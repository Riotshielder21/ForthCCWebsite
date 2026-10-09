# Content and services

## Firebase

1. Copy `.env.example` to `.env`.
2. Add Firebase web-app values.
3. Enable Google sign-in, Firestore, and Storage.
4. Deploy the rules:

```bash
firebase deploy --only firestore:rules,storage
```

## Hosting and GitHub

1. Create a Firebase service-account JSON for deployment.
2. Add the Firebase deployment service-account JSON to GitHub as `FIREBASE_SERVICE_ACCOUNT`.
3. Add each `VITE_FIREBASE_*` value from `.env` as a GitHub Actions secret.
4. Enable Cloud Run, Cloud Build, Artifact Registry, and Secret Manager APIs in project `fccwebsite-23cfc`.
5. Give the GitHub deployment identity permission to deploy Cloud Run and Firebase Hosting, build source, and act as the Cloud Run runtime identity.
6. Give the Cloud Run runtime identity Secret Manager Secret Accessor on `github-content-token` and `firebase-service-account-json`.
7. Push to `main`.

The workflow deploys the Express API to Cloud Run, builds the frontend with the returned API URL, then deploys Hosting and Firebase rules. Main-branch code pushes deploy immediately; page-content-only merges deploy on the nightly schedule.

## Admin editor

1. Add `localhost` and the production domain to Firebase authorized domains.
2. Give approved editors `{ "admin": true }` as a Firebase custom claim.
3. Open `/admin`.
4. Sign in with a `@forthcanoeclub.co.uk` Google account.
5. Select **Copy starter catalog** once.

The editor manages products, prices, descriptions, categories, discounts, and images.

The admin dashboard also lets approved editors choose a public page, edit its labeled copy and external links, preview the current published page, and save changes as versioned JSON in GitHub. Page layout and interactive behavior remain code-managed.

### Permanent page publishing

1. Create a fine-grained GitHub token for a bot/service GitHub account on `Riotshielder21/ForthCCWebsite` with:
	- **Contents: Read and write** (create branch and update page JSON)
	- **Pull requests: Read and write** (create PRs and request reviews)
	- **Issues: Read and write** (assign the PR to the administrator)
2. In Secret Manager, create `github-content-token` and store that token.
3. Create `firebase-service-account-json` and store the Workspace-delegated service-account JSON.
4. Set Cloud Run secret environment variables:

```text
GITHUB_CONTENT_TOKEN = github-content-token:latest
FIREBASE_SERVICE_ACCOUNT_JSON = firebase-service-account-json:latest
```

5. Set these Cloud Run variables:

```text
GITHUB_REPOSITORY=Riotshielder21/ForthCCWebsite
GITHUB_BRANCH=main
GITHUB_CONTENT_BRANCH=live/web-admin-edit
GITHUB_COMMIT_EMAIL=website@forthcanoeclub.co.uk
GITHUB_PR_ASSIGNEE=Riotshielder21
GITHUB_PR_NOTIFICATION_EMAIL=Riotshielder21@gmail.com
```

6. Add `GOOGLE_SHARED_DRIVE_ID` and `GOOGLE_FORMS_ROOT_FOLDER_ID` as GitHub Actions secrets. The workflow requests `Riotshielder21` as PR reviewer by default.
7. Push the workflow to `main`. It deploys the API first and injects the resulting Cloud Run URL into the frontend build automatically.
8. Admin page saves write `public/content/pages/{pageId}.json` to `live/web-admin-edit`.

Optional manual Cloud Run deploy (after creating secrets and filling in the two Drive IDs):

```bash
gcloud run deploy fcc-website-api \
	--source . \
	--project fccwebsite-23cfc \
	--region europe-west2 \
	--allow-unauthenticated \
	--set-env-vars GITHUB_REPOSITORY=Riotshielder21/ForthCCWebsite,GITHUB_BRANCH=main,GITHUB_CONTENT_BRANCH=live/web-admin-edit,GITHUB_COMMIT_EMAIL=website@forthcanoeclub.co.uk,GITHUB_PR_ASSIGNEE=Riotshielder21,GITHUB_PR_NOTIFICATION_EMAIL=Riotshielder21@gmail.com,GOOGLE_WORKSPACE_DELEGATED_USER=website@forthcanoeclub.co.uk,GOOGLE_WORKSPACE_SENDER=no-reply@forthcanoeclub.co.uk,GOOGLE_SHARED_DRIVE_ID=YOUR_DRIVE_ID,GOOGLE_FORMS_ROOT_FOLDER_ID=YOUR_FOLDER_ID,PUBLIC_SITE_URL=https://forthcanoeclub.co.uk \
	--set-secrets GITHUB_CONTENT_TOKEN=github-content-token:latest,FIREBASE_SERVICE_ACCOUNT_JSON=firebase-service-account-json:latest
```

The admin uses **Save page draft** to preview edits and commit them to `live/web-admin-edit`. **Save to web / Create PR** saves the current page if needed, then opens or updates the PR to `main`; the first PR sends a notification email to `GITHUB_PR_NOTIFICATION_EMAIL` through the configured Workspace Gmail API. `GITHUB_PR_ASSIGNEE` is a GitHub username, not an email address. Use a bot token so the human reviewer can approve the PR.

Page-content-only commits skip the immediate deploy. The Hosting workflow runs nightly at **18:00 UTC**; after you approve and merge the PR to `main`, that scheduled workflow deploys the approved content. Code changes pushed to `main` still deploy immediately. Use **Actions → Deploy Firebase Hosting → Run workflow** to publish an approved merge early.

Cloud Run must allow unauthenticated HTTP so the public website can reach it; admin write endpoints independently verify Firebase ID tokens, the `admin` claim, and club email domain. Keep `GITHUB_CONTENT_TOKEN` and service-account JSON server-side only. The current PR workflow covers page copy; shop products still save directly to Firestore and do not go through PR review yet.

The runtime service account must have Secret Manager Secret Accessor on both referenced secrets. The GitHub Actions deployment identity also needs permission to deploy Cloud Run and use the runtime service account.

## Google Workspace forms and email

The website account should have access to one Shared Drive and one root folder:

```text
ForthCommittee Shared Drive/
└── Test_Website/
    └── Website Forms/
	├── Forms 2025-2026/
	├── Forms 2026-2027/
	└── ...
```

Give the service account domain-wide delegation for:

```text
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/spreadsheets
```

Place the JSON file at `google-service-account.json` and set:

```env
GOOGLE_WORKSPACE_DELEGATED_USER=website@forthcanoeclub.co.uk
GOOGLE_WORKSPACE_SENDER=no-reply@forthcanoeclub.co.uk
PUBLIC_SITE_URL=http://localhost:3000
FIREBASE_SERVICE_ACCOUNT_PATH=./google-service-account.json
GOOGLE_SHARED_DRIVE_ID=your_shared_drive_id_here
GOOGLE_FORMS_ROOT_FOLDER_ID=your_forms_root_folder_id_here
GOOGLE_FORMS_TIMEZONE=Europe/London
```

Support: `jack.watt@forthcanoeclub.co.uk`.

Firebase stores form definitions in `forms`. Google Drive stores the response spreadsheet. When an admin creates a form through the admin API, the server creates one spreadsheet in the current club-year folder and stores its ID in Firebase. The admin account must have the `admin` custom claim.

The existing volunteering form still uses the legacy fixed-sheet path. Migrate it to the new `forms` collection once the public dynamic-form page is added; do not create new fixed sheets for new forms.

## Stripe test mode

1. Add `sk_test_...` as `STRIPE_SECRET_KEY` in `.env`.
2. Run:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

3. Add the printed `whsec_...` as `STRIPE_WEBHOOK_SECRET`.
4. Use `4242 4242 4242 4242` at checkout.

The server creates Checkout sessions. Monthly subscription items use Stripe recurring prices; annual and one-off items remain one-time charges. The webhook confirms payment and records the Stripe payment or subscription ID in Firebase.

## Product fallback

`src/constants/products.js` is used only when Firestore has no products. After the first catalog copy, use `/admin` for updates.

## Data ownership

Firebase is the website system of record:

- `products`: shop catalogue, prices, descriptions, images, and display settings
- `orders`: customer email, items, total, order status, Stripe IDs, receipt access hash, and timestamps
- `lists`: volunteer, equipment, and other form submissions
- `discountCodes`: generated voucher and volunteer discount codes
- `artifacts/.../members`: synced member verification data

Stripe stores payment-processing data:

- Checkout sessions and payment intents
- Payment status, amount, currency, refunds, and disputes
- Stripe customer/payment-method data where Stripe creates it

The site stores only the Stripe IDs and payment status needed for reconciliation. It does not store card numbers or CVV data. Stripe does not replace Firebase as the catalogue, customer receipt, membership-information, or form-submission store.

Customer access uses a 90-day emailed link. Firebase stores a hash of the link token, not the token itself; the original token exists only in the email URL.