/**
 * usePrecisionModifications — catalog + apply pipeline for the
 * precision-add buttons on each design tool.
 *
 * Reads the public `precision_modifications` catalog (via TanStack
 * Query) filtered by the current tool, and exposes `apply(mod, url)`
 * which calls the apply-precision-modification edge function. The
 * edge function returns:
 *   { newRenderUrl, lineItem }
 *
 * The page parent uses `newRenderUrl` to swap its displayed render
 * image (mods stack visually because each call sends the LATEST
 * displayed URL back to Gemini) and `lineItem` to append a non-
 * deduped row to the QuickQuote estimator.
 */

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PriceUnit } from "@/lib/quote-product-catalog";
import { useShopServicePrices } from "@/hooks/useShopServicePrices";

export type PrecisionModTool =
  | "designpro"
  | "colorpro"
  | "wbty"
  | "graphicspro";

export interface PrecisionModification {
  id: string;
  key: string;
  label: string;
  description: string | null;
  base_price: number;
  applies_to: string[];
  badge_color: string | null;
  sort_order: number;
}

export interface PrecisionModResult {
  newRenderUrl: string;
  lineItem: {
    label: string;
    description?: string;
    unitPrice: number;
    unit: PriceUnit;
    source: "upsell";
  };
}

export function usePrecisionModifications(tool: PrecisionModTool) {
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const { byKey: shopPrices } = useShopServicePrices();

  const { data: rawModifications = [], isLoading } = useQuery({
    queryKey: ["precision_modifications", tool],
    queryFn: async () => {
      // `db as never` cast — `precision_modifications` is a brand-new
      // table not yet present in the auto-generated types. Same
      // pattern used elsewhere for tables added between regenerations.
      const db = supabase as never as {
        from: (t: string) => {
          select: (cols: string) => {
            contains: (col: string, val: string[]) => {
              eq: (col: string, val: boolean) => {
                order: (col: string, opts: { ascending: boolean }) => Promise<{
                  data: PrecisionModification[] | null;
                  error: { message: string } | null;
                }>;
              };
            };
          };
        };
      };
      const { data, error } = await db
        .from("precision_modifications")
        .select(
          "id, key, label, description, base_price, applies_to, badge_color, sort_order",
        )
        .contains("applies_to", [tool])
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  // Phase 8b — apply shop overrides (if any) to the displayed prices
  // and labels. precision_modifications.key matches
  // shop_service_prices.service_key 1:1.
  const modifications = useMemo(() => {
    return rawModifications.map((mod) => {
      const override = shopPrices[mod.key];
      if (override && override.is_active) {
        return {
          ...mod,
          label: override.label,
          base_price: Number(override.unit_price),
        };
      }
      return mod;
    });
  }, [rawModifications, shopPrices]);

  const apply = useCallback(
    async (
      mod: PrecisionModification,
      currentRenderUrl: string,
    ): Promise<PrecisionModResult> => {
      setPendingKey(mod.key);
      try {
        const { data, error } = await supabase.functions.invoke(
          "apply-precision-modification",
          {
            body: {
              renderUrl: currentRenderUrl,
              modificationKey: mod.key,
            },
          },
        );
        if (error) throw new Error(error.message);
        if (!data?.newRenderUrl) {
          throw new Error("Edge function returned no newRenderUrl");
        }

        // Apply the shop's override to the returned line item so the
        // estimator picks up the shop's price (not the catalog
        // base_price the edge function returned).
        const result = data as PrecisionModResult;
        const override = shopPrices[mod.key];
        if (override && override.is_active) {
          result.lineItem = {
            ...result.lineItem,
            label: override.label,
            unitPrice: Number(override.unit_price),
            unit: override.unit,
          };
        }
        return result;
      } finally {
        setPendingKey(null);
      }
    },
    [shopPrices],
  );

  return { modifications, isLoading, apply, pendingKey };
}
