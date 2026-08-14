/**
 * VIDEO BLUEPRINT — the authoritative rendering object for DesignProAI's
 * native video pipeline. Ported from the proven WrapCommandAI SceneBlueprint
 * contract (2026-07). If it doesn't exist, nothing renders — no fallbacks,
 * no templates. The ffmpeg worker (worker/video-renderer) renders this
 * EXACTLY as specified.
 */

export interface VideoBlueprint {
  id: string;
  platform: 'instagram' | 'tiktok' | 'youtube' | 'facebook';
  totalDuration: number;

  scenes: VideoBlueprintScene[];

  endCard?: {
    duration: number;
    text: string;
    cta: string;
  };

  // Metadata for tracking
  createdAt?: string;
  source?: 'ai' | 'manual' | 'auto_assemble';

  // Which brand this content is for (e.g. 'weprintwraps', 'restylepro')
  brand?: string;

  // ── Target lock ──
  format?: 'reel' | 'story' | 'short';
  aspectRatio?: '9:16' | '1:1' | '16:9';

  // ── Style binding (overlay pack) ──
  overlayPack?: string;
  font?: string;
  textStyle?: 'bold' | 'minimal' | 'modern';

  // ── Caption style ──
  // sabri: UPPERCASE, bold, punchy · dara: sentence case, professional
  // clean: lowercase, minimal
  captionStyle?: 'sabri' | 'dara' | 'clean';

  // Global caption for the whole video (post copy, not burned in)
  caption?: string;
  title?: string;
}

export interface VideoBlueprintScene {
  sceneId: string;
  clipId: string;
  clipUrl: string;

  // EXACT timing within the source clip — no estimation
  start: number;
  end: number;

  // Editorial purpose - this drives the edit
  purpose: 'hook' | 'pattern_interrupt' | 'proof' | 'payoff' | 'cta' | 'b_roll' | 'reveal';

  // Burned-in text overlay (optional)
  text?: string;
  textPosition?: 'top' | 'center' | 'bottom';
  animation?: 'pop' | 'slide' | 'fade' | 'punch' | 'typewriter';

  // Editorial reasoning (for debugging)
  cutReason?: string;
}

// ── Overlay pack definitions (brand style bindings) ──
export const OVERLAY_PACK_MAP: Record<string, { font: string; textStyle: 'bold' | 'minimal' | 'modern' }> = {
  'wpw_signature': { font: 'Inter Black', textStyle: 'bold' },
  'restylepro': { font: 'Poppins', textStyle: 'modern' },
  'modern-clean': { font: 'Inter', textStyle: 'modern' },
  'minimal': { font: 'SF Pro', textStyle: 'minimal' },
};

/**
 * Validates that a blueprint is complete and renderable.
 */
export function validateVideoBlueprint(blueprint: VideoBlueprint | null): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!blueprint) {
    errors.push('No blueprint provided');
    return { valid: false, errors };
  }

  if (!blueprint.id) errors.push('Blueprint missing ID');
  if (!blueprint.platform) errors.push('Blueprint missing platform');
  if (!blueprint.scenes || blueprint.scenes.length === 0) errors.push('Blueprint has no scenes');

  if (blueprint.scenes) {
    blueprint.scenes.forEach((scene, idx) => {
      if (!scene.clipUrl) errors.push(`Scene ${idx + 1} missing clipUrl`);
      if (scene.start === undefined || scene.end === undefined) errors.push(`Scene ${idx + 1} missing timing`);
      if (scene.end <= scene.start) errors.push(`Scene ${idx + 1} has invalid timing (end <= start)`);
    });
  }

  return { valid: errors.length === 0, errors };
}
