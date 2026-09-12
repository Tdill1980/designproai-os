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

if [[ -L /opt/designproai-os/current ]] && \
   [[ $(readlink -f /opt/designproai-os/current) == "/opt/designproai-os/releases/$EXACT_SHA" ]]; then
  # A FLAG FLIP ON THE RELEASE ALREADY RUNNING. The Call-1 flags
  # (ATLAS_PANEL_FINISH, ATLAS_TOPOLOGY, ATLAS_CALL1_GRAPH) only ever reach the
  # droplet through the env writer below, which this branch used to skip -- so
  # a dispatch of the current SHA with a flag set printed ALREADY_COMPLETE and
  # changed nothing, under a green run. An explicit flag means the operator
  # wants the running release reconfigured: rewrite the environment through
  # the one writer (it consumes the secrets on stdin exactly as a full deploy
  # does), restart the service so both runtime replicas re-read it, and prove
  # acceptance again. An empty flag set keeps the pure no-op: nothing touched.
  if [[ -n ${ATLAS_PANEL_FINISH:-}${ATLAS_TOPOLOGY:-}${ATLAS_CALL1_GRAPH:-} ]]; then
    "$control/configure-env.sh" CONFIGURE_DESIGNPRO_SECRETS_ONLY
    systemctl restart designproai-os.service
    "$control/acceptance.sh" "$EXACT_SHA"
    echo "FLAGS_APPLIED: exact release already accepted; runtime environment rewritten and the service restarted"
    exit 0
  fi
  "$control/acceptance.sh" "$EXACT_SHA"
  cat >/dev/null
  echo "ALREADY_COMPLETE: exact release is locally accepted; no deployment performed"
  exit 0
fi

"$control/backup.sh"
"$control/install.sh" I_UNDERSTAND_NO_RP_CHANGES
runtime_env=/opt/designproai-os/shared/runtime.env
gateway_env=/opt/designproai-os/shared/gateway.env
if [[ -s $runtime_env && -s $gateway_env ]]; then
  python3 "$control/validate-env.py" "$runtime_env" "$gateway_env"
elif [[ ! -s $runtime_env && ! -s $gateway_env ]]; then
  :
else
  echo "BLOCKED: only one DesignPro environment file is configured" >&2
  exit 30
fi

# The workflow deliberately resolves the current DesignProAI project keys on
# every release. Always pass them through the one canonical environment writer:
# configure-env.sh preserves the existing WORKER_SECRET, atomically replaces
# both role-separated files, and prevents a rotated provider key from being
# validated as merely "long enough" and then discarded.
"$control/configure-env.sh" CONFIGURE_DESIGNPRO_SECRETS_ONLY

"$control/deploy.sh" "$archive" "$EXACT_SHA" "$ARCHIVE_DIGEST" DEPLOY_DESIGNPRO_ONLY
"$control/acceptance.sh" "$EXACT_SHA"

services=$(docker ps --filter label=com.docker.compose.project=designproai-os --format '{{.Label "com.docker.compose.service"}}' | sort)
test "$(wc -l <<<"$services" | tr -d ' ')" -eq 3
test "$services" = $'gateway\nruntime-1\nruntime-2'
test "$(docker volume ls --filter label=com.docker.compose.project=designproai-os -q | wc -l)" -eq 0
echo "VERIFIED_WORKING: exact artifact passed dark loopback acceptance; Caddy, DNS, and public traffic were not changed"
