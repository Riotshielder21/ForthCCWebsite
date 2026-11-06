#!/usr/bin/env bash
# One-command local stack: Firebase emulators, test data, the API (port 3002) and the website (port 3000).
#   scripts/localhost_startup.sh            reuse saved emulator data (./emulator-data); seed if there is none
#   scripts/localhost_startup.sh --fresh    start with empty emulators and reseed
#   scripts/localhost_startup.sh --clean    start with empty, unseeded emulators (local test admin only); nothing saved on exit
#   scripts/localhost_startup.sh --preview  serve a production build (vite build + preview) instead of the dev server
# Ctrl+C stops everything and saves emulator data to ./emulator-data (except with --clean).
set -euo pipefail
cd "$(dirname "$0")/.."

fresh=false clean=false preview=false
for arg in "$@"; do
  case "$arg" in
    --fresh) fresh=true ;;
    --clean) clean=true ;;
    --preview) preview=true ;;
    -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done
if [ "$fresh" = true ] && [ "$clean" = true ]; then echo "Use either --fresh or --clean, not both." >&2; exit 2; fi

[ -f .env.emulator ] || cp .env.emulator.example .env.emulator
[ -d node_modules ] || npm ci
set -a; . ./.env.emulator; set +a
# Never let real credentials from the calling shell reach the local stack.
unset NODE_ENV GOOGLE_APPLICATION_CREDENTIALS GITHUB_CONTENT_TOKEN STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET \
  STRIPE_REPORT_SECRET_KEY STRIPE_SUBSCRIPTION_ADMIN_KEY
export METADATA_SERVER_DETECTION=none

# Each background process gets its own process group, so Ctrl+C reaches only this script and shutdown is orderly.
set -m
pids=()
cleanup() {
  trap - EXIT INT TERM
  echo; echo "Stopping local stack..."
  for ((i = ${#pids[@]} - 1; i >= 0; i--)); do
    kill -INT -- "-${pids[i]}" 2>/dev/null || true
    wait "${pids[i]}" 2>/dev/null || true
  done
}
trap cleanup EXIT
trap 'exit 130' INT TERM

wait_for() {
  local name="$1" url="$2" pid="$3" curl_flags="$4" tries=180
  until curl $curl_flags -s -o /dev/null --max-time 2 "$url"; do
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then echo "$name stopped during startup." >&2; exit 1; fi
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then echo "$name did not start within 3 minutes." >&2; exit 1; fi
    sleep 1
  done
  echo "$name ready."
}

emulators_up() {
  for port in 9099 8080 9199; do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/" || return 1; done
}

seed=$fresh
if emulators_up; then
  if [ "$clean" = true ]; then echo "--clean needs empty emulators: stop the Firebase emulators already running first." >&2; exit 1; fi
  echo "Reusing the Firebase emulators already running."
elif [ "$clean" = true ]; then
  # No import, no seed and no export, so saved ./emulator-data is left untouched.
  npx --yes firebase-tools@14.22.0 emulators:start --only auth,firestore,storage --project demo-fcc &
  pids+=($!)
  for port in 9099 8080 9199; do wait_for "Emulator on port $port" "http://127.0.0.1:$port/" "${pids[0]}" ""; done
  node scripts/local-admin.js
  echo "Clean emulators: no test records, only the local test admin account."
else
  emulator_args=(--only auth,firestore,storage --project demo-fcc --export-on-exit=./emulator-data)
  if [ "$fresh" = false ] && [ -f emulator-data/firebase-export-metadata.json ]; then
    emulator_args+=(--import=./emulator-data)
  else
    seed=true
  fi
  npx --yes firebase-tools@14.22.0 emulators:start "${emulator_args[@]}" &
  pids+=($!)
  for port in 9099 8080 9199; do wait_for "Emulator on port $port" "http://127.0.0.1:$port/" "${pids[0]}" ""; done
fi

if [ "$seed" = true ]; then node scripts/seed-emulators.js; fi

node server.js &
pids+=($!)
wait_for "API" "http://127.0.0.1:${PORT}/health" "$!" "-f"

if [ "$preview" = true ]; then
  npx vite build
  npx vite preview --host 127.0.0.1 --port 3000 --strictPort &
else
  npx vite --host 127.0.0.1 --port 3000 --strictPort &
fi
pids+=($!)
wait_for "Website" "http://127.0.0.1:3000/" "$!" "-f"

cat <<EOF

Local stack running (Ctrl+C to stop):
  Website      http://localhost:3000  (Admin in the footer > Sign in as local test admin)
  API          http://localhost:${PORT}/health
  Emulator UI  http://localhost:4000
EOF
# Stop everything if any part exits on its own.
wait -n "${pids[@]}" || true
