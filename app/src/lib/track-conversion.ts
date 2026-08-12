import { supabase } from "@/integrations/supabase/client";

// Feature flag - ON for testing, disable via localStorage.setItem('TRACKING_ENABLED', 'false')
export const isTrackingEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem("TRACKING_ENABLED");
  // Default to true unless explicitly disabled
  return stored !== "false";
};

export type QuoteEventType =
  | "order_now_clicked"
  | "checkout_started"
  | "cart_redirect_attempted"
  | "cart_redirect_failed"
  | "quote_created";

export type ProductType =
  | "fadewrap"
  | "wbty"
  | "designpro"
  | "custom_print"
  | "design_pack"
  | "printpro";

interface TrackEventParams {
  eventType: QuoteEventType;
  quoteId?: string;
  productType?: ProductType;
  metadata?: Record<string, unknown>;
}

/**
 * Track a conversion event in a fire-and-forget manner.
 * Failures are silent to never break the checkout flow.
 */
export async function trackQuoteEvent(params: TrackEventParams): Promise<void> {
  if (!isTrackingEnabled()) {
    console.log("[track-conversion] Tracking disabled, skipping:", params.eventType);
    return;
  }

  try {
    console.log("[track-conversion] Tracking event:", params);
    
    await supabase.functions.invoke("track-quote-event", {
      body: {
        eventType: params.eventType,
        quoteId: params.quoteId,
        productType: params.productType,
        metadata: params.metadata,
      },
    });
  } catch (error) {
    // Silent fail - never break the flow
    console.error("[track-conversion] Failed to track event:", error);
  }
}

/**
 * Generate a unique quote ID for tracking related events
 */
export function generateQuoteId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}
