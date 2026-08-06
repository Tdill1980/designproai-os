#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"
for f in *.sh; do bash -n "$f"; done
scripts=$(find . -maxdepth 1 -name '*.sh' ! -name 'validate-package.sh' -printf '%f\n')
grep -InE 'pm2 kill|docker (system )?prune|docker stop \$\(|docker compose down|rm -rf|/opt/restylepro|PR #4119' -- $scripts compose.yaml designproai.service && {
  echo "Forbidden destructive/coupled construct found" >&2; exit 1;
} || true
grep -q '127.0.0.1:3001:3001' compose.yaml
grep -q '127.0.0.1:3002:3001' compose.yaml
grep -q '127.0.0.1:8787:8787' compose.yaml
grep -q 'host.docker.internal:3200/vectorize' .env.example
[[ $(grep -c '^  runtime-[12]:' compose.yaml) -eq 2 ]]
grep -q 'runtime/index.js' deploy.sh
grep -q 'gateway/src/server.mjs' deploy.sh
grep -q 'web/dist/index.html' deploy.sh
if rg -n 'worker\.mjs|/readyz|/version|:3400' . -g '!validate-package.sh'; then
  echo "Invented or obsolete runtime contract found" >&2
  exit 1
fi
echo "Package static validation passed"
