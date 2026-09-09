"use strict";
const { createHash } = require("node:crypto");
const { buildPanelProFileOutputHandoff } = require("./panelpro-file-output-contract.cjs");

const GRAPH_VERSION = "designpro.panelpro-file-output-graph.v1";
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(k => [k,canonical(value[k])]));
  return value;
}
const hashJson = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

function validateGraph(nodes) {
  if (!Array.isArray(nodes) || !nodes.length || nodes.length>140) throw new Error("panelprofile_graph_invalid");
  const byKey = new Map(nodes.map(n=>[n.key,n]));
  if (byKey.size!==nodes.length) throw new Error("panelprofile_duplicate_node");
  const visiting=new Set(),visited=new Set();
  function visit(key) {
    if (visiting.has(key)) throw new Error("panelprofile_dependency_cycle");
    if (visited.has(key)) return;
    const node=byKey.get(key);
    if (!node || !Array.isArray(node.dependsOn)) throw new Error("panelprofile_dependency_missing");
    visiting.add(key); for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(key); visited.add(key);
  }
  for (const key of byKey.keys()) visit(key);
  return nodes;
}

/** Template recreation/banking has its own reviewed input lifecycle. This run
 * consumes that immutable bank entry and never asks an image model for inches.
 * Every heavy piece is independently resumable; the runtime shares the same
 * global memory lease as the existing production worker. */
function compilePanelProFileOutputGraph(input) {
  const handoff=buildPanelProFileOutputHandoff(input);
  const renders=handoff.pieces.map(piece=>({key:`panelprofileoutput.render:${piece.pieceId}`,
    dependsOn:["panelprofileoutput.plan"],input:{pieceId:piece.pieceId}}));
  return validateGraph([
    {key:"source.verify",dependsOn:[]},
    {key:"template.lookup",dependsOn:[]},
    {key:"panelprofileoutput.plan",dependsOn:["source.verify","template.lookup"]},
    ...renders,
    {key:"panelprofileoutput.verify",dependsOn:renders.map(n=>n.key)},
    {key:"await_panelpro_preflight_qc",dependsOn:["panelprofileoutput.verify"]},
    {key:"panelprofileoutput.package",dependsOn:["await_panelpro_preflight_qc"]},
    {key:"panelprofileoutput.handoff",dependsOn:["panelprofileoutput.package"]},
  ]);
}

function readyNodes(nodes) {
  const states=new Map(nodes.map(n=>[n.key,n.state]));
  return nodes.filter(n=>n.state==="pending" && n.dependsOn.every(d=>states.get(d)==="completed"));
}

// Only persisted facts feed this projection. Model text, provider errors,
// thought signatures, geometry documents and storage paths stay private.
const PUBLIC_COPY=Object.freeze({
  "source.verify":"Checking this design’s original artwork and assets",
  "template.lookup":"Loading the verified template",
  "panelprofileoutput.plan":"Checking fit, protected artwork and installation areas",
  "panelprofileoutput.render":"Creating panels with continuous background and five-inch bleed",
  "panelprofileoutput.verify":"Checking the prepared files and dimensions",
  "await_panelpro_preflight_qc":"Waiting for the design team’s inspection",
  "panelprofileoutput.package":"Packaging the reviewed panel files",
  "panelprofileoutput.handoff":"Returning the files to the design workspace",
});
function publicNode(node) {
  const key=node.node_key || node.key;
  const base=String(key).startsWith("panelprofileoutput.render:")?"panelprofileoutput.render":key;
  return {key,state:node.state,dependsOn:node.depends_on || node.dependsOn || [],attempt:node.attempt || 0,
    messageCode:base,message:PUBLIC_COPY[base] || "Preparing the design",updatedAt:node.updated_at || null};
}

function verifyPieceArtifactJoin(handoff, nodes, artifacts) {
  const expected=handoff.pieces.map(p=>p.pieceId).sort();
  const pieceReceipts=nodes.filter(n=>String(n.node_key||n.key).startsWith("panelprofileoutput.render:"));
  if (pieceReceipts.length!==expected.length || pieceReceipts.some(n=>n.state!=="completed")) throw new Error("panelprofile_piece_join_incomplete");
  for (const pieceId of expected) {
    const node=pieceReceipts.find(n=>n.input?.pieceId===pieceId);
    if (!node || node.output?.inputHash!==handoff.inputHash || node.output?.qcApproved===true
      || node.output?.productionFilesCreated!==true || node.output?.pieces?.length!==1) throw new Error("panelprofile_piece_identity_invalid");
    // The renderer may create multiple roll sections for one physical piece.
    const outputArtifacts=artifacts.filter(a=>a.piece_id===pieceId && ["production-png","production-tiff","production-pdf"].includes(a.role));
    const sections=node.output?.pieces?.find(p=>p.pieceId===pieceId)?.sections || [];
    if (!sections.length || new Set(sections.map(s=>s.sectionId)).size!==sections.length
      || outputArtifacts.length!==sections.length*3 || sections.some(section=>!["production-png","production-tiff","production-pdf"].every(role=>
        outputArtifacts.filter(a=>a.role===role && a.metadata?.sectionId===section.sectionId).length===1))) throw new Error("panelprofile_piece_formats_missing");
    const receipts=node.output.artifacts;
    if(!Array.isArray(receipts) || new Set(receipts.map(r=>r.storagePath)).size!==receipts.length
      || receipts.length!==artifacts.filter(a=>a.node_id===node.id).length
      || receipts.some(receipt=>!artifacts.some(a=>a.node_id===node.id && a.piece_id===pieceId
        && a.storage_path===receipt.storagePath && a.content_hash===receipt.contentHash
        && Number(a.byte_size)===receipt.byteSize && a.role===receipt.role && a.mime_type===receipt.mimeType))) throw new Error("panelprofile_piece_receipt_mismatch");
  }
  const inventory=artifacts.map(a=>({role:a.role,pieceId:a.piece_id,storagePath:a.storage_path,contentHash:a.content_hash,byteSize:a.byte_size}))
    .sort((a,b)=>a.storagePath.localeCompare(b.storagePath));
  if (new Set(inventory.map(a=>a.storagePath)).size!==inventory.length) throw new Error("panelprofile_duplicate_artifact");
  return {contractVersion:GRAPH_VERSION,inputHash:handoff.inputHash,artifactSetHash:hashJson(inventory),
    inventory,pieceIds:expected,verified:true,qcApproved:false};
}

module.exports={GRAPH_VERSION,hashJson,validateGraph,compilePanelProFileOutputGraph,readyNodes,publicNode,verifyPieceArtifactJoin};
