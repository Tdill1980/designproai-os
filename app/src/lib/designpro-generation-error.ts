export const ATLAS_UNCONFIRMED_OUTCOME_CODE = "provider_outcome_unknown";

export const ATLAS_UNCONFIRMED_OUTCOME_MESSAGE =
  "ATLAS generation did not complete because the image service response could not be confirmed. Open the saved run to inspect its recorded status.";

export function isUnconfirmedProviderOutcome(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  return String(value?.code || value?.message || error || "")
    .includes(ATLAS_UNCONFIRMED_OUTCOME_CODE);
}
