#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
sha=${1:-}
confirm=${2:-}
ROOT=/opt/designproai

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ $confirm == ROLLBACK_DESIGNPRO_ONLY ]] || { echo "Confirmation token required" >&2; exit 2; }
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Exact known release SHA required" >&2; exit 3; }
target="$ROOT/releases/$sha"
[[ -d $target && ! -L $target && -f $target/deploy/release.env && -f $target/deploy/image-ids.env && -f $target/deploy/release.tgz ]] || {
  echo "Known immutable release with provenance required" >&2; exit 3;
}
grep -qx "DESIGNPRO_SHA=$sha" "$target/deploy/release.env" || { echo "Release identity mismatch" >&2; exit 3; }
archive_sha=$(awk -F= '$1 == "RELEASE_ARCHIVE_SHA256" {print $2}' "$target/deploy/release.env")
[[ $archive_sha =~ ^[0-9a-f]{64}$ && $(sha256sum "$target/deploy/release.tgz" | awk '{print $1}') == "$archive_sha" ]] || {
  echo "Stored release archive identity mismatch" >&2; exit 3;
}
python3 "$OPS_DIR/validate-archive.py" "$target/deploy/release.tgz" "$sha"
python3 "$OPS_DIR/validate-release-tree.py" "$target" "$sha"

runtime_image_id=$(awk -F= '$1 == "RUNTIME_IMAGE_ID" {print $2}' "$target/deploy/image-ids.env")
gateway_image_id=$(awk -F= '$1 == "GATEWAY_IMAGE_ID" {print $2}' "$target/deploy/image-ids.env")
[[ $runtime_image_id =~ ^sha256:[0-9a-f]{64}$ && $gateway_image_id =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Stored image identities are invalid" >&2; exit 3; }
[[ $(docker image inspect -f '{{.Id}}' "designproai-runtime:$sha") == "$runtime_image_id" ]] || { echo "Runtime image identity drifted" >&2; exit 3; }
[[ $(docker image inspect -f '{{.Id}}' "designproai-gateway:$sha") == "$gateway_image_id" ]] || { echo "Gateway image identity drifted" >&2; exit 3; }
python3 "$OPS_DIR/validate-env.py" "$ROOT/shared/runtime.env" "$ROOT/shared/gateway.env"

for link in current public; do
  if [[ -e $ROOT/$link || -L $ROOT/$link ]]; then
    [[ -L $ROOT/$link ]] || { echo "DesignPro $link pointer must be a symlink" >&2; exit 4; }
    existing=$(readlink -f "$ROOT/$link" 2>/dev/null || true)
    [[ -n $existing && -d $existing && $existing == "$ROOT/releases/"* ]] || {
      echo "DesignPro $link pointer escapes the immutable release directory" >&2; exit 4;
    }
  fi
done
previous=$(readlink -f "$ROOT/current" 2>/dev/null || true)
previous_public=$(readlink -f "$ROOT/public" 2>/dev/null || true)
recover() {
  status=$?
  trap - ERR
  if [[ -n $previous && -d $previous && $previous == "$ROOT/releases/"* ]]; then
    ln -sfn "$previous" "$ROOT/current.restore"
    mv -Tf "$ROOT/current.restore" "$ROOT/current"
    systemctl restart designproai.service || true
  fi
  if [[ -n $previous_public && -d $previous_public && $previous_public == "$ROOT/releases/"* ]]; then
    ln -sfn "$previous_public" "$ROOT/public.restore"
    mv -Tf "$ROOT/public.restore" "$ROOT/public"
  elif [[ -L $ROOT/public ]]; then
    unlink "$ROOT/public"
  fi
  exit "$status"
}
trap recover ERR
ln -sfn "$target" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
systemctl restart designproai.service
"$OPS_DIR/acceptance.sh" "$sha"
ln -sfn "$target" "$ROOT/public.next"
mv -Tf "$ROOT/public.next" "$ROOT/public"
[[ $(readlink -f "$ROOT/public") == "$target" ]] || { echo "Rollback public pointer did not switch exactly" >&2; exit 5; }
python3 "$OPS_DIR/validate-release-tree.py" "$target" "$sha"
trap - ERR
echo "Rolled back only DesignPro web, gateway, and runtimes to $sha"
