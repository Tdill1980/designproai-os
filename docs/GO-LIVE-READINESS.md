# Go-live readiness — what ships now, what cannot

Written 2026-08-12 against branch `claude/saas-migration-panel-pipeline-ke4ein`.

This document exists because "move DesignProAI and its suite of apps to the
server" is two different jobs with two different answers, and treating them as
one is how a go-live date gets missed.

## The short version

**The production kernel is deployable and the server machinery is complete.**
A shop that already has seven approved vehicle renders can be served end to
end today: upload, GENIE validation, the Call 8 2D production proof, six
deterministic panel cuts, logo inventory, both human QC gates, verified
production files, the stamped ZIP, and WrapBox delivery.

**The suite of apps is not in this repository and therefore cannot be moved.**
Not "needs wiring" — not extracted. `docs/DESIGNPROAI_SUITE_EXTRACTION_STATUS_2026-08-08.md`
records why: the historical `src/App.tsx` is a 67 KB mixed router carrying
DesignProAI, RestylePro, WPW, marketing, CRM and admin routes, and its Supabase
client hard-pins the RestylePro project `kfapjdyythzyvnpdeghu`. Copying it would
silently reconnect this server to RestylePro data. That is the reason the suite
was never a copy job, and it has not changed.

So: a kernel go-live is a scheduling question. A suite go-live is a build.

## What is in this repository and working

- Authentication, tenancy, immutable revision ingest with byte-hashed seven-view sources
- Universal GENIE validation gate — human-validated exact six-surface geometry
- Call 8: one continuous flat wrap design, plus the customer 2D Production Proof
- Call 9: six deterministic panel cuts at GENIE trim + 5" bleed, hash-verified
- Call 10 logo inventory, pack verify/activate
- PanelPro preflight and final human QC gates, both approving hashes
- Verified production outputs — PNG, TIFF, EPS per side, 18 files
- DesignID + Order # stamp, deterministic ZIP64, WrapBox delivery
- Revision Studio showing the proof and every cut panel with its provenance
- Two fenced workers, DB-owned leases, restart-safe resume

Gate status: 191 checks green (`node scripts/run-all-tests.mjs`).

## What is missing, from this repository's own audit

Per `DESIGNPROAI_SUITE_EXTRACTION_STATUS_2026-08-08.md` and
`DESIGNPROAI_DETERMINISTIC_END_TO_END_WORKFLOW_2026-08-08.md`:

| Component | State |
|---|---|
| Calls 1–7 generation engine | Adapter and claim contract present; **engine not ported** |
| DesignPro shell + generation page | Blocked on splitting the mixed router |
| MyVehiclePro | API and storage closure missing |
| Gallery | Read model and API missing |
| RecreatePro, WallPro, GraphicsPro | Not extracted |
| Full PanelProStudio, ApprovePro | Partial — QC gates exist, workspace does not |

The repository's stated next code PR is the **standalone Calls 1–7 generation
adapter**, after which the shell and generation page become a bounded
extraction, with MyVehiclePro and Gallery behind their own server APIs.

## The consequence for a kernel go-live

This system **consumes** the seven renders; it does not make them. Until Calls
1–7 are ported, renders come from one of:

1. **Customer/operator upload** — already fully supported. No dependency on the
   historical pipeline at all. This is the fastest path to serving a paying
   customer.
2. **The historical generation runner**, handing off through the Calls 1–7
   adapter. Note it must now present engine contract
   `designpro.calls-1-7-engine.v2` — it must have given up 2D-proof authority.
   A runner still on v1 is refused with `generation_contract_drift`.

Option 1 needs no further build. Option 2 needs the legacy runner updated.

## Blocking items before any public traffic

Ordered. Each is a real gate, not a formality.

1. **Merge to `main`.** The deploy workflow deploys only the artifact from a
   successful `Exact DesignProAI release gate` run for an exact `main` SHA. It
   never rebuilds. Work on a branch cannot deploy.
2. **Apply migrations to the production project.** Protected
   `workflow_dispatch` with `APPLY_DESIGNPRO_PRODUCTION`, on `main`, requires a
   reviewer. Includes `20260812120000_designpro_retire_legacy_2d_proof.sql`.
3. **Verify droplet backups.** Recorded as BLOCKED. A snapshot must exist or
   the droplet must report backups enabled — the UI checkbox is not proof.
4. **Configure root-owned environment files** on `137.184.0.4` via
   `configure-env.sh`. Never in chat, logs, or this repository.
5. **Dark deploy and local acceptance** — steps 1–6 of the `ops/README.md` safe
   sequence. No DNS change.
6. **Run the real canary.** Seven distinct views, GENIE validation, the 2D
   proof, six unique panel cuts, logos, PanelPro approval, outputs, final QC,
   stamp, ZIP, WrapBox. Then kill a worker mid-run and prove server-side resume
   without regenerating accepted artifacts. **This has never been run.**
7. **Caddy + DNS**, then public TLS acceptance.
8. **Outbound email** for public go-live. Runtime currently reports
   `publicGoLiveReady=false` with `outbound_email_disabled`. Requires a
   dedicated DesignProAI Resend key, verified sender, and the attestation.
   Do not substitute an RP/WPW key.

## Unproven, stated plainly

Everything in the kernel is verified by contract tests and local mechanism
checks. **Nothing has been run against live Gemini and Supabase on the
droplet.** The two open unknowns are design quality from the single-call Call 8
prompt, and print resolution: the model returns roughly 16 px/in at full scale
before `output.build` interpolates to 150 px/in. That stretch adds no detail.
It is the same stretch the historical pipeline performed, and it is the gap the
purchase-time upscale step was meant to close. `output.build` is the seam for
it.

## Recommendation

Ship the kernel to customers who bring their own renders, on the upload path,
while Calls 1–7 and the suite are extracted behind it. That converts a blocked
launch into a staged one and starts serving the customers who are waiting.
