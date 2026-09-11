#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
track_dir="$(cd -- "${script_dir}/.." && pwd)"
cd "${track_dir}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the Supabase shadow apply." >&2
  exit 1
fi

if command -v supabase >/dev/null 2>&1; then
  supabase_cmd=(supabase)
else
  supabase_cmd=(npx --yes supabase@2.111.0)
fi

cleanup() {
  "${supabase_cmd[@]}" stop --no-backup >/dev/null 2>&1 || true
}
trap cleanup EXIT

# `db reset` ends by restarting the local containers and returns before the
# API gateway is serving again. Measured on the release gate three times on
# 2026-09-11: the very next command answered `Error status 502: An invalid
# response was received from the upstream server` and passed unchanged on a
# re-run. Wait for the gateway to answer before asking it anything.
wait_for_local_stack() {
  local attempt code
  for attempt in $(seq 1 30); do
    # No key on purpose: a healthy gateway answers 401 from PostgREST; a
    # gateway whose upstream is still starting answers 502/503 or refuses.
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:54321/rest/v1/" || echo 000)"
    case "${code}" in
      2??|3??|401|403|404) return 0 ;;
    esac
    sleep 2
  done
  echo "The local Supabase API gateway did not become ready within 60 s (last status ${code})." >&2
  return 1
}

"${supabase_cmd[@]}" start
"${supabase_cmd[@]}" db reset --local
wait_for_local_stack
"${supabase_cmd[@]}" db lint --local --level error
"${supabase_cmd[@]}" test db
