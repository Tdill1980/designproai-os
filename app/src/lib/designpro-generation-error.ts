export const ATLAS_UNCONFIRMED_OUTCOME_CODE = "provider_outcome_unknown";
export const GENERATION_ACTIVE_LIMIT_CODE = "generation_active_request_limit";
export const GENERATION_ACTIVE_LIMIT_MESSAGE =
  "Wait for your current design to finish, then submit this brief. Your brief is still here; this design has not started.";

export const ATLAS_UNCONFIRMED_OUTCOME_MESSAGE =
  "ATLAS generation did not complete because the image service response could not be confirmed. Open the saved run to inspect its recorded status.";

export function isUnconfirmedProviderOutcome(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  return String(value?.code || value?.message || error || "")
    .includes(ATLAS_UNCONFIRMED_OUTCOME_CODE);
}
