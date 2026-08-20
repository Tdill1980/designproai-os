/**
 * WHICH ARTIFACT IS WHICH.
 *
 * These are pure functions over what the standalone runtime already emitted,
 * and they import nothing at runtime -- only types. That is deliberate: the two
 * rules below are the ones this product has broken most expensively, and a
 * selector that can be exercised without booting a Supabase client, a browser
 * or a session is a selector that actually gets tested.
 *
 * RULE ONE -- THE PROOF IS IDENTIFIED BY ROLE, NEVER BY KIND. Call 8 emits two
 * artifacts of kind "flat-proof": the customer's 2D Production Proof and the
 * internal canonical production surface. Both are honest images of the right
 * design, so showing the wrong one fails silently -- the customer approves a
 * manufacturing surface believing it is their proof. Only metadata.role
 * separates them, so only metadata.role is allowed to.
 *
 * Per-side pairing deliberately does NOT live here: toProductionLayers already
 * owns it, keyed by each artifact's own surfaceKey, and a second implementation
 * of the same mapping is how two panel sets end up both claiming to be a side.
 */

import type { WorkflowArtifact } from "@/lib/designpro-api";

/** The one role that is the customer's 2D Production Proof. */
export const CUSTOMER_PROOF_ROLE = "customer-2d-production-proof";

/**
 * The customer's Call 8 proof, or null while the run has not produced one.
 *
 * Throws on more than one. Two artifacts each claiming to be THE customer proof
 * is not a preference to be resolved quietly downstream -- it means Call 8
 * emitted a contradiction, and picking either one hides it.
 */
export function selectCustomerProof(
  artifacts: readonly WorkflowArtifact[] | undefined | null,
): WorkflowArtifact | null {
  const proofs = (artifacts ?? []).filter(
    (artifact) => artifact.kind === "flat-proof" && artifact.metadata?.role === CUSTOMER_PROOF_ROLE,
  );
  if (proofs.length > 1) {
    throw new Error(`customer_2d_production_proof_cardinality:${proofs.length}`);
  }
  return proofs[0] ?? null;
}
