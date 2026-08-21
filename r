#!/usr/bin/env bash
set -Eeuo pipefail

# Single-use recovery launcher for the already-built exact release. The work
# runs detached from the DigitalOcean browser console, so closing it is safe.
[[ $EUID -eq 0 ]] || { echo "Open the DigitalOcean root console first" >&2; exit 1; }

unit=designpro-retry-4c07299b5598
runner=/root/designpro-retry-4c07299b5598.sh

if systemctl is-active --quiet "$unit.service"; then
  echo "ALREADY_RUNNING: $unit"
  exit 0
fi

umask 077
cat >"$runner" <<'DESIGNPRO_RETRY'
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TARGET=4c07299b55985d59ce4c2e1dd4bc9d7d50277221
OLD=7a42861ab9d9a6f691a970868416abb9ccf5a03c
REPO=https://github.com/Tdill1980/designproai-os.git
ROOT=/opt/designproai-os
PUBLIC=https://os.designproai.com
LOG=/var/log/designpro-retry-4c07299b5598.log
STATUS=/var/log/designpro-retry-4c07299b5598.status
cutover_started=false
rollback_in_progress=false
outcome="DEPLOYED $TARGET"

exec > >(tee -a "$LOG") 2>&1
printf 'RUNNING %s\n' "$(date -u +%FT%TZ)" >"$STATUS"

finish() {
  code=$?
  trap - EXIT HUP INT TERM
  if [[ $code -ne 0 && $cutover_started == true && $rollback_in_progress == false ]]; then
    rollback_in_progress=true
    echo "Target verification failed; restoring the pinned prior release"
    set +e
    rollback_old
    rollback_code=$?
    set -e
    if [[ $rollback_code -ne 0 ]]; then
      echo "ROLLBACK_FAILED=$rollback_code" >&2
    fi
  fi
  if [[ $code -eq 0 ]]; then
    printf 'SUCCESS %s %s\n' "$outcome" "$(date -u +%FT%TZ)" >"$STATUS"
  else
    printf 'FAILED exit=%s %s\n' "$code" "$(date -u +%FT%TZ)" >"$STATUS"
  fi
  exit "$code"
}
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

echo "DesignProAI exact-release recovery starting: $TARGET"
test "$EUID" -eq 0
test "$(hostname)" = designproai-prod-sfo3
for cmd in cmp curl docker git python3 sha256sum systemctl systemd-run; do
  command -v "$cmd" >/dev/null
done
docker compose version >/dev/null
test -s "$ROOT/shared/runtime.env"
test -s "$ROOT/shared/gateway.env"

current=$(readlink -f "$ROOT/current" 2>/dev/null || true)
public=$(readlink -f "$ROOT/public" 2>/dev/null || true)
case "$current|$public" in
  "$ROOT/releases/$OLD|$ROOT/releases/$OLD") ;;
  "$ROOT/releases/$TARGET|$ROOT/releases/$TARGET") ;;
  "$ROOT/releases/$TARGET|$ROOT/releases/$OLD") ;;
  "$ROOT/releases/$OLD|$ROOT/releases/$TARGET") ;;
  *) echo "Unexpected DesignPro release pointers: current=$current public=$public" >&2; exit 20 ;;
esac

# Fetch only the two pinned source trees that own validation and rollback.
WORK=$(mktemp -d /tmp/designpro-retry.XXXXXXXX)
SRC=$WORK/target
OLD_SRC=$WORK/old
mkdir -p "$SRC"
git -C "$SRC" init --quiet
git -C "$SRC" remote add origin "$REPO"
remote_main=$(git ls-remote "$REPO" refs/heads/main | awk '{print $1}')
test "$remote_main" = "$TARGET"
git -C "$SRC" fetch --quiet --filter=blob:none --depth=50 origin main
test "$(git -C "$SRC" rev-parse FETCH_HEAD)" = "$TARGET"
git -C "$SRC" checkout --quiet --detach "$TARGET"
git -C "$SRC" cat-file -e "$OLD^{commit}"
git -C "$SRC" worktree add --quiet --detach "$OLD_SRC" "$OLD"
test "$(git -C "$SRC" rev-parse HEAD)" = "$TARGET"
test "$(git -C "$OLD_SRC" rev-parse HEAD)" = "$OLD"

# This remains an application-only recovery. It refuses infrastructure or
# Supabase changes between the pinned releases.
git -C "$SRC" diff --quiet "$OLD" "$TARGET" -- ops supabase

test -d "$ROOT/releases/$OLD"
test -d "$ROOT/releases/$TARGET"
test ! -L "$ROOT/releases/$OLD"
test ! -L "$ROOT/releases/$TARGET"

caddy_snapshot() {
  find -P /etc/caddy -type f -print0 2>/dev/null | LC_ALL=C sort -z | \
    while IFS= read -r -d '' file; do sha256sum "$file"; done
}
other_containers() {
  docker ps -a --no-trunc \
    --format '{{.ID}}\t{{.Label "com.docker.compose.project"}}\t{{.Names}}\t{{.Image}}' | \
    awk -F '\t' '$2 != "designproai-os"' | LC_ALL=C sort
}
designpro_envs() {
  sha256sum "$ROOT/shared/runtime.env" "$ROOT/shared/gateway.env"
}

# Public verification uses routes the installed Caddy actually exposes. The
# old launcher incorrectly required /gateway-healthz, which the live proxy
# serves as SPA HTML. That false negative caused the safe rollback.
verify_public() {
  sha=$1
  release="$ROOT/releases/$sha"
  page=$(mktemp /tmp/designpro-public-index.XXXXXXXX)
  headers=$(mktemp /tmp/designpro-public-headers.XXXXXXXX)
  api_body=$(mktemp /tmp/designpro-public-api.XXXXXXXX)
  api_headers=$(mktemp /tmp/designpro-public-api-headers.XXXXXXXX)
  worker_body=$(mktemp /tmp/designpro-public-worker.XXXXXXXX)

  test "$(readlink -f "$ROOT/public")" = "$release"
  curl --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 30 -fsS \
    -H 'Cache-Control: no-cache' \
    -D "$headers" \
    "$PUBLIC/?_deploy=$sha" >"$page"
  cmp -s "$page" "$release/web/dist/index.html"
  grep -qi '^strict-transport-security:.*max-age=31536000' "$headers"
  grep -qi '^x-content-type-options: *nosniff' "$headers"

  api_status=$(curl --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 30 -sS \
    -D "$api_headers" -o "$api_body" -w '%{http_code}' \
    "$PUBLIC/api/auth/session")
  test "$api_status" = 401
  grep -qi '^content-type: *application/json' "$api_headers"
  BODY_PATH="$api_body" python3 -I -c '
import json, os
with open(os.environ["BODY_PATH"], "r", encoding="utf-8") as stream:
    body = json.load(stream)
assert body == {"error": "authentication_required"}, body'

  worker_status=$(curl --proto '=https' --tlsv1.2 --connect-timeout 10 --max-time 30 -sS \
    -o "$worker_body" -w '%{http_code}' "$PUBLIC/worker/health")
  case "$worker_status" in
    404) ;;
    200) cmp -s "$worker_body" "$release/web/dist/index.html" ;;
    *) echo "Unexpected public worker-path status: $worker_status" >&2; return 1 ;;
  esac
}

# Record the exact reversible state. Both releases are immutable and validated;
# this recovery only switches the two symlinks and the DesignPro containers.
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="/var/backups/designpro-cutover/retry-$STAMP"
install -d -m 0700 "$BACKUP"
printf '%s\n' "$current" >"$BACKUP/current-release.txt"
printf '%s\n' "$public" >"$BACKUP/public-release.txt"
printf 'TARGET=%s\nOLD=%s\n' "$TARGET" "$OLD" >"$BACKUP/pinned-releases.txt"
cp -a "$SRC/ops" "$BACKUP/target-ops"
cp -a "$OLD_SRC/ops" "$BACKUP/rollback-ops"
chmod -R go-rwx "$BACKUP"
caddy_snapshot >"$BACKUP/caddy.before.sha256"
other_containers >"$BACKUP/other-containers.before.txt"
designpro_envs >"$BACKUP/environments.before.sha256"
sha256sum \
  "$ROOT/releases/$OLD/deploy/release.tgz" \
  "$ROOT/releases/$TARGET/deploy/release.tgz" \
  >"$BACKUP/release-archives.sha256"

rollback_old() {
  echo "Restoring DesignProAI to $OLD"
  bash "$BACKUP/rollback-ops/rollback.sh" "$OLD" ROLLBACK_DESIGNPRO_ONLY
  bash "$BACKUP/rollback-ops/acceptance.sh" "$OLD"
  verify_public "$OLD"
}

# Normalize a split prior cutover before promotion.
if [[ $current != "$public" ]]; then
  cutover_started=true
  rollback_old
  cutover_started=false
  current=$(readlink -f "$ROOT/current")
  public=$(readlink -f "$ROOT/public")
fi

if [[ $current == "$ROOT/releases/$TARGET" && $public == "$ROOT/releases/$TARGET" ]]; then
  cutover_started=true
  bash "$SRC/ops/acceptance.sh" "$TARGET"
  verify_public "$TARGET"
  outcome="ALREADY_DEPLOYED $TARGET"
else
  test "$current" = "$ROOT/releases/$OLD"
  test "$public" = "$ROOT/releases/$OLD"

  # Prove the rollback target and current public route immediately before the
  # reversible exact-release switch.
  bash "$OLD_SRC/ops/acceptance.sh" "$OLD"
  verify_public "$OLD"

  cutover_started=true
  bash "$SRC/ops/rollback.sh" "$TARGET" ROLLBACK_DESIGNPRO_ONLY
  verify_public "$TARGET"
fi

caddy_snapshot >"$BACKUP/caddy.after.sha256"
other_containers >"$BACKUP/other-containers.after.txt"
designpro_envs >"$BACKUP/environments.after.sha256"
cmp -s "$BACKUP/caddy.before.sha256" "$BACKUP/caddy.after.sha256"
cmp -s "$BACKUP/other-containers.before.txt" "$BACKUP/other-containers.after.txt"
cmp -s "$BACKUP/environments.before.sha256" "$BACKUP/environments.after.sha256"
test "$(readlink -f "$ROOT/current")" = "$ROOT/releases/$TARGET"
test "$(readlink -f "$ROOT/public")" = "$ROOT/releases/$TARGET"

cutover_started=false
printf 'DEPLOYED=%s\nBACKUP=%s\n' "$TARGET" "$BACKUP"
DESIGNPRO_RETRY

chmod 0700 "$runner"
systemd-run \
  --no-block \
  --unit="$unit" \
  --collect \
  --property=Type=oneshot \
  --property=TimeoutStartSec=infinity \
  --property=TimeoutStopSec=infinity \
  /bin/bash "$runner" >/dev/null

echo "STARTED: $unit"
echo "You may close this console. The recovery continues safely in the background."
echo "Status: cat /var/log/designpro-retry-4c07299b5598.status"
