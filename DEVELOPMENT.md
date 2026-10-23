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

The emulator seed also creates paid example orders for each purchasable starter product, plus family and sibling households, a five-day course, multiple shirt sizes, mixed carts and a voucher. These synthetic records are visible in the Reports page and are only written after the local-emulator guard succeeds.

The admin catalogue, discount product choices and voucher product choices use Up/More paging, showing 7-10 items according to browser height. Check that paging replaces rather than appends items, selections survive paging and resizing, and deleting products on the last page does not leave an empty page. The short vertical transitions respect reduced-motion preferences.

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

The test API needs `WEBSITE_ISLIVE=true` (the flow test checks policy versions) and a Stripe write key (the GDPR erasure test cancels a subscription). The origin and CORS checks expect `PUBLIC_SITE_URL=https://fccwebsite-23cfc.web.app` and `PUBLIC_SITE_URLS=https://staging.example.test` in the API environment.

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

CORS follows the same list: browsers may call the API only from `PUBLIC_SITE_URL`, `PUBLIC_SITE_URLS`, and any extra origins in `CORS_ORIGINS` (comma separated). `http://localhost` and `http://127.0.0.1` origins are also allowed while `WEBSITE_ISLIVE` is false or the emulators are in use. On Cloud Run the API trusts one proxy hop so rate limits apply per visitor; set `TRUST_PROXY_HOPS` if it runs behind a different number of proxies.

The API and Firebase Hosting send `nosniff`, `X-Frame-Options: DENY`, a referrer policy, HSTS and a framing-only Content-Security-Policy. The full script/connect policy is sent as `Content-Security-Policy-Report-Only`; check the browser console for violations before enforcing it. Receipt links (`/order/...`, `/payment-success`, `/api/orders/...`, `/api/checkout-receipt`) are sent with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and the payment success page removes the receipt token from the address bar.

In the API terminal, set `STRIPE_SECRET_KEY` to a test key and `STRIPE_WEBHOOK_SECRET` to the CLI's signing secret, then restart the API. Use card `4242 4242 4242 4242`, a future expiry and any CVC. Failed attempts remain retryable; expired sessions retain their saved order contents, and the basket is cleared only after the webhook confirms payment. Cancel sandbox subscriptions after testing. Do not send secrets through chat or commit them.

Stripe will not take a £0 one-off payment, so when trip discounts or a voucher bring a basket without a monthly subscription to £0, the API completes the order itself with no Stripe session. It is stored as paid with `paymentMethod: 'free'` and a `cs_free_…` reference, the receipt is emailed as usual, and the browser goes straight to the success page, which reads "Booking confirmed".

## Product Pricing

A product's type and pricing follow its category (`productTerms` in `src/utils/catalogue.js`). Saved products are normalised whenever the catalogue is read, so older product documents need no migration. Membership, vouchers, event tickets and merchandise are always fixed-price, one-off purchases. Services choose **Fixed** (full price all year, e.g. key hire), **Prorated 60%** (full price, then 60% from 1 October, when five months of the club year remain, to encourage winter kit hire; e.g. boat hire) or **Prorated monthly** (`pricingMode: 'subscription'`: a monthly price for each month left until 1 March, e.g. a lesson block). Older `yearly-service` products without a pricing mode are read as Prorated 60%, except `keyhire`, which is Fixed. Subscription and prorated-monthly prices are monthly. If **Allow monthly payments** is ticked (the default), the customer can pay monthly through a Stripe subscription; otherwise they pay up front for the months left until 1 March. **20% off when paid up front** is a per-product tick box for these items. The basket shows the monthly/annual toggle only when an item in it allows monthly payments, and each saved order line records `monthly`.

Generated voucher codes store the shop item they were bought from (`sourceProductId`). The admin discount code list shows one summary row per voucher shop item rather than every code; older codes without `sourceProductId` are grouped by the item name they were issued under. Individual codes are on the buyer's record in Reports.

A voucher item's **Edit** button in that list sets what its credit can be spent on (`voucherScope` on the product: categories, products or both; membership is never allowed). With nothing ticked the credit covers everything except membership. Each order line copies the scope at checkout, and the generated code stores it as `categories`/`productIds`, so changes only affect vouchers bought afterwards. Custom discount codes are unchanged.

Events, services and subscriptions also have a **Membership** rule (`membershipRule`, see `productMembershipRule` in `src/utils/catalogue.js`): *Club members only* (`required`, the default), *Open to non-members* (`none`; buyers who are not members are kept as contact-only records outside the member register) or *Club membership included* (`included`). An included product makes each person who is not already an active member an adult or junior member (by age) until 1 March: the order person carries `grantMembership`, and payment writes the same active membership, tier and queued JustGo upload as buying a membership, plus `membershipIncludedWith` (shown in the member register as "Included with …"). Active members pay the same price and keep their membership. Older events saved with `membershipRequired: false` read as `none`; `membershipRequired` is still written for compatibility. Order lines record the rule.

## Monthly Subscriptions

A payer has one Stripe subscription, so one monthly direct debit, for every monthly item they pay for with the same card or bank account, whoever it is for. Our records say which member receives each item, because Stripe only knows the payer.

- **First monthly purchase:** Checkout starts the subscription with every monthly item as a recurring line.
- **Later purchases by the same payer** (matched on email, against their active subscription in `subscriptions`): Checkout runs as a one-off payment that saves the card or bank account. Each monthly item is charged only up to the payer's next monthly payment date, as "(to <date>, then monthly with your other items)". After payment the webhook's `setUpSubscriptions` adds the items to the existing subscription without proration, so they are collected in the same debit from then on.
- **Different card or bank account** (compared by Stripe's payment-method fingerprint): the details may belong to someone else, so the items join whichever of the payer's subscriptions already uses those details, or otherwise get a new subscription on them, billing on the payer's usual date (`subscriptionPlan.newPaymentDetails`). Existing subscriptions and their payment details are never changed.
- **First payment under Stripe's 30p minimum** (the payment date is only hours away): the part-month is not charged. The lines are left off the Stripe page; if nothing else is being bought, the order completes without Stripe and the items are added straight away.
- **Renewal before the items are added** (for example a Bacs payment confirmed after the payment date): the items are added with `create_prorations`, so the rest of the new month is charged on the next debit (`subscriptionPlan.renewedBeforeAdding`).

Stripe calls use idempotency keys, so a replayed webhook changes nothing. If Stripe refuses a change, the order's `subscriptionPlan` is marked `failed` with the error and the order gets `subscriptionSetupNeedsStaff`; staff see which item and member it was on the order.

Records:

- **Order:** `subscriptionPlan` (`new` or `add`, the monthly lines, the target subscription and the first-payment end date) and `stripeSubscriptionIds`. Each monthly line gets `stripeSubscriptionId`/`stripeSubscriptionItemId`, and lines that joined an existing subscription record `firstPayment`/`firstPaymentUntil`. The order `total` is what was charged at checkout.
- **`subscriptions/{id}`:** the payer email, every `orderRefs` that added to it, and its items, each with its order, monthly amount, Stripe item id, status and the `membershipIds`/`names` of who receives it.
- **Customer:** the payer's `subscriptionIds`.
- **Each member who receives an item:** `subscriptionIds` and `subscriptionItems` (subscription, item, monthly amount, `payerEmail` and status), so their record shows what they get and who pays, even when someone else pays. Membership privileges record their order `lineId`.

In Reports, purchases and member records show **Monthly payments**: each subscription with its payer and monthly total, and one row per item with the member, order, amount and status. Staff can:

- **Cancel item:** removes one item.
- **Cancel this member's items** (on a member record): removes everything that member receives.
- **Cancel whole subscription.**

Removals take effect in Stripe straight away with no refund or proration, so the payer's debit drops from the next payment; removing the last active item cancels the subscription. Cancelled items keep their purchase history. Their privilege gets `endedAt` (so it no longer counts for trip discounts or the register's Includes column), the member's `subscriptionItems` entry becomes `cancelled`, and the order line gets `monthlyCancelledAt`. Each cancellation is written to `adminSubscriptionAudit`.

The flow test's Stripe mock (`scripts/mock-stripe.mjs`) keeps subscriptions in memory. Payer emails starting `new-card.` use a different card at every checkout, `renews-soon.` subscriptions renew two minutes after they start, `renewed.` subscriptions renew while a later purchase is paid, and `sub-fail.` makes adding to or creating a later subscription fail. The mock rejects any change to an existing subscription's payment details.

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
- Admin denied: reseed the local admin, then sign out/in. Real accounts need the Firebase `admin: true` claim: the person signs in once at `/admin` with their club Google account, then an existing admin approves them under **Website admins** (or a developer runs `node scripts/grant-admin.js name@forthcanoeclub.co.uk`). Changes are logged in `adminAccessAudit`; removed admins are signed out.
- Image upload fails: check Storage emulator/rules and port `9199`.
- Stripe subscribers unavailable: reporting and live subscription validation need a server-only `STRIPE_REPORT_SECRET_KEY` with read access in the matching Stripe mode; local Stripe is not emulated. Use test mode only.
- Port occupied: choose another frontend port and update `PUBLIC_SITE_URL`.

For configured cloud services instead of emulators, copy [.env.example](.env.example) to an ignored `.env`, use a test project, and set `VITE_API_BASE_URL` to your API URL. See [DEPLOYMENT.md](DEPLOYMENT.md) for releases.
