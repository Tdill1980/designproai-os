import assert from "node:assert/strict";
import { existsSync,readFileSync } from "node:fs";
import { dirname,resolve } from "node:path";
import { fileURLToPath } from "node:url";
const workspace=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const path=resolve(workspace,"worktracks/runtime_closure/runtime/designpro-standalone-claimant.cjs");
assert.ok(existsSync(path),"standalone claimant missing: designpro-standalone-claimant.cjs");
const source=readFileSync(path,"utf8");
const lower=source.toLowerCase();
assert.doesNotThrow(()=>new Function(source),"claimant must parse as JavaScript");
const tables=[...new Set([...source.matchAll(/\.from\(\s*["']([^"']+)/g)].map(m=>m[1]))];
const allowedTables=new Set(["designpro_workflow_runs","designpro_workflow_stages","designpro_revision_sources","designpro_stage_receipts","designpro_artifacts","designpro_vehicle_dimensions"]);
for(const table of tables) assert.ok(allowedTables.has(table),`claimant reads forbidden table ${table}`);
for(const forbidden of ["workforce_runs","workflow_stage_runs","panelizer_jobs","color_visualizations","design_version_commits","designiq_generations","designpro_entice_packs","designpro_production_jobs","production_flow_assets","production_panel_dispatches","user_roles","railway"])
  assert.ok(!lower.includes(forbidden),`claimant retains legacy/shared surface ${forbidden}`);
for(const rpc of ["claim_designpro_stage","heartbeat_designpro_stage","complete_designpro_stage","fail_designpro_stage","bind_designpro_entice_manifest","finalize_designpro_entice_identity","request_designpro_human_gate"])
  assert.ok(lower.includes(rpc),`claimant missing RPC ${rpc}`);
for(const leaseArg of ["p_stage_id","p_lease_token"]) assert.ok(lower.includes(leaseArg),`claimant missing lease fence ${leaseArg}`);
for(const stage of ["revision.freeze","manifest.resolve","proof.build","panels.build","logos.extract","pack.verify","pack.activate","source.verify","await_panelpro_preflight_qc","output.build","output.verify","await_final_human_qc","stamp.build","zip.build","wrapbox.deliver"])
  assert.ok(lower.includes(stage),`claimant missing stage ${stage}`);
for(const receipt of ["views.seven-source","call8.flat-proof","call9.surface-panels","call10.logo-inventory","output.verified","stamp","zip","wrapbox.delivery"])
  assert.ok(lower.includes(receipt),`claimant missing receipt ${receipt}`);
for(const artifact of ["flat-proof","panel","logo","output","stamp","zip","wrapbox-manifest"])
  assert.ok(lower.includes(artifact),`claimant missing artifact ${artifact}`);
assert.ok(lower.includes("verifiedby"),"stamp must use server-derived final-QC identity");
assert.ok(lower.includes("ziphash"),"WrapBox receipt must bind exact ZIP hash");
assert.ok(!lower.includes("approve_designpro_human_gate"),"claimant must never self-approve a human gate");
for(const exactField of ["viewreceipts","viewlineage","dimensionmanifestid","manifesthash","totalsqft","surfacesqft","trimdimensions"])
  assert.ok(lower.includes(exactField),`claimant is not aligned to schema field ${exactField}`);
for(const edge of ["top: 5","right: 5","bottom: 5","left: 5"])
  assert.ok(lower.includes(edge),`claimant does not bind exact ${edge} bleed`);
assert.match(lower,/metadata:\s*\{\s*sourceregionhash:[\s\S]{0,400}bleed:\s*\{\s*top:\s*5,\s*right:\s*5,\s*bottom:\s*5,\s*left:\s*5\s*\}/,
  'panel artifact metadata must bind four-edge bleed, not only manifest-level bleed');
console.log("standalone claimant matches all schema lease, receipt, artifact and human-gate contracts");
