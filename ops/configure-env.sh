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
# Call 12 enhancement. Leave blank to write a dark file with Call 12 disabled;
# a production pack cannot be built until it is set, and it fails closed rather
# than shipping un-enhanced artwork.
read -r -s -p "Topaz Labs API key for Call 12 (blank to leave Call 12 disabled): " topaz_key
echo

[[ ${#service_key} -ge 32 ]] || { echo "Supabase secret key is too short" >&2; exit 4; }
[[ ${#google_key} -ge 20 ]] || { echo "Google AI API key is too short" >&2; exit 4; }
[[ -z $topaz_key || ${#topaz_key} -ge 20 ]] || { echo "Topaz API key is too short" >&2; exit 4; }
for secret in "$service_key" "$google_key" "${topaz_key:-x}"; do
  [[ $secret != *$'\n'* && $secret != *$'\r'* ]] || { echo "A secret contains an invalid newline" >&2; exit 4; }
done

worker_secret=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
runtime_tmp=$(mktemp "$ROOT/shared/runtime.env.new.XXXXXX")
gateway_tmp=$(mktemp "$ROOT/shared/gateway.env.new.XXXXXX")
cleanup() {
  unset service_key google_key topaz_key worker_secret
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
  printf 'DESIGNPRO_OUTBOUND_EMAIL_ENABLED=false\n'
  if [[ -n $topaz_key ]]; then
    printf 'DESIGNPRO_TOPAZ_ENABLED=true\n'
    printf 'TOPAZ_API_KEY=%s\n' "$topaz_key"
    printf 'TOPAZ_MODEL=High Fidelity V2\n'
  else
    printf 'DESIGNPRO_TOPAZ_ENABLED=false\n'
  fi
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
unset service_key google_key worker_secret

echo "DesignProAI dark environment is configured with outbound email explicitly disabled. No secret was printed."

