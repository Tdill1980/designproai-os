/**
 * seo-google-search-console — Search Console queries.
 *
 * Actions:
 *   list_sites          → list properties the connected account owns
 *   set_site            → save the chosen siteUrl into the connection metadata
 *   query               → analytics query (queries / pages / countries / devices)
 *   inspect_url         → URL Inspection API (is the URL indexed?)
 *   submit_url          → ping for re-indexing (uses Indexing API if granted)
 *   sync_keywords       → pull top queries, upsert into seo_keywords
 *
 * All scoped to a single shop's connection.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopMember, assertShopAdmin } from "../_shared/seo/auth.ts";
import { getValidGoogleAccessToken } from "../_shared/seo/google-oauth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function gscFetch(token: string, path: string, init: RequestInit = {}) {
  const url = `https://www.googleapis.com/webmasters/v3${path}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers });
}

async function gscFetchV1(token: string, path: string, init: RequestInit = {}) {
  const url = `https://searchconsole.googleapis.com/v1${path}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(url, { ...init, headers });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const shop_id = body?.shop_id as string;
    const action = body?.action as string;
    if (!shop_id || !action) return json({ error: "shop_id + action required" }, 400);
    await assertShopMember(ctx, shop_id);

    const { access_token, metadata } = await getValidGoogleAccessToken(
      ctx.service,
      shop_id,
      "google_search_console",
    );

    if (action === "list_sites") {
      const res = await gscFetch(access_token, "/sites");
      if (!res.ok) {
        const txt = await res.text();
        return json({ error: `GSC ${res.status}: ${txt.slice(0, 400)}` }, 502);
      }
      const data = await res.json();
      return json({ ok: true, sites: data.siteEntry ?? [] });
    }

    if (action === "set_site") {
      await assertShopAdmin(ctx, shop_id);
      const siteUrl = body?.site_url as string;
      if (!siteUrl) return json({ error: "site_url required" }, 400);
      const newMeta = { ...metadata, selected_site: siteUrl };
      const { error } = await ctx.service
        .from("tenant_site_connections")
        .update({ metadata: newMeta, site_url: siteUrl })
        .eq("shop_id", shop_id)
        .eq("platform", "google_search_console");
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, selected_site: siteUrl });
    }

    if (action === "query") {
      const siteUrl = (body?.site_url as string) ?? (metadata?.selected_site as string);
      if (!siteUrl) return json({ error: "No site selected — call set_site first" }, 400);
      const days = (body?.days as number) ?? 28;
      const dimensions = (body?.dimensions as string[]) ?? ["query"];
      const rowLimit = (body?.row_limit as number) ?? 25;
      const filters = body?.filters as
        | Array<{ dimension: string; operator?: string; expression: string }>
        | undefined;
      const startDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      const endDate = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
      const res = await gscFetchV1(
        access_token,
        `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions,
            rowLimit,
            dimensionFilterGroups: filters ? [{ filters }] : undefined,
          }),
        },
      );
      if (!res.ok) {
        const txt = await res.text();
        return json({ error: `GSC query ${res.status}: ${txt.slice(0, 400)}` }, 502);
      }
      const data = await res.json();
      return json({ ok: true, rows: data.rows ?? [], range: { startDate, endDate } });
    }

    if (action === "inspect_url") {
      const siteUrl = (body?.site_url as string) ?? (metadata?.selected_site as string);
      const inspectionUrl = body?.url as string;
      if (!siteUrl || !inspectionUrl) {
        return json({ error: "site_url + url required" }, 400);
      }
      const res = await gscFetchV1(access_token, "/urlInspection/index:inspect", {
        method: "POST",
        body: JSON.stringify({
          inspectionUrl,
          siteUrl,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        return json({ error: `Inspect ${res.status}: ${txt.slice(0, 400)}` }, 502);
      }
      const data = await res.json();
      return json({ ok: true, inspection: data.inspectionResult });
    }

    if (action === "submit_url") {
      // Indexing API — separate access from Search Console. Requires the
      // OAuth account to be a verified owner in Search Console *and* the
      // Indexing API to be enabled on the Google Cloud project.
      await assertShopAdmin(ctx, shop_id);
      const submitUrl = body?.url as string;
      const type = (body?.type as string) ?? "URL_UPDATED";
      if (!submitUrl) return json({ error: "url required" }, 400);
      const res = await fetch(
        "https://indexing.googleapis.com/v3/urlNotifications:publish",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: submitUrl, type }),
        },
      );
      if (!res.ok) {
        const txt = await res.text();
        return json({ error: `Indexing ${res.status}: ${txt.slice(0, 400)}` }, 502);
      }
      const data = await res.json();
      return json({ ok: true, notification: data });
    }

    if (action === "load_sitemap") {
      // Public sitemap fetch — no GSC API call needed, but we lean on the
      // saved selected_site to resolve the host. Domain properties
      // ("sc-domain:example.com") are normalized to https://example.com.
      const siteUrl = (body?.site_url as string) ?? (metadata?.selected_site as string);
      if (!siteUrl) return json({ error: "No site selected" }, 400);
      const explicit = body?.sitemap_url as string | undefined;
      const maxUrls = Math.min((body?.limit as number) ?? 1000, 5000);
      const host = siteUrl.startsWith("sc-domain:")
        ? `https://${siteUrl.slice("sc-domain:".length)}`
        : siteUrl.replace(/\/+$/, "");
      const candidates = explicit
        ? [explicit]
        : [`${host}/sitemap_index.xml`, `${host}/sitemap.xml`, `${host}/wp-sitemap.xml`];

      const urls: string[] = [];
      const seen = new Set<string>();
      const tried: string[] = [];
      const errors: string[] = [];

      async function fetchXml(u: string): Promise<string | null> {
        tried.push(u);
        try {
          const res = await fetch(u, {
            headers: { "User-Agent": "RestyleProSEO/1.0 (+https://restyleproai.com)" },
            redirect: "follow",
          });
          if (!res.ok) {
            errors.push(`${u} → HTTP ${res.status}`);
            return null;
          }
          const ct = res.headers.get("content-type") ?? "";
          // Accept text/xml, application/xml, application/rss+xml, plain text
          // (some hosts mislabel) — the parser is tolerant of stray HTML.
          if (!ct.includes("xml") && !ct.includes("text")) {
            errors.push(`${u} → unexpected content-type ${ct}`);
            return null;
          }
          return await res.text();
        } catch (e) {
          errors.push(`${u} → ${e instanceof Error ? e.message : String(e)}`);
          return null;
        }
      }

      function extractLocs(xml: string): string[] {
        const out: string[] = [];
        const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(xml)) !== null) {
          const v = m[1].trim();
          if (v) out.push(v);
        }
        return out;
      }

      function isSitemapIndex(xml: string): boolean {
        return /<sitemapindex[\s>]/i.test(xml);
      }

      // Walk: try each candidate; if the response is a sitemap index,
      // follow its <loc> children up to a depth of 2.
      const queue: Array<{ url: string; depth: number }> = candidates.map((c) => ({ url: c, depth: 0 }));
      while (queue.length > 0 && urls.length < maxUrls) {
        const next = queue.shift()!;
        if (next.depth > 2) continue;
        const xml = await fetchXml(next.url);
        if (!xml) continue;
        const locs = extractLocs(xml);
        if (isSitemapIndex(xml)) {
          for (const child of locs) queue.push({ url: child, depth: next.depth + 1 });
          continue;
        }
        for (const u of locs) {
          if (urls.length >= maxUrls) break;
          if (seen.has(u)) continue;
          seen.add(u);
          urls.push(u);
        }
        // Once we found a real urlset on a default candidate path, stop
        // checking the remaining default fallbacks (don't merge sitemap.xml
        // and sitemap_index.xml — they usually overlap completely).
        if (!explicit && next.depth === 0) {
          // drop other top-level candidates
          for (let i = queue.length - 1; i >= 0; i--) {
            if (queue[i].depth === 0) queue.splice(i, 1);
          }
        }
      }

      if (urls.length === 0) {
        return json(
          {
            ok: false,
            error: "No URLs found — the site doesn't expose a public sitemap at /sitemap_index.xml, /sitemap.xml, or /wp-sitemap.xml.",
            tried,
            errors,
          },
          404,
        );
      }
      return json({ ok: true, urls, tried, count: urls.length });
    }

    if (action === "sync_keywords") {
      await assertShopAdmin(ctx, shop_id);
      const siteUrl = (body?.site_url as string) ?? (metadata?.selected_site as string);
      if (!siteUrl) return json({ error: "No site selected" }, 400);
      const days = (body?.days as number) ?? 28;
      const startDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      const endDate = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
      const res = await gscFetchV1(
        access_token,
        `/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
        {
          method: "POST",
          body: JSON.stringify({
            startDate,
            endDate,
            dimensions: ["query", "page"],
            rowLimit: 200,
          }),
        },
      );
      if (!res.ok) {
        const txt = await res.text();
        return json({ error: `Sync ${res.status}: ${txt.slice(0, 400)}` }, 502);
      }
      const data = await res.json();
      const rows: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>
        = data.rows ?? [];

      const upserts = rows.slice(0, 100).map((r) => ({
        shop_id,
        keyword: r.keys[0],
        target_url: r.keys[1] ?? null,
        current_clicks: Math.round(r.clicks),
        current_impressions: Math.round(r.impressions),
        ctr: r.ctr,
        current_position: r.position,
        last_seen_at: endDate,
      }));

      // Upsert one-by-one to use the unique (shop_id, keyword) constraint
      let inserted = 0;
      for (const u of upserts) {
        const { error } = await ctx.service
          .from("seo_keywords")
          .upsert(u, { onConflict: "shop_id,keyword" });
        if (!error) inserted++;
      }
      return json({ ok: true, synced: inserted, total_returned: rows.length });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-google-search-console] error", msg);
    return json({ error: msg }, 500);
  }
});
