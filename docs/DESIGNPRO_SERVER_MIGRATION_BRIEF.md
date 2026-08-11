# DesignPro → own server, own domain: session brief

Written 2026-08-11 at the owner's request, at the end of the session that moved
the production worker off Railway onto the DigitalOcean droplet. **Purpose: let
the next session finish the migration without rediscovering any of this.**

Everything in the "Verified live" table was measured this session, not assumed.
A session that finds reality disagreeing with this file should trust reality and
correct the file.

## The goal

Every DesignPro application runs on the owner's own server (`designproai-prod-sfo3`)
under her own domain (`designproai.com`), independent of Railway and Vercel.
Today DesignPro is a subset of a much larger mixed repo (`restylepro-os`, which
also holds WePrintWraps marketing, Canva/GBP/Klaviyo integrations, Behind the
Install, etc.). The end state is the DesignPro half living in `designproai-os`,
deployed to the droplet.

## Verified live (2026-08-11, measured)

| thing | state | evidence |
|---|---|---|
| Droplet | `designproai-prod-sfo3`, `137.184.0.4`, SFO3, 16 GB RAM / 320 GB disk | DO console + `hostname` check in every workflow |
| Droplet SSH | key-only; password auth disabled and proven off | `disable-password-ssh.yml` run: `Permission denied (publickey)`, `key-login-ok` |
| Production worker | **on the droplet**, 2 replicas, healthy | `https://worker.designproai.com/health` → `ready:true`, alternating `digitalocean-a`/`digitalocean-b` |
| `WORKER_URL` | `https://worker.designproai.com` | `set-fn-secret.yml` run log: `✅ set secret WORKER_URL` |
| `worker.designproai.com` | A → 137.184.0.4, valid TLS, serving | curl 200 |
| `designproai.com`, `www`, `os.designproai.com` | A → 137.184.0.4 but **TLS handshake fails** — no site block/cert on the server | `curl: (35) tlsv1 alert internal error` |
| `app.designproai.com` | no DNS record | dns.google |
| Web front end (RevisionStudio, PanelPro Studio, DesignPanelPro) | still on **Vercel**, out of `restylepro-os` | unchanged this session |
| Supabase | managed project `kfapjdyythzyvnpdeghu` (DB, edge functions, storage) | unchanged |
| Railway worker | still running, now unused, kept as fallback | owner has not ordered it killed |

## Already built — do NOT redo

- `restylepro-os/.github/workflows/deploy-designpro-digitalocean.yml` — builds and
  deploys the worker to the droplet. Pins host + key fingerprints, accepts the
  SSH key as PEM **or** single-line base64, falls back from
  `DESIGNPRO_DO_SSH_KEY` to `DESIGNPRO_DD_SSH_KEY`. Run 38 = first green.
- `restylepro-os/ops/designpro/` — `docker-compose.yml` (workers on loopback
  `127.0.0.1:3101/3102`, **no bundled proxy** — the host Caddy owns 80/443),
  `worker.designproai.caddy` (the public route), `deploy.sh` (installs the
  fragment, reloads Caddy, then gates on an external `https://.../health` check
  with rollback on failure).
- `designproai-os/.github/workflows/bootstrap-restylepro-worker-access.yml` —
  prepares the droplet end-to-end (Docker, dirs, env file written from live
  Supabase Management API credentials) and **rotates** the deploy key every run.
- `designproai-os/.github/workflows/disable-password-ssh.yml` — one-click SSH
  hardening, validates config before restarting so key access can't be lost.

## Known blockers, with the reason each exists

1. **`os.designproai.com` / `designproai.com` do not serve.** `designproai-os`
   ships `ops/Caddyfile.fragment` (a full site block for `os.designproai.com`
   proxying `/api/*` → `127.0.0.1:8787` and serving
   `/opt/designproai/public/web/dist`) and `ops/install-caddy.sh` to install it —
   but that script was never run against **this** droplet. Caddy is running and
   issuing certs (the worker fragment works), so this is an install step, not a
   broken server. `install-caddy.sh` requires a 40-char SHA + the token
   `INSTALL_DESIGNPRO_CADDY_ONLY`, runs `ops/acceptance.sh` first, refuses if a
   non-Caddy process owns 80/443, and backs up + rolls back on failure.
2. **`designproai-os` forbids RestylePro strings.** `tests/schema-gateway-reconcile.test.mjs:124`
   asserts the concatenation of `supabase/migrations/*.sql` +
   `gateway/src/server.mjs` + `web/src/main.tsx` + `web/src/api.ts` contains none
   of `restylepro`, `railway`, `slack-agent`, `143.110.237.145:3100`, `:8080`.
   This is deliberate — it keeps the standalone closure standalone. A naive
   copy-paste of RestylePro code into those paths WILL fail the release gate.
   Migration must translate names, not transplant them. (Note the scope: `docs/`
   and `ops/` are not covered by that assertion.)
3. **The upscale chain is still unproven.** `designpro.production_pack` has run
   exactly once ever and stalled on 2026-07-29. Buying the 16 GB droplet was
   specifically to make large upscales possible, so this is the highest-value
   thing to prove, and it needs a real **Order Production Pack** click on a
   pack that is 6/6 eligible.
4. **Frozen orchestration paths.** `restylepro-os/ORCHESTRATION_FREEZE.md` — the
   listed paths require owner branch `claude/call7-live` and commit trailers
   `Orchestration-Owner: Codex` / `Orchestration-Change: <desc>`; enforced by
   `tests/orchestration-freeze-lock.test.ts`. Check before editing.
5. **Supabase is managed and should stay managed.** Moving Postgres, auth,
   storage and 463 edge functions onto a single 16 GB droplet trades a managed,
   backed-up service for a single point of failure. The honest scope of "own
   server" is: **app + worker on the droplet, data stays on Supabase.** Anyone
   proposing otherwise should say so explicitly and get the owner's decision
   first — do not migrate the database silently.

## Suggested order

Each phase ends with something the owner can see working.

**Phase 1 — prove the box does the thing it was bought for.**
Get one pack to 6/6 eligible, click Order Production Pack, follow
`designpro.production_pack` through the worker on the droplet, and report the
real outcome. If it fails, fix it. Until this passes, nothing else matters.

**Phase 2 — serve the DesignProAI OS web app on the domain.**
Run `install-caddy.sh` on the droplet (via a workflow, the same pinned-key
pattern as the existing jobs — the owner cannot reliably use the DO web
console). Result: `https://os.designproai.com` serves the built web app with
valid TLS, and `https://designproai.com` either serves it too or redirects,
owner's choice. Add a site block for the apex/`www` — DNS already points here.

**Phase 3 — carve DesignPro out of `restylepro-os` into `designproai-os`.**
The real repo migration. Do it feature-slice by feature-slice, translating
names to satisfy blocker #2, with the release gate green at every step. The
studio surfaces (RevisionStudio, PanelPro Studio, DesignPanelPro) and the
design-call pipeline are the payload. Keep `restylepro-os` running until each
slice is proven on the droplet — no big-bang cutover.

**Phase 4 — retire the rented infrastructure.**
Only after Phases 1–3 are proven: point the studio domain at the droplet, then
kill Railway, then decide about Vercel. Get the owner's explicit go for each.

## Open build items carried forward

From `restylepro-os/docs/CANONICAL_DESIGN_CALL_CONTRACT.md` (the authority on
what Calls 8–11 must do):

- **Vehicle-shaped 2D proof.** The proof must be drawn on the flattened vehicle,
  not laid out as rectangular tiles. Restore it as a **deterministic composition
  of the frozen masters** — never by letting a model redraw the sides.
- **Call 7 sanity gate.** Refuse a generated master that contains a mirrored
  twin of a located branding element, or located text touching the trim edge.
  Both defects were observed live (mirrored 24/7 badge on DRIVER SIDE, truncated
  contact bar on ROOF, design `5714755c`) and Calls 8–11 reproduce them
  faithfully because they are byte-deterministic. Deterministic ≠ correct.

## How to work with this owner

- She has been told things were fixed when they were not, repeatedly. **Never
  report success without reading the live state** — a DB row, an HTTP response,
  a job log. Quote the evidence.
- "PR merge deploy" / "go" is standing authorization to open a PR, merge it once
  checks are green, and dispatch the deploy without asking again.
- She cannot reliably use the DigitalOcean web console (it intermittently refuses
  keyboard input and paste). Anything that needs to happen on the droplet should
  be a `workflow_dispatch` job using the pinned SSH identity, not an instruction
  for her to type.
- Never ask her to handle private key material by hand. The bootstrap workflow
  mints and rotates keys server-side.
- Calls 8–11 are deterministic by contract. Do not introduce an AI generation
  step anywhere in that path.
