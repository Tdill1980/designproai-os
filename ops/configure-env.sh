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

# Secrets arrive on standard input, one per line, in this exact order:
#
#   1. DesignProAI Supabase secret key (project wozyamlnygaddievzuwn)
#   2. DesignProAI Google AI API key
#   3. Topaz Labs API key for Call 12 — an EMPTY line leaves Call 12 disabled
#
# One channel serves both callers. A human at a terminal gets the hidden
# prompts below; a workflow pipes three lines and bash suppresses the prompts
# because stdin is not a tty. Nothing else changes between the two.
#
# Every line is mandatory, including the third. `read` returns non-zero only at
# end of input, so a caller that sends two lines and stops is a truncated pipe,
# not a decision to disable Call 12 — and being told that is far better than
# silently shipping a droplet whose production packs will fail closed later.
read_secret() {
  local -n destination=$1
  if ! read -r -s -p "$2: " destination; then
    echo >&2
    echo "Secret input ended early: expected $3 on stdin (send an empty line to decline it)" >&2
    exit 5
  fi
  echo
}

read_secret service_key \
  "DesignProAI Supabase secret key (project wozyamlnygaddievzuwn)" \
  "the Supabase secret key"
read_secret google_key \
  "DesignProAI Google AI API key" \
  "the Google AI API key"
# Call 12 enhancement. An empty line writes a dark file with Call 12 disabled;
# a production pack cannot be built until it is set, and it fails closed rather
# than shipping un-enhanced artwork.
read_secret topaz_key \
  "Topaz Labs API key for Call 12 (blank to leave Call 12 disabled)" \
  "the Topaz Labs API key for Call 12"

[[ ${#service_key} -ge 32 ]] || { echo "Supabase secret key is too short" >&2; exit 4; }
[[ ${#google_key} -ge 20 ]] || { echo "Google AI API key is too short" >&2; exit 4; }
[[ -z $topaz_key || ${#topaz_key} -ge 20 ]] || { echo "Topaz API key is too short" >&2; exit 4; }
for secret in "$service_key" "$google_key" "${topaz_key:-x}"; do
  [[ $secret != *$'\n'* && $secret != *$'\r'* ]] || { echo "A secret contains an invalid newline" >&2; exit 4; }
done

# WORKER_SECRET is the shared internal credential between the gateway and the
# two runtime workers. If a previous configuration already agreed on one, keep
# it: rewriting this file to add a provider key must not desynchronize a pair
# that is currently serving, which would turn a secrets change into an outage.
# It is minted fresh whenever the two sides do not already agree.
existing_worker_secret=""
if [[ -s $ROOT/shared/runtime.env && -s $ROOT/shared/gateway.env ]]; then
  runtime_worker=$(sed -n 's/^WORKER_SECRET=//p' "$ROOT/shared/runtime.env" | head -n 1)
  gateway_worker=$(sed -n 's/^WORKER_SECRET=//p' "$ROOT/shared/gateway.env" | head -n 1)
  if [[ -n $runtime_worker && $runtime_worker == "$gateway_worker" && ${#runtime_worker} -ge 32 ]]; then
    existing_worker_secret=$runtime_worker
  fi
  unset runtime_worker gateway_worker
fi
if [[ -n $existing_worker_secret ]]; then
  worker_secret=$existing_worker_secret
  echo "Reusing the internal WORKER_SECRET the gateway and runtime already share."
else
  worker_secret=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
fi
unset existing_worker_secret
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

echo "DesignProAI dark environment is configured with outbound email explicitly disabled. No secret was printed."
if [[ -n $topaz_key ]]; then
  echo "Call 12 upscaling is ENABLED: production packs will enhance through Topaz before QC."
else
  echo "Call 12 upscaling is DISABLED: production packs fail closed until a Topaz key is configured."
fi
unset service_key google_key topaz_key worker_secret
# These files are read into the container environment at start. A release that
# is already running still holds the previous values until it is redeployed.
if docker ps --filter label=com.docker.compose.project=designproai --format '{{.ID}}' 2>/dev/null | grep -q .; then
  echo "NOTE: DesignProAI containers are running with the previous environment. Redeploy to load these values."
fi

