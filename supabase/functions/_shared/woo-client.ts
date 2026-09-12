// Shared WooCommerce REST API client for the WPW tenant's server-side Edge
// Functions. Ported verbatim from restylepro-os's proven
// supabase/functions/_shared/woo-client.ts (RULE 1: recover, don't invent) —
// this file is pure and generic, so later WPW order-sync phases reuse it
// unchanged. Credentials are read only from Edge Function secrets, never
// hardcoded, never logged.

export const WOO_BASE = (
  Deno.env.get("WOOCOMMERCE_URL") || "https://weprintwraps.com"
).replace(/\/$/, "");

export function wooAuthHeader(): string {
  const consumerKey = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY");
  const consumerSecret = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET");
  if (!consumerKey || !consumerSecret) {
    throw new Error("WooCommerce API credentials are not configured");
  }
  return "Basic " + btoa(`${consumerKey}:${consumerSecret}`);
}

export interface WooCustomer {
  id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
}

export interface WooAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface WooLineItem {
  id: number;
  name: string;
  product_id: number;
  variation_id: number;
  quantity: number;
  sku?: string;
  price?: string | number;
  subtotal: string;
  total: string;
  image?: { id?: string; src?: string };
  meta_data?: { key: string; value: unknown }[];
}

export interface WooOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  total: string;
  subtotal?: string;
  shipping_total: string;
  total_tax: string;
  payment_method: string;
  payment_method_title: string;
  customer_id: number;
  order_key: string;
  date_created: string;
  date_created_gmt: string;
  date_modified: string;
  date_modified_gmt: string;
  date_completed: string | null;
  date_paid?: string | null;
  date_paid_gmt?: string | null;
  transaction_id?: string | null;
  billing: WooAddress;
  shipping: WooAddress;
  line_items: WooLineItem[];
  meta_data: { key: string; value: unknown }[];
  shipping_lines?: { method_title?: string }[];
}

export async function wooFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${WOO_BASE}/wp-json/wc/v3${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: wooAuthHeader(),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    // Woo's body can contain customer/order data. Keep the thrown error to
    // method, path and status; callers may log it safely.
    throw new Error(
      `Woo ${init.method || "GET"} ${path} returned ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

export function wooOrderPayUrl(order: WooOrder): string | null {
  if (!order.order_key) return null;
  return `${WOO_BASE}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${
    encodeURIComponent(order.order_key)
  }`;
}

export function extractTracking(order: WooOrder): {
  number: string | null;
  carrier: string | null;
  url: string | null;
} {
  const meta = order.meta_data || [];
  const get = (key: string): string | null => {
    const hit = meta.find((item) => item.key === key);
    return hit && typeof hit.value === "string" ? hit.value : null;
  };

  const direct = {
    number: get("_tracking_number") || get("_aftership_tracking_number") ||
      get("tracking_number"),
    carrier: get("_tracking_provider") || get("_aftership_tracking_provider") ||
      get("tracking_provider"),
    url: get("_tracking_url") || get("tracking_url"),
  };
  if (direct.number) return direct;

  const shipmentTracking = meta.find((item) =>
    item.key === "_wc_shipment_tracking_items"
  );
  if (
    shipmentTracking && Array.isArray(shipmentTracking.value) &&
    shipmentTracking.value.length > 0
  ) {
    const first = shipmentTracking.value[0] as Record<string, unknown>;
    return {
      number: (first.tracking_number as string) || null,
      carrier: (first.tracking_provider as string) ||
        (first.custom_tracking_provider as string) || null,
      url: (first.custom_tracking_link as string) || null,
    };
  }

  return { number: null, carrier: null, url: null };
}

// ── ORDER ATTRIBUTION ──────────────────────────────────────────────────────
// WooCommerce 8.5+ records where an order came from in order meta under
// `_wc_order_attribution_*`. Lifting only these keys (not the full payload)
// is what makes "is Meta or Google earning this?" answerable from our own
// data instead of each ad platform's self-reported (and inflated) number.
export interface WooOrderAttribution {
  attribution_source_type: string | null;
  attribution_utm_source: string | null;
  attribution_utm_medium: string | null;
  attribution_utm_campaign: string | null;
  attribution_utm_content: string | null;
  attribution_utm_term: string | null;
  attribution_referrer: string | null;
  attribution_device_type: string | null;
  attribution_session_entry: string | null;
  attribution_gclid: string | null;
  attribution_fbclid: string | null;
  attribution_captured_at: string | null;
}

/** Trim, cap, and treat blank/"(none)" as absent so empty strings never look like data. */
function attributionValue(value: unknown, maxLength = 512): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const cleaned = String(value).trim().slice(0, maxLength);
  if (!cleaned) return null;
  // Woo writes these literals when it has nothing; storing them would read as
  // a real source in a GROUP BY.
  if (cleaned === "(none)" || cleaned === "(not set)") return null;
  return cleaned;
}

/**
 * Pull a click id out of the session entry URL.
 *
 * Woo has no dedicated gclid/fbclid meta key — the click id survives only in
 * `_wc_order_attribution_session_entry`, the landing URL of the session that
 * produced the order.
 */
function clickIdFrom(entryUrl: string | null, param: string): string | null {
  if (!entryUrl) return null;
  try {
    const parsed = new URL(entryUrl, "https://weprintwraps.com");
    return attributionValue(parsed.searchParams.get(param), 255);
  } catch {
    return null;
  }
}

export function extractOrderAttribution(order: WooOrder): WooOrderAttribution {
  const meta = order.meta_data || [];
  const get = (key: string): string | null => {
    const hit = meta.find((item) => item.key === key);
    return hit ? attributionValue(hit.value) : null;
  };

  const sessionEntry = get("_wc_order_attribution_session_entry");

  const attribution: WooOrderAttribution = {
    attribution_source_type: get("_wc_order_attribution_source_type"),
    attribution_utm_source: get("_wc_order_attribution_utm_source"),
    attribution_utm_medium: get("_wc_order_attribution_utm_medium"),
    attribution_utm_campaign: get("_wc_order_attribution_utm_campaign"),
    attribution_utm_content: get("_wc_order_attribution_utm_content"),
    attribution_utm_term: get("_wc_order_attribution_utm_term"),
    attribution_referrer: get("_wc_order_attribution_referrer"),
    attribution_device_type: get("_wc_order_attribution_device_type"),
    attribution_session_entry: sessionEntry,
    attribution_gclid: clickIdFrom(sessionEntry, "gclid"),
    attribution_fbclid: clickIdFrom(sessionEntry, "fbclid"),
    attribution_captured_at: null,
  };

  const foundAny = Object.entries(attribution).some(
    ([key, value]) => key !== "attribution_captured_at" && value !== null,
  );
  if (foundAny) attribution.attribution_captured_at = new Date().toISOString();

  return attribution;
}
