/**
 * ArtGenerator — the model-agnostic seam for DesignIQ base-art generation.
 *
 * The "art generator" produces the artistic wrap BASE (background graphics,
 * color flow, texture) for a given vehicle view. It deliberately does NOT own
 * crisp logo / text / photo placement — those are composited on top as layers
 * by the compositor (see _shared/compositor). Keeping that split is what lets
 * the underlying image model be swapped without touching anything else.
 *
 * Implementations:
 *   - GeminiArtGenerator  — today. Delegates to the (locked) design-panel-ai-generate path.
 *   - VertexArtGenerator  — later. Our own DesignDNA-trained model. Drop-in: same interface.
 *
 * NOTHING in this module modifies a locked render file. Implementations wrap
 * the existing path behind this contract.
 */

/** A region the base art should leave clean so a crisp layer can be composited on top. */
export interface ReservedZone {
  role: "logo" | "company_name" | "contact_bar" | "photo_subject" | "qr";
  /** Normalized 0–1 rectangle within the 16:9 render frame. */
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  /** Optional guidance, e.g. "keep flat, evenly lit, free of graphics". */
  note?: string;
}

export interface ArtBrief {
  mode: "commercial" | "restyle";
  prompt: string;
  finish: string;
  substrate?: string;
  vehicle: { year?: string; make?: string; model?: string };
  viewType: string;
  brandColors?: string;
  industryType?: string;
  /** Clean regions to leave empty for compositing. Empty array = paint the whole wrap (current behavior). */
  reservedZones: ReservedZone[];
  styleDescriptors?: string;
  visionBoardImages?: { slotLabel: string; storageUrl: string }[];
  visionboard_intent?: "style_inspiration" | "exact_reference";
  /** For the 7-view fan-out: the hero render to clone other angles from. */
  originalRenderUrl?: string;
}

export interface ArtResult {
  /** Storage URL of the generated base art (the existing path uploads and returns a URL). */
  imageUrl: string;
  designName?: string;
  designAnchorText?: string;
  /** Which engine produced this — for telemetry and A/B (e.g. "gemini-3-pro-image-preview", "vertex-designdna-v1"). */
  modelId: string;
  /** Raw generation id / status passthrough for tracking. */
  generationId?: string;
}

export interface ArtGenerator {
  /** Stable id of the engine, e.g. "gemini" | "vertex". */
  readonly id: string;
  generateBaseArt(brief: ArtBrief, ctx: ArtGeneratorContext): Promise<ArtResult>;
}

/** Per-request context (auth + project) the implementation needs to call out. */
export interface ArtGeneratorContext {
  supabaseUrl: string;
  /** Forwarded end-user Authorization header (the locked function authenticates the user). */
  authHeader: string;
  /** Anon/publishable key for the functions gateway. */
  anonKey: string;
}
