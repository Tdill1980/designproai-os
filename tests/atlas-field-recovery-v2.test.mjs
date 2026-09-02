// FIELD RECOVERY v2 — LOCKS. `field-thirds-v2`, one draw, harness only.
//
// Without a provider call these convict every way the harness could stop
// being what the owner ruled: a territory off the thirds, a flank file that
// differs from its twin in size, the creative assembly changing by more than
// the seven reversible swaps, an object/topology/negative word anywhere in the
// model-facing prompt, a guide or teaching image entering the request, and the
// real extractor failing to cut six distinct files at the territory sizes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFieldTerritoriesV2, thirdBands, FIELD_TOPOLOGY_V2, FIELD_CONTRACT_V2 } from "../scripts/atlas-field-territories-v2.mjs";
import {
  CREATIVE_FIELD_SWAPS,
  APPROVED_CREATIVE_PHRASES,
  FORBIDDEN_IN_FIELD_PROMPT,
  applyCreativeFieldSwaps,
  reverseCreativeFieldSwaps,
  assertFieldPromptClean,
  buildFieldPromptV2,
  buildFieldRequestV2,
  fieldContractV2,
} from "../scripts/atlas-field-contract-v2.mjs";
import { FORBIDDEN_IN_FIELD_TAIL, assertFieldTailClean } from "../scripts/atlas-field-contract.mjs";
import { brandingInspectionPrompt, inspectFileBranding, INSPECTION_MODEL } from "../scripts/atlas-field-inspection.mjs";
import { fullBleedMetrics } from "../scripts/atlas-fullbleed-metrics.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const atlas = require("../runtime/flat-first-atlas.cjs");
const sha256 = (v) => createHash("sha256").update(v).digest("hex");

const surface = (k, w, h) => ({ surfaceKey: k, widthInches: w, heightInches: h, surfaceSqFt: Math.round((w * h / 144) * 100) / 100, bleed: { top: 5, right: 5, bottom: 5, left: 5 } });
// The LIVE GENIE row for "2022 Ford F250 Crew Cab" (state `measured`, manifest
// 879291d3…): trim inches; buildAtlasManifest adds the 5" bleed.
const LIVE = [surface("driver", 153, 56), surface("passenger", 153, 56), surface("hood", 71.5, 56), surface("roof", 74.3, 54.8), surface("front", 129, 34), surface("rear", 76, 54)];
// The catalog fixture the v1 locks use.
const CATALOG = [surface("driver", 251, 60), surface("passenger", 251, 60), surface("hood", 64, 40), surface("roof", 60, 58), surface("front", 64, 30), surface("rear", 64, 23)];
const legacy = (set = LIVE) => atlas.buildAtlasManifest(set, null, "truck");

const DEPLOYED_PROMPT = readFileSync(new URL("../docs/ab/object-model-33595250518-prompt-A.txt", import.meta.url), "utf8");

test("the deployed-prompt fixture is the one the edge sends", () => {
  assert.equal(DEPLOYED_PROMPT.length, 4587);
  assert.equal(sha256(DEPLOYED_PROMPT), "dcb73e9eae229cd88af6bcdb4a3874e1050b266fa98a55b79fee65d0b7e610b2");
});

test("thirds: two equal flank thirds, the centre takes the remainder", () => {
  assert.deepEqual(thirdBands(4096), [{ third: 1, y: 0, h: 1365 }, { third: 2, y: 1365, h: 1365 }, { third: 3, y: 2730, h: 1366 }]);
});

test("field-thirds-v2 on the live F250 row: flanks centred in their thirds, rear under the front, rotation 0", () => {
  const f = buildFieldTerritoriesV2(legacy());
  assert.equal(f.topology, FIELD_TOPOLOGY_V2);
  assert.equal(f.contract, FIELD_CONTRACT_V2);
  const rect = (k) => { const z = f.zones.find((q) => q.surfaceKey === k); return [z.x, z.y, z.w, z.h]; };
  assert.deepEqual(rect("driver"), [362, 0, 3371, 1365]);
  assert.deepEqual(rect("passenger"), [362, 1365, 3371, 1365]);
  const roof = rect("roof"); const hood = rect("hood"); const front = rect("front"); const rear = rect("rear");
  assert.equal(roof[1], 2730); assert.equal(hood[1], 2730); assert.equal(front[1], 2730);
  assert.equal(hood[0], roof[0] + roof[2]);
  assert.equal(front[0], hood[0] + hood[2]);
  assert.equal(f.installerMap.rearUnder, "front");
  assert.equal(rear[0], front[0]);
  assert.equal(rear[1], front[1] + front[3]);
  assert.ok(rear[1] + rear[3] <= 4096);
  for (const z of f.zones) {
    assert.equal(z.rotationDegrees, 0);
    assert.equal(z.extraction.outputRotationDegrees, 0);
    assert.deepEqual([z.extraction.x, z.extraction.y, z.extraction.w, z.extraction.h], [z.x, z.y, z.w, z.h]);
    const l = legacy().zones.find((q) => q.surfaceKey === z.surfaceKey);
    assert.equal(z.printWidthIn, l.printWidthIn);
    assert.equal(z.printHeightIn, l.printHeightIn);
    assert.equal(z.trimWidthIn, l.trimWidthIn);
    assert.equal(z.trimHeightIn, l.trimHeightIn);
    assert.ok(Math.abs((z.w / z.h) / (z.printWidthIn / z.printHeightIn) - 1) <= 0.0025, `${z.surfaceKey} aspect drifted`);
  }
  const d = f.zones.find((z) => z.surfaceKey === "driver");
  const p = f.zones.find((z) => z.surfaceKey === "passenger");
  assert.deepEqual([d.w, d.h], [p.w, p.h], "Driver and Passenger files are the same pixel size");
  assert.equal(d.effectivePpi, 20.68);
  assert.equal(p.effectivePpi, 20.68);
  assert.equal(d.noseEdge, "left");
  assert.equal(p.noseEdge, "right");
  assert.equal(f.fieldLayout.thirds[2].scaleCenterPxPerIn, 12.65);
  assert.ok(f.quality.minimumEffectivePpi >= 12.6, `centre native ${f.quality.minimumEffectivePpi} — v1 was 8.81`);
  assert.ok(f.fieldLayout.extractedRatio > 0.744, `extracted ${f.fieldLayout.extractedRatio} — v1 field-bands extracted 0.7444`);
  assert.deepEqual(f.zones.map((z) => z.surfaceKey), ["driver", "passenger", "hood", "roof", "front", "rear"], "SURFACE_KEYS order is preserved");
  // the derived boundaries include the two third lines the model draws
  const b = f.fieldLayout.boundaries.map((x) => `${x.between.join(">")}:${x.axis}=${x.at}`);
  assert.ok(b.includes("driver>passenger:y=1365"));
  assert.ok(b.some((s) => s.startsWith("passenger>") && s.endsWith(":y=2730")));
});

test("field-thirds-v2 holds on the catalog fixture and on 200 plausible vehicles", () => {
  const c = buildFieldTerritoriesV2(legacy(CATALOG));
  const d = c.zones.find((z) => z.surfaceKey === "driver");
  assert.equal(d.w, 4096, "a long flank is width-limited and spans the canvas");
  assert.ok(d.y > 0 && d.y + d.h < 1365, "and is centred vertically in its third");
  let seed = 11;
  const rnd = (lo, hi) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return lo + (seed / 0x7fffffff) * (hi - lo); };
  for (let i = 0; i < 200; i += 1) {
    const sideH = Math.round(rnd(40, 80));
    const side = [Math.round(sideH * rnd(2.2, 4.5)), sideH];
    const set = [
      surface("driver", side[0], side[1]), surface("passenger", side[0], side[1]),
      surface("hood", Math.round(rnd(40, 90)), Math.round(rnd(20, 70))),
      surface("roof", Math.round(rnd(40, 90)), Math.round(rnd(30, 200))),
      surface("front", Math.round(rnd(40, 90)), Math.round(rnd(15, 60))),
      surface("rear", Math.round(rnd(40, 90)), Math.round(rnd(15, 70))),
    ];
    const f = buildFieldTerritoriesV2(atlas.buildAtlasManifest(set, null, "truck"));
    assert.equal(f.zones.length, 6);
    for (const z of f.zones) assert.ok(z.x >= 0 && z.y >= 0 && z.x + z.w <= 4096 && z.y + z.h <= 4096, `${z.surfaceKey} out of bounds on fixture ${i}`);
  }
});

test("the creative assembly changes by exactly seven reversible swaps and every creative block survives", () => {
  const field = buildFieldPromptV2(DEPLOYED_PROMPT);
  assert.equal(CREATIVE_FIELD_SWAPS.length, 7);
  assert.ok(DEPLOYED_PROMPT.startsWith(field.creative));
  assert.ok(field.prompt.startsWith(field.creativeField));
  assert.equal(field.reverseProof, true);
  assert.equal(reverseCreativeFieldSwaps(applyCreativeFieldSwaps(field.creative)), field.creative);
  for (const [from, to] of CREATIVE_FIELD_SWAPS) {
    assert.ok(field.creative.includes(from), `deployed creative lacks "${from.slice(0, 40)}"`);
    assert.ok(!field.creativeField.includes(from));
    assert.ok(field.creativeField.includes(to));
  }
  for (const literal of [
    "You are the senior vehicle-wrap designer at a sign and wrap company",
    "installed on real trucks and vans",
    "Design the printed wrap artwork for a 2022 Ford F250 Crew Cab (truck)",
    "never an on-vehicle photograph",
    "THE CONCEPT — the heart of this design; build everything around it:",
    "Translate anything the brief names into concrete design — color story, layout, graphic motifs",
    "This business needs its own logo",
    "No phone number was provided",
    "Finish: GLOSS — wet-look surface",
    "render it with rich photographic realism",
  ]) assert.ok(field.creativeField.includes(literal), `creative block missing: ${literal}`);
  assert.ok(!field.prompt.includes("OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD"));
  assert.ok(field.fieldTail.includes("for this exact 2022 Ford F250 Crew Cab (truck)"), "the vehicle context is carried across");
  assert.equal(field.prompt, field.creativeField + field.fieldTail);
});

test("the WHOLE model-facing prompt carries no object-schema, topology or negative word", () => {
  const field = buildFieldPromptV2(DEPLOYED_PROMPT);
  assert.doesNotThrow(() => assertFieldPromptClean(field.prompt));
  for (const { word } of FORBIDDEN_IN_FIELD_PROMPT) {
    assert.throws(() => assertFieldPromptClean(`${field.prompt}\n${word} appears here`), new RegExp(`forbidden framing "${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`), word);
  }
  // the exemptions are exactly the production creative literals, and the unswapped deployed creative is convicted
  assert.deepEqual([...APPROVED_CREATIVE_PHRASES], ["wet-look surface", "never an on-vehicle photograph", "color story, layout, graphic motifs"]);
  assert.throws(() => assertFieldPromptClean(field.creative), /forbidden framing/);
  // whole-word: "whole" is not "hole", "plates" is not "panel"
  assert.doesNotThrow(() => assertFieldPromptClean("the whole field of faceted plates"));
});

test("the v2 tail is thirds, no negatives, under the ceiling, and passes the v1 tail guard too", () => {
  const tail = fieldContractV2(buildFieldPromptV2(DEPLOYED_PROMPT).deployedTail);
  assert.doesNotThrow(() => assertFieldTailClean(tail));
  for (const { word } of FORBIDDEN_IN_FIELD_TAIL) assert.throws(() => assertFieldTailClean(`${tail}\n${word} appears here`), undefined, word);
  assert.ok(tail.includes("THE UPPER THIRD"));
  assert.ok(tail.includes("THE MIDDLE THIRD"));
  assert.ok(tail.includes("THE LOWER THIRD"));
  assert.ok(!/MOVEMENT/.test(tail), "the v1 movement language is gone");
  assert.ok(/UPPER THIRD[^\n]*left to right\./.test(tail));
  assert.ok(/MIDDLE THIRD[^\n]*right to left\./.test(tail));
  assert.ok(tail.includes("company name whole and legible inside it"));
  assert.ok(!/\b(do not|never a|avoid|no drawn)\b/i.test(tail));
  assert.ok(tail.length <= 1400);
  const swapped = fieldContractV2(buildFieldPromptV2(DEPLOYED_PROMPT).deployedTail, { noseEdge: { driver: "right", passenger: "left" } });
  assert.ok(/UPPER THIRD[^\n]*right to left\./.test(swapped));
});

test("the v2 request carries exactly one text part and zero structural images", () => {
  const { request } = buildFieldRequestV2({ prompt: "p", model: "gemini-3-pro-image" });
  assert.equal(request.partCount, 1);
  assert.equal(request.modelInputImageCount, 0);
  assert.deepEqual(request.generationConfig, { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "4K" } });
  assert.throws(
    () => buildFieldRequestV2({ prompt: "p", model: "m", referenceParts: [{ text: "not an image" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] }),
    /structural image/,
  );
  const withRef = buildFieldRequestV2({ prompt: "p", model: "m", referenceParts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] });
  assert.equal(withRef.request.modelInputImageCount, 1);
  assert.equal(withRef.request.customerReferenceCount, 1);
});

test("the per-file branding inspection is record only, binds to the file hash, and fails open", async () => {
  assert.equal(INSPECTION_MODEL, "gemini-2.5-flash");
  const prompt = brandingInspectionPrompt("abc", "Precision Climate Solutions");
  assert.ok(prompt.includes('"inspectionId":"abc"'));
  assert.ok(prompt.includes("Precision Climate Solutions"));
  assert.ok(!/reject|refuse|fail|gate/i.test(prompt));
  const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: "#123456" } }).png().toBuffer();
  const noProvider = await inspectFileBranding({ provider: null, sharp, bytes: png, companyName: "X" });
  assert.equal(noProvider.disposition, "unavailable");
  assert.equal(noProvider.recordOnly, true);
  assert.equal(noProvider.fileSha256, sha256(png));
  const id = sha256(png).slice(0, 16);
  const provider = { generateRaw: async ({ body }) => {
    assert.equal(body.generationConfig.temperature, 0);
    assert.equal(body.contents[0].parts[0].inlineData.mimeType, "image/jpeg");
    return { payload: { candidates: [{ content: { parts: [{ text: JSON.stringify({ inspectionId: id, companyName: "complete", brandMark: "absent", cutAtEdge: false, evidence: "ok" }) }] } }] } };
  } };
  const r = await inspectFileBranding({ provider, sharp, bytes: png, companyName: "X" });
  assert.deepEqual([r.disposition, r.companyName, r.brandMark, r.cutAtEdge], ["inspected", "complete", "absent", false]);
  const wrong = { generateRaw: async () => ({ payload: { candidates: [{ content: { parts: [{ text: JSON.stringify({ inspectionId: "other", companyName: "complete" }) }] } }] } }) };
  assert.equal((await inspectFileBranding({ provider: wrong, sharp, bytes: png, companyName: "X" })).disposition, "unavailable");
});

test("the REAL extractor cuts six distinct canonical files from a synthetic field at the v2 sizes", async () => {
  const f = buildFieldTerritoriesV2(legacy());
  f.geometryResolution = { contract: "designpro.genie-manifest.v1", genieManifestId: "0".repeat(32), genieManifestHash: "a".repeat(64), state: "measured", productionEligible: true };
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
  assert.equal(bleed.fullBleedCompliantCount, 6);
  const panels = [];
  await atlas.cutCallOnePanels(master, f, sha256(master), { onPanel: async (p) => { panels.push(p); } });
  assert.equal(panels.length, 6);
  assert.equal(new Set(panels.map((p) => p.contentHash)).size, 6);
  const px = Object.fromEntries(panels.map((p) => [p.surfaceKey, [p.pixelWidth, p.pixelHeight]]));
  assert.deepEqual(px.driver, [3371, 1365]);
  assert.deepEqual(px.passenger, [3371, 1365]);
  for (const p of panels) {
    const z = f.zones.find((q) => q.surfaceKey === p.surfaceKey);
    assert.deepEqual([p.pixelWidth, p.pixelHeight], [z.w, z.h]);
    assert.equal(p.method, "deterministic_atlas_crop");
    assert.equal(p.deterministic, true);
    assert.equal(p.sourceMasterHash, sha256(master));
    assert.equal(p.genieManifestHash, "a".repeat(64));
    assert.equal(p.bleedInches, 5);
    assert.equal(p.effectivePpi, z.effectivePpi);
  }
  assert.deepEqual(panels.map((p) => p.surfaceKey), ["driver", "passenger", "hood", "front", "rear", "roof"], "PANEL_EXTRACTION_ORDER, driver first");
});
