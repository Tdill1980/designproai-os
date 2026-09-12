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
/** An explicit request for a repeating tile, as opposed to a word that merely
 * describes what the reference is made of. "Slatted", "floral" and "stone"
 * name a material; "repeating", "seamless" and "tile" ask for a repeat. On a
 * match the difference decides whether the customer's own reference keeps its
 * scale, so the two lists stay separate (owner, 2026-09-12). */
const REPEAT_REQUEST_WORDS = /\b(repeat|repeats|repeating|repeated|seamless|tile|tiles|tiled|tiling|wallpaper)\b/i;
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
 * The baseline for a design uploaded to match: it repeats about TWICE across
 * the wall, which is how a decorative wallpaper mural is actually hung.
 *
 * Measured from the owner's own installed wall, 2026-09-12 ("this is the size
 * pattern, see the difference"): against a 74-inch sofa and a 26-inch shelf,
 * the anthurium blooms print about 10 inches, which puts that design's full
 * repeat at roughly 74 to 87 inches on a 142-inch wall. One-across (142") is
 * about twice life size; the generic four-across (36") is about half. Two
 * across lands inside the measured band, and the pattern-size slider covers
 * the rest of it — 110% of 72 is 79 inches.
 *
 * Kept on the same 6-inch steps as `autoRepeatWidthIn`, never under 4 feet
 * nor over 8.
 */
export function autoMatchRepeatWidthIn(wallWidthIn: number): number {
  if (!Number.isFinite(wallWidthIn) || wallWidthIn <= 0) return 72;
  return Math.min(96, Math.max(48, Math.round(wallWidthIn / 2 / 6) * 6));
}

export type PatternSize = { placement: WallPlacement; repeatWidthIn: number };
export type WallBox = { width: number; height: number; aspect: number };

/**
 * PATTERN SCALE, exactly as RestylePro's PatternPro had it (owner, 2026-09-12:
 * "Look at PatternPro, we literally had this"): the design is the swatch, and a
 * 30 to 300 percent slider draws that swatch bigger or smaller on the surface,
 * repeated. `WrapByTheYardMode.tsx` previews it as `background-size: 100/scale%`
 * with `background-repeat: repeat`; WallPro does the same thing in inches so
 * the preview, the on-wall view and the print file are one geometry.
 *
 * The panels do not change. The 59-inch panels are the roll; what changes is
 * how big the design is drawn across them. Deterministic: the same master,
 * re-tiled at a new width; no regeneration, no token.
 *
 * At 100 percent the design is exactly as generated (a tile at its generated
 * width, a mural filling the wall). A mural is one swatch the size of the wall,
 * so 50 percent draws it half size and repeats it, and 200 percent draws it at
 * twice the wall and shows the middle, the way PatternPro's preview crops an
 * oversized swatch.
 */
export const PATTERN_SCALE_MIN = 30;
export const PATTERN_SCALE_MAX = 300;
export const PATTERN_SCALE_STEP = 10;

/** Snap a slider value onto the 10-percent steps inside 30 to 300. */
export function clampPatternScale(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  const snapped = Math.round(percent / PATTERN_SCALE_STEP) * PATTERN_SCALE_STEP;
  return Math.min(PATTERN_SCALE_MAX, Math.max(PATTERN_SCALE_MIN, snapped));
}

/** The swatch width at 100 percent: a tile's generated width, or for a mural
 * the width it covers the wall at (wider than the wall when the wall is taller
 * than the master's proportions). */
export function patternBaseWidthIn(base: PatternSize, wall: WallBox): number {
  if (base.placement === 'repeat') return base.repeatWidthIn;
  const coverWidth = Math.max(wall.width, wall.height * wall.aspect);
  return base.placement === 'cover' ? coverWidth : Math.min(wall.width, wall.height * wall.aspect);
}

/** The placement and swatch width that draw the design at `percent`. */
export function patternSizeAtScale(base: PatternSize, wall: WallBox, percent: number): PatternSize {
  const pct = clampPatternScale(percent);
  if (pct === 100) return { placement: base.placement, repeatWidthIn: base.repeatWidthIn };
  const width = patternBaseWidthIn(base, wall) * (pct / 100);
  return { placement: 'repeat', repeatWidthIn: Math.max(1, Math.round(width * 10) / 10) };
}

/** PatternPro's words for the slider position. */
export function patternScaleWord(percent: number): string {
  const s = percent / 100;
  return s < 0.6 ? 'Micro' : s < 0.8 ? 'Small' : s < 1.2 ? 'Standard' : s < 2 ? 'Large' : s < 2.5 ? 'Bold' : 'Extreme';
}

/** One tap per word, so the slider is not the only way to get there. */
export const PATTERN_SCALE_PRESETS = [50, 70, 100, 150, 220, 300] as const;

/** How wide the design is drawn on the wall, in inches, at this percentage.
 * The same number for a tile and for a mural, which is why one slider governs
 * both: a mural is simply a swatch the size of the wall. */
export function patternDrawnWidthIn(base: PatternSize, wall: WallBox, percent: number): number {
  return patternBaseWidthIn(base, wall) * (clampPatternScale(percent) / 100);
}

/**
 * The real resolution the design prints at, in pixels per inch: the master's
 * own pixels spread over the inches it is drawn across. Enlarging a design
 * does not add detail, so this falls as the slider rises — the one honest
 * limit on "bigger". Print size never changes with it; only sharpness does.
 */
export function patternPpi(masterPx: { width: number; height: number }, base: PatternSize, wall: WallBox, percent: number): number {
  const drawn = patternDrawnWidthIn(base, wall, percent);
  if (!Number.isFinite(masterPx.width) || masterPx.width <= 0 || drawn <= 0) return 0;
  return masterPx.width / drawn;
}

/** The largest slider step that still meets `minPpi` from the master's own
 * pixels, or null when even the smallest step cannot. */
export function maxPrintSafeScale(masterPx: { width: number; height: number }, base: PatternSize, wall: WallBox, minPpi: number): number | null {
  for (let pct = PATTERN_SCALE_MAX; pct >= PATTERN_SCALE_MIN; pct -= PATTERN_SCALE_STEP) {
    if (patternPpi(masterPx, base, wall, pct) + 1e-9 >= minPpi) return pct;
  }
  return null;
}

/** "150% · Large · the design repeats every 54″" */
export function patternScaleLabel(base: PatternSize, wall: WallBox, percent: number): string {
  const pct = clampPatternScale(percent);
  const size = patternSizeAtScale(base, wall, pct);
  const head = `${pct}% · ${patternScaleWord(pct)}`;
  if (pct === 100) return `${head} · as generated`;
  if (size.repeatWidthIn >= wall.width - 1e-9) return `${head} · one piece, ${size.repeatWidthIn}″ wide, cropped to the wall`;
  return `${head} · the design repeats every ${size.repeatWidthIn}″`;
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
  // A matched design keeps the reference's own scale, so its repeat is the
  // wallpaper baseline (about two across), not the generic four across.
  const repeatWidthIn = input.intent === 'match' ? autoMatchRepeatWidthIn(input.wallWidthIn) : autoRepeatWidthIn(input.wallWidthIn);
  if (input.chosen) return { placement: input.chosen, repeatWidthIn, reason: input.chosen === 'repeat' ? `Repeating pattern, as chosen, at ${repeatWidthIn}″ for a ${input.wallWidthIn}″ wall.` : 'Mural, as chosen: one composition sized to the wall.' };
  const brief = input.prompt || '';
  const saysMural = MURAL_WORDS.test(brief), saysPattern = PATTERN_WORDS.test(brief);
  const repeat = (why: string) => ({ placement: 'repeat' as const, repeatWidthIn, reason: `${why} Repeating at ${repeatWidthIn}″ across a ${input.wallWidthIn}″ wall so motifs print at real size.` });
  const mural = (why: string) => ({ placement: 'cover' as const, repeatWidthIn, reason: `${why} One composition sized to the ${input.wallWidthIn}″ wall.` });
  // MATCH: the uploaded reference IS the design, so it keeps its own scale.
  // The baseline is MEASURED, not assumed: `autoMatchRepeatWidthIn` above puts
  // it at about two repeats across, from the owner's installed wall. The
  // generic four-across made it half size; treating the file as one wall width
  // made it double. Naming the material ("slatted", "floral", "stone")
  // describes the reference and never re-scales it — only a brief that asks
  // for one scene makes it a mural.
  if (input.intent === 'match') return saysMural && !REPEAT_REQUEST_WORDS.test(brief)
    ? mural('The design you uploaded is one scene.')
    : { placement: 'repeat', repeatWidthIn, reason: `The design you uploaded sets the scale: it repeats every ${repeatWidthIn}″ across a ${input.wallWidthIn}″ wall, about twice, the way wallpaper is hung.` };
  if (saysPattern && !saysMural) return repeat('The brief describes a pattern.');
  if (saysMural && !saysPattern) return mural('The brief describes a mural.');
  if (input.intent === 'wall') return repeat('Designing for the room.');
  return input.wallWidthIn > 96 ? repeat('A wall this wide would blow a single composition up past life size.') : mural('A wall this size holds one composition.');
}
