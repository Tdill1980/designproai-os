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
docker ps -a --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>/dev/null || true
echo "--- exact docker images (read-only) ---"
docker images --digests --no-trunc 2>/dev/null || true
echo "--- exact docker volumes (read-only) ---"
docker volume ls 2>/dev/null || true
echo "--- exact docker networks (read-only) ---"
docker network ls 2>/dev/null || true
echo "--- exact compose projects (read-only) ---"
docker compose ls --all 2>/dev/null || true
echo "--- exact pm2 inventory (read-only) ---"
pm2 jlist 2>/dev/null | python3 -c 'import json,sys; a=json.load(sys.stdin); print("\n".join(f"{x.get(\"name\")}\t{x.get(\"pm2_env\",{}).get(\"status\")}\t{x.get(\"pid\")}" for x in a))' || true
echo "--- systemd candidates (read-only) ---"
systemctl list-units --type=service --all --no-pager | grep -Ei 'designpro|restyle|vector|parser|render|agent|caddy|docker' || true
echo "--- DesignProAI deployment paths (metadata only; no env contents) ---"
if [[ -e /opt/designproai || -L /opt/designproai ]]; then
  find -P /opt/designproai -maxdepth 3 \
    ! -path '/opt/designproai/shared/spool/*' \
    -printf '%y\t%u:%g\t%m\t%p\t%l\n' 2>/dev/null | LC_ALL=C sort
else
  echo "MISSING /opt/designproai"
fi
for path in /etc/systemd/system/designproai.service /etc/caddy/sites/designproai.caddy; do
  if [[ -e $path || -L $path ]]; then
    stat -c '%F\t%U:%G\t%a\t%n' "$path"
  fi
done
echo "--- DesignProAI server-owned worker boundary ---"
echo "expected_workers=runtime-1,runtime-2"
echo "external_panelizer_dependency=none"
