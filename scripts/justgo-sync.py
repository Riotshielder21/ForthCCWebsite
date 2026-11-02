"""Reads FCC's members from the JustGo API into Firestore (run on a schedule; see config/fcc-sync.timer).

JustGo is the source of truth for Paddle Scotland numbers, FCC membership status (including people who join FCC directly
on JustGo), suspensions and PVG/safeguarding credentials. Website-only data (subscriptions, privileges, history,
safety details) is never overwritten. Nothing is written to JustGo.
"""
import asyncio
import datetime as dt

from firebase_admin import firestore
from justgo_api import JustGoClient, JustGoError, club_snapshot, firestore_database, integration_config

db = None


async def run_sync():
    global db
    client = JustGoClient.from_env()
    client.require_enabled()
    snapshot = club_snapshot(client, integration_config())
    if not snapshot["listedIds"]:
        raise JustGoError("JustGo returned an empty club; review the scope before confirming a sync.")
    db = firestore_database()
    await sync_snapshot_to_firestore(snapshot)


def match_key(email, dob, first, last):
    return f"{email.lower()}|{dob}|{first.lower()} {last.lower()}".strip()


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


def check_label(check):
    label = check["status"]
    if check.get("expiresOn"):
        label += f", expires {dt.date.fromisoformat(check['expiresOn']).strftime('%d/%m/%Y')}"
    return label[:120]


def as_utc(value):
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)
    return dt.datetime.combine(value, dt.time(), dt.timezone.utc)


def contact_email(person):
    return person["guardian"]["email"] or person["email"]


async def sync_snapshot_to_firestore(snapshot, now=None):
    print("Starting Firestore sync...")
    now = as_utc(now) or dt.datetime.now(dt.timezone.utc)
    memberships = db.collection("memberships")
    households = db.collection("households")
    household_by_id = {document.id: document.to_dict() for document in households.stream()}
    household_by_email = {data.get("email", "").lower(): household_id for household_id, data in household_by_id.items() if data.get("email")}

    # Match each person to an existing record (a member who joined on the website, or an earlier sync)
    # so one person never has two records.
    by_id, by_number, by_person, documents = {}, {}, {}, []
    for doc in memberships.stream():
        data = doc.to_dict()
        documents.append(doc)
        if data.get("justgoMemberId"):
            by_id[str(data["justgoMemberId"]).lower()] = doc
        if data.get("affiliationNumber"):
            number = str(data["affiliationNumber"])
            if number in by_number:
                raise JustGoError("Duplicate local affiliation numbers require staff reconciliation.")
            by_number[number] = doc
        household = household_by_id.get(data.get("householdId"), {})
        key = match_key(data.get("email") or household.get("email", ""), data.get("dob", ""), data.get("firstName", ""), data.get("lastName", ""))
        by_person.setdefault(key, []).append(doc)

    people = snapshot["people"]
    keys = [match_key(contact_email(person), person["dob"], person["firstName"], person["lastName"]) for person in people]
    if len(set(keys)) != len(keys):
        raise JustGoError("Duplicate people in JustGo require staff reconciliation.")

    writes = created = linked = skipped = 0
    touched = set()
    for person, key in zip(people, keys):
        number = person["number"]
        candidates = by_person.get(key, [])
        if len(candidates) > 1:
            raise JustGoError("A JustGo member matches multiple local people; staff reconciliation is required.")
        existing = by_id.get(person["memberId"]) or by_number.get(number) or (candidates[0] if candidates else None)
        current = existing.to_dict() if existing else {}
        if current.get("justgoMemberId") and str(current["justgoMemberId"]).lower() != person["memberId"]:
            raise JustGoError("A local record is linked to a different JustGo member; staff reconciliation is required.")
        valid_until = as_utc(person["validUntil"])
        held_until = as_utc(current.get("validUntil"))
        website_ahead = current.get("justgoSyncStatus") == "pending" and held_until and (not valid_until or held_until > valid_until)
        staff_review = (current.get("justgoUpload") or {}).get("status") in ("revoked", "review", "processing")
        fields = {
            "affiliationNumber": number, "membershipNumber": membership_number_for(number), "justgoMemberId": person["memberId"],
            "lastJustgoSync": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP,
            "justgoProfile": {
                "clubLinked": True, "clubRoles": person["clubRoles"], "accountStatus": person["accountStatus"],
                "emailVerified": person["emailVerified"], "suspended": person["suspended"], "suspension": person["suspension"],
                "membershipStatus": person["membershipStatus"], "membershipName": person["membershipName"], "tier": person["tier"],
                "syncedAt": firestore.SERVER_TIMESTAMP,
            },
        }
        checks = dict(current.get("checks") or {})
        for name, check in person["checks"].items():
            checks[name] = {"source": "justgo", **check, "label": check_label(check), "updatedAt": firestore.SERVER_TIMESTAMP}
        if checks:
            fields["checks"] = checks
        if not website_ahead and not staff_review:
            fields.update({
                "validUntil": valid_until, "status": person["status"], "justgoSyncStatus": "synced", "renewalMethod": "justgo",
                "justgoUpload": {**(current.get("justgoUpload") or {}), "status": "done", "needsStaff": False, "nextAttemptAt": None},
            })
        if person["suspended"]:
            # A Paddle Scotland suspension always blocks club activity, even while a website renewal waits for upload.
            fields["status"] = "Suspended"
        for field in ("firstName", "lastName", "dob"):
            if not current.get(field):
                fields[field] = person[field]
        if not existing:
            today = now.date()
            dob = dt.date.fromisoformat(person["dob"])
            is_junior = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day)) < 18
            guardian = person["guardian"]
            if is_junior:
                if not (guardian["firstName"] and guardian["lastName"] and guardian["email"]):
                    print(f"Skipping {number}: JustGo has no parent/guardian name and email. Staff follow-up required.")
                    skipped += 1
                    continue
                # JustGo's member record has no guardian phone or address; staff complete them on the website.
                contact = {"contactName": f"{guardian['firstName']} {guardian['lastName']}", "contactRelationship": "Parent/guardian",
                           "email": guardian["email"], "phone": "", "address": "", "postcode": ""}
            else:
                if not person["email"]:
                    print(f"Skipping {number}: JustGo has no email for this adult. Staff follow-up required.")
                    skipped += 1
                    continue
                contact = {"contactName": f"{person['firstName']} {person['lastName']}", "contactRelationship": "Member",
                           "email": person["email"], "phone": person["phone"], "address": person["address"], "postcode": person["postcode"]}
            household_id = household_by_email.get(contact["email"]) if is_junior else None
            household_id = household_id or allocate_record_id("households", "H", 5)
            fields["householdId"] = household_id
            batch = db.batch()
            if household_id not in household_by_id:
                batch.create(households.document(household_id), {**contact, "updatedAt": firestore.SERVER_TIMESTAMP, "createdAt": firestore.SERVER_TIMESTAMP})
                household_by_id[household_id] = contact
                household_by_email[contact["email"]] = household_id
            fields.update({"source": "justgo", "schemaVersion": 3, "createdAt": firestore.SERVER_TIMESTAMP})
        else:
            batch = db.batch()
        fields["searchName"] = " ".join(f"{fields.get('firstName') or current.get('firstName', '')} {fields.get('lastName') or current.get('lastName', '')}".lower().split())
        if existing:
            # A checkout/refund racing the sync must fail the run, not lose its coverage or staff-review state.
            batch.update(existing.reference, fields, option=db.write_option(last_update_time=existing.update_time))
            touched.add(existing.id)
        else:
            batch.create(memberships.document(allocate_record_id("memberships", "M", 4)), fields)
        batch.commit()
        writes += 1
        created += 0 if existing else 1
        linked += 1 if existing else 0

    # People JustGo no longer lists at FCC have been unlinked (by staff, or by leaving in JustGo). Their status is
    # left alone; staff decide whether coverage or refunds need attention. Records with unusable JustGo data are
    # still listed, so they are not mistaken for unlinks.
    listed = {str(member_id).lower() for member_id in snapshot["listedIds"]}
    unlinked = 0
    for doc in documents:
        data = doc.to_dict()
        member_id = str(data.get("justgoMemberId") or "").lower()
        if doc.id in touched or not member_id or member_id in listed or (data.get("justgoProfile") or {}).get("clubLinked") is False:
            continue
        doc.reference.update({
            "justgoProfile.clubLinked": False, "justgoProfile.unlinkedDetectedAt": firestore.SERVER_TIMESTAMP,
            "justgoProfile.reviewReason": "No longer linked to FCC in JustGo; check whether this was intended.",
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }, option=db.write_option(last_update_time=doc.update_time))
        unlinked += 1

    problems = [{"justgoMemberId": problem["justgoMemberId"], "problem": problem["problem"][:200]} for problem in snapshot["problems"][:50]]
    db.collection("settings").document("justgoSync").set({
        "lastSuccessAt": firestore.SERVER_TIMESTAMP, "membersUpdated": writes, "membersSkipped": skipped + len(snapshot["problems"]),
        "membersUnlinked": unlinked, "problems": problems, "problemCount": len(snapshot["problems"]),
    }, merge=True)
    print(f"Sync complete. {writes} members updated ({created} new, {linked} matched); {skipped} need staff follow-up; "
          f"{len(snapshot['problems'])} JustGo records unusable; {unlinked} newly unlinked from FCC.")


if __name__ == "__main__":
    if not JustGoClient.from_env().enabled:
        print("JustGo API is disabled (JUSTGO_API_ENABLED is not true); sync skipped, no request was sent.")
    else:
        asyncio.run(run_sync())
