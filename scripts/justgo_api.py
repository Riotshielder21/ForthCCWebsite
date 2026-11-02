"""Server-only client for the JustGo v2.2 API (contract: docs/justgo/justgo-api-v2.2.json).

No request is sent, not even Auth, unless JUSTGO_API_ENABLED=true and JUSTGO_API_SECRET is set. Writes (POST, PUT and
DELETE) also need JUSTGO_API_WRITES_ENABLED=true, checked before Auth. Nothing here deletes or suspends a JustGo account:
removing someone only unlinks them from FCC.
"""
import datetime as dt
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE_URL = "https://api.justgo.com/api/v2.2/"
PAGE_SIZE = 100
MAX_PAGES = 10000
TIERS = ("adult", "junior", "family")
CHECKS = ("pvg", "safeguarding")
# An empty suspension level always means "not suspended"; JUSTGO_UNSUSPENDED_LEVELS adds the tenant's own wording.
DEFAULT_UNSUSPENDED_LEVELS = ("none",)
MEMBER_CREATE_FIELDS = {
    "firstName", "lastName", "emailAddress", "dob", "gender", "address1", "address2", "town", "county", "postCode",
    "country", "contactNumber", "parentFirstName", "parentLastName", "parentEmailAddress", "forcedCreate", "memberNumber",
    "additionalDatas",
}
# The v2.2 update contract has no email or parent fields.
MEMBER_UPDATE_FIELDS = {
    "firstName", "lastName", "dob", "gender", "address1", "address2", "town", "county", "postCode", "country",
    "contactNumber", "additionalDatas",
}


class JustGoError(Exception):
    pass


class JustGoReviewRequired(JustGoError):
    """A staff decision is required; do not retry an uncertain external write."""


class JustGoRecordError(JustGoError):
    """One JustGo record cannot be used; the rest of the club can still be synced."""


def guid(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as error:
        raise JustGoError("A valid JustGo UUID is required.") from error


def date_value(value):
    """A date from JustGo's `YYYY-MM-DD` or ISO date-time values."""
    try:
        if not isinstance(value, str) or len(value) < 10 or (len(value) > 10 and value[10] not in "T "):
            raise ValueError()
        return dt.date.fromisoformat(value[:10])
    except ValueError as error:
        raise JustGoError("JustGo dates must be valid YYYY-MM-DD values.") from error


def optional_date(value):
    return date_value(value) if value else None


def text(value):
    return str(value or "").strip()


def is_suspended(level, config):
    level = text(level).lower()
    return bool(level) and level not in config["unsuspended_levels"]


def club_year_period(year):
    """FCC's club year as an inclusive JustGo date range: 1 March to the last day of February."""
    return dt.date(year, 3, 1), dt.date(year + 1, 3, 1) - dt.timedelta(days=1)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise JustGoError("JustGo redirected a request; refusing to forward credentials.")


def http_transport(method, url, headers, body, timeout):
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
        return response.status, response.read()


def error_message(raw):
    """JustGo's short error message, without its field-level details (they can echo personal data)."""
    try:
        message = json.loads(raw).get("message") if raw else ""
    except (ValueError, TypeError, AttributeError, UnicodeDecodeError):
        return ""
    return f" JustGo said: {text(message)[:160]}" if isinstance(message, str) and text(message) else ""


class JustGoClient:
    def __init__(self, *, enabled=False, writes_enabled=False, secret="", transport=http_transport, clock=time.time):
        self.enabled = enabled
        self.writes_enabled = writes_enabled
        self.secret = (secret or "").strip()
        self.transport = transport
        self.clock = clock
        self.token = None
        self.token_until = 0

    @classmethod
    def from_env(cls, environ=None):
        environ = os.environ if environ is None else environ
        return cls(enabled=environ.get("JUSTGO_API_ENABLED") == "true",
                   writes_enabled=environ.get("JUSTGO_API_WRITES_ENABLED") == "true",
                   secret=environ.get("JUSTGO_API_SECRET", ""))

    def require_enabled(self, write=False):
        if not self.enabled:
            raise JustGoError("JustGo API is disabled (JUSTGO_API_ENABLED is not true); no request was sent.")
        if not self.secret:
            raise JustGoError("JUSTGO_API_SECRET is missing; no request was sent.")
        if write and not self.writes_enabled:
            raise JustGoError("JustGo API writes are disabled (JUSTGO_API_WRITES_ENABLED is not true); no request, including Auth, was sent.")

    def _send(self, method, path, *, body=None, query=None, token=None, write=False):
        self.require_enabled(write)
        url = BASE_URL + path
        if query:
            url += "?" + urllib.parse.urlencode({key: value for key, value in query.items() if value is not None})
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        uncertain = JustGoReviewRequired if write else JustGoError
        try:
            status, raw = self.transport(method, url, headers, payload, 30)
        except urllib.error.HTTPError as error:
            status = error.code
            try:
                message = error_message(error.read())
            finally:
                error.close()
            if write and (status >= 500 or status in (408, 409)):
                raise JustGoReviewRequired(f"JustGo write returned HTTP {status}; reconcile before retrying.{message}") from None
            raise JustGoError(f"JustGo returned HTTP {status} for {method} {path.split('/')[0]}.{message}") from None
        except (OSError, JustGoError):
            raise uncertain("JustGo request did not complete; " + ("reconcile the write before retrying." if write else "try again later.")) from None
        if not 200 <= status < 300:
            kind = JustGoReviewRequired if write and (status >= 500 or status in (408, 409)) else JustGoError
            raise kind(f"JustGo returned HTTP {status}.{error_message(raw)}")
        try:
            result = json.loads(raw) if raw else {}
            if not isinstance(result, dict):
                raise ValueError()
            code = result.get("statusCode", status)
            if not isinstance(code, int) or not 200 <= code < 300:
                raise ValueError()
        except (ValueError, TypeError, UnicodeDecodeError):
            raise uncertain("JustGo returned an invalid response; check the external result before retrying.") from None
        return result

    def authenticate(self):
        self.require_enabled()
        # The v2.2 contract leaves this response untyped; its login-success schema is accessToken/tokenType/expiresIn.
        result = self._send("POST", "Auth", body={"secret": self.secret}).get("data")
        if not isinstance(result, dict) or not result.get("accessToken") or str(result.get("tokenType", "")).lower() != "bearer":
            raise JustGoError("JustGo Auth did not return the documented bearer token.")
        expiry = result.get("expiresIn")
        if type(expiry) is not int or expiry <= 0:
            raise JustGoError("JustGo Auth returned an invalid token lifetime.")
        self.token = result["accessToken"]
        self.token_until = self.clock() + max(0, expiry - 30)

    def _request(self, method, path, *, body=None, query=None):
        write = method != "GET"
        self.require_enabled(write)
        if not self.token or self.clock() >= self.token_until:
            self.authenticate()
        return self._send(method, path, body=body, query=query, token=self.token, write=write)

    def _data(self, path, query=None):
        result = self._request("GET", path, query=query)
        if result.get("data") is None:
            raise JustGoError("JustGo response is missing its data.")
        return result["data"]

    def _pages(self, path, **query):
        seen = set()
        expected_total = None
        for page in range(1, MAX_PAGES + 1):
            result = self._request("GET", path, query={**query, "PageNumber": page, "PageSize": PAGE_SIZE})
            data, pages, total = result.get("data"), result.get("totalPages"), result.get("totalRecords")
            if (not isinstance(data, list) or type(pages) is not int or type(total) is not int
                    or pages < 0 or total < 0 or result.get("pageNumber") != page
                    or (expected_total is not None and total != expected_total)):
                raise JustGoError("JustGo pagination is incomplete or changed during the run; restart the run.")
            expected_total = total
            for item in data:
                if not isinstance(item, dict) or not item.get("id") or item["id"] in seen:
                    raise JustGoError("JustGo returned a missing or duplicate record ID.")
                seen.add(item["id"])
                yield item
            if page >= pages:
                if len(seen) != total:
                    raise JustGoError("JustGo record count does not match the completed pages.")
                return
            if not data:
                raise JustGoError("JustGo returned an empty intermediate page.")
        raise JustGoError("JustGo pagination exceeded the safety limit.")

    # --- Reads -------------------------------------------------------------------------------------------------------

    def organisations(self, organisation_number=None):
        return list(self._pages("Organisations/FindByAttributes", OrganisationNumber=organisation_number))

    def organisation(self, organisation_id):
        return self._data("Organisations/" + guid(organisation_id))

    def roles(self):
        return self._data("Organisations/Roles")

    def member_schema(self):
        return self._data("Members/Schema")

    def credential_schema(self):
        return self._data("Credentials/Schema")

    def membership_definitions(self, organisation_id):
        return list(self._pages("Memberships/FindByAttributes", OwnerId=guid(organisation_id)))

    def membership_definition(self, definition_id):
        return self._data("Memberships/" + guid(definition_id))

    def credential_definitions(self, category=None):
        return list(self._pages("Credentials/FindByAttributes", Category=category))

    def credential_definition(self, definition_id):
        return self._data("Credentials/" + guid(definition_id))

    def members(self, organisation_id=None, *, email=None, member_number=None, last_name=None, suspend_status=None, modified_after=None):
        if not any((organisation_id, email, member_number, last_name)):
            raise JustGoError("Member searches require a club, email, membership number or surname.")
        return list(self._pages("Members/FindByAttributes", OrganisationId=guid(organisation_id) if organisation_id else None,
                                Email=email, memberNumber=member_number, LastName=last_name, SuspendStatus=suspend_status,
                                ModifiedAfter=modified_after))

    def member(self, member_id):
        """Full record, including memberships, club links (`organisations`), credentials and suspension level."""
        member_id = guid(member_id)
        result = self._data("Members/" + member_id)
        if not isinstance(result, dict) or text(result.get("id")).lower() != member_id:
            raise JustGoError("JustGo returned a different member from the one requested.")
        return result

    def memberships(self, member_id, organisation_id):
        return list(self._pages("Memberships/Member/FindByAttributes", MemberId=guid(member_id), OwnerId=guid(organisation_id)))

    def membership(self, membership_id):
        return self._data("Memberships/Member/" + guid(membership_id))

    def credentials(self, member_id, definition_id=None):
        return list(self._pages("Credentials/Member/FindByAttributes", MemberId=guid(member_id),
                                DefinitionId=guid(definition_id) if definition_id else None))

    def credential(self, credential_id):
        return self._data("Credentials/Member/" + guid(credential_id))

    # --- Writes ------------------------------------------------------------------------------------------------------

    def _write(self, method, path, body, allowed):
        self.require_enabled(True)
        if not isinstance(body, dict) or not body or set(body) - allowed:
            raise JustGoError("The write contains missing or unsupported JustGo fields.")
        for field in ("dob", "startDate", "endDate"):
            if body.get(field) is not None:
                date_value(body[field])
        if body.get("startDate") and body.get("endDate") and date_value(body["endDate"]) < date_value(body["startDate"]):
            raise JustGoError("Membership end date must not be before its start date.")
        return self._request(method, path, body=body)

    @staticmethod
    def _created_id(result, what):
        data = result.get("data")
        try:
            if not isinstance(data, dict):
                raise JustGoError("missing")
            return {**data, "id": guid(data.get("id"))}
        except JustGoError:
            raise JustGoReviewRequired(f"JustGo did not confirm the {what}; reconcile before retrying.") from None

    def create_member(self, body):
        """Creates a JustGo account for someone who has never had one. JustGo itself emails the new account holder."""
        if body.get("forcedCreate") is not False:
            raise JustGoError("Forced member creation is prohibited; search for an existing person first.")
        return self._created_id(self._write("POST", "Members", body, MEMBER_CREATE_FIELDS), "created member")

    def update_member(self, member_id, body):
        return self._write("PUT", "Members/" + guid(member_id), body, MEMBER_UPDATE_FIELDS)

    @staticmethod
    def _reference(result):
        data = result.get("data")
        return {"reference": text(data.get("refrence") or data.get("reference")) if isinstance(data, dict) else ""}

    def add_to_club(self, member_id, organisation_id, role):
        """Links an existing JustGo member to a club; JustGo handles any request/notification email it sends."""
        if not text(role):
            raise JustGoError("A confirmed JustGo club role is required.")
        return self._reference(self._write("POST", "Organisations/AddMember",
                                           {"organisationId": guid(organisation_id), "memberId": guid(member_id), "role": role},
                                           {"organisationId", "memberId", "role"}))

    def update_club_role(self, member_id, organisation_id, role):
        if not text(role):
            raise JustGoError("A confirmed JustGo club role is required.")
        return self._reference(self._write("PUT", "Organisations/UpdateMember",
                                           {"organisationId": guid(organisation_id), "memberId": guid(member_id), "role": role},
                                           {"organisationId", "memberId", "role"}))

    def remove_from_club(self, member_id, organisation_id, *, is_additional_club):
        """Unlinks the member from the club only. Their JustGo account and other clubs are untouched."""
        if type(is_additional_club) is not bool:
            raise JustGoError("Confirm whether FCC is an additional club before unlinking the member.")
        return self._reference(self._write("DELETE", "Organisations/DeleteMember",
                                           {"organisationId": guid(organisation_id), "memberId": guid(member_id),
                                            "isAdditionalClub": is_additional_club},
                                           {"organisationId", "memberId", "isAdditionalClub"}))

    def create_membership(self, member_id, definition_id, start_date, end_date):
        return self._created_id(self._write("POST", "Memberships/Member/" + guid(member_id),
                                            {"id": guid(definition_id), "startDate": start_date, "endDate": end_date},
                                            {"id", "startDate", "endDate"}), "assigned membership")

    def update_membership(self, membership_id, body):
        return self._write("PUT", "Memberships/Member/" + guid(membership_id), body, {"startDate", "endDate", "status"})


def _env_set(environ, name, default=()):
    values = {value.strip().lower() for value in environ.get(name, "").split(",") if value.strip()}
    return values or set(default)


def integration_config(environ=None):
    """Tenant mappings confirmed through read-only discovery (scripts/justgo-admin.py discover)."""
    environ = os.environ if environ is None else environ
    try:
        definitions = json.loads(environ.get("JUSTGO_MEMBERSHIP_DEFINITIONS") or "{}")
        credentials = json.loads(environ.get("JUSTGO_CREDENTIAL_DEFINITIONS") or "{}")
    except ValueError as error:
        raise JustGoError("JustGo definition settings must contain JSON objects.") from error
    if not isinstance(definitions, dict) or not definitions or set(definitions) - set(TIERS):
        raise JustGoError("Configure confirmed adult/junior/family JUSTGO_MEMBERSHIP_DEFINITIONS before syncing or uploading.")
    if not isinstance(credentials, dict) or set(credentials) - set(CHECKS):
        raise JustGoError("JUSTGO_CREDENTIAL_DEFINITIONS accepts only pvg and safeguarding definition IDs.")
    definitions = {key: guid(value) for key, value in definitions.items()}
    if len(set(definitions.values())) != len(definitions):
        raise JustGoError("Membership tiers must have distinct confirmed definition IDs.")
    statuses = _env_set(environ, "JUSTGO_ACTIVE_MEMBERSHIP_STATUSES")
    if not statuses:
        raise JustGoError("Configure confirmed JUSTGO_ACTIVE_MEMBERSHIP_STATUSES before syncing or uploading.")
    member_statuses = _env_set(environ, "JUSTGO_ACTIVE_MEMBER_STATUSES")
    if not member_statuses:
        raise JustGoError("Configure confirmed JUSTGO_ACTIVE_MEMBER_STATUSES before syncing or uploading.")
    return {"organisation": guid(environ.get("JUSTGO_ORGANISATION_ID")), "definitions": definitions,
            "credentials": {key: guid(value) for key, value in credentials.items()},
            "active_statuses": statuses, "active_member_statuses": member_statuses,
            "unsuspended_levels": _env_set(environ, "JUSTGO_UNSUSPENDED_LEVELS", DEFAULT_UNSUSPENDED_LEVELS),
            "club_role": text(environ.get("JUSTGO_CLUB_MEMBER_ROLE"))}


def club_memberships(member, config):
    """The member's FCC memberships from a member-detail response. Paddle Scotland and other clubs' memberships are ignored."""
    tiers = {definition: tier for tier, definition in config["definitions"].items()}
    result = []
    for entry in member.get("memberships") or []:
        if not isinstance(entry, dict) or text(entry.get("definitionId")).lower() not in tiers:
            continue
        try:
            start, end = date_value(entry.get("startDate")), date_value(entry.get("endDate"))
        except JustGoError:
            raise JustGoRecordError("JustGo supplied invalid FCC membership dates.") from None
        if end < start or not text(entry.get("status")):
            raise JustGoRecordError("JustGo supplied invalid FCC membership dates or status.")
        result.append({"id": text(entry.get("id")), "definitionId": text(entry["definitionId"]).lower(),
                       "tier": tiers[text(entry["definitionId"]).lower()], "name": text(entry.get("name")),
                       "status": text(entry["status"]), "start": start, "end": end})
    return result


def credential_checks(member, config):
    """The latest PVG/safeguarding credential for each configured definition, with expiry, from a member-detail response."""
    checks = {}
    member_id = text(member.get("id")).lower()
    for check, definition in config["credentials"].items():
        entries = [entry for entry in member.get("credentials") or []
                   if isinstance(entry, dict) and text(entry.get("definitionId")).lower() == definition]
        if any(entry.get("memberId") and text(entry["memberId"]).lower() != member_id for entry in entries):
            raise JustGoRecordError("JustGo credential response belongs to another member.")
        try:
            dated = [(optional_date(entry.get("endDate")), optional_date(entry.get("startDate")), entry) for entry in entries]
        except JustGoError:
            raise JustGoRecordError("JustGo supplied invalid credential dates.") from None
        if not dated:
            checks[check] = {"status": "Not supplied by JustGo", "expiresOn": "", "grantedOn": "", "name": ""}
            continue
        # A credential without an end date never expires, so it outranks any dated one.
        end, start, entry = max(dated, key=lambda item: (item[0] is None, item[0] or dt.date.min, item[1] or dt.date.min))
        checks[check] = {"status": text(entry.get("status")) or "Not supplied by JustGo", "expiresOn": end.isoformat() if end else "",
                         "grantedOn": start.isoformat() if start else "", "name": text(entry.get("name"))[:120]}
    return checks


def member_snapshot(member, config, today):
    """One FCC member's state from the documented member-detail response."""
    member_id = guid(member.get("id"))
    link = next((entry for entry in member.get("organisations") or []
                 if isinstance(entry, dict) and text(entry.get("id")).lower() == config["organisation"]), None)
    if not link:
        raise JustGoRecordError("JustGo's member record does not show an FCC club link.")
    number = text(member.get("memberNumber"))
    if not number.isdigit() or not 4 <= len(number) <= 8:
        raise JustGoRecordError("JustGo has no valid Paddle Scotland number for this member yet.")
    first, last = text(member.get("firstName")), text(member.get("lastName"))
    if not first or not last:
        raise JustGoRecordError("JustGo is missing this member's name.")
    try:
        dob = date_value(member.get("dob"))
    except JustGoError:
        raise JustGoRecordError("JustGo is missing this member's date of birth.") from None
    account = text(member.get("memberStatus"))
    if not account:
        raise JustGoRecordError("JustGo did not supply the member's account status.")

    memberships = club_memberships(member, config)
    current = [entry for entry in memberships if entry["status"].lower() in config["active_statuses"] and entry["start"] <= today <= entry["end"]]
    # A not-yet-active FCC membership that has not ended is usually a join request awaiting approval or payment.
    waiting = [entry for entry in memberships if entry["status"].lower() not in config["active_statuses"] and entry["end"] >= today]
    selected = max(current or waiting or memberships, key=lambda entry: entry["end"], default=None)
    if current:
        status = "active"
    elif waiting:
        status = f"JustGo {selected['status']}"
    elif memberships:
        status = "expired"
    else:
        status = "No FCC membership"
    if account.lower() not in config["active_member_statuses"]:
        status = f"JustGo account {account}"
    suspension = text(member.get("suspensionLevel"))
    suspended = is_suspended(suspension, config)
    if suspended:
        status = "Suspended"
    verified = member.get("emailVerified")
    return {
        "memberId": member_id, "number": number, "firstName": first, "lastName": last, "dob": dob.isoformat(),
        "email": text(member.get("emailAddress")).lower(), "phone": text(member.get("phoneNumber")),
        "address": ", ".join(text(member.get(key)) for key in ("address1", "address2", "town", "county") if text(member.get(key))),
        "postcode": text(member.get("postCode")),
        # The member DTO has no guardian phone, address or relationship. Never substitute the child's own details.
        "guardian": {"firstName": text(member.get("parentFirstName")), "lastName": text(member.get("parentLastName")),
                     "email": text(member.get("parentEmailAddress")).lower()},
        "status": status, "suspended": suspended, "suspension": suspension if suspended else "",
        # JustGo's end date is the last covered day; the website stores the moment cover ends.
        "validUntil": selected["end"] + dt.timedelta(days=1) if selected else None,
        "tier": selected["tier"] if selected else "", "membershipStatus": selected["status"] if selected else "",
        "membershipName": selected["name"] if selected else "", "accountStatus": account,
        "emailVerified": verified if type(verified) is bool else None, "clubRoles": text(link.get("roles"))[:200],
        "checks": credential_checks(member, config),
    }


def club_snapshot(client, config, today=None):
    """Every person JustGo lists at FCC. Unusable records are reported, not guessed; transport problems stop the run."""
    today = today or dt.datetime.now(dt.timezone.utc).date()
    people, problems, listed_ids, numbers = [], [], set(), set()
    for listed in client.members(config["organisation"]):
        member_id = guid(listed.get("id"))
        listed_ids.add(member_id)
        try:
            person = member_snapshot(client.member(member_id), config, today)
        except JustGoRecordError as error:
            problems.append({"justgoMemberId": member_id, "memberNumber": text(listed.get("memberNumber"))[:20], "problem": str(error)})
            continue
        if person["number"] in numbers:
            raise JustGoError("JustGo lists two FCC members with the same Paddle Scotland number; reconcile before syncing.")
        numbers.add(person["number"])
        people.append(person)
    return {"people": people, "problems": problems, "listedIds": listed_ids}


class APIUploader:
    """Adds a paid website membership to JustGo: find or create the account, link it to FCC, then assign the FCC membership."""

    def __init__(self, client, config, today=None):
        self.client, self.config = client, config
        self.today = today

    def validate_configuration(self):
        self.client.require_enabled(True)
        if not self.config.get("club_role"):
            raise JustGoError("Configure the confirmed JUSTGO_CLUB_MEMBER_ROLE before uploading.")

    def _matches(self, first, last, dob, email, number):
        if number:
            candidates = self.client.members(member_number=number)
        else:
            found = {entry["id"]: entry for entry in self.client.members(email=email)}
            found.update({entry["id"]: entry for entry in self.client.members(last_name=last)})
            candidates = list(found.values())
        return [entry for entry in candidates
                if text(entry.get("firstName")).casefold() == first.casefold()
                and text(entry.get("lastName")).casefold() == last.casefold()
                and optional_date(entry.get("dob")) == dob
                and (not number or text(entry.get("memberNumber")) == number)]

    def _new_member(self, member, first, last, dob, email, today):
        payload = {"firstName": first, "lastName": last, "dob": dob.isoformat(), "contactNumber": text(member.get("phone")),
                   "address1": text(member.get("address")), "postCode": text(member.get("postcode")), "forcedCreate": False}
        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        if age >= 18:
            return {**payload, "emailAddress": email}
        guardian = text(member.get("contactName")).split()
        if len(guardian) != 2:
            raise JustGoReviewRequired("A junior's parent/guardian name must be exactly a first and last name to create the JustGo account; add them by hand.")
        return {**payload, "parentFirstName": guardian[0], "parentLastName": guardian[1], "parentEmailAddress": email}

    async def upload(self, member):
        self.validate_configuration()
        today = self.today or dt.datetime.now(dt.timezone.utc).date()
        first, last = text(member.get("firstName")), text(member.get("lastName"))
        email = text(member.get("email")).lower()
        try:
            dob = date_value(member.get("dob"))
        except JustGoError:
            raise JustGoReviewRequired("Member date of birth is missing or invalid.") from None
        if not first or not last or not email:
            raise JustGoReviewRequired("Member name, birth date and household email must be complete before upload.")
        tier = member.get("membershipTier")
        definition = self.config["definitions"].get(tier)
        if not definition:
            raise JustGoReviewRequired("This membership tier has no confirmed JustGo definition.")
        if tier == "family":
            raise JustGoReviewRequired("Family membership assignment needs tenant confirmation; add the family by hand.")
        until = member.get("validUntil")
        if not isinstance(until, dt.datetime):
            raise JustGoReviewRequired("Website membership expiry is missing.")
        this_year = today.year if today.month >= 3 else today.year - 1
        years = sorted({year for year in member.get("clubYears", []) if type(year) is int and year >= this_year})
        if not years or any(dt.date(year + 1, 3, 1) > until.date() for year in years):
            raise JustGoReviewRequired("Website club-year coverage needs staff reconciliation.")

        number = text(member.get("affiliationNumber"))
        matches = self._matches(first, last, dob, email, number)
        if len(matches) > 1 or (number and not matches):
            raise JustGoReviewRequired("JustGo identity lookup is ambiguous or conflicts with the website; do not create a duplicate.")
        remote = self.client.member(matches[0]["id"]) if matches else None
        if remote and (text(remote.get("memberStatus")).lower() not in self.config["active_member_statuses"]
                       or is_suspended(remote.get("suspensionLevel"), self.config)):
            raise JustGoReviewRequired("The matching JustGo account is inactive or suspended; review it before writing.")
        existing = club_memberships(remote, self.config) if remote else []
        missing = []
        for start, end in (club_year_period(year) for year in years):
            overlap = [entry for entry in existing if entry["definitionId"] == definition and entry["start"] <= end and entry["end"] >= start]
            if any(entry["start"] <= start and entry["end"] >= end and entry["status"].lower() in self.config["active_statuses"] for entry in overlap):
                continue
            if overlap:
                raise JustGoReviewRequired("An overlapping JustGo membership (possibly a pending request) needs review before changing coverage.")
            missing.append((start, end))

        result = {"status": "submitted", "createdAccount": False, "clubLinkReference": "", "membershipIds": []}
        if not remote:
            remote = self.client.create_member(self._new_member(member, first, last, dob, email, today))
            result["createdAccount"] = True
        remote_id = guid(remote["id"])
        result["justgoMemberId"] = remote_id
        try:
            if not any(text(entry.get("id")).lower() == self.config["organisation"] for entry in remote.get("organisations") or []):
                result["clubLinkReference"] = self.client.add_to_club(remote_id, self.config["organisation"], self.config["club_role"])["reference"]
            for start, end in missing:
                result["membershipIds"].append(self.client.create_membership(remote_id, definition, start.isoformat(), end.isoformat())["id"])
        except JustGoError as error:
            if not result["createdAccount"] and not result["clubLinkReference"] and not result["membershipIds"]:
                raise
            # Something was already written; a blind retry could double-link or double-assign.
            raise JustGoReviewRequired(f"JustGo upload stopped part-way for member {remote_id}: {error}") from None
        return result


def firestore_database():
    import firebase_admin
    from firebase_admin import credentials, firestore
    if not firebase_admin._apps:
        path = os.environ.get("FIREBASE_SERVICE_ACCOUNT_PATH")
        firebase_admin.initialize_app(credentials.Certificate(path) if path else None)
    return firestore.client()
