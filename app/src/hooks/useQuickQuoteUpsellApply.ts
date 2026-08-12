/**
 * useQuickQuoteUpsellApply — bridge between the QuickQuote estimator's
 * "Pitch an upsell" buttons and the apply-quickquote-upsell edge
 * function.
 *
 * Lives separately from usePrecisionModifications so the existing
 * tool-side PrecisionModButtons path on DesignPro / ColorPro stays
 * untouched. Identical line-item shape as PrecisionModResult so the
 * caller can reuse the same `handlePrecisionApplied` handler.
 */

import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PriceUnit } from "@/lib/quote-product-catalog";

export interface QuickQuoteUpsellResult {
  newRenderUrl: string | null;
  lineItem: {
    label: string;
    description?: string;
    unitPrice: number;
    unit: PriceUnit;
    source: "upsell";
  } | null;
  unsupported?: boolean;
  reason?: string;
}

export function useQuickQuoteUpsellApply() {
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const apply = useCallback(
    async (
      modificationKey: string,
      currentRenderUrl: string,
    ): Promise<QuickQuoteUpsellResult> => {
      setPendingKey(modificationKey);
      try {
        const { data, error } = await supabase.functions.invoke(
          "apply-quickquote-upsell",
          {
            body: {
              renderUrl: currentRenderUrl,
              modificationKey,
            },
          },
        );
        if (error) throw new Error(error.message);
        return data as QuickQuoteUpsellResult;
      } finally {
        setPendingKey(null);
      }
    },
    [],
  );

  return { apply, pendingKey };
}
