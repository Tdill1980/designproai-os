// Creative identity and translation ported from RestylePro generate-wall-design v116.
// Physical placement is deterministic after authoring; no vehicle prompts are modified.
const DESIGNER_IDENTITY =
      `You are the senior creative director at a premium sign & graphics company that builds install-ready wall murals, environmental branding, and printed vinyl wraps for luxury and commercial interiors — boutique hotels, corporate lobbies and offices, flagship retail, fine dining, bars, malls, fitness clubs and gyms, modern apartments and homes, schools and universities, and lifestyle spaces. Your work is what interior designers and architects spec at $30–$150 per square foot installed — the aesthetic of Williams Sonoma Home, Restoration Hardware, and Schumacher wallpaper. Every design is built with tangible depth and texture: dimensional shading, tactile surface detail (paper grain, brush stroke, stone, woven fiber, metallic leaf, ink bleed), layered hierarchy, and refined color harmony. Nothing flat or clip-art — the viewer should be able to feel the paper, the pigment, and the hand of the designer.`;

const CAPABILITIES =
      `Your output spans the full range a premium sign & graphics shop delivers: large-format murals and wallpaper; environmental branding (company logos, brand marks, tagline walls, mission statements, values walls, donor walls, wayfinding); typography-driven designs (custom letterforms, hand-lettered headlines, editorial display type, manifesto walls); mixed media (typography layered with graphic forms, illustration, photography, or pattern); and refined decorative art (botanical, abstract, geometric, architectural). When the brief calls for text or branding, render clean, crisp, production-ready letterforms — vector-sharp, correctly spelled, no gibberish or AI scribble. When the brief does not call for text, omit it entirely — no spurious captions, labels, borders, or watermarks.`;

const DESIGN_TRANSLATION =
      `Translate the brief into refined design geometry: "botanical" → oversized dimensional florals with painterly shading and negative space; "industrial" → layered concrete, brushed metal, and architectural linework; "abstract" → sculptural color fields with intentional gesture; "geometric" → precise repeating modules with depth and shadow; "luxury" → deep jewel tones, brass or gold accents, marble and velvet textures; "minimalist" → bold negative space, one hero element, restrained palette; "lifestyle/sports" → dynamic motion, layered graphic forms; "typography/branding" → bold editorial headline type with hierarchy, optional supporting marks or iconography; references like "art deco" or "mid-century" translate into period-accurate pattern vocabulary, not literal copies.`;

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
    DESIGNER_IDENTITY,
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
export function wallMatchRecoveryPrompt(input: { prompt: string; width: number; height: number; placement: string; repeatWidthIn?: number | null; referencePath?: string | null; wallPath?: string | null }) {
  const brief = 'An original wall covering with exactly the material, pattern, motif scale, colour, grain and texture of the reference image, drawn fresh as flat straight-on artwork at real-world scale: not a copy of the photograph, and nothing of the room around it (no furniture, window, drapes, floor, lighting or perspective).'
    + (input.prompt.trim() ? ' ' + input.prompt.trim() : '');
  return wallDesignPrompt({ ...input, intent: 'prompt', prompt: brief });
}

export function wallDesignPrompt(input: { prompt: string; width: number; height: number; placement: string; repeatWidthIn?: number | null; intent?: WallIntent; referencePath?: string | null; wallPath?: string | null; maskPath?: string | null }) {
  const intent: WallIntent = input.intent || 'prompt';
  if (intent === 'refine') return wallRefinePrompt(input);
  const brief = input.prompt.trim();
  const tile = input.placement === 'repeat';
  return [
    DESIGNER_IDENTITY, CAPABILITIES,
    'Deliver one continuous flat 2D artwork image, edge to edge. This is the mural artwork before installation, not a room photograph or a photographed wall. Fine texture and crisp detail at 4K.',
    'Wall size: ' + input.width + ' inches wide by ' + input.height + ' inches high.',
    // 59 inches is the roll width (WALLPRO_PRINT_WIDTH in the app; owner, 2026-09-11).
    'Printing uses panels up to 59 inches wide. Keep the artwork continuous across print seams; do not draw panel divisions, seam lines or print marks into the image.',
    // Scale is stated in inches so motifs are drawn at the size they print
    // (owner, 2026-09-11, after a mural printed with three-foot flowers).
    tile ? `Create one square seamless repeating tile. Opposite edges must join; motifs must continue cleanly across every boundary. Output one tile, not a room full of repeats.${input.repeatWidthIn ? ` This tile prints exactly ${input.repeatWidthIn} inches wide on the wall and repeats about ${Math.max(1, Math.round(input.width / input.repeatWidthIn))} times across it: draw every motif at the physical size it will be seen at in the room (a bloom or a leaf a few inches across, a slat or a stripe at its real width), never one motif filling the tile.` : ''}`
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
    intent === 'match' ? '' : DESIGN_TRANSLATION,
    'Generate the finished artwork image now. Return the image only, with no written explanation or design proposal.'
  ].filter(Boolean).join('\n\n');
}
