# Development

Run from the repository root in Bash. Use Node 22 LTS and Java 21 for Firebase emulators.

## Install

```bash
npm install
npm install -g --allow-scripts=@stripe/cli
npm install-scripts approve esbuild protobufjs
npm ci
cp .env.example .env
cp -n .env.emulator.example .env.emulator
```

## Run Locally

Terminal 1: Auth, database and image storage.

```bash
npx --yes firebase-tools@14.22.0 emulators:start --only auth,firestore,storage --project demo-fcc --export-on-exit=./emulator-data
```

Add `--import=./emulator-data` on later runs to restore saved test data.

Terminal 2: seed test records once, then start the API.

```bash
set -a; source .env.emulator; set +a
unset NODE_ENV GITHUB_CONTENT_TOKEN STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_REPORT_SECRET_KEY STRIPE_SUBSCRIPTION_ADMIN_KEY
node scripts/seed-emulators.js
npm run server
```

Terminal 3: frontend.

```bash
set -a; source .env.emulator; set +a
unset NODE_ENV
npm run dev
```

Open `http://localhost:3000`. Use **Admin** in the footer, then **Sign in as local test admin**. Emulator UI: `http://localhost:4000`; API: `http://localhost:3002`.

- **Emails** are written to Firestore's `testMail` collection (`body` and `html`), not sent. The organisation footer comes from Google Workspace **Append footer** rules, not the templates.
- **Remote VS Code:** forward ports `3000`, `3002`, `4000`, `8080`, `9099` and `9199`.
- **Edits:** restart the API after backend changes; Vite reloads the frontend.
- **Vite API proxy:** when `VITE_API_BASE_URL` is empty, Vite proxies `/api` requests to `http://127.0.0.1:3000` by default. Set `VITE_API_PROXY_TARGET` when the local API uses another address or port.
- **Seed data:** synthetic households, orders, a course and a voucher; reseeding resets them.
- **Mobile checks:** 390x844, 360x640, 320x568 portrait and 667x375, 844x390 landscape.
- **Banner editor (#88):** Upload photo and Photo URL should have matching input heights and align on desktop; all four fields should fit on mobile.
- **Key access (#26):** Grant, revoke, then restore access on a synthetic member. After each refresh, the record dialog must have exactly one key-access heading, reason field and action.
- **Mobile editor navigation:** Homepage shortcut bubbles disappear in Edit Mode below 1024px; the hamburger menu remains available. Turning Edit Mode off restores the shortcuts. Desktop navigation is unchanged.

## Build And Test

```bash
npm test
npm run build
node --check server.js
git diff --check
```

Pull requests run **Build and tests / Build and test** on a GitHub-hosted Ubuntu runner with Node 22, Python 3.12 and Java 21. The workflow installs locked npm dependencies and the Python requirements, runs all unit tests and the production build, then runs the local integration suites against fresh Firebase emulators.

To run the same integration checks locally:

```bash
set -a; source .env.emulator.example; set +a
npx --yes firebase-tools@14.22.0 emulators:exec \
  --only auth,firestore,storage --project demo-fcc \
  'npm run test:integration'
```

Install `requirements.txt` first; for the repository virtual environment, set `PYTHON="$PWD/bin/python"`. Use fresh emulators, not imported data. The runner seeds fixtures and mocks Stripe; real Stripe Test Clocks are manual only.

### Focused emulator tests

Stop manually running emulators before the isolated API/Storage smoke test:

```bash
set -a; source .env.emulator; set +a
unset NODE_ENV
npx --yes firebase-tools@14.22.0 emulators:exec --only auth,firestore,storage --project demo-fcc "node scripts/seed-emulators.js && node scripts/test-emulators.js"
```

With emulators running and `.env.emulator` loaded:

```bash
node scripts/test-admin-domain.js
node scripts/test-club-night.js
node scripts/test-volunteering.js
bin/python scripts/test-justgo-api.py
bin/python scripts/test-justgo-sync.py
bin/python scripts/test-justgo-upload.py

LOCAL_FIREBASE_EMULATORS=true GCLOUD_PROJECT=demo-fcc-item-action-tests \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 node scripts/test-item-actions.js
```

The JustGo API test is offline; sync/upload tests need `FIRESTORE_EMULATOR_HOST`. Item-action tests mock refunds.

### Mocked checkout

With emulators running, start a separate API:

```bash
set -a; source .env.emulator; set +a
node scripts/seed-emulators.js
RENEWAL_JOB_TOKEN=local-renewal-job-token-0123456789abcdef PUBLIC_SITE_URL=https://fccwebsite-23cfc.web.app PUBLIC_SITE_URLS=https://staging.example.test WEBSITE_ISLIVE=true STRIPE_SUBSCRIPTION_ADMIN_KEY=sk_test_local_admin PORT=3010 STRIPE_SECRET_KEY=sk_test_local_fixture STRIPE_WEBHOOK_SECRET=whsec_local_only node --import ./scripts/mock-stripe.mjs server.js
```

Then in another terminal:

```bash
set -a; source .env.emulator; set +a
RENEWAL_JOB_TOKEN=local-renewal-job-token-0123456789abcdef node scripts/test-checkout-flow.js
```

Keep the shown origins, live-mode flag and matching renewal token: the tests require them. Set `TEST_API_PORT` if changing `PORT`. Synthetic `@example.test` records remain afterwards. `X-Test-Now: <ISO date>` overrides checkout/renewal/job time only with local emulators, not webhook subscription setup.

### Real Stripe sandbox

Test Clocks use a dedicated sandbox and a restricted key file outside the repository (`STRIPE_SANDBOX_TEST_KEY=rk_test_...` or the key alone; protect with `chmod 600`). Grant test-clock, customer, payment-method, product and subscription write access, plus invoice read access.

```bash
node scripts/test-stripe-clocks.js /absolute/path/to/stripe-sandbox.env
```

The script cleans up its own resources. Select one case with `STRIPE_CLOCK_CASE=current-year`, `next-year`, `delayed-payment` or `failed-payment`. This tests subscription billing, not Checkout, Bacs, webhook delivery or membership activation.

For sandbox Checkout, run the local stack and forward all eight webhook events:

```bash
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.payment_failed,customer.subscription.deleted,invoice.payment_failed,invoice.paid --forward-to localhost:3002/api/stripe/webhook
```

Restart the API with a test `STRIPE_SECRET_KEY` and the CLI's `STRIPE_WEBHOOK_SECRET`. Use card `4242 4242 4242 4242`, a future expiry and any CVC; cancel sandbox subscriptions afterwards. Dashboard endpoints need the same events and their own mode-specific signing secret. Never commit or share keys.

## Data migrations

Export Firestore first, inspect the dry run, then apply. Already-converted records are skipped; incomplete guardian data must be corrected before retrying.

```bash
node scripts/migrate-schema.js
node scripts/migrate-schema.js --apply
```

The migration covers households, membership terms, orders, products, discount codes, Stripe mirrors and audit logs, and deletes legacy `customers` documents. See [schema.js](src/utils/schema.js), [membershipTerms.js](src/server/membershipTerms.js) and [orderPeople.js](src/server/orderPeople.js) for current record handling.

## JustGo

Use the [v2.2 API contract](docs/justgo/justgo-api-v2.2.json), not browser automation. Jobs run through the VM's systemd units with `.env`; keep secrets out of Git.

```bash
gcloud secrets versions access latest --secret=justgo-api-secret
venv/bin/python scripts/justgo-admin.py discover
scripts/justgo-admin.py snapshot
```

Set `JUSTGO_API_SECRET`, `JUSTGO_ORGANISATION_ID` and `JUSTGO_API_ENABLED=true`; leave writes off initially. Use discovery to set `JUSTGO_MEMBERSHIP_DEFINITIONS`, `JUSTGO_CREDENTIAL_DEFINITIONS`, `JUSTGO_ACTIVE_MEMBERSHIP_STATUSES`, `JUSTGO_ACTIVE_MEMBER_STATUSES` and `JUSTGO_CLUB_MEMBER_ROLE`; optionally set `JUSTGO_UNSUSPENDED_LEVELS`. Check the snapshot before enabling `fcc-sync`, then `JUSTGO_API_WRITES_ENABLED=true` and `fcc-upload`.

- Sync reads memberships, suspension and credentials; run weekly. After 8 days without success, membership confirmation is unreliable and the register warns staff.
- Upload links paid website memberships to FCC. Ambiguous identities, suspended/inactive accounts, overlapping memberships, family/guardian issues and uncertain writes require staff review, not automatic retry.
- Read commands: `discover`, `find-member`, `member`, `snapshot`. Writes require both the write flag and `--confirm-write`: `create-member`, `update-member`, `add-to-club`, `update-club-role`, `remove-from-club`, `add-membership --tier --club-year`, `update-membership`. Unlinking affects FCC only; nothing deletes or suspends a JustGo account.
- Output redacts known personal fields but IDs and free text remain private. Do not publish it.

## Deployment configuration

- **Google sign-in:** authorise `new.forthcanoeclub.co.uk` in Firebase and `https://new.forthcanoeclub.co.uk/__/auth/handler` in the OAuth client before setting the Actions variable `VITE_FIREBASE_AUTH_DOMAIN` and rebuilding. Keep the existing `firebaseapp.com` redirect. Removing the variable restores the secret's domain on the next deploy; leave emulator settings unchanged.
- **Origins:** `PUBLIC_SITE_URL` is canonical; `PUBLIC_SITE_URLS` adds approved checkout/receipt origins, and `CORS_ORIGINS` adds browser API origins. Keep all three frontends (`new.forthcanoeclub.co.uk`, `fccwebsite-23cfc.web.app`, `fccwebsite-23cfc.firebaseapp.com`) allowed. Escape commas as `\,` in the Hosting workflow's Cloud Run `env_vars`. CORS and Firebase `authDomain` are independent.
- **Proxy/rate limits:** Cloud Run uses one trusted proxy hop; adjust `TRUST_PROXY_HOPS` for other deployments. Use [rateLimit.js](src/server/rateLimit.js) for new routes; the baseline is 300 requests/minute (`BASELINE_RATE_LIMIT`).
- **Renewals:** configure `RENEWAL_JOB_TOKEN` (32+ random characters) in the API and job environment, plus `RENEWAL_JOB_URL` ending `/api/jobs/renewals`. [fcc-renewals.timer](config/fcc-renewals.timer) schedules 09:00 London on 1 and 15 February.
- **Email:** `STAFF_ALERT_EMAIL` defaults to the committee. Configure the volunteer coordinator in Reports. Retry failed notifications in the admin panels. Volunteer-benefits emails include HTML paragraphs and a bulleted list, with a plain-text alternative and an explicit Forth Canoe Club sign-off; email clients control line wrapping.
- **Admin page edits:** saves target `GITHUB_CONTENT_BRANCH` (`live/web-admin-edit`); merge the review PR into `GITHUB_BRANCH` (`main`) to publish. A rebase warning needs manual reconciliation:

```bash
git fetch && git checkout live/web-admin-edit && git rebase origin/main && git push --force-with-lease
```

In Edit Mode, select words in a description and use its link icon to add a link. Put the cursor inside an existing link to edit or remove it. Links are stored as `[link text](destination)` in the existing text fields, not HTML; ordinary text and existing template links remain unchanged. Home's legacy split paragraphs migrate to whole editable paragraphs, retaining saved wording and destinations. Destinations may be HTTPS (opens a new tab), website-relative (for example `/?page=beginners`), or `mailto:`. Tile settings allow a custom button on text, image, link, or existing tiles, with editable text and destination; choose "No button" to remove a template button, or "Keep original button" to restore it. Save draft still saves only the current page (see #70).

Volunteering configuration is saved directly to Firestore, not through GitHub publishing; its History panel restores previous versions.

### Live mode and sensitive operations

`WEBSITE_ISLIVE` defaults to false. Live mode versions consent wording and retains records/audit history. Before enabling it, publish the required policies, settle retention/analytics consent and outstanding security issues, and review Stripe live-mode support: checkout currently accepts test keys only.

Create Secret Manager secrets and grant the Cloud Run account access:

- `audit-lookup-secret` -> `AUDIT_LOOKUP_SECRET`; generate with `openssl rand -hex 32`. Never rotate without migrating audit lookups.
- `stripe-subscription-admin-key` -> `STRIPE_SUBSCRIPTION_ADMIN_KEY`; matching-mode subscription, item, schedule and customer read/write (including deletion), plus invoice, payment-intent and charge read access.

Refunds need refund write and payment/invoice/charge/refund read permissions. Reporting uses a separate server-only `STRIPE_REPORT_SECRET_KEY`.

Use purchased-item actions, not order deletion, for refunds/revocations. Refunds alone do not stop access or billing. Retry unfinished actions with the exact recorded request, never a replacement refund. Shared physical boathouse codes must be rotated after disclosure if access needs retracting.

GDPR erasure is irreversible; admin deletion retains a recovery snapshot. Erasure stops affected billing but preserves shared beneficiaries and anonymised financial history. Stripe history/mandates may need manual review; Google Sheets and JustGo cleanup are separate. Treat receipt links as private.

### Outage alerts

Deployments (main pushes, manual runs and monthly on the 1st at 18:00 UTC) configure the **FCC API health** uptime check and **FCC API outage** email policy. Set recipients in `API_ALERT_EMAILS` in [.github/workflows/firebase-hosting.yml](.github/workflows/firebase-hosting.yml).

One-off setup for the deploy account:

```bash
gcloud services enable monitoring.googleapis.com --project fccwebsite-23cfc
gcloud projects add-iam-policy-binding fccwebsite-23cfc --member serviceAccount:<deploy-account-email> --role roles/monitoring.editor
```

`/health` checks Firestore as well as the process. On an alert, inspect Cloud Run logs; route traffic to the previous revision if a deployment broke it. Otherwise check secrets, billing and Google Cloud status. CORS failures are not uptime failures.

## Dependency checks

Use the lockfile and review dependency changes; do not force audit fixes blindly.

```bash
npm ci
npm audit
docker build -t fcc-api . && docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image --severity HIGH,CRITICAL fcc-api
```

The distroless Node 22 runtime has no shell or npm. Retain dependency overrides until parents supply safe versions. Preserve the compressed-request rejection (`inflate: false`), avoid untrusted qs comma serialization, and validate IPv6 before `Address6`; these mitigate open advisories, not replace patched dependencies.

## Basic debugging

- Orders fail: start the API and Firestore, then run `curl --fail http://localhost:3002/health`.
- Payment pending: check Stripe CLI delivery and the signing secret; Stripe is not a Firebase emulator.
- API returns HTML: check `VITE_API_BASE_URL` and restart Vite.
- Admin denied: reseed locally and sign out/in. Real admins need a verified Google account on exactly `forthcanoeclub.co.uk`, an initial `/admin` sign-in and approval under **Website admins**, or `node scripts/grant-admin.js name@forthcanoeclub.co.uk`. Revoke with `--revoke --reason "..."`.
- Upload fails: check Storage rules/emulator and port `9199`.
- Stripe subscribers unavailable: check the report key's read permissions and matching mode.
- Port occupied: change the frontend port and `PUBLIC_SITE_URL`.

For cloud-backed development, copy [.env.example](.env.example) to an ignored `.env`, use a test project and set `VITE_API_BASE_URL` to its API.
