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
const WALL_DESIGNER =
      `You are an elite interior graphic designer for architectural printing. Your murals and wallcoverings are specified by architects and interior designers at $30-$150 per square foot installed — the level of Schumacher, Restoration Hardware and Williams Sonoma Home. You work at a real large-format print shop.

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
 * Persona 1, the consultant — ported from `supabase/functions/persona-csr-enrich`.
 * A fast text-only call that turns "blush florals" into a brief a designer can
 * execute without guessing. The vehicle stack has spent this call since it was
 * built, and it is why its designs are specific rather than generic.
 */
export function wallConsultantPrompt(input: { prompt: string; width: number; height: number; placement: string; repeatWidthIn?: number | null; intent?: WallIntent }) {
  const tile = input.placement === 'repeat';
  return `You are a senior interior designer and wallcovering consultant with fifteen years of specifying murals and printed wallcoverings for hotels, offices, retail and homes. You know what reads well at room scale, what prints, and what a client recognises as the thing they pictured.

A client has described what they want for one wall:
"${input.prompt.trim() || 'No brief given — propose the covering you would specify for this wall.'}"

The wall is ${input.width} inches wide by ${input.height} inches high.${tile && input.repeatWidthIn ? ` The design will print as a pattern repeating every ${input.repeatWidthIn} inches, about ${Math.max(1, Math.round(input.width / input.repeatWidthIn))} times across the wall.` : ' The design will print as one composition across the whole wall.'}

Enrich this into a brief a designer can execute. Respond in EXACTLY this JSON, no markdown and no code fences:

{
  "enrichedBrief": "Two or three sentences of specific direction: the subject and its treatment, the named colours, how the elements are arranged and how the composition flows. Specific enough to execute without guessing, and it must keep the client's own idea rather than replace it.",
  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4"],
  "designStyle": "One or two words for the energy, for example 'Botanical Editorial' or 'Quiet Industrial'"
}

Rules:
- The shorter the client's words, the MORE direction you add. Five words needs three full sentences of specifics.
- Three to five hex colours that work together on a wall, not a rainbow.
- Name real materials and treatments, never adjectives alone.
- Say what is LARGE and what is quiet: a wall needs a hierarchy, not an even field of motifs.
- Keep the client's core idea. Enhance it, do not replace it.`;
}

export function wallDesignPrompt(input: { prompt: string; width: number; height: number; placement: string; repeatWidthIn?: number | null; intent?: WallIntent; referencePath?: string | null; wallPath?: string | null; maskPath?: string | null }) {
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
    intent === 'match' ? '' : intent === 'wall' && !brief ? 'Design brief: design the wall covering you would specify for this room, chosen from its architecture, light and existing palette.' : 'Design brief: ' + brief,
    intent === 'match' ? '' : DESIGN_ANCHOR,
    'Generate the finished artwork image now. Return the image only, with no written explanation or design proposal.'
  ].filter(Boolean).join('\n\n');
}
