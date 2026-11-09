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
python3 -m venv venv && venv/bin/pip install -r jobs/justgo/requirements.txt
```

## Run Locally

One command starts the emulators, seeds test records on first run, then starts the API and website:

```bash
npm run local            # or scripts/localhost_startup.sh [--fresh | --clean] [--preview]
```

Saved emulator data in `./emulator-data` is reused; `--fresh` starts empty and reseeds, and `--clean` starts empty without test records (only the local test admin account) and leaves the saved data untouched. `--preview` serves a production build instead of the Vite dev server. Pass options through npm with `npm run local -- --clean`. Ctrl+C stops everything and saves the emulator data (not with `--clean`). If emulators are already running they are reused.

To run the parts separately instead:

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
npm run dev -- --port 3000
```

Open `http://localhost:3000`. The API only answers `/api/...` and `/health`; the website is served by Vite locally and Firebase Hosting in production. Use **Admin** in the footer, then **Sign in as local test admin**. Emulator UI: `http://localhost:4000`; API: `http://localhost:3002`.

- **Emails** are written to Firestore's `testMail` collection (`body` and `html`), not sent. The organisation footer comes from Google Workspace **Append footer** rules, not the templates.
- **Checkout revalidation:** returning-member verification belongs to the checked receipt email, name and date of birth. Editing the receipt email or identity fields clears the match (including volunteer discount previews); press **Verify** on the person step to check again. Every changed step must pass **Next** again, and the complete checkout is validated before requesting payment. Lookup failures block progress rather than treating members as new people.
- **Trip discounts (#31):** single-day trips are discounted for each attendee who holds a qualifying service or subscription this club year, or buys one in the same basket. Admins set the rules (amount, qualifying products, the checkout name and the trip-card wording) in **Reports & records → Trip discounts**; they are saved in `settings/tripDiscounts`, and until then £10 for annual boat hire and £10 for a coaching subscription apply ([tripDiscount.js](src/utils/tripDiscount.js)). The basket and checkout both price with `GET /api/trip-discounts`, so the review total is what Stripe charges. The own-kit tick plays no part. Qualifying products cannot be removed from the shop: `firestore.rules` reads their ids from the same document.
- **Back from Stripe:** the basket, attendees and typed details are kept in this tab's `sessionStorage`, so the browser back button or Stripe's cancel link (`/membership`) returns to them. Saved lines the cached catalogue does not have yet (such as a new event) wait for the live catalogue rather than being dropped. Starting checkout again expires the earlier Stripe session, and an earlier payment that went through or is still clearing is refused rather than charged twice. A discount code is not kept and must be entered again.
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

Install `jobs/justgo/requirements.txt` first; for the repository virtual environment, set `PYTHON="$PWD/venv/bin/python"`. Use fresh emulators, not imported data. The runner seeds fixtures and mocks Stripe; real Stripe Test Clocks are manual only.

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
venv/bin/python jobs/justgo/test-justgo-api.py
venv/bin/python jobs/justgo/test-justgo-sync.py
venv/bin/python jobs/justgo/test-justgo-upload.py

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

### Failed payments

Stripe does the retrying. In each mode's Dashboard, under **Billing → Revenue recovery → Retries**, use Smart Retries (or a fixed schedule), set **If all retries for a payment fail** to **Cancel the subscription**, and include Bacs Direct Debit. Turn off Stripe's own failed-payment customer emails so members are not emailed twice.

- **Monthly debit paid** (`invoice.paid`): the member is emailed a club receipt in the checkout receipt's layout, headed as a subscription payment, once per invoice. It has Stripe's invoice number, the payment date and the days covered, and lists every item paid monthly (subscriptions, and membership or kit hire paid monthly) under the person it is for, priced from the invoice lines; any discount or credit is shown so the lines add up to what was paid. £0 invoices (the free trial at set-up) are skipped. Subscriptions set up outside this site (e.g. the old Bookwhen ones, on the same Stripe account) are receipted too: to the payer email on the Stripe invoice, with the items from the invoice lines and the names of any members the subscriber import linked; `invoiceReceipts/{invoiceId}` stops repeats. If the same invoice failed earlier, the receipt says the payment has now gone through. Stripe's own successful-payment emails can stay off.
- **Monthly debit fails** (`invoice.payment_failed`): the member is emailed each attempt once, with the date Stripe tries again. On the final attempt (no retry scheduled) the email says the payments have stopped and links to restart (`/membership?restart=…`, the same items and people refilled in the basket for a new monthly checkout; missed months are not collected) or confirm they are stopping (`/payment-issue?subscription=…`). The treasurer gets a copy, and it is listed under Needs attention.
- **Stripe cancels the subscription** (`customer.subscription.deleted` before the club-year cut-off): its monthly items, and any membership paid with it, end at the paid-up date (the start of the earliest unpaid month). The member is emailed the links if the final-failure email was not sent. Restarting or confirming settles the Needs-attention entries.
- **A one-off bank payment fails** (`checkout.session.async_payment_failed`): the member is emailed links to retry (`/membership?retry=…`, the same basket as a new order) or cancel the order (`/payment-issue?order=…`). Retry links last 30 days. Once a retry is paid the old order records `retriedAs`; a second retry is refused.

Links are `ID.TOKEN`; only the token's hash is stored, and a new email replaces the earlier link. Opening a link never changes anything; cancelling needs the button on the page. To try it in the sandbox, attach card `4000 0000 0000 0341` (attaches, then declines) to a customer with a subscription and use **Advance time** on a Test Clock, or resend an `invoice.payment_failed` event from the Dashboard. Locally, payer emails starting `debit-fail.` give the mocked subscription an unpaid next debit (see `scripts/mock-stripe.mjs`).

## Data migrations

Export Firestore first, inspect the dry run, then apply. Already-converted records are skipped; incomplete guardian data must be corrected before retrying.

```bash
node scripts/migrate-schema.js
node scripts/migrate-schema.js --apply
```

The migration covers households, membership terms, orders, products, discount codes, Stripe mirrors and audit logs, and deletes legacy `customers` documents. See [schema.js](src/utils/schema.js), [membershipTerms.js](src/server/membershipTerms.js) and [orderPeople.js](src/server/orderPeople.js) for current record handling.

## JustGo

Use the [v2.2 API contract](docs/justgo/justgo-api-v2.2.json), not browser automation. The Python code in [jobs/justgo/](jobs/justgo/) runs as two Cloud Run jobs started by Cloud Scheduler: `fcc-justgo-sync` (daily 04:00 London) and `fcc-justgo-upload` (hourly). Each deployment rebuilds them (see [Scheduled jobs](#scheduled-jobs)); keep secrets out of Git.

Run the operator commands locally with the secret from Secret Manager:

```bash
export JUSTGO_API_SECRET="$(gcloud secrets versions access latest --secret=justgo-api-secret)" JUSTGO_API_ENABLED=true JUSTGO_ORGANISATION_ID=...
venv/bin/python jobs/justgo/justgo-admin.py discover
venv/bin/python jobs/justgo/justgo-admin.py snapshot
```

Job settings are GitHub repository variables (Settings > Secrets and variables > Actions > Variables), applied on the next deploy: `JUSTGO_ORGANISATION_ID`, then from discovery `JUSTGO_MEMBERSHIP_DEFINITIONS`, `JUSTGO_CREDENTIAL_DEFINITIONS`, `JUSTGO_ACTIVE_MEMBERSHIP_STATUSES`, `JUSTGO_ACTIVE_MEMBER_STATUSES` and `JUSTGO_CLUB_MEMBER_ROLE`; optionally `JUSTGO_UNSUSPENDED_LEVELS`. Check the snapshot before setting `JUSTGO_API_ENABLED=true` (resumes the sync schedule), then `JUSTGO_API_WRITES_ENABLED=true` (resumes the upload schedule). Run a job once on demand with `gcloud run jobs execute fcc-justgo-sync --region europe-west2 --wait`; its output is in Cloud Run job logs.

- Sync reads memberships, suspension and credentials. After 8 days without success, membership confirmation is unreliable and the register warns staff.
- Upload links paid website memberships to FCC. Ambiguous identities, suspended/inactive accounts, overlapping memberships, family/guardian issues and uncertain writes require staff review, not automatic retry.
- Read commands: `discover`, `find-member`, `member`, `snapshot`. Writes require both the write flag and `--confirm-write`: `create-member`, `update-member`, `add-to-club`, `update-club-role`, `remove-from-club`, `add-membership --tier --club-year`, `update-membership`. Unlinking affects FCC only; nothing deletes or suspends a JustGo account.
- Output redacts known personal fields but IDs and free text remain private. Do not publish it.

## Deployment configuration

- **Google sign-in:** authorise `new.forthcanoeclub.co.uk` in Firebase and `https://new.forthcanoeclub.co.uk/__/auth/handler` in the OAuth client before setting the Actions variable `VITE_FIREBASE_AUTH_DOMAIN` and rebuilding. Keep the existing `firebaseapp.com` redirect. Removing the variable restores the secret's domain on the next deploy; leave emulator settings unchanged.
- **Origins:** `PUBLIC_SITE_URL` is canonical; `PUBLIC_SITE_URLS` adds approved checkout/receipt origins, and `CORS_ORIGINS` adds browser API origins. Keep all three frontends (`new.forthcanoeclub.co.uk`, `fccwebsite-23cfc.web.app`, `fccwebsite-23cfc.firebaseapp.com`) allowed. Escape commas as `\,` in the Hosting workflow's Cloud Run `env_vars`. CORS and Firebase `authDomain` are independent.
- **Proxy/rate limits:** Cloud Run uses one trusted proxy hop; adjust `TRUST_PROXY_HOPS` for other deployments. Use [rateLimit.js](src/server/rateLimit.js) for new routes; the baseline is 300 requests/minute (`BASELINE_RATE_LIMIT`).
- **Renewals:** Cloud Scheduler job `fcc-renewals` posts to the API's `/api/jobs/renewals` at 09:00 London on 1 and 15 February, using the `renewal-job-token` secret that the API also reads as `RENEWAL_JOB_TOKEN`.
- **Email:** `STAFF_ALERT_EMAIL` defaults to the committee. Configure the volunteer coordinator in Reports. Retry failed notifications in the admin panels. Volunteer-benefits emails include HTML paragraphs and a bulleted list, with a plain-text alternative and an explicit Forth Canoe Club sign-off; email clients control line wrapping.
- **Admin page edits:** saves target `GITHUB_CONTENT_BRANCH` (`live/web-admin-edit`); merge the review PR into `GITHUB_BRANCH` (`main`) to publish. A rebase warning needs manual reconciliation:

```bash
git fetch && git checkout live/web-admin-edit && git rebase origin/main && git push --force-with-lease
```

In Edit Mode, select words in a description and use its link icon to add a link. Put the cursor inside an existing link to edit or remove it. Links are stored as `[link text](destination)` in the existing text fields, not HTML; ordinary text and existing template links remain unchanged. Home's legacy split paragraphs migrate to whole editable paragraphs, retaining saved wording and destinations. Destinations may be HTTPS (opens a new tab), website-relative (for example `/?page=beginners`), or `mailto:`. Tile settings allow a custom button on text, image, link, or existing tiles, with editable text and destination; choose "No button" to remove a template button, or "Keep original button" to restore it.

The editor toolbar appears whenever an approved admin is signed in; its presence does not mean Edit Mode is on. The browser remembers the Edit Mode setting and restores local drafts from earlier sessions. On sign-in, a read-only GitHub check distinguishes **Unsaved browser changes** (different from the saved draft) from **Saved, not published** (saved in GitHub but different from the deployed website, including merged changes awaiting deployment). A page can have both a saved unpublished version and newer unsaved browser edits. Merely reopening the site or entering Edit Mode does not make a page unsaved. Failed status checks leave drafts intact, display an error and offer a retry rather than guessing their saved state.

**Save all drafts** saves every page with unsaved browser changes. **Request publication review** creates or reuses the review PR; when there are unsaved changes, **Save all & request review** saves those first. Neither action publishes directly: the review PR must be merged and deployed. Discarding browser changes does not remove a saved draft from GitHub.

Volunteering configuration is saved directly to Firestore, not through GitHub publishing; its History panel restores previous versions.

### App Check

Register the deployed web app with Firebase App Check's reCAPTCHA Enterprise provider. Add the public site key as the GitHub Actions secret `VITE_APPCHECK_SITE_KEY`; deployment requires it and embeds it in the website. The site key is public, not a server credential. Do not add the standalone reCAPTCHA scripts or call the assessments API: Firebase manages token exchange and refresh.

App Check initializes before Auth, Firestore and Storage. Browser API calls use `apiFetch` to attach `X-Firebase-AppCheck`; Cloud Run verifies it with Firebase Admin and restricts it to the deployed Firebase app ID. Existing admin claims, email sessions, rate limits and input validation still apply. All browser API mutations and private admin/member/receipt/roster reads are checked. Stripe webhooks and scheduled renewal callbacks retain their own authentication and are exempt. Local loopback runs and Firebase emulators do not obtain browser tokens; the local API bypass is enabled only by `LOCAL_FIREBASE_EMULATORS=true`.

The GitHub repository variable `APP_CHECK_MODE` defaults to `monitor`: missing/invalid tokens are logged, not blocked. In this mode token acquisition failures are logged and requests still run. After deploying, inspect Cloud Run's `App Check` logs and Firebase's verified-request metrics. Enable Firebase enforcement independently for Auth, Firestore and Storage when ready. Set `APP_CHECK_MODE=enforce` and redeploy to reject missing/invalid tokens on protected Cloud Run routes too; enabling Firebase enforcement alone does not protect Cloud Run. Deploy and allow older browser versions to refresh before enforcing. App Check attests the app; it is not proof of a person's identity and does not eliminate all automated abuse.

### Images

Admins can choose PNG, JPG or WebP photos up to 25 MB for page banners, image tiles, supporter logos and shop products. The admin's browser ([imageProcessing.js](src/utils/imageProcessing.js)) corrects the camera rotation, then makes WebP copies at the widths in [responsiveImages.js](src/utils/responsiveImages.js) (banners 640–3840 px, tiles and products 320–1920 px, logos 160–640 px), never wider than the original. It also makes a plain JPEG/PNG copy for receipt emails, offline reading and old browsers, and a ~1 KB preview stored in the page content. The original is not uploaded; every stored file stays under the 5 MB limit in [storage.rules](storage.rules) and is cached by browsers for a year. A 6000×4000 photo takes about 3 seconds to prepare in desktop Chrome.

[ResponsiveImage.jsx](src/components/ResponsiveImage.jsx) measures each image's box and downloads the smallest copy at least as wide as the box × the screen's pixel density (capped at 2×, allowing for cover cropping). The blurred preview shows at once and the sharp copy replaces it when downloaded; if the box grows (for example, a maximised window), a larger copy loads, but it never steps down. Examples for a 3:2 banner: phone 1600 px, 1366×768 laptop 1600 px, 1080p 1920 px, 1440p 2560 px, 4K 3840 px. The service worker stores only the plain copy for offline reading, so new visitors do not download every size.

Banners need originals at least 2560 px wide to look sharp on large desktop monitors; the editor warns when an upload is narrower. Typing a photo URL instead of uploading shows that single image, as before. Older uploads without sizes keep working, and failed uploads may leave unused files in Storage. See [docs/hosting-cost-plan.md](docs/hosting-cost-plan.md) for traffic and cost estimates.

### Notices

The [Notices page](src/pages/NoticesPage.jsx) (`/notices`) shows the club's notices (privacy notice, data retention, terms…) as a row of tabs along the top, one notice per tab, with the selected tab joined to its document below. Signed-in admins tick **Edit notices** on the page to write, add, reorder or archive them; there is no GitHub review step, and changes go live when published.

- **Versions.** Publishing changed wording (title or text) makes the next numbered version through the API ([notices.js](src/server/notices.js)). Each version is kept for good in `noticeVersions/{id}@{n}` with who published it and when; archiving and restoring are logged in `noticeHistory`. Both collections are server-only. The public `notices` collection holds only the current wording, and stays readable while admin identities stay out of it.
- **PDF.** `GET /api/notices/{id}/pdf?version=n` builds a PDF of any published version (the current one without `version`). Archived notices' old versions stay downloadable for the record.
- **Checkout.** The review step asks people to tick "I agree to the club's Notices" when any are published. The server refuses payment unless `noticeVersions` names the current version of every published notice, so a notice changed mid-checkout must be agreed again. The order keeps `noticeAgreement` and each member's `consents.notices` keeps the latest agreement.
- **Formatting.** `## ` and `### ` start headings, `- ` and `1. ` start list items, blank lines separate paragraphs, and links use `[text](https://…)`, as in [notices.js](src/utils/notices.js).

Use the IDs `privacy-notice` and `data-retention` (the titles "Privacy notice" and "Data retention" give these) so live-mode readiness checks find them. Agreeing to the notices records that people were told; it is not consent, so photo/video consent stays a separate tick.

### Consents

Checkout and club-night guest check-in ask everyone for the participation disclaimer (required) and photo and video consent (optional; saying no never blocks anything). A parent or guardian answers for under-18s. Helpers are in [consents.js](src/utils/consents.js); the wording is `DISCLAIMER_TEXT` and `PHOTO_CONSENT_TEXT` in [checkout.js](src/utils/checkout.js).

- **Records.** Each person's membership record (contact-only for non-members) keeps `consents.disclaimer` and `consents.photoVideo`. A photo answer holds the wording version, when, who answered (`self`, `guardian` or `household-contact`), where (`checkout`, `club-night` or `my-details`), the order and the notice versions in force. A newer answer replaces the whole record, including a no. Checkout orders mark whether they asked the photo question; legacy orders without that marker do not turn an implicit false into a recorded withdrawal for an existing member. Checkout answers are timestamped when the order is created, not when a bank payment later clears; a more recent answer in My details therefore stays current. Every change is added to `consents.photoVideoHistory`. Orders keep `policyVersions`. In live mode the version is `policies/{key}.currentVersion`, which the API raises at start-up and hourly when its wording has changed (`syncPolicies`); before then every version is `pre-live`.
- **Ticked in advance.** Checkout ticks earlier answers only when they were given to the current version. This happens after the date of birth matches (`/api/membership-names` returns `prefill`) and on renewal, retry and restart links. If the wording has changed, the box stays unticked with a note. Notices are ticked only when every published notice is still at the agreed version. Unticking the disclaimer blocks checkout; it is not a withdrawal. Unticking photo consent records a no. Changing the person's name, date of birth or email clears these ticks. A retry link offers the failed order's answers, unless the membership record has a newer answer (such as a withdrawal).
- **My details.** The household's contact can give or withdraw photo consent for anyone in the household, including JustGo-managed households, because the club holds this answer. Each change is logged in `selfServiceChanges`. It applies to attendee lists straight away and to the next checkout.
- **Attendee lists.** Leaders see only "No consent: do not photograph or film" for anyone without consent, and the email adds a count. They do not see the history.
- **Wording checks.** The browser sends `wording` (fingerprints of both texts) with checkout, guest check-in and a My details grant. If it does not match the API's build, the API answers 409 `wording_changed` and the person must reload. Saved checkout drafts from an older build lose their ticks. Hosting and the API deploy separately, so a release that changes either text may refuse checkouts for a few minutes until both are live; after that, reloading fixes it.

### Live mode and sensitive operations

`WEBSITE_ISLIVE` defaults to false. Live mode versions consent wording and retains records/audit history. Before enabling it, publish the required policies, settle retention/analytics consent and outstanding security issues, and review Stripe live-mode support: checkout currently accepts test keys only.

Create Secret Manager secrets and grant the Cloud Run account access:

- `audit-lookup-secret` -> `AUDIT_LOOKUP_SECRET`; generate with `openssl rand -hex 32`. Never rotate without migrating audit lookups.
- `stripe-subscription-admin-key` -> `STRIPE_SUBSCRIPTION_ADMIN_KEY`; matching-mode subscription, item, schedule and customer read/write (including deletion), plus invoice, payment-intent and charge read access.

Refunds need refund write and payment/invoice/charge/refund read permissions. Reporting uses a separate server-only `STRIPE_REPORT_SECRET_KEY`.

Use purchased-item actions, not order deletion, for refunds/revocations. What each admin action changes (none deletes the order):

| Action (where) | Money back | Access/benefit | Future monthly billing |
| --- | --- | --- | --- |
| **Revoke access** (Purchased item actions) | No | Removed now: membership recomputed without the item, its terms ended, key access revoked, event place released, voucher disabled | Monthly item: stopped now (Stripe subscription item deleted without proration; the whole subscription is cancelled if it was the last item) |
| **Refund one payment** / **Refund only** (Purchased item actions) | Yes, the chosen amount from the chosen payment (each monthly invoice is listed separately) | Kept | Carries on |
| **Refund and cancel** (monthly) / **Refund and revoke** (one-off) (Purchased item actions) | Yes, as above | Removed now, as for Revoke | Monthly item: stopped now, as for Revoke |
| **Resume unfinished action** (Purchased item actions) | Only the refund already recorded for that action; never a second one | As the recorded action | As the recorded action |
| **Cancel item / this member's items / whole subscription** (Monthly payments on an order or member) | No | The items' terms end now; a membership runs to the date it is paid up to | Stopped now for those items |
| **Stop billing immediately** (Subscriptions tab) | No | For website subscriptions, ended as above once Stripe's cancellation webhook arrives (the payer is emailed); others need checking by hand | Whole subscription cancelled now |

Refund and cancel issues the Stripe refund first (keyed by the operation ID, and saved on the audit record), then stops billing, then records the revocation. If any step fails the order keeps the action as unfinished and blocks other item actions; **Resume unfinished action** replays exactly that request, reusing the saved refund, and stopping billing only touches items still active, so neither the refund nor the cancellation happens twice. A refund that Stripe rejects outright is released so it can be corrected. Deleting a member record stops that member's monthly items straight away without a refund; others on the same subscription keep paying, and subscriptions set up directly in Stripe still need checking by hand. Deleting an order is refused while its monthly payments run. Shared physical boathouse codes must be rotated after disclosure if access needs retracting.

GDPR erasure is irreversible; admin deletion retains a recovery snapshot. Erasure stops affected billing but preserves shared beneficiaries and anonymised financial history. Stripe history/mandates may need manual review; Google Sheets and JustGo cleanup are separate. Treat receipt links as private.

### Scheduled jobs

[scheduled-jobs.sh](scripts/scheduled-jobs.sh) replaces the old VM systemd timers. Each deployment runs `scripts/scheduled-jobs.sh deploy`, which rebuilds the JustGo jobs from [jobs/justgo/](jobs/justgo/), applies the JustGo repository variables, and creates or updates the three Cloud Scheduler jobs. JustGo schedules stay paused until their enable flags are true.

One-off setup, as a project owner, before the first deployment that includes it:

```bash
scripts/scheduled-jobs.sh setup <deploy-account-email>
```

This enables the APIs and creates the `fcc-scheduled-jobs` service account (Firestore access, starts the jobs). It creates the `renewal-job-token` secret if missing and grants the API and deploy accounts access. The deploy account also gets Cloud Scheduler admin and permission to act as the jobs account. If `justgo-api-secret` is missing it is created with a placeholder; add the real value with `gcloud secrets versions add justgo-api-secret --data-file=-` before enabling JustGo.

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
