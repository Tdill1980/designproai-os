/**
 * ONE CAMERA AUTHORITY, AND IT SPEAKS LAST.
 *
 * Owner, 2026-08-27: "The surface-specific camera contract must be the
 * final/highest-priority camera instruction and must override generic Studio OS
 * / Canon / automotive-photography composition language... If generic DPAG,
 * Studio OS and view-angles-os are each independently specifying
 * composition/camera, collapse camera authority to view-angles-os."
 *
 * WHAT WAS ACTUALLY WRONG. Not the ROOF and HOOD contracts -- those were
 * already right, and this test proves it by reading them. A single A.T.L.A.S.
 * proof request carried FOUR voices on camera geometry, and the generic one
 * held the last word:
 *
 *   1. angles.cameraAngle()                        FIRST, under "read this FIRST"
 *   2. VIEW_REINFORCEMENT (authored in the producer)   MIDDLE
 *   3. the pickup cab-roof override (ditto)            MIDDLE
 *   4. STUDIO_ENVIRONMENT's `FRAMING:` block, its opening "professional
 *      automotive photographer shooting for a luxury car brand campaign", and
 *      "Canon EOS R5, 4K capture, studio editorial quality"    LAST
 *
 * A model resolves a conflict by position and by explicit instruction. "read
 * this FIRST" is neither. Voice 4 is whole-vehicle glamour composition, which
 * is exactly what an intermittently-failing roof or hood proof looks like.
 *
 * 2 and 3 moved into view-angles.cjs unchanged in substance, so there is one
 * voice; the producer emits it once, last, with an explicit override header.
 * STUDIO OS IS NOT EDITED -- RULE 0.29 forbids the runtime restating it, and
 * this test pins that it still carries its own FRAMING block. The validator is
 * NOT weakened either: cameraContract and framingContract still grade.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const angles = require("../runtime/view-angles.cjs");
const provider = require("../runtime/designpanel-server-provider.cjs");

const INPUT = {
  vehicle: { year: 2024, make: "Ford", model: "F-250 Super Duty" },
  finish: "Gloss",
  brief: "a clean commercial wrap",
};
const FINAL_LINE = "Shoot the frame described in this block and no other.";
const MARKER = "CAMERA GEOMETRY — FINAL AUTHORITY";

// ⛔ THERE IS NO A.T.L.A.S. PROOF PROMPT IN THIS RUNTIME ANY MORE.
//
// `buildAtlasProjectionPrompt` was deleted on 2026-08-28 (owner: "Delete
// buildAtlasProjectionPrompt and its obsolete tests instead of leaving a second
// proof implementation available to reconnect"). A.T.L.A.S. proofs are produced
// by the deployed `persona-photographer-render`, whose camera text comes from
// the byte-pinned `view-angles-os` through the byte-pinned
// `buildPhotographerPrompt`.
//
// So the "one camera voice, speaking last" invariant is now split in two, and
// BOTH halves are still locked, just not both here:
//   - A.T.L.A.S.  -> `tests/proof-stack-pinned-sources.test.mjs`, which pins
//     those two files byte-for-byte and asserts atlas-proof mode restates
//     neither `Camera:` nor `Framing:`.
//   - Standard    -> `reproPrompt` below, which is still assembled here.
// The three tests after these two read `view-angles.cjs` and `studio-os.cjs`
// directly and are unaffected either way.
const reproPrompt = (sourceViewType) => provider.buildReproductionPrompt({ input: INPUT, sourceViewType });

const VIEWS = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];

test("exactly one camera instruction per proof request", () => {
  for (const build of [reproPrompt]) {
    for (const view of VIEWS) {
      const prompt = build(view);
      assert.equal(
        (prompt.match(new RegExp(MARKER, "g")) || []).length, 1,
        `${view}: expected exactly one camera authority block`,
      );
      // The header that used to sit at the top, under a precedence it could not
      // enforce, must be gone rather than merely demoted.
      assert.ok(!prompt.includes("CAMERA ANGLE (LOCKED"), `${view}: the old first-position camera header survived`);
    }
  }
});

test("the camera block is the LAST word, and the studio block comes before it", () => {
  const studioOpening = "You are a professional automotive photographer";
  for (const build of [reproPrompt]) {
    for (const view of VIEWS) {
      const prompt = build(view);
      assert.ok(prompt.trimEnd().endsWith(FINAL_LINE), `${view}: camera block is not the final block`);
      const camera = prompt.indexOf(MARKER);
      const studio = prompt.indexOf(studioOpening);
      assert.ok(studio >= 0, `${view}: the studio block vanished`);
      assert.ok(
        studio < camera,
        `${view}: generic photography language must not sit after the camera contract`,
      );
      // And the override is STATED, not implied by position alone.
      assert.match(prompt.slice(camera), /OVERRIDES every earlier line in this prompt/);
      assert.match(prompt.slice(camera), /does not choose, soften or reinterpret camera geometry/);
    }
  }
});

test("ROOF and HOOD carry the owner's exact geometry", () => {
  const roof = angles.cameraAuthority("roof", {});
  assert.match(roof, /looking straight down/i);
  assert.match(roof, /straight down at 90 degrees/i);
  assert.match(roof, /optical axis perpendicular to the roof panel/i);
  assert.match(roof, /ZERO front, rear or side perspective/i);
  assert.match(roof, /roof is the dominant visible surface/i);

  const hood = angles.cameraAuthority("hood_detail", {});
  assert.match(hood, /straight down at 90 degrees/i);
  assert.match(hood, /ZERO perspective tilt/i);
  assert.match(hood, /fill minimum 80% of the image area/i);

  // A pickup roof still gets its cab-roof qualification -- moving the override
  // must not have dropped the behaviour it existed for.
  assert.match(angles.cameraAuthority("roof", { pickup: true }), /CAB ROOF ONLY between windshield and rear cab glass/);
  assert.ok(!angles.cameraAuthority("roof", { pickup: false }).includes("CAB ROOF ONLY"));
  assert.ok(!angles.cameraAuthority("hood_detail", { pickup: true }).includes("CAB ROOF ONLY"),
    "the pickup qualification is roof-only");
});

test("no camera geometry is authored in the proof producer any more", () => {
  const source = read("runtime/designpanel-server-provider.cjs");
  assert.ok(!/const VIEW_REINFORCEMENT = Object\.freeze/.test(source),
    "the producer must not keep its own camera-reinforcement table");
  assert.ok(!/const pickupRoofOverride =/.test(source),
    "the producer must not author its own framing override");
  assert.match(source, /angles\.cameraAuthority\(sourceViewType, \{ pickup: pickupVehicle\(input\) \}\)/);
});

test("STUDIO OS is untouched and still owns presentation only", () => {
  // RULE 0.29: the runtime CONSUMES studio-os; it never restates it. The fix is
  // precedence in the producer, never an edit to the studio contract.
  const studio = read("runtime/studio-os.cjs");
  assert.match(studio, /FRAMING:/, "studio-os must keep its own framing/lens language");
  assert.match(studio, /Canon EOS R5, 4K capture, studio editorial quality/);
  assert.match(studio, /DO NOT MODIFY/);
});

test("the camera validator is not weakened", () => {
  const qc = read("runtime/atlas-proof-qc.cjs");
  assert.match(qc, /"cameraContract"/);
  assert.match(qc, /"framingContract"/);
  assert.match(qc, /cameraContract and framingContract grade the exact locked angle and frame-fill requirements/);
  assert.match(qc, /atlas_qc_camera_failed/);
});

test("DPAG contributes no camera instruction to a proof request", () => {
  // Owner: "DPAG should not be deciding the proof angle at all." It does not --
  // the proof producer imports three pure helpers from it and no prompt
  // assembly. This pins that, because an import list is where that would
  // quietly change.
  const source = read("runtime/designpanel-server-provider.cjs");
  const importLine = source.split("\n").find((line) => line.includes('require("./designiq-prompt.cjs")'));
  assert.ok(importLine, "the designiq import moved; re-verify what it now pulls in");
  assert.equal(
    importLine.trim(),
    'const { canonicalizeVehicle, briefWantsPhoto, truckBedClause } = require("./designiq-prompt.cjs");',
    "the proof producer may take only vehicle/photo/bed helpers from DPAG -- never prompt or camera assembly",
  );
});
