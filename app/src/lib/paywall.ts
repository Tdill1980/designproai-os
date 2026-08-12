/**
 * paywall.ts — Global trigger for the token-paywall modal.
 *
 * Any tool that catches a 402 from a render edge function should
 * call `showPaywall(payload)` with the JSON body the gate returned.
 * The PaywallTokenModal mounted at the App root listens for the
 * `restylepro:paywall` window event and renders accordingly.
 *
 * Payload shape matches what tokenGate (supabase/functions/_shared/
 * token-gate.ts) emits on `code: "no_tokens"`:
 *
 *   {
 *     error: "Out of tokens",
 *     code: "no_tokens",
 *     tier: "free" | "starter" | "advanced" | "complete" | ...
 *     subscription_active: boolean,
 *     subscription_remaining: number,
 *     token_balance: number,
 *     cost: number,
 *     paywall: {
 *       buy_tokens: { cost_per_token: number },
 *       production_pack: { price: number },
 *       upgrade_tier: { current: string },
 *     }
 *   }
 */

export interface PaywallPayload {
  error?: string;
  code?: string;
  /** Present on code:"pack_required" — the design generation the print pack
   *  unlocks. Drives create-print-pack-checkout for THIS generation. */
  generation_id?: string | null;
  tier?: string;
  subscription_active?: boolean;
  subscription_remaining?: number;
  token_balance?: number;
  cost?: number;
  paywall?: {
    buy_tokens?: { cost_per_token: number };
    production_pack?: { price: number };
    upgrade_tier?: { current: string };
  };
}

export const PAYWALL_EVENT = "restylepro:paywall" as const;

export function showPaywall(payload: PaywallPayload = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PAYWALL_EVENT, { detail: payload }));
}

/**
 * Convenience helper for the common pattern: detect a 402 from a
 * supabase.functions.invoke() result and fire the paywall.
 *
 * Returns true if the response was a 402 paywall and the modal was
 * shown — caller should NOT try to use the response as a successful
 * render. Returns false otherwise.
 */
export function handleMaybePaywall(
  response: { error?: { context?: { status?: number }; message?: string } | null } | null,
  data: unknown,
): boolean {
  const status = response?.error?.context?.status;
  // Supabase JS surfaces 402 via FunctionsHttpError. The body lives
  // in `data` on some clients and in `error.context.responseText` on
  // others — try both.
  const body = (data ?? {}) as PaywallPayload;
  if (status === 402 || body?.code === "no_tokens") {
    showPaywall(body);
    return true;
  }
  return false;
}
