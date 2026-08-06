# DesignProAI server cutover package

Target host: `143.110.237.145` (Ubuntu 24.04).

This package is deliberately **not** PR #4119's host boundary. It installs a
standalone DesignPro runtime under `/opt/designproai`, leaves
`/opt/restylepro` alone, and binds the application only to loopback. Caddy is
the sole public entry point.

## Non-negotiable preservation rules

- `:3200` / VectorizIt must remain healthy throughout.
- No `pm2 kill`, global Docker stop/restart/prune, broad `docker compose down`,
  recursive deletion, or modification of `/opt/restylepro`.
- `:3100` is retired only by `retire-rp-service.sh 3100 <exact-name>` after
  its caller has been disabled and WrapGuru/Check My File canaries pass.
- `:8080` and media-parser are retired only after their GitHub Actions
  fallbacks pass and their callers have been switched.
- All install/deploy/rollback actions require an explicit confirmation token.

## Required release artifact

Supply one tarball with the verified standalone closure. Do not use a monorepo
checkout or PR #4119 artifact. Its exact layout is:

- `runtime/index.js` and its locked Node package (port 3001)
- `gateway/src/server.mjs` and its locked Node package (port 8787)
- `web/dist/index.html` and built static assets

The runtime's real `GET /health` contract must return `ready: true`, the exact
release `commit`, and its unique `workerId`. The deployment runs two replicas,
`designpro-worker-1` and `designpro-worker-2`. The gateway's real health route
is `GET /healthz`. Caddy serves the web shell, sends `/api/*` to the gateway,
and load-balances `/worker/*` across the two runtimes.

## Safe sequence

1. `sudo ./inventory.sh | tee inventory.txt`
2. `sudo ./backup.sh`
3. Create `/opt/designproai/shared/runtime.env` and `gateway.env`, fill only
   their respective secrets, set mode `0600`, and never print them.
4. `sudo ./install.sh I_UNDERSTAND_NO_RP_CHANGES`
5. `sudo ./deploy.sh /path/release.tgz <40-char-git-sha> DEPLOY_DESIGNPRO_ONLY`
6. Run `sudo ./acceptance.sh <sha>` locally.
7. Install the isolated Caddy site with
   `sudo ./install-caddy.sh INSTALL_DESIGNPRO_CADDY_ONLY`.
8. Point DNS only after the local acceptance passes.
9. `sudo ./acceptance.sh <sha> https://os.designproai.com`

Rollback: `sudo ./rollback.sh <previous-sha> ROLLBACK_DESIGNPRO_ONLY`.
