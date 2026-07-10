#!/usr/bin/env bash
# Push Worker secrets from repo-root .env to production Cloudflare Worker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
CONFIG="${ROOT}/worker/wrangler.toml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}. Copy .env.example and add your values." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

missing=()
for key in SUPABASE_SERVICE_KEY RESEND_API_KEY TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER TWILIO_VERIFY_SERVICE_SID; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing in .env: ${missing[*]}" >&2
  exit 1
fi

put_secret() {
  local name="$1"
  local value="$2"
  printf '%s' "$value" | npx wrangler secret put "$name" --config "$CONFIG"
  echo "Set ${name}"
}

put_secret SUPABASE_SERVICE_KEY "$SUPABASE_SERVICE_KEY"
put_secret RESEND_API_KEY "$RESEND_API_KEY"
put_secret TWILIO_ACCOUNT_SID "$TWILIO_ACCOUNT_SID"
put_secret TWILIO_AUTH_TOKEN "$TWILIO_AUTH_TOKEN"
put_secret TWILIO_FROM_NUMBER "$TWILIO_FROM_NUMBER"
put_secret TWILIO_VERIFY_SERVICE_SID "$TWILIO_VERIFY_SERVICE_SID"

echo "Done. Worker secrets updated (Supabase, Resend, Twilio)."
