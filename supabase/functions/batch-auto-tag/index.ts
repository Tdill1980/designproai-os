/**
 * BATCH AUTO-TAG — Runs Gemini analysis on untagged design DNA records
 *
 * Processes V1 legacy renders (or any untagged DNA records) through Gemini
 * to populate: design_tags, industry_type, mode, design_anchor_text.
 *
 * Rate-limited to avoid API limits. Designed to run overnight or in batches.
 *
 * POST body:
 * {
 *   "batchSize": 10,                    // How many to process (default 10, max 50)
 *   "source": "v1_legacy",              // Filter by source (default: all untagged)
 *   "delayMs": 2000                     // Delay between Gemini calls (default 2000ms)
 * }
 *
 * Returns: { success: true, processed: number, errors: string[] }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createExternalClient();
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(body.batchSize || 10, 50);
    const sourceFilter = body.source || null;
    const delayMs = body.delayMs || 2000;

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: 'GOOGLE_AI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch untagged DNA records
    let query = supabase
      .from('neuralnetwork_design_dna')
      .select('id, vehicle_render_url, vehicle_make, vehicle_model, vehicle_year, design_name, design_tags, mode, industry_type')
      .or('design_tags.eq.{},design_tags.is.null')
      .order('created_at', { ascending: true })
      .limit(batchSize);

    if (sourceFilter) {
      query = query.eq('source', sourceFilter);
    }

    const { data: records, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch records: ${fetchError.message}`);
    }

    if (!records || records.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: 'No untagged records found' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Batch Auto-Tag] Processing ${records.length} records`);

    let processed = 0;
    const errors: string[] = [];

    for (const record of records) {
      try {
        if (!record.vehicle_render_url) {
          errors.push(`Record ${record.id}: no render URL`);
          continue;
        }

        console.log(`[Auto-Tag] Analyzing: ${record.design_name || record.id}`);

        // Call Gemini to analyze the render image
        const analysisPrompt = `Analyze this vehicle wrap design image and provide a JSON response with these fields:
{
  "design_tags": ["tag1", "tag2", ...],     // 5-10 descriptive tags (e.g., "partial wrap", "commercial", "fleet", "full body", "color change", "graphic", "stripe", "gradient", "logo placement", "truck", "van", "sedan", "SUV")
  "industry_type": "string",                // Industry category (e.g., "construction", "food service", "plumbing", "landscaping", "delivery", "personal", "racing", "taxi")
  "composition_style": "string",            // One of: "full_wrap", "partial_wrap", "accent_stripe", "half_wrap", "color_change", "graphic_wrap"
  "complexity_level": "string",             // One of: "simple", "moderate", "complex", "premium"
  "color_palette": ["#hex1", "#hex2"],      // 3-5 dominant colors as hex values
  "design_description": "string"            // 2-3 sentence description of the design for cross-view continuity
}

Be specific and accurate. If you can identify the vehicle type, company branding, or design style, include those details in the tags.
Respond ONLY with valid JSON, no markdown.`;

        // Fetch the image and convert to base64
        const imgResponse = await fetch(record.vehicle_render_url);
        if (!imgResponse.ok) {
          errors.push(`Record ${record.id}: failed to fetch image (${imgResponse.status})`);
          continue;
        }

        const contentType = imgResponse.headers.get('content-type') || 'image/png';
        const arrayBuffer = await imgResponse.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

        // Call Gemini for analysis
        const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`;

        const geminiResponse = await fetch(geminiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: analysisPrompt },
                { inlineData: { mimeType: contentType, data: base64 } }
              ]
            }],
            generationConfig: {
              responseMimeType: 'application/json',
            }
          })
        });

        if (!geminiResponse.ok) {
          const errText = await geminiResponse.text();
          errors.push(`Record ${record.id}: Gemini error (${geminiResponse.status})`);
          console.error(`[Auto-Tag] Gemini error for ${record.id}:`, errText.substring(0, 200));
          continue;
        }

        const geminiData = await geminiResponse.json();
        const textPart = geminiData.candidates?.[0]?.content?.parts?.find((p: any) => p.text);

        if (!textPart?.text) {
          errors.push(`Record ${record.id}: no text in Gemini response`);
          continue;
        }

        // Parse the JSON response
        let analysis;
        try {
          analysis = JSON.parse(textPart.text);
        } catch {
          // Try to extract JSON from markdown code blocks
          const jsonMatch = textPart.text.match(/```json?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            analysis = JSON.parse(jsonMatch[1]);
          } else {
            errors.push(`Record ${record.id}: failed to parse Gemini JSON`);
            continue;
          }
        }

        // Update the DNA record with analysis results
        const updateData: any = {
          design_tags: analysis.design_tags || [],
          metadata: {
            ...(record as any).metadata,
            composition_style: analysis.composition_style,
            complexity_level: analysis.complexity_level,
            color_palette: analysis.color_palette,
            auto_tagged: true,
            auto_tagged_at: new Date().toISOString(),
          },
        };

        // Only update fields that aren't already set
        if (!record.industry_type && analysis.industry_type) {
          updateData.industry_type = analysis.industry_type;
        }
        if (analysis.design_description) {
          updateData.design_anchor_text = analysis.design_description;
        }

        const { error: updateError } = await supabase
          .from('neuralnetwork_design_dna')
          .update(updateData)
          .eq('id', record.id);

        if (updateError) {
          errors.push(`Record ${record.id}: update failed (${updateError.message})`);
        } else {
          processed++;
          console.log(`[Auto-Tag] Tagged: ${record.design_name || record.id} -> ${(analysis.design_tags || []).join(', ')}`);
        }

        // Rate limit delay
        if (delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Record ${record.id}: ${msg}`);
      }
    }

    console.log(`[Batch Auto-Tag] Complete: ${processed}/${records.length} processed, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        total: records.length,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Batch Auto-Tag] Fatal error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
