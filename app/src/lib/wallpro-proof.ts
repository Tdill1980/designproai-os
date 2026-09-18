import { homography, projectPoint, UNIT_WALL, validWallCorners, type Point } from './wallpro-geometry';
import { loadWallImage } from './wallpro-render';

/** Locate a detail on the left of the customer's marked wall, in photo pixels.
 * The existing homography chooses the crop; it never changes the camera or art. */
export function wallDetailCrop(corners: Point[], width: number, height: number) {
  if (!validWallCorners(corners) || ![width, height].every(n => Number.isFinite(n) && n > 0)) {
    throw new Error('Locate the wall before making a close-up.');
  }
  const map = homography(UNIT_WALL, corners);
  const points = [{ x: .08, y: .18 }, { x: .53, y: .18 }, { x: .53, y: .82 }, { x: .08, y: .82 }]
    .map(p => projectPoint(map, p));
  const x = Math.max(0, Math.floor(Math.min(...points.map(p => p.x)) * width));
  const y = Math.max(0, Math.floor(Math.min(...points.map(p => p.y)) * height));
  const right = Math.min(width, Math.ceil(Math.max(...points.map(p => p.x)) * width));
  const bottom = Math.min(height, Math.ceil(Math.max(...points.map(p => p.y)) * height));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

/** Snapshot the completed geometry compositor. Its exclusions and detected
 * masks are already in these pixels, so the close-up preserves them verbatim.
 * No render-wall-view request, new perspective, or AI upscaling is involved. */
export async function captureWallProof(beforeUrl: string, after: HTMLCanvasElement, corners: Point[]) {
  const crop = wallDetailCrop(corners, after.width, after.height);
  const detail = document.createElement('canvas');
  detail.width = crop.width; detail.height = crop.height;
  const ctx = detail.getContext('2d');
  if (!ctx) throw new Error('This browser could not prepare the close-up.');
  ctx.drawImage(after, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const afterUrl = after.toDataURL('image/jpeg', .94);
  const detailUrl = detail.toDataURL('image/jpeg', .94);
  const original = await loadWallImage(beforeUrl);
  const before = document.createElement('canvas');
  const scale = Math.min(1, Math.max(after.width, after.height) / Math.max(original.naturalWidth, original.naturalHeight));
  before.width = Math.max(1, Math.round(original.naturalWidth * scale));
  before.height = Math.max(1, Math.round(original.naturalHeight * scale));
  const beforeCtx = before.getContext('2d');
  if (!beforeCtx) throw new Error('This browser could not prepare the before photo.');
  beforeCtx.drawImage(original, 0, 0, before.width, before.height);
  return [
    { type: 'before', label: 'Before', url: before.toDataURL('image/jpeg', .94) },
    { type: 'after', label: 'After', url: afterUrl },
    { type: 'detail', label: 'Detail close-up', url: detailUrl },
  ];
}
