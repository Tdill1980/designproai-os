/**
 * NEURALNETWORK RETRIEVAL — Dynamic Few-Shot Examples from Rated Designs
 *
 * Pulls top-rated design DNA records that match the current render context
 * (vehicle type, mode, industry) and returns their descriptions for
 * injection into the Gemini prompt.
 *
 * This turns admin star ratings into AI learning signal:
 *   - Rate a design 5 stars -> it becomes a few-shot example for similar renders
 *   - Rate a design 1 star -> it's excluded from examples
 *   - The more you rate, the smarter the system gets
 */

import { createExternalClient } from './external-db.ts';

// ============================================================================
// Types
// ============================================================================

export interface DesignDNAExample {
  id: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  mode: string | null;
  industry_type: string | null;
  design_tags: string[];
  avg_rating: number;
  vehicle_render_url: string | null;
  design_anchor_text: string | null;
  enhanced_prompt: string | null;
}

export interface RetrievalContext {
  vehicleMake?: string;
  vehicleModel?: string;
  modeType?: string;
  industryType?: string;
  limit?: number;
  minRating?: number;
}

// ============================================================================
// Retrieval Function
// ============================================================================

/**
 * Retrieve top-rated design DNA records matching the current render context.
 * Returns examples sorted by relevance (rating * match score).
 */
export async function retrieveTopRatedExamples(
  context: RetrievalContext
): Promise<DesignDNAExample[]> {
  const supabase = createExternalClient();
  const limit = context.limit || 3;
  const minRating = context.minRating || 4.0;

  try {
    // Build query — start with high-rated designs
    let query = supabase
      .from('neuralnetwork_design_dna')
      .select('id, vehicle_make, vehicle_model, mode, industry_type, design_tags, avg_rating, vehicle_render_url, design_anchor_text, enhanced_prompt')
      .gte('avg_rating', minRating)
      .gt('total_ratings', 0)
      .order('avg_rating', { ascending: false })
      .limit(limit * 3); // Fetch extra for filtering

    // Prefer same vehicle make if available
    if (context.vehicleMake) {
      query = query.eq('vehicle_make', context.vehicleMake);
    }

    const { data: exactMatch, error: exactError } = await query;

    if (exactError) {
      console.error('[NeuralNetwork Retrieve] Query error:', exactError);
      return [];
    }

    let results = (exactMatch || []) as unknown as DesignDNAExample[];

    // If not enough exact vehicle matches, broaden to all high-rated
    if (results.length < limit) {
      const { data: broadMatch } = await supabase
        .from('neuralnetwork_design_dna')
        .select('id, vehicle_make, vehicle_model, mode, industry_type, design_tags, avg_rating, vehicle_render_url, design_anchor_text, enhanced_prompt')
        .gte('avg_rating', minRating)
        .gt('total_ratings', 0)
        .order('avg_rating', { ascending: false })
        .limit(limit * 2);

      if (broadMatch) {
        // Merge, dedup by id
        const existingIds = new Set(results.map(r => r.id));
        for (const item of broadMatch as unknown as DesignDNAExample[]) {
          if (!existingIds.has(item.id)) {
            results.push(item);
            existingIds.add(item.id);
          }
        }
      }
    }

    // Score and sort: prefer same mode, same make, higher rating
    const scored = results.map(r => {
      let score = r.avg_rating;
      if (context.modeType && r.mode === context.modeType) score += 1;
      if (context.vehicleMake && r.vehicle_make === context.vehicleMake) score += 0.5;
      if (context.industryType && r.industry_type === context.industryType) score += 0.5;
      return { ...r, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const topResults = scored.slice(0, limit);
    console.log(`[NeuralNetwork Retrieve] Found ${topResults.length} top-rated examples (min rating: ${minRating})`);

    return topResults;
  } catch (err) {
    console.error('[NeuralNetwork Retrieve] Error:', err);
    return [];
  }
}

// ============================================================================
// Prompt Builder — Formats retrieved examples into a prompt block
// ============================================================================

/**
 * Build a dynamic few-shot examples block from retrieved DNA records.
 * Returns empty string if no examples are available.
 */
export function buildDynamicExamplesPromptBlock(
  examples: DesignDNAExample[]
): string {
  if (!examples || examples.length === 0) return '';

  const exampleBlocks = examples.map((ex, i) => {
    const vehicle = [ex.vehicle_make, ex.vehicle_model].filter(Boolean).join(' ') || 'Vehicle';
    const tags = (ex.design_tags || []).join(', ') || 'untagged';
    const description = ex.design_anchor_text || ex.enhanced_prompt || 'No description available';

    return `EXAMPLE ${i + 1}: ${vehicle} (Rating: ${ex.avg_rating}/5, Tags: ${tags})
${description}`;
  }).join('\n\n');

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DYNAMIC QUALITY EXAMPLES — Top-Rated Designs from RestylePro Database
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The following ${examples.length} designs have been rated highly by professionals.
Study their composition, hierarchy, and execution quality.

${exampleBlocks}

Match or exceed this quality standard in your render.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
}
