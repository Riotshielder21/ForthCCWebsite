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
# In a real environment, use Environment Variables for security
JUSTGO_USER = os.environ.get("JUSTGO_USER", "your_email@example.com")
JUSTGO_PASS = os.environ.get("JUSTGO_PASS", "your_password")
JUSTGO_URL = "https://sca.justgo.com/Account/Login"

# Firebase Setup
# You would download your serviceAccountKey.json from Firebase Settings
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

            # 3. Navigate to Member List / Reports
            # Note: JustGo UI changes often. These selectors are illustrative 
            # and would need to be matched to the specific 'Club Admin' view.
            await page.goto("https://sca.justgo.com/ClubAdmin/Members")
            
            # 4. Trigger Download
            print("Triggering CSV Export...")
            async with page.expect_download() as download_info:
                # Find the 'Export' or 'Download' button
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

async def sync_to_firestore(csv_path):
    print("Starting Firestore sync...")
    app_id = "forth-canoe-default" # Match this to your React App ID
    
    with open(csv_path, mode='r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        batch = db.batch()
        count = 0
        
        for row in reader:
            # Clean up keys based on JustGo's header format
            # Example: JustGo uses 'Membership Number' or 'SCA ID'
            sca_id = row.get('Membership Number') or row.get('Member ID')
            expiry = row.get('Expiry Date')
            name = row.get('First Name', '') + " " + row.get('Last Name', '')

            if sca_id:
                # Path format follows Rule 1 of our instructions
                doc_ref = db.collection("artifacts").document(app_id).collection("public").document("data").collection("members").document(str(sca_id))
                
                batch.set(doc_ref, {
                    "scaId": sca_id,
                    "name": name,
                    "expiry": expiry,
                    "lastUpdated": firestore.SERVER_TIMESTAMP,
                    "status": "Active" # You could add logic here to check if expiry > today
                })
                count += 1
                
                # Firestore batches have a limit of 500 operations
                if count % 400 == 0:
                    await batch.commit()
                    batch = db.batch()

        await batch.commit()
        print(f"Sync complete. {count} members updated in database.")

if __name__ == "__main__":
    asyncio.run(run_sync())