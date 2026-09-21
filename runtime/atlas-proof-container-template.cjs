"use strict";
/**
 * runtime/atlas-proof-container-template.cjs — THE BLANK CONTAINER TEMPLATE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "produce a blank container template for
 * system" — it rides in the system instruction beside the FILLED reference, so
 * the model sees both the empty structure and a finished example of it.
 *
 * DRAWN BY CODE, NOT BY THE MODEL, and that is the whole point.
 *
 * A generated container is a container that can come back slightly different
 * every time, and the owner's own generated one came back reading "2012 TOYOTA
 * PRIORS" and "5 BLEON ON ALL FOUR EDGES". A teaching input with a typo in it
 * teaches the typo. This one is sharp + SVG: same manifest in, byte-identical
 * sheet out, no glyph the code did not place.
 *
 * It is also RULE 0.27 applied to the teaching input rather than the product:
 * "Code/GENIE deterministically builds the containers ... the A.I. owns the
 * design; the code owns the geometry."
 *
 * WHY IT IS NOT A BLANK CANVAS. RULE 0.33 removed a blank neutral guide from
 * Call 1 on measured evidence -- "a blank canvas handed to an image model reads
 * as content to interpret". This is the opposite object: every region is
 * captioned, banded and dimensioned, so it reads as a DOCUMENT with empty
 * fields rather than as an empty picture. The zone bands say in plain words
 * what belongs in each one.
 *
 * 3:2 at 1536x1024, matching the pinned filled reference exactly, so the two
 * attachments agree on geometry and the request's aspectRatio agrees with both.
 */

// SHARP IS REQUIRED LAZILY, INSIDE THE RASTERISER THAT NEEDS IT.
//
// This module's whole point is that `containerSvg` is pure -- the half that can
// also run in Deno, where sharp cannot load at all. A top-level require made
// that false at MODULE level: importing the file to call the pure function
// still needed libvips, so the "portable half" could not be loaded anywhere the
// rasteriser could not run. Found by a workspace with no node_modules, which is
// exactly the condition the edge twin lives in permanently.

const CONTAINER_CONTRACT = "designpro.atlas-proof-container-template.v1";
const WIDTH = 1536;
const HEIGHT = 1024;

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#cbd5e1";
const FRAME = "#94a3b8";
const ZONE1 = "#1d4ed8";
const ZONE2 = "#15803d";
const ZONE3 = "#ea580c";

/** The six surfaces, in the reading order the filled reference uses. */
const SURFACE_ORDER = Object.freeze([
  "driver", "passenger", "roof", "hood", "front", "rear",
]);

const LABEL = Object.freeze({
  driver: "DRIVER SIDE", passenger: "PASSENGER SIDE", roof: "ROOF",
  hood: "HOOD", front: "FRONT", rear: "REAR",
});

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const r1 = (n) => (Math.round(Number(n) * 10) / 10).toFixed(1);

// A KNOCK-OUT NARROWER THAN ITS OWN TEXT IS INVISIBLE UNTIL SOMETHING IS BEHIND IT.
// The height figure is drawn right-anchored at x-3 behind a white tag, and the tag
// was a fixed 34px while "141.0"" measures ~34 and "78.0"" ~28 -- so the leading
// digits fell OUTSIDE the tag. On the template alone the neighbour cell is white,
// so dark ink on white read perfectly and every render looked correct. Composited
// over the model's artwork the same glyphs are dark on dark green, and the live
// sheet read "8.0"", "2.0"" and "6.0"" for 68, 42 and 36 -- indistinguishable from
// the dimension hallucination this whole change exists to remove.
// 5.6 is the per-character advance measured on the embedded face at these sizes,
// rounded up; over-wide is a slightly larger white tag, under-wide is a wrong number.
const CHAR_ADVANCE = 5.6;
const textWidth = (value, size) => String(value).length * CHAR_ADVANCE * (size / 9.5);

function text(x, y, value, { size = 11, fill = INK, weight = 400, anchor = "start", spacing = 0 } = {}) {
  return `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}"`
    + ` font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"`
    + (spacing ? ` letter-spacing="${spacing}"` : "") + `>${esc(value)}</text>`;
}

function zoneBand(x, y, w, colour, title, note) {
  return `<rect x="${x}" y="${y}" width="${w}" height="22" fill="${colour}"/>`
    + text(x + 10, y + 15.5, title, { size: 11.5, fill: "#ffffff", weight: 700, spacing: 0.4 })
    + (note ? text(x + w - 10, y + 15.5, note, { size: 10, fill: "#ffffff", anchor: "end" }) : "");
}

/**
 * An empty panel cell: the frame the artwork fills, plus its measured lines.
 *
 * The dimension lines are DRAWN -- arrowheads, extension lines, the figure set
 * on the line -- because that is the drafting convention the contract asks the
 * model to follow, and showing it is worth more than describing it.
 */
function panelCell(x, y, w, h, { widthIn, heightIn, caption, detail = [], dimension = true, fill = "#ffffff" }) {
  const out = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${FRAME}" stroke-width="1"/>`];
  if (dimension && widthIn != null) {
    const dy = y - 12;
    const label = `${r1(widthIn)}"`;
    const tw = textWidth(label, 9.5) + 8;
    out.push(`<line x1="${x}" y1="${dy}" x2="${x + w}" y2="${dy}" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${x}" y1="${dy - 4}" x2="${x}" y2="${dy + 4}" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${x + w}" y1="${dy - 4}" x2="${x + w}" y2="${dy + 4}" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${x}" y1="${dy}" x2="${x}" y2="${y}" stroke="${RULE}" stroke-width="0.5"/>`,
      `<line x1="${x + w}" y1="${dy}" x2="${x + w}" y2="${y}" stroke="${RULE}" stroke-width="0.5"/>`,
      `<rect x="${x + w / 2 - tw / 2}" y="${dy - 7}" width="${tw}" height="12" fill="#ffffff"/>`,
      text(x + w / 2, dy + 3.5, label, { size: 9.5, anchor: "middle" }));
  }
  if (dimension && heightIn != null) {
    const dx = x - 12;
    const label = `${r1(heightIn)}"`;
    const tw = textWidth(label, 9.5) + 8;
    out.push(`<line x1="${dx}" y1="${y}" x2="${dx}" y2="${y + h}" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${dx - 4}" y1="${y}" x2="${dx + 4}" y2="${y}" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${dx - 4}" y1="${y + h}" x2="${dx + 4}" y2="${y + h}" stroke="${INK}" stroke-width="0.8"/>`,
      `<rect x="${dx - tw}" y="${y + h / 2 - 6}" width="${tw}" height="12" fill="#ffffff"/>`,
      text(dx - 4, y + h / 2 + 3.5, label, { size: 9.5, anchor: "end" }));
  }
  out.push(text(x + w / 2, y + h + 15, caption, { size: 10, weight: 700, anchor: "middle" }));
  detail.forEach((line, i) => out.push(
    text(x + w / 2, y + h + 27 + i * 10, line, { size: 8, fill: MUTED, anchor: "middle" })));
  return out.join("");
}

/** Lay six cells across a band, each scaled to its own proportion. */
// GAP 56, AND IT IS THE HEIGHT LABEL THAT SETS IT. panelCell draws the height
// dimension at x-12 behind a knock-out sized from the text, so the widest figure
// this sheet carries ("141.0"", 41.6px of tag) reaches x-53.6. Anything narrower
// than that puts the tag INSIDE the previous cell, where it either overprints a
// neighbouring dimension (the 22px original) or -- once artwork is composited
// behind it -- clips the leading digits off a correct number (the 42px second
// attempt, which read "8.0"" for 68). The gap is derived from the label, not
// chosen: raise the figures' size or add a digit and this must move with it.
/**
 * WHERE the cells go. Pure geometry, no drawing -- and it is SEPARATE from the
 * drawing on purpose.
 *
 * The inspector gate has to judge the panel CELLS of a returned proof, not the
 * white document around them: `edgeHoleRatio`, `nonBlackFraction` and the
 * output-class inspector all measure a whole sheet today and would convict a
 * correct proof instantly, because a proof sheet IS mostly white. So the gate
 * needs the cell rectangles -- and the only thing that truly knows them is the
 * code that drew them. Deriving them a second time somewhere else is how the
 * drawing and the checking drift apart; RULE 0.27's "the code owns the
 * geometry" applied to validation rather than to authoring.
 */
function layoutRow(surfaces, { top, height, left = 56, right = 1482, gap = 56 }) {
  const usable = right - left - gap * (surfaces.length - 1);
  const totalW = surfaces.reduce((sum, s) => sum + s.widthIn, 0);
  let x = left;
  return surfaces.map((s) => {
    const w = Math.max(56, Math.round((s.widthIn / totalW) * usable));
    const h = Math.min(height, Math.round(w * (s.heightIn / s.widthIn)));
    const cell = { surfaceKey: s.surfaceKey, x, y: top + (height - h), w, h,
      widthIn: s.widthIn, heightIn: s.heightIn };
    x += w + gap;
    return cell;
  });
}

/** Lay six cells across a band, each scaled to its own proportion. */
function row(surfaces, opts) {
  const { detail } = opts;
  return layoutRow(surfaces, opts).map((cell) => panelCell(cell.x, cell.y, cell.w, cell.h, {
    widthIn: cell.widthIn, heightIn: cell.heightIn,
    caption: LABEL[cell.surfaceKey] || cell.surfaceKey.toUpperCase(),
    detail: detail ? detail(cell) : [],
    fill: opts.fill,
  })).join("");
}

/** The two panel bands' geometry, for the gate. Same numbers the sheet draws. */
const BAND = Object.freeze({ zone1: { top: 150, height: 150 }, zone2: { top: 414, height: 150 } });

/**
 * ZONE 3'S FIVE SLOTS, IN THE ONE PLACE THAT KNOWS WHERE THEY ARE.
 *
 * Owner, 2026-09-18, on what the sheet is: "the three quadrants ... panels with
 * the graphics, panels without the overlay graphic just the design, and the
 * graphic overlays by themselves."
 *
 * All three are cut out of the returned sheet and shipped, so all three need
 * their rectangles. Zones 1 and 2 already came from `layoutRow`; zone 3's were
 * literals inside the drawing loop, which meant the cutter would have had to
 * re-derive them and the two would drift the first time a slot width changed.
 * The drawing now reads THIS, so there is exactly one set of numbers.
 */
const ZONE3_SLOTS = Object.freeze([
  { key: "logo", w: 330, caption: "PRIMARY LOGO", note: "(Vector cut path — no background)" },
  { key: "tagline", w: 210, caption: "TAGLINE / SLOGAN", note: "(Vector cut path)" },
  { key: "contact", w: 210, caption: "CONTACT LINE", note: "(Vector cut path)" },
  { key: "promo", w: 210, caption: "PROMOTIONAL TEXT", note: "(Vector cut path)" },
  { key: "icons", w: 400, caption: "ICONS / SERVICE GRAPHICS", note: "(Vector cut paths)" },
]);
const ZONE3_BAND = Object.freeze({ top: 690, height: 86, left: 54, gap: 18 });

/** Where each cut-graphic slot sits, in the container's own coordinates. */
function layoutCutGraphics() {
  let x = ZONE3_BAND.left;
  return ZONE3_SLOTS.map((slot) => {
    const cell = { surfaceKey: slot.key, x, y: ZONE3_BAND.top, w: slot.w, h: ZONE3_BAND.height,
      caption: slot.caption, note: slot.note };
    x += slot.w + ZONE3_BAND.gap;
    return cell;
  });
}

function containerLayout(manifest) {
  const surfaces = surfacesFrom(manifest);
  if (surfaces.length !== 6) {
    throw new Error(`atlas_container_template_needs_six_surfaces:${surfaces.length}`);
  }
  return {
    width: WIDTH,
    height: HEIGHT,
    zone1: layoutRow(surfaces, BAND.zone1),
    zone2: layoutRow(surfaces, BAND.zone2),
    zone3: layoutCutGraphics(),
  };
}

/**
 * The contract's OWN row strings -> a manifest this renderer can draw.
 *
 * `buildPanelProofPrompt` states the panels to the model as
 * `DRIVER: 165.7" wide x 49.6" high`, and the container has to draw the SAME
 * six rectangles the prompt names. Parsing that one format here means there is
 * exactly one place the two can agree or disagree, instead of a caller
 * re-deriving inches beside a caller that states them.
 */
function parsePanelRows(rows) {
  const zones = [];
  for (const raw of Array.isArray(rows) ? rows : []) {
    const m = /^\s*([A-Za-z ]+?)\s*:\s*([0-9.]+)"?\s*wide\s*x\s*([0-9.]+)"?\s*high/i.exec(String(raw || ""));
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/\s+side$/, "").replace(/\s+/g, "");
    const widthIn = Number(m[2]);
    const heightIn = Number(m[3]);
    if (!SURFACE_ORDER.includes(key) || !Number.isFinite(widthIn) || !Number.isFinite(heightIn)) continue;
    zones.push({ surfaceKey: key, trimInches: { widthIn, heightIn } });
  }
  return { zones };
}

/** GENIE surfaces → the rows this sheet draws. Falls back to nothing. */
function surfacesFrom(manifest = {}) {
  const zones = Array.isArray(manifest.zones) ? manifest.zones : [];
  const byKey = new Map();
  for (const zone of zones) {
    const trim = zone?.trimInches || zone?.trim || {};
    const widthIn = Number(trim.widthIn ?? trim.w);
    const heightIn = Number(trim.heightIn ?? trim.h);
    if (zone?.surfaceKey && Number.isFinite(widthIn) && Number.isFinite(heightIn)) {
      byKey.set(String(zone.surfaceKey), { surfaceKey: String(zone.surfaceKey), widthIn, heightIn });
    }
  }
  return SURFACE_ORDER.map((k) => byKey.get(k)).filter(Boolean);
}

/**
 * TWO MODES, ONE DRAWING.
 *
 * "template" is the blank sheet shown to the model. "chrome" is the SAME
 * drawing with every opaque ground removed, so it can be composited OVER the
 * artwork the model returns.
 *
 * WHY THAT EXISTS. Live sheet 35393135814 printed the driver panel as
 * 195.7" x 89.6" in Zone 1, 155.7" x 49.6" in Zone 2 and 105.7" x 49.6" in its
 * own reference table -- against a request that said 141 x 78 and a container
 * with "141.0" burned into it TEN times and "78.0" TWELVE times. The template
 * notes and the guide legend came back as word-salad ("Drop-impertanli
 * zlomadte onteed: 1" frore the ican lew").
 *
 * So baking the numbers into the attachment was already done and did not work,
 * because the model does not FILL the template -- it redraws a picture that
 * resembles it, and every glyph in that picture is re-typed. A 8px numeral
 * re-typed by a diffusion model is a guess with a plausible shape.
 *
 * The answer is RestylePro's, which solved this exact problem and states it in
 * as many words (RULE 1 -- recover before you invent): "the sheet is assembled
 * by CODE ... Header, footer, tile labels and per-tile GENIE callouts are
 * DRAWN, never prompted, SO THEY CANNOT BE HALLUCINATED."
 *
 * A number the model never types is a number it cannot get wrong. Nothing about
 * the ARTWORK changes -- the company name, the contact line and the service
 * strings stay model-drawn, because those came back perfect on every live sheet
 * and they belong to the design.
 */
/**
 * THE SVG IS BUILT PURELY, AND THE RASTERISER IS THE ONLY PART THAT IS NOT.
 *
 * Split out so the SAME drawing can run in the edge function. I said for three
 * exchanges that the container could not be rendered inside Deno; that is true
 * of sharp and I over-generalised it to the whole render. The drawing is string
 * concatenation with no dependency at all, and resvg-wasm rasterises it in
 * Deno. Separating the two makes the portable half portable.
 */
function containerSvg({ manifest = {}, companyName = "", vehicle = "", bleedInches = 5,
  mode = "template", job = {}, dimensionManifest,
  /**
   * DOES A LETTERING-FREE CLEAN BASE ACTUALLY EXIST FOR THIS DESIGN?
   *
   * Zone 2's bar used to assert "BACKGROUNDS ONLY (NO TEXT OR LOGO)"
   * unconditionally. That is true only while the clean-base element graph is
   * on: with it off, DesignPanelAI draws the logo and lettering INTO the
   * artwork (the Sept 17-18 configuration the owner selected on 2026-09-21),
   * so the Zone 2 panels legitimately carry type — and a document that prints
   * "no text or logo" over panels with text on them is the claiming-what-was-
   * never-established failure this repo has now recorded six times, printed on
   * the customer's own proof.
   *
   * So the bar states what the row IS. The geometry, the captions and every
   * dimension are untouched, and with a clean base present the wording is
   * byte-identical to what it has always been.
   */
  cleanBase = true } = {}) {
  const chrome = mode === "chrome";
  const ground = chrome ? "none" : "#ffffff";
  const surfaces = surfacesFrom(manifest);
  if (surfaces.length !== 6) {
    throw new Error(`atlas_container_template_needs_six_surfaces:${surfaces.length}`);
  }
  // Only artwork destinations reach the model. Document chrome is composed later.
  if (mode === "artwork") {
    const cells = containerLayout(manifest).zone2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`
      + `<rect width="100%" height="100%" fill="#ffffff"/>`
      + cells.map(cell => `<rect x="${cell.x}" y="${cell.y}" width="${cell.w}" height="${cell.h}" fill="#d1d5db"/>`).join("")
      + `</svg>`;
  }
  // Artwork rows can describe print rectangles. Use authoritative GENIE
  // dimensions for labels without changing those rectangles or adding bleed twice.
  const dimensions = new Map((dimensionManifest?.zones || []).map(zone => [String(zone.surfaceKey), zone]));
  const trimOf = (s) => {
    const zone = dimensions.get(s.surfaceKey);
    return { w: Number(zone?.trimWidthIn ?? s.widthIn), h: Number(zone?.trimHeightIn ?? s.heightIn) };
  };
  const printOf = (s) => {
    const zone = dimensions.get(s.surfaceKey);
    const trim = trimOf(s);
    return { w: Number(zone?.printWidthIn ?? trim.w + bleedInches * 2),
      h: Number(zone?.printHeightIn ?? trim.h + bleedInches * 2) };
  };

  // EVERY PANEL CARRIES ITS OWN TRIM / PRINT / BLEED, IN BOTH ZONES -- which is
  // what the owner's filled twin does, and it is also the only place the sheet
  // states the difference between the rectangle the shop CUTS and the rectangle
  // it PRINTS. Zone 1 had the captions without it, so a reader of the blank
  // template learned the panel names and not the numbers under them.
  //
  // PER-PANEL SQUARE FOOTAGE, added 2026-09-21. The owner's own gold-standard
  // sheets carry it on every panel ("with 5\" bleed - 101.4 sq ft"), and she
  // asked for it directly: "if it knows make and model it must calculate sq ft
  // on PanelProductionSheet document". It is the figure a shop actually orders
  // material by, and the sheet stated a total while stating no part of it.
  //
  // It is the PRINT area -- the rectangle that goes on the roll, bleed
  // included -- because that is what is bought. The header's TOTAL COVERAGE is
  // the TRIM area, what lands on the vehicle, and the two are DIFFERENT
  // NUMBERS ON PURPOSE. So the header now also states the material total, or a
  // reader would reasonably try to sum these and find they do not reach it.
  // Both are computed from the GENIE manifest; neither is ever copied.
  const panelDetail = (s) => {
    const p = printOf(s);
    return [`TRIM ${r1(trimOf(s).w)}" x ${r1(trimOf(s).h)}"`,
      `PRINT ${r1(p.w)}" x ${r1(p.h)}"`,
      `${bleedInches}" bleed all edges — ${((p.w * p.h) / 144).toFixed(1)} sq ft`];
  };

  // TOTAL COVERAGE IS COMPUTED, NEVER COPIED. The owner's filled sheet carries
  // "TOTAL COVERAGE: 176.26 SQ FT" and that figure reproduces from none of the
  // dimensions printed beside it -- its per-panel square footages do not match
  // its own trim or print rectangles either, because a diffusion model wrote
  // them. This one is the sum of the GENIE trim areas and nothing else, so the
  // blank template can never teach arithmetic that does not close.
  const totalTrimSqFt = surfaces.reduce((sum, s) => sum + (trimOf(s).w * trimOf(s).h) / 144, 0);
  // The material total, which the per-panel figures DO sum to.
  const totalPrintSqFt = surfaces.reduce(
    (sum, s) => sum + (printOf(s).w * printOf(s).h) / 144, 0);
  const m = [];

  // ── the knock-out, in chrome mode only ──────────────────────────────────
  //
  // THE MODEL'S OWN METADATA IS COVERED, NOT ARGUED WITH. Compositing code-drawn
  // captions over a sheet that still carries the model's produces the doubling
  // measured on 35393135814's composite: "DRIVER SIDEDRIVER SIDE", two sets of
  // dimensions, "Cedar & Stone Tree Caree". The prompt now asks for artwork
  // only, and this makes that instruction unnecessary to obey.
  //
  // EVERY ONE OF THESE RECTANGLES IS DOCUMENT MARGIN — the header above the
  // first band, the caption strips BETWEEN bands, and the reference/notes/legend
  // block below the last one. No panel occupies any of them in the container,
  // and no live sheet has drawn artwork into one. The bands themselves are never
  // knocked out, which is why the artwork survives.
  if (chrome) {
    for (const [kx, ky, kw, kh] of [
      [0, 0, WIDTH, 100],        // header and job block
      [0, 300, WIDTH, 70],       // under zone 1
      [0, 564, WIDTH, 82],       // under zone 2
      [0, 778, WIDTH, HEIGHT - 778], // zone 3 captions, reference row, notes, legend, footer
    ]) {
      m.push(`<rect x="${kx}" y="${ky}" width="${kw}" height="${kh}" fill="#ffffff"/>`);
    }
  }

  // ── header ───────────────────────────────────────────────────────────────
  if (!chrome) m.push(`<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`);
  m.push(text(54, 44, companyName || "COMPANY NAME", { size: 23, weight: 700, spacing: 0.2 }));
  m.push(text(54, 61, "VEHICLE WRAP PRODUCTION TEMPLATE", { size: 9, fill: MUTED, spacing: 1.3 }));
  m.push(text(WIDTH / 2, 44, "2D PRODUCTION PROOF", { size: 21, weight: 700, anchor: "middle", spacing: 0.4 }));
  m.push(text(WIDTH / 2, 61, vehicle || "VEHICLE", { size: 10, fill: MUTED, anchor: "middle", spacing: 0.6 }));
  m.push(text(WIDTH / 2, 77, `TOTAL COVERAGE (TRIM): ${totalTrimSqFt.toFixed(2)} SQ FT`
    + `  |  MATERIAL (WITH ${bleedInches}" BLEED): ${totalPrintSqFt.toFixed(2)} SQ FT`
    + `  |  EVERY PANEL DIMENSIONED BY GENIE`,
    { size: 8.5, fill: MUTED, anchor: "middle", spacing: 0.3 }));
  m.push(`<rect x="1180" y="22" width="302" height="62" fill="none" stroke="${RULE}" stroke-width="1"/>`);
  // THE JOB BLOCK IS FILLED BY CODE WHEN THE REQUEST CARRIES IT, and left as a
  // ruled line when it does not. The prompt used to ask the model for these four
  // values; once the document became the code's job that instruction was one the
  // model is told to ignore, and deleting it without drawing them here would
  // have silently dropped a supplied order number off the sheet.
  [["DATE:", job.date], ["ORDER #:", job.order], ["DESIGNER:", job.designer],
    ["VERSION:", job.version]].forEach(([k, v], i) => {
    m.push(text(1192, 38 + i * 14, k, { size: 8.5, fill: MUTED }));
    if (v) m.push(text(1262, 38 + i * 14, v, { size: 8.5 }));
    else m.push(`<line x1="1258" y1="${41 + i * 14}" x2="1470" y2="${41 + i * 14}" stroke="${RULE}" stroke-width="0.7"/>`);
  });
  m.push(`<line x1="0" y1="96" x2="${WIDTH}" y2="96" stroke="${INK}" stroke-width="1.5"/>`);

  // ── zone 1: the finished panels ──────────────────────────────────────────
  m.push(zoneBand(54, 108, 1428, ZONE1,
    "ZONE 1 — FULL DESIGN PANELS (PHOTO + DESIGN + TEXT + LOGO)",
    "6 PANELS — COMPLETE WRAP ARTWORK"));
  m.push(row(surfaces, { ...BAND.zone1, detail: panelDetail, fill: ground }));

  // ── zone 2: the same panels, artwork only ────────────────────────────────
  m.push(zoneBand(54, 372, 1428, ZONE2,
    cleanBase
      ? "ZONE 2 — BACKGROUNDS ONLY (NO TEXT OR LOGO)"
      : "ZONE 2 — PRINT PANELS AS AUTHORED",
    cleanBase
      ? "6 PANELS — BACKGROUND ARTWORK ONLY"
      : "6 PANELS — ARTWORK, LETTERING AND LOGO AS DESIGNED"));
  m.push(row(surfaces, { ...BAND.zone2, detail: panelDetail, fill: ground }));

  // ── zone 3: the elements alone ───────────────────────────────────────────
  m.push(zoneBand(54, 648, 1428, ZONE3,
    "ZONE 3 — CUT GRAPHICS (LOGO, TEXT & ICONS ONLY)",
    "VECTOR CUT PATHS — NO BACKGROUND"));
  for (const slot of layoutCutGraphics()) {
    m.push(`<rect x="${slot.x}" y="${slot.y}" width="${slot.w}" height="${slot.h}" fill="${ground}"`
      + ` stroke="${FRAME}" stroke-width="1" stroke-dasharray="5 4"/>`);
    m.push(text(slot.x + slot.w / 2, 792, slot.caption, { size: 9.5, weight: 700, anchor: "middle" }));
    m.push(text(slot.x + slot.w / 2, 803, slot.note, { size: 7.5, fill: MUTED, anchor: "middle" }));
  }

  // ── trim table, notes, legend ────────────────────────────────────────────
  m.push(`<line x1="0" y1="826" x2="${WIDTH}" y2="826" stroke="${RULE}" stroke-width="1"/>`);
  m.push(text(54, 846, "PANEL DIMENSIONS REFERENCE (TRIM SIZE)", { size: 9.5, weight: 700 }));
  let cx = 54;
  for (const s of surfaces) {
    m.push(text(cx, 864, LABEL[s.surfaceKey] || s.surfaceKey.toUpperCase(), { size: 8, fill: MUTED }));
    m.push(text(cx, 877, `${r1(trimOf(s).w)}" x ${r1(trimOf(s).h)}"`, { size: 9 }));
    cx += 118;
  }
  m.push(text(838, 846, "TEMPLATE NOTES:", { size: 9.5, weight: 700 }));
  [
    `1. All panels include ${bleedInches}" bleed on all four edges.`,
    "2. Keep important elements at least 3\" from the trim line.",
    "3. Zone 1: full artwork with photo, design, text and logo.",
    "4. Zone 2: backgrounds only — no text or logo.",
    "5. Zone 3: vector cut graphics only — no background.",
  ].forEach((line, i) => m.push(text(838, 862 + i * 12, line, { size: 8, fill: MUTED })));
  m.push(`<rect x="1204" y="836" width="278" height="74" fill="none" stroke="${RULE}" stroke-width="1"/>`);
  m.push(text(1216, 851, "GUIDE (FOR REFERENCE ONLY)", { size: 8.5, weight: 700 }));
  [["#ec4899", "Panel size (with bleed)"], ["#16a34a", "Trim line (finished size)"],
    ["#2563eb", "Safe zone (keep critical elements inside)"]].forEach(([colour, label], i) => {
    m.push(`<rect x="1216" y="${860 + i * 15}" width="24" height="10" fill="none" stroke="${colour}"`
      + ` stroke-width="1.2" stroke-dasharray="4 3"/>`);
    m.push(text(1248, 869 + i * 15, `= ${label}`, { size: 8, fill: MUTED }));
  });

  // ── footer ───────────────────────────────────────────────────────────────
  m.push(`<line x1="0" y1="934" x2="${WIDTH}" y2="934" stroke="${INK}" stroke-width="1.5"/>`);
  m.push(text(54, 962, `${companyName || "COMPANY NAME"} — ${vehicle || "VEHICLE"} — 2D PRODUCTION PROOF TEMPLATE`,
    { size: 9, fill: MUTED }));
  m.push(text(WIDTH - 54, 962, CONTAINER_CONTRACT, { size: 8, fill: MUTED, anchor: "end" }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`
    + (chrome ? "" : `<rect width="100%" height="100%" fill="#ffffff"/>`) + `${m.join("")}</svg>`;
}

/** Rasterise with sharp. The runtime half; the edge uses resvg-wasm instead. */
async function renderContainerTemplate(options = {}) {
  const sharp = require("sharp");
  const svg = containerSvg(options);
  return sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

module.exports = {
  ZONE3_SLOTS, layoutCutGraphics,
  CONTAINER_CONTRACT,
  WIDTH,
  HEIGHT,
  SURFACE_ORDER,
  containerLayout,
  containerSvg,
  parsePanelRows,
  renderContainerTemplate,
  _test: { surfacesFrom, panelCell, row, layoutRow, BAND },
};
