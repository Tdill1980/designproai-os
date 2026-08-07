#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
sha=${1:?expected SHA}
public=${2:-}
ROOT=/opt/designproai

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Exact lowercase SHA required" >&2; exit 2; }
[[ -L $ROOT/current ]] || { echo "Current DesignPro release symlink is missing" >&2; exit 3; }
[[ $(readlink -f "$ROOT/current") == "$ROOT/releases/$sha" ]] || { echo "Current release is not the requested SHA" >&2; exit 3; }
[[ -f $ROOT/current/web/dist/index.html ]] || { echo "Web build missing" >&2; exit 4; }
[[ -f $ROOT/current/deploy/release.tgz && -f $ROOT/current/deploy/image-ids.env ]] || { echo "Release provenance is missing" >&2; exit 4; }
archive_sha=$(awk -F= '$1 == "RELEASE_ARCHIVE_SHA256" {print $2}' "$ROOT/current/deploy/release.env")
[[ $archive_sha =~ ^[0-9a-f]{64}$ && $(sha256sum "$ROOT/current/deploy/release.tgz" | awk '{print $1}') == "$archive_sha" ]] || {
  echo "Release archive identity mismatch" >&2; exit 4;
}
python3 "$OPS_DIR/validate-archive.py" "$ROOT/current/deploy/release.tgz" "$sha"
python3 "$OPS_DIR/validate-release-tree.py" "$ROOT/current" "$sha"
systemctl is-active --quiet designproai.service || { echo "DesignPro systemd service is not active" >&2; exit 5; }
python3 "$OPS_DIR/validate-env.py" "$ROOT/shared/runtime.env" "$ROOT/shared/gateway.env"
"$OPS_DIR/vectorize-guard.sh" verify

[[ -d $ROOT/shared/spool && ! -L $ROOT/shared/spool && $(stat -c '%u:%g:%a' "$ROOT/shared/spool") == 10001:10001:700 ]] || {
  echo "Persistent spool path, ownership, or mode is unsafe" >&2; exit 5;
}
host_spool_device=$(stat -c '%d' "$ROOT/shared/spool")
runtime_image_id=$(awk -F= '$1 == "RUNTIME_IMAGE_ID" {print $2}' "$ROOT/current/deploy/image-ids.env")
gateway_image_id=$(awk -F= '$1 == "GATEWAY_IMAGE_ID" {print $2}' "$ROOT/current/deploy/image-ids.env")
[[ $runtime_image_id =~ ^sha256:[0-9a-f]{64}$ && $gateway_image_id =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Stored image identities are invalid" >&2; exit 5;
}
[[ $(docker image inspect -f '{{.Id}}' "designproai-runtime:$sha") == "$runtime_image_id" ]] || { echo "Runtime image ID drifted" >&2; exit 5; }
[[ $(docker image inspect -f '{{.Id}}' "designproai-gateway:$sha") == "$gateway_image_id" ]] || { echo "Gateway image ID drifted" >&2; exit 5; }

ids=()
for port in 3001 3002; do
  result=""
  for _ in $(seq 1 75); do
    body=$(curl -fsS --max-time 5 "http://127.0.0.1:${port}/health" 2>/dev/null || true)
    if parsed=$(BODY="$body" EXPECTED="$sha" python3 -c '
import json, os
h=json.loads(os.environ["BODY"])
assert h.get("ready") is True
assert h.get("commit") == os.environ["EXPECTED"]
assert h.get("dependencies",{}).get("ready") is True
assert h.get("dependencies",{}).get("contract") == "designpro.runtime-readiness.v2"
print(h.get("workerId", ""))' 2>/dev/null); then
      result=$parsed
      [[ -n $result ]] && break
    fi
    sleep 2
  done
  [[ -n $result ]] || { echo "Missing worker ID on $port" >&2; exit 6; }
  ids+=("$result")
done
[[ ${ids[0]} == designpro-worker-1 && ${ids[1]} == designpro-worker-2 ]] || { echo "Unexpected worker identities" >&2; exit 7; }

gateway_ok=false
for _ in $(seq 1 30); do
  gateway_body=$(curl -fsS --max-time 5 http://127.0.0.1:8787/healthz 2>/dev/null || true)
  if BODY="$gateway_body" python3 -c 'import json,os; h=json.loads(os.environ["BODY"]); assert h == {"status":"ok","service":"designpro-api-gateway"}' 2>/dev/null; then
    gateway_ok=true
    break
  fi
  sleep 2
done
[[ $gateway_ok == true ]] || { echo "Gateway did not become healthy" >&2; exit 8; }

cd "$ROOT/current"
for spec in runtime-1:127.0.0.1:3001 runtime-2:127.0.0.1:3002 gateway:127.0.0.1:8787; do
  service=${spec%%:*}
  binding=${spec#*:}
  cid=$(docker compose --env-file deploy/release.env -f ops/compose.yaml ps -q "$service")
  [[ -n $cid && $(printf '%s\n' "$cid" | wc -l) -eq 1 ]] || { echo "Expected one $service container" >&2; exit 8; }
  expected_image_id=$gateway_image_id
  [[ $service == runtime-* ]] && expected_image_id=$runtime_image_id
  STATE=$(docker inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{index .Config.Labels "com.designpro.sha"}}|{{.HostConfig.ReadonlyRootfs}}|{{.Image}}' "$cid") \
    EXPECTED="$sha" EXPECTED_IMAGE="$expected_image_id" python3 -c 'import os; state,health,sha,readonly,image=os.environ["STATE"].split("|"); assert state=="running" and health=="healthy" and sha==os.environ["EXPECTED"] and readonly=="true" and image==os.environ["EXPECTED_IMAGE"]'
  container_port=8787
  [[ $service == runtime-* ]] && container_port=3001
  [[ $(docker port "$cid" "$container_port/tcp") == "$binding" ]] || { echo "$service is not bound only to $binding" >&2; exit 9; }
done

# Prove both non-root runtime containers see the same persistent filesystem and
# can resume the same spool bytes. This does not remove production pack files.
marker=".acceptance-${sha}"
runtime_1_device=$(docker compose --env-file deploy/release.env -f ops/compose.yaml exec -T runtime-1 node -e '
const fs=require("node:fs"); const p=process.env.DESIGNPRO_SPOOL_DIR; const m=process.argv[1];
const s=fs.lstatSync(p); if(!s.isDirectory()||s.isSymbolicLink()) process.exit(2);
fs.writeFileSync(`${p}/${m}`, "designpro-shared-spool", {flag:"wx",mode:0o600}); process.stdout.write(String(s.dev));' "$marker")
[[ $runtime_1_device == "$host_spool_device" ]] || { echo "runtime-1 spool is not the approved host filesystem" >&2; exit 9; }
runtime_2_device=$(docker compose --env-file deploy/release.env -f ops/compose.yaml exec -T runtime-2 node -e '
const fs=require("node:fs"); const p=process.env.DESIGNPRO_SPOOL_DIR; const m=process.argv[1];
const s=fs.lstatSync(p); if(fs.readFileSync(`${p}/${m}`,"utf8")!=="designpro-shared-spool") process.exit(2);
fs.unlinkSync(`${p}/${m}`); process.stdout.write(String(s.dev));' "$marker")
[[ $runtime_2_device == "$host_spool_device" ]] || { echo "runtime-2 spool is not the approved shared host filesystem" >&2; exit 9; }

# Host health alone is insufficient: Docker routing to protected :3200 must be
# reachable from each worker. This is a bounded TCP connect only and cannot
# stop, reconfigure, or mutate VectorizIt.
for service in runtime-1 runtime-2; do
  docker compose --env-file deploy/release.env -f ops/compose.yaml exec -T "$service" node -e '
const net=require("node:net"); const socket=net.connect({host:"host.docker.internal",port:3200});
const timer=setTimeout(()=>{socket.destroy();process.exit(2)},5000);
socket.once("connect",()=>{clearTimeout(timer);socket.end();});
socket.once("close",()=>process.exit(0)); socket.once("error",()=>{clearTimeout(timer);process.exit(3)});'
done

if [[ -n $public ]]; then
  [[ $public == https://os.designproai.com ]] || { echo "Public acceptance URL must be the DesignPro HTTPS origin" >&2; exit 10; }
  [[ -L $ROOT/public && $(readlink -f "$ROOT/public") == "$ROOT/releases/$sha" ]] || { echo "Public web pointer is not the requested release" >&2; exit 10; }
  curl --proto '=https' --tlsv1.2 -fsS "$public/" | grep -qi '<!doctype html'
  public_gateway=$(curl --proto '=https' --tlsv1.2 -fsS "$public/gateway-healthz")
  BODY="$public_gateway" python3 -c 'import json,os; h=json.loads(os.environ["BODY"]); assert h.get("status")=="ok" and h.get("service")=="designpro-api-gateway"'
  worker_status=$(curl --proto '=https' --tlsv1.2 -sS -o /dev/null -w '%{http_code}' "$public/worker/health")
  [[ $worker_status == 404 ]] || { echo "A production worker path is publicly reachable" >&2; exit 11; }
  headers=$(curl --proto '=https' --tlsv1.2 -fsSI "$public/")
  grep -qi '^strict-transport-security:.*max-age=31536000' <<<"$headers"
  grep -qi '^x-content-type-options: *nosniff' <<<"$headers"
  grep -qi '^x-frame-options: *DENY' <<<"$headers"
fi

echo "PASS: isolated web/gateway + two unique exact-SHA runtimes; VectorizIt identity unchanged"
echo "NOTE: infrastructure acceptance is not the seven-view production workflow canary"
