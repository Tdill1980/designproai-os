#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)

echo "timestamp=$(date -u +%FT%TZ)"
echo "hostname=$(hostname)"
echo "kernel=$(uname -r)"
echo "public_target=137.184.0.4"
echo "--- resources ---"
free -h
df -h / /opt 2>/dev/null || df -h /
echo "--- protected and relevant listeners ---"
ss -lntp | awk 'NR==1 || $4 ~ /:(80|443|3001|3002|3100|3200|8080|8787)$/'
echo "--- exact docker inventory (read-only) ---"
docker ps --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null || true
echo "--- exact pm2 inventory (read-only) ---"
pm2 jlist 2>/dev/null | python3 -c 'import json,sys; a=json.load(sys.stdin); print("\n".join(f"{x.get(\"name\")}\t{x.get(\"pm2_env\",{}).get(\"status\")}\t{x.get(\"pid\")}" for x in a))' || true
echo "--- systemd candidates (read-only) ---"
systemctl list-units --type=service --all --no-pager | grep -Ei 'designpro|restyle|vector|parser|render|agent|caddy|docker' || true
echo "--- DesignProAI server-owned worker boundary ---"
echo "expected_workers=runtime-1,runtime-2"
echo "external_panelizer_dependency=none"
