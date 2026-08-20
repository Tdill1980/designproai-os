#!/usr/bin/env bash
set -Eeuo pipefail

# Single-use mobile launcher. The long deployment runs as a transient systemd
# service so closing the DigitalOcean console cannot interrupt a cutover.
[[ $EUID -eq 0 ]] || { echo "Open the DigitalOcean root console first" >&2; exit 1; }

unit=designpro-mobile-4c07299b5598
runner=/root/designpro-mobile-4c07299b5598.sh

if systemctl is-active --quiet "$unit.service"; then
  echo "ALREADY_RUNNING: $unit"
  exit 0
fi

umask 077
cat >"$runner" <<'DESIGNPRO_DEPLOY'
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TARGET=4c07299b55985d59ce4c2e1dd4bc9d7d50277221
OLD=7a42861ab9d9a6f691a970868416abb9ccf5a03c
REPO=https://github.com/Tdill1980/designproai-os.git
ROOT=/opt/designproai-os
LOG=/var/log/designpro-mobile-4c07299b5598.log
STATUS=/var/log/designpro-mobile-4c07299b5598.status

exec > >(tee -a "$LOG") 2>&1
printf 'RUNNING %s\n' "$(date -u +%FT%TZ)" >"$STATUS"
finish() {
  code=$?
  if [[ $code -eq 0 ]]; then
    printf 'SUCCESS %s %s\n' "$TARGET" "$(date -u +%FT%TZ)" >"$STATUS"
  else
    printf 'FAILED exit=%s %s\n' "$code" "$(date -u +%FT%TZ)" >"$STATUS"
  fi
}
trap finish EXIT

echo "DesignProAI exact mobile deployment starting: $TARGET"
test "$EUID" -eq 0
test "$(hostname)" = designproai-prod-sfo3
for cmd in git docker python3 tar sha256sum curl systemctl systemd-run; do
  command -v "$cmd" >/dev/null
done
docker compose version >/dev/null

current=$(readlink -f "$ROOT/current" 2>/dev/null || true)
public=$(readlink -f "$ROOT/public" 2>/dev/null || true)
if [[ $current == "$ROOT/releases/$TARGET" && $public == "$ROOT/releases/$TARGET" ]]; then
  bash "$ROOT/releases/$TARGET/ops/acceptance.sh" "$TARGET" https://os.designproai.com
  echo "ALREADY_DEPLOYED=$TARGET"
  exit 0
fi
test "$current" = "$ROOT/releases/$OLD"
test "$public" = "$ROOT/releases/$OLD"
test -d "$ROOT/releases/$OLD"
test ! -e "$ROOT/releases/$TARGET"
test ! -L "$ROOT/releases/$TARGET"
test -s "$ROOT/shared/runtime.env"
test -s "$ROOT/shared/gateway.env"

WORK=$(mktemp -d /tmp/designpro-manual.XXXXXXXX)
SRC=$WORK/target
mkdir -p "$SRC"
git -C "$SRC" init --quiet
git -C "$SRC" remote add origin "$REPO"
remote_main=$(git ls-remote "$REPO" refs/heads/main | awk '{print $1}')
test "$remote_main" = "$TARGET"
git -C "$SRC" fetch --quiet --filter=blob:none --depth=50 origin main
test "$(git -C "$SRC" rev-parse FETCH_HEAD)" = "$TARGET"
git -C "$SRC" checkout --quiet --detach "$TARGET"
test "$(git -C "$SRC" rev-parse HEAD)" = "$TARGET"
git -C "$SRC" cat-file -e "$OLD^{commit}"

# This release is application-only. Abort if infrastructure or Supabase changed.
git -C "$SRC" diff --quiet "$OLD" "$TARGET" -- ops supabase

# Build and test without adding Node packages to the production host.
docker run --rm \
  -v "$SRC:/repo" -w /repo \
  node:22-bookworm-slim sh -eu -c '
    npm ci --prefix app
    npm test --prefix app
    npm run build --prefix app
    node --check runtime/generation-worker.cjs
    node --test tests/atlas-fail-fast.test.mjs tests/flat-first-atlas-schema.test.mjs
  '

bash "$SRC/scripts/build-release.sh" "$TARGET" "$WORK/release"
ARCHIVE="$WORK/release/designproai-release-$TARGET.tgz"
DIGEST=$(awk 'NF {print $1; exit}' "$ARCHIVE.sha256")
test "$(sha256sum "$ARCHIVE" | awk '{print $1}')" = "$DIGEST"
python3 "$SRC/ops/validate-archive.py" "$ARCHIVE" "$TARGET"

# Prove the current release is healthy before taking its recovery snapshot.
bash "$ROOT/releases/$OLD/ops/acceptance.sh" "$OLD" https://os.designproai.com

# Correct root-only recovery snapshot. Do not call the historical backup.sh:
# that file used the wrong /opt directory name.
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="/var/backups/designpro-cutover/$STAMP"
install -d -m 0700 "$BACKUP"
printf '%s\n' "$current" >"$BACKUP/current-release.txt"
printf '%s\n' "$public" >"$BACKUP/public-release.txt"
tar --one-file-system \
  --exclude='designproai-os/shared/spool' \
  -C /opt -czf "$BACKUP/designproai-before.tgz" designproai-os
chmod 0600 "$BACKUP/designproai-before.tgz"
tar -tzf "$BACKUP/designproai-before.tgz" | \
  grep -qx "designproai-os/releases/$OLD/deploy/release.tgz"
install -d -m 0700 "$BACKUP/rollback-ops"
cp -a "$ROOT/releases/$OLD/ops/." "$BACKUP/rollback-ops/"
chmod -R go-rwx "$BACKUP/rollback-ops"

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

bash "$ROOT/releases/$OLD/ops/inventory.sh" >"$BACKUP/inventory.before.txt"
caddy_snapshot >"$BACKUP/caddy.before.sha256"
other_containers >"$BACKUP/other-containers.before.txt"
designpro_envs >"$BACKUP/environments.before.sha256"

rollback_old() {
  echo "Rolling DesignProAI back to $OLD"
  bash "$BACKUP/rollback-ops/rollback.sh" "$OLD" ROLLBACK_DESIGNPRO_ONLY
  bash "$BACKUP/rollback-ops/acceptance.sh" "$OLD" https://os.designproai.com
}

if ! bash "$SRC/ops/deploy.sh" \
  "$ARCHIVE" "$TARGET" "$DIGEST" DEPLOY_DESIGNPRO_ONLY
then
  rollback_old
  exit 1
fi

if ! bash "$SRC/ops/acceptance.sh" "$TARGET" https://os.designproai.com
then
  rollback_old
  exit 1
fi

caddy_snapshot >"$BACKUP/caddy.after.sha256"
other_containers >"$BACKUP/other-containers.after.txt"
designpro_envs >"$BACKUP/environments.after.sha256"

if ! cmp -s "$BACKUP/caddy.before.sha256" "$BACKUP/caddy.after.sha256" ||
   ! cmp -s "$BACKUP/other-containers.before.txt" "$BACKUP/other-containers.after.txt" ||
   ! cmp -s "$BACKUP/environments.before.sha256" "$BACKUP/environments.after.sha256" ||
   test "$(readlink -f "$ROOT/current")" != "$ROOT/releases/$TARGET" ||
   test "$(readlink -f "$ROOT/public")" != "$ROOT/releases/$TARGET"
then
  rollback_old
  exit 1
fi

printf 'DEPLOYED=%s\nBACKUP=%s\n' "$TARGET" "$BACKUP"
DESIGNPRO_DEPLOY

chmod 0700 "$runner"
systemd-run \
  --unit="$unit" \
  --collect \
  --property=Type=oneshot \
  /bin/bash "$runner" >/dev/null

echo "STARTED: $unit"
echo "You may close this console. The deployment continues safely in the background."
echo "Status: cat /var/log/designpro-mobile-4c07299b5598.status"
