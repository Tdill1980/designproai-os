#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dest="/var/backups/designpro-cutover/$stamp"
install -d -m 0700 "$dest"
ss -lntp > "$dest/listeners.txt"
docker ps --no-trunc > "$dest/docker-ps.txt" 2>/dev/null || true
pm2 jlist > "$dest/pm2-jlist.json" 2>/dev/null || true
systemctl list-unit-files > "$dest/systemd-unit-files.txt"
if [[ -d /opt/designproai ]]; then
  tar --one-file-system -C /opt -czf "$dest/designproai-before.tgz" designproai
fi
cp -a /etc/caddy/Caddyfile "$dest/Caddyfile.before" 2>/dev/null || true
echo "$dest"

