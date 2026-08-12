#!/usr/bin/env bash
set -Eeuo pipefail

# Remote half of the GitHub-driven droplet configuration.
#
# It exists as a file rather than as a heredoc for one reason: the caller pipes
# the secrets into ssh on standard input, and a heredoc would claim that same
# stdin and silently discard the pipe. The reader on this side would then
# consume the tail of the script it was being fed and treat those lines as
# credentials. Invoking by path leaves stdin free for exactly one purpose.
#
# It configures. It does not deploy, does not move the current release symlink,
# and does not start, stop or restart a container.

: "${REMOTE_STAGE:?remote stage required}"

[[ $REMOTE_STAGE == /tmp/designproai-env-* ]] || { echo "Unsafe remote staging path" >&2; exit 2; }
[[ -d $REMOTE_STAGE && ! -L $REMOTE_STAGE ]] || { echo "Remote staging path is missing or unsafe" >&2; exit 2; }

control="$REMOTE_STAGE/ops"
[[ -d $control && ! -L $control ]] || { echo "Staged configuration controls are missing" >&2; exit 3; }

# configure-env.sh writes into a layout it does not create. Building it is the
# same idempotent base install the dark deploy runs, and it changes no public
# port, firewall rule, or running service.
if [[ ! -d /opt/designproai-os/shared || -L /opt/designproai-os/shared ]]; then
  echo "Base layout missing; running the idempotent base install first."
  "$control/install.sh" I_UNDERSTAND_NO_RP_CHANGES
fi

# The one canonical writer, reading the piped secrets from this script's stdin.
"$control/configure-env.sh" CONFIGURE_DESIGNPRO_SECRETS_ONLY

# Judged by the same validator the deploy uses, so a configuration that would
# fail at deploy time fails here instead, while nothing is at stake.
python3 "$control/validate-env.py" \
  /opt/designproai-os/shared/runtime.env /opt/designproai-os/shared/gateway.env
