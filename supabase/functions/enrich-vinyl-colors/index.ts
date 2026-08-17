import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!hasGeminiKey()) {
      throw new Error("No Gemini API key configured");
    }

    // Connect to EXTERNAL database for data operations
    const supabase = createExternalClient();

    // Get all swatches with missing/placeholder hex values
    // Common placeholders: #000000, #000, #FFFFFF, #FFF, none, N/A, 0, etc.
    const { data: colors, error: fetchError } = await supabase
      .from("vinyl_swatches")
      .select("id, manufacturer, name, hex")
      .or('hex.is.null,hex.eq.,hex.eq.#000000,hex.eq.#000,hex.eq.000000,hex.eq.000,hex.eq.#FFFFFF,hex.eq.#FFF,hex.eq.FFFFFF,hex.eq.FFF,hex.eq.none,hex.eq.N/A,hex.eq.0');

    if (fetchError) {
      throw new Error(`Failed to fetch colors: ${fetchError.message}`);
    }

    console.log(`Found ${colors?.length || 0} colors with missing hex values`);

    const results = {
      processed: 0,
      updated: 0,
      notFound: 0,
      errors: 0
    };

    for (const color of colors || []) {
      results.processed++;
      
      try {
        console.log(`Processing: ${color.manufacturer} - ${color.name}`);

        const systemPrompt = `You are a vinyl wrap film color database expert. Return the EXACT official hex color code for vinyl wrap films. Only return colors from ACTUAL manufacturer color charts. If uncertain, return "NOT_FOUND". Respond ONLY with a hex code like #RRGGBB or "NOT_FOUND".`;
        const userPrompt = `Manufacturer: ${color.manufacturer}\nFilm Color Name: ${color.name}\n\nReturn ONLY the hex code or "NOT_FOUND".`;

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: systemPrompt + "\n\n" + userPrompt }]
            }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 20
            }
          }),
        });

        if (!response.ok) {
          console.error(`Gemini API error for ${color.name}`);
          results.errors++;
          continue;
        }

        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
        const hexMatch = content.match(/^#[0-9A-Fa-f]{6}$/);

        if (hexMatch) {
          const { error: updateError } = await supabase
            .from("vinyl_swatches")
            .update({ hex: hexMatch[0].toUpperCase() })
            .eq("id", color.id);

          if (updateError) {
            console.error(`Update failed for ${color.name}: ${updateError.message}`);
            results.errors++;
          } else {
            console.log(`Updated: ${color.name} -> ${hexMatch[0]}`);
            results.updated++;
          }
        } else {
          console.log(`NOT_FOUND: ${color.manufacturer} - ${color.name}`);
          results.notFound++;
        }

        // Rate limiting - small delay between requests
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (err) {
        console.error(`Error processing ${color.name}:`, err);
        results.errors++;
      }
    }

    console.log("Enrichment complete:", results);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: "Color enrichment complete",
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in enrich-vinyl-colors:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
