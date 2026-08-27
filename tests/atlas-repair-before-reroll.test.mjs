// A CUT-OUT MUST NEVER CONSUME AN AUTHORING ATTEMPT. (Trish 2026-08-27)
//
// The existing `cutoutOnly` branch fires only when cut-outs are the ONLY
// finding. When the judge BUNDLES a cut-out with a real creative defect the
// code is `atlas_master_qc_semantic_failed`, and the whole candidate was
// discarded unrepaired.
//
// Live cost, canary 6c1bfae6: every attempt was refused for "one
// wheel/glass/bed shape cut out of the panel" on driver AND passenger together
// with upside-down hood text — three throws, when the holes were repairable
// deterministically each time and only the text was worth another one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const source = readFileSync(join(ROOT, "runtime/flat-first-atlas.cjs"), "utf8");
const loop = source.slice(
  source.indexOf("for (let attempt = 1; attempt <= maxAuthoringAttempts"),
  source.indexOf("const masterStoragePath = atlasStoragePath"),
);

test("a bundled cut-out is filled and re-judged before any retry is spent", () => {
  assert.match(loop, /REPAIR BEFORE YOU RE-ROLL/);
  // The fill runs on the candidate, inside the loop, not only after it.
  assert.match(loop, /const trialFill = await fillMasterCutouts\(masterBytes, manifest, bundledCutouts\)/);
  // …and the REPAIRED candidate is what gets judged.
  assert.match(loop, /const repairedQc = await validateMaster\(\{\s*masterBytes: repairedBytes/);
  // A repaired candidate that passes is KEPT — no further authoring call.
  assert.match(loop, /if \(repairedQc\?\.accepted === true && repairedBound\)/);
  assert.match(loop, /flat_atlas_master_repaired_then_accepted/);
});

test("the repaired verdict is bound to the repaired bytes, not the authored ones", () => {
  // Binding the verdict to the wrong hash is how a stale acceptance slips
  // through; the existing contract check is reused against repairedHash.
  assert.match(loop, /const repairedHash = sha256\(repairedBytes\)/);
  assert.match(loop, /repairedQc\.metadata\.masterHash === repairedHash/);
  assert.match(loop, /repairedQc\.metadata\.guideHash === guideHash/);
});

test("the surfaces that arrived holed are still recorded for human QC", () => {
  // Repairing them silently would hide a print defect from PanelPro's template
  // check. masterCutoutSurfaces still carries them into the revision.
  assert.match(loop, /masterCutoutSurfaces = bundledCutouts/);
});

test("a still-refused candidate spends the retry on what actually remains", () => {
  // The corrective note must describe the repaired candidate, not a hole that
  // has already been closed.
  assert.match(loop, /if \(repairedBound\) masterQc = repairedQc;/);
  assert.match(loop, /const refusalReason = String\(masterQc\?\.reason/);
});

test("the authored master is never mutated", () => {
  // masterBytes stays the lineage identity; the fill always works on a copy.
  assert.ok(!/masterBytes = trialFill/.test(loop), "the authored bytes must never be replaced by the repair");
  assert.ok(!/masterBytes = repairedBytes/.test(loop), "the authored bytes must never be replaced by the repair");
});

// ── THE VERDICT MUST CARRY WHAT THE REPAIR NEEDS ───────────────────────────
//
// The loop fix above is unreachable unless the QC verdict reports BOTH its
// binding metadata and its classified cut-outs. The semantic-failure return
// carried neither, which is why canaries 6c1bfae6 and cad013e1 each burned all
// three attempts on a repairable hole bundled with a text defect.
const qcSource = readFileSync(join(ROOT, "runtime/atlas-master-qc.cjs"), "utf8");
const semanticReturn = qcSource.slice(
  qcSource.indexOf("if (rejection && !coverageFailedOnClassifiedCutoutsOnly"),
  qcSource.indexOf("if (!rejection && !cutoutSurfaces.length"),
);

test("a fatal semantic verdict still reports its metadata and classified cut-outs", () => {
  assert.match(semanticReturn, /code: "atlas_master_qc_semantic_failed"/);
  // Without metadata the caller's contract/hash check fails and the repair is
  // skipped even when cut-outs are present.
  assert.match(semanticReturn, /reason: rejection\.reason, review, deterministic, metadata/);
  // And the repairable half is named.
  assert.match(semanticReturn, /cutout: \{ surfaces: cutoutSurfaces, findings, semantic: semanticCutout \}/);
});

test("the verdict stays fatal by code — reporting cut-outs does not accept it", () => {
  assert.match(semanticReturn, /accepted: false/);
  assert.ok(!/accepted: true/.test(semanticReturn), "a semantic refusal must never report accepted");
});
