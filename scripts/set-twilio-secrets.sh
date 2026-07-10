#!/usr/bin/env bash
# Push Twilio secrets from repo-root .env to the production Cloudflare Worker.
# Requires: wrangler logged in, CLOUDFLARE_API_TOKEN or wrangler OAuth, and .env with:
#   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_VERIFY_SERVICE_SID
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ROOT}/.env"
CONFIG="${ROOT}/worker/wrangler.toml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing ${ENV_FILE}. Copy .env.example and add your Twilio values." >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

missing=()
for key in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM_NUMBER TWILIO_VERIFY_SERVICE_SID; do
  if [[ -z "${!key:-}" ]]; then
    missing+=("$key")
  fi
done

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Missing in .env: ${missing[*]}" >&2
  echo "Create a Verify service in Twilio Console → Verify → Services (SID starts with VA)." >&2
  exit 1
fi

if [[ ! "$TWILIO_FROM_NUMBER" =~ ^\+[0-9]{10,15}$ ]]; then
  echo "TWILIO_FROM_NUMBER must be E.164 (e.g. +18015551234), got: ${TWILIO_FROM_NUMBER}" >&2
  exit 1
fi

put_secret() {
  local name="$1"
  local value="$2"
  printf '%s' "$value" | npx wrangler secret put "$name" --config "$CONFIG"
  echo "Set ${name}"
}

put_secret TWILIO_ACCOUNT_SID "$TWILIO_ACCOUNT_SID"
put_secret TWILIO_AUTH_TOKEN "$TWILIO_AUTH_TOKEN"
put_secret TWILIO_FROM_NUMBER "$TWILIO_FROM_NUMBER"
put_secret TWILIO_VERIFY_SERVICE_SID "$TWILIO_VERIFY_SERVICE_SID"

echo "Done. Test: curl -X POST https://utah-tee-times.tysontiatia.workers.dev/account/phone/start (expect 401, not verify_not_configured)"
