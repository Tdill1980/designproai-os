# DesignProAI OS — LIVE BUILD CHECKLIST

This file is the cross-session recovery authority for the DesignProAI operating-system build. Check an item only when code/server evidence proves it.

## Definite chief aim

Print-ready panels from one accepted A.T.L.A.S. creative authority, with 3D proofs, RevisionStudioIQ, PanelProStudio, Full QC, output, ZIP and WrapBox all locked to one immutable Generation ID and complete version history.

## Hard architecture rules

- [x] `generationId` is the immutable job root.
- [x] A.T.L.A.S. Call 1 is the sole creative authority.
- [x] PR #260 adds append-only Generation-ID event history and a canonical server snapshot.
- [x] Production wording in PR #260 is corrected to frozen Call-1 A.T.L.A.S. panel lineage.
- [ ] A.T.L.A.S. flattened topology is stored as a persistent vehicle OS asset, never creatively rebuilt per job.
- [ ] Saved topology carries labeled DRIVER / PASSENGER / ROOF / HOOD / FRONT / REAR cards plus machine-readable `surfaceKey` metadata.
- [ ] Pickup open-bed interior is a deterministic exclusion mask while exterior bedsides remain printable.
- [ ] Vehicle make/model/configuration immediately starts server prep: GENIE geometry lookup, saved topology lookup, saved 3D proof configuration lookup.
- [ ] Known vehicles reuse geometry/topology/proof config with zero model calls for topology.
- [ ] Unknown vehicles use grounded factual dimensions, deterministic GENIE calculation, validation, database write-back, then topology creation once.
- [ ] Before Generate Design, geometry, dimensions, masks, topology and 3D-proof context are already bound/prepared.
- [ ] Generate Design freezes the DCA brief and runs Call 1 against the prepared topology; it does not redo vehicle prep.
- [ ] A.T.L.A.S. flattened design is viewable in under 60 seconds for a known/prepped vehicle.
- [ ] Driver-side 3D proof from the same A.T.L.A.S. revision is viewable in under 90 seconds.
- [ ] Every graph node persists artifacts, receipts, provenance and normalized downstream context.
- [ ] Server events continuously evaluate downstream readiness; the user never transports IDs/data between modules.
- [ ] RevisionStudioIQ preserves immutable version history and acceptance receipts.
- [ ] Accepted-revision changes invalidate stale proofs/panels/QC/output descendants.
- [ ] Call 9 deterministically verifies/promotes accepted Call-1 panel descendants and fails closed on drift.
- [ ] PanelProStudio shows the accepted design and the exact real production panels for the same Generation ID.
- [ ] Full QC validates the exact panel set intended for print and creates durable receipts.
- [ ] Owner/promo testing creates a real server-side entitlement using the same production authorization contract as paid use.
- [ ] Output/upscale cannot redesign artwork and creates new versioned artifacts.
- [ ] Final QC, ZIP manifest and WrapBox retain complete lineage to the accepted A.T.L.A.S. revision.
- [ ] Durable queues, idempotency, retries, concurrency control, failure recovery and observability are implemented server-side.
- [ ] UI/UX works DESIGN → REVISE → PANELS → QC → WRAPBOX without manual IDs, SQL, hidden RPCs or engineering intervention.

## Current release blocker — PR #260

- [x] PR #260 exists.
- [x] Original failing head SHA identified: `9094150857d07211790ff2acdf5be550ee122556`.
- [x] Exact release run #729 identified.
- [x] `executable-contracts` reached `npm test` and failed there.
- [x] `supabase-shadow` reached fresh Auth/Storage/PostgREST/migrations/pgTAP and failed there.
- [x] Exact npm-test bootstrap failure identified: `tests/supabase-bootstrap.test.mjs` still hard-coded the pre-kernel 81-migration chain while PR #260 adds migrations `20260829230000` and `20260829230100`.
- [x] Bootstrap contract repaired to require the new 83-migration chain and explicitly include both Generation OS migrations. Repair commit: `046b4f4679dfc06278cde755741211b7acf351ad`.
- [x] Additional npm assertion identified and repaired: `tests/schema-gateway-reconcile.test.mjs` still expected the pre-OS migration tail instead of both Generation OS migrations.
- [x] Exact migration/pgTAP failures identified: purchase confirmation queried nonexistent `designpro_workflow_runs.generation_id`; legacy rows were rejected with `workflow_run_generation_identity_missing`; artifact/receipt trigger tests used the wrong pgTAP overload; new SECURITY DEFINER trigger functions retained default execute privileges.
- [x] Supabase migration/pgTAP failures repaired without redesigning A.T.L.A.S.: purchases resolve Generation ID through the revision-source contract; legacy unbound rows remain compatible without inventing lineage; artifact/receipt triggers assert their exact functions; PUBLIC/anon execute is revoked from every new SECURITY DEFINER function. Repair commits: `3d1ed060dd91e631a44d534bbffc65d836147006`, `9ae9162276f4cef0d5398798a2f7c4091bd9794f`, `4fbed7c40424b965621f4477dda7732e5129543f`.
- [x] Exact PR release gate rerun green: run #735, attempt 2, head `4fbed7c40424b965621f4477dda7732e5129543f`; executable contracts, fresh Supabase migrations/pgTAP, immutable archive reproducibility and manifest-bound image builds all passed. Production migration was correctly skipped until trusted merged/main context.
- [ ] PR #260 merged.
- [ ] Exact merged SHA deployed to `designproai-prod-sfo3`.
- [ ] Droplet SHA independently verified.

## Required live acceptance

- [ ] Select real vehicle and run vehicle prep.
- [ ] Confirm saved GENIE/topology/proof fast path for known vehicle.
- [ ] Confirm grounded fallback + GENIE write-back for unknown vehicle.
- [ ] Generate A.T.L.A.S. master under 60s and driver proof under 90s.
- [ ] Create revision in RevisionStudioIQ; old version remains available.
- [ ] Approve exact revision and prove stale descendants invalidate.
- [ ] PanelProStudio receives exact deterministic panels.
- [ ] Full QC passes exact panel set.
- [ ] Real paid or owner/promo entitlement advances production.
- [ ] Output + final QC + ZIP + WrapBox complete.
- [ ] Canonical snapshot proves full lineage back to Call 1.
- [ ] Repeat with browser refresh / worker retry / failure recovery and no manual intervention.

## Do not do

Do not rebuild DesignProAI from scratch. Do not replace A.T.L.A.S. with independent surface generators. Do not use 3D proofs as production artwork. Do not make browser state the workflow authority. Do not claim production/live status without exact deployed-SHA verification.
