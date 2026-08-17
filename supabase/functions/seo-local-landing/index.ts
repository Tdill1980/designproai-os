/**
 * seo-local-landing — Generate programmatic SEO landing pages for
 * {service} × {city} or {vehicle_type} × {city} combinations.
 *
 * The local-SEO move every wrap shop in the country uses to eat city-level
 * SERPs. Each landing page is an authored, human-feeling article — NOT a
 * spammy template — produced by Claude with the city + service + tenant
 * voice baked in.
 *
 * Action: 'generate_batch'
 *   Body: {
 *     shop_id,
 *     service: string,                  // e.g. "Vehicle Wraps", "Color Change Wraps"
 *     vehicle_types?: string[],         // optional: "Sprinter Van", "Box Truck", ...
 *     cities: string[],                 // "Denver, CO", "Boulder, CO", ...
 *     tone?: string,                    // default: "expert, no-fluff, locally rooted"
 *     min_words?: number,               // default: 700
 *     intent?: 'local_landing'          // forced — kept in body for clarity
 *   }
 *
 *   For each combo (every city × every vehicle_type, or just every city if no
 *   vehicle types are provided), Claude generates a full SEO landing page:
 *   title, slug, meta_title, meta_description, body_html, schema_json
 *   (LocalBusiness + Service), keywords[]. A draft seo_blog_posts row is
 *   created with intent='local_landing'. Returns the created list with
 *   per-row stats.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopAdmin } from "../_shared/seo/auth.ts";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface GeneratedPage {
  title: string;
  slug: string;
  meta_title: string;
  meta_description: string;
  body_html: string;
  keywords: string[];
  schema_json: unknown;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function wordCount(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function pickJson(raw: string): Record<string, unknown> {
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

async function generatePage(opts: {
  shopName: string;
  shopWebsite: string | null;
  shopPhone: string | null;
  service: string;
  vehicleType: string | null;
  city: string;
  tone: string;
  minWords: number;
}): Promise<GeneratedPage> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const targetThing = opts.vehicleType
    ? `${opts.vehicleType} ${opts.service}`
    : opts.service;
  const focusKeyword = `${targetThing} ${opts.city}`.toLowerCase();

  const sys = `You write hyper-local SEO landing pages for "${opts.shopName}", a vehicle wrap shop. Tone: ${opts.tone}. Strict rules:
- This is a LANDING PAGE, not a blog post. ${opts.minWords}+ words of substance — no padding.
- Lead with the customer problem in the first 60 words. NO "Welcome to our blog" intros.
- Reference the city by name 4-6 times (specific neighborhoods, landmarks, or local context where natural). Never fabricate facts.
- Use H2s for buyer questions: "How much does ${targetThing} cost in ${opts.city}?", "How long does it take?", "What materials do we use?", "Why local matters", "Get a free quote".
- One H3-level FAQ section with 4-6 schema-friendly Q&A pairs.
- Every section ends with a soft CTA. Never repeat "${opts.shopName}" more than every other paragraph.
- Embed 1-2 relevant internal-link placeholders as <a href="/products/…">anchor text</a> when natural. Don't invent links — leave them generic.
- Output valid HTML body only — no <html>, <head>, <body>, no <h1> (the page title becomes the H1).
- Return JSON only.`;

  const user = `Generate one landing page.

Shop: ${opts.shopName}
${opts.shopWebsite ? `Site: ${opts.shopWebsite}` : ""}
${opts.shopPhone ? `Phone: ${opts.shopPhone}` : ""}

Service: ${opts.service}
${opts.vehicleType ? `Vehicle type: ${opts.vehicleType}` : ""}
City: ${opts.city}
Focus keyword: ${focusKeyword}

Return JSON:
{
  "title": "H1 title (≤70 chars). Lead with the focus keyword.",
  "meta_title": "SEO title (≤60 chars).",
  "meta_description": "140-160 char meta description with a soft CTA.",
  "body_html": "Full landing page body HTML — H2s, H3 FAQ, paragraphs, optional <ul>. ${opts.minWords}+ words.",
  "keywords": ["6-8 supporting keywords as an array of strings"],
  "schema_json": {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "...",
    "areaServed": { "@type": "City", "name": "${opts.city}" },
    "provider": { "@type": "LocalBusiness", "name": "${opts.shopName}" }
  }
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
      max_tokens: 8000,
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
  const parsed = pickJson(raw) as Partial<GeneratedPage>;
  const title = String(parsed.title ?? targetThing).slice(0, 200);
  return {
    title,
    slug: slugify(`${title}-${opts.city}`),
    meta_title: String(parsed.meta_title ?? title).slice(0, 70),
    meta_description: String(parsed.meta_description ?? "").slice(0, 200),
    body_html: String(parsed.body_html ?? ""),
    keywords: Array.isArray(parsed.keywords)
      ? (parsed.keywords as string[]).filter((k) => typeof k === "string").slice(0, 12)
      : [],
    schema_json: parsed.schema_json ?? null,
  };
}

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
    await assertShopAdmin(ctx, shop_id);

    if (action !== "generate_batch") {
      return json({ error: `Unknown action: ${action}` }, 400);
    }

    const service = (body?.service as string)?.trim();
    const vehicleTypes = Array.isArray(body?.vehicle_types)
      ? (body.vehicle_types as string[]).map((s) => s.trim()).filter(Boolean)
      : [];
    const cities = Array.isArray(body?.cities)
      ? (body.cities as string[]).map((s) => s.trim()).filter(Boolean)
      : [];
    const tone = (body?.tone as string) ?? "expert, no-fluff, locally rooted";
    const minWords = (body?.min_words as number) ?? 700;

    if (!service) return json({ error: "service required" }, 400);
    if (cities.length === 0) return json({ error: "cities[] required" }, 400);

    // Cap at 25 combos per request to keep Claude usage and edge runtime
    // within sane bounds. The page can call this multiple times for larger
    // batches.
    const combos: Array<{ vehicleType: string | null; city: string }> = [];
    if (vehicleTypes.length === 0) {
      for (const c of cities) combos.push({ vehicleType: null, city: c });
    } else {
      for (const v of vehicleTypes) {
        for (const c of cities) combos.push({ vehicleType: v, city: c });
      }
    }
    if (combos.length === 0) return json({ error: "No combos to generate" }, 400);
    if (combos.length > 25) {
      return json(
        { error: `Too many combos (${combos.length}). Cap is 25 per call — split your batch.` },
        400,
      );
    }

    const { data: shop } = await ctx.service
      .from("shops")
      .select("name, website, phone")
      .eq("id", shop_id)
      .maybeSingle();
    const shopName = shop?.name ?? "the shop";
    const shopWebsite = shop?.website ?? null;
    const shopPhone = shop?.phone ?? null;

    const created: Array<{
      id?: string;
      title: string;
      slug: string;
      city: string;
      vehicle_type: string | null;
      word_count: number;
      error?: string;
    }> = [];

    for (const combo of combos) {
      try {
        const page = await generatePage({
          shopName,
          shopWebsite,
          shopPhone,
          service,
          vehicleType: combo.vehicleType,
          city: combo.city,
          tone,
          minWords,
        });

        const wc = wordCount(page.body_html);

        // Ensure slug uniqueness by appending a short suffix if needed.
        let slug = page.slug || slugify(`${page.title}-${combo.city}`);
        const { data: existing } = await ctx.service
          .from("seo_blog_posts")
          .select("id")
          .eq("shop_id", shop_id)
          .eq("slug", slug)
          .maybeSingle();
        if (existing) {
          slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
        }

        const insertRow = {
          shop_id,
          title: page.title,
          slug,
          excerpt: page.meta_description.slice(0, 200),
          body_html: page.body_html,
          meta_title: page.meta_title,
          meta_description: page.meta_description,
          focus_keyword: combo.vehicleType
            ? `${combo.vehicleType} ${service} ${combo.city}`.toLowerCase()
            : `${service} ${combo.city}`.toLowerCase(),
          keywords: page.keywords,
          schema_json: page.schema_json,
          intent: "local_landing",
          status: "draft",
          author_name: shopName,
          reading_time_min: Math.max(1, Math.round(wc / 220)),
          created_by: ctx.user.id,
        };

        const { data: inserted, error: insertErr } = await ctx.service
          .from("seo_blog_posts")
          .insert(insertRow)
          .select("id")
          .single();
        if (insertErr) throw new Error(insertErr.message);

        created.push({
          id: inserted.id,
          title: page.title,
          slug,
          city: combo.city,
          vehicle_type: combo.vehicleType,
          word_count: wc,
        });
      } catch (e) {
        created.push({
          title: combo.vehicleType
            ? `${combo.vehicleType} ${service} in ${combo.city}`
            : `${service} in ${combo.city}`,
          slug: "",
          city: combo.city,
          vehicle_type: combo.vehicleType,
          word_count: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return json({
      ok: true,
      generated: created.filter((c) => !c.error).length,
      failed: created.filter((c) => c.error).length,
      results: created,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-local-landing] error", msg);
    return json({ error: msg }, 500);
  }
});
