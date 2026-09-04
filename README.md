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

## Guides

- [DEVELOPMENT.md](DEVELOPMENT.md): local setup and checks
- [CONTENT_MANAGEMENT.md](CONTENT_MANAGEMENT.md): admin, Firebase, Workspace, and Stripe setup

