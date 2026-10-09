# Forth Canoe Club Website

React frontend on Firebase Hosting; Express API on Cloud Run; data in Firestore and Firebase Storage.

Use [DEVELOPMENT.md](DEVELOPMENT.md) for local setup and testing. This guide covers deployment and operations.

## Deploy Automatically

1. Merge code into `main` to deploy immediately.
2. Page-only changes in `public/content/pages/` deploy at the next daily **18:00 UTC** run (19:00 UK summer time). GitHub schedules may be delayed; keep `main` as the default branch.
3. To deploy sooner, use **GitHub Actions > Deploy Firebase Hosting > Run workflow > main**.

The [workflow](.github/workflows/firebase-hosting.yml) deploys `fcc-website-api` to Cloud Run in `europe-west2`, builds the frontend with the returned API URL, then deploys Hosting and Firebase rules to `fccwebsite-23cfc`. Firebase Hosting does not execute Express or proxy `/api`.

After a release, check the Actions result, Cloud Run revision logs, `CLOUD_RUN_URL/health`, public pages, and admin saves. Health confirms the server responds, not that Stripe, Gmail, or Drive credentials work.

## Admin Changes

1. Sign in at `/admin` with a club Workspace account and Firebase `admin: true` claim.
2. Edit and preview a page. **Save page draft** commits the current page to `live/web-admin-edit`.
3. **Save to web / Create PR** saves the current page, opens/reuses a PR to `main`, and attempts reviewer/email notification to Riotshielder21.
4. Review and merge; publish through the scheduled or manual workflow.

Save each page before switching. Preview storage is browser-local; pending branch drafts are not reloaded by the editor. Use a bot-owned GitHub token and protect `main` with required reviews. After merging, delete the review branch only after checking for other pending work; the next save recreates it from `main`.

Products save directly to Firestore without PR review. Images use Storage. Copy the starter catalogue only once; repeating it can overwrite product edits. Redeploying code does not undo database, image, or Sheet changes.

## Configuration

| Setting | Location |
|---|---|
| Project, region, review branch, Workspace addresses, Drive IDs | Workflow deployment inputs / `env_vars` |
| Frontend Firebase config | GitHub Actions `VITE_FIREBASE_*` secrets; local `.env` |
| Deploy identity | GitHub Actions repository secret `FIREBASE_SERVICE_ACCOUNT` |
| API URL | Cloud Run action output, injected automatically |
| Backend credentials | Google Secret Manager |
| Local settings | Ignored `.env`, based on [.env.example](.env.example) |
| Hosting/rules | [firebase.json](firebase.json), [.firebaserc](.firebaserc), [firestore.rules](firestore.rules), [storage.rules](storage.rules) |

Required GitHub Actions secrets: `FIREBASE_SERVICE_ACCOUNT` (deployment JSON), `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, and `VITE_FIREBASE_APP_ID`. The workflow fails before building if a required Firebase web secret is empty. `VITE_FIREBASE_MESSAGING_SENDER_ID` and `VITE_FIREBASE_MEASUREMENT_ID` (Analytics) are optional. Firebase web settings are embedded in the frontend at build time and are public; never put server credentials in `VITE_` variables.

Cloud Run secret mappings:

```text
GITHUB_CONTENT_TOKEN=github-content-token:latest
FIREBASE_SERVICE_ACCOUNT_JSON=firebase-service-account-json:latest
STRIPE_SECRET_KEY=stripe-test-secret-key:latest
STRIPE_WEBHOOK_SECRET=stripe-test-webhook-secret:latest
```

The GitHub bot token needs Contents, Pull requests, and Issues read/write access restricted to `Riotshielder21/ForthCCWebsite`. Never expose server secrets as `VITE_` variables or commit private JSON keys.

## Cloud And Workspace Setup

1. Enable Cloud Run, Cloud Build, Artifact Registry, Secret Manager, and Firebase services. Initialize Firestore and Storage in Firebase Console. Storage requires Blaze billing; Workspace charity benefits do not cover all Cloud costs. Set budget alerts (not spending caps).
2. Give the deploy identity Cloud Run Admin, Cloud Run Source Developer, Service Usage Consumer, Service Account User on the runtime identity, and Firebase Hosting/rule-deployment permissions.
3. Ensure the actual build identity has Cloud Run Builder and can push to Docker repository `cloud-run-source-deploy` in `europe-west2`.
4. Grant the actual Cloud Run runtime identity Secret Manager Secret Accessor on the secrets above. Verify the identity in service details; it is separate from the deploy identity.
5. Enable Firebase Google sign-in, authorize website hostnames, and assign approved editors the `admin` custom claim through a trusted Admin SDK process.
6. Enable Gmail, Drive, and Sheets APIs. Authorize the service account's numeric OAuth client ID for Workspace delegation with `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/drive`, and `https://www.googleapis.com/auth/spreadsheets`.
7. Give `website@forthcanoeclub.co.uk` file-creation access to the Shared Drive and configure its verified send-as alias `no-reply@forthcanoeclub.co.uk`.

The workflow contains the confirmed Shared Drive/Website Forms IDs. Form Sheets are created under `Website Forms/Forms YYYY-YYYY/`; the club year starts 1 March. This uses Google Sheets, not native Google Forms response submission.

## When Something Breaks

1. Find the first failed Actions step and its permission, resource, and principal. Do not grant Owner/Editor to work around errors.
2. Missing `credentials_json`: check GitHub's `FIREBASE_SERVICE_ACCOUNT` secret. Fork runs do not receive secrets; environment-scoped secrets need a workflow environment.
3. IAM denied: check the correct deploy/build/runtime identity. Inspect Logs Explorer with `protoPayload.status.code=7`; `actAs` needs Service Account User, Artifact Registry errors need repository access, and secret errors need runtime access and enabled versions.
4. Container fails to start: inspect Cloud Run revision logs; reproduce with the Docker commands in DEVELOPMENT. The server must listen on Cloud Run's `PORT` at `0.0.0.0`.
5. Firebase Storage API enable denied: enable `firebasestorage.googleapis.com` yourself as project owner, then initialize the Storage bucket. Service Usage Consumer cannot enable APIs.
6. HTML/JSON parsing error from an API: check the browser request URL and frontend's API base URL; rebuild after correcting the backend destination.
7. Admin denied: check Workspace account, Firebase claim, and authorized hostname; sign out/back in after claim changes. GitHub saves also need a valid bot token and backend deployment.
8. PR/email/Sheet failure: check Cloud Run warnings, token permissions/expiry, Workspace delegation, verified sender, and folder access. PR creation or health success does not prove notification delivery.

Fix code or deploy settings in a feature branch, test locally, and merge to `main`. Start a new workflow run after changing code; rerunning an old job uses its original commit. IAM-only fixes can use **Re-run failed jobs**. Manual Cloud Run settings may be overridden by the workflow.

## Stripe Test Setup

1. In Stripe Dashboard, select a sandbox or Test mode. Use its standard secret key (`sk_test_...`), never a live key.
2. In Stripe Workbench/Webhooks, create an event destination for that same sandbox/test account. Choose **Your account**, event `checkout.session.completed`, and endpoint:

```text
https://fcc-website-api-397447736103.europe-west2.run.app/api/stripe/webhook
```

3. Reveal that endpoint's signing secret (`whsec_...`). It is different from a Stripe CLI forwarding secret.
4. In Google Secret Manager, create `stripe-test-secret-key` with the test API secret and `stripe-test-webhook-secret` with the endpoint signing secret. Do not share either value or put it in GitHub source.
5. Grant the Cloud Run runtime identity Secret Manager Secret Accessor on both. Create the secrets before deploying this workflow, otherwise deployment will fail resolving them.
6. Deploy the updated workflow from `main`. Confirm `PUBLIC_SITE_URL` is the actual frontend URL you are testing; Stripe returns customers there, not to the API URL.
7. From the shop, buy a one-off item with `4242 4242 4242 4242`, a future expiry, and any CVC. Use your own test email. The card is for Stripe test mode only.
8. Confirm a test payment in Stripe, a successful webhook delivery, and the Firebase order status. Check receipt email separately; it depends on Workspace setup.

The hosted Stripe page collects card details; no publishable Stripe key is needed by the current frontend. The API rejects live keys. Prices and order fulfilment still need the hardening listed below before production use. Test payments on this deployed site still create real Firebase test records and may send real emails.

## Recovery And Secrets

- Revert a bad commit through a PR to `main`, then manually run deployment. For urgent recovery, use Cloud Run traffic rollback or Firebase Hosting release rollback; the next workflow redeploys `main`.
- API and Hosting releases are not atomic; check compatibility if Hosting fails after the API has deployed.
- Back up Firestore/Storage before risky edits. Git rollback does not restore customer data, products, images, or Sheets.
- Revoke exposed keys/tokens, replace every affected GitHub/Secret Manager/local copy, and redeploy to load the new credentials.
- Before a manual source upload, inspect `gcloud meta list-files-for-upload`; Docker ignore alone does not prevent uploading credentials to Cloud Build.

## Current Limitations

- Products bypass PR review. Page editors do not reload saved branch drafts; avoid overwriting another admin's pending changes.
- Admin-created Sheets exist, but public dynamic forms/submissions are unfinished. Volunteering uses the legacy fixed-sheet API, which still needs migration to Admin SDK.
- Stripe test keys are mapped from Secret Manager; sandbox credentials and the webhook destination must be configured using Stripe Test Setup above. Subscription renewals, failures, and cancellations are not handled yet.
- Do not accept live payments until trusted server pricing, the public paid-order bypass, paid-status/idempotent webhook handling, and subscription lifecycle updates are fixed and tested. Receipt retry/token behavior also needs validation.
- Legacy VPS/systemd/nginx tooling and JustGo sync are not part of automated deployment.

