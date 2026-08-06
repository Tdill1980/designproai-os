import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
const sql=readFileSync(join(dirname(fileURLToPath(import.meta.url)),"../migrations/20260806180100_designpro_workflow_rpcs.sql"),"utf8").toLowerCase();
for(const gate of ["call8_proof_artifact_required","call9_panel_artifact_set_incomplete","verified_output_artifact_required","finalized_entice_identity_required","verified_entice_pack_required_for_activation","final_qc_and_stamp_artifact_required","stamp_receipt_and_zip_artifact_required","exact_zip_and_wrapbox_manifest_required"])
  assert.ok(sql.includes(gate),`missing artifact-chain failure ${gate}`);
assert.ok(sql.includes("receipt_kind='final.human-qc'"));
assert.ok(sql.includes("receipt_kind='zip' and z.receipt_hash=lower(p_receipt->>'ziphash')"));
assert.ok(sql.includes("a->>'kind'='wrapbox-manifest'"));
assert.ok(sql.includes("if v_stage.stage_key in ('source.verify','output.verify')"),"completion must atomically open human gate");
assert.ok(sql.includes("required_human_gate_missing_or_already_transitioned"));
console.log("Call 7/8 and final artifact chain is database enforced");
