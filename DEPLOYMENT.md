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

The project owner enabled both policies on 16 November 2026. Deploy the updated API so new records contain `ttlAt`. For a fresh project or older records:

```bash
GCLOUD_PROJECT=fccwebsite-23cfc node scripts/migrate-email-ttl.js --gcloud
GCLOUD_PROJECT=fccwebsite-23cfc node scripts/migrate-email-ttl.js --gcloud --apply
gcloud firestore fields ttls update ttlAt --collection-group=emailCodes --enable-ttl --project=fccwebsite-23cfc
gcloud firestore fields ttls update ttlAt --collection-group=emailSessions --enable-ttl --project=fccwebsite-23cfc
gcloud firestore fields ttls list --project=fccwebsite-23cfc
```

Without `--apply` the migration is read-only. It writes only `ttlAt`, logs counts rather than personal information, and refuses to overwrite a document changed since it was read. Rerun it after deploying if the older API created more records in the meantime. Use application default credentials instead by omitting `--gcloud`.

## Stripe Dashboard

Do this in each mode (test now, live later); each endpoint has its own signing secret.

- **Webhook endpoint:** `https://fcc-website-api-397447736103.europe-west2.run.app/api/stripe/webhook` with these eight events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.payment_failed`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`. Put its signing secret in `stripe-test-webhook-secret`.
- **Retries:** under **Billing → Revenue recovery → Retries**, use Smart Retries (or a fixed schedule), set **If all retries for a payment fail** to **Cancel the subscription**, and include Bacs Direct Debit.
- **Customer emails:** turn off Stripe's own failed-payment and successful-payment emails. The site sends its own for both, so members would otherwise get two.

Monthly receipts are sent once per Stripe invoice even though Stripe can deliver an event more than once: website subscriptions record it in `subscriptions/{id}.receiptedInvoices`, and subscriptions set up outside the site (such as the old Bookwhen ones) in `invoiceReceipts/{invoiceId}`. Do not delete these records, or receipts may be sent again.

## One-Off Setup

**Scheduled jobs.** As a project owner, before the first deployment that includes them:

```bash
scripts/scheduled-jobs.sh setup <deploy-account-email>
```

This enables the APIs, creates the `fcc-scheduled-jobs` service account (Firestore access, starts the jobs), creates `renewal-job-token` if missing and grants the API and deploy accounts access. The deploy account also gets Cloud Scheduler admin and permission to act as the jobs account. Then add the real JustGo secret with `gcloud secrets versions add justgo-api-secret --data-file=-` before enabling JustGo.

Cloud Scheduler job `fcc-renewals` posts to `/api/jobs/renewals` at 09:00 London on 1 and 15 February with the `renewal-job-token`.
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
| FCC API outage | `/health` cannot read Firestore. The website maintainer checks Cloud Run logs, credentials and the latest revision, and rolls back a bad release if needed. |
| FCC browser errors | The browser reported a fixed error category/page, including caught API/sign-in network failures. The maintainer filters Cloud Run logs by `jsonPayload.event="fcc-client-error"` and reproduces the problem. Notifications are limited to once an hour per open incident. |
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
