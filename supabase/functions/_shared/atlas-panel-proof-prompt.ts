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
    out.push("", "PANELS ON THIS PROOF, at their finished trim size:", ...rows.map((row) => `  ${row}`));
  }
  out.push("", "THE DESIGN:", `"${pick(params.creativeDirection)}"`);
  if (strings.length) {
    out.push("", "EXACT TEXT — reproduce each of these character for character. Invent no other words,",
      "no other numerals, no other address or web address anywhere on the proof:",
      ...strings.map(([label, value]) => `  ${label}: ${value}`));
  }
  out.push("", "PRODUCE THREE VERSIONS ON THE PROOF, in this order:",
    ...VERSIONS.map((v, i) => `  ${i + 1}. ${v.label} — ${v.instruction}`));
  out.push("",
    "The attached proof sheet is the FORMAT to follow — its layout, captions and dimension callouts.",
    "Its artwork is not a style reference and must not be copied.",
    "The attached installation photograph shows why a panel is one continuous rectangle.");
  return out.join("\n");
}
