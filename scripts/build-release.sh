#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
sha=${1:-}
out=${2:-"$root/dist-release"}
policy="$root/ops/release-files.txt"

[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Exact lowercase 40-character Git SHA required" >&2; exit 2; }
[[ -f $policy && ! -L $policy ]] || { echo "Canonical release policy is missing or unsafe" >&2; exit 2; }
# The served application is the branded operator shell. `web/dist` remains the
# archive's name for the web build -- the Caddy root, the deploy pointer and
# the acceptance check all read that path -- but the bytes come from app/dist.
web_build="$root/app/dist"
[[ -d $root/runtime && -d $root/gateway && -d $web_build ]] || {
  echo "Runtime, gateway, and the built operator shell (app/dist) are required" >&2
  exit 2
}
[[ -f $web_build/index.html && ! -L $web_build/index.html ]] || {
  echo "The operator shell build is missing its entry page" >&2
  exit 2
}

stage=$(mktemp -d)
cleanup() { rm -rf -- "$stage"; }
trap cleanup EXIT

# The exact fixed inventory comes from one policy file shared by both Python
# validators. Patterns are validated after copying the normalized web build.
while IFS= read -r entry; do
  [[ -n $entry && $entry != \#* ]] || continue
  [[ $entry == *'*'* ]] && continue
  # The whole web tree is staged from the shell build below, so a fixed web
  # entry is satisfied there rather than read from this repository path.
  [[ $entry == web/dist/* ]] && continue
  source="$root/$entry"
  [[ -f $source && ! -L $source ]] || { echo "Required release file missing or unsafe: $entry" >&2; exit 3; }
  install -D -m 0644 -- "$source" "$stage/$entry"
done < "$policy"

# Stage the built shell as web/dist. Every file is copied; the validators then
# refuse anything the extension allowlist does not cover, so an unexpected file
# type fails the release rather than shipping.
while IFS= read -r -d '' source; do
  [[ -f $source && ! -L $source ]] || { echo "The web build cannot contain links or special files" >&2; exit 3; }
  relative=${source#"$web_build/"}
  install -D -m 0644 -- "$source" "$stage/web/dist/$relative"
done < <(find "$web_build" -type f -print0 | LC_ALL=C sort -z)

[[ -f $stage/web/dist/index.html ]] || { echo "Staged web build is missing index.html" >&2; exit 3; }

python3 "$root/ops/build-release-manifest.py" "$stage" "$sha" >/dev/null
mkdir -p -- "$out"
archive="$out/designproai-release-$sha.tgz"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  --mode='u+rwX,go+rX,go-w' --use-compress-program='gzip -n' -cf "$archive" -C "$stage" \
  .designpro-release.json runtime gateway web ops
python3 "$root/ops/validate-archive.py" "$archive" "$sha"
(cd "$out" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
printf '%s\n' "$archive"
