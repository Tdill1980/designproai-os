const COPY = {
  "panelprofileoutput.plan": [
    "Plan artwork placement",
    "Checking template fit, installation cuts and available artwork before moving any design elements.",
  ],
  "panelprofileoutput.render": [
    "Create physical panel",
    "Creating this panel with continuous background artwork and five inches of outside bleed.",
  ],
  "panelprofileoutput.verify": [
    "Verify physical files",
    "Checking every physical panel file, its dimensions and the complete output set.",
  ],
  "panelprofileoutput.package": [
    "Package physical panels",
    "Packaging the physical panels approved by the design team.",
  ],
  "panelprofileoutput.handoff": [
    "Return to source app",
    "Returning the reviewed files to the saved design and its production workflow.",
  ],
  "manifest.resolve": [
    "Confirm dimensions",
    "Confirming the dimensions for this job.",
  ],
  "source.verify": [
    "Check artwork",
    "Checking the saved artwork and reusable assets.",
  ],
  "template.lookup": [
    "Find template",
    "Finding the validated template for this vehicle or surface.",
  ],
  "template.recreate": [
    "Prepare template",
    "Preparing a branded template preview.",
  ],
  "template.brand": [
    "Brand template",
    "Applying the DesignProAI presentation.",
  ],
  "template.validate": [
    "Verify template",
    "Checking the preview against its measured template.",
  ],
  "template.bank": [
    "Save template",
    "Saving the verified template for future jobs.",
  ],
  "panelprofileoutput.fit": [
    "Fit artwork",
    "Placing the artwork on the measured template.",
  ],
  "panelprofileoutput.protect": [
    "Protect key elements",
    "Checking that logos and important content stay clear of installation cuts.",
  ],
  "panelprofileoutput.bleed": [
    "Prepare bleed",
    "Checking continuous background artwork and five inches of bleed on every outside edge.",
  ],
  "panelprofileoutput.proof": [
    "Build panel proof",
    "Creating the dimensioned panel proof and template overlays.",
  ],
  await_panelpro_preflight_qc: [
    "Designer review",
    "The design team checks the artwork against the template.",
  ],
  "enhance.upscale": [
    "Prepare resolution",
    "Preparing the artwork for its full printed size.",
  ],
  "output.build": [
    "Build print files",
    "Building the production files for each panel.",
  ],
  "output.verify": [
    "Verify print files",
    "Checking the saved files, dimensions and resolution.",
  ],
  await_final_human_qc: [
    "Final designer review",
    "The design team checks the finished files and proofs.",
  ],
  "stamp.build": [
    "Stamp proofs",
    "Adding the recorded QC approval to the proof copies.",
  ],
  "zip.build": [
    "Package files",
    "Packaging the approved files, proofs and assets.",
  ],
  "wrapbox.deliver": [
    "Save to WrapBox",
    "Saving the verified package in WrapBox.",
  ],
};
const BLOCKERS = {
  panelprofile_proof_refresh_required:
    "Artwork changed. Continue the existing RevisionStudio edit flow to regenerate matching panels and vehicle proofs before attaching this package.",
  panelprofile_template_validation_required:
    "The template's dimensions and installation cut areas must be reviewed before registration.",
  panelprofile_branded_template_required:
    "A verified branded template preview is required for this handoff.",
  panelprofile_template_geometry_mismatch:
    "The measured geometry and branded template preview do not match the same saved template version.",
  panelprofile_template_vehicle_mismatch:
    "The template does not match the saved design's make, model and year. Select the correct measured template.",
  panelprofile_template_vehicle_variant_missing:
    "The template is missing a vehicle variant recorded on this design.",
  panelprofile_template_vehicle_variant_mismatch:
    "The measured template's vehicle variant does not match this saved design.",
  panelprofile_template_vehicle_review_required:
    "The saved design omits a vehicle variant. The design team must compare the actual vehicle and record that review in source preparation.",
  panelprofile_template_vehicle_review_mismatch:
    "The vehicle review no longer matches this source revision, template geometry and GENIE dimensions. Review the current selection.",
  panelprofile_input_correction_required:
    "This output needs corrected source input before it can continue. Retrying the same input cannot fix this result.",
  panelprofile_asset_inventory_required:
    "The verified artwork asset inventory is missing from this handoff.",
  panelprofile_canonical_revision_mismatch:
    "The source master does not match the selected saved DesignPro revision.",
  panelprofile_asset_owner_scope_invalid:
    "A source file is outside the current account's authorized artwork storage.",
  panelprofile_source_mapping_required:
    "The artwork needs its measured placement bounds before it can be fitted to the template.",
  panelprofile_reviewed_geometry_required:
    "The reviewed template geometry file is required before this job can run.",
  panelprofile_qc_permission_required:
    "This account does not have the design-team permission required for this action.",
  panelprofile_service_not_enabled:
    "PanelProFileOutput has not been enabled on this server yet.",
  panelprofile_revision_selection_required:
    "Select the exact saved revision before preparing output.",
  clearance_profile_required:
    "The installation clearance around important artwork needs to be set.",
  protected_art_has_no_safe_candidate:
    "A designer needs to place this important artwork safely on the template.",
  protected_art_unsafe:
    "Important artwork overlaps an installation cut area and needs correction.",
  panelprofile_verified_nonessential_background_required:
    "A verified background layer is needed to keep cut areas covered when artwork is moved.",
  panelprofile_protected_art_requires_layer_separation:
    "A clean background and separate artwork are needed before important content can be moved.",
  panelprofile_bleed_source_coverage_missing:
    "The existing background does not cover the full panel and five-inch bleed.",
  panelprofile_continuous_artwork_has_transparency:
    "The artwork has transparent areas that need to be filled with background design before printing.",
  panelprofile_continuous_artwork_review_required:
    "A designer needs to verify continuous background coverage through the cut areas.",
  panelprofile_source_effective_ppi_insufficient:
    "The artwork needs more resolution at its full printed size.",
  panelprofile_asset_effective_ppi_insufficient:
    "A design element needs a higher-resolution source at its printed size.",
  panelprofile_source_mapping_would_stretch:
    "The artwork would stretch at this placement. A designer needs to correct its proportions.",
  panelprofile_source_orientation_requires_normalization:
    "The source artwork's orientation needs to be corrected before fitting.",
  panelprofile_roll_width_exceeded:
    "A physical piece exceeds the printable material width and needs a reviewed split.",
  panelprofile_source_not_prepared:
    "The design team needs to prepare this job's verified artwork and template handoff.",
  panelprofile_template_missing:
    "A validated template is needed for this exact vehicle or surface.",
  panelprofile_template_geometry_unverified:
    "The template's dimensions and installation cut areas need review.",
  panelprofile_template_display_unverified:
    "The branded template preview needs verification before it can be shown.",
  panelprofile_template_geometry_required:
    "A measured template file is required before artwork can be fitted.",
  panelprofile_geometry_artifact_required:
    "A measured template file is required before artwork can be fitted.",
  panelprofile_human_review_required:
    "A designer needs to review this placement.",
  protected_clearance_required:
    "The installation clearance around important artwork needs to be set.",
  physical_panel_split_required:
    "A panel is wider than the printable material and needs a reviewed split.",
  unsafe_baked_artwork:
    "Important artwork is combined with the background and needs a designer's correction.",
  layer_separation_required:
    "A clean background and separate artwork are needed before a logo can be moved.",
  source_resolution_verification_required:
    "The artwork's resolution needs to be checked at the full printed size.",
  bleed_content_verification_required:
    "The background needs to cover the complete panel and outside bleed.",
};
const ROLES = {
  "branded-template": "Branded template",
  "template-overlay": "Artwork on template",
  "installation-mask": "Installation cut areas",
  "placement-comparison": "Artwork placement comparison",
  "bleed-preview": "Panel and five-inch bleed",
  "production-panel-proof": "Dimensioned production panel proof",
  "qc-approved-panel-proof": "QC approved physical panel proof",
};
export function panelOutputStageCopy(key) {
  if (String(key).startsWith("panelprofileoutput.render:"))
    return COPY["panelprofileoutput.render"];
  return (
    (Object.hasOwn(COPY, key) ? COPY[key] : null) || [
      "Prepare production",
      "Preparing the next verified production asset.",
    ]
  );
}
export function panelOutputBlockerCopy(code) {
  return (
    (Object.hasOwn(BLOCKERS, code) ? BLOCKERS[code] : null) ||
    "This step needs the design team's review before work can continue."
  );
}
export function panelOutputStageState(state) {
  const states = {
    complete: "Complete",
    completed: "Complete",
    succeeded: "Complete",
    running: "Creating",
    leased: "Creating",
    waiting: "Waiting",
    blocked: "Needs review",
    requires_human_correction: "Needs correction",
    ready_for_human_review: "Ready for designer review",
    ready_for_source_app_review: "Ready for source app review",
    failed: "Needs review",
    cancelled: "Cancelled",
    skipped: "Not needed",
    retryable: "Retry scheduled",
    pending: "Queued",
    queued: "Queued",
  };
  return Object.hasOwn(states, state) ? states[state] : "Waiting";
}
export function panelOutputProgress(stages) {
  const real = Array.isArray(stages) ? stages : [];
  const complete = real.filter((stage) =>
    ["complete", "completed", "succeeded"].includes(stage.state),
  ).length;
  return {
    complete,
    total: real.length,
    percent: real.length ? Math.round((complete / real.length) * 100) : null,
  };
}
export function panelOutputPreviews(previews) {
  return (Array.isArray(previews) ? previews : [])
    .filter(
      (preview) =>
        Object.hasOwn(ROLES, preview.role) &&
        preview.approvedDisplay === true &&
        preview.geometryValidated === true &&
        preview.provenance === "generated-branded" &&
        /^[a-f0-9]{64}$/i.test(preview.contentHash || "") &&
        /^[a-f0-9]{64}$/i.test(preview.profileHash || "") &&
        /^https:\/\/[^\s]+$/.test(preview.signedUrl || ""),
    )
    .map((preview) => ({ ...preview, label: ROLES[preview.role] }))
    .sort(
      (a, b) =>
        Object.keys(ROLES).indexOf(a.role) -
          Object.keys(ROLES).indexOf(b.role) ||
        String(a.pieceId || "").localeCompare(String(b.pieceId || "")) ||
        a.id.localeCompare(b.id),
    );
}
export function panelOutputSafeReviewUrl(url, generationId) {
  const own = generationId
    ? `/designpro/jobs/${encodeURIComponent(generationId)}/panelpro`
    : null;
  return url === own || url === `${own}/surfaces` ? url : own;
}

/** Continue the existing mapped revision flow only for this saved child/job. */
export function panelOutputRevisionHref(continuation, generationId, panelOutputRunId, atlasRevisionId) {
  if (!continuation || continuation.targetApp !== "RevisionStudioIQ" || continuation.generationId !== generationId
    || continuation.panelOutputRunId !== panelOutputRunId || continuation.requiresAcceptedRevision !== true
    || continuation.automaticPanelRegeneration !== true || continuation.autoApply !== false
    || !continuation.sourceRevisionId || (atlasRevisionId && continuation.sourceRevisionId !== atlasRevisionId)) return null;
  try {
    const url = new URL(continuation.href, "https://designpro.invalid");
    if (url.origin !== "https://designpro.invalid" || url.pathname !== "/revision-studio"
      || url.searchParams.get("id") !== generationId || url.searchParams.get("sourceRevisionId") !== continuation.sourceRevisionId
      || url.searchParams.get("panelOutputRunId") !== panelOutputRunId || url.hash
      || [...url.searchParams.keys()].some((key) => !["id", "sourceRevisionId", "panelOutputRunId", "revisionInstruction"].includes(key))) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}
