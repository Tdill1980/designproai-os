import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Classify multiple vehicle photos by camera angle.
 *
 * Accepts: { images: Array<{ id: string; data: string; mimeType: string }> }
 *   - `data` is raw base64 (no data-URL prefix)
 *
 * Returns: { classifications: Array<{ id: string; viewType: string }> }
 *   viewType is one of: front, driver-side, passenger-side, rear, top, detail
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { images } = await req.json();

    if (!Array.isArray(images) || images.length === 0) {
      throw new Error("images array is required");
    }

    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    console.log(`[classify-vehicle-views] Classifying ${images.length} images`);

    const systemPrompt = `You are a vehicle photography expert. For each image, determine the camera angle / view of the vehicle.

Classify each image as EXACTLY ONE of:
- "front" — front of the vehicle visible (grille, headlights, bumper)
- "driver-side" — left side profile (US driver side)
- "passenger-side" — right side profile (US passenger side)
- "rear" — rear of the vehicle visible (taillights, rear bumper)
- "top" — overhead / bird's-eye / roof view
- "detail" — close-up of a specific area, or angle that doesn't fit the above

Return ONLY a JSON array of objects with "id" and "viewType" fields, matching the order and IDs of the input images.
Example: [{"id":"img-0","viewType":"front"},{"id":"img-1","viewType":"rear"}]`;

    // Build the parts array: one text instruction, then each image
    const parts: any[] = [
      {
        text:
          systemPrompt +
          `\n\nClassify the following ${images.length} image(s). The image IDs are: ${images.map((img: any) => img.id).join(", ")}`,
      },
    ];

    for (const img of images) {
      parts.push({
        inlineData: {
          mimeType: img.mimeType || "image/jpeg",
          data: img.data,
        },
      });
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1 },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();
    const aiText =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("[classify-vehicle-views] AI response:", aiText);

    // Parse JSON from potential markdown code blocks
    let classifications: Array<{ id: string; viewType: string }>;
    try {
      const jsonMatch =
        aiText.match(/```json\n([\s\S]*?)\n```/) ||
        aiText.match(/```\n([\s\S]*?)\n```/) ||
        [null, aiText];
      classifications = JSON.parse(jsonMatch[1] || aiText);
    } catch {
      console.error("Failed to parse AI response:", aiText);
      // Fallback: assign views in default order
      const defaultOrder = [
        "front",
        "driver-side",
        "passenger-side",
        "rear",
        "top",
        "detail",
      ];
      classifications = images.map((img: any, i: number) => ({
        id: img.id,
        viewType: defaultOrder[i % defaultOrder.length],
      }));
    }

    // Validate viewTypes and deduplicate — no two images should get the same slot
    const validTypes = new Set([
      "front",
      "driver-side",
      "passenger-side",
      "rear",
      "top",
      "detail",
    ]);
    const usedTypes = new Set<string>();
    const fallbackOrder = [
      "front",
      "driver-side",
      "passenger-side",
      "rear",
      "top",
      "detail",
    ];

    for (const c of classifications) {
      if (!validTypes.has(c.viewType)) {
        c.viewType = "detail";
      }
      if (usedTypes.has(c.viewType)) {
        // Find the first unused slot
        const unused = fallbackOrder.find((t) => !usedTypes.has(t)) || "detail";
        c.viewType = unused;
      }
      usedTypes.add(c.viewType);
    }

    return new Response(JSON.stringify({ classifications }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in classify-vehicle-views:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
