# INTERNAL — Naming & Migration Status

Reviewed against `main` at `703618d45f974bb5d800bda4b3d242005bba6631` on 2026-09-16.

This file exists so marketing/documentation names do not accidentally get confused with deployed routes, database keys, component names, or incomplete migrations.

## Target product hierarchy

### DesignProAI OS

**Target meaning:** master server-owned operating software.

**Current repo:** already positioned as the master operating system in current naming docs and persistent UI hierarchy.

### A.C.E. — AI Creative Engine

**Target meaning:** customer-facing name for the creative intelligence engine that turns prompts/references/context into professional designs inside DesignProAI.

**Current repo:** not yet the public/code name. Current public UI says `Powered by Atlas`; internal engineering uses Atlas/A.T.L.A.S. heavily.

**Migration guidance:**

- treat A.C.E. as a public brand layer first;
- do not mass-rename A.T.L.A.S. runtime identifiers, flags, tests, migrations, graph docs, or storage contracts;
- add one public naming source/mapping and update customer-facing copy intentionally;
- preserve internal engineering vocabulary until a separate code-migration decision exists.

### VehiclePro

**Target meaning:** vehicle-graphics app.

**Current repo:** customer-facing rename is already implemented. Internal key remains `designpro`; routes/components still include DesignPro names.

### WallPro

**Target meaning:** wall/environmental graphics app.

**Current repo:** active customer-facing name.

### CutPro

**Target meaning:** cut-graphics app.

**Current repo:** customer-facing rename is implemented. Internal key/routes/storage/functions may still use `graphicspro` by design.

### MyVehiclePro

**Target meaning:** actual-vehicle-photo design/visualization workflow.

**Current repo:** route/component exists; verify its final OS/product placement and current output-chain integration before publishing a strong production-output claim.

### RecreatePro

**Target meaning:** rebuild customer reference/photo/AI art into a project that enters the same DesignProAI output chain.

**Current repo:** migration brief still treats full standalone OS integration as migration work. Do not claim end-to-end production acceptance until a fresh run proves the whole sanctioned chain.

### RevisionStudio

**Target meaning:** edit/revise designs, email/share client proofs, preserve revision history, manage approval, and buy production-file output.

**Current repo:** RevisionStudio/RevisionStudioIQ surfaces exist, but proof email/approval behaviors are historically spread across multiple surfaces and ApprovePro is marked offline during integration. Treat full consolidation as product-integration work until verified.

### ProductionFlow

**Target meaning:** customer/operator production workflow/status layer connected to the server-owned graph.

**Current repo:** production routes/status surfaces exist; one legacy `/production-flow` route redirects into the server-owned jobs path. Public docs should describe the capability, not depend on one historical route name.

### GENIE Universal Panelizer

**Target meaning:** production geometry + panelization + real customer-facing progress.

**Current repo:** present across resolver, panelizer, progress, geometry, and production workflow code. Customer progress surfaces include `/designpro/jobs/:generationId/progress` and `/productionflow/:generationId`.

### GENIE Vehicle Database

**Target meaning:** authoritative year/make/model/configuration dimensions used by system tools and production validation.

**Current repo:** production code includes an embedded vehicle database of 1,664 records plus resolver/catalog infrastructure. If using a public record count, date-stamp it.

### PrintPanelStudio

**Target meaning:** multi-step production QC workspace.

**Current repo:** named `PanelPro Studio` / `PanelProStudio` in code and UI. It compares proof to production panel, shows dimensions/hashes/artifacts, and owns human preflight/QC actions.

**Migration guidance:** customer-facing rename can be copy/registry-first; internal `panelpro` identifiers should remain until compatibility impact is audited.

### WrapBox

**Target meaning:** verified production-package delivery.

**Current repo:** terminal digital delivery stage/surface. A large-file delivery fallback fix is present in recent history; confirm fresh canary acceptance before using absolute reliability claims.

## Public name mapping proposal

| Customer-facing | Current engineering / legacy aliases |
|---|---|
| DesignProAI OS | `designproai-os`, DesignProAI |
| A.C.E. — AI Creative Engine | Atlas / A.T.L.A.S. creative intelligence terminology |
| VehiclePro | `designpro`, DesignPro/DesignPanelPro component names |
| WallPro | `wallpro` |
| CutPro | `graphicspro`, GraphicsPro file/function/route names |
| MyVehiclePro | MyVehiclePro |
| RecreatePro | RecreatePro / historical RestylePro integration |
| RevisionStudio | RevisionStudioIQ / `/revision-studio` |
| ProductionFlow | Production jobs / `/productionflow/...` / historical redirects |
| GENIE Universal Panelizer | GENIE / panelizer-os / production geometry/resolver code |
| GENIE Vehicle Database | vehicle database/resolver/catalog tables/files |
| PrintPanelStudio | PanelPro Studio / PanelProStudio / `panelpro` |
| WrapBox | WrapBox / `wrapbox.deliver` |

## Naming implementation rule

A public rename is not permission to rename all technical identifiers.

Before changing any internal identifier, classify it:

1. **Pure UI copy** — safe candidate for rename.
2. **Route alias** — add compatibility alias before changing display name.
3. **Analytics/access key** — preserve unless migration is planned.
4. **Database/stored value** — preserve or migrate explicitly.
5. **Storage bucket/path** — preserve unless data migration is planned.
6. **Edge function/API contract** — preserve unless versioned migration is planned.
7. **Runtime flag/graph/test vocabulary** — preserve unless engineering explicitly approves code migration.

## Documentation release rule

Before publishing each public doc, mark every capability as one of:

- `VERIFIED LIVE`
- `IMPLEMENTED, ACCEPTANCE PENDING`
- `MIGRATING`
- `PLANNED`

Do not let future-state product naming turn into an accidental claim that incomplete integrations are already production-proven.
