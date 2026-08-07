#!/usr/bin/env bash
set -Eeuo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
sha=${1:-}
out=${2:-"$root/dist-release"}
policy="$root/ops/release-files.txt"

[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Exact lowercase 40-character Git SHA required" >&2; exit 2; }
[[ -f $policy && ! -L $policy ]] || { echo "Canonical release policy is missing or unsafe" >&2; exit 2; }
[[ -d $root/runtime && -d $root/gateway && -d $root/web/dist ]] || {
  echo "Runtime, gateway, and built web tree are required" >&2
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
  source="$root/$entry"
  [[ -f $source && ! -L $source ]] || { echo "Required release file missing or unsafe: $entry" >&2; exit 3; }
  install -D -m 0644 -- "$source" "$stage/$entry"
done < "$policy"

if [[ -e $root/web/dist/assets ]]; then
  [[ -d $root/web/dist/assets && ! -L $root/web/dist/assets ]] || { echo "Web assets path must be a regular directory" >&2; exit 3; }
  while IFS= read -r -d '' source; do
    [[ -f $source && ! -L $source ]] || { echo "Web assets cannot contain links or special files" >&2; exit 3; }
    relative=${source#"$root/"}
    install -D -m 0644 -- "$source" "$stage/$relative"
  done < <(find "$root/web/dist/assets" -type f -print0 | LC_ALL=C sort -z)
fi

python3 "$root/ops/build-release-manifest.py" "$stage" "$sha" >/dev/null
mkdir -p -- "$out"
archive="$out/designproai-release-$sha.tgz"
tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner \
  --mode='u+rwX,go+rX,go-w' --use-compress-program='gzip -n' -cf "$archive" -C "$stage" \
  .designpro-release.json runtime gateway web ops
python3 "$root/ops/validate-archive.py" "$archive" "$sha"
(cd "$out" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256")
printf '%s\n' "$archive"
