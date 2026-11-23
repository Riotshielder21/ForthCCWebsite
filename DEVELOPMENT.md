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

In the catalogue editor, the green **Save all** button stays at the top-right of the item tile while scrolling.
It saves every field of the current item, including an event's private attendee-list viewers (also for new events).
Uploading an image and sending an attendee-list email remain explicit actions. If viewer access fails to save,
the editor reports the partial save and lets you retry; it never reports all changes saved until both writes succeed.

## Test

Before opening a pull request:

```bash
npm run lint     # incremental JavaScript correctness and import-boundary baseline
npm test          # unit tests
npm run build     # production build
```

The lint baseline covers the refactored feature modules, browser modules and browser-test tooling rather than
silently claiming the whole repository is lint-clean. Add touched modules to [eslint.config.js](eslint.config.js)
as they are reviewed. It checks JavaScript correctness and browser/shared import boundaries; it is not a type checker.
This remains a JavaScript project, with no repository-wide TypeScript conversion.
The lint scope is deliberate: correctness and import-boundary rules are adopted incrementally instead of rewriting
untouched modules to satisfy a new formatter. Build, unit, browser and emulator checks remain complementary.

The unit runner discovers `.test.js` files recursively under [src/](src/), including nested browser/shared modules.
Keep unit tests beside their module; browser scenarios live separately in [tests/browser/](tests/browser/).
Use `node --test path/to/module.test.js` for a focused run.

Browser regression tests use Chromium and mocked API responses, with external network requests blocked or fulfilled
by synthetic Firebase authentication fixtures:

```bash
npx playwright install chromium
npm run test:browser
```

They exercise same-tab content freshness, the shop offering only this visit's products and pausing buying offline,
clearing consent ticks after wording changes, and admin reports using fresh tokens while requiring expired tokens to
refresh successfully.
Ordinary admin API requests should use `getIdToken()` so Firebase reuses valid tokens and refreshes only when needed;
reserve forced refreshes for explicitly rechecking changed claims or retrying session verification.
Playwright builds with test configuration, then starts and stops a production preview on port
4175. Service workers are blocked in these scenarios; their offline behavior has separate unit coverage.
CI runs the browser job separately and uploads traces on failure; no production credentials or emulators are needed.

The emulator integration suite runs the API against fresh emulators with Stripe mocked. It covers checkout, renewals, failed payments, club night, volunteering, refunds, GDPR erasure and the JustGo jobs. It takes 5–10 minutes. Stop `npm run local` first, as it uses the same ports.

```bash
export PYTHON="$PWD/venv/bin/python"
set -a; source .env.emulator.example; set +a
npx --yes firebase-tools@14.22.0 emulators:exec --only auth,firestore,storage --project demo-fcc 'npm run test:integration'
```

Pull requests run lint, unit tests, production build, server syntax, emulator integration and browser regressions,
plus CodeQL.

### Production-code boundaries

Keep HTTP feature handlers in [src/server/](src/server/) and register them from [server.js](server.js).
For example, [pagePublishing.js](src/server/pagePublishing.js) owns the saved-draft, page-save and review-request
routes; Workspace notification delivery remains in the server wiring. Shared validation and normalization stay
independent of Express and React, so the browser and API can use the same rules.

Prefer descriptive names, explicit validation steps and small helpers for repeated domain operations. Keep related
decisions together rather than introducing a generic abstraction or moving files only to reduce line counts.
Unit tests remain beside their production modules.

Live consent publication saves the statement and its numbered policy history in one Firestore transaction.
Policy sync must read consent wording inside its transaction too, so a release cannot version a stale copy during
an admin edit. Keep transaction reads before writes, and fetch wording and policy together with `transaction.getAll`
in both paths to avoid a second read on a transaction that contention has already aborted.
Checkout, guest check-in and photo-consent updates use `loadCheckoutConsent` to validate the wording and retain
the versions from the same read-only transaction snapshot. Do not fetch a newer version after validating older wording.

Public page JSON is fetched on each visit. Only in-flight requests are shared; do not retain completed promises
in the application. The service worker handles offline fallback after network failure or a four-second timeout.
Pages do not poll for edits while someone is reading them.

Browser state and effects belong in [src/browser/](src/browser/), starting with catalogue refresh and consent wording.
Keep that code out of server modules and keep shared rules free of React, storage and network side effects.
The existing consent-client utility re-exports its browser implementation for compatibility while call sites migrate.
The shop shows only products loaded from the database on this visit, never the starter list in
[products.js](src/constants/products.js) or an earlier visit's copy. Buying is paused while offline or when the latest
availability check failed, with a retry action. The starter list is only copied into an empty or incomplete catalogue,
by **Add missing starter products** in admin, which never changes existing records. Consent refresh failures retain the
displayed wording but show a retry action; a wording save whose follow-up refresh fails explicitly reports that the
save succeeded and the displayed copy is stale.

### Public pages and missing links

The build writes a metadata-specific HTML shell for each public route, plus `404.html` and `sitemap.xml`.
[routes.js](src/utils/routes.js) is the public-route source; update [public/sitemap.xml](public/sitemap.xml)
when adding a route (tests check that the lists match). Titles and descriptions are in
[pageMetadata.js](src/utils/pageMetadata.js). Firebase Hosting serves unknown URLs with the 404 shell
and HTTP 404; only private app routes and editor previews rewrite to the shared shell.

Check a production preview for page layout and reload recovery. To verify HTTP status codes and
direct links, use the Firebase Hosting emulator, not Vite's SPA fallback. Check an unknown path,
`/membership`, `/my-details`, and `/order/test` after refreshing each.
The missing-page illustration is an original club SVG in [public/images/missing-kayak.svg](public/images/missing-kayak.svg).

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

To test subscription billing over time (monthly and yearly, carrying on past 1 March, and the year-end stop from the continue/cancel email), [test-stripe-clocks.js](scripts/test-stripe-clocks.js) uses Stripe Test Clocks in a separate Stripe sandbox and cleans up after itself. Put a restricted test key (`STRIPE_SANDBOX_TEST_KEY=rk_test_...`) in a file outside the repository, `chmod 600` it, then:

```bash
node scripts/test-stripe-clocks.js /absolute/path/to/stripe-sandbox.env
```

The key needs write access to test clocks, customers, payment methods, products and subscriptions, and read access to invoices. Set `STRIPE_CLOCK_CASE` to `current-year`, `next-year`, `yearly`, `delayed-payment`, `year-end-cancel` or `failed-payment` to run one case.

### Committee and Stripe acceptance

The remaining checks for issues #41–#62 belong in [launch acceptance #138](https://github.com/Riotshielder21/ForthCCWebsite/issues/138) and [committee decisions #128](https://github.com/Riotshielder21/ForthCCWebsite/issues/128). The checks below require **Stripe sandbox/test mode**, made-up people and a test mailbox; never use a real member or real bank account. Test clocks simulate card billing, not Bacs settlement.

1. In Stripe's test Dashboard, disable customer trial-ending reminder emails for the club subscriptions. Keep other payment-failure notifications as agreed.
2. Forward actual sandbox webhooks with the `stripe listen` command above, restart the local API with the sandbox key, and use the real website checkout (not `stripe trigger`, which produces unrelated fixture events). Choose Bacs with Stripe's current documented Bacs test account details. Confirm the mandate appears and the order stays pending until the asynchronous payment succeeds, then becomes paid exactly once and grants the right items. Repeat with Stripe's documented failure account: no membership should be granted, and retry/cancel should work.
3. Use two made-up people sharing one monthly subscription. In Reports, schedule one item's removal as a volunteer benefit, then cancel/revoke that same item. Inspect the **actual Stripe schedule phases**: the removed price must not occur in any current/future phase, the other person's price must remain (the schedule then releases the subscription, which carries on), and no unwanted proration or new charge should appear. Cancel test subscriptions afterwards.
4. Submit GDPR erasure for a synthetic Stripe customer with no remaining payer obligations: billing stops, current identifying fields are redacted, and deletion completes. Repeat for one person sharing billing: only that person's item ends, while the other person's payments and payment method remain. The existing isolated GDPR script covers a failed-delete retry; verifying a real permission failure needs a deliberately restricted test key and must not be done to a live customer. Record any Stripe historical invoices/mandates that need separate retention review.
5. A genuinely live Bacs payment, settlement and refund is a separate controlled launch check requiring explicit agreement on the payer, amount and refund. Sandbox results do not prove bank settlement in live mode.

Record results without keys, bank information, names, emails or complete Stripe objects. Include which checks passed, the time, and any failure to reproduce. For an isolated item-action test, start separate empty emulators with a demo project and set `FCC_TEST_PROJECT` to that same project. Merely changing the variable against existing single-project emulators does not isolate data or authentication.

### Boathouse check-in poster

Generate an A4 PDF using the **deployed public website origin**, not localhost:

```bash
node scripts/export-checkin-poster.js https://new.forthcanoeclub.co.uk /tmp/check-in-poster.pdf
```

The command refuses to overwrite an existing file. Scan the printed QR code and confirm it opens `/check-ins`, then display it at the boathouse. Configure the agreed weekly sessions in the admin check-in sessions editor; the poster does not create sessions or grant access.

### Dependency status

For #51, the installed tree now resolves `body-parser` 1.20.9, `qs` 6.16.2 and `ip-address` 10.7.6. The original patch-waiting task is superseded; `npm audit` still reports a separate low-severity transitive XML-parser advisory with no available fix. Continue dependency monitoring. Compressed JSON remains deliberately unsupported by the API and is tested; installing patched packages does not require changing that API behaviour.

## When Something Goes Wrong

| Problem | Check |
| --- | --- |
| Orders fail | The API and emulators are running: `curl --fail http://localhost:3002/health` |
| Payment stays pending | `stripe listen` is running and the API has its signing secret |
| API calls return a web page | `VITE_API_BASE_URL` in `.env.emulator`, then restart the website |
| Admin access denied | Run `npm run local -- --fresh`, then sign out and in again |
| Image upload fails | The Storage emulator is on port `9199` |
| A port is in use | Something else is on that port, or an old emulator is still running |
