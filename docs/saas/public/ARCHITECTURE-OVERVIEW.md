# DesignProAI OS — Architecture Overview

This is the public-safe architecture description for technical evaluators. It explains system boundaries and data flow without exposing private prompt contracts, model-routing logic, proprietary thresholds, or internal recovery algorithms.

## Architecture at a glance

```text
Customer / Operator
        │
        ▼
DesignProAI Applications
VehiclePro · MyVehiclePro · WallPro · CutPro · RecreatePro
        │
        ▼
A.C.E. — AI Creative Engine
        │
        ▼
Shared DesignProAI Project
GenerationID · DesignID · RevisionID · assets · proof state
        │
        ├────────────► RevisionStudio ──► client proof / revisions / approval
        │
        ▼
Production-file order / entitlement
        │
        ▼
ProductionFlow — server-owned workflow state
        │
        ▼
GENIE Universal Panelizer
geometry · panel manifest · customer progress
        │
        ▼
PrintPanelStudio
machine validation + human preflight + final human QC
        │
        ▼
Production output build + verification
        │
        ▼
WrapBox
verified production-package delivery
```

## 1. Client/application layer

DesignProAI applications collect user intent and application-specific context.

Examples:

- VehiclePro supplies vehicle-graphics context;
- WallPro supplies wall/environment context;
- MyVehiclePro supplies actual-vehicle imagery;
- RecreatePro supplies customer reference/reconstruction context;
- CutPro supplies cut/contour-production context.

These applications do not each own a separate production system. They operate inside the DesignProAI project model.

## 2. Creative intelligence layer — A.C.E.

A.C.E. is the target public name for the creative engine.

It receives the user brief plus supported brand/art/application context and creates professional design work. Its output remains attached to the DesignProAI project so the design can continue into proofing and production.

Public architecture docs intentionally do not publish:

- prompt construction;
- provider/model routing;
- hidden creative personas;
- proprietary acceptance logic;
- image-conditioning sequence.

## 3. Project/identity layer

DesignProAI maintains durable identity across the lifecycle.

At a high level:

- **GenerationID** — generation lineage;
- **DesignID** — selected design identity;
- **RevisionID** — a specific creative revision.

This allows design, approval, production, and delivery to refer to the same job rather than relying on filenames alone.

## 4. Revision and approval layer

RevisionStudio is the controlled continuation of an existing project.

It is responsible for the user-facing loop around:

- reviewing designs/proofs;
- editing or requesting changes;
- preserving revision history;
- emailing/sharing client proofs;
- recording the selected/approved revision;
- ordering production-file output.

## 5. Server-owned orchestration layer

Once work enters server processing, the server is authoritative for workflow state.

The production workflow is modeled as dependent stages. A stage can run when its prerequisites are satisfied. Independent descendants may execute concurrently where safe.

Completed stage/artifact state is persisted so the system can recover/resume without depending on a browser tab.

This is one of the architectural reasons DesignProAI is an operating system rather than a collection of front-end automations.

## 6. ProductionFlow

ProductionFlow is the user/operator-facing representation of the production lifecycle.

It reports the server-owned state rather than inventing a second workflow in the UI.

## 7. GENIE production geometry

GENIE resolves the physical production context required for panel/output work.

For vehicle projects, the geometry layer can draw from the GENIE Vehicle Database and validated configuration data. The system does not use a photorealistic proof as the sole dimensional authority.

GENIE also powers the customer-facing progress experience, which should reflect real server stages and real artifact availability.

## 8. QC layer — PrintPanelStudio

PrintPanelStudio is the target public name for the production QC workspace.

QC is intentionally multi-layered:

1. project/surface identity verification;
2. design proof ↔ print-panel comparison;
3. geometry/dimension review;
4. automated validation;
5. human preflight release;
6. final output verification;
7. final human QC.

The exact internal rules and thresholds remain private.

## 9. Output and delivery layer

After production outputs are built and verified and the required human release has been completed, the system packages the approved production set and delivers it through WrapBox.

WrapBox is the digital delivery boundary. Printing/physical fulfillment is a downstream workflow or partner integration unless explicitly included in the purchased product path.

## 10. Reliability principles

The architecture is designed around:

- server authority rather than browser authority;
- persistent project identity;
- durable stage state;
- dependency-aware graph execution;
- idempotent purchase/workflow behavior;
- no second production-artifact producer;
- automated validation plus human release gates;
- delivery of verified project-bound outputs.

## What an evaluator should take away

DesignProAI is not simply a front end placed over an image model.

It has a persistent project/identity model, server-owned workflow execution, domain-specific applications, production geometry, human/machine QC, verified output construction, and a delivery boundary.

That combination is what makes the platform an operating system from design through production output.
