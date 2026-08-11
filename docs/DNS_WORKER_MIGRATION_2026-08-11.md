# DNS worker migration — completion record (2026-08-11)

**Every claim here says how it was verified.** Branch:
`claude/dns-worker-migration-u8yza3` (this file rides it in both repos).

## What moved

The DesignProAI print worker (erase passes, panel slices, upscales, durable
entice/production claimants) now runs on the dedicated DigitalOcean droplet
`designproai-prod-sfo3` (137.184.0.4), two replicas behind the host Caddy at
**https://worker.designproai.com** (loopback 3101/3102, round-robin,
health-checked). Railway is untouched and remains the fallback.

## Verified end state

| Claim | Evidence |
|---|---|
| DNS live | `worker.designproai.com` → 137.184.0.4 (resolver check, this session) |
| Deploy green | restylepro-os deploy run **#37** (`c20b8803`), conclusion **success** — first green ever. The run's own health gate curls `https://worker.designproai.com/health` from the droplet. |
| Publicly serving | WebFetch from outside: `status:ok, ready:true, commit:c20b8803, workerId:digitalocean-b, aiAllowedAfterCall7:false, legacyPanelPollerEnabled` absent from health but compose-gated false. |
| WORKER_URL flipped | `set-fn-secret.yml` run 31453381759, success, `WORKER_URL=https://worker.designproai.com`. All consumers read `Deno.env.get("WORKER_URL")` at call time. |
| Railway fallback healthy | `restylepro-os-production.up.railway.app/health`: ready:true, commit `bb932adb`, checked this session. |
| File outputs produced | Failed entice pack run `06842319-b1f1` (visualization `8c3787a6`, design `0ce03398`) **resumed via `resume_designpro_entice_pack`** → all 8 stages completed 02:49:23–29 UTC; pack `aa19de6b` now **active**, 6 panels, `deterministic-source-integrity` pass, `aiUsed:false`, GENIE dims (driver 225.2″×56″ + 5″ bleed). Verified in `designpro_entice_packs` + `workflow_stage_runs`. |

## What it took (the deploy-run ladder, all tonight)

- Run 33: workers built + healthy; died on `host caddy service is not running`.
- PR #4249 (parallel session): start a stopped caddy. Run 34: caddy start
  "succeeded" per systemd, but nothing bound :443 — no diagnostics existed.
- PR #4251 (this session): print caddy status/journal/listeners/loopback probe
  on health-gate failure. Run 35's journal then named the killer exactly:
  `open /var/log/caddy/designpro-worker-access.log: permission denied`, unit
  dead in 7ms. **`caddy validate` runs as root and provisions the config,
  creating that log file root-owned; the caddy service user can never open
  it. Every validate re-armed the landmine.**
- PR #4252 (parallel session): stop the sibling `caddy-api.service` +
  pre-gate :443 listener poll. Run 36: still failed (no chown).
- PR #4253 (this session, rebased over #4252): `chown -R caddy:caddy
  /var/log/caddy` after every validate. **Run 37: green.**

## Open finding — hand to the next session (do NOT re-diagnose from scratch)

At 02:51:12 UTC, entice run `f07eb5ee` `proof.build` attempt 7 (resumed by this
session) failed with **HTTP 401 "Authentication required" from
`generate-2d-proof`** — despite the worker's `callFn` sending BOTH
`Bearer ${SERVICE_KEY}` and `x-worker-secret`. Edge logs 02:48–02:54 show a
sustained mix on `panel-artboard-generator`: 200s interleaved with many 401s,
plus long-running `panel-pro-extract` 200s — consistent with two claimant
fleets where one's credentials the functions accept and one's they reject.

Facts that constrain the diagnosis:
- The 401 caller's DB credentials WORK (stage claims/leases succeeded via
  PostgREST) while the edge functions' strict string equality
  (`bearer === SUPABASE_SERVICE_ROLE_KEY env`) rejects it — the signature of a
  new-format Supabase key (`sb_secret_…`) vs the legacy JWT, or a
  WORKER_SECRET mismatch (both paths must fail for a 401).
- BUT designproai-os `bootstrap-restylepro-worker-access` (run #3, success,
  00:08 UTC tonight) writes the droplet env by fetching `service_role` and
  `WORKER_SECRET` **from the Supabase Management API** — so the droplet SHOULD
  hold exactly the right values. If it does, the 401 caller is something else
  (Railway with a stale key after the P0 auth hardening, or a third caller).
- A parallel Claude session (session_01SQFxZuNg…) was actively working this
  pipeline at the same time; some of that 401 traffic may be its testing.

Next step that settles it in one move: log the caller identity (worker id
header) inside `generate-2d-proof`/`panel-artboard-generator`'s 401 branch, or
diff the droplet env against the function env via the deploy workflow (which
has root SSH). Then fix the one credential that differs.

Also pre-existing, unrelated to the migration: `f07eb5ee`'s job had already
failed proof.build 6 times since 2026-08-05.

## 401 FINDING — CLEARED (2026-08-11, follow-up session)

**The 401 is fixed, proven, and shipped.** Root cause and proof below; every
claim says how it was checked. The diagnostic + fix workflow rides
`claude/designproai-delivery-chain-server-5noltc` in designproai-os
(`.github/workflows/bootstrap-restylepro-worker-access.yml`, DIAGNOSE /
FIX-WORKER-SECRET / PROVE-DROPLET jobs).

### Root cause (diagnosed, not guessed)

The migration bootstrap wrote the droplet `WORKER_SECRET` by reading
`GET /v1/projects/{ref}/secrets` — but that endpoint returns the **SHA-256
digest** of each secret, not its value (proven: the returned `WORKER_URL`
"value" equals `sha256("https://worker.designproai.com")` exactly). So the
droplet's `x-worker-secret` was the *digest* of the real secret, which the
edge functions' `workerSecret === WORKER_SECRET` check rejects. The bearer
path failed too: the function-env `SUPABASE_SERVICE_ROLE_KEY` digest
(`f39c8369…`) matches **no** key the `api-keys` endpoint returns, while the
droplet sends the current legacy `service_role` JWT (`ec14922d…`) — so
`bearer === SERVICE_ROLE_KEY env` is false as well. Both auth paths failing is
exactly the recorded 401; the droplet's DB writes kept working because
PostgREST validates the JWT cryptographically instead of by string equality.
(Fingerprint audit: designproai-os bootstrap workflow runs #4–#5, digests
only, no secret ever printed.)

### The fix (shipped, live)

`FIX-WORKER-SECRET` minted a fresh 64-hex `WORKER_SECRET`, POSTed it to the
Supabase function secrets, wrote it into
`/opt/designproai/config/designpro.env`, and recreated `worker-a`/`worker-b`
with the exact compose invocation `deploy.sh` uses. Verified end to end: the
function-side digest, the droplet env-file digest, and both containers'
in-process `WORKER_SECRET` digest all equal `57b4943b…` (run #7, 2026-08-11
05:10 UTC; secret value masked throughout). Railway is untouched and still
authenticates via its bearer.

### Proof the 401 is gone (queried, not assumed)

Resuming run `f07eb5ee` and firing the droplet's own
`/workflow/entice/drain` in the same second (PROVE-DROPLET, to beat Railway's
stale-credential claimants in the 5 s poll race), `proof.build` **attempt 10**
was claimed by `designpro-entice-pack:digitalocean-a` and ran **~2.5 minutes
with `error_code: null`** before failing on
`panel-artboard-generator returned HTTP 504`. Attempts 7–9 died in <2 s with
`Authentication required`. A downstream 504 gateway timeout is not auth — this
is the job's pre-existing proof failure history (failing since 2026-08-05), so
per the migration hand-off the auth work is done. `workflow_stage_runs`,
queried directly, shows the transition from `Authentication required` →
`panel_artboard_generator_failed`.

## OUTPUT-FILE DELIVERY CHAIN — hi-res build proven, back half blocked by a worker bug

Candidate job: entice pack `aa19de6b` (viz `8c3787a6`, design `0ce03398`,
active, 6 panels, GENIE dims), backing panelizer job
`603b8392-65ed-41cf-9c06-5eb3e4a26df9` (order **RP-101092**, user
`07e934b4-…`).

### STEP 1 hi-res build — WORKS at the file level (verified in storage)

Drove the sanctioned admin path `studioboard-build-print → worker
/process-panel` for `driver_side` with `jobId` = the panelizer **job** id,
GENIE dims 225.2″×56″, `inputPath` = the existing entice master
(`proof-tiles/e207b170…/masters/side.png`), `native:true, addBleed:true` — a
pure native upscale of the existing panel, no re-slice, no regenerate. The
droplet worker produced, confirmed in `storage.objects`:
- `production-packs/07e934b4-…/RP-101092/driver_side_225x56_1500dpi_CMYK.tiff`
  — **24.6 MB**, `image/tiff`, 33780×8400 panel → 35280×10979 with 5″ bleed,
  1500 DPI.
- `…/driver_side_225x56_1500dpi.png` — **92.7 MB** full-res PNG.
- `…/driver_side.png` — 2048px preview.

### Blocker A — the `print_worker` stamp cannot land (worker CAS bug)

Worker log, verbatim, after the files uploaded:
`completion stamp failed: stamp write: invalid input syntax for type json`.
`stampPrintWorker` (worker/index.js:184) does a read-modify-write guarded by an
optimistic compare-and-set `.eq("concept_json", concept)` where `concept` is a
JS **object**. supabase-js serializes that object into the PostgREST filter as
`[object Object]`, which PostgREST rejects as invalid JSON, so the update never
matches, retries 8×, throws, and is swallowed as a warning — the files exist
but `concept_json` stays `{}`. This fails for **every** object-valued
`concept_json`, so no `print_worker` stamp has succeeded since this CAS was
introduced (last real stamp: 2026-07-28). This is the true reason the back half
shows "0 QC stamps recently" / "unproven at volume" — not the wrong jobId.
Without the stamp there is no QC card, no `pending_qc`, no auto-ZIP, no WrapBox.

Recommended fix (worker code + droplet redeploy, owner's call — a shared
production worker rebuild): replace the whole-jsonb CAS with a scalar
optimistic lock on `updated_at` (a `BEFORE UPDATE` trigger,
`panelizer_jobs_updated_at`, bumps it on every write, so it is a correct
fence): read `concept_json, updated_at`; update `…eq("id",jobId).eq("updated_at",
row.updated_at)`; retry on miss. Avoids the jsonb-filter serialization entirely.

### Blocker B — no per-side EPS on the admin path

Worker log: `Vectorizer.AI: not configured`. On the non-source-bound admin
build, EPS is produced only if `VECTORIZER_API_ID`/`VECTORIZER_API_SECRET`
exist; the deterministic-raster EPS (`encodeDeterministicRasterEps`) is gated
to the **paid source-bound** path (`activate-print-worker` with a frozen Call-7
source). So the proof-of-done "TIFF + PNG + **EPS** per side" is only fully
reachable via the paid path, not the admin "Build Print Files" trigger.

### What remains (needs a human + an owner deploy decision)

1. Deploy the `stampPrintWorker` fix to the droplet worker (rebuilds both
   replicas via `deploy-designpro-digitalocean.yml`, main-only).
2. Re-run the per-side build → stamp lands → `pending_qc` → auto-ZIP.
3. **STEP 3 is human-only:** Trish works the six-box `ProductionPackQCCard`
   checklist and stamps. Nothing ships without her.
4. STEP 4: `deploy-to-wrapbox` copies to `wrap-files/wrapbox/{order}/`, upserts
   `production_packs` (`pack_url` = ZIP), emails with `expiresAt`, sets
   `panelizer_jobs.status = "ready"`; verify `/productionflow` + WrapBox.

## Rollback

Flip `WORKER_URL` back to `https://restylepro-os-production.up.railway.app`
via `set-fn-secret.yml`. Railway deployment untouched; its durable claimants
still poll. The droplet keeps serving until told otherwise — the two systems
share the durable queue by design (leases + fencing). Note: after the
`WORKER_SECRET` rotation, Railway still holds the *previous* secret; it
authenticates via its bearer today, but if a rollback ever needs Railway's
`x-worker-secret` path, update `WORKER_SECRET` in the Railway dashboard to
match the rotated value.
