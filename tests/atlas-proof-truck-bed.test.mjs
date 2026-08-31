/**
 * NOTHING INSIDE THE TRUCK BED -- ON THE PROOF, AND NEVER ON THE MASTER.
 *
 * Owner, 2026-08-31, looking at the flat Flamingo A.T.L.A.S. master beside its
 * installed proof and the 2D Production Proof: "Like this but nothing inside
 * truck bed."
 *
 * That instruction lands on exactly one of the two halves, and CLAUDE.md
 * RULE 0.0 already says which:
 *
 *   "For pickups, exterior bed sides and tailgate receive the coordinated
 *    artwork; the bed floor and inner bed walls remain unwrapped under the
 *    DOWNSTREAM VEHICLE APPLICATION/PROOF COVERAGE CONTRACT. ... That exclusion
 *    never punches a hole into Call 1: all six source panels remain pure,
 *    opaque, uninterrupted, full-bleed rectangles."
 *
 * So this file locks BOTH directions, because getting either one backwards is a
 * real defect that has a name:
 *
 *   - the PROOF must carry the rule. It did not. The pinned photographer prompt
 *     says "Wrap covers painted body panels only. Windows, lights, wheels, trim
 *     stay factory." -- an open cargo bed is none of those four, so nothing in
 *     the A.T.L.A.S. proof words stopped artwork being painted down into one.
 *     The clause has existed in `view-angles-os.ts` since it was written and
 *     reaches design-panel-ai-generate and generate-color-render by import; the
 *     A.T.L.A.S. proof path was the one consumer that never took it.
 *
 *   - CALL 1 must NOT carry it. A bed exclusion in the authoring prompt is how
 *     you get a hole in a source rectangle, which RULE 0.15 calls a print
 *     defect and RULE 0.28 forbids outright: "a line drawn on the master prints
 *     as a line on the wrap."
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const url = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(url(p), "utf8");

const angles = read("../supabase/functions/_shared/view-angles-os.ts");
const photographerFn = read("../supabase/functions/persona-photographer-render/index.ts");
const photographerPrompt = read("../supabase/functions/_shared/persona-photographer-prompt.ts");
const provider = read("../runtime/designpanel-server-provider.cjs");
const call1 = read("../supabase/functions/design-panel-ai-generate/index.ts");

/** The atlas-proof branch only -- the hero path is a different, historical mode. */
function atlasProofBranch(source) {
  const start = source.indexOf("async function handleAtlasProof");
  assert.notEqual(start, -1, "the atlas-proof mode is gone");
  return source.slice(start);
}

test("the pinned coverage block still carries the clause the proof slices out", () => {
  // The slice in the edge function throws on a miss rather than silently
  // dropping the rule, but a throw only surfaces at module load in production.
  // Assert it here so a pin edit fails in CI instead of on a live proof.
  const line = angles
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("TRUCK BED:"));
  assert.ok(line, "view-angles-os no longer carries the TRUCK BED clause the proof depends on");
  assert.match(line, /bed interior stays bare factory bedliner/);
});

test("the pinned photographer prompt does NOT cover an open bed on its own", () => {
  // This is the measurement that made the fix necessary, kept as a test so the
  // reasoning cannot be lost. `persona-photographer-prompt.ts` is byte-pinned
  // by RULE 0.29, so the repair could not go here -- it went into the ADAPTED
  // producer instead. If this ever stops being true the adaptation is
  // duplicating the pin and should be removed rather than kept alongside it.
  assert.ok(!/\bbed\b/i.test(photographerPrompt),
    "the pinned prompt now mentions the bed -- the atlas-proof adaptation is now a duplicate");
  assert.match(photographerPrompt, /Wrap covers painted body panels only\. Windows, lights, wheels, trim stay factory\./,
    "the pinned coverage sentence changed; re-check whether the bed clause is still needed");
});

test("the atlas proof derives the bed clause from the pin instead of restating it", () => {
  assert.match(photographerFn, /import \{ WRAP_COVERAGE_RULES \} from "\.\.\/_shared\/view-angles-os\.ts"/,
    "the clause must come from the pinned module, so the two homes cannot drift");
  assert.match(photographerFn, /startsWith\("TRUCK BED:"\)/,
    "the clause must be sliced out of the pinned block");
  assert.match(photographerFn, /atlas_proof_truck_bed_rule_missing_from_pin/,
    "a pin that loses the clause must fail loudly, never fall through to no rule");

  // Re-typing the sentence would let a future edit change the proof's wording
  // without touching the pinned source every other path reads.
  const restated = photographerFn.split("\n").filter(
    (l) => /bare factory bedliner/.test(l) && !/^\s*\/\//.test(l.trim()),
  );
  assert.equal(restated.length, 0,
    `the bed sentence is re-typed in the producer instead of sliced from the pin: ${restated.join(" | ")}`);
});

test("the bed clause reaches the proof prompt, and only on a pickup", () => {
  const atlas = atlasProofBranch(photographerFn);
  assert.match(atlas, /body\.isPickup === true \? TRUCK_BED_RULE : ""/,
    "the clause must be gated on the vehicle actually being a pickup");
  assert.match(atlas, /designAnchorText/,
    "the clause must ride the A.T.L.A.S.-owned design slot of the pinned prompt");

  // RULE 0.29's adaptation seam: A.T.L.A.S. contributes artwork, lineage,
  // vehicle/config and the requested shot. It may not restate presentation.
  for (const presentation of ["LED strip", "daylight balanced", "seamless white cyclorama", "Camera:", "Framing:"]) {
    assert.ok(!atlas.includes(presentation),
      `the bed repair pulled presentation text into atlas-proof: ${presentation}`);
  }
});

test("the runtime sends the same pickup verdict the camera authority uses", () => {
  assert.match(provider, /isPickup: pickupVehicle\(input\)/,
    "the proof request must carry the pickup config");
  assert.match(provider, /angles\.cameraAuthority\(sourceViewType, \{ pickup: pickupVehicle\(input\) \}\)/,
    "the camera authority must keep using the same predicate -- two pickup tests could disagree");
});

test("CALL 1 CARRIES NO BED EXCLUSION -- the source rectangles stay full-bleed", () => {
  // RULE 0.0: the exclusion "never punches a hole into Call 1: all six source
  // panels remain pure, opaque, uninterrupted, full-bleed rectangles."
  // RULE 0.28: "a line drawn on the master prints as a line on the wrap."
  const start = call1.indexOf("async function handleAtlasArtboard");
  assert.notEqual(start, -1, "the Call-1 artboard mode is gone");
  const artboard = call1.slice(start);
  const bed = artboard.split("\n").filter((l) => /\bbed(liner|s)?\b/i.test(l));
  assert.deepEqual(bed, [],
    `Call 1 now mentions the bed. A bed exclusion in the authoring prompt is a hole in a source rectangle: ${bed.join(" | ")}`);
});
