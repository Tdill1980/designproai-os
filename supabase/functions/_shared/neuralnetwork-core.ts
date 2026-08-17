/**
 * NeuralNetwork Core — Unified Intelligence API
 *
 * Single entry point for ALL render functions to tap into subscriber intelligence.
 * Handles loading subscriber DNA, fetching personalized few-shot examples,
 * and optimizing prompts based on rated history.
 *
 * FAIL-SAFE: Returns sensible defaults on any error.
 * The render pipeline NEVER breaks because of NeuralNetwork.
 *
 * Usage in render functions:
 *   import { enhanceWithIntelligence } from "../_shared/neuralnetwork-core.ts";
 *   const nn = await enhanceWithIntelligence(rawPrompt, { userId, ... });
 *   // Use nn.fewShotBlock, nn.ragContext, nn.subscriberDna
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { retrieveTopRatedExamples, buildDynamicExamplesPromptBlock } from "./neuralnetwork-retrieve.ts";
import { fetchRAGContext } from "./neuralnetwork-rag.ts";

// ============================================================================
// Types
// ============================================================================

export interface SubscriberDNA {
  id: string;
  user_id: string;
  industry_id: string | null;
  org_id: string | null;
  top_finishes: Array<{ finish: string; count: number; avg_rating: number }>;
  top_colors: Array<{ color_name: string; hex?: string; count: number; avg_rating: number }>;
  top_vehicles: Array<{ make: string; model?: string; count: number; avg_rating: number }>;
  avoid_patterns: Array<{ prompt_hash: string; reason?: string }>;
  preferred_view_angles: Array<{ angle: string; count: number }>;
  preferred_styles: Array<{ style_tag: string; count: number; avg_rating: number }>;
  total_renders: number;
  total_rated: number;
  avg_rating: number;
  five_star_count: number;
  one_star_count: number;
  last_learned_at: string | null;
  examples_version: number;
}

export interface NeuralNetworkContext {
  userId: string;
  industryId?: string;
  orgId?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  finish?: string;
  colorName?: string;
  modeType?: string;
}

export interface NeuralNetworkResult {
  subscriberDna: SubscriberDNA | null;
  fewShotBlock: string;
  ragContext: string;
  styleHints: string;
  confidence: number;
  examplesUsed: number;
  isPersonalized: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const VEHICLE_WRAPS_SLUG = "vehicle-wraps";
const MIN_EXAMPLES_FOR_PERSONALIZATION = 10;
const MAX_FEW_SHOT_CHARS = 3000;
const MAX_RAG_CHARS = 3000;

// ============================================================================
// Core Function
// ============================================================================

/**
 * Enhance a render request with subscriber intelligence.
 *
 * Call this ONCE per render, before building the final prompt.
 * Returns subscriber DNA, few-shot examples, RAG context, and style hints.
 *
 * Total output is capped to prevent prompt bloat (Gemini < 6K chars ideal).
 */
export async function enhanceWithIntelligence(
  rawPrompt: string,
  context: NeuralNetworkContext
): Promise<NeuralNetworkResult> {
  const defaults: NeuralNetworkResult = {
    subscriberDna: null,
    fewShotBlock: "",
    ragContext: "",
    styleHints: "",
    confidence: 0,
    examplesUsed: 0,
    isPersonalized: false,
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      console.warn("[NeuralNetwork Core] Missing env vars — returning defaults");
      return defaults;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Resolve industry ID if not provided
    let industryId = context.industryId;
    if (!industryId) {
      industryId = await resolveIndustryId(supabase, VEHICLE_WRAPS_SLUG);
    }

    // Run all queries in parallel for speed
    const [subscriberDna, fewShotExamples, ragContext] = await Promise.all([
      loadSubscriberDna(supabase, context.userId, industryId),
      fetchFewShotExamples(context, industryId),
      fetchRAGContext({
        collections: ["finish_library", "production_rules"],
        maxChars: MAX_RAG_CHARS,
        orgId: context.orgId || null,
        finishName: context.finish,
      }),
    ]);

    // Build few-shot block from examples
    const fewShotBlock = buildDynamicExamplesPromptBlock(fewShotExamples);

    // Build subscriber style hints (only if enough data)
    const styleHints = buildStyleHints(subscriberDna, context);

    // Calculate confidence based on available data
    const isPersonalized = (subscriberDna?.total_rated || 0) >= MIN_EXAMPLES_FOR_PERSONALIZATION;
    const confidence = calculateConfidence(subscriberDna, fewShotExamples.length);

    console.log(
      `[NeuralNetwork Core] User=${context.userId?.substring(0, 8)}... ` +
      `DNA=${subscriberDna ? "loaded" : "none"} ` +
      `Examples=${fewShotExamples.length} ` +
      `Personalized=${isPersonalized} ` +
      `Confidence=${confidence.toFixed(2)}`
    );

    return {
      subscriberDna,
      fewShotBlock: fewShotBlock.substring(0, MAX_FEW_SHOT_CHARS),
      ragContext,
      styleHints,
      confidence,
      examplesUsed: fewShotExamples.length,
      isPersonalized,
    };
  } catch (err) {
    console.warn("[NeuralNetwork Core] Enhancement failed (non-fatal):", err);
    return defaults;
  }
}

// ============================================================================
// Subscriber DNA Loading
// ============================================================================

async function loadSubscriberDna(
  supabase: any,
  userId: string,
  industryId: string | null
): Promise<SubscriberDNA | null> {
  try {
    let query = supabase
      .from("neuralnetwork_subscriber_dna")
      .select("*")
      .eq("user_id", userId);

    if (industryId) {
      query = query.eq("industry_id", industryId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      console.warn("[NeuralNetwork Core] DNA load error:", error.message);
      return null;
    }

    return data as SubscriberDNA | null;
  } catch (err) {
    console.warn("[NeuralNetwork Core] DNA load failed:", err);
    return null;
  }
}

// ============================================================================
// Few-Shot Example Retrieval (Subscriber-Scoped)
// ============================================================================

async function fetchFewShotExamples(
  context: NeuralNetworkContext,
  industryId: string | null
) {
  try {
    // Use existing retrieval function with subscriber context
    const examples = await retrieveTopRatedExamples({
      vehicleMake: context.vehicleMake,
      vehicleModel: context.vehicleModel,
      modeType: context.modeType,
      industryType: industryId || undefined,
      limit: 3,
      minRating: 4.0,
    });

    return examples;
  } catch (err) {
    console.warn("[NeuralNetwork Core] Few-shot fetch failed:", err);
    return [];
  }
}

// ============================================================================
// Style Hints Builder
// ============================================================================

/**
 * Build a concise style hints block from subscriber DNA.
 * Only generated when subscriber has enough rated data.
 * Kept SHORT to avoid prompt bloat.
 */
function buildStyleHints(
  dna: SubscriberDNA | null,
  context: NeuralNetworkContext
): string {
  if (!dna || dna.total_rated < MIN_EXAMPLES_FOR_PERSONALIZATION) {
    return "";
  }

  const hints: string[] = [];

  // Top finishes this subscriber loves
  if (dna.top_finishes && dna.top_finishes.length > 0) {
    const topFinishes = dna.top_finishes
      .sort((a, b) => b.avg_rating - a.avg_rating)
      .slice(0, 3)
      .map(f => f.finish);
    hints.push(`Preferred finishes: ${topFinishes.join(", ")}`);
  }

  // Top colors
  if (dna.top_colors && dna.top_colors.length > 0) {
    const topColors = dna.top_colors
      .sort((a, b) => b.avg_rating - a.avg_rating)
      .slice(0, 3)
      .map(c => c.color_name);
    hints.push(`Favorite colors: ${topColors.join(", ")}`);
  }

  // Preferred view angles
  if (dna.preferred_view_angles && dna.preferred_view_angles.length > 0) {
    const topAngles = dna.preferred_view_angles
      .sort((a, b) => b.count - a.count)
      .slice(0, 2)
      .map(a => a.angle);
    hints.push(`Preferred angles: ${topAngles.join(", ")}`);
  }

  if (hints.length === 0) return "";

  return `\n[Subscriber Style Profile — ${dna.total_rated} rated designs, avg ${dna.avg_rating}/5]\n${hints.join(". ")}.\n`;
}

// ============================================================================
// Industry Resolution
// ============================================================================

async function resolveIndustryId(
  supabase: any,
  slug: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("neuralnetwork_industries")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (error || !data) return null;
    return data.id;
  } catch {
    return null;
  }
}

// ============================================================================
// Confidence Calculation
// ============================================================================

function calculateConfidence(
  dna: SubscriberDNA | null,
  exampleCount: number
): number {
  let confidence = 0;

  // Base confidence from having any data
  if (exampleCount > 0) confidence += 0.2;
  if (exampleCount >= 3) confidence += 0.1;

  // Subscriber DNA adds confidence
  if (dna) {
    confidence += 0.1; // Has a profile at all
    if (dna.total_rated >= 10) confidence += 0.1;
    if (dna.total_rated >= 50) confidence += 0.2;
    if (dna.total_rated >= 100) confidence += 0.1;
    if (dna.avg_rating >= 4.0) confidence += 0.1;
    if (dna.five_star_count >= 10) confidence += 0.1;
  }

  return Math.min(confidence, 1.0);
}

// ============================================================================
// Utility: Hash a prompt for pattern tracking
// ============================================================================

/**
 * Generate a stable hash for prompt pattern matching.
 * Normalizes whitespace and case before hashing.
 */
export async function hashPrompt(prompt: string): Promise<string> {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
