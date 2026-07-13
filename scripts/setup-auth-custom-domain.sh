#!/usr/bin/env bash
# Set up Supabase custom Auth domain: auth.tee-time.io
# Requires: supabase CLI logged in as the Tee-Time project OWNER (not a personal side org).
# Paid plan + Custom Domains add-on must be enabled.
set -euo pipefail

PROJECT_REF="nmwlebcvezybfwertlzs"
HOSTNAME="auth.tee-time.io"
PROJECT_HOST="${PROJECT_REF}.supabase.co"

echo "== Tee-Time Auth custom domain =="
echo "Project:  ${PROJECT_REF}"
echo "Hostname: ${HOSTNAME}"
echo

echo "1) Confirm CLI identity owns Tee-Time (nmwlebcvezybfwertlzs)."
echo "   If supabase projects list does not include Utah / Tee-Time, run:"
echo "     supabase logout && supabase login"
echo "   and sign in as the account that owns that project (often the Tee-Time ops Google)."
echo

if ! supabase projects list -o json 2>/dev/null | grep -q "${PROJECT_REF}"; then
  echo "ERROR: Project ${PROJECT_REF} is not visible to the current supabase CLI login."
  echo "Fix login, then re-run this script."
  exit 1
fi

echo "2) Cloudflare DNS — create these records for tee-time.io:"
echo "   Type  CNAME"
echo "   Name  auth"
echo "   Target  ${PROJECT_HOST}"
echo "   Proxy  DNS only (grey cloud)  ← important for Supabase SSL"
echo "   TTL   Auto or 5 min"
echo
echo "   (After domains create, also add the TXT _acme-challenge record Supabase prints.)"
echo
read -r -p "Press Enter when the CNAME exists (grey-cloud)… "

echo "3) Register hostname with Supabase…"
supabase domains create --project-ref "${PROJECT_REF}" --custom-hostname "${HOSTNAME}"

echo
echo "4) Add any TXT validation records Supabase printed above in Cloudflare (DNS only)."
read -r -p "Press Enter when TXT records are saved… "

echo "5) Re-verify (may need a few tries while DNS propagates)…"
for i in 1 2 3 4 5 6; do
  if supabase domains reverify --project-ref "${PROJECT_REF}"; then
    break
  fi
  echo "   Attempt ${i} failed — waiting 30s…"
  sleep 30
done

echo
echo "6) BEFORE activate — add this Google OAuth redirect URI (keep the old one too):"
echo "   https://${HOSTNAME}/auth/v1/callback"
echo "   Google Cloud → Credentials → Tee-Time Web client → Authorized redirect URIs"
echo
read -r -p "Press Enter after Google has the new redirect URI… "

echo "7) Activate…"
supabase domains activate --project-ref "${PROJECT_REF}"

echo
echo "Done. Google should show “continue to ${HOSTNAME}”."
echo "Optional: point app SUPABASE_URL at https://${HOSTNAME} (project URL still works)."
echo "Smoke-test: https://tee-time.io → Sign in with Google"
