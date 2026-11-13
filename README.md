# Forth Canoe Club Website

How the club website works: what each part does and where its code lives. To run it locally, see [DEVELOPMENT.md](DEVELOPMENT.md); to deploy and configure it, see [DEPLOYMENT.md](DEPLOYMENT.md).

## The Parts

| Part | Runs on | Does |
| --- | --- | --- |
| Website | Firebase Hosting | React/Vite single-page app: public pages, shop, checkout, My details, club-night check-in and admin. A service worker ([service-worker.js](src/service-worker.js)) keeps a copy for offline reading. |
| API | Cloud Run (`europe-west2`) | Express ([server.js](server.js), [src/server/](src/server/)). Answers only `/api/...` and `/health`: payments, webhooks, emails, reports and every private read or write. |
| Database | Firestore | All records. Browsers can read only `products` and `notices`, and only club admins can write `products` ([firestore.rules](firestore.rules)). Everything else goes through the API. |
| Files | Firebase Storage | Uploaded images ([storage.rules](storage.rules)). |
| Scheduled jobs | Cloud Scheduler + Cloud Run jobs | `fcc-renewals` (renewal emails, 1 and 15 February), `fcc-welcome-emails` (daily welcome emails for JustGo joiners and renewals), `fcc-justgo-sync` (daily) and `fcc-justgo-upload` (hourly). See [scheduled-jobs.sh](scripts/scheduled-jobs.sh). The API also runs two hourly tasks itself: event attendee lists and policy wording versions. |
| Payments | Stripe | Checkout (card and Bacs Direct Debit), monthly subscriptions, refunds. Results arrive through the Stripe webhook. Only test keys are accepted for now. |
| Email, forms | Google Workspace | Sends all emails; admin-created forms save to Google Sheets in a club-year folder on the Shared Drive. |
| Page content | GitHub | Admin page edits become a review pull request into `main`. |
| Membership register | JustGo (Paddle Scotland) | National governing body records. See [JustGo](#justgo). |

Deployment is [.github/workflows/firebase-hosting.yml](.github/workflows/firebase-hosting.yml): pushes to `main`, a monthly run and manual runs deploy the API, website, Firebase rules and scheduled jobs. Pushes that change only page content do not deploy by themselves. Pull requests run unit and emulator tests ([checks.yml](.github/workflows/checks.yml)) and CodeQL.

## What Does What

**Pages and editing.** Default copy is in [src/constants/](src/constants/) and published page content in [public/content/pages/](public/content/pages/). Signed-in admins edit pages in place; saves go to the `live/web-admin-edit` branch, and a review PR merges them into `main` ([contentDrafts.js](src/server/contentDrafts.js)). They go live at the next deployment (run the workflow by hand if nothing else is due). The catalogue, images, notices and volunteering page save straight to Firebase without review.

**Admins.** A verified Google account on `forthcanoeclub.co.uk`, approved by an existing admin, which sets the Firebase `admin` claim ([adminAccess.js](src/server/adminAccess.js)). Removing an admin signs them out everywhere.

**Shop and checkout.** Products in Firestore override the starter list in [products.js](src/constants/products.js) ([catalogue.js](src/utils/catalogue.js)). Categories: membership, services, subscriptions, vouchers, events and merchandise, with stock, event capacity and discount codes. Checkout collects each person, matches returning members by email, name and date of birth, then sends the payer to Stripe. The webhook records the order, households and memberships ([orderPeople.js](src/server/orderPeople.js), [membershipTerms.js](src/server/membershipTerms.js)). After payment, monthly items are added to the payer's Stripe subscription for that club year (created if needed) and debited on the 1st of each month. If the payer comes back from Stripe without paying, the basket and typed details are kept in that browser tab; starting again expires the earlier Stripe session, so nobody is charged twice.

**Service trip discounts.** Single-day trips are cheaper for each attendee who holds, or is buying, a qualifying service or subscription this club year. Admins set the rules in **Reports & records → Credits & discounts → Service trip discounts**; the basket and checkout both price through the API, so the total shown is what Stripe charges ([tripDiscount.js](src/utils/tripDiscount.js)). Qualifying products cannot be removed from the shop.

**Monthly receipts.** Each paid monthly debit emails the payer a club receipt listing the items paid under the person each is for, once per Stripe invoice. Subscriptions set up outside this site on the same Stripe account are receipted too.

**Failed payments.** Stripe retries. The site emails the member on each failure, and on the last one sends links to restart the monthly payments or confirm they are stopping. A failed one-off bank payment gets retry and cancel links. Each case appears under **Needs attention** for staff ([attention.js](src/server/attention.js)).

**Renewals.** From 1 January staff can send renewal emails; the scheduled job sends them on 1 and 15 February. Each links to a basket prefilled with next year's membership and this year's services and subscriptions ([renewals.js](src/server/renewals.js)).

**My details.** Members sign in with an emailed code ([emailCodes.js](src/server/emailCodes.js)), then update their household's contact details, give or withdraw photo consent, view receipts and ask to stop monthly payments ([myDetails.js](src/server/myDetails.js)).

**Club night.** Scheduled check-in sessions. Non-members give their details once and are kept as contacts; volunteers sign in with an email code to see that day's check-ins ([clubNight.js](src/server/clubNight.js)).

**Weekly timetable.** Admins list the club's regular sessions (day, time, season, location) under **Reports & records → Sessions & timetable**; the Disciplines page shows them to everyone from `GET /api/timetable` ([timetable.js](src/server/timetable.js)). It is separate from check-in sessions.

**Events.** Each event has a schedule, capacity and leader. When bookings close, the leader is emailed the attendee list once, with emergency contacts, medical details and photo-consent status ([eventRosters.js](src/server/eventRosters.js)). An event leaves the shop when it sells out or is over; without a close date, a course can be booked until its last day ([eventRoster.js](src/utils/eventRoster.js)).

**Volunteering.** The volunteering page, volunteer levels and yearly benefits, with every save versioned and restorable ([volunteers.js](src/server/volunteers.js)). Boathouse access codes are private and only changed through admin routes ([boathouse.js](src/server/boathouse.js)).

**Notices and consents.** The Notices page holds the privacy notice, data retention and other notices; publishing changed wording makes a new numbered version, downloadable as a PDF ([notices.js](src/server/notices.js)). Checkout and club-night check-in ask for the participation disclaimer (required) and photo/video consent (optional), answered by a parent or guardian for under-18s ([consents.js](src/utils/consents.js)). Earlier answers are ticked in advance only if the wording has not changed.

**Reports and records.** Reports, member and order records, refunds and revocations per purchased item ([itemActions.js](src/server/itemActions.js)), credits for items paid outside the website or given free ([credits.js](src/utils/credits.js)), PVG and safeguarding dates ([memberChecks.js](src/server/memberChecks.js)), key access and GDPR erasure ([gdpr.js](src/server/gdpr.js)). Deleting a member record stops their monthly payments without a refund; deleting an order is refused while its monthly payments run. Erasure keeps anonymised financial history.

What each item action changes (none deletes the order):

| Action | Money back | Access | Monthly billing |
| --- | --- | --- | --- |
| Revoke access | No | Removed now | Stopped now |
| Refund one payment / Refund only | Yes, the chosen amount | Kept | Carries on |
| Refund and cancel / Refund and revoke | Yes | Removed now | Stopped now |
| Cancel item, member's items or subscription (Monthly payments) | No | Those items run to their paid-up date; membership and other items are unaffected | Stopped now |
| Stop billing immediately (Subscriptions tab) | No | Ended once Stripe confirms | Whole subscription cancelled |

A refund is made first, then billing stopped, then access removed. If a step fails, **Resume unfinished action** finishes the same request without refunding twice. Credited orders cannot be refunded through Stripe: refund the customer directly.

**Images.** The admin's browser resizes each upload into WebP copies of several widths, a plain JPEG/PNG copy and a tiny blurred preview; the original is never uploaded ([imageProcessing.js](src/utils/imageProcessing.js)). [ResponsiveImage.jsx](src/components/ResponsiveImage.jsx) shows the preview, then downloads the smallest copy that is sharp for the box on that screen. Costs are in [hosting-cost-plan.md](docs/hosting-cost-plan.md).

**Live mode.** `WEBSITE_ISLIVE=true` turns on versioning of consent and policy wording and record retention. It is off until the policies are published and live Stripe keys are supported.

**Security.** Firebase App Check on the website and API ([appCheck.js](src/server/appCheck.js)), rate limits on every route ([rateLimit.js](src/server/rateLimit.js)), and audit logs for admin actions.

## JustGo

Paddle Scotland is the data controller for the JustGo membership register. The Python jobs in [jobs/justgo/](jobs/justgo/) use the published [v2.2 API](docs/justgo/justgo-api-v2.2.json):

- **Sync** (daily, read only) reads members, memberships, suspensions and credentials into the website's register. If it has not succeeded for 8 days, the register warns staff that membership checks are unreliable.
- **Upload** (hourly) links memberships paid on the website to the club in JustGo. Anything uncertain (more than one possible match, suspended accounts, families, guardians, writes with an unclear result) is left for staff, never retried automatically. Nothing deletes or suspends a JustGo account.
- **Both are off** until `JUSTGO_API_ENABLED` (sync) and `JUSTGO_API_WRITES_ENABLED` (upload) are set. Paddle Scotland's permission for clubs to search the national register and link members is still being confirmed.

## Project Layout

| Location | Contents |
| --- | --- |
| [src/pages/](src/pages/), [src/components/](src/components/) | Pages, admin panels, forms and the in-page editor |
| [src/utils/](src/utils/) | Shared logic (catalogue, pricing, checkout, consents, reports) and its unit tests |
| [src/server/](src/server/), [server.js](server.js) | API routes and server logic, with unit tests |
| [src/constants/](src/constants/), [public/](public/), [src/assets/](src/assets/) | Default copy, starter products, page content and bundled images |
| [scripts/](scripts/) | Local startup, emulator seed data and tests, migrations, admin and deploy helpers |
| [jobs/justgo/](jobs/justgo/) | JustGo jobs, operator commands and their tests |
| [docs/](docs/) | JustGo API contract and hosting cost plan |
