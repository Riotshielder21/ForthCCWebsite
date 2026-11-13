# Deployment

How the live site is deployed, configured and kept running. For what each part does, see [README.md](README.md); to run it locally, see [DEVELOPMENT.md](DEVELOPMENT.md).

## What A Deployment Does

[firebase-hosting.yml](.github/workflows/firebase-hosting.yml) runs on pushes to `main` (except page-content-only pushes), on the 1st of each month at 18:00 UTC, and by hand. In order it:

1. Deploys the API to Cloud Run (`fcc-website-api`, `europe-west2`).
2. Checks that all three frontends can call the API (CORS preflight).
3. Builds the website against the new API URL.
4. Deploys Hosting, **Firestore rules** and Storage rules.
5. Rebuilds the JustGo jobs and updates the Cloud Scheduler jobs ([scheduled-jobs.sh](scripts/scheduled-jobs.sh)).
6. Updates the API uptime check and outage email ([setup-api-monitoring.mjs](scripts/setup-api-monitoring.mjs)).

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
| `justgo-api-secret` | (JustGo jobs) | Created as a placeholder by `scheduled-jobs.sh setup` |

`STRIPE_REPORT_SECRET_KEY` (optional, server only) gives reports their own key; without it they use `STRIPE_SECRET_KEY`.

**GitHub Actions secrets:** `FIREBASE_SERVICE_ACCOUNT` (the deploy account), the `VITE_FIREBASE_*` web config, `VITE_APPCHECK_SITE_KEY`, and optionally `WEBSITE_ISLIVE`.

**GitHub Actions variables** (Settings → Secrets and variables → Actions → Variables, applied on the next deploy): `APP_CHECK_MODE`, `VITE_FIREBASE_AUTH_DOMAIN` and the `JUSTGO_*` settings ([JustGo](#justgo)). Outage email recipients are `API_ALERT_EMAILS` in the workflow file.

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

- **Trip discounts.** Admins set the amount, qualifying products, checkout name and trip-card wording in **Reports & records → Trip discounts**, saved to `settings/tripDiscounts`. Until first saved, £10 off applies for annual boat hire and a coaching subscription.
- **Credits.** **Reports & records → Credit items** records items paid outside the website (bank transfer, cash, cheque, other) or given free. It calls `POST /api/admin/credits`, which runs the same checks and fulfilment as checkout. Credited orders cannot be refunded through Stripe.

## Live Mode

`WEBSITE_ISLIVE` (Actions secret, default false) turns on versioning of consent and policy wording and keeps all records (only audited deletes and GDPR erasure remove data). Before turning it on:

- publish the `privacy-notice` and `data-retention` notices;
- settle retention and analytics consent and any open security issues;
- add live-mode Stripe support (checkout accepts test keys only), with its own webhook endpoint, signing secret and restricted keys as above.

GDPR erasure cannot be undone; admin deletion keeps a recovery snapshot. Stripe history and mandates, Google Sheets and JustGo need checking by hand after an erasure.

## JustGo

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
