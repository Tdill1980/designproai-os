"use strict";
/**
 * runtime/atlas-panel-proof-contract.cjs — CALL 1 AS A FLAT PANEL PRODUCTION
 * PROOF (owner ruling, Trish 2026-09-18).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, verbatim: "Gemini image pro 3's newest model has no issues generating
 * text we need to rely on our custom design persona edge functions and Gemini's
 * own brain and test a flat panel production proof ... it must be fed a real
 * flat panel production proof and given the base prompt system engineering so
 * it knows its job on call 1 and has a clear example and done with thought
 * multi modal best practices."
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT ANOTHER PROMPT EDIT.
 *
 * Every documented Call-1 experiment in this repository changed THE ASK while
 * keeping the requested OBJECT the same: a bare six-rectangle artboard.
 * ATLAS-CALL1-GUIDE-ABLATION, -TOPOLOGY-TEXT, -OBJECT-CLAUSE, -OBJECT-MODEL,
 * -TEACHING-PROOF-ORDER, the field contracts, one-field. Measured outcome of
 * all of them: the model keeps drawing a LAYOUT DRAWING -- body panels die-cut
 * on a plain surround -- because that is what "the six panels of a vehicle
 * wrap, laid out flat" denotes in its training distribution.
 *
 * RULE 0.38's own canary table is the clearest statement of the trade: the
 * six-surface sheet "drew the best artwork of the four -- one cohesive
 * orange/blue wrap across all six surfaces, logo and name set properly on both
 * flanks -- but each panel die-cut to the truck's silhouette". The artwork was
 * right and the OBJECT was wrong, and we have been arguing with the object.
 *
 * So this contract asks for the object the model already draws well, and which
 * is also the artifact a print shop actually receives: a PANEL PRODUCTION
 * PROOF. Per-side panels, dimensioned, captioned, on a proof sheet.
 *
 * WHAT CHANGES DOWNSTREAM, STATED PLAINLY. A proof sheet is a DOCUMENT: white
 * ground, callouts, trim tables. `edgeHoleRatio`, `nonBlackFraction` and the
 * output-class inspector all judge the SHEET today and would convict a correct
 * proof instantly. Under this contract the gates must judge the EXTRACTED
 * PANEL REGIONS, not the sheet -- the panels are what print. That is a real
 * consequence, not a detail, and it is why this ships as a probe first.
 *
 * THREE VERSIONS IN ONE PASS, which is the owner's second instruction and the
 * part no compositor can reproduce:
 *
 *   V1  branded      full design, text + logo + photography
 *   V2  artwork only no text, no logo -- the clean base, cohesive by
 *                    construction because the same designer drew it
 *   V3  elements     logo + text only on a cut-proof strip, no vehicle
 *
 * v28 builds V2 and V3 mechanically and composites them, and the measured
 * result (34613569) is a slate slab at 1.95:1 contrast over mid-blue artwork,
 * clipped mid-word, in a vendored font that knows nothing about the design.
 * One designer producing all three is cohesive because it is one act.
 *
 * TEXT IS NO LONGER THE REASON FOR MECHANICAL TYPESETTING. The element graph's
 * justification was that a diffusion model cannot be trusted with a phone
 * number -- RestylePro measured exactly that (a proof sheet reading
 * 877-555-0000 / stanewerks.com against a hero reading 555-0142 /
 * cascadestoneworks.com). On gemini-3-pro-image that premise is what is being
 * retested here. The contract therefore states every literal string ONCE,
 * exactly, and says they are to be reproduced character for character -- the
 * same lock the edge's contact rules already apply.
 */

const PANEL_PROOF_CONTRACT = "designpro.atlas-panel-production-proof.v1";

/**
 * THE OWNER'S FORMAT SHEET, HASH-PINNED. "Must use this" (Trish 2026-09-18).
 *
 * The exact bytes she supplied: the Bright Smiles Dental three-version 2D
 * PRODUCTION PROOF, 1536x1024. It carries every block this contract names --
 * header job block, VERSION 1 dimensioned with measured lines, the ruled trim
 * table, TOTAL COVERAGE, VERSION 2 artwork-only, and the cut proof with each
 * element outlined on its own.
 *
 * Pinned the same way the Flamingo teaching proof is pinned, and for the same
 * reason: a teaching input that silently changes teaches something nobody
 * chose. Canary 33389124918 is what that costs -- an installed-vehicle proof
 * put wheel wells and template furniture back into the source rectangles, and
 * it took a request inspection to find out why. NEVER recreate, crop, relabel,
 * re-encode or "improve" this file. Replacing it is an owner decision and the
 * hash changes with it.
 *
 * It is a FORMAT reference and nothing else. It was produced by ChatGPT, not by
 * this pipeline and not by Gemini, so it says nothing about what our model will
 * draw -- it says what the document should look like. Its artwork, palette,
 * brand and typography are not style authority (RULE 0.24).
 */
const PANEL_PROOF_FORMAT_EXAMPLE = Object.freeze({
  path: "atlas-examples/panel-production-proof-three-version.png",
  sha256: "57c07672f644a9b3a38783807fd1cf67fbdf21829905e01d8b7afed042e315db",
  byteSize: 1793915,
  width: 1536,
  height: 1024,
});

/**
 * THE SYSTEM-LEVEL JOB STATEMENT. Multimodal best practice: state the ROLE and
 * the ARTIFACT before any content, so the model's object class is fixed before
 * it reads a single design word.
 *
 * Deliberately short. CLAUDE.md's standing measurement is that creative
 * conditioning loses to format text when the two compete for the same budget
 * (the v19 parity recovery: 465 characters of proven creative direction
 * deleted, four releases of refusal language added on top).
 */
const SYSTEM_JOB = [
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
 * HOW A SIDE IS ACTUALLY WRAPPED, which is why a panel is one rectangle.
 *
 * This is the Avery Dennison / Wrap Institute fact RULE 0.32 is built on,
 * stated to the model as the physical reason rather than as a prohibition. A
 * positive physical fact conditions better than "do not draw wheel arches",
 * which is the negative shape this file warns about in four places and which
 * has failed 4/4 on the field map.
 */
const INSTALLATION_FACT = [
  "One side of a vehicle is wrapped with ONE CONTINUOUS PANEL. The installer lays that whole printed",
  "rectangle onto the side and trims the wheel openings, handles and glass afterwards, with a blade,",
  "on the vehicle. So the printed panel has no holes and no vehicle-shaped outline: it is a solid",
  "rectangle of artwork, and the artwork continues straight through the places those openings will be.",
].join("\n");

/**
 * THE SHEET'S LAYOUT, STATED IN WORDS — NEVER AS COORDINATES.
 *
 * Owner ruling 2026-09-18: the template is a system-level constant, so every
 * customer's proof "looks like it came from the same professional print shop
 * line" and the downstream croppers always know where to look.
 *
 * It is described in PROSE, and the numbers live in PROOF_REGIONS below where
 * the model never sees them. That split is not fussiness: `atlasFieldContract`
 * emitted its layout as bare four-decimal rows and FOUR consecutive live runs
 * PAINTED those digits onto the customer's flanks (455b1723, 7c7bd633,
 * cc382c3c, 8c525565 -- one of them through Topaz onto 150-PPI print panels).
 * The `map_drawn` gate exists because of it. Prose describing a document's own
 * sections has never produced that failure; a coordinate table has, 4/4.
 */
const SHEET_LAYOUT = [
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
 * The same layout as rectangles, for CODE ONLY — the extractor, the gates and
 * PanelPro. Never rendered into the prompt.
 *
 * APPROXIMATE, and deliberately labelled so. They are read off the owner's
 * reference sheet's proportions and are accurate to a percent or two; they are
 * good enough to find a block and NOT good enough to cut a print panel from.
 * Calibrate against a real returned sheet before anything binds to them.
 *
 * This is what makes the gates workable under this contract. `edgeHoleRatio`,
 * `nonBlackFraction` and the output-class inspector all judge the WHOLE sheet
 * today, and a correct proof is a white document -- they would convict it
 * instantly. Under a fixed template they judge the panel cells instead.
 */
const PROOF_REGIONS = Object.freeze({
  header: Object.freeze({ x: 0, y: 0, w: 1, h: 0.093 }),
  version1: Object.freeze({ x: 0, y: 0.105, w: 1, h: 0.42 }),
  trimTable: Object.freeze({ x: 0.655, y: 0.37, w: 0.2, h: 0.14 }),
  totalCoverage: Object.freeze({ x: 0.865, y: 0.37, w: 0.125, h: 0.1 }),
  version2: Object.freeze({ x: 0, y: 0.54, w: 0.5, h: 0.35 }),
  cutProof: Object.freeze({ x: 0.5, y: 0.54, w: 0.5, h: 0.35 }),
  footer: Object.freeze({ x: 0, y: 0.905, w: 1, h: 0.095 }),
});

/** The three artifacts, in one pass, by one designer. */
const VERSIONS = Object.freeze([
  Object.freeze({
    key: "branded",
    label: "VERSION 1 — FULL DESIGN (WITH TEXT & LOGO)",
    instruction: "every panel carrying the finished design: artwork, logo, company name and contact line.",
  }),
  Object.freeze({
    key: "artwork",
    label: "VERSION 2 — ARTWORK ONLY (NO TEXT OR LOGO)",
    instruction:
      "the SAME panels with every word, numeral and logo removed and the artwork continued through where they sat. "
      + "Not erased or blanked -- drawn as the design would be if it had never carried type. This is the "
      + "installer's reference sheet.",
  }),
  Object.freeze({
    key: "elements",
    label: "VERSION 3 — LOGO + TEXT ONLY (CUT PROOF)",
    instruction:
      "the logo, company name and contact line alone, drawn as standalone vector cut outlines on a plain empty "
      + "ground -- no vehicle, no panels and no background artwork. This is the sheet a plotter cuts.",
  }),
]);

/**
 * Every literal string stated ONCE, to be reproduced character for character.
 *
 * TAGLINE, SERVICES AND PROMOTIONAL TEXT ARE LITERALS TOO. A commercial wrap
 * carries more words than a phone number, and a string the contract does not
 * state is a string the model invents -- which is the exact failure the element
 * graph was built to prevent (RestylePro measured a proof reading 877-555-0000
 * against a hero reading 555-0142). The owner's own Prius brief carries a
 * tagline and service lines, so leaving them out of the exact block would
 * retest the premise on only half the lettering.
 */
function exactStrings(input = {}) {
  const pick = (v) => String(v == null ? "" : v).trim();
  const list = (v) => (Array.isArray(v) ? v.map(pick).filter(Boolean).join(", ") : pick(v));
  return [
    ["Company name", pick(input.companyName || input.businessName)],
    ["Tagline", pick(input.tagline)],
    ["Phone", pick(input.phone)],
    ["Web address", pick(input.website)],
    ["Services", list(input.services)],
    ["Promotional text", pick(input.promo || input.promotionalText)],
  ].filter(([, value]) => value);
}

/**
 * Per-surface panel table, from the GENIE manifest.
 *
 * INCHES, NOT NORMALIZED FRACTIONS. RULE 0.33 removed the `[0,1]` topology
 * table from Call 1 on measured evidence, and the field contract's bare
 * four-decimal rows are what four consecutive runs PAINTED onto the artwork
 * (`map_drawn`). Real trim inches are what a proof legitimately carries and
 * what the example sheet shows, so they read as the document's own content
 * rather than as coordinates to transcribe.
 */
function panelTable(manifest = {}) {
  const zones = Array.isArray(manifest.zones) ? manifest.zones : [];
  return zones
    .map((zone) => {
      const trim = zone?.trimInches || zone?.trim || {};
      const w = Number(trim.widthIn ?? trim.w);
      const h = Number(trim.heightIn ?? trim.h);
      const name = String(zone?.surfaceKey || "").toUpperCase();
      if (!name || !Number.isFinite(w) || !Number.isFinite(h)) return null;
      return `${name}: ${w}" wide x ${h}" high`;
    })
    .filter(Boolean);
}

function buildPanelProofPrompt({ input = {}, manifest = {}, creativeDirection = "" } = {}) {
  const strings = exactStrings(input);
  const table = panelTable(manifest);
  const vehicle = [input?.vehicle?.year, input?.vehicle?.make, input?.vehicle?.model]
    .map((v) => String(v || "").trim()).filter(Boolean).join(" ");

  const out = [SYSTEM_JOB, "", INSTALLATION_FACT, ""];

  out.push(`VEHICLE: ${vehicle || "the vehicle named in the brief"}`);
  if (table.length) {
    // TRIM SIZE, with the bleed stated as the owner's own spec sheet states it.
    // A production proof legitimately carries a bleed callout, and these panels
    // ARE cut at trim + 5 inches -- so the number is the document's own content,
    // not a coordinate to transcribe (the map_drawn distinction, RULE 0.33).
    out.push("", "PANELS ON THIS PROOF, at their finished trim size, each printed with a",
      "5-inch bleed of artwork continuing past every edge:", ...table.map((row) => `  ${row}`));
  }

  out.push("", "THE DESIGN:", `"${String(creativeDirection || input.brief || "").trim()}"`);

  if (strings.length) {
    out.push("", "EXACT TEXT — reproduce each of these character for character. Invent no other words,",
      "no other numerals, no other address or web address anywhere on the proof:",
      ...strings.map(([label, value]) => `  ${label}: ${value}`));
  }

  const pick = (v) => String(v == null ? "" : v).trim();
  const job = [
    ["Date", pick(input.proofDate)],
    ["Order #", pick(input.orderNumber)],
    ["Designer", pick(input.designer)],
    ["Version", pick(input.proofVersion)],
  ].filter(([, value]) => value);
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

module.exports = {
  PANEL_PROOF_CONTRACT,
  PANEL_PROOF_FORMAT_EXAMPLE,
  SYSTEM_JOB,
  INSTALLATION_FACT,
  SHEET_LAYOUT,
  PROOF_REGIONS,
  VERSIONS,
  exactStrings,
  panelTable,
  buildPanelProofPrompt,
};
