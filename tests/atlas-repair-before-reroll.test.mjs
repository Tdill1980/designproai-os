// A CUT-OUT MUST NEVER CONSUME AN AUTHORING ATTEMPT — AND NEITHER MUST A JUDGE
// CYCLE. (Trish 2026-08-27.)
//
// FIRST FORM OF THIS LOCK. The judge decided acceptance, so a cut-out could only
// avoid costing a re-roll by being filled and RE-JUDGED inside the loop. That
// worked, and it still cost a whole Flash round-trip per repair. Live: canary
// 6c1bfae6 refused every attempt for "one wheel/glass/bed shape cut out of the
// panel" on driver AND passenger bundled with upside-down hood text; a3e15054
// then spent 180 seconds on ONE attempt — image, judge, compose, judge, fill,
// judge — and showed the customer a failure page at the end of it.
//
// SECOND FORM, WHICH IS THIS ONE. The owner's directive removed the judge from
// the customer's critical path entirely: "Do deterministic master validation
// immediately … don't make the customer wait for Flash to philosophically judge
// the artwork before starting Driver. If semantic QC finds something
// catastrophic, flag the job."
//
// So the original intent is now satisfied more strongly than the old mechanism
// could: a cut-out cannot consume an authoring attempt because acceptance never
// consults the judge at all. What this file locks is that the deterministic gate
// really is the gate, that the two repairs still happen before any re-roll, and
// that the judge's verdict is still COLLECTED and still FLAGS — because a
// non-blocking check that nobody records is just a check that was deleted.
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
const afterLoop = source.slice(source.indexOf("const masterStoragePath = atlasStoragePath"));

test("the gate is deterministic — acceptance never consults the judge", () => {
  // The decision to keep or re-roll reads pixel measurements only.
  assert.match(loop, /const stillBlocking = deterministic\.blockingFailures \|\| \[\];/);
  assert.match(loop, /if \(!stillBlocking\.length\) break;/);
  assert.match(loop, /deterministicMasterChecks\(masterBytes, manifest\)/);
  // And nothing in the loop turns the judge's verdict into an accept/reject.
  assert.ok(
    !/masterQc\?\.accepted === true/.test(loop),
    "acceptance must not read the semantic verdict",
  );
  assert.ok(
    !/atlas_master_qc_semantic_failed/.test(loop),
    "the loop must not branch on a semantic failure code",
  );
});

test("the judge is dispatched the moment the master exists, and awaited nowhere on the fast path", () => {
  const dispatch = loop.indexOf("semanticQc = Promise.resolve()");
  const gate = loop.indexOf("const stillBlocking");
  assert.ok(dispatch > 0, "the semantic pass is dispatched inside the loop");
  assert.ok(dispatch < gate, "it is dispatched before the gate, not after it");
  // Exactly one place may await it: the passenger composition, which needs the
  // measured lettering bands and only runs on a master already known to be
  // wrong. Any other await would put Flash back on the customer's clock.
  const awaits = loop.match(/await semanticQc/g) || [];
  assert.equal(awaits.length, 1, "only the lettering-band path may await the judge");
  const bandWait = loop.indexOf("const bandVerdict = await semanticQc;");
  assert.ok(bandWait > 0);
  assert.ok(
    loop.slice(0, bandWait).includes("if (mirrorFailed(deterministic)) {"),
    "the single await is guarded by the deterministic mirror measurement",
  );
});

test("a rejected in-flight promise can never take the worker down", () => {
  // A detached promise with no synchronous consumer is an unhandled rejection.
  // The catch is attached at creation, both times it is created.
  const creations = loop.match(/semanticQc = Promise\.resolve\(\)/g) || [];
  assert.equal(creations.length, 2, "created for the authored master and again after composition");
  const guards = loop.match(/\.catch\(\(cause\) => \(\{/g) || [];
  assert.equal(guards.length, creations.length, "every creation attaches its own catch");
});

test("the passenger flank is composed, and the re-measure decides whether it worked", () => {
  assert.match(loop, /mirrorPassengerFromDriver\(\{\s*\n?\s*masterBytes, manifest, brandBands: bands,/);
  assert.match(loop, /const composedChecks = await deterministicMasterChecks\(mirrored\.bytes, manifest\)/);
  assert.match(loop, /if \(!mirrorFailed\(composedChecks\)\)/);
  // Composing replaces the master, so the judge must be re-dispatched against
  // what will actually be persisted — otherwise the recorded review describes
  // bytes nobody kept.
  assert.ok(
    loop.indexOf("semanticQc = Promise.resolve()", loop.indexOf("flat_atlas_passenger_flank_composed")) > 0,
    "the judge is re-dispatched after composition",
  );
});

test("the surfaces that arrived holed are still recorded for human QC", () => {
  // Repairing them silently would hide a print defect from PanelPro's template
  // check. The classification comes from the deterministic findings now.
  assert.match(loop, /masterCutoutSurfaces = cutoutSurfacesOf\(deterministic\)/);
  assert.match(loop, /masterCutoutFindings = \(deterministic\.cutoutFindings \|\| \[\]\)/);
});

test("a still-refused candidate spends the retry on the deterministic finding", () => {
  // The corrective note must name what actually refused the sheet, which is now
  // the pixel measurement rather than a model's prose.
  assert.match(loop, /const refusalReason = stillBlocking\.join\("; "\)/);
  assert.match(loop, /flat_atlas_master_deterministic_failed/);
});

test("the authored master is never mutated", () => {
  // masterBytes stays the lineage identity; every repair works on a copy. The
  // composed flank is the one sanctioned replacement and it re-hashes.
  assert.ok(!/masterBytes = trialFill/.test(loop), "the authored bytes must never be replaced by a fill");
  assert.ok(!/masterBytes = repairedBytes/.test(loop), "the authored bytes must never be replaced by a fill");
  assert.match(loop, /masterBytes = mirrored\.bytes;\s*\n\s*masterHash = composedHash;/);
});

// ── THE VERDICT IS STILL COLLECTED, AND IT STILL FLAGS ─────────────────────
//
// Off the critical path must not mean discarded. The owner's directive says
// "flag the job", so the review reaches the immutable revision and a
// catastrophic verdict joins the surfaces PanelPro's human QC must inspect.

test("the verdict is collected after the panels are cut, not before", () => {
  const panels = afterLoop.indexOf("cutCallOnePanels(surfaceSourceBytes");
  const collect = afterLoop.indexOf("const semanticVerdict = semanticQc ? await semanticQc : null;");
  assert.ok(panels > 0 && collect > 0);
  assert.ok(collect > panels, "the judge overlaps the panel cut instead of preceding it");
});

test("a verdict graded against superseded bytes is discarded, never recorded", () => {
  assert.match(afterLoop, /semanticVerdict\.metadata\.masterHash === masterHash/);
  assert.match(afterLoop, /semanticVerdict\.metadata\.masterHash === semanticQcMasterHash/);
  assert.match(afterLoop, /semanticVerdict\.metadata\.guideHash === guideHash/);
  assert.match(afterLoop, /const masterQc = semanticBound \? semanticVerdict : null;/);
});

test("a catastrophic verdict flags the surfaces instead of destroying the design", () => {
  assert.match(afterLoop, /const semanticFlagged = masterQc && masterQc\.accepted !== true;/);
  assert.match(afterLoop, /masterCutoutSurfaces = judged;/);
  assert.match(afterLoop, /semantic review \(non-blocking, recorded for human QC\)/);
  assert.match(afterLoop, /flat_atlas_master_semantic_flagged/);
  // It must not raise. The design ships and a human looks at the panels.
  const flagStart = afterLoop.indexOf("if (semanticFlagged) {");
  const flagEnd = afterLoop.indexOf("flat_atlas_master_semantic_flagged");
  assert.ok(flagStart > 0 && flagEnd > flagStart);
  const flagBlock = afterLoop.slice(flagStart, flagEnd);
  assert.ok(!/throw /.test(flagBlock), "a semantic verdict must never throw");
});

test("the revision records what decided acceptance and what the judge said", () => {
  assert.match(afterLoop, /masterAcceptance: "deterministic"/);
  assert.match(afterLoop, /masterSemanticVerdict:/);
  assert.match(afterLoop, /masterSemanticBlocking: false/);
  // The deterministic measurements are always present, because they are the gate.
  assert.match(afterLoop, /masterQcDeterministic: masterQc\?\.deterministic \|\| masterDeterministic/);
});

test("click -> master is measured in segments on the immutable revision", () => {
  assert.match(source, /const callOneStartedAt = Date\.now\(\);/);
  assert.match(source, /timings\.authoringMs \+= Date\.now\(\) - authoringStartedAt;/);
  assert.match(source, /timings\.deterministicMs \+= Date\.now\(\) - deterministicStartedAt;/);
  assert.match(afterLoop, /callOneTimings: \{/);
  assert.match(afterLoop, /semanticOverlapped: timings\.semanticWaitMs === 0/);
});

// ── THE VERDICT MUST STILL CARRY WHAT THE REPAIR NEEDS ─────────────────────
//
// The lettering bands ride on the semantic return. If that return stops
// reporting them, the passenger composition silently flops the text backward —
// the exact defect cad013e1 reported — so this stays locked even though the
// verdict no longer gates anything.
const qcSource = readFileSync(join(ROOT, "runtime/atlas-master-qc.cjs"), "utf8");
const semanticReturn = qcSource.slice(
  qcSource.indexOf("if (rejection && !coverageFailedOnClassifiedCutoutsOnly"),
  qcSource.indexOf("if (!rejection && !cutoutSurfaces.length"),
);

test("a fatal semantic verdict still reports its metadata, bands and classified cut-outs", () => {
  assert.match(semanticReturn, /code: "atlas_master_qc_semantic_failed"/);
  // Without metadata the caller's contract/hash check fails and the verdict is
  // discarded as unbound.
  assert.match(semanticReturn, /reason: rejection\.reason, review, deterministic, metadata/);
  // The lettering bands the passenger composition re-drops un-flipped.
  assert.match(semanticReturn, /brandBands: brandBandsOf\(review\)/);
  // And the repairable half is named.
  assert.match(semanticReturn, /cutout: \{ surfaces: cutoutSurfaces, findings, semantic: semanticCutout \}/);
});

test("the verdict stays fatal by code — reporting cut-outs does not accept it", () => {
  assert.match(semanticReturn, /accepted: false/);
  assert.ok(!/accepted: true/.test(semanticReturn), "a semantic refusal must never report accepted");
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
