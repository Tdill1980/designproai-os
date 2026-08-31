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
- [x] Call 9 deterministically verifies/promotes accepted Call-1 panel descendants and fails closed on byte/hash/surface drift; it contains no creative model call.
- [ ] PanelProStudio shows the accepted design and the exact real production panels for the same Generation ID.
- [ ] Full QC validates the exact panel set intended for print and creates durable receipts.
- [ ] Owner/promo testing creates a real server-side entitlement using the same production authorization contract as paid use.
- [ ] Output/upscale cannot redesign artwork and creates new versioned artifacts.
- [ ] Final QC, ZIP manifest and WrapBox retain complete lineage to the accepted A.T.L.A.S. revision.
- [ ] Durable queues, idempotency, retries, concurrency control, failure recovery and observability are implemented server-side.
- [ ] UI/UX works DESIGN → REVISE → PANELS → QC → WRAPBOX without manual IDs, SQL, hidden RPCs or engineering intervention.

## Verified release state — 2026-08-31

- [x] PR #272 merged and deployed the customer-lifecycle fixes at `4638db8b`: authoritative Commercial/ReStyle selection, prompt/mode retention, GenerationID carry-through and advisory-only semantic Call-1 review.
- [x] PR #273 merged and deployed exact SHA `c582673d3316b4baa62f4a511af9796ee4b95d8a`: apex `/api/*` now reaches the existing gateway, apex is in the origin allowlist and a Design Prep technical retry retains the same GenerationID.
- [x] PR #273 release gate, web, gateway, Caddy/droplet install and two distinct runtime replicas accepted the same exact SHA.
- [x] No canary was run for PR #272 or PR #273.
- [x] The owner-selected DCA policy supersedes every historical “run a canary” item below. Validation is one real customer-style lineage through PanelProStudio, followed by owner confirmation before Full QC.

- [x] Workflow UI/UX PR #258 merged as `b6b30c1e913c3656602923affb30face6ab6c013`; it is an ancestor of the deployed release and carries one Generation ID through DESIGN → REVISE → PANELS → QC → WRAPBOX without manual copy/paste handoffs.
- [x] Generation-ID OS kernel PR #260 merged as `01eb47ddea1c9c67c240aba172f8b4a5d5e2d5eb`; it is an ancestor of the deployed release.
- [x] Labeled A.T.L.A.S. Call-1 recovery PR #261 merged as `b7e639721918f7290e2ff0f8ed124c989d1c38c4` with all four required checks passed.
- [x] Protected manual dark-deploy workflow run #839 succeeded for exact `main` SHA `b7e639721918f7290e2ff0f8ed124c989d1c38c4` in 6m 46s and produced the exact-droplet inventory artifact.
- [x] Run #839 built and labeled both `designproai-runtime` and `designproai-gateway` with exact SHA `b7e639721918f7290e2ff0f8ed124c989d1c38c4`, deployed web, gateway and two exact-SHA server-owned runtime replicas, and passed isolated dark loopback infrastructure acceptance on `designproai-prod-sfo3`.
- [x] Release archive layout, manifest/content hashes, extracted release tree, role-separated environment files, shared restart-safe spool and exact-SHA runtime isolation all passed in run #839. Topaz Call 12 and Stripe checkout were enabled without printing secrets.
- [x] Historical canary requirement superseded on 2026-08-31. Do not run a canary; use the real DCA path.

## Resolved release — PR #260

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
- [x] PR #260 merged as `01eb47ddea1c9c67c240aba172f8b4a5d5e2d5eb`.
- [x] Exact merged SHA `01eb47ddea1c9c67c240aba172f8b4a5d5e2d5eb` deployed to `designproai-prod-sfo3` through the protected exact-artifact workflow.
- [x] Droplet acceptance verified the exact release/image SHA `01eb47ddea1c9c67c240aba172f8b4a5d5e2d5eb`; protected deploy workflow run #834 succeeded.

## Resolved merge/deploy — PR #261; historical canary item superseded

- [x] Production canary failure localized: GENIE supplied the correct Hood geometry, but Call 1 had been given six unnamed rectangles and label-only panel entries, so side-view artwork could occupy the Hood region.
- [x] Call 1 restored to one complete flattened 4K A.T.L.A.S. design through `design-panel-ai-generate` `atlas-artboard`; DCA and the separate `persona-photographer-render` 3D-proof architecture are unchanged.
- [x] **Historical state, superseded:** the model-facing topology briefly carried gutter labels and anonymous field prose. The current contract uses an unlabeled/unstroked mask plus named surface/YMM/body-class prompt data; dimensions and technical furniture remain server-only.
- [x] **Historical state, superseded:** semantic master review once blocked Call 1. It is now advisory; only deterministic structural/container/canonical-byte/hash/dimension/lineage gates may block publication.
- [x] Live canary evidence before this fix: Generation `ed000590-1658-4f26-adbe-c11c68d13517` reached one immutable A.T.L.A.S. revision and seven active proof roles; its Entice workflow completed with six `panel` and six `qc-panel` artifacts.
- [x] The same live run exposed the next OS seam: the canary duplicated the automatic Production workflow and created no entitlement, leaving both runs honestly at `await_purchase`.
- [x] Canary repaired to consume exactly one server-created Production workflow and persist/verify a real Generation-bound owner promotion entitlement through `confirm_designpro_purchase`; no browser boolean or purchase bypass is accepted.
- [x] Exact local release gate repeated after both repairs: runtime/schema 386, repository contracts 496, gateway 63, web 8, app 74, server/archive 57, and both production builds passed.
- [x] PR #261 opened at initial head `dfe063840b18d7f2fbc9cea334495a6445790a32`, repaired at `be75cb0e5515e99146bef8dedb312d402cba3689`, and finalized at `da6bde122fe9738b032ca1039ed41ca677e2e0f1`.
- [x] Exact final PR release gate #741 succeeded at head `da6bde122fe9738b032ca1039ed41ca677e2e0f1`; executable contracts, Supabase shadow migrations/pgTAP and the immutable release archive all passed.
- [x] PR #261 merged as exact `main` SHA `b7e639721918f7290e2ff0f8ed124c989d1c38c4`.
- [x] Exact merged SHA `b7e639721918f7290e2ff0f8ed124c989d1c38c4` deployed and independently verified on `designproai-prod-sfo3` by protected workflow run #839.
- [x] Historical canary release item superseded on 2026-08-31. The DCA is the only production validation path.

## Current DCA evidence — Oasis Pools, 2026-08-31

- [x] Real owner-browser lineage retained GenerationID `a2a31bb7-9d0b-43b0-a00c-ca9c836e9d50`.
- [x] Server created DesignID `DID-A2A31BB7` when the generation request reached it.
- [x] Call 1 created immutable A.T.L.A.S. revision `f28ac210-0018-4175-b88d-050cc2bb9965`.
- [x] Call 1 persisted accepted master hash `c99ba8353589b1ce008d45ce4d0f568bd2efc2bd18132fd2bbf5f42081ad0b2e`.
- [x] The revision carries all six content-addressed Call-1 panel records and all six storage objects exist.
- [x] Exact failing descendant identified: `hood_detail` was rejected by the proof-staging path allowlist even though the downloaded bytes matched the photographer hash.
- [x] Exact PanelPro click regression identified: a thin list record was cast to a full job and dereferenced before hydration; the fully hydrated surface row also read `job.qc_side_panels` instead of `job.concept_json.qc_side_panels`.
- [x] Exact design-quality regression identified: current Call 1 received anonymous fields without canonical vehicle identity, named physical relationships, pickup exclusion context or the proven vehicle-wrap designer persona.
- [x] Attached screenshots prove weak design quality and cross-surface/view inconsistency; the Porsche's requested one-off angle and aspect ratio are explicitly excluded from the diagnosis.
- [x] Exact fake-Passenger risk identified: deterministic Driver-to-Passenger mirroring can overwrite the separately authored Passenger Call-1 region and is not a valid structural gate.
- [ ] Merge and deploy the smallest proof-identity, PanelPro hydration/publication and Call-1 conditioning repairs.
- [ ] Resume/re-run a real DCA and prove the accepted master plus all six Call-1 panels appear immediately in PanelProStudio.
- [ ] Continue that same lineage through all required views, Call 8 and Call-9 byte-identical promotion; then stop in PanelProStudio for owner confirmation before Full QC.

## Required live acceptance

- [ ] Select real vehicle and run vehicle prep.
- [ ] Confirm saved GENIE/topology/proof fast path for known vehicle.
- [ ] Confirm grounded fallback + GENIE write-back for unknown vehicle.
- [ ] Generate A.T.L.A.S. master under 60s and driver proof under 90s.
- [ ] Confirm one cohesive vehicle-specific composition across Driver, Passenger, Hood, Roof, Front and Rear.
- [ ] Confirm Passenger is rendered from its own Call-1 panel and Hood is present; no Driver mirror substitutes for either.
- [ ] Confirm all presentation views preserve the same accepted A.T.L.A.S. artwork.
- [ ] Create revision in RevisionStudioIQ; old version remains available.
- [ ] Approve exact revision and prove stale descendants invalidate.
- [ ] PanelProStudio receives the exact six Call-1 panels immediately, then displays their Call-9-promoted state without byte drift.
- [ ] Full QC passes exact panel set.
- [ ] Real paid or owner/promo entitlement advances production.
- [ ] Output + final QC + ZIP + WrapBox complete.
- [ ] Canonical snapshot proves full lineage back to Call 1.
- [ ] Repeat with browser refresh / worker retry / failure recovery and no manual intervention.

## Do not do

Do not rebuild DesignProAI from scratch. Do not replace A.T.L.A.S. with independent surface generators. Do not use 3D proofs as production artwork. Do not make browser state the workflow authority. Do not claim production/live status without exact deployed-SHA verification.
