#!/usr/bin/env node
/**
 * CONTINUITY ACROSS TERRITORY BOUNDARIES — harness telemetry. Not a gate.
 *
 * In a continuous field the territories share borders. Two things are worth a
 * number: does the ground CONTINUE across each border (`boundaryMae`, low = it
 * does), and did the model draw the border -- a rule, a divider, a frame edge
 * -- which would mean it read the movements as containers (`dividerDetected`,
 * with its depth so it can be compared to the bleed inset).
 *
 * Deterministic pixel arithmetic on the unmasked field at full resolution.
 */

export const STRIP_PX = 32;      // reference strips either side of the border
export const INNER_PX = 8;       // the ±window a divider would occupy
export const SAMPLE_STEP_PX = 8; // positions sampled along the border
export const DIVIDER_LUMA_DELTA = 40;
export const DIVIDER_COVERAGE = 0.9;

function lumaAt(data, width, channels, x, y) {
  const i = (y * width + x) * channels;
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
}

/**
 * @param raw {{ data: Buffer, width: number, height: number, channels: number }}
 *   an RGB/RGBA raw buffer of the whole field
 * @param boundary {{ axis: "x"|"y", at: number, from: number, to: number, between: string[] }}
 */
export function measureBoundary(raw, boundary) {
  const { data, width, height, channels } = raw;
  const perpendicularMax = boundary.axis === "y" ? height : width;
  const lo = boundary.at - STRIP_PX - INNER_PX;
  const hi = boundary.at + STRIP_PX + INNER_PX - 1;
  if (lo < 0 || hi >= perpendicularMax) {
    return { ...boundary, measurable: false, reason: "border too close to the canvas edge" };
  }
  let positions = 0;
  let maeSum = 0;
  let dividerPositions = 0;
  const depths = [];
  for (let t = boundary.from; t < boundary.to; t += SAMPLE_STEP_PX) {
    const at = (offset) => {
      const p = boundary.at + offset;
      return boundary.axis === "y" ? lumaAt(data, width, channels, t, p) : lumaAt(data, width, channels, p, t);
    };
    let a = 0; let b = 0;
    for (let k = INNER_PX + 1; k <= INNER_PX + STRIP_PX; k += 1) { a += at(-k); b += at(k - 1); }
    a /= STRIP_PX; b /= STRIP_PX;
    maeSum += Math.abs(a - b) / 255;
    let depth = 0;
    for (let k = -INNER_PX; k < INNER_PX; k += 1) {
      const l = at(k);
      if (Math.abs(l - a) > DIVIDER_LUMA_DELTA && Math.abs(l - b) > DIVIDER_LUMA_DELTA) depth += 1;
    }
    if (depth > 0) { dividerPositions += 1; depths.push(depth); }
    positions += 1;
  }
  depths.sort((p, q) => p - q);
  const coverage = positions ? dividerPositions / positions : 0;
  return {
    ...boundary,
    measurable: true,
    positions,
    boundaryMae: positions ? Number((maeSum / positions).toFixed(5)) : null,
    dividerCoverage: Number(coverage.toFixed(3)),
    dividerDetected: coverage >= DIVIDER_COVERAGE,
    dividerDepthPx: depths.length ? depths[Math.floor(depths.length / 2)] : 0,
  };
}

export function measureContinuity(raw, boundaries) {
  const results = boundaries.map((b) => measureBoundary(raw, b));
  const measured = results.filter((r) => r.measurable);
  return {
    contract: "designpro.atlas-field-continuity.v1",
    boundaries: results,
    anyDividerDetected: measured.some((r) => r.dividerDetected),
    worstBoundaryMae: measured.length ? Math.max(...measured.map((r) => r.boundaryMae)) : null,
    deepestDividerPx: measured.length ? Math.max(0, ...measured.map((r) => r.dividerDepthPx)) : 0,
  };
}
