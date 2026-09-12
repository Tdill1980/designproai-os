import { homography, projectPoint, validWallCorners, layoutMetrics, tileCoordinateAt, UNIT_WALL, insidePolygon, type Point, type WallLayout } from './wallpro-geometry';
import { maskFlags } from './wallpro-masks';

export async function loadWallImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('The image could not be opened. Upload a JPG, PNG or WebP file.')); image.src = src; });
  return image;
}

/** The formats the whole chain already handles losslessly end to end. */
const WALL_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** 58 MP leaves headroom under the 60 MP guard below after rounding. */
const TRANSCODE_MAX_PIXELS = 58_000_000;

/**
 * Whether a chosen file has to be re-encoded before the app can use it.
 * A JPG, PNG or WebP passes through byte for byte, so an uploaded print-ready
 * file is never re-compressed. Anything else — above all HEIC/HEIF, which is
 * what an iPhone camera actually produces — is transcoded once, in the browser.
 * Some pickers report an empty type, so the extension is the fallback.
 */
export function needsWallTranscode(type: string, name = ''): boolean {
  if (WALL_UPLOAD_TYPES.includes(type)) return false;
  if (type) return true;
  return !/\.(jpe?g|png|webp)$/i.test(name);
}

/**
 * Take the photo the phone actually gives us. iPhones shoot HEIC, and the
 * old contract rejected it outright ("export it first"), which is not a thing
 * anyone does while standing in front of a wall. Safari decodes HEIC natively,
 * so one canvas pass turns it into the JPEG the rest of the chain expects —
 * including the storage upload, which names the object by its content type.
 */
export async function prepareWallUpload(file: File): Promise<File> {
  if (!needsWallTranscode(file.type, file.name)) return file;
  if (file.size > 60 * 1024 * 1024 || file.size === 0) throw new Error('Choose an image between 1 byte and 60 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadWallImage(url).catch(() => {
      throw new Error('This device cannot open that image. Take the photo again, or choose a JPG, PNG or WebP file.');
    });
    const pixels = image.naturalWidth * image.naturalHeight;
    if (!pixels) throw new Error('That image has no pixels. Choose another file.');
    const scale = Math.min(1, Math.sqrt(TRANSCODE_MAX_PIXELS / pixels));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not convert the image. Choose a JPG, PNG or WebP file.');
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) throw new Error('This browser could not convert the image. Choose a JPG, PNG or WebP file.');
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } finally { URL.revokeObjectURL(url); }
}

export async function validateWallUpload(file: File): Promise<{ url: string; aspect: number; width: number; height: number }> {
  // Reached only for a file `prepareWallUpload` could not convert, so the
  // message names what is left rather than telling an iPhone owner to export.
  if (!WALL_UPLOAD_TYPES.includes(file.type)) throw new Error('Use a photo or an image file. A PDF or a TIFF has to be exported to JPG, PNG or WebP first.');
  if (file.size > 20 * 1024 * 1024 || file.size === 0) throw new Error('Choose an image between 1 byte and 20 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadWallImage(url);
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error('Use an image with no more than 60 megapixels.');
    return { url, aspect: image.naturalWidth / image.naturalHeight, width: image.naturalWidth, height: image.naturalHeight };
  } catch (e) { URL.revokeObjectURL(url); throw e; }
}

// Bounded client-side visual proof. Original artwork remains separate and unmodified.
// The inverse perspective map and physical repeat are identical for preview/export.
export async function renderWallPreview(photoUrl: string, artworkUrl: string, corners: Point[], exclusions: Point[][], layout: WallLayout, cancelled: () => boolean = () => false, maskUrl: string | null = null): Promise<HTMLCanvasElement> {
  if (!validWallCorners(corners)) throw new Error('Mark the four wall corners clockwise, starting at the top left.');
  const [photo, art] = await Promise.all([loadWallImage(photoUrl), loadWallImage(artworkUrl)]);
  if (cancelled()) throw new Error('Preview superseded.');
  const m = layoutMetrics(layout, art.naturalWidth / art.naturalHeight);
  const scale = Math.min(1, 1600 / Math.max(photo.naturalWidth, photo.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(photo.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(photo.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
  const result = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Pixel-accurate protected areas from detection, beside any hand-drawn polygons.
  const protectedPx = maskUrl ? await maskFlags(maskUrl, canvas.width, canvas.height) : null;
  if (cancelled()) throw new Error('Preview superseded.');
  const texture = document.createElement('canvas');
  const textureScale = Math.min(1, 2400 / Math.max(art.naturalWidth, art.naturalHeight));
  texture.width = Math.max(1, Math.round(art.naturalWidth * textureScale)); texture.height = Math.max(1, Math.round(art.naturalHeight * textureScale));
  const tctx = texture.getContext('2d', { willReadFrequently: true })!;
  tctx.drawImage(art, 0, 0, texture.width, texture.height);
  const texels = tctx.getImageData(0, 0, texture.width, texture.height).data;
  const h = homography(corners, UNIT_WALL);
  const minX = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x)) * canvas.width));
  const maxX = Math.min(canvas.width, Math.ceil(Math.max(...corners.map(p => p.x)) * canvas.width));
  const minY = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y)) * canvas.height));
  const maxY = Math.min(canvas.height, Math.ceil(Math.max(...corners.map(p => p.y)) * canvas.height));
  for (let y = minY; y < maxY; y++) {
    // Yield during large previews so controls remain responsive.
    if (y % 100 === 0) await new Promise<void>(r => requestAnimationFrame(() => r()));
    if (cancelled()) throw new Error('Preview superseded.');
    for (let x = minX; x < maxX; x++) {
      const p = { x: (x + 0.5) / canvas.width, y: (y + 0.5) / canvas.height };
      const uv = projectPoint(h, p);
      if (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1 || (protectedPx && protectedPx[y * canvas.width + x]) || exclusions.some(poly => insidePolygon(p, poly))) continue;
      let u: number, v: number;
      if (layout.mode === 'repeat') { u = tileCoordinateAt(uv.x * layout.width, m.originX, m.artworkWidth, !!layout.mirror); v = tileCoordinateAt(uv.y * layout.height, m.originY, m.artworkHeight, !!layout.mirror); }
      else { u = (uv.x * layout.width - (layout.width - m.artworkWidth) / 2) / m.artworkWidth; v = (uv.y * layout.height - (layout.height - m.artworkHeight) / 2) / m.artworkHeight; }
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const tx = Math.min(texture.width - 1, Math.floor(u * texture.width)), ty = Math.min(texture.height - 1, Math.floor(v * texture.height));
      const source = (ty * texture.width + tx) * 4, dest = (y * canvas.width + x) * 4;
      const alpha = texels[source + 3] / 255;
      for (let c = 0; c < 3; c++) result.data[dest + c] = Math.round(texels[source + c] * alpha + result.data[dest + c] * (1 - alpha));
    }
  }
  ctx.putImageData(result, 0, 0);
  return canvas;
}

/**
 * The flat print master as it will print across the whole wall: the tile
 * repeated (flipped on alternate tiles when the layout mirrors) or the mural
 * fitted, on a canvas in the wall's proportions. This is what "pattern scale"
 * changes, so the flat pane shows it; the generated tile itself is unchanged.
 */
export async function renderFlatWall(artworkUrl: string, layout: WallLayout, maxPx = 1800): Promise<HTMLCanvasElement> {
  const art = await loadWallImage(artworkUrl);
  const aspect = art.naturalWidth / art.naturalHeight;
  const m = layoutMetrics(layout, aspect);
  const scale = maxPx / Math.max(layout.width, layout.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.width * scale)); canvas.height = Math.max(1, Math.round(layout.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tw = m.artworkWidth * scale, th = m.artworkHeight * scale;
  if (layout.mode === 'repeat') {
    // Tile (0, 0) sits at the origin: the wall's corner, or centred when the
    // tile is larger than the wall (a mural scaled past 100%).
    const ox = m.originX * scale, oy = m.originY * scale;
    for (let row = 0; oy + row * th < canvas.height; row++) {
      for (let col = 0; ox + col * tw < canvas.width; col++) {
        const flipX = !!layout.mirror && col % 2 === 1, flipY = !!layout.mirror && row % 2 === 1;
        ctx.save();
        ctx.translate(ox + col * tw + (flipX ? tw : 0), oy + row * th + (flipY ? th : 0));
        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        ctx.drawImage(art, 0, 0, tw, th);
        ctx.restore();
      }
    }
  } else {
    ctx.drawImage(art, (canvas.width - tw) / 2, (canvas.height - th) / 2, tw, th);
  }
  return canvas;
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not export the preview.')), 'image/png'));
}
