/**
 * seo-aeo-publish — AEO artifacts + llms.txt + standalone pillar pages.
 *
 * SAFETY: never edits the live Elementor layout. Only returns paste-ready
 * artifacts or creates/updates standalone WordPress pages by slug.
 *
 * Auth: normally a shop-admin JWT (authenticate + assertShopAdmin). For
 * server-to-server automation (pg_net/cron) a request may instead carry
 * `internal_key`, validated against public.app_internal_keys.name = 'aeo'.
 * Delete that row to disable the internal path.
 *
 * Actions: homepage_artifacts | llms_txt | publish_pillar
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopAdmin } from "../_shared/seo/auth.ts";
import {
  buildOrganizationSchema,
  buildStoreSchema,
  buildWebsiteSchema,
  buildFaqSchema,
  buildFaqHtml,
  buildKeyTakeawaysHtml,
  buildLlmsTxt,
  combineGraph,
  type FaqItem,
} from "../_shared/seo/aeo.ts";

const DEFAULT_SITE = "https://weprintwraps.com";
const PILLAR_TITLE = "AI-Designed, Print-Ready Vehicle Wraps";
const PILLAR_SLUG = "ai-designed-vehicle-wraps";
const PILLAR_HTML =
  "<h2>AI-Designed, Print-Ready Vehicle Wraps</h2><p>From one prompt to a true-size, " +
  "300 DPI CMYK print-ready production pack - designed, printed, and shipped nationwide.</p>";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function trimUrl(url: string): string {
  return String(url ?? "").replace(/\/+$/, "");
}

interface WpConn { site_url: string; username: string; app_password: string; seo_plugin?: string; }

function homepageFaqs(brand: string): FaqItem[] {
  return [
    { q: "How much does a vehicle wrap cost?", a: `The price of a wrap depends on the vehicle size, how much of it you cover (partial vs. full), the vinyl finish, and the design complexity. A small car partial wrap sits at the low end, while a full wrap on a large van, truck, or SUV costs more because it uses more material and labor. For an exact figure, ${brand} provides a free, no-obligation quote based on your specific vehicle and design.` },
    { q: "How long does a vehicle wrap last?", a: "A wrap made from quality cast vinyl typically lasts 5 to 7 years, and often longer when the vehicle is garage-kept and hand-washed. Lifespan depends on sun exposure, climate, and care. Avoid automatic brushes and harsh chemicals to get the most life out of your wrap." },
    { q: "Is a vehicle wrap better than paint?", a: "A wrap and a paint job serve different goals. A wrap is removable without harming the factory paint, and lets you run finishes and graphics that paint cannot easily match. It also protects the original paint underneath, which helps preserve resale value. Paint is permanent, while a wrap can be removed or changed later." },
    { q: "Will a wrap damage my factory paint?", a: "No. When quality vinyl is installed on factory paint that is in good condition and properly cleaned beforehand, it protects the paint rather than harming it. When you are ready for a change, the wrap can be removed cleanly, leaving the original finish intact." },
    { q: "Do you ship vehicle wraps nationwide?", a: `Yes. ${brand} designs and prints your wrap and ships it anywhere in the United States - you do not need to be local.` },
    { q: "Can I get a custom design and approve it before printing?", a: `Yes. ${brand} creates a digital proof so you can review the exact look on your vehicle and request changes before anything is printed. Nothing goes to production until you approve the design.` },
  ];
}

function homepageTakeaways(brand: string): string[] {
  return [
    "Wrap pricing depends on vehicle size, coverage, finish, and design complexity - request a free quote for an exact figure.",
    "A quality cast-vinyl wrap typically lasts 5 to 7 years with proper care.",
    "Wraps are removable and protect the factory paint underneath, helping preserve resale value.",
    `${brand} designs, prints, and ships vehicle wraps nationwide, with a digital proof for approval before printing.`,
  ];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const action = body?.action as string;
    const shop_id = body?.shop_id as string;
    if (!action || !shop_id) {
      return json({ error: "action + shop_id required" }, 400);
    }

    // Auth: shop-admin JWT, OR a secret-gated internal call (cron/pg_net).
    let service: SupabaseClient;
    const internalKey = body?.internal_key as string | undefined;
    if (internalKey) {
      service = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false } },
      );
      const { data: keyRow } = await service
        .from("app_internal_keys")
        .select("secret")
        .eq("name", "aeo")
        .maybeSingle();
      if (!keyRow || keyRow.secret !== internalKey) {
        return json({ error: "Invalid internal key" }, 401);
      }
    } else {
      const authCtx = await authenticate(req);
      await assertShopAdmin(authCtx, shop_id);
      service = authCtx.service;
    }
    const ctx = { service };

    const { data: shop } = await ctx.service
      .from("shops")
      .select("name, website, logo_url, phone")
      .eq("id", shop_id)
      .maybeSingle();

    const brand = (shop?.name as string | undefined)?.trim() || "We Print Wraps";
    const siteUrl = trimUrl((shop?.website as string | undefined)?.trim() || DEFAULT_SITE);
    const logoUrl = (shop?.logo_url as string | undefined) || undefined;
    const email: string | undefined = undefined;
    const phone = (shop?.phone as string | undefined) || undefined;

    if (action === "homepage_artifacts") {
      const faqs = homepageFaqs(brand);
      const orgNode = buildOrganizationSchema({ name: brand, url: siteUrl, logoUrl, description: `${brand} designs, prints, and ships professional vehicle wraps and printed graphics nationwide.`, telephone: phone, email });
      const storeNode = buildStoreSchema({ name: brand, url: siteUrl, description: `${brand} - custom vehicle wraps, wall wraps, cut graphics, and window graphics, shipped nationwide.`, logoUrl, telephone: phone, email });
      const websiteNode = buildWebsiteSchema({ name: brand, url: siteUrl });
      const faqNode = buildFaqSchema(faqs);
      const graph = combineGraph(orgNode, storeNode, websiteNode, faqNode);
      const homepageJsonldScript = `<script type="application/ld+json">${JSON.stringify(graph)}</script>`;
      const faqHtml = buildFaqHtml(faqs);
      const keyTakeawaysHtml = buildKeyTakeawaysHtml(homepageTakeaways(brand));
      return json({
        ok: true,
        homepage_jsonld: graph,
        homepage_jsonld_script: homepageJsonldScript,
        faq_html: faqHtml,
        key_takeaways_html: keyTakeawaysHtml,
        instructions: "Paste faq_html / key_takeaways_html into a single Elementor HTML widget; paste homepage_jsonld_script via your SEO plugin's schema field or an HTML widget in the footer. Nothing here edits your existing layout.",
      });
    }

    if (action === "llms_txt") {
      const publish = body?.publish === true;
      const { data: posts } = await ctx.service
        .from("seo_blog_posts")
        .select("title, external_url, published_at")
        .eq("shop_id", shop_id)
        .eq("status", "published")
        .not("external_url", "is", null)
        .order("published_at", { ascending: false })
        .limit(25);
      const postLinks = (posts ?? [])
        .filter((p: { title?: string; external_url?: string }) => p.title && p.external_url)
        .map((p: { title: string; external_url: string }) => ({ title: p.title, url: p.external_url }));
      const facts = [
        "We Print Wraps designs, prints, and ships custom vehicle wraps, wall wraps, cut graphics, and window graphics nationwide.",
        "Designs are AI-generated and delivered as true-size, 300 DPI CMYK, print-ready files with bleed.",
        "Wraps are removable and protect the factory paint underneath.",
        "A digital proof is provided for approval before anything is printed.",
      ];
      const llmsTxt = buildLlmsTxt({
        brandName: brand,
        siteUrl,
        summary: `${brand} designs, prints, and ships AI-designed, print-ready vehicle wraps, wall wraps, cut graphics, and window graphics nationwide.`,
        posts: postLinks,
        facts,
        contact: { email, phone, url: siteUrl },
      });
      const result: Record<string, unknown> = {
        ok: true,
        llms_txt: llmsTxt,
        note: "A true root-level /llms.txt requires uploading this raw content to your web root. When publish=true, this creates a standalone WordPress Page at /llms-txt as a fallback. It never edits any other page or your layout.",
      };
      if (!publish) { result.published = false; return json(result); }
      const creds = await resolveCreds(ctx.service, shop_id);
      if (!creds) { result.published = false; result.publish_error = "WordPress not connected / missing credentials"; return json(result); }
      try {
        const published = await publishWpPage(creds, "LLMs.txt", "llms-txt", `<pre>${escapeHtml(llmsTxt)}</pre>`);
        result.published = true;
        result.published_url = published.link;
        result.wp_page = { id: published.id, slug: published.slug, status: published.status };
      } catch (e) {
        result.published = false;
        result.publish_error = e instanceof Error ? e.message : String(e);
      }
      return json(result);
    }

    if (action === "publish_pillar") {
      const creds = await resolveCreds(ctx.service, shop_id);
      if (!creds) return json({ error: "WordPress not connected / missing credentials" }, 400);
      const title = (body?.title as string | undefined)?.trim() || PILLAR_TITLE;
      const slug = (body?.slug as string | undefined)?.trim() || PILLAR_SLUG;
      const content = (body?.content as string | undefined) || PILLAR_HTML;
      // Optional draft-first publish. Defaults to "publish" so the existing
      // cron/pillar behavior is unchanged; callers that want a reviewable WP
      // draft (the wrap-tv-world DRAFT-ONLY convention) pass status:"draft".
      const status = body?.status === "draft" ? "draft" : "publish";
      try {
        const published = await publishWpPage(creds, title, slug, content, status);
        return json({ ok: true, published_url: published.link, wp_page: { id: published.id, slug: published.slug, status: published.status } });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-aeo-publish] error", msg);
    return json({ error: msg }, 500);
  }
});

async function resolveCreds(service: SupabaseClient, shopId: string): Promise<WpConn | null> {
  const { data: conn } = await service
    .from("tenant_site_connections")
    .select("site_url, config")
    .eq("shop_id", shopId)
    .eq("platform", "wordpress")
    .eq("is_active", true)
    .maybeSingle();
  if (!conn) return null;
  const cfg = (conn.config ?? {}) as { username?: string; app_password?: string; seo_plugin?: string };
  const creds: WpConn = {
    site_url: (conn.site_url as string) ?? "",
    username: cfg.username ?? "",
    app_password: cfg.app_password ?? "",
    seo_plugin: cfg.seo_plugin ?? "none",
  };
  if (!creds.site_url || !creds.username || !creds.app_password) return null;
  return creds;
}

async function publishWpPage(
  creds: WpConn,
  title: string,
  slug: string,
  content: string,
  status: "draft" | "publish" = "publish",
): Promise<{ id: number; link: string; slug: string; status: string }> {
  const auth = "Basic " + btoa(`${creds.username}:${creds.app_password}`);
  const base = trimUrl(creds.site_url);
  const headers = { Authorization: auth, "Content-Type": "application/json", "User-Agent": "RestyleProSEO/1.0" };
  let existingId: number | null = null;
  try {
    const lookup = await fetch(`${base}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&_fields=id&status=any`, { headers: { Authorization: auth, "User-Agent": "RestyleProSEO/1.0" } });
    if (lookup.ok) {
      const arr = await lookup.json();
      if (Array.isArray(arr) && arr.length > 0 && arr[0]?.id) existingId = Number(arr[0].id);
    }
  } catch (_) { /* fall through to create */ }
  const url = existingId ? `${base}/wp-json/wp/v2/pages/${existingId}` : `${base}/wp-json/wp/v2/pages`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ title, slug, content, status }) });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`WP page ${existingId ? "update" : "create"} ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json();
  return { id: Number(data?.id), link: String(data?.link ?? `${base}/${slug}`), slug: String(data?.slug ?? slug), status: String(data?.status ?? "publish") };
}
