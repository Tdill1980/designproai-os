/**
 * Print Production OS - Post-Process Bridge
 *
 * Transforms raw Gemini AI flat-panel output into production-ready panel images.
 * This is the processing pipeline between AI generation and ProductionOS:
 *
 *   AI Output → Validate → Upscale 4× → Resize → Sharpen → Add Bleed → ProductionOS
 *
 * Client-side operations (Canvas-based):
 *   - Aspect ratio validation
 *   - Resize to exact WPW pixel dimensions
 *   - Unsharp mask sharpening
 *   - Mirror-edge bleed extension
 *
 * Server-side operations (via Supabase Edge Functions):
 *   - Real-ESRGAN 4× upscale (Replicate API)
 *
 * The bridge is designed to run in the browser. Heavy operations (upscale)
 * are delegated to edge functions. Light operations (resize, sharpen, bleed)
 * use HTML5 Canvas for instant feedback.
 */

import { supabase } from '@/integrations/supabase/client';
import { validateAspectRatio, getTargetPixels, getTargetPixelsWithBleed } from './aspect-ratios';
import { WRAP_DPI, STANDARD_BLEED, SCALE_FACTORS } from './constants';
import type { DPI, BleedSpec } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PanelProcessConfig {
  /** Panel width in inches */
  widthInches: number;
  /** Panel height in inches */
  heightInches: number;
  /** Expected aspect ratio string from Gemini (e.g., "40:12") */
  expectedRatio: string;
  /** Panel label for logging */
  label: string;
  /** Whether to run Real-ESRGAN 4× upscale (default: true) */
  upscaleEnabled?: boolean;
  /** Sharpen amount 0.0–1.0 (default: 0.3) */
  sharpenAmount?: number;
  /** Bleed in inches per edge (default: 0.5") */
  bleedInches?: number;
  /** Output DPI (default: 150) */
  dpi?: DPI;
  /** Output scale (default: '10%') */
  scale?: string;
}

export interface ProcessedPanel {
  /** Final image as Blob */
  blob: Blob;
  /** Blob URL for display/download */
  blobUrl: string;
  /** Pixel dimensions of the trim area (no bleed) */
  trimPixels: { width: number; height: number };
  /** Pixel dimensions including bleed */
  totalPixels: { width: number; height: number };
  /** Whether the AI output passed aspect ratio validation */
  aspectRatioValid: boolean;
  /** Whether upscaling was applied */
  upscaled: boolean;
  /** Processing metadata */
  metadata: {
    inputSize: { width: number; height: number };
    outputSize: { width: number; height: number };
    steps: string[];
    durationMs: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  actualWidth: number;
  actualHeight: number;
  actualRatio: number;
  expectedRatio: number;
  deviation: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Step 1: Validate AI Output
// ---------------------------------------------------------------------------

/**
 * Validate that the AI-generated image matches the expected panel aspect ratio.
 * Loads the image to check its actual pixel dimensions against the expected ratio.
 *
 * @param imageBlob  Raw AI output image
 * @param expectedRatio  Expected ratio string (e.g., "40:12")
 * @param tolerance  Max deviation allowed (default: 5%)
 */
export async function validateAiOutput(
  imageBlob: Blob,
  expectedRatio: string,
  tolerance: number = 0.05,
): Promise<ValidationResult> {
  const img = await loadBlobAsImage(imageBlob);
  const result = validateAspectRatio(img.width, img.height, expectedRatio, tolerance);

  return {
    valid: result.valid,
    actualWidth: img.width,
    actualHeight: img.height,
    actualRatio: result.actualRatio,
    expectedRatio: result.expectedNumeric,
    deviation: result.deviation,
    message: result.valid
      ? `Aspect ratio OK: ${result.actualRatio} (expected ${result.expectedNumeric}, deviation ${(result.deviation * 100).toFixed(1)}%)`
      : `Aspect ratio MISMATCH: ${result.actualRatio} vs expected ${result.expectedNumeric} (deviation ${(result.deviation * 100).toFixed(1)}% exceeds ${(tolerance * 100)}% tolerance)`,
  };
}

// ---------------------------------------------------------------------------
// Step 2: Upscale 4× via Real-ESRGAN
// ---------------------------------------------------------------------------

/**
 * Upscale an image 4× using Real-ESRGAN via the quick-prep-upscale edge function.
 * Falls back to the original image if the upscale fails.
 *
 * quick-prep-upscale interface:
 *   Input:  { file_url, user_id?, file_name?, step_key?, options?: { scale } }
 *   Output: { success, file_url, output_url, original, upscaled, scale, method }
 *
 * @param imageBlob  Input image
 * @returns Upscaled image blob (or original on failure)
 */
export async function upscale4x(
  imageBlob: Blob,
): Promise<{ blob: Blob; upscaled: boolean }> {
  try {
    // Upload to temporary storage so the edge function can fetch it via URL
    const timestamp = Date.now();
    const tempFileName = `bridge-temp/${timestamp}/upscale-input.png`;

    const { error: uploadError } = await supabase.storage
      .from('wrap-files')
      .upload(tempFileName, imageBlob, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      console.warn('[PostProcess] Upload for upscale failed:', uploadError.message);
      return { blob: imageBlob, upscaled: false };
    }

    // Get public URL for the uploaded file (quick-prep-upscale fetches via URL)
    const { data: urlData } = supabase.storage
      .from('wrap-files')
      .getPublicUrl(tempFileName);

    if (!urlData?.publicUrl) {
      console.warn('[PostProcess] Could not get public URL for upscale input');
      return { blob: imageBlob, upscaled: false };
    }

    // Call quick-prep-upscale with its expected interface
    const { data, error } = await supabase.functions.invoke('quick-prep-upscale', {
      body: {
        file_url: urlData.publicUrl,
        file_name: `bridge-upscale-${timestamp}`,
        step_key: 'bridge_upscale_4x',
        options: { scale: 4 },
      },
    });

    if (error || !data?.file_url) {
      console.warn('[PostProcess] Upscale edge function failed:', error?.message || 'no file_url in response');
      return { blob: imageBlob, upscaled: false };
    }

    // Fetch the upscaled image from the returned URL
    const upscaledResponse = await fetch(data.file_url);
    if (!upscaledResponse.ok) {
      console.warn('[PostProcess] Failed to fetch upscaled image:', upscaledResponse.status);
      return { blob: imageBlob, upscaled: false };
    }

    const upscaledBlob = await upscaledResponse.blob();
    console.log(`[PostProcess] Upscaled 4× (${data.method || 'unknown'}): ${(upscaledBlob.size / 1024).toFixed(0)} KB`);
    return { blob: upscaledBlob, upscaled: true };
  } catch (err) {
    console.warn('[PostProcess] Upscale error:', err);
    return { blob: imageBlob, upscaled: false };
  }
}

// ---------------------------------------------------------------------------
// Step 3: Resize to Exact WPW Pixel Dimensions
// ---------------------------------------------------------------------------

/**
 * Resize an image to the exact WPW pixel dimensions for a panel.
 * Uses Canvas-based high-quality downscale (browser native).
 *
 * Target pixels = physicalInches × scaleFactor × DPI
 * e.g., Large Side: 200" × 0.10 × 150 = 3,000 × 893 px
 *
 * @param imageBlob     Input image (ideally upscaled)
 * @param targetWidth   Target width in pixels
 * @param targetHeight  Target height in pixels
 */
export async function resizeToExactWpw(
  imageBlob: Blob,
  targetWidth: number,
  targetHeight: number,
): Promise<Blob> {
  const img = await loadBlobAsImage(imageBlob);

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  // Use high-quality image smoothing for downscale
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  return canvasToBlob(canvas, 'image/png');
}

// ---------------------------------------------------------------------------
// Step 4: Sharpen (Unsharp Mask)
// ---------------------------------------------------------------------------

/**
 * Apply unsharp mask sharpening to an image.
 * Sharpening compensates for softness introduced by AI generation and resize.
 *
 * Uses a 3×3 convolution kernel:
 *   [ 0, -a,  0]
 *   [-a, 1+4a, -a]
 *   [ 0, -a,  0]
 *
 * where a = amount (0.0–1.0, default 0.3)
 *
 * @param imageBlob  Input image
 * @param amount     Sharpen strength (0.0–1.0, default: 0.3)
 */
export async function sharpen(
  imageBlob: Blob,
  amount: number = 0.3,
): Promise<Blob> {
  if (amount <= 0) return imageBlob;

  const img = await loadBlobAsImage(imageBlob);
  const { width, height } = img;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, width, height);
  const src = imageData.data;
  const dst = new Uint8ClampedArray(src.length);

  const a = Math.min(1.0, Math.max(0.0, amount));
  const center = 1 + 4 * a;

  // Apply 3×3 unsharp mask kernel
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        // Center pixel weighted + 4 cardinal neighbors
        const val =
          center * src[idx + c]
          - a * src[((y - 1) * width + x) * 4 + c]     // top
          - a * src[((y + 1) * width + x) * 4 + c]     // bottom
          - a * src[(y * width + (x - 1)) * 4 + c]     // left
          - a * src[(y * width + (x + 1)) * 4 + c];    // right
        dst[idx + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
      dst[idx + 3] = src[idx + 3]; // Preserve alpha
    }
  }

  // Copy edge pixels unchanged
  for (let x = 0; x < width; x++) {
    const topIdx = x * 4;
    const botIdx = ((height - 1) * width + x) * 4;
    for (let c = 0; c < 4; c++) {
      dst[topIdx + c] = src[topIdx + c];
      dst[botIdx + c] = src[botIdx + c];
    }
  }
  for (let y = 0; y < height; y++) {
    const leftIdx = (y * width) * 4;
    const rightIdx = (y * width + width - 1) * 4;
    for (let c = 0; c < 4; c++) {
      dst[leftIdx + c] = src[leftIdx + c];
      dst[rightIdx + c] = src[rightIdx + c];
    }
  }

  const output = new ImageData(dst, width, height);
  ctx.putImageData(output, 0, 0);
  return canvasToBlob(canvas, 'image/png');
}

// ---------------------------------------------------------------------------
// Step 5: Add Bleed (Mirror-Edge Extension)
// ---------------------------------------------------------------------------

/**
 * Extend the canvas by bleed amount on all edges using mirror-edge extension.
 *
 * Mirror-edge extension reflects the edge pixels outward to create
 * seamless bleed content. This is the industry standard for bleed
 * when the design doesn't explicitly extend past the trim line.
 *
 * @param imageBlob   Input image (trim area)
 * @param bleedInches Bleed amount per edge (default: 0.5")
 * @param dpi         Target DPI (default: 150)
 * @param scale       Scale factor string (default: '10%')
 */
export async function addBleed(
  imageBlob: Blob,
  bleedInches: number = 0.5,
  dpi: DPI = WRAP_DPI,
  scale: string = '10%',
): Promise<{ blob: Blob; trimWidth: number; trimHeight: number; totalWidth: number; totalHeight: number }> {
  const img = await loadBlobAsImage(imageBlob);
  const trimW = img.width;
  const trimH = img.height;

  const factor = SCALE_FACTORS[scale] || 0.10;
  const bleedPx = Math.round(bleedInches * factor * dpi);

  const totalW = trimW + bleedPx * 2;
  const totalH = trimH + bleedPx * 2;

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = totalH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context not available');

  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, totalW, totalH);

  // Draw the trim image centered (offset by bleed)
  ctx.drawImage(img, bleedPx, bleedPx);

  // Mirror-edge extension: reflect edge strips into bleed area
  // Top bleed: mirror top strip of trim image
  if (bleedPx > 0) {
    ctx.save();
    ctx.translate(bleedPx, bleedPx);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0, trimW, bleedPx, 0, 0, trimW, bleedPx);
    ctx.restore();

    // Bottom bleed: mirror bottom strip
    ctx.save();
    ctx.translate(bleedPx, bleedPx + trimH);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, trimH - bleedPx, trimW, bleedPx, 0, -bleedPx, trimW, bleedPx);
    ctx.restore();

    // Left bleed: mirror left strip
    ctx.save();
    ctx.translate(bleedPx, bleedPx);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, bleedPx, trimH, 0, 0, bleedPx, trimH);
    ctx.restore();

    // Right bleed: mirror right strip
    ctx.save();
    ctx.translate(bleedPx + trimW, bleedPx);
    ctx.scale(-1, 1);
    ctx.drawImage(img, trimW - bleedPx, 0, bleedPx, trimH, -bleedPx, 0, bleedPx, trimH);
    ctx.restore();
  }

  const blob = await canvasToBlob(canvas, 'image/png');
  return { blob, trimWidth: trimW, trimHeight: trimH, totalWidth: totalW, totalHeight: totalH };
}

// ---------------------------------------------------------------------------
// Full Pipeline: processPanel
// ---------------------------------------------------------------------------

/**
 * Run the complete post-processing pipeline on an AI-generated panel image.
 *
 * Pipeline: Validate → Upscale 4× → Resize to WPW → Sharpen → Add Bleed
 *
 * Each step is logged to the steps array for debugging.
 *
 * @param imageBlob  Raw AI output image
 * @param config     Panel configuration
 */
export async function processPanel(
  imageBlob: Blob,
  config: PanelProcessConfig,
): Promise<ProcessedPanel> {
  const startMs = Date.now();
  const steps: string[] = [];
  const dpi = config.dpi || WRAP_DPI;
  const scale = config.scale || '10%';
  const bleedInches = config.bleedInches ?? 0.5;
  const upscaleEnabled = config.upscaleEnabled ?? true;
  const sharpenAmount = config.sharpenAmount ?? 0.3;

  // Get input dimensions
  const inputImg = await loadBlobAsImage(imageBlob);
  const inputSize = { width: inputImg.width, height: inputImg.height };

  // Step 1: Validate aspect ratio
  const validation = await validateAiOutput(imageBlob, config.expectedRatio);
  steps.push(`VALIDATE: ${validation.message}`);

  let current = imageBlob;

  // Step 2: Upscale 4× (optional, server-side)
  let upscaled = false;
  if (upscaleEnabled) {
    const upscaleResult = await upscale4x(current);
    current = upscaleResult.blob;
    upscaled = upscaleResult.upscaled;
    steps.push(`UPSCALE: ${upscaled ? '4× via Real-ESRGAN' : 'skipped (fallback to original)'}`);
  } else {
    steps.push('UPSCALE: disabled');
  }

  // Step 3: Resize to exact WPW pixels
  const target = getTargetPixels(config.widthInches, config.heightInches, dpi, scale);
  current = await resizeToExactWpw(current, target.width, target.height);
  steps.push(`RESIZE: ${target.width}×${target.height}px (${config.widthInches}" × ${config.heightInches}" @ ${scale} / ${dpi} DPI)`);

  // Step 4: Sharpen
  if (sharpenAmount > 0) {
    current = await sharpen(current, sharpenAmount);
    steps.push(`SHARPEN: amount=${sharpenAmount}`);
  }

  // Step 5: Add bleed
  const bleedResult = await addBleed(current, bleedInches, dpi, scale);
  current = bleedResult.blob;
  steps.push(`BLEED: +${bleedInches}" all edges → ${bleedResult.totalWidth}×${bleedResult.totalHeight}px`);

  const blobUrl = URL.createObjectURL(current);
  const durationMs = Date.now() - startMs;
  steps.push(`DONE: ${durationMs}ms total`);

  return {
    blob: current,
    blobUrl,
    trimPixels: target,
    totalPixels: { width: bleedResult.totalWidth, height: bleedResult.totalHeight },
    aspectRatioValid: validation.valid,
    upscaled,
    metadata: {
      inputSize,
      outputSize: { width: bleedResult.totalWidth, height: bleedResult.totalHeight },
      steps,
      durationMs,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadBlobAsImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image from blob'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      type,
      1.0,
    );
  });
}
