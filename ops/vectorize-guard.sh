#!/usr/bin/env bash
set -Eeuo pipefail

mode=${1:-}
state_file=${2:-/opt/designproai/shared/vectorize.identity}

vector_probe() {
  if curl -fsS --max-time 5 http://127.0.0.1:3200/health >/dev/null; then
    return 0
  fi
  local code
  code=$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' -X OPTIONS http://127.0.0.1:3200/vectorize || true)
  [[ $code =~ ^[234][0-9][0-9]$ ]]
}

vector_identity() {
  local published
  published=$(docker ps --filter publish=3200 --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Ports}}' 2>/dev/null | LC_ALL=C sort || true)
  if [[ -n $published ]]; then
    printf 'docker|%s\n' "$published"
    return 0
  fi
  local socket
  socket=$(ss -H -lntp 'sport = :3200' 2>/dev/null | sed -E 's/fd=[0-9]+/fd=FILTERED/g' | LC_ALL=C sort || true)
  [[ -n $socket ]] || return 1
  printf 'socket|%s\n' "$socket"
}

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
case "$mode" in
  capture)
    [[ ! -L $state_file ]] || { echo "VectorizIt identity path must not be a symlink" >&2; exit 2; }
    vector_probe || { echo "Protected VectorizIt :3200 is not healthy" >&2; exit 3; }
    identity=$(vector_identity) || { echo "Cannot identify the :3200 listener" >&2; exit 4; }
    install -d -m 0700 "$(dirname "$state_file")"
    temp="${state_file}.new.$$"
    umask 077
    printf '%s\n' "$identity" > "$temp"
    chmod 0600 "$temp"
    mv -f "$temp" "$state_file"
    echo "Protected VectorizIt identity captured"
    ;;
  verify)
    [[ -f $state_file && ! -L $state_file ]] || { echo "Protected VectorizIt identity baseline is missing" >&2; exit 5; }
    vector_probe || { echo "Protected VectorizIt :3200 is not healthy" >&2; exit 6; }
    identity=$(vector_identity) || { echo "Cannot identify the :3200 listener" >&2; exit 7; }
    if [[ $(<"$state_file") != "$identity" ]]; then
      echo "Protected VectorizIt :3200 identity changed; refusing DesignPro mutation" >&2
      exit 8
    fi
    echo "Protected VectorizIt identity is unchanged and healthy"
    ;;
  print)
    vector_probe || { echo "Protected VectorizIt :3200 is not healthy" >&2; exit 9; }
    vector_identity
    ;;
  *)
    echo "usage: vectorize-guard.sh capture|verify [STATE_FILE]" >&2
    exit 64
    ;;
esac
