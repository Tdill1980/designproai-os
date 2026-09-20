import { describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn((options) => options));
vi.mock("@tanstack/react-query", () => ({ useQuery: query }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { proofAllowanceAllowsSend, useProofAllowance, type ProofAllowance } from "./useProofAllowance";

const allowance = (remaining: number): ProofAllowance => ({
  remaining, tier: "Bronze", ai_revisions_per_proof: 0, white_label_enabled: false,
});

describe("legacy client approval availability", () => {
  it("does not query an allowance for a closed dialog", () => {
    useProofAllowance({ enabled: false });
    expect(query.mock.lastCall?.[0].enabled).toBe(false);
    useProofAllowance({ enabled: true });
    expect(query.mock.lastCall?.[0].enabled).toBe(true);
  });

  it("blocks sending without a verified positive allowance", () => {
    for (const value of [null, undefined, allowance(0), allowance(-1), allowance(NaN), allowance(Infinity)]) {
      expect(proofAllowanceAllowsSend(value)).toBe(false);
    }
    expect(proofAllowanceAllowsSend(allowance(1))).toBe(true);
    expect(proofAllowanceAllowsSend(allowance(999999))).toBe(true);
  });
});
