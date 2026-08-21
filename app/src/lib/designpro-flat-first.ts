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

function legacyRequestedBySearch(search: unknown): boolean {
  try {
    return new URLSearchParams(String(search || "")).get("pipeline") === "legacy";
  } catch {
    return false;
  }
}

export function initialDesignProPipelineMode(
  value: unknown,
  search = "",
): GenerationPipelineMode {
  if (!FLAT_FIRST_ATLAS_UI_ENABLED) return "legacy";

  // URL authority is explicit and makes both modes independently testable.
  // `?pipeline=legacy` is the one-click rollback path; `?pipeline=atlas` is the
  // immutable flat-first path and wins over stale navigation state.
  if (legacyRequestedBySearch(search)) return "legacy";
  if (flatFirstAtlasRequestedBySearch(search)) return FLAT_FIRST_ATLAS_PIPELINE_MODE;

  // A mode deliberately carried by the Home brief remains authoritative.
  if (value === "legacy") return "legacy";
  if (value === FLAT_FIRST_ATLAS_PIPELINE_MODE) return FLAT_FIRST_ATLAS_PIPELINE_MODE;

  // The customer route stays on the production-capable pipeline by default.
  // A.T.L.A.S. is an explicit diagnostic (`?pipeline=atlas` or a carried Home
  // selection) until it can satisfy the same Call 8/9 production contract.
  return "legacy";
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

/** Flat-first cannot use the independent photo-edit path as an atlas source. */
export function myVehiclePhotoFlowEnabledForPipeline(mode: GenerationPipelineMode): boolean {
  return mode !== FLAT_FIRST_ATLAS_PIPELINE_MODE;
}
