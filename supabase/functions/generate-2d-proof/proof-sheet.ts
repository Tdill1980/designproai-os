import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
// std@0.168.0 exports `encode`/`decode`, NOT the newer `encodeBase64`
// names. Importing the wrong symbol is a BOOT error, not a call-site
// error — the whole function 503s before any request runs (live
// 2026-08-04: "worker boot error: Uncaught SyntaxError: the requested
// module does not provide an export named encodeBase64"). Aliased the
// same way _shared/panelizer-os/storage.ts does.
import {
  encode as encodeBase64,
  decode as decodeBase64,
} from "https://deno.land/std@0.168.0/encoding/base64.ts";
import {
  BAND_LINE_GAP,
  bandHeight,
  fitBandFontSize,
} from "./proof-band-fit.ts";

const FONT_URL = "https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf";
let _fontBytes: Uint8Array | null = null;
export async function getFont(): Promise<Uint8Array> {
  if (!_fontBytes) { const r = await fetch(FONT_URL); _fontBytes = new Uint8Array(await r.arrayBuffer()); }
  return _fontBytes;
}

// ── PER-TILE FLAT ELEVATIONS + DETERMINISTIC SHEET COMPOSITION ────────────
// The proof used to be ONE image holding all five/six view tiles at
// imageSize:"1K" — so a tile was ~250px wide and the wrap's OWN lettering
// landed at 2-3px in Gemini's OUTPUT. It cannot draw a phone number that
// small, so it drew a plausible one instead. Live-verified on Cascade
// Stoneworks (b4781b2d-ebfb-4699-ab5d-a57716e025ce): the hero render correctly
// reads "555-0142", "cascadestoneworks.com", "FAMILY OWNED SINCE 2009" at
// 5504x3072, while the proof read "877-555-0000", "stanewerks.com", "2008".
// Panels extracted from that proof inherit the fabrication, which is why the
// FRONT panel's QC judge refuses it — the judge was right, the proof was wrong.
//
// Raising the single sheet to 2K only doubles the lettering to ~5px AND 546'd
// the worker on the ~15MB response decode, which is why it was reverted to 1K
// on 2026-07-27. Per-tile dissolves both problems: each view is redrawn on its
// OWN full canvas (about 6x the horizontal pixels for the same lettering), and
// no large AI sheet is ever decoded because the SHEET is assembled by code.
//
// Layout is fixed and known, so the per-tile rects are exact — downstream
// extraction can read a full-resolution tile instead of re-cropping a shrunken
// sheet.
// LANDSCAPE. A production proof is a shop drawing — it is read, printed and
// signed on a landscape page, and every proof this system shipped before the
// per-tile rewrite was landscape.
//
// The first per-tile sheets came out portrait (1600 x 2380) because both side
// elevations were placed FULL WIDTH and stacked: two 16:9 tiles alone are
// 1.125x the sheet width, so height could never come in under it at any width.
// The fix is columnar, not a bigger number — the sides stack in a left column
// and the remaining faces fill a grid beside them.
//
// WIDTH IS A CPU BUDGET, NOT A QUALITY DIAL (1800, lowered from 2400 on
// 2026-08-04 after proof.build failed a pack seven straight attempts).
//
// The sheet is encoded to PNG by a PURE-JS deflate inside the edge isolate, so
// encode cost scales with PIXEL COUNT. At 2400x1958 that is 4.7M px / 18.8MB of
// raw RGBA, and it put the stage exactly ON the CPU ceiling: a direct call with
// identical inputs (TEXT LOCK engaged) returned 200 in 49.7s, while the
// workflow's attempt on the same work died at ~50s with "CPU Time exceeded".
// Same work, opposite sides of one line — and retries made it worse, because a
// reused isolate starts with CPU already spent. Live run 400b63e3 burned
// attempts 1-5 on that ceiling.
//
// 1800 is 2.6M px — about 44% less encode work — which converts a coin-flip
// into margin. It is NOT a detail loss at the source: every tile is still
// GENERATED on its own ~1K canvas, so a side tile placed at ~863px wide carries
// the same real pixels it did at 1151 (the tile caps it either way, as the
// paragraph above already noted for 1520 -> 1151). Landscape and the per-tile
// rect contract are unchanged; proofTileBoxes is normalized 0-1000, so
// downstream extraction is width-agnostic by construction.
//
// The durable fix is to move composition to the self-hosted DesignPro worker, where there is
// no per-request CPU ceiling (docs/DESIGNPRO_OS_WIRING_PLAN.md). Until then this
// constant is the margin.
export const PROOF_SHEET_W = 1800;
export const PROOF_TILE_ORDER = ["side", "passenger", "hood", "roof", "front", "rear"] as const;
export const PROOF_TILE_LABELS: Record<string, string> = {
  side: "DRIVER SIDE",
  passenger: "PASSENGER SIDE",
  hood: "HOOD",
  roof: "ROOF / TOP",
  front: "FRONT",
  rear: "REAR",
};

/**
 * TEXT LOCK — re-exported from `./proof-text-lock.ts`, which holds the literals
 * the wrap actually carries AND the ground-truth check that they survived
 * generation. It lives in its own module because this file imports imagescript
 * over a Deno URL, which vitest cannot load; the pure logic there is unit-tested
 * for real in tests/proof-text-lock-verify.test.ts. Callers are unchanged.
 */
export {
  buildProofTextLock,
  findFabricatedText,
  normalizeLockedText,
  proofTextLiterals,
} from "./proof-text-lock.ts";
export type { LockedTextKind } from "./proof-text-lock.ts";

/**
 * Our tile bucket -> the canonical side label `panelize-artboard` resolves
 * (its SIDE_ALIASES table). Used to hand the tile pre-crop exact boxes instead
 * of making it re-detect them with a vision pass.
 */
export const PROOF_TILE_SIDE_LABELS: Record<string, string> = {
  side: "DRIVER SIDE",
  passenger: "PASSENGER SIDE",
  hood: "HOOD",
  roof: "ROOF",
  front: "FRONT",
  rear: "REAR",
};

/** 56.6 -> "56.6", 193.0 -> "193" — matches the size band's formatting. */
function fmtInches(v: number): string {
  const n = Math.round(Number(v) * 10) / 10;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Convert composed tile rects (pixels) into the 0-1000 normalized
 * [ymin, xmin, ymax, xmax] boxes `panelize-artboard` consumes.
 *
 * `height` MUST be the height of the FINAL uploaded proof — the GENIE size band
 * is appended below the tiles after composition, so normalizing against the
 * pre-band height would shift every box upward.
 */
export function proofTileBoxes(
  rects: Record<string, { x: number; y: number; w: number; h: number }>,
  width: number,
  height: number,
): Record<string, [number, number, number, number]> {
  const out: Record<string, [number, number, number, number]> = {};
  if (!(width > 0 && height > 0)) return out;
  const n = (v: number, total: number) => Math.max(0, Math.min(1000, Math.round((v / total) * 1000)));
  for (const [key, r] of Object.entries(rects)) {
    const label = PROOF_TILE_SIDE_LABELS[key];
    if (!label) continue;
    const box: [number, number, number, number] = [
      n(r.y, height), n(r.x, width), n(r.y + r.h, height), n(r.x + r.w, width),
    ];
    if (box[2] > box[0] && box[3] > box[1]) out[label] = box;
  }
  return out;
}

/**
 * READ the lettering off a rendered tile. Reading only — no generation.
 *
 * This is the model's half of the ground-truth gate, and it is deliberately the
 * smaller half: it REPORTS strings, and `findFabricatedText` DECIDES in plain
 * code against the customer's own brief. Same split that makes the overlay lift
 * safe — let the model locate, let code judge. A verifier that asked a model
 * "does this look right?" would just be another opinion defending the proof.
 *
 * Fails OPEN (returns null): a broken reader must never block a good proof. A
 * null result skips the check for that tile rather than condemning it.
 */
export async function readTileText(
  png: Uint8Array,
  apiKey: string,
  label: string,
): Promise<string[] | null> {
  try {
    // Single-pass std encode — the chunked fromCharCode + concat loop this
    // replaces moved O(n^2) bytes per tile and, run six times per proof, was
    // a main CPU sink behind the 2026-08-04 "CPU Time exceeded" kills.
    const b64 = encodeBase64(png);
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text:
                  `Transcribe EVERY piece of text visible in this vehicle-wrap elevation, exactly as printed — ` +
                  `company name, phone number, website, taglines, badges, any lettering at all. ` +
                  `Copy character for character; never correct spelling, never expand an abbreviation, ` +
                  `never fill in a string you cannot read. Omit anything illegible rather than guessing. ` +
                  `Respond ONLY with JSON: {"strings":["…"]}`,
              },
              { inlineData: { mimeType: "image/png", data: b64 } },
            ],
          }],
          generationConfig: {
            responseModalities: ["TEXT"],
            temperature: 0,
            topP: 1,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!resp.ok) {
      console.warn(`[2D-PROOF] text read "${label}" → Gemini ${resp.status} (check skipped)`);
      return null;
    }
    const result = await resp.json();
    const text = result.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const strings = Array.isArray(parsed?.strings) ? parsed.strings : [];
    return strings.map((s: unknown) => String(s || "")).filter(Boolean);
  } catch (e) {
    console.warn(`[2D-PROOF] text read "${label}" threw: ${String(e)} (check skipped)`);
    return null;
  }
}

/**
 * One Call 7 Gemini pass → one panel-ready, edge-to-edge surface master.
 *
 * This is the final pixel-authoring boundary. The output is not a vehicle
 * elevation on white; it is the rectangular artwork that will be displayed in
 * the flat proof and code-cropped after approval.
 */
export async function renderFlatTile(opts: {
  label: string;
  vehicleName: string;
  view: { b64: string; mime: string };
  anchor?: { b64: string; mime: string };
  textLock: string;
  stripBranding: boolean;
  widthIn?: number;
  heightIn?: number;
  apiKey: () => string;
}): Promise<Uint8Array | null> {
  const brandingRule = opts.stripBranding
    ? `Keep ONLY the wrap background artwork — color, pattern, gradient, texture, photography, and graphic flow. OMIT every logo, company name, phone number, website, tagline, badge, and line of lettering.`
    : `Preserve EVERY graphic and EVERY line of lettering exactly as shown — company name, logo lockup, phone number, website, taglines, and badges — glyph for glyph, in the same position, size, arrangement, and colors. Lettering must be sharp and fully legible.${opts.textLock}`;
  const supportedAspects = [
    { value: "1:1", ratio: 1 },
    { value: "2:3", ratio: 2 / 3 },
    { value: "3:2", ratio: 3 / 2 },
    { value: "3:4", ratio: 3 / 4 },
    { value: "4:3", ratio: 4 / 3 },
    { value: "4:5", ratio: 4 / 5 },
    { value: "5:4", ratio: 5 / 4 },
    { value: "9:16", ratio: 9 / 16 },
    { value: "16:9", ratio: 16 / 9 },
    { value: "21:9", ratio: 21 / 9 },
  ];
  const physicalRatio =
    Number(opts.widthIn) > 0 && Number(opts.heightIn) > 0
      ? Number(opts.widthIn) / Number(opts.heightIn)
      : 16 / 9;
  const surfaceAspect = supportedAspects.reduce((best, candidate) =>
    Math.abs(candidate.ratio - physicalRatio) <
        Math.abs(best.ratio - physicalRatio)
      ? candidate
      : best
  ).value;

  const tiers = [
    `Create the FLAT, RECTANGULAR, PANEL-READY artwork for the ${opts.label} of this ${opts.vehicleName}, using the attached 3D render only as the design reference.

OUTPUT ONLY THE ARTWORK CANVAS. Completely remove the vehicle body, cab, windows, glass, wheels, tires, wheel arches, bumpers, mirrors, lights, handles, seams, ground, studio, shadows, reflections, highlights, and every white or transparent cutout. Continue the real surrounding artwork through every area those vehicle parts covered. Fill all four edges with the design. There must be no vehicle silhouette, no white margin, no transparency, no labels, no dimensions, no border, and no mockup.

Do not redesign, restyle, simplify, or substitute anything. Preserve the exact color relationships, imagery, gradients, patterns, element routing, scale, and placement visible on this surface. Keep photographic elements photographic. ${brandingRule}

This returned rectangle becomes the approved Call 7 production source. Nothing after it is allowed to heal or invent pixels.`,
    `Convert the attached ${opts.label} render into one edge-to-edge rectangular wrap-art canvas. Remove every vehicle/studio pixel and fill windows, wheels, arches, seams, and all gaps by continuing the existing design. No vehicle outline, no white, no transparency, no margin, no labels. Keep the exact design, colors, positions, photography, logos, and text. ${brandingRule}`,
    `Panel-ready ${opts.label} artwork only: a solid edge-to-edge rectangle of the exact wrap design. No vehicle, windows, wheels, cutouts, white background, transparency, mockup, or extra text. ${opts.stripBranding ? "No logos or lettering." : "Keep every original logo and line of text exactly."}`,
  ];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const tier = Math.min(attempt - 1, tiers.length - 1);
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${opts.apiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: tiers[tier] },
                ...(opts.anchor?.b64 ? [
                  { text: "APPROVED DESIGN ANCHOR — this locks the exact palette, logo treatment, typography, photography, scale, and graphic routing for every surface. The surface render below controls only what belongs on that surface; it must not become a different design." },
                  { inlineData: { mimeType: opts.anchor.mime, data: opts.anchor.b64 } },
                ] : []),
                { text: `SOURCE RENDER — ${opts.label} (3D photo, surface geometry and content reference):` },
                { inlineData: { mimeType: opts.view.mime, data: opts.view.b64 } },
              ],
            }],
            // 1K PER TILE — this is the whole point. One tile alone at 1K gives
            // the same lettering ~6x the pixels it had inside the old shared
            // sheet, and a single 1K response is nowhere near the 256MB ceiling
            // that killed the 2K shared sheet.
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: { aspectRatio: surfaceAspect, imageSize: "1K" },
            },
          }),
          signal: AbortSignal.timeout(120000),
        },
      );
      if (!resp.ok) {
        console.warn(`[2D-PROOF] tile "${opts.label}" attempt ${attempt} → Gemini ${resp.status}`);
        if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      const result = await resp.json();
      const parts = result.candidates?.[0]?.content?.parts;
      let b64 = "";
      if (parts) for (const p of parts) { if (p.inlineData) { b64 = p.inlineData.data; break; } }
      if (b64) {
        const bin = atob(b64);
        return Uint8Array.from(bin, (c) => c.charCodeAt(0));
      }
      const reason = result.candidates?.[0]?.finishReason;
      console.warn(`[2D-PROOF] tile "${opts.label}" attempt ${attempt} → no image (${reason}); retrying shorter`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1200 * attempt));
    } catch (e) {
      console.warn(`[2D-PROOF] tile "${opts.label}" attempt ${attempt} threw: ${String(e)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return null;
}

/**
 * DETERMINISTIC PANEL SOURCE — the RestylePro RUNG-0 "cut only" primary
 * (worker/index.js generateCleanField, reached via panel-artboard-generator
 * step:"sidefield" → worker /clean-artboard). Reference: restylepro-os
 * worker/index.js:1213-1287, ported byte-identical into this project's
 * worker (only the WORKER_HOST env name differs — see finish_designpro_
 * migration.py). This function is the edge-side caller of that same worker
 * endpoint, called directly (the same pattern generate-2d-proof already uses
 * for the Call-7 sanity gate below).
 *
 * This REPLACES renderFlatTile as the panel/tile producer. The two differ in
 * exactly the way that matters:
 *   - renderFlatTile fed a SEPARATE "design anchor" image (the driver hero)
 *     alongside each side's own view and asked Gemini to compose a NEW flat
 *     elevation "using the attached 3D render only as the design reference" —
 *     i.e. paint from a reference, not extract. That is what let each tile
 *     drift into its own layout (badge repositioned, background swapped,
 *     driver/passenger disagreeing) even though every approved view already
 *     carries the correct design.
 *   - sidefieldFlatten feeds ONLY that side's OWN approved view and asks the
 *     worker to "flatten THIS exact wrap side ... into ONE continuous flat
 *     field" — an edit of the one image, not a composition from two. The
 *     worker's own generateCleanField runs a GENERATE→QC→RETRY loop
 *     (qcCleanField) that checks the flattened field against that SAME source
 *     image before accepting it, at full 4K resolution and worker memory.
 *
 * No anchor image is passed, and none should be added back — reintroducing a
 * second reference image reintroduces the drift.
 */
export async function sidefieldFlatten(opts: {
  label: string;
  side: string;
  viewUrl: string;
  widthIn: number;
  heightIn: number;
  stripBranding: boolean;
  uid: string;
  jobScope: string;
  workerHost: string;
  workerSecret: string;
}): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(`${opts.workerHost.replace(/\/+$/, "")}/clean-artboard`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.workerSecret ? { Authorization: `Bearer ${opts.workerSecret}` } : {}),
      },
      body: JSON.stringify({
        uid: opts.uid,
        jobId: opts.jobScope,
        sides: [{
          side: opts.side,
          viewUrl: opts.viewUrl,
          widthInches: opts.widthIn,
          heightInches: opts.heightIn,
        }],
        // keepBranding:true = preserve every logo/line of text (the normal
        // branded tile); false = the stripBranding pass, background only.
        keepBranding: !opts.stripBranding,
      }),
      // The worker's own GENERATE→QC→RETRY loop can run up to 3 full 4K
      // generations; panel-artboard-generator's existing sidefield proxy
      // budgets 480s for the identical call for the identical reason.
      signal: AbortSignal.timeout(480_000),
    });
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok || out?.success !== true) {
      console.warn(`[2D-PROOF] sidefield "${opts.label}" failed: ${JSON.stringify(out).slice(0, 300)}`);
      return null;
    }
    const result = out.sides?.[opts.side];
    if (!result?.url) {
      console.warn(`[2D-PROOF] sidefield "${opts.label}" returned no url: ${JSON.stringify(result).slice(0, 200)}`);
      return null;
    }
    const r = await fetch(result.url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    return new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    console.warn(`[2D-PROOF] sidefield "${opts.label}" threw: ${String(e)}`);
    return null;
  }
}

/**
 * Assemble the proof sheet from finished tiles. ZERO AI — every pixel here is
 * placed by code, so the header, footer, labels and per-tile dimension callouts
 * can never be hallucinated the way the shared-sheet pass hallucinated them.
 * Returns the sheet bytes and the exact rectangle of each tile on it.
 */
import {
  vehicleProofSvg,
  vehicleProofTemplate,
} from "./vehicle-proof-template.ts";

export async function composeProofSheet(opts: {
  tiles: Array<{ key: string; label: string; callout: string; png: Uint8Array; wIn?: number; hIn?: number }>;
  brandTitle: string;
  metaLine: string;
  footerLine: string;
  /**
   * Draws each tile inside its flattened vehicle elevation instead of as a bare
   * rectangle — the Call 8 contract, and what the 2026-07-24 proofs showed.
   * The silhouette is a DISPLAY clip only: the Call 7 master uploaded for panel
   * extraction is the unmasked full-bleed rectangle, so panels stay byte-equal
   * to their masters and the proof can never change a printed pixel. Omitted
   * means rectangles, exactly as before.
   */
  vehicleType?: string;
  /**
   * Bleed per edge in inches, as the pipeline actually applies it. Drawn under
   * every tile that has resolved dimensions — the owner's instruction on the
   * approved reference was "add 5" bleed on every side" (2026-08-04). Undefined
   * means no bleed line is drawn; the sheet never invents a figure.
   */
  bleedIn?: number;
  /**
   * "TOTAL COVERAGE: 315.5 sq ft" — the summary figure on the approved
   * reference. Supplied by the caller from GENIE's own total; omitted rather
   * than derived here, so the sheet can never state an area nobody resolved.
   */
  totalCoverageLine?: string;
  /** GENIE size-band lines, drawn into the same sheet. */
  sizeBandLines?: string[];
  /** Storage prefix for the per-tile uploads the worker fetches. */
  tileUploadPrefix?: string;
  /** Uploads a tile PNG and returns its public URL. Injected by the caller. */
  uploadTile?: (path: string, bytes: Uint8Array) => Promise<string>;
  /** Resolves a worker-uploaded storage path to its immutable public URL. */
  publicTileUrl?: (path: string) => string;
}): Promise<{
  bytes: Uint8Array;
  rects: Record<string, { x: number; y: number; w: number; h: number }>;
  surfaceMasters: Array<{
    key: string;
    url: string;
    sha256: string;
    bytes: number;
    pixelWidth: number;
    pixelHeight: number;
    trimWidthIn: number;
    trimHeightIn: number;
    bleedIn: number;
    printWidthIn: number;
    printHeightIn: number;
    regionSha256: string;
    sourceCrop: Record<string, unknown>;
  }>;
  width: number;
  height: number;
}> {
  // ── COMPOSITION RUNS ON THE SELF-HOSTED DESIGNPRO WORKER ─────────────────
  //
  // The LAYOUT below is unchanged and still computed HERE: every rect, every
  // figure, every drawn element. Only the PIXEL work — compositing six tiles
  // onto a 1800x~1468 canvas and deflating it to PNG — moved, because that is
  // what could not fit the edge function's per-request CPU budget.
  //
  // Evidence (2026-08-04, run 400b63e3 then pack 50ffb4f4): proof.build failed
  // TWELVE attempts across two packs, every one "CPU Time exceeded", each kill
  // landing right after the compose log. Three real optimisations were shipped
  // first — single-pass base64 encode, sheet 2400 -> 1800, and a per-CHARACTER
  // base64 decode in fingerprintBase64 (~18M callbacks/attempt, workflow-path
  // only) — and NONE was sufficient. A direct call doing the same visible work
  // survived at 49.7s while every workflow attempt died at ~50s, because the
  // workflow path additionally carries artifact binding, evidence attestation
  // and canonical persistence. The workload does not fit; shaving it further
  // was not converging.
  //
  // Measured before this was written: Sharp/libvips composes these six tiles
  // and encodes the sheet in 0.48s average (worst case — pure-noise tiles at
  // 12.1MB producing a 3.56MB PNG; real elevations compress better). The
  // pure-JS deflate this replaces was the ceiling, not the sheet.
  //
  // The worker returns the encoded bytes, so this function's contract is
  // byte-identical to before: same rects, same width/height, same bytes out.
  // Nothing downstream — path, fence, upload, tileBoxes — changes.
  const W = PROOF_SHEET_W;
  const MARGIN = 40;
  const GAP = 18;
  const HEADER_H = 118;
  const FOOTER_H = 78;
  const LABEL_H = 108;
  const DIM_GUTTER = 74;

  const bigKeys = opts.tiles.filter((t) => t.key === "side" || t.key === "passenger");
  const smallKeys = opts.tiles.filter((t) => t.key !== "side" && t.key !== "passenger");
  const contentW = W - MARGIN * 2;
  const COL_GAP = GAP * 2;

  const gutters = (bigKeys.length ? DIM_GUTTER : 0) + (smallKeys.length ? DIM_GUTTER : 0);
  const drawableW = contentW - gutters;
  const bigW = bigKeys.length
    ? (smallKeys.length ? Math.floor((drawableW - COL_GAP) / 2) : drawableW)
    : 0;
  const rightW = smallKeys.length
    ? (bigKeys.length ? drawableW - COL_GAP - bigW : drawableW)
    : 0;
  const smallCols = smallKeys.length
    ? (bigKeys.length ? Math.min(2, smallKeys.length) : Math.min(4, smallKeys.length))
    : 1;
  const smallW = smallKeys.length
    ? Math.floor((rightW - GAP * (smallCols - 1)) / smallCols)
    : 0;
  const smallRows = smallKeys.length ? Math.ceil(smallKeys.length / smallCols) : 0;

  // The proof regions are the production contract, not decorative 16:9
  // thumbnails. Size every region from GENIE trim + the real five-inch bleed
  // so the compositor never stretches a side, face, hood, or roof to fit a
  // presentation box.
  const tileHeight = (
    tile: { wIn?: number; hIn?: number },
    widthPx: number,
  ) => {
    const trimW = Number(tile.wIn || 0);
    const trimH = Number(tile.hIn || 0);
    const bleed = Number(opts.bleedIn || 0);
    if (!(trimW > 0 && trimH > 0)) {
      throw new Error("Every Call 7 proof surface requires GENIE trim dimensions");
    }
    return Math.max(
      1,
      Math.round(widthPx * (trimH + bleed * 2) / (trimW + bleed * 2)),
    );
  };
  const bigHeights = bigKeys.map((tile) => tileHeight(tile, bigW));
  const smallHeights = smallKeys.map((tile) => tileHeight(tile, smallW));
  const smallRowHeights = Array.from({ length: smallRows }, (_, row) => {
    const begin = row * smallCols;
    return Math.max(...smallHeights.slice(begin, begin + smallCols), 0);
  });

  const COVERAGE_H = String(opts.totalCoverageLine || "").trim() ? 52 : 0;
  const bandLines = (opts.sizeBandLines || []).filter((l) => String(l || "").trim());
  const bandFontSize = fitBandFontSize(bandLines, W - MARGIN * 2);
  const BAND_H = bandHeight(bandLines, bandFontSize);

  const bodyH = Math.max(
    bigHeights.reduce((sum, height) => sum + height + LABEL_H + GAP, 0),
    smallRowHeights.reduce((sum, height) => sum + height + LABEL_H + GAP, 0),
  );
  const H = HEADER_H + bodyH + COVERAGE_H + FOOTER_H + MARGIN + BAND_H;

  const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
  const placed: Array<{ key: string; x: number; y: number; w: number; h: number }> = [];
  const bodyTop = HEADER_H + GAP;

  // SVG carries every DRAWN element — header, footer, labels, bleed lines,
  // dimension rules with arrowheads, coverage, band. Text is drawn by the
  // renderer, so it still cannot be hallucinated by a model.
  const esc = (t: string) =>
    String(t || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg: string[] = [];
  const text = (t: string, x: number, y: number, size: number, anchor = "start", bold = false) => {
    const v = esc(t).trim();
    if (!v) return;
    svg.push(
      `<text x="${x}" y="${y}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" ` +
      `font-size="${size}" font-weight="${bold ? 700 : 400}" fill="#111111" text-anchor="${anchor}">${v}</text>`,
    );
  };
  const fittedText = (
    t: string,
    x: number,
    y: number,
    maxWidth: number,
    maxSize: number,
    minSize: number,
    bold = false,
  ) => {
    const value = String(t || "").trim();
    if (!value) return;
    const fittedSize = Math.max(
      minSize,
      Math.min(
        maxSize,
        Math.floor(maxWidth / Math.max(1, value.length * 0.58)),
      ),
    );
    text(value, x, y, fittedSize, "middle", bold);
  };
  const line = (x1: number, y1: number, x2: number, y2: number, w = 2) =>
    svg.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#111111" stroke-width="${w}"/>`);
  const arrow = (x: number, y: number, dx: number, dy: number) =>
    svg.push(
      `<path d="M${x},${y} l${dx},${-5 - dy} l0,${10 + dy * 2} z" fill="#111111"/>`,
    );

  // Header — same geometry the imagescript pass used.
  text(opts.brandTitle, MARGIN, 26 + 34, 34, "start", true);
  text(opts.metaLine, MARGIN, 80 + 17, 17);
  line(MARGIN, HEADER_H, W - MARGIN, HEADER_H);

  // Tile-local silhouette paths, keyed by tile. The worker clips the DISPLAY
  // copy of each tile to these; the Call 7 master it uploads is untouched.
  const tileClipPaths: Record<string, string> = {};

  const place = (
    tile: { key: string; label: string; callout: string; wIn?: number; hIn?: number },
    x: number, y: number, w: number, h: number,
  ) => {
    rects[tile.key] = { x, y, w, h };
    placed.push({ key: tile.key, x, y, w, h });

    // The vehicle elevation. Drawn twice from one template: tile-local for the
    // worker's clip mask, sheet-space for the outline and detail strokes that
    // ride over the artwork so the wrap reads as applied to a vehicle rather
    // than as a sticker in a vehicle-shaped hole.
    if (opts.vehicleType) {
      const template = vehicleProofTemplate(opts.vehicleType, tile.key);
      if (!template.rectangular) {
        const local = vehicleProofSvg(template, `clip-${tile.key}`, 0, 0, w, h);
        tileClipPaths[tile.key] = local.clipPath;
        const onSheet = vehicleProofSvg(template, `sheet-${tile.key}`, x, y, w, h);
        svg.push(...onSheet.overlay);
      }
    }

    const wIn = Number(tile.wIn) > 0 ? Number(tile.wIn) : 0;
    const hIn = Number(tile.hIn) > 0 ? Number(tile.hIn) : 0;

    const bleedIn = Number(opts.bleedIn || 0);
    const bleedX = bleedIn && wIn
      ? w * bleedIn / (wIn + bleedIn * 2)
      : 0;
    const bleedY = bleedIn && hIn
      ? h * bleedIn / (hIn + bleedIn * 2)
      : 0;
    const trimLeft = x + bleedX;
    const trimRight = x + w - bleedX;
    const trimTop = y + bleedY;
    const trimBottom = y + h - bleedY;

    if (bleedIn && wIn && hIn) {
      // Solid outer rectangle = full print edge. Dashed inner rectangle = trim.
      // Their proportional separation is exactly five physical inches on all
      // four edges because the tile itself is sized from trim + 10 inches.
      svg.push(
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" ` +
        `fill="none" stroke="#111111" stroke-width="2"/>`,
      );
      svg.push(
        `<rect x="${trimLeft}" y="${trimTop}" ` +
        `width="${trimRight - trimLeft}" height="${trimBottom - trimTop}" ` +
        `fill="none" stroke="#111111" stroke-width="2" stroke-dasharray="10 7"/>`,
      );
      fittedText(
        `DASHED = TRIM  ·  SOLID = PRINT EDGE  ·  ${fmtInches(bleedIn)}" BLEED EACH EDGE`,
        x + w / 2,
        y + Math.max(16, bleedY - 6),
        w - 8,
        13,
        8,
        true,
      );
    }

    if (wIn) {
      const ruleY = y + h + 20;
      // This rule names TRIM width, so its endpoints must be the dashed trim
      // line — not the outer print rectangle that includes ten extra inches.
      line(trimLeft, ruleY, trimRight, ruleY);
      arrow(trimLeft, ruleY, 9, 0);
      arrow(trimRight, ruleY, -9, 0);
      line(trimLeft, ruleY - 7, trimLeft, ruleY + 7);
      line(trimRight, ruleY - 7, trimRight, ruleY + 7);
      text(`${fmtInches(wIn)}" W`, x + w / 2, ruleY + 26, 16, "middle");
    }
    if (hIn) {
      const ruleX = x - Math.round(DIM_GUTTER / 2);
      // Same truth rule vertically: the trim height/length figure spans only
      // the trim boundary; the separate PRINT caption states trim + 10.
      line(ruleX, trimTop, ruleX, trimBottom);
      line(ruleX - 7, trimTop, ruleX + 7, trimTop);
      line(ruleX - 7, trimBottom, ruleX + 7, trimBottom);
      const cy = (trimTop + trimBottom) / 2;
      const verticalAxis =
        tile.key === "hood" || tile.key === "roof" ? "L" : "H";
      svg.push(
        `<text x="${ruleX - 10}" y="${cy}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" ` +
        `font-size="16" fill="#111111" text-anchor="middle" ` +
        `transform="rotate(-90 ${ruleX - 10} ${cy})">${esc(`${fmtInches(hIn)}" ${verticalAxis}`)}</text>`,
      );
    }

    const labelY = y + h + (wIn ? 46 : 10);
    text(tile.label, x + w / 2, labelY + 17, 17, "middle", true);
    if (opts.bleedIn && wIn && hIn) {
      const b = bleedIn * 2;
      fittedText(
        `TRIM ${fmtInches(wIn)}" x ${fmtInches(hIn)}"  ·  BLEED ${fmtInches(bleedIn)}" EACH EDGE  ·  PRINT ${fmtInches(wIn + b)}" x ${fmtInches(hIn + b)}"`,
        x + w / 2,
        labelY + 42,
        w - 8,
        14,
        9,
      );
    } else if (tile.callout) {
      text(tile.callout, x + w / 2, labelY + 42, 15, "middle");
    }
  };

  let leftY = bodyTop;
  for (let i = 0; i < bigKeys.length; i++) {
    const tile = bigKeys[i];
    const height = bigHeights[i];
    place(tile, MARGIN + DIM_GUTTER, leftY, bigW, height);
    leftY += height + LABEL_H + GAP;
  }
  if (smallKeys.length) {
    const rightX = (bigKeys.length ? MARGIN + DIM_GUTTER + bigW + COL_GAP : MARGIN) + DIM_GUTTER;
    for (let i = 0; i < smallKeys.length; i++) {
      const col = i % smallCols;
      const row = Math.floor(i / smallCols);
      place(
        smallKeys[i],
        rightX + col * (smallW + GAP),
        bodyTop + smallRowHeights
          .slice(0, row)
          .reduce((sum, height) => sum + height + LABEL_H + GAP, 0),
        smallW,
        smallHeights[i],
      );
    }
  }

  if (COVERAGE_H) text(opts.totalCoverageLine!, W / 2, bodyTop + bodyH + 8 + 22, 22, "middle", true);
  const y = bodyTop + bodyH + COVERAGE_H;
  line(MARGIN, y, W - MARGIN, y);
  text(opts.footerLine, MARGIN, y + 20 + 17, 17);

  if (BAND_H) {
    const bandTop = H - BAND_H;
    line(0, bandTop + 1, W, bandTop + 1);
    const step = Math.round(bandFontSize * BAND_LINE_GAP);
    const firstBaseline = bandTop + Math.round(bandFontSize * 1.35);
    for (let i = 0; i < bandLines.length; i++) {
      const lineText = bandLines[i];
      text(
        lineText,
        W / 2,
        firstBaseline + i * step,
        bandFontSize,
        "middle",
        true,
      );
    }
  }

  const overlaySvg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svg.join("")}</svg>`;

  // Tiles travel as URLs, not bytes: the worker's express body limit is 1MB and
  // six 1K PNGs are ~12MB. Every other worker endpoint already takes URLs.
  const prefix = opts.tileUploadPrefix || `proof-tiles/${Date.now()}`;
  const uploaded: Array<{
    key: string;
    url: string;
    x: number;
    y: number;
    w: number;
    h: number;
    trimWidthIn: number;
    trimHeightIn: number;
    bleedIn: number;
    masterPath: string;
  }> = [];
  for (const p of placed) {
    const tile = opts.tiles.find((t) => t.key === p.key);
    if (!tile || !opts.uploadTile) continue;
    const url = await opts.uploadTile(`${prefix}/${p.key}.png`, tile.png);
    const trimWidthIn = Number(tile.wIn || 0);
    const trimHeightIn = Number(tile.hIn || 0);
    const bleedIn = Number(opts.bleedIn || 0);
    if (!(trimWidthIn > 0 && trimHeightIn > 0) || bleedIn !== 5) {
      throw new Error(`proof tile ${p.key} lacks GENIE dimensions or exact 5-inch bleed`);
    }
    uploaded.push({
      key: p.key,
      url,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      trimWidthIn,
      trimHeightIn,
      bleedIn,
      masterPath: `${prefix}/masters/${p.key}.png`,
      // Display-only. The worker clips its on-sheet copy of this tile to the
      // vehicle elevation; the master it derives and hashes is the unmasked
      // rectangle, so extraction stays byte-identical to Call 7.
      clipPath: tileClipPaths[p.key] || null,
    });
  }

  const DESIGNPRO_WORKER_HOST = Deno.env.get("DESIGNPRO_WORKER_URL");
  const WORKER_SECRET = Deno.env.get("WORKER_SECRET") || "";
  if (!DESIGNPRO_WORKER_HOST) throw new Error("DESIGNPRO_WORKER_URL is not configured");
  if (!opts.publicTileUrl) {
    throw new Error("publicTileUrl is required for frozen Call 7 surface masters");
  }
  if (uploaded.length !== placed.length) {
    throw new Error(`proof tile upload incomplete (${uploaded.length}/${placed.length})`);
  }

  const resp = await fetch(`${DESIGNPRO_WORKER_HOST.replace(/\/+$/, "")}/compose-proof-sheet`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(WORKER_SECRET ? { Authorization: `Bearer ${WORKER_SECRET}` } : {}),
    },
    body: JSON.stringify({ canvas: { w: W, h: H }, tiles: uploaded, overlaySvg }),
    signal: AbortSignal.timeout(120_000),
  });
  const out = await resp.json().catch(() => ({}));
  if (!resp.ok || out?.success === false || !out?.pngBase64) {
    throw new Error(
      String(out?.error || `compose-proof-sheet returned HTTP ${resp.status}`),
    );
  }

  const returnedMasters = Array.isArray(out?.surfaceMasters)
    ? out.surfaceMasters
    : [];
  if (
    returnedMasters.length !== uploaded.length ||
    uploaded.some((tile) =>
      !returnedMasters.some((master: any) =>
        master?.key === tile.key &&
        master?.masterPath === tile.masterPath &&
        /^[0-9a-f]{64}$/.test(String(master?.sha256 || "")) &&
        /^[0-9a-f]{64}$/.test(String(master?.regionSha256 || "")) &&
        Number(master?.bytes) > 0 &&
        Number(master?.pixelWidth) > 0 &&
        Number(master?.pixelHeight) > 0 &&
        Number(master?.trimWidthIn) === tile.trimWidthIn &&
        Number(master?.trimHeightIn) === tile.trimHeightIn &&
        Number(master?.bleedIn) === 5 &&
        Number(master?.printWidthIn) === tile.trimWidthIn + 10 &&
        Number(master?.printHeightIn) === tile.trimHeightIn + 10 &&
        Number(master?.pixelWidth) === Math.round((tile.trimWidthIn + 10) * 10) &&
        Number(master?.pixelHeight) === Math.round((tile.trimHeightIn + 10) * 10) &&
        master?.sourceCrop?.fit === "contain-mirror-fill-at-call7" &&
        master?.sourceCrop?.stretch === false &&
        master?.sourceCrop?.rotationDegrees === 0 &&
        master?.sourceCrop?.truncated === false
      )
    )
  ) {
    throw new Error("compose-proof-sheet returned an incomplete or unsafe Call 7 master set");
  }

  const surfaceMasters = returnedMasters.map((master: any) => ({
    key: String(master.key),
    url: opts.publicTileUrl!(String(master.masterPath)),
    sha256: String(master.sha256).toLowerCase(),
    bytes: Number(master.bytes),
    pixelWidth: Number(master.pixelWidth),
    pixelHeight: Number(master.pixelHeight),
    trimWidthIn: Number(master.trimWidthIn),
    trimHeightIn: Number(master.trimHeightIn),
    bleedIn: Number(master.bleedIn),
    printWidthIn: Number(master.printWidthIn),
    printHeightIn: Number(master.printHeightIn),
    regionSha256: String(master.regionSha256 || "").toLowerCase(),
    sourceCrop: master.sourceCrop as Record<string, unknown>,
  }));

  return {
    bytes: decodeBase64(String(out.pngBase64)),
    rects,
    surfaceMasters,
    width: W,
    height: H,
  };
}
