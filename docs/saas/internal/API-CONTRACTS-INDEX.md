# INTERNAL — API & Service Contract Index

DesignProAI currently has internal gateway, runtime, Supabase function, database/RPC, payment, email, and file-delivery interfaces. This index classifies those interfaces so internal implementation is not accidentally marketed as a stable public API.

## Contract classes

### A. Public product contract

What customers are allowed to depend on at the product level:

- a DesignProAI project retains identity across supported apps;
- supported apps can create/review/revise work inside that project;
- approved/purchased production work enters the server-owned production workflow;
- GENIE reports production progress/state;
- required QC gates precede final release;
- verified output is delivered through WrapBox.

This is a capability contract, not an endpoint contract.

### B. Public API contract — NOT YET DECLARED

Do not publish internal gateway routes or Supabase functions as a supported external API until they are intentionally versioned.

A future public API must define:

- version prefix/policy;
- OAuth/API-key/service-account authentication;
- tenant/account authorization;
- stable project resources;
- GenerationID/DesignID/RevisionID resource semantics;
- idempotency;
- pagination/filtering;
- file upload/download mechanisms;
- webhook event versioning;
- rate limits;
- error schemas;
- deprecation guarantees.

### C. Internal gateway contract

The gateway is the public web application's server boundary. Internal gateway routes may:

- create/read DesignProAI jobs;
- submit authorized project inputs;
- expose server-owned state/progress;
- perform authorized human gate actions;
- initiate/resume sanctioned processing;
- issue supported purchase/output operations;
- serve artifact/download metadata.

Treat route names and payloads as private implementation until promoted to a versioned public API.

### D. Runtime worker contract

The runtime executes server-owned production/creative work. Direct worker routes are not a customer API and should not be exposed publicly.

Contract principles:

- runtime receives validated server inputs;
- runtime work remains bound to the correct project/run/stage identity;
- worker actions must be idempotent or fenced where required;
- completed artifact receipts persist before a stage is considered complete;
- browser clients do not invoke production workers directly.

### E. Workflow/database contract

The durable graph relies on workflow-run/stage/artifact state stored in the database.

Internal contracts include:

- stage key and dependency definitions;
- claim/lease/fencing semantics;
- project/generation/design/revision identity;
- production entitlement/purchase state;
- artifact receipts;
- QC decisions;
- package/delivery state.

Schema/RPC names are private implementation unless explicitly published.

### F. Creative-engine contract

Target public name: **A.C.E. — AI Creative Engine**.

Internal creative contracts may currently use Atlas/A.T.L.A.S. terminology.

Publicly safe inputs/outputs:

**Inputs:** customer brief, brand/customer assets, references, supported application context.

**Outputs:** project-bound professional design assets/proofs capable of continuing into revision and production.

Keep private:

- prompt templates;
- model/provider selection;
- image ordering/conditioning;
- retry/candidate strategy;
- proprietary acceptance criteria;
- internal graph node implementation.

### G. GENIE geometry contract

GENIE supplies/uses the dimensional and production-manifest authority required by downstream file output.

Contract principles:

- target application identity is explicit;
- dimensions are sourced/resolved from sanctioned geometry authority;
- production geometry is not inferred solely from proof imagery;
- panel identities remain bound to project/surface lineage;
- unresolved geometry fails/queues for supported validation rather than silently inventing production dimensions.

### H. PrintPanelStudio QC contract

Current internal name: PanelPro Studio.

QC actions must be scoped to the exact project/revision/surface/output being inspected.

Contract principles:

- full job hydration by authoritative identity;
- proof/panel pair must belong to the same lineage;
- human decisions are persisted;
- preflight gate and final human QC are distinct workflow decisions;
- approvals may not leak across GenerationID/RevisionID boundaries.

### I. Billing / production entitlement contract

Production processing behind the purchase gate must be authorized exactly once for the purchased project/output product.

Contract principles:

- payment completion and entitlement state agree;
- webhook processing is idempotent;
- discount/promotion attribution does not bypass entitlement validation;
- repeated webhook delivery does not create duplicate production runs;
- production processing must not start on an unentitled job merely because the UI reports success.

### J. Email/notification contract

Proof/delivery notifications are transport, not project authority.

Contract principles:

- email references the correct project/revision;
- a bounced email does not create a new project;
- email failure does not rewrite project approval/production state;
- outbound provider configuration fails closed if required credentials/attestation are incomplete.

### K. WrapBox delivery contract

Delivery must publish the verified production package associated with the completed project/output identity.

Contract principles:

- package build and delivery are separate states;
- retrying delivery should not unnecessarily regenerate accepted production outputs;
- delivered package identity must match the verified package receipt;
- large-file transport may use a resumable/streamed path without changing the production artifact identity.

## Before exposing an internal interface publicly

Complete this checklist:

- [ ] endpoint/resource has a stable public name;
- [ ] auth and tenant isolation are documented;
- [ ] request/response schema is versioned;
- [ ] idempotency behavior is documented;
- [ ] errors are stable/documented;
- [ ] rate/file limits are documented;
- [ ] audit/logging behavior is defined;
- [ ] backwards compatibility/deprecation policy exists;
- [ ] security review completed;
- [ ] examples contain no private identifiers/secrets;
- [ ] automated contract tests lock the public behavior.

Until then, internal implementation APIs remain private.
