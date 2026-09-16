# DesignProAI OS — Application Reference

This is the public-safe reference for what each DesignProAI application/service does and how it participates in the shared project lifecycle.

## DesignProAI OS

**Role:** Master operating software.

DesignProAI owns project identity, lineage, state, workflow progression, production status, and delivery. It is not the name of one individual design tool.

**What it coordinates:**

- customer/project context;
- GenerationID / DesignID / RevisionID lineage;
- app-to-app continuity;
- proof/revision state;
- production-file order/entitlement;
- server-owned production stages;
- QC state;
- final output and delivery.

---

## A.C.E. — AI Creative Engine

**Role:** Creative intelligence engine.

A.C.E. turns a user's natural-language brief and supplied context into professional design work inside DesignProAI.

**Inputs can include:**

- business/brand context;
- desired style;
- color direction;
- messaging;
- supplied logos/artwork;
- inspiration/reference images;
- vehicle or wall context;
- customer-requested placement direction.

**Outputs:** design candidates/assets that remain attached to the DesignProAI project and can proceed into proofing, RevisionStudio, and production.

**Public positioning:** like combining professional design software, Photoshop-level image control, and an experienced production designer — without disconnecting the creative work from file output.

**Naming note:** A.C.E. is the target public name. The current codebase still contains Atlas/A.T.L.A.S. engineering terms; public documentation should not expose those internal mechanics unless intentionally writing an engineering document.

---

## VehiclePro

**Role:** Vehicle-graphics design application.

VehiclePro uses the DesignProAI project plus vehicle context to create commercial vehicle-graphics designs and presentation proofs.

**Core capabilities:**

- prompt-based vehicle-graphics design;
- year/make/model project context;
- multiple photorealistic vehicle views for presentation/review;
- design continuity across views;
- handoff into RevisionStudio and production output;
- shared GenerationID/DesignID lineage.

**What it is not:** a standalone AI image generator whose result must be rebuilt elsewhere.

---

## MyVehiclePro

**Role:** Actual-vehicle-photo workflow.

MyVehiclePro uses customer-supplied photography of the real vehicle when a standard year/make/model representation does not fully describe what will be wrapped.

**Useful for:**

- aftermarket racks or accessories;
- specialty commercial bodies;
- upfits;
- trailers;
- unusual configurations;
- existing modifications.

**Outcome:** a project that can be visualized in the customer's actual vehicle context while remaining inside the DesignProAI lifecycle.

---

## WallPro

**Role:** Wall and environmental-graphics design application.

WallPro creates graphics for walls and architectural spaces from a prompt, uploaded space/photo, physical dimensions, and optional artwork.

**Core capabilities:**

- prompt-based design;
- uploaded room/wall context;
- wall dimensions;
- architectural obstacle/mask handling;
- visual preview;
- production planning/panel output workflow.

**Outcome:** the same wall project can move from concept/preview into production output instead of becoming a detached rendering.

---

## CutPro

**Role:** Cut-graphics and contour-cut preparation application.

CutPro is the customer-facing name replacing GraphicsPro.

**Core capabilities:**

- create/import graphics for cut production;
- choose applicable surface/context;
- prepare contour/cut geometry;
- produce files/metadata needed by downstream cut/plot workflows.

**Compatibility note:** internal routes, storage names, analytics keys, and edge functions may still use `graphicspro`. Do not rename those simply to match public copy.

---

## RecreatePro

**Role:** Inbound design reconstruction / rescue workflow.

RecreatePro is for customers who already have visual direction but do not have usable production artwork.

**Typical inputs:**

- AI-generated concepts;
- screenshots;
- customer photos;
- old wrap images;
- low-resolution graphics;
- flattened artwork;
- reference/inspiration designs.

**Core job:** interpret/recreate the supplied visual direction as a DesignProAI project that can continue through proofing, revision, and the sanctioned production-file output chain.

**Architecture rule:** RecreatePro must enter the same production chain; it must not become a second independent producer of production panels/files.

---

## RevisionStudio

**Role:** Review, edit, client proof, revise, and order-output workspace.

RevisionStudio keeps customer changes attached to the existing project.

**Target capabilities:**

- review designs/proofs;
- edit or request controlled changes;
- change logos, copy, phone numbers, URLs, colors, and placement;
- email/share design proofs with clients;
- record new revision lineage;
- see project history;
- purchase/order production-file output;
- open related production/QC status without creating a new project.

**Outcome:** revisions become part of the project history rather than a chain of disconnected `final-v7` files.

---

## ProductionFlow

**Role:** Production workflow and status layer.

ProductionFlow represents the project's transition from approved creative work into paid production processing.

**Core responsibilities:**

- show the current production state;
- expose the server-owned progression rather than inventing browser status;
- connect the production-file order to GENIE, QC, output verification, and delivery;
- provide the state used by customer and operator production views.

---

## GENIE Universal Panelizer

**Role:** Production geometry, panelization, and progress system.

GENIE converts the approved project's application context into the physical production manifest/panel relationships required downstream.

**Core capabilities:**

- resolve production geometry;
- establish panel dimensions/relationships;
- apply bleed/production allowances according to the production contract;
- bind production artifacts to project identity;
- surface real customer-facing production progress;
- support validation against vehicle dimension authority.

**Customer-facing progress:** the GENIE progress page should reflect real stages/artifacts. It must not show fake completion merely because the browser advanced a step animation.

---

## GENIE Vehicle Database

**Role:** Vehicle measurement/configuration authority.

The GENIE Vehicle Database supplies year/make/model/configuration dimensions used by production tools and validation.

**Current implementation evidence:** the reviewed codebase includes an embedded dataset of 1,664 vehicle records plus resolver/catalog infrastructure. This count is implementation status, not a permanent marketing promise.

**Why it matters:** photorealistic proofs are presentation assets; production geometry must be grounded in real dimensional data rather than inferred from the appearance of a rendered image.

---

## PrintPanelStudio

**Role:** Multi-step production QC workspace.

PrintPanelStudio is the target public name for the current PanelPro Studio production workspace.

**Core capabilities:**

- inspect the approved design proof beside the corresponding print panel;
- verify project/surface identity;
- review dimensions and production artifact state;
- complete human preflight checks;
- inspect enhanced/final production outputs;
- complete final human release/QC.

**QC model:** DesignProAI combines automated validation with human release gates. Automation finds objective mismatches quickly; human production/design review remains part of the release process.

---

## WrapBox

**Role:** Verified production-package delivery.

WrapBox is the customer delivery destination after production output has been built, verified, approved, stamped/packaged as required, and released.

**Core capabilities:**

- present delivered production packs;
- preserve the relationship to DesignID/order identity;
- deliver the verified package rather than an unrelated export;
- support retrieval of completed production assets.

---

## Optional downstream print / ship handoff

DesignProAI can hand finished digital output to a downstream print/fulfillment workflow. The reviewed repository already contains separate WePrintWraps/PatternPro fulfillment and shipping logic, but that is not the same thing as the core DesignProAI production graph.

Until a universal DesignProAI print/ship contract is explicitly approved, public docs should say:

> **WrapBox delivers verified production files. Printing, fulfillment, and shipping can be handled by the customer's downstream production workflow or an integrated fulfillment partner where offered.**

Do not imply that every DesignProAI production pack is automatically printed and physically shipped unless that product path is implemented and verified.
