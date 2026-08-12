#!/usr/bin/env bash
set -Eeuo pipefail

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dest="/var/backups/designpro-cutover/$stamp"
install -d -m 0700 "$dest"

ss -lntp > "$dest/listeners.txt"
docker ps --no-trunc > "$dest/docker-ps.txt" 2>/dev/null || true
systemctl status designproai-os.service --no-pager > "$dest/designproai-os-service.txt" 2>&1 || true
systemctl status caddy.service --no-pager > "$dest/caddy-service.txt" 2>&1 || true
readlink -f /opt/designproai-os/current > "$dest/current-release.txt" 2>/dev/null || true
readlink -f /opt/designproai-os/public > "$dest/public-release.txt" 2>/dev/null || true

if [[ -d /opt/designproai-os && ! -L /opt/designproai-os ]]; then
  # This root-only backup contains the two server secret files; never move it
  # into a repository or user-readable location.
  # Active/partial multi-gigabyte ZIP bytes are deliberately excluded. Their
  # exact committed identity lives in Supabase and deterministic construction
  # can resume from the persistent spool without copying live partials here.
  tar --one-file-system --exclude='designproai/shared/spool' -C /opt -czf "$dest/designproai-before.tgz" designproai
  chmod 0600 "$dest/designproai-before.tgz"
fi
cp -a /etc/caddy/Caddyfile "$dest/Caddyfile.before" 2>/dev/null || true
cp -a /etc/caddy/sites/designproai-os.caddy "$dest/designproai-os.caddy.before" 2>/dev/null || true
echo "$dest"
