# DesignProAI standalone server cutover

Target host: `137.184.0.4` (Ubuntu 24.04). The displayed DigitalOcean
droplet name and old repository documentation are not trusted for capacity;
`inventory.sh` reports the live CPU, RAM, disk, listeners, and service owners.

This package deploys only the standalone DesignPro OS under
`/opt/designproai`. It never installs PR #4119, modifies an RP directory, or
contains a tool for stopping RP services. RestylePro relocation is a separate
owner/session responsibility.

## Non-negotiable boundary

- Calls 8–11 and all production-file work execute in the two fenced DesignProAI runtimes. No external VectorizIt, Railway conductor, or browser worker is a deployment prerequisite.
- Runtime ports `3001` and `3002` and gateway port `8787` bind only to
  loopback. Caddy exposes the white UI and `/api/*` gateway only.
- The runtime `current` pointer is accepted locally before the separate Caddy
  `public` pointer changes, so a failed deploy leaves the prior UI live.
- `/worker/*` is an explicit public 404. Browsers submit, inspect, and approve;
  they do not call a production worker.
- No global Docker, PM2, firewall, or process mutation is part of this package.
- Every mutation requires a narrow confirmation token.

## Required release artifact

Build one gzip tarball from the standalone repository—not a monorepo checkout.
Its exact code layout is:

- `runtime/index.js`
- `runtime/designpro-standalone-claimant.cjs`
- `runtime/runtime-contract.cjs`
- `runtime/runtime-readiness.cjs`
- `runtime/genie-universal-resolver.cjs`
- `runtime/gemini-flat-surface.cjs`
- `runtime/output-qc.cjs`
- `runtime/resend-transport.cjs`
- `runtime/wrapbox-delivery.cjs`
- `runtime/zip-spool.cjs`
- `runtime/package.json` and `runtime/package-lock.json`
- `gateway/src/server.mjs`
- `gateway/package.json` and `gateway/package-lock.json`
- `web/dist/index.html` and optional built `web/dist/assets/*`
- manifest-bound `ops/Dockerfile.runtime`, `ops/Dockerfile.gateway`, both
  healthchecks, `ops/compose.yaml`, and the canonical `ops/release-files.txt`
- `.designpro-release.json`

Generate the manifest **before** creating the tarball:

```bash
python3 ./ops/build-release-manifest.py ./release "$GIT_SHA"
tar -C ./release -czf designproai-release.tgz .designpro-release.json runtime gateway web ops
sha256sum designproai-release.tgz
python3 ./ops/validate-archive.py designproai-release.tgz "$GIT_SHA"
```

The manifest binds every permitted file hash to the exact 40-character Git
SHA. The deployment also requires the independently calculated tarball
SHA-256. Links, devices, traversal, hidden env files, Node modules, extra
runtime/gateway files, and RP code are rejected before extraction.

`ops/release-files.txt` is the single archive allowlist used by the builder,
manifest generator, archive validator, release-tree validator, and tests. The
deployment copies the archive once into root-owned staging and uses only the
manifest-bound Docker/Compose controls from that copy. Built image IDs are
recorded and rechecked during acceptance and rollback.

## Capacity and persistent spool

Installation refuses hosts below 8 logical CPUs, 15 GiB RAM, a configured
8-GiB active swapfile (7.5-GiB accounting floor for Linux page-size
tolerance), or 120 GiB free on the `/opt` filesystem. Both fixed-UID (10001) runtime
containers share `/opt/designproai/shared/spool`, mounted at
`/var/lib/designproai/spool`; the read-only container roots and 256 MiB `/tmp`
are never used for production ZIPs. Runtime containers are capped at 6 GiB and
3 CPUs each, and the gateway at 512 MiB and 0.5 CPU. The database-wide heavy
lease remains the authority that permits only one `output.build` at a time.

## Secret separation

Run `install.sh` first, then run the hidden-prompt configurator without pasting
any private value into chat or committing it:

```bash
sudo ./configure-env.sh CONFIGURE_DESIGNPRO_SECRETS_ONLY
```

It pins the public project identity, generates a separate worker secret,
validates role separation, and atomically writes these root-owned `0600` files:

- `/opt/designproai/shared/runtime.env`, copied from `runtime.env.example`:
  isolated Supabase secret key, an independent random worker secret, Google AI
  key, Google image model, app origin, persistent spool and direct TUS paths,
  verified Resend sender/key.
- `/opt/designproai/shared/gateway.env`, copied from `gateway.env.example`:
  isolated Supabase publishable key, HTTPS app origin, Docker-internal runtime
  URL, and the same internal `WORKER_SECRET`. It must never contain a Supabase
  secret key.

`validate-env.py` checks exact key sets, file ownership/mode, the isolated
project URL, secret separation, HTTPS origin. It
does not print values.

## Safe sequence

1. Read-only inventory:
   `sudo ./inventory.sh | tee inventory.txt`
2. Root-only recovery snapshot:
   `sudo ./backup.sh`
3. Base boundary:
   `sudo ./install.sh I_UNDERSTAND_NO_RP_CHANGES`
4. Configure secrets through hidden server-console prompts:
   `sudo ./configure-env.sh CONFIGURE_DESIGNPRO_SECRETS_ONLY`
5. Deploy an exact artifact (arguments deliberately include both identities):

   ```bash
   sudo ./deploy.sh /path/designproai-release.tgz \
     <40-char-git-sha> <64-char-tarball-sha256> DEPLOY_DESIGNPRO_ONLY
   ```

6. Local infrastructure acceptance:
   `sudo ./acceptance.sh <40-char-git-sha>`
7. Install/reload only the isolated Caddy site:
   `sudo ./install-caddy.sh <40-char-git-sha> INSTALL_DESIGNPRO_CADDY_ONLY`
8. Add `os.designproai.com -> 137.184.0.4` only after local acceptance.
9. Public TLS acceptance:
   `sudo ./acceptance.sh <40-char-git-sha> https://os.designproai.com`
10. Run the real distressed-Porsche canary: seven distinct views, GENIE
    validation, eighth 2D proof, six unique ninth-stage panels, exact logos,
    PanelPro approval, outputs, final QC/stamp, ZIP, and WrapBox. Then force a
    retry with the browser closed and prove server-side resume.

Infrastructure acceptance deliberately does not claim the production canary
has passed. Production traffic switches only after step 10.

## Protected production migrations

The release workflow shadow-applies every migration first. A live push exists
only on manual `workflow_dispatch` with `APPLY_DESIGNPRO_PRODUCTION`, on `main`,
after the exact-head tests and reproducible archive pass. Its
`designproai-production` GitHub Environment must have a required reviewer and
these environment secrets: `DESIGNPRO_SUPABASE_ACCESS_TOKEN`,
`DESIGNPRO_SUPABASE_DB_PASSWORD`, and
`DESIGNPRO_PRODUCTION_APPROVAL_TOKEN=APPROVED_DESIGNPRO_PRODUCTION_MIGRATION`.
The job links only `wozyamlnygaddievzuwn`, uploads its dry-run plan, never calls
remote reset, and then applies that same exact-head migration set.

Rollback only the DesignPro release symlink and containers:

```bash
sudo ./rollback.sh <previous-40-char-sha> ROLLBACK_DESIGNPRO_ONLY
```
