/**
 * GENIE size-band fitting — pure, so it can be tested for real.
 *
 * Split out of `proof-sheet.ts` for the same reason `proof-text-lock.ts` was:
 * that file imports imagescript over a Deno URL, which vitest cannot load, so
 * anything left in it can only ever be string-matched. The arithmetic here
 * decides whether the sheet states its own dimensions legibly, so it should be
 * exercised rather than grepped.
 *
 * THE DEFECT THIS EXISTS TO PREVENT
 *
 * The band font was derived from the band's own HEIGHT (`BAND_H * 0.20`, giving
 * 32px at a 1800px sheet) and drawn centred. Nothing consulted the WIDTH, so a
 * long line ran off both edges and the proof shipped with its own dimensions
 * unreadable. Live on the Ridgeline F-250 sheet the two lines read:
 *
 *   Driver/Passenger 214" x 56" | Hood 68" x 39" | ... | Tot⟨cut⟩
 *   ⟨cut⟩BLEED ALL AROUND) Driver/Passenger 224" x 66" | ... | Front 132" x 44⟨cut⟩
 *
 * 120 characters at 32px needs ~2,227px inside 1,720px of usable width — 507px
 * of overflow, about 250px clipped from each side. Height was never the
 * constraint.
 */

/**
 * Average glyph advance as a fraction of font size, for DejaVu Sans Bold over
 * the characters these lines actually contain — digits, quotes, pipes, spaces
 * and capitals. Deliberately conservative: erring small yields a slightly
 * roomy line, erring large yields a clipped one, and only one of those is
 * recoverable by the reader.
 *
 * An estimate is adequate here because the failure being prevented is gross
 * overflow, not sub-pixel fit — and real text metrics are not available to an
 * SVG string built without a layout engine.
 */
export const BAND_AVG_ADVANCE = 0.58;

/** Vertical step between band baselines, as a multiple of font size. */
export const BAND_LINE_GAP = 1.55;

/** Never smaller than this — a band must degrade to "small", never "invisible". */
export const BAND_MIN_FONT = 12;

/** Never larger than this — the size short bands used before, so they are unchanged. */
export const BAND_MAX_FONT = 32;

/**
 * Largest font size at which every line fits the available width.
 *
 * Returns 0 when there is nothing to draw, so the caller reserves no height.
 */
export function fitBandFontSize(lines: string[], availableWidth: number): number {
  const live = (lines || []).map((l) => String(l || "").trim()).filter(Boolean);
  if (!live.length || !(availableWidth > 0)) return 0;
  const maxChars = live.reduce((m, l) => Math.max(m, l.length), 0);
  if (!maxChars) return 0;
  const fitted = Math.floor(availableWidth / (maxChars * BAND_AVG_ADVANCE));
  return Math.max(BAND_MIN_FONT, Math.min(BAND_MAX_FONT, fitted));
}

/**
 * Height to reserve for the band, derived FROM the fitted text rather than
 * dictating it. Returns 0 when there is nothing to draw.
 */
export function bandHeight(lines: string[], fontSize: number): number {
  const live = (lines || []).map((l) => String(l || "").trim()).filter(Boolean);
  if (!live.length || fontSize <= 0) return 0;
  return Math.max(
    72,
    Math.round(fontSize * BAND_LINE_GAP * live.length + fontSize * 1.2),
  );
}

/**
 * Estimated rendered width of a line at a given size. Exposed so tests can
 * assert the fit directly instead of re-deriving the constant.
 */
export function estimateBandLineWidth(line: string, fontSize: number): number {
  return String(line || "").trim().length * fontSize * BAND_AVG_ADVANCE;
}
