// THE MODEL'S GUIDE MUST CARRY NO READABLE TEXT, AND EVERY ZONE MUST BE OPAQUE.
//
// Generation eb7835a8-247b-443c-9804-e73f66379603 (2026-08-25, Carley's 2011
// Chevy Traverse LT) died at Call 1 after three consecutive authoring attempts,
// refused on `artifactFreeContract` -- "The hood zone contains the guide label
// 'HOOD'", "The roof zone contains the guide label 'ROOF'" -- and on
// `zoneCoverageContract` for a transparent area in the hood. Zero atlas
// revisions, zero proofs, zero panels.
//
// The cause was the input, not the gate: one guide served the model, the QC
// inspector and the design team at once, and it printed each surface's name
// across the middle of that surface at up to 180px bold. These tests lock the
// split that fixes it -- the model sees geometry, the humans and the inspector
// keep their labels -- and lock the full-bleed conviction so neither can regress
// back into a run that dies before the customer sees an image.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");

const flatFirst = require("../runtime/flat-first-atlas.cjs");
const { CANVAS, SURFACE_KEYS, PROMPT_VERSION, renderAtlasAuthoringGuide, renderAtlasGuide, _test } = flatFirst;
const { authoringGuideSvg, guideGeometrySvg, guideSvg } = _test;

const { deterministicMasterChecks } = require("../runtime/atlas-master-qc.cjs");

/** A manifest shaped like the real one: six zones, two of them rotated flanks. */
function manifestFixture() {
  const zones = [
    { surfaceKey: "passenger", x: 40, y: 300, w: 700, h: 3400, rotationDegrees: 90 },
    { surfaceKey: "driver", x: 3356, y: 300, w: 700, h: 3400, rotationDegrees: -90 },
    { surfaceKey: "rear", x: 1200, y: 200, w: 1700, h: 780, rotationDegrees: 0 },
    { surfaceKey: "roof", x: 1200, y: 1030, w: 1700, h: 1000, rotationDegrees: 0 },
    { surfaceKey: "hood", x: 1200, y: 2080, w: 1700, h: 1000, rotationDegrees: 0 },
    { surfaceKey: "front", x: 1200, y: 3130, w: 1700, h: 780, rotationDegrees: 0 },
  ].map((zone) => ({ ...zone, guideFill: "#4a4a4a" }));
  return {
    zones,
    seamContinuity: { relationships: [{ surfaces: ["hood", "roof"] }] },
    geometryAuthority: { status: "provisional" },
  };
}

const manifest = manifestFixture();

// The strings a print shop stamps on an installer map, and the ones that showed
// up painted into the artwork. None of them may reach the authoring model.
const GUIDE_ANNOTATIONS = [
  ...SURFACE_KEYS.map((key) => key.toUpperCase()),
  ...SURFACE_KEYS.map((key) => key.toLowerCase()),
  "TOPOLOGY GUIDE ONLY",
  "MUST NOT APPEAR IN ARTWORK",
  "GRAYS AND LABELS",
];

test("the authoring guide contains no text element at all", () => {
  const svg = authoringGuideSvg(manifest).toString("utf8");
  assert.equal(/<text\b/i.test(svg), false, "the model's guide must not carry a <text> element");
  assert.equal(/<tspan\b/i.test(svg), false);
  assert.equal(/font-family|font-size|letter-spacing/i.test(svg), false,
    "typography attributes mean glyphs are being drawn for the model to copy");
});

test("no surface name, dimension or annotation can reach the authoring model", () => {
  const svg = authoringGuideSvg(manifest).toString("utf8");
  for (const annotation of GUIDE_ANNOTATIONS) {
    assert.equal(svg.includes(annotation), false,
      `the authoring guide leaked the annotation ${JSON.stringify(annotation)}`);
  }
  // Inch marks, square footage and PPI callouts are the other things a human map
  // carries. Nothing renders as glyphs at all here, so read every text node the
  // document actually has and assert the set is empty -- that covers dimensions,
  // resolutions and any annotation a later edit might invent.
  const renderedText = [...svg.matchAll(/<(?:text|tspan)\b[^>]*>([\s\S]*?)<\/(?:text|tspan)>/gi)]
    .map((match) => match[1].trim()).filter(Boolean);
  assert.deepEqual(renderedText, [],
    `the authoring guide renders text the model can copy: ${renderedText.join(" | ")}`);
});

test("the labelled admin guide keeps every annotation the design team reads", () => {
  const svg = guideSvg(manifest).toString("utf8");
  for (const key of SURFACE_KEYS) {
    assert.equal(svg.includes(key.toUpperCase()), true,
      `the human installer map lost its ${key} label`);
  }
  assert.match(svg, /<text\b/);
  assert.match(svg, /TOPOLOGY GUIDE ONLY/);
});

test("both guides are rendered from one identical geometry authority", () => {
  const geometry = guideGeometrySvg(manifest);
  assert.equal(authoringGuideSvg(manifest).toString("utf8").includes(geometry), true);
  assert.equal(guideSvg(manifest).toString("utf8").includes(geometry), true);
  // Topology is preserved exactly: every zone box and fill survives the split.
  for (const zone of manifest.zones) {
    assert.equal(
      geometry.includes(`x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}"`),
      true,
      `${zone.surfaceKey} geometry is missing from the shared authority`,
    );
  }
});

test("the two renders differ only by the annotations, and the authoring one is the plainer", async () => {
  const [authoring, labelled] = await Promise.all([
    renderAtlasAuthoringGuide(manifest), renderAtlasGuide(manifest),
  ]);
  assert.notEqual(authoring.equals(labelled), true, "the model must not be handed the labelled map");
  const [a, b] = await Promise.all([
    sharp(authoring).metadata(), sharp(labelled).metadata(),
  ]);
  assert.equal(a.width, CANVAS.widthPx);
  assert.equal(a.height, CANVAS.heightPx);
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  // Glyphs are ink. The labelled map must carry strictly more distinct tones
  // than the geometry-only render, which is the pixel-level statement that the
  // authoring copy has had annotation removed rather than merely relabelled.
  const distinct = async (bytes) => {
    const stats = await sharp(bytes).greyscale().stats();
    return stats.channels[0].stdev;
  };
  assert.ok(await distinct(labelled) > await distinct(authoring),
    "the labelled guide should carry more tonal variation than the glyph-free one");
});

test("reintroducing text on the authoring path fails the run instead of authoring", async () => {
  // The renderer's own fail-closed guard. A future edit that puts a glyph back
  // must stop the run here, not produce another sheet with HOOD painted on it.
  const withText = {
    ...manifest,
    zones: manifest.zones.map((zone) => ({ ...zone, guideFill: '#4a4a4a"/><text x="10" y="10">HOOD</text><rect fill="#4a4a4a' })),
  };
  await assert.rejects(
    () => renderAtlasAuthoringGuide(withText),
    (error) => error?.code === "flat_atlas_authoring_guide_contains_text",
  );
});

test("the solid-panel output contract lives in the edge function's flat contract", () => {
  // The runtime assembles no creative text (owner directive 2026-08-27); the
  // full-bleed rule rides the deployed design-panel-ai-generate atlas-artboard
  // handler instead, stated once and positively.
  const { readFileSync } = require("node:fs");
  const edge = readFileSync(new URL("../supabase/functions/_shared/atlas-artboard-prompt.ts", import.meta.url), "utf8");
  assert.match(edge, /ONE SOLID RECTANGLE of continuous wrap artwork, opaque corner to corner/);
  assert.match(edge, /outside the rectangles the canvas stays blank/i);
  // Zone identity reaches the model as the labeled GENIE panel list.
  assert.match(edge, /panelLines/);
});

test("the prompt version moved off v6, so masters authored with the labelled guide are refused", () => {
  const { readFileSync } = require("node:fs");
  const atlasSource = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  assert.match(atlasSource, /designpro-flat-first-atlas-20260827\.v10-edge/);
  assert.doesNotMatch(atlasSource, /PROMPT_VERSION = "designpro-flat-first-atlas-20260824\.v6"/);
});
