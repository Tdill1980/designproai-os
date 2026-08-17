import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * import-wpw-swatches
 *
 * Pulls the OFFICIAL pattern swatch images directly from WePrintWraps.com's
 * WooCommerce REST API for each of the 5 WBTY variable products, downloads
 * each variation image, uploads it to Supabase Storage, and updates the
 * matching wbty_products row with the public URL.
 *
 * For each WooCommerce variable product, we fetch /products/{id}/variations
 * which returns each variation with its `image` and `attributes`. The
 * variation's pa_color/pa_pattern/pa_style attribute value is the swatch
 * name (e.g. "Sand Camo"). We match it to a wbty_products row by name
 * (case-insensitive, ignoring spaces/punctuation).
 *
 * POST body: { categories?: string[] }  // optional filter, defaults to all 5
 */

const CATEGORY_TO_WOO_ID: Record<string, number> = {
  "Camo & Carbon": 1726,
  "Metal & Marble": 39698,
  "Wicked & Wild": 4181,
  "Bape Camo": 42809,
  "Modern & Trippy": 52489,
};

const BUCKET = "wrap-files";
const SWATCH_PREFIX = "pattern-swatches-wpw"; // separate from AI swatches so we don't clobber

function createSb() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchWooVariations(
  wooUrl: string,
  consumerKey: string,
  consumerSecret: string,
  productId: number,
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;
  while (true) {
    const url = `${wooUrl}/wp-json/wc/v3/products/${productId}/variations?per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: "Basic " + btoa(`${consumerKey}:${consumerSecret}`) },
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Woo variations fetch ${productId} page ${page}: ${res.status} ${txt.substring(0, 200)}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
    if (page > 10) break; // safety
  }
  return all;
}

async function fetchWooProductImages(
  wooUrl: string,
  consumerKey: string,
  consumerSecret: string,
  productId: number,
): Promise<any[]> {
  // Fallback: if a product has no variations (or variations have no images),
  // use the parent product's gallery instead. Each gallery image has `name` + `src`.
  const url = `${wooUrl}/wp-json/wc/v3/products/${productId}`;
  const res = await fetch(url, {
    headers: { Authorization: "Basic " + btoa(`${consumerKey}:${consumerSecret}`) },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Woo product fetch ${productId}: ${res.status} ${txt.substring(0, 200)}`);
  }
  const product = await res.json();
  return product.images || [];
}

async function downloadAndUpload(
  imageUrl: string,
  storagePath: string,
  sb: any,
): Promise<string | null> {
  try {
    const imgRes = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      },
    });
    if (!imgRes.ok) {
      console.error(`[wpw-import] Image fetch failed: ${imageUrl} ${imgRes.status}`);
      return null;
    }
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buf = new Uint8Array(await imgRes.arrayBuffer());

    const { error } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, buf, { contentType, upsert: true });
    if (error) {
      console.error(`[wpw-import] Storage upload error ${storagePath}:`, error);
      return null;
    }
    const { data } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
    return data?.publicUrl || null;
  } catch (err) {
    console.error(`[wpw-import] downloadAndUpload error:`, err);
    return null;
  }
}

interface ImportResult {
  category: string;
  woocommerce_id: number;
  variations_found: number;
  matched: number;
  unmatched: string[];
  unmatched_db_rows: string[];
  errors: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const wooUrl = Deno.env.get("WOOCOMMERCE_URL");
    const consumerKey = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET");

    if (!wooUrl || !consumerKey || !consumerSecret) {
      return new Response(
        JSON.stringify({ error: "WooCommerce credentials not configured (WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const categoryFilter: string[] = body.categories || Object.keys(CATEGORY_TO_WOO_ID);
    const dryRun: boolean = body.dryRun === true;

    const sb = createSb();
    const results: ImportResult[] = [];

    for (const category of categoryFilter) {
      const wooId = CATEGORY_TO_WOO_ID[category];
      if (!wooId) {
        console.warn(`[wpw-import] Unknown category: ${category}`);
        continue;
      }

      console.log(`[wpw-import] === ${category} (Woo ${wooId}) ===`);

      // Pull all DB rows for this category up front
      const { data: dbRows, error: dbErr } = await sb
        .from("wbty_products")
        .select("id, name")
        .eq("category", category)
        .eq("is_active", true);

      if (dbErr || !dbRows) {
        console.error(`[wpw-import] DB fetch failed:`, dbErr);
        results.push({
          category,
          woocommerce_id: wooId,
          variations_found: 0,
          matched: 0,
          unmatched: [],
          unmatched_db_rows: [],
          errors: [`DB fetch failed: ${dbErr?.message || "unknown"}`],
        });
        continue;
      }

      const dbByNorm: Record<string, { id: string; name: string }> = {};
      for (const row of dbRows) dbByNorm[normalize(row.name)] = row;

      // Try variations first
      let variations: any[] = [];
      const errors: string[] = [];
      try {
        variations = await fetchWooVariations(wooUrl, consumerKey, consumerSecret, wooId);
      } catch (e: any) {
        errors.push(e.message);
      }

      console.log(`[wpw-import] Found ${variations.length} variations for ${category}`);

      const result: ImportResult = {
        category,
        woocommerce_id: wooId,
        variations_found: variations.length,
        matched: 0,
        unmatched: [],
        unmatched_db_rows: [],
        errors,
      };

      const matchedDbIds = new Set<string>();

      for (const v of variations) {
        // The swatch name lives in attributes — typically pa_color, pa_pattern, pa_style, or pa_design
        const attributes = v.attributes || [];
        const swatchAttr = attributes.find((a: any) =>
          /color|pattern|style|design|print|swatch/i.test(a.name || a.slug || ""),
        ) || attributes[0];
        const swatchName: string = swatchAttr?.option || v.name || "";
        const norm = normalize(swatchName);
        const imageSrc: string | undefined = v.image?.src || v.image?.source_url;

        if (!swatchName || !imageSrc) {
          result.unmatched.push(`(no name or image) ${JSON.stringify(swatchAttr)}`);
          continue;
        }

        const dbRow = dbByNorm[norm];
        if (!dbRow) {
          result.unmatched.push(swatchName);
          continue;
        }

        if (dryRun) {
          console.log(`[wpw-import] DRY: ${swatchName} -> ${imageSrc}`);
          result.matched++;
          matchedDbIds.add(dbRow.id);
          continue;
        }

        const ext = imageSrc.split("?")[0].split(".").pop()?.toLowerCase() || "jpg";
        const storagePath = `${SWATCH_PREFIX}/${slugify(category)}/${slugify(swatchName)}.${ext}`;
        const publicUrl = await downloadAndUpload(imageSrc, storagePath, sb);

        if (publicUrl) {
          await sb
            .from("wbty_products")
            .update({ media_url: publicUrl })
            .eq("id", dbRow.id);
          result.matched++;
          matchedDbIds.add(dbRow.id);
          console.log(`[wpw-import] OK ${swatchName} -> ${publicUrl}`);
        } else {
          result.errors.push(`Upload failed: ${swatchName}`);
        }
      }

      // If variations didn't yield any matches, fall back to the parent product gallery
      if (result.matched === 0 && variations.length === 0) {
        try {
          const galleryImages = await fetchWooProductImages(wooUrl, consumerKey, consumerSecret, wooId);
          console.log(`[wpw-import] Fallback gallery: ${galleryImages.length} images`);

          for (const img of galleryImages) {
            const swatchName: string = (img.alt || img.name || "").trim();
            const norm = normalize(swatchName);
            if (!swatchName || !img.src) continue;

            const dbRow = dbByNorm[norm];
            if (!dbRow) {
              result.unmatched.push(swatchName);
              continue;
            }

            if (dryRun) {
              result.matched++;
              matchedDbIds.add(dbRow.id);
              continue;
            }

            const ext = img.src.split("?")[0].split(".").pop()?.toLowerCase() || "jpg";
            const storagePath = `${SWATCH_PREFIX}/${slugify(category)}/${slugify(swatchName)}.${ext}`;
            const publicUrl = await downloadAndUpload(img.src, storagePath, sb);
            if (publicUrl) {
              await sb.from("wbty_products").update({ media_url: publicUrl }).eq("id", dbRow.id);
              result.matched++;
              matchedDbIds.add(dbRow.id);
            }
          }
        } catch (e: any) {
          errors.push(`Gallery fallback: ${e.message}`);
        }
      }

      // Record DB rows that didn't get matched
      for (const row of dbRows) {
        if (!matchedDbIds.has(row.id)) result.unmatched_db_rows.push(row.name);
      }

      results.push(result);
    }

    const summary = {
      total_matched: results.reduce((s, r) => s + r.matched, 0),
      total_db_unmatched: results.reduce((s, r) => s + r.unmatched_db_rows.length, 0),
      total_woo_unmatched: results.reduce((s, r) => s + r.unmatched.length, 0),
    };

    return new Response(JSON.stringify({ summary, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[wpw-import] Fatal:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
