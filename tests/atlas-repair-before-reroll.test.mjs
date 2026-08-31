// A CUT-OUT MUST NEVER CONSUME AN AUTHORING ATTEMPT, AND SUBJECTIVE SEMANTIC
// REVIEW MUST NEVER STALL OR TERMINATE THE DETERMINISTIC A.T.L.A.S. GRAPH.
//
// FIRST FORM OF THIS LOCK. The judge decided acceptance, so a cut-out could only
// avoid costing a re-roll by being filled and RE-JUDGED inside the loop. That
// worked, and it still cost a whole Flash round-trip per repair. Live: canary
// 6c1bfae6 refused every attempt for "one wheel/glass/bed shape cut out of the
// panel" on driver AND passenger bundled with upside-down hood text; a3e15054
// then spent 180 seconds on ONE attempt — image, judge, compose, judge, fill,
// judge — and showed the customer a failure page at the end of it.
//
// Semantic analysis remains available outside active Call 1 as advisory
// telemetry, but the release invariant is deterministic: container geometry,
// pixels, hashes and lineage. Call 1 makes no semantic call and waits on no
// reviewer. Passenger is its own authored region and is never rebuilt from
// Driver merely to satisfy a similarity score.
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

test("the release gate is deterministic and semantic review cannot refuse Call 1", () => {
  assert.match(loop, /const stillBlocking = deterministic\.blockingFailures \|\| \[\];/);
  assert.match(loop, /deterministicMasterChecks\(masterBytes, manifest\)/);
  assert.match(loop, /if \(!stillBlocking\.length\) \{\s*break;\s*\}/);
  assert.doesNotMatch(loop, /flat_atlas_master_semantic_failed/);
  assert.doesNotMatch(loop, /semanticVerdict = await semanticQc/);
});

test("active Call 1 never starts semantic analysis", () => {
  assert.doesNotMatch(loop, /startSemanticQc/);
  assert.doesNotMatch(loop, /createAtlasMasterValidator/);
  assert.doesNotMatch(loop, /await\s+validateMaster/);
});

test("Passenger is never manufactured from Driver in active Call 1", () => {
  assert.doesNotMatch(source, /require\("\.\/atlas-passenger-mirror\.cjs"\)/);
  assert.doesNotMatch(loop, /mirrorPassengerFromDriver/);
  assert.doesNotMatch(loop, /masterBytes\s*=\s*mirrored\.bytes/);
  assert.match(afterLoop, /passengerSource: "authored-passenger-region"/);
  assert.match(afterLoop, /passengerMirrorTelemetry: \{/);
  assert.match(afterLoop, /blocking: false/);
});

test("the surfaces that arrived holed are still recorded for human QC", () => {
  // Repairing them silently would hide a print defect from PanelPro's template
  // check. The classification comes from the deterministic findings now.
  assert.match(loop, /masterCutoutSurfaces = cutoutSurfacesOf\(deterministic\)/);
  assert.match(loop, /masterCutoutFindings = \(deterministic\.cutoutFindings \|\| \[\]\)/);
});

test("only a deterministic refusal can spend an authoring retry", () => {
  assert.match(loop, /const refusalReason = stillBlocking\.join\("; "\)/);
  assert.match(loop, /flat_atlas_master_deterministic_failed/);
  assert.doesNotMatch(loop, /flat_atlas_master_semantic_failed/);
});

test("the authored master is never mutated", () => {
  // masterBytes stays the lineage identity; the cut-out fill works on a copy
  // and Passenger's authored pixels are never substituted with Driver.
  assert.ok(!/masterBytes = trialFill/.test(loop), "the authored bytes must never be replaced by a fill");
  assert.ok(!/masterBytes = repairedBytes/.test(loop), "the authored bytes must never be replaced by a fill");
  assert.doesNotMatch(loop, /masterBytes\s*=\s*mirrored\.bytes/);
});

// ── NOTHING IS RELEASED BEFORE DETERMINISTIC ACCEPTANCE ─────────────────────

test("the deterministic gate precedes master and panel publication", () => {
  const acceptance = loop.indexOf("if (!stillBlocking.length)");
  const panels = afterLoop.indexOf("cutCallOnePanels(surfaceSourceBytes");
  assert.ok(acceptance > 0 && panels > 0);
  assert.match(afterLoop, /await persistImmutableAssets\(\);/);
  assert.match(afterLoop, /const persistImmutableAssets = \(\) => Promise\.all\(\[/);
});

test("every binding the write batch closes over is declared before it runs", () => {
  // THE LOCK ABOVE IS TEXT, AND TEXT CANNOT SEE A TEMPORAL DEAD ZONE.
  //
  // Hoisting the batch out of its old site moved its INVOCATION thirty lines
  // earlier while `const projectionStoragePath = ...` stayed where it was --
  // so `persistImmutableAssets()` ran, reached a `const` that had not been
  // evaluated yet, and would have thrown ReferenceError on the first real
  // generation. The regex above matched happily throughout, because the two
  // strings it asserts were both exactly right.
  //
  // So this reads the ORDER instead of the words: every `const`/`let` in this
  // file that the batch body names must be declared on a line before the line
  // that calls it.
  const defLine = afterLoop.split("\n")
    .findIndex((line) => line.includes("const persistImmutableAssets = () => Promise.all(["));
  const callLine = afterLoop.split("\n")
    .findIndex((line) => line.includes("await persistImmutableAssets();"));
  assert.ok(defLine >= 0 && callLine > defLine, "the batch must be defined before it is called");

  const lines = afterLoop.split("\n");
  const body = lines.slice(defLine, lines.findIndex((line, i) => i > defLine && /^  \]\);$/.test(line)) + 1)
    .join("\n");
  const named = new Set(body.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []);

  const declaredAt = new Map();
  lines.forEach((line, i) => {
    const hit = /^\s*(?:const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/.exec(line);
    if (hit && !declaredAt.has(hit[1])) declaredAt.set(hit[1], i);
  });

  const dead = [...declaredAt].filter(([name, at]) => named.has(name) && at > callLine && at !== defLine);
  assert.deepEqual(
    dead.map(([name]) => name), [],
    `these bindings are read by the write batch but declared after it runs: ${dead.map(([n]) => n).join(", ")}`,
  );
});

test("an absent semantic verdict is never claimed as final-master acceptance", () => {
  assert.match(afterLoop, /semantic_qc_advisory_not_run/);
  assert.doesNotMatch(afterLoop, /masterAcceptance: "semantic"/);
});

test("deterministic cut-out findings carry into repair", () => {
  assert.match(loop, /masterCutoutSurfaces = cutoutSurfacesOf\(deterministic\)/);
  assert.match(afterLoop, /fillMasterCutouts\(masterBytes, manifest, masterCutoutSurfaces\)/);
});

test("the revision records what decided acceptance and what the judge said", () => {
  assert.match(afterLoop, /masterAcceptance: "deterministic"/);
  assert.match(afterLoop, /masterSemanticVerdict:/);
  assert.match(afterLoop, /masterSemanticBlocking: false/);
  assert.match(afterLoop, /masterQcDeterministic: masterDeterministic/);
});

test("click -> master is measured in segments on the immutable revision", () => {
  assert.match(source, /const callOneStartedAt = Date\.now\(\);/);
  assert.match(source, /timings\.authoringMs \+= Date\.now\(\) - authoringStartedAt;/);
  assert.match(source, /timings\.deterministicMs \+= Date\.now\(\) - deterministicStartedAt;/);
  assert.match(afterLoop, /callOneTimings: \{/);
  assert.match(afterLoop, /semanticOverlapped: timings\.semanticWaitMs === 0/);
});

// ── THE ADVISORY MODULE KEEPS ITS DIAGNOSTIC RESPONSE SHAPE ────────────────
//
// Active Call 1 does not invoke this module. Operator diagnostics can still use
// its bound metadata, classified cut-outs and measurements without granting it
// permission to mutate the A.T.L.A.S. authority.
const qcSource = readFileSync(join(ROOT, "runtime/atlas-master-qc.cjs"), "utf8");
const semanticReturn = qcSource.slice(
  qcSource.indexOf("if (rejection && !coverageFailedOnClassifiedCutoutsOnly"),
  qcSource.indexOf("if (!rejection && !cutoutSurfaces.length"),
);

test("an advisory diagnostic result still reports bound metadata and classified cut-outs", () => {
  assert.match(semanticReturn, /code: "atlas_master_qc_semantic_failed"/);
  // Without metadata the caller's contract/hash check fails and the verdict is
  // discarded as unbound.
  assert.match(semanticReturn, /reason: rejection\.reason, review, deterministic, metadata/);
  // Retained as diagnostic data; active Call 1 does not consume it as a repair.
  assert.match(semanticReturn, /brandBands: brandBandsOf\(review\)/);
  // And the repairable half is named.
  assert.match(semanticReturn, /cutout: \{ surfaces: cutoutSurfaces, findings, semantic: semanticCutout \}/);
});

test("the verdict stays fatal by code — reporting cut-outs does not accept it", () => {
  assert.match(semanticReturn, /accepted: false/);
  assert.ok(!/accepted: true/.test(semanticReturn), "a semantic refusal must never report accepted");
});

// ── THE GATE AND THE RUNNER MUST READ THE SAME BASIS ───────────────────────
//
// Taking the judge off the critical path left its CONFIDENCE gating in TWO
// places, and fixing one did not fix the other:
//
//   * designpro_private.flat_first_atlas_view_set_valid (database)
//   * assertAtlasViewLineage (runtime/generation-worker.cjs)
//
// Live: canary 1a424bf5 died at the database copy (10:01), and after that was
// patched canary 4efeda23 died at the runtime copy (10:29) -- Call 1 finished in
// 91 seconds with an accepted master and ZERO proofs rendered. Same defect,
// twice, an hour apart.
//
// CLAUDE.md names this exact class: "the DB gate must learn <the contract> in
// the same cutover as the runtime that emits it -- runner and gate may not
// diverge across a customer-visible window again."
const worker = readFileSync(join(ROOT, "runtime/generation-worker.cjs"), "utf8");
const lineage = worker.slice(
  worker.indexOf("function assertAtlasViewLineage"),
  worker.indexOf("const byView = new Map();"),
);

test("the runtime lineage gate preserves semantic-confidence acceptance", () => {
  assert.match(lineage, /masterAcceptance\.basis === "deterministic"/);
  assert.match(lineage, /gatedDeterministically \|\| gatedBySemanticConfidence/);
  assert.match(lineage, /masterAcceptance\.confidence >= 0\.92/);
});

test("the basis actually reaches the gate from the persisted revision", () => {
  // assertAtlasViewLineage reads flatAtlas.masterAcceptance, which rowIdentity
  // builds from the revision metadata. If the field is not carried across, the
  // gate silently falls back to the confidence branch and the fix is inert.
  assert.match(source, /basis: row\.metadata\?\.masterAcceptance \|\| null,/);
  assert.match(afterLoop, /masterAcceptance: "deterministic"/);
});
