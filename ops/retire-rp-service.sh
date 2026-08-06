#!/usr/bin/env bash
set -Eeuo pipefail
port=${1:-}; exact=${2:-}; proof=${3:-}
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
case "$port" in
  3100) [[ $proof == WRAPGURU_CANARY_PASSED_AND_CALLER_DISABLED ]] || { echo "3100 retirement proof token required" >&2; exit 2; } ;;
  8080) [[ $proof == GITHUB_ACTIONS_RENDERER_PARSER_CANARIES_PASSED ]] || { echo "8080 fallback proof token required" >&2; exit 2; } ;;
  parser) [[ $proof == GITHUB_ACTIONS_RENDERER_PARSER_CANARIES_PASSED ]] || { echo "Parser fallback proof token required" >&2; exit 2; } ;;
  *) echo "Only explicitly gated 3100 or 8080 may be retired" >&2; exit 3 ;;
esac
[[ -n $exact ]] || { echo "Exact PM2 process or systemd unit required" >&2; exit 4; }
[[ $exact != rp-vectorize && $exact != *vector* ]] || { echo "VectorizIt is protected" >&2; exit 5; }
curl -fsS http://127.0.0.1:3200/health >/dev/null || \
  curl -fsS -X OPTIONS http://127.0.0.1:3200/vectorize >/dev/null || { echo "VectorizIt unhealthy; refusing" >&2; exit 6; }
if pm2 describe "$exact" >/dev/null 2>&1; then
  pm2 stop "$exact"
  pm2 delete "$exact"
elif systemctl cat "$exact" >/dev/null 2>&1; then
  systemctl disable --now "$exact"
else
  echo "Exact target not found; refusing guessed action" >&2; exit 7
fi
if [[ $port != parser ]] && ss -lnt | grep -qE ":${port}([[:space:]]|$)"; then
  echo "Port $port still listening; manual investigation required" >&2; exit 8
fi
curl -fsS http://127.0.0.1:3200/health >/dev/null || curl -fsS -X OPTIONS http://127.0.0.1:3200/vectorize >/dev/null
echo "Retired only $exact on $port; VectorizIt remains healthy"
