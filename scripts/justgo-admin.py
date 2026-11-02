"""Explicit JustGo operator commands. Every request, including Auth, uses the same default-off guard.

Reads:  discover | find-member --email/--number | member --member-id | snapshot
Writes (also need JUSTGO_API_WRITES_ENABLED=true and --confirm-write):
  create-member --payload | update-member --member-id --payload | add-to-club --member-id [--role]
  update-club-role --member-id --role | remove-from-club --member-id --is-additional-club true|false
  add-membership --member-id --tier adult|junior --club-year YYYY | update-membership --membership-id --payload
There is deliberately no command that deletes or suspends a JustGo account. remove-from-club only unlinks FCC.
Printed results redact personal fields; record IDs and operational status remain available for reconciliation.
"""
import argparse
import json
import os
import sys

from justgo_api import JustGoClient, JustGoError, club_snapshot, club_year_period, guid, integration_config

READS = ("discover", "find-member", "member", "snapshot")
WRITES = ("create-member", "update-member", "add-to-club", "update-club-role", "remove-from-club", "add-membership", "update-membership")

SENSITIVE_KEYS = frozenset({
    "phone", "phonenumber", "contactnumber", "mobilenumber", "postcode",
    "email", "emailaddress", "parentemailaddress",
    "address", "address1", "address2", "town", "county", "country",
    "guardian", "firstname", "lastname", "parentfirstname", "parentlastname",
    "dob", "dateofbirth",
})


def redact_sensitive(value, redact=False):
    if redact:
        return "[REDACTED]"
    if isinstance(value, dict):
        return {
            key: redact_sensitive(item, redact or str(key).lower() in SENSITIVE_KEYS)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_sensitive(item, redact) for item in value]
    return value


def payload(path):
    if not path:
        raise JustGoError("Supply --payload with a JSON file of documented fields.")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def linked_member(client, member_id, organisation):
    existing = client.member(member_id)
    linked = any(str(entry.get("id", "")).lower() == organisation for entry in existing.get("organisations") or [])
    return existing, linked


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=READS + WRITES)
    parser.add_argument("--member-id")
    parser.add_argument("--membership-id")
    parser.add_argument("--email")
    parser.add_argument("--number")
    parser.add_argument("--payload", help="Path to a JSON file with the documented fields.")
    parser.add_argument("--role")
    parser.add_argument("--tier", choices=["adult", "junior", "family"])
    parser.add_argument("--club-year", type=int, help="Club year starting 1 March of this year.")
    parser.add_argument("--is-additional-club", choices=["true", "false"])
    parser.add_argument("--confirm-write", action="store_true")
    args = parser.parse_args()

    client = JustGoClient.from_env()
    write = args.action in WRITES
    client.require_enabled(write)
    if write and not args.confirm_write:
        raise JustGoError("Explicit operator changes require --confirm-write as well as both environment guards.")
    organisation = guid(os.environ.get("JUSTGO_ORGANISATION_ID"))

    if args.action == "discover":
        result = {"organisation": client.organisation(organisation), "roles": client.roles(),
                  "membershipDefinitions": client.membership_definitions(organisation),
                  "credentialDefinitions": client.credential_definitions(),
                  "memberSchema": client.member_schema(), "credentialSchema": client.credential_schema()}
    elif args.action == "find-member":
        if not (args.email or args.number):
            raise JustGoError("Supply --email or --number.")
        result = client.members(email=args.email, member_number=args.number)
    elif args.action == "snapshot":
        result = club_snapshot(client, integration_config())
        result["listedIds"] = sorted(result["listedIds"])
    elif args.action == "member":
        result = client.member(guid(args.member_id))
    elif args.action == "create-member":
        body = payload(args.payload)
        if client.members(email=body.get("emailAddress") or body.get("parentEmailAddress"), last_name=body.get("lastName")):
            raise JustGoError("JustGo already has a matching email/surname; link the existing account instead of creating one.")
        result = client.create_member({**body, "forcedCreate": False})
    elif args.action == "update-membership":
        membership_id = guid(args.membership_id)
        if str(client.membership(membership_id).get("ownerId", "")).lower() != organisation:
            raise JustGoError("This membership is not owned by the configured FCC organisation.")
        result = client.update_membership(membership_id, payload(args.payload))
    else:
        member_id = guid(args.member_id)
        existing, linked = linked_member(client, member_id, organisation)
        if not linked and args.action != "add-to-club":
            raise JustGoError("This member is not linked to the configured FCC organisation.")
        if args.action == "update-member":
            result = client.update_member(member_id, payload(args.payload))
        elif args.action == "add-to-club":
            if linked:
                raise JustGoError("This member is already linked to FCC.")
            result = client.add_to_club(member_id, organisation, args.role or os.environ.get("JUSTGO_CLUB_MEMBER_ROLE", ""))
        elif args.action == "update-club-role":
            result = client.update_club_role(member_id, organisation, args.role)
        elif args.action == "add-membership":
            config = integration_config()
            if not args.tier or args.tier not in config["definitions"] or not args.club_year:
                raise JustGoError("Supply a configured --tier and --club-year.")
            start, end = club_year_period(args.club_year)
            result = client.create_membership(member_id, config["definitions"][args.tier], start.isoformat(), end.isoformat())
        else:
            if args.is_additional_club is None:
                raise JustGoError("Supply --is-additional-club true or false after checking the JustGo record.")
            result = client.remove_from_club(member_id, organisation, is_additional_club=args.is_additional_club == "true")
    print(json.dumps(redact_sensitive(result), indent=2, default=str))


if __name__ == "__main__":
    try:
        main()
    except (JustGoError, OSError, ValueError) as error:
        # Messages never contain the secret, token or request bodies.
        print(f"JustGo command failed: {error}", file=sys.stderr)
        sys.exit(1)
