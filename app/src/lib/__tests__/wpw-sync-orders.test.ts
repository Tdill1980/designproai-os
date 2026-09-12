import { describe, expect, it, vi } from 'vitest';

// woo-client.ts reads Deno.env at module load (it is an edge function shared
// module). hoisted() runs before the imports below, so the handler stays
// loadable by this Node suite exactly as the other edge handlers are.
vi.hoisted(() => {
  const env: Record<string, string> = { WOOCOMMERCE_URL: 'https://weprintwraps.com', WOOCOMMERCE_CONSUMER_KEY: 'ck', WOOCOMMERCE_CONSUMER_SECRET: 'cs' };
  (globalThis as any).Deno = { env: { get: (key: string) => env[key] } };
});

import { createSyncOrdersHandler, normalizeLineItems, normalizeOrder, parseWindow } from '../../../../supabase/functions/wpw-sync-orders/handler';

const SECRET = 'sync-secret';

const order = (id: number, over: Record<string, unknown> = {}) => ({
  id, number: String(id), status: 'completed', currency: 'USD', customer_id: 42,
  total: '975.00', subtotal: '900.00', shipping_total: '25.00', total_tax: '50.00',
  payment_method: 'stripe', payment_method_title: 'Credit Card',
  order_key: 'wc_order_' + id,
  date_created_gmt: '2026-09-01T10:00:00', date_modified_gmt: '2026-09-01T11:00:00', date_created: '', date_modified: '', date_completed: null,
  billing: { email: 'shop@example.com', first_name: 'Trade', last_name: 'Buyer' }, shipping: {},
  line_items: [{ id: id * 10, name: 'Wall wrap design', product_id: 7, variation_id: 0, quantity: 1, sku: 'DESIGN-WALL', subtotal: '900.00', total: '900.00' }],
  meta_data: [
    { key: '_wc_order_attribution_utm_source', value: 'facebook' },
    { key: '_wc_order_attribution_session_entry', value: 'https://weprintwraps.com/wall?fbclid=ABC123' },
  ],
  ...over,
});

function fixture(pages: any[][]) {
  const upserts: Record<string, any[]> = { wpw_orders: [], wpw_order_items: [] };
  const sb = { from: vi.fn((table: string) => ({ upsert: vi.fn(async (rows: any[]) => { upserts[table].push(...rows); return { error: null }; }) })) };
  let call = 0;
  const fetchOrders = vi.fn(async () => pages[call++] ?? []);
  const handler = createSyncOrdersHandler({ createClient: () => sb, supabaseUrl: 'https://own.supabase.co', serviceKey: 'k', syncSecret: () => SECRET, fetchOrders: fetchOrders as any });
  const invoke = (body: any = {}, secret = SECRET) => handler(new Request('https://own.supabase.co/functions/v1/wpw-sync-orders', {
    method: 'POST', headers: { 'x-wpw-sync-secret': secret, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { invoke, upserts, fetchOrders };
}

describe('WPW order sync', () => {
  it('normalizes an order to the shape the reference ingest writes, attribution and all', () => {
    const row = normalizeOrder(order(1001) as any);
    expect(row).toMatchObject({
      id: 1001, woo_customer_id: 42, order_number: '1001', status: 'completed',
      total: 975, subtotal: 900, shipping_total: 25, tax_total: 50,
      customer_email: 'shop@example.com', customer_name: 'Trade Buyer',
      payment_method: 'Credit Card',
      attribution_utm_source: 'facebook',
    });
    // Woo has no fbclid meta key: it is parsed out of the session entry URL.
    expect(row.attribution_fbclid).toBe('ABC123');
    expect(row.date_created).toBe('2026-09-01T10:00:00Z');
    // `raw` is deliberately not stored; the attribution columns exist for that.
    expect(row).not.toHaveProperty('raw');
  });
  it('normalizes line items against their order, which is what makes design work identifiable', () => {
    const items = normalizeLineItems(1001, order(1001).line_items as any);
    expect(items).toEqual([{ id: 10010, order_id: 1001, product_id: 7, variation_id: null, name: 'Wall wrap design', sku: 'DESIGN-WALL', quantity: 1, subtotal: 900, total: 900, meta: null, image_url: null }]);
  });
  it('refuses a caller without the shared secret before touching Woo or the database', async () => {
    const f = fixture([[order(1)]]);
    const denied = await f.invoke({}, 'wrong');
    expect(denied.status).toBe(401);
    expect(f.fetchOrders).not.toHaveBeenCalled();
  });
  it('refuses a malformed window rather than sweeping the whole store', async () => {
    expect(() => parseWindow({ after: 'not-a-date' })).toThrow(/ISO dates/);
    expect(parseWindow({})).toEqual({ after: null, before: null });
    const f = fixture([[order(1)]]);
    expect((await f.invoke({ after: 'nonsense' })).status).toBe(400);
    expect(f.fetchOrders).not.toHaveBeenCalled();
  });
  it('pages until a short page, upserting orders and their items, and reports the counts', async () => {
    const full = Array.from({ length: 50 }, (_, i) => order(2000 + i));
    const f = fixture([full, [order(3001)]]);
    const result = await f.invoke({ after: '2026-09-01T00:00:00Z' });
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body).toMatchObject({ ok: true, orders_fetched: 51, orders_upserted: 51, items_upserted: 51 });
    expect(f.upserts.wpw_orders).toHaveLength(51);
    expect(f.upserts.wpw_order_items).toHaveLength(51);
    // A short page ends the sweep: no third request.
    expect(f.fetchOrders).toHaveBeenCalledTimes(2);
  });
  it('keeps partial progress when a page fails, because every upsert is idempotent', async () => {
    const upserts: Record<string, any[]> = { wpw_orders: [], wpw_order_items: [] };
    let orderCalls = 0;
    const sb = { from: vi.fn((table: string) => ({ upsert: vi.fn(async (rows: any[]) => {
      if (table === 'wpw_orders' && ++orderCalls === 2) return { error: { message: 'deadlock' } };
      upserts[table].push(...rows); return { error: null };
    }) })) };
    const pages = [Array.from({ length: 50 }, (_, i) => order(4000 + i)), [order(5001)]];
    let call = 0;
    const handler = createSyncOrdersHandler({ createClient: () => sb, supabaseUrl: 'u', serviceKey: 'k', syncSecret: () => SECRET, fetchOrders: (async () => pages[call++] ?? []) as any });
    const result = await handler(new Request('https://own/x', { method: 'POST', headers: { 'x-wpw-sync-secret': SECRET }, body: '{}' }));
    expect(result.status).toBe(502);
    const body = await result.json();
    expect(body.ok).toBe(false);
    expect(body.orders_upserted).toBe(50); // the first page survived
    expect(upserts.wpw_orders).toHaveLength(50);
  });
});
