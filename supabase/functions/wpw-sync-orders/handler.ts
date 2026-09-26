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

/** How far back a signed-in customer's own sync reaches. */
const USER_DAYS_BACK_DEFAULT = 90;
const USER_DAYS_BACK_MAX = 365;
const USER_MAX_PAGES = 4; // 200 orders for one customer is far past any real account.

/**
 * `days_back` is what every browser caller has always sent (ShopFlow, Quotes);
 * the handler only understood `after`/`before`, so the number was ignored.
 * An explicit `after` still wins. Out-of-range values are refused, not clamped.
 */
export function windowFromBody(body: any, now = Date.now()): { after: string | null; before: string | null } {
  const window = parseWindow(body);
  if (window.after || body?.days_back === undefined || body?.days_back === null || body?.days_back === '') return window;
  const days = Number(body.days_back);
  if (!Number.isInteger(days) || days < 1 || days > USER_DAYS_BACK_MAX) throw new Error(`days_back must be an integer from 1 to ${USER_DAYS_BACK_MAX}.`);
  return { after: new Date(now - days * 86_400_000).toISOString(), before: window.before };
}

/** The shared Woo client throws this exact sentence when the secrets are absent. */
export function isWooNotConfigured(err: unknown): boolean {
  return /WooCommerce API credentials are not configured/.test(err instanceof Error ? err.message : String(err));
}

type SyncDeps = {
  createClient: (...args: any[]) => any;
  supabaseUrl: string;
  serviceKey: string;
  syncSecret: () => string;
  fetchOrders?: typeof wooFetch;
  /**
   * Resolves the signed-in caller from the request's bearer token, or null.
   * Injected so the handler stays testable without Supabase Auth.
   */
  authenticate?: (req: Request) => Promise<{ id: string } | null>;
};

export function createSyncOrdersHandler(deps: SyncDeps) {
  const fetchOrders = deps.fetchOrders || wooFetch;
  return async (req: Request): Promise<Response> => {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

    // TWO CALLERS, TWO SCOPES (diagnosed 2026-09-25 from function_edge_logs:
    // every 401 was a browser POST preceded by an OPTIONS preflight).
    //
    //  1. Staff/cron with the shared secret: the whole store's window, as before.
    //  2. A signed-in customer (ShopFlow "Sync", Quotes "Sync orders"): ONLY the
    //     Woo customer linked to that account in user_subscriptions.
    //
    // Before this, (2) could never succeed: a browser does not and must not
    // hold WPW_SYNC_SECRET, so the handler answered 401 to every real click.
    // The customer scope is filtered by Woo's own `customer` parameter AND
    // re-checked on every returned row, so one account can never write another
    // customer's orders.
    const secret = deps.syncSecret();
    const presented = (req.headers.get('x-wpw-sync-secret') || '').trim();
    const staff = Boolean(secret) && presented === secret;
    let user: { id: string } | null = null;
    if (!staff) {
      if (presented) return json({ ok: false, error: 'Not authorized' }, 401);
      user = deps.authenticate ? await deps.authenticate(req).catch(() => null) : null;
      if (!user?.id) return json({ ok: false, error: 'Not authorized' }, 401);
    }

    let window: ReturnType<typeof parseWindow>;
    let body: any = {};
    try { body = await req.json().catch(() => ({})); window = windowFromBody(user ? { days_back: USER_DAYS_BACK_DEFAULT, ...body } : body); }
    catch (err) { return json({ ok: false, error: err instanceof Error ? err.message : 'Invalid request' }, 400); }

    const sb = deps.createClient(deps.supabaseUrl, deps.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    let wooCustomerId: number | null = null;
    if (user) {
      const { data: link, error: linkError } = await sb.from('user_subscriptions')
        .select('woo_customer_id').eq('user_id', user.id).not('woo_customer_id', 'is', null).maybeSingle();
      if (linkError) return json({ ok: false, error: 'Account link could not be read' }, 502);
      wooCustomerId = Number(link?.woo_customer_id) || null;
      // Not linked is an answer, not a failure: the page shows "link your account".
      if (!wooCustomerId) return json({ ok: true, linked: false, scope: 'customer', orders_fetched: 0, orders_upserted: 0, items_upserted: 0 });
    }

    const maxPages = user ? USER_MAX_PAGES : MAX_PAGES;
    let page = 1, fetched = 0, orders = 0, items = 0;
    try {
      for (; page <= maxPages; page++) {
        const query = new URLSearchParams({ per_page: String(PAGE_SIZE), page: String(page), orderby: 'date', order: 'desc' });
        if (window.after) query.set('after', window.after);
        if (window.before) query.set('before', window.before);
        if (wooCustomerId) query.set('customer', String(wooCustomerId));
        const raw = await fetchOrders<WooOrder[]>(`/orders?${query.toString()}`);
        if (!Array.isArray(raw) || raw.length === 0) break;
        const batch = wooCustomerId ? raw.filter((o) => Number(o.customer_id) === wooCustomerId) : raw;
        fetched += batch.length;

        if (batch.length) {
          // No user_id column is written: production's wpw_orders has none
          // (information_schema, 2026-09-25). The customer scope is the Woo
          // customer id, which is the column wpw-orders-read filters on.
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
        }
        if (raw.length < PAGE_SIZE) break;
      }
      const scope = user ? 'customer' : 'store';
      console.log(JSON.stringify({ event: 'wpw_orders_synced', scope, after: window.after, before: window.before, pages: page, fetched, orders, items }));
      return json({ ok: true, scope, ...(user ? { linked: true } : {}), window, pages: page, orders_fetched: fetched, orders_upserted: orders, items_upserted: items });
    } catch (err) {
      // MISSING SECRETS ARE A CONFIGURATION STATE, NOT A CRASH. The shared Woo
      // client throws when WOOCOMMERCE_CONSUMER_KEY/SECRET are unset; that used
      // to surface as a 502 with a raw message. 503 + a stable code lets the UI
      // say "order sync is not configured" and lets monitoring tell it apart.
      if (isWooNotConfigured(err)) {
        console.error(JSON.stringify({ event: 'wpw_orders_sync_not_configured' }));
        return json({ ok: false, code: 'woo_not_configured', error: 'Order sync is not configured on this project.' }, 503);
      }
      const message = err instanceof Error ? err.message : 'Order sync failed.';
      console.error(JSON.stringify({ event: 'wpw_orders_sync_failed', error: message, pages: page, orders }));
      // Partial progress is kept on purpose: every upsert is idempotent, so a
      // re-run resumes rather than duplicating.
      return json({ ok: false, error: message, orders_upserted: orders, items_upserted: items }, 502);
    }
  };
}
