/**
 * homography.ts — 8-DOF Perspective Transform Solver
 *
 * Pure math: given 4 source points and 4 destination points,
 * computes the 3x3 homography matrix that maps between them.
 *
 * Used by extract-panel-from-render to reverse perspective distortion
 * from 3D renders back to flat panel artwork.
 *
 * No external dependencies.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * 3x3 homography matrix stored as flat array [h0..h8]
 * Maps (x,y) -> (x',y') via:
 *   w  = h[6]*x + h[7]*y + h[8]
 *   x' = (h[0]*x + h[1]*y + h[2]) / w
 *   y' = (h[3]*x + h[4]*y + h[5]) / w
 */
export type HomographyMatrix = number[];

/**
 * Solve the 8-DOF homography from 4 point correspondences.
 *
 * Given source points (in render image) and destination points (in flat panel),
 * returns H such that for each pair: dst = H * src (in homogeneous coords).
 *
 * Uses Direct Linear Transform (DLT) with Gaussian elimination.
 */
export function solveHomography(
  src: [Point2D, Point2D, Point2D, Point2D],
  dst: [Point2D, Point2D, Point2D, Point2D],
): HomographyMatrix {
  // Build 8x9 matrix A for the system Ah = 0
  // For each point correspondence (sx,sy) -> (dx,dy):
  //   -sx*1  -sy*1  -1   0      0      0   sx*dx  sy*dx  dx  = 0
  //    0      0      0  -sx*1  -sy*1  -1   sx*dy  sy*dy  dy  = 0
  //
  // We fix h[8] = 1 and solve the 8x8 system instead.
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y;
    const dx = dst[i].x, dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }

  const h = gaussianElimination(A, b);
  return [...h, 1]; // h[0..7] + h[8]=1
}

/**
 * Apply homography to transform a point.
 * Maps source point through H to get destination point.
 */
export function applyHomography(H: HomographyMatrix, p: Point2D): Point2D {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  if (Math.abs(w) < 1e-10) return { x: 0, y: 0 };
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

/**
 * Compute the inverse homography matrix.
 * Used for backward mapping: for each output pixel, find the source pixel.
 */
export function invertHomography(H: HomographyMatrix): HomographyMatrix {
  // 3x3 matrix inverse using cofactors
  const [a, b, c, d, e, f, g, h, i] = H;

  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) {
    throw new Error("Homography matrix is singular — cannot invert");
  }

  const invDet = 1 / det;
  return [
    (e * i - f * h) * invDet,
    (c * h - b * i) * invDet,
    (b * f - c * e) * invDet,
    (f * g - d * i) * invDet,
    (a * i - c * g) * invDet,
    (c * d - a * f) * invDet,
    (d * h - e * g) * invDet,
    (b * g - a * h) * invDet,
    (a * e - b * d) * invDet,
  ];
}

/**
 * Solve Ax = b using Gaussian elimination with partial pivoting.
 * A is NxN, b is Nx1. Returns x as N-element array.
 */
function gaussianElimination(A: number[][], b: number[]): number[] {
  const n = A.length;

  // Augmented matrix [A|b]
  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(aug[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(aug[row][col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    // Swap rows
    if (maxRow !== col) {
      [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];
    }

    if (Math.abs(aug[col][col]) < 1e-12) {
      throw new Error(`Singular matrix at column ${col}`);
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = aug[row][n];
    for (let col = row + 1; col < n; col++) {
      sum -= aug[row][col] * x[col];
    }
    x[row] = sum / aug[row][row];
  }

  return x;
}
