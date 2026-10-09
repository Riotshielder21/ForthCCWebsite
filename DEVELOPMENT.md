# FCC Website - Local Development Guide

Complete guide for local development, testing, and live editing of the Forth Canoe Club website.

## Prerequisites

**One-time system setup:**

```bash
sudo apt update
sudo apt install -y nodejs npm python3 python3-pip python3-venv
```

Verify installation:
```bash
# Development

## Setup

```bash
cd /home/jwatt/FCCWebsite
npm install
cp .env.example .env
```

Add Firebase values to `.env`. Add Stripe and Workspace values when testing payments or email.

## Run the full app

```bash
set -a; source .env; set +a
npm run build
npm run server
```

Open `http://localhost:3000`.

For frontend-only editing: `npm run dev`.

## Test Stripe

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the printed `whsec_...` into `.env`, restart the server, and use `4242 4242 4242 4242` at checkout.

## Checks

```bash
npx vite build --minify esbuild
node --check server.js
git diff --check
```

## JustGo sync

```bash
source venv/bin/activate
python3 scripts/justgo-sync.py
```

## Deploy

```bash
sudo ./scripts/deploy.sh email@example.com example.org
```

See [CONTENT_MANAGEMENT.md](CONTENT_MANAGEMENT.md) for Firebase, Workspace, Stripe, and admin setup.