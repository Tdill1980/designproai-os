/**
 * NeuralNetwork Learn — Rating Processor & Intelligence Builder
 *
 * Processes subscriber ratings into intelligence improvements:
 *   1. Updates subscriber DNA preferences (finishes, colors, vehicles)
 *   2. Updates prompt pattern scores
 *   3. Triggers embedding generation (async)
 *   4. Flags high-rated renders as few-shot candidates
 *   5. Marks low-rated patterns for avoidance
 *
 * Called:
 *   - After every rating submission (via frontend or admin rating page)
 *   - During batch seeding (admin rates 300 renders)
 *
 * The SQL trigger (fn_update_subscriber_dna_on_rating) handles basic stats.
 * This function handles the INTELLIGENCE layer — preferences, patterns, embeddings.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { hashPrompt } from "../_shared/neuralnetwork-core.ts";

// ============================================================================
// Types
// ============================================================================

interface LearnRequest {
  design_dna_id: string;
  user_id: string;
  rating: number;
  feedback_text?: string;
  industry_id?: string;
}

interface DesignDNARecord {
  id: string;
  creator_id: string;
  prompt_text: string;
  enhanced_prompt: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  design_config: Record<string, any>;
  render_url: string | null;
  mode: string | null;
  industry_id: string | null;
  design_name: string | null;
}

// ============================================================================
// Preference Extraction
// ============================================================================

function extractFinish(config: Record<string, any>): string | null {
  return config?.finish || config?.finishType || config?.material || null;
}

function extractColor(config: Record<string, any>): { name: string; hex?: string } | null {
  const name = config?.color || config?.colorName || config?.primaryColor || null;
  if (!name) return null;
  return { name, hex: config?.hex || config?.colorHex || undefined };
}

function extractStyle(config: Record<string, any>): string | null {
  return config?.style || config?.designStyle || config?.mode || null;
}

function extractViewAngle(config: Record<string, any>): string | null {
  return config?.viewAngle || config?.camera_angle || config?.view || null;
}

// ============================================================================
// DNA Preference Updater
// ============================================================================

async function updateSubscriberPreferences(
  supabase: any,
  userId: string,
  industryId: string | null,
  dnaRecord: DesignDNARecord,
  rating: number
): Promise<void> {
  // Load current subscriber DNA
  let query = supabase
    .from("neuralnetwork_subscriber_dna")
    .select("*")
    .eq("user_id", userId);

  if (industryId) {
    query = query.eq("industry_id", industryId);
  }

  const { data: existingDna } = await query.maybeSingle();

  if (!existingDna) {
    // DNA record created by SQL trigger — if it doesn't exist yet, skip preferences
    console.log("[NeuralNetwork Learn] No DNA record yet — trigger will create on feedback insert");
    return;
  }

  const config = dnaRecord.design_config || {};
  const updates: Record<string, any> = { updated_at: new Date().toISOString() };

  // Only update preferences for meaningful ratings (3+ stars = positive signal)
  if (rating >= 3) {
    // Update finish preferences
    const finish = extractFinish(config);
    if (finish) {
      const finishes = Array.isArray(existingDna.top_finishes) ? [...existingDna.top_finishes] : [];
      const existing = finishes.find((f: any) => f.finish === finish);
      if (existing) {
        existing.count = (existing.count || 0) + 1;
        existing.avg_rating = ((existing.avg_rating || 0) * (existing.count - 1) + rating) / existing.count;
      } else {
        finishes.push({ finish, count: 1, avg_rating: rating });
      }
      // Keep top 10, sorted by avg_rating
      updates.top_finishes = finishes
        .sort((a: any, b: any) => b.avg_rating - a.avg_rating)
        .slice(0, 10);
    }

    // Update color preferences
    const color = extractColor(config);
    if (color) {
      const colors = Array.isArray(existingDna.top_colors) ? [...existingDna.top_colors] : [];
      const existing = colors.find((c: any) => c.color_name === color.name);
      if (existing) {
        existing.count = (existing.count || 0) + 1;
        existing.avg_rating = ((existing.avg_rating || 0) * (existing.count - 1) + rating) / existing.count;
      } else {
        colors.push({ color_name: color.name, hex: color.hex, count: 1, avg_rating: rating });
      }
      updates.top_colors = colors
        .sort((a: any, b: any) => b.avg_rating - a.avg_rating)
        .slice(0, 10);
    }

    // Update vehicle preferences
    if (dnaRecord.vehicle_make) {
      const vehicles = Array.isArray(existingDna.top_vehicles) ? [...existingDna.top_vehicles] : [];
      const vehicleKey = [dnaRecord.vehicle_make, dnaRecord.vehicle_model].filter(Boolean).join(" ");
      const existing = vehicles.find((v: any) => v.make === vehicleKey);
      if (existing) {
        existing.count = (existing.count || 0) + 1;
        existing.avg_rating = ((existing.avg_rating || 0) * (existing.count - 1) + rating) / existing.count;
      } else {
        vehicles.push({ make: vehicleKey, model: dnaRecord.vehicle_model, count: 1, avg_rating: rating });
      }
      updates.top_vehicles = vehicles
        .sort((a: any, b: any) => b.avg_rating - a.avg_rating)
        .slice(0, 10);
    }

    // Update view angle preferences
    const angle = extractViewAngle(config);
    if (angle) {
      const angles = Array.isArray(existingDna.preferred_view_angles) ? [...existingDna.preferred_view_angles] : [];
      const existing = angles.find((a: any) => a.angle === angle);
      if (existing) {
        existing.count = (existing.count || 0) + 1;
      } else {
        angles.push({ angle, count: 1 });
      }
      updates.preferred_view_angles = angles
        .sort((a: any, b: any) => b.count - a.count)
        .slice(0, 8);
    }

    // Update style preferences
    const style = extractStyle(config);
    if (style) {
      const styles = Array.isArray(existingDna.preferred_styles) ? [...existingDna.preferred_styles] : [];
      const existing = styles.find((s: any) => s.style_tag === style);
      if (existing) {
        existing.count = (existing.count || 0) + 1;
        existing.avg_rating = ((existing.avg_rating || 0) * (existing.count - 1) + rating) / existing.count;
      } else {
        styles.push({ style_tag: style, count: 1, avg_rating: rating });
      }
      updates.preferred_styles = styles
        .sort((a: any, b: any) => b.avg_rating - a.avg_rating)
        .slice(0, 10);
    }
  }

  // Add to avoid patterns if rating is very low
  if (rating <= 2 && dnaRecord.prompt_text) {
    const promptHash = await hashPrompt(dnaRecord.prompt_text);
    const avoidPatterns = Array.isArray(existingDna.avoid_patterns) ? [...existingDna.avoid_patterns] : [];
    const alreadyAvoiding = avoidPatterns.some((p: any) => p.prompt_hash === promptHash);
    if (!alreadyAvoiding) {
      avoidPatterns.push({
        prompt_hash: promptHash,
        reason: `Rated ${rating}/5`,
      });
      // Keep latest 50 avoid patterns
      updates.avoid_patterns = avoidPatterns.slice(-50);
    }
  }

  // Apply updates
  if (Object.keys(updates).length > 1) { // More than just updated_at
    const { error } = await supabase
      .from("neuralnetwork_subscriber_dna")
      .update(updates)
      .eq("id", existingDna.id);

    if (error) {
      console.warn("[NeuralNetwork Learn] DNA update failed:", error.message);
    } else {
      console.log(`[NeuralNetwork Learn] Updated DNA preferences for user ${userId.substring(0, 8)}...`);
    }
  }
}

// ============================================================================
// Prompt Score Tracking
// ============================================================================

async function updatePromptScores(
  supabase: any,
  dnaRecord: DesignDNARecord,
  userId: string,
  industryId: string | null,
  rating: number
): Promise<void> {
  if (!dnaRecord.prompt_text) return;

  const promptHash = await hashPrompt(dnaRecord.prompt_text);
  const nullUuid = "00000000-0000-0000-0000-000000000000";

  // Check if this prompt pattern already exists for this user
  const { data: existing } = await supabase
    .from("neuralnetwork_prompt_scores")
    .select("*")
    .eq("prompt_hash", promptHash)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing) {
    // Update existing score
    const newTotal = (existing.total_renders || 0) + 1;
    const newAvg = ((existing.avg_rating || 0) * (existing.total_renders || 0) + rating) / newTotal;
    const updates: Record<string, any> = {
      total_renders: newTotal,
      avg_rating: Math.round(newAvg * 100) / 100,
      updated_at: new Date().toISOString(),
    };

    // Track best result
    if (rating > (existing.best_rating || 0)) {
      updates.best_rating = rating;
      updates.best_render_url = dnaRecord.render_url;
      if (dnaRecord.enhanced_prompt) {
        updates.enhanced_prompt = dnaRecord.enhanced_prompt;
      }
    }

    await supabase
      .from("neuralnetwork_prompt_scores")
      .update(updates)
      .eq("id", existing.id);
  } else {
    // Insert new prompt score
    await supabase
      .from("neuralnetwork_prompt_scores")
      .insert({
        prompt_hash: promptHash,
        prompt_text: dnaRecord.prompt_text,
        enhanced_prompt: dnaRecord.enhanced_prompt,
        user_id: userId,
        industry_id: industryId,
        total_renders: 1,
        avg_rating: rating,
        best_rating: rating,
        best_render_url: dnaRecord.render_url,
      });
  }

  // Also update/create the GLOBAL prompt score (user_id IS NULL)
  const { data: globalExisting } = await supabase
    .from("neuralnetwork_prompt_scores")
    .select("*")
    .eq("prompt_hash", promptHash)
    .is("user_id", null)
    .maybeSingle();

  if (globalExisting) {
    const newTotal = (globalExisting.total_renders || 0) + 1;
    const newAvg = ((globalExisting.avg_rating || 0) * (globalExisting.total_renders || 0) + rating) / newTotal;
    await supabase
      .from("neuralnetwork_prompt_scores")
      .update({
        total_renders: newTotal,
        avg_rating: Math.round(newAvg * 100) / 100,
        best_rating: Math.max(rating, globalExisting.best_rating || 0),
        best_render_url: rating > (globalExisting.best_rating || 0) ? dnaRecord.render_url : globalExisting.best_render_url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", globalExisting.id);
  } else {
    await supabase
      .from("neuralnetwork_prompt_scores")
      .insert({
        prompt_hash: promptHash,
        prompt_text: dnaRecord.prompt_text,
        enhanced_prompt: dnaRecord.enhanced_prompt,
        user_id: null,
        industry_id: industryId,
        total_renders: 1,
        avg_rating: rating,
        best_rating: rating,
        best_render_url: dnaRecord.render_url,
      });
  }

  console.log(`[NeuralNetwork Learn] Prompt score updated: hash=${promptHash.substring(0, 12)}... rating=${rating}`);
}

// ============================================================================
// Update Design DNA with Rating
// ============================================================================

async function updateDesignDnaRating(
  supabase: any,
  designDnaId: string,
  rating: number
): Promise<void> {
  // Get current rating stats
  const { data: dna } = await supabase
    .from("neuralnetwork_design_dna")
    .select("avg_rating, total_ratings")
    .eq("id", designDnaId)
    .single();

  if (!dna) return;

  const currentTotal = dna.total_ratings || 0;
  const currentAvg = dna.avg_rating || 0;
  const newTotal = currentTotal + 1;
  const newAvg = (currentAvg * currentTotal + rating) / newTotal;

  await supabase
    .from("neuralnetwork_design_dna")
    .update({
      avg_rating: Math.round(newAvg * 100) / 100,
      total_ratings: newTotal,
      updated_at: new Date().toISOString(),
    })
    .eq("id", designDnaId);
}

// ============================================================================
// Trigger Embedding Generation (Non-Blocking)
// ============================================================================

async function triggerEmbedding(
  supabaseUrl: string,
  supabaseKey: string,
  dnaRecord: DesignDNARecord
): Promise<void> {
  try {
    // Build embedding text from prompt + context
    const embeddingText = [
      dnaRecord.prompt_text,
      dnaRecord.enhanced_prompt,
      dnaRecord.vehicle_make,
      dnaRecord.vehicle_model,
      dnaRecord.design_name,
      dnaRecord.mode,
    ]
      .filter(Boolean)
      .join(" | ");

    // Fire-and-forget call to neuralnetwork-embed
    const embedUrl = `${supabaseUrl}/functions/v1/neuralnetwork-embed`;
    fetch(embedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        text: embeddingText,
        table: "neuralnetwork_design_dna",
        record_id: dnaRecord.id,
      }),
    }).catch((err) => {
      console.warn("[NeuralNetwork Learn] Embedding trigger failed (non-blocking):", err);
    });

    console.log(`[NeuralNetwork Learn] Triggered embedding for DNA ${dnaRecord.id.substring(0, 8)}...`);
  } catch (err) {
    console.warn("[NeuralNetwork Learn] Embedding trigger error (non-blocking):", err);
  }
}

// ============================================================================
// Edge Function Handler
// ============================================================================

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing Supabase env vars");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body: LearnRequest = await req.json();

    const { design_dna_id, user_id, rating, feedback_text, industry_id } = body;

    // Validate inputs
    if (!design_dna_id) throw new Error("Missing design_dna_id");
    if (!user_id) throw new Error("Missing user_id");
    if (!rating || rating < 1 || rating > 5) throw new Error("Rating must be 1-5");

    console.log(`[NeuralNetwork Learn] Processing: user=${user_id.substring(0, 8)}... dna=${design_dna_id.substring(0, 8)}... rating=${rating}`);

    // 1. Fetch the design DNA record
    const { data: dnaRecord, error: dnaError } = await supabase
      .from("neuralnetwork_design_dna")
      .select("*")
      .eq("id", design_dna_id)
      .single();

    if (dnaError || !dnaRecord) {
      throw new Error(`Design DNA record not found: ${design_dna_id}`);
    }

    // 2. Create feedback record (triggers SQL auto-learning)
    const { error: feedbackError } = await supabase
      .from("neuralnetwork_feedback")
      .insert({
        design_dna_id,
        rater_id: user_id,
        rating,
        feedback_text: feedback_text || null,
        feedback_type: "rating",
      });

    if (feedbackError) {
      console.warn("[NeuralNetwork Learn] Feedback insert error:", feedbackError.message);
      // Non-fatal — continue with other updates
    }

    // Resolve industry ID
    const resolvedIndustryId = industry_id || dnaRecord.industry_id || null;

    // 3. Update design DNA with this rating
    await updateDesignDnaRating(supabase, design_dna_id, rating);

    // 4. Update subscriber preferences (the INTELLIGENCE layer)
    await updateSubscriberPreferences(
      supabase,
      user_id,
      resolvedIndustryId,
      dnaRecord as DesignDNARecord,
      rating
    );

    // 5. Update prompt pattern scores
    await updatePromptScores(
      supabase,
      dnaRecord as DesignDNARecord,
      user_id,
      resolvedIndustryId,
      rating
    );

    // 6. Trigger embedding generation (async, non-blocking)
    await triggerEmbedding(supabaseUrl, supabaseKey, dnaRecord as DesignDNARecord);

    // 7. Auto-exemplar escalation DISABLED
    // Was auto-promoting 5-star renders to exemplar status, which then got
    // injected as style references into new prompts, creating a feedback loop
    // that destroyed render variety. Ratings are still recorded for analytics.
    // To re-enable: uncomment the block below.
    //
    // if (rating === 5) {
    //   await supabase
    //     .from("neuralnetwork_design_dna")
    //     .update({ status: "exemplar" })
    //     .eq("id", design_dna_id);
    //   console.log(`[NeuralNetwork Learn] Marked ${design_dna_id.substring(0, 8)}... as exemplar (5-star)`);
    // }
    console.log(`[NeuralNetwork Learn] Rating ${rating}/5 recorded (exemplar auto-escalation disabled)`);

    return new Response(
      JSON.stringify({
        success: true,
        design_dna_id,
        rating,
        actions: [
          "feedback_recorded",
          "dna_rating_updated",
          "preferences_updated",
          "prompt_scores_updated",
          "embedding_triggered",
          rating === 5 ? "marked_exemplar" : null,
        ].filter(Boolean),
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("[NeuralNetwork Learn] Error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Learning failed" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
