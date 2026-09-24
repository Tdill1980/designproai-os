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
 * THE OWNER'S FORMAT SHEET, HASH-PINNED. "Must use this" (Trish 2026-09-18);
 * "It's supposed to use the production panel proof for Ridgeline Pools"
 * (2026-09-21).
 *
 * The RIDGELINE CUSTOM POOLS 2024 Ford F-250 Crew Cab 2D PRODUCTION PROOF,
 * 1536x1024: header with ORDER #, DESIGNER, VERSION and TOTAL COVERAGE, then
 * the three full-width ZONE bands the product is named for --
 *   ZONE 1  FULL DESIGN PANELS (photo + design + text + logo), 6 panels
 *   ZONE 2  BACKGROUNDS ONLY (no text or logo), matching Zone 1 exactly
 *   ZONE 3  CUT GRAPHICS (logo, text and icons only), vector, no background
 * -- each panel dimensioned in inches with its trim size and 5" bleed, then the
 * PANEL DIMENSIONS REFERENCE row, TEMPLATE NOTES and the GUIDE legend.
 *
 * It replaced the Bright Smiles Dental 2012 Prius sheet, which taught the same
 * structure from a different job. Pinned exactly as the Flamingo teaching proof
 * is pinned, for the same reason: a teaching input that silently changes
 * teaches something nobody chose (canary 33389124918). NEVER recreate, crop,
 * relabel or re-encode it.
 *
 * ⚠️ THE HASH PIN IS WHAT MAKES "USE THIS SHEET" TRUE. Swapping the sheet means
 * changing this constant AND `byteSize` together, and seeding the object at the
 * path above; it does not mean deleting the check. Without it any object that
 * happens to sit at that path becomes the format authority, which is exactly
 * how a sheet nobody chose ends up teaching Call 1. The bytes are versioned at
 * `runtime/atlas-examples/ridgeline-panel-proof-gold.png` so the pin is
 * reproducible from the checkout alone.
 *
 * SIX PANELS, REAR AS ONE PIECE -- matching `SURFACE_KEYS` exactly. The first
 * Ridgeline sheet drew seven (rear split plus a rear bumper), which maps onto no
 * canonical surface; #592 corrected it and this pins the corrected bytes.
 *
 * IT IS THE STANDARD, NOT JUST THE GRID (owner correction, 2026-09-18). The
 * layout AND the quality of the work on it are the bar -- finish, type, the
 * depth of the artwork. One carve-out, about ownership rather than style: the
 * identity on the sheet is Ridgeline Custom Pools', and a customer's proof
 * carries only the strings in their own request.
 */
export const PANEL_PROOF_FORMAT_EXAMPLE = {
  path: "atlas-examples/ridgeline-panel-proof-gold.png",
  sha256: "e53f39a371205b61ade688a8a7ed7494cfa9fea7541be4bcf64bc844b4b1bafa",
  byteSize: 1894054,
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
  "THE DELIVERABLE IS A PRODUCTION PANEL PROOF: ONE sheet, three bands, in exactly the form of the",
  "attached finished proof. Everything on it is flat design artwork — the file a wrap-shop graphic",
  "designer builds. The print files are cut from the top band afterwards.",
  "",
  "DRAW ONLY THE PANELS. Every caption, figure, note and rule around them is printed onto this",
  "sheet by the press afterwards. Every part of the sheet outside the panels stays plain white.",
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
  // EITHER PERSONA IS A HEAD: the commercial sign-and-wrap-company designer or
  // the restyle Lead Vehicle Wrap Designer (owner, 2026-09-22: "the persona
  // based design instruction for commercial and restyle"). Neither present and
  // the proof has no designer at all, which is the defect this exists to end.
  // RecreatePro uses the EXISTING reproduction specialist, not the inventor.
  // Admit that exact identity only with its explicit bounded recreation task;
  // an arbitrary prompt still cannot masquerade as an executed designer.
  const recreationHead = /^You are a vehicle wrap REPRODUCTION specialist at WePrintWraps\.com\./.test(head)
    && /\n\nRECREATION TASK \(applies to the supplied artwork\):\nRecreatePro \/ (exact|complete|transfer)\./.test(head);
  if (!/^(?:You are (?:the |a )?senior (?:professional )?graphic designer and vehicle-wrap specialist|You are WePrintWraps\.com Lead Vehicle Wrap Designer)\b/.test(head) && !recreationHead) {
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
  "One side is wrapped with ONE CONTINUOUS PANEL: the installer lays that whole printed rectangle on",
  "and trims the wheel openings, handles and glass afterwards, with a blade, on the vehicle. So every",
  "panel here is a SOLID RECTANGLE of artwork — four straight edges, four square corners — and",
  "the artwork runs straight through the places those openings will be. Type and logos stay clear of the",
  "trim line; the artwork runs past it — filling its cell corner to corner, out past the frame line on",
  "all four sides.",
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
  "Fill the attached template exactly as it is drawn. Each band holds those six panels in the",
  "template's own cells, in that order, each drawn ONCE, and every box on the sheet carries its art.",
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
    label: "ZONE 2 — BACKGROUNDS ONLY (THE ARTWORK ALONE)",
    instruction: "the same six panels with the artwork alone, background to every edge.",
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
// ⚠️ A SLOT FALLBACK MAY NAME A SLOT. IT MAY NEVER NAME A LOGO FORM.
//
// `fallback` used to read "the logo mark alone, without the wordmark", and that
// single clause was the only form direction anywhere in the request -- which
// made it the strongest. Live sheet 7a72951823648d27 (Ironclad Roofing, 2019
// Transit): a shield crest with an "I" monogram, repeated on all six panels,
// because Zone 3 must agree with Zone 1 and Zone 3 had been told the logo is
// something OTHER than the name.
//
// `designiq-assembly.ts` refuses to prescribe a form on purpose, and says so at
// length: every version that named one converged (custom lettering gave three
// trades one lockup; a menu of "pictorial, monogram, abstract symbol or badge"
// was the same pressure in different clothes). LOGO_REQUIREMENT is one sentence
// -- "decide its form from this brief alone" -- and this file then overrode it
// from downstream. A prescription the persona deliberately withheld must not be
// reintroduced by the document contract.
//
// So both brand slots LIFT rather than specify. Zone 3 is a cut sheet of the
// design's own marks; it is not a second brief.
//
/**
 * THE CONTACT SLOT NAMED A PHONE THE FORM NEVER SUPPLIED (2026-09-22).
 *
 * The slot read "the phone and web address above, on one line" whenever EITHER
 * was present. On the live New Aura run the brief carried a website and no
 * phone, so Zone 3 was told to cut a phone line that exists nowhere in the
 * request -- an invitation to invent a number, which is exactly what the
 * exact-text rule exists to prevent. It now names only what the form supplied.
 */
function contactNames(phone: string, website: string): string {
  const names = [phone ? "phone" : "", website ? "web address" : ""].filter(Boolean);
  return names.length ? `the ${names.join(" and ")} above, on one line` : "";
}

export const CUT_GRAPHIC_SLOTS = [
  { caption: "PRIMARY LOGO", from: "logo", fallback: "this design's own logo, exactly as drawn on the panels" },
  { caption: "TAGLINE / SLOGAN", from: "tagline", fallback: "the company name exactly as set on the panels" },
  { caption: "CONTACT LINE", from: "contact", fallback: "the company name set as one cut line, in the design's own lettering" },
  { caption: "PROMOTIONAL TEXT", from: "promo", fallback: "a line of the design's own lettering, lifted from the panels exactly as set" },
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

/**
 * THE SAME ASK, SPLIT INTO THE TWO TURNS OF ONE CONVERSATION.
 *
 * Owner, 2026-09-21: "do the multitodal thought signatures", after "Like a real
 * graphic designer creates a cohesive design. design each element seperatley,
 * then put togetehr".
 *
 * WHY A SECOND TURN AND NOT A LONGER PROMPT. Live sheet 7a72951823648d27 sent
 * ONE user turn carrying 5,106 characters and four images, of which roughly
 * three lines were the design and forty-five were the document. The model had
 * to invent a wrap AND decompose it into clean backgrounds AND decompose it
 * into cut graphics AND lay eighteen cells out, in one pass, with the creative
 * references and the structural references in the same undifferentiated bag.
 * Google's own guidance names both halves of that: "iterate and refine" (the
 * documented multi-turn example generates an infographic, then revises it) and
 * reference images that carry ROLES. We were doing neither.
 *
 * TURN 1 IS THE DESIGN. Persona, brief, the exact strings, the six panel
 * shapes, and the physical fact that a panel is a solid rectangle -- all
 * properties of the ARTWORK. Its attachments are the CREATIVE class: the
 * customer's own references and the gold-standard artboards. The word
 * "document", the three bands and the container never appear, so nothing
 * competes with designing.
 *
 * TURN 2 IS THE LAYOUT, and it is a continuation rather than a new request:
 * turn 1's user turn and the model's reply are replayed with the reply's
 * thoughtSignature intact on the part it arrived on, exactly as
 * `gemini-image-history.mjs` already does for the hero cascade. So turn 2 does
 * not re-invent the wrap -- it has it in the conversation and decomposes it.
 * Its attachments are the STRUCTURAL class: the container template and the
 * pinned format sheet. RULE 0.24's three classes stop sharing one bag.
 *
 * THE HONEST COST: two image requests instead of one, so roughly double the
 * ~40 s authoring leg. That is the trade, and it is not hidden -- the receipt
 * reports `imageRequestCount` and both turns' prompts.
 *
 * `buildPanelProofPrompt` below is UNCHANGED and still assembles the
 * single-turn ask byte for byte. Neither is derived from the other, so
 * `panelProofTurnsCoverTheSinglePrompt` in the contract test asserts the two
 * turns still carry every section the one prompt does.
 */
export function buildPanelProofTurns(params: PanelProofParams): { design: string; layout: string } {
  const pick = (v: unknown) => String(v == null ? "" : v).trim();
  const list = (v: unknown) => (Array.isArray(v) ? v.map(pick).filter(Boolean).join(", ") : pick(v));
  const head = pick(params.creativeHead);
  const vehicle = [params.vehicleYear, params.vehicleMake, params.vehicleModel]
    .map(pick).filter(Boolean).join(" ");
  const rows = (params.panelRows || []).filter((row) => pick(row).length > 0);
  const strings: Array<[string, string]> = ([
    ["Company name", pick(params.companyName)],
    ["Tagline", pick(params.tagline)],
    ["Phone", pick(params.phone)],
    ["Web address", pick(params.website)],
    ["Services", list(params.services)],
    ["Promotional text", pick(params.promo)],
  ] as Array<[string, string]>)
    .filter(([, value]) => value.length > 0)
    .filter(([label]) => !(head && ["Company name", "Phone", "Web address"].includes(label)));

  const design: string[] = [];
  if (head) design.push(head, "");
  else design.push(`VEHICLE: ${vehicle || "the vehicle named in the brief"}`, "");
  design.push(INSTALLATION_FACT);
  if (rows.length) {
    design.push("", "THE SIX PANELS, left to right, each drawn at this shape:",
      ...rows.map((row) => `  ${row}`));
  }
  if (strings.length) {
    design.push("", "EXACT TEXT, character for character — every word, numeral and web address on the wrap is here, in one drawn letterform:",
      ...strings.map(([label, value]) => `  ${label}: ${value}`));
  }
  // The turn-1 ask, stated last so it is the instruction the model leaves with.
  // It names the six panels and nothing about a document.
  design.push("", "Draw those six panels of finished wrap artwork, one cohesive design across all of them,",
    "each panel filled corner to corner. Nothing else on the canvas.");

  const layout: string[] = [
    "Keep that exact design — every colour, motif, photograph, logo and line of type as you just drew it.",
    "Now lay it out as the production proof document.",
    "",
    SYSTEM_JOB,
    "",
    "THE THREE BANDS, in this order:",
    ...VERSIONS.map((v, i) => `  ${i + 1}. ${v.label}`),
  ];
  const supplied: Record<string, string> = {
    logo: "",
    tagline: pick(params.tagline) ? "the tagline above" : "",
    contact: contactNames(pick(params.phone), pick(params.website)),
    promo: pick(params.promo) ? "the promotional text above" : "",
    icons: "",
  };
  layout.push("", "ZONE 3'S FIVE BOXES, every one filled:",
    ...CUT_GRAPHIC_SLOTS.map((slot) => `  ${slot.caption}: ${supplied[slot.from] || slot.fallback}`));
  layout.push("", SHEET_LAYOUT);
  layout.push("",
    "ATTACHED NOW: (1) the BLANK CONTAINER TEMPLATE — it is drawn for THIS vehicle, so every panel's",
    "shape and position comes from it; (2) a FINISHED PROOF — the standard for the QUALITY of the",
    "work, on a different vehicle for another company's brand: match its craft and draw this brief's",
    "own shapes. Every shape on this sheet belongs to this design.");
  return { design: design.join("\n"), layout: layout.join("\n") };
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
  ] as Array<[string, string]>)
    .filter(([, value]) => value.length > 0)
    // A.C.E. ALREADY STATES THESE THREE AS EXACT, in stronger words than these.
    .filter(([label]) => !(pick(params.creativeHead)
      && ["Company name", "Phone", "Web address"].includes(label)));

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
  if (!head) out.push(`VEHICLE: ${vehicle || "the vehicle named in the brief"}`);
  if (rows.length) {
    out.push("", "THE SIX PANELS, left to right, each drawn at this shape:",
      ...rows.map((row) => `  ${row}`));
  }
  // THE COVERAGE TOTAL AND THE JOB BLOCK USED TO BE ASKED FOR HERE. They are
  // header furniture, so the compositor draws both from this same manifest --
  // `panelProofCoverageSqFt` stays exported because the edge reports the figure
  // on its receipt. Asking the model for a number it is told not to draw is
  // noise in a prompt whose budget is the design's.
  // ⛔ "IN ONE DRAWN LETTERING FAMILY" IS THE CUSTOM-LOGO-FONT RULE (owner,
  // Trish 2026-09-23: "must be a custom logo font"). Live on New Aura Day Spa
  // (7748e5d7): "NewAuraDaySpa" came back set in a stock book face on both
  // flanks and again in the Zone 3 cut graphics.
  //
  // THREE CONSTRAINTS SHAPED IT INTO SIX WORDS ON AN EXISTING LINE, and each
  // one was a lock convicting a longer draft:
  //   1. NOT in `LOGO_REQUIREMENT`. That shared constant also feeds the field
  //      and six-surface assemblies, whose prompts are byte-pinned to what the
  //      owner approved and what is deployed; `atlas-one-field-call1` convicted
  //      that by exactly the 150 characters of the first attempt.
  //   2. POSITIVE. The document contract speaks only in the positive
  //      (2026-09-22) and that lock convicts "rather than", which the second
  //      draft used.
  //   3. THE BUDGET IS FULL. The contract is capped at 2700 chars and sat at
  //      2668; two new lines took it to 2788. The ceiling is not raised to fit
  //      a sentence -- CLAUDE.md's own rule is that prompt length is the
  //      quality killer and every word earns its place. So the rule rides the
  //      line that already introduces the strings, for 23 characters -- "in one drawn letterform", after the first
  //      wording came in ONE character over.
  //
  // It names a PROPERTY (drawn, one family) and never a FORM. Naming a form is
  // what converged three unrelated trades on one centred badge in July and got
  // the old mandate deleted; this cannot, because it describes no shape.
  if (strings.length) {
    out.push("", "EXACT TEXT, character for character — every word, numeral and web address on the wrap is here, in one drawn letterform:",
      ...strings.map(([label, value]) => `  ${label}: ${value}`));
  }
  // THE SMALL-PANELS LINE IS GONE (owner, 2026-09-22: "Ace creates a logo
  // font, uses that throughout"). It told the designer that hood, front and
  // rear "carry the logo and ONE line at most, set LARGE" — a composition rule
  // written by code, standing between the persona and its own judgement, and
  // it capped every small panel at a logo plus a slogan. The lettering-size
  // failure it was written for (live 35404195565) is a pixel-budget fact of the
  // six-across sheet, not a reason to compose the design from here. What the
  // designer places on each panel is the designer's call.

  out.push("", "THE THREE BANDS, in this order:",
    ...VERSIONS.map((v, i) => `  ${i + 1}. ${v.label}`));
  // EVERY ZONE-3 BOX IS NAMED WITH WHAT FILLS IT. Three of five came back empty
  // under a rule that only said not to leave them empty.
  const supplied: Record<string, string> = {
    logo: "",
    tagline: pick(params.tagline) ? "the tagline above" : "",
    contact: contactNames(pick(params.phone), pick(params.website)),
    promo: pick(params.promo) ? "the promotional text above" : "",
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
    "work, on a different vehicle for another company's brand: match its craft and draw this brief's",
    "own shapes. Every shape on this sheet belongs to this design.");
  return out.join("\n");
}
