// Physical layout belongs to WallPro, independently of the vehicle A.T.L.A.S. seam.
import { tileCoordinate } from './wallpro-seamless';
export type Point = { x: number; y: number };
export type Placement = 'cover' | 'contain' | 'repeat';
/** `mirror` applies to repeat only: odd tiles are flipped so every join is a
 * column or row against its own copy, which is seamless by construction. */
export type WallLayout = { width: number; height: number; mode: Placement; repeatWidth: number; mirror?: boolean };
export function rectangularWallMask(a: Point, b: Point): Point[] {
  if ([a.x, a.y, b.x, b.y].some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new Error('Choose two points inside the wall photo.');
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  if (right - left < .002 || bottom - top < .002) throw new Error('Choose opposite corners of the window or drapes, with some space between them.');
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
}
// Printable panel width on the production roll: 53 inches.
//
// THIS IS WHAT THE PRESS CAN IMAGE, NOT WHAT THE ROLL MEASURES. The live
// product page states it twice -- "Printed at 53 in panel width" and "Panels
// are charged at full 53 in width regardless of trimmed size"
// (weprintwraps.com/our-products/wall-wrap-printed-vinyl/, read 2026-09-14).
// The sibling perforated-window product spells out the same relationship:
// "54 in Roll (Max Print 53.5 in)" -- 54 inches of media, less than that
// imageable.
//
// IT WAS 54, AND THAT PRODUCED A SHORT WRAP. The owner's first end-to-end
// WallPro job -- her own in-home spa -- came back half an inch short. Panels
// were planned and rasterised at a full 54 in, which the press cannot image;
// what came off it was the printable width, so every panel arrived narrower
// than the file said. The geometry was never wrong: both planners agree to the
// micron and the raster lands on exactly round(panel.width x ppi). The file was
// simply asking for more width than the machine has.
//
// The billing width is a SEPARATE number and stays as the shop states it:
// "All panels billed at 54 in width, regardless of actual printed width."
// Billed 54, printed 53. Do not collapse the two.
//
// Before this it was 59, which is wider than the media itself -- those panels
// could not be printed at all. Historical jobs keep the width they were built
// at; only new ones plan at 53.
//
// Lower this ONE constant and the runtime default beside it and every panel
// plan, seam guide, preflight and print file follows. They must stay equal --
// a test in source-tests/runtime/wallpro-production.test.mjs reads this file to
// enforce it.
export const WALLPRO_PRINT_WIDTH = 53;
export const UNIT_WALL: Point[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

export function validWallSize(width: number, height: number): boolean {
  return [width, height].every(n => Number.isFinite(n) && n >= 1 && n <= 2400);
}

// Trim-area planning at the shop's printable width. Pattern coordinates stay
// wall-wide; they never restart or stretch at a panel boundary.
export function wallPrintPanels(width: number, height: number) {
  if (!validWallSize(width, height)) throw new Error('Enter valid wall dimensions.');
  return Array.from({ length: Math.ceil(width / WALLPRO_PRINT_WIDTH) }, (_, i) => ({
    number: i + 1, start: i * WALLPRO_PRINT_WIDTH,
    width: Math.min(WALLPRO_PRINT_WIDTH, width - i * WALLPRO_PRINT_WIDTH), height,
  }));
}

/**
 * A QUAD THAT IS THE WHOLE PHOTOGRAPH IS NOT A WALL (owner, 2026-09-22).
 *
 * She uploaded a real room -- vanity nook, wall-mounted TV, an open closet
 * doorway -- and the design was painted straight over the ceiling, the floor
 * and the doorway, with no prompt to mark anything. The page even has a
 * comment describing that exact outcome, written 2026-09-12.
 *
 * The guard that was supposed to stop it (`cornerSource !== 'default'`) checks
 * PROVENANCE, not GEOMETRY. `validWallCorners` happily accepts UNIT_WALL --
 * area 1.0, all crosses positive -- so a detector that hands back the frame is
 * indistinguishable from a located wall: corners valid, source "detected",
 * `wallLocated` true, and the view auto-flips to the composite before she has
 * seen her own photo.
 *
 * THE ASYMMETRY IS THE WHOLE ARGUMENT. A false negative costs four taps. A
 * false positive covers the room and reads as "it didn't work". And a real
 * wall photograph essentially cannot fill its own frame: you always see floor,
 * ceiling, or the return wall -- her photo's feature wall is well under half
 * the frame.
 *
 * Scope: this convicts a DETECTION only. A customer who taps four corners at
 * the edges of her photo meant it, and `wallPreviewBlocker` still judges her
 * taps on validity alone.
 */
const WHOLE_FRAME_AREA = 0.9;
const WHOLE_FRAME_EPS = 0.03;

export function looksLikeWholeFrame(points: Point[]): boolean {
  if (points.length !== 4) return false;
  const area = Math.abs(points.reduce((a, p, i) => a + p.x * points[(i + 1) % 4].y - p.y * points[(i + 1) % 4].x, 0)) / 2;
  if (area >= WHOLE_FRAME_AREA) return true;
  // Or it hugs all four frame corners without covering much — a thin sliver
  // pinned to the edges is the same "I found nothing" answer wearing a
  // different shape.
  return UNIT_WALL.every((corner, i) =>
    Math.abs(points[i].x - corner.x) <= WHOLE_FRAME_EPS &&
    Math.abs(points[i].y - corner.y) <= WHOLE_FRAME_EPS);
}

/**
 * FOUR TAPS ARE A WALL IN WHATEVER ORDER THEY ARRIVE (owner, Trish 2026-09-23,
 * standing in front of the wall she needed to show a printer in the morning:
 * "I'm trying to wrap this wall the white wall and it won't do it").
 *
 * Her four corners were right. Their ORDER was not: she had tapped top-left,
 * top-right, bottom-LEFT, bottom-RIGHT — reading order, which is what a person
 * does — and slots 3 and 4 are bottom-right and bottom-left. That makes the
 * quad cross itself, `validWallCorners` returns false, "Wall area: not set"
 * never clears, and the design can never land on the photo. Measured on her own
 * numbers: corner 2's cross product came back -2297.6.
 *
 * The app's answer was a sentence telling her to do it again, clockwise. But
 * the four points already describe exactly one convex quadrilateral; which
 * order they were tapped in carries no information the geometry needs. So the
 * code sorts them instead of asking a person to.
 *
 * Deterministic, no model, no guess: take the centroid, sort the four points by
 * their angle around it — which is the convex ring for any four points in
 * convex position — then rotate that ring to start at the corner nearest the
 * top-left of the frame. In image coordinates (y downward) ascending angle IS
 * top-left → top-right → bottom-right → bottom-left, the order every consumer
 * already expects.
 *
 * It returns null rather than guessing when no ordering can work — one point
 * inside the triangle of the other three is a genuinely degenerate wall, and
 * `validWallCorners` is still the judge of the result.
 */
export function orderWallCorners(points: Point[]): Point[] | null {
  if (points.length !== 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const cx = points.reduce((a, p) => a + p.x, 0) / 4;
  const cy = points.reduce((a, p) => a + p.y, 0) / 4;
  const ring = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0;
  for (let i = 1; i < 4; i += 1) if (ring[i].x + ring[i].y < ring[start].x + ring[start].y) start = i;
  const ordered = [0, 1, 2, 3].map(i => ring[(start + i) % 4]);
  return validWallCorners(ordered) ? ordered : null;
}

export function validWallCorners(points: Point[]): boolean {
  if (points.length !== 4 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
  // Top-left, top-right, bottom-right, bottom-left in image coordinates.
  const cross = points.map((p, i) => {
    const q = points[(i + 1) % 4], r = points[(i + 2) % 4];
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
  });
  const area = Math.abs(points.reduce((a, p, i) => a + p.x * points[(i + 1) % 4].y - p.y * points[(i + 1) % 4].x, 0)) / 2;
  return cross.every(n => n > 1e-6) && area >= 0.0025;
}

// Gate before any paid wall generation. The flat rectangle is the product and
// the print file, so it needs the wall size and nothing else: a wall photo
// without corners still generates, shows the flat design first, and is imposed
// on the photo the moment four valid corners exist (owner, 2026-09-11: "show the
// flat rectangle first then impose it"). Returning a reason instead of a
// boolean keeps the button, the click handler and the tests on one message.
export function wallGenerationBlocker(_hasPhoto: boolean, _corners: Point[], width: number, height: number): string | null {
  if (!validWallSize(width, height)) return 'Enter wall dimensions between 1 and 2,400 inches.';
  return null;
}

// What stands between the customer and the on-wall view. Never blocks
// generation or the print files; it only says why the photo view is not ready.
export function wallPreviewBlocker(hasPhoto: boolean, corners: Point[]): string | null {
  if (!hasPhoto) return null;
  if (corners.length < 4) return 'Mark all four wall corners (' + (4 - corners.length) + ' remaining) to see the design on your wall photo. The flat design and print files do not wait for this.';
  if (!validWallCorners(corners)) return 'The wall corners cross or form a narrow area. Restart the corners clockwise from the top left to see the design on your wall.';
  return null;
}

export function homography(from: Point[], to: Point[]): number[] {
  const rows: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i], u = to[i].x, v = to[i].y;
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let pivot = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r;
    if (Math.abs(rows[pivot][c]) < 1e-10) throw new Error('The wall corners form a flat or crossed area. Mark them again.');
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    const divisor = rows[c][c];
    for (let j = c; j <= 8; j++) rows[c][j] /= divisor;
    for (let r = 0; r < 8; r++) if (r !== c) {
      const factor = rows[r][c];
      for (let j = c; j <= 8; j++) rows[r][j] -= factor * rows[c][j];
    }
  }
  return rows.map(r => r[8]);
}

export function projectPoint(h: number[], p: Point): Point {
  const z = h[6] * p.x + h[7] * p.y + 1;
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / z, y: (h[3] * p.x + h[4] * p.y + h[5]) / z };
}

export function layoutMetrics(layout: WallLayout, aspect: number) {
  if (!validWallSize(layout.width, layout.height) || !Number.isFinite(aspect) || aspect <= 0) throw new Error('Enter a valid wall width and height.');
  if (layout.mode === 'repeat') {
    if (!Number.isFinite(layout.repeatWidth) || layout.repeatWidth < 1 || layout.repeatWidth > 2400) throw new Error('Enter a pattern tile width between 1 and 2,400 inches.');
    const repeatHeight = layout.repeatWidth / aspect;
    if (layout.width / layout.repeatWidth > 1000 || layout.height / repeatHeight > 1000) throw new Error('The repeat is too small for this preview. Increase its width.');
    // The tile grid starts at the wall's top-left corner. A tile larger than
    // the wall in an axis (a mural scaled past 100%) is centred on it instead,
    // so the wall shows the middle of the design, as PatternPro's preview
    // crops an oversized swatch. `originX/Y` are the wall-inch coordinates of
    // tile (0, 0)'s corner; identical in runtime/wallpro-production.cjs.
    return { artworkWidth: layout.repeatWidth, artworkHeight: repeatHeight, across: layout.width / layout.repeatWidth, down: layout.height / repeatHeight, originX: tileOrigin(layout.width, layout.repeatWidth), originY: tileOrigin(layout.height, repeatHeight) };
  }
  const scale = (layout.mode === 'cover' ? Math.max : Math.min)(layout.width / aspect, layout.height);
  return { artworkWidth: aspect * scale, artworkHeight: scale, across: 1, down: 1, originX: 0, originY: 0 };
}

export function tileOrigin(wallIn: number, tileIn: number): number {
  return tileIn > wallIn + 1e-9 ? (wallIn - tileIn) / 2 : 0;
}

/** Tile-grid coordinate (in tiles) of a wall point given in inches. */
export function tileCoordinateAt(inches: number, origin: number, tileIn: number, mirror: boolean): number {
  return tileCoordinate((inches - origin) / tileIn, mirror).u;
}

export function artworkPoint(p: Point, layout: WallLayout, aspect: number): Point | null {
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
  const m = layoutMetrics(layout, aspect);
  if (layout.mode === 'repeat') return { x: tileCoordinateAt(p.x * layout.width, m.originX, m.artworkWidth, !!layout.mirror), y: tileCoordinateAt(p.y * layout.height, m.originY, m.artworkHeight, !!layout.mirror) };
  const x = (p.x * layout.width - (layout.width - m.artworkWidth) / 2) / m.artworkWidth;
  const y = (p.y * layout.height - (layout.height - m.artworkHeight) / 2) / m.artworkHeight;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

export function insidePolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (((a.y > p.y) !== (b.y > p.y)) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
