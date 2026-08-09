#!/usr/bin/env bash
set -Eeuo pipefail

OPS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
ROOT=/opt/designproai

[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
[[ ${1:-} == I_UNDERSTAND_NO_RP_CHANGES ]] || { echo "Confirmation token required" >&2; exit 2; }
for command in df docker install nproc python3 ss stat systemctl; do
  command -v "$command" >/dev/null || { echo "Required command missing: $command" >&2; exit 3; }
done
docker compose version >/dev/null || { echo "Docker Compose v2 is required" >&2; exit 3; }

# Refuse a server that cannot safely hold one 50-GiB resumable production pack\n# and two independent server-owned workers. These checks
# happen before the first DesignPro directory is created.
minimum_cpu=8
minimum_ram_kib=$((15 * 1024 * 1024))
# Linux can report a configured 8-GiB swapfile a few pages below its nominal
# size.  Refuse genuinely undersized hosts while allowing that accounting gap.
minimum_swap_kib=$((15 * 512 * 1024))
minimum_free_bytes=$((120 * 1024 * 1024 * 1024))
cpu_count=$(nproc)
ram_kib=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
swap_kib=$(awk '/^SwapTotal:/ {print $2}' /proc/meminfo)
active_swap=$(awk 'NR > 1 {count++} END {print count + 0}' /proc/swaps)
free_bytes=$(df -B1 --output=avail /opt | awk 'NR == 2 {print $1}')
[[ $cpu_count -ge $minimum_cpu ]] || { echo "Host requires at least 8 logical CPUs" >&2; exit 3; }
[[ $ram_kib -ge $minimum_ram_kib ]] || { echo "Host requires at least 15 GiB physical RAM" >&2; exit 3; }
[[ $active_swap -ge 1 && $swap_kib -ge $minimum_swap_kib ]] || { echo "Host requires an active swapfile configured as 8 GiB (kernel accounting tolerance allowed)" >&2; exit 3; }
[[ $free_bytes -ge $minimum_free_bytes ]] || { echo "Host requires at least 120 GiB free on the /opt filesystem" >&2; exit 3; }

# A pre-existing symlink could redirect an apparently safe DesignPro write into
# another application tree. Every persistent cutover directory must be real.
for path in "$ROOT" "$ROOT/releases" "$ROOT/staging" "$ROOT/shared" "$ROOT/shared/spool"; do
  [[ ! -L $path ]] || { echo "Refusing symlinked DesignPro path: $path" >&2; exit 4; }
done


# Never claim loopback ports already owned by a non-DesignPro process. An
# idempotent reinstall may see containers from this exact Compose project.
for port in 3001 3002 8787; do
  if ss -H -lnt "sport = :$port" | grep -q .; then
    case "$port" in 3001) expected=runtime-1 ;; 3002) expected=runtime-2 ;; 8787) expected=gateway ;; esac
    owner=$(docker ps --filter "publish=$port" --filter label=com.docker.compose.project=designproai --format '{{.Label "com.docker.compose.service"}}')
    [[ $owner == "$expected" ]] || { echo "Loopback port $port is already owned outside the expected DesignPro service" >&2; exit 6; }
  fi
done

install -d -m 0755 "$ROOT" "$ROOT/releases" "$ROOT/staging"
install -d -m 0700 "$ROOT/shared"
install -d -o 10001 -g 10001 -m 0700 "$ROOT/shared/spool"
[[ ! -L $ROOT/shared/spool && $(stat -c '%u:%g:%a' "$ROOT/shared/spool") == 10001:10001:700 ]] || {
  echo "Persistent spool ownership or mode is unsafe" >&2; exit 7;
}
spool_free=$(df -B1 --output=avail "$ROOT/shared/spool" | awk 'NR == 2 {print $1}')
[[ $spool_free -ge $minimum_free_bytes ]] || { echo "Spool filesystem has less than 120 GiB free" >&2; exit 7; }
for role in runtime gateway; do
  env_file="$ROOT/shared/$role.env"
  [[ ! -L $env_file ]] || { echo "$env_file must not be a symlink" >&2; exit 7; }
  [[ -f $env_file ]] || install -m 0600 /dev/null "$env_file"
  chown root:root "$env_file"
  chmod 0600 "$env_file"
  install -m 0600 "$OPS_DIR/$role.env.example" "$ROOT/shared/$role.env.example"
done

[[ ! -L /etc/systemd/system/designproai.service ]] || {
  echo "Refusing a symlinked DesignPro systemd unit" >&2; exit 8;
}
install -m 0644 "$OPS_DIR/designproai.service" /etc/systemd/system/designproai.service
systemctl daemon-reload

echo "Base installed. No existing service, firewall, or public port was changed."
echo "Populate the two 0600 env files, then run deploy.sh with its exact archive digest."
