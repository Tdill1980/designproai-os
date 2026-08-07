#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
cd "$OPS_DIR"

for f in *.sh; do bash -n "$f"; done
python3 - <<'PY'
from pathlib import Path
for name in ("validate-env.py", "validate-archive.py", "validate-release-tree.py", "build-release-manifest.py"):
    compile(Path(name).read_text(encoding="utf-8"), name, "exec")
PY
node --check runtime-healthcheck.js
node --check gateway-healthcheck.mjs

mutable=(install.sh configure-env.sh deploy.sh rollback.sh install-caddy.sh designproai.service compose.yaml)
if grep -InE 'pm2|docker (system )?prune|docker compose down|docker stop|/opt/restylepro|:(3100|8080)([^0-9]|$)|\bufw\b' -- "${mutable[@]}"; then
  echo "Forbidden RP/global mutation construct found" >&2
  exit 1
fi
[[ ! -e retire-rp-service.sh ]] || { echo "RP retirement tooling must not ship in the DP package" >&2; exit 1; }
grep -q 'read -r -s' configure-env.sh
grep -q 'wozyamlnygaddievzuwn' configure-env.sh
grep -q 'validate-env.py' configure-env.sh

grep -q '127.0.0.1:3001:3001' compose.yaml
grep -q '127.0.0.1:3002:3001' compose.yaml
grep -q '127.0.0.1:8787:8787' compose.yaml
grep -q 'read_only: true' compose.yaml
grep -q 'mem_limit: 6g' compose.yaml
grep -q 'cpus: "3.0"' compose.yaml
grep -q '/opt/designproai/shared/spool' compose.yaml
grep -q 'DESIGNPRO_SPOOL_DIR: "/var/lib/designproai/spool"' compose.yaml
grep -q 'host.docker.internal:3200/vectorize' runtime.env.example
grep -q 'host.docker.internal:3200/vectorize' compose.yaml
[[ $(grep -Ec '^  runtime-[12]:' compose.yaml) -eq 2 ]]

# Caddy must explicitly deny browser/Internet access to production workers.
worker_block=$(awk '/handle \/worker\/\* \{/{inside=1} inside{print} inside && /^  }/{exit}' Caddyfile.fragment)
grep -q 'respond 404' <<<"$worker_block"
if grep -q 'reverse_proxy' <<<"$worker_block"; then
  echo "Caddy exposes a production worker" >&2
  exit 1
fi
grep -q 'root \* /opt/designproai/public/web/dist' Caddyfile.fragment
[[ $(grep -n 'acceptance.sh.*"\$sha"' deploy.sh | tail -1 | cut -d: -f1) -lt $(grep -n 'public.next' deploy.sh | tail -1 | cut -d: -f1) ]]

grep -q 'validate-archive.py' deploy.sh
grep -q 'validate-release-tree.py' deploy.sh
grep -q 'validate-env.py' deploy.sh
grep -q 'archive_sha256' deploy.sh
grep -q 'vectorize-guard.sh.*verify' deploy.sh
grep -qx 'runtime/runtime-contract.cjs' release-files.txt
grep -qx 'runtime/resend-transport.cjs' release-files.txt
grep -qx 'runtime/wrapbox-delivery.cjs' release-files.txt
grep -qx 'runtime/zip-spool.cjs' release-files.txt
grep -qx 'gateway/src/server.mjs' release-files.txt
grep -qx 'web/dist/index.html' release-files.txt
grep -qx 'ops/compose.yaml' release-files.txt
grep -q '.designpro-release.json' validate-archive.py
grep -q 'host.docker.internal.*3200' acceptance.sh
grep -q 'RUNTIME_IMAGE_ID' rollback.sh

if rg -n 'worker\.mjs|/readyz|/version|:3400|SUPABASE_ANON_KEY|DESIGNPRO_ORCHESTRATOR_URL' . \
  -g '!validate-package.sh' -g '!tests/**'; then
  echo "Invented, obsolete, or cross-role runtime contract found" >&2
  exit 1
fi

node --test tests/*.test.mjs
echo "Server cutover package static validation passed"
