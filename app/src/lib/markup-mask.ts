/**
 * markup-mask — geometry + rasterization helpers for MarkupIQ (the draw-on-the-
 * render markup tools in RevisionStudioIQ's Precise Edit canvas).
 *
 * MarkupIQ lets the customer draw directly on the actual render instead of
 * uploading a phone photo of a different vehicle. Because the marks land on the
 * real render they are perfectly registered to the truck, which is a far
 * stronger signal than an external reference. Every tool resolves to a MASK so
 * the edit routes through the pixel-locked pipeline (Flux Fill / LayerLift heal)
 * — only the marked region can change, the rest of the vehicle stays
 * bit-for-bit identical. This is what stops "end the wrap at this line" from
 * wiping the entire front end.
 *
 * Tools → mask:
 *   - CutLine  (neon teal): draw the line where the wrap ends, then tap the side
 *              to clear. Flood-fill from the tapped point, bounded by the line
 *              and the image edges → the exact (non-rectangular) region to
 *              repaint to factory paint. {@link cutlineMaskDataUrl}
 *   - Delete   (X): scribble over the thing to remove → bbox mask. {@link bboxFromPoints}
 *   - Move     (circle + arrow): circle the element → bbox mask (lifted), arrow
 *              gives the destination. {@link bboxFromPoints}
 *   - Pen      (sketch): freehand stroke → thick-stroke mask. {@link strokeMaskDataUrl}
 *
 * Coordinates: all geometry helpers work in NORMALIZED image space (0..1) so
 * they are resolution-independent; the raster helpers expand to a capped pixel
 * canvas (Flux resamples the mask to the source image anyway).
 */

/** A point in normalized image space (0..1). */
export interface Pt {
  x: number;
  y: number;
}

/** Bounding box in normalized image coordinates (0..1). */
export interface NormalizedBox {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

/** Longest side of a generated mask in pixels. Flux Fill resamples the mask to
 *  the source resolution, so the mask itself doesn't need to be full-res — a
 *  capped canvas keeps flood-fill fast while staying crisp. */
const MASK_MAX_SIDE = 900;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Tight bounding box (normalized) around a set of normalized points, grown by
 * `padPct` on every side and clamped to the image. Used by Delete / Move / Pen
 * where the marked region is well-approximated by a rectangle.
 */
export function bboxFromPoints(pts: Pt[], padPct = 0.015): NormalizedBox {
  if (!pts.length) return { xPct: 0, yPct: 0, wPct: 0, hPct: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x0 = clamp01(minX - padPct);
  const y0 = clamp01(minY - padPct);
  const x1 = clamp01(maxX + padPct);
  const y1 = clamp01(maxY + padPct);
  return { xPct: x0, yPct: y0, wPct: Math.max(0, x1 - x0), hPct: Math.max(0, y1 - y0) };
}

/** Center of a normalized box. */
export function boxCenter(box: NormalizedBox): Pt {
  return { x: box.xPct + box.wPct / 2, y: box.yPct + box.hPct / 2 };
}

/**
 * March a ray from `origin` in direction `dir` to the first edge of the unit
 * square and return that border point (normalized). If `dir` is ~zero the
 * origin is returned unchanged. Used to extend a hand-drawn CutLine so it
 * always touches two borders and fully separates the image into two regions.
 */
export function extendToBorder(origin: Pt, dir: Pt): Pt {
  const ts: number[] = [];
  if (dir.x > 1e-6) ts.push((1 - origin.x) / dir.x);
  if (dir.x < -1e-6) ts.push((0 - origin.x) / dir.x);
  if (dir.y > 1e-6) ts.push((1 - origin.y) / dir.y);
  if (dir.y < -1e-6) ts.push((0 - origin.y) / dir.y);
  const positive = ts.filter((t) => t > 0);
  if (!positive.length) return origin;
  const t = Math.min(...positive);
  return { x: clamp01(origin.x + dir.x * t), y: clamp01(origin.y + dir.y * t) };
}

/** Standard even-odd ray-cast point-in-polygon test (normalized space). */
export function pointInPolygon(pt: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Compute a capped mask canvas size that preserves the source aspect ratio. */
function maskDims(imgW: number, imgH: number): { w: number; h: number } {
  const longest = Math.max(imgW, imgH) || 1;
  const scale = longest > MASK_MAX_SIDE ? MASK_MAX_SIDE / longest : 1;
  return { w: Math.max(1, Math.round(imgW * scale)), h: Math.max(1, Math.round(imgH * scale)) };
}

function canvasToBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png").split(",")[1];
}

/**
 * White rectangle on black — the mask for Delete / Move / Pen-bbox tools.
 * Returns base64 (no data: prefix), ready for segment-click's manualMaskBase64.
 */
export function boxMaskBase64(box: NormalizedBox, imgW: number, imgH: number): string {
  const { w, h } = maskDims(imgW, imgH);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#FFF";
  ctx.fillRect(
    Math.round(box.xPct * w),
    Math.round(box.yPct * h),
    Math.max(1, Math.round(box.wPct * w)),
    Math.max(1, Math.round(box.hPct * h)),
  );
  return canvasToBase64(canvas);
}

/**
 * Thick freehand stroke as a white-on-black mask — the Pen (sketch) tool. The
 * stroke is dilated by `widthPct` of the image's longest side so the masked
 * band is wide enough for Flux to repaint cleanly.
 */
export function strokeMaskBase64(
  stroke: Pt[],
  imgW: number,
  imgH: number,
  widthPct = 0.06,
): string {
  const { w, h } = maskDims(imgW, imgH);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if (stroke.length) {
    ctx.strokeStyle = "#FFF";
    ctx.fillStyle = "#FFF";
    ctx.lineWidth = Math.max(2, widthPct * Math.max(w, h));
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(stroke[0].x * w, stroke[0].y * h);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x * w, stroke[i].y * h);
    if (stroke.length === 1) {
      ctx.arc(stroke[0].x * w, stroke[0].y * h, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.stroke();
    }
  }
  return canvasToBase64(canvas);
}

/**
 * CutLine mask: the customer draws the line where the wrap should end, then taps
 * the side that should become factory paint. We extend the line to both image
 * borders so it fully divides the frame, rasterize it as a barrier, then
 * flood-fill outward from the tapped point. Everything reachable from the tap
 * WITHOUT crossing the line becomes the mask — the exact region to clear, even
 * when it's a diagonal triangle a rectangle could never capture.
 *
 * Returns base64 (no data: prefix), or null if the tap fell on the line itself.
 */
export function cutlineMaskBase64(
  line: Pt[],
  tap: Pt,
  imgW: number,
  imgH: number,
): string | null {
  if (line.length < 2) return null;
  const { w, h } = maskDims(imgW, imgH);

  // Extend the first/last segments out to the image border so the barrier runs
  // edge-to-edge and cleanly separates the two sides.
  const startDir = { x: line[0].x - line[1].x, y: line[0].y - line[1].y };
  const endDir = {
    x: line[line.length - 1].x - line[line.length - 2].x,
    y: line[line.length - 1].y - line[line.length - 2].y,
  };
  const full: Pt[] = [extendToBorder(line[0], startDir), ...line, extendToBorder(line[line.length - 1], endDir)];

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);

  // Draw the barrier in white. A few px wide so flood-fill can't leak through
  // antialiased gaps, but thin enough not to swallow real area.
  const barrierW = Math.max(2, Math.round(Math.max(w, h) * 0.006));
  ctx.strokeStyle = "#FFF";
  ctx.lineWidth = barrierW;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(full[0].x * w, full[0].y * h);
  for (let i = 1; i < full.length; i++) ctx.lineTo(full[i].x * w, full[i].y * h);
  ctx.stroke();

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const isBarrier = (i: number) => px[i * 4] > 127; // red channel; white barrier

  // Flood fill (4-connectivity) from the tapped pixel, stopping at the barrier
  // and the canvas edges.
  let startX = Math.round(clamp01(tap.x) * (w - 1));
  let startY = Math.round(clamp01(tap.y) * (h - 1));
  let startIdx = startY * w + startX;
  if (isBarrier(startIdx)) {
    // Nudge off the line by scanning a small neighborhood for a free pixel.
    let found = -1;
    for (let r = 1; r <= 8 && found < 0; r++) {
      for (let dy = -r; dy <= r && found < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = startX + dx;
          const ny = startY + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!isBarrier(ni)) {
            found = ni;
            startX = nx;
            startY = ny;
            break;
          }
        }
      }
    }
    if (found < 0) return null;
    startIdx = found;
  }

  const region = new Uint8Array(w * h);
  const stack: number[] = [startIdx];
  region[startIdx] = 1;
  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;
    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < w - 1 ? idx + 1 : -1,
      y > 0 ? idx - w : -1,
      y < h - 1 ? idx + w : -1,
    ];
    for (const n of neighbors) {
      if (n < 0 || region[n] || isBarrier(n)) continue;
      region[n] = 1;
      stack.push(n);
    }
  }

  // Paint the result: white = filled region (the area to clear), black = rest.
  // The barrier line itself stays black so it isn't included in the edit.
  for (let i = 0; i < w * h; i++) {
    const v = region[i] ? 255 : 0;
    px[i * 4] = v;
    px[i * 4 + 1] = v;
    px[i * 4 + 2] = v;
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvasToBase64(canvas);
}
