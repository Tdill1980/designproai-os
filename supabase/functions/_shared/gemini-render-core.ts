/**
 * gemini-render-core.ts — Shared helper for non-automotive edge functions.
 *
 * Extracted from the 4-tier Gemini fallback pattern used by generate-color-render.
 * This file is imported by render-motorcycle, render-boat, render-bus, and render-rv
 * so they can reuse the battle-tested Gemini call loop, quality gate, and upload flow
 * WITHOUT modifying the locked generate-color-render/index.ts.
 *
 * Key rule: this file does NOT import from any locked file. It imports studio text
 * from _shared/studio-os.ts via the per-type prompt builders, not from here.
 */

import { getGeminiKey } from "./gemini-key-pool.ts";

const PRIMARY_MODEL = "gemini-3-pro-image-preview";
const FLASH_MODEL = "gemini-3.1-flash-image-preview";

// ---------------------------------------------------------------------------
// Quality Gate — rejects blank/corrupt/solid-color frames
// ---------------------------------------------------------------------------
export function checkImageQuality(base64Data: string): { pass: boolean; reason?: string } {
  try {
    const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
    if (bytes.byteLength < 50_000) {
      return { pass: false, reason: `Image too small (${bytes.byteLength} bytes)` };
    }
    const sampleSize = Math.min(10_000, bytes.byteLength);
    const sample = bytes.slice(bytes.byteLength - sampleSize);
    const uniqueValues = new Set(sample);
    if (uniqueValues.size < 20) {
      return { pass: false, reason: `Low pixel variance (${uniqueValues.size} unique values)` };
    }
    return { pass: true };
  } catch (err) {
    return { pass: false, reason: `Quality check error: ${err}` };
  }
}

// ---------------------------------------------------------------------------
// Gemini image generation with 4-tier fallback
// ---------------------------------------------------------------------------

export interface GeminiImagePart {
  label: string;
  inlineData: { mimeType: string; data: string };
}

export interface GeminiRenderOptions {
  prompt: string;
  imageParts?: GeminiImagePart[];
  aspectRatio?: string;
  imageSize?: string;
  viewLabel?: string;
}

export interface GeminiRenderResult {
  success: boolean;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
  tier?: number;
  model?: string;
}

/**
 * Calls Gemini image generation with a 4-tier fallback ladder.
 * Tier 1: Full payload (prompt + all images)
 * Tier 2: Truncated prompt + kept images
 * Tier 3: Short prompt, IMAGE-only modality
 * Tier 4: Flash model fallback, short prompt
 */
export async function callGeminiImageGen(opts: GeminiRenderOptions): Promise<GeminiRenderResult> {
  const { prompt, imageParts = [], aspectRatio = "16:9", imageSize = "4K", viewLabel = "render" } = opts;
  const totalTiers = 4;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= totalTiers; attempt++) {
    try {
      let currentModel: string;
      let currentModalities: string[];
      let requestParts: any[];

      if (attempt === 1) {
        requestParts = [{ text: prompt }, ...imageParts.map(p => ({ inlineData: p.inlineData }))];
        currentModel = PRIMARY_MODEL;
        currentModalities = ["TEXT", "IMAGE"];
      } else if (attempt === 2) {
        const truncated = prompt.substring(0, 2000);
        requestParts = [{ text: truncated }, ...imageParts.map(p => ({ inlineData: p.inlineData }))];
        currentModel = PRIMARY_MODEL;
        currentModalities = ["TEXT", "IMAGE"];
      } else if (attempt === 3) {
        const short = ("[GENERATE IMAGE] " + prompt).substring(0, 1000);
        requestParts = [{ text: short }, ...imageParts.map(p => ({ inlineData: p.inlineData }))];
        currentModel = PRIMARY_MODEL;
        currentModalities = ["IMAGE"];
      } else {
        const short = ("[GENERATE IMAGE] " + prompt).substring(0, 1000);
        requestParts = [{ text: short }, ...imageParts.map(p => ({ inlineData: p.inlineData }))];
        currentModel = FLASH_MODEL;
        currentModalities = ["IMAGE"];
      }

      console.log(`🎯 [${viewLabel}] Gemini attempt ${attempt}/${totalTiers}: model=${currentModel}, promptLen=${(requestParts[0] as any).text.length}, images=${imageParts.length}`);

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${getGeminiKey()}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: requestParts }],
          generationConfig: {
            responseModalities: currentModalities,
            imageConfig: { aspectRatio, imageSize },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${viewLabel}] Gemini HTTP error tier ${attempt}:`, errorText.substring(0, 500));
        if (response.status === 429 && attempt < totalTiers) {
          // Short backoff: the retry rotates to the NEXT key in the pool, so a
          // per-key rate limit doesn't warrant a long wait (was 5000 * attempt).
          await new Promise(r => setTimeout(r, 1500 * attempt));
          continue;
        }
        if (response.status === 403) {
          return { success: false, error: "API key invalid or quota exceeded" };
        }
        throw new Error(`Gemini HTTP ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        const msg = data.error.message || "Unknown Gemini error";
        console.error(`[${viewLabel}] Gemini error tier ${attempt}:`, msg);
        if (msg.includes("blocked") || msg.includes("SAFETY")) {
          return { success: false, error: "Image generation blocked. Please try a different prompt." };
        }
        if (attempt < totalTiers) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
          continue;
        }
        throw new Error(`Gemini error: ${msg}`);
      }

      const parts = data.candidates?.[0]?.content?.parts;
      if (!parts || parts.length === 0) {
        if (attempt < totalTiers) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
          continue;
        }
        throw new Error("No parts in Gemini response");
      }

      let imageBase64: string | null = null;
      let mimeType = "image/png";
      for (const part of parts) {
        if (part.inlineData) {
          imageBase64 = part.inlineData.data;
          mimeType = part.inlineData.mimeType || "image/png";
          break;
        }
      }

      if (!imageBase64) {
        console.warn(`[${viewLabel}] No image in response tier ${attempt} — escalating`);
        if (attempt < totalTiers) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
          continue;
        }
        throw new Error("No image generated after 4-tier fallback");
      }

      const quality = checkImageQuality(imageBase64);
      if (!quality.pass) {
        console.warn(`[${viewLabel}] Quality gate failed tier ${attempt}: ${quality.reason}`);
        if (attempt < totalTiers) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        console.warn(`[${viewLabel}] Accepting low-quality image on final tier`);
      }

      console.log(`✅ [${viewLabel}] Gemini success tier ${attempt}`);
      return { success: true, imageBase64, mimeType, tier: attempt, model: currentModel };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[${viewLabel}] Tier ${attempt} exception:`, lastError.message);
      if (attempt < totalTiers) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }

  return { success: false, error: lastError?.message || "All fallback tiers exhausted" };
}

// ---------------------------------------------------------------------------
// Upload rendered image to Supabase storage
// ---------------------------------------------------------------------------

export interface UploadOptions {
  supabase: any;
  imageBase64: string;
  mimeType?: string;
  userId: string | null;
  modeType: string;
  vehicleMake: string;
  vehicleModel: string;
  viewType: string;
}

export async function uploadRenderToStorage(opts: UploadOptions): Promise<string> {
  const { supabase, imageBase64, userId, modeType, vehicleMake, vehicleModel, viewType } = opts;
  const buffer = Uint8Array.from(atob(imageBase64), c => c.charCodeAt(0));
  const timestamp = Date.now();
  const userPrefix = userId ? `${userId}/` : "";
  const safeMake = (vehicleMake || "vehicle").replace(/[^a-zA-Z0-9]/g, "_");
  const safeModel = (vehicleModel || "model").replace(/[^a-zA-Z0-9]/g, "_");
  const fileName = `renders/${userPrefix}${modeType}/${timestamp}_${safeMake}_${safeModel}_${viewType}.png`;

  const { error: uploadError } = await supabase.storage
    .from("wrap-files")
    .upload(fileName, buffer, { contentType: "image/png", upsert: false });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(fileName);
  return publicUrl;
}

// ---------------------------------------------------------------------------
// Save render record to vehicle_renders (legacy tracking table)
// ---------------------------------------------------------------------------

export interface SaveRenderOptions {
  supabase: any;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  modeType: string;
  renderUrl: string;
  colorData: any;
}

export async function saveRenderRecord(opts: SaveRenderOptions): Promise<string | null> {
  const { supabase, vehicleYear, vehicleMake, vehicleModel, modeType, renderUrl, colorData } = opts;
  try {
    const { data, error } = await supabase
      .from("vehicle_renders")
      .insert({
        vehicle_year: vehicleYear,
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel,
        mode_type: modeType,
        render_url: renderUrl,
        color_data: colorData || {},
      })
      .select()
      .single();

    if (error) {
      console.error("vehicle_renders insert error:", error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error("saveRenderRecord exception:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// CORS headers (match generate-color-render convention)
// ---------------------------------------------------------------------------

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
