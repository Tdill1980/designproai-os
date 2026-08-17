/**
 * seo-product-sweep — Google-Search-Console-FREE product SEO + AEO sweep for
 * WooCommerce stores.
 *
 * Why this exists: seo-ctr-sweep needs Google Search Console OAuth, which many
 * customers never connect. This function pulls the WooCommerce catalog DIRECTLY
 * over the WordPress Application Password already stored in
 * tenant_site_connections, has Claude rewrite each product's SEO + AEO answer
 * content, and writes SUGGESTIONS to seo_pages — with an explicit, admin-gated
 * one-click apply path.
 *
 * SAFETY: "analyze" is read-only against the live store. It lists products and
 * writes suggestions to seo_pages ONLY — it never calls updateWooProductSeoMeta.
 * Only "apply" (single) and "apply_all" mutate the live store, and both require
 * assertShopAdmin.
 *
 * Actions:
 *   analyze    Body: { shop_id, limit?=20, page?=1, status?='publish' }
 *   apply      Body: { shop_id, product_id, name?, meta_title?,
 *                      meta_description?, short_description?, schema? }
 *   apply_all  Body: { shop_id, limit?=50 }
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopMember, assertShopAdmin } from "../_shared/seo/auth.ts";
import {
  WordPressCredentials,
  WCProductSummary,
  listWooProducts,
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

// ── Helpers ─────────────────────────────────────────────────────────────────
function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\/?[^>]+>/g, " ")
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

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function parseJson(raw: string): Record<string, unknown> {
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

// ── WP credential resolution ──────────────────────────────────────────────────
interface TenantConn {
  site_url: string | null;
  config: {
    username?: string;
    app_password?: string;
    seo_plugin?: WordPressCredentials["seo_plugin"];
    site_url?: string;
  } | null;
}

async function resolveCreds(
  ctx: Awaited<ReturnType<typeof authenticate>>,
  shopId: string,
): Promise<WordPressCredentials> {
  const { data: conn, error } = await ctx.service
    .from("tenant_site_connections")
    .select("site_url, config")
    .eq("shop_id", shopId)
    .eq("platform", "wordpress")
    .eq("is_active", true)
    .maybeSingle();
  if (error || !conn) {
    throw json({ error: "WordPress not connected for this shop" }, 400);
  }
  const c = conn as TenantConn;
  const cfg = c.config ?? {};
  const site_url = c.site_url ?? cfg.site_url ?? "";
  if (!site_url || !cfg.username || !cfg.app_password) {
    throw json({ error: "WordPress connection is missing site_url / credentials" }, 400);
  }
  return {
    site_url,
    username: cfg.username,
    app_password: cfg.app_password,
    seo_plugin: cfg.seo_plugin ?? "none",
  };
}

// ── Claude rewrite ────────────────────────────────────────────────────────────
interface ProductRewrite {
  name: string;
  meta_title: string;
  meta_description: string;
  short_description: string;
  faq: Array<{ q: string; a: string }>;
  rationale: string;
}

async function rewriteProduct(
  shopName: string,
  product: WCProductSummary,
): Promise<ProductRewrite> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const sys = `You are a senior ecommerce SEO + AEO (Answer Engine Optimization) specialist for a vehicle-wrap shop named "${shopName}". Rewrite product SEO content. Strict rules:
- Never invent prices, specs, guarantees, or features that aren't in the supplied product context.
- Keep the product's real identity (brand, material, dimensions, SKU) accurate.
- Product title (name): keyword-led, ≤60 chars ideal, keep it a credible product name.
- meta_title: ≤60 characters, keyword-led SEO title.
- meta_description: 140-160 characters, action verb first, concrete benefit + a soft CTA. No invented prices or guarantees.
- short_description: 1-2 sentence HTML-safe, buyer-focused product blurb.
- faq: 3-5 Q&A pairs written to be QUOTABLE by AI answer engines (Google AI Overviews, ChatGPT, Perplexity) — concise, factual, direct-answer-first. Specific to THIS product.
- rationale: one sentence on what changed and why.
- Output JSON only — no prose.`;

  const shortText = truncate(stripHtml(product.short_description), 600);
  const descText = truncate(stripHtml(product.description), 600);

  const user = `Product context:
Name: ${product.name}
SKU: ${product.sku ?? "(none)"}
Price: ${product.price ?? "(none)"}
URL: ${product.permalink}
Existing short description: ${shortText || "(empty)"}
Existing description: ${descText || "(empty)"}

Return JSON exactly in this shape:
{
  "name": "improved product title (keyword-led, <=60 chars ideal)",
  "meta_title": "<=60 char SEO title",
  "meta_description": "140-160 char meta description",
  "short_description": "1-2 sentence HTML-safe buyer-focused blurb",
  "faq": [{ "q": "...", "a": "..." }],
  "rationale": "one sentence"
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
      max_tokens: 1200,
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

  const faqRaw = Array.isArray(parsed.faq) ? parsed.faq : [];
  const faq = faqRaw
    .map((f) => {
      const obj = f as { q?: unknown; a?: unknown };
      return { q: String(obj?.q ?? "").trim(), a: String(obj?.a ?? "").trim() };
    })
    .filter((f) => f.q && f.a);

  return {
    name: String(parsed.name ?? "").trim(),
    meta_title: String(parsed.meta_title ?? "").trim(),
    meta_description: String(parsed.meta_description ?? "").trim(),
    short_description: String(parsed.short_description ?? "").trim(),
    faq,
    rationale: String(parsed.rationale ?? "").trim(),
  };
}

// ── JSON-LD builder (inline, Product + FAQPage) ───────────────────────────────
function buildJsonLd(
  shopName: string,
  product: { permalink: string; sku: string | null; price: string | null },
  metaDescription: string,
  faq: Array<{ q: string; a: string }>,
): Record<string, unknown> {
  const productNode: Record<string, unknown> = {
    "@type": "Product",
    name: undefined as unknown,
    description: metaDescription,
    url: product.permalink,
    brand: { "@type": "Brand", name: shopName },
  };
  if (product.sku) productNode.sku = product.sku;
  if (product.price) {
    productNode.offers = {
      "@type": "Offer",
      price: product.price,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: product.permalink,
    };
  }

  const graph: Record<string, unknown>[] = [productNode];
  if (faq.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

// ── Best-effort JSON-LD attach via WC product meta_data ───────────────────────
async function attachSchemaMeta(
  creds: WordPressCredentials,
  productId: number,
  schema: unknown,
): Promise<void> {
  try {
    const auth = "Basic " + btoa(`${creds.username}:${creds.app_password}`);
    const base = creds.site_url.replace(/\/+$/, "");
    const res = await fetch(`${base}/wp-json/wc/v3/products/${productId}`, {
      method: "PUT",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        "User-Agent": "RestyleProSEO/1.0",
      },
      body: JSON.stringify({
        meta_data: [{ key: "_restylepro_aeo_schema", value: JSON.stringify(schema) }],
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.warn(`[seo-product-sweep] schema attach ${res.status}: ${txt.slice(0, 200)}`);
    }
  } catch (e) {
    // Best-effort — never fail the apply on schema attach.
    console.warn("[seo-product-sweep] schema attach error", e instanceof Error ? e.message : String(e));
  }
}

// ── Single-product apply (shared by apply + apply_all) ────────────────────────
async function applyOne(
  creds: WordPressCredentials,
  args: {
    product_id: number;
    name?: string;
    meta_title?: string;
    meta_description?: string;
    short_description?: string;
    schema?: unknown;
  },
): Promise<void> {
  await updateWooProductSeoMeta(creds, args.product_id, {
    name: args.name,
    short_description: args.short_description,
    meta: {
      title: args.meta_title ?? args.name,
      description: args.meta_description,
    },
  });
  if (args.schema) {
    await attachSchemaMeta(creds, args.product_id, args.schema);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
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

    // ── analyze (READ-ONLY against the store) ────────────────────────────────
    if (action === "analyze") {
      const limit = Math.min((body?.limit as number) ?? 20, 100);
      const page = (body?.page as number) ?? 1;
      const status = (body?.status as string) ?? "publish";

      const creds = await resolveCreds(ctx, shop_id);

      const { data: shopRow } = await ctx.service
        .from("shops")
        .select("name, tenant_type")
        .eq("id", shop_id)
        .maybeSingle();
      const shopName = shopRow?.name ?? "this shop";

      const allProducts = await listWooProducts(creds, limit, page);
      const products = allProducts.filter((p) => p.status === status);

      const results: Array<Record<string, unknown>> = [];
      // Sequential to avoid hammering Claude; tolerate per-product errors.
      for (const product of products) {
        let rewrite: ProductRewrite | null = null;
        let schema: Record<string, unknown> | null = null;
        let err: string | undefined;

        try {
          rewrite = await rewriteProduct(shopName, product);
          schema = buildJsonLd(
            shopName,
            { permalink: product.permalink, sku: product.sku, price: product.price },
            rewrite.meta_description,
            rewrite.faq,
          );
          // Stamp the resolved product name into the Product node.
          const graph = (schema["@graph"] as Record<string, unknown>[]) ?? [];
          if (graph[0]) graph[0].name = rewrite.name || product.name;
        } catch (e) {
          err = e instanceof Error ? e.message : String(e);
        }

        const existingMeta =
          stripHtml(product.short_description) || stripHtml(product.description) || null;

        // Persist suggestion to seo_pages (NON-FATAL — collect any error).
        if (rewrite) {
          try {
            await ctx.service.from("seo_pages").upsert(
              {
                shop_id,
                url: product.permalink,
                page_type: "product",
                external_platform: "wordpress",
                external_id: String(product.id),
                current_title: product.name,
                current_meta_description: existingMeta,
                ai_suggested_title: rewrite.name || null,
                ai_suggested_meta_description: rewrite.meta_description || null,
                ai_suggested_short_description: rewrite.short_description || null,
                ai_suggested_schema: schema,
                ai_suggested_at: new Date().toISOString(),
              },
              { onConflict: "shop_id,url" },
            );
          } catch (e) {
            const dbErr = e instanceof Error ? e.message : String(e);
            err = err ? `${err}; db: ${dbErr}` : `db: ${dbErr}`;
          }
        }

        results.push({
          product_id: product.id,
          url: product.permalink,
          current: { name: product.name },
          suggested: rewrite
            ? {
                name: rewrite.name,
                meta_title: rewrite.meta_title,
                meta_description: rewrite.meta_description,
                short_description: rewrite.short_description,
                faq: rewrite.faq,
              }
            : null,
          schema,
          rationale: rewrite?.rationale ?? null,
          ...(err ? { error: err } : {}),
        });
      }

      return json({ ok: true, results });
    }

    // ── apply (MUTATES — admin only) ─────────────────────────────────────────
    if (action === "apply") {
      await assertShopAdmin(ctx, shop_id);
      const product_id = Number(body?.product_id);
      if (!product_id || Number.isNaN(product_id)) {
        return json({ error: "product_id required" }, 400);
      }
      const name = (body?.name as string | undefined)?.trim() || undefined;
      const meta_title = (body?.meta_title as string | undefined)?.trim() || undefined;
      const meta_description =
        (body?.meta_description as string | undefined)?.trim() || undefined;
      const short_description =
        (body?.short_description as string | undefined)?.trim() || undefined;
      const schema = body?.schema;

      const creds = await resolveCreds(ctx, shop_id);

      try {
        await applyOne(creds, {
          product_id,
          name,
          meta_title,
          meta_description,
          short_description,
          schema,
        });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : String(e) }, 502);
      }

      // Reflect the applied state into seo_pages (match by external_id, fall
      // back to nothing if no row exists — non-fatal).
      try {
        const update: Record<string, unknown> = { applied_at: new Date().toISOString() };
        if (name) update.current_title = name;
        if (meta_description) update.current_meta_description = meta_description;
        await ctx.service
          .from("seo_pages")
          .update(update)
          .eq("shop_id", shop_id)
          .eq("external_platform", "wordpress")
          .eq("external_id", String(product_id));
      } catch (_) {
        // non-fatal
      }

      return json({
        ok: true,
        product_id,
        applied: { name: name ?? null, meta_description: meta_description ?? null },
      });
    }

    // ── apply_all (MUTATES — admin only) ─────────────────────────────────────
    if (action === "apply_all") {
      await assertShopAdmin(ctx, shop_id);
      const limit = Math.min((body?.limit as number) ?? 50, 200);

      const creds = await resolveCreds(ctx, shop_id);

      const { data: rows, error: rowsErr } = await ctx.service
        .from("seo_pages")
        .select(
          "external_id, url, ai_suggested_title, ai_suggested_meta_description, ai_suggested_short_description, ai_suggested_schema",
        )
        .eq("shop_id", shop_id)
        .eq("page_type", "product")
        .not("ai_suggested_title", "is", null)
        .is("applied_at", null)
        .limit(limit);
      if (rowsErr) {
        return json({ error: rowsErr.message }, 500);
      }

      let applied = 0;
      const errors: Array<{ product_id: string | null; url: string | null; error: string }> = [];

      for (const row of rows ?? []) {
        const product_id = Number(row.external_id);
        if (!product_id || Number.isNaN(product_id)) {
          errors.push({
            product_id: row.external_id ?? null,
            url: row.url ?? null,
            error: "missing or invalid external_id",
          });
          continue;
        }
        try {
          await applyOne(creds, {
            product_id,
            name: row.ai_suggested_title ?? undefined,
            meta_description: row.ai_suggested_meta_description ?? undefined,
            short_description: row.ai_suggested_short_description ?? undefined,
            schema: row.ai_suggested_schema ?? undefined,
          });
          await ctx.service
            .from("seo_pages")
            .update({
              applied_at: new Date().toISOString(),
              current_title: row.ai_suggested_title,
              current_meta_description: row.ai_suggested_meta_description,
            })
            .eq("shop_id", shop_id)
            .eq("external_platform", "wordpress")
            .eq("external_id", String(product_id));
          applied++;
        } catch (e) {
          errors.push({
            product_id: row.external_id ?? null,
            url: row.url ?? null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return json({ ok: true, applied, errors });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-product-sweep] error", msg);
    return json({ error: msg }, 500);
  }
});
