# INTERNAL — DesignProAI OS System Design Overview

**Do not publish this document as sales copy.**

Reviewed against `main` at `703618d45f974bb5d800bda4b3d242005bba6631` (2026-09-16).

This document describes the current server-owned operating-system architecture at a level useful to developers/operators. It intentionally does not duplicate proprietary prompt bodies, secret thresholds, credentials, or provider keys.

## 1. System boundary

DesignProAI is a standalone server-owned production operating system.

The current repository architecture explicitly rejects a browser-owned conductor. The browser/UI is allowed to:

- submit authorized immutable/user inputs;
- read/report server state;
- display private review artifacts;
- perform authorized human gates/actions;
- request an explicit resume/retry where supported.

The browser is not allowed to become the durable workflow engine.

The runtime/gateway own the durable chain and persist stage/artifact receipts so closing the browser or restarting a worker does not erase completed work.

## 2. Public naming vs. current internal naming

### Target public layer

- DesignProAI OS — master operating software
- A.C.E. — AI Creative Engine — creative intelligence layer
- VehiclePro
- WallPro
- CutPro
- MyVehiclePro
- RecreatePro
- RevisionStudio
- ProductionFlow
- GENIE Universal Panelizer
- GENIE Vehicle Database
- PrintPanelStudio
- WrapBox

### Current internal/code layer

- Atlas / A.T.L.A.S. remains the dominant creative-graph engineering vocabulary.
- `designpro` remains a compatibility/access/storage key for the vehicle design application.
- `graphicspro` remains a compatibility/access/storage key for CutPro.
- PanelPro Studio / `panelpro` remains the current QC workspace naming in code.
- Several historical page/component/function names still carry DesignPro/GraphicsPro/PanelPro strings.

**Rule:** public naming changes must not casually rename internal identifiers that are part of routes, stored data, analytics, storage, functions, or deployed contracts.

## 3. Creative lineage

The canonical lineage contract is conceptually:

`OrderID → GenerationID → DesignID → RevisionID → accepted creative authority → proofs/panels → production workflow → verified package → WrapBox`

A technical retry must preserve the creative identity and receive a technical run/attempt identity rather than pretending a new design was created.

A customer-requested creative change creates a new immutable revision while retaining the broader order/generation/design relationship.

## 4. Creative graph

Current engineering uses the A.T.L.A.S. one-artifact/six-surface model for vehicle design. The public A.C.E. name should sit above this implementation rather than forcing an immediate internal rename.

High-level behavior:

1. Creative input is normalized/validated server-side.
2. One authoritative creative result is accepted and persisted.
3. Canonical surface outputs are deterministically derived/bound from the accepted creative authority.
4. Presentation proofs are descendants of the matching authoritative surface/source.
5. Independent proof descendants may run concurrently when their declared dependencies exist.
6. Presentation logic must not become new production-art authority.

Do not expose private prompt fences, model-conditioning instructions, fill contracts, or acceptance formulas in public docs.

## 5. Durable production graph

The current sanctioned production chain contains two broad phases.

### Design / preparation side

The current graph includes work such as:

- revision freeze / authoritative revision selection;
- panel preparation/promotion;
- logo inventory/extraction and de-logo preparation where applicable;
- proof build;
- preparation-pack verification;
- pack activation.

These stages can exist before paid production processing. Current owner rule: only processing/manufacturing work should wait behind purchase.

### Paid production side

Canonical stage sequence currently documented/implemented:

`await_purchase`
→ `manifest.resolve`
→ `source.verify`
→ `await_panelpro_preflight_qc`
→ `enhance.upscale`
→ `output.build`
→ `output.verify`
→ `await_final_human_qc`
→ `stamp.build`
→ `zip.build`
→ `wrapbox.deliver`

Public docs should translate this to understandable language:

Purchase → GENIE geometry → source validation → PrintPanelStudio preflight → production enhancement/output → output verification → final human QC → package/stamp → WrapBox delivery.

## 6. GENIE geometry authority

GENIE owns/resolves production geometry; model-generated presentation images do not.

Current repository evidence includes:

- embedded vehicle measurement database used by the panelizer validation path;
- resolver/catalog infrastructure;
- year/make/model/configuration lookup;
- panel geometry/config used by production tooling.

The current embedded dataset contains 1,664 vehicle records. Treat the count as date-specific implementation state.

### Engineering rule

Photorealistic proofs are presentation descendants. Do not use visible pixels from a proof as the sole authority for physical production dimensions.

## 7. Customer-facing GENIE progress

GENIE/ProductionFlow progress surfaces must be projections of actual server state and actual artifact availability.

Do not let a browser increment a fake progress rail independently of the workflow state.

Where a file/panel is presented as complete, its real artifact must exist and be bound to the job identity.

## 8. PrintPanelStudio / current PanelPro Studio

Target public name: **PrintPanelStudio**.

Current implementation name: **PanelPro Studio**.

The workspace is the production control/QC surface. It should hydrate the full job by GenerationID and compare the real approved design/proof to the real production panel/artifact.

Responsibilities include:

- project/surface identity inspection;
- proof ↔ panel comparison;
- dimensions/hashes/provenance inspection;
- per-surface production review;
- human preflight gate;
- downstream artifact inspection;
- final human QC/release.

A thin recent-jobs index must never be treated as the full production job object.

## 9. Automated + human QC model

DesignProAI intentionally combines deterministic/automated validation with human release gates.

Automated validation should cover objective machine-checkable facts such as:

- required artifact presence;
- identity/lineage match;
- expected dimensions/geometry;
- content/file integrity;
- output matrix completeness;
- hash/receipt agreement where applicable.

Human gates exist for production/design judgment and final release.

Do not market a specific numerical quality guarantee unless the exact contract is verified and approved for publication.

## 10. WrapBox delivery

WrapBox is the terminal digital delivery surface for the verified production package.

The current pipeline builds/validates the production outputs, passes final QC, builds the stamped package/ZIP, then delivers through WrapBox.

Recent history: a large-package server-side copy failure exposed a last-mile delivery limitation; a streaming/TUS fallback fix was merged before the reviewed head. Do not claim universal large-file delivery is production-proven until a fresh accepted canary verifies the fix end-to-end.

## 11. RecreatePro integration status

The current migration brief records RecreatePro's original implementation as a RestylePro ProductionFlow workflow and states that DesignProAI OS must migrate it into the sanctioned file-output chain rather than create a second producer.

Preferred architecture:

- RecreatePro converts the customer's photos/reference concept into the OS's accepted creative authority;
- downstream proof/panel/production stages remain the same sanctioned chain;
- one GenerationID/DesignID/revision lineage is preserved;
- RecreatePro does not independently build a competing production package.

**Status rule:** do not state that RecreatePro production output is live/proven until its fresh acceptance run completes through output/QC/WrapBox.

## 12. RevisionStudio target contract

RevisionStudio is the user-facing continuation of an existing project, not a new producer.

Target capabilities:

- inspect current project/design/proofs;
- edit/submit controlled revision instructions;
- preserve GenerationID/DesignID and mint a new RevisionID for creative change;
- email/share the current client proof;
- manage approval state;
- purchase production output;
- continue into ProductionFlow/GENIE without creating a parallel identity.

Current customer-facing proof/email features are spread across historical approval/proof surfaces. Consolidation into RevisionStudio should be treated as product integration work, not assumed complete merely because legacy email code exists.

## 13. No-second-producer rule

One project must have one sanctioned production lineage.

No UI, edge function, migration, helper, or integration may silently regenerate/reconstruct a missing production artifact as a substitute for the authoritative artifact.

If an expected artifact is missing, report it missing and repair the authoritative path.

This rule prevents two different 'truths' from reaching QC or a printer.

## 14. Recovery and idempotency principles

- completed stage receipts survive browser closure;
- technical retries do not mint new creative identity;
- stage claims/dependencies are server-owned;
- independent descendants may parallelize when dependencies allow;
- accepted artifacts should not be regenerated on resume unless the contract explicitly requires a new revision;
- purchase/entitlement gates must be idempotent;
- final delivery must verify the package it is delivering.

## 15. Public-doc translation table

| Internal/engineering term | Public-safe term |
|---|---|
| A.T.L.A.S./Atlas creative graph | A.C.E. — AI Creative Engine / creative intelligence layer |
| `designpro` tool key | VehiclePro (until product owner changes the app mapping) |
| `graphicspro` key/functions | CutPro |
| PanelPro Studio | PrintPanelStudio |
| `manifest.resolve` | GENIE resolves production geometry |
| `await_panelpro_preflight_qc` | PrintPanelStudio preflight QC |
| `output.build` / `output.verify` | Build and verify production files |
| `await_final_human_qc` | Final human QC |
| `wrapbox.deliver` | WrapBox delivery |

## 16. Documentation safety boundary

Public docs may describe capabilities and high-level flow.

Keep internal:

- provider/model routing details;
- prompt content/ordering;
- proprietary acceptance thresholds;
- exact geometry/crop formulas;
- private hashes and canary IDs;
- internal database schemas/RPC details;
- worker leases/fencing implementation;
- retry budgets and failure heuristics;
- credentials, deployment hosts, private URLs.
