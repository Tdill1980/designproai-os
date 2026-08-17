import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * sync-shop-products-from-woo
 *
 * Reads all shop_products rows that have a woo_product_id, fetches the
 * current price + image from the WooCommerce REST API on weprintwraps.com,
 * and updates the row with the live values.
 *
 * Use cases:
 * - Initial price/image hydration for newly seeded WPW products
 * - Periodic re-sync when WooCommerce prices change
 *
 * POST body:
 *   { shopId?: string, productIds?: string[] }
 *   - shopId: limit sync to a specific shop_profiles.id
 *   - productIds: limit sync to specific shop_products.id values
 *   (omit both to sync everything)
 */

function createSb() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

function authHeader() {
  const ck = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY")!;
  const cs = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET")!;
  return "Basic " + btoa(`${ck}:${cs}`);
}

const WOO_BASE = (Deno.env.get("WOOCOMMERCE_URL") || "https://weprintwraps.com").replace(/\/$/, "");

interface WooProduct {
  id: number;
  name: string;
  price: string;          // string in Woo, e.g. "5.27"
  regular_price: string;
  sale_price: string;
  description: string;
  short_description: string;
  permalink: string;
  images: { src: string; alt?: string }[];
  variations: number[];
  type: string;           // "simple" | "variable" | etc.
}

async function fetchWooProduct(id: number): Promise<WooProduct | null> {
  try {
    const res = await fetch(`${WOO_BASE}/wp-json/wc/v3/products/${id}`, {
      headers: { Authorization: authHeader() },
    });
    if (!res.ok) {
      console.warn(`[woo] product ${id} returned ${res.status}`);
      return null;
    }
    return await res.json() as WooProduct;
  } catch (err) {
    console.warn(`[woo] failed to fetch product ${id}`, err);
    return null;
  }
}

// For variable products (no fixed price), grab the lowest variation price as the "starting at" price
async function fetchVariableMinPrice(productId: number): Promise<number | null> {
  try {
    const res = await fetch(`${WOO_BASE}/wp-json/wc/v3/products/${productId}/variations?per_page=100`, {
      headers: { Authorization: authHeader() },
    });
    if (!res.ok) return null;
    const variations = await res.json() as { price: string }[];
    const prices = variations
      .map((v) => parseFloat(v.price))
      .filter((p) => !isNaN(p) && p > 0);
    if (prices.length === 0) return null;
    return Math.min(...prices);
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const { shopId, productIds } = body as { shopId?: string; productIds?: string[] };

    const sb = createSb();
    let q = sb.from("shop_products").select("id, name, woo_product_id, price, logo_url").not("woo_product_id", "is", null);
    if (shopId) q = q.eq("shop_id", shopId);
    if (productIds && productIds.length > 0) q = q.in("id", productIds);

    const { data: products, error } = await q;
    if (error) throw error;
    if (!products || products.length === 0) {
      return new Response(JSON.stringify({ ok: true, synced: 0, message: "No products to sync" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { id: string; name: string; woo_id: number; old_price: number; new_price: number | null; image_updated: boolean }[] = [];

    for (const p of products) {
      const woo = await fetchWooProduct(p.woo_product_id);
      if (!woo) {
        results.push({ id: p.id, name: p.name, woo_id: p.woo_product_id, old_price: Number(p.price), new_price: null, image_updated: false });
        continue;
      }

      let newPrice: number | null = parseFloat(woo.price);
      if (isNaN(newPrice) || newPrice === 0) {
        // Try variations for variable products
        if (woo.type === "variable" || woo.variations?.length > 0) {
          newPrice = await fetchVariableMinPrice(p.woo_product_id);
        }
      }

      const newImage = woo.images?.[0]?.src || null;
      const updates: Record<string, unknown> = {
        woo_product_url: woo.permalink || undefined,
        updated_at: new Date().toISOString(),
      };
      if (newPrice !== null && newPrice > 0) updates.price = newPrice;
      if (newImage && !p.logo_url) updates.logo_url = newImage;
      if (woo.short_description) updates.description = woo.short_description.replace(/<[^>]*>/g, "").trim().slice(0, 500);

      const { error: upErr } = await sb.from("shop_products").update(updates).eq("id", p.id);
      if (upErr) console.warn(`[sync] update failed for ${p.id}`, upErr);

      results.push({
        id: p.id,
        name: p.name,
        woo_id: p.woo_product_id,
        old_price: Number(p.price),
        new_price: newPrice,
        image_updated: !!newImage && !p.logo_url,
      });
    }

    return new Response(JSON.stringify({ ok: true, synced: results.length, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[sync-shop-products-from-woo] error", err);
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
