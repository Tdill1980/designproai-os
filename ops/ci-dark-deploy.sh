#!/usr/bin/env bash
set -Eeuo pipefail

: "${EXACT_SHA:?exact SHA required}"
: "${ARCHIVE_DIGEST:?archive digest required}"
: "${REMOTE_STAGE:?remote stage required}"

[[ $EXACT_SHA =~ ^[0-9a-f]{40}$ ]] || { echo "Exact lowercase 40-character Git SHA required" >&2; exit 2; }
[[ $ARCHIVE_DIGEST =~ ^[0-9a-f]{64}$ ]] || { echo "Exact archive digest required" >&2; exit 2; }
[[ $REMOTE_STAGE == "/tmp/designproai-dark-$EXACT_SHA-"* ]] || { echo "Unsafe remote staging path" >&2; exit 2; }
[[ -d $REMOTE_STAGE && ! -L $REMOTE_STAGE ]] || { echo "Remote staging path is missing or unsafe" >&2; exit 2; }

archive="$REMOTE_STAGE/designproai-release-$EXACT_SHA.tgz"
control="$REMOTE_STAGE/control/ops"
[[ -f $archive && ! -L $archive ]] || { echo "Exact release archive is missing" >&2; exit 3; }
[[ -d $control && ! -L $control ]] || { echo "Exact deployment controls are missing" >&2; exit 3; }

cleanup() {
  find "$REMOTE_STAGE" -depth -mindepth 1 -delete
  rmdir "$REMOTE_STAGE"
}
trap cleanup EXIT

if [[ -L /opt/designproai/current ]] && \
   [[ $(readlink -f /opt/designproai/current) == "/opt/designproai/releases/$EXACT_SHA" ]]; then
  "$control/acceptance.sh" "$EXACT_SHA"
  cat >/dev/null
  echo "ALREADY_COMPLETE: exact release is locally accepted; no deployment performed"
  exit 0
fi

"$control/backup.sh"
"$control/install.sh" I_UNDERSTAND_NO_RP_CHANGES
runtime_env=/opt/designproai/shared/runtime.env
gateway_env=/opt/designproai/shared/gateway.env
if [[ -s $runtime_env && -s $gateway_env ]]; then
  python3 "$control/validate-env.py" "$runtime_env" "$gateway_env"
  cat >/dev/null
elif [[ ! -s $runtime_env && ! -s $gateway_env ]]; then
  "$control/configure-env.sh" CONFIGURE_DESIGNPRO_SECRETS_ONLY
else
  echo "BLOCKED: only one DesignPro environment file is configured" >&2
  exit 30
fi

"$control/deploy.sh" "$archive" "$EXACT_SHA" "$ARCHIVE_DIGEST" DEPLOY_DESIGNPRO_ONLY
"$control/acceptance.sh" "$EXACT_SHA"

services=$(docker ps --filter label=com.docker.compose.project=designproai --format '{{.Label "com.docker.compose.service"}}' | sort)
test "$(wc -l <<<"$services" | tr -d ' ')" -eq 3
test "$services" = $'gateway\nruntime-1\nruntime-2'
test "$(docker volume ls --filter label=com.docker.compose.project=designproai -q | wc -l)" -eq 0
echo "VERIFIED_WORKING: exact artifact passed dark loopback acceptance; Caddy, DNS, and public traffic were not changed"
