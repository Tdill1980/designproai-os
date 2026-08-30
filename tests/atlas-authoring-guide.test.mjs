// THE MODEL'S GUIDE MUST CARRY SIX GUTTER LABELS, AND EVERY ZONE MUST BE OPAQUE.
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
// split that fixes it -- the model sees short identity labels only outside the
// cut rectangles, while humans and QC keep the full installer annotations.

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

const FORBIDDEN_AUTHORING_ANNOTATIONS = [
  "TOPOLOGY GUIDE ONLY",
  "MUST NOT APPEAR IN ARTWORK",
  "GRAYS AND LABELS",
  "Surface ID:",
  "W:",
  "H:",
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
test("the model's guide carries exactly six short gutter labels", () => {
  const svg = authoringGuideSvg(manifest).toString("utf8");
  assert.equal((svg.match(/<text\b/gi) || []).length, SURFACE_KEYS.length);
  for (const key of SURFACE_KEYS) {
    assert.equal(svg.includes(key.toUpperCase()), true,
      `the authoring guide lost the ${key} surface name`);
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

test("the authoring guide carries names but no installer instructions or dimensions", () => {
  const svg = authoringGuideSvg(manifest).toString("utf8");
  for (const annotation of FORBIDDEN_AUTHORING_ANNOTATIONS) {
    assert.equal(svg.includes(annotation), false,
      `the authoring guide leaked ${JSON.stringify(annotation)}`);
  }
  // Six filled rectangles, six gutter labels and the canvas ground. No trim furniture.
  assert.equal((svg.match(/<rect\b/gi) || []).length, manifest.zones.length + 1,
    "the model's guide is the canvas plus exactly one rectangle per container");
  assert.equal(svg.includes("stroke-dasharray"), false);
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

test("both guides place and identify the same containers; only the human map has print furniture", () => {
  // The containers are shared — same boxes, same fills, same canvas. What
  // differs is that the installer map also carries the dashed printable-area
  // inset and the captions, and the model's guide carries neither. A mark
  // drawn INSIDE a rectangle the model is told to fill is a mark it copies.
  const authoring = authoringGuideSvg(manifest).toString("utf8");
  const human = guideSvg(manifest).toString("utf8");
  for (const zone of manifest.zones) {
    const box = `x="${zone.x}" y="${zone.y}" width="${zone.w}" height="${zone.h}"`;
    assert.equal(authoring.includes(box), true, `${zone.surfaceKey} is missing from the model's guide`);
    assert.equal(human.includes(box), true, `${zone.surfaceKey} is missing from the installer map`);
  }
  assert.equal(authoring.includes("stroke-dasharray"), false,
    "no dashed inset may be drawn inside a container the model must fill");
  assert.equal(human.includes("stroke-dasharray"), true,
    "the installer map keeps the printable-area inset the design team reads");
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
  // ⚠️ NOT TONAL SPREAD. The old assertion compared greyscale stdev, on the
  // reasoning that "glyphs are ink". That inverts once the model's guide is
  // bare fills: six light rectangles on a dark ground is a HIGH-variance image,
  // and adding fine captions to it moves the mean more than the spread. It
  // failed on exactly that.
  //
  // Count EDGES instead. The model's guide is six flat fills, so it has almost
  // none; the installer map adds a white stroke, a dashed inset and four lines
  // of caption per container. That comparison cannot tie and cannot invert.
  const edginess = async (bytes) => {
    const { data, info } = await sharp(bytes).greyscale().resize(512, 512, { fit: "fill" })
      .raw().toBuffer({ resolveWithObject: true });
    let edges = 0;
    for (let y = 1; y < info.height; y += 1) {
      for (let x = 1; x < info.width; x += 1) {
        const at = y * info.width + x;
        if (Math.abs(data[at] - data[at - 1]) > 24 || Math.abs(data[at] - data[at - info.width]) > 24) edges += 1;
      }
    }
    return edges;
  };
  assert.ok(await edginess(labelled) > await edginess(authoring),
    "the installer map carries marks the model's guide does not");
});

test("a glyph inside any extraction rectangle fails before authoring", async () => {
  const hood = manifest.zones.find((zone) => zone.surfaceKey === "hood");
  const inside = {
    x: Math.round(hood.trim.x + hood.trim.w / 2),
    y: Math.round(hood.trim.y + hood.trim.h / 2),
  };
  const withText = {
    ...manifest,
    zones: manifest.zones.map((zone) => ({
      ...zone,
      guideFill: `#4a4a4a"/><text x="${inside.x}" y="${inside.y}" font-size="40">HOOD</text><rect fill="#4a4a4a`,
    })),
  };
  await assert.rejects(
    () => renderAtlasAuthoringGuide(withText),
    (error) => error?.code === "flat_atlas_authoring_guide_contains_text",
  );
});

test("dashed, line, path and polygon geometry are refused too", async () => {
  // Not only glyphs. The 2026-08-29 canary (c3269f4d) returned all six panels
  // with a dashed rectangle through the artwork, because the guide drew the
  // trim inset inside every container. Anything the model can trace is
  // forbidden, not just anything it can read.
  const injections = {
    "a dashed inset": '#4a4a4a"/><rect x="10" y="10" width="20" height="20" stroke-dasharray="26 18" fill="none',
    "a line": '#4a4a4a"/><line x1="0" y1="0" x2="10" y2="10',
    "a path": '#4a4a4a"/><path d="M0 0 L10 10',
    "a polygon": '#4a4a4a"/><polygon points="0,0 10,0 10,10',
  };
  for (const [what, fill] of Object.entries(injections)) {
    await assert.rejects(
      () => renderAtlasAuthoringGuide({
        ...manifest,
        zones: manifest.zones.map((zone) => ({ ...zone, guideFill: fill })),
      }),
      (error) => error?.code === "flat_atlas_authoring_guide_contains_technical_furniture",
      `${what} must fail closed`,
    );
  }
});

/**
 * THE SHEET STILL HAS TO RENDER FOR EVERY VEHICLE PROPORTION.
 *
 * This used to also assert each caption declared a font-size the positional
 * guard could read, and two live refusals came out of that machinery on
 * correctly laid-out sheets. With no captions left there is nothing to fit and
 * nothing to size — but the layout itself still has to survive flanks from
 * 120in to 300in, so the render is exercised across the spread.
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
    const svg = flatFirst._test.authoringGuideSvg(build(rows)).toString("utf8");
    assert.equal((svg.match(/<text\b/gi) || []).length, SURFACE_KEYS.length,
      `${name}: every container must retain one gutter label`);
  }
});

test("text with no readable anchor is refused, as every text node now is", async () => {
  // This used to be its own class: a glyph that declares no x/y could not be
  // proven outside a container, so it was refused rather than trusted. With no
  // legal text at all the distinction collapses — but the fixture is kept,
  // because a guard that only convicted ANCHORED text would let this one past.
  await assert.rejects(
    () => renderAtlasAuthoringGuide({
      ...manifest,
      zones: manifest.zones.map((zone) => ({
        ...zone,
        guideFill: '#4a4a4a"/><text dx="10">HOOD</text><rect fill="#4a4a4a',
      })),
    }),
    (error) => error?.code === "flat_atlas_authoring_guide_text_unlocatable",
  );
});

test("the solid-panel output contract lives in the edge function's flat contract", () => {
  // The runtime assembles no creative text (owner directive 2026-08-27); the
  // full-bleed rule rides the deployed design-panel-ai-generate atlas-artboard
  // handler instead, stated once and positively.
  const { readFileSync } = require("node:fs");
  const edge = readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");
  assert.match(edge, /filling every region completely edge-to-edge/);
  assert.match(edge, /hardwired flattened TOP-VIEW artboard/);
  assert.match(edge, /\$\{panelLines\}/);
  assert.match(edge, /centre column is fixed top-to-bottom as Rear, Roof, Hood, Front/);
  // Scoped to the ATLAS contract, not the file: `mode === 'artboard'` is the
  // separate legacy RestylePro artboard branch and still builds its own list.
  // The RETURNED TEMPLATE, not the whole function: the signature still types
  // widthInches/heightInches on its parameter, which is dead but harmless — the
  // defect was ever putting them in the words the model reads.
  const atlasContract = edge.slice(
    edge.indexOf("OUTPUT FORMAT \u2014 ONE FLAT A.T.L.A.S. MASTER"),
    edge.indexOf("function buildDesignIQPrompt("),
  );
  assert.match(atlasContract, /\$\{panelLines\}/);
  assert.doesNotMatch(atlasContract, /widthInches|heightInches/);
});

test("the prompt version fences pure-panel masters from every obsolete authoring contract", () => {
  const { readFileSync } = require("node:fs");
  const atlasSource = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  assert.match(atlasSource, /designpro-flat-first-atlas-20260830\.v11-pure-panels/);
  assert.doesNotMatch(atlasSource, /PROMPT_VERSION = "designpro-flat-first-atlas-20260827\.v10-edge"/);
  assert.doesNotMatch(atlasSource, /PROMPT_VERSION = "designpro-flat-first-atlas-20260824\.v6"/);
});
