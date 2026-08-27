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

/**
 * THE REAL BUILDER, NOT A HAND-DRAWN APPROXIMATION.
 *
 * This fixture used to hand-place six rectangles, and it put the passenger
 * flank 40px from the canvas edge -- a layout `buildAtlasManifest` cannot
 * produce (it reserves OUTER_PADDING_PX on every side) and one with no gutter
 * to caption a container in. Once the containers became labeled, that
 * impossible geometry was the only thing failing. Build the manifest the
 * product builds, so the guides are tested against the geometry they ship.
 */
function manifestFixture() {
  return flatFirst.buildAtlasManifest([
    { surfaceKey: "driver", widthInches: 251, heightInches: 60 },
    { surfaceKey: "passenger", widthInches: 251, heightInches: 60 },
    { surfaceKey: "hood", widthInches: 70, heightInches: 60 },
    { surfaceKey: "roof", widthInches: 80, heightInches: 60 },
    { surfaceKey: "front", widthInches: 70, heightInches: 50 },
    { surfaceKey: "rear", widthInches: 70, heightInches: 60 },
  ], null);
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

/**
 * ⚠️ THE RULE NARROWED ON 2026-08-27, BY THE OWNER, LOOKING AT THE LIVE MASTER:
 * "just fix so it's a true topography flattened view labeled containers."
 *
 * It used to be "the authoring guide carries no text at all". That was a proxy
 * for the thing that actually broke on 08-25, and the proxy was wider than the
 * defect: what came back painted was a surface name centred ON the rectangle
 * the model was told to paint. A caption in the empty gutter beside a
 * container is a different object, and it is doubly safe --
 * `normalizeAtlasMaster` masks the delivered sheet to the zone rectangles, so
 * anything painted in a gutter is discarded before a master exists.
 *
 * So the invariant is now positional, and it is the one worth locking: NO
 * GLYPH MAY SIT INSIDE A CONTAINER. The containers are labeled; the paint area
 * stays clean.
 */
test("every authoring-guide label sits outside every container", () => {
  const svg = authoringGuideSvg(manifest).toString("utf8");
  const anchors = [...svg.matchAll(/<text\s+x="(-?\d+(?:\.\d+)?)"\s+y="(-?\d+(?:\.\d+)?)"/g)];
  assert.equal(anchors.length, (svg.match(/<text\b/gi) || []).length,
    "every label must declare an x/y anchor so its position can be proven");
  assert.ok(anchors.length > 0, "the containers must actually be labeled");
  for (const [, rawX, rawY] of anchors) {
    const x = Number(rawX);
    const y = Number(rawY);
    for (const zone of manifest.zones) {
      const inside = x > zone.x && x < zone.x + zone.w && y > zone.y && y < zone.y + zone.h;
      assert.equal(inside, false,
        `a label at ${x},${y} sits inside the ${zone.surfaceKey} container`);
    }
  }
});

test("the authoring guide names its containers, and never the instructions about them", () => {
  const svg = authoringGuideSvg(manifest).toString("utf8");
  // The Surface IDs and names ARE on the model's sheet now -- that is the
  // point of a labeled container, and it is what lets the panel list in the
  // prompt ("DS — DRIVER SIDE") refer to a specific rectangle.
  for (const key of SURFACE_KEYS) {
    assert.ok(svg.includes(key.toUpperCase()),
      `the authoring artboard must caption its ${key} container`);
  }
  assert.match(svg, /TOPO TOP VIEW/, "the sheet must declare what it is");
  // What still may NEVER reach the model is the prose telling it what not to
  // paint -- a negative instruction rendered as pixels inside the image it is
  // warning about, which is the one prompt shape Gemini over-indexes on.
  for (const annotation of ["TOPOLOGY GUIDE ONLY", "MUST NOT APPEAR IN ARTWORK", "GRAYS AND LABELS"]) {
    assert.equal(svg.includes(annotation), false,
      `the authoring guide leaked the annotation ${JSON.stringify(annotation)}`);
  }
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

test("a glyph put back INSIDE a container fails the run instead of authoring", async () => {
  // The renderer's own fail-closed guard, aimed at the real 08-25 defect: a
  // surface name sitting ON the rectangle the model is told to paint. The
  // injected label is anchored at the centre of the hood container, which is
  // exactly where "HOOD" was when three attempts died on artifactFreeContract.
  const hood = manifest.zones.find((zone) => zone.surfaceKey === "hood");
  const x = Math.round(hood.x + hood.w / 2);
  const y = Math.round(hood.y + hood.h / 2);
  const withText = {
    ...manifest,
    zones: manifest.zones.map((zone) => ({
      ...zone,
      guideFill: `#4a4a4a"/><text x="${x}" y="${y}">HOOD</text><rect fill="#4a4a4a`,
    })),
  };
  await assert.rejects(
    () => renderAtlasAuthoringGuide(withText),
    (error) => error?.code === "flat_atlas_authoring_guide_contains_text",
  );
});

test("a label whose position cannot be read is refused rather than trusted", async () => {
  // The positional guard is only as good as its ability to LOCATE every glyph.
  // A text node that declares no x/y anchor -- or declares them in another
  // order -- cannot be proven outside a container, so it stops the run rather
  // than passing unchecked.
  const unlocatable = {
    ...manifest,
    zones: manifest.zones.map((zone) => ({
      ...zone,
      guideFill: '#4a4a4a"/><text dx="10">HOOD</text><rect fill="#4a4a4a',
    })),
  };
  await assert.rejects(
    () => renderAtlasAuthoringGuide(unlocatable),
    (error) => error?.code === "flat_atlas_authoring_guide_text_unlocatable",
  );
});

test("the solid-panel output contract lives in the edge function's flat contract", () => {
  // The runtime assembles no creative text (owner directive 2026-08-27); the
  // full-bleed rule rides the deployed design-panel-ai-generate atlas-artboard
  // handler instead, stated once and positively.
  const { readFileSync } = require("node:fs");
  const edge = readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");
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
