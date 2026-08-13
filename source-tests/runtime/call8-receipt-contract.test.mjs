// complete_designpro_stage's Call 8 branch pins several receipt fields to
// frozen literals. They are not labels: a single character off and the RPC
// rejects the finished stage with call8_flat_proof_contract_failed, after the
// layout has been authored, cut and uploaded — so the work is done and thrown
// away, and the error names no field.
//
// That is exactly how proofKind drifted. bca6fc8 rewrote the runtime's Call 8
// receipt and changed proofKind to "2d-production-proof" while the SQL contract
// kept requiring "flattened-2d-proof". Nothing failed at build time because the
// two live in different languages in different directories.
//
// This test reads the literals out of the migration and asserts the claimant
// sends them, so either side moving alone fails here instead of in production.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const claimant = await readFile(fileURLToPath(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url)), "utf8");
const workflowSql = await readFile(fileURLToPath(new URL("../../supabase/migrations/20260806180100_designpro_workflow_rpcs.sql", import.meta.url)), "utf8");

// The Call 8 branch only — the neighbouring branches pin their own literals for
// their own stages, and matching those here would prove nothing about Call 8.
function call8ContractBranch() {
  const start = workflowSql.indexOf("ELSIF v_stage.stage_key='proof.build' THEN");
  assert.ok(start > 0, "the workflow RPC must still carry a proof.build branch");
  const end = workflowSql.indexOf("ELSIF v_stage.stage_key=", start + 1);
  assert.ok(end > start, "the proof.build branch must be delimited by the next branch");
  return workflowSql.slice(start, end);
}

// The receipt object the claimant hands to complete() for proof.build.
function call8Receipt() {
  const anchor = claimant.indexOf('receiptKind: "call8.flat-proof"');
  assert.ok(anchor > 0, "the claimant must still send a call8.flat-proof receipt");
  return claimant.slice(claimant.lastIndexOf("complete(", anchor), claimant.indexOf("\n    }", anchor));
}

test("every frozen string literal in the Call 8 SQL contract is what the claimant sends", () => {
  const branch = call8ContractBranch();
  const receipt = call8Receipt();
  const pinned = [...branch.matchAll(/p_receipt->>'([A-Za-z]+)'<>'([^']+)'/g)];
  assert.ok(pinned.length >= 2, "expected the Call 8 contract to pin string fields");

  for (const [, field, required] of pinned) {
    assert.match(receipt, new RegExp(`${field}:\\s*"${required}"`), `the Call 8 contract requires ${field} = "${required}"`);
  }
});

test("every frozen numeric literal in the Call 8 SQL contract is what the claimant sends", () => {
  const branch = call8ContractBranch();
  const receipt = call8Receipt();
  const pinned = [...branch.matchAll(/\(p_receipt->>'([A-Za-z]+)'\)::(?:int|numeric)<>(\d+)/g)];
  assert.ok(pinned.length >= 2, "expected the Call 8 contract to pin numeric fields");

  for (const [, field, required] of pinned) {
    assert.match(receipt, new RegExp(`${field}:\\s*${required}\\b`), `the Call 8 contract requires ${field} = ${required}`);
  }
});

test("the Call 8 receipt carries every field the contract dereferences", () => {
  const branch = call8ContractBranch();
  const receipt = call8Receipt();
  // Fields the contract reads but does not pin to a literal — a missing one
  // reads as NULL in SQL and fails the same opaque way.
  for (const field of new Set([...branch.matchAll(/p_receipt->>'([A-Za-z]+)'/g)].map((match) => match[1]))) {
    assert.match(receipt, new RegExp(`\\b${field}:`), `the Call 8 contract reads ${field}, so the receipt must carry it`);
  }
});
