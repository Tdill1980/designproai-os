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
 * The Bright Smiles Dental 2012 Toyota Prius 2D PRODUCTION PROOF, 1536x1024:
 * header and TOTAL COVERAGE, three full-width ZONE bands, the PANEL DIMENSIONS
 * REFERENCE row, TEMPLATE NOTES, GUIDE legend, footer. It is the FILLED TWIN of
 * the container template, which is why it replaced the two-column sheet pinned
 * earlier the same day -- two layouts cannot both be "the template filled in".
 * Pinned exactly as the Flamingo
 * teaching proof is pinned, for the same reason: a teaching input that silently
 * changes teaches something nobody chose (canary 33389124918). NEVER recreate,
 * crop, relabel or re-encode it.
 *
 * IT IS THE STANDARD, NOT JUST THE GRID (owner correction, 2026-09-18). The
 * layout AND the quality of the work on it are the bar -- finish, type, the
 * depth of the artwork. One carve-out, about ownership rather than style: the
 * identity on the sheet is Bright Smiles Dental's, and a customer's proof
 * carries only the strings in their own request.
 */
export const PANEL_PROOF_FORMAT_EXAMPLE = {
  path: "atlas-examples/panel-proof-zones-filled.png",
  sha256: "9586710b026e22b3b2c5f80379382b31a211852c7c5128d10d0d356a0534d108",
  byteSize: 1870997,
  width: 1536,
  height: 1024,
} as const;

/**
 * THE BLANK CONTAINER TEMPLATE — the SECOND system-level attachment.
 *
 * Owner ruling, Trish 2026-09-18: "This is just the container template edge
 * function that needs in system instruction along with the version that has
 * graphics" / "produce a blank container template for system". The request
 * carries BOTH: the empty structure and a finished example of it.
 *
 * DRAWN BY CODE (`runtime/atlas-proof-container-template.cjs`), not generated.
 * A generated container comes back slightly different every time, and the
 * owner's own generated one read "2012 TOYOTA PRIORS" and "5 BLEON ON ALL FOUR
 * EDGES" -- a teaching input with a typo in it teaches the typo.
 *
 * NOT a blank canvas: every region is captioned, banded and dimensioned, so it
 * reads as a DOCUMENT WITH EMPTY FIELDS rather than the empty picture RULE 0.33
 * removed from Call 1. 3:2 at 1536x1024, identical to the filled reference.
 */
export const PANEL_PROOF_CONTAINER_TEMPLATE = {
  // NO path, sha256 or byteSize. Those described one fixed Prius render and
  // became a lie the moment the container went per-vehicle: the caller stages
  // its own under atlas-call1-inputs/<sha256>.png and names it in the request.
  // A constant that still advertises a stale path is how a later reader wires
  // the wrong object with complete confidence.
  contract: "designpro.atlas-proof-container-template.v1",
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
/**
 * ⚠️ THE DESIGNER IS NOT DESCRIBED HERE ANY MORE. A.C.E. IS EXECUTED.
 *
 * Owner ruling, Trish 2026-09-18: "Must use our suite of custom design edge
 * functions no fucking excuses!!!"
 *
 * This constant used to open with two paragraphs of my own designer persona --
 * "You are a professional wide-format wrap designer ... You are a pro-level
 * graphic designer ..." -- and that was the whole reason the proof came back as
 * generic blue waves and stock photography. Measured on the live sheet: the
 * prompt was 3,906 characters, of which roughly 40 were the customer's brief
 * and ZERO were A.C.E. All 1,506 characters of the proven commercial persona
 * (COMMERCIAL_DEPTH's layered build order, COMMERCIAL_TRANSLATION,
 * LOGO_AUTHORING_RULE, PROFESSIONAL_JUDGMENT, the customer's FINISH_SPEC) sat
 * unused in a file this one never imported.
 *
 * Writing a new persona to fix a design is exactly what RULE 0.1 forbids and
 * what v19 measured the cost of. So the creative half now comes from
 * `buildDesignIQPrompt` itself, via `panelProofCreativeHead` below, and what
 * remains here is only the OBJECT: which document is being produced. The
 * safe-area rule survives because it is a production fact about this document,
 * not creative direction -- and it is one sentence, not two paragraphs.
 */
export const SYSTEM_JOB = [
  "THE DELIVERABLE IS A VEHICLE WRAP PANEL PRODUCTION PROOF — the document a print shop receives:",
  "each side's finished wrap panel as a flat rectangle on a clean sheet.",
].join("\n");

/**
 * WHERE A.C.E. STOPS AND THIS DOCUMENT BEGINS.
 *
 * `buildDesignIQPrompt(..., atlasFlatMaster: true)` returns the real commercial
 * assembly followed by its own OUTPUT FORMAT contract -- the six-rectangle
 * A.T.L.A.S. artboard. That tail is the right object for Call 1 and the wrong
 * one here, and leaving both in would hand the model two contradictory output
 * contracts in one prompt.
 *
 * So the creative half is kept and the tail is swapped, which is precisely the
 * move RULE 0.26 already sanctions for the artboard assembly: "swaps ONLY the
 * presentation tail ... via exact-match throw-on-drift replacements". THROW is
 * the load-bearing word. If the marker ever moves, this fails loudly rather
 * than silently shipping a prompt that asks for a six-panel artboard and a
 * three-zone proof at the same time.
 */
export const ACE_OUTPUT_TAIL_MARKER = "\nOUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD";

export function panelProofCreativeHead(aceAssembly: string): string {
  const cut = String(aceAssembly || "").indexOf(ACE_OUTPUT_TAIL_MARKER);
  if (cut < 0) {
    throw new Error("panel_proof_ace_output_tail_marker_missing");
  }
  const head = aceAssembly.slice(0, cut).trimEnd();
  // A head that lost the persona is not a head. The opening sentence of the
  // commercial assembly is the senior-designer identity; if a refactor ever
  // drops it, the proof silently goes back to having no designer at all, which
  // is the exact defect this function exists to end.
  if (!/senior vehicle-wrap designer/.test(head)) {
    throw new Error("panel_proof_ace_persona_missing");
  }
  return head;
}

/**
 * THE PHYSICAL REASON A PANEL IS ONE RECTANGLE.
 *
 * This is the Avery Dennison / Wrap Institute fact RULE 0.32 is built on,
 * stated as a positive physical fact rather than as a prohibition. "Do not draw
 * wheel arches" is the negative shape this repo warns about in four places and
 * which has failed 4/4 on the field map.
 */
export const INSTALLATION_FACT = [
  "One side is wrapped with ONE CONTINUOUS PANEL, trimmed on the vehicle afterwards — so type and",
  "logos stay well clear of the trim line.",
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
  "Fill the attached template; do not re-flow it. Each band holds those six panels, each drawn ONCE,",
  "in that order — never repeated, never a seventh, never an empty box.",
].join("\n");

/**
 * The same layout as rectangles, for CODE ONLY. Never rendered into the prompt.
 * APPROXIMATE -- read off the reference sheet's proportions, good enough to
 * find a block and not good enough to cut a print panel from. Calibrate against
 * a real returned sheet before anything binds to them.
 */
export const PROOF_REGIONS = {
  header: { x: 0, y: 0, w: 1, h: 0.094 },
  zone1: { x: 0, y: 0.105, w: 1, h: 0.258 },
  zone2: { x: 0, y: 0.363, w: 1, h: 0.270 },
  zone3: { x: 0, y: 0.633, w: 1, h: 0.174 },
  reference: { x: 0, y: 0.807, w: 1, h: 0.105 },
  footer: { x: 0, y: 0.912, w: 1, h: 0.088 },
} as const;

/** The three artifacts, in one pass, by one designer. */
export const VERSIONS = [
  {
    key: "branded",
    label: "ZONE 1 — FULL DESIGN PANELS (PHOTO + DESIGN + TEXT + LOGO)",
    instruction: "the finished design.",
  },
  {
    key: "artwork",
    label: "ZONE 2 — BACKGROUNDS ONLY (NO TEXT OR LOGO)",
    instruction: "the same panels drawn as if they had never carried type.",
  },
  {
    key: "elements",
    label: "ZONE 3 — CUT GRAPHICS (LOGO, TEXT & ICONS ONLY)",
    instruction: "the marks alone as cut outlines on empty ground.",
  },
] as const;

/**
 * THE FIVE ZONE-3 SLOTS, AND WHAT THE CUSTOMER'S OWN STRINGS PUT IN EACH.
 *
 * Live sheet 2026-09-18 left THREE of the five empty -- contact line,
 * promotional text and icons -- while "never leave a box empty" was already in
 * the contract. A rule with no content behind it cannot be followed: the model
 * was told not to leave a box empty and never told what went in it. Naming the
 * slot AND the exact string that fills it is the difference.
 *
 * `fallback` is what a slot carries when the customer supplied nothing for it.
 * It is never a fabricated STRING -- inventing a phone number or a slogan is
 * the defect the exact-text rule exists to prevent -- it is a drawn MARK from
 * the design's own vocabulary, which is a legitimate cut graphic.
 */
export const CUT_GRAPHIC_SLOTS = [
  { caption: "PRIMARY LOGO", from: "logo", fallback: "the logo mark alone, without the wordmark" },
  { caption: "TAGLINE / SLOGAN", from: "tagline", fallback: "the company name set as a one-line wordmark" },
  { caption: "CONTACT LINE", from: "contact", fallback: "the web address alone" },
  { caption: "PROMOTIONAL TEXT", from: "promo", fallback: "the services line set as one cut strip" },
  { caption: "ICONS / SERVICE GRAPHICS", from: "icons", fallback: "the design's own motifs drawn as plain cut shapes" },
] as const;

/** Trim square footage from THIS request's own panel rows. Never copied. */
export function panelProofCoverageSqFt(panelRows: string[] | undefined): number | null {
  let total = 0;
  let seen = 0;
  for (const raw of Array.isArray(panelRows) ? panelRows : []) {
    const m = /([0-9.]+)"?\s*wide\s*x\s*([0-9.]+)"?\s*high/i.exec(String(raw || ""));
    if (!m) continue;
    const w = Number(m[1]);
    const h = Number(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
    total += (w * h) / 144;
    seen += 1;
  }
  // ONE ROUNDING BOUNDARY, on the raw sum -- the same rule the Call-8 total
  // uses, for the same reason: rounding each surface and then summing produced
  // a one-cent mismatch that deferred a whole production run.
  return seen === 6 ? Math.round(total * 100) / 100 : null;
}

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
  /**
   * The REAL A.C.E. assembly, head only — `panelProofCreativeHead(
   * buildDesignIQPrompt({ ..., atlasFlatMaster: true }))`. The caller passes it
   * rather than this module importing it, because this module has a runtime
   * twin that is byte-locked to it and the runtime has no `buildDesignIQPrompt`
   * of its own; the one place that can execute the deployed assembly is the
   * edge function, and that is where it is executed.
   */
  creativeHead?: string;
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

  // A.C.E. FIRST, ALWAYS. The creative half opens the prompt because it is the
  // design; the document contract follows because it is the packaging. The old
  // order had it the other way round with no persona at all.
  const head = pick(params.creativeHead);
  const out: string[] = [];
  if (head) out.push(head, "");
  out.push(SYSTEM_JOB, "", INSTALLATION_FACT, "");
  out.push(`VEHICLE: ${vehicle || "the vehicle named in the brief"}`);
  if (rows.length) {
    out.push("", "PANELS, at finished trim size, each printed with 5\" of bleed past every edge:",
      ...rows.map((row) => `  ${row}`));
    // THE FIGURES ARE COPIED FROM THE TEMPLATE, NEVER RECOMPUTED. Live sheet
    // 2026-09-18 put ROOF at 45.0" in Zone 1, 43.0" in Zone 2 and 43.0 x 56.0
    // in its own reference table, against a template that said 110.2 x 55.1 --
    // three different answers on one document, none of them the vehicle's.
    out.push("Print each figure under its own panel, identical in every zone and in the reference row.");
  }
  const coverage = panelProofCoverageSqFt(rows);
  if (coverage != null) {
    // AND THE TOTAL IS THIS JOB'S OWN ARITHMETIC. The live sheet printed
    // "176.26 sq ft" -- the figure off the attached reference sheet, which
    // belongs to a different vehicle and reproduces from none of the numbers
    // printed beside it.
    out.push(`TOTAL COVERAGE (TRIM): ${coverage.toFixed(2)} SQ FT in the header — take no figure from the example.`);
  }
  if (strings.length) {
    out.push("", "EXACT TEXT, character for character — invent no other words, numerals or web address:",
      ...strings.map(([label, value]) => `  ${label}: ${value}`));
  }
  const job: Array<[string, string]> = ([
    ["Date", pick(params.proofDate)],
    ["Order #", pick(params.orderNumber)],
    ["Designer", pick(params.designer)],
    ["Version", pick(params.proofVersion)],
  ] as Array<[string, string]>).filter(([, value]) => value.length > 0);
  if (job.length) {
    out.push("", "JOB BLOCK, in the header, exactly as given:",
      ...job.map(([label, value]) => `  ${label}: ${value}`));
  }
  out.push("", "THE THREE ZONES, in this order, each band titled exactly as written:",
    ...VERSIONS.map((v, i) => `  ${i + 1}. ${v.label}`),
    "Zone 2 is Zone 1 drawn as if it had never carried type. Zone 3 is the marks alone, cut outlines",
    "on empty ground.");
  // EVERY ZONE-3 BOX IS NAMED WITH WHAT FILLS IT. Three of five came back empty
  // under a rule that only said not to leave them empty.
  const supplied: Record<string, string> = {
    logo: "",
    tagline: pick(params.tagline) ? "the tagline above" : "",
    contact: [pick(params.phone), pick(params.website)].filter(Boolean).length
      ? "the phone and web address above, on one line" : "",
    promo: pick(params.promo) ? "the promotional text above" : "",
    icons: "",
  };
  out.push("", "ZONE 3'S FIVE BOXES, every one filled:",
    ...CUT_GRAPHIC_SLOTS.map((slot) => {
      return `  ${slot.caption}: ${supplied[slot.from] || slot.fallback}`;
    }));
  out.push("", SHEET_LAYOUT);
  out.push("",
    "ATTACHED: (1) the BLANK CONTAINER TEMPLATE to fill; (2) a FINISHED PROOF — THE STANDARD TO MATCH,",
    "its layout and the quality of its work, but another company's brand; (3) an INSTALLATION PHOTOGRAPH.");
  return out.join("\n");
}
