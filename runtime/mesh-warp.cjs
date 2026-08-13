"use strict";

/**
 * Phase 4: deterministic mesh warp.
 *
 * A production surface is a flat rectangle. A vehicle panel is not. Getting the
 * artwork from one to the other is the only geometric step the 3D proof needs,
 * and it is done here by inverse mapping: for every destination pixel, find
 * where it came from in the surface, and sample there. Nothing is invented,
 * nothing is inferred, and no pixel appears in the output that was not read out
 * of the authoritative surface.
 *
 * The mesh is declared by the vehicle plate, never fitted at run time. Fitting
 * a warp to an image is the same class of mistake as reconstructing artwork
 * from a render: it produces a plausible answer with no way to tell a correct
 * one from a wrong one.
 *
 * DETERMINISM. Only +, -, *, / and Math.sqrt appear below. IEEE-754 specifies
 * all five exactly, so the same inputs produce the same bytes on any host. The
 * transcendental helpers (Math.hypot, Math.pow) are not exactly specified and
 * are deliberately absent.
 */

// Below this, a quadratic's leading coefficient is treated as zero and the
// equation solved as a linear one. Affine and perspective cells are the common
// case, and both make the quadratic term vanish exactly.
const DEGENERATE = 1e-9;
// Cell membership tolerance. Adjacent cells share an edge, so a pixel centre
// landing exactly on one must belong to a cell rather than to neither.
const EDGE_TOLERANCE = 1e-6;

class MeshWarpError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "MeshWarpError";
  }
}

function fail(code, message) {
  throw new MeshWarpError(code, message);
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

/**
 * Where in the unit cell does this destination point sit?
 *
 * The cell maps (s,t) in [0,1]^2 to the plane by bilinear interpolation of its
 * four corners:
 *
 *   P(s,t) = A + B s + C t + D s t,  A = P00 - P, B = P10 - P00,
 *                                    C = P01 - P00, D = P00 - P10 - P01 + P11
 *
 * Setting P(s,t) = 0 and crossing with (B + D t) eliminates s and leaves a
 * quadratic in t. Solve it, then recover s from whichever component has the
 * larger denominator — the smaller one can be zero for an axis-aligned cell.
 *
 * Returns null when the point is outside this cell.
 */
function inverseBilinear(px, py, quad) {
  const ax = quad[0] - px, ay = quad[1] - py;
  const bx = quad[2] - quad[0], by = quad[3] - quad[1];
  const cx = quad[4] - quad[0], cy = quad[5] - quad[1];
  const dx = quad[0] - quad[2] - quad[4] + quad[6];
  const dy = quad[1] - quad[3] - quad[5] + quad[7];

  const qa = cross(cx, cy, dx, dy);
  const qb = cross(ax, ay, dx, dy) + cross(cx, cy, bx, by);
  const qc = cross(ax, ay, bx, by);

  const roots = [];
  if (qa < DEGENERATE && qa > -DEGENERATE) {
    if (qb < DEGENERATE && qb > -DEGENERATE) return null;
    roots.push(-qc / qb);
  } else {
    const discriminant = qb * qb - 4 * qa * qc;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    // Both roots, in a fixed order, so a point that satisfies each resolves the
    // same way on every host.
    roots.push((-qb - root) / (2 * qa), (-qb + root) / (2 * qa));
  }

  for (const t of roots) {
    if (!(t >= -EDGE_TOLERANCE && t <= 1 + EDGE_TOLERANCE)) continue;
    const denomX = bx + dx * t;
    const denomY = by + dy * t;
    const useX = (denomX < 0 ? -denomX : denomX) >= (denomY < 0 ? -denomY : denomY);
    const denom = useX ? denomX : denomY;
    if (denom < DEGENERATE && denom > -DEGENERATE) continue;
    const s = useX ? -(ax + cx * t) / denom : -(ay + cy * t) / denom;
    if (!(s >= -EDGE_TOLERANCE && s <= 1 + EDGE_TOLERANCE)) continue;
    const clampedS = s < 0 ? 0 : s > 1 ? 1 : s;
    const clampedT = t < 0 ? 0 : t > 1 ? 1 : t;
    return { s: clampedS, t: clampedT };
  }
  return null;
}

/** Bilinear sample of an RGB raster. Coordinates are in source pixels. */
function sampleRgb(source, width, height, x, y, out) {
  const clampedX = x < 0 ? 0 : x > width - 1 ? width - 1 : x;
  const clampedY = y < 0 ? 0 : y > height - 1 ? height - 1 : y;
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = x0 + 1 > width - 1 ? width - 1 : x0 + 1;
  const y1 = y0 + 1 > height - 1 ? height - 1 : y0 + 1;
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy, w11 = fx * fy;
  const i00 = (y0 * width + x0) * 3, i10 = (y0 * width + x1) * 3;
  const i01 = (y1 * width + x0) * 3, i11 = (y1 * width + x1) * 3;
  for (let channel = 0; channel < 3; channel += 1) {
    out[channel] = source[i00 + channel] * w00 + source[i10 + channel] * w10
      + source[i01 + channel] * w01 + source[i11 + channel] * w11;
  }
}

/**
 * The destination-space bounding box of one mesh cell, as integer pixel bounds.
 */
function cellBounds(quad, frameWidth, frameHeight) {
  let minX = quad[0], maxX = quad[0], minY = quad[1], maxY = quad[1];
  for (let corner = 1; corner < 4; corner += 1) {
    const x = quad[corner * 2], y = quad[corner * 2 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    left: Math.max(0, Math.floor(minX)),
    top: Math.max(0, Math.floor(minY)),
    right: Math.min(frameWidth - 1, Math.ceil(maxX)),
    bottom: Math.min(frameHeight - 1, Math.ceil(maxY)),
  };
}

/**
 * Warp one production surface into the plate frame through a declared mesh.
 *
 * `source` is raw RGB at sourceWidth x sourceHeight and must already be cropped
 * to the surface's trim rectangle: bleed is the margin the trimmer removes, and
 * showing it to a customer would show artwork the vehicle never carries.
 *
 * Returns raw RGBA over the whole frame. Alpha is coverage — 255 where the mesh
 * painted, 0 where it did not — so the caller can tell the difference between
 * black artwork and no artwork.
 */
function warpSurface({ source, sourceWidth, sourceHeight, mesh, frameWidth, frameHeight }) {
  if (!Buffer.isBuffer(source) || source.length !== sourceWidth * sourceHeight * 3) {
    fail("warp_source_invalid", "the warp source must be raw RGB matching its declared size");
  }
  if (!Number.isInteger(frameWidth) || !Number.isInteger(frameHeight) || frameWidth <= 0 || frameHeight <= 0) {
    fail("warp_frame_invalid", "the destination frame must be a positive integer size");
  }
  const { rows, cols, points } = mesh;
  if (points.length !== (rows + 1) * (cols + 1)) {
    fail("warp_mesh_incomplete", `a ${rows}x${cols} mesh needs ${(rows + 1) * (cols + 1)} points, not ${points.length}`);
  }

  const out = Buffer.alloc(frameWidth * frameHeight * 4);
  const rgb = new Float64Array(3);
  const maxSourceX = sourceWidth - 1;
  const maxSourceY = sourceHeight - 1;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const p00 = points[row * (cols + 1) + col];
      const p10 = points[row * (cols + 1) + col + 1];
      const p01 = points[(row + 1) * (cols + 1) + col];
      const p11 = points[(row + 1) * (cols + 1) + col + 1];
      const quad = [p00.x, p00.y, p10.x, p10.y, p01.x, p01.y, p11.x, p11.y];
      const bounds = cellBounds(quad, frameWidth, frameHeight);

      for (let y = bounds.top; y <= bounds.bottom; y += 1) {
        for (let x = bounds.left; x <= bounds.right; x += 1) {
          const local = inverseBilinear(x + 0.5, y + 0.5, quad);
          if (!local) continue;
          const { s, t } = local;
          // The cell's own UV corners, so a mesh may sample the surface
          // unevenly — a door that occupies more of the frame than the quarter
          // panel beside it is exactly that.
          const u = (1 - s) * (1 - t) * p00.u + s * (1 - t) * p10.u + (1 - s) * t * p01.u + s * t * p11.u;
          const v = (1 - s) * (1 - t) * p00.v + s * (1 - t) * p10.v + (1 - s) * t * p01.v + s * t * p11.v;
          sampleRgb(source, sourceWidth, sourceHeight, u * maxSourceX, v * maxSourceY, rgb);
          const index = (y * frameWidth + x) * 4;
          // Round-half-up on a non-negative value: deterministic, and the same
          // rule libvips applies when it narrows a float band to eight bits.
          out[index] = Math.floor(rgb[0] + 0.5);
          out[index + 1] = Math.floor(rgb[1] + 0.5);
          out[index + 2] = Math.floor(rgb[2] + 0.5);
          out[index + 3] = 255;
        }
      }
    }
  }
  return out;
}

/**
 * The longest destination edge of any mesh cell, in pixels.
 *
 * The caller uses this to choose how much of the surface to decode: sampling a
 * 24,000 px wide surface into a 1,400 px wide panel by point-picking one pixel
 * in seventeen is aliasing, and aliasing on a proof reads as a defect in the
 * artwork rather than as a defect in the proof.
 */
function meshExtentPx(mesh) {
  const { rows, cols, points } = mesh;
  let widest = 0;
  let tallest = 0;
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const a = points[row * (cols + 1) + col];
      const b = points[row * (cols + 1) + col + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const span = b.u - a.u;
      const perUnit = span > DEGENERATE || span < -DEGENERATE ? length / (span < 0 ? -span : span) : length;
      if (perUnit > widest) widest = perUnit;
    }
  }
  for (let col = 0; col <= cols; col += 1) {
    for (let row = 0; row < rows; row += 1) {
      const a = points[row * (cols + 1) + col];
      const b = points[(row + 1) * (cols + 1) + col];
      const dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const span = b.v - a.v;
      const perUnit = span > DEGENERATE || span < -DEGENERATE ? length / (span < 0 ? -span : span) : length;
      if (perUnit > tallest) tallest = perUnit;
    }
  }
  return { widthPx: Math.ceil(widest), heightPx: Math.ceil(tallest) };
}

module.exports = {
  MeshWarpError,
  warpSurface,
  meshExtentPx,
  _test: { inverseBilinear, sampleRgb, cellBounds },
};
