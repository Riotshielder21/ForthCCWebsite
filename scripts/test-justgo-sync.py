"""Checks the JustGo sync against the Firestore emulator: one register, no duplicates, nothing of ours overwritten.

Run with the emulator up:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 venv/bin/python scripts/test-justgo-sync.py
"""
import asyncio
import csv
import datetime
import importlib.util
import os
import sys
import tempfile
import uuid

from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore as gcf

if not os.environ.get("FIRESTORE_EMULATOR_HOST"):
    sys.exit("Set FIRESTORE_EMULATOR_HOST to a local Firestore emulator.")

spec = importlib.util.spec_from_file_location("justgo_sync", os.path.join(os.path.dirname(__file__), "justgo-sync.py"))
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)
sync.db = gcf.Client(project=os.environ.get("GCLOUD_PROJECT", "demo-fcc"), credentials=AnonymousCredentials())

run = uuid.uuid4().hex[:6]
alex_email = f"alex.sync.{run}@example.test"
new_email = f"new.person.{run}@example.test"
number_existing, number_new = f"JG-{run}-1", f"JG-{run}-2"

memberships = sync.db.collection("memberships")
website = memberships.document(f"MEM-SYNC-{run}")
website.set({
    "firstName": "Alex", "lastName": "Tester", "searchName": "alex tester", "email": alex_email, "dob": "1988-05-05",
    "phone": "07700 900111", "address": "1 River Road", "postcode": "EH1 1AA", "status": "active", "source": "website",
    "justgoSyncStatus": "pending", "emergencyContact": {"name": "Pat Friend", "phone": "07700 900222", "relationship": "Friend"},
    "privileges": [{"productId": "boat-hire", "name": "ANNUAL BOAT & KIT HIRE"}], "history": [{"orderRef": "FCC-X"}], "medical": "Asthma",
})

ahead_email = f"ahead.{run}@example.test"
number_ahead = f"JG-{run}-3"
ahead = memberships.document(f"MEM-AHEAD-{run}")
ahead.set({
    "firstName": "Ada", "lastName": "Ahead", "searchName": "ada ahead", "email": ahead_email, "dob": "1985-03-03",
    "status": "active", "source": "website", "justgoSyncStatus": "pending", "renewalMethod": "website",
    "validUntil": datetime.datetime(2099, 3, 1, tzinfo=datetime.timezone.utc),
})

header = ["Membership Number", "First Name", "Last Name", "Email", "Date of Birth", "Expiry Date", "Phone", "Address", "Postcode", "Emergency Contact Name", "Emergency Contact Phone"]
rows = [
    [number_existing, "Alex", "Tester", alex_email, "05/05/1988", "01/03/2099", "07111 111111", "99 JustGo Rd", "EH9 9JG", "JG Emergency", "07222 222222"],
    [number_ahead, "Ada", "Ahead", ahead_email, "03/03/1985", "01/03/2020", "", "", "", "", ""],
    [number_new, "New", "Person", new_email, "01/02/1990", "01/03/2020", "07333 333333", "5 Sync Street", "EH5 5SS", "Sync Contact", "07444 444444"],
]
with tempfile.NamedTemporaryFile("w", suffix=".csv", newline="", delete=False, encoding="utf-8") as handle:
    csv.writer(handle).writerows([header, *rows])
    path = handle.name

for attempt in range(2):  # the second run proves the sync is repeatable
    asyncio.run(sync.sync_to_firestore(path))
    matches = list(memberships.where("email", "==", alex_email).stream())
    assert len(matches) == 1, f"run {attempt + 1}: expected one Alex record, found {len(matches)}"

alex = website.get().to_dict()
assert alex["scaNumber"] == number_existing, "JustGo number linked to the website record"
assert alex["justgoSyncStatus"] == "synced"
assert alex["address"] == "1 River Road" and alex["phone"] == "07700 900111", "website contact details not overwritten"
assert alex["emergencyContact"]["name"] == "Pat Friend", "website emergency contact not overwritten"
assert alex["privileges"][0]["productId"] == "boat-hire" and alex["history"] and alex["medical"] == "Asthma", "website-only data kept"
assert alex["source"] == "website" and alex["searchName"] == "alex tester"
assert alex["status"] == "active"

assert alex["renewalMethod"] == "justgo", "JustGo becomes the renewal method once linked"
assert alex["justgoUpload"]["status"] == "done", "linking finishes the upload"

held = ahead.get().to_dict()
assert held["scaNumber"] == number_ahead, "the JustGo number is linked"
assert held["status"] == "active" and held["justgoSyncStatus"] == "pending" and held["renewalMethod"] == "website", \
    "a website renewal paid after JustGo's expiry stays active until it is uploaded"

created = list(memberships.where("email", "==", new_email).stream())
assert len(created) == 1 and created[0].id == f"sca-{number_new}", "new JustGo member created once under its number"
person = created[0].to_dict()
assert person["source"] == "justgo" and person["status"] == "expired" and person["searchName"] == "new person"
assert person["dob"] == "1990-02-01" and person["phone"] == "07333 333333" and person["address"] == "5 Sync Street"
assert person["emergencyContact"]["name"] == "Sync Contact", "optional JustGo columns fill gaps for new members"
assert person["renewalMethod"] == "justgo"

os.unlink(path)
website.delete()
ahead.delete()
created[0].reference.delete()
print("JustGo sync checks passed: linking, no duplicates, website data preserved, gaps filled, repeatable.")
