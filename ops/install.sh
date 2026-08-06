#!/usr/bin/env bash
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ ${1:-} == I_UNDERSTAND_NO_RP_CHANGES ]] || { echo "Confirmation token required" >&2; exit 2; }

# Refuse to proceed unless the protected service is live.
ss -lnt | grep -qE '127\.0\.0\.1:3200|0\.0\.0\.0:3200|\[::\]:3200' || {
  echo "Protected VectorizIt :3200 is not listening; refusing install" >&2; exit 3;
}
install -d -m 0755 /opt/designproai /opt/designproai/releases
install -d -m 0750 /opt/designproai/shared/artifacts
install -d -m 0700 /opt/designproai/shared
[[ -f /opt/designproai/shared/runtime.env ]] || install -m 0600 /dev/null /opt/designproai/shared/runtime.env
[[ -f /opt/designproai/shared/gateway.env ]] || install -m 0600 /dev/null /opt/designproai/shared/gateway.env
install -m 0644 designproai.service /etc/systemd/system/designproai.service
systemctl daemon-reload

# Add only explicit web rules. Do not reset/reload a host firewall here.
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp comment 'DesignPro Caddy HTTP'
  ufw allow 443/tcp comment 'DesignPro Caddy HTTPS'
fi
echo "Base installed. No RP service was changed. Populate runtime.env before deploy."
