/**
 * ─────────────────────────────────────────────────────────────
 *  RestylePro Prompt-to-Production™ — shared lib for the
 *  restyle-pro-* trio (orchestrator → asset-harvester → prepress-assembler).
 *
 *  Pure, deterministic helpers + shared types. NO generative AI here.
 *  Mirrors the inch-space panel math used by the GENIE pipeline
 *  (_shared/panelizer-os/constants.ts) so a Sprinter and a Miata never
 *  get the same cut.
 * ─────────────────────────────────────────────────────────────
 */

// ── Panel specs (WePrintWraps standard) — inlined so this lib has NO
//    dependency on panelizer-os/constants (keeps the deploy bundle tiny). ──
interface PanelSpec { widthInches: number; heightInches: number; label: string }

const SIDE_PANELS: Record<string, PanelSpec> = {
  small:  { widthInches: 144, heightInches: 59.5, label: "Side Small" },
  medium: { widthInches: 172, heightInches: 59.5, label: "Side Medium" },
  large:  { widthInches: 200, heightInches: 59.5, label: "Side Large" },
  xl:     { widthInches: 240, heightInches: 59.5, label: "Side XL" },
};
const ADDON_PANELS: Record<string, PanelSpec> = {
  hood:        { widthInches: 72,    heightInches: 59.5, label: "Hood" },
  frontBumper: { widthInches: 120.5, heightInches: 38,   label: "Front Bumper" },
  rear:        { widthInches: 72.5,  heightInches: 59,   label: "Rear" },
  rearBumper:  { widthInches: 120,   heightInches: 38,   label: "Rear Bumper" },
};
const ROOF_PANELS: Record<string, PanelSpec> = {
  small:  { widthInches: 72,  heightInches: 59.5, label: "Roof Small" },
  medium: { widthInches: 110, heightInches: 59.5, label: "Roof Medium" },
  large:  { widthInches: 160, heightInches: 59.5, label: "Roof Large" },
};

/** Light vehicle dims (subset of the panelizer VehicleDimensions). */
export interface VehicleDims {
  bodyLengthInches?: number;
  bodyHeightInches?: number;
  source?: string;
}

// ── Storage layout ────────────────────────────────────────────────
export const RESTYLE_BUCKET = "wrap-files";

/** Root prefix for everything this trio writes for a job. */
export function jobPrefix(jobId: string): string {
  return `restyle-pro/${jobId}`;
}

// ── Bleed (customer/North-Star spec: 1" per edge, overridable) ────
export const DEFAULT_BLEED_INCHES = 1;

// ── Types ─────────────────────────────────────────────────────────

/** Normalised bounding box, 0..1 relative to the source proof image. */
export interface RelBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextLayer {
  text: string;
  hexColor: string;       // "#rrggbb"
  fontWeight: string;     // "normal" | "bold"
  fontStyle: string;      // "normal" | "italic"
  relBBox: RelBBox;
}

export interface GradientStop {
  hex: string;
  pos: number;            // 0..1
}

export interface BackgroundSpec {
  type: "linear-gradient" | "solid";
  angleDeg: number;       // 0 = left→right, 90 = top→bottom
  stops: GradientStop[];
}

/** Strict JSON produced by restyle-pro-orchestrator's vision pass. */
export interface SpatialMap {
  background: BackgroundSpec;
  textLayers: TextLayer[];
  logo: { relBBox: RelBBox } | null;
  dominantColors: string[];
  finish: string;
  notes: string;
}

export interface PanelLayout {
  id: string;             // "driver-side" | "passenger-side" | "hood" | "rear" | "roof"
  label: string;
  widthInches: number;
  heightInches: number;
  mirrored: boolean;      // passenger side prints mirrored
  role: "side" | "addon" | "roof";
}

export interface HarvestedAsset {
  id: string;             // "logo" | "text-0" ...
  role: "logo" | "text";
  text?: string;
  relBBox: RelBBox;
  pngPath: string;
  pngUrl: string;
  svgPath: string;
  svgUrl: string;
  width: number;
  height: number;
}

export interface PanelSelection {
  sideSize?: "small" | "medium" | "large" | "xl";
  addHood?: boolean;
  addFrontBumper?: boolean;
  addRearBumper?: boolean;
  addRear?: boolean;
  roofSize?: "none" | "small" | "medium" | "large";
}

// ── Deterministic panel inch-layout ───────────────────────────────
// True side width = real vehicle body length from the CSV DB when available.
export function pickSideSize(vehicle: VehicleDims): "small" | "medium" | "large" | "xl" {
  const len = Number(vehicle?.bodyLengthInches) || 0;
  if (!len) return "medium";
  if (len <= 150) return "small";
  if (len <= 185) return "medium";
  if (len <= 215) return "large";
  return "xl";
}

export function buildPanelLayout(
  selection: PanelSelection,
  vehicle: VehicleDims,
): PanelLayout[] {
  const sizeKey = selection.sideSize || pickSideSize(vehicle);
  const sideBucket = SIDE_PANELS[sizeKey] || SIDE_PANELS.medium;
  const trueLen = Number(vehicle?.bodyLengthInches) || 0;
  const sideW = trueLen > 0 ? trueLen : sideBucket.widthInches;
  const sideH = sideBucket.heightInches;

  const panels: PanelLayout[] = [
    { id: "driver-side", label: "Driver Side", widthInches: sideW, heightInches: sideH, mirrored: false, role: "side" },
    { id: "passenger-side", label: "Passenger Side", widthInches: sideW, heightInches: sideH, mirrored: true, role: "side" },
  ];
  if (selection.addHood) {
    panels.push({ id: "hood", label: "Hood", ...ADDON_PANELS.hood, mirrored: false, role: "addon" });
  }
  if (selection.addRear ?? true) {
    panels.push({ id: "rear", label: "Rear", ...ADDON_PANELS.rear, mirrored: false, role: "addon" });
  }
  if (selection.addFrontBumper) {
    panels.push({ id: "front-bumper", label: "Front Bumper", ...ADDON_PANELS.frontBumper, mirrored: false, role: "addon" });
  }
  if (selection.addRearBumper) {
    panels.push({ id: "rear-bumper", label: "Rear Bumper", ...ADDON_PANELS.rearBumper, mirrored: false, role: "addon" });
  }
  if (selection.roofSize && selection.roofSize !== "none") {
    const roof = ROOF_PANELS[selection.roofSize] || ROOF_PANELS.medium;
    panels.push({ id: "roof", label: "Roof", ...roof, mirrored: false, role: "roof" });
  }
  return panels;
}

/**
 * Map panelizer-step-validate output (real vehicle dims) → PanelLayout[].
 * This is the preferred dims source — single source of truth, no DB import.
 */
export function mapValidatePanels(validatePanels: any[]): PanelLayout[] {
  const roleOf = (id: string): PanelLayout["role"] =>
    id.includes("roof") ? "roof" : (id.includes("side") ? "side" : "addon");
  const out: PanelLayout[] = [];
  for (const vp of validatePanels || []) {
    const id = String(vp.panelKey || "").replace(/-panel\d+$/, "").replace(/_/g, "-");
    if (!id) continue;
    out.push({
      id,
      label: vp.label || id.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
      widthInches: Number(vp.widthInches) || 172,
      heightInches: Number(vp.heightInches) || 59.5,
      mirrored: !!vp.mirrored || id === "passenger-side",
      role: roleOf(id),
    });
  }
  return out;
}

// ── Lean orchestrator manifest (the blueprint passed Edge-1 → Edge-2/3) ──
// Prompts stay hyper-focused on raw vision/analysis; code does the layout.
export interface CanvasGeometry {
  target_panel: string;
  base_width_in: number;
  base_height_in: number;
  bleed_in: number;
}
export interface ManifestElement {
  text_content: string;
  bounding_box_normalized: [number, number, number, number]; // [x, y, w, h] 0..1
  primary_hex: string;
}
export interface PanelManifest {
  job_id: string;
  canvas_geometry: CanvasGeometry;
  base_design_url: string | null;             // the uploaded design = Layer 1
  extracted_elements: Record<string, ManifestElement>;
}

const bbToArr = (b: RelBBox): [number, number, number, number] => [b.x, b.y, b.w, b.h];

/**
 * Build the per-panel lean manifest from the vision spatial map. Same branding
 * elements ride every panel; the assembler re-positions them per panel by math.
 */
export function buildManifests(
  jobId: string,
  panels: PanelLayout[],
  spatialMap: SpatialMap,
  bleedInches: number,
  baseUrlFor: (panel: PanelLayout) => string | null,
): PanelManifest[] {
  const elements: Record<string, ManifestElement> = {};
  if (spatialMap.logo?.relBBox) {
    const lead = spatialMap.textLayers[0];
    elements.branding_logo = {
      text_content: lead?.text || "",
      bounding_box_normalized: bbToArr(spatialMap.logo.relBBox),
      primary_hex: lead?.hexColor || spatialMap.dominantColors[0] || "#ffffff",
    };
  }
  spatialMap.textLayers.forEach((t, i) => {
    const key = i === 0 ? "sub_text" : `text_${i}`;
    elements[key] = {
      text_content: t.text,
      bounding_box_normalized: bbToArr(t.relBBox),
      primary_hex: t.hexColor,
    };
  });
  return panels.map((p) => ({
    job_id: jobId,
    canvas_geometry: {
      target_panel: p.id,
      base_width_in: p.widthInches,
      base_height_in: p.heightInches,
      bleed_in: bleedInches,
    },
    base_design_url: baseUrlFor(p),
    extracted_elements: elements,
  }));
}

// ── Colour helpers ────────────────────────────────────────────────
export function parseHex(hex: string): { r: number; g: number; b: number } {
  let h = (hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 17, g: 17, b: 17 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function normHex(hex: string): string {
  const { r, g, b } = parseHex(hex);
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Gemini API key pool ───────────────────────────────────────────
export function getGoogleAiKeys(): string[] {
  const keys: string[] = [];
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) keys.push(primary);
  for (let i = 2; i <= 8; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) keys.push(k);
  }
  return keys;
}
