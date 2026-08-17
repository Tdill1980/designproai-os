/**
 * Design DNA Capture Module
 *
 * Records every render's genetic fingerprint into neuralnetwork_design_dna.
 * Called AFTER a successful render, NEVER blocks the render response.
 *
 * CRITICAL: This entire module is wrapped in try/catch.
 * If the table doesn't exist or the insert fails, it logs a warning
 * and returns null. The render response is never affected.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface DesignDNAParams {
  userId: string;
  promptText: string;
  enhancedPrompt: string;
  vehicle: {
    year?: string;
    make?: string;
    model?: string;
  };
  designConfig: Record<string, any>;
  renderUrl: string;
  designName?: string;
  generationId?: string;
  revisionParentId?: string;
  revisionText?: string;
  viewType?: string;
}

/**
 * Capture a design's DNA record after successful render.
 * Returns the DNA record ID or null on error.
 */
export async function captureDesignDNA(params: DesignDNAParams): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.warn("[DNA] Missing env vars — skipping DNA capture");
      return null;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      userId,
      promptText,
      enhancedPrompt,
      vehicle,
      designConfig,
      renderUrl,
      designName,
      generationId,
      revisionParentId,
      revisionText,
      viewType,
    } = params;

    const dnaRecord = {
      user_id: userId,
      prompt_text: promptText,
      enhanced_prompt: enhancedPrompt,
      vehicle_year: vehicle.year || null,
      vehicle_make: vehicle.make || null,
      vehicle_model: vehicle.model || null,
      design_config: designConfig,
      render_url: renderUrl,
      design_name: designName || null,
      generation_id: generationId || null,
      revision_parent_id: revisionParentId || null,
      revision_text: revisionText || null,
      view_type: viewType || 'side',
      status: 'active',
    };

    const { data, error } = await (supabase as any)
      .from("neuralnetwork_design_dna")
      .insert(dnaRecord)
      .select("id")
      .single();

    if (error) {
      console.warn("[DNA] Insert failed (non-fatal):", error.message);
      return null;
    }

    const dnaId = data?.id || null;
    console.log(`[DNA] Captured design DNA: ${dnaId}`);
    return dnaId;
  } catch (err) {
    console.warn("[DNA] Capture failed (non-fatal):", err);
    return null;
  }
}
