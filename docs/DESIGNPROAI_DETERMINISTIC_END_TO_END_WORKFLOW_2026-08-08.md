# DesignProAI Deterministic End-to-End Workflow

**Date:** 2026-08-08  
**Repository:** `Tdill1980/designproai-os`  
**Deployment target:** dedicated DesignProAI production droplet `137.184.0.4`  
**Status:** canonical migration, preservation, repair, deployment, and acceptance contract

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
