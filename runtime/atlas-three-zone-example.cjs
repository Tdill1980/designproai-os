"use strict";
/**
 * runtime/atlas-three-zone-example.cjs — THE THREE-ZONE PROOF, DRAWN IN CODE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-21: "Recreate in code. But call one is not atlas and it should
 * say example."
 *
 * ═══ WHY IN CODE AND NOT A PINNED PNG ═══
 *
 * Call 1 is shown a filled three-zone sheet so the model understands that its
 * artwork gets SEPARATED downstream — Zone 2 is the same panels with the
 * lettering left off, Zone 3 is the brand elements lifted out — which is why it
 * has to leave a deliberate calm area for the lockup instead of painting edge
 * to edge and hoping.
 *
 * That example used to be a stored PNG, and a stored PNG has two failure modes
 * this repository has already paid for:
 *
 *   1. THE COPY THAT CIRCULATES IS A SCREENSHOT. The versions that get passed
 *      around carry an "EXAMPLE" badge burned across Zone 2 and a UI widget in
 *      the corner. `atlas-examples/installer-one-panel-per-side.png` is the
 *      precedent sitting in the same folder: a still "with its own title text
 *      and watermark", and live sheet 35402317471 ANSWERED the watermark. A
 *      teaching input is learned exactly as it arrives.
 *   2. IT DRIFTS FROM THE DOCUMENT IT CLAIMS TO SHOW. The stored sheet was
 *      already replaced once for teaching a different document than the one
 *      being asked for (the Arctic Air sheet carried ONE version where the
 *      contract asks for THREE).
 *
 * Drawing it from `atlas-proof-container-template.cjs` closes both. The example
 * IS the real template — same `containerLayout`, same bands, same cells — so it
 * cannot drift from the document the production system actually produces, and
 * the word EXAMPLE is placed deliberately rather than inherited from someone's
 * screen capture.
 *
 * ═══ WHERE "EXAMPLE" GOES, AND WHY NOT ACROSS THE PANELS ═══
 *
 * In the CHROME only: the header, every zone bar, and the footer. Never over a
 * cell.
 *
 * The owner asked for it to say example, and it says so four times. But the
 * chrome is document furniture that the Call-1 prompt already forbids the model
 * to reproduce by name, so a word there is inert. A word laid across the
 * ARTWORK is the thing the 35402317471 precedent convicts, and `map_drawn`
 * convicts its cousins — captions and dimension text painted into a flank. The
 * request is honoured without rebuilding the defect it protects against.
 *
 * ═══ AND IT IS NOT CALLED A.T.L.A.S. ═══
 *
 * Owner: "call one is not atlas". The sheet says 2D PRODUCTION PROOF and
 * VEHICLE WRAP PRODUCTION TEMPLATE, which is what the document is. A.T.L.A.S.
 * is the flat six-surface master — engineering vocabulary for a different
 * object — and naming this after it teaches the model the wrong noun for the
 * wrong artifact.
 *
 * ZERO MODEL CALLS. Deterministic: the same bytes every run, so the staged
 * object is content-addressed and uploaded once.
 */

const { containerLayout, renderContainerTemplate, WIDTH, HEIGHT } = require("./atlas-proof-container-template.cjs");

const EXAMPLE_CONTRACT = "designpro.three-zone-example.v1";

/**
 * A FIXED VEHICLE, NOT THE CUSTOMER'S.
 *
 * The example teaches the FORMAT, so it must be identical on every run — a
 * sheet that changed with the customer's vehicle would be a new teaching input
 * each time, re-uploaded each time, and impossible to point at when judging a
 * refusal. These are the rows of the reference sheet the owner supplied.
 */
const EXAMPLE_SURFACES = Object.freeze([
  ["driver", 165.7, 49.6], ["passenger", 165.7, 49.6], ["roof", 43, 56],
  ["hood", 50, 41], ["front", 50, 22], ["rear", 58, 40],
].map(([surfaceKey, widthIn, heightIn]) => ({
  surfaceKey,
  // `surfacesFrom` reads `zone.trim`, so the example is stated in the shape the
  // real template consumes rather than a second one that would have to be kept
  // in step with it.
  trim: { widthIn, heightIn },
  printWidthIn: widthIn + 10,
  printHeightIn: heightIn + 10,
})));

/** The manifest shape both the layout and the renderer take. */
const EXAMPLE_MANIFEST = Object.freeze({ zones: EXAMPLE_SURFACES });

/**
 * A GENERIC BUSINESS, DELIBERATELY.
 *
 * RULE 0.24 keeps a structural reference free of artwork, wording, logo, brand
 * and industry authority. A real customer's name on a teaching sheet is exactly
 * the contamination that rule exists to prevent, and it would also put someone
 * else's client on every generation this product runs.
 */
const EXAMPLE_BRAND = Object.freeze({
  name: "NORTHPOINT",
  suffix: "SERVICES",
  tagline: "CLEAN WORK. DONE RIGHT.",
  contact: "(555) 555-0142  ·  northpointservices.com",
  promo: "FREE ESTIMATES",
  services: ["RESIDENTIAL", "COMMERCIAL", "EMERGENCY", "SERVICE PLANS"],
});

const INK = "#0b2d4d";
const ACCENT = "#1f6fb2";
const LIGHT = "#cfe4f5";

const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * SHRINK TYPE UNTIL IT FITS ITS BOX.
 *
 * Every cell on this sheet is a different width -- a 165.7" flank and a 50"
 * front are the same row -- and a fixed font size that suits the flank runs
 * straight off the front. The first render did exactly that: the service bar
 * read "RESIDENTIALCOMMERCIALEMERGENCYSERVICE PL" across four narrow panels and
 * the Zone 3 lines overflowed their dashed cells.
 *
 * 0.58em per character is the measured average advance for Helvetica bold caps,
 * which is what every string here is set in. It is an approximation, so it is
 * used to SHRINK ONLY -- never to justify or to claim a precise metric.
 */
function fitSize(value, maxWidth, desired, { min = 4, spacing = 0 } = {}) {
  const chars = String(value).length || 1;
  // 0.70, not 0.58. The first estimate was the bare glyph advance and ignored
  // the letter-spacing every string here carries, so "NORTHPOINT" still ran off
  // all four narrow panels after being "fitted". An estimate used to SHRINK
  // must err large, or it does not shrink enough.
  return Math.max(min, Math.min(desired, (maxWidth - chars * spacing) / (chars * 0.70)));
}

/**
 * The flowing ground every panel shares.
 *
 * ONE composition sampled at each panel's own aspect, never six unrelated
 * pictures: the whole point of the sheet is that six rectangles read as one
 * design, and an example whose panels did not agree would teach the opposite.
 */
function groundSvg(w, h, { seed = 0 } = {}) {
  const sweep = (yBase, amp, opacity, colour) => {
    const y = h * yBase;
    const a = h * amp;
    return `<path d="M0 ${y.toFixed(1)}`
      + ` C ${(w * 0.28).toFixed(1)} ${(y - a).toFixed(1)}, ${(w * 0.52).toFixed(1)} ${(y + a).toFixed(1)}, ${w} ${(y - a * 0.4).toFixed(1)}`
      + ` L ${w} ${h} L 0 ${h} Z" fill="${colour}" opacity="${opacity}"/>`;
  };
  // ⚠️ DO NOT ADD MOTIF HERE TO "ENRICH" THE SMALL PANELS. IT WAS TRIED.
  //
  // A diagonal cut and a chevron field were added to this shared function to
  // give the four small surfaces more to look at. Because it is SHARED, it
  // degraded the two flanks that were already right: the chevrons read as scuff
  // marks and the cut muddied every top-right corner. A fix aimed at four
  // panels damaged all six.
  //
  // The premise was wrong as well as the execution. On the reference sheet the
  // ROOF is pure background, the FRONT carries one line and the HOOD carries
  // the mark alone -- different surfaces carry different amounts, which is what
  // a real wrap does and what this sheet should teach. Equal complexity on
  // every panel teaches the opposite. Differentiation belongs in
  // `SURFACE_TREATMENT` below, per surface, not in the ground they share.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${w} ${h}">`
    + `<defs><linearGradient id="g${seed}" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${ACCENT}"/><stop offset="1" stop-color="${INK}"/></linearGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="url(#g${seed})"/>`
    + sweep(0.42, 0.20, 0.30, "#ffffff")
    + sweep(0.60, 0.14, 0.22, LIGHT)
    + sweep(0.80, 0.10, 0.30, "#ffffff")
    + `</svg>`;
}

/**
 * WHAT EACH SURFACE CARRIES — the sheet's real lesson.
 *
 * Read off the reference: the roof is background alone, the front carries a
 * single line, the hood carries the mark, the rear carries mark plus contact,
 * and only the two flanks carry the full lockup with the service bar. A wrap
 * designer does not put the same amount on a 165" flank and a 50" bumper, and
 * an example that did would teach a customer's roof to be as busy as their door.
 */
const SURFACE_TREATMENT = Object.freeze({
  driver: { lockup: "full", services: true },
  passenger: { lockup: "full", services: true },
  roof: { lockup: "none", services: false },
  hood: { lockup: "mark", services: false },
  front: { lockup: "line", services: false },
  rear: { lockup: "stacked", services: false },
});

/** The mark: a plain geometric device, never a real company's logo. */
function markSvg(size, colour = "#ffffff") {
  const c = size / 2;
  return `<circle cx="${c}" cy="${c}" r="${size * 0.44}" fill="none" stroke="${colour}" stroke-width="${size * 0.09}"/>`
    + `<path d="M${c - size * 0.22} ${c + size * 0.14} L${c} ${c - size * 0.22} L${c + size * 0.22} ${c + size * 0.14} Z"`
    + ` fill="${colour}"/>`;
}

/** Zone 1: the ground plus whatever THIS surface carries. */
function brandedPanelSvg(w, h, surfaceKey = "driver") {
  const treatment = SURFACE_TREATMENT[surfaceKey] || SURFACE_TREATMENT.driver;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${w} ${h}">`;
  // A roof is background. Nothing else, on purpose.
  if (treatment.lockup === "none") return open + `</svg>`;

  const markSize = Math.min(h * 0.34, w * 0.16);
  const out = [open];

  // THE MARK ALONE, centred — a hood.
  if (treatment.lockup === "mark") {
    out.push(`<g transform="translate(${((w - markSize * 1.4) / 2).toFixed(1)} ${((h - markSize * 1.4) / 2).toFixed(1)})">`);
    out.push(markSvg(markSize * 1.4));
    out.push(`</g>`, `</svg>`);
    return out.join("");
  }

  // ONE LINE — a front bumper. The reference carries the web address there and
  // nothing else, because that is all a 22"-tall strip can hold and be read.
  if (treatment.lockup === "line") {
    const size = fitSize(EXAMPLE_BRAND.contact, w * 0.82, h * 0.26, { spacing: 0.5 });
    // Set on the DARK upper ground. At y 0.58 it landed on the pale mid sweep
    // and the white type had almost no contrast -- which on a 22"-tall bumper
    // strip is the difference between readable and decorative.
    out.push(`<text x="${(w / 2).toFixed(1)}" y="${(h * 0.34).toFixed(1)}"`
      + ` font-family="Helvetica,Arial,sans-serif" font-size="${size.toFixed(1)}" font-weight="700"`
      + ` fill="#ffffff" text-anchor="middle" letter-spacing="0.5">${esc(EXAMPLE_BRAND.contact)}</text>`);
    out.push(`</svg>`);
    return out.join("");
  }

  // STACKED — a rear door: mark over name over contact, centred.
  if (treatment.lockup === "stacked") {
    const nameSize = fitSize(EXAMPLE_BRAND.name, w * 0.74, h * 0.16, { spacing: 1 });
    out.push(`<g transform="translate(${((w - markSize) / 2).toFixed(1)} ${(h * 0.10).toFixed(1)})">`);
    out.push(markSvg(markSize));
    out.push(`</g>`);
    out.push(`<text x="${(w / 2).toFixed(1)}" y="${(h * 0.56).toFixed(1)}"`
      + ` font-family="Helvetica,Arial,sans-serif" font-size="${nameSize.toFixed(1)}" font-weight="700"`
      + ` fill="#ffffff" text-anchor="middle" letter-spacing="1">${esc(EXAMPLE_BRAND.name)}</text>`);
    out.push(`<text x="${(w / 2).toFixed(1)}" y="${(h * 0.56 + nameSize * 1.05).toFixed(1)}"`
      + ` font-family="Helvetica,Arial,sans-serif" font-size="${(nameSize * 0.5).toFixed(1)}" font-weight="600"`
      + ` fill="${LIGHT}" text-anchor="middle" letter-spacing="2">${esc(EXAMPLE_BRAND.suffix)}</text>`);
    out.push(`</svg>`);
    return out.join("");
  }

  // FULL — a flank: the horizontal lockup and the service bar.
  const nameSize = Math.min(h * 0.19, w * 0.085);
  const barH = Math.max(10, h * 0.14);
  const slot = w / EXAMPLE_BRAND.services.length;
  const longest = Math.max(...EXAMPLE_BRAND.services.map((label) => label.length));
  const serviceSize = Math.min(barH * 0.46, fitSize("x".repeat(longest), slot * 0.88, barH * 0.46));
  const services = !treatment.services || serviceSize < 5 ? "" : EXAMPLE_BRAND.services.map((label, i) =>
    `<text x="${(slot * (i + 0.5)).toFixed(1)}" y="${(h - barH * 0.32).toFixed(1)}"`
    + ` font-family="Helvetica,Arial,sans-serif" font-size="${serviceSize.toFixed(1)}" font-weight="700"`
    + ` fill="#ffffff" text-anchor="middle" letter-spacing="0.4">${esc(label)}</text>`).join("");

  const gap = markSize * 0.28;
  const maxLockup = w * 0.92;
  const roomForText = Math.max(1, maxLockup - markSize - gap);
  const fittedName = Math.min(nameSize, fitSize(EXAMPLE_BRAND.name, roomForText, nameSize, { spacing: 1 }));
  const textWidth = fittedName * EXAMPLE_BRAND.name.length * 0.70 + EXAMPLE_BRAND.name.length;
  const lockupWidth = markSize + gap + textWidth;
  const startX = Math.max((w - maxLockup) / 2, (w - lockupWidth) / 2);
  const textX = startX + markSize + gap;
  const baseline = h * 0.34;
  out.push(
    `<g transform="translate(${startX.toFixed(1)} ${(baseline - markSize * 0.72).toFixed(1)})">`,
    markSvg(markSize),
    `</g>`,
    `<text x="${textX.toFixed(1)}" y="${baseline.toFixed(1)}" font-family="Helvetica,Arial,sans-serif"`
      + ` font-size="${fittedName.toFixed(1)}" font-weight="700" fill="#ffffff" text-anchor="start"`
      + ` letter-spacing="1">${esc(EXAMPLE_BRAND.name)}</text>`,
    `<text x="${textX.toFixed(1)}" y="${(baseline + fittedName * 0.92).toFixed(1)}" font-family="Helvetica,Arial,sans-serif"`
      + ` font-size="${(fittedName * 0.42).toFixed(1)}" font-weight="600" fill="${LIGHT}" text-anchor="start"`
      + ` letter-spacing="${(fittedName * 0.22).toFixed(1)}">${esc(EXAMPLE_BRAND.suffix)}</text>`,
    `<rect x="0" y="${(h - barH).toFixed(1)}" width="${w}" height="${barH.toFixed(1)}" fill="${INK}" opacity="0.82"/>`,
    services,
    `</svg>`,
  );
  return out.join("");
}

/** Zone 3: the elements alone, on nothing. */
function cutGraphicSvg(slot, w, h) {
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${w} ${h}">`;
  // Every Zone 3 line is fitted to its own cell. The first render spilled
  // "CLEAN WORK. DONE RIGHT." and the contact line straight out of their dashed
  // boxes and across their neighbours -- which on a cut-graphics zone reads as
  // one element overlapping another, the opposite of what it is teaching.
  const label = (value, size, y, weight = 700, spacing = 1) => {
    const fitted = fitSize(value, w * 0.86, size);
    return `<text x="${(w / 2).toFixed(1)}" y="${y.toFixed(1)}" font-family="Helvetica,Arial,sans-serif"`
      + ` font-size="${fitted.toFixed(1)}" font-weight="${weight}" fill="${INK}" text-anchor="middle"`
      + ` letter-spacing="${spacing}">${esc(value)}</text>`;
  };
  if (slot === "logo") {
    const size = h * 0.56;
    return open
      + `<g transform="translate(${(w * 0.16).toFixed(1)} ${((h - size) / 2).toFixed(1)})">${markSvg(size, INK)}</g>`
      + `<text x="${(w * 0.40).toFixed(1)}" y="${(h * 0.52).toFixed(1)}" font-family="Helvetica,Arial,sans-serif"`
      + ` font-size="${fitSize(EXAMPLE_BRAND.name, w * 0.56, h * 0.26).toFixed(1)}" font-weight="700"`
      + ` fill="${INK}" letter-spacing="1">${esc(EXAMPLE_BRAND.name)}</text>`
      + `<text x="${(w * 0.40).toFixed(1)}" y="${(h * 0.74).toFixed(1)}" font-family="Helvetica,Arial,sans-serif"`
      + ` font-size="${(h * 0.13).toFixed(1)}" font-weight="600" fill="${ACCENT}" letter-spacing="3">${esc(EXAMPLE_BRAND.suffix)}</text>`
      + `</svg>`;
  }
  if (slot === "tagline") return open + label(EXAMPLE_BRAND.tagline, h * 0.17, h * 0.56, 700, 0.6) + `</svg>`;
  if (slot === "contact") return open + label(EXAMPLE_BRAND.contact, h * 0.13, h * 0.56, 600, 0.2) + `</svg>`;
  if (slot === "promo") return open + label(EXAMPLE_BRAND.promo, h * 0.20, h * 0.58, 700, 1.2) + `</svg>`;
  // icons
  const n = EXAMPLE_BRAND.services.length;
  const cell = w / n;
  const size = Math.min(h * 0.44, cell * 0.5);
  return open + EXAMPLE_BRAND.services.map((s, i) =>
    `<g transform="translate(${(cell * (i + 0.5) - size / 2).toFixed(1)} ${(h * 0.14).toFixed(1)})">${markSvg(size, INK)}</g>`
    + `<text x="${(cell * (i + 0.5)).toFixed(1)}" y="${(h * 0.88).toFixed(1)}" font-family="Helvetica,Arial,sans-serif"`
    + ` font-size="${fitSize(s, cell * 0.92, h * 0.11).toFixed(1)}" font-weight="700" fill="${INK}"`
    + ` text-anchor="middle" letter-spacing="0.4">${esc(s)}</text>`).join("") + `</svg>`;
}

/**
 * THE WORD, IN THE CHROME.
 *
 * Header, all three zone bars, and the footer. Never over a cell — see the
 * header of this file for why that distinction is the whole safety argument.
 */
function exampleStampSvg(layout) {
  // ⚠️ THE STAMPS SIT WHERE NOTHING ELSE DOES. The first render put the badge on
  // top of the job block (ORDER #, VERSION) and the band text underneath the
  // right-hand zone caption. A teaching sheet whose own furniture collides is
  // teaching a broken document, so each position below is a measured gap: the
  // header badge goes under the centred title, and the band text is left of the
  // caption rather than through it.
  const bars = [
    { y: 128, x: 620 },  // zone 1 band
    { y: 392, x: 620 },  // zone 2 band
    { y: 668, x: 620 },  // zone 3 band
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}"`
    + ` viewBox="0 0 ${layout.width} ${layout.height}">`
    + `<rect x="54" y="68" width="172" height="21" rx="3" fill="${INK}"/>`
    + `<text x="140" y="83" font-family="Helvetica,Arial,sans-serif" font-size="11"`
    + ` font-weight="700" fill="#ffffff" text-anchor="middle" letter-spacing="4">EXAMPLE</text>`
    + bars.map(({ x, y }) =>
      `<text x="${x}" y="${y}" font-family="Helvetica,Arial,sans-serif" font-size="10" font-weight="700"`
      + ` fill="#ffffff" fill-opacity="0.85" letter-spacing="2">EXAMPLE — NOT A REAL JOB</text>`).join("")
    + `<text x="${layout.width - 54}" y="${layout.height - 14}" font-family="Helvetica,Arial,sans-serif"`
    + ` font-size="10" font-weight="700" fill="${INK}" text-anchor="end" letter-spacing="2">`
    + `EXAMPLE DOCUMENT — FORMAT REFERENCE ONLY</text>`
    + `</svg>`;
}

/**
 * The finished sheet. Deterministic: same bytes every call.
 *
 * Built exactly the way `assemblePanelProofMaster` builds a real one — render
 * the container template, then place artwork into its own cells — so the
 * example and the product cannot diverge.
 */
async function renderThreeZoneExample({ sharp = require("sharp") } = {}) {
  const layout = containerLayout(EXAMPLE_MANIFEST);
  const base = await renderContainerTemplate({
    manifest: EXAMPLE_MANIFEST,
    dimensionManifest: EXAMPLE_MANIFEST,
    companyName: `${EXAMPLE_BRAND.name} ${EXAMPLE_BRAND.suffix}`,
    vehicle: "EXAMPLE VEHICLE",
    bleedInches: 5,
    cleanBase: true,
    job: { date: "", order: "EXAMPLE", designer: "", version: "EXAMPLE" },
  });

  const layers = [];
  for (const [index, cell] of layout.zone2.entries()) {
    layers.push({
      input: await sharp(Buffer.from(groundSvg(cell.w, cell.h, { seed: index }))).png().toBuffer(),
      left: Math.round(cell.x), top: Math.round(cell.y),
    });
  }
  for (const [index, cell] of layout.zone1.entries()) {
    const ground = await sharp(Buffer.from(groundSvg(cell.w, cell.h, { seed: index }))).png().toBuffer();
    const branded = await sharp(ground)
      .composite([{ input: Buffer.from(brandedPanelSvg(cell.w, cell.h, cell.surfaceKey)), top: 0, left: 0 }])
      .png().toBuffer();
    layers.push({ input: branded, left: Math.round(cell.x), top: Math.round(cell.y) });
  }
  for (const cell of layout.zone3) {
    layers.push({
      input: await sharp(Buffer.from(cutGraphicSvg(cell.surfaceKey, cell.w, cell.h))).png().toBuffer(),
      left: Math.round(cell.x), top: Math.round(cell.y),
    });
  }
  layers.push({ input: Buffer.from(exampleStampSvg(layout)), top: 0, left: 0 });

  return sharp(base).composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = {
  EXAMPLE_CONTRACT,
  EXAMPLE_SURFACES,
  EXAMPLE_MANIFEST,
  EXAMPLE_BRAND,
  SURFACE_TREATMENT,
  WIDTH,
  HEIGHT,
  renderThreeZoneExample,
  _test: { groundSvg, brandedPanelSvg, cutGraphicSvg, exampleStampSvg },
};
