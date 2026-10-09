# Development

Run commands from the repository root in Bash. Use Node 22 LTS and npm; Docker and Stripe CLI are optional for their respective tests.

## Setup

1. Install dependencies and create local configuration without overwriting an existing file:

```bash
npm ci
cp -n .env.example .env
```

2. Review `.env`. Use a test Firebase project, Stripe test keys, and a test GitHub repository/branch for write operations.
3. Set `PUBLIC_SITE_URL=http://localhost:3000`.
4. Remove `NODE_ENV=production` from the local `.env`; Vite chooses its own build mode.
5. Keep any local service-account key at `google-service-account.json`, ignored by Git. Never share or commit it.

Local testing is not isolated automatically: using production credentials can change real Firestore records, send email, create Sheets, or commit to GitHub.

## Frontend Only

```bash
npm run dev
```

Open `http://localhost:3000`. Firebase reads use the configured project. API calls require a running backend; Vite does not proxy `/api`.

## Frontend And API

Terminal 1, start the API on port 3001:

```bash
set -a
source .env
set +a
unset NODE_ENV
PORT=3001 HOST=127.0.0.1 npm run server
```

Terminal 2, start Vite on port 3000 with the local API URL:

```bash
VITE_API_BASE_URL=http://localhost:3001 npm run dev
```

Open `http://localhost:3000/admin`. Check the API separately:

```bash
curl --fail http://localhost:3001/health
```

Restart the server after backend changes. Vite reloads frontend edits automatically. For Google sign-in, Firebase Authentication must allow `localhost`; approved editors need the `admin: true` claim.

## Production Build Locally

Stop Vite and the API first; both instructions below use port 3000.

```bash
set -a
source .env
set +a
unset NODE_ENV
VITE_API_BASE_URL= npm run build
PORT=3000 HOST=127.0.0.1 npm run server
```

Open `http://localhost:3000`. Express serves `dist/` and the API from the same origin. `npm run preview` serves static assets only, not the API.

## Stripe Test

1. Start frontend and API using the two-terminal setup.
2. In another terminal, run:

```bash
stripe listen --forward-to localhost:3001/api/stripe/webhook
```

3. Put the printed signing secret in `.env` as `STRIPE_WEBHOOK_SECRET`, then restart the API.
4. Use a Stripe test secret key as `STRIPE_SECRET_KEY`.
5. Pay with `4242 4242 4242 4242`, any future expiry, and any CVC. Never use real card details for this test.

Checkout is not ready for live payments; see [README.md](README.md#current-limitations).

## Checks Before A PR

```bash
npm run build
node --check server.js
git diff --check
```

Check changed pages on desktop and mobile. For backend changes, optionally build the API image:

```bash
docker build -t fcc-website-api:local .
docker run --rm -p 8088:8080 -e PORT=8080 fcc-website-api:local
```

Open `http://localhost:8088/health`. Without credentials, health can succeed while Firebase/Workspace features remain unavailable. Stop the container with Ctrl+C.

## Local Troubleshooting

- `ETARGET` but the npm package exists: retry the install with `--prefer-online --cache /tmp/fcc-npm-cache`; do not delete the lockfile.
- Port 3000 occupied: stop the existing process or run `npm run dev -- --port 3002` and update `PUBLIC_SITE_URL` for that test.
- `Unexpected token '<'` from an API request: it probably reached the static frontend instead of Express; check `VITE_API_BASE_URL` and restart Vite.
- Sign-in works but editing is denied: check the account's `admin` claim, then sign out and back in.
- Browserslist/bundle-size warnings alone do not mean the build failed; inspect its exit code and final error.

Use [README.md](README.md) for automatic deployment and production recovery. Do not use the legacy VPS installer for Cloud Run/Firebase releases.