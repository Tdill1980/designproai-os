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
// Printable panel width on the production roll. The media is Avery HP MPI 2610
// wall vinyl, matte/luster, and the shop's own spec sheet states it: "All
// panels billed at 54 in width, regardless of actual printed width" (owner,
// 2026-09-12). A printed panel is therefore at most 54 in INCLUDING its
// half-inch duplicated overlap (DEFAULT_WALL_PRINT).
//
// This was 59 until 2026-09-12, which is wider than the roll — those panels
// could not be printed at all. Historical jobs keep the width they were built
// at; only new ones plan at 54. If the press needs an edge margin and cannot
// image the full 54, lower this ONE constant and the runtime default beside
// it: every panel plan, seam guide, preflight and print file follows from here.
export const WALLPRO_PRINT_WIDTH = 54;
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
