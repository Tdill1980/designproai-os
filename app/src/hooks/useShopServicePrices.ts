/**
 * useShopServicePrices — Phase 8a.
 *
 * Reads + writes the current shop's pricing overrides on
 * `public.shop_service_prices`. Exposes a stable map keyed by
 * service_key so consumers can do `prices[key]?.unit_price` without
 * scanning an array.
 *
 * Phase 8b will wire the QuickQuoteEstimator's upsell button strip
 * and the precision-mod buttons through this hook so the prices the
 * shop sees in admin are the prices the customer sees on the quote.
 */

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { ServiceUnit } from "@/lib/shop-service-defaults";

export interface ShopServicePriceRow {
  id: string;
  shop_id: string;
  service_key: string;
  label: string;
  unit_price: number;
  unit: ServiceUnit;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UpsertShopServicePriceInput {
  service_key: string;
  label: string;
  unit_price: number;
  unit: ServiceUnit;
  is_active?: boolean;
}

export function useShopServicePrices() {
  const { currentShop } = useOrganization();
  const shopId = currentShop?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = ["shop_service_prices", shopId];

  // `db as never` cast — shop_service_prices is brand-new and not in
  // the auto-generated types yet. Same pattern used elsewhere in the
  // codebase for tables added between regenerations.
  const db = supabase as never as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          order: (col: string) => Promise<{
            data: ShopServicePriceRow[] | null;
            error: { message: string } | null;
          }>;
        };
      };
      upsert: (
        row: Record<string, unknown>,
        opts: { onConflict: string },
      ) => {
        select: () => {
          single: () => Promise<{
            data: ShopServicePriceRow | null;
            error: { message: string } | null;
          }>;
        };
      };
      delete: () => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => Promise<{
            error: { message: string } | null;
          }>;
        };
      };
    };
  };

  const { data: rows = [], isLoading } = useQuery({
    queryKey,
    enabled: !!shopId,
    queryFn: async () => {
      if (!shopId) return [];
      const { data, error } = await db
        .from("shop_service_prices")
        .select(
          "id, shop_id, service_key, label, unit_price, unit, is_active, created_at, updated_at",
        )
        .eq("shop_id", shopId)
        .order("service_key");
      if (error) throw new Error(error.message);
      return (data ?? []) as ShopServicePriceRow[];
    },
  });

  const byKey = useMemo(() => {
    const map: Record<string, ShopServicePriceRow> = {};
    for (const r of rows) map[r.service_key] = r;
    return map;
  }, [rows]);

  const upsertMutation = useMutation({
    mutationFn: async (input: UpsertShopServicePriceInput) => {
      if (!shopId) throw new Error("No current shop");
      const { data, error } = await db
        .from("shop_service_prices")
        .upsert(
          {
            shop_id: shopId,
            service_key: input.service_key,
            label: input.label,
            unit_price: input.unit_price,
            unit: input.unit,
            is_active: input.is_active ?? true,
          },
          { onConflict: "shop_id,service_key" },
        )
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data as ShopServicePriceRow;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (service_key: string) => {
      if (!shopId) throw new Error("No current shop");
      const { error } = await db
        .from("shop_service_prices")
        .delete()
        .eq("shop_id", shopId)
        .eq("service_key", service_key);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const upsert = useCallback(
    (input: UpsertShopServicePriceInput) => upsertMutation.mutateAsync(input),
    [upsertMutation],
  );

  const remove = useCallback(
    (service_key: string) => deleteMutation.mutateAsync(service_key),
    [deleteMutation],
  );

  return {
    shopId,
    rows,
    byKey,
    isLoading,
    upsert,
    remove,
    isMutating: upsertMutation.isPending || deleteMutation.isPending,
  };
}
