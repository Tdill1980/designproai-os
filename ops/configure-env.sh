#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
ROOT=/opt/designproai-os
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
#   4. Stripe secret key — an EMPTY line leaves checkout disabled
#   5. Stripe webhook signing secret — an EMPTY line leaves checkout disabled
#
# One channel serves both callers. A human at a terminal gets the hidden
# prompts below; a workflow pipes five lines and bash suppresses the prompts
# because stdin is not a tty. Nothing else changes between the two.
#
# Every line is mandatory, including the third. `read` returns non-zero only at
# end of input, so a caller that stops short is a truncated pipe, not a decision
# to disable a feature — and being told that is far better than
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
# Checkout. Both lines are always sent -- empty when checkout is not configured
# -- for the same reason the Topaz line is: a short pipe is a truncated channel,
# and the reader would consume whatever followed as a credential.
read_secret stripe_secret \
  "Stripe secret key (blank to leave checkout disabled)" \
  "the Stripe secret key"
read_secret stripe_webhook \
  "Stripe webhook signing secret (blank to leave checkout disabled)" \
  "the Stripe webhook signing secret"

[[ ${#service_key} -ge 32 ]] || { echo "Supabase secret key is too short" >&2; exit 4; }
[[ ${#google_key} -ge 20 ]] || { echo "Google AI API key is too short" >&2; exit 4; }
[[ -z $topaz_key || ${#topaz_key} -ge 20 ]] || { echo "Topaz API key is too short" >&2; exit 4; }
# Either both halves of checkout or neither. Half a payment configuration is
# worse than none: it can charge a customer and never record the entitlement.
if [[ ( -n $stripe_secret && -z $stripe_webhook ) || ( -z $stripe_secret && -n $stripe_webhook ) ]]; then
  echo "Checkout needs BOTH the Stripe secret key and the webhook signing secret, or neither" >&2
  exit 4
fi
[[ -z $stripe_secret || ${#stripe_secret} -ge 20 ]] || { echo "Stripe secret key is too short" >&2; exit 4; }
[[ -z $stripe_webhook || ${#stripe_webhook} -ge 20 ]] || { echo "Stripe webhook secret is too short" >&2; exit 4; }
for secret in "$service_key" "$google_key" "${topaz_key:-x}" "${stripe_secret:-x}" "${stripe_webhook:-x}"; do
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
# Resolve the panel-finishing flag before the file is rewritten: explicit
# instruction from this deploy wins, otherwise whatever the running system
# already had, otherwise off. Read from the LIVE file, not the temp one.
atlas_panel_finish=${ATLAS_PANEL_FINISH:-}
if [[ -z $atlas_panel_finish && -s $ROOT/shared/runtime.env ]]; then
  atlas_panel_finish=$(sed -n 's/^DESIGNPRO_ATLAS_PANEL_FINISH=//p' "$ROOT/shared/runtime.env" | head -n 1)
fi
[[ $atlas_panel_finish == "on" ]] || atlas_panel_finish=off
# Call-1 authoring topology (RULE 0.35, owner 2026-09-11). Same resolution as
# the finishing flag: this deploy's explicit instruction wins, otherwise the
# running system's value, otherwise the six-surface default (written as an
# empty value, which the runtime reads as "not hero-driver"). Only the exact
# string `hero-driver` selects the cascade; anything else fails safe.
atlas_topology=${ATLAS_TOPOLOGY:-}
if [[ -z $atlas_topology && -s $ROOT/shared/runtime.env ]]; then
  atlas_topology=$(sed -n 's/^DESIGNPRO_ATLAS_TOPOLOGY=//p' "$ROOT/shared/runtime.env" | head -n 1)
fi
# Written as the literal "six-surface" rather than empty: validate-env.py
# refuses an empty value, and the runtime reads anything but "hero-driver" as
# the six-surface default either way.
[[ $atlas_topology == "hero-driver" ]] || atlas_topology="six-surface"
# Call-1 node graph (owner 2026-09-11). ON unless a deploy says "off": the
# graph is the product; "off" is the kill switch back to the in-process
# cascade. Sticky like the two flags above.
atlas_call1_graph=${ATLAS_CALL1_GRAPH:-}
if [[ -z $atlas_call1_graph && -s $ROOT/shared/runtime.env ]]; then
  atlas_call1_graph=$(sed -n 's/^DESIGNPRO_ATLAS_CALL1_GRAPH=//p' "$ROOT/shared/runtime.env" | head -n 1)
fi
[[ $atlas_call1_graph == "off" ]] || atlas_call1_graph=on

# Independent production-output and template-preview opt-ins. Preserve an
# installed choice on later deploys; absence on an older release means false.
# The provider credentials still arrive through the unchanged secret channel.
resolve_optional_flag() {
  local key=$1
  local value=${!key:-}
  if [[ -z $value && -s $ROOT/shared/runtime.env ]]; then
    value=$(sed -n "s/^${key}=//p" "$ROOT/shared/runtime.env" | head -n 1)
  fi
  value=${value:-false}
  [[ $value == true || $value == false ]] || { echo "$key must be exactly true or false" >&2; return 4; }
  printf '%s' "$value"
}
panelprofileoutput_enabled=$(resolve_optional_flag DESIGNPRO_PANELPROFILEOUTPUT_ENABLED)
template_recreate_enabled=$(resolve_optional_flag DESIGNPRO_PANELPROFILE_TEMPLATE_RECREATE_ENABLED)

runtime_tmp=$(mktemp "$ROOT/shared/runtime.env.new.XXXXXX")
gateway_tmp=$(mktemp "$ROOT/shared/gateway.env.new.XXXXXX")
cleanup() {
  unset service_key google_key topaz_key stripe_secret stripe_webhook worker_secret
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
  # PER-SURFACE PANEL FINISHING. Off unless explicitly turned on, and STICKY:
  # this script rewrites runtime.env on every deploy, so a value that is not
  # carried forward would silently switch the feature off at the next release
  # and nobody would know why the panels changed. `ATLAS_PANEL_FINISH` from the
  # deploy overrides; absent, the current value is preserved; absent both, off.
  # Only the exact string `on` enables it -- the runtime fails safe on anything
  # else, so a typo here cannot switch a customer path on.
  printf 'DESIGNPRO_ATLAS_PANEL_FINISH=%s\n' "$atlas_panel_finish"
  # CALL-1 TOPOLOGY. `six-surface` (the default) or `hero-driver` (the
  # cascade). Sticky for the same reason as the finishing flag above.
  printf 'DESIGNPRO_ATLAS_TOPOLOGY=%s\n' "$atlas_topology"
  # CALL-1 NODE GRAPH. `on` (default) or `off` (in-process cascade). Sticky.
  printf 'DESIGNPRO_ATLAS_CALL1_GRAPH=%s\n' "$atlas_call1_graph"
  printf 'DESIGNPRO_PANELPROFILEOUTPUT_ENABLED=%s\n' "$panelprofileoutput_enabled"
  printf 'DESIGNPRO_PANELPROFILE_TEMPLATE_RECREATE_ENABLED=%s\n' "$template_recreate_enabled"
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
  printf 'DESIGNPRO_ADDITIONAL_ORIGINS=https://designproai.com\n'
  printf 'DESIGNPRO_RUNTIME_INTERNAL_URL=http://runtime-1:3001\n'
  printf 'WORKER_SECRET=%s\n' "$worker_secret"
  # Checkout, written only when BOTH halves arrived. A secret key with no
  # webhook secret can take a payment and never hear that it arrived, so the
  # gateway is left answering 503 on the purchase routes rather than opening a
  # session it cannot finish.
  if [[ -n $stripe_secret && -n $stripe_webhook ]]; then
    printf 'STRIPE_SECRET_KEY=%s\n' "$stripe_secret"
    printf 'STRIPE_WEBHOOK_SECRET=%s\n' "$stripe_webhook"
  fi
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
if [[ -n $stripe_secret ]]; then
  echo "Checkout is ENABLED: the Production Pack and Logo Pack routes can open a Stripe session."
else
  echo "Checkout is DISABLED: the purchase routes answer 503 until both Stripe secrets are configured."
fi
unset service_key google_key topaz_key stripe_secret stripe_webhook worker_secret
# These files are read into the container environment at start. A release that
# is already running still holds the previous values until it is redeployed.
if docker ps --filter label=com.docker.compose.project=designproai-os --format '{{.ID}}' 2>/dev/null | grep -q .; then
  echo "NOTE: DesignProAI containers are running with the previous environment. Redeploy to load these values."
fi
