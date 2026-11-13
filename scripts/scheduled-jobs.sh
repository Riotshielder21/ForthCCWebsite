#!/usr/bin/env bash
# Scheduled jobs on Google Cloud (replaces the old VM systemd timers):
#   fcc-justgo-sync     Cloud Run job, daily 04:00   (paused unless JUSTGO_API_ENABLED=true)
#   fcc-justgo-upload   Cloud Run job, hourly        (paused unless JUSTGO_API_WRITES_ENABLED=true too)
#   fcc-renewals        POST <API_URL>/api/jobs/renewals, 09:00 on 1 and 15 February
#   fcc-welcome-emails  POST <API_URL>/api/jobs/welcome-emails, daily 06:00 (after the JustGo sync)
#
#   scripts/scheduled-jobs.sh setup <deploy-account-email>   one-off, as a project owner
#   scripts/scheduled-jobs.sh deploy                         every deployment (API_URL required)
set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-fccwebsite-23cfc}"
REGION="${REGION:-europe-west2}"
JOBS_ACCOUNT="fcc-scheduled-jobs@${PROJECT}.iam.gserviceaccount.com"
SOURCE_DIR="$(cd "$(dirname "$0")/../jobs/justgo" && pwd)"
TIME_ZONE="Europe/London"
cloud=(--project "$PROJECT")

setup() {
  local deployer="${1:?Usage: scripts/scheduled-jobs.sh setup <deploy-account-email>}"
  gcloud services enable run.googleapis.com cloudscheduler.googleapis.com cloudbuild.googleapis.com \
    artifactregistry.googleapis.com secretmanager.googleapis.com "${cloud[@]}"

  gcloud iam service-accounts describe "$JOBS_ACCOUNT" "${cloud[@]}" >/dev/null 2>&1 ||
    gcloud iam service-accounts create fcc-scheduled-jobs --display-name "FCC scheduled jobs" "${cloud[@]}"
  # Runs the JustGo jobs (Firestore read/write) and lets Cloud Scheduler start them.
  for role in roles/datastore.user roles/run.invoker; do
    gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$JOBS_ACCOUNT" --role "$role" --condition None >/dev/null
  done

  # Cloud Run needs the secret to exist. A placeholder is harmless: the jobs send nothing until JUSTGO_API_ENABLED=true.
  if ! gcloud secrets describe justgo-api-secret "${cloud[@]}" >/dev/null 2>&1; then
    printf %s 'not-configured' | gcloud secrets create justgo-api-secret --data-file=- "${cloud[@]}"
    echo "Created justgo-api-secret with a placeholder. Before enabling JustGo, add the real secret:" >&2
    echo "  printf %s 'REAL_SECRET' | gcloud secrets versions add justgo-api-secret --data-file=- --project $PROJECT" >&2
  fi
  gcloud secrets add-iam-policy-binding justgo-api-secret --member "serviceAccount:$JOBS_ACCOUNT" \
    --role roles/secretmanager.secretAccessor "${cloud[@]}" >/dev/null

  if ! gcloud secrets describe renewal-job-token "${cloud[@]}" >/dev/null 2>&1; then
    openssl rand -hex 32 | tr -d '\n' | gcloud secrets create renewal-job-token --data-file=- "${cloud[@]}"
  fi
  local api_account
  api_account="$(gcloud run services describe fcc-website-api --region "$REGION" "${cloud[@]}" \
    --format 'value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"
  [ -n "$api_account" ] || api_account="$(gcloud projects describe "$PROJECT" --format 'value(projectNumber)')-compute@developer.gserviceaccount.com"
  # The API checks the token; the deploy account copies it into the Cloud Scheduler request.
  for member in "$api_account" "$deployer"; do
    gcloud secrets add-iam-policy-binding renewal-job-token --member "serviceAccount:$member" \
      --role roles/secretmanager.secretAccessor "${cloud[@]}" >/dev/null
  done

  gcloud iam service-accounts add-iam-policy-binding "$JOBS_ACCOUNT" --member "serviceAccount:$deployer" \
    --role roles/iam.serviceAccountUser "${cloud[@]}" >/dev/null
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$deployer" \
    --role roles/cloudscheduler.admin --condition None >/dev/null
  echo "Scheduled-job setup complete for $PROJECT."
}

# Creates or updates an HTTP Cloud Scheduler job; extra arguments are passed to both create and update.
upsert_schedule() {
  local name="$1" schedule="$2" uri="$3"; shift 3
  local action=create
  gcloud scheduler jobs describe "$name" --location "$REGION" "${cloud[@]}" >/dev/null 2>&1 && action=update
  gcloud scheduler jobs "$action" http "$name" --location "$REGION" "${cloud[@]}" --schedule "$schedule" \
    --time-zone "$TIME_ZONE" --uri "$uri" --http-method POST "$@" >/dev/null
  echo "Scheduled $name ($schedule $TIME_ZONE)"
}

set_schedule_enabled() {
  local name="$1" enabled="$2" state
  state="$(gcloud scheduler jobs describe "$name" --location "$REGION" "${cloud[@]}" --format 'value(state)')"
  if [ "$enabled" = true ] && [ "$state" != ENABLED ]; then
    gcloud scheduler jobs resume "$name" --location "$REGION" "${cloud[@]}" >/dev/null
  elif [ "$enabled" != true ] && [ "$state" != PAUSED ]; then
    gcloud scheduler jobs pause "$name" --location "$REGION" "${cloud[@]}" >/dev/null
  fi
  echo "$name: $([ "$enabled" = true ] && echo enabled || echo paused)"
}

deploy() {
  local api_url="${API_URL:?Set API_URL to the deployed API URL.}"
  local reads="${JUSTGO_API_ENABLED:-false}" writes="${JUSTGO_API_WRITES_ENABLED:-false}"
  env_file="$(mktemp)"
  trap 'rm -f "$env_file"' EXIT
  # JSON is valid YAML, and keeps the JSON-valued settings intact.
  node --input-type=module -e '
    const names = ["JUSTGO_API_ENABLED", "JUSTGO_API_WRITES_ENABLED", "JUSTGO_ORGANISATION_ID", "JUSTGO_MEMBERSHIP_DEFINITIONS",
      "JUSTGO_CREDENTIAL_DEFINITIONS", "JUSTGO_ACTIVE_MEMBERSHIP_STATUSES", "JUSTGO_ACTIVE_MEMBER_STATUSES",
      "JUSTGO_CLUB_MEMBER_ROLE", "JUSTGO_UNSUSPENDED_LEVELS", "JUSTGO_UPLOAD_MAX_ATTEMPTS", "JUSTGO_UPLOAD_STAFF_AFTER"];
    const env = Object.fromEntries(names.filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
    env.JUSTGO_API_ENABLED ??= "false";
    env.JUSTGO_API_WRITES_ENABLED ??= "false";
    process.stdout.write(JSON.stringify(env));
  ' > "$env_file"

  local job_settings=(--region "$REGION" "${cloud[@]}" --service-account "$JOBS_ACCOUNT" --env-vars-file "$env_file"
    --set-secrets JUSTGO_API_SECRET=justgo-api-secret:latest --max-retries 0 --task-timeout 30m --quiet)
  gcloud run jobs deploy fcc-justgo-sync --source "$SOURCE_DIR" --args justgo-sync.py "${job_settings[@]}"
  local image
  image="$(gcloud run jobs describe fcc-justgo-sync --region "$REGION" "${cloud[@]}" \
    --format 'value(spec.template.spec.template.spec.containers[0].image)')"
  [ -n "$image" ] || { echo "Could not read the fcc-justgo-sync image." >&2; exit 1; }
  gcloud run jobs deploy fcc-justgo-upload --image "$image" --args justgo-upload.py "${job_settings[@]}"

  local run_api="https://run.googleapis.com/v2/projects/$PROJECT/locations/$REGION/jobs"
  upsert_schedule fcc-justgo-sync '0 4 * * *' "$run_api/fcc-justgo-sync:run" --oauth-service-account-email "$JOBS_ACCOUNT"
  upsert_schedule fcc-justgo-upload '30 * * * *' "$run_api/fcc-justgo-upload:run" --oauth-service-account-email "$JOBS_ACCOUNT"
  set_schedule_enabled fcc-justgo-sync "$reads"
  set_schedule_enabled fcc-justgo-upload "$([ "$reads" = true ] && [ "$writes" = true ] && echo true || echo false)"

  local token header_flag=--headers
  token="$(gcloud secrets versions access latest --secret renewal-job-token "${cloud[@]}")"
  [ -z "${GITHUB_ACTIONS:-}" ] || echo "::add-mask::$token"
  gcloud scheduler jobs describe fcc-renewals --location "$REGION" "${cloud[@]}" >/dev/null 2>&1 && header_flag=--update-headers
  upsert_schedule fcc-renewals '0 9 1,15 2 *' "${api_url%/}/api/jobs/renewals" \
    "$header_flag" "Authorization=Bearer $token" --attempt-deadline 600s
  header_flag=--headers
  gcloud scheduler jobs describe fcc-welcome-emails --location "$REGION" "${cloud[@]}" >/dev/null 2>&1 && header_flag=--update-headers
  upsert_schedule fcc-welcome-emails '0 6 * * *' "${api_url%/}/api/jobs/welcome-emails" \
    "$header_flag" "Authorization=Bearer $token" --attempt-deadline 600s
}

case "${1:-}" in
  setup) shift; setup "$@" ;;
  deploy) deploy ;;
  *) echo "Usage: scripts/scheduled-jobs.sh setup <deploy-account-email> | deploy" >&2; exit 2 ;;
esac
