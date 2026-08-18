/**
 * build-bleed-panel.js — DETERMINISTIC flat-design → print panel
 * ----------------------------------------------------------------
 * Pixel-for-pixel. NO AI. NO regeneration. The design you give it is the
 * design that comes out — placed on a correctly-sized rectangle, with the
 * artwork bled to the edge of a 2" all-side installer bleed.
 *
 * What it does, in order:
 *   1. Load the flat design (PNG/JPEG/TIFF/WebP).
 *   2. FLATTEN any transparency onto a solid background (no alpha holes,
 *      no window/tire cutouts) — a solid continuous sheet.
 *   3. Place the design at the EXACT trim size of the panel (W"×H" at the
 *      chosen pixel density) WITHOUT distorting it (default mode keeps the
 *      design's pixels true; it warns instead of silently stretching).
 *   4. Extend the artwork BLEED" past every edge by mirroring it, so the
 *      design runs cleanly to the cut edge (2" bleed to edge).
 *   5. Encode a real, print-ready TIFF with the print DPI embedded, and a
 *      downscaled PNG proof with a trim/bleed legend you can eyeball.
 *
 * Canvas math (matches the shop's 150 px/in = 1500 DPI @ 10% RIP convention):
 *   trim   = W" × H"                       e.g. 237 × 55
 *   sheet  = (W+2·BLEED)" × (H+2·BLEED)"   e.g. 241 × 59
 *   px     = inches × PPI                  e.g. 241·150 × 59·150 = 36150 × 8850
 *
 * CLI:
 *   node scripts/build-bleed-panel.js \
 *     --in design.png --w 237 --h 55 --bleed 2 \
 *     --ppi 150 --dpi 1500 --fit exact \
 *     --out-tiff panel.tiff --out-proof proof.png
 *
 * Programmatic:
 *   const { buildBleedPanel } = require('./scripts/build-bleed-panel');
 *   await buildBleedPanel({ input: buf, widthIn: 237, heightIn: 55, bleedIn: 2 });
 */

const sharp = require("sharp");

// sharp guards very large images; a full 241×59 sheet @150ppi is ~320 MP.
sharp.cache(false);
sharp.concurrency(1); // memory-safe: one heavy pipeline at a time

/**
 * @param {object} o
 * @param {Buffer} o.input              flat design image bytes
 * @param {number} o.widthIn            panel TRIM width in inches  (visible print)
 * @param {number} o.heightIn           panel TRIM height in inches (visible print)
 * @param {number} [o.bleedIn=2]        bleed added on EVERY side, in inches
 * @param {number} [o.ppi=150]          working pixels-per-inch (shop = 150)
 * @param {number} [o.dpi=1500]         DPI tag embedded in the TIFF (RIP scales)
 * @param {'exact'|'cover'|'fill'} [o.fit='exact']
 *        exact = scale to trim, error if the design aspect would distort
 *        cover = scale to cover the trim, center-crop the overflow (no distort)
 *        fill  = stretch to the trim exactly (distorts; only if authored that way)
 * @param {string} [o.background='#000000'] color shown under any transparency
 * @param {'mirror'|'edge'} [o.bleedMode='mirror'] how the bleed is filled
 * @param {number} [o.aspectTolerance=0.01] allowed trim/design aspect mismatch
 * @returns {Promise<{ tiff: Buffer, proof: Buffer, meta: object }>}
 */
async function buildBleedPanel(o) {
  const {
    input,
    widthIn,
    heightIn,
    bleedIn = 2,
    ppi = 150,
    dpi = 1500,
    fit = "exact",
    background = "#000000",
    bleedMode = "mirror",
    aspectTolerance = 0.01,
  } = o;

  if (!input || !input.length) throw new Error("input image buffer is required");
  if (!(widthIn > 0) || !(heightIn > 0)) throw new Error("widthIn and heightIn (inches) are required and must be > 0");

  // ── Geometry (inches → pixels) ──────────────────────────────
  const trimWpx = Math.round(widthIn * ppi);
  const trimHpx = Math.round(heightIn * ppi);
  const bleedPx = Math.round(bleedIn * ppi);
  const sheetWpx = trimWpx + bleedPx * 2;
  const sheetHpx = trimHpx + bleedPx * 2;

  const src = sharp(input, { limitInputPixels: false });
  const srcMeta = await src.metadata();
  if (!srcMeta.width || !srcMeta.height) throw new Error("could not read source image dimensions");

  const trimAspect = widthIn / heightIn;
  const srcAspect = srcMeta.width / srcMeta.height;
  const aspectDelta = Math.abs(trimAspect - srcAspect) / trimAspect;
  const aspectMatches = aspectDelta <= aspectTolerance;
  const warnings = [];

  // ── 1. Flatten transparency → solid sheet, place at TRIM size ──
  // A single sharp pipeline (no intermediate PNG round-trips) keeps peak
  // memory ~1 decoded bitmap instead of 3 — important at full panel size.
  let resizeOpts;
  if (fit === "fill") {
    resizeOpts = { width: trimWpx, height: trimHpx, fit: "fill", kernel: "lanczos3" };
    if (!aspectMatches) warnings.push(`fit=fill STRETCHES the design (source ${srcAspect.toFixed(3)}:1 → trim ${trimAspect.toFixed(3)}:1). Not a pixel-true match.`);
  } else if (fit === "cover") {
    resizeOpts = { width: trimWpx, height: trimHpx, fit: "cover", position: "centre", kernel: "lanczos3" };
    if (!aspectMatches) warnings.push(`fit=cover preserves proportions but CENTER-CROPS the overflow to fill the trim.`);
  } else {
    // exact: pixel-true scale. Demands the design be authored to the panel
    // aspect — otherwise we refuse rather than silently distort.
    if (!aspectMatches) {
      throw new Error(
        `ASPECT MISMATCH: design is ${srcMeta.width}×${srcMeta.height} (${srcAspect.toFixed(3)}:1) but the ${widthIn}"×${heightIn}" panel is ${trimAspect.toFixed(3)}:1 ` +
        `(off by ${(aspectDelta * 100).toFixed(1)}%, tolerance ${(aspectTolerance * 100).toFixed(1)}%).\n` +
        `A true pixel-for-pixel match needs the design authored at the panel's proportions.\n` +
        `Re-run with --fit cover (crop overflow, no distortion) or --fit fill (stretch to exact rectangle) if that's intended.`
      );
    }
    resizeOpts = { width: trimWpx, height: trimHpx, fit: "fill", kernel: "lanczos3" };
  }

  const trimSheet = await src
    .flatten({ background }) // composite away ALL transparency → solid sheet
    .resize(resizeOpts)
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  // ── 2. Bleed: extend the artwork BLEED" to the edge ──────────
  const extendWith = bleedMode === "edge" ? "copy" : "mirror";
  const sheet = sharp(trimSheet.data, {
    raw: { width: trimSheet.info.width, height: trimSheet.info.height, channels: trimSheet.info.channels },
    limitInputPixels: false,
  }).extend({ top: bleedPx, bottom: bleedPx, left: bleedPx, right: bleedPx, extendWith });

  // ── 3a. Print-ready TIFF (real TIFF, DPI embedded) ───────────
  // JPEG-in-TIFF q95: a lossless LZW sheet at full size is 200 MB+; this is
  // 15–30 MB at print-indistinguishable quality (same as the GENIE worker).
  const tiff = await sheet
    .clone()
    .withMetadata({ density: dpi })
    .tiff({ compression: "jpeg", quality: 95 })
    .toBuffer();

  // ── 3b. Web proof PNG with trim + bleed legend ───────────────
  const proof = await buildProof(sheet.clone(), {
    sheetWpx, sheetHpx, bleedPx, widthIn, heightIn, bleedIn,
  });

  return {
    tiff,
    proof,
    meta: {
      trim_inches: `${widthIn}" × ${heightIn}"`,
      sheet_inches: `${widthIn + bleedIn * 2}" × ${heightIn + bleedIn * 2}"`,
      sheet_px: `${sheetWpx} × ${sheetHpx}`,
      bleed_inches: bleedIn,
      ppi,
      dpi,
      fit,
      source_px: `${srcMeta.width} × ${srcMeta.height}`,
      aspect_matches: aspectMatches,
      warnings,
    },
  };
}

/**
 * Downscaled PNG with a dashed trim line (where the installer cuts) inset
 * BLEED from the sheet edge, plus a dimensions caption. Purely a human proof —
 * the trim guide is NOT in the production TIFF.
 */
async function buildProof(sheet, { sheetWpx, sheetHpx, bleedPx, widthIn, heightIn, bleedIn }) {
  const PROOF_MAX = 1800; // longest side of the proof image
  const scale = Math.min(1, PROOF_MAX / Math.max(sheetWpx, sheetHpx));
  const pW = Math.max(1, Math.round(sheetWpx * scale));
  const pH = Math.max(1, Math.round(sheetHpx * scale));
  const inset = Math.round(bleedPx * scale);

  const base = await sheet.resize(pW, pH, { fit: "fill" }).png().toBuffer();

  const cap = 38;
  const svg = `
<svg width="${pW}" height="${pH + cap}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="${pH}" width="${pW}" height="${cap}" fill="#000000"/>
  <text x="${pW / 2}" y="${pH + 25}" fill="#00C7FF" font-family="monospace" font-size="20" text-anchor="middle">
    TRIM ${widthIn}" × ${heightIn}"   +${bleedIn}" BLEED → SHEET ${widthIn + bleedIn * 2}" × ${heightIn + bleedIn * 2}"
  </text>
  <rect x="${inset}" y="${inset}" width="${pW - inset * 2}" height="${pH - inset * 2}"
        fill="none" stroke="#FF00AA" stroke-width="2" stroke-dasharray="10 7"/>
  <text x="${inset + 8}" y="${inset + 22}" fill="#FF00AA" font-family="monospace" font-size="16">TRIM / CUT LINE</text>
</svg>`;

  return sharp(base)
    .extend({ bottom: cap, background: "#000000" })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toBuffer();
}

// ── CLI ───────────────────────────────────────────────────────
if (require.main === module) {
  const fs = require("fs");
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const k = process.argv[i].replace(/^--/, "");
    args[k] = process.argv[i + 1];
  }
  (async () => {
    if (!args.in) {
      console.error("usage: node scripts/build-bleed-panel.js --in <design> --w <in> --h <in> [--bleed 2] [--ppi 150] [--dpi 1500] [--fit exact|cover|fill] [--out-tiff f.tiff] [--out-proof p.png]");
      process.exit(1);
    }
    const { tiff, proof, meta } = await buildBleedPanel({
      input: fs.readFileSync(args.in),
      widthIn: Number(args.w),
      heightIn: Number(args.h),
      bleedIn: args.bleed != null ? Number(args.bleed) : 2,
      ppi: args.ppi != null ? Number(args.ppi) : 150,
      dpi: args.dpi != null ? Number(args.dpi) : 1500,
      fit: args.fit || "exact",
    });
    const tiffOut = args["out-tiff"] || "panel.tiff";
    const proofOut = args["out-proof"] || "panel-proof.png";
    fs.writeFileSync(tiffOut, tiff);
    fs.writeFileSync(proofOut, proof);
    console.log("✓ built deterministic panel");
    console.log(JSON.stringify(meta, null, 2));
    console.log(`TIFF  → ${tiffOut} (${(tiff.length / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`PROOF → ${proofOut} (${(proof.length / 1024).toFixed(0)} KB)`);
    if (meta.warnings.length) console.log("WARN:", meta.warnings.join(" | "));
  })().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
}

module.exports = { buildBleedPanel };
