// CALL 1 IS A.T.L.A.S. AUTHORITY ONLY — owner ruling, Trish 2026-09-01.
//
// DCA generation 470cb0e9 proved Gemini can answer the approved Call-1 request
// with a photorealistic vehicle-mockup montage that passes every deterministic
// structural gate (a bright render measures as 94%+ artwork), after which the
// six canonical panels faithfully cut pictures of a van. These locks hold the
// repair: (1) the conditioning states the absolute output class, and (2) the
// runtime refuses an explicit vehicle-depiction verdict BEFORE the candidate
// can become canonical or fan out — while an inspector outage fails open with
// a durable receipt instead of bricking all authoring.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const { classifyAtlasCandidate, OUTPUT_CLASS_CONTRACT, outputClassPrompt } = require("../runtime/atlas-output-class.cjs");
const runtime = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const edge = readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");

async function candidatePng() {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 40, g: 90, b: 200 } } })
    .png().toBuffer();
}

function providerAnswering(json) {
  return {
    generateRaw: async () => ({ payload: { candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }] } }),
  };
}

test("an explicit vehicle-depiction verdict is BLOCKING", async () => {
  const bytes = await candidatePng();
  const { createHash } = await import("node:crypto");
  const inspectionId = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const receipt = await classifyAtlasCandidate({
    provider: providerAnswering({ inspectionId, outputClass: "vehicle_depiction", confidence: 0.97, evidence: "four rendered vans on a studio floor" }),
    bytes,
  });
  assert.equal(receipt.contract, OUTPUT_CLASS_CONTRACT);
  assert.equal(receipt.disposition, "vehicle_depiction");
  assert.equal(receipt.blocking, true);
});

test("a flat_atlas verdict passes and carries the evidence receipt", async () => {
  const bytes = await candidatePng();
  const { createHash } = await import("node:crypto");
  const inspectionId = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const receipt = await classifyAtlasCandidate({
    provider: providerAnswering({ inspectionId, outputClass: "flat_atlas", confidence: 0.9, evidence: "six flat print rectangles" }),
    bytes,
  });
  assert.equal(receipt.disposition, "flat_atlas");
  assert.equal(receipt.blocking, false);
  assert.match(receipt.evidence, /flat print rectangles/);
});

test("inspector transport failure fails OPEN with a durable unavailable receipt — never blocking", async () => {
  const bytes = await candidatePng();
  for (const provider of [
    null,
    { generateRaw: async () => { throw new Error("gemini 503"); } },
    providerAnswering({ inspectionId: "0000000000000000", outputClass: "vehicle_depiction", confidence: 1 }),
    { generateRaw: async () => ({ payload: { candidates: [{ content: { parts: [{ text: "not json" }] } }] } }) },
  ]) {
    const receipt = await classifyAtlasCandidate({ provider, bytes });
    assert.equal(receipt.disposition, "unavailable");
    assert.equal(receipt.blocking, false);
    assert.ok(receipt.code, "an unavailable receipt names its cause");
  }
});

test("the inspector question is a binary class check at temperature 0, never creative direction", () => {
  const prompt = outputClassPrompt("abcdef0123456789");
  assert.match(prompt, /OUTPUT CLASS only/);
  assert.match(prompt, /flat_atlas/);
  assert.match(prompt, /vehicle_depiction/);
  assert.doesNotMatch(prompt, /design|improve|redraw|create artwork/i);
  // 2026-09-10, New Aura (DID-664D054D): a master whose flanks were an Urus
  // side profile on a plain grey surround was classed flat_atlas and printed
  // as anatomy. The question names that shape: a vehicle-shaped island with an
  // any-colour plain surround is vehicle_depiction.
  assert.match(prompt, /vehicle-shaped island/);
  assert.match(prompt, /side profile, front or rear elevation/);
  assert.match(prompt, /plain single-colour surround \(grey, white, black or any colour\)/);
  // 2026-09-14 (owner: "Fix it"): the same question refused two Porsche
  // Martini race-livery sheets for "a side profile of a race car" and "a car's
  // front grille and headlights, and a tire tread pattern" -- the ARTWORK's
  // motifs, not a vehicle -- and on 09-06 refused a six-panel sheet because it
  // held "hood, sides, and rear" panels. Motifs, panel captions and a cut-out
  // inside continuous artwork are named as flat_atlas so the inspector convicts
  // pictures of vehicles, not livery.
  assert.match(prompt, /automotive MOTIFS drawn as graphics/);
  assert.match(prompt, /grille or headlight graphics, tire-tread or carbon patterns/);
  assert.match(prompt, /printed panel names or captions \(for example HOOD, ROOF, DRIVER, REAR\): that is the layout, not a vehicle/);
  // 2026-09-15 (owner: "look at containers, fill that"): the accepted 911
  // Turbo master shipped both flanks with a wheel-shaped void because the
  // inspector had been told a hole inside continuous artwork was fine. It runs
  // AFTER the deterministic fill now, so a void it still sees is one the fill
  // missed, and that sheet must not become canonical.
  assert.match(prompt, /a dark or empty OPENING where a wheel, wheel arch, window, windshield or grille would sit/);
  assert.match(prompt, /Printed vinyl has no openings; the installer cuts them/);
  assert.doesNotMatch(prompt, /is NOT this class; classify by the artwork around it/);
  assert.match(prompt, /flat_atlas requires EVERY rectangle to read as continuous print artwork edge to edge/);
  assert.doesNotMatch(prompt, /wheel-arch cut-outs or discs, bumper, grille, headlight, door or window shapes/);
  const source = readFileSync(new URL("../runtime/atlas-output-class.cjs", import.meta.url), "utf8");
  assert.match(source, /temperature: 0/);
  assert.doesNotMatch(source, /image/.source && /gemini-[a-z0-9.]*image/i);
});

test("the runtime gate refuses a vehicle-depiction candidate BEFORE canonicalization or fan-out", () => {
  const loop = runtime.slice(
    runtime.indexOf("for (let attempt = 1; attempt <= maxAuthoringAttempts"),
    runtime.indexOf("const masterStoragePath"),
  );
  assert.match(loop, /classifyAtlasCandidate\(\{ provider, bytes: masterBytes \}\)/);
  assert.match(loop, /flat_atlas_master_output_class_invalid/);
  // The gate runs only after the deterministic checks pass, and its refusal
  // joins the same bounded refusal path — so nothing not-A.T.L.A.S. reaches
  // the acceptance break below it.
  const deterministicIdx = loop.indexOf("deterministic.blockingFailures");
  const gateIdx = loop.indexOf("classifyAtlasCandidate");
  const breakIdx = loop.indexOf("break;");
  assert.ok(deterministicIdx > -1 && deterministicIdx < gateIdx && gateIdx < breakIdx,
    "gate order must be deterministic checks, then output class, then acceptance");
  // The accepted revision records the receipt.
  assert.match(runtime, /masterOutputClass: outputClassReceipt/);
  assert.match(runtime, /masterOutputClassContract: OUTPUT_CLASS_CONTRACT/);
});

test("the absolute output class is acceptance logic, never Call-1 authoring conditioning", () => {
  // OWNER RULING 2026-09-01: the refusal block is POST-GENERATION acceptance
  // logic only. It must never be injected into the authoring prompt, where a
  // long negative displaces creative direction and makes the model over-index
  // on the forbidden thing. The gate itself is unchanged and still blocking.
  assert.doesNotMatch(edge, /OUTPUT CLASS — ABSOLUTE/);
  assert.doesNotMatch(edge, /vehicle presentation exists only in the downstream proofing system/);
  // Both authoring scenes still state the flat output class -- in the proven
  // DesignPanelAI wording recovered from 36e5acc4, which names what the output
  // IS rather than listing what it must not be.
  const sceneMatches = edge.match(/as ONE FLAT print-production master — flat orthographic panels of pure printed vinyl artwork, never an on-vehicle photograph/g) || [];
  assert.equal(sceneMatches.length, 2, "commercial and restyle scenes both state the flat output class");
  assert.doesNotMatch(edge, /Your output is the same kind of object as this teaching proof/);
});
