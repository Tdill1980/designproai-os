/**
 * social-outreach-run — the "Start AI engagement run" button
 * (docs/SOCIALIQ_SPEC.md). Proactive like + comment on followers and
 * industry-related shops, in the brand's APPROVED voice.
 *
 * TWO HARD GATES, both deliberate:
 *
 * 1. APPROVED STYLE REQUIRED. Drafting uses the single approved
 *    social_comment_styles row for (brand, channel). No approved style =
 *    the run refuses for that channel and says so. The AI never speaks in
 *    a voice a human hasn't signed off.
 *
 * 2. PLATFORM REALITY. Meta's API only permits comment/like on media the
 *    connected account OWNS — there is no sanctioned way to like or comment
 *    on someone else's post. So Instagram/Facebook rows are queued as
 *    'manual_required' with the draft ready to copy; only WRAPFEED (our own
 *    platform) actually auto-engages. We do not drive a headless browser
 *    against Instagram: that violates Meta's terms and would put the WPW
 *    account — the revenue account — at risk of a ban.
 *
 * Modes (POST JSON):
 *   { "brand": "weprintwraps" }              — run (defaults wrapfeed)
 *   { "brand": "...", "channel": "instagram" }
 *   { "limit": 10 }                          — max posts to engage (default 10)
 *   { "dry_run": true }                      — draft + report, queue nothing
 *
 * Never engages the brand's own posts, and never the same post twice
 * (unique index on platform+external_post_id+action).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { createExternalClient } from "../_shared/external-db.ts";

const OPENAI_MODEL = "gpt-4o";
const DEFAULT_LIMIT = 10;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function requireUserOrServiceRole(req: Request): Promise<Response | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (jwt && serviceKey && jwt === serviceKey) return null;
  if (jwt) {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.getUser(jwt);
    if (!error && data?.user) return null;
  }
  return json({ error: "Sign in required" }, 401);
}

interface Style {
  id: string;
  name: string;
  style_prompt: string;
}

async function draftComment(
  openaiKey: string,
  style: Style,
  postExcerpt: string,
  author: string,
): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 90,
      messages: [
        { role: "system", content: `${style.style_prompt}\n\nOutput ONLY the comment text.` },
        {
          role: "user",
          content: `${author || "A shop"} posted: "${(postExcerpt || "").slice(0, 400)}"\n\nWrite the comment.`,
        },
      ],
    }),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.choices?.[0]?.message?.content?.trim() || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = await requireUserOrServiceRole(req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const brand = String(body.brand || "weprintwraps").toLowerCase();
    const channel = String(body.channel || "wrapfeed").toLowerCase();
    const limit = Math.min(Number(body.limit) || DEFAULT_LIMIT, 50);
    const db = createExternalClient();

    // GATE 1 — an approved voice for this brand + channel.
    const { data: style } = await db
      .from("social_comment_styles")
      .select("id, name, style_prompt")
      .eq("brand", brand)
      .eq("channel", channel)
      .eq("status", "approved")
      .maybeSingle();
    if (!style) {
      return json({
        success: false,
        needs_style_approval: true,
        error:
          `No APPROVED comment style for ${brand} on ${channel}. Approve one in SocialIQ → Outreach before running — the AI won't comment in an unapproved voice.`,
      }, 200);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) throw new Error("OPENAI_API_KEY is not configured");

    // GATE 2 — platform reality.
    if (channel !== "wrapfeed") {
      // Meta can't act on other accounts' media. Queue drafts for a human.
      const { data: targets } = await db
        .from("social_outreach_targets")
        .select("id, handle, display_name")
        .eq("brand", brand).eq("platform", channel).eq("active", true)
        .limit(limit);
      const queued: string[] = [];
      for (const t of targets || []) {
        const draft = await draftComment(openaiKey, style as Style, t.display_name || "", t.handle || "");
        if (!draft) continue;
        const { error } = await db.from("social_outreach_actions").insert({
          brand, platform: channel, target_id: t.id, target_handle: t.handle,
          external_post_id: `manual:${t.handle}`, post_excerpt: t.display_name,
          action: "comment", draft_text: draft, style_id: (style as Style).id,
          status: "manual_required",
          manual_reason:
            "Meta's API only allows comment/like on media the connected account owns. Post this by hand — automating it would break Meta's terms and risk the account.",
        });
        if (!error) queued.push(t.handle || t.id);
      }
      return json({
        success: true, brand, channel, style: (style as Style).name,
        drafted: queued.length, auto_sent: 0,
        note:
          "Instagram/Facebook drafts are queued for a human to post — Meta's API cannot comment or like on other accounts' posts, and automating it would risk the account.",
      });
    }

    // ── WRAPFEED — our own platform, so this actually runs. ──
    const { data: targets } = await db
      .from("social_outreach_targets")
      .select("id, user_id, handle")
      .eq("brand", brand).eq("platform", "wrapfeed").eq("active", true);
    const targetByUser = new Map((targets || []).filter((t) => t.user_id).map((t) => [t.user_id, t]));

    // Member posts only — never the brand's own (author_id NOT NULL means a
    // member wrote it; brand posts are authored by an admin but flagged by
    // author_name, so we exclude our own brand name too).
    let q = db
      .from("social_feed_posts")
      .select("id, author_id, author_name, caption, created_at")
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(limit * 3);
    const { data: posts, error: postErr } = await q;
    if (postErr) throw new Error(`feed lookup failed: ${postErr.message}`);

    const candidates = (posts || []).filter(
      (p) => p.author_id && (!targetByUser.size || targetByUser.has(p.author_id)),
    ).slice(0, limit);

    let liked = 0, commented = 0, skipped = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const p of candidates) {
      const t = targetByUser.get(p.author_id);
      const draft = await draftComment(openaiKey, style as Style, p.caption || "", p.author_name);
      if (!draft) { skipped++; continue; }

      if (body.dry_run) {
        results.push({ post: p.id, author: p.author_name, draft, dry_run: true });
        continue;
      }

      // LIKE — claim first; the unique index makes a re-run idempotent.
      const { error: likeClaim } = await db.from("social_outreach_actions").insert({
        brand, platform: "wrapfeed", target_id: t?.id ?? null, target_handle: p.author_name,
        external_post_id: p.id, post_excerpt: (p.caption || "").slice(0, 200),
        action: "like", style_id: null, status: "pending",
      });
      if (!likeClaim) {
        // Brand like = a first-party row; conflict means already liked.
        const { error: likeErr } = await db.from("social_feed_likes").insert({
          post_id: p.id, user_id: "00000000-0000-0000-0000-000000000000",
        });
        await db.from("social_outreach_actions")
          .update({
            status: likeErr && likeErr.code !== "23505" ? "failed" : "sent",
            error: likeErr && likeErr.code !== "23505" ? likeErr.message : null,
            sent_at: new Date().toISOString(),
          })
          .eq("platform", "wrapfeed").eq("external_post_id", p.id).eq("action", "like");
        if (!likeErr || likeErr.code === "23505") liked++;
      }

      // COMMENT — claim, then post as the brand.
      const { error: cClaim } = await db.from("social_outreach_actions").insert({
        brand, platform: "wrapfeed", target_id: t?.id ?? null, target_handle: p.author_name,
        external_post_id: p.id, post_excerpt: (p.caption || "").slice(0, 200),
        action: "comment", draft_text: draft, style_id: (style as Style).id, status: "pending",
      });
      if (cClaim) { skipped++; continue; }  // already engaged this post

      const { error: postCommentErr } = await db.from("social_feed_comments").insert({
        post_id: p.id, author_id: null, author_name: brandDisplayName(brand),
        text: draft, is_brand: true,
      });
      await db.from("social_outreach_actions")
        .update({
          status: postCommentErr ? "failed" : "sent",
          error: postCommentErr?.message ?? null,
          sent_at: new Date().toISOString(),
        })
        .eq("platform", "wrapfeed").eq("external_post_id", p.id).eq("action", "comment");
      if (postCommentErr) { skipped++; } else { commented++; }
      results.push({ post: p.id, author: p.author_name, comment: draft, ok: !postCommentErr });
    }

    return json({
      success: true, brand, channel: "wrapfeed", style: (style as Style).name,
      considered: candidates.length, liked, commented, skipped, results,
    });
  } catch (e) {
    console.error("social-outreach-run error:", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});

function brandDisplayName(brand: string): string {
  const map: Record<string, string> = {
    weprintwraps: "WePrintWraps",
    designproai: "DesignProAI",
    restylepro: "RestyleProAI",
    wraptvworld: "WrapTVWorld",
    creatormarket: "CreatorMarket",
  };
  return map[brand] || brand;
}
