#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
sha=${1:?expected SHA}
public=${2:-}
ROOT=/opt/designproai-os

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Exact lowercase SHA required" >&2; exit 2; }
release="$ROOT/releases/$sha"
[[ -L $ROOT/current ]] || { echo "Current DesignPro release symlink is missing" >&2; exit 3; }
[[ $(readlink -f "$ROOT/current") == "$release" ]] || { echo "Current release is not the requested SHA" >&2; exit 3; }
[[ -d $release && ! -L $release ]] || { echo "Exact immutable release directory is missing or unsafe" >&2; exit 3; }
[[ -f $ROOT/current/web/dist/index.html ]] || { echo "Web build missing" >&2; exit 4; }
[[ -f $ROOT/current/deploy/release.tgz && -f $ROOT/current/deploy/image-ids.env ]] || { echo "Release provenance is missing" >&2; exit 4; }
archive_sha=$(awk -F= '$1 == "RELEASE_ARCHIVE_SHA256" {print $2}' "$ROOT/current/deploy/release.env")
[[ $archive_sha =~ ^[0-9a-f]{64}$ && $(sha256sum "$ROOT/current/deploy/release.tgz" | awk '{print $1}') == "$archive_sha" ]] || {
  echo "Release archive identity mismatch" >&2; exit 4;
}
python3 "$OPS_DIR/validate-archive.py" "$ROOT/current/deploy/release.tgz" "$sha"
python3 "$OPS_DIR/validate-release-tree.py" "$release" "$sha"
systemctl is-active --quiet designproai-os.service || { echo "DesignPro systemd service is not active" >&2; exit 5; }
python3 "$OPS_DIR/validate-env.py" "$ROOT/shared/runtime.env" "$ROOT/shared/gateway.env"

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
[[ $(docker image inspect -f '{{index .Config.Labels "com.designpro.sha"}}' "designproai-runtime:$sha") == "$sha" ]] || { echo "Runtime image release label drifted" >&2; exit 5; }
[[ $(docker image inspect -f '{{index .Config.Labels "com.designpro.sha"}}' "designproai-gateway:$sha") == "$sha" ]] || { echo "Gateway image release label drifted" >&2; exit 5; }
[[ $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "designproai-runtime:$sha") == "$sha" ]] || { echo "Runtime OCI revision drifted" >&2; exit 5; }
[[ $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "designproai-gateway:$sha") == "$sha" ]] || { echo "Gateway OCI revision drifted" >&2; exit 5; }

# Probe failures are diagnosed, not swallowed. `python3 -I` runs isolated so
# Ubuntu's apport excepthook cannot replace a real AssertionError with
# "FileNotFoundError: .../-c", and each assert carries the observed value.
probe_err=$(mktemp)
trap 'rm -f -- "$probe_err"' EXIT

ids=()
for port in 3001 3002; do
  result=""
  last_body=""
  last_error=""
  for _ in $(seq 1 75); do
    body=$(curl -fsS --max-time 5 "http://127.0.0.1:${port}/health" 2>/dev/null || true)
    [[ -n $body ]] && last_body=$body
    if parsed=$(BODY="$body" EXPECTED="$sha" python3 -I -c '
import json, os
raw = os.environ["BODY"]
assert raw.strip(), "empty /health response"
h = json.loads(raw)
assert h.get("ready") is True, "ready=%r" % (h.get("ready"),)
assert h.get("commit") == os.environ["EXPECTED"], "commit=%r expected=%r" % (h.get("commit"), os.environ["EXPECTED"])
deps = h.get("dependencies", {})
assert deps.get("ready") is True, "dependencies.ready=%r detail=%r" % (deps.get("ready"), deps)
assert deps.get("contract") == "designpro.runtime-readiness.v2", "dependencies.contract=%r" % (deps.get("contract"),)
print(h.get("workerId", ""))' 2>"$probe_err"); then
      result=$parsed
      [[ -n $result ]] && break
    fi
    last_error=$(tail -n 3 -- "$probe_err" | tr '\n' ' ')
    sleep 2
  done
  if [[ -z $result ]]; then
    echo "Missing worker ID on $port" >&2
    echo "  last /health body : ${last_body:-<no response>}" >&2
    echo "  last probe failure: ${last_error:-<none>}" >&2
    exit 6
  fi
  ids+=("$result")
done
[[ ${ids[0]} == designpro-worker-1 && ${ids[1]} == designpro-worker-2 ]] || { echo "Unexpected worker identities: ${ids[*]}" >&2; exit 7; }

gateway_ok=false
gateway_last_body=""
gateway_last_error=""
for _ in $(seq 1 30); do
  gateway_body=$(curl -fsS --max-time 5 http://127.0.0.1:8787/healthz 2>/dev/null || true)
  [[ -n $gateway_body ]] && gateway_last_body=$gateway_body
  if BODY="$gateway_body" python3 -I -c '
import json, os
raw = os.environ["BODY"]
assert raw.strip(), "empty /healthz response"
h = json.loads(raw)
expected = {"status": "ok", "service": "designpro-api-gateway"}
assert h == expected, "healthz=%r expected=%r" % (h, expected)' 2>"$probe_err"; then
    gateway_ok=true
    break
  fi
  gateway_last_error=$(tail -n 3 -- "$probe_err" | tr '\n' ' ')
  sleep 2
done
if [[ $gateway_ok != true ]]; then
  echo "Gateway did not become healthy" >&2
  echo "  last /healthz body : ${gateway_last_body:-<no response>}" >&2
  echo "  last probe failure : ${gateway_last_error:-<none>}" >&2
  exit 8
fi

cd "$ROOT/current"
for spec in runtime-1:127.0.0.1:3001 runtime-2:127.0.0.1:3002 gateway:127.0.0.1:8787; do
  service=${spec%%:*}
  binding=${spec#*:}
  cid=$(docker compose --env-file deploy/release.env -f ops/compose.yaml ps -q "$service")
  [[ -n $cid && $(printf '%s\n' "$cid" | wc -l) -eq 1 ]] || { echo "Expected one $service container" >&2; exit 8; }
  expected_image_id=$gateway_image_id
  [[ $service == runtime-* ]] && expected_image_id=$runtime_image_id

  # compose.yaml declares start_period 45s (runtime) and 20s (gateway); Docker
  # reports "starting" until the first probe lands inside that window. Wait for
  # a terminal verdict rather than sampling once and racing the interval.
  health=""
  for _ in $(seq 1 60); do
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid")
    [[ $health != starting ]] && break
    sleep 2
  done

  state=$(docker inspect -f '{{.State.Status}}' "$cid")
  readonly=$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$cid")
  image_id=$(docker inspect -f '{{.Image}}' "$cid")

  [[ $state == running ]] || { echo "$service is not running: $state" >&2; exit 8; }
  if [[ $health != healthy ]]; then
    echo "$service is not healthy: ${health:-<none>}" >&2
    docker inspect -f '{{range .State.Health.Log}}exit={{.ExitCode}} out={{println .Output}}{{end}}' "$cid" 2>/dev/null | tail -n 5 >&2 || true
    exit 8
  fi
  [[ $readonly == true ]] || { echo "$service root filesystem is not read-only" >&2; exit 8; }
  [[ $image_id == "$expected_image_id" ]] || { echo "$service image identity drifted: $image_id" >&2; exit 8; }

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

if [[ -n $public ]]; then
  [[ $public == https://os.designproai.com ]] || { echo "Public acceptance URL must be the DesignPro HTTPS origin" >&2; exit 10; }
  [[ -L $ROOT/public && $(readlink -f "$ROOT/public") == "$ROOT/releases/$sha" ]] || { echo "Public web pointer is not the requested release" >&2; exit 10; }
  curl --proto '=https' --tlsv1.2 -fsS "$public/" | grep -qi '<!doctype html'
  public_gateway=$(curl --proto '=https' --tlsv1.2 -fsS "$public/gateway-healthz")
  BODY="$public_gateway" python3 -I -c '
import json, os
h = json.loads(os.environ["BODY"])
assert h.get("status") == "ok" and h.get("service") == "designpro-api-gateway", "public healthz=%r" % (h,)'
  worker_status=$(curl --proto '=https' --tlsv1.2 -sS -o /dev/null -w '%{http_code}' "$public/worker/health")
  [[ $worker_status == 404 ]] || { echo "A production worker path is publicly reachable" >&2; exit 11; }
  headers=$(curl --proto '=https' --tlsv1.2 -fsSI "$public/")
  grep -qi '^strict-transport-security:.*max-age=31536000' <<<"$headers"
  grep -qi '^x-content-type-options: *nosniff' <<<"$headers"
  grep -qi '^x-frame-options: *DENY' <<<"$headers"
fi

echo "PASS: isolated web/gateway + two unique exact-SHA server-owned runtimes with shared restart-safe spool"
echo "NOTE: infrastructure acceptance is not the seven-view production workflow canary"
