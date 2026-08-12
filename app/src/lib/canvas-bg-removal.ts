/**
 * Canvas View — client-side background removal using @imgly/background-removal.
 * Runs an ONNX model in-browser via WebAssembly. Zero server cost.
 *
 * Flow:
 *   1. Check Supabase Storage for cached canvas version
 *   2. If cached, return the public URL
 *   3. If not, run bg removal in browser, composite onto white, upload, return URL
 */

import { removeBackground } from "@imgly/background-removal";
import { supabase } from "@/integrations/supabase/client";

const CANVAS_BUCKET = "canvas-renders";

/**
 * Get or generate a white-canvas version of a render.
 * Returns the public URL of the canvas image.
 */
export async function getCanvasVersion(
  originalUrl: string,
  cacheKey: string,
  onProgress?: (stage: string) => void,
): Promise<string> {
  // 1. Check cache
  const storagePath = `${cacheKey}.png`;
  const { data: existing } = supabase.storage
    .from(CANVAS_BUCKET)
    .getPublicUrl(storagePath);

  if (existing?.publicUrl) {
    // Verify the file actually exists with a HEAD request
    try {
      const head = await fetch(existing.publicUrl, { method: "HEAD" });
      if (head.ok) return existing.publicUrl;
    } catch {
      // Not cached, continue to generate
    }
  }

  // 2. Remove background
  onProgress?.("Removing background...");
  const transparentBlob = await removeBackground(originalUrl, {
    output: { format: "image/png", quality: 1 },
  });

  // 3. Composite onto white canvas
  onProgress?.("Compositing...");
  const canvasBlob = await compositeOnWhite(transparentBlob);

  // 4. Upload to Supabase Storage
  onProgress?.("Caching...");
  const { error: uploadErr } = await supabase.storage
    .from(CANVAS_BUCKET)
    .upload(storagePath, canvasBlob, {
      contentType: "image/png",
      upsert: true,
    });

  if (uploadErr) {
    // If upload fails (bucket missing, permissions, etc.), return a local blob URL
    console.warn("[canvas-bg-removal] Upload failed, using local blob:", uploadErr.message);
    return URL.createObjectURL(canvasBlob);
  }

  const { data: publicUrlData } = supabase.storage
    .from(CANVAS_BUCKET)
    .getPublicUrl(storagePath);

  return publicUrlData.publicUrl;
}

/**
 * Composite a transparent PNG blob onto a white background.
 */
async function compositeOnWhite(transparentBlob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(transparentBlob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d")!;
  // White background
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Draw the vehicle cutout on top
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), "image/png");
  });
}
