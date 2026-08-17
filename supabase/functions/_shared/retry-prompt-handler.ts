/**
 * RETRY PROMPT HANDLER — Progressive Prompt Distillation for Render Quality
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Instead of dumb `substring(0, 2000)` truncation that chops prompts mid-sentence
 * and loses critical color/material data, this handler intelligently distills
 * prompts at each retry tier — keeping what matters, dropping what doesn't.
 *
 * PRIORITY ORDER (highest → lowest):
 *   1. Vehicle identity + color specs (LAB, hex, finish)
 *   2. Camera angle + resolution
 *   3. Studio environment (condensed)
 *   4. Panel lock rules (condensed)
 *   5. Photorealism cues
 *   6. Expert designer knowledge, branding, verbose enforcement — DROPPED on retry
 *
 * LOCKED MODEL: gemini-3-pro-image-preview — NO flash fallback.
 *
 * @file retry-prompt-handler.ts
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RenderEssentials {
  vehicle: string;
  colorName: string;
  hex: string;
  finish: string;
  cameraAngle: string;
  /** LAB values — the most critical data for color accuracy */
  lab?: { L: number; a: number; b: number };
  manufacturer?: string;
  reflectivity?: number;
  metallic_flake?: number;
  isColorFlipFilm?: boolean;
  isRevisionMode?: boolean;
  /** The original full prompt from Tier 1 */
  fullPrompt: string;
  /** Optional: GraphicsPro zone block (kept through Tier 2, dropped Tier 3+) */
  graphicsProZoneBlock?: string;
  /** Optional: revision edit instruction */
  revisionInstruction?: string;
}

export interface TierResult {
  prompt: string;
  model: string;
  modalities: string[];
  tier: number;
  charCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const LOCKED_MODEL = "gemini-3-pro-image-preview";

/**
 * Max prompt lengths per tier. Gemini quality degrades beyond ~6K chars.
 * Tier 1 allows the full prompt (capped at 6K recommended).
 * Lower tiers get progressively shorter for higher success rates.
 */
const TIER_LIMITS = {
  1: 6000,
  2: 3000,
  3: 1500,
  4: 800,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Core: Build prompt for a given tier
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns an optimized prompt + config for the given retry tier.
 *
 * Tier 1: Full prompt (capped at TIER_LIMITS[1])
 * Tier 2: Distilled — vehicle + color + LAB + finish + camera + studio (condensed)
 * Tier 3: Minimal — vehicle + color + LAB + camera + resolution only
 * Tier 4: Ultra-minimal anchor — same model, IMAGE-only modality
 *
 * ALL tiers use gemini-3-pro-image-preview. No flash fallback.
 */
export function buildTierPrompt(
  tier: number,
  essentials: RenderEssentials
): TierResult {
  const { vehicle, colorName, hex, finish, cameraAngle, lab, manufacturer,
          reflectivity, metallic_flake, isColorFlipFilm, isRevisionMode,
          fullPrompt, graphicsProZoneBlock, revisionInstruction } = essentials;

  let prompt: string;
  let modalities: string[];

  switch (tier) {
    case 1: {
      // Tier 1: Full prompt, trimmed to 6K if over limit
      prompt = fullPrompt.length > TIER_LIMITS[1]
        ? smartTrim(fullPrompt, TIER_LIMITS[1])
        : fullPrompt;
      modalities = ["TEXT", "IMAGE"];
      break;
    }

    case 2: {
      // Tier 2: Distilled essentials — ~3K chars max
      const parts: string[] = [];

      parts.push("[GENERATE IMAGE] Professional automotive studio photograph.");

      // Color spec (highest priority)
      parts.push(buildColorBlock(essentials));

      // Camera + resolution
      parts.push(`Vehicle: ${vehicle}\nCamera: ${cameraAngle}\nResolution: 3840x2160, 16:9 landscape.`);

      // Condensed studio
      parts.push("Studio: Dark polished concrete floor, medium-dark gray wall, neutral daylight 5500K, diffused softboxes hidden from view.");

      // Finish
      parts.push(`Finish: ${finish}${reflectivity !== undefined ? ` (reflectivity: ${reflectivity.toFixed(2)})` : ''}`);

      // GraphicsPro zones if present (important for multi-zone renders)
      if (graphicsProZoneBlock) {
        parts.push(graphicsProZoneBlock.substring(0, 500));
      }

      // Condensed panel rules
      parts.push("Wrap body panels only (hood, roof, trunk, fenders, doors, bumpers). NEVER wrap windows, glass, grilles, headlights, taillights, wheels, or tires.");

      // Condensed quality
      parts.push("Photorealistic, Canon EOS R5 quality, f/8, ISO 100. No text, no watermarks, no visible studio equipment.");

      if (isColorFlipFilm) {
        parts.push("This is a color-shift film — show visible color variation across panels at different viewing angles.");
      }

      if (isRevisionMode && revisionInstruction) {
        parts.push(`[EDIT] ${revisionInstruction}`);
      }

      prompt = parts.join("\n\n");
      if (prompt.length > TIER_LIMITS[2]) {
        prompt = smartTrim(prompt, TIER_LIMITS[2]);
      }
      modalities = ["TEXT", "IMAGE"];
      break;
    }

    case 3: {
      // Tier 3: Minimal — just the essentials, IMAGE-only modality
      const colorSpec = lab
        ? `Color: ${colorName} (LAB: L*=${lab.L.toFixed(1)}, a*=${lab.a.toFixed(1)}, b*=${lab.b.toFixed(1)}, hex ${hex})`
        : `Color: ${colorName} (hex ${hex})`;

      prompt = [
        `[GENERATE IMAGE] ${vehicle} in ${colorName} ${finish} vinyl wrap.`,
        colorSpec,
        `Finish: ${finish}.`,
        `Camera: ${cameraAngle}. Resolution: 3840x2160, 16:9 landscape.`,
        "Dark studio, concrete floor. Photorealistic automotive photo. No text.",
        "Wrap body panels only. Do not wrap windows, lights, grilles, or wheels.",
      ].join("\n");

      if (isRevisionMode && revisionInstruction) {
        prompt = `[EDIT] ${revisionInstruction}\n\n${prompt}`;
      }

      modalities = ["IMAGE"];
      break;
    }

    case 4:
    default: {
      // Tier 4: Ultra-minimal anchor — still uses locked model (NOT flash)
      const colorRef = lab
        ? `LAB(${lab.L.toFixed(0)},${lab.a.toFixed(0)},${lab.b.toFixed(0)}) hex ${hex}`
        : `hex ${hex}`;

      prompt = isRevisionMode && revisionInstruction
        ? `[EDIT] ${revisionInstruction}\n${vehicle}, ${colorName} ${finish} wrap, ${colorRef}. ${cameraAngle}. 3840x2160. No text.`
        : `[GENERATE IMAGE] ${vehicle}, ${colorName} ${finish} wrap, ${colorRef}. ${cameraAngle}. 3840x2160 studio photo. No text.`;

      modalities = ["IMAGE"];
      break;
    }
  }

  return {
    prompt,
    model: LOCKED_MODEL,
    modalities,
    tier,
    charCount: prompt.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Build color block with LAB priority
// ─────────────────────────────────────────────────────────────────────────────

function buildColorBlock(essentials: RenderEssentials): string {
  const { colorName, hex, lab, manufacturer, metallic_flake, isColorFlipFilm } = essentials;

  if (lab) {
    return [
      `COLOR LOCK: ${manufacturer || 'Custom'} "${colorName}"`,
      `LAB: L*=${lab.L.toFixed(2)}, a*=${lab.a.toFixed(2)}, b*=${lab.b.toFixed(2)}`,
      `HEX: ${hex} (secondary reference — LAB is primary)`,
      metallic_flake !== undefined && metallic_flake > 0.1
        ? `Metallic flake: ${metallic_flake.toFixed(2)}`
        : null,
      isColorFlipFilm ? "Color-shift film — show multi-tone variation." : null,
      "Match LAB values exactly. Do not override with training data.",
    ].filter(Boolean).join("\n");
  }

  return [
    `COLOR: ${manufacturer || 'Custom'} "${colorName}"`,
    `HEX: ${hex} — match this exactly.`,
    isColorFlipFilm ? "Color-shift film — show multi-tone variation." : null,
  ].filter(Boolean).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Smart trim — cuts at sentence boundaries, not mid-word
// ─────────────────────────────────────────────────────────────────────────────

function smartTrim(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  // Find the last sentence boundary before the limit
  const truncated = text.substring(0, maxLength);
  const lastPeriod = truncated.lastIndexOf(".");
  const lastNewline = truncated.lastIndexOf("\n");
  const cutPoint = Math.max(lastPeriod, lastNewline);

  if (cutPoint > maxLength * 0.7) {
    return truncated.substring(0, cutPoint + 1);
  }

  // Fallback: cut at last space
  const lastSpace = truncated.lastIndexOf(" ");
  return lastSpace > maxLength * 0.5
    ? truncated.substring(0, lastSpace)
    : truncated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Log tier escalation
// ─────────────────────────────────────────────────────────────────────────────

export function logTierEscalation(
  fromTier: number,
  toTier: number,
  reason: string,
  waitMs: number
): string {
  const emoji = toTier <= 2 ? "🔄" : toTier === 3 ? "⚠️" : "🚨";
  const msg = `${emoji} Escalating Tier ${fromTier} → Tier ${toTier}: ${reason} (wait ${waitMs}ms)`;
  console.log(msg);
  return msg;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Calculate exponential backoff
// ─────────────────────────────────────────────────────────────────────────────

export function getBackoffMs(tier: number): number {
  // Tier 1→2: 2s, Tier 2→3: 4s, Tier 3→4: 8s
  return Math.min(2000 * Math.pow(2, tier - 1), 16000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Extract essentials from a full prompt (for existing callers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts render essentials from request params, for callers that already
 * have structured data (e.g., generate-color-render, design-panel-ai-generate).
 *
 * This does NOT parse the prompt string — it takes structured request fields
 * and packages them for buildTierPrompt().
 */
export function extractEssentials(params: {
  vehicle: string;
  colorName: string;
  hex: string;
  finish: string;
  cameraAngle: string;
  fullPrompt: string;
  lab?: { L: number; a: number; b: number };
  manufacturer?: string;
  reflectivity?: number;
  metallic_flake?: number;
  isColorFlipFilm?: boolean;
  isRevisionMode?: boolean;
  graphicsProZoneBlock?: string;
  revisionInstruction?: string;
}): RenderEssentials {
  return { ...params };
}
