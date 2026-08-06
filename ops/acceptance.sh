#!/usr/bin/env bash
set -Eeuo pipefail
sha=${1:?expected SHA}; public=${2:-}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Exact SHA required" >&2; exit 2; }
curl -fsS http://127.0.0.1:3200/health >/dev/null || curl -fsS -X OPTIONS http://127.0.0.1:3200/vectorize >/dev/null

ids=()
for port in 3001 3002; do
  body=$(curl -fsS "http://127.0.0.1:${port}/health")
  result=$(BODY="$body" EXPECTED="$sha" python3 -c 'import json,os; h=json.loads(os.environ["BODY"]); assert h.get("ready") is True; assert h.get("commit")==os.environ["EXPECTED"]; print(h.get("workerId",""))')
  [[ -n $result ]] || { echo "Missing worker ID on $port" >&2; exit 3; }
  ids+=("$result")
done
[[ ${ids[0]} != "${ids[1]}" ]] || { echo "Runtime worker IDs are not unique" >&2; exit 4; }
[[ ${ids[0]} == designpro-worker-1 && ${ids[1]} == designpro-worker-2 ]] || { echo "Unexpected worker identities" >&2; exit 4; }

curl -fsS http://127.0.0.1:8787/healthz >/dev/null
[[ -f /opt/designproai/current/web/dist/index.html ]] || { echo "Web build missing" >&2; exit 5; }
[[ $(docker ps --filter label=com.docker.compose.project=designproai --format '{{.Label "com.docker.compose.service"}}' | grep -Ec '^runtime-[12]$') -eq 2 ]] || { echo "Expected two runtime replicas" >&2; exit 6; }
[[ $(docker ps --filter label=com.docker.compose.project=designproai --format '{{.Label "com.docker.compose.service"}}' | grep -Ec '^gateway$') -eq 1 ]] || { echo "Expected one gateway" >&2; exit 6; }

if [[ -n $public ]]; then
  curl -fsS "$public/" | grep -qi '<!doctype html'
  curl -fsS "$public/gateway-healthz" >/dev/null
  public_health=$(curl -fsS "$public/worker/health")
  BODY="$public_health" EXPECTED="$sha" python3 -c 'import json,os; h=json.loads(os.environ["BODY"]); assert h.get("ready") is True; assert h.get("commit")==os.environ["EXPECTED"]'
fi
echo "PASS: web + gateway + two unique exact-SHA runtimes; VectorizIt healthy"
