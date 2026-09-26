# DesignProAI OS — Security & Reliability Overview

This document is a public-safe technical trust overview based on the reviewed repository architecture. It does **not** claim a compliance certification, penetration-test result, encryption guarantee, or uptime SLA that has not been separately verified and approved.

## Server-owned execution

DesignProAI's production workflow is owned by server-side runtime/gateway infrastructure rather than by a customer's browser tab.

The browser can submit authorized inputs, display state, show private review artifacts, perform permitted human approvals, and request supported resume actions. It does not own the durable production chain.

This design reduces the risk that a long-running production job disappears simply because a user closes a browser or loses a local session.

## Durable workflow state

Production work is represented as persisted workflow runs, stages, artifacts, and receipts. Completed work can remain recorded across browser closure and worker restart so the system can resume from known state instead of blindly recreating accepted work.

## Project lineage

DesignProAI maintains identity across the lifecycle using project/generation/design/revision relationships. Production artifacts are expected to remain bound to the correct lineage through QC and delivery.

This is important for preventing an approved design from being silently replaced by an unrelated output during production.

## Human release gates

The production graph includes human QC gates in addition to automated validation.

At a high level:

- automated checks verify objective production/file conditions;
- production/design personnel complete preflight review;
- output files are built and verified;
- final human QC is required before the package is released.

This is intentionally different from an 'instant download' model that assumes generation alone is sufficient production validation.

## GENIE geometry authority

Vehicle production geometry is resolved from the production system's dimensional authority rather than inferred solely from the appearance of a photorealistic proof.

The current codebase includes an embedded vehicle-dimension dataset plus resolver/catalog infrastructure used by GENIE.

## Runtime isolation

The reviewed repository documents a standalone DesignProAI runtime/gateway deployment in which internal worker/runtime ports bind locally and the public web layer exposes the intended application/API surface rather than exposing worker routes directly.

Exact hostnames, private addresses, credentials, and deployment secrets are intentionally omitted from public documentation.

## Artifact verification

The production workflow includes output-building and output-verification stages before final human QC and package delivery.

Internal implementation may use hashes/receipts/identity checks; public docs should describe the outcome — verified production artifacts tied to the correct project — without publishing private integrity details.

## Release validation

The repository contains automated test suites covering runtime, schema, gateway, UI, output, delivery, and server-boundary behavior. Release automation also validates migrations against a fresh local/shadow database environment before producing release artifacts.

A green automated suite is not treated as the only proof of production correctness. The project also uses end-to-end production canary acceptance for high-risk output changes.

## Recovery principles

The architecture is designed around these reliability principles:

- completed work should not be lost because the browser closed;
- accepted artifacts should not be silently regenerated on resume;
- technical retry should not mint a new creative identity;
- independent graph descendants may run in parallel only when dependencies allow;
- missing artifacts should be reported as missing rather than synthesized by a UI;
- delivery should verify the package it sends.

## Data/privacy claims not made by this document

This document does not make claims about:

- SOC 2 certification;
- ISO 27001 certification;
- HIPAA compliance;
- PCI scope beyond use of supported payment-provider flows;
- GDPR/CCPA legal compliance status;
- encryption-at-rest or key-management specifics;
- geographic data residency;
- customer-data retention periods;
- backup RPO/RTO;
- guaranteed uptime.

Those topics require separate technical/legal verification before being published as commitments.

## Procurement contact package to prepare before enterprise launch

For enterprise/franchise/OEM procurement, DesignProAI should maintain a controlled trust package containing:

1. architecture/data-flow diagram;
2. authentication/authorization overview;
3. data categories and subprocessors;
4. retention/deletion policy;
5. encryption/key-management statement;
6. incident-response policy;
7. backup/recovery policy;
8. vulnerability-management policy;
9. current compliance/certification evidence, if any;
10. approved SLA/support commitments.
