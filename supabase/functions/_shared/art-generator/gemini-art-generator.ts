/**
 * GeminiArtGenerator — the current art engine.
 *
 * Phase 0 = pure pass-through. It delegates to the existing, LOCKED
 * `design-panel-ai-generate` edge function over HTTP and adapts the response
 * to ArtResult. No prompt logic is duplicated here and no locked file is
 * modified — this wrapper exists only so the rest of the system can depend on
 * the ArtGenerator interface instead of on a specific model.
 *
 * Reserved zones are passed through; in Phase 0 the locked function ignores
 * unknown fields, so behavior is identical to today. A later phase adds the
 * "leave these regions clean" clause (outside the locked file).
 */

import type { ArtBrief, ArtGenerator, ArtGeneratorContext, ArtResult } from "./types.ts";

export class GeminiArtGenerator implements ArtGenerator {
  readonly id = "gemini";

  async generateBaseArt(brief: ArtBrief, ctx: ArtGeneratorContext): Promise<ArtResult> {
    const endpoint = `${ctx.supabaseUrl}/functions/v1/design-panel-ai-generate`;

    const body = {
      mode: brief.mode,
      prompt: brief.prompt,
      finish: brief.finish,
      substrate: brief.substrate,
      brandColors: brief.brandColors,
      industryType: brief.industryType,
      vehicleYear: brief.vehicle.year,
      vehicleMake: brief.vehicle.make,
      vehicleModel: brief.vehicle.model,
      viewType: brief.viewType,
      styleDescriptors: brief.styleDescriptors,
      visionBoardImages: brief.visionBoardImages,
      visionboard_intent: brief.visionboard_intent,
      originalRenderUrl: brief.originalRenderUrl,
      // Forward-compatible: ignored by the current locked function.
      reservedZones: brief.reservedZones,
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": ctx.authHeader,
        "apikey": ctx.anonKey,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.renderUrl) {
      const detail = data?.message || data?.error || `HTTP ${res.status}`;
      throw new Error(`GeminiArtGenerator failed: ${detail}`);
    }

    return {
      imageUrl: data.renderUrl,
      designName: data.designName,
      designAnchorText: data.designAnchorText,
      generationId: data.generationId,
      modelId: "gemini-3-pro-image-preview",
    };
  }
}
