# DesignProAI OS — Platform Overview

## One operating system from prompt to production-ready output

**DesignProAI is server-owned operating software for creating, approving, preparing, validating, and delivering graphics projects.**

A user can describe the design they want in natural language. **A.C.E. — the AI Creative Engine — creates the design inside the DesignProAI project.** From there, the same project can move through visualization, client proofing, revision, production-file purchase, production preparation, quality control, and final file delivery.

The important difference is continuity:

**Prompt → Design → 3D Proof → Client Review → Revision → Approval → Production → QC → Output**

The app doing the work can change. The project does not have to.

## Why this category exists

AI made it dramatically easier to create visual concepts. It did not solve the entire path from a visual idea to a file that can be manufactured.

A convincing image can still be the wrong size, tied to the wrong vehicle geometry, difficult to revise, disconnected from the approval record, missing production structure, or unsuitable for final output.

Traditional workflows solve these problems by handing the job from one application and person to another: creative software, mockups, email, shared folders, templates, prepress, RIP software, and production.

DesignProAI is designed to operate the work between those handoffs.

## Why it is an operating system

DesignProAI is not called an operating system because it has many menu items. It is an operating system because the specialized applications work against a shared project identity and a server-owned workflow.

The OS maintains the relationship between:

- the customer brief;
- generated design assets;
- project identity;
- GenerationID, DesignID, and revision lineage;
- proof state and customer review;
- production-file entitlement/order state;
- geometry and panel requirements;
- QC state;
- production outputs;
- final delivery.

The browser is not the production conductor. The server owns the durable workflow and reports truthful state back to the user.

## The application layer

### A.C.E. — AI Creative Engine

The creative intelligence layer. A user describes what they want; A.C.E. converts the brief, brand information, supplied artwork, references, and application context into professional design work inside DesignProAI.

A.C.E. is the public creative-engine name. Internal engineering may continue to use existing Atlas/A.T.L.A.S. terminology until a deliberate code-level migration is approved.

### VehiclePro

Creates and manages vehicle-graphics projects. VehiclePro combines prompt-based design with vehicle context and photorealistic proofing so a design can be reviewed on the intended year/make/model before production.

### MyVehiclePro

Uses photos of the customer's actual vehicle as design/visualization context. It is useful when a standard year/make/model representation is not enough because the vehicle has custom bodies, racks, accessories, upfits, trailers, or other real-world differences.

### WallPro

Creates wall and environmental graphics from prompts, uploaded spaces, dimensions, and artwork. WallPro connects creative design to physical wall geometry and downstream production output.

### CutPro

Creates cut-graphics work and contour-cut production preparation. `GraphicsPro` remains a legacy/internal identifier in parts of the current codebase; CutPro is the target customer-facing product name.

### RecreatePro

Takes customer references — including photos, screenshots, low-resolution artwork, previous graphics, and AI concepts — and recreates them as a DesignProAI project capable of entering the standard proof, revision, and production-output lifecycle.

### RevisionStudio

The controlled design-review and revision workspace. Users can review a design, edit or request changes, send/email proofs to a client, manage version history, and order production-file output without creating a separate disconnected project.

### ProductionFlow

The production workflow layer. It carries an approved/purchased project into the server-owned production graph and provides the operational state used by production and customer-facing progress surfaces.

## The production intelligence layer

### GENIE Universal Panelizer

GENIE resolves the production geometry required by the job, creates/coordinates the panel structure, and drives the customer-facing production progress experience. The progress page is a projection of real server state and real artifacts, not an animation that pretends work is complete.

### GENIE Vehicle Database

The vehicle-dimension authority used by GENIE and other system tools. It provides year/make/model/configuration measurements for production geometry and validation. The current repository contains an embedded production dataset with 1,664 vehicle records; public counts should be date-stamped if used in marketing because the database can grow.

### PrintPanelStudio

The production/QC workspace. This is the target public name for the current PanelPro Studio implementation. PrintPanelStudio is where production personnel compare the approved design proof against the corresponding print panel, inspect dimensions and identity, complete preflight checks, and perform the human release gates required by the workflow.

### WrapBox

The delivery layer for the verified production package. WrapBox receives the final production pack after required output verification and QC have completed.

## How a project moves through the OS

1. **Start with the brief.** The user describes what should be designed and supplies the relevant customer, brand, vehicle, wall, or reference context.
2. **A.C.E. creates the design.** The correct application — VehiclePro, WallPro, RecreatePro, or another supported workflow — supplies domain context while the creative engine produces the design work.
3. **Proof it in context.** Vehicle work can be presented through multiple photorealistic views tied to the target vehicle; other applications present their own application-specific proof.
4. **Send it to the client.** The proof can be shared from the project rather than exported into an unrelated email/file chain.
5. **Revise it in RevisionStudio.** The project retains identity while changes are made and new revisions are recorded.
6. **Approve and order output.** Approval and production-file purchase move the same project into the production side of the OS.
7. **GENIE resolves production geometry.** Dimensions, panel relationships, and the production manifest are resolved server-side.
8. **Track production progress.** The customer-facing GENIE progress page reports the actual workflow state.
9. **Run multi-step QC in PrintPanelStudio.** Production files are checked by automated validation and human review before release.
10. **Build and verify outputs.** The system creates the required production files and verifies that the expected outputs exist and match the project identity.
11. **Deliver through WrapBox.** The verified production package is delivered without breaking project lineage.

## What DesignProAI replaces

DesignProAI does not need to replace every creative tool, RIP, printer, or production device to be valuable.

It replaces a large amount of **manual orchestration between them**:

- repeated exports;
- version hunting;
- disconnected proof emails;
- rebuilding job context;
- manual status chasing;
- duplicated production preparation;
- losing the link between approved design and output;
- file archaeology when a fleet adds vehicles or needs replacement work.

## The category shift

The first wave of AI asked: **How fast can we create an image?**

DesignProAI asks a more valuable production question: **How do we carry that idea all the way to a validated production file without losing the job in between?**

That is the role of the operating system.
