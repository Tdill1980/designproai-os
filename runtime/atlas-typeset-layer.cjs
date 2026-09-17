"use strict";
/**
 * runtime/atlas-typeset-layer.cjs — the element graph's TYPOGRAPHY PRODUCER.
 *
 * RULE 1 reference: `restylepro-os api/typeset-layer.js` (176 lines). The
 * geometry below is that file's `renderLockup()` ported unchanged -- name at 12%
 * of width, contact lines at 5%, 0.7x line gap, 5% padding, canvas height from
 * the real descender, each string centred by its own advance width.
 *
 * WHY OUTLINES AND NOT SVG <text> (the reference's own header, and it still
 * holds here): sharp/librsvg ships with NO system fonts and ignores data-URI
 * @font-face, so <text> renders as empty "tofu" boxes. opentype.js converts each
 * string to <path> outlines, so sharp rasterises pure geometry -- crisp at any
 * size, no font engine at render time.
 *
 * FIVE DELTAS from the reference, each forced by the standalone boundary and
 * each recorded in ARCHITECTURE_DAG.md §5:
 *
 *   1. fonts are VENDORED and hash-verified, never fetched. A graph node that can
 *      fail on raw.githubusercontent.com is not deterministic -- and three of the
 *      reference's twenty paths are already dead upstream, where loadFont() would
 *      have silently fallen back to Anton.
 *   2. NO storage and NO Supabase client in here. The producer returns bytes plus
 *      their sha256; persisting them is the NODE's job. That keeps this module
 *      pure and provable offline.
 *   3. no `Date.now()`/random in any identifier -- the artifact is addressed by
 *      the sha256 of its own bytes, so a re-claimed node re-reads instead of
 *      re-writing (the graph's idempotency contract).
 *   4. a module, not a Vercel handler. Call 1 runs on the droplet runtime.
 *   5. a missing or drifted face FAILS CLOSED. The reference falls back to the
 *      default font; here, silently rendering a different typeface than the
 *      design recorded would be an undetectable lie in a print file.
 *
 * DETERMINISM IS THE CONTRACT: same input -> same bytes -> same sha256, every
 * time, on every worker. `tests/atlas-typeset-layer.test.mjs` asserts it by
 * rendering twice and comparing hashes.
 */

const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const opentype = require("opentype.js");
const sharp = require("sharp");

const CONTRACT = "designpro.atlas-typeset-layer.v1";
const FONT_DIR = path.join(__dirname, "atlas-fonts");
const MANIFEST = JSON.parse(readFileSync(path.join(FONT_DIR, "fonts.json"), "utf8"));

const DEFAULT_NAME_FONT = MANIFEST.defaultNameFont;
const DEFAULT_CONTACT_FONT = MANIFEST.defaultContactFont;

const MIN_WIDTH_PX = 600;
const MAX_WIDTH_PX = 4000;
const DEFAULT_WIDTH_PX = 1600;
const DEFAULT_COLOR = "#1f2937";

/** Parsed faces, keyed by font key. Bytes are verified once, on first use. */
const _fonts = new Map();

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Load a vendored face and verify it against the pin.
 *
 * Fails closed, unlike the reference: an unknown key, a missing file or drifted
 * bytes throw. A print file that silently used a different typeface than the
 * design recorded is worse than a refusal.
 */
function loadFont(key) {
  const name = String(key || "").toLowerCase();
  if (_fonts.has(name)) return _fonts.get(name);

  const entry = MANIFEST.fonts[name];
  if (!entry) {
    throw new Error(
      `atlas_typeset_font_unknown:${name}:known=${Object.keys(MANIFEST.fonts).join(",")}`,
    );
  }

  let bytes;
  try {
    bytes = readFileSync(path.join(FONT_DIR, entry.file));
  } catch (err) {
    throw new Error(`atlas_typeset_font_missing:${name}:${entry.file}:${err.message}`);
  }

  const actual = sha256(bytes);
  if (actual !== entry.sha256) {
    throw new Error(
      `atlas_typeset_font_hash_mismatch:${name}:expected=${entry.sha256}:actual=${actual}`,
    );
  }

  const font = opentype.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  );
  const loaded = { key: name, font, sha256: actual };
  _fonts.set(name, loaded);
  return loaded;
}

function normalizeColor(value) {
  if (!value) return DEFAULT_COLOR;
  const v = String(value).trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(v) ? `#${v.toLowerCase()}` : DEFAULT_COLOR;
}

function clampWidth(value) {
  const n = Number(value) || DEFAULT_WIDTH_PX;
  return Math.max(MIN_WIDTH_PX, Math.min(MAX_WIDTH_PX, Math.round(n)));
}

/** One centred line of outlines. Ported from the reference's `outline()`. */
function outline(font, text, size, baseline, width, color, pad) {
  const t = String(text || "").trim();
  if (!t) return { svg: "", advance: 0 };
  const advance = font.getAdvanceWidth(t, size);
  const x = Math.max(pad, (width - advance) / 2);
  const p = font.getPath(t, x, baseline, size);
  p.fill = color;
  return { svg: p.toSVG(2), advance };
}

/**
 * Render a lockup to a transparent PNG.
 *
 * The transparency matters: this is LAYER 1 in the Layer 0 / Layer 1 model
 * (ARCHITECTURE_DAG.md §4.1), composited over a clean authored base. A baked
 * background would reintroduce exactly the seam this port exists to remove.
 */
async function renderLockup({
  name = "",
  lines = [],
  color = DEFAULT_COLOR,
  width = DEFAULT_WIDTH_PX,
  nameFont = DEFAULT_NAME_FONT,
  contactFont = DEFAULT_CONTACT_FONT,
} = {}) {
  const canvasWidth = clampWidth(width);
  const fill = normalizeColor(color);
  const headline = String(name || "").trim();
  const body = (Array.isArray(lines) ? lines : [])
    .map((l) => String(l == null ? "" : l).trim())
    .filter(Boolean);

  if (!headline && body.length === 0) {
    throw new Error("atlas_typeset_empty:nothing to set");
  }

  const faceName = loadFont(nameFont || DEFAULT_NAME_FONT);
  const faceBody = loadFont(contactFont || DEFAULT_CONTACT_FONT);

  // The reference's proportions, unchanged.
  const pad = Math.round(canvasWidth * 0.05);
  const nameSize = Math.round(canvasWidth * 0.12);
  const lineSize = Math.round(canvasWidth * 0.05);
  const lineGap = Math.round(lineSize * 0.7);

  const parts = [];
  let widest = 0;
  let y = pad;

  if (headline) {
    y += nameSize;
    const drawn = outline(faceName.font, headline, nameSize, y, canvasWidth, fill, pad);
    parts.push(drawn.svg);
    widest = Math.max(widest, drawn.advance);
  }
  for (const line of body) {
    // First line on a bare canvas drops by its own size; every later line adds
    // the gap as well. (The reference always had a headline, so it only ever
    // needed the second case.)
    y += parts.length === 0 ? lineSize : lineSize + lineGap;
    const drawn = outline(faceBody.font, line, lineSize, y, canvasWidth, fill, pad);
    parts.push(drawn.svg);
    widest = Math.max(widest, drawn.advance);
  }

  const measured = body.length ? faceBody : faceName;
  const descent =
    Math.abs((measured.font.descender || 0) / (measured.font.unitsPerEm || 1000)) *
    (body.length ? lineSize : nameSize);
  const canvasHeight = Math.round(y + descent + pad);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" ` +
    `viewBox="0 0 ${canvasWidth} ${canvasHeight}">${parts.join("")}</svg>`;

  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();

  return {
    contract: CONTRACT,
    bytes,
    contentHash: sha256(bytes),
    byteSize: bytes.length,
    // LAYER 1 KEEPS ITS VECTOR (owner, 2026-09-17: "Layer 1 & Above ... clean
    // vector text/graphics ... guaranteeing that the customer gets a clean
    // vector separation for production").
    //
    // These glyphs are already real outlines -- `outline()` converts the font's
    // paths with opentype's `toSVG()`, which is why they stay crisp at any size
    // and why sharp can rasterise them without a single system font installed.
    // The vector was then DISCARDED at this line: only the PNG was returned, so
    // a production consumer had raster where the geometry existed all along.
    //
    // It costs nothing to keep: the same string the PNG is rendered from. The
    // PNG remains what the composite draws (compositing is pixel work), and the
    // SVG is what a plotter, a cut path or a print RIP can consume.
    svg,
    width: canvasWidth,
    height: canvasHeight,
    // Enough geometry for the lockup node to place this without re-measuring.
    metrics: {
      inkWidth: Math.round(widest),
      nameSize,
      lineSize,
      pad,
      descent: Math.round(descent),
    },
    fonts: {
      name: { key: faceName.key, sha256: faceName.sha256 },
      contact: { key: faceBody.key, sha256: faceBody.sha256 },
    },
    color: fill,
    deterministic: true,
  };
}

/** The storage path IS the content hash — see delta 3. */
function elementStoragePath(contentHash, ext = "png") {
  if (!/^[0-9a-f]{64}$/.test(String(contentHash || ""))) {
    throw new Error(`atlas_typeset_bad_content_hash:${contentHash}`);
  }
  return `atlas-elements/${contentHash}.${ext}`;
}

module.exports = {
  CONTRACT,
  DEFAULT_NAME_FONT,
  DEFAULT_CONTACT_FONT,
  MIN_WIDTH_PX,
  MAX_WIDTH_PX,
  fontKeys: () => Object.keys(MANIFEST.fonts),
  loadFont,
  normalizeColor,
  clampWidth,
  renderLockup,
  elementStoragePath,
};
