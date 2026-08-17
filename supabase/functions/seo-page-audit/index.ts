/**
 * seo-page-audit — Fetch a URL, parse its HTML, score on-page SEO,
 * persist the run, and return the result.
 *
 * Body: { shop_id, url, focus_keyword?, persist?: boolean }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopMember, assertShopAdmin } from "../_shared/seo/auth.ts";
import { extractFromHtml, scoreSeo } from "../_shared/seo/seo-scoring.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const shop_id = body?.shop_id as string;
    const url = body?.url as string;
    const focus_keyword = body?.focus_keyword as string | undefined;
    const persist = body?.persist !== false;

    if (!shop_id || !url) return json({ error: "shop_id + url required" }, 400);
    await assertShopMember(ctx, shop_id);

    const fetched = await fetch(url, {
      headers: { "User-Agent": "RestyleProSEO/1.0 (+https://restyleproai.com)" },
      redirect: "follow",
    });
    if (!fetched.ok) {
      return json({ error: `Could not fetch URL (HTTP ${fetched.status})` }, 400);
    }
    const html = await fetched.text();
    const parsed = extractFromHtml(html);

    const { score, findings } = scoreSeo({
      url,
      title: parsed.title,
      metaTitle: parsed.metaTitle,
      metaDescription: parsed.metaDescription,
      focusKeyword: focus_keyword,
      bodyText: parsed.bodyText,
      wordCount: parsed.wordCount,
      internalLinkCount: parsed.internalLinkCount,
      externalLinkCount: parsed.externalLinkCount,
      hasH1: parsed.hasH1,
      h1Count: parsed.h1Count,
      hasSchema: parsed.hasSchema,
      hasOpenGraph: parsed.hasOpenGraph,
      hasCanonical: parsed.hasCanonical,
      totalImages: parsed.totalImages,
      imagesWithoutAlt: parsed.imagesWithoutAlt,
    });

    if (persist) {
      // Need admin to write — but reads work for members, so just attempt and swallow
      try {
        await assertShopAdmin(ctx, shop_id);
        // Upsert seo_pages
        const { data: pageRow } = await ctx.service
          .from("seo_pages")
          .upsert(
            {
              shop_id,
              url,
              current_title: parsed.title,
              current_meta_description: parsed.metaDescription,
              word_count: parsed.wordCount,
              last_audited_at: new Date().toISOString(),
              last_score: score,
              last_findings: findings,
            },
            { onConflict: "shop_id,url" },
          )
          .select("id")
          .maybeSingle();

        await ctx.service.from("seo_audit_runs").insert({
          shop_id,
          page_id: pageRow?.id ?? null,
          url,
          score,
          findings,
          raw_html_excerpt: html.slice(0, 4000),
          ran_by: ctx.user.id,
        });
      } catch (_) {
        // member-only call: skip persist silently
      }
    }

    return json({
      ok: true,
      url,
      score,
      findings,
      parsed: {
        title: parsed.title,
        meta_description: parsed.metaDescription,
        word_count: parsed.wordCount,
        h1_count: parsed.h1Count,
        total_images: parsed.totalImages,
        images_without_alt: parsed.imagesWithoutAlt,
        internal_links: parsed.internalLinkCount,
        external_links: parsed.externalLinkCount,
        has_schema: parsed.hasSchema,
        has_canonical: parsed.hasCanonical,
        has_open_graph: parsed.hasOpenGraph,
      },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-page-audit] error", msg);
    return json({ error: msg }, 500);
  }
});
