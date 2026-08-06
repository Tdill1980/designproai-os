#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ ${1:-} == INSTALL_DESIGNPRO_CADDY_ONLY ]] || { echo "Confirmation token required" >&2; exit 2; }
command -v caddy >/dev/null || { echo "Caddy must be installed first" >&2; exit 3; }
install -d -m 0755 /etc/caddy/sites /var/log/caddy
install -m 0644 Caddyfile.fragment /etc/caddy/sites/designproai.caddy
if ! grep -qF 'import /etc/caddy/sites/*.caddy' /etc/caddy/Caddyfile; then
  cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-designpro.$(date -u +%Y%m%dT%H%M%SZ)"
  printf '\nimport /etc/caddy/sites/*.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl -fsS http://127.0.0.1:3200/health >/dev/null || \
  curl -fsS -X OPTIONS http://127.0.0.1:3200/vectorize >/dev/null
echo "Caddy DesignPro site installed; protected service remains reachable"

