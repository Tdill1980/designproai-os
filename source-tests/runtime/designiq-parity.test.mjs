import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const worker = require("../../runtime/generation-worker.cjs");
const ace = require("../../runtime/designiq-prompt.cjs");
const photography = require("../../runtime/photorealism-prompt.cjs");
const studio = require("../../runtime/studio-os.cjs");
const angles = require("../../runtime/view-angles.cjs");

const INPUT = Object.freeze({
  brief: "HVAC Hero, dark blue and ice blue, bold commercial wrap",
  businessName: "Precision Climate Solutions",
  industry: "HVAC",
  phone: "(602) 555-1842",
  colors: ["deep blue", "ice blue"],
  finish: "gloss",
  vehicle: { year: "2022", make: "Ford", model: "F250 Crew Cab", type: "truck" },
});

const live = () => worker.promptPartsFor(INPUT, "side")[0].text;

test("the live Calls 1-7 prompt is the A.C.E. stack, not a key:value brief", () => {
  const text = live();
  // Each of these was ABSENT from the runtime before the port. If any goes
  // missing again the design language regresses to the thin prompt, which is
  // the regression this locks.
  const required = {
    persona: /senior graphic designer at a sign and wrap company/,
    cameraLockedFirst: /CAMERA ANGLE \(LOCKED — read this FIRST\):/,
    studioContract: /DARK EPOXY WITH MIRROR REFLECTIONS/,
    logoRequirement: /needs its own logo/,
    commercialDepth: /built from layered elements/,
    translation: /stealth bomber/,
    professionalJudgment: /rich photographic realism/,
    finishSpec: /wet-look surface/,
    coverageRule: /wrap covers painted body panels only/,
    cameraSpec: /Canon EOS R5/,
  };
  for (const [name, pattern] of Object.entries(required)) {
    assert.match(text, pattern, `${name} is missing from the live prompt`);
  }
  // The thin prompt was ~200 chars. A collapse back toward that is the failure.
  assert.ok(text.length > 3000, `live prompt is only ${text.length} chars`);
});

test("the camera angle is read first and never appended twice", () => {
  const text = live();
  const first = text.indexOf("CAMERA ANGLE (LOCKED");
  assert.ok(first > -1 && first < 400, "the locked camera angle must lead the prompt");
  assert.equal(
    text.split("PERFECTLY STRAIGHT side-on elevation").length - 1, 1,
    "the camera angle must appear exactly once",
  );
});

test("the studio contract is byte-identical to the ported file", () => {
  assert.ok(live().includes(studio.STUDIO_ENVIRONMENT.trim()),
    "the prompt must carry the studio kernel verbatim");
});

test("runtime Studio OS strings are byte-identical to the DesignProAI Edge source", () => {
  const edgeSource = readFileSync(
    new URL("../../supabase/functions/_shared/studio-os.ts", import.meta.url),
    "utf8",
  );
  for (const name of ["STUDIO_ENVIRONMENT", "STUDIO_REINFORCEMENT"]) {
    const sourceLiteral = edgeSource.match(
      new RegExp("export const " + name + " = `([\\s\\S]*?)`;"),
    );
    assert.ok(sourceLiteral, `the Edge ${name} template literal must remain readable`);
    assert.equal(
      studio[name],
      sourceLiteral[1],
      `runtime ${name} must be a byte-for-byte port of the Edge contract`,
    );
  }
});

test("runtime view order and every active camera are exact Edge view-angles-os ports", () => {
  const edgeSource = readFileSync(
    new URL("../../supabase/functions/_shared/view-angles-os.ts", import.meta.url),
    "utf8",
  );
  const orderLiteral = edgeSource.match(
    /export const VIEW_ORDER = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(orderLiteral, "the Edge VIEW_ORDER literal must remain readable");
  const edgeOrder = [...orderLiteral[1].matchAll(/['\"]([^'\"]+)['\"]/g)]
    .map((match) => match[1]);
  assert.deepEqual(
    angles.viewOrder(),
    edgeOrder,
    "runtime view order must be byte-derived from the active Edge order",
  );
  assert.deepEqual(edgeOrder, [
    "side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof",
  ]);
  assert.ok(!edgeOrder.includes("hero-3d"), "Hero must not enter the active seven");

  const cameraBlock = edgeSource.match(
    /export const CAMERA_ANGLES:[^=]+?= \{([\s\S]*?)\n\};/,
  );
  assert.ok(cameraBlock, "the Edge CAMERA_ANGLES object must remain readable");
  for (const view of edgeOrder) {
    const escaped = view.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const sourceLiteral = cameraBlock[1].match(
      new RegExp(
        "(?:^|\\n)\\s*(?:['\"]" + escaped + "['\"]|" + escaped
          + "):\\s*`([\\s\\S]*?)`,",
        "m",
      ),
    );
    assert.ok(sourceLiteral, `the Edge ${view} camera template must remain readable`);
    assert.equal(
      angles.cameraAngle(view),
      sourceLiteral[1],
      `runtime ${view} camera must be a byte-for-byte Edge port`,
    );
  }
});

test("the photorealism contract is byte-identical to the DesignProAI Edge source", () => {
  const edgeSource = readFileSync(
    new URL("../../supabase/functions/_shared/photorealism-prompt.ts", import.meta.url),
    "utf8",
  );
  const sourceLiteral = edgeSource.match(
    /export const PHOTOREALISM_REQUIREMENT = `([\s\S]*?)`;/,
  );
  assert.ok(sourceLiteral, "the Edge PHOTOREALISM_REQUIREMENT template literal must remain readable");
  assert.equal(
    photography.PHOTOREALISM_REQUIREMENT,
    sourceLiteral[1],
    "runtime photography must be a byte-for-byte port of the Edge contract",
  );
});

test("photo realism is explicit-request only", () => {
  // A designer illustrates by default. Scene words alone must not flip it.
  assert.equal(ace.briefWantsPhoto("a ranch at sunset with a cabin"), false);
  assert.equal(ace.briefWantsPhoto("mountains and wildlife"), false);
  assert.equal(ace.briefWantsPhoto("use a photo of a tech installing an AC"), true);
  assert.equal(ace.briefWantsPhoto("photorealistic desert scene"), true);
  assert.equal(ace.briefWantsPhoto("lifelike imagery"), true);
  assert.ok(!live().includes("PHOTOGRAPHIC IMAGERY"), "a non-photo brief must not carry the lock");
});

test("the pickup bed clause fires for pickups only", () => {
  assert.match(ace.truckBedClause("2022 Ford F-250 Crew Cab"), /bare factory bedliner/);
  assert.match(ace.truckBedClause("Chevrolet Silverado 1500"), /bare factory bedliner/);
  assert.equal(ace.truckBedClause("2024 Ford Transit"), "");
  assert.equal(ace.truckBedClause("Mercedes-Benz Sprinter"), "");
});

test("vehicle canonicalization gives the model its proper noun", () => {
  assert.equal(ace.canonicalizeVehicle("tesla", "cyber truck"), "Tesla Cybertruck");
  assert.equal(ace.canonicalizeVehicle("chevy", "silverado"), "Chevrolet Silverado 1500");
  assert.equal(ace.canonicalizeVehicle("ford", "f250"), "Ford F-250");
});

test("a phone number is copied exactly, and never invented when absent", () => {
  assert.match(live(), /\(602\) 555-1842 — display this EXACT number, digit for digit/);
  const noPhone = worker.promptPartsFor({ ...INPUT, phone: "" }, "side")[0].text;
  assert.match(noPhone, /do NOT invent, fabricate, or display any phone number/);
});

test("VisionBoard grounding reaches the prompt", () => {
  const images = [{ slotLabel: "hero", storageUrl: "x" }];
  const inspiration = worker.promptPartsFor({ ...INPUT, visionBoardImages: images }, "side")[0].text;
  assert.match(inspiration, /STYLE INSPIRATION/);
  const exact = worker.promptPartsFor(
    { ...INPUT, visionBoardImages: images, visionboardIntent: "exact_reference" }, "side")[0].text;
  assert.match(exact, /EXACT REFERENCE/);
});
