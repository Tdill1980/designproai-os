# DesignProAI Deterministic End-to-End Workflow

**Contract date:** 2026-08-08  
**Status updated:** 2026-08-09  
**Repository:** `Tdill1980/designproai-os`  
**Deployment target:** dedicated DesignProAI production droplet `137.184.0.4`  
**Status:** canonical migration, preservation, repair, deployment, and acceptance contract

## 0. Verified migration status and zero-duplication checklist — 2026-08-09

This checklist records evidence at the continuation point after PRs #4 and #5. A completed or verified item is frozen: do not recreate it, rerun it, or replace it. Test proof is identified as test proof; it is not upgraded into a live-production claim.

### ALREADY COMPLETE

- [x] The dedicated DesignProAI droplet is the only deployment target: `designproai-prod-sfo3`, public IPv4 `137.184.0.4`, Ubuntu 24.04, 8 vCPU, 15 GiB usable RAM, 309 GiB root disk, and 8 GiB swap.
- [x] SSH access to the new droplet from the owner's laptop was proven; Docker `29.1.3` and Docker Compose `2.40.3` were installed there.
- [x] The pre-deployment host inventory found no DesignProAI application containers, images, or volumes. That clean baseline is preserved; it is not permission to create parallel stacks.
- [x] PR [#4](https://github.com/Tdill1980/designproai-os/pull/4) merged the canonical preservation and end-to-end workflow at `a38b952ffd3e5bc544992fa19275b7ebb422f1cf`.
- [x] PR [#5](https://github.com/Tdill1980/designproai-os/pull/5) merged the server-owned downstream production boundary at current main `b0cf022396a22b86d6a0b471aef82af5e375606e`.
- [x] The dedicated Supabase project already exists: `designproai-os-prod`, ref `wozyamlnygaddievzuwn`, region `us-west-1`.
- [x] Production Supabase already contains exactly the 13 repository migrations `20260806180000` through `20260806181200`. Do not rerun or recreate them.
- [x] The old RestylePro droplet and `/opt/restylepro` are outside this deployment. PRs #4/#5 do not stop, replace, clone, or mutate them.

### VERIFIED WORKING

- [x] PR #5 head `d7b4fdc94f6fb76ac08b3990cac0b5c4f09b9675` passed **Exact DesignProAI release gate #14**. This proves the checked release contracts, fresh shadow migration path, pgTAP/schema gate, gateway, UI, runtime, output/delivery contracts, reproducible release assembly, and image builds for that PR head.
- [x] The merged code preserves Calls 1–7; PR #5 did not change generation prompts, models, seeds, source-view ordering, or upstream generator files.
- [x] Contract tests verify two independent fenced workers, one shared persistent spool, durable Call 8/9 receipts, leases, hashes, restart-safe state, and no external VectorizIt `:3200`, Railway conductor, or browser worker prerequisite.
- [x] Supabase `wozyamlnygaddievzuwn` is currently `ACTIVE_HEALTHY`, and its live migration list matches the same 13 repository migrations exactly.
- [x] The standalone database, worker, gateway, storage, RLS, QC, stamp, deterministic archive, and WrapBox contracts have passed automated gates. This is kernel/contract verification, not proof that the complete application suite is live.
- [x] The Porsche Martini generation from approximately 2026-08-06 remains the latest known good upstream design reference. It is frozen as a comparison target, not regenerated or replaced.
- [x] The 2026-07-24 run remains the last known panelizer output that extracted panels; those outputs are a failure reference because their physical dimensions were wrong.

### NEEDS FIX

- [ ] Repair the current downstream regression in which panels no longer load or deploy into RevisionStudio and PanelProStudio/PanelizerStudio.
- [ ] Correct Call 8 so the eighth artifact is the designated flat 2D proof tied to validated GENIE surface dimensions, exactly 5-inch bleed on all edges, per-surface dimensions, and square footage.
- [ ] Correct Call 9 so six unique panels derive only from their corresponding accepted flat sources; driver pixels may not substitute for passenger, hood, roof, front, or rear.
- [ ] Complete versioned deterministic Call 10 variants without altering existing `call10.logo-inventory` history.
- [ ] Complete Call 11 Entice previews, RevisionStudio locking, Production Pack/Logo Pack entitlement, and exactly-once downstream activation.
- [ ] Wire approved revisions to create one immutable new revision and rebuild Call 8 onward exactly once while leaving older accepted artifacts untouched.
- [ ] Replace any preview-scale or metadata-only output claim with verified full-scale production upscaling/output: correct physical dimensions, real resolution, color requirements, formats, bleed, hashes, and raster equivalence.
- [ ] Prove the PanelProStudio human checklist, final QC, DesignID + registered Order # stamp, deterministic ZIP/ZIP64, WrapBox delivery, and customer GENIE progress projection with real artifacts.

### MISSING

- [ ] The standalone repository does not yet prove the complete application suite is present and wired. The migration still needs DesignPro's actual working generator iteration, RecreatePro, WallPro, GraphicsPro, MyVehiclePro, full RevisionStudio, GENIE Universal Panelizer/progress, full PanelProStudio, ApprovePro, Gallery, ProductionFlow, WrapBox, customer/account/order/design pages, operator/admin pages, authentication, tenancy, audit, storage, and entitlement.
- [ ] A single source-of-truth inventory is still required for every app route, API, edge function, database object, storage bucket/path, secret class, worker stage, and external service. Historical RestylePro code may be inspected as migration evidence, but RP runtime is not deployable to this droplet.
- [ ] The Porsche Martini record still needs one bounded provenance capture: canonical generation/revision IDs, seven source artifacts, selected proof, deployed function versions, prompts/models/parameters, and SHA-256 evidence. This is preservation evidence, not permission to redesign Calls 1–7.
- [ ] The July 24 wrong-size extraction still needs its exact run IDs, artifacts, dimension manifest/math, and producing function version captured once for the repair comparison.
- [ ] Deployment of an exact current-main release at `b0cf022396a22b86d6a0b471aef82af5e375606e` to `137.184.0.4` is not yet verified in this checklist. The older `013140ba72673c07de6fea0f567f7a19c8122ccd` artifact is a limited kernel and cannot be represented as the complete suite.
- [ ] Root-owned production environment files and their required secret classes are not yet verified on the new droplet. Secret values must be configured through protected GitHub/server mechanisms and never placed in this document, chat, logs, or repository.

### BLOCKED

- [ ] Automated DigitalOcean backup enablement and a recoverable pre-deployment snapshot are not yet verified. Do not treat backup selection in the UI as proof until the droplet reports it enabled or a snapshot exists.
- [ ] A dark server deployment cannot be marked complete until the exact current-main artifact, archive SHA-256, release manifest, environment validation, image IDs, container count, listeners, health checks, and rollback target are captured on `137.184.0.4`.
- [ ] Production cutover is blocked until the full-suite gaps above are closed and one real Porsche Martini canary passes Calls 1–11, PanelProStudio, output verification, human QC, stamp, ZIP, WrapBox, progress, worker interruption/resume, and revision rebuild without duplicate work.
- [ ] Public DNS/TLS traffic must remain unchanged until local acceptance and the real canary pass. A successful dark kernel deploy alone is not authorization for go-live.

### Only the next incomplete work may proceed

1. Verify backup/recovery, build or retrieve the exact current-main artifact, configure protected runtime secrets, and dark-deploy only the intended three-service topology: `runtime-1`, `runtime-2`, and `gateway`.
2. Inventory and surgically migrate the missing application suite from verified source code without changing the Porsche Martini upstream behavior.
3. Run the single Porsche / July 24 / current regression comparison, then repair only Call 8 onward and its RevisionStudio/PanelProStudio handoffs.
4. Pass full-suite integration, security, deterministic-output, restart/resume, and real-customer canary gates before DNS cutover.

## 0.1 Deterministic Call 8/9 panel repair — 2026-08-10

Code repair only. Nothing below is a deployment or canary claim; the real Porsche Martini canary in section 11 still governs acceptance.

### Root causes found in the merged code

1. **Call 9 extracted nothing.** `panels.build` re-read the Call 8 masters and relabelled them as `panel` artifacts. Every production pixel on the path was authored by an image model; the recorded `sourceCrop` contract named a crop that was never taken.
2. **The driver flank was fed into every surface.** Call 8 attached the hero three-quarter render to all six generations as a "cross-vehicle design anchor". The hero is a driver-side view, so passenger, front, rear, hood, and roof were repainted from driver artwork — the observed "one driver side repeated".
3. **The uniqueness gates could not see it.** `call9_surface_reuse` and `call9_driver_passenger_reuse` compared SHA-256 hashes. Two repaints of the same flank are never byte-identical, so a visually duplicated driver panel passed every gate.
4. **Bleed was invented.** Masters were contain-fitted to trim and then mirror-extended, so the 5-inch bleed — and any letterboxed margin — was padding, not artwork.
5. **`panels.build` could not complete at all.** `complete_designpro_stage` requires `sourceRule = 'one-own-surface-region-per-output-side'` and a `sourceRegionHashes` map; the runtime sent `own-call8-bound-surface-master` with `sourceMasterHashes`, so every Call 9 completion raised `call9_unique_proof_region_contract_failed`. `logos.extract` read the same wrong key. This is the regression that stopped panels loading or deploying into RevisionStudio and PanelProStudio/PanelizerStudio.

### What the repair changes

- New `runtime/proof-region-extract.cjs` owns RUNG 0: named-region geometry, deterministic extraction, and surface fingerprinting. It has no network and no model.
- Call 8 authors each flat from **its own** render only (no hero cross-feed), then freezes a **proof region map**: for every surface, the immutable flat source, the exact integer rectangle inside it, the resulting master hash, the rectangle it occupies on the proof sheet, and a 320-bit structural + colour fingerprint with its mirror.
- The named rectangle is the largest centred rect whose aspect equals validated GENIE trim plus 5-inch bleed, so trim **and** bleed are real artwork. Mirror fill is gone.
- Call 9 crops each panel from the frozen proof under a bounded heavy-output lease and verifies: frozen source bytes, byte-for-byte reproduction of the accepted Call 8 master, exact 1:10 @1500dpi trim-plus-bleed geometry, the region shown on the approved proof sheet, and fingerprint identity. A missing region fails closed with `call9_proof_reference_missing`; Call 9 never synthesizes a panel.
- Surfaces are compared as images, directly and mirrored, so a repainted or flipped driver flank fails as `call9_driver_passenger_visual_reuse` / `call9_surface_visual_reuse`.
- The Call 9 receipt and panel artifacts now carry the exact `sourceRule` and `sourceRegionHashes` the database verifies, and Call 10 reads the same key.

### Still open after this repair

- No real generation has been run through the repaired chain. The Porsche Martini canary, the July 24 comparison capture, and PanelProStudio human verification remain required.
- Changing the Call 8 prompt and geometry changes `flatInputHash`, so repaired runs are new immutable artifacts. Existing accepted artifacts are untouched and are not retro-fitted.

## 1. Owner directive

This is a continuation of completed migration work, not a rebuild. The complete existing DesignProAI suite must run as one server-owned operating system: DesignPro, RecreatePro, WallPro, GraphicsPro, MyVehiclePro, RevisionStudio, GENIE Universal Panelizer, PanelProStudio, ApprovePro, Gallery, customer/admin pages, ProductionFlow, production-file output/upscaling, QC, packaging, and WrapBox.

RestylePro is not the deployment target. Railway must not remain the production-file execution authority. The dedicated server owns durable production work, leases, retries, resume, hashes, artifacts, and delivery.

## 2. Evidence anchors and preservation freeze

The existing software already produced top-tier designs. Do not rewrite or replace prompts, models, seeds, call ordering, image-generation parameters, view selection, UI, or revision behavior merely to migrate it.

The **Porsche Martini design**, generated approximately **2026-08-06**, is the latest upstream golden reference. Its real database records, storage artifacts, deployed function versions, Git provenance, models, prompts, parameters, and seven-view outputs must be traced before migration. Do not assume that its producer was a component named A.C.E.; the evidence identifies the actual working iteration.

The panelizer has been broken for weeks. The **2026-07-24 panelizer run** is the last known point where it still extracted panel files, although their physical dimensions were wrong. The current regression is more severe: panels no longer load or deploy into RevisionStudio or PanelProStudio/PanelizerStudio. The repair investigation must therefore compare three evidence boundaries: the August 6 working Porsche generation, the July 24 wrong-size extraction, and the current no-load/no-deploy path. Preserve the proven upstream generator and repair only the panelizer/dimension/handoff/output chain.

Before upstream extraction:

- record canonical generation and revision IDs;
- identify all seven source artifacts and the selected customer proof;
- record source commit and deployed function versions;
- hash source files, prompts, models, parameters, routes, requests, responses, and golden outputs;
- compare migrated outputs to the Porsche Martini baseline;
- fail migration if the working generation behavior changes.

No upstream behavior change may be hidden inside migration or panelizer repair.

## 3. Canonical artifact lineage

Every artifact is immutable and traceable through:

`tenant → customer → orderNumber → DesignID → generationId → revisionId → workflowRunId → stageKey → artifactKind → surfaceKey → SHA-256`

Every durable stage requires an idempotency key, fenced lease/heartbeat, immutable input and output hashes, byte size, completion receipt, retry classification, and restart-safe resume. The browser submits, displays, approves, and requests resume; it is not the production worker.

## 4. Canonical sequence

### Calls 1–7 — preserve the proven generator

Preserve the actual verified seven-call generation sequence byte-for-byte or behavior-for-behavior:

1. driver
2. passenger
3. hood
4. roof/top
5. front
6. rear
7. hero/three-quarter view

All views must belong to one design, vehicle, generation, and revision. Each surface retains its own source identity. Preserve all seven original 3D proofs in Gallery/revision history and preserve one explicitly selected customer-facing proof without discarding the others.

Compatibility receipt: `views.seven-source`.

### Call 8 — GENIE-grounded flat 2D proof

After GENIE geometry is validated, create one designated flat 2D proof:

- exact validated trim width/height for driver, passenger, hood, roof, front, rear;
- correct corresponding source view or authored flat source for every surface;
- exactly 5 inches of bleed on all four edges;
- per-surface trim dimensions;
- per-surface and total square footage calculated from raw trim dimensions;
- frozen text/logo placements;
- no crop, stretch, rotation, perspective substitution, or 3D-mockup extraction;
- immutable proof, source-region map, dimension-manifest hash, material hash, and receipt.

Compatibility receipt/stage: `call8.flat-proof` / `proof.build`.

### Call 9 — deterministic surface panels

Extract driver, passenger, hood, roof, front, and rear only from accepted flat sources tied to Call 8 and the same GENIE manifest:

- never extract production panels from a 3D mockup;
- never substitute driver pixels for passenger;
- contain-fit to GENIE trim geometry;
- exactly 5-inch bleed on every edge;
- verify pixel geometry, aspect ratio, trim, bleed, source identity, content hash, and six-surface uniqueness;
- persist immutable full-resolution masters and lineage receipt.

Compatibility receipt/stage: `call9.surface-panels` / `panels.build`.

### Call 10 — deterministic variants

Create only declared deterministic duplicates/mirrors/format variants. Every variant retains parent hash, transformation, dimensions, bleed, and its own hash. It may not masquerade as a unique source surface.

Existing `call10.logo-inventory` history remains immutable. Introduce a versioned receipt such as `call10.panel-variants.v2`; never silently relabel old rows.

### Call 11 — Entice and purchase lock

Create Entice previews from verified Call 8/9/10 lineage:

- display previews in RevisionStudio;
- bind to DesignID, Order #, revision, GENIE manifest, parent panel hashes, and artifact-set hash;
- lock full masters before entitlement;
- display Production Pack and Logo Pack purchase actions;
- activate purchases idempotently without unrelated regeneration.

Recommended receipt: `call11.entice-preview.v2`.

Logo inventory remains separately verified and preserves legacy `call10.logo-inventory` / `logos.extract` compatibility.

## 5. RevisionStudio

RevisionStudio displays all seven 3D views, selected proof, Call 8 flat proof, Entice panels, purchase state, revision history, GENIE status, and production status.

An approved revision creates a new immutable snapshot. Changes to design pixels, source views, text, logo placement, vehicle, or dimensions invalidate Call 8 and downstream artifacts for the new revision and enqueue a fresh Call 8→9→10→11 chain. Older accepted revisions remain immutable. Stale packs become non-orderable. No duplicate jobs, purchases, notifications, ZIPs, or deliveries.

## 6. Production Pack and PanelProStudio

One idempotent production workflow runs from the active verified Entice identity:

1. `source.verify`
2. `await_panelpro_preflight_qc`
3. `output.build`
4. `output.verify`
5. `await_final_human_qc`
6. `stamp.build`
7. `zip.build`
8. `wrapbox.deliver`

PanelProStudio receives seven source proofs, selected proof, flat proof, GENIE manifest/square-foot evidence, six masters, variants, Entice, logos, production outputs, hashes, DesignID, Order #, revision, generation, workflow, and customer identity.

The human designer must download/inspect actual artifacts against the correct vehicle template and individually verify vehicle/dimensions/square footage, unique surface sources, 5-inch bleed, crop/stretch/rotation/mirroring, text, logos, physical output dimensions, resolution, color requirements, and formats. A generic approval cannot bypass unchecked items.

## 7. Upscaling and production outputs

Use the approved production upscaler/output implementation under DesignProAI control on the dedicated server or through an explicitly pinned service. Produce the required matrix for all six surfaces. Verify physical dimensions, real resolution, bleed, color-mode requirements, hashes, and raster equivalence. Never claim DPI by metadata relabeling.

Heavy output work uses the database-wide lease, persistent spool, resumable upload, restart-safe receipts, and independent fenced workers. Railway is not the production executor.

## 8. Final QC, stamp, ZIP, WrapBox

After actual PNG/TIFF/EPS assets pass final human QC:

- create the approved seal and stamped proof;
- visibly include canonical DesignID and registered Order #;
- bind approver, approval reference/time, proof hash, revision, and output-set hash;
- create one deterministic ZIP/ZIP64 with stable ordering/names/timestamps/modes;
- verify stored ZIP hash and byte size;
- deliver verified ZIP and manifest to WrapBox exactly once.

WrapBox cannot publish before QC, stamp, ZIP verification, entitlement, and customer authorization pass.

## 9. Customer GENIE progress

Project durable receipts to the customer-facing progress page:

- design/revision received;
- seven views complete;
- GENIE pending/validated;
- flat proof complete;
- panels/variants/Entice complete;
- pack ordered;
- PanelPro review pending/approved;
- outputs processing/verified;
- stamp/ZIP complete;
- WrapBox ready.

The progress page observes state; it never advances workers.

## 10. Complete suite migration scope

The dedicated server is incomplete until route, dependency, API, database, storage, authorization, and acceptance inventories prove:

- DesignPro and its actual verified generator iteration;
- RecreatePro;
- WallPro;
- GraphicsPro;
- MyVehiclePro;
- RevisionStudio;
- GENIE Universal Panelizer/progress;
- PanelProStudio;
- ApprovePro;
- Gallery;
- ProductionFlow;
- WrapBox;
- customer account/order/design pages;
- operator/admin pages;
- authentication, tenant isolation, audit, storage, and entitlement.

The exact standalone SHA `013140ba72673c07de6fea0f567f7a19c8122ccd` is a production kernel with limited routes, not proof that the full application suite has migrated. Historical RestylePro code is read-only migration evidence; RP runtime must not be deployed to the new server.

## 11. Acceptance gates

1. Trace and freeze Porsche Martini provenance and golden outputs.
2. Trace the July 24 wrong-size panelizer output and its exact dimension math/function version, then identify the later regression that stopped loading/deployment into RevisionStudio and PanelProStudio.
3. Inventory every app route/module/function/schema/storage dependency.
4. Preserve Calls 1–7 through source/prompt/model/config hashes and golden regression.
5. Correct Calls 8–11 without changing upstream generation.
6. Pass unit, schema-shadow, gateway, UI, runtime, storage, RLS, output, entitlement, and security tests.
7. Deploy only intended DesignProAI services; no RP or duplicate workers.
8. Complete the real Porsche Martini canary through seven views, GENIE, proof, six unique panels, variants, Entice, purchase, PanelProStudio, output, stamp, ZIP, WrapBox, and progress.
9. Interrupt a worker with browser closed and prove resume without regenerating accepted artifacts.
10. Approve a real revision and prove downstream rebuild occurs once.
11. Switch public traffic only after all gates pass; retain rollback and prior infrastructure.

## 12. Definition of done

DesignProAI is complete only when the entire application suite is served from the dedicated deployment and a real revision travels from the preserved working seven-call generator through GENIE, flat proof, deterministic panels, variants, Entice, purchase, PanelProStudio/upscaling, human validation, approved DesignID/Order # stamp, deterministic ZIP, WrapBox, and customer completion—with durable hashes, no browser dependency, safe retry/resume, and zero duplicate work.
