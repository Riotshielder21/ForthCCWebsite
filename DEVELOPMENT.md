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

Receipt emails store both `body` (plain text) and `html` in `testMail`. Live messages use UTF-8 `multipart/alternative`, so mail clients display one version, not both. Subjects contain the order reference. New event orders snapshot the catalogue image URL; the HTML version displays absolute HTTPS images, while older orders and clients that block images still have all purchase details in text. Website receipts and HTML emails use the club's navy-and-white itemized layout, with assigned names on each item. Saved receipt links expose those names but not member contact details, dates of birth or other submitted answers; treat the link as private. Items without a recorded person assignment are labelled as unassigned, rather than guessing a name. Admins choose extra submitted person details (date of birth, phone, address, guardian, emergency contact, medical and so on) for the confirmation email under **Admin → Receipt email details**; the choice is stored in `settings/receiptEmail`, is off by default, and only affects emails sent afterwards. Those details are never added to the receipt link or the payment success page.

The application does not append an organisation/legal footer or fetch a Gmail signature. If delivered mail has a duplicated or unformatted organisation footer, check Google Workspace Gmail **Append footer** rules, including inherited rules. Configure it once there and check both HTML and plain-text delivery; do not duplicate it in the receipt template.

In remote VS Code, forward ports `3000`, `3002`, `4000`, `8080`, `9099` and `9199` to the same local port numbers. Restart the API after backend edits; Vite reloads frontend edits automatically. Reseeding resets named test fixtures.

The emulator seed also creates paid example orders for each purchasable starter product, plus family and sibling households, a five-day course, multiple shirt sizes, mixed carts and a voucher. These synthetic records are visible in the Reports page and are only written after the local-emulator guard succeeds.

For mobile layout checks, use portrait viewports of 390x844, 360x640 and 320x568, plus landscape at 667x375 and 844x390. A short page (such as an unavailable receipt) should leave no gap below the footer. In a long basket, only the item list should scroll: the heading, billing controls, discount entry, errors, totals and Checkout button stay visible. Check both billing modes with a discount error and a checkout rejection, and confirm closing the basket restores page scrolling. Short landscape screens place the summary beside the item list.

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
RENEWAL_JOB_TOKEN=local-renewal-job-token-0123456789abcdef PUBLIC_SITE_URL=https://fccwebsite-23cfc.web.app PUBLIC_SITE_URLS=https://staging.example.test WEBSITE_ISLIVE=true STRIPE_SUBSCRIPTION_ADMIN_KEY=sk_test_local_admin PORT=3010 STRIPE_SECRET_KEY=sk_test_local_fixture STRIPE_WEBHOOK_SECRET=whsec_local_only node --import ./scripts/mock-stripe.mjs server.js
```

The test API needs `WEBSITE_ISLIVE=true` (the flow test checks policy versions) and a Stripe write key (the GDPR erasure test cancels a subscription). The origin, CORS and renewal-link checks expect the `PUBLIC_SITE_URL` and `PUBLIC_SITE_URLS` shown, and the renewal test needs the same `RENEWAL_JOB_TOKEN` in the API and test environments.

```bash
set -a; source .env.emulator; set +a
RENEWAL_JOB_TOKEN=local-renewal-job-token-0123456789abcdef node scripts/test-checkout-flow.js
```

Use a different `TEST_API_PORT` if you change `PORT`. The test adds records with unique `@example.test` emails and does not remove them.

## Stripe Webhook Test

For a real sandbox checkout, run the local stack above and forward webhooks:

```bash
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.payment_failed,customer.subscription.deleted --forward-to localhost:3002/api/stripe/webhook
```

For a Dashboard webhook endpoint, subscribe to those same six events. The `reporting.*` events are unrelated to checkout and are not needed. One endpoint handles all of these events; its signing secret is specific to that endpoint and mode, so use the test secret for sandbox and the live secret only for a live deployment.

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

## Club Years

The club year runs from 1 March and is named by the year it starts (1 March 2027 – 28/29 February 2028 is **2027**). Dates and sale windows are in `src/utils/clubYear.js` and use London time.

- **Sale windows:** before 1 January only this club year is sold. From 1 January the basket asks, for each membership, service and subscription, whether it is for **this club year**, **next club year** or **both** (`clubYearChoice` on each basket line; `both` is one line that the server splits into this year's line and a next-year line). This year's membership stops on 8 February and everything else for this year on 15 February; after that only next year is offered. Events, merchandise and vouchers have no club year.
- **Records:** order lines and privileges record `clubYear`, and members record every club year they hold in `clubYears` (for example `[2027, 2028]` for someone who renewed early), with `validUntil` the end of the latest. Older privileges without `clubYear` use the year they were granted. A member who holds only next year is not covered for this year, except that from 8 February a next-year membership also covers the rest of this year.
- A held service or subscription cannot be bought again for the same club year (`already_held`), and an active member cannot buy a membership for a year they already hold (`membership_active`).

## Monthly Subscriptions

Every direct debit is on the 1st of the month and everything monthly ends with the club year. Checkout never creates subscriptions itself: it takes what is due now, saves the card or bank account, and the webhook creates or extends the subscriptions afterwards (`setUpSubscriptions` in `server.js`).

- **Checkout** charges annual and one-off items in full plus a **joining-month charge** for each monthly item: the share of the current month still to run, rounded up to the next 20% (`joiningShare`). The Checkout session is in `payment` mode with `setup_future_usage=off_session`. When nothing is due now (only next-year monthly items), it runs in `setup` mode and the order records `stripeSetupIntentId` instead of a payment intent.
- **One subscription per payer per club year per card or bank account.** The order's `subscriptionPlan.groups` has one group per club year with its `firstDebitAt` and `cutoffAt`. The webhook adds the group's items to the payer's live subscription for that club year when it uses the same payment details (compared by Stripe's fingerprint), otherwise creates a new one (`newPaymentDetails` when another live one exists). Existing subscriptions' payment details are never changed.
- **New subscriptions** wait until their first 1st (`trial_end`, which Stripe shows as *trialing*) with `cancel_at` set to the cut-off and no proration. If the first 1st has already passed (a delayed bank payment), the subscription is backdated to it (`backdate_start_date`, `billing_cycle_anchor` the next 1st, `create_prorations`) so the missed month is charged, then `cancel_at` is set. Stripe metadata records `club_year` and `cutoff_at`; only subscriptions with `club_year` count as *trialing = live*.
- **This year's monthly items** are first debited on the next 1st. Bought from 1 to 14 February, the joining-month charge is the only payment and no subscription is made. **Next year's** monthly items are first debited on 1 March.
- **February cut-off:** the last debit is 1 February and every subscription stops at the start of 15 February (`cancel_at`, no proration), so a failed 1 February debit is retried only until then. Cover runs to 1 March in our records. When Stripe sends `customer.subscription.deleted`, the `subscriptions` record becomes `ended`, any invoice still open is voided (`voidedInvoices`), and the record is flagged `needsStaff` if money was left unpaid or the subscription ended before its cut-off (`endedAtCutoff: false`).

Stripe calls use idempotency keys, so a replayed webhook changes nothing. If Stripe refuses a change, the order's `subscriptionPlan` is marked `failed` with the error and the order gets `subscriptionSetupNeedsStaff`; staff see which item and member it was on the order.

Stripe settings to check in the Dashboard (test mode first): turn off Stripe's trial-ending reminder emails (new subscriptions are *trialing* until their first 1st), and confirm that cancellation at the cut-off stops retries and creates no credit or 1 March invoice.

Records:

- **Order:** `subscriptionPlan` (`status`, the monthly `lineIds`, and the `groups` with their club year, first debit, cut-off and resulting `stripeSubscriptionId`) and `stripeSubscriptionIds`. The order `total` is what was charged at checkout.
- **`subscriptions/{id}`:** the payer email, `clubYear`, `firstDebitAt`, `cancelAt`, every `orderRefs` that added to it, and its items, each with its order, club year, monthly amount, Stripe item id, status and the `membershipIds`/`names` of who receives it.
- **Customer:** the payer's `subscriptionIds`.
- **Each member who receives an item:** `subscriptionIds` and `subscriptionItems` (subscription, item, club year, monthly amount, `payerEmail` and status), so their record shows what they get and who pays, even when someone else pays. Membership privileges record their order `lineId`.

In Reports, purchases and member records show **Monthly payments**: each subscription with its payer and monthly total, and one row per item with the member, order, amount and status. Staff can:

- **Cancel item:** removes one item.
- **Cancel this member's items** (on a member record): removes everything that member receives.
- **Cancel whole subscription.**

Removals take effect in Stripe straight away with no refund or proration, so the payer's debit drops from the next payment; removing the last active item cancels the subscription. Cancelled items keep their purchase history. Their privilege gets `endedAt` (so it no longer counts for trip discounts or the register's Includes column), the member's `subscriptionItems` entry becomes `cancelled`, and the order line gets `monthlyCancelledAt`. Each cancellation is written to `adminSubscriptionAudit`.

The flow test's Stripe mock (`scripts/mock-stripe.mjs`) keeps subscriptions in memory and checks the parameters above (trial or backdate, `cancel_at`, proration, club-year metadata). Payer emails starting `new-card.` use a different card at every checkout, `sub-fail.` makes creating a subscription fail, and `unpaid-feb.` gives the subscription an open invoice. The mock rejects any change to an existing subscription's payment details.

When the API runs against the emulators, a request header `X-Test-Now: <ISO date>` makes checkout, renewal and job routes act as if it were that time, so the flow test can check January, February and autumn rules on any day. It is ignored otherwise. Subscription setup in the webhook always uses the real time.

## Renewal Emails

Website members whose membership ends this club year get one renewal email per contact address (the household email, so a family gets one email). JustGo members renew through JustGo and are not emailed, nor are contact-only records. The email lists the basket and links to `/membership?renew=<token>`, which fills the basket with next year's membership (one family membership for a family) and the services and subscriptions each person holds this club year that are still sold, with monthly billing if they pay monthly now. They can remove or add items before paying. Logic is in `src/utils/renewals.js` and the routes in `src/server/renewals.js`.

- **Sending:** staff can send from 1 January (Admin → Reports & records → **Renewal emails**, or **Send renewal email** on a member in Reports, which also resends). The scheduled job sends twice: on 1 February to everyone not yet emailed, and a reminder on 15 February to everyone not yet reminded. Members record `renewalInviteSentFor` and `renewalReminderSentFor` (club years), so rerunning a round emails nobody twice. Anyone already holding next year's membership (in `clubYears` or covered past 1 March) is never emailed, even if they did not renew their extras.
- **Links:** a random token whose SHA-256 is the `renewalInvites` document id (with the email, renewal year and `membershipIds`). Links expire after 31 March. The basket is worked out when the link is opened, so members who have since renewed are left out, and the token is removed from the address bar. GDPR erasure deletes invites that name an erased member.
- **Scheduled job:** `config/fcc-renewals.service` and `.timer` run at 09:00 London on 1 and 15 February (a missed run catches up when the server starts) and `POST` to `/api/jobs/renewals` with `Authorization: Bearer $RENEWAL_JOB_TOKEN`. Set `RENEWAL_JOB_TOKEN` (at least 32 random characters) in the API environment and, with `RENEWAL_JOB_URL` (the API's `/api/jobs/renewals` URL), in the server's `.env`. Outside 1 February to 1 March the job does nothing; from 15 February it sends the reminder round.
- **Testing locally:** the emulator seed adds the `TEST-HH-RENEWAL` household (`renewal@example.test`): a website family whose cover ends this club year, with Boathouse Access held by the parent. Start the API with `PUBLIC_SITE_URL` set to the Vite address so links point at it. Renewals open on 1 January, so as the local test admin send with the `X-Test-Now` header (honoured only with local emulators), e.g. `POST /api/admin/renewals/send` with body `{"membershipId":"test-renewal-parent"}` and `X-Test-Now: 2027-01-05T12:00:00Z`. The email, with its link, is in `testMail` (`kind: renewal`). Opening the link before 1 January still fills the basket, but checkout for next year is refused until then. Reseeding clears the sent flag.

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
