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

# `db reset` recreates the database, applies every migration, restarts
# storage/auth/realtime/pooler and then re-upserts `[storage.buckets]` through
# the local Kong gateway (CLI 2.111.0: internal/db/reset/reset.go, then
# internal/seed/buckets/buckets.go). The CLI waits for the storage container's
# Docker health check first, but Kong can still answer that first request with
# its own
#   Error status 502: {"message":"An invalid response was received from the upstream server"}
# while its pooled connection to the restarted storage-api is stale. Measured
# on the release gate three times on 2026-09-11, after every migration had
# applied; each passed unchanged on a re-run. The bucket rows this suite tests
# come from migrations (20260806180700, 20260910070849), so the upsert is a
# property no-op here. A bounded retry of the reset on that exact signature is
# the remedy that lives in this repository; any other failure exits at once.
reset_with_retry() {
  local attempt log
  log="$(mktemp)"
  for attempt in 1 2 3; do
    if "${supabase_cmd[@]}" db reset --local 2>&1 | tee "${log}"; then
      rm -f "${log}"
      return 0
    fi
    if ! grep -q "Error status 502" "${log}"; then
      rm -f "${log}"
      return 1
    fi
    echo "db reset attempt ${attempt} hit the local gateway 502 after the service restart; retrying in 10 s." >&2
    sleep 10
  done
  rm -f "${log}"
  echo "db reset hit the local gateway 502 on three consecutive attempts; that is no longer the restart race." >&2
  return 1
}

"${supabase_cmd[@]}" start
reset_with_retry
"${supabase_cmd[@]}" db lint --local --level error
"${supabase_cmd[@]}" test db
