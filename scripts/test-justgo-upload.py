"""Checks the JustGo upload queue in an isolated emulator project with a fake uploader.

Run with the emulator up:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 venv/bin/python scripts/test-justgo-upload.py
"""
import asyncio
import datetime
import importlib.util
import os
import sys
import uuid

from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore as gcf

if not os.environ.get("FIRESTORE_EMULATOR_HOST"):
    sys.exit("Set FIRESTORE_EMULATOR_HOST to a local Firestore emulator.")

sys.path.insert(0, os.path.dirname(__file__))
spec = importlib.util.spec_from_file_location("justgo_upload", os.path.join(os.path.dirname(__file__), "justgo-upload.py"))
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)
run = uuid.uuid4().hex[:6]
db = gcf.Client(project=f"demo-fcc-upload-{run}", credentials=AnonymousCredentials())
T0 = datetime.datetime(2026, 10, 11, 9, 0, tzinfo=datetime.timezone.utc)
hours = lambda n: datetime.timedelta(hours=n)
days = lambda n: datetime.timedelta(days=n)


class FakeUploader:
    def __init__(self, failing, uncertain=()):
        self.failing, self.uncertain, self.calls = failing, set(uncertain), []

    async def upload(self, member):
        self.calls.append((member["id"], member["justgoUpload"]["attempts"], member.get("email", ""), member.get("contactName", "")))
        if member["id"] in self.failing:
            raise upload.UploadError("JustGo said no")
        if member["id"] in self.uncertain:
            raise upload.JustGoReviewRequired("JustGo write returned HTTP 500; reconcile before retrying.")
        return {"status": "submitted", "justgoMemberId": f"jg-{member['id']}", "createdAccount": True,
                "clubLinkReference": "LINK-1", "membershipIds": ["MS-1"]}


def member(key, state, household_id=""):
    reference = db.collection("memberships").document(f"UP-{key}-{run}")
    reference.set({"firstName": key, "lastName": "Test", "email": f"{key}.{run}@example.test", "justgoSyncStatus": "pending", "justgoUpload": state,
                   **({"householdId": household_id} if household_id else {})})
    return reference


household_id = f"HH-UP-{run}"
db.collection("households").document(household_id).set({
    "contactName": "Parent Contact", "contactRelationship": "Parent", "email": f"parent.{run}@example.test",
    "phone": "0777", "address": "1 Road", "postcode": "EH1"
})
queued = member("queued", {"status": "queued", "attempts": 0, "failures": 0}, household_id)
failing = member("failing", {"status": "queued", "attempts": 0, "failures": 0})
uncertain = member("uncertain", {"status": "queued", "attempts": 0, "failures": 0})
stale = member("stale", {"status": "submitted", "attempts": 1, "failures": 0, "lastAttemptAt": T0 - days(9)})
waiting = member("waiting", {"status": "submitted", "attempts": 1, "failures": 0, "lastAttemptAt": T0 - days(3)})
manual = member("manual", {"status": "manual", "attempts": 0, "failures": 0})
spent = member("spent", {"status": "failed", "attempts": upload.MAX_ATTEMPTS, "failures": 8, "needsStaff": True, "nextAttemptAt": None})
uploader = FakeUploader({f"UP-failing-{run}"}, {f"UP-uncertain-{run}"})


def state(reference):
    return reference.get().to_dict()["justgoUpload"]


summary = asyncio.run(upload.process_queue(db, uploader, T0))
assert summary["submitted"] == 1 and summary["failed"] == 1 and summary["review"] == 1 and summary["waiting"] == 2, summary
q1 = state(queued)
assert (q1["status"], q1["attempts"], q1["clubLinkReference"], q1["membershipIds"], q1["createdAccount"]) == ("submitted", 1, "LINK-1", ["MS-1"], True), q1
assert queued.get().to_dict()["justgoMemberId"] == f"jg-UP-queued-{run}", "the JustGo member ID is stored"
assert "mode" not in q1 and "inviteExpiresAt" not in q1
assert (f"UP-queued-{run}", 1, f"parent.{run}@example.test", "Parent Contact") in uploader.calls, "JustGo upload reads contact details from the household"
f1 = state(failing)
assert (f1["status"], f1["failures"], f1["attempts"], f1["needsStaff"]) == ("failed", 1, 1, False), f1
assert f1["lastError"] == "JustGo said no" and f1["nextAttemptAt"] == T0 + hours(1), "first retry after an hour"
u1 = state(uncertain)
assert (u1["status"], u1["needsStaff"], u1["nextAttemptAt"]) == ("review", True, None), "an uncertain write is never retried automatically"
assert state(stale)["needsStaff"] is True and "8 days" in state(stale)["lastError"], "an unconfirmed submission is flagged"
assert state(waiting)["status"] == "submitted" and not state(waiting).get("needsStaff"), "a recent submission waits for the sync"
assert state(manual)["status"] == "manual", "staff-handled members are skipped"
assert state(spent)["attempts"] == upload.MAX_ATTEMPTS and not [call for call in uploader.calls if call[0] == f"UP-spent-{run}"], "stops after the maximum attempts"

summary = asyncio.run(upload.process_queue(db, uploader, T0 + hours(0.5)))
assert summary["failed"] == 0 and not [call for call in uploader.calls if call[0] == f"UP-failing-{run}" and call[1] == 2], "no retry before the delay"

asyncio.run(upload.process_queue(db, uploader, T0 + hours(2)))
f2 = state(failing)
assert (f2["failures"], f2["attempts"], f2["needsStaff"]) == (2, 2, True), "flagged for staff after repeated failures"
assert f2["nextAttemptAt"] == T0 + hours(2 + upload.BACKOFF_HOURS[1]), "the delay grows"

uploader.failing.clear()
asyncio.run(upload.process_queue(db, uploader, T0 + hours(2 + 7)))
f3 = state(failing)
assert (f3["status"], f3["needsStaff"], f3["failures"]) == ("submitted", False, 2), "a later success clears the staff flag but keeps the failure count"

asyncio.run(upload.process_queue(db, uploader, T0 + days(1)))
assert state(queued)["attempts"] == 1 and state(uncertain)["attempts"] == 1, "submitted and review members are never re-sent"

for reference in (queued, failing, uncertain, stale, waiting, manual, spent):
    reference.delete()
db.collection("households").document(household_id).delete()
print("JustGo upload checks passed: submissions, references, uncertain-write review, unconfirmed flag, backoff, staff flag, manual skip, attempt limit.")
