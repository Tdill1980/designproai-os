// Creative identity and translation ported from RestylePro generate-wall-design v116.
// Physical placement is deterministic after authoring; no vehicle prompts are modified.
/**
 * The wall designer, built on the PROVEN vehicle stack (RULE 1).
 * Reference: `supabase/functions/_shared/persona-designer-prompt.ts`, whose
 * own header states the rule this file had broken —
 *   "IMPORTANT: Prompt length = quality killer. Keep under 4K chars total.
 *    Every word must earn its place."
 * Measured 2026-09-12, on the owner's report that "design gen is horrendous":
 * the assembled wall prompt was 4,501 characters, of which 3,342 were generic
 * persona boilerplate and 44 were the customer's actual brief. The persona
 * outweighed the design 76 to 1, so every wall came back as the average of the
 * persona rather than the customer's idea.
 *
 * The vehicle stack solves this with TWO personas, not a longer one: a
 * consultant turns the customer's words into a specific brief (colours, flow,
 * elements), and the designer prompt stays short because the brief carries the
 * content. WallPro now does the same — `wallConsultantPrompt` below.
 */
// Owner correction (2026-09-12): "elite interior graphic designer" anchored to
// Schumacher / Restoration Hardware / Williams Sonoma Home biased every design
// toward tasteful luxury wallcovering, regardless of the actual brief — a
// literal request (a specific subject, a specific scene) kept coming back as
// generic botanical-editorial decor, because the persona's identity, not the
// customer's words, was driving the composition. The fix is the identity
// itself: environmental graphics and large-format wrap design, not wallpaper
// styling, so a literal commercial concept reads as the job, not a deviation
// from a "luxury interior" brief.
const WALL_DESIGNER =
      `You are a Senior Environmental Graphic Designer and Large-Format Wrap Designer working inside a commercial sign company and interior design studio. You produce custom wall murals, branded interiors, and environmental graphics for salons, spas, retail, hospitality, offices and feature walls — architectural finishes at large-format print scale. Your job is literal execution of the client's actual concept: the exact subject, the exact required elements, at commercial quality — not a generic "look" for the industry named.

COMPOSE AT ROOM SCALE. The viewer stands six to twelve feet back and reads the wall whole: a few large forms, generous negative space, hierarchy before detail, three to five values plus one accent. Every element carries tangible material — paper grain, brush stroke, ink bleed, leaf, stone, woven fibre — with dimensional shading and layered depth. Nothing flat, nothing clip-art, and nothing that would look at home on a quilt, a greeting card or a phone case.

Render text only when the brief asks for it, and then vector-sharp and correctly spelled. Otherwise no captions, labels, borders or watermarks.`;

/** What the designer says before the image, ported from the vehicle designer's
 * DESIGN ANCHOR: it names the design and fixes its colours and placement in
 * words, so a refinement has something exact to hold onto. */
const DESIGN_ANCHOR =
      `Before the image, output: 1) a design name, 2 to 4 words; 2) DESIGN ANCHOR — three sentences fixing the palette with hex values, the placement and scale of each major element, and the direction the composition flows.`;

/** The four customer entry paths, as the generator understands them.
 *  prompt  describe a design; the optional reference is style inspiration.
 *  match   the reference IS the design: reproduce it faithfully as a clean
 *          print-ready master, applying only the requested changes.
 *  wall    design for this specific wall photograph; the brief is optional.
 * Every intent outputs the same thing: flat artwork, edge to edge, at 4K. */
export type WallIntent = 'prompt' | 'match' | 'wall' | 'refine';
export const WALL_INTENTS: readonly WallIntent[] = ['prompt', 'match', 'wall', 'refine'];

/** refine: the customer's current version is the first image; produce the
 * next version by applying ONLY the requested change. Composition, motif
 * placement and scale, palette, style, framing and edges are preserved unless
 * the change names them. With a mask, only the white region may change; the
 * page additionally restores the black region pixel-for-pixel from the parent,
 * so preservation outside the mask is deterministic, not a model promise. */
export function wallRefinePrompt(input: { prompt: string; placement: string; maskPath?: string | null; referencePath?: string | null }) {
  const tile = input.placement === 'repeat';
  return [
    WALL_DESIGNER,
    'The first image is the customer\'s current wall design. Produce the NEXT VERSION of this same design by applying only the change requested below. Everything the change does not name stays exactly as it is: composition, motif placement and scale, palette, rendering style, framing, edges and overall character. This is an edit of the existing artwork, not a new design.',
    'Requested change: ' + input.prompt.trim(),
    input.maskPath ? 'A mask image follows the design: only the WHITE region of the mask may change. The BLACK region must remain identical to the current design.' : '',
    input.referencePath ? 'A reference image follows for the requested change, for example a colour or object to match. Use it only for that change.' : '',
    'Output one continuous flat 2D artwork image, edge to edge, at the same framing and aspect as the current design, at full 4K detail. Not a room photograph, no mockup, no borders, no captions.',
    tile ? 'The design is a seamless repeating tile: keep opposite edges joining exactly as before.' : 'Keep the artwork continuous across print seams; do not draw panel divisions or print marks.',
    'Return the image only, with no written explanation.'
  ].filter(Boolean).join('\n\n');
}

/** The one retry after IMAGE_RECITATION on a match. The model declines to
 * reproduce a reference it recognises as a published photograph (a stock
 * photo of a slat wall, measured 3/3 on 2026-09-11), so the retry asks for an
 * ORIGINAL covering in the reference's material through the style-inspiration
 * path instead of a copy. Same request, same credit, one retry only. */
export function wallMatchRecoveryPrompt(input: { prompt: string; width: number; height: number; placement: string; repeatWidthIn?: number | null; referencePath?: string | null; wallPath?: string | null; description?: string | null }) {
  // With a description the retry carries NO photograph: measured 2026-09-11
  // 19:36, a retry that still attached the customer's own photo was refused
  // again, so the filter matches the image, not the words.
  const described = (input.description || '').trim();
  const brief = (described
    ? `An original wall covering matching this description of the customer's reference: "${described}". Drawn fresh as flat straight-on artwork at real-world scale; not a copy of any photograph, and nothing of a room around it (no furniture, window, drapes, floor, lighting or perspective).`
    : 'An original wall covering with exactly the material, pattern, motif scale, colour, grain and texture of the reference image, drawn fresh as flat straight-on artwork at real-world scale: not a copy of the photograph, and nothing of the room around it (no furniture, window, drapes, floor, lighting or perspective).')
    + (input.prompt.trim() ? ' ' + input.prompt.trim() : '');
  return wallDesignPrompt({ ...input, intent: 'prompt', prompt: brief, referencePath: described ? null : input.referencePath, wallPath: described ? null : input.wallPath });
}

/** What the fast text model is asked about the reference before a
 * words-only retry: the covering, never the room. */
export const COVERING_DESCRIPTION_PROMPT = 'Describe the wall covering or wall surface material in this photograph for a designer who cannot see it: the material, the pattern or motif, the colours, the real-world size of the repeating element in inches (for example slat width and gap, tile size, motif size), the finish and the texture. Two to four plain sentences. Say nothing about the room, furniture, windows or lighting.';

/**
 * The Design Contract Persona 1 produces. This replaces the old loose
 * {enrichedBrief, colorPalette, designStyle} shape (owner correction,
 * 2026-09-12): prose the designer was "free to reinterpret" is how a literal
 * request — a specific subject, a specific scene — kept coming back as generic
 * category art ("spa" -> quiet botanical mural). A typed contract separates
 * what the customer actually specified (immutable, must appear) from what is
 * genuinely open for the designer to compose (everything the contract leaves
 * blank), so Persona 2 receives binding requirements, not reinterpretable prose.
 */
export interface WallDesignContract {
  customerIntent: string;
  requiredSubjects: string[];
  requiredElements: string[];
  requiredColors: string[];
  businessContext: string;
  designObjective: string;
  compositionDirection: string;
  focalHierarchy: string;
  negativeSpaceZones: string;
  realismLevel: string;
  typography: string | null;
  logoTreatment: string | null;
  mustPreserve: string[];
  forbiddenInventions: string[];
}

/**
 * Persona 1, the consultant — ported from `supabase/functions/persona-csr-enrich`.
 * A fast text-only call that turns "blush florals" into a brief a designer can
 * execute without guessing. The vehicle stack has spent this call since it was
 * built, and it is why its designs are specific rather than generic.
 *
 * Runs as a BRIEF COMPILER, not a creative stage: its job is extraction and
 * preservation of what the customer actually said, and classification of
 * business context — never invention of a different subject. See the lowered
 * temperature at the call site (handler.ts) for the other half of this.
 */
export function wallConsultantPrompt(input: { prompt: string; width: number; height: number; placement: string; repeatWidthIn?: number | null; intent?: WallIntent }) {
  const tile = input.placement === 'repeat';
  return `You are a design brief compiler for a commercial environmental-graphics and large-format wrap studio. Your job is EXTRACTION and PRESERVATION, not creative invention: read exactly what the client asked for, classify it, and state what is missing — never substitute a generic idea for what they actually said.

A client has described what they want for one wall:
"${input.prompt.trim() || 'No brief given — propose the covering you would specify for this wall.'}"

The wall is ${input.width} inches wide by ${input.height} inches high.${tile && input.repeatWidthIn ? ` The design will print as a pattern repeating every ${input.repeatWidthIn} inches, about ${Math.max(1, Math.round(input.width / input.repeatWidthIn))} times across the wall.` : ' The design will print as one composition across the whole wall.'}

If the brief names or clearly implies a business or space type, use commercial interior/signage knowledge to improve composition, hierarchy, material treatment and usability. Never substitute generic industry imagery for a subject or concept supplied by the customer — a named industry informs HOW the client's own subject is composed and finished, it never replaces that subject with a stock idea of what that industry "usually" looks like.

Respond in EXACTLY this JSON, no markdown and no code fences:

{
  "customerIntent": "One sentence: what the client is actually asking for, in their own terms.",
  "requiredSubjects": ["Every literal subject, scene or figure the client named or clearly implied — empty array if none."],
  "requiredElements": ["Every specific motif, object or material the client named — empty array if none."],
  "requiredColors": ["Every colour the client named, as plain words — empty array if none."],
  "businessContext": "The named or implied business/space type, or empty string if none.",
  "designObjective": "One phrase: what this wall is for, e.g. 'custom commercial wall mural'.",
  "compositionDirection": "One or two sentences: how the required subjects/elements should be arranged and what should read first, second, third.",
  "focalHierarchy": "One sentence: what is LARGE and dominant versus what is quiet and secondary.",
  "negativeSpaceZones": "One sentence: where the composition should stay open/quiet.",
  "realismLevel": "One or two words, e.g. 'editorial realism', 'flat illustration', 'photoreal'.",
  "typography": "Any text the client asked to include, verbatim, or null.",
  "logoTreatment": "Any logo/brand treatment the client asked for, or null.",
  "mustPreserve": ["A short restatement of every requiredSubject/requiredElement/requiredColor — the exact things a review must find in the finished design."],
  "forbiddenInventions": ["Specific things the designer must NOT add — additional people, generic industry props (spa equipment, gym gear, restaurant tableware) unless requested, stock luxury accents, unrequested text — tailored to what would be an obvious deviation from THIS client's request."]
}

Rules:
- requiredSubjects/requiredElements/requiredColors/mustPreserve are IMMUTABLE: every specific the client actually gave must appear in them exactly, never softened, generalised or dropped.
- Only businessContext, designObjective, compositionDirection, focalHierarchy, negativeSpaceZones and realismLevel are yours to fill in from professional knowledge — and only where the client left them unsaid.
- A named business or space type is knowledge for HOW to execute the client's own subject, never permission to invent a different one.
- If the client's brief is generic (no literal subject named), it is correct for requiredSubjects to be empty and for compositionDirection to carry your own professional judgement.`;
}

/**
 * Turns the Design Contract into the binding-requirements block Persona 2
 * receives. Framed as REQUIRED/FORBIDDEN, not as prose to reinterpret — the
 * contract's immutable fields are stated as must-appear facts, and only the
 * open fields (composition, hierarchy, negative space, realism) are handed
 * over as direction the designer composes with.
 */
export function contractDirective(contract: WallDesignContract): string {
  const list = (items: string[]) => items.filter(Boolean).map((i) => `  - ${i}`).join('\n');
  const lines: string[] = [];
  lines.push('BINDING DESIGN REQUIREMENTS — these are facts about this specific job, not suggestions:');
  lines.push(`Client intent: ${contract.customerIntent}`);
  if (contract.requiredSubjects.length) lines.push(`REQUIRED SUBJECTS (must appear, exactly as stated):\n${list(contract.requiredSubjects)}`);
  if (contract.requiredElements.length) lines.push(`REQUIRED ELEMENTS (must appear):\n${list(contract.requiredElements)}`);
  if (contract.requiredColors.length) lines.push(`REQUIRED COLORS (must appear):\n${list(contract.requiredColors)}`);
  if (contract.businessContext) lines.push(`Business context (informs execution, not the subject): ${contract.businessContext}`);
  lines.push(`Design objective: ${contract.designObjective}`);
  lines.push(`Composition direction: ${contract.compositionDirection}`);
  lines.push(`Focal hierarchy: ${contract.focalHierarchy}`);
  lines.push(`Negative space: ${contract.negativeSpaceZones}`);
  lines.push(`Realism level: ${contract.realismLevel}`);
  if (contract.typography) lines.push(`Text to include, verbatim: ${contract.typography}`);
  if (contract.logoTreatment) lines.push(`Logo/brand treatment: ${contract.logoTreatment}`);
  if (contract.mustPreserve.length) lines.push(`MUST PRESERVE — the finished design must clearly contain every one of these:\n${list(contract.mustPreserve)}`);
  if (contract.forbiddenInventions.length) lines.push(`FORBIDDEN — do not add any of the following:\n${list(contract.forbiddenInventions)}`);
  return lines.join('\n');
}

export function wallDesignPrompt(input: { prompt: string; width: number; height: number; placement: string; repeatWidthIn?: number | null; intent?: WallIntent; referencePath?: string | null; wallPath?: string | null; maskPath?: string | null; contract?: WallDesignContract | null }) {
  const intent: WallIntent = input.intent || 'prompt';
  if (intent === 'refine') return wallRefinePrompt(input);
  const brief = input.prompt.trim();
  const tile = input.placement === 'repeat';
  return [
    WALL_DESIGNER,
    'Deliver one continuous flat 2D artwork image, edge to edge. This is the mural artwork before installation, not a room photograph or a photographed wall. Fine texture and crisp detail at 4K.',
    'Wall size: ' + input.width + ' inches wide by ' + input.height + ' inches high.',
    // 54 inches is the roll width: Avery HP MPI 2610 wall vinyl, billed at 54 in
    // per panel regardless of printed width (owner spec sheet, 2026-09-12).
    'Printing uses panels up to 54 inches wide. Keep the artwork continuous across print seams; do not draw panel divisions, seam lines or print marks into the image.',
    // Scale is stated in inches so motifs are drawn at the size they print
    // (owner, 2026-09-11, after a mural printed with three-foot flowers).
    // THE REFERENCE SETS THE SCALE on a match (owner, 2026-09-12, looking at a
    // matched tropical mural whose motifs came back a quarter of their size:
    // "it looks like crap, not matched, and the pattern is too small — there
    // should be a baseline"). The generic tile sentence below tells the model
    // to draw "a bloom a few inches across", which directly contradicts
    // reproducing the reference faithfully. A match never receives it.
    intent === 'match'
      ? (tile
        ? `Create one square seamless repeating tile${input.repeatWidthIn ? ` that prints ${input.repeatWidthIn} inches wide on the wall and repeats about ${Math.max(1, Math.round(input.width / input.repeatWidthIn))} times across it` : ''}. Opposite edges must join and motifs must continue cleanly across every boundary. Hold the reference's own motif scale: reproduce its composition at the size the reference shows it, filling this tile with the same number of elements it has, not with many smaller copies of them.`
        : `Reproduce the reference as one continuous covering for a wall ${input.width} inches wide by ${input.height} inches high. The reference is the scale baseline: every leaf, bloom, slat, stripe or tile lands at the size it appears in the reference. Do not shrink the design into many small repeats and do not blow one element up past the wall.`)
      : tile ? `Create one square seamless repeating tile. Opposite edges must join; motifs must continue cleanly across every boundary. Output one tile, not a room full of repeats.${input.repeatWidthIn ? ` This tile prints ${input.repeatWidthIn} inches wide on the wall and repeats about ${Math.max(1, Math.round(input.width / input.repeatWidthIn))} times across it, so compose it at architectural scale: a few large, confident forms with real negative space between them — a hero bloom or frond ${Math.max(6, Math.round(input.repeatWidthIn / 4))} to ${Math.max(10, Math.round(input.repeatWidthIn / 2))} inches across, drawn with the detail of a hand-painted panel. Do not fill the tile with many small motifs, do not make a busy all-over craft print, and do not let one motif fill the whole tile edge to edge.` : ''}`
      : `Compose one complete mural in the requested aspect ratio. Keep important text and logos clear of the edges. The mural prints at ${input.width} by ${input.height} inches: scale every element to that real size, so a wall this large carries many elements at true scale rather than two or three blown past life size, unless the brief asks for one hero element.`,
    input.wallPath ? (intent === 'wall'
      ? 'The wall photograph is the space this artwork is for. Read its architecture, light, existing colours and furnishings so the design belongs in that room, but output flat artwork only: do not reproduce the room, floor, furniture, windows, drapes or perspective in the image. Wall placement is performed separately.'
      : 'The wall photograph is architectural context only. Do not reproduce the room, floor, furniture, windows or perspective in the output artwork. Wall placement is performed separately.') : '',
    input.referencePath ? (intent === 'match'
      ? 'The labeled reference image IS the design. Reproduce it faithfully as a clean print-ready master: the same composition, motifs, motif scale, palette, rendering style and mood, redrawn at full 4K detail with every edge filled. Do not reinterpret it, do not add new elements, do not change its character.'
        // A customer photographs the wall they want reproduced (a slat wall,
        // a stone feature wall, an existing wallpaper) as often as they upload
        // flat artwork. The covering is the design; the room around it is not.
        + ' If the reference is a photograph of a room or of an installed wall, the design is the WALL COVERING in it: reproduce only that surface\'s material, pattern, colour, grain and texture as flat straight-on artwork at real-world scale, and leave out the room itself: furniture, window, drapes, floor, ceiling, lighting, shadows, shelves and objects, and any perspective.'
        + (tile ? ' Make it a true seamless tile while keeping the motif scale.' : '') + (brief ? ' Apply only these requested changes: ' + brief : ' No changes were requested.')
      : 'The labeled reference image is style inspiration or an existing wall design. Use its visual direction to create flat artwork following the brief. Do not recreate its surrounding room.') : '',
    // The contract's binding requirements REPLACE the plain-text brief line
    // when Persona 1 produced one: it is a strict superset (subjects,
    // elements, colours, hierarchy, forbidden inventions) of what a single
    // sentence conveyed, and stating both would leave the model to decide
    // which one to trust.
    intent === 'match' ? '' : input.contract ? contractDirective(input.contract)
      : intent === 'wall' && !brief ? 'Design brief: design the wall covering you would specify for this room, chosen from its architecture, light and existing palette.' : 'Design brief: ' + brief,
    intent === 'match' ? '' : DESIGN_ANCHOR,
    'Generate the finished artwork image now. Return the image only, with no written explanation or design proposal.'
  ].filter(Boolean).join('\n\n');
}

/**
 * Post-generation creative compliance check (advisory, logged — not wired to
 * block generation or production yet; see docs/wallpro/
 * WALLPRO-GENIE-UI-INTEGRATION-PLAN.md and the owner's own scoping: the next
 * change is prompt.ts/handler.ts, not the production pipeline).
 *
 * Asks the fast vision model to compare the finished image against the exact
 * Design Contract it was supposed to satisfy, so a literal-subject failure
 * (the required subject silently dropped, a forbidden invention added) is
 * measured rather than assumed from a pretty render.
 */
export function wallComplianceCheckPrompt(contract: WallDesignContract): string {
  const list = (items: string[]) => items.length ? items.map((i) => `"${i}"`).join(', ') : '(none specified)';
  return `You are reviewing a finished wall mural design against the exact requirements it was commissioned against. Look only at the attached image.

Required subjects that must be visibly present: ${list(contract.requiredSubjects)}
Required elements that must be visibly present: ${list(contract.requiredElements)}
Required colors that must be visibly present: ${list(contract.requiredColors)}
Business context this was designed for: ${contract.businessContext || '(none specified)'}
Things that must NOT have been added: ${list(contract.forbiddenInventions)}

Respond in EXACTLY this JSON, no markdown and no code fences:

{
  "compliant": true or false,
  "missingSubjects": ["any required subject not visibly present"],
  "missingElements": ["any required element not visibly present"],
  "missingColors": ["any required color not visibly present"],
  "forbiddenFound": ["any forbidden item that was added anyway"],
  "businessContextSurvived": true or false,
  "notes": "One sentence on anything else material."
}

"compliant" is true only if every required subject, element and colour is visibly present, no forbidden item was added, and the design would read as suitable for the stated business context. Be literal: a required subject that is absent, or replaced with something generic, makes this non-compliant even if the image is well made.`;
}
