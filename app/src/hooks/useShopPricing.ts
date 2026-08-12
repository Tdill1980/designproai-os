/**
 * useShopPricing — load and save per-shop pricing config for QuickQuote.
 *
 * Falls back to the hardcoded defaults in quick-quote.ts when no
 * shop-level override exists.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  FILM_COST_PER_YARD,
  PRINT_COST_PER_SQFT,
  REGIONS,
  ADD_ONS,
  type PriceRegion,
} from "@/lib/quick-quote";

const db = supabase as any;

export interface ShopPricingConfig {
  id?: string;
  shop_id?: string;
  film_prices: Record<string, number>;
  print_prices: Record<string, number>;
  labor_rates: Record<PriceRegion, number>;
  add_on_prices: Record<string, number>;
  default_margin_percent: number;
  default_region: string;
}

const DEFAULTS: ShopPricingConfig = {
  film_prices: { ...FILM_COST_PER_YARD },
  print_prices: { ...PRINT_COST_PER_SQFT },
  labor_rates: {
    budget: REGIONS.budget.laborPerSqFt,
    standard: REGIONS.standard.laborPerSqFt,
    premium: REGIONS.premium.laborPerSqFt,
    luxury: REGIONS.luxury.laborPerSqFt,
  },
  add_on_prices: Object.fromEntries(
    Object.entries(ADD_ONS).map(([k, v]) => [k, v.flatPrice])
  ),
  default_margin_percent: 65,
  default_region: "standard",
};

async function getShopId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await db
    .from("shop_profiles")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.id || null;
}

export function useShopPricing() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["shop-quote-pricing"],
    queryFn: async (): Promise<ShopPricingConfig> => {
      const shopId = await getShopId();
      if (!shopId) return DEFAULTS;

      const { data, error } = await db
        .from("shop_quote_pricing")
        .select("*")
        .eq("shop_id", shopId)
        .maybeSingle();

      if (error || !data) return { ...DEFAULTS, shop_id: shopId };

      return {
        id: data.id,
        shop_id: data.shop_id,
        film_prices: { ...DEFAULTS.film_prices, ...(data.film_prices || {}) },
        print_prices: { ...DEFAULTS.print_prices, ...(data.print_prices || {}) },
        labor_rates: { ...DEFAULTS.labor_rates, ...(data.labor_rates || {}) },
        add_on_prices: { ...DEFAULTS.add_on_prices, ...(data.add_on_prices || {}) },
        default_margin_percent: data.default_margin_percent ?? DEFAULTS.default_margin_percent,
        default_region: data.default_region ?? DEFAULTS.default_region,
      };
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (config: Partial<ShopPricingConfig>) => {
      const shopId = await getShopId();
      if (!shopId) throw new Error("No shop profile found");

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const payload = {
        shop_id: shopId,
        user_id: user.id,
        film_prices: config.film_prices,
        print_prices: config.print_prices,
        labor_rates: config.labor_rates,
        add_on_prices: config.add_on_prices,
        default_margin_percent: config.default_margin_percent,
        default_region: config.default_region,
        updated_at: new Date().toISOString(),
      };

      const { error } = await db
        .from("shop_quote_pricing")
        .upsert(payload, { onConflict: "shop_id" });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shop-quote-pricing"] });
    },
  });

  return {
    pricing: query.data ?? DEFAULTS,
    isLoading: query.isLoading,
    save: saveMutation.mutateAsync,
    isSaving: saveMutation.isPending,
    defaults: DEFAULTS,
  };
}
