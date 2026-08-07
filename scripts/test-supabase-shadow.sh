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

"${supabase_cmd[@]}" start
"${supabase_cmd[@]}" db reset --local
"${supabase_cmd[@]}" db lint --local --level error
"${supabase_cmd[@]}" test db

