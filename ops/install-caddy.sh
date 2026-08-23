#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
sha=${1:-}
confirm=${2:-}
site=/etc/caddy/sites/designproai-os.caddy
legacy_sites=(
  /etc/caddy/sites/os.designproai.caddy
  /etc/caddy/sites/designproai-apex.caddy
  /etc/caddy/sites/designproai.caddy
)
caddy_log_files=(
  /var/log/caddy/designpro-apex-access.log
  /var/log/caddy/designpro-www-access.log
  /var/log/caddy/designpro-access.log
)
main=/etc/caddy/Caddyfile

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "Exact deployed SHA required" >&2; exit 2; }
[[ $confirm == INSTALL_DESIGNPRO_CADDY_ONLY ]] || { echo "Confirmation token required" >&2; exit 3; }
command -v caddy >/dev/null || { echo "Caddy must be installed through the normal OS package first" >&2; exit 4; }
[[ -f $main && ! -L $main ]] || { echo "The primary Caddyfile must be a regular, non-symlink file" >&2; exit 5; }
[[ ! -L /etc/caddy/sites && ! -L $site ]] || { echo "Refusing a symlinked Caddy site path" >&2; exit 5; }
[[ ! -e $site || -f $site ]] || { echo "The canonical Caddy site path must be a regular file" >&2; exit 5; }
[[ ! -L /var/log/caddy ]] || { echo "Refusing a symlinked Caddy log directory" >&2; exit 5; }
for legacy_site in "${legacy_sites[@]}"; do
  [[ ! -L $legacy_site ]] || { echo "Refusing a symlinked Caddy site path: $legacy_site" >&2; exit 5; }
  [[ ! -e $legacy_site || -f $legacy_site ]] || { echo "A legacy Caddy site path is not a regular file: $legacy_site" >&2; exit 5; }
done
for log_file in "${caddy_log_files[@]}"; do
  [[ ! -L $log_file ]] || { echo "Refusing a symlinked Caddy log path: $log_file" >&2; exit 5; }
  [[ ! -e $log_file || -f $log_file ]] || { echo "A Caddy log path is not a regular file: $log_file" >&2; exit 5; }
done

approved_designpro_site() {
  local candidate=$1
  local legacy_site
  [[ $candidate == "$site" ]] && return 0
  for legacy_site in "${legacy_sites[@]}"; do
    [[ $candidate == "$legacy_site" ]] && return 0
  done
  return 1
}

while IFS= read -r existing; do
  approved_designpro_site "$existing" || {
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
legacy_existing=()
legacy_missing=()
caddy_was_active=false
systemctl is-active --quiet caddy && caddy_was_active=true
if [[ -f $site ]]; then
  site_existed=true
  cp -a "$site" "$backup_dir/designproai-os.caddy.before"
fi
for legacy_site in "${legacy_sites[@]}"; do
  if [[ -f $legacy_site ]]; then
    cp -a "$legacy_site" "$backup_dir/$(basename "$legacy_site").before"
    legacy_existing+=("$legacy_site")
  else
    legacy_missing+=("$legacy_site")
  fi
done

restore() {
  status=$?
  trap - ERR
  echo "--- failed Caddy activation status ---" >&2
  systemctl status caddy --no-pager -l >&2 || true
  echo "--- recent Caddy journal ---" >&2
  journalctl -u caddy --since '-3 minutes' --no-pager -n 120 >&2 || true
  echo "Caddy update failed; restoring the previous Caddy configuration" >&2
  cp -a "$backup_dir/Caddyfile.before" "$main"
  if [[ $site_existed == true ]]; then
    cp -a "$backup_dir/designproai-os.caddy.before" "$site"
  elif [[ -f $site && ! -L $site ]]; then
    unlink "$site"
  fi
  for legacy_site in "${legacy_existing[@]}"; do
    cp -a "$backup_dir/$(basename "$legacy_site").before" "$legacy_site"
  done
  for legacy_site in "${legacy_missing[@]}"; do
    if [[ -f $legacy_site && ! -L $legacy_site ]]; then
      unlink "$legacy_site"
    fi
  done
  caddy validate --adapter caddyfile --config "$main" >/dev/null 2>&1 || true
  if [[ $caddy_was_active == true ]]; then
    # A failed restart can leave the unit inactive. Restart the validated old
    # configuration instead of relying on the admin reload endpoint that may
    # have caused the original activation failure.
    systemctl restart caddy >/dev/null 2>&1 || true
  else
    systemctl stop caddy >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap restore ERR

install -d -m 0755 /etc/caddy/sites
if id caddy >/dev/null 2>&1; then
  install -d -m 0750 -o caddy -g caddy /var/log/caddy
  # Caddy validates file-log syntax as root but opens these files as the caddy
  # service user. Historical cutovers left one of the exact DesignProAI logs
  # root-owned, which made reload fail and the subsequent service start exit.
  # Repair only the three DesignProAI-owned logs; never recurse into the shared
  # Caddy log directory or change a neighboring site's files.
  for log_file in "${caddy_log_files[@]}"; do
    if [[ -f $log_file ]]; then
      chown caddy:caddy "$log_file"
      chmod 0640 "$log_file"
    else
      install -m 0640 -o caddy -g caddy /dev/null "$log_file"
    fi
  done
else
  echo "Caddy service account is missing" >&2
  false
fi
# These exact legacy filenames were created by earlier DesignProAI cutovers.
# Remove them only after every root-only backup exists, so the new canonical
# site does not duplicate a host during validation. The ERR trap restores all.
for legacy_site in "${legacy_existing[@]}"; do
  [[ -f $legacy_site && ! -L $legacy_site ]] || { echo "Legacy Caddy site changed after backup: $legacy_site" >&2; false; }
  unlink "$legacy_site"
done
install -m 0644 "$OPS_DIR/Caddyfile.fragment" "$site"
if ! grep -Eq '^[[:space:]]*import[[:space:]]+(/etc/caddy/)?sites/\*\.caddy[[:space:]]*$' "$main"; then
  printf '\nimport /etc/caddy/sites/*.caddy\n' >> "$main"
fi
caddy validate --adapter caddyfile --config "$main"
if systemctl is-active --quiet caddy; then
  # Prefer a zero-downtime reload. Some pre-existing Caddy configurations have
  # no reachable admin endpoint, so the packaged systemd reload command can
  # fail even though both the old and new configurations validate. In that
  # exact case, use one controlled service restart. The ERR trap restores and
  # restarts the previous configuration if the restart does not succeed.
  if ! systemctl reload caddy; then
    echo "Caddy reload was refused; using one controlled service restart" >&2
    systemctl restart caddy
  fi
else
  systemctl start caddy
fi
# systemctl can report a successful start before the daemon finishes opening
# its log writers. Require the unit to remain active and the expected local TLS
# origin to answer before acceptance can make this workflow green.
for _ in {1..10}; do
  systemctl is-active --quiet caddy && break
  sleep 1
done
systemctl is-active --quiet caddy || {
  echo "Caddy did not remain active after activation" >&2
  systemctl status caddy --no-pager -l >&2 || true
  false
}
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
  --resolve os.designproai.com:443:127.0.0.1 \
  https://os.designproai.com/gateway-healthz >/dev/null
"$OPS_DIR/acceptance.sh" "$sha"
trap - ERR

echo "Caddy DesignPro site installed. DNS and the public canary remain separate gates."
