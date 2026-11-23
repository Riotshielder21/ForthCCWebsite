# Deployment

How the live site is deployed, configured and kept running. For what each part does, see [README.md](README.md); to run it locally, see [DEVELOPMENT.md](DEVELOPMENT.md).

## What A Deployment Does

[firebase-hosting.yml](.github/workflows/firebase-hosting.yml) runs on pushes to `main` (except page-content-only pushes), on the 1st of each month at 18:00 UTC, and by hand. In order it:

1. Deploys the API to Cloud Run (`fcc-website-api`, `europe-west2`).
2. Checks that all three frontends can call the API (CORS preflight).
3. Builds the website against the new API URL.
4. Deploys Hosting, **Firestore rules** and Storage rules.
5. Rebuilds the JustGo jobs and updates the Cloud Scheduler jobs ([scheduled-jobs.sh](scripts/scheduled-jobs.sh)).
6. Updates outage, browser-error, scheduled-job and project budget alerts ([setup-site-monitoring.mjs](scripts/setup-site-monitoring.mjs)).

Deploy [firestore.rules](firestore.rules) whenever the API is deployed; the workflow does both in one run. If you deploy the API by hand, also run `npx firebase-tools deploy --project fccwebsite-23cfc --only firestore:rules`. The rules stop admins deactivating or deleting the products a trip discount depends on (the ids in `settings/tripDiscounts`, or `boat-hire`, `blue-sub` and `gold-sub` until the rules are first saved); without them those products can be removed from the shop.

## Secrets And Settings

Never commit secrets. Locally, copy [.env.example](.env.example) to the ignored `.env` and use a test project.

**Secret Manager** (read by Cloud Run; grant its service account access):

| Secret | API variable | Notes |
| --- | --- | --- |
| `github-content-token` | `GITHUB_CONTENT_TOKEN` | Fine-grained token with read/write contents on this repository, for admin page edits |
| `firebase-service-account-json` | `FIREBASE_SERVICE_ACCOUNT_JSON` | Needs domain-wide delegation for Gmail send, Drive and Sheets (see [.env.example](.env.example)) |
| `stripe-test-secret-key` | `STRIPE_SECRET_KEY` | Only test keys are accepted for now |
| `stripe-test-webhook-secret` | `STRIPE_WEBHOOK_SECRET` | Signing secret of the Dashboard webhook endpoint (below) |
| `stripe-subscription-admin-key` | `STRIPE_SUBSCRIPTION_ADMIN_KEY` | Restricted key, same mode: subscription, item, schedule and customer read/write (including deletion), plus invoice, payment-intent and charge read. Refunds also need refund write and refund read. |
| `audit-lookup-secret` | `AUDIT_LOOKUP_SECRET` | `openssl rand -hex 32`. Never rotate it: GDPR erasure uses it to find already-deleted records. |
| `renewal-job-token` | `RENEWAL_JOB_TOKEN` | Created by `scheduled-jobs.sh setup` |
| `justgo-api-secret` | `JUSTGO_API_SECRET` (API and JustGo jobs) | Created as a placeholder by `scheduled-jobs.sh setup`; API service account also needs Secret Manager access |

`STRIPE_REPORT_SECRET_KEY` (optional, server only) gives reports their own key; without it they use `STRIPE_SECRET_KEY`.

**GitHub Actions secrets:** `FIREBASE_SERVICE_ACCOUNT` (the deploy account), the `VITE_FIREBASE_*` web config, `VITE_APPCHECK_SITE_KEY`, and optionally `WEBSITE_ISLIVE`.

**GitHub Actions variables** (Settings → Secrets and variables → Actions → Variables, applied on the next deploy): `APP_CHECK_MODE`, `VITE_FIREBASE_AUTH_DOMAIN` and the `JUSTGO_*` settings ([JustGo](#justgo)). Monitoring/budget recipients are `API_ALERT_EMAILS` in the workflow file; `STAFF_ALERT_EMAIL` sets Needs attention emails. Both currently use `jack.watt@forthcanoeclub.co.uk`.

## Email-code expiry cleanup

The API rejects expired codes and sessions immediately; Firestore TTL only removes expired storage later (normally within about 24 hours). Numeric `expiresAt` values remain unchanged for compatibility. TTL uses a separate timestamp field, `ttlAt`, in `emailCodes` and `emailSessions`. Code cleanup waits until the hourly sending-limit window ends so background cleanup cannot reset that limit early.

The project owner enabled both policies on 16 November 2026, and the API sets `ttlAt` on every new record. To check them, or to enable them in a new project:

```bash
gcloud firestore fields ttls update ttlAt --collection-group=emailCodes --enable-ttl --project=fccwebsite-23cfc
gcloud firestore fields ttls update ttlAt --collection-group=emailSessions --enable-ttl --project=fccwebsite-23cfc
gcloud firestore fields ttls list --project=fccwebsite-23cfc
```

The list should show `ttlAt` for both `emailCodes` and `emailSessions` with `state: ACTIVE`.

## Backups and restore

Set up on 20 November 2026 for the Firestore `(default)` database (about 1 MB; the cost is negligible):

- **Delete protection** stops the database itself being deleted.
- **Point-in-time recovery** keeps every version for 7 days, to the minute.
- **Daily backups** are kept for 14 days. Firestore chooses the time of day.
- **One-off exports** go to `gs://fccwebsite-23cfc-firestore-exports` (private, London). A lifecycle rule deletes them after 14 days, and soft delete is off so nothing lingers. Take one before any bulk change or migration:
  `gcloud firestore export gs://fccwebsite-23cfc-firestore-exports/before-CHANGE-$(date -u +%Y%m%d) --database='(default)' --project=fccwebsite-23cfc`
- **Storage** (`fccwebsite-23cfc.firebasestorage.app`, page and product images) has no separate backup. Uploads get unique names, so nothing is overwritten, and Google's 7-day soft delete covers deletions: `gcloud storage restore`.

These periods are in the draft Data Retention and Privacy notices. The committee approves them in the approval checklist.

**To restore**, never write over the live database directly:

1. **Copy the restore point into a new database.** For any minute in the last 7 days, clone it:
   `gcloud firestore databases clone --source-database='projects/fccwebsite-23cfc/databases/(default)' --snapshot-time=2026-11-20T16:45:00Z --destination-database=restore-YYYYMMDD --project=fccwebsite-23cfc`
   For anything older, up to 14 days, use `gcloud firestore backups list` and `gcloud firestore databases restore --source-backup=BACKUP --destination-database=restore-YYYYMMDD`. For an export, create the database and run `gcloud firestore import`. Wait until it serves reads; a clone takes about 10 minutes.
2. **Copy back only the collections the problem affected.** Run [restore-documents.mjs](scripts/restore-documents.mjs) as a dry run first, then add `--apply`:
   ```bash
   AUDIT_LOOKUP_SECRET="$(gcloud secrets versions access latest --secret=audit-lookup-secret --project=fccwebsite-23cfc)" \
   GCLOUD_PROJECT=fccwebsite-23cfc node scripts/restore-documents.mjs --gcloud --from restore-YYYYMMDD \
     --snapshot-time 2026-11-20T16:45:00Z --collection orders
   ```
   - Anyone erased since the restore point stays erased. Their member and household records, and anything that names them, are kept out, using the erasure audit entries, which hold only keyed hashes. A record an erasure redacted is never overwritten.
   - Records changed since the restore point are left as they are and listed. Add `--overwrite-changed` only when those changes are the problem being undone.
3. **Reconcile Stripe and JustGo for the time since the restore point.**
   - Compare Stripe payments, refunds and subscription changes made since then with the restored orders and subscriptions.
   - Resend missing webhook events from the Stripe Dashboard, then check **Needs attention**.
   - Check the JustGo links of any restored members.
4. **Delete the restored database**, which holds personal data:
   `gcloud firestore databases update --database=restore-YYYYMMDD --no-delete-protection` (a clone copies delete protection), then `gcloud firestore databases delete --database=restore-YYYYMMDD`.

The first test restore cloned 16:45 UTC on 20 November into a temporary database. A dry run found exactly the 110 records the beta clean-up had just removed, and none were copied back. The clone was then deleted.

## Stripe Dashboard

Do this in each mode (test now, live later); each endpoint has its own signing secret.

- **Webhook endpoint:** `https://fcc-website-api-397447736103.europe-west2.run.app/api/stripe/webhook` with these eight events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`. Put its signing secret in `stripe-test-webhook-secret`.
- **Retries:** under **Billing → Revenue recovery → Retries**, use Smart Retries (or a fixed schedule), set **If all retries for a payment fail** to **Cancel the subscription**, and include Bacs Direct Debit.
- **Customer emails:** turn off Stripe's own failed-payment and successful-payment emails. The site sends its own for both, so members would otherwise get two.

Subscriptions carry on until cancelled: the website never sets an end date when it creates one. The only end it sets is the year-end stop a payer asks for with the Cancel in their renewal email (`cancel_at` and `metadata.cutoff_at` = 1 March); a subscription ending there is expected, and any unpaid February invoice is voided and raised for staff.

Subscription receipts are sent once per Stripe invoice even though Stripe can deliver an event more than once: website subscriptions record it in `subscriptions/{id}.receiptedInvoices`, and subscriptions set up outside the site (such as the old Bookwhen ones) in `invoiceReceipts/{invoiceId}`. Do not delete these records, or receipts may be sent again.

### Website replacement subscriptions (sandbox)

**Status:** preview email and monthly sandbox checkout only. The full sandbox rehearsal is still to be run.
There is no live cutover command: the website rejects live Stripe checkout keys, and the cancellation
Source key must also be a test key. The local preview below can read live product labels with a restricted
key, but cannot change a live subscription. Do not email the live Bookwhen cohort or cancel their subscriptions yet.

#### 1. Send yourself a preview

Use the same Google Workspace setup as the website: `GOOGLE_WORKSPACE_DELEGATED_USER`,
`GOOGLE_WORKSPACE_SENDER` (or omit it to send as the delegated user), and either
`FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON`. The service account needs
domain-wide delegation for `https://www.googleapis.com/auth/gmail.send`, and Gmail API must be enabled.
No separate email-provider API key is needed. The script requests only the Gmail send scope.

From the repository root, with the website's local settings in the ignored `.env` file:

```bash
export STRIPE_REPLACEMENT_TEST_INBOX='jack.watt@forthcanoeclub.co.uk'
node --env-file=.env scripts/invite-subscription-replacements.mjs --dry-run
```

This sends one professionally formatted `[TEST ONLY]` email with official invitation wording but no working checkout link. It needs neither a
Stripe key nor a Firestore connection. A successful run reports Gmail acceptance, not inbox delivery.
If you already exported the settings in your shell, omit `--env-file=.env`. Each preview invocation sends
a new email. If Gmail fails or times out, check the delegated mailbox's Sent folder before retrying.

##### Working localhost link using the first live subscription

Start the [local emulator stack](DEVELOPMENT.md#run-locally) with its Firestore emulator on
`127.0.0.1:8080` and website on `http://localhost:3000`. To complete real Stripe sandbox checkout,
run the local API with the sandbox `STRIPE_SECRET_KEY` and webhook signing secret as described under
[Stripe testing](DEVELOPMENT.md). The API must have `LOCAL_FIREBASE_EMULATORS=true`,
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, and `GCLOUD_PROJECT=demo-fcc`.

In a separate terminal, keep Workspace settings and the **same Destination sandbox key** in `.env`, then:

```bash
set +x
export STRIPE_REPLACEMENT_TEST_INBOX='jack.watt@forthcanoeclub.co.uk'
read -rs -p 'Read-only Source rk_live key: ' PREVIEW_KEY
printf '\n'
STRIPE_REPLACEMENT_PREVIEW_SOURCE_KEY="$PREVIEW_KEY" \
  node --env-file=.env scripts/invite-subscription-replacements.mjs --dry-run --local-link
unset PREVIEW_KEY
```

Only GET requests are made to live Stripe. The script picks the first active subscription and includes
its product names in the email sent **only to the test inbox**, never to the subscriber. It creates a
24-hour invitation in the **local demo Firestore emulator**. No live customer or subscription identifier
is stored there, and no customer or card is copied. `STRIPE_REPLACEMENT_TEST_URL` may override the local
website URL, but only HTTP `localhost` or `127.0.0.1` is accepted; the emulator must also be loopback and
the project must begin with `demo-`.

Open the email on the computer serving localhost (or with the local port forwarded). Use the test inbox
email at checkout, choose any available monthly website product and supply Stripe sandbox payment details.
This tests the normal basket and monthly setup, not product mapping or annual credit. The receipt reports
**Sandbox checkout confirmed**; the live subscription is never cancelled. Production APIs reject these
preview invitations. The preview does not require the separate replacement feature flag or a live key on
the API. If the local stack was started without Stripe keys, restart just the API with `.env` followed by
`.env.emulator` (`node --env-file=.env --env-file=.env.emulator server.js`) and the test webhook secret.

#### 2. Check the sandbox cohort

Use two isolated Stripe sandboxes. **Source** is the old subscription account; **Destination** is the
account used by website checkout. Create a synthetic Source subscription using the test inbox. In a
private local `replacement-map.json`, map each old Stripe price ID to the approved website product ID
and its shop name. The new price comes from normal website checkout, not from this file or the old invoice:

```json
{ "price_SANDBOX": { "id": "website-product-id", "name": "Website product name" } }
```

Export `STRIPE_SOURCE_ACCOUNT_ID`, `STRIPE_DEST_ACCOUNT_ID` and `STRIPE_REPLACEMENT_SOURCE_KEY`. The
CLI can use a read-only Source test key with access to the account, subscriptions, customers, invoices
and charges. Then run:

```bash
node scripts/invite-subscription-replacements.mjs --dry-run replacement-map.json
```

This checks active and trialling Source subscriptions and sends the same single fictional preview. It
does not email the cohort, write to Stripe or Firestore, or verify the Destination catalogue. Separately
check that each mapped product can actually be bought with monthly payments on staging. For annual
payments, the check accepts supported subscriptions with a settled GBP invoice and an unrefunded charge,
calculates the unused share of the amount actually paid, and reports how many qualify for the card-only
rule. Mixed, unsupported, or unverifiable cases need review.

#### 3. Rehearse one real sandbox checkout

1. On the HTTPS staging API, use the Destination test key for normal checkout and configure its signed
   Stripe webhook. Enable `STRIPE_REPLACEMENT_ENABLED=true` on staging only. Give staging its own
   `STRIPE_REPLACEMENT_SOURCE_KEY` with permission to read the Source account, subscriptions, customers
   and invoices, and to cancel subscriptions. The CLI's read-only key cannot do that. Keep these staging
   settings out of the default production deploy, which does not configure them.
2. In your shell, keep the settings from steps 1 and 2. Also set `STRIPE_REPLACEMENT_TEST_PROJECT`,
   `STRIPE_REPLACEMENT_TEST_URL` and `STRIPE_REPLACEMENT_TOKEN_SECRET` (at least 32 random bytes,
   base64url). Use Firebase Application Default Credentials for the same isolated Firestore project
   as the staging API. Start with only one eligible synthetic subscription for the test inbox:

   ```bash
   node scripts/invite-subscription-replacements.mjs --send-test replacement-map.json
   ```

3. Open the working invitation. Use the original billing email, choose monthly payments for every
   approved replacement product, and complete normal website checkout. No customer or card is copied;
   no PostgreSQL or Stripe customer sharing is needed.
4. Verify both dashboards. The server confirms the order and the new subscription's approved items
   before cancelling the matching Source subscription immediately, without an automatic refund or final
   invoice. Opening the link, leaving checkout, or an unconfirmed payment does not cancel anything.
   On return, the receipt shows the old stop as confirmed, pending or needing review. If cancellation
   fails (for example, Source has an open invoice or Stripe refuses the stop), reconcile it in **Needs
   attention** and in the Source dashboard. Do not ask the subscriber to pay again.

Gmail has no send idempotency key. A functional invitation is recorded before sending, so an unresolved
send blocks automatic resending. Reconcile Gmail Sent and the private Firestore invitation record before
retrying; never delete the record merely to force a resend. Successful sends are skipped on subsequent runs.

#### Before a live cutover

Enable and rehearse live-ready checkout separately, verify Source cancellation permissions, and approve
the cohort and product mapping. Do not bulk-cancel the old subscriptions in advance; non-responders
keep their old subscriptions.

Annual and other non-monthly subscriptions are excluded from functional test invitations. The agreed
annual plan is to apply verified unused credit to the initial amount, then carry any balance forward.
For more than 300 prepaid days left, the planned exception is to register the card at £0 and first
charge on **1 March 2028**. Applying credit, the card-only checkout, and the separate continuation
rules (monthly renewals on the 1st, annual renewals on 1 March, and cancellation only when requested)
are not implemented.

## One-Off Setup

**Scheduled jobs.** As a project owner, before the first deployment that includes them:

```bash
scripts/scheduled-jobs.sh setup <deploy-account-email>
```

This enables the APIs, creates the `fcc-scheduled-jobs` service account (Firestore access, starts the jobs), creates `renewal-job-token` if missing and grants the API and deploy accounts access. The deploy account also gets Cloud Scheduler admin and permission to act as the jobs account. Then add the real JustGo secret with `gcloud secrets versions add justgo-api-secret --data-file=-` before enabling JustGo.

Cloud Scheduler job `fcc-renewals` posts to `/api/jobs/renewals` at 09:00 London on 1, 15 and 27 February with the `renewal-job-token`. Each renewal email also asks about the subscriptions that address pays for, and payers with nothing to renew get an email about just their subscriptions (the reminder only to anyone who has not answered). The 15 and 27 February runs also move subscriptions to the new club year's prices before the 1 March payments; a subscription that cannot be moved is flagged in **Needs attention**. After deploying this change, run `scripts/scheduled-jobs.sh deploy` once so the schedule gains the 27 February run.
Cloud Scheduler job `fcc-welcome-emails` posts to `/api/jobs/welcome-emails` at 06:00 London daily (after the JustGo sync) with the same token, sending the welcome email to members who joined or renewed through JustGo.

**Outage alerts.** Every deployment sets up the **FCC API health** uptime check and **FCC API outage** email policy. The deploy account first needs:

```bash
gcloud services enable monitoring.googleapis.com --project fccwebsite-23cfc
gcloud projects add-iam-policy-binding fccwebsite-23cfc --member serviceAccount:<deploy-account-email> --role roles/monitoring.editor
```

**App Check.** Register the web app with Firebase App Check's reCAPTCHA Enterprise provider and put the public site key in the `VITE_APPCHECK_SITE_KEY` Actions secret (deployment fails without it). Do not add standalone reCAPTCHA scripts. `APP_CHECK_MODE` defaults to `monitor`, which logs missing or invalid tokens but lets requests through. When Cloud Run's `App Check` logs and Firebase's verified-request metrics look right, enable Firebase enforcement for Auth, Firestore and Storage, then set `APP_CHECK_MODE=enforce` and redeploy to protect the API too. Firebase enforcement alone does not protect Cloud Run. Stripe webhooks and the renewal job have their own authentication and are exempt.

### Monitoring and who acts

All monitoring emails currently go to **jack.watt@forthcanoeclub.co.uk**, the interim website maintainer and budget contact.
The Google login and alert recipient need not match. Transfer budget responsibility to the treasurer by changing the
recipient configuration and rerunning setup; do not delete an email channel still used by another budget.

| Alert | Meaning and action |
| --- | --- |
| FCC API outage | Checks from at least two of Google's six regions got no healthy `/health` response within 30 seconds; `/health` also reads Firestore. The website maintainer checks Cloud Run logs, credentials and the latest revision, and rolls back a bad release if needed. Logs Explorer → `resource.type="uptime_url" "UptimeCheckResult"` shows why each check failed. If only distant regions timed out and Cloud Run logged successful requests, it was a network delay: no action is needed and the alert clears itself, as on 21 November 2026. |
| FCC browser errors | The browser reported a fixed error category/page, including caught API/sign-in network failures. Google Analytics or reCAPTCHA scripts blocked by privacy tools are not reported. The maintainer filters Cloud Run logs by `jsonPayload.event="fcc-client-error"` and reproduces the problem. Notifications are limited to once an hour per open incident. |
| FCC scheduled job failures | Scheduler dispatch, JustGo execution or partial renewal/upload work failed. Check Scheduler and execution/API logs; reconcile uncertain JustGo writes before retrying. |
| FCC scheduled job missed or unhealthy | `/health/jobs` found a missed/failed run or could not inspect jobs. Check **Reports & records → Needs attention**, then Scheduler/Run and monitoring permissions. Paused JustGo schedules are intentionally ignored. |
| FCC website monthly budget | Project-only **GBP 5/month**, including credits: actual spend 50% (GBP 2.50), 90% (GBP 4.50), 100% (GBP 5), plus forecast 100%. The budget contact/treasurer checks Billing cost reports for unexpected usage. **This is an alert, not a spending cap**; forecasts and emails can be delayed. |

The job health endpoint checks the four schedules in [scheduled-jobs.sh](scripts/scheduled-jobs.sh), using London time
and a two-hour completion grace. It inspects Cloud Run's latest execution for the JustGo jobs. Checks are cached for
five minutes per API instance, including failed checks. A newly created/reconfigured schedule is checked after its
next due run; an older missed run is not inferred from before that configuration. Renewals are due on 1/15 February,
not every day. Update [jobMonitoring.js](src/utils/jobMonitoring.js) if those schedules change.
The missed-run policy stays disabled until the setup script recognises the deployed `/health/jobs` endpoint.

Browser reports contain only an allowlisted category and route ID, never error messages, stack traces, full URLs,
query strings, form contents, names, email addresses, cookies or persistent visitor identifiers. Each page session
sends at most ten reports, with a one-minute duplicate cooldown; the API additionally limits each IP to ten/minute
per instance. The endpoint is deliberately independent of App Check (which can itself fail), accepts no arbitrary
text and uses the existing baseline limiter. Reports go to existing Google Cloud Logging/Monitoring, not a new
analytics provider, and do not depend on Google Analytics consent. Standard Cloud Run request/security logs still
contain technical data such as IP addresses; operational logs follow the configured Cloud Logging retention.
The privacy starting draft explains this; already-published notices are not overwritten by editing that draft.
Include the wording in the committee's notice review. No CSP origin additions are needed: the existing API origin
already accepts website requests.

One-off permissions, as a project owner:

```bash
gcloud services enable monitoring.googleapis.com logging.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com --project fccwebsite-23cfc
# The API runtime account needs read-only Scheduler/Run access.
gcloud projects add-iam-policy-binding fccwebsite-23cfc --member serviceAccount:<api-runtime-account> --role roles/cloudscheduler.viewer --condition=None
gcloud projects add-iam-policy-binding fccwebsite-23cfc --member serviceAccount:<api-runtime-account> --role roles/run.viewer --condition=None
# Give the deploy account only project-scoped budget read/write, not billing-account administration.
gcloud iam roles create fccWebsiteBudget --project fccwebsite-23cfc --title="FCC project budget setup" --permissions=billing.resourcebudgets.read,billing.resourcebudgets.write,resourcemanager.projects.get
gcloud projects add-iam-policy-binding fccwebsite-23cfc --member serviceAccount:<deploy-account-email> --role projects/fccwebsite-23cfc/roles/fccWebsiteBudget --condition=None
```

The deploy account also needs the Monitoring Editor role described above. Setup can be rerun locally using the
authenticated gcloud account (tokens are never printed or saved):

```bash
API_URL=https://fcc-website-api-votmp6k2oq-nw.a.run.app \
GOOGLE_CLOUD_PROJECT=fccwebsite-23cfc API_ALERT_EMAILS=jack.watt@forthcanoeclub.co.uk \
MONTHLY_BUDGET_GBP=5 node scripts/setup-site-monitoring.mjs --gcloud
```

Setup updates only club-named policies/checks and the matching project budget; unrelated budgets, including an existing
account-wide GBP 1 budget, are left alone. Do not trigger a real failure just to test emails: use the Monitoring
notification channel's test feature and synthetic local error/job tests.

**Google sign-in on the club domain.** Authorise `new.forthcanoeclub.co.uk` in Firebase Authentication and `https://new.forthcanoeclub.co.uk/__/auth/handler` in the OAuth client, keeping the existing `firebaseapp.com` redirect. Then set the `VITE_FIREBASE_AUTH_DOMAIN` variable and redeploy. Removing the variable returns to the secret's domain.

**Admins.** A verified Google account on exactly `forthcanoeclub.co.uk` signs in at `/admin` and is approved under **Website admins** by an existing admin. For the first admin, run `node scripts/grant-admin.js name@forthcanoeclub.co.uk` with the service account; revoke with `--revoke --reason "..."`.

## Configuration Notes

- **Origins.** `PUBLIC_SITE_URL` is the canonical site; `PUBLIC_SITE_URLS` adds origins allowed for Stripe returns and receipts; `CORS_ORIGINS` adds other browser origins. Keep all three frontends (`new.forthcanoeclub.co.uk`, `fccwebsite-23cfc.web.app`, `fccwebsite-23cfc.firebaseapp.com`) allowed. In the workflow's Cloud Run `env_vars`, escape commas as `\,`.
- **Hosting cache.** Page HTML (every path without a file extension, plus `404.html`) is served `no-cache` because it names hashed `/assets/` files that the next release deletes; the assets themselves are immutable. In [firebase.json](firebase.json), keep the `no-store` rules for `/order/**` and the payment pages after that rule: when rules set the same header, the later one wins.
- **Proxy and rate limits.** Cloud Run is one trusted proxy hop (`TRUST_PROXY_HOPS`). Every route is rate limited ([rateLimit.js](src/server/rateLimit.js)); the baseline is 300 requests a minute (`BASELINE_RATE_LIMIT`).
- **Request bodies.** The body parsers (JSON and the raw webhook body) use `inflate: false` and reject compressed bodies. This, and not serialising untrusted query strings with commas, is what keeps the open body-parser and qs advisories from applying. Keep both until patched versions exist.
- **Email.** Sent through Google Workspace as `GOOGLE_WORKSPACE_SENDER`, which must be a mailbox or "send as" alias of `GOOGLE_WORKSPACE_DELEGATED_USER`. Payment problems are emailed to `STAFF_ALERT_EMAIL` (default: the club reply-to address). Set the volunteer coordinator in Reports. Failed notifications can be retried from the admin panels.
- **Admin page edits.** Saves go to `live/web-admin-edit`; merging its review PR into `main` publishes at the next deployment. If the editor warns that the branch needs a rebase:

  ```bash
  git fetch && git checkout live/web-admin-edit && git rebase origin/main && git push --force-with-lease
  ```

- **Service trip discounts.** Admins set the amount, qualifying products, checkout name and trip-card wording in **Reports & records → Credits & discounts → Service trip discounts**, saved to `settings/tripDiscounts`. Until first saved, £10 off applies for annual boat hire and a coaching subscription.
- **Credits.** **Reports & records → Credit items** records items paid outside the website (bank transfer, cash, cheque, other) or given free. It calls `POST /api/admin/credits`, which runs the same checks and fulfilment as checkout. Credited orders cannot be refunded through Stripe.

## Live Mode

`WEBSITE_ISLIVE` (Actions secret, default false) turns on versioning of consent and policy wording and keeps all records (only audited deletes and GDPR erasure remove data). Before turning it on:

- publish the `privacy-notice` and `data-retention` notices;
- settle retention and analytics consent and any open security issues;
- add live-mode Stripe support (checkout accepts test keys only), with its own webhook endpoint, signing secret and restricted keys as above.

GDPR erasure cannot be undone; admin deletion keeps a recovery snapshot. Stripe history and mandates, Google Sheets and JustGo need checking by hand after an erasure.

## JustGo

GDPR erasure automatically removes only the FCC club link, never the JustGo account or other clubs. The API uses the documented v2.2 member lookup and `Organisations/DeleteMember`, taking primary/additional status from the current record and confirming removal with another lookup. It requires `JUSTGO_API_ENABLED=true`, `JUSTGO_API_WRITES_ENABLED=true`, the confirmed `JUSTGO_ORGANISATION_ID` and the `justgo-api-secret` binding. Both flags remain default-off; the workflow binds the secret only when both are true. `scripts/scheduled-jobs.sh setup` also grants the Cloud Run API account access to this secret. For the existing production account, that specific secret-access grant was approved and verified on 16 November 2026; no flags were enabled or live accounts unlinked.

Linked records without a confirmed `justgoMemberId`, ambiguous club status, shared duplicate JustGo links, disabled integration or failed/unconfirmed removal block erasure with local member records retained. Reconcile the link and retry; a retry checks current JustGo state and skips already-removed FCC links. Stripe billing may already have stopped if unlinking fails after its initial validation. Wider JustGo/governing-body data erasure remains the person's separate privacy request. The [customer erasure-summary email (#140)](https://github.com/Riotshielder21/ForthCCWebsite/issues/140) is a separate follow-up, not sent by this implementation.

Both jobs stay paused until their flags are set. Run the read-only discovery locally with the secret from Secret Manager:

```bash
export JUSTGO_API_SECRET="$(gcloud secrets versions access latest --secret=justgo-api-secret)" JUSTGO_API_ENABLED=true JUSTGO_ORGANISATION_ID=...
venv/bin/python jobs/justgo/justgo-admin.py discover
venv/bin/python jobs/justgo/justgo-admin.py snapshot
```

From its output set the variables `JUSTGO_ORGANISATION_ID`, `JUSTGO_MEMBERSHIP_DEFINITIONS`, `JUSTGO_CREDENTIAL_DEFINITIONS`, `JUSTGO_ACTIVE_MEMBERSHIP_STATUSES`, `JUSTGO_ACTIVE_MEMBER_STATUSES`, `JUSTGO_CLUB_MEMBER_ROLE` and optionally `JUSTGO_UNSUSPENDED_LEVELS`. Check the snapshot, then set `JUSTGO_API_ENABLED=true` (starts the daily sync) and later `JUSTGO_API_WRITES_ENABLED=true` (starts the hourly upload). Run a job once with `gcloud run jobs execute fcc-justgo-sync --region europe-west2 --wait`; output is in the Cloud Run job logs. Output may contain personal IDs and free text: do not publish it.

Writes from `justgo-admin.py` need both the write flag and `--confirm-write`.

## When The API Is Down

`/health` checks Firestore as well as the process. On an outage email, look at the Cloud Run logs; if a deployment broke it, send traffic to the previous revision. Otherwise check secrets, billing and Google Cloud status. CORS failures do not trip the uptime check.

## Dependency Checks

Use the lockfile and review dependency changes; do not force audit fixes.

```bash
npm ci
npm audit
docker build -t fcc-api . && docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image --severity HIGH,CRITICAL fcc-api
```

The runtime image is distroless Node 22 with no shell or npm. Keep the dependency overrides in [package.json](package.json) until the parent packages ship safe versions.
