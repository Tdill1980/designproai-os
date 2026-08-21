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
  return FLAT_FIRST_ATLAS_UI_ENABLED && (
    value === FLAT_FIRST_ATLAS_PIPELINE_MODE || flatFirstAtlasRequestedBySearch(search)
  )
    ? FLAT_FIRST_ATLAS_PIPELINE_MODE
    : "legacy";
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
