import { createExternalClient } from "../_shared/external-db.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Batch swatch generator for PatternPro patterns.
 *
 * Generates clean, square 1024×1024 pattern swatch images via Gemini
 * and uploads them to Supabase Storage (wrap-files/pattern-swatches/).
 *
 * POST body:
 *   { patterns: Array<{ slug: string; name: string; category: string; description: string }> }
 *   — or omit `patterns` to generate ALL missing swatches from wbty_products table.
 *
 * Each swatch is a flat, tileable pattern tile with NO text, NO labels,
 * NO watermarks — just the raw pattern filling the entire square.
 */

interface PatternInput {
  slug: string;
  name: string;
  category: string;
  description: string;
}

const BUCKET = "wrap-files";
const SWATCH_PREFIX = "pattern-swatches";

async function generateSwatch(
  pattern: PatternInput,
  geminiKey: string,
): Promise<{ slug: string; success: boolean; url?: string; error?: string }> {
  const prompt = buildPrompt(pattern);

  try {
    console.log(`[swatch] Generating: ${pattern.name} (${pattern.category})`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            // ["IMAGE"] alone suppresses output on Gemini 3 image models;
            // responseMimeType is not valid for image generation.
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[swatch] Gemini API error for ${pattern.slug}:`, response.status, errorText);
      return { slug: pattern.slug, success: false, error: `Gemini ${response.status}` };
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts;

    let imageData: string | null = null;
    let mimeType = "image/png";

    if (parts && Array.isArray(parts)) {
      for (const part of parts) {
        if (part.inlineData) {
          mimeType = part.inlineData.mimeType || "image/png";
          imageData = part.inlineData.data;
          break;
        }
      }
    }

    if (!imageData) {
      return { slug: pattern.slug, success: false, error: "No image in Gemini response" };
    }

    // Upload to Supabase Storage
    const supabase = createExternalClient();
    const filePath = `${SWATCH_PREFIX}/${pattern.slug}.png`;

    // Decode base64 to Uint8Array
    const binaryStr = atob(imageData);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, bytes, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error(`[swatch] Storage upload error for ${pattern.slug}:`, uploadError);
      return { slug: pattern.slug, success: false, error: uploadError.message };
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = urlData?.publicUrl || "";

    console.log(`[swatch] ✓ Generated + uploaded: ${pattern.name} → ${publicUrl}`);
    return { slug: pattern.slug, success: true, url: publicUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[swatch] Error generating ${pattern.slug}:`, msg);
    return { slug: pattern.slug, success: false, error: msg };
  }
}

function buildPrompt(pattern: PatternInput): string {
  // Build a focused prompt for a clean, square pattern swatch
  return [
    `Generate a single high-quality 1024x1024 square pattern swatch image.`,
    ``,
    `Pattern name: "${pattern.name}"`,
    `Category: ${pattern.category}`,
    `Description: ${pattern.description}`,
    ``,
    `REQUIREMENTS:`,
    `- The pattern fills the ENTIRE square edge-to-edge with NO borders or margins`,
    `- NO text, NO labels, NO watermarks, NO logos anywhere in the image`,
    `- Clean, sharp, high-resolution pattern at print quality`,
    `- The pattern should look like a professional vinyl wrap swatch sample`,
    `- Colors must be vivid and accurate to the description`,
    `- Pattern should be suitable for vehicle wrap visualization`,
    `- Square 1:1 aspect ratio filling the entire canvas`,
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }
    const geminiKey = getGeminiKey();

    const body = await req.json().catch(() => ({}));
    let patterns: PatternInput[] = body.patterns || [];

    // If no patterns provided, fetch from DB and find ones missing swatches
    if (patterns.length === 0) {
      const supabase = createExternalClient();
      const { data: dbProducts, error } = await supabase
        .from("wbty_products")
        .select("id, name, category, media_url")
        .eq("is_active", true);

      if (error) throw new Error(`DB fetch error: ${error.message}`);

      // Find products that don't have swatch images or have placeholder URLs
      patterns = (dbProducts || [])
        .filter(
          (p: any) =>
            !p.media_url ||
            p.media_url.includes("placeholder") ||
            p.media_url.startsWith("/panels/"),
        )
        .map((p: any) => ({
          slug: p.id,
          name: p.name,
          category: p.category || "Uncategorized",
          description: `${p.name} pattern from the ${p.category || "wrap"} collection - professional vinyl wrap swatch`,
        }));
    }

    if (patterns.length === 0) {
      return new Response(
        JSON.stringify({ message: "No patterns need swatch generation", generated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[swatch] Starting batch generation for ${patterns.length} patterns`);

    const results = [];
    let successCount = 0;
    let failCount = 0;

    // Process in batches of 3 to avoid rate limits
    const BATCH_SIZE = 3;
    for (let i = 0; i < patterns.length; i += BATCH_SIZE) {
      const batch = patterns.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((p) => generateSwatch(p, geminiKey)),
      );

      for (const result of batchResults) {
        results.push(result);
        if (result.success) {
          successCount++;

          // Update the wbty_products table with the new swatch URL
          if (result.url) {
            const supabase = createExternalClient();
            await supabase
              .from("wbty_products")
              .update({ media_url: result.url })
              .or(`id.eq.${result.slug},name.eq.${results[results.length - 1]?.slug}`)
              .then(() =>
                console.log(`[swatch] Updated DB media_url for ${result.slug}`),
              );
          }
        } else {
          failCount++;
        }
      }

      // Brief pause between batches to respect rate limits
      if (i + BATCH_SIZE < patterns.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    console.log(
      `[swatch] Batch complete: ${successCount} success, ${failCount} failed`,
    );

    return new Response(
      JSON.stringify({
        generated: successCount,
        failed: failCount,
        total: patterns.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[swatch] Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
