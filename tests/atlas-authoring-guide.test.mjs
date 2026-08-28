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
test("every authoring-guide label sits outside every EXTRACTION rectangle", () => {
  const svg = authoringGuideSvg(manifest).toString("utf8");
  const anchors = [...svg.matchAll(/<text\s+x="(-?\d+(?:\.\d+)?)"\s+y="(-?\d+(?:\.\d+)?)"/g)];
  assert.equal(anchors.length, (svg.match(/<text\b/gi) || []).length,
    "every label must declare an x/y anchor so its position can be proven");
  assert.ok(anchors.length > 0, "the containers must actually be labeled");
  for (const [, rawX, rawY] of anchors) {
    const x = Number(rawX);
    const y = Number(rawY);
    for (const zone of manifest.zones) {
      const cut = zone.extraction || zone;
      const inside = x > cut.x && x < cut.x + cut.w && y > cut.y && y < cut.y + cut.h;
      assert.equal(inside, false,
        `a label at ${x},${y} sits inside the ${zone.surfaceKey} extraction rectangle`);
    }
  }
});

/**
 * THE BLEED BAND IS PART OF THE CUSTOMER'S PANEL. IT IS NOT SPARE ROOM.
 *
 * For one day the caption sat in the bleed band -- inside `zone`, outside
 * `zone.trim` -- on the reasoning that the panel is "finished to trim". It is
 * not: `cutOnePanel` extracts `zone.extraction`, which is the whole container,
 * and stores the panel at PRINT size with the bleed attached.
 *
 * Live cost, request f3eb40c1 (2026-08-27): the model copied the caption off
 * the artboard, the cut carried it into the passenger panel, and the proof
 * judge -- handed that panel as artwork authority -- refused the proof with
 * "The text 'PASSENGER SIDE' and dimensions visible in the authority crop are
 * not present on the candidate proof." Four attempts, no passenger proof.
 *
 * So this asserts the band is inside the cut and that nothing is drawn there.
 */
test("no caption is drawn in a container's bleed band, which the panel cut keeps", () => {
  const svg = authoringGuideSvg(manifest).toString("utf8");
  const anchors = [...svg.matchAll(/<text\s+x="(-?\d+(?:\.\d+)?)"\s+y="(-?\d+(?:\.\d+)?)"/g)]
    .map(([, x, y]) => ({ x: Number(x), y: Number(y) }));
  for (const zone of manifest.zones) {
    const band = zone.trim.y - zone.y;
    assert.ok(band > 0, `${zone.surfaceKey} has no bleed band to test`);
    // The band is inside what the extractor cuts -- that is the whole point.
    assert.ok(zone.extraction.y <= zone.y && zone.extraction.h >= zone.h,
      `${zone.surfaceKey}'s cut no longer contains its bleed band`);
    for (const anchor of anchors) {
      const inBand = anchor.x >= zone.x && anchor.x <= zone.x + zone.w
        && anchor.y >= zone.y && anchor.y < zone.trim.y;
      assert.equal(inBand, false,
        `a caption sits in the ${zone.surfaceKey} bleed band, which prints on the customer's panel`);
    }
  }
});

test("the authoring guide names every container, and never the instructions about them", () => {
  const svg = authoringGuideSvg(manifest).toString("utf8");
  // The Surface IDs and names ARE on the model's sheet now -- that is the
  // point of a labeled container, and it is what lets the panel list in the
  // prompt ("DS — DRIVER SIDE") refer to a specific rectangle.
  for (const key of SURFACE_KEYS) {
    assert.ok(svg.includes(key.toUpperCase()),
      `the authoring artboard must caption its ${key} container`);
  }
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
  const x = Math.round(hood.trim.x + hood.trim.w / 2);
  const y = Math.round(hood.trim.y + hood.trim.h / 2);
  // ...and the bleed band, which is equally inside the panel cut.
  const bandY = Math.round(hood.y + (hood.trim.y - hood.y) / 2);
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

  const inBleedBand = {
    ...manifest,
    zones: manifest.zones.map((zone) => ({
      ...zone,
      guideFill: `#4a4a4a"/><text x="${x}" y="${bandY}" font-size="40">HOOD</text><rect fill="#4a4a4a`,
    })),
  };
  await assert.rejects(
    () => renderAtlasAuthoringGuide(inBleedBand),
    (error) => error?.code === "flat_atlas_authoring_guide_contains_text",
    "a glyph in the bleed band is a glyph in the printed panel and must fail closed",
  );
});

/**
 * THE GUTTERS ARE NOT A FIXED WIDTH, AND THE GUARD MUST MEASURE, NOT ASSUME.
 *
 * Two live refusals came out of this, both on correctly laid-out sheets. The
 * first sized the captions for one vehicle's proportions: a 190x66 side leaves
 * 74px between the passenger column and the centre stack where a 251x60 side
 * leaves 115px. The second was subtler -- the guard read each label's pad from
 * an OPTIONAL font-size capture sitting behind a lazy `[^>]*?`, which a regex
 * engine satisfies by leaving unmatched, so every caption was padded as the
 * largest type on the sheet however small it actually was.
 *
 * So this walks a spread of real vehicle proportions, wide flanks to narrow,
 * and asserts the sheet renders for all of them.
 */
test("captions fit the gutter on every vehicle proportion, not just the fixture's", async () => {
  const build = (rows) => flatFirst.buildAtlasManifest(rows.map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches, bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  })), null);
  const proportions = {
    "long flanks, small centre": [["driver", 300, 40], ["passenger", 300, 40], ["hood", 40, 40], ["roof", 40, 40], ["front", 40, 30], ["rear", 40, 40]],
    "short flanks, wide centre": [["driver", 120, 50], ["passenger", 120, 50], ["hood", 95, 90], ["roof", 95, 120], ["front", 95, 60], ["rear", 95, 70]],
    "the 190x66 van": [["driver", 190, 66], ["passenger", 190, 66], ["hood", 68, 62], ["roof", 76, 96], ["front", 84, 34], ["rear", 82, 48]],
    "the 251x60 F-250": [["driver", 251, 60], ["passenger", 251, 60], ["hood", 70, 60], ["roof", 80, 60], ["front", 70, 50], ["rear", 70, 60]],
  };
  for (const [name, rows] of Object.entries(proportions)) {
    await flatFirst.renderAtlasAuthoringGuide(build(rows));
    // And the pad the guard uses must come from the label's OWN declared size.
    const svg = flatFirst._test.authoringGuideSvg(build(rows)).toString("utf8");
    const sizes = [...svg.matchAll(/<text\s[^>]*font-size="(\d+)"/g)].map((m) => Number(m[1]));
    assert.equal(sizes.length, (svg.match(/<text\b/gi) || []).length,
      `${name}: every label must declare a font-size the guard can read`);
  }
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
