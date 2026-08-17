/**
 * social-engage-act — SocialIQ Engage actions (docs/SOCIALIQ_SPEC.md).
 *
 * The ONE outbound path for the /admin/social-iq inbox: a signed-in admin
 * clicked Send/Like/Dismiss on a specific comment. Executes the Graph call
 * and updates the social_interactions row in the same place so they can't
 * drift apart. The reply text is whatever the human approved in the box —
 * this function never composes anything.
 *
 * POST JSON: { interaction_id, action: "reply"|"like"|"dismiss", text? }
 *
 * WPW FIRST: acts only for brand 'weprintwraps' until other brands' Meta
 * connections + review scopes are in place (SOCIAL_ENGAGE_BRANDS secret
 * widens it later without a deploy: comma-separated brand list).
 *
 * Graph reality: replying needs instagram_manage_comments (IG) /
 * pages_manage_engagement (FB). Liking a comment is FB-only — the IG API
 * has no comment-like endpoint, and the UI hides the button there.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { createExternalClient } from "../_shared/external-db.ts";

const GRAPH = "https://graph.facebook.com/v19.0";

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

async function graphPost(path: string, token: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const form = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error((body?.error?.message as string) || `Graph ${res.status}`);
  return body;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = await requireUserOrServiceRole(req);
  if (denied) return denied;

  try {
    const { interaction_id, action, text } = await req.json();
    if (!interaction_id || !action) throw new Error("interaction_id and action are required");

    const db = createExternalClient();
    const { data: row, error } = await db
      .from("social_interactions")
      .select("id, brand, platform, external_comment_id, status")
      .eq("id", interaction_id)
      .single();
    if (error || !row) throw new Error("interaction not found");

    const allowed = (Deno.env.get("SOCIAL_ENGAGE_BRANDS") || "weprintwraps")
      .split(",").map((b) => b.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes((row.brand || "").toLowerCase())) {
      throw new Error(`Engage is enabled for ${allowed.join(", ")} only (brand '${row.brand}')`);
    }

    const now = new Date().toISOString();

    if (action === "dismiss") {
      await db.from("social_interactions").update({ status: "dismissed", updated_at: now }).eq("id", row.id);
      return json({ success: true, action });
    }

    // OUR OWN platform (WrapFeed) — no Meta, no scopes: the brand reply is
    // a first-party comment row, the like is a flag. The comment-insert
    // trigger's fanout ignores brand comments, so no echo loop.
    if ((row.platform || "").toLowerCase() === "wrapfeed") {
      const { data: mirror } = await db
        .from("social_feed_comments")
        .select("id, post_id")
        .eq("id", row.external_comment_id)
        .single();
      if (!mirror) throw new Error("feed comment not found");
      if (action === "reply") {
        const replyText = (text || "").trim();
        if (!replyText) throw new Error("reply text is required");
        const { error: repErr } = await db.from("social_feed_comments").insert({
          post_id: mirror.post_id,
          author_id: null,
          author_name: "WePrintWraps",
          text: replyText,
          is_brand: true,
        });
        if (repErr) throw new Error(`feed reply failed: ${repErr.message}`);
        await db.from("social_interactions")
          .update({ status: "replied", replied_text: replyText, replied_at: now, updated_at: now })
          .eq("id", row.id);
        return json({ success: true, action, platform: "wrapfeed" });
      }
      if (action === "like") {
        await db.from("social_feed_comments").update({ brand_liked: true }).eq("id", mirror.id);
        await db.from("social_interactions").update({ liked: true, liked_at: now, updated_at: now }).eq("id", row.id);
        return json({ success: true, action, platform: "wrapfeed" });
      }
      throw new Error(`unknown action '${action}'`);
    }

    const cfg = await loadMetaConfig(db, row.brand);
    const isIG = (row.platform || "").toLowerCase().includes("instagram") || row.platform === "ig";

    if (action === "reply") {
      const replyText = (text || "").trim();
      if (!replyText) throw new Error("reply text is required");
      // Same endpoint shape both platforms: POST /{comment-id}/replies (IG)
      // vs /{comment-id}/comments (FB).
      const path = isIG
        ? `${row.external_comment_id}/replies`
        : `${row.external_comment_id}/comments`;
      const result = await graphPost(path, cfg.page_access_token, { message: replyText });
      await db
        .from("social_interactions")
        .update({ status: "replied", replied_text: replyText, replied_at: now, updated_at: now })
        .eq("id", row.id);
      return json({ success: true, action, external_reply_id: result.id ?? null });
    }

    if (action === "like") {
      if (isIG) throw new Error("The Instagram API does not support liking comments — reply instead");
      await graphPost(`${row.external_comment_id}/likes`, cfg.page_access_token, {});
      await db
        .from("social_interactions")
        .update({ liked: true, liked_at: now, updated_at: now })
        .eq("id", row.id);
      return json({ success: true, action });
    }

    throw new Error(`unknown action '${action}'`);
  } catch (e) {
    console.error("social-engage-act error:", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
