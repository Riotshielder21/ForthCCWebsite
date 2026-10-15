# Development

Run from the repository root in Bash. Use Node 22 LTS and Java 21 for Firebase emulators.

## Install

```bash
npm ci
cp .env.example .env
cp -n .env.emulator.example .env.emulator
```

Use the `demo-fcc` emulators below for local data. Never use production credentials for tests.

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

Open `http://localhost:3000`. Use **Admin** in the footer, then **Sign in as local test admin**. Emulator UI: `http://localhost:4000`; API: `http://localhost:3002`. Test receipt links are stored in Firestore's `testMail` collection, not emailed.

In remote VS Code, forward ports `3000`, `3002`, `4000`, `8080`, `9099` and `9199` to the same local port numbers. Restart the API after backend edits; Vite reloads frontend edits automatically. Reseeding resets named test fixtures.

## Build And Test

```bash
npm test
npm run build
node --check server.js
git diff --check
```

## Household Data Migration

Member contact details are stored once in `households`; membership documents keep a `householdId` and personal membership/safety information. A family shares one household. For a junior, the parent or guardian is the household contact and no separate emergency contact is saved; adult-led households keep the external emergency contact there.

Before migrating existing data, take a Firestore export. Run `node scripts/migrate-schema.js` for a dry run, inspect the household groups and counts, then run `node scripts/migrate-schema.js --apply` to create household documents and remove contact/checkout fields from member records. The migration is repeatable and stops if an under-18 record cannot be linked to complete parent/guardian details, so correct those records and rerun it. The JustGo sync also creates household records for new imports; under-18 imports without complete parent/guardian details are skipped and logged for staff follow-up.

Stop manually running emulators before this isolated API/Storage smoke test:

```bash
set -a; source .env.emulator; set +a
unset NODE_ENV
npx --yes firebase-tools@14.22.0 emulators:exec --only auth,firestore,storage --project demo-fcc "node scripts/seed-emulators.js && node scripts/test-emulators.js"
```

The smoke test mocks Stripe; it does not contact Stripe or production Firebase.

## Checkout Flow Test

With the emulators running and `.env.emulator` loaded, seed them, start the API with Stripe mocked, then run the flow test from another terminal. It places orders through the API, confirms payment with a signed webhook, and checks memberships, households, customers, vouchers, discount codes, receipts and admin reports. The voucher scenario purchases a course-place voucher and redeems it against a five-day course before checking that it cannot be reused.

```bash
set -a; source .env.emulator; set +a
node scripts/seed-emulators.js
WEBSITE_ISLIVE=true STRIPE_SUBSCRIPTION_ADMIN_KEY=sk_test_local_admin PORT=3010 STRIPE_SECRET_KEY=sk_test_local_fixture STRIPE_WEBHOOK_SECRET=whsec_local_only node --import ./scripts/mock-stripe.mjs server.js
```

The test API needs `WEBSITE_ISLIVE=true` (the flow test checks policy versions) and a Stripe write key (the GDPR erasure test cancels a subscription).

```bash
set -a; source .env.emulator; set +a
node scripts/test-checkout-flow.js
```

Use a different `TEST_API_PORT` if you change `PORT`. The test adds records with unique `@example.test` emails and does not remove them.

## Stripe Webhook Test

For a real sandbox checkout, run the local stack above and forward webhooks:

```bash
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.payment_failed --forward-to localhost:3002/api/stripe/webhook
```

For a Dashboard webhook endpoint, subscribe to those same five events. The `reporting.*` events are unrelated to checkout and are not needed. One endpoint handles all of these events; its signing secret is specific to that endpoint and mode, so use the test secret for sandbox and the live secret only for a live deployment.

`PUBLIC_SITE_URL` is the canonical frontend origin. If the same API serves other approved frontend domains, list their origins in `PUBLIC_SITE_URLS` separated by commas. Stripe returns and receipt links use the checkout origin only when it is on this allowlist; other origins fall back to the canonical site.

In the API terminal, set `STRIPE_SECRET_KEY` to a test key and `STRIPE_WEBHOOK_SECRET` to the CLI's signing secret, then restart the API. Use card `4242 4242 4242 4242`, a future expiry and any CVC. Failed attempts remain retryable; expired sessions retain their saved order contents, and the basket is cleared only after the webhook confirms payment. Cancel sandbox subscriptions after testing. Do not send secrets through chat or commit them.

## Live Mode (`WEBSITE_ISLIVE`)

`WEBSITE_ISLIVE` tells the API whether the site holds real customers' data. It defaults to false. Set it with the `WEBSITE_ISLIVE` GitHub secret (the deploy workflow passes it to Cloud Run) and locally in `.env`.

| | `false` (testing) | `true` (live) |
| --- | --- | --- |
| Consent and policy wording | Not versioned. Each member's consent record shows `pre-live` instead of a version. | Every wording change is recorded as the next numbered version in `policyVersions` (checked when the API starts and hourly, so a change published by a release is picked up). Each member's consent record stores the policy name, version, date and whether they or a guardian agreed. |
| Start-up | Logs that wording is not versioned. | Logs a warning for anything missing: `AUDIT_LOOKUP_SECRET`, or no recorded wording for the privacy notice, data retention policy, first aid and safety statement or participation disclaimer. Checkout is not blocked. |
| Records | Test data; free to delete. | Records are kept. Orders, members, policy versions and audit entries are never deleted by the application except through the two audited routes below. |

When live, personal data can only leave through:

1. **Admin delete** (Reports page). The record is removed, and the back-end audit entry keeps a full hidden copy so a mistaken delete can be recovered, plus a masked summary.
2. **GDPR erasure** (member register). Removes the person everywhere, keeps orders for the accounts without their details, cancels their Stripe subscriptions, and leaves only a masked audit entry. It also purges the hidden copies from earlier admin deletes. It cannot be undone.

Policy versions and audit entries have no delete route.

The wording the club must be able to prove it showed (disclaimer, photo and video consent, privacy notice, retention policy, first aid and safety) is defined in `src/utils/policies.js`. Wording that lives on a website page can be added there with a `page` and `field`, and a change made in the page editor is versioned after the next release. The public kayaking policies are rolling public documents and are not versioned here.

Before switching to live:

- Write and publish the privacy notice, data retention policy and first aid and safety statement, and confirm the disclaimer and photo consent wording.
- Set `AUDIT_LOOKUP_SECRET` (a long random value kept in Secret Manager; losing it breaks erasure lookups of earlier deletions).
- Decide retention periods and long-term statistics together (see `TODO.md`), and finish the outstanding items in the security review there, including analytics consent.
- Refunds still remove the order record until refunds are recorded as a status (see `TODO.md`); do not refund by deleting once live.
- Replace the Stripe test keys with live ones; checkout currently refuses anything but test keys.

## Basic Debugging

- Orders fail: start the API and Firestore, not only Vite. Check `curl --fail http://localhost:3002/health`.
- Payment stays pending: check Stripe CLI delivery and the API signing secret. Stripe and Firebase emulators are separate services.
- API returns HTML: check `VITE_API_BASE_URL` and restart Vite.
- Admin denied: reseed the local admin, then sign out/in. Real accounts need the Firebase `admin: true` claim.
- Image upload fails: check Storage emulator/rules and port `9199`.
- Stripe subscribers unavailable: reporting and live subscription validation need a server-only `STRIPE_REPORT_SECRET_KEY` with read access in the matching Stripe mode; local Stripe is not emulated. Use test mode only.
- Port occupied: choose another frontend port and update `PUBLIC_SITE_URL`.

For configured cloud services instead of emulators, copy [.env.example](.env.example) to an ignored `.env`, use a test project, and set `VITE_API_BASE_URL` to your API URL. See [DEPLOYMENT.md](DEPLOYMENT.md) for releases.