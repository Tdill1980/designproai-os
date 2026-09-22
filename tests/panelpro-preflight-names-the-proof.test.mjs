/**
 * THE PANELPRO PREFLIGHT NAMES THE PRODUCTION PANEL PROOF -- the four layers
 * agree on the three keys, the control room asks them beside the evidence, and
 * no surface offers a preflight control that cannot complete the gate.
 *
 * Owner (2026-09-22): "must send production panel proof and its assets to
 * panel pro studio / For processing and qc." Measured in
 * docs/PANEL-PROOF-TO-PANELPRO.md: the assets reached the board and the ZIP;
 * no QC check named them; and two of the three preflight controls submitted a
 * payload the gateway refuses on every click.
 *
 * The database branch itself runs on PGlite in
 * tests/designpro-preflight-names-the-proof-db.test.mjs. This file is the
 * source contract across the gateway, the app and the two dead controls.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const gateway = read("../gateway/src/server.mjs");
const stages = read("../app/src/lib/designpro-stages.ts");
const api = read("../app/src/lib/designpro-api.ts");
const controlRoom = read("../app/src/pages/AdminGeminiCompareStudio.tsx");
const board = read("../app/src/pages/designpro/PanelProStudioBoard.tsx");
const workflow = read("../app/src/pages/designpro/ProductionWorkflow.tsx");
const proofSheet = read("../app/src/components/designpanelpro/AtlasPanelProofSheet.tsx");
const migration = read("../supabase/migrations/20260922130000_designpro_preflight_names_the_proof.sql");

const KEYS = ["proofSheetReviewed", "cleanPanelsMatchBranded", "cutGraphicsInventoried"];

function at(haystack, needle, label) {
  const index = haystack.indexOf(needle);
  assert.notEqual(index, -1, `${label}: expected to find ${JSON.stringify(needle)}`);
  return index;
}

test("the three proof attestations are one key set on every layer", () => {
  // The gateway forwards them; the app lists them; the API type carries them;
  // the migration requires them. Any layer drifting from the set makes a
  // reviewer's signature silently vanish somewhere between the box and the row.
  const gatewayList = gateway.match(/const PROOF_CHECKS = \[([^\]]+)\]/);
  assert.ok(gatewayList, "gateway declares PROOF_CHECKS");
  assert.deepEqual(gatewayList[1].match(/"([A-Za-z]+)"/g).map((s) => s.replace(/"/g, "")), KEYS);
  const stageList = stages.slice(at(stages, "export const PROOF_CHECKS", "stages PROOF_CHECKS"));
  // A label may be a plain string or a template that reads the product's name from PROOF_BRAND.
  for (const key of KEYS) assert.match(stageList.slice(0, 900), new RegExp(`\\["${key}", [\`"]`), `stages lists ${key} with a label`);
  for (const key of KEYS) assert.match(api, new RegExp(`${key}\\?: boolean`), `PreflightQc carries ${key}`);
  for (const key of KEYS) assert.match(migration, new RegExp(`"${key}":true`), `the migration requires ${key}`);
});

test("the gateway forwards a signed attestation, refuses an unsigned one, and never fabricates one", () => {
  const fn = gateway.slice(at(gateway, "function exactQc", "exactQc"), at(gateway, "function approvalRef", "approvalRef"));
  assert.match(fn, /for \(const key of PROOF_CHECKS\)/);
  assert.match(fn, /if \(!\(key in qc\)\) continue;/, "absent is omitted, not invented");
  assert.match(fn, /if \(qc\[key\] !== true\) return null;/, "present-but-false is a refusal");
  assert.match(fn, /\.\.\.proofChecks,/, "the signed ones ride on the receipt");
  assert.doesNotMatch(fn, /PROOF_CHECKS\.map\(\(key\) => \[key, true\]\)/, "never all-true by construction");
});

test("the migration is a text patch of the live body, conditional on the frozen snapshot", () => {
  assert.match(migration, /pg_get_functiondef\(to_regprocedure\('public\.approve_designpro_human_gate\(uuid,text,uuid,text,jsonb\)'\)\)/);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION/, "never re-emits the function (it would revert 20260908193134)");
  assert.match(migration, /jsonb_typeof\(v_source\.snapshot->'panelProofAuthoring'\)='object'/, "the condition is the snapshot's own proof, never a flag");
  assert.match(migration, /IS DISTINCT FROM 1\s*\n\s*THEN RAISE EXCEPTION 'preflight_proof_gate_unexpected_approval_contract'/, "the anchor must occur exactly once");
  assert.match(migration, /v_after:=pg_get_functiondef/, "the produced body is read back");
  assert.match(migration, /panelpro_proof_evidence_incomplete/);
});

test("the control room asks the three attestations inside the Production Pack card, beside the proof's own evidence", () => {
  const section = controlRoom.slice(at(controlRoom, "function ProductionPackSection", "pack section"), at(controlRoom, "function ZipContentsCard", "zip card"));
  const attest = controlRoom.slice(at(controlRoom, "function ProofSourceAttestations", "attestations"), at(controlRoom, "function ProductionPackSection", "pack section"));
  // Rendered from the shared list, under the six, above the notes.
  assert.match(attest, /PROOF_CHECKS\.map\(\(\[key, label\]\)/);
  const six = at(section, "PREFLIGHT_CHECKS.map", "the six");
  const proof = at(section, "<ProofSourceAttestations", "the proof block");
  const notes = at(section, "placeholder=\"What you checked on the vehicle template\"", "notes");
  assert.ok(six < proof && proof < notes, "six attestations, then the proof, then the notes");
  // Evidence beside each box, from the proof itself: the sheet hash, the Zone 2
  // count, the Zone 3 inventory, and thumbnails of the assets being signed for.
  assert.match(attest, /useAtlasPanelProof\(requestId/, "reads the proof through the ONE reader");
  assert.match(proofSheet, /export function useAtlasPanelProof/, "the reader is the loader's own query, exported");
  assert.match(proofSheet, /const query = useAtlasPanelProof\(requestId, pollWhilePending\);/, "the sheet loader uses the same hook");
  assert.equal(proofSheet.split('queryKey: ["designpro-atlas-panel-proof"').length, 2, "one query key, declared once");
  assert.match(attest, /Sheet \$\{String\(proof\?\.sheet\?\.contentHash/, "sheet hash on the first row");
  assert.match(attest, /Zone 2 · \$\{clean\.length\} clean panels/, "Zone 2 count on the second row");
  assert.match(attest, /Zone 3 · \$\{cut\.length\} elements/, "Zone 3 inventory on the third row");
  assert.match(attest, /<img[\s\S]{0,200}src=\{panel\.signedUrl\}/, "thumbnails of the signed-for assets");
  // The gate on the button includes them, and only when the proof exists.
  assert.match(section, /const proofReady = !proofRequired \|\| PROOF_CHECKS\.every\(\(\[key\]\) => proofQc\[key\]\)/);
  assert.match(section, /&& proofReady\s*\n/, "the release button waits on them");
  assert.match(attest, /proof\.panelProof === false/, "absence is the read's POSITIVE answer, never a failed read");
  assert.match(attest, /data-testid="proof-attestations-not-required"/);
});

test("no submitter hard-codes a proof attestation as true", () => {
  // The six have been sent as literal `true` by the shortcut since before
  // this change; that is recorded, not repeated. The three about the proof
  // are a person's signature and travel only as ticked.
  for (const key of KEYS) {
    assert.doesNotMatch(controlRoom, new RegExp(`${key}:\\s*true`), `${key} is never a literal true in the control room`);
    assert.doesNotMatch(board, new RegExp(`${key}:\\s*true`));
    assert.doesNotMatch(workflow, new RegExp(`${key}:\\s*true`));
  }
  assert.equal(controlRoom.split("...tickedProofChecks(").length, 3, "both submitters send only the ticked ones");
  const shortcut = controlRoom.slice(at(controlRoom, "const buildPrintFiles = useCallback", "shortcut"), at(controlRoom, "const uploadToSide", "next fn"));
  assert.match(shortcut, /proofRequiredRef\.current/, "the shortcut stops when the proof is on this revision and unsigned");
  assert.match(shortcut, /Sign for the \$\{PROOF_BRAND\.full\} first/);
});

test("the two controls that always returned 400 no longer offer a submit they cannot complete", () => {
  // PanelProStudioBoard submitted `{ ...checks, approvedSides }` with no
  // per-surface checklist; ProductionWorkflow submitted the six keys alone.
  // exactQc refuses both before the RPC. Each now points at the control room.
  assert.doesNotMatch(board, /dpApi\.approvePreflight\(/, "the per-surface board does not submit the preflight");
  assert.doesNotMatch(workflow, /dpApi\.approvePreflight\(/, "the workflow page does not submit the preflight");
  assert.doesNotMatch(workflow, /<QcGate\s+gate="preflight"/, "the generic gate is not mounted for the preflight");
  assert.match(board, /to=\{`\/designpro\/jobs\/\$\{generationId\}\/panelpro`\}/, "the board links to the control room");
  assert.match(workflow, /to=\{`\/designpro\/jobs\/\$\{generationId\}\/panelpro`\}/, "the workflow page links to the control room");
  // The final gate on the workflow page was complete on its own and stays.
  assert.match(workflow, /<QcGate[\s\S]{0,240}gate="final"/);
  assert.match(board, /dpApi\.approveFinalQc\(/);
  // And the control room is the one place the preflight is submitted.
  assert.equal(controlRoom.split("dpApi.approvePreflight(").length, 3, "two submitters in the control room: the card and the shortcut");
});
