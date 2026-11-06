"""Uploads paid website memberships through the default-disabled JustGo API.

Cloud Run job fcc-justgo-upload, run hourly by Cloud Scheduler. Each website member waiting for JustGo has a `justgoUpload` record:
  queued     -> waiting for an attempt
  processing -> an attempt is in progress (if interrupted, staff reconcile JustGo before retrying)
  submitted  -> the account was found or created, linked to FCC and given the FCC membership; awaiting the read sync
  failed     -> a request was refused before anything was written; retried later with a growing delay
  review     -> the result is uncertain or needs a decision (ambiguous identity, suspension, partial write)
  manual     -> staff entered them by hand; the sync will link them
  revoked    -> the website membership was revoked; staff decide what to change in JustGo
After STAFF_AFTER failures the member is flagged `needsStaff` and appears on the register's staff list with the attempt
count and last problem. A submission the sync has not confirmed within 8 days is also flagged. Any emails (account
creation, club-link notices) are sent by JustGo itself.
"""
import asyncio
import datetime
import os

from firebase_admin import firestore
from justgo_api import APIUploader, JustGoClient, JustGoError, JustGoReviewRequired, firestore_database, integration_config

MAX_ATTEMPTS = int(os.environ.get("JUSTGO_UPLOAD_MAX_ATTEMPTS", "8"))
STAFF_AFTER = int(os.environ.get("JUSTGO_UPLOAD_STAFF_AFTER", "2"))
BACKOFF_HOURS = [1, 6, 24, 24, 48, 72, 72, 168]


class UploadError(Exception):
    """An attempt failed for a reason staff should know about."""


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
    client = JustGoClient.from_env()
    client.require_enabled(True)
    uploader = APIUploader(client, integration_config())
    uploader.validate_configuration()
    return uploader


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
    if hasattr(uploader, "validate_configuration"):
        uploader.validate_configuration()
    now = now or utcnow()
    summary = {"submitted": 0, "review": 0, "failed": 0, "waiting": 0, "skipped": 0}
    for document in database.collection("memberships").where(filter=firestore.FieldFilter("justgoSyncStatus", "==", "pending")).stream():
        member = {"id": document.id, **document.to_dict()}
        state = dict(member.get("justgoUpload") or {"status": "queued", "attempts": 0, "failures": 0})
        status = state.get("status", "queued")
        if status in ("manual", "revoked", "review", "processing"):
            summary["skipped"] += 1
            continue
        if status == "submitted":
            if state.get("lastAttemptAt") and now - state["lastAttemptAt"] > datetime.timedelta(days=8):
                document.reference.update({"justgoUpload.needsStaff": True,
                                           "justgoUpload.lastError": "API submission has not been confirmed by the read sync in 8 days."},
                                          option=database.write_option(last_update_time=document.update_time))
            summary["waiting"] += 1
            continue
        due = state.get("nextAttemptAt")
        if int(state.get("attempts", 0)) >= MAX_ATTEMPTS or (due and due > now):
            if state != member.get("justgoUpload"):
                document.reference.set({"justgoUpload": state, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True)
            summary["skipped"] += 1
            continue
        @firestore.transactional
        def claim(transaction):
            current = document.reference.get(transaction=transaction)
            if current.update_time != document.update_time:
                return False
            transaction.update(document.reference, {"justgoUpload": {
                **state, "status": "processing", "attempts": int(state.get("attempts", 0)) + 1,
                "lastAttemptAt": now, "needsStaff": True,
                "lastError": "Upload is in progress. If interrupted, reconcile JustGo before retrying.", "nextAttemptAt": None,
            }, "updatedAt": firestore.SERVER_TIMESTAMP})
            return True

        if not claim(database.transaction()):
            summary["skipped"] += 1
            continue
        claimed = document.reference.get()
        if (claimed.to_dict().get("justgoUpload", {}).get("status") != "processing"
                or claimed.to_dict()["justgoUpload"].get("attempts") != int(state.get("attempts", 0)) + 1):
            summary["skipped"] += 1
            continue
        state["attempts"] = int(state.get("attempts", 0)) + 1
        member["justgoUpload"] = state
        result = {}
        try:
            result = await uploader.upload(upload_details(database, member)) or {}
        except JustGoReviewRequired as error:
            state = {**state, "status": "review", "needsStaff": True, "lastError": str(error)[:300],
                     "lastAttemptAt": now, "nextAttemptAt": None}
            summary["review"] += 1
        except (UploadError, JustGoError) as error:
            state = after_failure(state, str(error), now)
            summary["failed"] += 1
        except Exception:
            # Unknown exceptions can happen after a successful external write. Never replay it automatically.
            state = {**state, "status": "review", "needsStaff": True,
                     "lastError": "Unexpected upload error. Reconcile JustGo before retrying.",
                     "lastAttemptAt": now, "nextAttemptAt": None}
            summary["review"] += 1
            import traceback
            traceback.print_exc()
        else:
            state = {**state, "status": "submitted", "lastError": "", "needsStaff": False, "lastAttemptAt": now, "nextAttemptAt": None,
                     "createdAccount": bool(result.get("createdAccount")), "clubLinkReference": result.get("clubLinkReference", ""),
                     "membershipIds": list(result.get("membershipIds") or [])}
            summary["submitted"] += 1
        document.reference.update({
            "justgoUpload": state, "updatedAt": firestore.SERVER_TIMESTAMP,
            **({"justgoMemberId": result["justgoMemberId"]} if result.get("justgoMemberId") else {}),
        }, option=database.write_option(last_update_time=claimed.update_time))
    return summary


if __name__ == "__main__":
    if not JustGoClient.from_env().writes_enabled or not JustGoClient.from_env().enabled:
        print("JustGo API writes are disabled; upload pass skipped, no request was sent. Members stay queued.")
        raise SystemExit(0)
    uploader = load_uploader()  # Guard before opening Firestore or changing attempts.
    print(f"[{utcnow().isoformat()}] JustGo upload pass: {asyncio.run(process_queue(firestore_database(), uploader))}")
