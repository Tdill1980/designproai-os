#!/usr/bin/env bash
set -Eeuo pipefail
sha=${1:-}; confirm=${2:-}
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ $confirm == ROLLBACK_DESIGNPRO_ONLY ]] || { echo "Confirmation token required" >&2; exit 2; }
[[ $sha =~ ^[0-9a-f]{40}$ && -d /opt/designproai/releases/$sha ]] || { echo "Known release SHA required" >&2; exit 3; }
curl -fsS http://127.0.0.1:3200/health >/dev/null || curl -fsS -X OPTIONS http://127.0.0.1:3200/vectorize >/dev/null || { echo "VectorizIt unhealthy; refusing mutation" >&2; exit 4; }
ln -sfn "/opt/designproai/releases/$sha" /opt/designproai/current.next
mv -Tf /opt/designproai/current.next /opt/designproai/current
systemctl restart designproai.service
"$(dirname "$0")/acceptance.sh" "$sha"
echo "Rolled back only DesignPro web, gateway and runtimes to $sha"
