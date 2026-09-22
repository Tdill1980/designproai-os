import { PROOF_BRAND } from "@/lib/os-brand";

export const ATLAS_UNCONFIRMED_OUTCOME_CODE = "provider_outcome_unknown";
export const GENERATION_ACTIVE_LIMIT_CODE = "generation_active_request_limit";
export const GENERATION_ACTIVE_LIMIT_MESSAGE =
  "Wait for your current design to finish, then submit this brief. Your brief is still here; this design has not started.";

export const ATLAS_UNCONFIRMED_OUTCOME_MESSAGE =
  `Your ${PROOF_BRAND.full} didn't finish because the image service response could not be confirmed. Open the saved run to inspect its recorded status.`;

export function isUnconfirmedProviderOutcome(error: unknown): boolean {
  const value = error as { code?: unknown; message?: unknown } | null;
  return String(value?.code || value?.message || error || "")
    .includes(ATLAS_UNCONFIRMED_OUTCOME_CODE);
}

/**
 * ⛔ A CUSTOMER NEVER READS AN INTERNAL CODE, AND NEVER READS "ATLAS".
 *
 * Owner, 2026-09-21, looking at the VehiclePro screen showing
 * "ATLAS generation did not complete." over
 * `flat_atlas_edge_topology_contract_mismatch`: "It should never say this
 * ever."
 *
 * Both halves were wrong. ATLAS is internal vocabulary for assembling flat
 * panels in PanelProStudio -- the customer's Call 1 is the Production Panel
 * Proof, and they have no reason to know the other name exists. And an error
 * code is diagnostics: it tells a buyer nothing and reads as a broken product.
 *
 * So the raw string never reaches the alert. A known code resolves to a
 * sentence; anything unrecognised falls back to one. The code itself stays in
 * the console, the failed row and the admin surfaces, which is where someone
 * can act on it.
 */
export const GENERATION_FAILED_FALLBACK_MESSAGE =
  `Your ${PROOF_BRAND.full} didn't finish. Your brief is still here — try it again.`;

const CUSTOMER_FACING_MESSAGES: Record<string, string> = {
  [GENERATION_ACTIVE_LIMIT_CODE]: GENERATION_ACTIVE_LIMIT_MESSAGE,
  [ATLAS_UNCONFIRMED_OUTCOME_CODE]: ATLAS_UNCONFIRMED_OUTCOME_MESSAGE,
  flat_atlas_edge_topology_contract_mismatch:
    "Your design came back in a shape the production step couldn't accept. Try it again.",
  designpro_atlas_call1_graph_unavailable:
    `The ${PROOF_BRAND.full} service is busy right now. Try it again in a moment.`,
  flat_atlas_edge_master_path_missing:
    "The design service didn't return a finished proof. Try it again.",
  provider_private_request_invalid:
    "Your brief was too large for the design service to accept. Try trimming the reference images.",
};

/** Looks like an internal code rather than a sentence: snake_case, no spaces. */
function looksLikeInternalCode(value: string): boolean {
  return /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(value.trim());
}

/**
 * The ONLY string a customer is shown when a generation fails. It can never be
 * a raw code and can never contain "ATLAS".
 */
export function customerFacingGenerationMessage(
  errorCode: string | null | undefined,
  error: string | null | undefined,
): string {
  // A SENTENCE ALREADY WRITTEN FOR A PERSON WINS over a code lookup. The
  // server sends specific, human errors ("Sign in again to inspect this saved
  // design.") alongside a generic code; mapping the code first would replace
  // the useful sentence with a vaguer one.
  const text = String(error || "").trim();
  if (text && !looksLikeInternalCode(text) && !/atlas/i.test(text)) return text;

  for (const candidate of [errorCode, error]) {
    const key = String(candidate || "").trim();
    if (key && CUSTOMER_FACING_MESSAGES[key]) return CUSTOMER_FACING_MESSAGES[key];
  }
  return GENERATION_FAILED_FALLBACK_MESSAGE;
}
