import os
import csv
import time
import json
import asyncio
from datetime import datetime
from playwright.async_api import async_playwright
import firebase_admin
from firebase_admin import credentials, firestore

# --- CONFIGURATION ---
JUSTGO_USER = os.environ.get("JUSTGO_USER", "your_email@example.com")
JUSTGO_PASS = os.environ.get("JUSTGO_PASS", "your_password")
JUSTGO_URL = "https://sca.justgo.com/Account/Login"

# Firebase Setup
try:
    cred = credentials.Certificate("serviceAccountKey.json")
    firebase_admin.initialize_app(cred)
    db = firestore.client()
except Exception as e:
    print(f"Firebase Init Error: {e}. Ensure serviceAccountKey.json is present.")

async def run_sync():
    async with async_playwright() as p:
        # 1. Launch Browser
        print(f"[{datetime.now()}] Launching browser...")
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(accept_downloads=True)
        page = await context.new_page()

        try:
            # 2. Login
            print("Logging into JustGo...")
            await page.goto(JUSTGO_URL)
            await page.fill('input[name="Username"]', JUSTGO_USER)
            await page.fill('input[name="Password"]', JUSTGO_PASS)
            await page.click('button[type="submit"]')
            
            # Wait for dashboard to load
            await page.wait_for_selector(".dashboard-container", timeout=30000)
            print("Login successful.")

            # 3. Navigate to Member List
            await page.goto("https://sca.justgo.com/ClubAdmin/Members")
            
            # 4. Trigger Download
            print("Triggering CSV Export...")
            async with page.expect_download() as download_info:
                await page.click('button:has-text("Export")') 
            
            download = await download_info.value
            path = f"./downloads/members_{int(time.time())}.csv"
            await download.save_as(path)
            print(f"CSV saved to {path}")

            # 5. Parse CSV and Sync to Firestore
            await sync_to_firestore(path)

        except Exception as e:
            print(f"Error during automation: {e}")
        finally:
            await browser.close()

def parse_date(value):
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime((value or "").strip(), fmt)
        except ValueError:
            continue
    return None

def pick(row, *names):
    for name in names:
        value = (row.get(name) or "").strip()
        if value:
            return value
    return ""

def match_key(email, dob, first, last):
    return f"{email.lower()}|{dob}|{first.lower()} {last.lower()}".strip()

class WrittenRecord:
    """A record written earlier in this sync, matched like a Firestore snapshot by later rows."""
    def __init__(self, reference, data):
        self.reference, self._data = reference, data

    def to_dict(self):
        return dict(self._data)

def membership_number_for(number):
    """The Paddle Scotland number staff see, kept separate from the permanent record ID so it can change."""
    number = str(number or "").strip()
    return f"FCC-{number}" if number.isdigit() and 4 <= len(number) <= 8 else ""

def allocate_record_id(collection, prefix, digits):
    """Reserve a permanent short ID using the same counter as website checkout."""
    counter = db.collection("counters").document(collection)
    records = db.collection(collection)

    @firestore.transactional
    def take(transaction):
        snapshot = counter.get(transaction=transaction)
        number = (snapshot.to_dict() or {}).get("next", 1) if snapshot.exists else 1
        if type(number) is not int or number < 1:
            raise ValueError(f"Invalid {collection} ID counter.")
        while records.document(f"{prefix}{number:0{digits}d}").get(transaction=transaction).exists:
            number += 1
        transaction.set(counter, {"next": number + 1}, merge=True)
        return f"{prefix}{number:0{digits}d}"

    return take(db.transaction())

def allocate_member_id():
    return allocate_record_id("memberships", "M", 4)

async def sync_to_firestore(csv_path):
    print("Starting Firestore sync...")
    memberships = db.collection("memberships")
    households = db.collection("households")
    household_by_id = {document.id: document.to_dict() for document in households.stream()}
    household_by_email = {data.get("email", "").lower(): household_id for household_id, data in household_by_id.items() if data.get("email")}

    # JustGo only supplies simple identity fields. Match each row to an existing record (a member who
    # joined on the website, or an earlier sync) so one person never has two records, and never overwrite
    # anything the website holds (subscriptions, privileges, history, safety details).
    by_number, by_person = {}, {}
    for doc in memberships.stream():
        data = doc.to_dict()
        if data.get("affiliationNumber"):
            by_number[str(data["affiliationNumber"])] = doc
        household = household_by_id.get(data.get("householdId"), {})
        by_person[match_key(data.get("email") or household.get("email", ""), data.get("dob", ""), data.get("firstName", ""), data.get("lastName", ""))] = doc

    with open(csv_path, mode='r', encoding='utf-8-sig') as f:
        batch = db.batch()
        writes = pending = created = linked = 0

        for row in csv.DictReader(f):
            number = pick(row, 'Membership Number', 'Member ID')
            if not number:
                continue
            first, last = pick(row, 'First Name'), pick(row, 'Last Name')
            email = pick(row, 'Email').lower()
            dob_date = parse_date(pick(row, 'Date of Birth', 'DOB'))
            dob = dob_date.strftime("%Y-%m-%d") if dob_date else ""
            valid_until = parse_date(pick(row, 'Expiry Date'))

            existing = by_number.get(number) or by_person.get(match_key(email, dob, first, last))
            current = existing.to_dict() if existing else {}

            # JustGo is the authority on whether someone is a current member, and becomes their renewal method.
            # The exception is a website purchase awaiting upload that runs later than JustGo's record: keep it
            # active until the upload lands, but still link the JustGo number.
            held_until = current.get("validUntil")
            held_until = held_until.replace(tzinfo=None) if held_until else None
            website_ahead = current.get("justgoSyncStatus") == "pending" and held_until and (not valid_until or held_until > valid_until)
            fields = {
                "affiliationNumber": number,
                "membershipNumber": membership_number_for(number),
                "lastJustgoSync": firestore.SERVER_TIMESTAMP,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
            # Only use explicitly supplied check columns, never infer clearance from an active membership.
            checks = dict(current.get("checks") or {})
            for check, column in (("pvg", "PVG Status"), ("safeguarding", "Safeguarding Status")):
                if column in row:
                    label = pick(row, column)[:120] or "Not supplied by JustGo"
                    checks[check] = {"source": "justgo", "label": label, "updatedAt": firestore.SERVER_TIMESTAMP}
            if checks:
                fields["checks"] = checks
            if not website_ahead:
                fields.update({
                    "validUntil": valid_until,
                    "status": "active" if not valid_until or valid_until >= datetime.now() else "expired",
                    "justgoSyncStatus": "synced",
                    "renewalMethod": "justgo",
                    "justgoUpload": {"status": "done", "needsStaff": False, "nextAttemptAt": None},
                })
            # Identity and optional contact columns fill gaps only.
            optional = {"firstName": first, "lastName": last, "dob": dob}
            for key, value in optional.items():
                if value and not current.get(key):
                    fields[key] = value
            if not existing:
                today = datetime.now().date()
                age = today.year - dob_date.year - ((today.month, today.day) < (dob_date.month, dob_date.day)) if dob_date else 18
                is_junior = age < 18
                if is_junior:
                    contact = {
                        "contactName": pick(row, 'Parent/Guardian Name', 'Guardian Name'),
                        "contactRelationship": pick(row, 'Parent/Guardian Relationship', 'Guardian Relationship'),
                        "email": pick(row, 'Parent/Guardian Email', 'Guardian Email').lower(),
                        "phone": pick(row, 'Parent/Guardian Phone', 'Guardian Phone'),
                        "address": pick(row, 'Parent/Guardian Address', 'Guardian Address'),
                        "postcode": pick(row, 'Parent/Guardian Postcode', 'Guardian Postcode'),
                    }
                    if not all(contact.values()):
                        print(f"Skipping {number}: the JustGo row identifies an under-18 but has no complete parent/guardian contact.")
                        continue
                else:
                    contact = {
                        "contactName": f"{first} {last}".strip(), "contactRelationship": "Member", "email": email,
                        "phone": pick(row, 'Phone', 'Mobile'), "address": pick(row, 'Address', 'Address 1'), "postcode": pick(row, 'Postcode'),
                    }
                emergency = {
                    "name": pick(row, 'Emergency Contact Name', 'Emergency Contact'),
                    "phone": pick(row, 'Emergency Contact Phone', 'Emergency Contact Number'),
                    "relationship": pick(row, 'Emergency Contact Relationship'),
                }
                if not is_junior and any(emergency.values()):
                    contact["emergencyContact"] = emergency
                household_id = household_by_email.get(contact["email"].lower()) if is_junior else None
                household_id = household_id or allocate_record_id("households", "H", 5)
                fields["householdId"] = household_id
                if household_id not in household_by_id:
                    household_fields = {**contact, "updatedAt": firestore.SERVER_TIMESTAMP, "createdAt": firestore.SERVER_TIMESTAMP}
                    batch.set(households.document(household_id), household_fields, merge=True)
                    household_by_id[household_id] = contact
                    household_by_email[contact["email"].lower()] = household_id
                    pending += 1
                fields["source"] = "justgo"
                fields["schemaVersion"] = 3
                fields["createdAt"] = firestore.SERVER_TIMESTAMP
            name_for_search = f"{fields.get('firstName') or current.get('firstName', '')} {fields.get('lastName') or current.get('lastName', '')}"
            fields["searchName"] = " ".join(name_for_search.lower().split())

            if not membership_number_for(number):
                print(f"Warning: JustGo number {number} is not 4 to 8 digits, so no FCC membership number was set.")
            reference = existing.reference if existing else memberships.document(allocate_member_id())
            batch.set(reference, fields, merge=True)
            # Later rows for the same person in this file update this record rather than allocating another.
            by_number[number] = WrittenRecord(reference, {**current, **fields})
            created += 0 if existing else 1
            linked += 1 if existing else 0
            writes += 1
            pending += 1
            if pending >= 400:
                batch.commit()
                batch = db.batch()
                pending = 0

        batch.commit()
        print(f"Sync complete. {writes} members updated ({created} new, {linked} matched to existing records).")

if __name__ == "__main__":
    asyncio.run(run_sync())
