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

/** Materials whose repeat is genuinely small: the unit is a slat, a plank, a
 * tile or a weave, and it has a real-world width of a few inches. A botanical
 * or a damask is not one of these, and asking for four of them across a wall
 * is what produced a craft-fair print (owner, 2026-09-12: "pattern way too
 * small"). */
const FINE_MATERIAL_WORDS = /\b(grasscloth|linen|weave|woven|burlap|hessian|canvas|plaster|concrete|stucco|plain|solid|plank|planks|slat|slats|slatted|shiplap|woodgrain|grain|subway|brick|bricks|tile|tiles|mosaic|terrazzo|herringbone|chevron|basketweave|stripe|stripes|striped|pinstripe|dots?|polka|check|checks|checkered|gingham|houndstooth)\b/i;

/** The tile width a DECORATIVE pattern wants: about two repeats across, the
 * same measured baseline a matched design gets, because that is the size a
 * wallpaper mural is actually hung at. A fine material — a slat, a plank, a
 * tile, a weave — keeps the old four-across, because its unit really is a few
 * inches wide. Both stay on the 6-inch steps wallpaper is sold in. */
export function autoRepeatWidthIn(wallWidthIn: number, brief = ''): number {
  if (!Number.isFinite(wallWidthIn) || wallWidthIn <= 0) return FINE_MATERIAL_WORDS.test(brief) ? 24 : 72;
  if (FINE_MATERIAL_WORDS.test(brief)) return Math.min(48, Math.max(18, Math.round(wallWidthIn / 4 / 6) * 6));
  return autoMatchRepeatWidthIn(wallWidthIn);
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
  const repeatWidthIn = input.intent === 'match' ? autoMatchRepeatWidthIn(input.wallWidthIn) : autoRepeatWidthIn(input.wallWidthIn, input.prompt || '');
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

/**
 * WHICH PICTURE THE FLAT PANE SHOWS.
 *
 * Owner, 2026-09-12, on a matched design: "why does it keep generating the
 * pattern I uploaded to match with much smaller pattern... when I clicked
 * generate it had correct pattern on wall and I had to manually adjust bar
 * just to see it the right size."
 *
 * Nothing was generating small. The stored generation rows show the scale
 * brain sending exactly what it should — a 120" wall gets a 60" repeat, a 142"
 * wall gets 72", about two across. What the pane was showing in that moment
 * was the BARE GENERATED TILE: one 60-inch tile, which is HALF the wall, in a
 * square box, next to a reference photograph that depicts a whole wall. It
 * reads as half size because it IS half the wall.
 *
 * The pane already held the last wall-scale render across a re-render, but on
 * the first paint after a generation there is no last one, and the exact
 * canvas pass over a 4096-square tile takes seconds on a phone. That window is
 * the one the customer reaches for the slider in — so the UI was teaching them
 * to enlarge a pattern that was already right, and out of the measured band.
 *
 *   tile    only while a refinement mask is being drawn, where the tile is the
 *           correct picture because the mask coordinates belong to it (and as
 *           the last resort when the wall geometry is not known yet).
 *   css     instant tiling at wall scale — under the moving slider, and on the
 *           first paint before the exact canvas exists.
 *   canvas  the exact render, once it is ready.
 */
export type FlatPaneView = 'tile' | 'canvas' | 'css';

export function flatPaneView(input: {
  /** A refinement mask is open or drawn: the tile is the right picture. */
  maskActive: boolean;
  /** The slider is mid-move, so the exact canvas is out of date. */
  settling: boolean;
  /** An exact wall-scale render is available (this scale's or the last one's). */
  hasCanvas: boolean;
  /** Wall geometry is known, so CSS can tile at wall scale. */
  hasCssTile: boolean;
}): FlatPaneView {
  if (input.maskActive) return 'tile';
  if (input.settling || !input.hasCanvas) return input.hasCssTile ? 'css' : 'tile';
  return 'canvas';
}
