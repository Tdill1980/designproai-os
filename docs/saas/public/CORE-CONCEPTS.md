# DesignProAI OS — Core Concepts

This guide defines the public vocabulary used across DesignProAI. It explains how the platform thinks without exposing proprietary prompt construction, internal thresholds, or private graph implementation.

## DesignProAI OS

The master operating software. DesignProAI owns the project identity, state, lineage, workflow progression, production status, and delivery relationship across its apps.

The OS is intentionally server-owned: the browser starts work, shows work, accepts permitted human actions, and reports status; it is not the durable production conductor.

## A.C.E. — AI Creative Engine

The target public name for the creative intelligence layer. A.C.E. turns a natural-language creative brief plus available customer/brand/application context into design work inside the OS.

A.C.E. should be explained as the equivalent of combining professional creative software, advanced image handling, and the judgment of an experienced production designer — while remaining connected to the downstream production workflow.

Public docs should use A.C.E. once the naming change is approved. Internal runtime names may remain Atlas/A.T.L.A.S. until engineering deliberately migrates them.

## Project

The persistent unit of work inside DesignProAI. A project is more than an image. It ties together the customer context, design lineage, revisions, proof state, production order, production geometry, QC state, and delivered output.

## GenerationID

The persistent identity of a generation lineage. It lets the OS tie generated assets, subsequent workflow state, and downstream artifacts back to the same originating job.

A retry of technical work should not silently create a new creative identity. A truly new creative generation does.

## DesignID

The persistent identity of the selected commercial design. DesignID is carried into downstream production and delivery so the approved design can be traced to the files ultimately released.

## RevisionID

The identity of a specific creative revision. Customer-requested changes create a new revision while preserving the broader project/generation/design lineage.

## Server-owned orchestration

DesignProAI does not rely on a browser tab to keep a production workflow alive. The server owns the workflow graph and records durable stage state. Completed work remains recorded even if a browser closes or a worker restarts.

This is a key reason DesignProAI is an operating system rather than a sequence of browser automations.

## Durable graph

The production workflow is modeled as dependent work rather than one fragile linear script. A stage runs when its declared requirements are satisfied; independent descendants can run in parallel where safe. Completed stage receipts and artifact identities are persisted so the system can resume rather than blindly repeat accepted work.

Public docs should describe this as **durable graph orchestration**. Internal node keys and proprietary scheduling/retry details belong only in engineering documentation.

## Proof

A customer-facing visualization of the design. For vehicle work, this can include multiple photorealistic views tied to the target year/make/model. A proof is used to understand and approve the design; it is not automatically the same artifact as the production file.

## RevisionStudio

The controlled review/edit/approval workspace. RevisionStudio is where users keep changes attached to the existing project instead of starting an unrelated file chain. Target capabilities include editing, emailing proofs, recording revisions, and ordering production-file output.

## GENIE Universal Panelizer

The production geometry and panelization system. GENIE resolves dimensions and panel relationships, then participates in the production workflow that prepares the approved design for final output.

GENIE also has a customer-facing role: its progress experience reports the real production state and the availability of real artifacts.

## GENIE Vehicle Database

The vehicle measurement/configuration authority used by GENIE and related tools. It provides the physical dimensions required to ground production geometry rather than trusting a photorealistic proof as production truth.

## PrintPanelStudio

The target public name for the production/QC workspace currently implemented as PanelPro Studio. PrintPanelStudio is where the design/production team compares approved proofs to print panels, checks geometry and identity, and completes the human preflight/final-QC work required before release.

## ProductionFlow

The operational bridge from approved/purchased design to produced output. ProductionFlow presents and coordinates the state of the production graph while the server remains the source of truth.

## Production-file entitlement

The state that authorizes the paid production portion of the workflow. Design work and proofing can exist before purchase; production/manufacturing work begins only when the appropriate output entitlement/order exists.

## Preflight QC

The first human release gate in the production side of the workflow. The purpose is to catch production issues before expensive enhancement/export work proceeds.

## Automated validation

Machine checks that verify required relationships and artifacts — for example, identity, expected output presence, geometry, or file integrity — before a human release or final delivery.

## Final human QC

A human release gate that evaluates the exact production file set after output generation/verification and before final stamped packaging/delivery.

## WrapBox

The verified-file delivery destination. WrapBox is where the customer receives the completed production package after the server-owned production graph and required QC gates have completed.

## Production lineage

The traceable relationship from order/project identity through generation, design, revision, proof, production files, QC, packaging, and delivery.

The public idea is simple: **the approved design and the delivered files remain part of the same job.**

## What a deterministic gate means publicly

A deterministic gate is a rule the system can evaluate from objective project/file state rather than aesthetic opinion. Public docs may say DesignProAI uses deterministic validation where production safety requires it. The exact formulas, thresholds, hashes, and internal rules are private engineering IP.
