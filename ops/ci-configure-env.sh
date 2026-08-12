#!/usr/bin/env bash
set -Eeuo pipefail

# Remote half of the GitHub-driven environment configuration.
#
# This exists as a file rather than as a heredoc for one reason: the secrets
# arrive on standard input. An `ssh ... bash -s <<'HEREDOC'` invocation spends
# stdin on the script itself, so a pipe feeding the same ssh is silently
# discarded and the reader downstream sees the tail of the script where it
# expected a key. Invoking a staged script by path leaves stdin free for what
# it is actually for, which is the pattern ci-dark-deploy.sh already uses.
#
# Secrets pass straight through to configure-env.sh. Nothing here reads, holds,
# echoes, or writes one.

: "${REMOTE_STAGE:?remote stage required}"

[[ $REMOTE_STAGE == "/tmp/designproai-env-"* ]] || { echo "Unsafe remote staging path" >&2; exit 2; }
[[ -d $REMOTE_STAGE && ! -L $REMOTE_STAGE ]] || { echo "Remote staging path is missing or unsafe" >&2; exit 2; }

control="$REMOTE_STAGE/ops"
[[ -d $control && ! -L $control ]] || { echo "Configuration controls are missing" >&2; exit 3; }

# configure-env.sh writes into a layout it does not create. Establishing it is
# the same idempotent base install the dark deploy runs, and it changes no
# public port, firewall rule, or running service.
if [[ ! -d /opt/designproai/shared || -L /opt/designproai/shared ]]; then
  echo "Base layout missing; running the idempotent base install first."
  "$control/install.sh" I_UNDERSTAND_NO_RP_CHANGES
fi

"$control/configure-env.sh" CONFIGURE_DESIGNPRO_SECRETS_ONLY
python3 "$control/validate-env.py" \
  /opt/designproai/shared/runtime.env /opt/designproai/shared/gateway.env
