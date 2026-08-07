import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const sql=readFileSync(join(root,"supabase/migrations/20260806180400_designpro_progressive_identity.sql"),"utf8").toLowerCase();
const blockers=JSON.parse(readFileSync(join(root,"source-tests/contracts/standalone-refactor-blockers.json"),"utf8"));
for(const object of ["designpro_revision_sources","bind_designpro_entice_manifest","finalize_designpro_entice_identity","create_designpro_production_workflow"])
  assert.ok(sql.includes(`public.${object}`),`schema-side blocker unresolved: ${object}`);
for(const required of ["revision_snapshot_hash","genieverified","expectedsurfaces","surfaceSqFt".toLowerCase(),"totalSqFt".toLowerCase(),"verified_seven_views_call8_call9_call10_receipts_required","derived_identity_hash_mismatch","sourceenticerunid"])
  assert.ok(sql.includes(required),`progressive identity contract missing ${required}`);
for(const forbidden of ["color_visualizations","design_version_commits","designiq_generations","panelizer_jobs","production_flow_assets","user_roles","railway","restyle"])
  assert.ok(!sql.includes(forbidden),`irreducible/shared surface leaked into target schema: ${forbidden}`);
assert.equal(blockers.contract,"designpro.standalone-refactor-closure.v3");
assert.equal(blockers.decision,"release-candidate");
assert.deepEqual(blockers.remainingLegacyTables,[]);
assert.deepEqual(blockers.remainingLegacyRpcs,[]);
assert.ok(sql.includes("workflow_type='designpro.production_pack' and dimension_manifest_id is not null"),"production identity must remain fully pinned");
assert.ok(sql.includes("old.dimension_manifest_id is not null"),"bound progressive identity needs immutable CAS guard");
assert.ok(sql.includes("v_derived_manifest:=encode(extensions.digest(convert_to(p_manifest::text,'utf8'),'sha256'),'hex')"));
assert.ok(sql.includes("nullif(btrim(coalesce(p_manifest_hash,'')),'') is not null"),"manifest client hash must be optional");
assert.ok(sql.includes("nullif(btrim(coalesce(p_artifact_set_hash,'')),'') is not null"),"artifact client hash must be optional");
assert.ok(sql.includes("nullif(btrim(coalesce(p_source_contract_hash,'')),'') is not null"),"source-contract client hash must be optional");
assert.ok(sql.includes("'dimensionmanifest',v_entice.results->'dimensionmanifest'"),"production must receive server-bound GENIE manifest");
console.log("schema-side progressive identity closure: zero irreducible surfaces");
