// Physical layout belongs to WallPro, independently of the vehicle A.T.L.A.S. seam.
export type Point = { x: number; y: number };
export type Placement = 'cover' | 'contain' | 'repeat';
export type WallLayout = { width: number; height: number; mode: Placement; repeatWidth: number };
export function rectangularWallMask(a: Point, b: Point): Point[] {
  if ([a.x, a.y, b.x, b.y].some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new Error('Choose two points inside the wall photo.');
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  if (right - left < .002 || bottom - top < .002) throw new Error('Choose opposite corners of the window or drapes, with some space between them.');
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
}
export const WALLPRO_PRINT_WIDTH = 51;
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
    return { artworkWidth: layout.repeatWidth, artworkHeight: repeatHeight, across: layout.width / layout.repeatWidth, down: layout.height / repeatHeight };
  }
  const scale = (layout.mode === 'cover' ? Math.max : Math.min)(layout.width / aspect, layout.height);
  return { artworkWidth: aspect * scale, artworkHeight: scale, across: 1, down: 1 };
}

export function artworkPoint(p: Point, layout: WallLayout, aspect: number): Point | null {
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
  const m = layoutMetrics(layout, aspect);
  if (layout.mode === 'repeat') return { x: (p.x * m.across) % 1, y: (p.y * m.down) % 1 };
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
