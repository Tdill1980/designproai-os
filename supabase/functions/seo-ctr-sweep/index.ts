/**
 * seo-ctr-sweep — Find pages that are ranking but not getting clicked,
 * have Claude rewrite their title/meta for CTR, and push the change live
 * to WordPress.
 *
 * Why this exists: position 5-20 with high impressions = "almost ranking".
 * A CTR lift on these pages is the highest-leverage SEO change in the
 * shortest time.
 *
 * Actions:
 *   analyze
 *     Body: { shop_id, days?, min_impressions?, position_min?,
 *             position_max?, limit? }
 *     - Pulls GSC top pages over `days` (default 28), filtered to rows
 *       with position between position_min..position_max (default 5..20)
 *       and impressions >= min_impressions (default 50).
 *     - For each URL: fetches the live HTML to capture the current
 *       <title> + <meta name="description">.
 *     - Asks Claude (claude-sonnet-4-6) for a rewritten title (under 60
 *       chars) and meta description (under 160 chars) optimized for CTR
 *       around the dominant query.
 *     - Upserts each row into seo_pages with ai_suggested_title /
 *       ai_suggested_meta_description.
 *     - Returns the analysis array.
 *
 *   apply
 *     Body: { shop_id, url, title, meta_description }
 *     - Resolves the shop's WordPress connection.
 *     - Finds the matching post/page/product in WP by slug.
 *     - Updates the post title (if different) and the SEO meta (Yoast /
 *       RankMath / AIOSEO aware via buildSeoMeta).
 *     - Updates seo_pages.current_title / current_meta_description.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopMember, assertShopAdmin } from "../_shared/seo/auth.ts";
import { getValidGoogleAccessToken } from "../_shared/seo/google-oauth.ts";
import {
  WordPressCredentials,
  updatePost,
  updateWooProductSeoMeta,
} from "../_shared/seo/wordpress-adapter.ts";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface GscPageRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface PageAnalysis {
  url: string;
  topQuery: string | null;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  currentTitle: string | null;
  currentMeta: string | null;
  suggestedTitle: string | null;
  suggestedMeta: string | null;
  rationale: string | null;
  error?: string;
}

// ── HTML extraction (no JSDOM in Deno edge runtime) ──────────────────────
function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].trim()).slice(0, 200) : null;
}

function extractMeta(html: string, name: string): string | null {
  // Tolerate single/double quotes, attribute order, and `name=` vs `property=`.
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:name|property)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*(?:name|property)\\s*=\\s*["']${name}["']`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeEntities(m[1]).slice(0, 400);
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageMeta(url: string): Promise<{ title: string | null; meta: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "RestyleProSEO/1.0 (+https://restyleproai.com)" },
      redirect: "follow",
    });
    if (!res.ok) return { title: null, meta: null };
    const html = await res.text();
    return {
      title: extractTitle(html),
      meta: extractMeta(html, "description"),
    };
  } catch (_) {
    return { title: null, meta: null };
  }
}

// ── Claude rewrite ────────────────────────────────────────────────────────
interface ClaudeRewrite {
  title: string;
  meta: string;
  rationale: string;
}

async function rewriteForCtr(
  shopName: string,
  page: {
    url: string;
    topQuery: string | null;
    position: number;
    impressions: number;
    currentTitle: string | null;
    currentMeta: string | null;
  },
): Promise<ClaudeRewrite> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const sys = `You rewrite SEO titles and meta descriptions for a wrap shop "${shopName}" to maximize click-through from Google. Strict rules:
- Title ≤ 60 characters. Lead with the primary keyword. Add a number, year, or differentiator (free quote, same-day, custom, etc.) when natural.
- Meta description 140-160 characters. Action verb in the first 5 words. Concrete benefit + a soft CTA (e.g., "Get a free quote today.").
- Match user intent of the dominant query — informational, comparison, local, or commercial.
- Never use emojis, ALL CAPS, or "click here". Never invent prices, guarantees, or specs.
- Output JSON only — no prose.`;

  const user = `URL: ${page.url}
Top query: ${page.topQuery ?? "(unknown — infer from URL slug)"}
Current position: ${page.position.toFixed(1)}
28d impressions: ${page.impressions}
Current title: ${page.currentTitle ?? "(empty)"}
Current meta: ${page.currentMeta ?? "(empty)"}

Return JSON:
{
  "title": "≤60 char SEO title",
  "meta": "140-160 char meta description",
  "rationale": "one sentence on what changed and why"
}`;

  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system: sys,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Claude ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  const raw =
    data?.content?.find((c: { type: string; text?: string }) => c.type === "text")?.text ?? "";
  const parsed = parseJson(raw);
  return {
    title: String(parsed?.title ?? "").trim(),
    meta: String(parsed?.meta ?? "").trim(),
    rationale: String(parsed?.rationale ?? "").trim(),
  };
}

function parseJson(raw: string): { title?: string; meta?: string; rationale?: string } {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], raw].filter(Boolean) as string[];
  for (const c of candidates) {
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start === -1 || end === -1) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch (_) {
      continue;
    }
  }
  return {};
}

// ── GSC: top pages with their #1 query ────────────────────────────────────
async function fetchTopPages(
  accessToken: string,
  siteUrl: string,
  days: number,
  positionMin: number,
  positionMax: number,
  minImpressions: number,
  limit: number,
): Promise<Array<{ url: string; topQuery: string | null; position: number; impressions: number; clicks: number; ctr: number }>> {
  const startDate = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const endDate = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);

  const pagesRes = await fetch(
    `https://searchconsole.googleapis.com/v1/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["page"],
        rowLimit: 200,
      }),
    },
  );
  if (!pagesRes.ok) {
    const txt = await pagesRes.text();
    throw new Error(`GSC pages ${pagesRes.status}: ${txt.slice(0, 300)}`);
  }
  const pagesData = await pagesRes.json();
  const pageRows: GscPageRow[] = pagesData.rows ?? [];

  // Filter to the "almost ranking" zone and sort by impressions desc.
  const candidates = pageRows
    .filter(
      (r) =>
        r.position >= positionMin &&
        r.position <= positionMax &&
        r.impressions >= minImpressions,
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);

  // For each candidate, find its top query (single round-trip per page is too
  // many calls — do one combined page+query query instead).
  const pqRes = await fetch(
    `https://searchconsole.googleapis.com/v1/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["page", "query"],
        rowLimit: 1000,
      }),
    },
  );
  const topQueryByPage = new Map<string, string>();
  if (pqRes.ok) {
    const pqData = await pqRes.json();
    const pqRows: Array<{ keys: string[]; clicks: number; impressions: number }> = pqData.rows ?? [];
    // Walk highest-impression rows first; first hit per page wins.
    pqRows
      .sort((a, b) => b.impressions - a.impressions)
      .forEach((r) => {
        const [page, query] = r.keys;
        if (!topQueryByPage.has(page)) topQueryByPage.set(page, query);
      });
  }

  return candidates.map((r) => ({
    url: r.keys[0],
    topQuery: topQueryByPage.get(r.keys[0]) ?? null,
    position: r.position,
    impressions: Math.round(r.impressions),
    clicks: Math.round(r.clicks),
    ctr: r.ctr,
  }));
}

// ── WP post lookup by slug ────────────────────────────────────────────────
interface WpHit {
  type: "post" | "page" | "product";
  id: number;
  title: string;
}

async function findWpEntryBySlug(
  c: WordPressCredentials,
  slug: string,
): Promise<WpHit | null> {
  const auth = "Basic " + btoa(`${c.username}:${c.app_password}`);
  const base = c.site_url.replace(/\/+$/, "");
  const headers = { Authorization: auth, "User-Agent": "RestyleProSEO/1.0" };

  const tries: Array<{ path: string; type: WpHit["type"] }> = [
    { path: `/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&_fields=id,title&status=any`, type: "post" },
    { path: `/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&_fields=id,title&status=any`, type: "page" },
    { path: `/wp-json/wc/v3/products?slug=${encodeURIComponent(slug)}`, type: "product" },
  ];
  for (const t of tries) {
    try {
      const res = await fetch(`${base}${t.path}`, { headers });
      if (!res.ok) continue;
      const arr = await res.json();
      if (Array.isArray(arr) && arr.length > 0) {
        const first = arr[0] as { id: number; title?: { rendered?: string } | string; name?: string };
        const title =
          typeof first.title === "object"
            ? first.title?.rendered ?? ""
            : typeof first.title === "string"
            ? first.title
            : first.name ?? "";
        return { type: t.type, id: first.id, title };
      }
    } catch (_) {
      // try next
    }
  }
  return null;
}

function slugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    return parts[parts.length - 1];
  } catch {
    return null;
  }
}

// ── Handler ───────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const action = body?.action as string;
    const shop_id = body?.shop_id as string;
    if (!action || !shop_id) {
      return json({ error: "action + shop_id required" }, 400);
    }
    await assertShopMember(ctx, shop_id);

    if (action === "analyze") {
      await assertShopAdmin(ctx, shop_id);
      const days = (body?.days as number) ?? 28;
      const positionMin = (body?.position_min as number) ?? 5;
      const positionMax = (body?.position_max as number) ?? 20;
      const minImpressions = (body?.min_impressions as number) ?? 50;
      const limit = Math.min((body?.limit as number) ?? 50, 100);

      const { access_token, metadata } = await getValidGoogleAccessToken(
        ctx.service,
        shop_id,
        "google_search_console",
      );
      const siteUrl = metadata?.selected_site as string | undefined;
      if (!siteUrl) {
        return json({ error: "No Search Console site selected" }, 400);
      }

      const { data: shopRow } = await ctx.service
        .from("shops")
        .select("name")
        .eq("id", shop_id)
        .maybeSingle();
      const shopName = shopRow?.name ?? "this shop";

      const candidates = await fetchTopPages(
        access_token,
        siteUrl,
        days,
        positionMin,
        positionMax,
        minImpressions,
        limit,
      );

      const results: PageAnalysis[] = [];
      for (const c of candidates) {
        const meta = await fetchPageMeta(c.url);
        let suggestedTitle: string | null = null;
        let suggestedMeta: string | null = null;
        let rationale: string | null = null;
        let err: string | undefined;
        try {
          const rewrite = await rewriteForCtr(shopName, {
            url: c.url,
            topQuery: c.topQuery,
            position: c.position,
            impressions: c.impressions,
            currentTitle: meta.title,
            currentMeta: meta.meta,
          });
          suggestedTitle = rewrite.title || null;
          suggestedMeta = rewrite.meta || null;
          rationale = rewrite.rationale || null;
        } catch (e) {
          err = e instanceof Error ? e.message : String(e);
        }

        // Persist to seo_pages so /admin/seo/pages shows the same suggestions.
        try {
          await ctx.service
            .from("seo_pages")
            .upsert(
              {
                shop_id,
                url: c.url,
                page_type: c.url.includes("/product")
                  ? "product"
                  : c.url.includes("/category")
                  ? "category"
                  : "other",
                current_title: meta.title,
                current_meta_description: meta.meta,
                ai_suggested_title: suggestedTitle,
                ai_suggested_meta_description: suggestedMeta,
                ai_suggested_at: suggestedTitle || suggestedMeta ? new Date().toISOString() : null,
              },
              { onConflict: "shop_id,url" },
            );
        } catch (_) {
          // non-fatal
        }

        results.push({
          url: c.url,
          topQuery: c.topQuery,
          position: c.position,
          impressions: c.impressions,
          clicks: c.clicks,
          ctr: c.ctr,
          currentTitle: meta.title,
          currentMeta: meta.meta,
          suggestedTitle,
          suggestedMeta,
          rationale,
          error: err,
        });
      }
      return json({ ok: true, results, range_days: days });
    }

    if (action === "apply") {
      await assertShopAdmin(ctx, shop_id);
      const url = body?.url as string;
      const newTitle = (body?.title as string | undefined)?.trim() || undefined;
      const newMeta = (body?.meta_description as string | undefined)?.trim() || undefined;
      if (!url || (!newTitle && !newMeta)) {
        return json({ error: "url + title and/or meta_description required" }, 400);
      }

      // Pull WP credentials.
      const { data: conn, error: connErr } = await ctx.service
        .from("tenant_site_connections")
        .select("config, metadata")
        .eq("shop_id", shop_id)
        .eq("platform", "wordpress")
        .eq("is_active", true)
        .maybeSingle();
      if (connErr || !conn) return json({ error: "WordPress not connected" }, 400);
      const cfg = conn.config as {
        site_url: string;
        username: string;
        app_password: string;
        seo_plugin?: WordPressCredentials["seo_plugin"];
      };
      const credentials: WordPressCredentials = {
        site_url: cfg.site_url,
        username: cfg.username,
        app_password: cfg.app_password,
        seo_plugin: cfg.seo_plugin ?? "none",
      };

      const slug = slugFromUrl(url);
      if (!slug) return json({ error: "Could not extract slug from URL" }, 400);
      const hit = await findWpEntryBySlug(credentials, slug);
      if (!hit) return json({ error: `No WP post/page/product found for slug "${slug}"` }, 404);

      try {
        if (hit.type === "product") {
          await updateWooProductSeoMeta(credentials, hit.id, {
            name: newTitle,
            meta: { title: newTitle, description: newMeta },
          });
        } else {
          // posts + pages share the same /wp/v2/<type>/<id> shape; updatePost
          // hits /posts only, so handle pages with a direct fetch.
          if (hit.type === "post") {
            await updatePost(credentials, hit.id, {
              title: newTitle,
              meta: { title: newTitle, description: newMeta },
            });
          } else {
            const auth = "Basic " + btoa(`${credentials.username}:${credentials.app_password}`);
            const base = credentials.site_url.replace(/\/+$/, "");
            const seoMeta: Record<string, unknown> = {};
            if (credentials.seo_plugin === "yoast") {
              if (newTitle) seoMeta._yoast_wpseo_title = newTitle;
              if (newMeta) seoMeta._yoast_wpseo_metadesc = newMeta;
            } else if (credentials.seo_plugin === "rankmath") {
              if (newTitle) seoMeta.rank_math_title = newTitle;
              if (newMeta) seoMeta.rank_math_description = newMeta;
            } else {
              if (newTitle) seoMeta.meta_title = newTitle;
              if (newMeta) seoMeta.meta_description = newMeta;
            }
            const res = await fetch(`${base}/wp-json/wp/v2/pages/${hit.id}`, {
              method: "POST",
              headers: { Authorization: auth, "Content-Type": "application/json" },
              body: JSON.stringify({
                ...(newTitle ? { title: newTitle } : {}),
                meta: seoMeta,
              }),
            });
            if (!res.ok) {
              const txt = await res.text();
              throw new Error(`WP page update ${res.status}: ${txt.slice(0, 300)}`);
            }
          }
        }
      } catch (e) {
        return json(
          { error: e instanceof Error ? e.message : String(e) },
          502,
        );
      }

      // Update the locally cached current_* so the UI reflects the new state.
      await ctx.service
        .from("seo_pages")
        .upsert(
          {
            shop_id,
            url,
            ...(newTitle ? { current_title: newTitle } : {}),
            ...(newMeta ? { current_meta_description: newMeta } : {}),
          },
          { onConflict: "shop_id,url" },
        );

      return json({
        ok: true,
        wp: { type: hit.type, id: hit.id, title: hit.title },
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-ctr-sweep] error", msg);
    return json({ error: msg }, 500);
  }
});
