#!/usr/bin/env bash
set -Eeuo pipefail
archive=${1:-}; sha=${2:-}; confirm=${3:-}
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ $confirm == DEPLOY_DESIGNPRO_ONLY ]] || { echo "Confirmation token required" >&2; exit 2; }
[[ -f $archive ]] || { echo "Release archive missing" >&2; exit 3; }
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Exact 40-character SHA required" >&2; exit 4; }
[[ -s /opt/designproai/shared/runtime.env && -s /opt/designproai/shared/gateway.env ]] || {
  echo "runtime.env and gateway.env must both be populated" >&2; exit 5;
}
grep -q '^VECTORIZE_IT_URL=http://host.docker.internal:3200/vectorize$' /opt/designproai/shared/runtime.env || {
  echo "Protected VectorizIt URL missing" >&2; exit 6;
}
vector_ok() {
  curl -fsS --max-time 5 http://127.0.0.1:3200/health >/dev/null || \
    curl -fsS --max-time 5 -X OPTIONS http://127.0.0.1:3200/vectorize >/dev/null
}
vector_ok || { echo "VectorizIt unhealthy before deploy" >&2; exit 7; }

release="/opt/designproai/releases/$sha"
[[ ! -e $release ]] || { echo "Release already exists" >&2; exit 8; }
install -d -m 0750 "$release/deploy"
if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Unsafe release archive path" >&2; exit 9
fi
tar -xzf "$archive" -C "$release"
[[ -f "$release/runtime/index.js" ]] || { echo "runtime/index.js missing" >&2; exit 9; }
[[ -f "$release/runtime/package-lock.json" ]] || { echo "runtime lockfile missing" >&2; exit 9; }
[[ -f "$release/gateway/src/server.mjs" ]] || { echo "gateway/src/server.mjs missing" >&2; exit 9; }
[[ -f "$release/gateway/package-lock.json" ]] || { echo "gateway lockfile missing" >&2; exit 9; }
[[ -f "$release/web/dist/index.html" ]] || { echo "built web/dist missing" >&2; exit 9; }
chmod 0755 "$release" "$release/web" "$release/web/dist"

install -m 0644 Dockerfile.runtime "$release/runtime/Dockerfile"
install -m 0644 runtime-healthcheck.js "$release/runtime/healthcheck.js"
install -m 0644 Dockerfile.gateway "$release/gateway/Dockerfile"
install -m 0644 gateway-healthcheck.mjs "$release/gateway/healthcheck.mjs"
install -m 0644 compose.yaml "$release/deploy/compose.yaml"
printf 'DESIGNPRO_SHA=%s\n' "$sha" > "$release/deploy/release.env"

docker build --label "com.designpro.sha=$sha" -t "designproai-runtime:$sha" "$release/runtime"
docker build --label "com.designpro.sha=$sha" -t "designproai-gateway:$sha" "$release/gateway"

ln -sfn "$release" /opt/designproai/current.next
mv -Tf /opt/designproai/current.next /opt/designproai/current
systemctl enable designproai.service
if systemctl is-active --quiet designproai.service; then
  systemctl restart designproai.service
else
  systemctl start designproai.service
fi

for port in 3001 3002; do
  for _ in $(seq 1 45); do
    body=$(curl -fsS "http://127.0.0.1:${port}/health" 2>/dev/null || true)
    if BODY="$body" EXPECTED="$sha" python3 -c 'import json,os; h=json.loads(os.environ["BODY"]); raise SystemExit(0 if h.get("ready") is True and h.get("commit")==os.environ["EXPECTED"] else 1)' 2>/dev/null; then break; fi
    sleep 2
  done
  body=$(curl -fsS "http://127.0.0.1:${port}/health")
  BODY="$body" EXPECTED="$sha" PORT_CHECK="$port" python3 -c 'import json,os; h=json.loads(os.environ["BODY"]); assert h["ready"] is True; assert h["commit"]==os.environ["EXPECTED"]; assert h["workerId"]==("designpro-worker-1" if os.environ["PORT_CHECK"]=="3001" else "designpro-worker-2")'
done
curl -fsS http://127.0.0.1:8787/healthz >/dev/null
vector_ok || { echo "VectorizIt degraded after deploy" >&2; exit 11; }
echo "Deployed web, gateway, and two exact-SHA DesignPro runtime replicas: $sha"
