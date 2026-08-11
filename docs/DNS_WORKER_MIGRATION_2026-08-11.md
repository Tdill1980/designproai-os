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

## Rollback

Flip `WORKER_URL` back to `https://restylepro-os-production.up.railway.app`
via `set-fn-secret.yml`. Railway deployment untouched; its durable claimants
still poll. The droplet keeps serving until told otherwise — the two systems
share the durable queue by design (leases + fencing).
