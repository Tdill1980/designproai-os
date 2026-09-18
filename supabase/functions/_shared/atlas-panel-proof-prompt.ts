/**
 * _shared/atlas-panel-proof-prompt.ts — CALL 1 AS A FLAT PANEL PRODUCTION
 * PROOF (owner ruling, Trish 2026-09-18).
 *
 * BYTE-LOCKED against runtime/atlas-panel-proof-contract.cjs by
 * tests/atlas-panel-proof-contract.test.mjs. Two homes for one contract is how
 * a fix here keeps coming undone (the same reason atlas-artboard-prompt.ts is
 * locked against designiq-prompt.cjs). Change both or neither.
 *
 * WHY IT EXISTS. Every documented Call-1 experiment in this repository changed
 * THE ASK while keeping the requested OBJECT the same -- a bare six-rectangle
 * artboard. The measured outcome of all of them is that the model draws a
 * LAYOUT DRAWING: body panels die-cut on a plain surround. RULE 0.38's canary
 * table states the trade exactly: the six-surface sheet "drew the best artwork
 * of the four ... but each panel die-cut to the truck's silhouette". The
 * artwork was right and the OBJECT was wrong.
 *
 * So this asks for the object the model already draws well AND which a print
 * shop actually receives: a panel production proof.
 *
 * OPT-IN ONLY. Reached solely when `body.proofContract` names this contract.
 * Absent -- which is every production request today -- nothing in
 * handleAtlasArtboard changes by a single byte.
 */

export const ATLAS_PANEL_PROOF_CONTRACT = "designpro.atlas-panel-production-proof.v1";

/**
 * THE OWNER'S FORMAT SHEET, HASH-PINNED. "Must use this" (Trish 2026-09-18).
 *
 * The Bright Smiles Dental three-version 2D PRODUCTION PROOF, 1536x1024,
 * carrying every block this contract names. Pinned exactly as the Flamingo
 * teaching proof is pinned, for the same reason: a teaching input that silently
 * changes teaches something nobody chose (canary 33389124918). NEVER recreate,
 * crop, relabel or re-encode it.
 *
 * FORMAT ONLY. It was produced by ChatGPT, not by this pipeline and not by
 * Gemini, so it says what the document should look like and nothing about what
 * our model will draw. Its artwork and branding are not style authority.
 */
export const PANEL_PROOF_FORMAT_EXAMPLE = {
  path: "atlas-examples/panel-production-proof-three-version.png",
  sha256: "57c07672f644a9b3a38783807fd1cf67fbdf21829905e01d8b7afed042e315db",
  byteSize: 1793915,
  width: 1536,
  height: 1024,
} as const;

/**
 * ROLE AND ARTIFACT BEFORE CONTENT. Multimodal best practice: fix the object
 * class before the model reads a design word. Deliberately short -- CLAUDE.md's
 * standing measurement is that creative direction loses to format text when the
 * two compete for one budget (v19: 465 characters of proven creative direction
 * deleted, four releases of refusal language added on top).
 */
export const SYSTEM_JOB = [
  "You are a professional wide-format wrap designer producing a VEHICLE WRAP PANEL PRODUCTION PROOF:",
  "the document a print shop receives. It shows each side's finished wrap panel as a flat rectangle,",
  "dimensioned, captioned with its surface name, on a clean proof sheet.",
  "",
  "You are a pro-level graphic designer. Your job on this proof is to guarantee that NOTHING pertinent",
  "is lost at installation: the company name, the logo, the contact line and any face or focal subject",
  "must sit clear of where the installer trims or the vinyl distorts -- wheel arches, door handles,",
  "deep body creases, mirrors, glass and the panel's own outer trim line. Artwork runs past the trim on",
  "every edge; type and logos do not.",
].join("\n");

/**
 * THE PHYSICAL REASON A PANEL IS ONE RECTANGLE.
 *
 * This is the Avery Dennison / Wrap Institute fact RULE 0.32 is built on,
 * stated as a positive physical fact rather than as a prohibition. "Do not draw
 * wheel arches" is the negative shape this repo warns about in four places and
 * which has failed 4/4 on the field map.
 */
export const INSTALLATION_FACT = [
  "One side of a vehicle is wrapped with ONE CONTINUOUS PANEL. The installer lays that whole printed",
  "rectangle onto the side and trims the wheel openings, handles and glass afterwards, with a blade,",
  "on the vehicle. So the printed panel has no holes and no vehicle-shaped outline: it is a solid",
  "rectangle of artwork, and the artwork continues straight through the places those openings will be.",
].join("\n");

/**
 * THE SHEET'S LAYOUT, STATED IN WORDS — NEVER AS COORDINATES.
 *
 * Owner ruling 2026-09-18: the template is a system-level constant so every
 * proof looks like it came from the same print shop line and the downstream
 * croppers always know where to look. The numbers live in PROOF_REGIONS, which
 * the model never sees -- `atlasFieldContract` emitted its layout as bare
 * four-decimal rows and four consecutive live runs painted those digits onto
 * the customer's flanks. Prose describing a document's own sections has never
 * done that; a coordinate table has, 4/4.
 */
export const SHEET_LAYOUT = [
  "THE SHEET, in this order down the page:",
  "  A header band: the company logo and tagline at the left, the title 2D PRODUCTION PROOF centred,",
  "  and a job block at the right carrying the date, order number, designer and version.",
  "  VERSION 1 across the upper half, each panel dimensioned.",
  "  A TRIM SIZE REFERENCE table and a TOTAL COVERAGE figure beside the smaller panels.",
  "  VERSION 2 across the lower left. The cut proof fills the lower right.",
  "  A footer band repeating the logo and tagline.",
  "",
  "DIMENSION IT AS A DRAFTSMAN WOULD: a measured line outside each panel, arrowheads at both ends,",
  "thin extension lines back to the edge, the figure on the line. A working shop drawing, not a poster.",
].join("\n");

/**
 * The same layout as rectangles, for CODE ONLY. Never rendered into the prompt.
 * APPROXIMATE -- read off the reference sheet's proportions, good enough to
 * find a block and not good enough to cut a print panel from. Calibrate against
 * a real returned sheet before anything binds to them.
 */
export const PROOF_REGIONS = {
  header: { x: 0, y: 0, w: 1, h: 0.093 },
  version1: { x: 0, y: 0.105, w: 1, h: 0.42 },
  trimTable: { x: 0.655, y: 0.37, w: 0.2, h: 0.14 },
  totalCoverage: { x: 0.865, y: 0.37, w: 0.125, h: 0.1 },
  version2: { x: 0, y: 0.54, w: 0.5, h: 0.35 },
  cutProof: { x: 0.5, y: 0.54, w: 0.5, h: 0.35 },
  footer: { x: 0, y: 0.905, w: 1, h: 0.095 },
} as const;

/** The three artifacts, in one pass, by one designer. */
export const VERSIONS = [
  {
    key: "branded",
    label: "VERSION 1 — FULL DESIGN (WITH TEXT & LOGO)",
    instruction: "every panel carrying the finished design: artwork, logo, company name and contact line.",
  },
  {
    key: "artwork",
    label: "VERSION 2 — ARTWORK ONLY (NO TEXT OR LOGO)",
    instruction:
      "the SAME panels with every word, numeral and logo removed and the artwork continued through where they sat. "
      + "Not erased or blanked -- drawn as the design would be if it had never carried type. This is the "
      + "installer's reference sheet.",
  },
  {
    key: "elements",
    label: "VERSION 3 — LOGO + TEXT ONLY (CUT PROOF)",
    instruction:
      "the logo, company name and contact line alone, drawn as standalone vector cut outlines on a plain empty "
      + "ground -- no vehicle, no panels and no background artwork. This is the sheet a plotter cuts.",
  },
] as const;

export interface PanelProofParams {
  companyName?: string;
  /** Every literal the wrap carries, not just the contact bar -- see the runtime twin. */
  tagline?: string;
  phone?: string;
  website?: string;
  services?: string[] | string;
  promo?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  /** Header job block — the metadata the reference sheet carries top-right. */
  proofDate?: string;
  orderNumber?: string;
  designer?: string;
  proofVersion?: string;
  creativeDirection?: string;
  /** `SURFACE: 165.7" wide x 49.6" high` rows, from the GENIE manifest. */
  panelRows?: string[];
}

export function buildPanelProofPrompt(params: PanelProofParams): string {
  const pick = (v: unknown) => String(v == null ? "" : v).trim();
  const list = (v: unknown) => (Array.isArray(v) ? v.map(pick).filter(Boolean).join(", ") : pick(v));
  const strings: Array<[string, string]> = ([
    ["Company name", pick(params.companyName)],
    ["Tagline", pick(params.tagline)],
    ["Phone", pick(params.phone)],
    ["Web address", pick(params.website)],
    ["Services", list(params.services)],
    ["Promotional text", pick(params.promo)],
  ] as Array<[string, string]>).filter(([, value]) => value.length > 0);

  const vehicle = [params.vehicleYear, params.vehicleMake, params.vehicleModel]
    .map(pick).filter(Boolean).join(" ");
  const rows = (params.panelRows || []).filter((row) => pick(row).length > 0);

  const out: string[] = [SYSTEM_JOB, "", INSTALLATION_FACT, ""];
  out.push(`VEHICLE: ${vehicle || "the vehicle named in the brief"}`);
  if (rows.length) {
    out.push("", "PANELS ON THIS PROOF, at their finished trim size, each printed with a",
      "5-inch bleed of artwork continuing past every edge:", ...rows.map((row) => `  ${row}`));
  }
  out.push("", "THE DESIGN:", `"${pick(params.creativeDirection)}"`);
  if (strings.length) {
    out.push("", "EXACT TEXT — reproduce each of these character for character. Invent no other words,",
      "no other numerals, no other address or web address anywhere on the proof:",
      ...strings.map(([label, value]) => `  ${label}: ${value}`));
  }
  const job: Array<[string, string]> = ([
    ["Date", pick(params.proofDate)],
    ["Order #", pick(params.orderNumber)],
    ["Designer", pick(params.designer)],
    ["Version", pick(params.proofVersion)],
  ] as Array<[string, string]>).filter(([, value]) => value.length > 0);
  if (job.length) {
    out.push("", "JOB BLOCK — set these in the header exactly as given:",
      ...job.map(([label, value]) => `  ${label}: ${value}`));
  }
  out.push("", "PRODUCE THREE VERSIONS ON THE PROOF, in this order:",
    ...VERSIONS.map((v, i) => `  ${i + 1}. ${v.label} — ${v.instruction}`));
  out.push("", SHEET_LAYOUT);
  out.push("",
    "The attached proof sheet is the FORMAT to follow — its layout, captions and dimension callouts.",
    "Its artwork is not a style reference and must not be copied.",
    "The attached installation photograph shows why a panel is one continuous rectangle.");
  return out.join("\n");
}
