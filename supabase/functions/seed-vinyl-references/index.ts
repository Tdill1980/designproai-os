// seed-vinyl-references
// Pulls curated reference images from MetroRestyling (a Shopify store) for each
// vinyl color and stores the image URLs in vinyl_reference_images, which the
// render pipeline (generate-color-render) reads to ground 3D renders in real
// photos. The images are NOT hosted by us and NOT shown to customers — only the
// URLs are referenced server-side at render time as AI grounding.
//
// Trigger (service-role or pg_net), body is optional:
//   { "manufacturer": "3M", "codes": ["2080-S196"], "limit": 200, "dryRun": false }
//
// Returns a per-color report so it can be driven in batches and debugged.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const METRO = "https://metrorestyling.com";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function jsonFetch(url: string): Promise<any | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    if (!r.ok) return null;
    return await r.json();
  } catch (_e) {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function slug(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Pull the full image list for a product handle (null if the product doesn't exist).
async function productImages(handle: string): Promise<string[] | null> {
  const data = await jsonFetch(`${METRO}/products/${handle}.json`);
  if (!data?.product) return null;
  const imgs = data.product.images ?? [];
  return imgs.map((im: any) => im?.src).filter((s: any) => typeof s === "string");
}

// Resolve a MetroRestyling product handle for a color. Tries constructed handles
// (the store's pattern is 3m-2080-<finish>-<name>-vinyl-wrap-<code>), then
// predictive search as a fallback.
async function resolve(code: string, name: string, finish: string):
  Promise<{ handle: string; images: string[]; via: string } | null> {
  const codeSuffix = code.replace(/^2080-/i, "").toLowerCase();
  // MetroRestyling sometimes drops the trailing "P" from the code prefix
  // (GP251->g251, HGP278->hg278, SP238->s238), inconsistently — so try both.
  const codeAlt = codeSuffix.replace(/^([a-z]+)p(\d)/, "$1$2");
  const nameSlug = slug(name);
  const finishSlug = slug(finish);
  const candidates: string[] = [];
  for (const cs of [...new Set([codeSuffix, codeAlt])]) {
    candidates.push(`3m-2080-${finishSlug}-${nameSlug}-vinyl-wrap-${cs}`);
    candidates.push(`3m-2080-${nameSlug}-vinyl-wrap-${cs}`);
    candidates.push(`3m-2080-series-${finishSlug}-${nameSlug}-vinyl-wrap-${cs}`);
  }
  for (const h of [...new Set(candidates)]) {
    const imgs = await productImages(h);
    if (imgs && imgs.length) return { handle: h, images: imgs, via: "handle" };
    await sleep(120); // be gentle on the store between tries
  }
  // fallback: predictive search by name + code
  for (const q of [`3M 2080 ${name} ${codeSuffix}`, `${name} ${codeSuffix}`, codeSuffix]) {
    const data = await jsonFetch(`${METRO}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=10`);
    const products = data?.resources?.results?.products ?? [];
    const re = new RegExp(`(^|[^a-z0-9])${codeSuffix}([^a-z0-9]|$)`, "i");
    const hit = products.find((p: any) => re.test((p.handle || p.title || "").toLowerCase()));
    if (hit?.handle) {
      const imgs = await productImages(hit.handle);
      if (imgs && imgs.length) return { handle: hit.handle, images: imgs, via: "search" };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));
  const manufacturer = body.manufacturer ?? "3M";
  const codes: string[] | null = Array.isArray(body.codes) ? body.codes : null;
  const limit = body.limit ?? 200;
  const dryRun = !!body.dryRun;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
  let q = sb.from("manufacturer_colors")
    .select("id, product_code, official_name, finish")
    .eq("manufacturer", manufacturer).eq("show_in_picker", true).limit(limit);
  if (codes) q = q.in("product_code", codes);
  const { data: colors, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors });

  const results: any[] = [];
  for (const c of colors ?? []) {
    const found = await resolve(c.product_code, c.official_name, c.finish);
    if (!found) { results.push({ code: c.product_code, ok: false, reason: "no product found" }); continue; }
    const imgs = found.images;

    const rows = imgs.slice(0, 4).map((src, i) => ({
      swatch_id: c.id,
      manufacturer,
      color_name: c.official_name,
      product_code: c.product_code,
      image_url: src,
      source_url: `${METRO}/products/${found.handle}`,
      image_type: i === 0 ? "product_sheet" : "vehicle_installation",
      is_verified: true,
      verified_at: new Date().toISOString(),
      color_characteristics: { finish: c.finish, source: "metrorestyling" },
      search_query: `metrorestyling ${c.product_code} ${c.official_name}`,
      score: 100,
    }));
    if (!dryRun) {
      const { error: upErr } = await sb.from("vinyl_reference_images")
        .upsert(rows, { onConflict: "swatch_id,image_url", ignoreDuplicates: true });
      if (upErr) { results.push({ code: c.product_code, ok: false, handle: found.handle, reason: "upsert: " + upErr.message }); continue; }
    }
    results.push({ code: c.product_code, ok: true, handle: found.handle, via: found.via, totalImages: imgs.length, stored: rows.length, first: imgs[0] });
    await sleep(400); // throttle between colors to avoid rate-limiting
  }

  const ok = results.filter((r) => r.ok).length;
  return new Response(JSON.stringify({ manufacturer, processed: results.length, ok, dryRun, results }, null, 2),
    { headers: { ...cors, "Content-Type": "application/json" } });
});
