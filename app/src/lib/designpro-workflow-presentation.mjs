// Public narration is a fixed vocabulary. Never render provider prompts,
// reasoning, errors, implementation labels or arbitrary stage-supplied copy.
const COPY = {
  'revision.freeze': ['Design saved', 'Saving the selected design for production.'],
  'manifest.resolve': ['Dimensions', 'Confirming the dimensions needed for your panels.'],
  'source.verify': ['Artwork check', 'Checking that the artwork matches this design.'],
  'panels.build': ['Panel artwork', 'Preparing the artwork for each section.'],
  'logos.extract': ['Design assets', 'Saving the logos and available design assets.'],
  'panels.delogo': ['Review copies', 'Preparing separate copies for the design team to check.'],
  'proof.build': ['Production proof', 'Creating a proof of the panel artwork.'],
  'pack.verify': ['Asset check', 'Checking that the required design files are present.'],
  'pack.activate': ['Design package', 'Preparing the design package for the next step.'],
  'await_purchase': ['Production access', 'Waiting for production access to be confirmed.'],
  'await_panelpro_preflight_qc': ['Template review', 'The design team checks fit and important artwork placement.'],
  'enhance.upscale': ['Print detail', 'Preparing the image detail needed at print size.'],
  'output.build': ['Print files', 'Creating the individual production files.'],
  'output.verify': ['File checks', 'Checking the dimensions and integrity of the exported files.'],
  'await_final_human_qc': ['Final review', 'The design team reviews the completed production files.'],
  'stamp.build': ['Approved proofs', 'Preparing approval marks for the reviewed proofs.'],
  'zip.build': ['Download package', 'Putting the checked files into the download package.'],
  'wrapbox.deliver': ['WrapBox', 'Making the completed package available in WrapBox.'],
  // These stages only appear when an integrated producer actually reports
  // them. This registry never invents an execution or creates a workflow row.
  'template.lookup': ['Vehicle template', 'Finding a validated template for this vehicle.'],
  'template.recreate': ['Template preparation', 'Preparing a branded vehicle template.'],
  'template.brand': ['Template presentation', 'Preparing the template for display.'],
  'template.validate': ['Template check', 'Checking the template against the vehicle measurements.'],
  'template.bank': ['Template saved', 'Saving the checked template for future designs.'],
  'panelprofileoutput.fit': ['Artwork on template', 'Placing the existing artwork on the measured template.'],
  'panelprofileoutput.protect': ['Protected artwork', 'Checking important artwork against areas trimmed during installation.'],
  'panelprofileoutput.bleed': ['Panel coverage', 'Checking that artwork covers the required panel edges.'],
  'panelprofileoutput.proof': ['Placement proof', 'Preparing the template overlay for review.'],
};

const PREVIEW_ROLES = {
  'branded-template': ['Vehicle template', 0],
  'template-overlay': ['Artwork on the template', 1],
  'installation-mask': ['Areas trimmed during installation', 2],
  'placement-comparison': ['Artwork placement adjustment', 3],
  'bleed-preview': ['Panel coverage and bleed', 4],
};

export function presentWorkflowStages(stages = []) {
  return stages.map((stage) => {
    const copy = Object.hasOwn(COPY, stage.key) ? COPY[stage.key] : ['File preparation', 'Preparing an additional design file.'];
    const state = stage.deferred === true ? 'attention'
      : stage.executionState === 'retryable' ? 'retrying'
      : stage.executionState === 'cancelled' ? 'cancelled'
      : stage.executionState === 'skipped' ? 'skipped'
      : ['complete', 'running', 'waiting', 'failed', 'pending'].includes(stage.state)
        ? stage.state : 'pending';
    return {
      key: stage.key, label: copy[0], explanation: copy[1], state,
      // Undefined/null is legacy/unknown, never an invented root edge.
      dependsOn: Array.isArray(stage.dependsOn) ? [...stage.dependsOn] : null,
    };
  });
}

export function publicBuildPreviews(artifacts = []) {
  return artifacts.flatMap((artifact) => {
    const m = artifact.metadata || {};
    const role = m.presentationRole;
    const copy = Object.hasOwn(PREVIEW_ROLES, role) ? PREVIEW_ROLES[role] : null;
    if (!copy || m.customerDisplayApproved !== true || m.containsPrivateTemplate === true
      || !artifact.signedUrl || !/^[a-f0-9]{64}$/.test(artifact.contentHash || '')) return [];
    // A recreated image is not a calibrated template simply because it is branded.
    if (m.templateDisplayOrigin !== 'generated-branded' || m.geometryValidated !== true || !/^[a-f0-9]{64}$/.test(m.templateProfileHash || '')) return [];
    return [{ id: artifact.id, role, label: copy[0], order: copy[1], signedUrl: artifact.signedUrl,
      surfaceKey: artifact.surfaceKey || '', contentHash: artifact.contentHash }];
  }).sort((a, b) => a.order - b.order || a.surfaceKey.localeCompare(b.surfaceKey) || a.id.localeCompare(b.id));
}

export function productionProgressMessage(job, hasZip) {
  if (job?.state === 'complete' && hasZip) return 'Your checked production package is ready to download.';
  if (job?.state === 'waiting_for_preflight') return 'Your panels are ready for the design team to check against the vehicle template.';
  if (job?.state === 'waiting_for_final_qc') return 'Your exported files are waiting for final review.';
  if (job?.state === 'failed' || job?.stages?.some((s) => s.deferred === true)) return 'A production step needs attention. Completed artwork remains available.';
  return 'Each panel appears as its artwork becomes available. File preparation and review continue below.';
}
