# DesignProAI App Workflows

Use this guide to understand which application to open and what outcome it is responsible for.

## VehiclePro

Use VehiclePro when you know the vehicle and need a professional custom vehicle-graphics design.

### Typical workflow

1. Select/confirm year, make, model, and relevant vehicle context.
2. Enter the customer/brand information.
3. Describe the desired design in natural language.
4. Add required logos, reference artwork, and messaging.
5. Generate through A.C.E.
6. Review the photorealistic views.
7. Open the project in RevisionStudio for client proofing/revisions.
8. Approve and order production output when ready.

### Best use

New vehicle-wrap and commercial-graphics projects where the target vehicle is known.

---

## MyVehiclePro

Use MyVehiclePro when the customer's real vehicle differs from a generic vehicle representation or when you want the actual vehicle photo in the design/visualization workflow.

### Typical workflow

1. Upload clear photos of the customer's actual vehicle.
2. Confirm the known year/make/model/context.
3. Supply the design or creative brief.
4. Generate/visualize in the real-vehicle context.
5. Continue into RevisionStudio and production when approved.

### Best use

Specialty bodies, custom upfits, racks, accessories, trailers, and modified fleet vehicles.

---

## WallPro

Use WallPro for wall murals, architectural graphics, and environmental graphics.

### Typical workflow

1. Upload the wall/room photo or start the wall project.
2. Enter/confirm physical dimensions.
3. Identify architectural areas that should not receive graphics.
4. Choose whether to prompt a new design, use existing artwork, or select another supported design path.
5. Generate/preview the design in context.
6. Refine the wall project.
7. Continue into output/panel preparation when approved.

### Best use

Commercial interiors, apartment/common areas, gyms, hospitality, offices, retail, residential feature walls, and other architectural surfaces.

---

## CutPro

Use CutPro when the required output is a cut/contour graphic rather than a full printed wrap panel set.

### Typical workflow

1. Choose the target surface/application.
2. Add or create the graphic.
3. Confirm scale/placement.
4. Prepare the contour/cut geometry.
5. Validate the result.
6. Export/hand off the supported cut-production file/metadata.

### Best use

Vehicle lettering, logos, window graphics, wall cut graphics, decals, and contour-cut work.

---

## RecreatePro

Use RecreatePro when the customer already has the look but not usable production artwork.

### Typical workflow

1. Upload the customer references/photos/artwork.
2. Enter the vehicle/application context.
3. Describe what must be preserved and what may change.
4. Recreate the visual direction through A.C.E./the sanctioned recreation workflow.
5. Review the recreated result.
6. Move the accepted project into RevisionStudio.
7. Approve and order production output through the standard DesignProAI chain.

### Best use

AI-generated customer concepts, screenshots, old wrap photos, low-resolution art, flattened files, and visual references that communicate the customer's intent but are not production-ready.

---

## RevisionStudio

Use RevisionStudio after a design exists and must be reviewed, changed, presented, or purchased for production output.

### Typical workflow

1. Open the DesignProAI project.
2. Review current design/proofs and history.
3. Make or request targeted edits.
4. Save the new revision while preserving project lineage.
5. Email/share the current proof with the client.
6. Record/confirm approval.
7. Order the production-file package.
8. Open production/progress views for the same project.

### Best use

Client-facing design review and ongoing account/fleet revisions.

---

## ProductionFlow

Use ProductionFlow to understand where an approved/purchased job is in production.

### Typical workflow

1. Open the production job.
2. Review the current server-reported state.
3. Follow required production/QC gates.
4. Open GENIE progress for customer-facing status.
5. Open PrintPanelStudio for production-team QC where authorized.
6. Continue to WrapBox after release.

### Best use

Operations, customer service, designers, and production teams that need one shared view of the job's state.

---

## GENIE Universal Panelizer

Use GENIE when an approved job needs physical production geometry/panels.

### What happens

- resolves/uses the correct dimensional authority;
- builds the required production manifest/panel relationships;
- binds panel work to the correct DesignProAI identity;
- exposes real production progress to the customer/operator;
- hands production artifacts into QC/output stages.

### Important distinction

GENIE's customer progress is not the same thing as PrintPanelStudio. GENIE tells the customer/operator where the job is. PrintPanelStudio is the production team's inspection/release workspace.

---

## GENIE Vehicle Database

The GENIE Vehicle Database is not a design screen. It is production infrastructure used to ground vehicle dimensions/configuration for other DesignProAI tools.

When a supported vehicle is selected, the system can resolve dimensions needed for production validation rather than estimating them from a render.

---

## PrintPanelStudio

Use PrintPanelStudio when the production file set must be inspected and released.

### Multi-step QC model

1. Confirm project/GenerationID/DesignID/surface identity.
2. Compare the approved design proof with the production panel.
3. Inspect dimensions and production geometry.
4. Review automated validation results.
5. Complete human preflight approval.
6. Inspect enhanced/final output artifacts.
7. Complete final human QC before delivery.

Only authorized production/design users should perform release actions.

---

## WrapBox

Use WrapBox to retrieve completed, verified production packages.

WrapBox should be treated as the end of the DesignProAI digital production chain. If the job is also being printed and physically shipped, that occurs through a separate downstream fulfillment path or approved partner integration.
