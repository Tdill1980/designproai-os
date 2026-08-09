#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
ROOT=/opt/designproai
PROJECT_URL=https://wozyamlnygaddievzuwn.supabase.co
PUBLISHABLE_KEY=sb_publishable_fXHc8sn8AgTY56RKa6zyvQ_5Dt2eDR3
TUS_ENDPOINT=https://wozyamlnygaddievzuwn.storage.supabase.co/storage/v1/upload/resumable

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ ${1:-} == CONFIGURE_DESIGNPRO_SECRETS_ONLY ]] || { echo "Confirmation token required" >&2; exit 2; }
[[ -d $ROOT/shared && ! -L $ROOT/shared ]] || { echo "Run install.sh first" >&2; exit 3; }

umask 077
read -r -s -p "DesignProAI Supabase secret key (project wozyamlnygaddievzuwn): " service_key
echo
read -r -s -p "DesignProAI Google AI API key: " google_key
echo
read -r -s -p "DesignProAI Resend API key: " resend_key
echo
read -r -p "Verified Resend sender (for example DesignProAI WrapBox <delivery@designproai.com>): " resend_from
read -r -p "Type RESEND_DOMAIN_VERIFIED to attest that sender domain is verified: " resend_attestation

[[ ${#service_key} -ge 32 ]] || { echo "Supabase secret key is too short" >&2; exit 4; }
[[ ${#google_key} -ge 20 ]] || { echo "Google AI API key is too short" >&2; exit 4; }
[[ ${#resend_key} -ge 20 ]] || { echo "Resend API key is too short" >&2; exit 4; }
[[ $resend_from == *"@"* && $resend_from != *$'\n'* && $resend_from != *$'\r'* ]] || { echo "Verified Resend sender is invalid" >&2; exit 4; }
[[ $resend_attestation == RESEND_DOMAIN_VERIFIED ]] || { echo "Resend verified-domain attestation was not provided" >&2; exit 4; }
for secret in "$service_key" "$google_key" "$resend_key"; do
  [[ $secret != *$'\n'* && $secret != *$'\r'* ]] || { echo "A secret contains an invalid newline" >&2; exit 4; }
done

worker_secret=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
runtime_tmp=$(mktemp "$ROOT/shared/runtime.env.new.XXXXXX")
gateway_tmp=$(mktemp "$ROOT/shared/gateway.env.new.XXXXXX")
cleanup() {
  unset service_key google_key resend_key resend_from resend_attestation worker_secret
  [[ ! -e ${runtime_tmp:-} ]] || rm -f -- "$runtime_tmp"
  [[ ! -e ${gateway_tmp:-} ]] || rm -f -- "$gateway_tmp"
}
trap cleanup EXIT

{
  printf 'SUPABASE_URL=%s\n' "$PROJECT_URL"
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$service_key"
  printf 'WORKER_SECRET=%s\n' "$worker_secret"
  printf 'GOOGLE_AI_API_KEY=%s\n' "$google_key"
  printf 'GOOGLE_IMAGE_MODEL=gemini-3-pro-image\n'
  printf 'DESIGNPRO_APP_ORIGIN=https://os.designproai.com\n'
  printf 'DESIGNPRO_SPOOL_DIR=/var/lib/designproai/spool\n'
  printf 'SUPABASE_TUS_ENDPOINT=%s\n' "$TUS_ENDPOINT"
  printf 'RESEND_API_KEY=%s\n' "$resend_key"
  printf 'RESEND_FROM=%s\n' "$resend_from"
  printf 'RESEND_FROM_VERIFIED=true\n'
} > "$runtime_tmp"
{
  printf 'SUPABASE_URL=%s\n' "$PROJECT_URL"
  printf 'SUPABASE_PUBLISHABLE_KEY=%s\n' "$PUBLISHABLE_KEY"
  printf 'DESIGNPRO_APP_ORIGIN=https://os.designproai.com\n'
  printf 'DESIGNPRO_RUNTIME_INTERNAL_URL=http://runtime-1:3001\n'
  printf 'WORKER_SECRET=%s\n' "$worker_secret"
} > "$gateway_tmp"

chown root:root "$runtime_tmp" "$gateway_tmp"
chmod 0600 "$runtime_tmp" "$gateway_tmp"
python3 "$OPS_DIR/validate-env.py" "$runtime_tmp" "$gateway_tmp"
mv -f -- "$runtime_tmp" "$ROOT/shared/runtime.env"
mv -f -- "$gateway_tmp" "$ROOT/shared/gateway.env"
trap - EXIT
unset service_key google_key resend_key resend_from resend_attestation worker_secret

echo "DesignProAI environment files are configured. No secret was printed."
