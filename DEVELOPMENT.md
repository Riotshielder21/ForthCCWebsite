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

The application does not append an organisation/legal footer or fetch a Gmail signature. Sign-in and contact-email confirmation codes include both HTML and plain-text alternatives, like receipts, so HTML-capable clients can display Workspace's formatted footer rather than its plain-text conversion (which can repeat link URLs). If delivered mail still has a duplicated or unformatted organisation footer, check Google Workspace Gmail **Append footer** rules, including inherited rules. Configure it once there and check both HTML and plain-text delivery; do not duplicate it in email templates.

In remote VS Code, forward ports `3000`, `3002`, `4000`, `8080`, `9099` and `9199` to the same local port numbers. Restart the API after backend edits; Vite reloads frontend edits automatically. Reseeding resets named test fixtures.

The emulator seed also creates paid example orders for each purchasable starter product, plus family and sibling households, a five-day course, multiple shirt sizes, mixed carts and a voucher. These synthetic records are visible in the Reports page and are only written after the local-emulator guard succeeds.

For mobile layout checks, use portrait viewports of 390x844, 360x640 and 320x568, plus landscape at 667x375 and 844x390. A short page (such as an unavailable receipt) should leave no gap below the footer. In a long basket, only the item list should scroll: the heading, billing controls, discount entry, errors, totals and Checkout button stay visible. Check both billing modes with a discount error and a checkout rejection, and confirm closing the basket restores page scrolling. Short landscape screens place the summary beside the item list.

The admin catalogue, discount product choices, voucher product choices and combined current-code/voucher table use Up/More paging, showing 7-10 items according to browser height. Disabled discount codes are hidden by default; **Show disabled codes** includes them and resets the table to its first page. Check that paging replaces rather than appends items, selections survive paging and resizing, and deleting products or disabling codes on the last page does not leave an empty page. The short vertical transitions respect reduced-motion preferences. Shared checkout and contact-form grids bottom-align their fields within each row so wrapped labels have room above the inputs.

## Build And Test

```bash
npm test
npm run build
node --check server.js
git diff --check
```

## Google sign-in domain

The domain in Google's "to continue to" prompt comes from Firebase's `authDomain`, not the Workspace `hd` account hint. Use `new.forthcanoeclub.co.uk`: it is served by this project's Firebase Hosting, so `https://new.forthcanoeclub.co.uk/__/auth/handler` already serves Firebase's auth helper (checked 28 October 2026). The bare `forthcanoeclub.co.uk` is hosted elsewhere and returns 404 for that path, so it cannot be used unless it moves to Firebase Hosting or proxies `/__/auth/**`.

1. Confirm `new.forthcanoeclub.co.uk` is in Firebase Authentication's authorised domains.
2. In Google Cloud's OAuth web client used by Firebase's Google provider, add `https://new.forthcanoeclub.co.uk/__/auth/handler` as an authorised redirect URI. Keep the existing `firebaseapp.com` redirect URI.
3. Set the GitHub Actions repository **variable** `VITE_FIREBASE_AUTH_DOMAIN` to `new.forthcanoeclub.co.uk`, then rebuild/deploy. The workflow prefers this variable over the existing secret. For local builds, set the same value in your environment; leave emulator configuration unchanged.
4. Test Google popup sign-in, confirm the prompt says `new.forthcanoeclub.co.uk`, then sign out and back in. Removing the repository variable restores the secret's domain on the next deployment.

Do not switch the build before the handler and OAuth configuration are ready: it would break admin sign-in. See [Firebase's custom redirect domain instructions](https://firebase.google.com/docs/auth/web/google-signin#customizing-the-redirect-domain-for-google-sign-in).

## Crawlers and scraping

- `public/robots.txt` allows normal search engines on public pages, excludes private/admin routes, and asks named AI and bulk-data crawlers not to crawl any pages. Vite copies it into the build; Firebase Hosting serves it at `/robots.txt`.
- Firebase Hosting sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` on private/admin routes. The API sends the same header on `/api` responses and serves its own disallow-all `/robots.txt` for the Cloud Run hostname.
- These are voluntary instructions, not protection for personal data. Blocked URLs can still appear in search results without snippets; crawlers must fetch a page to see its `noindex` header. Keep authentication, private receipt links and database rules in place.
- Existing API rate limits reduce repeated requests per IP, but are per server instance and do not protect Firebase's static pages. Enforced bot filtering/challenges need an edge service (for example Cloudflare); Cloud Armor needs a supported load balancer and restricted direct-origin access. Do not blanket-challenge API routes or Stripe webhooks. User-agent blocking alone is easily spoofed.
- After deployment, check `/robots.txt` on both the public site and the API hostname, and check `X-Robots-Tag` on `/my-details`, `/admin/reports`, `/order/example` and an API response. Public `/` must not have `noindex`.

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

To check the FCC-domain admin restriction without seeding data, run `node scripts/test-admin-domain.js` with the local emulator environment loaded. It checks approval, API access, Firestore product writes and both Storage upload paths, including non-club accounts carrying an admin claim. The synthetic users and test data are removed afterwards.

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

## Real Stripe Test Clocks

Unlike the mocked checkout flow, this calls Stripe's real sandbox using the same subscription-creation function as the API. It does not exercise Checkout, webhook delivery, Firebase membership updates, Bacs mandates or renewal emails.

Save a restricted sandbox key outside the repository, either alone or as `STRIPE_SANDBOX_TEST_KEY=rk_test_...`, and protect the file with `chmod 600`. It needs test-clock, customer, payment-method, product and subscription write access, plus invoice read access. Use a dedicated sandbox: its billing settings and webhook endpoints affect the results.

```bash
node scripts/test-stripe-clocks.js /absolute/path/to/stripe-sandbox.env
```

The script creates synthetic clock-bound customers, advances through deferred starts and year-end cancellation, checks exact invoice amounts and retries, and tests one delayed-payment catch-up. It deletes only this run's clocks/customers/subscriptions and archives its products, including after failures; Stripe's inline prices cannot be edited. It never reads real member data. To repeat one case, set `STRIPE_CLOCK_CASE=current-year`, `next-year`, `delayed-payment` or `failed-payment`.

Subscriptions now end at 1 March so the final 1 February debit covers a full February billing period. The test clock asserts three full payments for a November start, twelve full payments for a January next-year renewal, one full catch-up payment for delayed setup, and no March debit. This is card-based Stripe evidence, not proof of Bacs timing or end-to-end membership activation.

## Stripe Webhook Test

For a real sandbox checkout, run the local stack above and forward webhooks:

```bash
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,payment_intent.payment_failed,customer.subscription.deleted --forward-to localhost:3002/api/stripe/webhook
```

For a Dashboard webhook endpoint, subscribe to those same six events. The `reporting.*` events are unrelated to checkout and are not needed. One endpoint handles all of these events; its signing secret is specific to that endpoint and mode, so use the test secret for sandbox and the live secret only for a live deployment.

`PUBLIC_SITE_URL` is the canonical frontend origin. If the same API serves other approved frontend domains, list their origins in `PUBLIC_SITE_URLS` separated by commas. Stripe returns and receipt links use the checkout origin only when it is on this allowlist; other origins fall back to the canonical site.

CORS follows the same list: browsers may call the API only from `PUBLIC_SITE_URL`, `PUBLIC_SITE_URLS`, and any extra origins in `CORS_ORIGINS` (comma separated). `http://localhost` and `http://127.0.0.1` origins are also allowed while `WEBSITE_ISLIVE` is false or the emulators are in use. On Cloud Run the API trusts one proxy hop so rate limits apply per visitor; set `TRUST_PROXY_HOPS` if it runs behind a different number of proxies. Every request other than static files counts towards a per-visitor ceiling (300 a minute, or `BASELINE_RATE_LIMIT`), and each route adds its own tighter per-path limit through `rateLimit` in `src/server/rateLimit.js`; new routes should use that helper.

The API and Firebase Hosting send `nosniff`, `X-Frame-Options: DENY`, a referrer policy, HSTS and a framing-only Content-Security-Policy. The full script/connect policy is sent as `Content-Security-Policy-Report-Only`; check the browser console for violations before enforcing it. Receipt links (`/order/...`, `/payment-success`, `/api/orders/...`, `/api/checkout-receipt`) are sent with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and the payment success page removes the receipt token from the address bar.

In the API terminal, set `STRIPE_SECRET_KEY` to a test key and `STRIPE_WEBHOOK_SECRET` to the CLI's signing secret, then restart the API. Use card `4242 4242 4242 4242`, a future expiry and any CVC. Failed attempts remain retryable; expired sessions retain their saved order contents, and the basket is cleared only after the webhook confirms payment. Cancel sandbox subscriptions after testing. Do not send secrets through chat or commit them.

Stripe will not take a £0 one-off payment, so when trip discounts or a voucher bring a basket without a monthly subscription to £0, the API completes the order itself with no Stripe session. It is stored as paid with `paymentMethod: 'free'` and a `cs_free_…` reference, the receipt is emailed as usual, and the browser goes straight to the success page, which reads "Booking confirmed".

## Product Pricing

A product's type and pricing follow its category (`productTerms` in `src/utils/catalogue.js`). Saved products are normalised whenever the catalogue is read, so older product documents need no migration. Membership, vouchers, event tickets and merchandise are always fixed-price, one-off purchases. Services choose **Fixed** (full price all year, e.g. key hire), **Prorated 60%** (full price, then 60% from 1 October, when five months of the club year remain, to encourage winter kit hire; e.g. boat hire) or **Prorated monthly** (`pricingMode: 'subscription'`: a monthly price for each month left until 1 March, e.g. a lesson block). Older `yearly-service` products without a pricing mode are read as Prorated 60%, except `keyhire`, which is Fixed. Subscription and prorated-monthly prices are monthly. If **Allow monthly payments** is ticked (the default), the customer can pay monthly through a Stripe subscription; otherwise they pay up front for the months left until 1 March. **20% off when paid up front** is a per-product tick box for these items. The basket shows the monthly/annual toggle only when an item in it allows monthly payments, and each saved order line records `monthly`.

Generated voucher codes store the shop item they were bought from (`sourceProductId`). The admin discount code list shows one summary row per voucher shop item rather than every code; older codes without `sourceProductId` are grouped by the item name they were issued under. Individual codes are on the buyer's record in Reports.

A voucher item's **Edit** button in that list sets what its credit can be spent on (`voucherScope` on the product: categories, products or both; membership is never allowed). With nothing ticked the credit covers everything except membership. Each order line copies the scope at checkout, and the generated code stores it as `categories`/`productIds`, so changes only affect vouchers bought afterwards. Custom discount codes are unchanged.

Events, services and subscriptions also have a **Membership** rule (`membershipRule`, see `productMembershipRule` in `src/utils/catalogue.js`): *Club members only* (`required`, the default), *Open to non-members* (`none`; buyers who are not members are kept as contact-only records outside the member register) or *Club membership included* (`included`). An included product makes each person who is not already an active member an adult or junior member (by age) until 1 March: the order person carries `grantMembership`, and payment writes the same active membership, tier and queued JustGo upload as buying a membership, plus `membershipIncludedWith` (shown in the member register as "Included with …"). Active members pay the same price and keep their membership. Older events saved with `membershipRequired: false` read as `none`; `membershipRequired` is still written for compatibility. Order lines record the rule.

## Member IDs

- Each `memberships` document has a short, permanent ID (`M0001`, `M0002`, …) allocated from the `counters/memberships` counter by checkout, `scripts/justgo-sync.py` and `scripts/migrate-members.js`. It never changes.
- `membershipNumber` is `FCC-<Paddle Scotland number>` (4–8 digits). JustGo sync sets it and updates it if the number changes. Until then, admins see "Awaiting Paddle Scotland sync".
- Membership status is the same on the member register, event attendee lists and Check-ins (`membershipStatus` in `src/utils/adminReports.js`): **Active** (or **Active (no expiry)**), **Awaiting renewal** (cover has ended but a renewal link is live, or a JustGo member is not yet confirmed in the first 14 days of the club year), **Pending** (a JustGo member never synced), **Unavailable** (a JustGo member not confirmed this club year while the sync has stopped), **Expired**, **Revoked** or **No**. Imported statuses such as Cancelled are shown as recorded. Run `scripts/justgo-sync.py` weekly; each completed run writes `settings/justgoSync.lastSuccessAt`, and with no completed run for 8 days the sync counts as stopped and the Members tab shows a warning, because a missing confirmation then cannot be read as a lapsed membership.
- Admins see both in Reports & records. Members are shown neither.

### Other short record IDs

New records use sequential IDs: households `H00001`, catalogue items (including events) `P00001`, volunteer sign-ups `V00001`, other list entries `L00001`, forms `F00001`, and form responses `R00001`. Existing IDs are preserved, including named starter-product IDs. Event bookings remain part of their purchase and keep the purchase ID.

The server reserves numbers transactionally through `counters/<type>`, skips IDs already present, and never reuses a reserved number. Padding is a minimum, so numbers can grow past five digits. Checkout, club-night guests, JustGo sync and schema migration all use the household counter; migration dry runs do not reserve numbers. New catalogue IDs are reserved through the admin-only `/api/admin/products/reserve-id` endpoint before saving.

Purchase IDs, Stripe IDs, voucher/redemption codes, private tokens, audit/idempotency keys, and internal deterministic document keys are unchanged. IDs identify records; they are not access credentials.

## Club Years

The club year runs from 1 March and is named by the year it starts (1 March 2027 – 28/29 February 2028 is **2027**). Dates and sale windows are in `src/utils/clubYear.js` and use London time.

- **Sale windows:** before 1 January only this club year is sold. From 1 January the basket asks, for each membership, service and subscription, whether it is for **this club year**, **next club year** or **both** (`clubYearChoice` on each basket line; `both` is one line that the server splits into this year's line and a next-year line). This year's membership stops on 8 February and everything else for this year on 15 February; after that only next year is offered. Events, merchandise and vouchers have no club year.
- **Records:** order lines and privileges record `clubYear`, and members record every club year they hold in `clubYears` (for example `[2027, 2028]` for someone who renewed early), with `validUntil` the end of the latest. Older privileges without `clubYear` use the year they were granted. A member who holds only next year is not covered for this year, except that from 8 February a next-year membership also covers the rest of this year.
- A held service or subscription cannot be bought again for the same club year (`already_held`), and an active member cannot buy a membership for a year they already hold (`membership_active`).

## Monthly Subscriptions

Every direct debit is on the 1st of the month and everything monthly ends with the club year. Checkout never creates subscriptions itself: it takes what is due now, saves the card or bank account, and the webhook creates or extends the subscriptions afterwards (`setUpSubscriptions` in `server.js`).

- **Checkout** charges annual and one-off items in full plus a **joining-month charge** for each monthly item: the share of the current month still to run, rounded up to the next 20% (`joiningShare`). The Checkout session is in `payment` mode with `setup_future_usage=off_session`. When nothing is due now (only next-year monthly items), it runs in `setup` mode and the order records `stripeSetupIntentId` instead of a payment intent.
- **One subscription per payer per club year per card or bank account.** The order's `subscriptionPlan.groups` has one group per club year with its `firstDebitAt` and `cutoffAt` (1 March). The webhook adds the group's items to the payer's live subscription for that club year when it uses the same payment details (compared by Stripe's fingerprint), otherwise creates a new one (`newPaymentDetails` when another live one exists). Existing subscriptions' payment details are never changed.
- **New subscriptions** wait until their first 1st (`trial_end`, which Stripe shows as *trialing*) with `cancel_at` set to 1 March and no proration. If the first 1st has already passed (a delayed bank payment), the subscription is backdated to it (`backdate_start_date`, `billing_cycle_anchor` the next 1st, `create_prorations`) so the missed month is charged, then `cancel_at` is set to 1 March. Stripe metadata records `club_year` and `cutoff_at`; only subscriptions with `club_year` count as *trialing = live*.
- **This year's monthly items** are first debited on the next 1st. Bought from 1 to 14 February, the joining-month charge is the only payment and no subscription is made. **Next year's** monthly items are first debited on 1 March.
- **February sales cut-off and subscription end are separate:** current-year sales close on 15 February, but every subscription ends at the start of 1 March (`cancel_at`, no proration). The last full monthly debit is 1 February, giving 12 full payments for a full club year. Failed February payments may retry until 1 March; an invoice still open at cancellation is voided and flagged for staff. When Stripe sends `customer.subscription.deleted`, the `subscriptions` record becomes `ended`; it is flagged `needsStaff` if money was left unpaid or it ended before the scheduled boundary (`endedAtCutoff: false`).
- Existing subscriptions created before this change keep their earlier Stripe cancellation date unless reused by a new order. Review and reschedule any existing club-year subscriptions from 15 February to 1 March separately; this change does not bulk-update Stripe records.
- In **Admin → Reports → Stripe subscribers**, the document button opens information-only details with no cancellation control. The stop button (active subscriptions linked to a club customer only) opens **Stop billing immediately**, requiring the exact subscription ID and explicit approval. It cancels the entire Stripe subscription now using `DELETE /v1/subscriptions/:id` with `invoice_now=false` and `prorate=false`, not the existing club-year cutoff. No refund, prorated credit or final invoice is created; existing unpaid invoices and processing payments may still be collected. The server verifies the imported customer and Stripe mode, confirms Stripe's cancelled status, refreshes the registry, and records the administrator in `adminSubscriptionAudit`. The bank mandate and other subscriptions are unaffected. This requires the server-only `STRIPE_SUBSCRIPTION_ADMIN_KEY` with subscription cancellation access.

Stripe calls use idempotency keys, so a replayed webhook changes nothing. If Stripe refuses a change, the order's `subscriptionPlan` is marked `failed` with the error and the order gets `subscriptionSetupNeedsStaff`; staff see which item and member it was on the order.

Stripe settings to check in the Dashboard (test mode first): turn off Stripe's trial-ending reminder emails (new subscriptions are *trialing* until their first 1st), and confirm that cancellation at 1 March stops retries and creates no credit or March invoice.

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

### Volunteer membership benefits

The Volunteering page has a fixed layout: introduction, one card per volunteer level, a single ways-to-volunteer list and the existing sign-up form. Approved admins use **Configure volunteering** on the page, without Edit Mode. All saves are live database changes: no GitHub PR or rebuild is needed, and fresh visits load the saved configuration. Other pages such as Home retain the GitHub draft/review/publish process.

The configuration sections are **Page**, **Ways to volunteer**, **Levels** and **Form**. **Page** edits the heading and introduction. **Ways to volunteer** edits its heading and a structured list of up to 50 title/description items, with Add item and Remove item controls; it cannot add, remove, reorder or restyle tiles. **Form** changes only its existing heading and description, not questions, validation or submission behaviour. **Save volunteering content** saves all three wording/list sections through the admin-only `POST /api/admin/volunteering` endpoint to `settings/volunteerPage.content`, recording `updatedBy` and `updatedAt`. The endpoint rejects arbitrary tiles, custom form fields and unknown properties. Public `GET /api/volunteering` returns content and levels without caching. The base version is built into the repo (`DEFAULT_VOLUNTEER_PAGE` in `src/utils/volunteerPage.js` and `DEFAULT_VOLUNTEER_BENEFITS` in `src/utils/volunteering.js`); the server returns the latest saved version, and if the API cannot be reached the page shows the built-in base version, with configuration hidden and a notice for admins. Before the first content save, it uses existing published `public/content/pages/volunteering.json` wording if present, or the original defaults; old tile layouts and arbitrary custom tiles are not migrated. Volunteering is no longer registered with the generic page editor or GitHub publishing endpoint.

**Levels** picks one level from a dropdown to edit its hours, card title, description, discount or price cap, free services (tap-friendly tick boxes) and other benefits. **Add level** and **Delete level** control the level cards and form options (1–10 levels, unique hours). **Save volunteer levels** separately writes `settings/volunteerBenefits`; existing payments never change. A level cannot be deleted while current or future sign-ups use it (409); move those volunteers first. Existing levels keep the ids `20`, `40` and `60`; new levels get `level-<hex>` ids, and member year records also store the level's `hours`. Defaults: 20+ gives £5/month off Blue and Gold plus free key hire; 40+ caps those subscriptions at £10/month plus free boat/equipment and key hire; 60+ makes those subscriptions and hires free. The 60+ other benefit is a request for 25% off CVC **or** camping paid for at the Tully weekend, not an automatic coaching discount. Equivalent rates apply to up-front payments. Other list forms and current-club-year custom forms remain on Contact us.

**History** lists every volunteering version as *Version N · date · editor*, newest first (up to 100). Version 1 is created on the server the first time history is opened or a volunteering save is made, from the live state at that moment (editor *Server (initial version)*). Every successful content or levels save then stores a full snapshot of page content **and** levels in `volunteerVersions/v000NNN`, numbered by `settings/volunteerVersions.latest` in a transaction, with the editor's email and time; rejected saves are not recorded. **Restore version N** (admin-only `POST /api/admin/volunteering/versions/:version/restore`, listed by `GET /api/admin/volunteering/versions`) re-validates the snapshot against current rules, applies its levels through the same in-use check, catalogue check and member update as a levels save, then its content, and records a new *Restored from version N* version, so a restore can itself be undone. A restore that would remove a level still used by this or next club year's volunteers is refused (409) with nothing changed. Version documents are server-only (Firestore rules deny client access).

In **Reports & records → Volunteers**, each sign-up is a row. Select the level and use the single induction/activation control. Deactivation preserves induction history. Legacy sign-ups need a bracket selected before activation; no hours commitment is assumed. Opening the volunteer table reconciles older inducted sign-ups into their matched membership records without sending emails; no bracket or benefits are invented for legacy rows. Confirming a volunteer renewal reuses an existing sign-up for that member and year, retaining their answers. `memberships.volunteer` holds induction and `years.<clubYear>` holds active status, bracket and benefit descriptions, shown in the member register's Includes and record details. Existing purchases and payments are never removed or refunded. Old thank-you codes are left intact; new sign-ups receive automatic benefits instead of new generic 25% codes.

PVG and safeguarding are editable expiry dates before the first JustGo sync. Afterwards they are read-only JustGo text statuses, including when a future-year membership purchase is still pending upload. The CSV sync imports optional `PVG Status` and `Safeguarding Status` columns; missing columns mean “Not supplied by JustGo”, never assumed clearance.

Set the induction contact email in **Reports & records → Volunteers**. New volunteer forms notify that coordinator so they can arrange induction. Failed or unconfigured notifications are shown on the volunteer row and can be retried after setting the address.

At membership renewal, volunteers who have not opted in for next year also get links to keep or change their hours commitment. Members who have already renewed membership receive **only a volunteer reminder**, on the same two February rounds, while they still need to opt in. Paid benefits do not imply a volunteer opt-in. Links are hashed in `volunteerRenewals`, expire after March, and only update volunteering after an explicit form POST; opening an email link does not activate benefits. `volunteerRenewalSentFor` deduplicates each round. GDPR erasure removes these links and contact-form submissions.

For an already-paid monthly item that is now completely free for every holder, the member's **Monthly payments** view offers a manual cancellation schedule. Staff must confirm it; Stripe retains the paid phase, removes only that item at its end, and preserves other items and the club-year cutoff. Existing Stripe schedules or additional billing settings require staff to manage the change in Stripe rather than overwrite them. No payment is changed by volunteer activation itself.

Validation: `npm test`; with `.env.emulator` loaded, `node scripts/test-volunteering.js` runs an isolated `demo-fcc-volunteer-tests` project and cleans up its fixtures.

Website members whose membership ends this club year get one renewal email per contact address (the household email, so a family gets one email). JustGo members renew through JustGo and are not emailed, nor are contact-only records. The email lists the basket and links to `/membership?renew=<token>`, which fills the basket with next year's membership (one family membership for a family) and the services and subscriptions each person holds this club year that are still sold, with monthly billing if they pay monthly now. They can remove or add items before paying. Logic is in `src/utils/renewals.js` and the routes in `src/server/renewals.js`.

- **Sending:** staff can send from 1 January (Admin → Reports & records → **Renewal emails**, or **Send renewal email** on a member in Reports, which also resends). The scheduled job sends twice: on 1 February to everyone not yet emailed, and a reminder on 15 February to everyone not yet reminded. Members record `renewalInviteSentFor` and `renewalReminderSentFor` (club years), so rerunning a round emails nobody twice. Anyone already holding next year's membership (in `clubYears` or covered past 1 March) is never emailed, even if they did not renew their extras.
- **Links:** a random token whose SHA-256 is the `renewalInvites` document id (with the email, renewal year and `membershipIds`). Links expire after 31 March. The basket is worked out when the link is opened, so members who have since renewed are left out, and the token is removed from the address bar. GDPR erasure deletes invites that name an erased member.
- **Scheduled job:** `config/fcc-renewals.service` and `.timer` run at 09:00 London on 1 and 15 February (a missed run catches up when the server starts) and `POST` to `/api/jobs/renewals` with `Authorization: Bearer $RENEWAL_JOB_TOKEN`. Set `RENEWAL_JOB_TOKEN` (at least 32 random characters) in the API environment and, with `RENEWAL_JOB_URL` (the API's `/api/jobs/renewals` URL), in the server's `.env`. Outside 1 February to 1 March the job does nothing; from 15 February it sends the reminder round.
- **Testing locally:** the emulator seed adds the `TEST-HH-RENEWAL` household (`renewal@example.test`): a website family whose cover ends this club year, with Boathouse Access held by the parent. Start the API with `PUBLIC_SITE_URL` set to the Vite address so links point at it. Renewals open on 1 January, so as the local test admin send with the `X-Test-Now` header (honoured only with local emulators), e.g. `POST /api/admin/renewals/send` with body `{"membershipId":"test-renewal-parent"}` and `X-Test-Now: 2027-01-05T12:00:00Z`. The email, with its link, is in `testMail` (`kind: renewal`). Opening the link before 1 January still fills the basket, but checkout for next year is refused until then. Reseeding clears the sent flag.

### Check-ins (club night and other sessions)

Set the weekly check-in sessions in **Reports & records → Volunteers → Check-in sessions**. Each session has a name, weekday, start and end (UK time), whether to show boat hire, and which shop subscriptions to check (for example a Gold subscriber session). They are stored as `settings/clubNight.sessions`; the original single club-night setting still reads as one "Club night" session with boat hire. The reusable QR code points to `/check-ins`; `/club-night` remains an alias for existing QR codes. Public check-in and authorised volunteer access are open for the whole of each session's day (00:00 until the next midnight in Europe/London), not just the session times. Start and end times describe the session. Access respects BST and GMT.

- People check in with name, date of birth and email, choosing a session first when more than one is on that day. A match against a member or earlier guest is recorded in `clubNightCheckins` with the session, membership status (the same status shown on the admin member register), current-year boat hire, any checked subscription and whether they have been to that session before. Checking in again the same day refreshes the status, for example after paying at the card reader. Someone we do not hold enters the details a membership needs (contact, emergency contact, swimming, medical, consents) and is saved as a contact-only household and record (`source: 'club-night'`); they are not a member. When they later buy a membership, the checkout's returning-person lookup finds that record, so they only confirm their details.
- Volunteers open the same page and sign in with an email code. Any inducted, active volunteer for the current club year qualifies. Signed-in admins use their Google sign-in instead. The mobile-first volunteer view shows today's check-ins for one session at a time (with a session selector when several are on), as attendee cards with membership, first-visit status, and boat hire and subscription when the session checks them; earlier weeks are never shown. The API rejects list and emergency-contact access after midnight, and the page clears displayed details when the day or email session ends. Emergency contacts are hidden until a volunteer presses **Show emergency contact**, and each view is logged in `clubNightAccessLog`. Phone numbers are tap-to-call.
- Check-in is self-reported and does not prove physical presence.
- Approved FCC admins already signed in through Google can open **Volunteer view** without an email code or a volunteer registration. The page uses their Firebase ID token, checked by the same server-side admin/domain and revocation checks as the admin pages. The local emulator test-admin sign-in works too. Access is still limited to the scheduled day; emergency-contact views record the admin email and `viaAdmin: true` in `clubNightAccessLog`. Other volunteers continue to use email codes.

### Email codes and My details

`/my-details` (footer link) lets a household's contact see this club year's paid receipts (orders since renewals opened, in the same limited form as the receipt link) and change phone, address, postcode, emergency contact and contact email. They enter the email plus their own date of birth or an attendee's (any member of the household, so a parent can use a child's), and receive a 6-digit code. A new email is confirmed by a code sent to it, and the old address is told. Name and date of birth changes go through the secretary. Households with a JustGo member are read-only and told to update JustGo. Changed field names (not values) are logged in `selfServiceChanges`. The Stripe customer email is not changed.

Codes (`emailCodes`, hashed) expire after 10 minutes, allow 5 attempts and 5 sends an hour, and the form gives the same reply whether or not an address is held. My details is the exception: a wrong email or date of birth gets "The email address and/or date of birth do not match a membership or purchase record", which tells someone who already knows the email and a household date of birth that a record exists. A verified code gives a session in `emailSessions`: 30 minutes for My details, 12 hours for club-night volunteers. Sessions are tied to their purpose. GDPR erasure removes a person's check-ins, access-log entries, self-service log, codes and sessions.

Test with the emulators running: `node scripts/test-club-night.js`.

## Boathouse Access and Purchased Item Actions

The private boathouse settings hold separate gate, alarm and lockbox codes with optional notes. All three codes are required when saving; older single-code settings are read as the gate code. Changing any code increments one shared version and emails all three codes to every member with recorded key access. Notes alone do not increment the version. Saving unchanged settings retries unsuccessful deliveries; successful recipients skip that version, and a short delivery lease prevents concurrent broadcasts sending duplicates.

Key hire purchases and volunteer induction grant key access on the member record. Deactivating a volunteer does not remove their key access. In a member's report details, admins can grant/restore or revoke key access with a required reason. Explicit revocation overrides purchases and induction until an admin restores access. Revocation cannot retract already disclosed physical codes: rotate the shared codes when necessary.

Paid order and event report details expose actions for each purchased line:

- **Revoke item:** removes its entitlement, stops the matching future monthly payments, releases its ticket/merchandise stock or disables an unused voucher. Key hire revocation also revokes the holder's key access.
- **Refund:** issues a real Stripe refund in integer pence against the selected checkout or attributable subscription payment, bounded by the item's allocation and the charge's remaining balance. Refund alone leaves access and future billing unchanged; select the separate revoke option to stop them too.
- Every action requires a reason and records the admin, timestamp and operation ID in `adminItemAudit`. Orders, original totals and purchase lines remain intact with refund/revocation history. Pending Stripe refunds reserve their amounts; a pending status is not confirmation that funds have reached the customer.

Uncertain Stripe responses keep a persisted unfinished action. Use **Refund / retry unfinished action** on the order and retry the exact recorded request; never create a replacement refund. Stripe idempotency keys and refund metadata reconcile lost responses. The order cannot be deleted while an action is unfinished. Legacy person-level entitlements without line IDs, imported memberships without saved pre-purchase coverage, unfinished monthly setup and used/reserved vouchers require staff reconciliation rather than guessing. Multi-payment invoices also require review in Stripe. Membership revocation preserves reconstructable independent cover and marks JustGo for staff review; it does not automatically delete a JustGo membership.

Refunds use the existing server Stripe write credentials and test-mode restriction; this does not enable live Stripe writes. Payment/invoice/charge/refund read access and refund write permission are required. External Stripe adjustments must still be reviewed against the item allocation; website history only records refunds initiated here.

Run isolated integration checks against the existing local emulators (Stripe and email are mocked; no real refund is issued):

```bash
LOCAL_FIREBASE_EMULATORS=true GCLOUD_PROJECT=demo-fcc-item-action-tests \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 node scripts/test-item-actions.js
```

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
- Decide retention periods and long-term statistics together (see `TODO.md`), and finish the outstanding items in the security review there, including analytics consent.
- Use the purchased-item refund/revoke actions rather than deleting an order to refund it; keep the original financial history.
- Replace the Stripe test keys with live ones; checkout currently refuses anything but test keys.
- Create Secret Manager secrets and grant the Cloud Run service account `Secret Manager Secret Accessor` on each; the deploy maps them to the API. Until set, deletion and subscription scheduling are refused:
  - `audit-lookup-secret` → `AUDIT_LOOKUP_SECRET`: a long random value (`openssl rand -hex 32`). Never change it without migrating existing audit lookups.
  - `stripe-subscription-admin-key` → `STRIPE_SUBSCRIPTION_ADMIN_KEY`: a Stripe restricted key (same mode as the report key) with subscription read/write and customer, invoice, payment-intent and charge read access.

## API Outage Alerts

`GET /health` returns 200 only when the API is running **and** can read Firestore (5-second limit); otherwise 503. Every deploy (including the daily run) runs `scripts/setup-api-monitoring.mjs`, which creates or updates in Google Cloud Monitoring: the uptime check **FCC API health** (the Cloud Run URL's `/health`, every 5 minutes from several regions), one email channel per address, and the alert policy **FCC API outage** (fires when more than one region fails; a resolved email follows when it passes again). Re-running is safe: nothing is duplicated, a new API URL replaces the check, and addresses removed from the workflow stop being alerted.

- **Who is emailed:** `API_ALERT_EMAILS` at the top of `.github/workflows/firebase-hosting.yml` (comma separated). Change it and push to `main` (or run the workflow manually).
- **One-off setup:** enable the Cloud Monitoring API for `fccwebsite-23cfc` and give the deploy service account (`FIREBASE_SERVICE_ACCOUNT`) the **Monitoring Editor** role:
  `gcloud services enable monitoring.googleapis.com --project fccwebsite-23cfc` and
  `gcloud projects add-iam-policy-binding fccwebsite-23cfc --member serviceAccount:<deploy-account-email> --role roles/monitoring.editor`.
  Until then the **Configure API outage email alert** step fails with an annotation (the site itself is already deployed by then).
- **When an alert arrives:** Cloud Run → `fcc-website-api` → Logs for the error. If a recent deploy caused it, Cloud Run → Revisions → route 100% of traffic to the previous working revision, then fix and redeploy. Otherwise check Secret Manager secrets, project billing and status.cloud.google.com. Members only see the problem; no saved data is lost.
- **Not covered:** a single visitor blocked by their network or the rate limit, or a browser blocked by CORS because a new site address is missing from `PUBLIC_SITE_URLS` (the API is healthy in those cases).

## Basic Debugging

- Orders fail: start the API and Firestore, not only Vite. Check `curl --fail http://localhost:3002/health`.
- Payment stays pending: check Stripe CLI delivery and the API signing secret. Stripe and Firebase emulators are separate services.
- API returns HTML: check `VITE_API_BASE_URL` and restart Vite.
- Admin denied: reseed the local admin, then sign out/in. Real accounts need the Firebase `admin: true` claim and an address on the exact `forthcanoeclub.co.uk` domain: the person signs in once at `/admin` with their verified club Google account, then an existing admin approves them under **Website admins** (or a developer runs `node scripts/grant-admin.js name@forthcanoeclub.co.uk`). The API, editor and Firebase write rules also enforce the club domain; an admin claim alone does not permit another domain. Password accounts are accepted for approval only in local emulators, still on the club domain. Changes are logged in `adminAccessAudit`; removed admins are signed out.
- Image upload fails: check Storage emulator/rules and port `9199`.
- Stripe subscribers unavailable: reporting and live subscription validation need a server-only `STRIPE_REPORT_SECRET_KEY` with read access in the matching Stripe mode; local Stripe is not emulated. Use test mode only.
- Port occupied: choose another frontend port and update `PUBLIC_SITE_URL`.

For configured cloud services instead of emulators, copy [.env.example](.env.example) to an ignored `.env`, use a test project, and set `VITE_API_BASE_URL` to your API URL. See [DEPLOYMENT.md](DEPLOYMENT.md) for releases.
