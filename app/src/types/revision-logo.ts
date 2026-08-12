/**
 * Shared types for the RevisionIQ logo layer system.
 *
 * Two layer kinds, one strip:
 *   - "uploaded" — Carley dropped her own logo file (Feature 1)
 *   - "extracted" — wand-clicked off the existing AI render (Feature 2)
 *
 * Both kinds get persisted on the render record so QC artboard and the
 * print pipeline can re-composite them at exact coordinates without drift.
 */

export type LogoLayerKind = "uploaded" | "extracted";

export type LogoSize = "sm" | "md" | "lg";

export interface LogoPlacement {
  /** Center x as fraction of render width (0-1) */
  xPct: number;
  /** Center y as fraction of render height (0-1) */
  yPct: number;
  /** Discrete size bucket — width fraction is computed at composite time */
  size: LogoSize;
  /** Continuous size override (0.05–0.50 = 5%–50% of image width). Takes precedence over `size` when set. */
  sizePercent?: number;
  /** Clockwise rotation in degrees about the object's center. Defaults to 0. */
  rotationDeg?: number;
}

export interface LogoLayer {
  /** Stable unique id, e.g. upl_xxx or ext_xxx */
  id: string;
  kind: LogoLayerKind;
  /** Public URL of the cleaned, tight-cropped PNG for this layer */
  sourceUrl: string;
  /** Public URL of the vectorized SVG version of this layer, when present.
   *  Populated by the per-layer "Vectorize" action that runs the layer's
   *  alpha-cleaned PNG through /api/vectorize-it (VTracer). */
  svgUrl?: string;
  /** Display name (auto-generated, optionally renamed by user) */
  name: string;
  /**
   * For "extracted" layers: the (xPct, yPct, wPct, hPct) bbox where this
   * element originally lived on the AI render — used as the QC default
   * position when nothing else is set.
   */
  origin?: { xPct: number; yPct: number; wPct: number; hPct: number };
  /** Where the user placed it on the current view, or null if not yet placed */
  placement: LogoPlacement | null;
  /**
   * Layers extracted from the same element across multiple views share a
   * groupId, so placing one re-positions the rest at the same relative coords.
   */
  groupId?: string;
  /**
   * For extracted layers: the base RGB color the magic wand used. Lets us
   * re-run the same extraction on sibling views with consistent settings.
   */
  sourceColor?: { r: number; g: number; b: number };
  /** Tolerance value used for the original wand extraction */
  tolerance?: number;
}

/**
 * Top-level shape stored on color_visualizations.admin_notes.logo_layers
 *
 * Keyed by view (side, front, rear, ...) so each angle has its own clean
 * background, layer set, and placements. The print pipeline reads these
 * directly to skip drift on panelization.
 */
export interface RenderLogoLayers {
  /** Per-view clean background URL (AI render with extracted elements patched) */
  backgrounds?: Record<string, string>;
  /** Per-view layer arrays (uploaded + extracted) */
  layers?: Record<string, LogoLayer[]>;
}
