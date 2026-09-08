"use strict";
const { createHash } = require("node:crypto");
const { canonicalUuid, safeStoragePath } = require("./runtime-contract.cjs");
const { verifyStoredArtifact } = require("./zip-spool.cjs");
const CONTRACT = "designpro.panelprofile-production-attachment.v1";
const HASH = /^[a-f0-9]{64}$/;
const ROLE = new Set(["branded-template","template-overlay","installation-mask","placement-comparison","bleed-preview","production-panel-proof","qc-approved-panel-proof","production-png","production-tiff","production-pdf","qc-panel-copy","reused-asset","reviewed-package"]);
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status, retryable: false }); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
const hashJson = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
function result(response, code) {
  if (response.error) {
    const message = String(response.error.message || "");
    if (/^(panelprofile|production_panelprofile)_[a-z_]+$/.test(message)) fail(message);
    fail(code,503);
  }
  return response.data;
}
function changesArtwork(source, handoff, renderNodes) {
  if (handoff?.requiresProofRefresh !== false || handoff?.compositionChanged === true) return true;
  if (!Array.isArray(source?.handoff?.pieces) || !source.handoff.pieces.length) return true;
  if (source.handoff.pieces.some(piece => piece.composition?.rebuildFromSeparatedAssets === true || piece.composition?.compositionChanged === true)) return true;
  return renderNodes.some(node => !Array.isArray(node.output?.pieces) || node.output.pieces.some(piece =>
    piece.compositionChanged === true || piece.evidence?.cutAreaFill === "verified-existing-nonessential-background"
    || !Array.isArray(piece.placements) || piece.placements.some(element => element.moved === true)));
}
function revisionContinuation(source, childRunId) {
  const generationId=canonicalUuid(source.generation_id,"generationId");
  const revisionId=canonicalUuid(source.handoff?.atlasRevisionId,"atlasRevisionId");
  const sourceWorkflowRevisionId=canonicalUuid(source.revision_id,"revisionId");
  const query=new URLSearchParams({id:generationId,sourceRevisionId:revisionId,panelOutputRunId:childRunId,
    revisionInstruction:"Review the saved template-fit changes, apply the approved artwork edits, and regenerate this design's panels and vehicle proofs."});
  return {targetApp:"RevisionStudioIQ",href:`/revision-studio?${query}`,generationId,sourceRevisionId:revisionId,sourceWorkflowRevisionId,
    panelOutputRunId:childRunId,requiresAcceptedRevision:true,automaticPanelRegeneration:true,
    proposedChangesSource:"reviewed-panelprofile-run",autoApply:false};
}
function normalizedInventory(artifacts, ownerId, childRunId) {
  if (!Array.isArray(artifacts) || !artifacts.length || artifacts.length > 4096) fail("panelprofile_attachment_inventory_invalid");
  const prefix = `designpro/user_${ownerId}/${childRunId}/panelprofile/`;
  const inventory = artifacts.map(artifact => {
    const storagePath = safeStoragePath(artifact.storage_path);
    if (!storagePath.startsWith(prefix) || !ROLE.has(artifact.role) || !HASH.test(artifact.content_hash || "")
      || !Number.isSafeInteger(Number(artifact.byte_size)) || Number(artifact.byte_size) < 1) fail("panelprofile_attachment_artifact_invalid");
    return { role: artifact.role, pieceId: artifact.piece_id || "", storagePath, contentHash: artifact.content_hash,
      byteSize: Number(artifact.byte_size), mimeType: artifact.mime_type };
  }).sort((a,b) => a.storagePath < b.storagePath ? -1 : a.storagePath > b.storagePath ? 1 : 0);
  if (new Set(inventory.map(file => file.storagePath)).size !== inventory.length
    || inventory.filter(file => file.role === "reviewed-package").length !== 1) fail("panelprofile_attachment_inventory_invalid");
  return inventory;
}
async function reservePanelProfileForProduction({supabase,actorId,productionRunId}) {
  canonicalUuid(actorId,"actorId"); canonicalUuid(productionRunId,"productionRunId");
  const reserved = result(await supabase.rpc("reserve_panelprofile_for_production",{p_actor:actorId,p_production_run_id:productionRunId}),"panelprofile_reservation_failed");
  return {parentRunId:reserved.production_run_id,generationId:reserved.generation_id,revisionId:reserved.revision_id,status:"waiting_for_reviewed_panelprofile",customerReleaseApproved:false};
}
async function attachPanelProfileToProduction({ supabase, actorId, childRunId, productionRunId }) {
  canonicalUuid(actorId,"actorId"); canonicalUuid(childRunId,"childRunId"); canonicalUuid(productionRunId,"productionRunId");
  const member = result(await supabase.from("designpro_qc_members").select("user_id,can_preflight").eq("user_id",actorId).maybeSingle(),"panelprofile_attachment_actor_lookup_failed");
  if (member?.can_preflight !== true) fail("panelprofile_qc_permission_required",403);
  const child = result(await supabase.from("panelprofile_runs").select("*").eq("id",childRunId).maybeSingle(),"panelprofile_attachment_child_missing");
  const parent = result(await supabase.from("designpro_workflow_runs").select("*").eq("id",productionRunId).maybeSingle(),"panelprofile_attachment_parent_missing");
  if (!child || !parent || child.state !== "completed" || parent.workflow_type !== "designpro.production_pack"
    || parent.owner_id !== child.owner_id) fail("panelprofile_attachment_parent_mismatch");
  const source = result(await supabase.from("panelprofile_source_handoffs").select("*").eq("id",child.source_id).maybeSingle(),"panelprofile_attachment_source_missing");
  if (!source || source.source_app !== "DesignPro" || source.revision_id !== parent.revision_id || source.owner_id !== parent.owner_id
    || source.handoff?.dimensionManifestHash !== parent.manifest_hash) fail("panelprofile_attachment_source_mismatch");
  const nodes = result(await supabase.from("panelprofile_nodes").select("node_key,state,output,output_hash").eq("run_id",childRunId),"panelprofile_attachment_nodes_missing");
  const handoff = nodes.find(node => node.node_key === "panelprofileoutput.handoff");
  const rendered = nodes.filter(node => node.node_key.startsWith("panelprofileoutput.render:"));
  if (handoff?.state !== "completed" || handoff.output?.qcApproved !== true
    || rendered.length !== source.handoff.pieces?.length || rendered.some(node => node.state !== "completed")) fail("panelprofile_attachment_not_reviewed");
  if (changesArtwork(source,handoff.output,rendered)) throw Object.assign(
    new Error("Review these artwork changes in RevisionStudioIQ so its existing revision flow regenerates the matching panels and vehicle proofs"),
    {code:"panelprofile_proof_refresh_required",status:409,retryable:false,continuation:revisionContinuation(source,childRunId)});
  const artifacts = result(await supabase.from("panelprofile_artifacts").select("*").eq("run_id",childRunId),"panelprofile_attachment_inventory_missing");
  const inventory = normalizedInventory(artifacts,parent.owner_id,childRunId);
  // Verify the exact existing files before the database atomically binds them.
  // No source image, panel, receipt, human approval or file is overwritten.
  for (const file of inventory) {
    const verified = await verifyStoredArtifact({ supabase,storagePath:file.storagePath,contentHash:file.contentHash,byteSize:file.byteSize });
    if (!verified) fail("panelprofile_attachment_file_missing");
  }
  const attached = result(await supabase.rpc("attach_panelprofile_to_production",{
    p_actor:actorId,p_child_run_id:childRunId,p_production_run_id:productionRunId,p_verified_inventory:inventory,
  }),"panelprofile_attachment_rejected");
  return { attachmentId:attached.id,parentRunId:attached.production_run_id,childRunId:attached.child_run_id,
    snapshotHash:attached.snapshot_hash,status:"attached_for_final_human_qc",customerReleaseApproved:false };
}
function projectAttachment(row) {
  return { attachmentId:row.id,childRunId:row.child_run_id,snapshotHash:row.snapshot_hash,snapshot:row.snapshot };
}
async function loadPanelProfileAttachments(supabase,run,{verifyBytes=false}={}) {
  const rows = result(await supabase.from("designpro_panelprofile_attachments").select("*").eq("production_run_id",run.id),"panelprofile_attachment_lookup_failed") || [];
  const reservation = result(await supabase.from("designpro_panelprofile_reservations").select("*").eq("production_run_id",run.id).maybeSingle(),"panelprofile_reservation_lookup_failed");
  if (reservation && (reservation.owner_id !== run.owner_id || reservation.revision_id !== run.revision_id || reservation.manifest_hash !== run.manifest_hash)) fail("panelprofile_reservation_identity_drift");
  if (reservation && !rows.length) throw Object.assign(new Error("The reserved PanelProFileOutput package is still being prepared or reviewed"),{code:"production_panelprofile_pending",retryable:true});
  if (rows.length > 1) fail("panelprofile_attachment_set_ambiguous");
  for (const row of rows) {
    const snapshot = row.snapshot;
    if (row.owner_id !== run.owner_id || !HASH.test(row.snapshot_hash || "") || snapshot?.contractVersion !== CONTRACT
      || snapshot.parentRunId !== run.id || snapshot.childRunId !== row.child_run_id || snapshot.revisionId !== run.revision_id
      || snapshot.dimensionManifestHash !== run.manifest_hash || snapshot.requiresProofRefresh !== false
      || snapshot.approval?.qcApproved !== true || snapshot.approval?.artifactSetHash !== snapshot.artifactSetHash) fail("panelprofile_attachment_identity_drift");
    const inventory = normalizedInventory((snapshot.files || []).map(file => ({role:file.role,piece_id:file.pieceId,storage_path:file.storagePath,content_hash:file.contentHash,byte_size:file.byteSize,mime_type:file.mimeType})),run.owner_id,row.child_run_id);
    if (verifyBytes) for (const file of inventory) {
      if (!await verifyStoredArtifact({supabase,storagePath:file.storagePath,contentHash:file.contentHash,byteSize:file.byteSize})) fail("panelprofile_attachment_file_missing");
    }
  }
  return rows.map(projectAttachment);
}
async function assertPinnedPanelProfileAttachments(supabase,run,pinned) {
  const current = await loadPanelProfileAttachments(supabase,run);
  const expected = pinned == null && current.length === 0 ? [] : pinned;
  if (!Array.isArray(expected) || JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(current))) fail("panelprofile_attachment_approval_drift");
  return current;
}
function attachmentArchiveFiles(attachments) {
  return (attachments || []).flatMap(attachment => attachment.snapshot.files.map(file => ({...file,
    archivePath:`panelprofile/${attachment.childRunId}/${file.storagePath.slice(file.storagePath.indexOf("/panelprofile/")+14)}`,
    kind:"panelprofile-artifact",attachmentId:attachment.attachmentId,childRunId:attachment.childRunId,
  })));
}
module.exports = { CONTRACT,reservePanelProfileForProduction,attachPanelProfileToProduction,loadPanelProfileAttachments,assertPinnedPanelProfileAttachments,attachmentArchiveFiles,
  _test:{changesArtwork,revisionContinuation,normalizedInventory,hashJson,projectAttachment} };
