/**
 * atlas-proof-container-template.ts — THE CONTAINER TEMPLATE, DRAWN IN THE EDGE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-18: "just use template wired as a studio edge
 * function" — the panel studio renders its own container; a caller does not
 * pre-render one and hand it over.
 *
 * I ARGUED FOR THREE EXCHANGES THAT THIS COULD NOT LIVE HERE, AND THAT WAS
 * WRONG. The true statement is that *sharp* cannot live here: it is libvips,
 * a native binding, and Deno has no loader for it. I generalised that to the
 * whole render and concluded the container had to be drawn on the droplet and
 * cross as a storage reference. But the DRAWING is string concatenation with
 * no dependency at all, and `@resvg/resvg-wasm` rasterises SVG inside Deno. So
 * the drawing moves here — this file — and only the rasteriser is swapped.
 *
 * THIS FILE IS THE PORTABLE HALF, AND IT IS PURE ON PURPOSE. No imports, no
 * I/O, no wasm: `containerSvg()` takes a manifest and returns a string. The
 * rasteriser is `atlas-proof-container-render.ts` beside it, so a change to the
 * sheet never touches the wasm plumbing and a wasm failure can never change a
 * glyph.
 *
 * ITS TWIN IS `runtime/atlas-proof-container-template.cjs`, and the two are
 * locked by EXECUTION rather than by a string diff: `tests/atlas-proof-
 * container-template.test.mjs` transpiles this file with esbuild, runs both
 * builders over the same manifests and asserts the SVG is byte-identical. That
 * is the precedent `tests/designpro-persona-contract.test.mjs` sets for a
 * contract with two homes — a diff proves the text matches, executing proves
 * the OUTPUT does, and the output is what a customer sees.
 *
 * WHY IT IS DRAWN BY CODE AT ALL. A generated container comes back slightly
 * different every time, and the owner's own generated one read "2012 TOYOTA
 * PRIORS" and "5 BLEON ON ALL FOUR EDGES". A teaching input with a typo in it
 * teaches the typo. Same manifest in, byte-identical sheet out, no glyph the
 * code did not place. It is RULE 0.27 — "the A.I. owns the design; the code
 * owns the geometry" — applied to the teaching input rather than the product.
 *
 * WHY IT IS NOT A BLANK CANVAS. RULE 0.33 removed a blank neutral guide from
 * Call 1 on measured evidence: "a blank canvas handed to an image model reads
 * as content to interpret". This is the opposite object. Every region is
 * captioned, banded and dimensioned, so it reads as a DOCUMENT with empty
 * fields rather than as an empty picture, and the zone bands say in plain words
 * what belongs in each one.
 *
 * 3:2 at 1536x1024, matching the pinned filled reference exactly, so the two
 * attachments agree on geometry and the request's aspectRatio agrees with both.
 */

export const CONTAINER_CONTRACT = "designpro.atlas-proof-container-template.v1";
export const WIDTH = 1536;
export const HEIGHT = 1024;

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#cbd5e1";
const FRAME = "#94a3b8";
const ZONE1 = "#1d4ed8";
const ZONE2 = "#15803d";
const ZONE3 = "#ea580c";

/** The six surfaces, in the reading order the filled reference uses. */
export const SURFACE_ORDER = Object.freeze([
  "driver", "passenger", "roof", "hood", "front", "rear",
]) as readonly string[];

const LABEL: Record<string, string> = {
  driver: "DRIVER SIDE", passenger: "PASSENGER SIDE", roof: "ROOF",
  hood: "HOOD", front: "FRONT", rear: "REAR",
};

export interface ContainerSurface {
  surfaceKey: string;
  widthIn: number;
  heightIn: number;
}

export interface ContainerCell extends ContainerSurface {
  x: number; y: number; w: number; h: number;
}

export interface ContainerManifest {
  zones?: Array<Record<string, unknown>>;
}

export interface ContainerOptions {
  manifest?: ContainerManifest;
  companyName?: string;
  vehicle?: string;
  bleedInches?: number;
}

const esc = (v: unknown) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const r1 = (n: number) => (Math.round(Number(n) * 10) / 10).toFixed(1);

interface TextOptions {
  size?: number; fill?: string; weight?: number;
  anchor?: string; spacing?: number;
}

function text(x: number, y: number, value: unknown, opts: TextOptions = {}): string {
  const { size = 11, fill = INK, weight = 400, anchor = "start", spacing = 0 } = opts;
  return `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}"`
    + ` font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"`
    + (spacing ? ` letter-spacing="${spacing}"` : "") + `>${esc(value)}</text>`;
}

function zoneBand(x: number, y: number, w: number, colour: string, title: string, note: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="22" fill="${colour}"/>`
    + text(x + 10, y + 15.5, title, { size: 11.5, fill: "#ffffff", weight: 700, spacing: 0.4 })
    + (note ? text(x + w - 10, y + 15.5, note, { size: 10, fill: "#ffffff", anchor: "end" }) : "");
}

/**
 * An empty panel cell: the frame the artwork fills, plus its measured lines.
 *
 * The dimension lines are DRAWN — arrowheads, extension lines, the figure set
 * on the line — because that is the drafting convention the contract asks the
 * model to follow, and showing it is worth more than describing it.
 */
function panelCell(
  x: number, y: number, w: number, h: number,
  spec: { widthIn?: number | null; heightIn?: number | null; caption: string; detail?: string[]; dimension?: boolean },
): string {
  const { widthIn, heightIn, caption, detail = [], dimension = true } = spec;
  const out = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff" stroke="${FRAME}" stroke-width="1"/>`];
  if (dimension && widthIn != null) {
    const dy = y - 12;
    out.push(`<line x1="${x}" y1="${dy}" x2="${x + w}" y2="${dy}" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${x}" y1="${dy - 4}" x2="${x}" y2="${dy + 4}" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${x + w}" y1="${dy - 4}" x2="${x + w}" y2="${dy + 4}" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${x}" y1="${dy}" x2="${x}" y2="${y}" stroke="${RULE}" stroke-width="0.5"/>`,
      `<line x1="${x + w}" y1="${dy}" x2="${x + w}" y2="${y}" stroke="${RULE}" stroke-width="0.5"/>`,
      `<rect x="${x + w / 2 - 22}" y="${dy - 7}" width="44" height="12" fill="#ffffff"/>`,
      text(x + w / 2, dy + 3.5, `${r1(widthIn)}"`, { size: 9.5, anchor: "middle" }));
  }
  if (dimension && heightIn != null) {
    const dx = x - 12;
    out.push(`<line x1="${dx}" y1="${y}" x2="${dx}" y2="${y + h}" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${dx - 4}" y1="${y}" x2="${dx + 4}" y2="${y}" stroke="${INK}" stroke-width="0.8"/>`,
      `<line x1="${dx - 4}" y1="${y + h}" x2="${dx + 4}" y2="${y + h}" stroke="${INK}" stroke-width="0.8"/>`,
      `<rect x="${dx - 20}" y="${y + h / 2 - 6}" width="34" height="12" fill="#ffffff"/>`,
      text(dx - 3, y + h / 2 + 3.5, `${r1(heightIn)}"`, { size: 9.5, anchor: "end" }));
  }
  out.push(text(x + w / 2, y + h + 15, caption, { size: 10, weight: 700, anchor: "middle" }));
  detail.forEach((line, i) => out.push(
    text(x + w / 2, y + h + 27 + i * 10, line, { size: 8, fill: MUTED, anchor: "middle" })));
  return out.join("");
}

// GAP 42, NOT 22, AND IT IS THE HEIGHT LABEL THAT SETS IT. panelCell draws the
// height dimension at x-12 behind a knock-out box reaching x-32, so a 22px gap
// put every label except the first one 10px INSIDE the previous panel. Measured
// on the first render: the passenger, hood, front and rear figures all collided.
// The clearance the label needs is 32px plus air; anything below that silently
// overprints, which on a teaching input is a sheet that teaches a collision.
/**
 * WHERE the cells go. Pure geometry, no drawing — and it is SEPARATE from the
 * drawing on purpose.
 *
 * The inspector gate has to judge the panel CELLS of a returned proof, not the
 * white document around them: `edgeHoleRatio`, `nonBlackFraction` and the
 * output-class inspector all measure a whole sheet today and would convict a
 * correct proof instantly, because a proof sheet IS mostly white. So the gate
 * needs the cell rectangles — and the only thing that truly knows them is the
 * code that drew them.
 */
export function layoutRow(
  surfaces: ContainerSurface[],
  opts: { top: number; height: number; left?: number; right?: number; gap?: number },
): ContainerCell[] {
  const { top, height, left = 54, right = 1482, gap = 42 } = opts;
  const usable = right - left - gap * (surfaces.length - 1);
  const totalW = surfaces.reduce((sum, s) => sum + s.widthIn, 0);
  let x = left;
  return surfaces.map((s) => {
    const w = Math.max(56, Math.round((s.widthIn / totalW) * usable));
    const h = Math.min(height, Math.round(w * (s.heightIn / s.widthIn)));
    const cell = {
      surfaceKey: s.surfaceKey, x, y: top + (height - h), w, h,
      widthIn: s.widthIn, heightIn: s.heightIn,
    };
    x += w + gap;
    return cell;
  });
}

/** Lay six cells across a band, each scaled to its own proportion. */
function row(
  surfaces: ContainerSurface[],
  opts: { top: number; height: number; detail?: (cell: ContainerCell) => string[] },
): string {
  const { detail } = opts;
  return layoutRow(surfaces, opts).map((cell) => panelCell(cell.x, cell.y, cell.w, cell.h, {
    widthIn: cell.widthIn, heightIn: cell.heightIn,
    caption: LABEL[cell.surfaceKey] || cell.surfaceKey.toUpperCase(),
    detail: detail ? detail(cell) : [],
  })).join("");
}

/** The two panel bands' geometry, for the gate. Same numbers the sheet draws. */
export const BAND = Object.freeze({
  zone1: { top: 150, height: 150 },
  zone2: { top: 414, height: 150 },
});

/** GENIE surfaces → the rows this sheet draws. Falls back to nothing. */
export function surfacesFrom(manifest: ContainerManifest = {}): ContainerSurface[] {
  const zones = Array.isArray(manifest.zones) ? manifest.zones : [];
  const byKey = new Map<string, ContainerSurface>();
  for (const zone of zones) {
    const z = zone as Record<string, Record<string, unknown>> & { surfaceKey?: unknown };
    const trim = (z?.trimInches || z?.trim || {}) as Record<string, unknown>;
    const widthIn = Number(trim.widthIn ?? trim.w);
    const heightIn = Number(trim.heightIn ?? trim.h);
    if (z?.surfaceKey && Number.isFinite(widthIn) && Number.isFinite(heightIn)) {
      byKey.set(String(z.surfaceKey), { surfaceKey: String(z.surfaceKey), widthIn, heightIn });
    }
  }
  return SURFACE_ORDER.map((k) => byKey.get(k)).filter(Boolean) as ContainerSurface[];
}

export function containerLayout(manifest: ContainerManifest) {
  const surfaces = surfacesFrom(manifest);
  if (surfaces.length !== 6) {
    throw new Error(`atlas_container_template_needs_six_surfaces:${surfaces.length}`);
  }
  return {
    width: WIDTH,
    height: HEIGHT,
    zone1: layoutRow(surfaces, BAND.zone1),
    zone2: layoutRow(surfaces, BAND.zone2),
  };
}

/**
 * The contract's OWN row strings → a manifest this renderer can draw.
 *
 * `buildPanelProofPrompt` states the panels to the model as
 * `DRIVER: 165.7" wide x 49.6" high`, and the container has to draw the SAME
 * six rectangles the prompt names. Parsing that one format here means there is
 * exactly one place the two can agree or disagree, instead of a caller
 * re-deriving inches beside a caller that states them.
 */
export function parsePanelRows(rows: unknown): ContainerManifest {
  const zones: Array<Record<string, unknown>> = [];
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

/**
 * The whole sheet, as an SVG string. Deterministic and dependency-free.
 */
export function containerSvg(options: ContainerOptions = {}): string {
  const { manifest = {}, companyName = "", vehicle = "", bleedInches = 5 } = options;
  const surfaces = surfacesFrom(manifest);
  if (surfaces.length !== 6) {
    throw new Error(`atlas_container_template_needs_six_surfaces:${surfaces.length}`);
  }
  // THE ROWS ARRIVE AS TRIM INCHES — that is what the contract states and what
  // GENIE resolves. The PRINT size is trim plus the bleed on all four edges, so
  // it is trim + 2x bleed in each dimension. Stating both is the point of the
  // sheet: the shop cuts on the trim line and prints to the larger rectangle.
  const printOf = (s: ContainerSurface) => ({
    w: s.widthIn + bleedInches * 2, h: s.heightIn + bleedInches * 2,
  });

  // EVERY PANEL CARRIES ITS OWN TRIM / PRINT / BLEED, IN BOTH ZONES — which is
  // what the owner's filled twin does, and it is also the only place the sheet
  // states the difference between the rectangle the shop CUTS and the rectangle
  // it PRINTS. Zone 1 had the captions without it, so a reader of the blank
  // template learned the panel names and not the numbers under them.
  const panelDetail = (s: ContainerSurface) => {
    const p = printOf(s);
    return [`TRIM ${r1(s.widthIn)}" x ${r1(s.heightIn)}"`,
      `PRINT ${r1(p.w)}" x ${r1(p.h)}"`,
      `${bleedInches}" bleed all edges`];
  };

  // TOTAL COVERAGE IS COMPUTED, NEVER COPIED. The owner's filled sheet carries
  // "TOTAL COVERAGE: 176.26 SQ FT" and that figure reproduces from none of the
  // dimensions printed beside it — its per-panel square footages do not match
  // its own trim or print rectangles either, because a diffusion model wrote
  // them. This one is the sum of the GENIE trim areas and nothing else, so the
  // blank template can never teach arithmetic that does not close.
  const totalTrimSqFt = surfaces.reduce((sum, s) => sum + (s.widthIn * s.heightIn) / 144, 0);
  const m: string[] = [];

  // ── header ───────────────────────────────────────────────────────────────
  m.push(`<rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`);
  m.push(text(54, 44, companyName || "COMPANY NAME", { size: 23, weight: 700, spacing: 0.2 }));
  m.push(text(54, 61, "VEHICLE WRAP PRODUCTION TEMPLATE", { size: 9, fill: MUTED, spacing: 1.3 }));
  m.push(text(WIDTH / 2, 44, "2D PRODUCTION PROOF", { size: 21, weight: 700, anchor: "middle", spacing: 0.4 }));
  m.push(text(WIDTH / 2, 61, vehicle || "VEHICLE", { size: 10, fill: MUTED, anchor: "middle", spacing: 0.6 }));
  m.push(text(WIDTH / 2, 77, `TOTAL COVERAGE (TRIM): ${totalTrimSqFt.toFixed(2)} SQ FT`
    + `  |  EVERY PANEL DIMENSIONED BY GENIE  |  ${bleedInches}" BLEED ON ALL FOUR EDGES`,
    { size: 8.5, fill: MUTED, anchor: "middle", spacing: 0.3 }));
  m.push(`<rect x="1180" y="22" width="302" height="62" fill="none" stroke="${RULE}" stroke-width="1"/>`);
  ["DATE:", "ORDER #:", "DESIGNER:", "VERSION:"].forEach((k, i) => {
    m.push(text(1192, 38 + i * 14, k, { size: 8.5, fill: MUTED }));
    m.push(`<line x1="1258" y1="${41 + i * 14}" x2="1470" y2="${41 + i * 14}" stroke="${RULE}" stroke-width="0.7"/>`);
  });
  m.push(`<line x1="0" y1="96" x2="${WIDTH}" y2="96" stroke="${INK}" stroke-width="1.5"/>`);

  // ── zone 1: the finished panels ──────────────────────────────────────────
  m.push(zoneBand(54, 108, 1428, ZONE1,
    "ZONE 1 — FULL DESIGN PANELS (PHOTO + DESIGN + TEXT + LOGO)",
    "6 PANELS — COMPLETE WRAP ARTWORK"));
  m.push(row(surfaces, { ...BAND.zone1, detail: panelDetail }));

  // ── zone 2: the same panels, artwork only ────────────────────────────────
  m.push(zoneBand(54, 372, 1428, ZONE2,
    "ZONE 2 — BACKGROUNDS ONLY (NO TEXT OR LOGO)",
    "6 PANELS — BACKGROUND ARTWORK ONLY"));
  m.push(row(surfaces, { ...BAND.zone2, detail: panelDetail }));

  // ── zone 3: the elements alone ───────────────────────────────────────────
  m.push(zoneBand(54, 648, 1428, ZONE3,
    "ZONE 3 — CUT GRAPHICS (LOGO, TEXT & ICONS ONLY)",
    "VECTOR CUT PATHS — NO BACKGROUND"));
  const slots = [
    { w: 330, caption: "PRIMARY LOGO", note: "(Vector cut path — no background)" },
    { w: 210, caption: "TAGLINE / SLOGAN", note: "(Vector cut path)" },
    { w: 210, caption: "CONTACT LINE", note: "(Vector cut path)" },
    { w: 210, caption: "PROMOTIONAL TEXT", note: "(Vector cut path)" },
    { w: 400, caption: "ICONS / SERVICE GRAPHICS", note: "(Vector cut paths)" },
  ];
  let sx = 54;
  for (const slot of slots) {
    m.push(`<rect x="${sx}" y="690" width="${slot.w}" height="86" fill="#ffffff" stroke="${FRAME}"`
      + ` stroke-width="1" stroke-dasharray="5 4"/>`);
    m.push(text(sx + slot.w / 2, 792, slot.caption, { size: 9.5, weight: 700, anchor: "middle" }));
    m.push(text(sx + slot.w / 2, 803, slot.note, { size: 7.5, fill: MUTED, anchor: "middle" }));
    sx += slot.w + 18;
  }

  // ── trim table, notes, legend ────────────────────────────────────────────
  m.push(`<line x1="0" y1="826" x2="${WIDTH}" y2="826" stroke="${RULE}" stroke-width="1"/>`);
  m.push(text(54, 846, "PANEL DIMENSIONS REFERENCE (TRIM SIZE)", { size: 9.5, weight: 700 }));
  let cx = 54;
  for (const s of surfaces) {
    m.push(text(cx, 864, LABEL[s.surfaceKey] || s.surfaceKey.toUpperCase(), { size: 8, fill: MUTED }));
    m.push(text(cx, 877, `${r1(s.widthIn)}" x ${r1(s.heightIn)}"`, { size: 9 }));
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">`
    + `<rect width="100%" height="100%" fill="#ffffff"/>${m.join("")}</svg>`;
}
