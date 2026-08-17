/**
 * seo-blog-generate — Claude-powered SEO blog writer.
 *
 * Body:
 *   shop_id: uuid                  — owning shop
 *   topic: string                  — what the post is about (req)
 *   focus_keyword: string          — primary keyword to rank for (req)
 *   secondary_keywords?: string[]  — supporting keywords
 *   intent?: 'informational' | 'comparison' | 'buyer_intent' | 'how_to' | 'local_landing'
 *   target_word_count?: number     — default 1200
 *   tone?: string                  — e.g. "expert but friendly", "no-fluff direct"
 *   internal_link_targets?: Array<{ url: string; anchor_hint: string; description?: string }>
 *   product_context?: Array<{ name: string; url: string; description?: string }>
 *      — for ecomm: products to weave in (PDP/category links)
 *   tenant_brief?: string          — extra context about the brand/voice
 *   draft_post_id?: string         — if updating an existing draft, we save under this id
 *
 * Returns: full post (title, slug, meta, body_html, schema, etc.) and
 *          either creates a new seo_blog_posts row or updates the given one.
 *
 * Uses Claude with prompt caching on the system prompt (brand brief stays
 * cacheable across many posts for the same shop).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopAdmin } from "../_shared/seo/auth.ts";
import { scoreSeo } from "../_shared/seo/seo-scoring.ts";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface GenerateInput {
  shop_id: string;
  topic: string;
  focus_keyword: string;
  secondary_keywords?: string[];
  intent?: string;
  target_word_count?: number;
  tone?: string;
  internal_link_targets?: Array<{ url: string; anchor_hint: string; description?: string }>;
  product_context?: Array<{ name: string; url: string; description?: string }>;
  tenant_brief?: string;
  draft_post_id?: string;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function readingTime(text: string) {
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / 220));
}

function buildSystemPrompt(input: GenerateInput, shopName: string, tenantType: string) {
  const intent = input.intent ?? (tenantType === "ecommerce" ? "buyer_intent" : "informational");

  const ecommExtras = tenantType === "ecommerce"
    ? `
This is an E-COMMERCE site. The blog's job is to drive product page traffic
and conversions. Every post must:
- Open with the customer problem, not generic intro fluff
- Reference relevant products by name with internal links to their pages
- Include a "Recommended Products" section near the bottom with 3-5 product links
- Use buyer-intent language (cost, specs, comparisons, "how to choose") naturally
- End with a clear CTA back to a product or category page`
    : `
This is a LOCAL SERVICE business. The blog's job is to build authority,
rank for local + service keywords, and drive call/quote requests. Every post must:
- Reference the local service area where natural ("if you're in [city]")
- Internally link to relevant /services/ pages and the contact page
- End with a CTA to request a quote or call
- Use Service + LocalBusiness FAQ schema where relevant`;

  return `You are the senior SEO content director AND a hands-on vehicle-wrap
subject-matter expert for ${shopName}. You write long-form, ranking-grade content
that wins on GOOGLE and on ANSWER ENGINES (Google AI Overviews, ChatGPT, Perplexity).
${input.tenant_brief ? `\nBRAND BRIEF:\n${input.tenant_brief}\n` : ""}
Write for readers first, Google second, answer engines always. Satisfy the on-page
SEO checklist: focus keyword in title, H1, meta description, first paragraph and one
H2; semantic variations throughout; clean heading hierarchy (one H1, then H2/H3);
1200-2000 words; an FAQ schema-ready Q&A section.

E-E-A-T (Experience, Expertise, Authoritativeness, Trust) is MANDATORY — it is how
the post earns rankings and AI citations:
- EXPERIENCE: write from first-hand shop-floor experience ("in our bays we see…") —
  what actually happens during install/removal, real failure modes, and edge cases.
- EXPERTISE: use correct industry terms (cast vs calendered vinyl, OEM panels,
  post-heating, knifeless tape, laminate) and explain each plainly the first time.
- AUTHORITY: reference real standards generically (manufacturer install specs,
  warranty terms) WITHOUT inventing numbers, brands, prices, or guarantees.
- TRUST: stay balanced — name the trade-offs and say when an option is NOT worth it.

EDUCATIONAL FRAMING: the post TEACHES. Answer each section's question directly, then
explain the "why" so the reader genuinely understands the decision — never a sales
pitch dressed up as an article.

ANSWER-ENGINE OPTIMIZATION (AEO): structure for extraction —
- body_html MUST OPEN with a "Key Takeaways" box: a <h2>Key Takeaways</h2> followed
  by a <ul> of 3-5 one-sentence, self-contained answer bullets (each makes sense
  quoted on its own, out of context).
- Under every H2, give the direct answer in the first sentence before elaborating.
- Prefer concise factual sentences and comparison <table>s where they aid extraction.
${ecommExtras}

Tone: ${input.tone ?? "expert, direct, plain-English. No filler. No 'in today's fast-paced world' garbage."}
Content intent: ${intent}.

You ALWAYS return a single valid JSON object — no prose before or after,
no markdown code fences. Schema:

{
  "title": "string — 50-60 chars, focus keyword early",
  "slug": "string — kebab-case, 3-6 words, contains focus keyword",
  "meta_title": "string — 50-60 chars, focus keyword + benefit",
  "meta_description": "string — 140-160 chars, benefit + keyword + soft CTA",
  "excerpt": "string — 1-2 sentences, hooks the reader",
  "body_html": "string — clean semantic HTML using <h2>, <h3>, <p>, <ul>, <ol>, <table>, <a>, <strong>, <em>. MUST OPEN with <h2>Key Takeaways</h2> + a <ul> of 3-5 self-contained answer bullets. NO inline styles, NO classes, NO <script>, NO <h1> (the CMS adds it from title)",
  "faq": [{"q": "string", "a": "string"}],
  "author_name": "string — a credible human expert byline for E-E-A-T (e.g. a lead wrap installer or shop owner persona, kept consistent)",
  "schema_json": {/* JSON-LD @graph — Article (with author Person incl. jobTitle, and publisher Organization) + FAQPage when FAQs present */},
  "internal_links": [{"url": "string", "anchor_text": "string", "context": "string"}],
  "keywords": ["string", "string"],
  "design_notes": "string — 1-2 sentences for the editor on what wins this post should add (custom image suggestions, etc.)"
}

Rules:
- Use only the internal_link_targets and product_context the operator provides
  for internal links; do not invent URLs.
- Every internal link in body_html MUST also appear in the internal_links array.
- The first paragraph must include the focus keyword AND state the answer/benefit immediately.
- Headings: ONE post-level H1 will be added by the CMS — do NOT include H1 in body_html.
- FAQ section: include 4-6 question/answer pairs unless the topic genuinely doesn't lend itself to FAQs.
- body_html MUST open with the "Key Takeaways" answer box (required for AEO).
- Demonstrate first-hand experience and name trade-offs; never write a one-sided sales pitch.
- schema_json must include an Article node with author (Person, with jobTitle) and publisher (Organization), plus a FAQPage node when FAQs exist.
- Body length: aim for ${input.target_word_count ?? 1200}-${(input.target_word_count ?? 1200) + 600} words.
- No emojis. No "as an AI". No date references that will go stale.
- No fake stats. Only cite numbers if they're in the brand brief or are obviously industry-known.`;
}

function buildUserPrompt(input: GenerateInput) {
  const linkTargets = (input.internal_link_targets ?? []).map(
    (t) => `- ${t.url}${t.anchor_hint ? ` (anchor hint: ${t.anchor_hint})` : ""}${t.description ? ` — ${t.description}` : ""}`,
  ).join("\n");
  const products = (input.product_context ?? []).map(
    (p) => `- ${p.name} → ${p.url}${p.description ? ` — ${p.description}` : ""}`,
  ).join("\n");

  return `Topic: ${input.topic}
Focus keyword: ${input.focus_keyword}
${input.secondary_keywords?.length ? `Secondary keywords: ${input.secondary_keywords.join(", ")}` : ""}

${linkTargets ? `Internal link targets (use freely where natural):\n${linkTargets}` : "No internal link targets provided."}

${products ? `Products to weave in:\n${products}` : ""}

Write the post now. Return JSON only.`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    const input = (await req.json()) as GenerateInput;
    if (!input.shop_id || !input.topic || !input.focus_keyword) {
      return json({ error: "shop_id, topic, focus_keyword required" }, 400);
    }
    await assertShopAdmin(ctx, input.shop_id);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: shop } = await ctx.db
      .from("shops")
      .select("name, tenant_type")
      .eq("id", input.shop_id)
      .maybeSingle();
    const shopName = shop?.name ?? "the brand";
    const tenantType = shop?.tenant_type ?? "local_service";

    const systemPrompt = buildSystemPrompt(input, shopName, tenantType);
    const userPrompt = buildUserPrompt(input);

    const claudeRes = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      const txt = await claudeRes.text().catch(() => "");
      return json({ error: `Claude error ${claudeRes.status}: ${txt.slice(0, 500)}` }, 502);
    }

    const claudeData = await claudeRes.json();
    const text = claudeData?.content?.find((c: { type: string; text?: string }) => c.type === "text")?.text ?? "";

    let parsed: Record<string, unknown>;
    try {
      const jsonStr = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      return json(
        {
          error: "Claude returned non-JSON",
          raw: text.slice(0, 2000),
          parse_error: e instanceof Error ? e.message : String(e),
        },
        502,
      );
    }

    // Score the generated content
    const bodyHtml = String(parsed.body_html ?? "");
    const bodyText = bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
    const internalLinkCount = (bodyHtml.match(/<a[^>]+href=["'](?:\/|\.\.?\/)/gi) ?? []).length;
    const externalLinkCount = (bodyHtml.match(/<a[^>]+href=["']https?:\/\//gi) ?? []).length;
    const h1Count = (bodyHtml.match(/<h1[^>]*>/gi) ?? []).length;

    const { score, findings } = scoreSeo({
      title: String(parsed.title ?? ""),
      metaTitle: String(parsed.meta_title ?? parsed.title ?? ""),
      metaDescription: String(parsed.meta_description ?? ""),
      focusKeyword: input.focus_keyword,
      bodyText,
      wordCount,
      internalLinkCount,
      externalLinkCount,
      hasH1: h1Count === 0, // body shouldn't have H1; scoring assumes CMS adds one — treat as good
      h1Count: 1,
      hasSchema: !!parsed.schema_json,
      hasOpenGraph: true,
      hasCanonical: true,
      totalImages: 0,
      imagesWithoutAlt: 0,
    });

    const slug = String(parsed.slug ?? slugify(String(parsed.title ?? input.topic)));

    const row = {
      shop_id: input.shop_id,
      title: String(parsed.title ?? ""),
      slug,
      excerpt: String(parsed.excerpt ?? ""),
      body_html: bodyHtml,
      meta_title: String(parsed.meta_title ?? parsed.title ?? ""),
      meta_description: String(parsed.meta_description ?? ""),
      author_name: String(parsed.author_name ?? "").trim() || null,
      focus_keyword: input.focus_keyword,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      schema_json: parsed.schema_json ?? null,
      internal_links: Array.isArray(parsed.internal_links) ? parsed.internal_links : [],
      intent: input.intent ?? (tenantType === "ecommerce" ? "buyer_intent" : "informational"),
      reading_time_min: readingTime(bodyText),
      seo_score: score,
      seo_findings: findings,
      status: "draft",
      created_by: ctx.user.id,
    };

    let result;
    if (input.draft_post_id) {
      const { data, error } = await ctx.service
        .from("seo_blog_posts")
        .update(row)
        .eq("id", input.draft_post_id)
        .eq("shop_id", input.shop_id)
        .select()
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      result = data;
    } else {
      const { data, error } = await ctx.service
        .from("seo_blog_posts")
        .insert(row)
        .select()
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      result = data;
    }

    return json({
      ok: true,
      post: result,
      score,
      findings,
      faq: parsed.faq ?? [],
      design_notes: parsed.design_notes ?? "",
      usage: claudeData.usage,
    });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-blog-generate] error", msg);
    return json({ error: msg }, 500);
  }
});
