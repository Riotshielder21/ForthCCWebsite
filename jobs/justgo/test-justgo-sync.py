"""Checks the JustGo sync in an isolated emulator project: one register, no duplicates, website data preserved.

Run with the emulator up:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 venv/bin/python jobs/justgo/test-justgo-sync.py
"""
import asyncio
import datetime
import importlib.util
import os
import re
import sys
import uuid

from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore as gcf

if not os.environ.get("FIRESTORE_EMULATOR_HOST"):
    sys.exit("Set FIRESTORE_EMULATOR_HOST to a local Firestore emulator.")

sys.path.insert(0, os.path.dirname(__file__))
spec = importlib.util.spec_from_file_location("justgo_sync", os.path.join(os.path.dirname(__file__), "justgo-sync.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
run = uuid.uuid4().hex[:6]
sync.db = gcf.Client(project=f"demo-fcc-sync-{run}", credentials=AnonymousCredentials())
base = int(run, 16) % 900000 + 100000  # six-digit Paddle Scotland numbers unique to this run
alex_email = f"alex.sync.{run}@example.test"
new_email = f"new.person.{run}@example.test"
number_existing, number_new = f"{base}1", f"{base}2"
number_junior, number_missing_guardian = f"{base}4", f"{base}5"

memberships = sync.db.collection("memberships")
website = memberships.document(f"MEM-SYNC-{run}")
website.set({
    "firstName": "Alex", "lastName": "Tester", "searchName": "alex tester", "email": alex_email, "dob": "1988-05-05",
    "phone": "07700 900111", "address": "1 River Road", "postcode": "EH1 1AA", "status": "active", "source": "website",
    "justgoSyncStatus": "pending", "emergencyContact": {"name": "Pat Friend", "phone": "07700 900222", "relationship": "Friend"},
    "subscriptionItems": [{"productId": "boat-hire", "name": "ANNUAL BOAT & KIT HIRE"}], "keyAccess": {"source": "purchase"}, "medical": "Asthma",
})

ahead_email = f"ahead.{run}@example.test"
number_ahead = f"{base}3"
ahead = memberships.document(f"MEM-AHEAD-{run}")
ahead.set({
    "firstName": "Ada", "lastName": "Ahead", "searchName": "ada ahead", "email": ahead_email, "dob": "1985-03-03",
    "status": "active", "source": "website", "justgoSyncStatus": "pending", "renewalMethod": "website",
    "validUntil": datetime.datetime(2099, 3, 1, tzinfo=datetime.timezone.utc),
})

def person(number, first, last, dob, email, valid_until, member_id, *, guardian=None, phone="", address="", postcode="", status="active", **extra):
    return {
        "memberId": member_id, "number": number, "firstName": first, "lastName": last, "dob": dob, "email": email, "phone": phone,
        "address": address, "postcode": postcode, "guardian": guardian or {"firstName": "", "lastName": "", "email": ""},
        "status": status, "suspended": False, "suspension": "", "validUntil": valid_until, "tier": "adult",
        "membershipStatus": "Active", "membershipName": "FCC Adult", "accountStatus": "Active", "emailVerified": True, "clubRoles": "Member",
        "checks": {"pvg": {"status": "Approved", "expiresOn": "2099-01-31", "grantedOn": "2020-01-01", "name": "PVG"},
                   "safeguarding": {"status": "Completed", "expiresOn": "", "grantedOn": "", "name": "Safeguarding"}}, **extra,
    }


make_person = person

ids = {key: str(uuid.uuid4()) for key in ("alex", "ahead", "new", "junior", "missing", "gone", "bad")}
far, past = datetime.date(2099, 3, 1), datetime.date(2020, 3, 1)
people = [
    person(number_existing, "Alex", "Tester", "1988-05-05", alex_email, far, ids["alex"], phone="07111 111111", address="99 JustGo Rd", postcode="EH9 9JG"),
    person(number_ahead, "Ada", "Ahead", "1985-03-03", ahead_email, past, ids["ahead"], status="expired"),
    person(number_new, "New", "Person", "1990-02-01", new_email, past, ids["new"], status="expired", phone="07333 333333", address="5 Sync Street", postcode="EH5 5SS"),
    person(number_junior, "Young", "Member", "2015-02-01", f"child.{run}@example.test", far, ids["junior"],
           guardian={"firstName": "Parent", "lastName": "Member", "email": f"parent.{run}@example.test"}),
    person(number_missing_guardian, "Unknown", "Child", "2016-02-01", f"unknown.{run}@example.test", far, ids["missing"]),
]
snapshot = {"people": people, "problems": [{"justgoMemberId": ids["bad"], "memberNumber": "", "problem": "No number yet"}],
            "listedIds": {*(entry["memberId"] for entry in people), ids["bad"]}}

# A member staff unlinked from FCC in JustGo, and one whose JustGo record is temporarily unusable.
gone = memberships.document(f"MEM-GONE-{run}")
gone.set({"firstName": "Gone", "lastName": "Away", "justgoMemberId": ids["gone"], "justgoSyncStatus": "synced", "status": "active",
          "affiliationNumber": f"{base}6"})
bad = memberships.document(f"MEM-BAD-{run}")
bad.set({"firstName": "Bad", "lastName": "Data", "justgoMemberId": ids["bad"], "justgoSyncStatus": "synced", "status": "active"})

heartbeat = sync.db.collection("settings").document("justgoSync")
heartbeat.delete()
for attempt in range(2):  # the second run proves the sync is repeatable
    asyncio.run(sync.sync_snapshot_to_firestore(snapshot))
    assert heartbeat.get().to_dict()["lastSuccessAt"], "a completed run records its heartbeat"
    matches = list(memberships.where("email", "==", alex_email).stream())
    assert len(matches) == 1, f"run {attempt + 1}: expected one Alex record, found {len(matches)}"

alex = website.get().to_dict()
assert alex["affiliationNumber"] == number_existing, "JustGo number linked to the website record"
assert alex["justgoSyncStatus"] == "synced"
assert alex["membershipNumber"] == f"FCC-{number_existing}", "staff see the FCC membership number once synced"
assert alex["address"] == "1 River Road" and alex["phone"] == "07700 900111", "website contact details not overwritten"
assert alex["emergencyContact"]["name"] == "Pat Friend", "website emergency contact not overwritten"
assert alex["subscriptionItems"][0]["productId"] == "boat-hire" and alex["keyAccess"] and alex["medical"] == "Asthma", "website-only data kept"
assert alex["source"] == "website" and alex["searchName"] == "alex tester"
assert alex["status"] == "active"
assert alex["justgoMemberId"] == ids["alex"] and alex["justgoProfile"]["clubLinked"] is True and alex["justgoProfile"]["emailVerified"] is True
assert alex["checks"]["pvg"]["source"] == "justgo" and alex["checks"]["pvg"]["status"] == "Approved"
assert alex["checks"]["pvg"]["expiresOn"] == "2099-01-31" and alex["checks"]["pvg"]["label"] == "Approved, expires 31/01/2099"
assert alex["checks"]["safeguarding"]["label"] == "Completed"
assert alex["validUntil"] == datetime.datetime(2099, 3, 1, tzinfo=datetime.timezone.utc)

assert alex["renewalMethod"] == "justgo", "JustGo becomes the renewal method once linked"
assert alex["justgoUpload"]["status"] == "done", "linking finishes the upload"

held = ahead.get().to_dict()
assert held["affiliationNumber"] == number_ahead, "the JustGo number is linked"
assert held["status"] == "active" and held["justgoSyncStatus"] == "pending" and held["renewalMethod"] == "website", \
    "a website renewal paid after JustGo's expiry stays active until it is uploaded"

def only_record(number):
    found = list(memberships.where("affiliationNumber", "==", number).stream())
    assert len(found) <= 1, f"expected at most one record for {number}, found {len(found)}"
    return found[0] if found else None

created = only_record(number_new).reference
assert re.fullmatch(r"M\d{4,}", created.id), f"new members get a short permanent ID, not {created.id}"
person = created.get().to_dict()
assert re.fullmatch(r"H\d{5,}", person["householdId"]), "new JustGo households use the shared short-ID counter"
assert person["affiliationNumber"] == number_new and person["membershipNumber"] == f"FCC-{number_new}", "new JustGo member created once"
assert person["source"] == "justgo" and person["status"] == "expired" and person["searchName"] == "new person"
assert person["dob"] == "1990-02-01" and "phone" not in person and "email" not in person
household = sync.db.collection("households").document(person["householdId"]).get().to_dict()
assert household["email"] == new_email and household["phone"] == "07333 333333" and household["address"] == "5 Sync Street"
assert person["renewalMethod"] == "justgo"

junior_record = only_record(number_junior)
june = junior_record.to_dict()
junior_household = sync.db.collection("households").document(june["householdId"]).get().to_dict()
assert "email" not in june and "phone" not in june, "a junior member never owns the contact fields"
assert junior_household["contactName"] == "Parent Member" and junior_household["email"] == f"parent.{run}@example.test"
assert only_record(number_missing_guardian) is None, "an under-18 without guardian details is skipped"

gone_now = gone.get().to_dict()
assert gone_now["justgoProfile"]["clubLinked"] is False and gone_now["status"] == "active", "an unlink is flagged for staff, not acted on"
assert gone_now["justgoProfile"]["reviewReason"]
assert "justgoProfile" not in bad.get().to_dict(), "an unusable but still listed record is not mistaken for an unlink"
beat = heartbeat.get().to_dict()
assert beat["problemCount"] == 1 and beat["problems"][0]["justgoMemberId"] == ids["bad"] and beat["membersUnlinked"] == 0, beat

# Welcome emails: the first sync is a baseline import; later renewals and new joiners are flagged once per term.
assert not alex.get("welcomeEmailDue") and not june.get("welcomeEmailDue"), "the first sync imports existing members without welcome emails"
number_joiner, joiner_email = f"{base}7", f"joiner.{run}@example.test"
joiner = make_person(number_joiner, "Jo", "Joiner", "1992-04-04", joiner_email, far, str(uuid.uuid4()))
people[0] = {**people[0], "validUntil": datetime.date(2100, 3, 1)}
people.append(joiner)
snapshot["listedIds"].add(joiner["memberId"])
asyncio.run(sync.sync_snapshot_to_firestore(snapshot))
assert website.get().to_dict().get("welcomeEmailDue") is True, "a JustGo renewal after the first sync is due a welcome email"
joiner_record = only_record(number_joiner)
assert joiner_record.to_dict().get("welcomeEmailDue") is True, "someone who joins through JustGo is due a welcome email"
assert not ahead.get().to_dict().get("welcomeEmailDue"), "a membership JustGo has not renewed is not flagged"
website.update({"welcomeEmailDue": False})
asyncio.run(sync.sync_snapshot_to_firestore(snapshot))
assert website.get().to_dict().get("welcomeEmailDue") is False, "a repeat sync of the same term does not ask again"
people.pop()

# A lifetime membership keeps no expiry and stays active whatever JustGo says.
website.update({"lifetimeMembership": {"reason": "Committee"}, "validUntil": gcf.DELETE_FIELD, "status": "active"})
people[0] = {**people[0], "status": "expired", "validUntil": past}
asyncio.run(sync.sync_snapshot_to_firestore(snapshot))
lifer = website.get().to_dict()
assert lifer["status"] == "active" and "validUntil" not in lifer and not lifer.get("welcomeEmailDue"), lifer
assert lifer["lastJustgoSync"] and lifer["justgoProfile"]["clubLinked"] is True, "profile details still sync"

# A Paddle Scotland suspension blocks club activity even while a website renewal waits for upload.
people[1] = {**people[1], "suspended": True, "suspension": "Full", "status": "Suspended"}
asyncio.run(sync.sync_snapshot_to_firestore(snapshot))
held = ahead.get().to_dict()
assert held["status"] == "Suspended" and held["justgoSyncStatus"] == "pending" and held["justgoProfile"]["suspended"] is True

gone.delete()
bad.delete()
website.delete()
ahead.delete()
created.delete()
sync.db.collection("households").document(person["householdId"]).delete()
junior_record.reference.delete()
sync.db.collection("households").document(june["householdId"]).delete()
sync.db.collection("households").document(joiner_record.to_dict()["householdId"]).delete()
joiner_record.reference.delete()
print("JustGo sync checks passed: linking, no duplicates, website data preserved, gaps filled, credentials, unlinks, suspensions, repeatable.")
