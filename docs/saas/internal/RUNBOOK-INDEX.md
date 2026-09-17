# INTERNAL — DesignProAI Runbook Index

This file points operators and developers to operational runbooks without copying sensitive deployment details into public documentation.

## Purpose

Runbooks are operational instructions. They are not marketing collateral and should not be published under the public docs site without deliberate redaction.

## Existing operational sources of truth

### Standalone server deployment

**Canonical source:** `ops/README.md`

Covers:

- standalone DesignProAI runtime/gateway boundary;
- release artifact construction and validation;
- environment configuration;
- deployment sequencing;
- acceptance checks;
- rollback;
- protected production migrations;
- canary acceptance expectations.

Do not duplicate hostnames, secrets, internal ports, or environment details into public docs.

### End-to-end production workflow

**Canonical sources:**

- `docs/DESIGNPROAI-END-TO-END.md`
- `docs/DESIGNPROAI_DETERMINISTIC_END_TO_END_WORKFLOW_2026-08-08.md`

Use for:

- server-owned stage sequence;
- artifact lineage;
- production-file gates;
- QC boundaries;
- delivery requirements;
- known acceptance requirements.

### Creative graph / lineage

**Canonical source:** `docs/ATLAS_ONE_ARTIFACT_GRAPH.md`

Use for:

- current internal A.T.L.A.S. lineage;
- GenerationID / DesignID / RevisionID relationship;
- proof-vs-production authority;
- server-owned graph rules;
- no-second-producer constraints.

Public naming may refer to A.C.E.; internal operational runbooks should retain the exact current engineering terms until the runtime is deliberately migrated.

### RecreatePro migration

**Canonical source:** `docs/RECREATEPRO-MIGRATION-BRIEF.md`

Use for:

- current migration status;
- historical source flow;
- sanctioned integration path;
- explicit prohibition on a second production-file producer;
- acceptance criteria before calling the integration complete.

### Panel/output graph integration

**Canonical source:** `docs/PANELPROFILEOUTPUT-GRAPH-INTEGRATION.md`

Use for:

- current production panel/output graph;
- PanelProStudio/target PrintPanelStudio role;
- GENIE progress relationship;
- final output/QC handoff.

## Required operational runbooks to maintain

### RUNBOOK-01 — Deploy exact DesignProAI release

Must include:

- pre-deploy inventory;
- release artifact identity;
- exact SHA verification;
- dark deployment;
- local acceptance;
- public cutover only after acceptance;
- rollback path.

Use `ops/README.md` as the authority rather than creating a competing process.

### RUNBOOK-02 — Resume stalled production job

Must include:

1. locate by GenerationID/DesignID/order;
2. identify the server-owned stage actually blocking;
3. inspect artifact receipts;
4. distinguish waiting-for-human from failed-machine work;
5. resume only through supported server controls;
6. never repair by manually synthesizing a missing production artifact in the UI;
7. verify downstream state after resume.

### RUNBOOK-03 — PrintPanelStudio preflight

Must include:

- open the full server job by GenerationID;
- compare approved proof to matching print panel;
- confirm vehicle/application identity;
- verify dimensions and surface identity;
- review automated validation results;
- record human preflight decision;
- never approve a panel from a different revision/generation.

### RUNBOOK-04 — Final human QC and release

Must include:

- verify exact output matrix exists;
- verify output identity/lineage;
- inspect representative/full artifacts according to production policy;
- record final human QC;
- verify stamp/package creation;
- confirm WrapBox delivery receipt.

### RUNBOOK-05 — GENIE dimension exception

Must include:

- identify missing/ambiguous vehicle configuration;
- inspect GENIE resolver result/source;
- route to authorized human validation where required;
- persist approved geometry through the sanctioned catalog/update mechanism;
- never derive final production dimensions from the apparent size of a 3D proof.

### RUNBOOK-06 — RecreatePro acceptance

Must include:

- confirm customer/reference inputs;
- confirm accepted creative authority is bound to the canonical project lineage;
- confirm downstream sanctioned panel/proof/output chain is used;
- confirm no parallel producer wrote substitute panels;
- complete production/QC/WrapBox acceptance before marking the integration production-proven.

### RUNBOOK-07 — Large production package delivery failure

Must include:

- inspect package/ZIP build receipt;
- verify package hash/identity;
- distinguish build success from delivery failure;
- use the supported resumable/streaming delivery path where applicable;
- do not rebuild accepted outputs solely to retry delivery;
- verify WrapBox receipt after retry.

### RUNBOOK-08 — Customer proof email failure

Must include:

- verify current approved/sent revision;
- verify customer email;
- inspect send/delivery state;
- resend from the same project identity;
- do not duplicate the project to work around an email transport failure.

## Runbook quality rules

Every runbook should state:

- trigger/when to use it;
- prerequisites;
- read-only inspection first;
- exact authorized mutation step;
- success evidence;
- rollback/recovery if applicable;
- escalation boundary;
- actions explicitly prohibited.

## Safety rule

If an operational runbook conflicts with a current locked engineering contract or current production code, stop and update/reconcile the runbook before using it. Documentation is not authority to bypass the server contracts.
