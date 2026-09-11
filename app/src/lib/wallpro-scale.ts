// WallPro's scale brain. The customer types the wall size; nobody should have
// to know what a repeat is. Owner, 2026-09-11, after a mural came off the
// printer with three-foot flowers: "If someone is entering in dimensions
// WallPro should use its brain and know how to scale."
//
// Deterministic and local (no model call decides this): the brief's words and
// the wall's inches pick tile-versus-mural and the tile's real-world width.
// The generator is then told that width so motifs are drawn at the size they
// print; production tiles the master at exactly that width.

export type WallPlacement = 'cover' | 'contain' | 'repeat';
export type WallScaleIntent = 'prompt' | 'match' | 'wall';
export type WallScaleDecision = { placement: WallPlacement; repeatWidthIn: number; reason: string };

/** Words that mean "a covering that repeats", the way wallpaper does. */
const PATTERN_WORDS = /\b(pattern|patterns|wallpaper|repeat|repeating|seamless|tile|tiles|tiled|floral|florals|flowers|botanical|botanicals|leaves|foliage|geometric|geometrics|stripe|stripes|striped|dots?|polka|damask|paisley|chevron|herringbone|lattice|trellis|plaid|check|checks|checkered|texture|textures|textured|grain|wood|woodgrain|slat|slats|slatted|stone|marble|brick|concrete|plaster|linen|weave|woven|grasscloth|terrazzo|mosaic|shiplap|tropical|palm|palms|fern|ferns)\b/i;
/** Words that mean one composition sized to the wall. */
const MURAL_WORDS = /\b(mural|murals|scene|scenery|landscape|skyline|cityscape|sunset|sunrise|mountain|mountains|ocean|beach|forest|map|logo|logos|brand|branding|wordmark|typography|lettering|quote|quotes|slogan|tagline|manifesto|mission|values|portrait|photo|photograph|illustration|artwork|painting|collage|timeline|wayfinding|donor)\b/i;

/** The tile width the wall wants: about four repeats across, on the 6-inch
 * steps wallpaper is sold in, never smaller than 18 nor wider than 48. A 96-inch
 * wall gets 24, a 142-inch wall 36, a 240-inch wall 48. */
export function autoRepeatWidthIn(wallWidthIn: number): number {
  if (!Number.isFinite(wallWidthIn) || wallWidthIn <= 0) return 24;
  const raw = wallWidthIn / 4;
  return Math.min(48, Math.max(18, Math.round(raw / 6) * 6));
}

/**
 * Tile or mural, and how wide the tile prints, from the brief and the wall.
 *  match   the reference is a covering (wallpaper, a slat wall, a stone wall):
 *          a repeat unless the brief says mural.
 *  wall    design for the room: a repeat unless the brief names a mural subject.
 *  prompt  the brief decides; a brief that names neither is a mural on a wall
 *          under 8 ft and a repeat on a wider one, where a single 4K
 *          composition would blow every motif up past life size.
 * A customer's explicit choice (`chosen`) always wins.
 */
export function autoWallScale(input: { intent: WallScaleIntent; prompt: string; wallWidthIn: number; chosen?: WallPlacement | null }): WallScaleDecision {
  const repeatWidthIn = autoRepeatWidthIn(input.wallWidthIn);
  if (input.chosen) return { placement: input.chosen, repeatWidthIn, reason: input.chosen === 'repeat' ? `Repeating pattern, as chosen, at ${repeatWidthIn}″ for a ${input.wallWidthIn}″ wall.` : 'Mural, as chosen: one composition sized to the wall.' };
  const brief = input.prompt || '';
  const saysMural = MURAL_WORDS.test(brief), saysPattern = PATTERN_WORDS.test(brief);
  const repeat = (why: string) => ({ placement: 'repeat' as const, repeatWidthIn, reason: `${why} Repeating at ${repeatWidthIn}″ across a ${input.wallWidthIn}″ wall so motifs print at real size.` });
  const mural = (why: string) => ({ placement: 'cover' as const, repeatWidthIn, reason: `${why} One composition sized to the ${input.wallWidthIn}″ wall.` });
  if (input.intent === 'match') return saysMural && !saysPattern ? mural('The brief asks for a mural.') : repeat('A matched design is a covering.');
  if (saysPattern && !saysMural) return repeat('The brief describes a pattern.');
  if (saysMural && !saysPattern) return mural('The brief describes a mural.');
  if (input.intent === 'wall') return repeat('Designing for the room.');
  return input.wallWidthIn > 96 ? repeat('A wall this wide would blow a single composition up past life size.') : mural('A wall this size holds one composition.');
}
