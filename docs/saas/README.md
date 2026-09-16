# DesignProAI Documentation System

Status: draft documentation architecture for review before public launch.

DesignProAI documentation is separated by reader role. Public evaluator docs explain the platform and operating model without exposing proprietary prompt contracts, graph-node internals, thresholds, model-routing logic, or production heuristics. Daily-user docs explain outcomes and UI workflows. Sales docs explain business value. Internal engineering docs retain the actual server-owned graph terminology and implementation boundaries.

## Product hierarchy used by this documentation

- **DesignProAI OS** — the master server-owned operating software. It owns project identity, state, lineage, workflow execution, production status, and delivery.
- **A.C.E. — AI Creative Engine** — target public name for the creative intelligence layer. A.C.E. converts a natural-language brief and supplied assets into professional design work inside the OS. The current repository still uses A.T.L.A.S./Atlas terminology internally; that engineering vocabulary is not automatically renamed by these docs.
- **VehiclePro** — vehicle-graphics application.
- **WallPro** — wall and environmental-graphics application.
- **CutPro** — cut-graphics application. Existing internal identifiers may still use `graphicspro`.
- **MyVehiclePro** — actual-vehicle-photo design and visualization workflow.
- **RecreatePro** — recreates customer references, photographs, low-resolution art, and AI concepts into a DesignProAI project that can enter the same production-output chain.
- **RevisionStudio** — controlled editing, design review, client proofing/email, revisions, and production-file ordering.
- **ProductionFlow** — production workflow/status layer that carries an approved/purchased project through the server-owned production graph.
- **GENIE Universal Panelizer** — production geometry/panelization system and customer-facing progress experience.
- **GENIE Vehicle Database** — vehicle dimension and configuration authority used by production validation and system tools.
- **PrintPanelStudio** — target public name for the production/QC workspace currently identified in code as PanelPro Studio. It compares design proof to print panel and owns human preflight/final QC surfaces.
- **WrapBox** — delivery destination for the verified production package.

## Documentation lanes

### 1. Platform & Technical Documentation — evaluators, CTOs, technical buyers

- `public/PLATFORM-OVERVIEW.md`
- `public/CORE-CONCEPTS.md`
- `public/APP-REFERENCE.md`
- `public/INTEGRATION-OVERVIEW.md`

Purpose: explain why DesignProAI is a real operating system, how work moves through it, and how its apps share one project lifecycle — without exposing proprietary source code or creative/production secret sauce.

### 2. Knowledge Base / Help Center — daily users

- `help/QUICK-START.md`
- `help/APP-WORKFLOWS.md`

Purpose: task-first guidance that reduces support load.

### 3. Sales & Go-To-Market — buyers, owners, enterprise/channel partners

- `sales/INDUSTRY-ONE-PAGER.md`

Purpose: concise problem → solution → differentiation → business-value narrative.

### 4. Internal System Design — developers and operators only

- `internal/SYSTEM-DESIGN-OVERVIEW.md`
- `internal/NAMING-AND-MIGRATION-STATUS.md`

Purpose: preserve the real server-owned orchestration model, current internal identifiers, graph safety rules, implementation status, and naming transitions. Do not publish these files as marketing docs.

### 5. Trust & Legal — security, procurement, compliance

- `trust/SECURITY-RELIABILITY-OVERVIEW.md`
- `trust/LEGAL-AND-SLA-CHECKLIST.md`

Purpose: separate verified reliability/security architecture from legal promises. No compliance certification, uptime guarantee, retention commitment, or SLA is claimed unless separately verified and approved.

## Public-documentation rule

Public docs may explain:

- prompt-to-design workflow;
- shared project lifecycle;
- server-owned orchestration;
- durable project identity;
- 3D photorealistic proofs;
- RevisionStudio workflow;
- GENIE geometry and production progress;
- AI-assisted + human QC;
- production-ready file output;
- WrapBox delivery.

Public docs must not expose:

- proprietary prompt construction;
- private model-conditioning methods;
- internal graph-node implementation details;
- exact acceptance thresholds;
- secret hashes, provider credentials, or deployment secrets;
- internal retry heuristics or proprietary geometry math beyond high-level capability descriptions.

## Source-of-truth rule

Customer-facing names belong in the public naming registry once approved. Internal routes, database keys, storage paths, edge-function names, and historical engineering terms must not be renamed merely to make documentation look cleaner. Preserve compatibility first; map public names to internal identifiers explicitly in internal docs.
