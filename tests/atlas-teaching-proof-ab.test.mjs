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
