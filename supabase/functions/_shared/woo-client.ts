// ──────────────────────────────────────────────────────────────────────
// Shared WooCommerce REST API client for the WPW PrintPro Gateway.
//
// Env vars expected:
//   WOOCOMMERCE_URL               (default https://weprintwraps.com)
//   WOOCOMMERCE_CONSUMER_KEY      (ck_…)
//   WOOCOMMERCE_CONSUMER_SECRET   (cs_…)
//
// Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/
// ──────────────────────────────────────────────────────────────────────

export const WOO_BASE = (
  Deno.env.get("WOOCOMMERCE_URL") || "https://weprintwraps.com"
).replace(/\/$/, "");

export function wooAuthHeader(): string {
  const ck = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY");
  const cs = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET");
  if (!ck || !cs) {
    throw new Error(
      "WOOCOMMERCE_CONSUMER_KEY or WOOCOMMERCE_CONSUMER_SECRET is not set",
    );
  }
  return "Basic " + btoa(`${ck}:${cs}`);
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
  billing: WooAddress;
  shipping: WooAddress;
  line_items: WooLineItem[];
  meta_data: { key: string; value: unknown }[];
  shipping_lines?: { method_title?: string }[];
}

export interface WooCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  username: string;
  billing: WooAddress;
  shipping: WooAddress;
  date_created: string;
}

export async function wooFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${WOO_BASE}/wp-json/wc/v3${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: wooAuthHeader(),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Woo ${init.method || "GET"} ${path} ${res.status}: ${body}`);
  }
  return (await res.json()) as T;
}

export function wooOrderPayUrl(order: WooOrder): string | null {
  if (!order.order_key) return null;
  return `${WOO_BASE}/checkout/order-pay/${order.id}/?pay_for_order=true&key=${encodeURIComponent(order.order_key)}`;
}

// Pull tracking info out of common Woo plugin meta keys.
// AST Pro, YITH, Shipment Tracking all store it slightly differently —
// we check the popular ones and fall back to raw scanning.
export function extractTracking(order: WooOrder): {
  number: string | null;
  carrier: string | null;
  url: string | null;
} {
  const meta = order.meta_data || [];
  const get = (key: string): string | null => {
    const hit = meta.find((m) => m.key === key);
    return hit && typeof hit.value === "string" ? hit.value : null;
  };

  // Popular plugin keys
  const direct = {
    number: get("_tracking_number") || get("_aftership_tracking_number") || get("tracking_number"),
    carrier: get("_tracking_provider") || get("_aftership_tracking_provider") || get("tracking_provider"),
    url: get("_tracking_url") || get("tracking_url"),
  };
  if (direct.number) return direct;

  // WooCommerce Shipment Tracking stores an array under "_wc_shipment_tracking_items"
  const st = meta.find((m) => m.key === "_wc_shipment_tracking_items");
  if (st && Array.isArray(st.value) && st.value.length > 0) {
    const first = st.value[0] as Record<string, unknown>;
    return {
      number: (first.tracking_number as string) || null,
      carrier: (first.tracking_provider as string) || (first.custom_tracking_provider as string) || null,
      url: (first.custom_tracking_link as string) || null,
    };
  }

  return { number: null, carrier: null, url: null };
}
