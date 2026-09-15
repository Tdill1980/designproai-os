/**
 * FIVE FREE WALLPRO DESIGNS — the client half of the entitlement.
 *
 * Owner, 2026-09-15, on the signed-in half of ShopFlow: "once in it has the WPW
 * ShopFlow log in to see your order history and points page along with your
 * CommercialPro account if you have one. There they get 5 Free WallPro Designs."
 *
 * The count is NEVER computed here. `claim_wallpro_welcome_designs()` grants the
 * five (once, enforced by a unique index, not by this hook remembering) and
 * returns what is left, so the number on screen is the number the database would
 * actually honour at spend time. That distinction is the whole point: this page
 * already had a fabricated points balance pulled out of it on 2026-09-14 for
 * exactly this failure — a number the customer reads as a promise and no server
 * agrees to. Do not add a local fallback count.
 *
 * -1 from the RPC means NOT ELIGIBLE (no linked WePrintWraps account), which is
 * a different screen from 0 ("you've used them"). Keep the two apart.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const WALLPRO_WELCOME_DESIGNS = 5;

export type WallProDesignCredits = {
  /** Designs left to spend. 0 once they are used up. */
  remaining: number;
  /** False when there is no linked WePrintWraps account to attach them to. */
  eligible: boolean;
};

export function useWallProDesignCredits(enabled: boolean) {
  return useQuery({
    queryKey: ["wallpro-design-credits"],
    enabled,
    queryFn: async (): Promise<WallProDesignCredits> => {
      // Claiming is idempotent, so the page can call it on every load and a
      // customer never has to find a button to receive what they were promised.
      const { data, error } = await supabase.rpc("claim_wallpro_welcome_designs");
      if (error) throw error;
      const value = Number(data ?? -1);
      if (!Number.isFinite(value) || value < 0) return { remaining: 0, eligible: false };
      return { remaining: value, eligible: true };
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
