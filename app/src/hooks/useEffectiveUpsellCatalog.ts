/**
 * useEffectiveUpsellCatalog — Phase 8b.
 *
 * Returns the upsell catalog that the QuickQuoteEstimator's drawer
 * button strip displays — with each row's price replaced by the
 * shop's override from `shop_service_prices` when one exists and is
 * active. Falls back to the catalog default from
 * `shop-service-defaults.ts` otherwise.
 *
 * Service keys here mirror precision_modifications.key so the
 * precision-mod buttons (`usePrecisionModifications`) can resolve
 * the same shop overrides without a second mapping table.
 *
 * Order of UPSELL_KEYS = display order in the UI.
 */

import { useMemo } from "react";

import { useShopServicePrices } from "./useShopServicePrices";
import {
  findServiceDefault,
  type ServiceUnit,
} from "@/lib/shop-service-defaults";

const UPSELL_KEYS = [
  "chrome_delete",
  "carbon_fiber_roof",
  "carbon_fiber_hood",
  "racing_stripe_black",
  "roof_wrap_black",
  "ppf_full_front",
  "ppf_hood",
  "window_tint_dark",
  "accent_wrap",
  "partial_wrap",
  "commercial_lettering",
] as const;

export interface EffectiveUpsell {
  service_key: string;
  label: string;
  description?: string;
  unit_price: number;
  unit: ServiceUnit;
  /** True when the shop has overridden the catalog default. */
  is_override: boolean;
}

export function useEffectiveUpsellCatalog(): EffectiveUpsell[] {
  const { byKey } = useShopServicePrices();

  return useMemo(() => {
    const out: EffectiveUpsell[] = [];
    for (const key of UPSELL_KEYS) {
      const def = findServiceDefault(key);
      if (!def) continue;
      const override = byKey[key];
      if (override && override.is_active) {
        out.push({
          service_key: key,
          label: override.label,
          description: def.description,
          unit_price: Number(override.unit_price),
          unit: override.unit,
          is_override: true,
        });
      } else {
        out.push({
          service_key: key,
          label: def.label,
          description: def.description,
          unit_price: def.default_price,
          unit: def.default_unit,
          is_override: false,
        });
      }
    }
    return out;
  }, [byKey]);
}

/** Look up the shop's effective price for a single service key. */
export function effectivePriceFor(
  service_key: string,
  byKey: Record<
    string,
    { unit_price: number; unit: ServiceUnit; is_active: boolean; label: string }
  >,
): { unit_price: number; unit: ServiceUnit; label: string; is_override: boolean } | null {
  const def = findServiceDefault(service_key);
  if (!def) return null;
  const override = byKey[service_key];
  if (override && override.is_active) {
    return {
      unit_price: Number(override.unit_price),
      unit: override.unit,
      label: override.label,
      is_override: true,
    };
  }
  return {
    unit_price: def.default_price,
    unit: def.default_unit,
    label: def.label,
    is_override: false,
  };
}
