// WePrintWraps order sync — phase 2 of the WPW wiring.
//
// Pulls WooCommerce orders into wpw_orders / wpw_order_items so the repeat
// cohort is measurable from this side (owner, 2026-09-12: "those repeats are
// who we will track and optimize on for a saas"). wpw-oauth-link already
// linked the accounts; this brings the orders those accounts actually placed.
//
// Ported from the reference project's proven backfill writers (RULE 1:
// recover, don't invent) -- normalizeOrder and normalizeLineItems are field
// for field the same, so both ingests agree on shape. What is deliberately
// NOT carried: quote matching, customer emails, alarms and every other side
// effect the reference's 1,400-line sync also performs. This does one thing:
// fetch a window, upsert it, report counts. Idempotent, safe to re-run.
import { extractOrderAttribution, extractTracking, wooFetch, wooOrderPayUrl, type WooLineItem, type WooOrder } from '../_shared/woo-client.ts';
import { corsHeaders } from '../_shared/cors.ts';

const PAGE_SIZE = 50;
const MAX_PAGES = 40; // 2,000 orders per invocation; page through with `after`.

export function normalizeOrder(o: WooOrder): Record<string, unknown> {
  const tracking = extractTracking(o);
  return {
    id: o.id,
    woo_customer_id: o.customer_id,
    order_number: o.number,
    status: o.status,
    currency: o.currency,
    total: parseFloat(o.total || '0') || 0,
    subtotal: o.subtotal ? parseFloat(o.subtotal) : null,
    shipping_total: parseFloat(o.shipping_total || '0') || 0,
    tax_total: parseFloat(o.total_tax || '0') || 0,
    payment_method: o.payment_method_title || o.payment_method || null,
    date_created: o.date_created_gmt ? `${o.date_created_gmt}Z` : o.date_created || null,
    date_modified: o.date_modified_gmt ? `${o.date_modified_gmt}Z` : o.date_modified || null,
    date_completed: o.date_completed || null,
    customer_email: o.billing?.email || null,
    customer_name: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ') || null,
    billing: o.billing || null,
    shipping: o.shipping || null,
    tracking_number: tracking.number,
    tracking_carrier: tracking.carrier,
    tracking_url: tracking.url,
    order_key: o.order_key || null,
    pay_url: wooOrderPayUrl(o),
    customer_note: typeof (o as any).customer_note === 'string' && (o as any).customer_note.trim().length > 0
      ? String((o as any).customer_note).slice(0, 4000)
      : null,
    ...extractOrderAttribution(o),
    fetched_at: new Date().toISOString(),
  };
}

export function normalizeLineItems(orderId: number, items: WooLineItem[]): Record<string, unknown>[] {
  return (items || []).map(it => ({
    id: it.id,
    order_id: orderId,
    product_id: it.product_id || null,
    variation_id: it.variation_id || null,
    name: it.name || null,
    sku: it.sku || null,
    quantity: it.quantity,
    subtotal: parseFloat(it.subtotal || '0') || 0,
    total: parseFloat(it.total || '0') || 0,
    meta: it.meta_data || null,
    image_url: it.image?.src || null,
  }));
}

/** ISO date or null. A bad `after`/`before` is refused rather than silently
 * turning into a full-store sweep. */
export function parseWindow(body: any): { after: string | null; before: string | null } {
  const iso = (v: unknown): string | null => {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new Error('after/before must be ISO dates.');
    return d.toISOString();
  };
  return { after: iso(body?.after), before: iso(body?.before) };
}

export function createSyncOrdersHandler(deps: { createClient: (...args: any[]) => any; supabaseUrl: string; serviceKey: string; syncSecret: () => string; fetchOrders?: typeof wooFetch }) {
  const fetchOrders = deps.fetchOrders || wooFetch;
  return async (req: Request): Promise<Response> => {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

    // Staff/cron only: this reads the whole store's revenue. A shared secret
    // rather than a user JWT, because the caller is a scheduler, not a person.
    const secret = deps.syncSecret();
    const presented = (req.headers.get('x-wpw-sync-secret') || '').trim();
    if (!secret || presented !== secret) return json({ ok: false, error: 'Not authorized' }, 401);

    let window: ReturnType<typeof parseWindow>;
    let body: any = {};
    try { body = await req.json().catch(() => ({})); window = parseWindow(body); }
    catch (err) { return json({ ok: false, error: err instanceof Error ? err.message : 'Invalid request' }, 400); }

    const sb = deps.createClient(deps.supabaseUrl, deps.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let page = 1, fetched = 0, orders = 0, items = 0;
    try {
      for (; page <= MAX_PAGES; page++) {
        const query = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page), orderby: 'date', order: 'desc' });
        if (window.after) query.set('after', window.after);
        if (window.before) query.set('before', window.before);
        const batch = await fetchOrders<WooOrder[]>(`/orders?${query.toString()}`);
        if (!Array.isArray(batch) || batch.length === 0) break;
        fetched += batch.length;

        const orderRows = batch.map(normalizeOrder);
        const { error: orderError } = await sb.from('wpw_orders').upsert(orderRows, { onConflict: 'id' });
        if (orderError) throw new Error('Orders could not be stored: ' + orderError.message);
        orders += orderRows.length;

        // Items only after their order exists: the FK is what keeps a partial
        // page from leaving items pointing at nothing.
        const itemRows = batch.flatMap(o => normalizeLineItems(o.id, o.line_items || []));
        if (itemRows.length) {
          const { error: itemError } = await sb.from('wpw_order_items').upsert(itemRows, { onConflict: 'id' });
          if (itemError) throw new Error('Order items could not be stored: ' + itemError.message);
          items += itemRows.length;
        }
        if (batch.length < PAGE_SIZE) break;
      }
      console.log(JSON.stringify({ event: 'wpw_orders_synced', after: window.after, before: window.before, pages: page, fetched, orders, items }));
      return json({ ok: true, window, pages: page, orders_fetched: fetched, orders_upserted: orders, items_upserted: items });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Order sync failed.';
      console.error(JSON.stringify({ event: 'wpw_orders_sync_failed', error: message, pages: page, orders }));
      // Partial progress is kept on purpose: every upsert is idempotent, so a
      // re-run resumes rather than duplicating.
      return json({ ok: false, error: message, orders_upserted: orders, items_upserted: items }, 502);
    }
  };
}
