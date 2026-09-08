import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// sharp is installed under runtime/, not at the repo root.
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const authoring = require("../runtime/atlas-panel-authoring.cjs");
const { assertPanelAncestry } = require("../runtime/production-provenance.cjs");

const runtimeSrc = fs.readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const edgeSrc = fs.readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");

/** A solid sheet of artwork at a given size. No holes. */
async function solid(width, height, colour = { r: 40, g: 120, b: 200 }) {
  return sharp({ create: { width, height, channels: 4, background: { ...colour, alpha: 255 } } })
    .png().toBuffer();
}

/** The same sheet with a black disc punched out of it — a wheel-well cutout. */
async function holed(width, height, radius) {
  const cx = Math.round(width / 2);
  const cy = Math.round(height / 2);
  const disc = Buffer.from(
    `<svg width="${width}" height="${height}"><circle cx="${cx}" cy="${cy}" r="${radius}" fill="#000000"/></svg>`,
  );
  return sharp(await solid(width, height))
    .composite([{ input: disc }])
    .png().toBuffer();
}

function panelFixture(bytes, { width, height, surfaceKey = "driver" }) {
  return {
    surfaceKey,
    bytes,
    contentHash: "a".repeat(64),
    pixelWidth: width,
    pixelHeight: height,
  };
}

test("the finishing pass is OFF unless the flag says on, and a bad value fails safe", () => {
  // The flag lives in the runtime, so this reads the real gate rather than a
  // copy of it. A misspelling must resolve OFF -- the same direction
  // DESIGNPRO_STANDARD_TRANSPORT fails, for the same reason.
  assert.match(
    runtimeSrc,
    /String\(process\.env\.DESIGNPRO_ATLAS_PANEL_FINISH \|\| ""\)\.trim\(\)\.toLowerCase\(\) !== "on"/,
  );
  const gate = runtimeSrc.slice(runtimeSrc.indexOf("function atlasPanelFinisher("));
  assert.match(gate.slice(0, 600), /return null;/,
    "an unset or misspelled flag must return no finisher at all");
});

test("cutCallOnePanels without a finisher is byte-for-byte the deterministic crop", () => {
  // The finishing hook is optional and the resume path passes nothing, so the
  // default branch must still stamp the deterministic provenance. If this ever
  // flips, every historical panel's ancestry claim changes meaning.
  assert.match(runtimeSrc, /method: "deterministic_atlas_crop",\s*\n\s*deterministic: true,/);
  assert.match(runtimeSrc, /if \(typeof finishPanel === "function"\) \{/);
  const hook = runtimeSrc.slice(
    runtimeSrc.indexOf('if (typeof finishPanel === "function") {'),
    runtimeSrc.indexOf("panels.push(panel);"),
  );
  assert.match(hook, /finish\?\.applied === true && finish\.bytes\?\.length/,
    "only an APPLIED finish may replace the crop");
});

test("the finished panel is substituted BEFORE it is released, never after", () => {
  // Everything downstream binds to contentHash -- the persisted bytes, the
  // PanelPro row, the proof's artwork authority. Finishing after onPanel would
  // publish one panel and print another.
  const loop = runtimeSrc.slice(
    runtimeSrc.indexOf("for (const surfaceKey of PANEL_EXTRACTION_ORDER)"),
    runtimeSrc.indexOf("async function cutOnePanel(surfaceKey)"),
  );
  const finished = loop.indexOf('if (typeof finishPanel === "function")');
  const released = loop.indexOf("await onPanel(panel,");
  assert.ok(finished > 0 && released > finished,
    "the finishing pass must run before the panel is released to the graph");
});

test("PASSENGER IS AUTHORED FROM DRIVER, NEVER MIRRORED FROM IT", () => {
  // The owner's sketch said "then flipped passenger". A horizontal flip
  // mirrors every letterform, so a phone number would print backwards down the
  // flank -- and RULE 0 already forbids mirrored Driver pixels standing in for
  // Passenger. The cascade delivers the same intent by SHOWING Driver to
  // Passenger's own authoring pass.
  assert.deepEqual(authoring.PANEL_NEIGHBOURS.passenger, ["driver"]);
  assert.deepEqual(authoring.PANEL_NEIGHBOURS.driver, []);
  const module = fs.readFileSync(new URL("../runtime/atlas-panel-authoring.cjs", import.meta.url), "utf8");
  assert.doesNotMatch(module, /\.flop\(\)|\bmirrorPassenger|flip: true/,
    "the finishing module must never mirror one surface into another");
});

test("the cascade shows each surface the sheets that most constrain it", () => {
  assert.deepEqual(authoring.PANEL_CASCADE_ORDER,
    ["driver", "passenger", "hood", "roof", "front", "rear"]);
  // Both flanks reach every centre surface: they carry the design's identity,
  // so the centre four are composed against them rather than against each other.
  for (const centre of ["hood", "roof", "front", "rear"]) {
    const seen = authoring.PANEL_NEIGHBOURS[centre];
    assert.ok(seen.includes("driver") && seen.includes("passenger"),
      `${centre} must be shown both flanks`);
    assert.ok(seen.length <= 3, `${centre} must stay inside the model-request budget`);
  }
});

test("a candidate returned at the wrong proportion is refused, and the crop wins", async () => {
  // The edge deliberately asks for NO aspect ratio so the edit follows its
  // input. This is where that assumption is checked instead of trusted: a
  // 4.2:1 flank answered at 1:1 is a different shape, not a rounding error.
  const panel = panelFixture(await solid(2100, 500), { width: 2100, height: 500 });
  const square = await solid(1024, 1024);
  const verdict = await authoring._test.evaluateCandidate(panel, { bytes: square }, 0.05);
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /^aspect_drift:/);
});

test("a candidate that OPENS holes is refused — a finishing pass may not regress", async () => {
  const clean = await solid(800, 400);
  const panel = panelFixture(clean, { width: 800, height: 400 });
  const before = await authoring._test.holeRatio(clean);
  const worse = await holed(800, 400, 90);
  const verdict = await authoring._test.evaluateCandidate(panel, { bytes: worse }, before);
  assert.equal(verdict.accepted, false);
  assert.match(verdict.reason, /^holes_increased:/);
});

test("a candidate that CLOSES holes is accepted, resized to the exact zone rectangle", async () => {
  // Every downstream dimension, PPI and square-footage field is computed from
  // the zone, so the finished sheet has to occupy exactly the crop's pixels.
  const punched = await holed(800, 400, 90);
  const before = await authoring._test.holeRatio(punched);
  assert.ok(before > 0.05, "the fixture must actually contain a hole");
  const panel = panelFixture(punched, { width: 800, height: 400 });
  // Same proportion, different pixel count -- the model returns its own size.
  const repaired = await solid(1600, 800);
  const verdict = await authoring._test.evaluateCandidate(panel, { bytes: repaired }, before);
  assert.equal(verdict.accepted, true, verdict.reason);
  const meta = await sharp(verdict.bytes).metadata();
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 400);
  assert.ok(verdict.afterHoles < before);
});

test("every failure path returns the crop unchanged — this can never lose a run", async () => {
  const bytes = await solid(600, 300);
  const panel = panelFixture(bytes, { width: 600, height: 300 });
  // No transport at all.
  const noTransport = await authoring.finishPanel(panel, {});
  assert.equal(noTransport.applied, false);
  assert.equal(noTransport.bytes, bytes);
  assert.equal(noTransport.contentHash, panel.contentHash);

  // Transport present, edge throws on every attempt.
  let calls = 0;
  const refused = await authoring.finishPanel(panel, {
    store: { putImmutableBytes: async () => {} },
    callEdge: async () => { calls += 1; throw new Error("boom"); },
  });
  assert.equal(refused.applied, false);
  assert.equal(refused.bytes, bytes, "the deterministic crop must survive an edge failure");
  assert.equal(calls, authoring.PANEL_FINISH_ATTEMPTS, "the budget is spent, then it gives up quietly");
  assert.match(refused.reason, /^edge_failed:/);
});

test("holeRatio uses the SAME hole predicate as the master gate", () => {
  // Two definitions of "hole" would let this module accept a sheet the gate
  // convicts. CLAUDE.md makes the same point about the deterministic fill.
  const module = fs.readFileSync(new URL("../runtime/atlas-panel-authoring.cjs", import.meta.url), "utf8");
  assert.match(module, /require\("\.\/atlas-master-qc\.cjs"\)/);
  assert.match(module, /CUTOUT_ALPHA_MAX/);
  assert.match(module, /FLAT_BLACK_CHANNEL_MAX/);
});

test("production provenance accepts a FINISHED panel only with its full chain", () => {
  const base = {
    surfaceKey: "driver",
    metadata: {
      source: "atlas-call1-panel",
      promotedFrom: "atlas-call1",
      sourceStoragePath: "tenant/gen/revisions/1/panels/x.png",
      sourceContentHash: "b".repeat(64),
      sourceMasterHash: "c".repeat(64),
    },
  };
  // The deterministic crop is unchanged.
  assert.doesNotThrow(() => assertPanelAncestry({
    ...base, metadata: { ...base.metadata, deterministic: true },
  }));
  // A finished panel that names its contract AND the crop it came from.
  assert.doesNotThrow(() => assertPanelAncestry({
    ...base,
    metadata: {
      ...base.metadata,
      deterministic: false,
      panelAuthoringContract: authoring.PANEL_AUTHORING_CONTRACT,
      preFinishHash: "d".repeat(64),
    },
  }));
  // The refusal CODE is the contract downstream reads, not the prose.
  const refusalCode = (metadata) => {
    try {
      assertPanelAncestry({ ...base, metadata: { ...base.metadata, ...metadata } });
    } catch (cause) {
      return cause.code;
    }
    return "accepted";
  };
  // Neither claim: refused exactly as before this widening existed.
  assert.equal(refusalCode({ deterministic: false }), "production_ancestry_not_deterministic");
  // Contract named, but the crop behind it is not -- the chain is broken, so
  // nobody could prove what these pixels were finished from.
  assert.equal(
    refusalCode({ deterministic: false, panelAuthoringContract: authoring.PANEL_AUTHORING_CONTRACT }),
    "production_ancestry_incomplete",
  );
  // An unknown contract is not a passport.
  assert.equal(
    refusalCode({
      deterministic: false,
      panelAuthoringContract: "designpro.some-other-thing.v9",
      preFinishHash: "d".repeat(64),
    }),
    "production_ancestry_not_deterministic",
  );
});

test("the edge finishing prompt hands the model no vehicle anatomy", () => {
  // The measured lesson this repo keeps re-learning: naming a part makes the
  // model draw it (Desert Ridge c3a8ff40 carried ten anatomy refusals and came
  // back a van elevation). The finishing text states what the sheet IS.
  const tail = edgeSrc.slice(
    edgeSrc.indexOf("function atlasPanelFinishPrompt("),
    edgeSrc.indexOf("async function handleAtlasPanel("),
  );
  assert.ok(tail.length > 0, "the finishing prompt builder must exist");
  const emitted = tail.slice(tail.indexOf("lines.push"));
  for (const forbidden of [
    "vehicle", "wheel", "window", "glass", "door", "arch", "bumper", "fender",
    "silhouette", "truck", "van", "car", "panel", "artboard", "template",
  ]) {
    // Whole words on both sides: a bare `\bcar` prefix convicts "carry", and
    // a test that fires on its own prose teaches nothing.
    assert.ok(
      !new RegExp(`\\b${forbidden}s?\\b`, "i").test(emitted),
      `the finishing prompt must not hand the image model "${forbidden}"`,
    );
  }
  assert.match(emitted, /the same composition, the same palette/);
  assert.match(emitted, /corner to corner, running off all four edges/);
  assert.match(emitted, /completed with the artwork that already surrounds it/);
});

test("the edge and the runtime finish against the same pinned contract", () => {
  assert.match(edgeSrc, /ATLAS_PANEL_PROMPT_VERSION = "atlas-panel-finish\.20260908\.v1"/);
  assert.equal(authoring.PANEL_AUTHORING_PROMPT_VERSION, "atlas-panel-finish.20260908.v1");
  // The runtime and the function ship through DIFFERENT workflows, so a
  // runtime-first deploy must refuse rather than be answered by the old edge.
  assert.match(runtimeSrc, /flat_atlas_panel_edge_prompt_version_mismatch/);
  assert.match(runtimeSrc, /flat_atlas_panel_edge_surface_mismatch/);
});

test("the atlas-panel edge mode is internal-only and makes exactly one image request", () => {
  assert.match(edgeSrc, /if \(body\?\.mode === "atlas-panel"\) \{/);
  const dispatch = edgeSrc.slice(
    edgeSrc.indexOf('if (body?.mode === "atlas-panel") {'),
    edgeSrc.indexOf("return await handleAtlasPanel(body);"),
  );
  assert.match(dispatch, /atlas_panel_internal_only/);
  const handler = edgeSrc.slice(edgeSrc.indexOf("async function handleAtlasPanel("));
  assert.match(handler, /imageRequestCount: 1,/);
  // One fetch to the model, and the subject sheet is the FIRST image -- the
  // prompt says "the first image", so an ordering change silently re-points
  // the whole instruction at a neighbour.
  assert.equal((handler.match(/await fetch\(geminiUrl/g) || []).length, 1);
  const source = handler.indexOf("attach(body.sourcePanelStoragePath");
  const neighbours = handler.indexOf("for (const neighbour of neighboursIn)");
  assert.ok(source > 0 && neighbours > source);
  // No aspect ratio is requested: an edit follows its input, and the flanks
  // are steeper than the model's aspect menu goes.
  const request = handler.slice(handler.indexOf("const modelRequest = JSON.stringify("), handler.indexOf("modelRequestByteSize"));
  assert.doesNotMatch(request, /aspectRatio/);
});
