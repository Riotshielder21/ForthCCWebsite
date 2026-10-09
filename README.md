# Forth Canoe Club website

React/Vite frontend with an Express API, Firebase content, Stripe test checkout, Google Workspace email, and JustGo sync.

## Start locally

```bash
cp .env.example .env
npm install
set -a; source .env; set +a
npm run build
npm run server
```

Open `http://localhost:3000`.

For frontend-only editing, run `npm run dev`.

## Test payments

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Use Stripe test card `4242 4242 4242 4242`.

## Firebase Hosting

```bash
npm run build
npx firebase-tools login
npx firebase-tools deploy --only hosting
```

Pushes to `main` deploy automatically through `.github/workflows/firebase-hosting.yml`. The workflow deploys the Cloud Run API first, then builds/deploys Firebase Hosting. Add the required GitHub Actions secrets described in [CONTENT_MANAGEMENT.md](CONTENT_MANAGEMENT.md).

Firebase Hosting serves the frontend only. Stripe, Gmail, order, and form API routes still need the Express server on Cloud Run or another server. Hosting currently rewrites page routes to the React app and does not proxy `/api` routes.

## Project map

| Path | Purpose |
|---|---|
| `src/pages` | Website pages and admin tools |
| `src/components` | Shared UI and forms |
| `src/constants/products.js` | Offline product fallback |
| `src/utils/content.js` | Firestore product catalog |
| `server.js` | Orders, Stripe, email, forms |
| `firestore.rules` / `storage.rules` | Firebase access rules |
| `scripts` | Deployment and JustGo sync |

Google Workspace forms use a Shared Drive root folder. Each admin-created form gets one response spreadsheet inside the current club-year folder. See [CONTENT_MANAGEMENT.md](CONTENT_MANAGEMENT.md).

Admin page-copy changes are committed to `live/web-admin-edit` and proposed through a PR to `main`. Page-only merges publish on the nightly schedule. Shop product changes currently save directly to Firestore.

## Guides

- [DEVELOPMENT.md](DEVELOPMENT.md): local setup and checks
- [CONTENT_MANAGEMENT.md](CONTENT_MANAGEMENT.md): admin, Firebase, Workspace, and Stripe setup

