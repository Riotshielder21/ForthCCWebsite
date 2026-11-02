"""Offline checks for the JustGo API client: guards, paging, parsing and the uploader. No network or Firestore.

Run:  bin/python scripts/test-justgo-api.py
"""
import asyncio
import datetime as dt
import json
import os
import sys
import urllib.error

sys.path.insert(0, os.path.dirname(__file__))
import justgo_api as jg  # noqa: E402

ORG = "11111111-1111-1111-1111-111111111111"
ADULT = "22222222-2222-2222-2222-222222222222"
JUNIOR = "33333333-3333-3333-3333-333333333333"
PVG = "44444444-4444-4444-4444-444444444444"
SAFE = "55555555-5555-5555-5555-555555555555"
OTHER = "66666666-6666-6666-6666-666666666666"
M1 = "aaaaaaaa-0000-0000-0000-000000000001"
M2 = "aaaaaaaa-0000-0000-0000-000000000002"
NEW = "aaaaaaaa-0000-0000-0000-000000000009"
TODAY = dt.date(2026, 6, 15)
ENV = {
    "JUSTGO_API_ENABLED": "true", "JUSTGO_API_WRITES_ENABLED": "true", "JUSTGO_API_SECRET": "s3cret",
    "JUSTGO_ORGANISATION_ID": ORG, "JUSTGO_MEMBERSHIP_DEFINITIONS": json.dumps({"adult": ADULT, "junior": JUNIOR}),
    "JUSTGO_CREDENTIAL_DEFINITIONS": json.dumps({"pvg": PVG, "safeguarding": SAFE}),
    "JUSTGO_ACTIVE_MEMBERSHIP_STATUSES": "Active", "JUSTGO_ACTIVE_MEMBER_STATUSES": "Active",
    "JUSTGO_CLUB_MEMBER_ROLE": "Member",
}
CONFIG = jg.integration_config(ENV)


def ok(data=None, **extra):
    return 200, json.dumps({"statusCode": 200, "message": "OK", "data": data, **extra}).encode()


def page(items, number=1, pages=1, total=None):
    return ok(items, pageNumber=number, pageSize=100, totalPages=pages, totalRecords=len(items) if total is None else total)


class Fake:
    """Routes (method, path) to canned responses and records every call."""

    def __init__(self, routes=None):
        self.routes, self.calls = dict(routes or {}), []
        self.routes.setdefault(("POST", "Auth"), lambda body, query: ok({"accessToken": "tok", "tokenType": "Bearer", "expiresIn": 3600}))

    def __call__(self, method, url, headers, body, timeout):
        assert url.startswith(jg.BASE_URL)
        path, _, query = url[len(jg.BASE_URL):].partition("?")
        parsed = json.loads(body) if body else None
        self.calls.append((method, path, query, parsed, headers.get("Authorization")))
        route = self.routes.get((method, path))
        if route is None:
            raise AssertionError(f"Unexpected request {method} {path}")
        return route(parsed, query)

    def paths(self):
        return [(method, path) for method, path, *_ in self.calls]


def client(fake, **overrides):
    env = {**ENV, **overrides}
    return jg.JustGoClient(enabled=env["JUSTGO_API_ENABLED"] == "true", writes_enabled=env["JUSTGO_API_WRITES_ENABLED"] == "true",
                           secret=env["JUSTGO_API_SECRET"], transport=fake)


def raises(kind, function, *args, **kwargs):
    try:
        function(*args, **kwargs)
    except kind as error:
        return error
    raise AssertionError(f"Expected {kind.__name__}")


def detail(member_id=M1, number="123456", **extra):
    return {"id": member_id, "memberNumber": number, "firstName": "Alex", "lastName": "Tester", "emailAddress": "Alex@Example.test",
            "dob": "1988-05-05", "phoneNumber": "0777", "address1": "1 Road", "town": "Edinburgh", "postCode": "EH1 1AA",
            "memberStatus": "Active", "suspensionLevel": "", "emailVerified": True,
            "organisations": [{"id": ORG, "organisationName": "Forth Canoe Club", "roles": "Member", "isPrimary": True}],
            "memberships": [
                {"id": "m-1", "definitionId": ADULT, "name": "FCC Adult", "status": "Active", "startDate": "2026-03-01T00:00:00", "endDate": "2027-02-28T00:00:00"},
                {"id": "m-ps", "definitionId": OTHER, "name": "Paddle Scotland", "status": "Expired", "startDate": "2020-01-01", "endDate": "2020-12-31"},
            ],
            "credentials": [
                {"id": "c1", "definitionId": PVG, "name": "PVG", "status": "Approved", "startDate": "2020-01-01", "endDate": "2026-08-01", "memberId": member_id},
                {"id": "c0", "definitionId": PVG, "name": "PVG", "status": "Expired", "startDate": "2015-01-01", "endDate": "2019-01-01", "memberId": member_id},
            ], **extra}


# --- Guards: nothing is sent, not even Auth, unless enabled with a secret; writes need their own flag before Auth.
for overrides in ({"JUSTGO_API_ENABLED": "false"}, {"JUSTGO_API_SECRET": ""}):
    fake = Fake()
    raises(jg.JustGoError, client(fake, **overrides).members, ORG)
    raises(jg.JustGoError, client(fake, **overrides).authenticate)
    assert fake.calls == [], "disabled or secretless clients never send a request"
fake = Fake()
raises(jg.JustGoError, client(fake, JUSTGO_API_WRITES_ENABLED="false").add_to_club, M1, ORG, "Member")
assert fake.calls == [], "a blocked write does not even authenticate"
assert jg.JustGoClient.from_env({}).enabled is False and jg.JustGoClient.from_env({}).writes_enabled is False, "default off"
raises(jg.JustGoError, jg.JustGoClient.from_env({}).require_enabled)

# --- Auth token reuse, bearer header and paging.
fake = Fake({("GET", "Members/FindByAttributes"): lambda body, query: page([{"id": M1}, {"id": M2}][int("PageNumber=2" in query)::2][:1],
                                                                           number=2 if "PageNumber=2" in query else 1, pages=2, total=2)})
api = client(fake)
assert [entry["id"] for entry in api.members(ORG)] == [M1, M2]
assert [entry["id"] for entry in api.members(ORG)] == [M1, M2]
assert fake.paths().count(("POST", "Auth")) == 1, "the token is reused"
assert all(call[4] == "Bearer tok" for call in fake.calls if call[1] != "Auth") and fake.calls[0][4] is None
assert fake.calls[0][3] == {"secret": "s3cret"}
fake = Fake({("GET", "Members/FindByAttributes"): lambda body, query: page([{"id": M1}, {"id": M1}])})
raises(jg.JustGoError, client(fake).members, ORG)
fake = Fake({("GET", "Members/FindByAttributes"): lambda body, query: page([{"id": M1}], total=5)})
raises(jg.JustGoError, client(fake).members, ORG)
raises(jg.JustGoError, client(Fake()).members)


# --- Write failures with uncertain outcomes need staff review; refusals are ordinary errors.
def http_error(code):
    def route(body, query):
        raise urllib.error.HTTPError("u", code, "x", {}, None)
    return route


fake = Fake({("POST", "Organisations/AddMember"): http_error(500)})
raises(jg.JustGoReviewRequired, client(fake).add_to_club, M1, ORG, "Member")
fake = Fake({("POST", "Organisations/AddMember"): http_error(400)})
error = raises(jg.JustGoError, client(fake).add_to_club, M1, ORG, "Member")
assert not isinstance(error, jg.JustGoReviewRequired)
fake = Fake({("POST", "Organisations/AddMember"): lambda body, query: ok({"refrence": "REF-1"})})
assert client(fake).add_to_club(M1, ORG, "Member") == {"reference": "REF-1"}
fake = Fake({("DELETE", "Organisations/DeleteMember"): lambda body, query: ok({"refrence": "REF-2"})})
assert client(fake).remove_from_club(M1, ORG, is_additional_club=False)["reference"] == "REF-2"
assert fake.calls[-1][3] == {"organisationId": ORG, "memberId": M1, "isAdditionalClub": False}
raises(jg.JustGoError, client(Fake()).create_member, {"firstName": "A", "forcedCreate": True})
raises(jg.JustGoError, client(Fake()).update_member, M1, {"emailAddress": "x@example.test"})
assert not any(name for name in dir(jg.JustGoClient) if "delete" in name.lower() or "suspend" in name.lower()), "no account deletion or suspension"

# --- Dates accept JustGo date-times.
assert jg.date_value("2027-02-28T00:00:00") == dt.date(2027, 2, 28) and jg.date_value("2027-02-28") == dt.date(2027, 2, 28)
raises(jg.JustGoError, jg.date_value, "28/02/2027")
assert jg.club_year_period(2026) == (dt.date(2026, 3, 1), dt.date(2027, 2, 28))
assert jg.club_year_period(2027)[1] == dt.date(2028, 2, 29)

# --- Snapshot parsing: FCC membership, credentials, suspension, join requests, unusable records.
person = jg.member_snapshot(detail(), CONFIG, TODAY)
assert (person["status"], person["tier"], person["validUntil"]) == ("active", "adult", dt.date(2027, 3, 1)), person
assert person["email"] == "alex@example.test" and person["emailVerified"] is True and person["clubRoles"] == "Member"
assert person["checks"]["pvg"] == {"status": "Approved", "expiresOn": "2026-08-01", "grantedOn": "2020-01-01", "name": "PVG"}
assert person["checks"]["safeguarding"]["status"] == "Not supplied by JustGo"
suspended = jg.member_snapshot(detail(suspensionLevel="Full"), CONFIG, TODAY)
assert suspended["status"] == "Suspended" and suspended["suspended"] and suspended["suspension"] == "Full"
assert not jg.member_snapshot(detail(suspensionLevel="None"), CONFIG, TODAY)["suspended"]
requested = jg.member_snapshot(detail(memberships=[{"id": "m-2", "definitionId": ADULT, "name": "FCC Adult", "status": "Pending",
                                                    "startDate": "2026-06-14", "endDate": "2027-02-28"}]), CONFIG, TODAY)
assert requested["status"] == "JustGo Pending" and requested["membershipStatus"] == "Pending", "a join request made on JustGo is visible"
assert jg.member_snapshot(detail(memberships=[]), CONFIG, TODAY)["status"] == "No FCC membership"
lapsed = jg.member_snapshot(detail(memberships=[{"id": "m-0", "definitionId": ADULT, "name": "FCC Adult", "status": "Active",
                                                 "startDate": "2025-03-01", "endDate": "2026-02-28"}]), CONFIG, TODAY)
assert lapsed["status"] == "expired" and lapsed["validUntil"] == dt.date(2026, 3, 1)
assert jg.member_snapshot(detail(memberStatus="Inactive"), CONFIG, TODAY)["status"] == "JustGo account Inactive"
assert jg.member_snapshot(detail(emailVerified=None), CONFIG, TODAY)["emailVerified"] is None
raises(jg.JustGoRecordError, jg.member_snapshot, detail(organisations=[]), CONFIG, TODAY)
raises(jg.JustGoRecordError, jg.member_snapshot, detail(number=""), CONFIG, TODAY)
raises(jg.JustGoRecordError, jg.member_snapshot, detail(credentials=[{"definitionId": PVG, "memberId": M2}]), CONFIG, TODAY)

fake = Fake({("GET", "Members/FindByAttributes"): lambda body, query: page([{"id": M1}, {"id": M2, "memberNumber": "9"}]),
             ("GET", "Members/" + M1): lambda body, query: ok(detail()),
             ("GET", "Members/" + M2): lambda body, query: ok(detail(M2, number=""))})
snapshot = jg.club_snapshot(client(fake), CONFIG, TODAY)
assert [entry["memberId"] for entry in snapshot["people"]] == [M1] and snapshot["listedIds"] == {M1, M2}
assert snapshot["problems"][0]["justgoMemberId"] == M2, "one unusable record does not stop the sync"
fake.routes[("GET", "Members/" + M2)] = lambda body, query: ok(detail(M2))
raises(jg.JustGoError, jg.club_snapshot, client(fake), CONFIG, TODAY)
fake.routes[("GET", "Members/" + M2)] = lambda body, query: ok(detail(M1))
raises(jg.JustGoError, jg.club_snapshot, client(fake), CONFIG, TODAY)


# --- Uploader.
def website_member(**extra):
    return {"firstName": "Alex", "lastName": "Tester", "email": "alex@example.test", "dob": "1988-05-05", "phone": "0777",
            "address": "1 Road", "postcode": "EH1 1AA", "membershipTier": "adult", "clubYears": [2026],
            "validUntil": dt.datetime(2027, 3, 1, tzinfo=dt.timezone.utc), **extra}


def upload(fake, member, **overrides):
    return asyncio.run(jg.APIUploader(client(fake, **overrides), CONFIG, TODAY).upload(member))


def search(results):
    return lambda body, query: page(results)


created = {}
fake = Fake({("GET", "Members/FindByAttributes"): search([]),
             ("POST", "Members"): lambda body, query: created.update(body) or ok({"id": NEW, "memberNumber": "777777"}),
             ("POST", "Organisations/AddMember"): lambda body, query: ok({"refrence": "LINK-1"}),
             ("POST", "Memberships/Member/" + NEW): lambda body, query: ok({"id": "bbbbbbbb-0000-0000-0000-000000000001", "reference": "MS-1"})})
result = upload(fake, website_member())
assert result == {"status": "submitted", "createdAccount": True, "clubLinkReference": "LINK-1", "justgoMemberId": NEW,
                  "membershipIds": ["bbbbbbbb-0000-0000-0000-000000000001"]}, result
assert created["forcedCreate"] is False and created["emailAddress"] == "alex@example.test"
assert fake.calls[-1][3] == {"id": ADULT, "startDate": "2026-03-01", "endDate": "2027-02-28"}

created.clear()
upload(fake, website_member(firstName="Young", dob="2015-02-01", membershipTier="junior", contactName="Pat Parent", email="pat@example.test"))
assert created["parentFirstName"] == "Pat" and created["parentEmailAddress"] == "pat@example.test" and "emailAddress" not in created
raises(jg.JustGoReviewRequired, upload, Fake({("GET", "Members/FindByAttributes"): search([])}),
       website_member(dob="2015-02-01", membershipTier="junior", contactName="Pat van Parent"))

listed = {"id": M1, "firstName": "Alex", "lastName": "Tester", "dob": "1988-05-05", "memberNumber": "123456"}
fake = Fake({("GET", "Members/FindByAttributes"): search([listed]), ("GET", "Members/" + M1): lambda body, query: ok(detail())})
result = upload(fake, website_member(affiliationNumber="123456"))
assert result["createdAccount"] is False and result["membershipIds"] == [] and result["clubLinkReference"] == ""
assert not [call for call in fake.calls if call[0] != "GET" and call[1] != "Auth"], "an already linked, covered member needs no writes"

fake = Fake({("GET", "Members/FindByAttributes"): search([listed]), ("GET", "Members/" + M1): lambda body, query: ok(detail(suspensionLevel="Full"))})
raises(jg.JustGoReviewRequired, upload, fake, website_member())
fake = Fake({("GET", "Members/FindByAttributes"): search([listed, {**listed, "id": M2}])})
raises(jg.JustGoReviewRequired, upload, fake, website_member())
fake = Fake({("GET", "Members/FindByAttributes"): search([])})
raises(jg.JustGoReviewRequired, upload, fake, website_member(affiliationNumber="123456"))
raises(jg.JustGoReviewRequired, upload, Fake(), website_member(membershipTier="family"))
pending = detail(organisations=[], memberships=[{"id": "m-9", "definitionId": ADULT, "name": "FCC Adult", "status": "Pending",
                                                "startDate": "2026-03-01", "endDate": "2027-02-28"}])
fake = Fake({("GET", "Members/FindByAttributes"): search([listed]), ("GET", "Members/" + M1): lambda body, query: ok(pending)})
raises(jg.JustGoReviewRequired, upload, fake, website_member())

fake = Fake({("GET", "Members/FindByAttributes"): search([listed]), ("GET", "Members/" + M1): lambda body, query: ok(detail(organisations=[], memberships=[])),
             ("POST", "Organisations/AddMember"): lambda body, query: ok({"refrence": "LINK-2"}),
             ("POST", "Memberships/Member/" + M1): http_error(400)})
error = raises(jg.JustGoReviewRequired, upload, fake, website_member())
assert M1 in str(error), "a part-way upload is never retried blindly"
fake = Fake()
raises(jg.JustGoError, upload, fake, website_member(), JUSTGO_API_WRITES_ENABLED="false")
assert fake.calls == [], "the uploader checks the write guard before any request"

print("JustGo API checks passed: guards, auth reuse, paging, write review, parsing, suspensions, credentials, uploader.")
