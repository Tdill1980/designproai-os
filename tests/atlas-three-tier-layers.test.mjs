// THE THREE-TIER LAYER ARCHITECTURE (owner ruling, Trish 2026-09-17).
//
//   "Layer 0 (Base / Background): the foundational color block, gradient, or
//    background texture ... locked as the primary template base.
//    Layer 1 & Above (Graphics, Typography, Badges): placed as distinct, modular
//    vector stems that sit on top of the base asset, ensuring text stays crisp
//    and logos never get baked into background raster pixels.
//    Deterministic Assembly (master.composite): the final step merges these
//    layers programmatically ... without tripping the hole gate."
//
// Locks all three tiers against the real modules:
//   1. LAYER 0 is preserved byte for byte and is recoverable by hash after the
//      composite -- the base a later element edit floors on;
//   2. LAYER 1 carries REAL VECTOR geometry, not only a raster -- the glyph
//      outlines the typeset layer already computes are kept, not discarded;
//   3. master.composite is deterministic, records exactly where it darkened the
//      sheet, and CANNOT trip the hole gate: it changes nothing outside its own
//      element rectangles, and it fails closed rather than shipping a sheet it
//      damaged.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const typeset = require("../runtime/atlas-typeset-layer.cjs");
const composite = require("../runtime/atlas-master-composite.cjs");
const qc = require("../runtime/atlas-master-qc.cjs");

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A Layer 0 stand-in: a bright, fully painted sheet with no dark field. */
const baseSheet = (w, h) => sharp({
  create: { width: w, height: h, channels: 3, background: { r: 210, g: 235, b: 232 } },
}).png().toBuffer();

const zone = (surfaceKey, x, y, w, h, rotationDegrees = 0) => ({
  surfaceKey, rotationDegrees, trim: { x, y, w, h },
});

test("LAYER 1 keeps its vector: the glyph outlines are returned, not discarded at the raster", async () => {
  const rendered = await typeset.renderLockup({
    name: "All Smiles Orthodontics",
    lines: ["(555) 123-4567", "allsmiles.com"],
    width: 1600,
  });

  // The raster the composite draws is unchanged and still the primary artifact.
  assert.ok(Buffer.isBuffer(rendered.bytes) && rendered.bytes.length > 0);
  assert.equal(rendered.contentHash, sha(rendered.bytes));

  // ...and the geometry that produced it now survives. `outline()` already
  // converted the font to real paths (opentype `toSVG`) -- that is why these
  // stay crisp at any size and why sharp needs no system font. Returning only
  // the PNG threw the vector away at the last line.
  assert.equal(typeof rendered.svg, "string");
  assert.match(rendered.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(rendered.svg, /<path/, "the lockup is path geometry, never a font-family reference");
  // One path per drawn line: the name plus its two contact lines.
  assert.equal((rendered.svg.match(/<path/g) || []).length, 3);
  // A <text> element would resolve a family through fontconfig, which ships no
  // fonts in this image -- the exact failure the outline conversion exists to
  // prevent.
  assert.ok(!/<text/.test(rendered.svg), "text must be outlines, never a live font reference");
  assert.match(rendered.svg, new RegExp(`width="${rendered.width}"`));
});

test("LAYER 0 survives the composite byte for byte, and Layer 1 lands where the plan put it", async () => {
  const cleanMasterBytes = await baseSheet(1200, 800);
  const cleanMasterHash = sha(cleanMasterBytes);
  const element = await typeset.renderLockup({ name: "Bright Smiles", lines: [], width: 1200 });

  const result = await composite.compositeElementsOntoMaster({
    cleanMasterBytes,
    zones: [zone("driver", 100, 100, 800, 400)],
    plan: {
      placements: [{
        surfaceKey: "driver", role: "typography", contentHash: element.contentHash,
        box: { xPct: 0.1, yPct: 0.2, wPct: 0.5, hPct: 0.25 },
      }],
    },
    artwork: new Map([["typography", element.bytes]]),
  });

  assert.equal(result.changed, true);
  // THE BASE IS THE FLOOR. Not replaced, not healed -- recoverable by hash, so
  // a later element move re-composites onto it instead of smearing type away.
  assert.equal(result.cleanMasterHash, cleanMasterHash,
    "Layer 0's identity must survive so an element can be moved without healing");
  assert.notEqual(result.contentHash, cleanMasterHash, "the composited sheet is its own artifact");
  assert.equal(sha(cleanMasterBytes), cleanMasterHash, "the input buffer itself is never mutated");

  // The sheet keeps its dimensions: panels are cut by fixed geometry, so a
  // composite that resized the master would move every cut.
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 800);

  // Placed at the planned box in sheet space: trim origin + the box fraction.
  assert.equal(result.applied.length, 1);
  const spot = result.applied[0].sheet;
  assert.equal(spot.left, 100 + Math.round(0.1 * 800));
  assert.equal(spot.top, 100 + Math.round(0.2 * 400));
  assert.equal(spot.rotation, 0);
});

test("the composite CANNOT trip the hole gate: it darkens nothing outside its own elements", async () => {
  const cleanMasterBytes = await baseSheet(1200, 800);
  // Dark type on a light base -- the exact combination that makes a lockup look
  // like a concentrated near-black component to the cut-out detector.
  const element = await typeset.renderLockup({
    name: "All Smiles Orthodontics",
    lines: ["(555) 123-4567"],
    width: 1200,
    color: "#000000",
  });

  const result = await composite.compositeElementsOntoMaster({
    cleanMasterBytes,
    zones: [zone("driver", 0, 0, 1200, 800)],
    plan: {
      placements: [{
        surfaceKey: "driver", role: "typography", contentHash: element.contentHash,
        box: { xPct: 0.15, yPct: 0.3, wPct: 0.6, hPct: 0.3 },
      }],
    },
    artwork: new Map([["typography", element.bytes]]),
  });

  // ZERO, not "small". Outside its own rectangles a correct composite is a
  // no-op, so the gate sees exactly the sheet it already accepted.
  assert.equal(result.outsideDelta, 0,
    "Layer 1 may only darken pixels inside the rectangles the plan placed it in");

  // And it says WHERE it darkened, so a reviewer -- or a later hole
  // measurement -- can tell added ink from missing artwork.
  assert.equal(result.elementRegions.length, 1);
  const region = result.elementRegions[0];
  assert.equal(region.role, "typography");
  assert.equal(region.surfaceKey, "driver");
  for (const key of ["left", "top", "drawWidth", "drawHeight"]) {
    assert.ok(Number.isFinite(region[key]), `${key} must be a real sheet coordinate`);
  }

  // One definition of "dark". If this module and the gate disagreed, the
  // measurement above would be meaningless -- the standing rule the cut-out
  // fill follows for the same reason.
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../runtime/atlas-master-composite.cjs", import.meta.url), "utf8"));
  assert.match(source, /FLAT_BLACK_CHANNEL_MAX \} = require\("\.\/atlas-master-qc\.cjs"\)/,
    "the composite must import the gate's own threshold, never restate one");
  assert.ok(Number.isFinite(qc.FLAT_BLACK_CHANNEL_MAX));
});

test("an empty plan is a sheet with no elements, not a failure", async () => {
  const cleanMasterBytes = await baseSheet(600, 400);
  const result = await composite.compositeElementsOntoMaster({
    cleanMasterBytes, zones: [zone("driver", 0, 0, 600, 400)], plan: { placements: [] }, artwork: new Map(),
  });
  assert.equal(result.changed, false);
  assert.equal(result.contentHash, result.cleanMasterHash,
    "with nothing to place the composited master IS Layer 0, and both hashes agree");
  assert.deepEqual(result.applied, []);
});
