/**
 * DesignPro Raster Studio — layer schema (single source of truth).
 *
 * The Konva editor produces this JSON document and persists it to
 * public.design_canvas_documents. api/flatten-canvas.js composites it at full
 * resolution. Keep the two in sync.
 *
 * Coordinate space: ALL geometry is in full-resolution document pixels.
 * Rotation is about the layer CENTER; position (cx, cy) is the center, which
 * keeps Konva (offset = center) and sharp (.rotate() about center) in parity.
 *
 * Text layers are rasterized on the client at export time (exact font fidelity)
 * and sent to the server as raster layers, so the server stays raster-only.
 */

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion";

export const BLEND_MODES: BlendMode[] = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion",
];

/** Per-layer adjustments. 1 = no change for brightness/contrast/saturation. */
export interface LayerFilters {
  brightness: number; // 0..2
  contrast: number;   // 0..2
  saturation: number; // 0..2
  blur: number;       // px, 0 = none
}

export const NEUTRAL_FILTERS: LayerFilters = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  blur: 0,
};

export function hasActiveFilters(f?: LayerFilters | null): boolean {
  if (!f) return false;
  return f.brightness !== 1 || f.contrast !== 1 || f.saturation !== 1 || f.blur > 0;
}

/** Image-based alpha mask: luminance is used as alpha (white = visible). */
export interface LayerMask {
  src: string;
}

interface BaseLayer {
  id: string;
  name: string;
  /** Center X / Y in doc pixels. */
  cx: number;
  cy: number;
  /** Displayed (post-scale) size in doc pixels. */
  width: number;
  height: number;
  /** Rotation in degrees, clockwise, about the layer center. */
  rotation: number;
  /** 0..1 */
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  /** locked layers cannot be selected/transformed in the editor. */
  locked?: boolean;
  filters?: LayerFilters;
  mask?: LayerMask | null;
}

export interface RasterLayer extends BaseLayer {
  type: "raster";
  /** Storage URL or signed URL of the layer's source image. */
  src: string;
}

export type TextAlign = "left" | "center" | "right";
export type FontStyle = "normal" | "bold" | "italic" | "bold italic";

export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  fontFamily: string;
  fontSize: number; // doc px
  fill: string;     // hex
  fontStyle: FontStyle;
  align: TextAlign;
  lineHeight: number;
  letterSpacing: number;
}

export type Layer = RasterLayer | TextLayer;

export const FONT_FAMILIES = [
  "Poppins", "Oswald", "Inter", "Arial", "Helvetica", "Georgia",
  "Times New Roman", "Courier New", "Impact", "Verdana",
];

export interface CanvasSpec {
  width: number;
  height: number;
  dpi: number;
  /** hex background fill, or "transparent". */
  background: string;
}

export interface CanvasDocument {
  id?: string;
  name: string;
  canvas: CanvasSpec;
  /** bottom-first: layers[0] is the bottom of the stack. */
  layers: Layer[];
}

export function newLayerId(): string {
  return `layer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultCanvasDocument(): CanvasDocument {
  return {
    name: "Untitled design",
    canvas: { width: 12000, height: 4000, dpi: 150, background: "#ffffff" },
    layers: [],
  };
}
