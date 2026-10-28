"""Tries to add website members to JustGo, tracks every attempt, and hands failures to staff.

Run on a schedule (see config/fcc-upload.timer). Each website member waiting for JustGo has a `justgoUpload` record:
  queued   -> waiting for an attempt        invited -> JustGo has emailed them; waiting for them to accept
  failed   -> last attempt failed; retried later with a growing delay
  manual   -> staff entered them by hand; the weekly sync will link them
Invitations expire, so an unaccepted one counts as a failure and is sent again. After STAFF_AFTER failures the
member is flagged `needsStaff` and appears on the register's staff list with the attempt count and last problem.
The weekly sync (justgo-sync.py) marks them done once JustGo lists them.
"""
import asyncio
import datetime
import json
import os

import firebase_admin
from firebase_admin import credentials, firestore

MAX_ATTEMPTS = int(os.environ.get("JUSTGO_UPLOAD_MAX_ATTEMPTS", "8"))
STAFF_AFTER = int(os.environ.get("JUSTGO_UPLOAD_STAFF_AFTER", "2"))
INVITE_DAYS = int(os.environ.get("JUSTGO_INVITE_DAYS", "7"))
BACKOFF_HOURS = [1, 6, 24, 24, 48, 72, 72, 168]
CONFIG_PATH = os.environ.get("JUSTGO_UPLOAD_CONFIG", os.path.join(os.path.dirname(__file__), "..", "config", "justgo-upload.json"))

try:
    firebase_admin.initialize_app(credentials.Certificate("serviceAccountKey.json"))
    db = firestore.client()
except Exception as error:  # the tests and local runs supply their own `db`
    print(f"Firebase Init Error: {error}. Ensure serviceAccountKey.json is present.")


class UploadError(Exception):
    """An attempt failed for a reason staff should know about."""


class NotConfiguredUploader:
    async def upload(self, member):
        raise UploadError("JustGo upload automation is not configured yet (config/justgo-upload.json)")


class PlaywrightUploader:
    """Fills JustGo's add-member / invite form using selectors from config/justgo-upload.json.

    The selectors must be mapped to JustGo's real forms before this can run; until then every attempt fails
    cleanly and the member lands on the staff list.
    """

    def __init__(self, config):
        self.config = config

    async def upload(self, member):
        from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

        mode = member["justgoUpload"].get("mode", "new")
        form = self.config["forms"][mode]
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await (await browser.new_context()).new_page()
            try:
                await page.goto(self.config["login_url"])
                await page.fill(self.config["login"]["user"], os.environ["JUSTGO_USER"])
                await page.fill(self.config["login"]["password"], os.environ["JUSTGO_PASS"])
                await page.click(self.config["login"]["submit"])
                await page.wait_for_selector(self.config["login"]["ready"], timeout=30000)
                await page.goto(form["url"])
                for field, selector in form["fields"].items():
                    value = member.get(field) or ""
                    if value:
                        await page.fill(selector, str(value))
                await page.click(form["submit"])
                await page.wait_for_selector(form["success"], timeout=30000)
            except PlaywrightTimeout as error:
                raise UploadError(f"JustGo did not confirm the upload: {error}") from error
            finally:
                await browser.close()
        return {"inviteExpiresAt": None}

def upload_details(database, member):
    household_id = member.get("householdId")
    if not household_id:
        return member
    document = database.collection("households").document(household_id).get()
    if not document.exists:
        raise UploadError(f"Household {household_id} is missing.")
    household = document.to_dict()
    if not household.get("email"):
        raise UploadError(f"Household {household_id} has no contact email.")
    return {
        **member,
        "contactName": household.get("contactName", ""),
        "contactRelationship": household.get("contactRelationship", ""),
        "email": household.get("email", ""),
        "phone": household.get("phone", ""),
        "address": household.get("address", ""),
        "postcode": household.get("postcode", ""),
        "emergencyContact": household.get("emergencyContact", {}),
    }


def load_uploader():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as handle:
            return PlaywrightUploader(json.load(handle))
    except FileNotFoundError:
        return NotConfiguredUploader()


def utcnow():
    return datetime.datetime.now(datetime.timezone.utc)


def after_failure(state, message, now):
    failures = int(state.get("failures", 0)) + 1
    attempts = int(state.get("attempts", 0))
    delay = BACKOFF_HOURS[min(failures - 1, len(BACKOFF_HOURS) - 1)]
    return {
        **state, "status": "failed", "failures": failures, "attempts": attempts, "lastError": message[:300], "lastAttemptAt": now,
        "needsStaff": failures >= STAFF_AFTER,
        "nextAttemptAt": now + datetime.timedelta(hours=delay) if attempts < MAX_ATTEMPTS else None,
    }


async def process_queue(database, uploader, now=None):
    """One pass over everyone still waiting for JustGo. Returns counts for the log."""
    now = now or utcnow()
    summary = {"invited": 0, "failed": 0, "waiting": 0, "skipped": 0}
    for document in database.collection("memberships").where(filter=firestore.FieldFilter("justgoSyncStatus", "==", "pending")).stream():
        member = {"id": document.id, **document.to_dict()}
        state = dict(member.get("justgoUpload") or {"status": "queued", "attempts": 0, "failures": 0, "mode": "new"})
        status = state.get("status", "queued")
        if status == "manual":
            summary["skipped"] += 1
            continue
        if status == "invited":
            expires = state.get("inviteExpiresAt")
            if expires and expires > now:
                summary["waiting"] += 1
                continue
            state = after_failure(state, "The JustGo invitation expired without being accepted", now)
            state["nextAttemptAt"] = now
        due = state.get("nextAttemptAt")
        if int(state.get("attempts", 0)) >= MAX_ATTEMPTS or (due and due > now):
            if state != member.get("justgoUpload"):
                document.reference.set({"justgoUpload": state, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True)
            summary["skipped"] += 1
            continue
        state["attempts"] = int(state.get("attempts", 0)) + 1
        member["justgoUpload"] = state
        try:
            result = await uploader.upload(upload_details(database, member)) or {}
        except UploadError as error:
            state = after_failure(state, str(error), now)
            summary["failed"] += 1
        except Exception as error:  # an unexpected crash is still a failed attempt, never a lost member
            state = after_failure(state, f"Unexpected error: {error}", now)
            summary["failed"] += 1
        else:
            state = {**state, "status": "invited", "lastError": "", "needsStaff": False, "lastAttemptAt": now, "invitedAt": now,
                     "inviteExpiresAt": result.get("inviteExpiresAt") or now + datetime.timedelta(days=INVITE_DAYS), "nextAttemptAt": None}
            summary["invited"] += 1
        document.reference.set({"justgoUpload": state, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True)
    return summary


if __name__ == "__main__":
    print(f"[{utcnow().isoformat()}] JustGo upload pass: {asyncio.run(process_queue(db, load_uploader()))}")
