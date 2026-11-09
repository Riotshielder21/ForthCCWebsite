# Development

How to run the site on your own machine and test it. Everything runs against local Firebase emulators with made-up data; no real credentials are needed. For what each part does, see [README.md](README.md); for deployment, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Install

Needs Node 22, Java 21 (for the Firebase emulators) and Python 3.12 (for the JustGo jobs). Run from the repository root in Bash.

```bash
npm ci
cp -n .env.emulator.example .env.emulator
python3 -m venv venv && venv/bin/pip install -r jobs/justgo/requirements.txt
```

The [Stripe CLI](https://docs.stripe.com/stripe-cli) is only needed to try a real Stripe test checkout (below).

## Run Locally

```bash
npm run local
```

This starts the Auth, Firestore and Storage emulators, adds test records on the first run, then starts the API and the website. Ctrl+C stops everything and saves the emulator data to `./emulator-data` for next time. Options (pass through npm as `npm run local -- --fresh`):

| Option | Effect |
| --- | --- |
| `--fresh` | Start empty and add the test records again |
| `--clean` | Start empty with only the local test admin; nothing is saved on exit |
| `--preview` | Serve a production build instead of the Vite dev server |

| Address | What |
| --- | --- |
| `http://localhost:3000` | Website. **Admin** in the footer, then **Sign in as local test admin**. |
| `http://localhost:3002` | API (`/api/...` and `/health` only) |
| `http://localhost:4000` | Emulator UI, to browse and edit the local database |

- **Emails** are not sent. They are written to the `testMail` collection in the emulator database.
- **Changes:** Vite reloads the website; restart the API after changing [server.js](server.js) or [src/server/](src/server/).
- **Remote VS Code:** forward ports `3000`, `3002`, `4000`, `8080`, `9099` and `9199`.
- **Test records** are made-up households, orders, a course and a voucher; `--fresh` resets them.

## Test

Before opening a pull request:

```bash
npm test          # unit tests
npm run build     # production build
```

The emulator integration suite runs the API against fresh emulators with Stripe mocked. It covers checkout, renewals, failed payments, club night, volunteering, refunds, GDPR erasure, data migration and the JustGo jobs. It takes 5–10 minutes. Stop `npm run local` first, as it uses the same ports.

```bash
export PYTHON="$PWD/venv/bin/python"
set -a; source .env.emulator.example; set +a
npx --yes firebase-tools@14.22.0 emulators:exec --only auth,firestore,storage --project demo-fcc 'npm run test:integration'
```

Pull requests run the same three checks on GitHub, plus CodeQL.

To run one integration script while `npm run local` is running, load the emulator settings and run it directly, for example:

```bash
set -a; source .env.emulator; set +a
node scripts/test-club-night.js
venv/bin/python jobs/justgo/test-justgo-sync.py
```

The scripts are listed in [test-local.mjs](scripts/test-local.mjs). The checkout tests need the mocked-Stripe API that the suite starts, so run them through the full suite.

### Real Stripe test mode (optional)

To click through a real Stripe test checkout, forward Stripe's webhooks to the local API:

```bash
stripe listen --forward-to localhost:3002/api/stripe/webhook \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.payment_failed,customer.subscription.deleted,invoice.payment_failed,invoice.paid
```

Then restart the API with a Stripe **test** secret key in `STRIPE_SECRET_KEY` and the signing secret the CLI prints in `STRIPE_WEBHOOK_SECRET`. Pay with card `4242 4242 4242 4242`, any future expiry and any CVC. Cancel any test subscriptions afterwards, and never commit keys.

To test monthly billing over time, [test-stripe-clocks.js](scripts/test-stripe-clocks.js) uses Stripe Test Clocks in a separate Stripe sandbox and cleans up after itself. Put a restricted test key (`STRIPE_SANDBOX_TEST_KEY=rk_test_...`) in a file outside the repository, `chmod 600` it, then:

```bash
node scripts/test-stripe-clocks.js /absolute/path/to/stripe-sandbox.env
```

The key needs write access to test clocks, customers, payment methods, products and subscriptions, and read access to invoices. Set `STRIPE_CLOCK_CASE` to `current-year`, `next-year`, `delayed-payment` or `failed-payment` to run one case.

## When Something Goes Wrong

| Problem | Check |
| --- | --- |
| Orders fail | The API and emulators are running: `curl --fail http://localhost:3002/health` |
| Payment stays pending | `stripe listen` is running and the API has its signing secret |
| API calls return a web page | `VITE_API_BASE_URL` in `.env.emulator`, then restart the website |
| Admin access denied | Run `npm run local -- --fresh`, then sign out and in again |
| Image upload fails | The Storage emulator is on port `9199` |
| A port is in use | Something else is on that port, or an old emulator is still running |
