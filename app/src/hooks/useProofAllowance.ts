/**
 * useProofAllowance
 *
 * Live tier info for the logged-in shop owner. Powers the Send-for-Approval
 * dialog so shops see their remaining proofs, whether AI revisions are
 * allowed on this tier, and whether the white-label logo input should be
 * shown or greyed out.
 *
 * The underlying check_proof_allowance() SECURITY DEFINER function is the
 * single source of truth — Phase 7 admin UI reads the same function.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProofAllowance {
  remaining: number;
  tier: string;
  ai_revisions_per_proof: number;
  white_label_enabled: boolean;
}

async function fetchAllowance(): Promise<ProofAllowance | null> {
  // Read the cached session (local, no network) instead of getUser(): the
  // latter does a network round-trip behind a cross-tab Web Lock and can
  // hang indefinitely with several app tabs open, which would leave the
  // usage meter stuck on "Loading usage…". A short timeout guards any stall.
  const sessionRes = await Promise.race([
    supabase.auth.getSession(),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
  const user = (sessionRes as any)?.data?.session?.user ?? null;
  if (!user) return null;
  const { data, error } = await supabase.rpc("check_proof_allowance", {
    p_user_id: user.id,
  });
  if (error) {
    console.error("useProofAllowance: rpc failed:", error.message);
    return null;
  }
  if (!Array.isArray(data) || data.length === 0) return null;
  const row = data[0] as ProofAllowance;
  return {
    remaining: Number(row.remaining ?? 0),
    tier: String(row.tier ?? "Bronze"),
    ai_revisions_per_proof: Number(row.ai_revisions_per_proof ?? 0),
    white_label_enabled: Boolean(row.white_label_enabled),
  };
}

export function useProofAllowance() {
  return useQuery({
    queryKey: ["proof_allowance"],
    queryFn: fetchAllowance,
    staleTime: 60 * 1000, // 1 min — fresh enough for the dialog
    gcTime: 5 * 60 * 1000,
  });
}
