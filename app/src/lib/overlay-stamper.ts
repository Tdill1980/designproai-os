/**
 * OVERLAY STAMPING UTILITY
 * 
 * ====================================================================
 * THIS FUNCTION IS THE ONLY LEGAL WAY TO EXPORT A RENDER.
 * DO NOT BYPASS. DO NOT DUPLICATE. DO NOT RE-IMPLEMENT ELSEWHERE.
 * ====================================================================
 * 
 * All renders pass through here before download/PDF/share.
 * This ensures deterministic, permanent overlay embedding that
 * cannot be affected by AI variability or UI inconsistencies.
 * 
 * Typography Contract:
 * - Upper-left: Tool name | Font: Poppins | Color: #FFFFFF | Size: 16px | Weight: 600
 * - Bottom-right: Manufacturer + Color/Design | Font: Inter | Color: #FFFFFF | Size: 14px | Weight: 400
 * - Subtle drop shadow for readability on any background
 */

import { getToolLabel, isValidToolKey, type ToolKey } from './tool-registry';

export interface OverlaySpec {
  /** Tool key from registry (e.g., "colorpro", "fadewraps") - PREFERRED */
  toolKey?: ToolKey;
  /** Legacy: free-form tool name - will be mapped to registry if possible */
  toolName?: string;
  /** Manufacturer name (e.g., "3M", "Avery Dennison") */
  manufacturer?: string;
  /** Color or design name (e.g., "Satin Nardo Gray", "Carbon Fiber") */
  colorOrDesignName?: string;
}

// Font loading promises - cached for performance
let poppinsLoaded = false;
let interLoaded = false;

/**
 * Ensures fonts are loaded before drawing
 */
async function ensureFontsLoaded(): Promise<void> {
  if (poppinsLoaded && interLoaded) return;

  try {
    // Check if fonts are available via document.fonts API
    if (document.fonts) {
      await document.fonts.ready;
      
      // Verify Poppins is loaded
      if (document.fonts.check('500 16px Poppins')) {
        poppinsLoaded = true;
      }
      
      // Verify Inter is loaded
      if (document.fonts.check('300 14px Inter')) {
        interLoaded = true;
      }
    }
  } catch (error) {
    console.warn('Font loading check failed, proceeding with fallbacks:', error);
  }
}

/**
 * Loads an image from URL and returns an HTMLImageElement.
 * Fetches as blob first to avoid CORS canvas tainting issues with Supabase Storage.
 */
async function loadImage(url: string): Promise<HTMLImageElement> {
  // Fetch as blob to avoid canvas taint from cross-origin images
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load image blob`));
    };
    img.src = objectUrl;
  });
}

/**
 * Resolves the display label for the tool
 * Priority: toolKey from registry > legacy toolName mapping > fallback
 */
function resolveToolLabel(overlay: OverlaySpec): string {
  // Priority 1: Use toolKey from registry
  if (overlay.toolKey && isValidToolKey(overlay.toolKey)) {
    return getToolLabel(overlay.toolKey);
  }
  
  // Priority 2: Try to map legacy toolName to registry
  if (overlay.toolName) {
    const normalized = overlay.toolName.toLowerCase().replace(/[™®\s]/g, '');
    if (isValidToolKey(normalized as ToolKey)) {
      return getToolLabel(normalized as ToolKey);
    }
    // Return as-is if not in registry (legacy support)
    return overlay.toolName;
  }
  
  // Priority 3: Fallback to platform label
  return 'DesignProAI™';
}

/**
 * Stamps overlay text onto an image and returns a Blob
 * 
 * @param imageUrl - URL of the base render image
 * @param overlay - Overlay specification with tool key/name, manufacturer, color/design name
 * @returns Promise<Blob> - The composited image as an image blob
 *
 * Format behavior:
 *   - 'jpeg' (default): smaller files, fast encode — desktop downloads
 *   - 'png': lossless, bigger — mobile "Save to Photos" flows where
 *     users want the file in their camera roll, not the Downloads folder
 */
export type StampFormat = 'png' | 'jpeg';

/** Hard ceiling for exported PNGs so they re-upload cleanly (VisionBoard etc.
 * reject anything over 10MB). We aim a touch under to leave headroom. */
export const MAX_PNG_BYTES = 9.5 * 1024 * 1024;

/** Draws the base image + overlay text at the given output dimensions. */
function drawStampedCanvas(
  img: HTMLImageElement,
  overlay: OverlaySpec,
  outWidth: number,
  outHeight: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Draw the base image scaled to the target dimensions
  ctx.drawImage(img, 0, 0, outWidth, outHeight);

  // Calculate responsive font sizes based on output dimensions
  // Base: 16px for 1920px width, scale proportionally
  const scaleFactor = Math.max(0.5, Math.min(1.5, outWidth / 1920));
  const toolNameFontSize = Math.round(16 * scaleFactor);
  const labelFontSize = Math.round(14 * scaleFactor);
  const padding = Math.round(12 * scaleFactor);

  // Set text rendering settings — white with subtle shadow for readability
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = Math.round(4 * scaleFactor);
  ctx.shadowOffsetX = Math.round(1 * scaleFactor);
  ctx.shadowOffsetY = Math.round(1 * scaleFactor);
  ctx.fillStyle = '#FFFFFF';

  // Draw tool name (upper-left) - Poppins SemiBold
  const toolLabel = resolveToolLabel(overlay);
  if (toolLabel) {
    ctx.font = `600 ${toolNameFontSize}px Poppins, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(toolLabel, padding, padding);
  }

  // Build bottom label: manufacturer + colorOrDesignName
  const bottomLabel = [overlay.manufacturer, overlay.colorOrDesignName]
    .filter(Boolean)
    .join(' ')
    .trim();

  // Draw bottom label (bottom-right) - Inter Regular
  if (bottomLabel) {
    ctx.font = `400 ${labelFontSize}px Inter, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';

    // Calculate max width (70% of image width)
    const maxWidth = outWidth * 0.7;

    // Measure text and wrap if needed
    const metrics = ctx.measureText(bottomLabel);
    if (metrics.width > maxWidth) {
      // Truncate with ellipsis if too long
      let truncated = bottomLabel;
      while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 10) {
        truncated = truncated.slice(0, -1);
      }
      ctx.fillText(truncated + '...', outWidth - padding, outHeight - padding);
    } else {
      ctx.fillText(bottomLabel, outWidth - padding, outHeight - padding);
    }
  }

  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: StampFormat
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob from canvas'));
        }
      },
      format === 'png' ? 'image/png' : 'image/jpeg',
      format === 'png' ? undefined : 0.92
    );
  });
}

export async function stampOverlayOnImage(
  imageUrl: string,
  overlay: OverlaySpec,
  format: StampFormat = 'jpeg',
  maxBytes?: number
): Promise<Blob> {
  // Ensure fonts are loaded
  await ensureFontsLoaded();

  // Load the base image
  const img = await loadImage(imageUrl);

  let width = img.naturalWidth;
  let height = img.naturalHeight;

  let blob = await canvasToBlob(drawStampedCanvas(img, overlay, width, height), format);

  // Enforce a max file size (used for PNG downloads that get re-uploaded to
  // surfaces with a 10MB limit). PNG is lossless, so the only lever is
  // dimensions — progressively downscale and re-encode until we fit.
  if (maxBytes && blob.size > maxBytes) {
    for (let attempt = 0; attempt < 8 && blob.size > maxBytes; attempt++) {
      // Scale area proportionally to the overshoot, with a 0.85 floor per
      // step so we converge smoothly rather than collapsing the image.
      const ratio = Math.min(0.85, Math.sqrt(maxBytes / blob.size));
      width = Math.max(640, Math.round(width * ratio));
      height = Math.max(360, Math.round(height * ratio));
      blob = await canvasToBlob(drawStampedCanvas(img, overlay, width, height), format);
      if (width <= 640 || height <= 360) break;
    }
  }

  return blob;
}

/**
 * Stamps overlay and returns as base64 data URL (for PDF embedding)
 */
export async function stampOverlayAsDataUrl(
  imageUrl: string,
  overlay: OverlaySpec
): Promise<string> {
  const blob = await stampOverlayOnImage(imageUrl, overlay);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to data URL'));
      }
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}
