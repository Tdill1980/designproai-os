import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * mirror-wpw-swatches
 *
 * Finds wbty_products rows whose media_url still points at weprintwraps.com,
 * downloads each image, uploads to Supabase Storage at
 * `wrap-files/pattern-swatches-wpw/{category}/{name}.{ext}`, and updates the
 * row to point at the mirrored URL.
 *
 * This gives us ownership of the swatch assets so we don't depend on WPW
 * continuing to serve them at the same URLs. Runs idempotently — only
 * processes rows still pointing at weprintwraps.com.
 *
 * POST body: { limit?: number }  // default 30
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "image/webp,image/png,image/jpeg,*/*;q=0.8",
};

const BUCKET = "wrap-files";
const PREFIX = "pattern-swatches-wpw";

function createSb() {
  const url = Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

function slugify(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const limit: number = body.limit || 30;
    const sb = createSb();

    const { data: rows, error } = await sb
      .from("wbty_products")
      .select("id, name, category, media_url")
      .like("media_url", "https://weprintwraps.com/%")
      .eq("is_active", true)
      .order("sort_order")
      .limit(limit);
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ message: "All mirrored", mirrored: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];
    let ok = 0, fail = 0;

    for (const row of rows) {
      try {
        const r = await fetch(row.media_url, { headers: BROWSER_HEADERS });
        if (!r.ok) {
          fail++;
          results.push({ name: row.name, ok: false, err: `fetch ${r.status}` });
          continue;
        }
        const ct = r.headers.get("content-type") || "image/jpeg";
        const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
        const buf = new Uint8Array(await r.arrayBuffer());
        const path = `${PREFIX}/${slugify(row.category)}/${slugify(row.name)}.${ext}`;
        const { error: upErr } = await sb.storage
          .from(BUCKET)
          .upload(path, buf, { contentType: ct, upsert: true });
        if (upErr) {
          fail++;
          results.push({ name: row.name, ok: false, err: upErr.message });
          continue;
        }
        const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(path);
        const publicUrl = urlData?.publicUrl;
        if (!publicUrl) {
          fail++;
          results.push({ name: row.name, ok: false, err: "no public url" });
          continue;
        }
        await sb.from("wbty_products").update({ media_url: publicUrl }).eq("id", row.id);
        ok++;
        results.push({ name: row.name, ok: true });
      } catch (e: any) {
        fail++;
        results.push({ name: row.name, ok: false, err: String(e?.message || e) });
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    const { count: remaining } = await sb
      .from("wbty_products")
      .select("id", { count: "exact", head: true })
      .like("media_url", "https://weprintwraps.com/%");

    return new Response(
      JSON.stringify({ processed: rows.length, ok, fail, remaining, results }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
