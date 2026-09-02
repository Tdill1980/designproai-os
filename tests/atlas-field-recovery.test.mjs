// FIELD RECOVERY HARNESS — LOCKS. Phase 1, one draw, harness only.
//
// These convict, without a provider call, every way the harness could quietly
// stop being what the owner approved: the territories drifting off the §L
// geometry, the creative assembly changing by more than the one scene clause,
// a forbidden container/anatomy word entering the tail, a guide or teaching
// image sneaking back into the request, the nose-direction phrases inverting,
// and the continuity instrument failing to see a divider it was built to see.
// The last test runs the REAL production extractor over a synthetic field and
// proves six distinct canonical files come out at the §L pixel sizes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildFieldTerritories,
  fieldTrimRectangle,
  internalBoundaries,
  FIELD_TOPOLOGY,
  NOSE_EDGE,
} from "../scripts/atlas-field-territories.mjs";
import {
  DEPLOYED_SCENE_CLAUSE,
  FIELD_SCENE_CLAUSE,
  FIELD_TAIL_MAX_CHARS,
  FORBIDDEN_IN_FIELD_TAIL,
  assertFieldTailClean,
  buildFieldPrompt,
  buildFieldRequest,
  fieldContract,
  replaceExactlyOnce,
  sweepPhrase,
} from "../scripts/atlas-field-contract.mjs";
import { measureContinuity, measureBoundary } from "../scripts/atlas-field-continuity.mjs";
import { fullBleedMetrics } from "../scripts/atlas-fullbleed-metrics.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const atlas = require("../runtime/flat-first-atlas.cjs");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");

// The 2022 Ford F250 Crew Cab fixture at the catalog's GENIE trim sizes.
const surface = (k, w, h) => ({ surfaceKey: k, widthInches: w, heightInches: h, surfaceSqFt: Math.round((w * h / 144) * 100) / 100, bleed: { top: 5, right: 5, bottom: 5, left: 5 } });
const F250 = [surface("driver", 251, 60), surface("passenger", 251, 60), surface("hood", 64, 40), surface("roof", 60, 58), surface("front", 64, 30), surface("rear", 64, 23)];
const legacy = () => atlas.buildAtlasManifest(F250, null, "truck");

// The deployed prompt, captured off the harness on run 33595250518 and pinned
// by sha against the deployed edge (4,587 chars).
const DEPLOYED_PROMPT = readFileSync(new URL("../docs/ab/object-model-33595250518-prompt-A.txt", import.meta.url), "utf8");

test("the deployed-prompt fixture is the one the edge sends", () => {
  assert.equal(DEPLOYED_PROMPT.length, 4587);
  assert.equal(sha256(DEPLOYED_PROMPT), "dcb73e9eae229cd88af6bcdb4a3874e1050b266fa98a55b79fee65d0b7e610b2");
});

test("field-bands-v1 places the F250 territories exactly where §L says, rotation 0, real inches", () => {
  const f = buildFieldTerritories(legacy());
  assert.equal(f.topology, FIELD_TOPOLOGY);
  const rect = (k) => { const z = f.zones.find((q) => q.surfaceKey === k); return [z.x, z.y, z.w, z.h]; };
  assert.deepEqual(rect("driver"), [0, 0, 4096, 1099]);
  assert.deepEqual(rect("passenger"), [0, 1099, 4096, 1099]);
  assert.deepEqual(rect("roof"), [0, 2198, 1315, 1278]);
  assert.deepEqual(rect("hood"), [1315, 2198, 1390, 939]);
  assert.deepEqual(rect("front"), [2705, 2198, 1390, 752]);
  assert.deepEqual(rect("rear"), [0, 3476, 1390, 620]);
  for (const z of f.zones) {
    assert.equal(z.rotationDegrees, 0);
    assert.equal(z.extraction.outputRotationDegrees, 0);
    assert.deepEqual([z.extraction.x, z.extraction.y, z.extraction.w, z.extraction.h], [z.x, z.y, z.w, z.h]);
    // inches are lifted from the legacy manifest, never re-derived
    const l = legacy().zones.find((q) => q.surfaceKey === z.surfaceKey);
    assert.equal(z.printWidthIn, l.printWidthIn);
    assert.equal(z.printHeightIn, l.printHeightIn);
    assert.equal(z.trimWidthIn, l.trimWidthIn);
    assert.equal(z.trimHeightIn, l.trimHeightIn);
    assert.deepEqual(z.bleedIn, { top: 5, right: 5, bottom: 5, left: 5 });
    // exact print aspect
    assert.ok(Math.abs((z.w / z.h) / (z.printWidthIn / z.printHeightIn) - 1) <= 0.001, `${z.surfaceKey} aspect drifted`);
  }
  const driver = f.zones.find((z) => z.surfaceKey === "driver");
  assert.deepEqual(driver.trim, { x: 78, y: 79, w: 3940, h: 941 });
  assert.equal(driver.effectivePpi, 15.69);
  assert.equal(driver.noseEdge, "left");
  assert.equal(f.zones.find((z) => z.surfaceKey === "passenger").noseEdge, "right");
  assert.equal(f.quality.minimumEffectivePpi, 15.69);
  assert.ok(f.quality.minimumEffectivePpi > legacy().quality.minimumEffectivePpi, "the field layout must not lose native density");
  assert.equal(f.fieldLayout.extractedRatio, 0.8283);
  assert.equal(f.fieldLayout.paintedNotExtractedRatio, 0.1717);
  assert.equal(f.zones.length, 6);
  assert.deepEqual(f.zones.map((z) => z.surfaceKey), ["driver", "passenger", "hood", "roof", "front", "rear"], "SURFACE_KEYS order is preserved");
});

test("territories never overlap and the boundary list is derived from the rects", () => {
  const f = buildFieldTerritories(legacy());
  const b = internalBoundaries(f.zones).map((x) => `${x.between.join(">")}:${x.axis}=${x.at}`);
  assert.ok(b.includes("driver>passenger:y=1099"));
  assert.ok(b.includes("roof>hood:x=1315"));
  assert.ok(b.includes("hood>front:x=2705"));
  assert.ok(b.includes("roof>rear:y=3476"));
  assert.deepEqual(fieldTrimRectangle({ x: 0, y: 0, w: 4096, h: 1099 }, 261, 70), { x: 78, y: 79, w: 3940, h: 941 });
});

test("the creative assembly is byte-identical except one reversible scene clause", () => {
  const field = buildFieldPrompt(DEPLOYED_PROMPT);
  assert.ok(DEPLOYED_PROMPT.startsWith(field.creative));
  assert.ok(field.prompt.startsWith(field.creativeField));
  assert.equal(replaceExactlyOnce(field.creativeField, FIELD_SCENE_CLAUSE, DEPLOYED_SCENE_CLAUSE), field.creative);
  assert.equal(field.creative.length - DEPLOYED_SCENE_CLAUSE.length + FIELD_SCENE_CLAUSE.length, field.creativeField.length);
  assert.ok(field.creativeField.includes("never an on-vehicle photograph"), "the v19-restored phrase survives");
  assert.ok(!field.creativeField.includes("flat orthographic panels"));
  // the persona and every creative block survive untouched
  for (const literal of [
    "You are the senior vehicle-wrap designer at a sign and wrap company",
    "THE CONCEPT — the heart of this design; build everything around it:",
    "Translate anything the brief names into concrete design",
    "This business needs its own logo",
    "Finish: GLOSS — wet-look surface",
  ]) assert.ok(field.creativeField.includes(literal), `creative block missing: ${literal}`);
  assert.ok(!field.prompt.includes("OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD"));
  assert.ok(field.fieldTail.length <= FIELD_TAIL_MAX_CHARS);
  assert.ok(field.fieldTail.includes("for this exact 2022 Ford F250 Crew Cab (truck)"), "the vehicle context is carried across");
});

test("the field tail carries no container, panel, anatomy or negative framing", () => {
  const tail = fieldContract(buildFieldPrompt(DEPLOYED_PROMPT).deployedTail);
  for (const { word } of FORBIDDEN_IN_FIELD_TAIL) {
    assert.throws(() => assertFieldTailClean(`${tail}\n${word} appears here`), new RegExp(`forbidden framing "${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  }
  assert.throws(() => assertFieldTailClean("x".repeat(FIELD_TAIL_MAX_CHARS + 1)), /over the 1400 ceiling/);
  // word boundaries: "whole" and "search" are not "hole" and "arch"
  assert.doesNotThrow(() => assertFieldTailClean("the whole search"));
  assert.ok(tail.includes("MOVEMENT ONE"));
  assert.ok(tail.includes("MOVEMENT THREE"));
});

test("nose direction generates the sweep phrases and the OS flips nothing", () => {
  assert.equal(NOSE_EDGE.driver, "left");
  assert.equal(NOSE_EDGE.passenger, "right");
  assert.equal(sweepPhrase("left"), "Forward energy sweeps left to right.");
  assert.equal(sweepPhrase("right"), "Forward energy sweeps right to left.");
  assert.throws(() => sweepPhrase("up"), /unknown noseEdge/);
  const tail = fieldContract(buildFieldPrompt(DEPLOYED_PROMPT).deployedTail);
  assert.ok(/MOVEMENT ONE[^\n]*left to right\./.test(tail));
  assert.ok(/MOVEMENT TWO[^\n]*right to left\./.test(tail));
  assert.ok(tail.includes("Lettering reads left to right throughout."));
  const swapped = fieldContract(buildFieldPrompt(DEPLOYED_PROMPT).deployedTail, { noseEdge: { driver: "right", passenger: "left" } });
  assert.ok(/MOVEMENT ONE[^\n]*right to left\./.test(swapped));
});

test("the field request carries zero structural images and refuses one", () => {
  const { request } = buildFieldRequest({ prompt: "p", model: "gemini-3-pro-image" });
  assert.equal(request.partCount, 1);
  assert.equal(request.modelInputImageCount, 0);
  assert.deepEqual(request.generationConfig, { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "4K" } });
  // a structural image that is not a counted customer reference is refused
  assert.throws(
    () => buildFieldRequest({ prompt: "p", model: "m", referenceParts: [{ text: "not an image" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] }),
    /structural image/,
  );
  // a customer reference is allowed and counted; a stray image without the count is not
  const withRef = buildFieldRequest({ prompt: "p", model: "m", referenceParts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] });
  assert.equal(withRef.request.modelInputImageCount, 1);
  assert.equal(withRef.request.customerReferenceCount, 1);
});

function rawField(width, height, paint) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const i = (y * width + x) * 3;
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
  }
  return { data, width, height, channels: 3 };
}

test("the continuity instrument sees a drawn divider and does not see a continuous gradient", () => {
  const boundary = { between: ["a", "b"], axis: "y", at: 256, from: 0, to: 512 };
  const gradient = rawField(512, 512, (x, y) => { const v = Math.round(y / 2); return [v, 255 - v, 128]; });
  const clean = measureBoundary(gradient, boundary);
  assert.equal(clean.measurable, true);
  assert.equal(clean.dividerDetected, false);
  assert.ok(clean.boundaryMae < 0.1);
  const lined = rawField(512, 512, (x, y) => { const v = Math.round(y / 2); return (y >= 253 && y < 259) ? [0, 0, 0] : [v, 255 - v, 128]; });
  const divided = measureBoundary(lined, boundary);
  assert.equal(divided.dividerDetected, true);
  assert.equal(divided.dividerDepthPx, 6);
  // two flat fields with no line: a hard colour step is continuity failure, not a divider
  const step = rawField(512, 512, (x, y) => (y < 256 ? [40, 40, 40] : [220, 220, 220]));
  const stepped = measureBoundary(step, boundary);
  assert.equal(stepped.dividerDetected, false);
  assert.ok(stepped.boundaryMae > 0.5);
  const all = measureContinuity(lined, [boundary]);
  assert.equal(all.anyDividerDetected, true);
  assert.equal(all.deepestDividerPx, 6);
});

test("the REAL extractor cuts six distinct canonical files from a synthetic field at the §L sizes", async () => {
  const f = buildFieldTerritories(legacy());
  f.geometryResolution = { contract: "designpro.genie-manifest.v1", genieManifestId: "0".repeat(32), genieManifestHash: "a".repeat(64), state: "derived", productionEligible: true };
  // a continuous field: a diagonal gradient carrying per-pixel texture, so the
  // colour-blind flood stops at the first pixel everywhere (a smooth gradient
  // with no detail would read as one uniform field -- which is correct: the
  // instrument measures artwork, and artwork has detail).
  const W = 4096; const H = 4096;
  const data = Buffer.alloc(W * H * 3);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const t = (x + y) / (W + H);
      const n = (rnd() - 0.5) * 90;
      const i = (y * W + x) * 3;
      data[i] = Math.max(0, Math.min(255, Math.round(27 + t * 228 + n)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(42 + t * 80 + n)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(107 - t * 81 + n)));
    }
  }
  const raw = await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
  const normalized = await atlas.normalizeAtlasMaster(raw, f);
  const master = normalized.bytes;
  const bleed = await fullBleedMetrics(master, f);
  assert.equal(bleed.fullBleedCompliantCount, 6, "a continuous gradient field is full-bleed in every territory");
  const trim = await fullBleedMetrics(master, { zones: f.zones.map((z) => ({ surfaceKey: z.surfaceKey, rect: z.trim })) });
  assert.equal(trim.fullBleedCompliantCount, 6);
  const panels = [];
  await atlas.cutCallOnePanels(master, f, sha256(master), { onPanel: async (p) => { panels.push(p); } });
  assert.equal(panels.length, 6);
  assert.equal(new Set(panels.map((p) => p.contentHash)).size, 6);
  const px = Object.fromEntries(panels.map((p) => [p.surfaceKey, [p.pixelWidth, p.pixelHeight]]));
  assert.deepEqual(px.driver, [4096, 1099]);
  assert.deepEqual(px.passenger, [4096, 1099]);
  assert.deepEqual(px.roof, [1315, 1278]);
  assert.deepEqual(px.hood, [1390, 939]);
  assert.deepEqual(px.front, [1390, 752]);
  assert.deepEqual(px.rear, [1390, 620]);
  for (const p of panels) {
    assert.equal(p.method, "deterministic_atlas_crop");
    assert.equal(p.deterministic, true);
    assert.equal(p.sourceMasterHash, sha256(master));
    assert.equal(p.genieManifestHash, "a".repeat(64));
    assert.equal(p.bleedInches, 5);
  }
  assert.deepEqual(panels.map((p) => p.surfaceKey), ["driver", "passenger", "hood", "front", "rear", "roof"], "PANEL_EXTRACTION_ORDER, driver first");
});
