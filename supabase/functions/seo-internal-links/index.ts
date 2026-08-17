/**
 * seo-internal-links — AI-suggested internal links for a blog post.
 *
 * Action: 'suggest'
 *   Body: { shop_id, post_id }
 *   Loads the current post's body_html + focus_keyword, plus all other
 *   seo_blog_posts and seo_pages for the same shop with their titles +
 *   URLs. Asks Claude (claude-sonnet-4-6) for 5-10 internal-link
 *   suggestions: anchor text in the body to link, target URL, and a
 *   short rationale. Persists the array to seo_blog_posts.internal_links
 *   and returns it.
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

interface SuggestionLink {
  anchor: string;
  url: string;
  rationale: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface CandidatePage {
  title: string;
  url: string;
  source: "blog" | "page";
}

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch(CLAUDE_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Claude ${res.status}: ${txt.slice(0, 400)}`);
  }
  const data = await res.json();
  const text =
    data?.content?.find((c: { type: string; text?: string }) => c.type === "text")?.text ?? "";
  return text;
}

function parseSuggestions(raw: string): SuggestionLink[] {
  // Try fenced JSON first, then plain JSON anywhere in the response.
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenced?.[1]) candidates.push(fenced[1]);
  const arrStart = raw.indexOf("[");
  const arrEnd = raw.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    candidates.push(raw.slice(arrStart, arrEnd + 1));
  }
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((s) => s && typeof s === "object")
          .map((s: { anchor?: string; url?: string; rationale?: string }) => ({
            anchor: String(s.anchor ?? "").trim(),
            url: String(s.url ?? "").trim(),
            rationale: String(s.rationale ?? "").trim(),
          }))
          .filter((s) => s.anchor && s.url);
      }
    } catch (_) {
      // try next
    }
  }
  return [];
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

    if (action !== "suggest") {
      return json({ error: `Unknown action: ${action}` }, 400);
    }

    const post_id = body?.post_id as string;
    if (!post_id) return json({ error: "post_id required" }, 400);

    // Load the source post.
    const { data: post, error: postErr } = await ctx.service
      .from("seo_blog_posts")
      .select("id, shop_id, title, focus_keyword, body_html, external_url")
      .eq("id", post_id)
      .maybeSingle();
    if (postErr) return json({ error: postErr.message }, 500);
    if (!post) return json({ error: "Post not found" }, 404);
    if (post.shop_id !== shop_id) {
      return json({ error: "Post does not belong to this shop" }, 403);
    }
    const bodyText = stripHtml(post.body_html ?? "");
    if (bodyText.length < 200) {
      return json(
        { error: "Post body is too short to suggest internal links yet." },
        400,
      );
    }

    // Load candidate targets — other published blog posts + tracked pages.
    const [otherPostsRes, pagesRes] = await Promise.all([
      ctx.service
        .from("seo_blog_posts")
        .select("title, slug, external_url, focus_keyword")
        .eq("shop_id", shop_id)
        .neq("id", post_id)
        .order("updated_at", { ascending: false })
        .limit(60),
      ctx.service
        .from("seo_pages")
        .select("url, current_title, page_type")
        .eq("shop_id", shop_id)
        .eq("is_active", true)
        .limit(80),
    ]);

    if (otherPostsRes.error) return json({ error: otherPostsRes.error.message }, 500);
    if (pagesRes.error) return json({ error: pagesRes.error.message }, 500);

    const candidates: CandidatePage[] = [
      ...(otherPostsRes.data ?? [])
        .filter((p: { external_url?: string | null; slug?: string | null }) => p.external_url || p.slug)
        .map((p: { title: string | null; external_url: string | null; slug: string | null }) => ({
          title: p.title ?? p.slug ?? "(untitled)",
          url: p.external_url ?? `/${p.slug}`,
          source: "blog" as const,
        })),
      ...(pagesRes.data ?? []).map((p: { url: string; current_title: string | null }) => ({
        title: p.current_title ?? p.url,
        url: p.url,
        source: "page" as const,
      })),
    ];

    if (candidates.length === 0) {
      return json({
        ok: true,
        suggestions: [],
        note: "No other posts or tracked pages exist yet — add some to enable internal-link suggestions.",
      });
    }

    const sys = `You are an SEO editor recommending internal links for a blog post on a wrap-shop site. Pick anchor phrases that already appear (verbatim or near-verbatim) in the source body, and link them to the most topically relevant target URL from the candidate list. Prefer commercial/landing pages when buyer intent is strong. Never invent URLs. Output 5-10 suggestions as a JSON array only — no prose.`;

    const candidateList = candidates
      .slice(0, 100)
      .map(
        (c, i) =>
          `${i + 1}. [${c.source}] "${c.title.slice(0, 90)}" — ${c.url}`,
      )
      .join("\n");

    const user = `SOURCE POST
Title: ${post.title}
Focus keyword: ${post.focus_keyword ?? "(none)"}
Live URL: ${post.external_url ?? "(unpublished)"}

BODY (plain text, first 6000 chars):
${bodyText.slice(0, 6000)}

CANDIDATE TARGETS:
${candidateList}

Return JSON only:
[
  {
    "anchor": "exact phrase from the body to wrap in <a>",
    "url": "url copied verbatim from the candidate list",
    "rationale": "one sentence on why this link helps the reader"
  }
]`;

    const raw = await callClaude(sys, user);
    let suggestions = parseSuggestions(raw);

    // Drop suggestions whose anchor isn't actually in the body.
    const lowerBody = bodyText.toLowerCase();
    suggestions = suggestions.filter((s) =>
      s.anchor && lowerBody.includes(s.anchor.toLowerCase()),
    );

    // Drop suggestions whose URL isn't in the candidate set.
    const validUrls = new Set(candidates.map((c) => c.url));
    suggestions = suggestions.filter((s) => validUrls.has(s.url));

    const { error: updateErr } = await ctx.service
      .from("seo_blog_posts")
      .update({ internal_links: suggestions })
      .eq("id", post_id);
    if (updateErr) return json({ error: updateErr.message }, 500);

    return json({ ok: true, suggestions });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-internal-links] error", msg);
    return json({ error: msg }, 500);
  }
});
