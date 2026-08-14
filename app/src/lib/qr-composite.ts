import QRCode from "qrcode";

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface QrCompositeOptions {
  /** QR size as a fraction of the render width. Default 0.13. */
  sizeFraction?: number;
  /** Horizontal inset from the right edge, as a fraction of width. Default 0.05. */
  rightFraction?: number;
  /** Vertical inset from the bottom edge, as a fraction of height. Default 0.10. */
  bottomFraction?: number;
}

/**
 * Generates a real, scannable QR code and composites it onto a rendered wrap
 * image at the reserved rear-quarter zone (lower-right by default — the rear of
 * a left-facing studio render). Returns a PNG data URL.
 *
 * This is a flat overlay for the hero/display image only — it must NOT replace
 * the storage URL that the multi-view pipeline clones from.
 */
export async function compositeQrOnRender(
  renderUrl: string,
  qrData: string,
  opts: QrCompositeOptions = {},
): Promise<string> {
  const sizeFraction = opts.sizeFraction ?? 0.13;
  const rightFraction = opts.rightFraction ?? 0.05;
  const bottomFraction = opts.bottomFraction ?? 0.1;

  const img = await loadImage(renderUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const qrPx = Math.round(canvas.width * sizeFraction);
  const qrDataUrl = await QRCode.toDataURL(qrData, {
    width: qrPx,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
  const qrImg = await loadImage(qrDataUrl);

  const pad = Math.max(4, Math.round(qrPx * 0.08));
  const x = canvas.width - qrPx - Math.round(canvas.width * rightFraction);
  const y = canvas.height - qrPx - Math.round(canvas.height * bottomFraction);

  // White rounded backing plate so the code stays scannable over any artwork.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = Math.round(pad * 1.5);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, x - pad, y - pad, qrPx + pad * 2, qrPx + pad * 2, pad);
  ctx.fill();
  ctx.restore();

  ctx.drawImage(qrImg, x, y, qrPx, qrPx);

  return canvas.toDataURL("image/png");
}
