"""Checks the JustGo upload queue against the Firestore emulator with a fake uploader.

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

spec = importlib.util.spec_from_file_location("justgo_upload", os.path.join(os.path.dirname(__file__), "justgo-upload.py"))
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)
db = gcf.Client(project=os.environ.get("GCLOUD_PROJECT", "demo-fcc"), credentials=AnonymousCredentials())

run = uuid.uuid4().hex[:6]
T0 = datetime.datetime(2026, 10, 11, 9, 0, tzinfo=datetime.timezone.utc)
hours = lambda n: datetime.timedelta(hours=n)
days = lambda n: datetime.timedelta(days=n)

# Every other pending member must be settled so the pass only sees ours.
for stale in db.collection("memberships").where("justgoSyncStatus", "==", "pending").stream():
    stale.reference.set({"justgoSyncStatus": "synced"}, merge=True)


class FakeUploader:
    def __init__(self, failing):
        self.failing, self.calls = failing, []

    async def upload(self, member):
        self.calls.append((member["id"], member["justgoUpload"]["attempts"]))
        if member["id"] in self.failing:
            raise upload.UploadError("JustGo said no")
        return {}


def member(key, state):
    reference = db.collection("memberships").document(f"UP-{key}-{run}")
    reference.set({"firstName": key, "lastName": "Test", "email": f"{key}.{run}@example.test", "justgoSyncStatus": "pending", "justgoUpload": state})
    return reference


queued = member("queued", {"status": "queued", "attempts": 0, "failures": 0, "mode": "new"})
failing = member("failing", {"status": "queued", "attempts": 0, "failures": 0, "mode": "invite"})
expired = member("expired", {"status": "invited", "attempts": 1, "failures": 0, "mode": "new", "inviteExpiresAt": T0 - days(1)})
waiting = member("waiting", {"status": "invited", "attempts": 1, "failures": 0, "mode": "new", "inviteExpiresAt": T0 + days(3)})
manual = member("manual", {"status": "manual", "attempts": 0, "failures": 0})
spent = member("spent", {"status": "failed", "attempts": upload.MAX_ATTEMPTS, "failures": 8, "needsStaff": True, "nextAttemptAt": None})
uploader = FakeUploader({f"UP-failing-{run}"})


def state(reference):
    return reference.get().to_dict()["justgoUpload"]


summary = asyncio.run(upload.process_queue(db, uploader, T0))
assert summary["invited"] == 2 and summary["failed"] == 1, summary
assert state(queued)["status"] == "invited" and state(queued)["inviteExpiresAt"] == T0 + days(upload.INVITE_DAYS), "invite expiry recorded"
assert state(queued)["attempts"] == 1
f1 = state(failing)
assert (f1["status"], f1["failures"], f1["attempts"], f1["needsStaff"]) == ("failed", 1, 1, False), f1
assert f1["lastError"] == "JustGo said no" and f1["nextAttemptAt"] == T0 + hours(1), "first retry after an hour"
e1 = state(expired)
assert (e1["status"], e1["failures"], e1["attempts"]) == ("invited", 1, 2), "an expired invitation counts as a failure and is resent at once"
assert state(waiting)["status"] == "invited" and state(waiting)["attempts"] == 1, "an open invitation is left alone"
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
assert (f3["status"], f3["needsStaff"], f3["failures"]) == ("invited", False, 2), "a later success clears the staff flag but keeps the failure count"

asyncio.run(upload.process_queue(db, uploader, T0 + days(9)))
assert state(queued)["status"] == "invited" and state(queued)["failures"] == 1 and state(queued)["attempts"] == 2, "the unaccepted invitation was resent"

for reference in (queued, failing, expired, waiting, manual, spent):
    reference.delete()
print("JustGo upload checks passed: invitations, expiry resends, backoff, staff flag, failure counts, manual skip, attempt limit.")
