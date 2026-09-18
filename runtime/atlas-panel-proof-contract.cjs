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
 * The exact bytes she supplied: the Bright Smiles Dental 2012 Toyota Prius 2D
 * PRODUCTION PROOF, 1536x1024. It carries every block this contract names --
 * header job block and TOTAL COVERAGE, then three full-width ZONE bands (full
 * design panels dimensioned with measured lines / backgrounds only / cut
 * graphics), then the PANEL DIMENSIONS REFERENCE row, TEMPLATE NOTES and GUIDE
 * legend, then the footer.
 *
 * IT IS THE FILLED TWIN OF THE CONTAINER TEMPLATE, and that is why it replaced
 * the sheet pinned earlier the same day. That first one
 * (`panel-production-proof-three-version.png`, 57c07672...) is a TWO-COLUMN
 * layout: VERSION 1 across the upper half, a ruled trim table and TOTAL
 * COVERAGE beside the smaller panels, VERSION 2 lower left, the cut proof lower
 * right. The container template is three zone bands. Pinning both would have
 * attached two contradictory structures and told the model one was the other
 * drawn empty -- a sentence that was simply false. The superseded file stays on
 * disk unpinned, because owner-supplied reference bytes are not mine to delete.
 *
 * Pinned the same way the Flamingo teaching proof is pinned, and for the same
 * reason: a teaching input that silently changes teaches something nobody
 * chose. Canary 33389124918 is what that costs -- an installed-vehicle proof
 * put wheel wells and template furniture back into the source rectangles, and
 * it took a request inspection to find out why. NEVER recreate, crop, relabel,
 * re-encode or "improve" this file. Replacing it is an owner decision and the
 * hash changes with it.
 *
 * IT IS THE STANDARD, NOT JUST THE GRID (owner correction, 2026-09-18). An
 * earlier revision of this comment called it "a FORMAT reference and nothing
 * else ... not style authority". The owner said no, and she is right about her
 * own product: the layout AND the quality of the work on it are the bar -- the
 * finish, the confidence of the type, the depth of the artwork, the
 * professionalism of the document. A proof that copies the grid and misses the
 * craft has missed the point of pinning it.
 *
 * ONE CARVE-OUT, and it is about ownership rather than style: the identity on
 * this sheet belongs to Bright Smiles Dental. A customer's proof carries the
 * name, tagline, logo and contact strings in their own request and no others,
 * which the EXACT TEXT block already states. Nothing else here is off limits.
 *
 * (It was produced by ChatGPT, so it is a target rather than a demonstration of
 * what this model will draw. That is what the probe measures.)
 */
const PANEL_PROOF_FORMAT_EXAMPLE = Object.freeze({
  path: "atlas-examples/panel-proof-zones-filled.png",
  sha256: "9586710b026e22b3b2c5f80379382b31a211852c7c5128d10d0d356a0534d108",
  byteSize: 1870997,
  width: 1536,
  height: 1024,
});

/**
 * THE BLANK CONTAINER TEMPLATE — the SECOND system-level attachment.
 *
 * Owner ruling, Trish 2026-09-18: "This is just the container template edge
 * function that needs in system instruction along with the version that has
 * graphics" / "produce a blank container template for system". So the request
 * carries BOTH: the empty structure and a finished example of it.
 *
 * DRAWN BY CODE (`runtime/atlas-proof-container-template.cjs`), not generated.
 * A generated container comes back slightly different every time, and the
 * owner's own generated one read "2012 TOYOTA PRIORS" and "5 BLEON ON ALL FOUR
 * EDGES" -- a teaching input with a typo in it teaches the typo. sharp + SVG:
 * same manifest in, byte-identical sheet out, no glyph the code did not place.
 *
 * NOT A BLANK CANVAS, deliberately. RULE 0.33 removed a blank neutral guide
 * from Call 1 on measured evidence ("a blank canvas handed to an image model
 * reads as content to interpret"). This is the opposite object: every region is
 * captioned, banded and dimensioned, so it reads as a DOCUMENT WITH EMPTY
 * FIELDS. It is also RULE 0.27 applied to the teaching input -- the code owns
 * the geometry, the A.I. owns the design.
 *
 * 3:2 at 1536x1024, identical to the filled reference and to the request's own
 * aspectRatio, so all three agree and nothing has to be re-flowed.
 */
const PANEL_PROOF_CONTAINER_TEMPLATE = Object.freeze({
  // NO path, sha256 or byteSize. Those described one fixed Prius render and
  // became a lie the moment the container went per-vehicle: the caller stages
  // its own under atlas-call1-inputs/<sha256>.png and names it in the request.
  // A constant that still advertises a stale path is how a later reader wires
  // the wrong object with complete confidence.
  contract: "designpro.atlas-proof-container-template.v1",
  width: 1536,
  height: 1024,
});

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
const SYSTEM_JOB = [
  "THE DELIVERABLE IS THE ARTWORK FOR A VEHICLE WRAP PANEL PRODUCTION PROOF: the printed panels",
  "themselves, laid out in three bands on a clean white sheet.",
  "",
  "DRAW ONLY THE PANELS. Every caption, figure, note and rule around them is printed onto this",
  "sheet by the press afterwards. Leave every part of the sheet that is not a panel plain white.",
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
const ACE_OUTPUT_TAIL_MARKER = "\nOUTPUT FORMAT — ONE FLAT A.T.L.A.S. ARTBOARD";

function panelProofCreativeHead(aceAssembly) {
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
 * HOW A SIDE IS ACTUALLY WRAPPED, which is why a panel is one rectangle.
 *
 * This is the Avery Dennison / Wrap Institute fact RULE 0.32 is built on,
 * stated to the model as the physical reason rather than as a prohibition. A
 * positive physical fact conditions better than "do not draw wheel arches",
 * which is the negative shape this file warns about in four places and which
 * has failed 4/4 on the field map.
 */
const INSTALLATION_FACT = [
  "One side is wrapped with ONE CONTINUOUS PANEL: the installer lays that whole printed rectangle on",
  "and trims the wheel openings, handles and glass afterwards, with a blade, on the vehicle. So every",
  "panel here is a SOLID RECTANGLE of artwork with no holes and no vehicle-shaped outline, and the",
  "artwork runs straight through the places those openings will be. Type and logos stay clear of the",
  "trim line; the artwork does not.",
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
  "Fill the attached template; do not re-flow it. Each band holds those six panels in the template's",
  "own cells, in that order, each drawn ONCE — never repeated, never a seventh, never an empty box.",
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
  header: Object.freeze({ x: 0, y: 0, w: 1, h: 0.094 }),
  zone1: Object.freeze({ x: 0, y: 0.105, w: 1, h: 0.258 }),
  zone2: Object.freeze({ x: 0, y: 0.363, w: 1, h: 0.270 }),
  zone3: Object.freeze({ x: 0, y: 0.633, w: 1, h: 0.174 }),
  reference: Object.freeze({ x: 0, y: 0.807, w: 1, h: 0.105 }),
  footer: Object.freeze({ x: 0, y: 0.912, w: 1, h: 0.088 }),
});

/** The three artifacts, in one pass, by one designer. */
const VERSIONS = Object.freeze([
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
const CUT_GRAPHIC_SLOTS = [
  { caption: "PRIMARY LOGO", from: "logo", fallback: "the logo mark alone, without the wordmark" },
  { caption: "TAGLINE / SLOGAN", from: "tagline", fallback: "the company name set as a one-line wordmark" },
  { caption: "CONTACT LINE", from: "contact", fallback: "the web address alone" },
  { caption: "PROMOTIONAL TEXT", from: "promo", fallback: "the services line set as one cut strip" },
  { caption: "ICONS / SERVICE GRAPHICS", from: "icons", fallback: "the design's own motifs drawn as plain cut shapes" },
];

/** Trim square footage from THIS request's own panel rows. Never copied. */
function panelProofCoverageSqFt(panelRows) {
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

function buildPanelProofPrompt({ input = {}, manifest = {}, creativeDirection = "", creativeHead = "" } = {}) {
  const pick = (v) => String(v == null ? "" : v).trim();
  const strings = exactStrings(input)
    // A.C.E. ALREADY STATES THESE THREE AS EXACT, in stronger words than these
    // ("display this EXACT number, digit for digit"). What it does NOT carry is
    // the tagline, the service list and the promotional line, so those are the
    // only ones this block needs to add.
    .filter(([label]) => !(String(creativeHead || "").trim() && ["Company name", "Phone", "Web address"].includes(label)));
  const table = panelTable(manifest);
  const vehicle = [input?.vehicle?.year, input?.vehicle?.make, input?.vehicle?.model]
    .map(pick).filter(Boolean).join(" ");

  // A.C.E. FIRST, ALWAYS. The creative half opens the prompt because it is the
  // design; the document contract follows because it is the packaging. This
  // used to open with a designer persona of my own and carry none of the real
  // one -- measured on the live sheet at zero characters of A.C.E.
  const head = pick(creativeHead);
  const out = [];
  if (head) out.push(head, "");
  out.push(SYSTEM_JOB, "", INSTALLATION_FACT, "");

  if (!head) out.push(`VEHICLE: ${vehicle || "the vehicle named in the brief"}`);
  if (table.length) {
    // TRIM SIZE, with the bleed stated as the owner's own spec sheet states it.
    // A production proof legitimately carries a bleed callout, and these panels
    // ARE cut at trim + 5 inches -- so the number is the document's own content,
    // not a coordinate to transcribe (the map_drawn distinction, RULE 0.33).
    out.push("", "THE SIX PANELS, left to right, each drawn at this shape:",
      ...table.map((row) => `  ${row}`));
  }

  // THE COVERAGE TOTAL AND THE JOB BLOCK USED TO BE ASKED FOR HERE. They are
  // header furniture, so the compositor draws both from this same manifest --
  // `panelProofCoverageSqFt` stays exported because the edge reports the figure
  // on its receipt. Asking the model for a number it is told not to draw is
  // noise in a prompt whose budget is the design's.

  if (strings.length) {
    out.push("", "EXACT TEXT, character for character — invent no other words, numerals or web address:",
      ...strings.map(([label, value]) => `  ${label}: ${value}`));
  }

  out.push("", "THE THREE BANDS, in this order:",
    ...VERSIONS.map((v, i) => `  ${i + 1}. ${v.label}`),
    "Zone 2 is Zone 1 drawn as if it had never carried type.");

  // EVERY ZONE-3 BOX IS NAMED WITH WHAT FILLS IT. Three of five came back empty
  // under a rule that only said not to leave them empty.
  const supplied = {
    logo: "",
    tagline: pick(input.tagline) ? "the tagline above" : "",
    contact: [pick(input.phone), pick(input.website)].filter(Boolean).length
      ? "the phone and web address above, on one line" : "",
    promo: pick(input.promo) ? "the promotional text above" : "",
    icons: "",
  };
  out.push("", "ZONE 3'S FIVE BOXES, every one filled:",
    ...CUT_GRAPHIC_SLOTS.map((slot) => {
      return `  ${slot.caption}: ${supplied[slot.from] || slot.fallback}`;
    }));

  out.push("", SHEET_LAYOUT);

  out.push("",
    "ATTACHED: (1) the BLANK CONTAINER TEMPLATE — it is drawn for THIS vehicle, so every panel's",
    "shape and position comes from it; (2) a FINISHED PROOF — the standard for the QUALITY of the",
    "work, on a different vehicle and another company's brand, so take no shape or figure from it.",
    "Every panel on both is a plain rectangle of artwork; the only shapes are Zone 3's cut graphics.");

  return out.join("\n");
}

module.exports = {
  PANEL_PROOF_CONTRACT,
  PANEL_PROOF_FORMAT_EXAMPLE,
  PANEL_PROOF_CONTAINER_TEMPLATE,
  SYSTEM_JOB,
  INSTALLATION_FACT,
  SHEET_LAYOUT,
  PROOF_REGIONS,
  VERSIONS,
  exactStrings,
  panelTable,
  buildPanelProofPrompt,
  ACE_OUTPUT_TAIL_MARKER,
  panelProofCreativeHead,
  CUT_GRAPHIC_SLOTS,
  panelProofCoverageSqFt,
};
