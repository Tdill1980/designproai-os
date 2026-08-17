/**
 * social-engage-sweep — SocialIQ Engage ingest (docs/SOCIALIQ_SPEC.md).
 *
 * Pulls COMMENTS on our published posts (agent_social_posts, status 'posted')
 * into social_interactions, and drafts an organic-voiced suggested reply for
 * the ones worth answering. WPW account first: sweeps brand 'weprintwraps'
 * unless a body {brand} says otherwise. A human sends every reply from the
 * /admin/social-iq inbox — this function never posts anything outward.
 *
 * Modes (POST JSON):
 *   { }                          — sweep WPW posts (cron default)
 *   { "brand": "weprintwraps" }  — sweep a specific brand
 *   { "days": 14 }               — look-back window (default 30)
 *
 * Credentials: tenant_site_connections 'meta_facebook' via
 * CONTENT_DEPLOY_SHOP_MAP — same store as content-deploy. Reading IG
 * comments needs instagram_manage_comments; FB needs pages_read_user_content.
 * A post whose comments 403 is reported per-post (needs_permission), never
 * fatal — the sweep stays honest about what Meta hasn't granted yet.
 *
 * Suggested replies come from OPENAI_API_KEY + the brand's voice
 * (_shared/brand-os.ts loadBrandBlock — DB-editable, no deploy). Suggestions
 * are DRAFTS stored on the row; missing key = comments still ingest, just
 * without suggestions.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { loadBrandBlock } from "../_shared/brand-os.ts";

const GRAPH = "https://graph.facebook.com/v19.0";
const OPENAI_MODEL = "gpt-4o";
const POST_LIMIT = 25;
const SUGGEST_LIMIT = 15; // AI-draft at most this many new comments per run

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

interface FBConfig {
  page_id: string;
  page_access_token: string;
  ig_business_id?: string | null;
}

// deno-lint-ignore no-explicit-any
async function loadMetaConfig(db: any, brand: string): Promise<FBConfig> {
  let shopId: string | undefined;
  const mapRaw = Deno.env.get("CONTENT_DEPLOY_SHOP_MAP");
  if (mapRaw) {
    try {
      shopId = JSON.parse(mapRaw)[brand];
    } catch {
      throw new Error("CONTENT_DEPLOY_SHOP_MAP is not valid JSON");
    }
  }
  shopId = shopId || Deno.env.get("CONTENT_DEPLOY_SHOP_ID") || undefined;

  let q = db
    .from("tenant_site_connections")
    .select("shop_id, config")
    .eq("platform", "meta_facebook")
    .eq("is_active", true);
  if (shopId) q = q.eq("shop_id", shopId);
  const { data, error } = await q;
  if (error) throw new Error(`Meta connection lookup failed: ${error.message}`);
  if (!data?.length) throw new Error(`No active meta_facebook connection for brand '${brand}'`);
  if (data.length > 1) {
    throw new Error("Multiple active meta_facebook connections — set CONTENT_DEPLOY_SHOP_MAP");
  }
  const cfg = data[0].config as FBConfig;
  if (!cfg?.page_id || !cfg?.page_access_token) throw new Error("Meta connection has no Page selected");
  return cfg;
}

async function graphGet(path: string, token: string): Promise<Record<string, unknown>> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  const body = await res.json();
  if (!res.ok) {
    const err = new Error((body?.error?.message as string) || `Graph ${res.status}`);
    // deno-lint-ignore no-explicit-any
    (err as any).graphCode = body?.error?.code;
    throw err;
  }
  return body;
}

interface RawComment {
  id: string;
  text: string;
  authorName: string | null;
  authorHandle: string | null;
  createdAt: string | null;
}

async function fetchComments(platform: string, externalPostId: string, token: string, pageId: string): Promise<RawComment[]> {
  const isIG = platform.includes("instagram") || platform === "ig";
  const body = isIG
    ? await graphGet(`${externalPostId}/comments?fields=id,text,username,timestamp&limit=50`, token)
    : await graphGet(`${externalPostId}/comments?fields=id,message,from,created_time&limit=50&filter=toplevel`, token);
  const rows = (body.data as Array<Record<string, unknown>>) || [];
  return rows
    .map((c) => ({
      id: c.id as string,
      text: ((c.text ?? c.message) as string) || "",
      // deno-lint-ignore no-explicit-any
      authorName: ((c as any).from?.name as string) ?? null,
      authorHandle: (c.username as string) ?? null,
      createdAt: ((c.timestamp ?? c.created_time) as string) ?? null,
      // deno-lint-ignore no-explicit-any
      fromId: (c as any).from?.id as string | undefined,
    }))
    // Never suggest replies to our own page's comments.
    .filter((c) => c.text && (c as { fromId?: string }).fromId !== pageId);
}

interface ReplyRule {
  id: string;
  name: string;
  trigger_words: string[];
  template: string;
  auto_send: boolean;
}

/**
 * Klaviyo-style trigger-word capture (docs/SOCIALIQ_SPEC.md): match the
 * comment against the brand's human-authored rules. Matched rule beats the
 * AI suggestion; auto_send additionally sends it immediately (the owner
 * opted that rule in — templates are human-written, never AI).
 */
function matchRule(rules: ReplyRule[], text: string): ReplyRule | null {
  const t = text.toLowerCase();
  for (const r of rules) {
    if ((r.trigger_words || []).some((w) => w && t.includes(w.toLowerCase()))) return r;
  }
  return null;
}

function renderTemplate(template: string, comment: RawComment, captureUrl: string): string {
  return template
    .replaceAll("{{capture_url}}", captureUrl)
    .replaceAll("{{handle}}", comment.authorHandle ? `@${comment.authorHandle}` : (comment.authorName || "there"));
}

function buildCaptureUrl(brand: string, platform: string, externalPostId: string, handle: string | null): string {
  const base = Deno.env.get("SOCIAL_CAPTURE_BASE") || "https://www.restyleproai.com/social/join";
  const q = new URLSearchParams({ b: brand, pl: platform, p: externalPostId });
  if (handle) q.set("h", handle);
  return `${base}?${q.toString()}`;
}

/** Worth a reply draft? Questions and buying signals first; skip bare emoji. */
function isRelevant(text: string): { relevant: boolean; question: boolean } {
  const t = text.trim();
  const question = t.includes("?") ||
    /\b(how much|price|pricing|cost|quote|how do|can you|do you|where|ship|turnaround|install)\b/i.test(t);
  const substantive = /[a-zA-Z]{3,}/.test(t);
  return { relevant: question || substantive, question };
}

async function suggestReply(openaiKey: string, brandVoice: string, postCaption: string, comment: RawComment): Promise<string | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content: `You draft replies to social media comments for this brand. Voice:\n${brandVoice}\n\nRules: sound like a real person on the team, not a corporation. 1-2 short sentences, casual, warm, specific to what they said. No hashtags, no em-dashes, at most one emoji. If they ask about price or getting their own wrap, invite them to grab a quick quote at weprintwraps.com. Never promise a specific price or turnaround. Output ONLY the reply text.`,
        },
        {
          role: "user",
          content: `Our post: "${postCaption.slice(0, 300)}"\n${comment.authorHandle || comment.authorName || "Someone"} commented: "${comment.text.slice(0, 400)}"`,
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
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const brand = (body.brand as string) || "weprintwraps";
    const days = Math.min(Number(body.days) || 30, 90);
    const db = createExternalClient();

    const { data: posts, error } = await db
      .from("agent_social_posts")
      .select("id, brand, platform, caption, published_post_id")
      .eq("status", "posted")
      .eq("brand", brand)
      .not("published_post_id", "is", null)
      .gte("posted_date", new Date(Date.now() - days * 86400_000).toISOString())
      .order("posted_date", { ascending: false })
      .limit(POST_LIMIT);
    if (error) throw new Error(`post lookup failed: ${error.message}`);

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const brandVoice = openaiKey ? await loadBrandBlock(brand) : "";

    const { data: ruleRows } = await db
      .from("social_reply_rules")
      .select("id, name, trigger_words, template, auto_send")
      .eq("brand", brand)
      .eq("active", true);
    const rules = (ruleRows || []) as ReplyRule[];

    let ingested = 0;
    let suggested = 0;
    let autoSent = 0;
    const perPost: Array<Record<string, unknown>> = [];

    // ── OUR OWN PLATFORM FIRST (WrapFeed) — zero Meta, zero scopes. ──
    // Native comments were already mirrored into social_interactions by the
    // DB trigger; here they get the same rules + AI treatment as any channel.
    const { data: nativeRows } = await db
      .from("social_interactions")
      .select("id, external_post_id, external_comment_id, author_name, text")
      .eq("brand", brand)
      .eq("platform", "wrapfeed")
      .eq("status", "new")
      .is("suggested_reply", null)
      .limit(50);
    for (const n of nativeRows || []) {
      const comment: RawComment = {
        id: n.external_comment_id,
        text: n.text || "",
        authorName: n.author_name,
        authorHandle: null,
        createdAt: null,
      };
      const rule = matchRule(rules, comment.text);
      const nowIso = new Date().toISOString();
      if (rule) {
        const captureUrl = buildCaptureUrl(brand, "wrapfeed", n.external_post_id, null);
        const replyText = renderTemplate(rule.template, comment, captureUrl);
        if (rule.auto_send) {
          const { error: repErr } = await db.from("social_feed_comments").insert({
            post_id: n.external_post_id,
            author_id: null,
            author_name: "WePrintWraps",
            text: replyText,
            is_brand: true,
          });
          if (!repErr) {
            await db.from("social_interactions").update({
              status: "replied", replied_text: replyText, replied_at: nowIso,
              suggested_reply: replyText, updated_at: nowIso,
            }).eq("id", n.id);
            autoSent++;
            continue;
          }
        }
        await db.from("social_interactions")
          .update({ suggested_reply: replyText, updated_at: nowIso }).eq("id", n.id);
        suggested++;
      } else if (openaiKey && isRelevant(comment.text).relevant && suggested < SUGGEST_LIMIT) {
        const draft = await suggestReply(openaiKey, brandVoice, "", comment);
        if (draft) {
          await db.from("social_interactions")
            .update({ suggested_reply: draft, updated_at: nowIso }).eq("id", n.id);
          suggested++;
        }
      }
    }

    // ── META (rented ground) — a missing connection must not block our own
    // platform's pass above. ──
    let cfg: FBConfig;
    try {
      cfg = await loadMetaConfig(db, brand);
    } catch (e) {
      return json({
        success: true, brand, posts: 0, ingested, suggested, autoSent,
        meta_skipped: (e as Error).message, perPost,
      });
    }

    for (const post of posts || []) {
      try {
        const comments = await fetchComments(post.platform || "", post.published_post_id, cfg.page_access_token, cfg.page_id);
        for (const c of comments) {
          const { relevant, question } = isRelevant(c.text);
          const { data: upserted, error: upErr } = await db
            .from("social_interactions")
            .upsert(
              {
                brand,
                platform: post.platform,
                post_id: post.id,
                external_post_id: post.published_post_id,
                external_comment_id: c.id,
                author_name: c.authorName,
                author_handle: c.authorHandle,
                text: c.text,
                comment_created_at: c.createdAt,
                is_question: question,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "external_comment_id", ignoreDuplicates: false },
            )
            .select("id, suggested_reply, status")
            .single();
          if (upErr) throw new Error(`interaction upsert failed: ${upErr.message}`);
          ingested++;

          if (upserted && upserted.status === "new") {
            // Trigger-word rules beat the AI suggestion — the capture loop
            // is the point. Auto-send only when the owner flipped that rule.
            const rule = matchRule(rules, c.text);
            if (rule) {
              const captureUrl = buildCaptureUrl(brand, post.platform || "", post.published_post_id, c.authorHandle);
              const replyText = renderTemplate(rule.template, c, captureUrl);
              if (rule.auto_send) {
                try {
                  const igComment = (post.platform || "").toLowerCase().includes("instagram");
                  const path = igComment ? `${c.id}/replies` : `${c.id}/comments`;
                  const form = new URLSearchParams({ message: replyText, access_token: cfg.page_access_token });
                  const sendRes = await fetch(`${GRAPH}/${path}`, { method: "POST", body: form });
                  if (!sendRes.ok) throw new Error(`Graph ${sendRes.status}`);
                  await db.from("social_interactions").update({
                    status: "replied",
                    replied_text: replyText,
                    replied_at: new Date().toISOString(),
                    suggested_reply: replyText,
                    updated_at: new Date().toISOString(),
                  }).eq("id", upserted.id);
                  autoSent++;
                } catch {
                  // Scope missing or Graph refusal — degrade to a suggestion.
                  await db.from("social_interactions").update({
                    suggested_reply: replyText,
                    updated_at: new Date().toISOString(),
                  }).eq("id", upserted.id);
                  suggested++;
                }
              } else if (!upserted.suggested_reply) {
                await db.from("social_interactions").update({
                  suggested_reply: replyText,
                  updated_at: new Date().toISOString(),
                }).eq("id", upserted.id);
                suggested++;
              }
            } else if (openaiKey && relevant && suggested < SUGGEST_LIMIT && !upserted.suggested_reply) {
              const draft = await suggestReply(openaiKey, brandVoice, post.caption || "", c);
              if (draft) {
                await db
                  .from("social_interactions")
                  .update({ suggested_reply: draft, updated_at: new Date().toISOString() })
                  .eq("id", upserted.id);
                suggested++;
              }
            }
          }
        }
        perPost.push({ post_id: post.id, ok: true, comments: comments.length });
      } catch (e) {
        // deno-lint-ignore no-explicit-any
        const code = (e as any).graphCode;
        perPost.push({
          post_id: post.id,
          ok: false,
          needs_permission: code === 10 || code === 200 || code === 3,
          error: (e as Error).message,
        });
      }
    }

    return json({ success: true, brand, posts: (posts || []).length, ingested, suggested, autoSent, perPost });
  } catch (e) {
    console.error("social-engage-sweep error:", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
