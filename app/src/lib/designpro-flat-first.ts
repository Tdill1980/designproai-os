import {
  FLAT_FIRST_ATLAS_PIPELINE_MODE,
  type GenerationPipelineMode,
} from "@/lib/designpro-api";
import type { VehicleType } from "@/components/tools/VehicleTypeSelector";

/**
 * Deployment kill switch. Unset/false preserves the legacy UI and v2 request
 * byte-for-byte; the test option only appears when an operator enables it.
 */
const flag = String(import.meta.env.VITE_DESIGNPRO_FLAT_FIRST_V1 || "").toLowerCase();
export const FLAT_FIRST_ATLAS_UI_ENABLED = ["1", "true", "on", "enabled"].includes(flag);

export function flatFirstAtlasRequestedBySearch(search: unknown): boolean {
  try {
    const requested = new URLSearchParams(String(search || "")).get("pipeline");
    return requested === "atlas" || requested === FLAT_FIRST_ATLAS_PIPELINE_MODE;
  } catch {
    return false;
  }
}

export function initialDesignProPipelineMode(
  value: unknown,
  search = "",
): GenerationPipelineMode {
  if (!FLAT_FIRST_ATLAS_UI_ENABLED) return "legacy";

  // A.T.L.A.S. is the canonical design authority (RULE 0.17 / 0.21), so it is
  // what Create Design sends. This used to default to `legacy` and treat the
  // atlas as an opt-in diagnostic — which is why every live customer request
  // on 2026-08-24/25 arrived as `designpro.calls-1-7-input.v2` with a null
  // pipelineMode and died in `generation_slots_failed`, while the atlas
  // masters sat at zero production runs. The diagnostic framing is over.
  if (flatFirstAtlasRequestedBySearch(search)) return FLAT_FIRST_ATLAS_PIPELINE_MODE;

  // An explicit mode carried by the Home brief remains authoritative, and
  // `?pipeline=legacy` is still the one-URL rollback to the standard producer.
  if (value === "legacy") return "legacy";
  if (legacyRequestedBySearch(search)) return "legacy";

  return FLAT_FIRST_ATLAS_PIPELINE_MODE;
}

function legacyRequestedBySearch(search: unknown): boolean {
  try {
    return new URLSearchParams(String(search || "")).get("pipeline") === "legacy";
  } catch {
    return false;
  }
}

/**
 * Until a revision endpoint accepts the parent atlas revision id, allowing the
 * legacy prompt handler would create a separate design while presenting it as
 * a child edit. Fail closed instead.
 */
export function inlineRevisionEnabledForPipeline(mode: GenerationPipelineMode): boolean {
  return mode !== FLAT_FIRST_ATLAS_PIPELINE_MODE;
}

const FLAT_FIRST_ATLAS_SUPPORTED_VEHICLE_TYPES = new Set([
  "car",
  "truck",
  "suv",
  "van",
]);

/**
 * The current proof-only estimator has bounded body-class rules for these four
 * vehicle families. Everything else stays on legacy until an explicit topology
 * contract exists, so an unsupported selection cannot consume a Gemini call.
 */
export function flatFirstAtlasSupportedVehicleType(value: unknown): boolean {
  return FLAT_FIRST_ATLAS_SUPPORTED_VEHICLE_TYPES.has(String(value || "").trim().toLowerCase());
}

const DESIGNPRO_VEHICLE_TYPES: VehicleType[] = [
  "car",
  "truck",
  "suv",
  "van",
  "motorcycle",
  "boat",
  "bus",
  "rv",
  "trailer",
];

/** Normalize legacy Home labels (for example `SUV`) into the exact API enum. */
export function normalizeDesignProVehicleType(value: unknown): VehicleType {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return DESIGNPRO_VEHICLE_TYPES.includes(normalized as VehicleType)
    ? (normalized as VehicleType)
    : "car";
}

/**
 * Correct unmistakable model identities before they enter either pipeline.
 * The selector historically defaulted to `car`, so a Ford F-Series request
 * could reach prompts and GENIE with contradictory body-class data even though
 * the model name itself was unambiguous.
 */
export function normalizeDesignProVehicleTypeForIdentity(
  value: unknown,
  make: unknown,
  model: unknown,
): VehicleType {
  const declared = normalizeDesignProVehicleType(value);
  // AN EXPLICIT CHOICE IS NEVER OVERRIDDEN. Identity resolution exists only to
  // correct the historical `car` default; if the customer picked truck, suv or
  // van, that is the answer.
  if (declared !== "car") return declared;
  const identity = `${String(make || "").trim()} ${String(model || "").trim()}`.toLowerCase();
  // VAN IS TESTED FIRST, AND THE ORDER IS LOAD-BEARING. The truck pattern
  // contains `\bram\b`, so "RAM ProMaster 1500" matches it and would resolve
  // truck before ever reaching a van branch placed after it. A specific van
  // MODEL identity beats a generic truck MAKE identity.
  if (/\b(?:transit|sprinter|promaster|econoline|e[\s-]?(?:150|250|350)|express|savana|nv\s?(?:200|1500|2500|3500)|metris|ducato|boxer|crafter|master|movano|city\s?express)\b/.test(identity)) {
    return "van";
  }
  if (/\b(ford\s+)?f[\s-]?(?:150|250|350|450|550)\b|\b(?:silverado|sierra|ram|tundra|tacoma|colorado|canyon|ranger|maverick|frontier|titan|ridgeline|gladiator)\b/.test(identity)) {
    return "truck";
  }
  return declared;
}

/** Flat-first cannot use the independent photo-edit path as an atlas source. */
export function myVehiclePhotoFlowEnabledForPipeline(mode: GenerationPipelineMode): boolean {
  return mode !== FLAT_FIRST_ATLAS_PIPELINE_MODE;
}
