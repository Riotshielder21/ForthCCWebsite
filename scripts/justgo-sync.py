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

async def sync_to_firestore(csv_path):
    print("Starting Firestore sync...")
    memberships = db.collection("memberships")

    # JustGo only supplies simple identity fields. Match each row to an existing record (a member who
    # joined on the website, or an earlier sync) so one person never has two records, and never overwrite
    # anything the website holds (subscriptions, privileges, history, safety details).
    by_number, by_person = {}, {}
    for doc in memberships.stream():
        data = doc.to_dict()
        if data.get("scaNumber"):
            by_number[str(data["scaNumber"])] = doc
        by_person[match_key(data.get("email", ""), data.get("dob", ""), data.get("firstName", ""), data.get("lastName", ""))] = doc

    with open(csv_path, mode='r', encoding='utf-8-sig') as f:
        batch = db.batch()
        writes = created = linked = 0

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
            reference = existing.reference if existing else memberships.document(f"sca-{number}")

            # JustGo is the authority on whether someone is a current member, and becomes their renewal method.
            # The exception is a website purchase awaiting upload that runs later than JustGo's record: keep it
            # active until the upload lands, but still link the JustGo number.
            held_until = current.get("validUntil")
            held_until = held_until.replace(tzinfo=None) if held_until else None
            website_ahead = current.get("justgoSyncStatus") == "pending" and held_until and (not valid_until or held_until > valid_until)
            fields = {
                "scaNumber": number,
                "lastJustgoSync": firestore.SERVER_TIMESTAMP,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
            if not website_ahead:
                fields.update({
                    "validUntil": valid_until,
                    "status": "active" if not valid_until or valid_until >= datetime.now() else "expired",
                    "justgoSyncStatus": "synced",
                    "renewalMethod": "justgo",
                    "justgoUpload": {"status": "done", "needsStaff": False, "nextAttemptAt": None},
                })
            # Identity and optional contact columns fill gaps only.
            optional = {
                "firstName": first, "lastName": last, "email": email, "dob": dob,
                "phone": pick(row, 'Phone', 'Mobile'), "address": pick(row, 'Address', 'Address 1'), "postcode": pick(row, 'Postcode'),
                "emergencyContact": {
                    "name": pick(row, 'Emergency Contact Name', 'Emergency Contact'),
                    "phone": pick(row, 'Emergency Contact Phone', 'Emergency Contact Number'),
                },
            }
            for key, value in optional.items():
                if key == "emergencyContact":
                    if (value["name"] or value["phone"]) and not current.get("emergencyContact"):
                        fields[key] = value
                elif value and not current.get(key):
                    fields[key] = value
            if not existing:
                fields["source"] = "justgo"
                fields["createdAt"] = firestore.SERVER_TIMESTAMP
            name_for_search = f"{fields.get('firstName') or current.get('firstName', '')} {fields.get('lastName') or current.get('lastName', '')}"
            fields["searchName"] = " ".join(name_for_search.lower().split())

            batch.set(reference, fields, merge=True)
            created += 0 if existing else 1
            linked += 1 if existing else 0
            writes += 1
            if writes % 400 == 0:
                batch.commit()
                batch = db.batch()

        batch.commit()
        print(f"Sync complete. {writes} members updated ({created} new, {linked} matched to existing records).")

if __name__ == "__main__":
    asyncio.run(run_sync())
