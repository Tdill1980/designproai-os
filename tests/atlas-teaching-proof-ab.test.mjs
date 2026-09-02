// TEST 1's INSTRUMENT, LOCKED.
//
// The owner's black-field A/B is only a measurement if the variant is provably
// a ONE-VARIABLE change: every artwork pixel inside all six panels preserved,
// every label and relative placement preserved, and nothing altered except
// near-black pixels in the separation/background field. "We only changed one
// thing" is a claim; these assertions are what make it a fact.
//
// They also stand guard the other way. The production teaching proof is
// hash-pinned here, so a session that quietly swapped, re-encoded or removed
// the owner's Flamingo bytes fails this suite — the variant builder refuses any
// input that is not the pinned proof, and the A/B refuses to run without it.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CANVAS,
  DARK_MAX,
  NEUTRAL,
  PANEL_RECTS,
  SOURCE_BYTES,
  SOURCE_PATH,
  SOURCE_SHA256,
  buildNeutralFieldVariant,
} from "../scripts/atlas-teaching-proof-variant.mjs";
import { buildAtlasCall1Prompt } from "../scripts/build-atlas-call1-prompt.mjs";
import { resolveEsbuild } from "../scripts/build-control-prompt.mjs";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const examples = require("../runtime/flat-atlas-topology-examples.cjs");
const edgeSource = readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const sourceBytes = readFileSync(new URL(`../${SOURCE_PATH}`, import.meta.url));

test("the bundled teaching proof is still the owner's exact pinned bytes", () => {
  assert.equal(sha256(sourceBytes), SOURCE_SHA256);
  assert.equal(sourceBytes.length, SOURCE_BYTES);
  // The runtime loader and the deployed edge must agree with the pin, or the
  // A/B's control arm is not the request production sends.
  const bundled = examples.loadBundledAtlasTeachingProof();
  assert.equal(bundled.identity.flattenedTopViewContentHash, SOURCE_SHA256);
  assert.equal(bundled.identity.flattenedTopViewByteSize, SOURCE_BYTES);
  assert.ok(edgeSource.includes(`const ATLAS_TEACHING_PROOF_HASH = "${SOURCE_SHA256}"`),
    "the deployed edge function's hash pin no longer names the owner proof");
  assert.ok(edgeSource.includes(`const ATLAS_TEACHING_PROOF_BYTES = ${SOURCE_BYTES}`));
});

test("the variant changes ONE variable: near-black outside the panels, nothing else", async () => {
  const { bytes, report } = await buildNeutralFieldVariant(sourceBytes, { sharp });

  assert.equal(report.sourceSha256, SOURCE_SHA256);
  assert.notEqual(report.variantSha256, SOURCE_SHA256, "the variant is identical to the source — nothing is being tested");
  assert.deepEqual(report.canvas, CANVAS);
  assert.equal(report.changedInsidePanels, 0);
  assert.equal(report.changedThatWereNotNearBlack, 0);
  assert.equal(report.changedPixelsVerified, report.recolouredPixels);
  assert.ok(report.recolouredPixels > 100_000, `only ${report.recolouredPixels} background pixels changed`);
  assert.ok(report.darkPixelsPreservedInsidePanels > 0, "no dark artwork pixel survived inside the panels");

  // Re-derive the invariants from the encoded output rather than trusting the
  // builder's own report.
  const src = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(
    { w: out.info.width, h: out.info.height, c: out.info.channels },
    { w: src.info.width, h: src.info.height, c: src.info.channels },
  );
  const { width, height, channels } = src.info;
  const inPanel = (x, y) => PANEL_RECTS.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);

  let insideDiffs = 0;
  let outsideNonBlackDiffs = 0;
  let neutralised = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      let differs = false;
      for (let c = 0; c < channels; c += 1) if (src.data[i + c] !== out.data[i + c]) { differs = true; break; }
      if (!differs) continue;
      if (inPanel(x, y)) { insideDiffs += 1; continue; }
      const wasDark = src.data[i] < DARK_MAX && src.data[i + 1] < DARK_MAX && src.data[i + 2] < DARK_MAX;
      if (!wasDark) { outsideNonBlackDiffs += 1; continue; }
      if (out.data[i] === NEUTRAL[0] && out.data[i + 1] === NEUTRAL[1] && out.data[i + 2] === NEUTRAL[2]) neutralised += 1;
    }
  }
  assert.equal(insideDiffs, 0, `${insideDiffs} pixels changed inside a panel — artwork is not preserved`);
  assert.equal(outsideNonBlackDiffs, 0, `${outsideNonBlackDiffs} non-near-black pixels changed — labels or field tone were altered`);
  assert.equal(neutralised, report.recolouredPixels);

  // The field really was black, and really is not any more. Measured on the
  // outer band beside the driver flank, which is where the strongest signal is.
  const band = { x0: 0, y0: 0, x1: PANEL_RECTS.find((r) => r.key === "driver").x0 - 1, y1: height - 1 };
  const darkShare = (buf) => {
    let dark = 0; let n = 0;
    for (let y = band.y0; y <= band.y1; y += 1) {
      for (let x = band.x0; x <= band.x1; x += 1) {
        const i = (y * width + x) * channels;
        n += 1;
        if (buf[i] < DARK_MAX && buf[i + 1] < DARK_MAX && buf[i + 2] < DARK_MAX) dark += 1;
      }
    }
    return dark / n;
  };
  assert.ok(darkShare(src.data) > 0.5, "the production proof's outer band is not predominantly black — the premise of the test is wrong");
  assert.ok(darkShare(out.data) < 0.02, "the variant's outer band is still black — the variable did not move");
});

test("the variant builder refuses anything that is not the owner's proof", async () => {
  const notTheProof = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#000000" } }).png().toBuffer();
  await assert.rejects(
    () => buildNeutralFieldVariant(notTheProof, { sharp }),
    /source is not the owner proof/,
  );
});

test("the A/B executes the DEPLOYED Call-1 assembly, never a re-description of it", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "atlas-call1-slice-"));
  const bundle = buildAtlasCall1Prompt({ outDir, esbuild: resolveEsbuild() });
  const sliced = readFileSync(join(outDir, "atlas-call1-prompt.ts"), "utf8");
  const mod = await import(`file://${bundle}`);

  // The lifted region is the edge function's own bytes, not a paraphrase.
  const region = sliced.slice(sliced.indexOf("export function buildAtlasCall1Prompt"));
  assert.ok(region.includes("atlasFlatMaster: true"), "the lifted region is not the flat-master branch");
  assert.ok(edgeSource.includes('    const authoringMode = String(body.authoringMode || "commercial") === "restyle" ? "restyle" : "commercial";'));
  assert.ok(region.includes('    const authoringMode = String(body.authoringMode || "commercial") === "restyle" ? "restyle" : "commercial";'),
    "the lifted region drifted from the deployed source");

  // Both model-facing text parts came out of the deployed file verbatim.
  assert.ok(edgeSource.includes(JSON.stringify(mod.TEACHING_REFERENCE_TEXT).slice(1, -1).replace(/\\"/g, '"'))
    || edgeSource.includes(mod.TEACHING_REFERENCE_TEXT));
  assert.ok(edgeSource.includes(mod.TARGET_GUIDE_TEXT));
  assert.match(mod.TEACHING_REFERENCE_TEXT, /^LABELED A\.T\.L\.A\.S\. TEACHING REFERENCE\./);
  assert.match(mod.TARGET_GUIDE_TEXT, /^CURRENT TARGET GUIDE/);
  assert.equal(mod.AUTHORING_MODEL, "gemini-3-pro-image");

  // And it runs: the real production assembly, on a canonical panel set.
  const panels = [
    ["Driver Side", "DS", "right-flank"],
    ["Passenger Side", "PS", "left-flank"],
    ["Hood", "HD", "center-column"],
    ["Roof", "RF", "center-column"],
    ["Front", "FR", "center-column"],
    ["Rear", "RR", "center-column"],
  ].map(([label, surfaceId, placement]) => ({
    label,
    surfaceId,
    placement,
    normalized: { x: 0.1, y: 0.1, width: 0.2, height: 0.3, orientation: "upright" },
  }));
  const assembled = mod.buildAtlasCall1Prompt({
    authoringMode: "commercial",
    prompt: "Bold commercial HVAC wrap.",
    finish: "Gloss",
    industryType: "HVAC",
    vehicleYear: "2022",
    vehicleMake: "Ford",
    vehicleModel: "F250 Crew Cab",
    vehicleType: "truck",
    panels,
    visionboard_intent: "style_inspiration",
  });
  assert.ok(assembled.prompt.length > 2000, `the assembled prompt is only ${assembled.prompt.length} chars`);
  assert.equal(assembled.panels.length, 6);
  assert.ok(assembled.prompt.includes("F250 Crew Cab"));
});

// ── TEST 2's INSTRUMENT ────────────────────────────────────────────────────
// The guide ablation is only an ablation if exactly the guide pair leaves and
// nothing else moves. These convict every way that could quietly stop being
// true: a shared part drifting between arms, the wrong pair removed, arm B
// still carrying a guide, or the teaching proof moving.
const ablation = await import("../scripts/atlas-guide-ablation-ab.mjs");

const ablationInput = (overrides = {}) => ({
  prompt: "P".repeat(4587),
  teachingReferenceText: "LABELED A.T.L.A.S. TEACHING REFERENCE. This example shows …",
  targetGuideText: "CURRENT TARGET GUIDE — this final neutral mask alone controls …",
  teachingBytes: sourceBytes,
  guideBytes: Buffer.from("a-neutral-six-rectangle-mask"),
  model: "gemini-3-pro-image",
  ...overrides,
});

test("Test 2 removes exactly the target-guide pair and nothing else", () => {
  const { requests } = ablation.buildAblationRequests(ablationInput());

  assert.equal(requests.A.partCount, 5, "arm A is not the deployed 5-part request");
  assert.equal(requests.B.partCount, 3, "arm B is not the 3-part ablation");
  assert.equal(requests.A.modelInputImageCount, 2);
  assert.equal(requests.B.modelInputImageCount, 1);

  for (let i = 0; i < 3; i += 1) {
    assert.equal(requests.A.parts[i].sha256, requests.B.parts[i].sha256, `part ${i} drifted between arms`);
  }
  assert.equal(requests.A.promptChars, requests.B.promptChars);
  assert.equal(requests.A.parts[2].sha256, SOURCE_SHA256, "the teaching proof is not the owner's pinned bytes");
  assert.equal(requests.B.parts[2].sha256, SOURCE_SHA256);
  assert.match(requests.A.parts[3].preview, /^CURRENT TARGET GUIDE/);
  assert.equal(requests.A.parts[4].kind, "image");

  // The removed pair is the guide, and only the guide.
  const removed = requests.A.parts.slice(3);
  assert.equal(removed.length, 2);
  assert.ok(!requests.B.parts.some((p) => removed.some((r) => r.sha256 === p.sha256)));

  assert.deepEqual(requests.A.generationConfig, {
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig: { aspectRatio: "1:1", imageSize: "4K" },
  });
  assert.deepEqual(requests.B.generationConfig, requests.A.generationConfig);
});

test("Test 2 refuses a request that is not the ablation it claims to be", () => {
  // The teaching proof swapped for something else.
  assert.throws(
    () => ablation.buildAblationRequests(ablationInput({ teachingBytes: Buffer.from("not the proof") })),
    /the teaching proof moved/,
  );
  // The wrong pair targeted for removal.
  assert.throws(
    () => ablation.buildAblationRequests(ablationInput({ targetGuideText: "SOME OTHER INSTRUCTION" })),
    /part 3 is not the target-guide instruction/,
  );
});

// ── TEST 3's INSTRUMENT ────────────────────────────────────────────────────
// The topology text must be the ONLY thing that changes, and it must carry the
// manifest's own numbers rather than a re-typed table.
const topologyAb = await import("../scripts/atlas-topology-text-ab.mjs");

const NORMALIZED = [
  ["Passenger Side", 0.0224, 0.0225, 0.2705, 0.9550],
  ["Driver Side", 0.7071, 0.0225, 0.2705, 0.9550],
  ["Rear", 0.3235, 0.6120, 0.3530, 0.1810],
  ["Roof", 0.3235, 0.2680, 0.3530, 0.3195],
  ["Hood", 0.3235, 0.0225, 0.3530, 0.2210],
  ["Front", 0.3235, 0.8180, 0.3530, 0.1595],
].map(([label, x, y, width, height]) => ({ label, normalized: { x, y, width, height, orientation: "upright" } }));

test("the topology text is the manifest's own coordinates, and nothing else", () => {
  const text = topologyAb.topologyText(NORMALIZED);

  assert.match(text, /^TARGET A\.T\.L\.A\.S\. TOPOLOGY — normalized canvas coordinates \[0,1\]/);
  for (const name of ["PASSENGER", "DRIVER", "REAR", "ROOF", "HOOD", "FRONT"]) {
    assert.match(text, new RegExp(`^${name}: +[\\d.]+, [\\d.]+, [\\d.]+, [\\d.]+$`, "m"), `${name} row missing or malformed`);
  }
  // x1/y1 are x+width and y+height, at the manifest's own four decimals.
  assert.match(text, /^DRIVER: +0\.7071, 0\.0225, 0\.9776, 0\.9775$/m);
  assert.match(text, /^PASSENGER: +0\.0224, 0\.0225, 0\.2929, 0\.9775$/m);

  // No vehicle-anatomy prose, no negatives, no creative direction rode in.
  for (const word of ["wheel", "window", "arch", "glass", "door", "bumper", "vehicle", "truck", "do not", "never"]) {
    assert.ok(!text.toLowerCase().includes(word), `the topology block smuggled in "${word}"`);
  }
  assert.ok(text.length < 500, `the topology block is ${text.length} chars — it is meant to be compact`);

  assert.throws(() => topologyAb.topologyText(NORMALIZED.slice(1)), /no normalized rect for Passenger Side/);
});

test("Test 3 adds the topology text and changes nothing else", () => {
  const { requests } = topologyAb.buildTopologyRequests({
    prompt: "P".repeat(4587),
    teachingReferenceText: "LABELED A.T.L.A.S. TEACHING REFERENCE. This example shows …",
    teachingBytes: sourceBytes,
    topology: topologyAb.topologyText(NORMALIZED),
    model: "gemini-3-pro-image",
  });

  assert.equal(requests.A.partCount, 3, "arm A is not test 2's guide-absent control");
  assert.equal(requests.B.partCount, 4);
  // The teaching proof is the only image in EITHER arm — the guide stays gone.
  assert.equal(requests.A.modelInputImageCount, 1);
  assert.equal(requests.B.modelInputImageCount, 1);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(requests.A.parts[i].sha256, requests.B.parts[i].sha256, `part ${i} drifted between arms`);
  }
  assert.equal(requests.A.parts[2].sha256, SOURCE_SHA256);
  assert.equal(requests.A.promptChars, requests.B.promptChars);
  assert.match(requests.B.parts[3].preview, /^TARGET A\.T\.L\.A\.S\. TOPOLOGY/);
  // The whole difference between the two bodies is one appended text part —
  // computed, not a magic constant, because the block carries an em dash (3
  // UTF-8 bytes) and newlines that JSON escapes.
  const appended = Buffer.byteLength(`,${JSON.stringify({ text: topologyAb.topologyText(NORMALIZED) })}`, "utf8");
  assert.equal(
    requests.B.modelRequestByteSize - requests.A.modelRequestByteSize,
    appended,
    "arm B differs from arm A by more than the topology part",
  );
});

test("Test 3 refuses a request that is not the topology addition it claims to be", () => {
  const base = {
    prompt: "P".repeat(4587),
    teachingReferenceText: "LABELED A.T.L.A.S. TEACHING REFERENCE. …",
    teachingBytes: sourceBytes,
    topology: topologyAb.topologyText(NORMALIZED),
    model: "gemini-3-pro-image",
  };
  assert.throws(
    () => topologyAb.buildTopologyRequests({ ...base, teachingBytes: Buffer.from("not the proof") }),
    /the teaching proof moved/,
  );
  assert.throws(
    () => topologyAb.buildTopologyRequests({ ...base, topology: "PAINT THE PANELS AS SOLID RECTANGLES" }),
    /not the normalized topology text/,
  );
});

// ── TEST 4's INSTRUMENT ────────────────────────────────────────────────────
// The reordered proof is only a one-variable change if exactly the HOOD and
// REAR blocks move, each carrying its own label, and nothing else in the image
// is touched. A label left behind would mislabel the panel that arrived — a
// second variable, and a worse one.
const reorder = await import("../scripts/atlas-teaching-proof-reorder.mjs");
const orderAb = await import("../scripts/atlas-teaching-proof-order-ab.mjs");

test("the reordered proof swaps HOOD and REAR and touches nothing else", async () => {
  const { bytes, report } = await reorder.buildReorderedTeachingProof(sourceBytes, { sharp });

  assert.equal(report.sourceSha256, SOURCE_SHA256);
  assert.notEqual(report.variantSha256, SOURCE_SHA256, "nothing moved");
  assert.deepEqual(report.centerOrderBefore, ["HOOD", "ROOF", "REAR", "FRONT"]);
  assert.deepEqual(report.centerOrderAfter, ["REAR", "ROOF", "HOOD", "FRONT"]);
  assert.equal(report.hoodBlock.movedTo, reorder.REAR_BLOCK.y0);
  assert.equal(report.rearBlock.movedTo, reorder.HOOD_BLOCK.y0);
  assert.ok(report.changedPixels > 100_000, `only ${report.changedPixels} pixels changed`);

  // Re-derive independently of the builder's own report.
  const src = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = src.info;
  assert.deepEqual({ w: out.info.width, h: out.info.height, c: out.info.channels }, { w: width, h: height, c: channels });

  const at = (x, y) => (y * width + x) * channels;
  const same = (a, ia, b, ib) => {
    for (let c = 0; c < channels; c += 1) if (a[ia + c] !== b[ib + c]) return false;
    return true;
  };

  // Flanks, ROOF and FRONT are untouched.
  let flankDiffs = 0; let roofDiffs = 0; let frontDiffs = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (same(out.data, at(x, y), src.data, at(x, y))) continue;
      if (x < reorder.CENTER_X.x0 || x > reorder.CENTER_X.x1) { flankDiffs += 1; continue; }
      if (y >= reorder.ROOF_REGION.y0 && y <= reorder.ROOF_REGION.y1) roofDiffs += 1;
      if (y >= reorder.FRONT_REGION.y0 && y <= reorder.FRONT_REGION.y1) frontDiffs += 1;
    }
  }
  assert.equal(flankDiffs, 0, "a pixel outside the centre column changed — Driver/Passenger moved");
  assert.equal(roofDiffs, 0, "the ROOF region changed");
  assert.equal(frontDiffs, 0, "the FRONT region changed");

  // Each relocated block is its source block, pixel for pixel — artwork AND its
  // label travelled together.
  const movedBlockMatches = (block, destY0) => {
    for (let n = 0; n <= block.y1 - block.y0; n += 1) {
      for (let x = reorder.CENTER_X.x0; x <= reorder.CENTER_X.x1; x += 1) {
        if (!same(out.data, at(x, destY0 + n), src.data, at(x, block.y0 + n))) return false;
      }
    }
    return true;
  };
  assert.ok(movedBlockMatches(reorder.REAR_BLOCK, reorder.HOOD_BLOCK.y0), "the REAR block was altered in transit");
  assert.ok(movedBlockMatches(reorder.HOOD_BLOCK, reorder.REAR_BLOCK.y0), "the HOOD block was altered in transit");
});

test("the reorder builder refuses anything that is not the owner's proof", async () => {
  const notTheProof = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#000000" } }).png().toBuffer();
  await assert.rejects(
    () => reorder.buildReorderedTeachingProof(notTheProof, { sharp }),
    /source is not the owner proof/,
  );
});

test("Test 4 swaps only the teaching image, and both arms keep one image", async () => {
  const { bytes } = await reorder.buildReorderedTeachingProof(sourceBytes, { sharp });
  const base = {
    prompt: "P".repeat(4587),
    teachingReferenceText: "LABELED A.T.L.A.S. TEACHING REFERENCE. …",
    teachingBytes: sourceBytes,
    reorderedBytes: bytes,
    model: "gemini-3-pro-image",
  };
  const { requests } = orderAb.buildReorderRequests(base);

  assert.equal(requests.A.partCount, 3);
  assert.equal(requests.B.partCount, 3);
  assert.equal(requests.A.modelInputImageCount, 1, "the guide came back into arm A");
  assert.equal(requests.B.modelInputImageCount, 1, "the guide came back into arm B");
  assert.equal(requests.A.parts[0].sha256, requests.B.parts[0].sha256);
  assert.equal(requests.A.parts[1].sha256, requests.B.parts[1].sha256);
  assert.notEqual(requests.A.parts[2].sha256, requests.B.parts[2].sha256);
  assert.equal(requests.A.parts[2].sha256, SOURCE_SHA256);
  assert.equal(requests.A.promptChars, requests.B.promptChars);

  // Arm B carrying the pinned bytes would mean nothing was swapped.
  assert.throws(
    () => orderAb.buildReorderRequests({ ...base, reorderedBytes: sourceBytes }),
    /arm B carries the unmodified proof/,
  );
  assert.throws(
    () => orderAb.buildReorderRequests({ ...base, teachingBytes: Buffer.from("not the proof") }),
    /arm A is not the owner's pinned teaching proof/,
  );
});

// ── TEST 5's INSTRUMENT ────────────────────────────────────────────────────
// One clause of the flat-master output contract, reframed from vehicle anatomy
// to print media (RULE 0.32). The whole experiment rests on that clause being
// the ONLY difference, so these convict a second edit, a clause that is not
// found, a missing guide, or a moved teaching proof.
const objectClause = await import("../scripts/atlas-object-clause-ab.mjs");

test("the clause is the owner's exact wording, and carries no negative", () => {
  assert.equal(objectClause.ANATOMY_CLAUSE, "the complete flattened panel layout of the vehicle");
  assert.equal(
    objectClause.MEDIA_CLAUSE,
    "the complete layout of the continuous rectangular printed wrap sheets, unwrapped flat before installation and trimming",
  );
  // No wheel-well language, no negatives — the owner forbade both by name.
  for (const word of ["wheel", "well", "arch", "window", "glass", "do not", "never", "avoid", "without"]) {
    assert.ok(!objectClause.MEDIA_CLAUSE.toLowerCase().includes(word), `the replacement clause smuggled in "${word}"`);
  }
});

test("Test 5 changes one clause of the deployed prompt and nothing else", () => {
  const deployedPrompt = [
    "SOME CREATIVE PREAMBLE that must not move.",
    "OUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD on one square 4K canvas.",
    `Design ONE flat wrap for this vehicle — on one sheet — ${objectClause.ANATOMY_CLAUSE}. The output is flat print artwork.`,
    "Every panel is opaque, unbroken and full-bleed to all four edges.",
  ].join("\n");

  const { requests, reframed } = objectClause.buildObjectClauseRequests({
    prompt: deployedPrompt,
    teachingReferenceText: "LABELED A.T.L.A.S. TEACHING REFERENCE. …",
    targetGuideText: "CURRENT TARGET GUIDE — this final neutral mask …",
    teachingBytes: sourceBytes,
    guideBytes: Buffer.from("a-neutral-six-rectangle-mask"),
    model: "gemini-3-pro-image",
  });

  // Both arms are the deployed shape: 5 parts, teaching proof AND guide.
  assert.equal(requests.A.partCount, 5);
  assert.equal(requests.B.partCount, 5);
  assert.equal(requests.A.modelInputImageCount, 2);
  assert.equal(requests.B.modelInputImageCount, 2);
  for (let i = 1; i < 5; i += 1) {
    assert.equal(requests.A.parts[i].sha256, requests.B.parts[i].sha256, `part ${i} drifted between arms`);
  }
  assert.equal(requests.A.parts[2].sha256, SOURCE_SHA256, "arm A is not carrying the owner's pinned teaching proof");
  assert.notEqual(requests.A.parts[0].sha256, requests.B.parts[0].sha256);

  // The reframed prompt is the deployed prompt with exactly one substring swapped.
  assert.ok(!reframed.includes(objectClause.ANATOMY_CLAUSE));
  assert.ok(reframed.includes(objectClause.MEDIA_CLAUSE));
  assert.equal(reframed.replace(objectClause.MEDIA_CLAUSE, objectClause.ANATOMY_CLAUSE), deployedPrompt);
  assert.equal(
    reframed.length - deployedPrompt.length,
    objectClause.MEDIA_CLAUSE.length - objectClause.ANATOMY_CLAUSE.length,
  );
  // Everything either side of the clause survives untouched.
  assert.ok(reframed.startsWith("SOME CREATIVE PREAMBLE that must not move."));
  assert.ok(reframed.includes("Every panel is opaque, unbroken and full-bleed to all four edges."));
});

test("Test 5 refuses a prompt that does not carry the clause exactly once", () => {
  const base = {
    teachingReferenceText: "LABELED A.T.L.A.S. TEACHING REFERENCE. …",
    targetGuideText: "CURRENT TARGET GUIDE — …",
    teachingBytes: sourceBytes,
    guideBytes: Buffer.from("guide"),
    model: "gemini-3-pro-image",
  };
  assert.throws(
    () => objectClause.buildObjectClauseRequests({ ...base, prompt: "a prompt with no such clause" }),
    /appears 0 times in the deployed prompt/,
  );
  assert.throws(
    () => objectClause.buildObjectClauseRequests({
      ...base,
      prompt: `${objectClause.ANATOMY_CLAUSE} and again ${objectClause.ANATOMY_CLAUSE}`,
    }),
    /appears 2 times in the deployed prompt/,
  );
});

test("the clause is present exactly once in the DEPLOYED assembly", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "atlas-clause-"));
  const bundle = buildAtlasCall1Prompt({ outDir, esbuild: resolveEsbuild() });
  const mod = await import(`file://${bundle}`);
  const panels = [
    ["Driver Side", "DS", "right-flank"], ["Passenger Side", "PS", "left-flank"],
    ["Hood", "HD", "center-column"], ["Roof", "RF", "center-column"],
    ["Front", "FR", "center-column"], ["Rear", "RR", "center-column"],
  ].map(([label, surfaceId, placement]) => ({
    label, surfaceId, placement, normalized: { x: 0.1, y: 0.1, width: 0.2, height: 0.3, orientation: "upright" },
  }));
  const { prompt } = mod.buildAtlasCall1Prompt({
    authoringMode: "commercial", prompt: "Bold commercial HVAC wrap.", finish: "Gloss",
    vehicleYear: "2022", vehicleMake: "Ford", vehicleModel: "F250 Crew Cab", vehicleType: "truck",
    panels, visionboard_intent: "style_inspiration",
  });
  // If the deployed contract ever stops carrying this clause, the experiment is
  // testing something that is no longer there and must fail rather than run.
  assert.equal(prompt.split(objectClause.ANATOMY_CLAUSE).length - 1, 1,
    "the deployed output contract no longer contains the anatomy clause exactly once");
});

// ── TEST 6's INSTRUMENT ────────────────────────────────────────────────────
// Erasing the six technical labels is only a one-variable change if the artwork
// and the Flamingo branding are untouchable BY CONSTRUCTION, not by care. These
// assert that, and that the labels are gone rather than ghosted — a half-erased
// label is a worse input than an intact one, because it is neither condition.
const delabel = await import("../scripts/atlas-teaching-proof-delabel.mjs");
const delabelAb = await import("../scripts/atlas-teaching-proof-delabel-ab.mjs");

test("every technical-label box is disjoint from every artwork panel", () => {
  const overlaps = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
  assert.equal(delabel.LABEL_BOXES.length, 6);
  assert.deepEqual(
    delabel.LABEL_BOXES.map((l) => l.key).sort(),
    ["DRIVER SIDE", "FRONT", "HOOD", "PASSENGER SIDE", "REAR", "ROOF"],
  );
  for (const label of delabel.LABEL_BOXES) {
    for (const panel of delabel.PANEL_RECTS) {
      assert.ok(!overlaps(label, panel), `${label.key} overlaps panel ${panel.key} — it could erase artwork`);
    }
  }
});

test("the de-labelled proof erases the six marks and nothing else", async () => {
  const { bytes, report } = await delabel.buildDelabelledTeachingProof(sourceBytes, { sharp });

  assert.equal(report.sourceSha256, SOURCE_SHA256);
  assert.notEqual(report.variantSha256, SOURCE_SHA256);
  assert.equal(report.changedInsideAnyPanel, 0);
  assert.equal(report.changedOutsideLabelBoxes, 0);
  assert.equal(report.everyLabelBoxIsUniformField, true);
  for (const key of ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "REAR", "FRONT"]) {
    assert.ok(report.erasedByLabel[key] > 500, `${key} barely changed: ${report.erasedByLabel[key]}`);
  }

  // Re-derive independently of the builder's own report.
  const src = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = src.info;
  const at = (x, y) => (y * width + x) * channels;
  const inBox = (boxes, x, y) => boxes.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);

  let outsideLabels = 0;
  let insidePanels = 0;
  let notField = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = at(x, y);
      let differs = false;
      for (let c = 0; c < channels; c += 1) if (out.data[i + c] !== src.data[i + c]) { differs = true; break; }
      if (!differs) continue;
      if (inBox(delabel.PANEL_RECTS, x, y)) insidePanels += 1;
      if (!inBox(delabel.LABEL_BOXES, x, y)) outsideLabels += 1;
      if (!(out.data[i] === 0 && out.data[i + 1] === 0 && out.data[i + 2] === 0)) notField += 1;
    }
  }
  assert.equal(insidePanels, 0, `${insidePanels} pixels changed inside a panel — artwork or branding was altered`);
  assert.equal(outsideLabels, 0, `${outsideLabels} pixels changed outside every label box`);
  assert.equal(notField, 0, `${notField} changed pixels did not become the field colour`);

  // Gone, not ghosted: no bright OR mid-grey remnant survives in any box.
  for (const label of delabel.LABEL_BOXES) {
    for (let y = label.y0; y <= label.y1; y += 1) {
      for (let x = label.x0; x <= label.x1; x += 1) {
        const i = at(x, y);
        assert.ok(out.data[i] === 0 && out.data[i + 1] === 0 && out.data[i + 2] === 0,
          `${label.key} still carries a non-field pixel at ${x},${y}`);
      }
    }
  }
});

test("the de-label builder refuses anything that is not the owner's proof", async () => {
  const notTheProof = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#000000" } }).png().toBuffer();
  await assert.rejects(
    () => delabel.buildDelabelledTeachingProof(notTheProof, { sharp }),
    /source is not the owner proof/,
  );
});

test("Test 6 swaps only the teaching image, and both arms keep one image", async () => {
  const { bytes } = await delabel.buildDelabelledTeachingProof(sourceBytes, { sharp });
  const base = {
    prompt: "P".repeat(4587),
    teachingReferenceText: "LABELED A.T.L.A.S. TEACHING REFERENCE. …",
    teachingBytes: sourceBytes,
    delabelledBytes: bytes,
    model: "gemini-3-pro-image",
  };
  const { requests } = delabelAb.buildDelabelRequests(base);
  assert.equal(requests.A.partCount, 3);
  assert.equal(requests.B.partCount, 3);
  assert.equal(requests.A.modelInputImageCount, 1);
  assert.equal(requests.B.modelInputImageCount, 1);
  assert.equal(requests.A.parts[0].sha256, requests.B.parts[0].sha256);
  assert.equal(requests.A.parts[1].sha256, requests.B.parts[1].sha256);
  assert.notEqual(requests.A.parts[2].sha256, requests.B.parts[2].sha256);
  assert.equal(requests.A.parts[2].sha256, SOURCE_SHA256);
  assert.throws(
    () => delabelAb.buildDelabelRequests({ ...base, delabelledBytes: sourceBytes }),
    /arm B carries the unmodified proof/,
  );
});

// ── TEST 7's INSTRUMENT ────────────────────────────────────────────────────
// Tiling is only a clean variable if the six panels PARTITION the canvas — no
// overlap, no remainder, no field — and each tile is nothing but its own source
// panel scaled. These assert both, and that no panel was cropped or reordered.
const { fullBleedMetrics } = await import("../scripts/atlas-fullbleed-metrics.mjs");
const tile = await import("../scripts/atlas-teaching-proof-tile.mjs");
const tileAb = await import("../scripts/atlas-teaching-proof-tile-ab.mjs");

test("the tile layout partitions the canvas exactly", () => {
  const rects = tile.tileLayout();
  assert.equal(rects.length, 6);
  const covered = new Uint8Array(tile.CANVAS.width * tile.CANVAS.height);
  for (const r of rects) {
    assert.ok(r.w >= 1 && r.h >= 1, `${r.key} tiles to ${r.w}x${r.h}`);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= tile.CANVAS.width && r.y + r.h <= tile.CANVAS.height,
      `${r.key} falls outside the canvas`);
    for (let y = r.y; y < r.y + r.h; y += 1) {
      for (let x = r.x; x < r.x + r.w; x += 1) {
        const i = y * tile.CANVAS.width + x;
        assert.equal(covered[i], 0, `${r.key} overlaps another tile at ${x},${y}`);
        covered[i] = 1;
      }
    }
  }
  assert.equal(covered.reduce((n, v) => n + (v ? 0 : 1), 0), 0, "the tiles leave canvas pixels uncovered");

  // The proof's own centre order survives — test 4 showed order is null, so it
  // must not become a second variable here.
  const centre = rects.filter((r) => r.source.column === "centre").sort((a, b) => a.y - b.y);
  assert.deepEqual(centre.map((r) => r.source.order), [1, 2, 3, 4], "the centre panels were reordered");
});

test("the tiled proof is the same six panels, scaled, with no field left", async () => {
  const { bytes, report } = await tile.buildTiledTeachingProof(sourceBytes, { sharp });

  assert.equal(report.sourceSha256, SOURCE_SHA256);
  assert.notEqual(report.variantSha256, SOURCE_SHA256);
  assert.equal(report.canvasFullyCovered, true);
  assert.equal(report.tilesOverlapping, 0);
  assert.ok(report.residualFieldShare < 0.005, `${report.residualFieldShare} of the canvas is still field`);
  assert.equal(report.tiles.length, 6);

  // Every tile grew: the point is that the artwork now reaches the boundary.
  for (const t of report.tiles) {
    assert.ok(t.to.w >= t.from.w || t.to.h >= t.from.h, `${t.key} shrank in both axes`);
  }

  // Independently, and colour-blind: the whole point of this variant is that the
  // separation field is gone, so measure it with the instrument that asks "is
  // this artwork" rather than "is this black". Counting exact (0,0,0) would
  // undercount — the proof's field is NEAR-black, only 16.7% of it is pure.
  const whole = { zones: [{ surfaceKey: "sheet", x: 0, y: 0, w: 1254, h: 1254 }] };
  const before = (await fullBleedMetrics(sourceBytes, whole, { sharp })).zones.sheet;
  const after = (await fullBleedMetrics(bytes, whole, { sharp })).zones.sheet;
  assert.ok(before.nonArtworkRatio > 0.2,
    `the source proof is only ${(before.nonArtworkRatio * 100).toFixed(1)}% non-artwork field — the premise is wrong`);
  assert.ok(after.nonArtworkRatio < 0.02,
    `the tiled proof is still ${(after.nonArtworkRatio * 100).toFixed(1)}% non-artwork field`);
  assert.ok(after.borderArtworkRatio > 0.98,
    `the tiled proof's border is only ${(after.borderArtworkRatio * 100).toFixed(1)}% artwork — it does not reach its own edges`);
});

test("the tile builder refuses anything that is not the owner's proof", async () => {
  const notTheProof = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#000000" } }).png().toBuffer();
  await assert.rejects(() => tile.buildTiledTeachingProof(notTheProof, { sharp }), /source is not the owner proof/);
});

test("Test 7 swaps only the teaching image, and both arms keep one image", async () => {
  const { bytes } = await tile.buildTiledTeachingProof(sourceBytes, { sharp });
  const base = {
    prompt: "P".repeat(4587),
    teachingReferenceText: "LABELED A.T.L.A.S. TEACHING REFERENCE. …",
    teachingBytes: sourceBytes,
    tiledBytes: bytes,
    model: "gemini-3-pro-image",
  };
  const { requests } = tileAb.buildTileRequests(base);
  assert.equal(requests.A.partCount, 3);
  assert.equal(requests.B.partCount, 3);
  assert.equal(requests.A.modelInputImageCount, 1);
  assert.equal(requests.B.modelInputImageCount, 1);
  assert.equal(requests.A.parts[0].sha256, requests.B.parts[0].sha256);
  assert.equal(requests.A.parts[1].sha256, requests.B.parts[1].sha256);
  assert.notEqual(requests.A.parts[2].sha256, requests.B.parts[2].sha256);
  assert.equal(requests.A.parts[2].sha256, SOURCE_SHA256);
  assert.throws(() => tileAb.buildTileRequests({ ...base, tiledBytes: sourceBytes }), /arm B carries the unmodified proof/);
});
