"use strict";
/**
 * A.T.L.A.S. LETTERING READ — one flank panel in, every band of lettering out,
 * each with its reading ORIENTATION.
 *
 * WHY THIS EXISTS (live run 8eec8162, 2026-09-15, "Porsche Martini" 911).
 *
 * The passenger flank is composed in code as the driver flank mirrored, with
 * each band of lettering lifted from the driver and re-dropped un-flipped so
 * it reads forward (atlas-passenger-mirror.cjs). The bands used to come from
 * the whole-sheet master QC read, which looks at the ENTIRE 4096² sheet
 * squeezed into one 1800px JPEG: a flank is a third of that, and a race
 * livery's "PORSCHE", "21" and sponsor marks are a few pixels tall on the
 * wire. It located ONE band. Everything else flipped backwards, the proof
 * inspector correctly reported "'PORSCHE' in the authority crop is mirrored",
 * the passenger proof was refused, and the run stalled at six views.
 *
 * Two things fix that at the root, both here:
 *
 *   1. THE READ IS OF THE PANEL, NOT THE SHEET. The driver flank is cropped
 *      out and sent on its own at up to 1800px, so lettering is read at the
 *      resolution it was authored at.
 *   2. THE RESULT IS VERIFIED ON THE COMPOSED PASSENGER PANEL. The same reader
 *      looks at the composed flank and names every band that reads MIRRORED.
 *      Those are mapped back to driver space and re-dropped forward, and the
 *      panel is read again. A band the first read missed cannot ship reversed
 *      unnoticed: it is either corrected or the composition declines.
 *
 * No pixel is invented here. This module only READS; every correction is a
 * rearrangement of driver pixels performed by atlas-passenger-mirror.cjs.
 * Every failure of the reader is a receipt (`status: "unavailable"`), never a
 * throw, so an unreachable inspector can never fail an accepted Call 1.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const LETTERING_READ_CONTRACT = "designpro.atlas-lettering-read.v1";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TRANSPORT_DIMENSION = 1800;
const MAX_TRANSPORT_BYTES = 3 * 1024 * 1024;
const MAX_BANDS = 24;
/**
 * A BAND IS LETTERING ONLY IF IT READS AS LETTERING. Live 220d569f
 * (2026-09-16): the model had painted the coordinate map onto the sheet and
 * the reader returned seven "bands" for the digits and the stripes around
 * them, each a big rectangle, and the mirror pasted seven un-flipped patches
 * onto the passenger flank. A band with no readable letters or digits is not
 * lettering, and a band wider or taller than a real word block on a flank is
 * not a word: both are dropped before any pixel moves.
 */
const MIN_BAND_TEXT_CHARS = 2;
const MAX_BAND_AREA_FRACTION = 0.18;
const MAX_BAND_WIDTH_FRACTION = 0.6;
const MAX_BAND_HEIGHT_FRACTION = 0.6;
const MAX_TOTAL_BAND_AREA_FRACTION = 0.4;
const ORIENTATIONS = Object.freeze(["forward", "mirrored", "vertical", "unknown"]);
const SURFACES = Object.freeze(["driver", "passenger"]);
/** Two bands describing the same lettering overlap at least this much. */
const DUPLICATE_IOU = 0.6;
const DRIVER_READ_LABEL = "A.T.L.A.S. driver lettering read";
const PASSENGER_VERIFY_LABEL = "A.T.L.A.S. passenger lettering verify";

class AtlasLetteringReadError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "AtlasLetteringReadError";
    this.code = code;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanText(value, max = 400) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The reader's question. One panel, in the orientation a person reads it in.
 * The inspectionId binds the answer to these exact bytes so a cached or
 * misrouted answer for another panel is refused.
 */
function letteringReadPrompt({ inspectionId, surface }) {
  return [
    `You are a print-production inspector reading ONE flat vinyl print panel: the ${surface} flank of a vehicle wrap, shown in its installed reading orientation. Do not judge quality, style or branding.`,
    "",
    "List EVERY band of lettering on the panel: words, wordmarks, company names, numerals and race numbers, phone numbers, URLs, taglines, sponsor marks, badges and logos that contain letters or digits — anything that has a reading direction. Decorative marks with no letters or digits are not bands.",
    "",
    "For each band report its bounding rectangle as fractions of THIS image, 0 to 1, origin at the top-left corner: xPct and yPct are the left and top edges, wPct and hPct the width and height. Pad every rectangle by about 2% of the image on each side so the whole outline of every glyph, including outlines, shadows and the logo shape it sits in, is inside it. Words that sit together on one line form one band; separate lines and separate marks are separate bands.",
    "",
    "For each band also report `text`, the characters as they read, and `orientation`: \"forward\" when the letters read normally left to right; \"mirrored\" when the letters are horizontally reversed, as seen in a mirror, reading right to left; \"vertical\" when the line runs up or down the panel; \"unknown\" when it cannot be told. A word that is upside down but not reversed is \"forward\".",
    "",
    "Return an empty list when the panel carries no lettering. Report measurements, not judgements.",
    "",
    `Respond with STRICT JSON only: {"inspectionId":"${inspectionId}","bands":[{"xPct":0..1,"yPct":0..1,"wPct":0..1,"hPct":0..1,"text":"...","orientation":"forward"|"mirrored"|"vertical"|"unknown"}],"confidence":0..1}`,
  ].join("\n");
}

/**
 * THE SCHEMA IS SHAPE ONLY. Every constraint lives in the parser.
 *
 * The first deployed version (2026-09-15, canary 871a8bf1) carried an
 * inspectionId enum, an orientation enum, min/max on five numbers and
 * maxItems on the band list, and Gemini refused it on every call:
 *   400 "The specified schema produces a constraint that has too many
 *   states for serving."
 * The read silently fell back to the sheet read and the verify never ran --
 * the exact defect this reader exists to fix. So the schema names only the
 * fields and their types; `parseLetteringRead` binds the inspectionId,
 * clamps every fraction, normalises the orientation and caps the count. A
 * constraint the serving engine cannot compile is not a constraint.
 */
function responseSchema() {
  const number = { type: "NUMBER" };
  return {
    type: "OBJECT",
    propertyOrdering: ["inspectionId", "bands", "confidence"],
    properties: {
      inspectionId: { type: "STRING" },
      bands: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          propertyOrdering: ["xPct", "yPct", "wPct", "hPct", "text", "orientation"],
          properties: {
            xPct: number, yPct: number, wPct: number, hPct: number,
            text: { type: "STRING" },
            orientation: { type: "STRING" },
          },
          required: ["xPct", "yPct", "wPct", "hPct", "text", "orientation"],
        },
      },
      confidence: number,
    },
    required: ["inspectionId", "bands", "confidence"],
  };
}

/** The panel at reading resolution, inside the request budget. */
async function boundedTransport(bytes) {
  const widths = [MAX_TRANSPORT_DIMENSION, 1600, 1400, 1200, 1024];
  const qualities = [88, 82, 76, 70, 64];
  for (const width of widths) {
    for (const quality of qualities) {
      const candidate = await sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 })
        .flatten({ background: "#ffffff" })
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
        .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
      if (candidate.length <= MAX_TRANSPORT_BYTES) return candidate;
    }
  }
  throw new AtlasLetteringReadError("atlas_lettering_transport_too_large", "The panel cannot fit the read budget");
}

/** One band, cleaned: finite fractions, positive area, clamped to the panel. */
function normalizeBand(raw) {
  if (!raw || typeof raw !== "object") return null;
  const x = Number(raw.xPct);
  const y = Number(raw.yPct);
  const w = Number(raw.wPct);
  const h = Number(raw.hPct);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  const left = Math.min(Math.max(0, x), 1);
  const top = Math.min(Math.max(0, y), 1);
  const width = Math.min(Math.max(0, w), 1 - left);
  const height = Math.min(Math.max(0, h), 1 - top);
  if (width <= 0 || height <= 0) return null;
  const orientation = ORIENTATIONS.includes(raw.orientation) ? raw.orientation : "unknown";
  const text = cleanText(raw.text, 80);
  // Readable characters only: the fraction "0.3633" the model painted on the
  // sheet reads as digits, so it is refused on shape below; stripes and
  // graphics with no letters at all are refused here.
  if ((text.match(/[A-Za-z0-9]/g) || []).length < MIN_BAND_TEXT_CHARS) return null;
  if (width > MAX_BAND_WIDTH_FRACTION || height > MAX_BAND_HEIGHT_FRACTION || width * height > MAX_BAND_AREA_FRACTION) return null;
  return {
    xPct: left, yPct: top, wPct: width, hPct: height,
    text,
    orientation,
  };
}

/** Bands in reading order until their combined area exceeds the cap. */
function boundTotalArea(bands) {
  let area = 0;
  const kept = [];
  for (const band of bands) {
    if (area + band.wPct * band.hPct > MAX_TOTAL_BAND_AREA_FRACTION) break;
    area += band.wPct * band.hPct;
    kept.push(band);
  }
  return kept;
}

function parseLetteringRead(payload, inspectionId) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("\n").trim();
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    throw new AtlasLetteringReadError("atlas_lettering_response_unparseable", `Reader returned non-JSON: ${cleanText(text, 160)}`);
  }
  if (parsed?.inspectionId !== inspectionId) {
    throw new AtlasLetteringReadError("atlas_lettering_inspection_mismatch", "Reader answered for different bytes");
  }
  if (!Array.isArray(parsed?.bands)) {
    throw new AtlasLetteringReadError("atlas_lettering_bands_invalid", "Reader returned no bands array");
  }
  const bands = boundTotalArea(parsed.bands.slice(0, MAX_BANDS).map(normalizeBand).filter(Boolean));
  const confidence = Number(parsed?.confidence);
  return {
    bands,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : null,
  };
}

/**
 * Read every lettering band on one flank panel.
 *
 * Returns a receipt, never throws:
 *   { contract, surface, status: "read"|"unavailable", bands, confidence,
 *     model, panelSha256, code, reason }
 */
async function readPanelLettering({
  provider, panelBytes, surface, model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS, signal,
} = {}) {
  const surfaceKey = SURFACES.includes(surface) ? surface : null;
  const panelSha256 = Buffer.isBuffer(panelBytes) && panelBytes.length ? sha256(panelBytes) : null;
  const base = { contract: LETTERING_READ_CONTRACT, surface: surfaceKey, model, panelSha256 };
  const unavailable = (error) => ({
    ...base,
    status: "unavailable",
    bands: [],
    confidence: null,
    code: error instanceof AtlasLetteringReadError ? error.code : "atlas_lettering_reader_failed",
    reason: cleanText(error?.message || error, 400),
  });
  if (!surfaceKey) {
    return unavailable(new AtlasLetteringReadError("atlas_lettering_surface_invalid", `${surface} is not a flank`));
  }
  if (!panelSha256) {
    return unavailable(new AtlasLetteringReadError("atlas_lettering_panel_required", "The panel bytes are required"));
  }
  if (!provider || typeof provider.generateRaw !== "function") {
    return unavailable(new AtlasLetteringReadError("atlas_lettering_transport_missing", "Lettering read requires provider.generateRaw"));
  }
  if (!/^gemini-[a-z0-9.-]+$/.test(String(model)) || /image/.test(String(model))) {
    return unavailable(new AtlasLetteringReadError("atlas_lettering_model_invalid", `${model} is not an inspection model`));
  }
  try {
    const transport = await boundedTransport(panelBytes);
    const inspectionId = panelSha256.slice(0, 16);
    const result = await provider.generateRaw({
      model,
      body: {
        contents: [{ role: "user", parts: [
          { text: letteringReadPrompt({ inspectionId, surface: surfaceKey }) },
          { inlineData: { mimeType: "image/jpeg", data: transport.toString("base64") } },
        ] }],
        generationConfig: {
          temperature: 0,
          // Flash otherwise spends the small structured budget on hidden
          // reasoning and can hit MAX_TOKENS before the JSON lands.
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          responseSchema: responseSchema(),
        },
      },
      signal,
      timeoutMs,
      label: surfaceKey === "driver" ? DRIVER_READ_LABEL : PASSENGER_VERIFY_LABEL,
    });
    const read = parseLetteringRead(result?.payload, inspectionId);
    return {
      ...base,
      model: result?.model || model,
      status: "read",
      bands: read.bands,
      confidence: read.confidence,
      code: null,
      reason: null,
    };
  } catch (error) {
    return unavailable(error);
  }
}

/**
 * A band located on the composed PASSENGER panel, expressed in DRIVER panel
 * space. The passenger panel is the driver panel flopped, so a rectangle at
 * xPct on the passenger sits at 1 - xPct - wPct on the driver; the vertical
 * axis is untouched. Only mirrored bands are mapped: those are the ones the
 * mirror must lift from the driver and re-drop forward.
 */
function mirroredBandsToDriverSpace(bands) {
  return (Array.isArray(bands) ? bands : [])
    .filter((band) => band && band.orientation === "mirrored")
    .map((band) => ({
      xPct: Math.min(Math.max(0, 1 - Number(band.xPct) - Number(band.wPct)), 1),
      yPct: Number(band.yPct),
      wPct: Number(band.wPct),
      hPct: Number(band.hPct),
      text: band.text || "",
      orientation: "forward",
    }));
}

function intersectionOverUnion(a, b) {
  const left = Math.max(a.xPct, b.xPct);
  const top = Math.max(a.yPct, b.yPct);
  const right = Math.min(a.xPct + a.wPct, b.xPct + b.wPct);
  const bottom = Math.min(a.yPct + a.hPct, b.yPct + b.hPct);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.wPct * a.hPct + b.wPct * b.hPct - overlap;
  return union > 0 ? overlap / union : 0;
}

/** Existing bands plus the incoming ones that describe lettering not already covered. */
function mergeBands(existing, incoming) {
  const merged = [...(Array.isArray(existing) ? existing : [])];
  for (const band of Array.isArray(incoming) ? incoming : []) {
    if (!band) continue;
    if (merged.some((known) => intersectionOverUnion(known, band) >= DUPLICATE_IOU)) continue;
    merged.push(band);
  }
  return merged;
}

module.exports = {
  LETTERING_READ_CONTRACT,
  DEFAULT_MODEL,
  DRIVER_READ_LABEL,
  PASSENGER_VERIFY_LABEL,
  MAX_BANDS,
  AtlasLetteringReadError,
  readPanelLettering,
  letteringReadPrompt,
  parseLetteringRead,
  mirroredBandsToDriverSpace,
  mergeBands,
  responseSchema,
  MIN_BAND_TEXT_CHARS, MAX_BAND_AREA_FRACTION, MAX_TOTAL_BAND_AREA_FRACTION,
  _test: { normalizeBand, intersectionOverUnion, boundedTransport, sha256, boundTotalArea },
};
