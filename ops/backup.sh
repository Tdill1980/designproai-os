#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dest="/var/backups/designpro-cutover/$stamp"
install -d -m 0700 "$dest"

ss -lntp > "$dest/listeners.txt"
docker ps --no-trunc > "$dest/docker-ps.txt" 2>/dev/null || true
systemctl status designproai.service --no-pager > "$dest/designproai-service.txt" 2>&1 || true
systemctl status caddy.service --no-pager > "$dest/caddy-service.txt" 2>&1 || true
readlink -f /opt/designproai/current > "$dest/current-release.txt" 2>/dev/null || true
readlink -f /opt/designproai/public > "$dest/public-release.txt" 2>/dev/null || true
"$OPS_DIR/vectorize-guard.sh" print > "$dest/vectorize-identity.txt"

if [[ -d /opt/designproai && ! -L /opt/designproai ]]; then
  # This root-only backup contains the two server secret files; never move it
  # into a repository or user-readable location.
  # Active/partial multi-gigabyte ZIP bytes are deliberately excluded. Their
  # exact committed identity lives in Supabase and deterministic construction
  # can resume from the persistent spool without copying live partials here.
  tar --one-file-system --exclude='designproai/shared/spool' -C /opt -czf "$dest/designproai-before.tgz" designproai
  chmod 0600 "$dest/designproai-before.tgz"
fi
cp -a /etc/caddy/Caddyfile "$dest/Caddyfile.before" 2>/dev/null || true
cp -a /etc/caddy/sites/designproai.caddy "$dest/designproai.caddy.before" 2>/dev/null || true
echo "$dest"
