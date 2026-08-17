/**
 * bti-episode-pack — every Behind the Install™ approval recruits the world
 * (owner spec, Trish 2026-08-04; framework in _shared/bti-movement.ts).
 *
 * Fired automatically when a WrapTVWorld BTI episode is approved in the
 * Content Director (DB trigger queue_bti_pack_on_approval → pg_net), or
 * manually with a body. Generates the full cross-channel recruitment pack
 * as DRAFTS in the existing queues — every asset carries the five movement
 * blocks (what / why / invite / link / showroom):
 *
 *   agent_social_posts (status 'draft' → Content Director queue):
 *     instagram · facebook · linkedin · x · threads · youtube description ·
 *     instagram story script · master blog article (platform 'blog')
 *   agent_email_campaigns (status 'needs_review' → same queue):
 *     announcement email (approve → Klaviyo draft, existing flow)
 *
 * The WrapTVWorld WEBSITE post needs nothing here — the existing
 * publish_approved_wraptv_video trigger already pushes the approved episode
 * to wraptv_site_content. Push notifications: no customer push infra
 * exists; deliberately not faked.
 *
 * NOTHING here publishes. Drafts land in the Director queue and the human
 * gate stays the gate (AUTO channels ship on approve; DRAFT channels are
 * posted natively). Idempotent per episode via
 * generation_meta.bti_pack_source — re-approving an episode won't duplicate
 * its pack unless {force:true}.
 *
 * POST JSON:
 *   { "post_id": "<agent_social_posts uuid>" }   — from the trigger
 *   { "title": "...", "episode_url": "..." }     — manual/launch pack
 *   { ..., "force": true }                       — regenerate
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { BTI_BRAND, buildBtiEmail, buildBtiSocialPack } from "../_shared/bti-movement.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const denied = await requireUserOrServiceRole(req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const db = createExternalClient();

    let title: string = body.title || "";
    let episodeUrl: string | null = body.episode_url || null;
    let sourceKey: string = body.post_id || "";

    if (body.post_id) {
      const { data: ep, error } = await db
        .from("agent_social_posts")
        .select("id, brand, caption, media_urls")
        .eq("id", body.post_id)
        .single();
      if (error || !ep) throw new Error("episode post not found");
      if ((ep.brand || "").toLowerCase() !== BTI_BRAND) {
        throw new Error(`post ${body.post_id} is brand '${ep.brand}', not ${BTI_BRAND}`);
      }
      title = title || (ep.caption || "Behind the Install").split("\n")[0].slice(0, 120);
      episodeUrl = episodeUrl || ep.media_urls?.[0] || null;
    } else {
      if (!title) throw new Error("post_id or title required");
      sourceKey = `manual:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`;
    }

    // Idempotency: one pack per episode unless forced.
    if (!body.force) {
      const { data: existing } = await db
        .from("agent_social_posts")
        .select("id")
        .eq("generation_meta->>bti_pack_source", sourceKey)
        .limit(1);
      if (existing?.length) {
        return json({ success: true, skipped: "pack already generated for this episode", sourceKey });
      }
    }

    const ep = { title, episodeUrl };
    const social = buildBtiSocialPack(ep);
    const now = new Date().toISOString();

    const rows = social.map((item) => ({
      brand: BTI_BRAND,
      platform: item.platform,
      post_type: item.post_type,
      caption: item.caption,
      hashtags: item.hashtags,
      media_urls: episodeUrl && /\.(mp4|mov|m4v|webm|jpg|jpeg|png)(\?|$)/i.test(episodeUrl) ? [episodeUrl] : [],
      status: "draft",
      created_by: "bti-pack",
      generation_meta: { bti_pack_source: sourceKey, producer: "bti-episode-pack.v1", channel: item.platform },
      updated_at: now,
    }));
    const { data: inserted, error: insErr } = await db.from("agent_social_posts").insert(rows).select("id, platform");
    if (insErr) throw new Error(`social pack insert failed: ${insErr.message}`);

    const email = buildBtiEmail(ep);
    const { error: emailErr } = await db.from("agent_email_campaigns").insert({
      brand: BTI_BRAND,
      campaign_name: email.campaign_name,
      campaign_type: "broadcast",
      subject_line: email.subject_line,
      preview_text: email.preview_text,
      body_text: email.body_text,
      body_html: email.body_html,
      status: "needs_review",
      created_by: "bti-pack",
      updated_at: now,
    });

    return json({
      success: true,
      sourceKey,
      title,
      drafts: (inserted || []).map((r: { platform: string }) => r.platform),
      email: emailErr ? `failed: ${emailErr.message}` : email.campaign_name,
    });
  } catch (e) {
    console.error("bti-episode-pack error:", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
