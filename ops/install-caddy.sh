#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
sha=${1:-}
confirm=${2:-}
site=/etc/caddy/sites/designproai.caddy
main=/etc/caddy/Caddyfile

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Exact deployed SHA required" >&2; exit 2; }
[[ $confirm == INSTALL_DESIGNPRO_CADDY_ONLY ]] || { echo "Confirmation token required" >&2; exit 3; }
command -v caddy >/dev/null || { echo "Caddy must be installed through the normal OS package first" >&2; exit 4; }
[[ -f $main && ! -L $main ]] || { echo "The primary Caddyfile must be a regular, non-symlink file" >&2; exit 5; }
[[ ! -L /etc/caddy/sites && ! -L $site ]] || { echo "Refusing a symlinked Caddy site path" >&2; exit 5; }
while IFS= read -r existing; do
  [[ $existing == "$site" ]] || {
    echo "os.designproai.com already appears in another Caddy config: $existing" >&2
    exit 5
  }
done < <(grep -RIlF --include='Caddyfile' --include='*.caddy' 'os.designproai.com' /etc/caddy 2>/dev/null || true)

# Prove the local release before changing the public proxy.
"$OPS_DIR/acceptance.sh" "$sha"
caddy validate --adapter caddyfile --config "$OPS_DIR/Caddyfile.fragment"

# Existing listeners on 80/443 are acceptable only when Caddy already owns
# them. This prevents replacing nginx, Apache, or an RP-bound proxy.
for port in 80 443; do
  listener=$(ss -H -lntp "sport = :$port" 2>/dev/null || true)
  if [[ -n $listener && $listener != *caddy* ]]; then
    echo "Port $port is owned by a non-Caddy process; refusing proxy install" >&2
    exit 6
  fi
done

stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="/var/backups/designpro-cutover/caddy-$stamp"
install -d -m 0700 "$backup_dir"
cp -a "$main" "$backup_dir/Caddyfile.before"
site_existed=false
caddy_was_active=false
systemctl is-active --quiet caddy && caddy_was_active=true
if [[ -f $site ]]; then
  site_existed=true
  cp -a "$site" "$backup_dir/designproai.caddy.before"
fi

restore() {
  status=$?
  trap - ERR
  echo "Caddy update failed; restoring the previous Caddy configuration" >&2
  cp -a "$backup_dir/Caddyfile.before" "$main"
  if [[ $site_existed == true ]]; then
    cp -a "$backup_dir/designproai.caddy.before" "$site"
  elif [[ -f $site && ! -L $site ]]; then
    unlink "$site"
  fi
  caddy validate --adapter caddyfile --config "$main" >/dev/null 2>&1 || true
  if [[ $caddy_was_active == true ]]; then
    systemctl reload caddy >/dev/null 2>&1 || true
  else
    systemctl stop caddy >/dev/null 2>&1 || true
  fi
  "$OPS_DIR/vectorize-guard.sh" verify >/dev/null || true
  exit "$status"
}
trap restore ERR

install -d -m 0755 /etc/caddy/sites
if id caddy >/dev/null 2>&1; then
  install -d -m 0750 -o caddy -g caddy /var/log/caddy
else
  echo "Caddy service account is missing" >&2
  false
fi
install -m 0644 "$OPS_DIR/Caddyfile.fragment" "$site"
if ! grep -Eq '^[[:space:]]*import[[:space:]]+(/etc/caddy/)?sites/\*\.caddy[[:space:]]*$' "$main"; then
  printf '\nimport /etc/caddy/sites/*.caddy\n' >> "$main"
fi
caddy validate --adapter caddyfile --config "$main"
if systemctl is-active --quiet caddy; then
  systemctl reload caddy
else
  systemctl start caddy
fi
"$OPS_DIR/vectorize-guard.sh" verify
"$OPS_DIR/acceptance.sh" "$sha"
trap - ERR

echo "Caddy DesignPro site installed. DNS and the public canary remain separate gates."
