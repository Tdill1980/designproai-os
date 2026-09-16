/**
 * PatternPro™ (Wrap By The Yard) orders in ShopFlow.
 *
 * A PatternPro order is paid through Stripe and lives in `wbty_orders`, not in
 * WooCommerce, so the WPW order sync never sees it. ShopFlow is the customer's
 * one tracker (owner 2026-09-15: "we need it wired to shopflow"), so both doors
 * — the guest door in `wpw-shopflow` and the signed-in door in
 * `wpw-orders-read` — merge these rows into the same list, shaped exactly like
 * a WPW order so the page renders them through the SAME card. A second shape
 * would become a second renderer, and they would drift.
 *
 * Reference: a PatternPro order has no Woo number. Its reference is
 * `PP-` + the first block of its uuid, upper-cased — the same 8 characters the
 * order-success page shows the buyer — so it can be typed into the guest
 * unlock form like a Woo order number.
 *
 * Status: `wbty_orders.status` is passed through unchanged. The stage table
 * (src/lib/shopflowStages.ts + _shared/shopflow-stages.ts, kept identical by
 * tests/shopflow-dashboard.test.ts) carries the PatternPro-only statuses:
 * `paid` → Order Received, `fulfillment_emailed` → Files Sent to Print;
 * `in_production`, `shipped`, `cancelled`, `refunded` already existed.
 */

export const PATTERNPRO_REF_PREFIX = "PP-";

export const PATTERNPRO_ORDER_COLUMNS =
  "id,created_at,updated_at,customer_email,customer_name,status,order_type,pattern_name," +
  "pattern_category,vehicle_year,vehicle_make,vehicle_model,finish,yards,retail_price_cents," +
  "tracking_number,tracking_carrier,shipped_at,render_url";

export function patternProRef(id: string): string {
  return PATTERNPRO_REF_PREFIX + String(id).split("-")[0].toUpperCase();
}

/** `PP-1A2B3C4D`, with or without the `#`, any case. */
export function isPatternProRef(value: unknown): boolean {
  return /^#?PP-[0-9A-F]{8}$/i.test(String(value ?? "").trim());
}

type Db = {
  from: (table: string) => {
    select: (cols: string) => {
      ilike: (col: string, v: string) => {
        order: (col: string, o: { ascending: boolean }) => {
          limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
};

export type PatternProOrderRow = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  customer_email: string | null;
  customer_name: string | null;
  status: string | null;
  order_type: string | null;
  pattern_name: string | null;
  pattern_category: string | null;
  vehicle_year: string | number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  finish: string | null;
  yards: number | null;
  retail_price_cents: number | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  shipped_at: string | null;
  render_url: string | null;
};

/** One PatternPro row → the WPW-order shape the ShopFlow card renders. */
export function shapePatternProOrder(o: PatternProOrderRow) {
  const vehicle = [o.vehicle_year, o.vehicle_make, o.vehicle_model].filter(Boolean).join(" ");
  const isPrint = o.order_type === "printed_wrap";
  const total = (Number(o.retail_price_cents) || 0) / 100;
  const name =
    `PatternPro™ ${o.pattern_name || "pattern"}` +
    (isPrint ? ` — ${o.yards ?? "?"} yd` : " — design file") +
    (vehicle ? ` — ${vehicle}` : "") +
    (o.finish ? ` (${o.finish})` : "");
  return {
    id: `pp-${o.id}`,
    woo_customer_id: null,
    user_id: null,
    order_number: patternProRef(o.id),
    status: o.status || "pending",
    currency: "USD",
    total,
    subtotal: null,
    shipping_total: null,
    tax_total: null,
    payment_method: "Stripe",
    date_created: o.created_at,
    date_modified: o.updated_at,
    date_completed: o.shipped_at,
    customer_email: o.customer_email,
    customer_name: o.customer_name,
    tracking_number: o.tracking_number,
    tracking_carrier: o.tracking_carrier,
    tracking_url: null,
    order_key: null,
    pay_url: null,
    customer_note: null,
    billing: null,
    shipping: null,
    source: "patternpro" as const,
    wpw_order_items: [
      {
        id: 0,
        name,
        quantity: isPrint ? Number(o.yards) || 1 : 1,
        total,
        image_url: o.render_url,
        meta: null,
      },
    ],
  };
}

export type ShapedPatternProOrder = ReturnType<typeof shapePatternProOrder>;

/** Every PatternPro order for an email the SERVER has already resolved. */
export async function patternProOrdersFor(db: Db, email: string): Promise<ShapedPatternProOrder[]> {
  const cleaned = String(email || "").trim();
  if (!cleaned) return [];
  const { data, error } = await db
    .from("wbty_orders")
    .select(PATTERNPRO_ORDER_COLUMNS)
    .ilike("customer_email", cleaned)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error || !Array.isArray(data)) return [];
  return (data as PatternProOrderRow[]).map(shapePatternProOrder);
}

/** The ONE PatternPro order a reference names — and only if it is this email's. */
export async function findPatternProOrder(db: Db, ref: unknown, email: string): Promise<ShapedPatternProOrder | null> {
  if (!isPatternProRef(ref)) return null;
  const wanted = String(ref).trim().replace(/^#/, "").toUpperCase();
  const rows = await patternProOrdersFor(db, email);
  return rows.find((r) => r.order_number === wanted) ?? null;
}

/** WPW + PatternPro in one list, newest first. */
export function mergeOrdersByDate<T extends { date_created?: string | null }>(a: T[], b: T[]): T[] {
  const t = (o: T) => (o.date_created ? Date.parse(String(o.date_created)) || 0 : 0);
  return [...a, ...b].sort((x, y) => t(y) - t(x));
}
