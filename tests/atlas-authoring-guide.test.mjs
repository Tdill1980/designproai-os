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
const { authoringGuideSvg, guideGeometrySvg, guideSvg, atlasPrompt } = _test;

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

test("the prompt states full bleed positively and no longer enumerates guide furniture", () => {
  const prompt = atlasPrompt({ designBrief: "a clean geometric livery" }, manifest);
  // FULL BLEED IS STATED ONCE, POSITIVELY, IN THE PROTECTED BLOCK.
  //
  // It used to be stated twice: a "FULL BLEED PER ZONE" heading and then SOLID
  // PANELS immediately below it, which RULE 0.15 protects verbatim and which
  // already says every zone is one solid rectangle of continuous artwork,
  // opaque corner to corner and edge to edge. The heading carried one clause
  // SOLID PANELS does not — what happens OUTSIDE the rectangles — so that
  // clause survives on its own and the restatement is gone.
  assert.match(prompt, /SOLID PANELS -- THIS IS THE MOST IMPORTANT RULE OF THIS CALL/);
  assert.match(prompt, /opaque corner to corner and edge to edge/i);
  assert.match(prompt, /canvas stays empty/i, "the outside-the-zones rule must survive the dedupe");
  // Zone identity still reaches the model as text, which is why the glyphs were
  // never load-bearing.
  for (const zone of manifest.zones) {
    assert.equal(prompt.includes(`${zone.surfaceKey}: box [${zone.x},${zone.y},${zone.w},${zone.h}]`), true,
      `${zone.surfaceKey} lost its ZONE MAP entry`);
  }
  // The old OUTPUT CLEANLINESS clause named the forbidden thing -- "labels",
  // "legend", "dimensions" -- which is the prompt shape that made the model
  // paint them. It must not come back.
  assert.equal(/guide's colors, labels/i.test(prompt), false);
});

test("the prompt version moved off v6, so masters authored with the labelled guide are refused", () => {
  assert.equal(PROMPT_VERSION, "designpro-flat-first-atlas-20260826.v9-dpag");
  assert.doesNotMatch(PROMPT_VERSION, /\.v[4-8]$/);
});

// ---------------------------------------------------------------------------
// FULL BLEED: a required zone carrying transparency cannot pass.
// ---------------------------------------------------------------------------

const qcZoneKeys = ["driver", "passenger", "hood", "roof", "front", "rear"];
const qcManifest = {
  zones: qcZoneKeys.map((surfaceKey, index) => ({
    surfaceKey,
    x: (index % 3) * 100,
    y: Math.floor(index / 3) * 100,
    w: 100,
    h: 100,
    extraction: { outputRotationDegrees: 0 },
  })),
  installerMap: {
    passenger: "left", driver: "right",
    centerOrderTopToBottom: ["rear", "roof", "hood", "front"],
  },
};

/** Textured artwork, opaque everywhere -- a legal sheet. */
async function opaqueSheet() {
  const tile = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <rect width="100" height="100" fill="#0f766e"/>
    <rect x="6" y="6" width="88" height="88" fill="#f59e0b"/>
    <rect x="24" y="24" width="52" height="52" fill="#e11d48"/>
    <rect x="42" y="42" width="16" height="16" fill="#ffffff"/>
  </svg>`)).png().toBuffer();
  return sharp({ create: { width: 300, height: 200, channels: 4, background: "#000000" } })
    .composite(qcManifest.zones.map((zone) => ({ input: tile, left: zone.x, top: zone.y })))
    .png().toBuffer();
}

/** The same sheet with a transparent bite taken out of one zone. */
async function sheetWithHoleIn(surfaceKey, holePx) {
  const base = await opaqueSheet();
  const zone = qcManifest.zones.find((candidate) => candidate.surfaceKey === surfaceKey);
  // `dest-out` erases the destination wherever the SOURCE is opaque, so the
  // stamp has to be solid. A transparent stamp erases nothing at all.
  const hole = await sharp({
    create: { width: holePx, height: holePx, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  }).png().toBuffer();
  return sharp(base)
    .composite([{ input: hole, left: zone.x + 5, top: zone.y + 5, blend: "dest-out" }])
    .png().toBuffer();
}

test("an opaque sheet satisfies the full-bleed floor on every required zone", async () => {
  const checks = await deterministicMasterChecks(await opaqueSheet(), qcManifest);
  const coverage = checks.failures.filter((finding) => /opaqueRatio/.test(finding));
  assert.deepEqual(coverage, [], `a fully painted sheet must not be convicted: ${coverage.join("; ")}`);
});

test("transparency inside a required zone is convicted, and convicted as BLOCKING", async () => {
  for (const surfaceKey of qcZoneKeys) {
    const checks = await deterministicMasterChecks(await sheetWithHoleIn(surfaceKey, 40), qcManifest);
    assert.equal(checks.accepted, false, `${surfaceKey} transparency was accepted`);
    const named = checks.blockingFailures.filter((finding) => finding.startsWith(`${surfaceKey} `));
    assert.ok(named.length > 0,
      `${surfaceKey} transparency must be a blocking failure, not a cut-out flag`);
    assert.ok(named.some((finding) => /opaqueRatio/.test(finding)),
      `${surfaceKey} must be convicted on opaque coverage: ${named.join("; ")}`);
    // A hole in the sheet is a broken DESIGN, never the panel-scoped cut-out
    // class -- it must not be carried forward and filled.
    assert.equal(
      checks.cutoutFindings.some((item) => item.surfaceKey === surfaceKey && /opaqueRatio/.test(item.finding)),
      false,
      `${surfaceKey} transparency must not be reclassified as a fillable cut-out`,
    );
  }
});

test("the full-bleed floor is not satisfied by painting only the middle of a zone", async () => {
  // Edge coverage is its own check: artwork that stops short of the trim leaves
  // the installer nothing to wrap, even when the centre is solid.
  const base = await opaqueSheet();
  const zone = qcManifest.zones.find((candidate) => candidate.surfaceKey === "hood");
  const frame = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <path d="M0,0 H100 V100 H0 Z M12,12 V88 H88 V12 Z" fill="#ffffff" fill-rule="evenodd"/>
  </svg>`)).png().toBuffer();
  const bytes = await sharp(base)
    .composite([{ input: frame, left: zone.x, top: zone.y, blend: "dest-out" }])
    .png().toBuffer();
  const checks = await deterministicMasterChecks(bytes, qcManifest);
  assert.equal(checks.accepted, false);
  assert.ok(checks.blockingFailures.some((finding) => /^hood .*(edgeOpaqueRatio|opaqueRatio)/.test(finding)),
    `a hood painted only in the middle must fail: ${checks.blockingFailures.join("; ")}`);
});
