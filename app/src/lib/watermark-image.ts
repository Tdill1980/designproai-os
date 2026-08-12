/**
 * Canvas-based image watermarking for batch renders.
 *
 * Adds text overlays:
 *   - Top-left: tool name (e.g. "ColorPro™")
 *   - Bottom-right: color/pattern label (e.g. "3M Hot Rod Red" or "Timber Ridge Camo")
 *
 * Returns a Blob of the watermarked PNG.
 */

export interface WatermarkOptions {
  /** Text for top-left corner (tool name) */
  topLeft: string;
  /** Text for bottom-right corner (manufacturer + color name, or pattern name) */
  bottomRight: string;
}

/**
 * Load an image from a URL with CORS enabled.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Draw watermark text on a canvas context.
 * Uses white semi-bold text with a subtle dark shadow for readability.
 */
function drawWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: WatermarkOptions,
) {
  // Scale font size relative to image dimensions (target ~2.5% of width)
  const fontSize = Math.max(16, Math.round(width * 0.025));
  const padding = Math.round(fontSize * 1.2);

  ctx.textBaseline = "top";
  ctx.font = `600 ${fontSize}px "Poppins", "Inter", "Helvetica Neue", Arial, sans-serif`;

  // Dark shadow behind text for legibility on any background
  ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
  ctx.shadowBlur = Math.round(fontSize * 0.3);
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = "#FFFFFF";

  // ── Top-left: tool name ──
  if (options.topLeft) {
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(options.topLeft, padding, padding);
  }

  // ── Bottom-right: color/pattern label ──
  if (options.bottomRight) {
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(options.bottomRight, width - padding, height - padding);
  }

  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
}

/**
 * Download an image, burn watermark text onto it, and return a PNG Blob.
 */
export async function watermarkImage(
  imageUrl: string,
  options: WatermarkOptions,
): Promise<Blob> {
  const img = await loadImage(imageUrl);

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");

  // Draw original image
  ctx.drawImage(img, 0, 0);

  // Apply watermark
  drawWatermark(ctx, canvas.width, canvas.height, options);

  // Convert to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob returned null"));
      },
      "image/png",
      1.0,
    );
  });
}

/**
 * Watermark an image and upload the result to Supabase Storage.
 * Returns the public URL of the watermarked image.
 */
export async function watermarkAndUpload(
  imageUrl: string,
  options: WatermarkOptions,
  supabaseClient: any,
  bucket = "color-renders",
): Promise<string> {
  const blob = await watermarkImage(imageUrl, options);

  const fileName = `watermarked/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;

  const { error: uploadError } = await supabaseClient.storage
    .from(bucket)
    .upload(fileName, blob, {
      contentType: "image/png",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Watermark upload failed: ${uploadError.message}`);
  }

  const { data: urlData } = supabaseClient.storage
    .from(bucket)
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}
