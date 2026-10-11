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

Stop manually running emulators before this isolated API/Storage smoke test:

```bash
set -a; source .env.emulator; set +a
unset NODE_ENV
npx --yes firebase-tools@14.22.0 emulators:exec --only auth,firestore,storage --project demo-fcc "node scripts/seed-emulators.js && node scripts/test-emulators.js"
```

The smoke test mocks Stripe; it does not contact Stripe or production Firebase.

## Checkout Flow Test

With the emulators running and `.env.emulator` loaded, seed them, start the API with Stripe mocked, then run the flow test from another terminal. It places orders through the API, confirms payment with a signed webhook, and checks the memberships, customers, vouchers, discount codes, receipts and admin reports it produces.

```bash
set -a; source .env.emulator; set +a
node scripts/seed-emulators.js
PORT=3010 STRIPE_SECRET_KEY=sk_test_local_fixture STRIPE_WEBHOOK_SECRET=whsec_local_only node --import ./scripts/mock-stripe.mjs server.js
```

```bash
set -a; source .env.emulator; set +a
node scripts/test-checkout-flow.js
```

Use a different `TEST_API_PORT` if you change `PORT`. The test adds records with unique `@example.test` emails and does not remove them.

## Stripe Webhook Test

For a real sandbox checkout, run the local stack above and forward webhooks:

```bash
stripe listen --forward-to localhost:3002/api/stripe/webhook
```

In the API terminal, set `STRIPE_SECRET_KEY` to a test key and `STRIPE_WEBHOOK_SECRET` to the CLI's signing secret, then restart the API. Use card `4242 4242 4242 4242`, a future expiry and any CVC. Cancel sandbox subscriptions after testing. Do not send secrets through chat or commit them.

## Basic Debugging

- Orders fail: start the API and Firestore, not only Vite. Check `curl --fail http://localhost:3002/health`.
- Payment stays pending: check Stripe CLI delivery and the API signing secret. Stripe and Firebase emulators are separate services.
- API returns HTML: check `VITE_API_BASE_URL` and restart Vite.
- Admin denied: reseed the local admin, then sign out/in. Real accounts need the Firebase `admin: true` claim.
- Image upload fails: check Storage emulator/rules and port `9199`.
- Stripe subscribers unavailable: reporting needs a server-only `STRIPE_REPORT_SECRET_KEY`; local Stripe is not emulated. Use test mode only.
- Port occupied: choose another frontend port and update `PUBLIC_SITE_URL`.

For configured cloud services instead of emulators, copy [.env.example](.env.example) to an ignored `.env`, use a test project, and set `VITE_API_BASE_URL` to your API URL. See [DEPLOYMENT.md](DEPLOYMENT.md) for releases.