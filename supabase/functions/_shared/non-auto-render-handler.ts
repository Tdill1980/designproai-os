/**
 * non-auto-render-handler.ts — Shared request handler for render-<type> edge functions.
 *
 * Each of render-motorcycle, render-boat, render-bus, render-rv is just a
 * thin wrapper that sets its vehicle class and delegates to this handler.
 * Centralizing the flow here keeps the 4 edge functions nearly identical
 * (and bug fixes land in one place).
 *
 * Flow:
 *   1. Parse + validate the request body (same shape as generate-color-render)
 *   2. Fetch vehicle specs via Google-grounded lookup (cached)
 *   3. Build the class-specific prompt (imports studio-os.ts, which is locked
 *      but allowed to import)
 *   4. Call Gemini with the 4-tier fallback
 *   5. Upload the PNG to Supabase storage
 *   6. Insert a vehicle_renders record
 *   7. Return { renderUrl, renderId, requiresValidation, vehicleSpecsId, ... }
 *
 * The response shape is a SUPERSET of generate-color-render's response so the
 * frontend can treat it interchangeably — with the addition of validation
 * metadata for the proof-stage warning banner.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callGeminiImageGen, uploadRenderToStorage, saveRenderRecord, corsHeaders } from "./gemini-render-core.ts";
import { resolveUniversalVehicleSpecs, type VehicleClass } from "./vehicle-specs-universal.ts";
import {
  buildMotorcyclePrompt,
  buildBoatPrompt,
  buildBusPrompt,
  buildRvPrompt,
  buildTrailerPrompt,
  type NonAutoPromptInput,
} from "./non-auto-prompts.ts";

// ---------------------------------------------------------------------------
// Supported classes
// ---------------------------------------------------------------------------

export const NON_AUTO_CLASSES = ["motorcycle", "boat", "bus", "rv", "trailer"] as const;
export type NonAutoClass = typeof NON_AUTO_CLASSES[number];

// ---------------------------------------------------------------------------
// Prompt builder lookup
// ---------------------------------------------------------------------------

const PROMPT_BUILDERS: Record<NonAutoClass, (input: NonAutoPromptInput) => string> = {
  motorcycle: buildMotorcyclePrompt,
  boat: buildBoatPrompt,
  bus: buildBusPrompt,
  rv: buildRvPrompt,
  trailer: buildTrailerPrompt,
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleNonAutoRender(req: Request, vehicleClass: NonAutoClass): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      vehicleYear,
      vehicleMake,
      vehicleModel,
      colorData,
      modeType = "ColorPro",
      viewType = "side",
      userEmail,
      customStylingPrompt,
    } = body;

    if (!vehicleMake || !vehicleModel) {
      return jsonResponse({ error: "vehicleMake and vehicleModel are required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://kfapjdyythzyvnpdeghu.supabase.co";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Resolve authenticated user (optional — renders can be anonymous in some flows)
    let authenticatedUserId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      try {
        const token = authHeader.substring(7);
        const { data } = await supabase.auth.getUser(token);
        authenticatedUserId = data?.user?.id || null;
      } catch {
        // Non-fatal — continue as anonymous
      }
    }

    // 2. Google-grounded vehicle specs lookup (cached)
    console.log(`[render-${vehicleClass}] Looking up specs for ${vehicleYear} ${vehicleMake} ${vehicleModel}`);
    const specs = await resolveUniversalVehicleSpecs(
      supabase,
      vehicleClass as VehicleClass,
      vehicleYear || "",
      vehicleMake,
      vehicleModel,
    );
    console.log(`[render-${vehicleClass}] Specs resolved (cached=${specs.cached}, confidence=${specs.confidence})`);

    // 3. Build class-specific prompt
    const promptBuilder = PROMPT_BUILDERS[vehicleClass];
    const prompt = promptBuilder({
      vehicleYear: vehicleYear || "",
      vehicleMake,
      vehicleModel,
      viewType,
      specs,
      colorData,
      modeType,
      customStylingPrompt,
    });

    console.log(`[render-${vehicleClass}] Prompt built (${prompt.length} chars), calling Gemini...`);

    // 4. Gemini image generation with 4-tier fallback
    const result = await callGeminiImageGen({
      prompt,
      imageParts: [],
      aspectRatio: "16:9",
      imageSize: "4K",
      viewLabel: `${vehicleClass}-${viewType}`,
    });

    if (!result.success || !result.imageBase64) {
      return jsonResponse(
        { error: result.error || "Image generation failed after all fallback tiers" },
        503,
      );
    }

    // 5. Upload to storage
    const publicUrl = await uploadRenderToStorage({
      supabase,
      imageBase64: result.imageBase64,
      mimeType: result.mimeType,
      userId: authenticatedUserId,
      modeType: `${modeType}-${vehicleClass}`,
      vehicleMake,
      vehicleModel,
      viewType,
    });

    console.log(`[render-${vehicleClass}] Uploaded: ${publicUrl}`);

    // 6. Save legacy render record
    const renderId = await saveRenderRecord({
      supabase,
      vehicleYear: vehicleYear || "",
      vehicleMake,
      vehicleModel,
      modeType: `${modeType}-${vehicleClass}`,
      renderUrl: publicUrl,
      colorData: { ...colorData, vehicle_class: vehicleClass, sub_type: specs.sub_type },
    });

    // 7. Return response — SUPERSET of generate-color-render's shape
    // The extra fields (requiresValidation, vehicleSpecsId, confidence) power
    // the proof-stage warning banner in the frontend.
    return jsonResponse({
      renderUrl: publicUrl,
      renderId: renderId,
      cached: false,
      vehicleClass,
      vehicleSubType: specs.sub_type,
      vehicleSpecsId: specs.id,
      dimensions: specs.dimensions,
      panels: specs.panels,
      confidence: specs.confidence,
      sourceUrls: specs.source_urls,
      requiresValidation: specs.requires_validation,
      tier: result.tier,
      model: result.model,
    });
  } catch (err) {
    console.error(`[render-${vehicleClass}] Handler error:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return jsonResponse({ error: message }, 500);
  }
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
