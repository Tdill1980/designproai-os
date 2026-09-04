"use strict";

/**
 * ONE FIELD -> SIX GENIE WINDOWS -> CANONICAL FLATTENED A.T.L.A.S.
 *
 * ⛔ OFFLINE PROTOTYPE. Nothing in the product path imports this. It is not
 * wired to runtime/index.js. It makes no provider call and touches no database.
 *
 * THE ONE PROBLEM THIS SOLVES. The current one-call path already produces what
 * we want creatively: cohesive professional artwork, ~40 s, no wheel wells, no
 * windows, no anatomy, no instructional labels. The single thing that does not
 * work is that the boundaries GEMINI DRAWS do not land where GENIE's boundaries
 * ARE. Tests 12 and 13 both came back a 25/50/25 grid with four equal centre
 * quarters, and stretching those finished cells onto GENIE geometry clips logos
 * and distorts artwork.
 *
 * The fix is not to ask the model for better boundaries -- Test 13 proved exact
 * proportions in words move nothing -- and not to ask it six times. It is to
 * stop asking it for boundaries at all. The model paints ONE oversized
 * continuous field with no boundaries in it, and GENIE takes six windows out of
 * that field by arithmetic.
 *
 * WHY CROPPING IS SAFE HERE AND ONLY HERE. The field is deliberately authored
 * as overscan and carries NO company name, phone number, website or final logo
 * -- so there is nothing in it a crop can clip. Protected content is placed
 * afterwards, by code, at exact size. Cropping artwork that was drawn to be
 * cropped is not the same operation as cropping a finished composition.
 *
 * WHAT IS NOT DONE, ANYWHERE IN THIS FILE. No non-uniform stretch. No
 * `fit:"fill"`. No remap, inpaint, clone, wheel-well fill or generated fill. No
 * resize of the field, the windows, or the panels: every window is a pure
 * `extract` at its exact destination size and is pasted 1:1, so between the
 * authored field and the finished panel not one pixel is resampled.
 *
 * WHAT IS PRESERVED. The GENIE manifest, `buildFieldTerritories` geometry, the
 * production extractor, `masterContentHash` / `sourceMasterHash` semantics, and
 * every downstream consumer shape. This adds a producer for the flattened
 * master; it changes nothing about what that master IS.
 */

const sharp = require("../../runtime/node_modules/sharp");
const { createHash } = require("node:crypto");
const { outlineStringSvg } = require("../../runtime/opentype-outline.cjs");

const WINDOW_COMPILER_CONTRACT = "designpro.atlas-window-compiler.v1";
const CANVAS = Object.freeze({ widthPx: 4096, heightPx: 4096 });
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });

/**
 * A logo fitted into its box is scaled uniformly; this proves it afterwards.
 * It is an assertion about `fit:"inside"`, not a licence to stretch.
 */
const MAX_LOGO_ASPECT_DRIFT = 0.005;

class WindowCompilerError extends Error {
  constructor(code, message) { super(message || code); this.name = "WindowCompilerError"; this.code = code; }
}
const fail = (code, message) => { throw new WindowCompilerError(code, message); };
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * Six windows into the oversized field, one per surface.
 *
 * Each window is EXACTLY the pixel size of the A.T.L.A.S. territory it will
 * occupy, which is what lets it be pasted without a resize. They sit at
 * distinct, non-overlapping places in the field, which is what makes Driver and
 * Passenger genuinely different artwork rather than one image used twice.
 *
 * Placement is a pure function of the territory sizes and the field size, so
 * two compiles of the same inputs choose the same windows.
 */
function planWindows(territories, field) {
  const zones = Array.isArray(territories?.zones) ? territories.zones : null;
  if (!zones || zones.length !== SURFACE_KEYS.length) fail("window_territories_invalid", "six code-only territories are required");

  const byKey = new Map(zones.map((z) => [z.surfaceKey, z]));
  const margin = Math.round(Math.min(field.width, field.height) * 0.03); // the overscan the model paints past every window
  const gap = margin;

  // Laid out in reading order, each row as tall as its tallest window. The
  // flanks take a row each so their artwork cannot coincide.
  const rows = [["driver"], ["passenger"], ["hood", "roof", "front"], ["rear"]];
  const windows = [];
  let y = margin;
  for (const row of rows) {
    let x = margin;
    let rowHeight = 0;
    for (const surfaceKey of row) {
      const zone = byKey.get(surfaceKey);
      if (!zone) fail("window_surface_missing", `${surfaceKey} has no territory`);
      if (Number(zone.rotationDegrees || 0) !== 0) {
        fail("window_territory_rotated",
          `${surfaceKey} territory is rotated ${zone.rotationDegrees}deg; these windows are pasted 1:1 and never rotated`);
      }
      const w = Number(zone.w);
      const h = Number(zone.h);
      if (x + w + margin > field.width || y + h + margin > field.height) {
        fail("window_field_too_small",
          `the ${field.width}x${field.height} field cannot hold the ${surfaceKey} window (${w}x${h}) with ${margin}px of overscan; author a larger field`);
      }
      windows.push({
        surfaceKey,
        source: { left: x, top: y, width: w, height: h },
        destination: { left: Number(zone.x), top: Number(zone.y), width: w, height: h },
        printWidthIn: Number(zone.printWidthIn),
        printHeightIn: Number(zone.printHeightIn),
        trimWidthIn: Number(zone.trimWidthIn),
        trimHeightIn: Number(zone.trimHeightIn),
        // Reported, not corrected: this is the territory geometry's own integer
        // rounding, and nothing here resamples to hide it.
        printAspect: Number((Number(zone.printWidthIn) / Number(zone.printHeightIn)).toFixed(6)),
        windowAspect: Number((w / h).toFixed(6)),
        effectivePpi: Number((w / Number(zone.printWidthIn)).toFixed(2)),
      });
      x += w + gap;
      rowHeight = Math.max(rowHeight, h);
    }
    y += rowHeight + gap;
  }
  return { margin, windows };
}

/** Inches on a surface -> pixels inside that surface's window. */
function inchesToWindow(win, rect) {
  const sx = win.source.width / win.printWidthIn;
  const sy = win.source.height / win.printHeightIn;
  return {
    left: Math.round(rect.xIn * sx),
    top: Math.round(rect.yIn * sy),
    width: Math.max(1, Math.round(rect.widthIn * sx)),
    height: Math.max(1, Math.round(rect.heightIn * sy)),
    pxPerInch: sx,
  };
}

/**
 * Compile the canonical flattened A.T.L.A.S.
 *
 * @param fieldBytes  the one continuous oversized creative field
 * @param territories `buildFieldTerritories` output (rotation-0 zones)
 * @param content     { text: [...], logos: [...] } placed by code, at exact size
 */
async function compileAtlas({ fieldBytes, territories, content = {}, fontBytes }) {
  if (!Buffer.isBuffer(fieldBytes) || !fieldBytes.length) fail("window_field_missing", "a creative field is required");
  const meta = await sharp(fieldBytes).metadata();
  const field = { width: meta.width, height: meta.height };
  if (!(field.width > CANVAS.widthPx || field.height > CANVAS.heightPx)) {
    fail("window_field_not_overscanned",
      `the field is ${field.width}x${field.height}; it must be larger than the ${CANVAS.widthPx}x${CANVAS.heightPx} canvas so every window is cut from overscan`);
  }

  const { margin, windows } = planWindows(territories, field);
  const byKey = new Map(windows.map((w) => [w.surfaceKey, w]));
  const operations = [];
  const placements = [];

  const surfaces = [];
  for (const win of windows) {
    // 1. PURE CROP. No resize: the window is already its destination size.
    const cut = await sharp(fieldBytes, { limitInputPixels: false })
      .extract({ left: win.source.left, top: win.source.top, width: win.source.width, height: win.source.height })
      .png(PNG_OPTIONS).toBuffer();
    operations.push(`${win.surfaceKey}: extract ${win.source.width}x${win.source.height} @ ${win.source.left},${win.source.top} (no resize)`);

    // 2. Deterministic protected content, composited at exact size.
    const overlays = [];
    for (const item of (content.text || []).filter((t) => t.surfaceKey === win.surfaceKey)) {
      const box = inchesToWindow(win, item.rect);
      const outlined = outlineStringSvg({
        fontBytes, string: item.string, sizeIn: item.sizeIn, pxPerInch: box.pxPerInch, fill: item.fill,
      });
      // Never shrunk, never cropped: type that does not fit is a refusal.
      if (outlined.widthPx > box.width || outlined.heightPx > box.height) {
        fail("window_text_exceeds_box",
          `${win.surfaceKey} "${item.string}" outlines to ${outlined.widthPx}x${outlined.heightPx}px, larger than its ${box.width}x${box.height}px box; ` +
          "customer type is never shrunk or cropped to fit");
      }
      if (box.left + outlined.widthPx > win.source.width || box.top + outlined.heightPx > win.source.height) {
        fail("window_text_outside_surface", `${win.surfaceKey} "${item.string}" falls outside the surface`);
      }
      overlays.push({ input: await sharp(outlined.svg).png(PNG_OPTIONS).toBuffer(), left: box.left, top: box.top });
      operations.push(`${win.surfaceKey}: outline "${item.string}" ${outlined.widthPx}x${outlined.heightPx}px from pinned font, composite @ ${box.left},${box.top} (no scale)`);
      placements.push({
        kind: "text", surfaceKey: win.surfaceKey, string: item.string,
        widthPx: outlined.widthPx, heightPx: outlined.heightPx, scaled: false,
        spellingAuthority: "frozen-fixture-string",
      });
    }

    for (const item of (content.logos || []).filter((l) => l.surfaceKey === win.surfaceKey)) {
      if (sha256(item.bytes) !== item.contentHash) {
        fail("window_logo_hash_mismatch", `${item.identityKey} bytes do not match the approved digest`);
      }
      const box = inchesToWindow(win, item.rect);
      const src = await sharp(item.bytes).metadata();
      // fit:"inside" is uniform by definition; the drift check proves it.
      const fitted = await sharp(item.bytes)
        .resize(box.width, box.height, { fit: "inside", kernel: "lanczos3" })
        .png(PNG_OPTIONS).toBuffer();
      const out = await sharp(fitted).metadata();
      const drift = Math.abs((src.width / src.height) - (out.width / out.height)) / (src.width / src.height);
      if (!(drift <= MAX_LOGO_ASPECT_DRIFT)) {
        fail("window_logo_aspect_drift",
          `${item.identityKey} changed aspect by ${(drift * 100).toFixed(3)}% during placement; an approved mark is scaled uniformly or not at all`);
      }
      if (box.left + out.width > win.source.width || box.top + out.height > win.source.height) {
        fail("window_logo_outside_surface", `${item.identityKey} falls outside ${win.surfaceKey}`);
      }
      overlays.push({ input: fitted, left: box.left, top: box.top });
      operations.push(`${win.surfaceKey}: logo ${item.identityKey} ${src.width}x${src.height} -> ${out.width}x${out.height} uniform (fit:inside), composite @ ${box.left},${box.top}`);
      placements.push({
        kind: "logo", surfaceKey: win.surfaceKey, identityKey: item.identityKey, contentHash: item.contentHash,
        sourcePx: `${src.width}x${src.height}`, placedPx: `${out.width}x${out.height}`,
        uniformScale: true, aspectDrift: Number(drift.toFixed(6)),
      });
    }

    const finished = overlays.length
      ? await sharp(cut).composite(overlays).png(PNG_OPTIONS).toBuffer()
      : cut;
    surfaces.push({ ...win, bytes: finished, contentHash: sha256(finished) });
  }

  // 3. PURE PASTE. Each finished surface lands at its territory, 1:1, upright.
  const composed = await sharp({
    create: { width: CANVAS.widthPx, height: CANVAS.heightPx, channels: 4, background: { r: 10, g: 10, b: 12, alpha: 1 } },
  }).composite(surfaces.map((s) => ({ input: s.bytes, left: s.destination.left, top: s.destination.top })))
    .png(PNG_OPTIONS).toBuffer();
  for (const s of surfaces) {
    operations.push(`atlas: paste ${s.surfaceKey} ${s.destination.width}x${s.destination.height} @ ${s.destination.left},${s.destination.top} (1:1, rotation 0, no resize)`);
  }

  const covered = surfaces.reduce((sum, s) => sum + s.destination.width * s.destination.height, 0);
  return Object.freeze({
    contract: WINDOW_COMPILER_CONTRACT,
    bytes: composed,
    // Requirement: unchanged semantics -- the constructed flattened A.T.L.A.S. bytes.
    masterContentHash: sha256(composed),
    canvas: { ...CANVAS },
    topology: territories.topology,
    field: { ...field, overscanMarginPx: margin, sourceHash: sha256(fieldBytes) },
    surfaces: Object.freeze(surfaces.map(({ bytes, ...rest }) => rest)),
    surfaceBytes: new Map(surfaces.map((s) => [s.surfaceKey, s.bytes])),
    placements: Object.freeze(placements),
    operations: Object.freeze(operations),
    coverage: {
      territoryPixels: covered,
      canvasPixels: CANVAS.widthPx * CANVAS.heightPx,
      coveredFraction: Number((covered / (CANVAS.widthPx * CANVAS.heightPx)).toFixed(4)),
    },
    resampling: Object.freeze({ fieldResized: false, windowsResized: false, textScaled: false, panelsResized: false, logoScale: "uniform-only" }),
  });
}

module.exports = { WINDOW_COMPILER_CONTRACT, CANVAS, SURFACE_KEYS, MAX_LOGO_ASPECT_DRIFT, WindowCompilerError, compileAtlas, planWindows, _test: { inchesToWindow } };
