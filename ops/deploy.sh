#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
archive=${1:-}
sha=${2:-}
archive_sha256=${3:-}
confirm=${4:-}
ROOT=/opt/designproai

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ $confirm == DEPLOY_DESIGNPRO_ONLY ]] || { echo "Confirmation token required" >&2; exit 2; }
[[ -f $archive && ! -L $archive ]] || { echo "Release archive must be a regular, non-symlink file" >&2; exit 3; }
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Exact lowercase 40-character Git SHA required" >&2; exit 4; }
[[ $archive_sha256 =~ ^[0-9a-f]{64}$ ]] || { echo "Exact release archive SHA-256 required" >&2; exit 5; }
for command in curl docker install node python3 sha256sum stat systemctl tar; do
  command -v "$command" >/dev/null || { echo "Required command missing: $command" >&2; exit 6; }
done
docker compose version >/dev/null || { echo "Docker Compose v2 is required" >&2; exit 6; }

for path in "$ROOT" "$ROOT/releases" "$ROOT/staging" "$ROOT/shared" "$ROOT/shared/spool"; do
  [[ -d $path && ! -L $path ]] || { echo "Unsafe or missing DesignPro path: $path" >&2; exit 7; }
done
[[ $(stat -c '%u:%g:%a' "$ROOT/shared/spool") == 10001:10001:700 ]] || { echo "Persistent spool ownership or mode changed" >&2; exit 7; }
python3 "$OPS_DIR/validate-env.py" "$ROOT/shared/runtime.env" "$ROOT/shared/gateway.env"

release="$ROOT/releases/$sha"
[[ ! -e $release && ! -L $release ]] || { echo "Immutable release already exists: $sha" >&2; exit 9; }
for link in current public; do
  if [[ -e $ROOT/$link || -L $ROOT/$link ]]; then
    [[ -L $ROOT/$link ]] || { echo "DesignPro $link pointer must be a symlink" >&2; exit 9; }
    existing=$(readlink -f "$ROOT/$link" 2>/dev/null || true)
    [[ -n $existing && -d $existing && $existing == "$ROOT/releases/"* ]] || {
      echo "DesignPro $link pointer escapes the immutable release directory" >&2; exit 9;
    }
  fi
done

staging="$ROOT/staging/${sha}.$(date -u +%Y%m%dT%H%M%SZ).$$"
[[ ! -e $staging ]] || { echo "Staging path collision" >&2; exit 10; }
install -d -m 0750 "$staging/deploy"

# Copy once into root-owned staging, then hash, validate, and extract this exact
# copy. A caller changing the original archive cannot change deployed bytes.
incoming="$staging/deploy/release.tgz"
install -m 0600 -- "$archive" "$incoming"
actual_archive_sha=$(sha256sum "$incoming" | awk '{print $1}')
[[ $actual_archive_sha == "$archive_sha256" ]] || { echo "Release archive SHA-256 mismatch after root-owned copy" >&2; exit 8; }
python3 "$OPS_DIR/validate-archive.py" "$incoming" "$sha"
tar --extract --gzip --file "$incoming" --directory "$staging" --no-same-owner --no-same-permissions
python3 "$OPS_DIR/validate-release-tree.py" "$staging" "$sha"

printf 'DESIGNPRO_SHA=%s\nRELEASE_ARCHIVE_SHA256=%s\n' "$sha" "$archive_sha256" > "$staging/deploy/release.env"
chmod 0600 "$staging/deploy/release.env"

# Dockerfiles, health checks, and Compose are extracted manifest-bound inputs;
# nothing from the mutable installer directory is injected into the build.
docker build \
  --label "com.designpro.sha=$sha" \
  --label "org.opencontainers.image.revision=$sha" \
  -f "$staging/ops/Dockerfile.runtime" \
  -t "designproai-runtime:$sha" "$staging"
docker build \
  --label "com.designpro.sha=$sha" \
  --label "org.opencontainers.image.revision=$sha" \
  -f "$staging/ops/Dockerfile.gateway" \
  -t "designproai-gateway:$sha" "$staging"
runtime_image_id=$(docker image inspect -f '{{.Id}}' "designproai-runtime:$sha")
gateway_image_id=$(docker image inspect -f '{{.Id}}' "designproai-gateway:$sha")
[[ $runtime_image_id =~ ^sha256:[0-9a-f]{64}$ && $gateway_image_id =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "Built image identity is invalid" >&2; exit 11;
}
printf 'RUNTIME_IMAGE_ID=%s\nGATEWAY_IMAGE_ID=%s\n' "$runtime_image_id" "$gateway_image_id" > "$staging/deploy/image-ids.env"
chmod 0600 "$staging/deploy/image-ids.env"
(cd "$staging" && docker compose --env-file deploy/release.env -f ops/compose.yaml config --quiet)

# Tracked sources and deployment metadata become root-owned/non-writable before
# the immutable release is installed. The persistent spool remains outside it.
chown -R root:root "$staging"
find "$staging" -type d -exec chmod 0555 {} +
find "$staging" -type f -exec chmod 0444 {} +
mv "$staging" "$release"

previous=$(readlink -f "$ROOT/current" 2>/dev/null || true)
previous_public=$(readlink -f "$ROOT/public" 2>/dev/null || true)
cutover_started=false
recover() {
  status=$?
  trap - ERR
  if [[ $cutover_started == true ]]; then
    echo "DesignPro deploy failed after cutover; restoring the prior DesignPro release" >&2
    if [[ -n $previous && -d $previous && $previous == "$ROOT/releases/"* ]]; then
      ln -sfn "$previous" "$ROOT/current.restore"
      mv -Tf "$ROOT/current.restore" "$ROOT/current"
      systemctl restart designproai.service || true
    else
      systemctl stop designproai.service || true
      [[ -L $ROOT/current ]] && unlink "$ROOT/current"
    fi
    if [[ -n $previous_public && -d $previous_public && $previous_public == "$ROOT/releases/"* ]]; then
      ln -sfn "$previous_public" "$ROOT/public.restore"
      mv -Tf "$ROOT/public.restore" "$ROOT/public"
    elif [[ -L $ROOT/public ]]; then
      unlink "$ROOT/public"
    fi
    if [[ -d $release && ! -L $release && $(readlink -f "$ROOT/current" 2>/dev/null || true) != "$release" ]]; then
      mv "$release" "$ROOT/staging/failed-${sha}-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    fi
  fi
  exit "$status"
}
trap recover ERR

cutover_started=true
ln -sfn "$release" "$ROOT/current.next"
mv -Tf "$ROOT/current.next" "$ROOT/current"
systemctl enable designproai.service
if systemctl is-active --quiet designproai.service; then
  systemctl restart designproai.service
else
  systemctl start designproai.service
fi
"$OPS_DIR/acceptance.sh" "$sha"
ln -sfn "$release" "$ROOT/public.next"
mv -Tf "$ROOT/public.next" "$ROOT/public"
[[ $(readlink -f "$ROOT/public") == "$release" ]] || { echo "Public pointer did not switch exactly" >&2; exit 12; }
python3 "$OPS_DIR/validate-release-tree.py" "$release" "$sha"
cutover_started=false
trap - ERR

echo "Deployed web, gateway, and two exact-SHA DesignPro runtime replicas: $sha"
