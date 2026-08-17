/**
 * seo-meta-publish — Publish content to Facebook Page + Instagram Business.
 *
 * Actions:
 *   publish_facebook        { shop_id, message, link?, image_url?, schedule_at? }
 *   publish_instagram       { shop_id, image_url, caption } | { video_url, caption } | { carousel: string[], caption }
 *   distribute_blog_post    { shop_id, post_id, channels: ['facebook' | 'instagram'] }
 *
 * For Instagram, the Graph API requires a 2-step container flow:
 *   1. POST /:ig_user_id/media     → returns container_id
 *   2. POST /:ig_user_id/media_publish?creation_id=container_id
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopAdmin } from "../_shared/seo/auth.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface FBConfig {
  page_id: string;
  page_access_token: string;
  ig_business_id?: string | null;
}

async function loadFb(ctx: Awaited<ReturnType<typeof authenticate>>, shopId: string): Promise<FBConfig> {
  const { data, error } = await ctx.db
    .from("tenant_site_connections")
    .select("config")
    .eq("shop_id", shopId)
    .eq("platform", "meta_facebook")
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) throw new Error("Facebook not connected");
  const cfg = data.config as FBConfig;
  if (!cfg.page_id || !cfg.page_access_token) {
    throw new Error("No Page selected — choose a Page in /admin/seo/connections");
  }
  return cfg;
}

async function postToFacebook(cfg: FBConfig, body: {
  message: string;
  link?: string;
  image_url?: string;
  schedule_at?: number;
}) {
  const params = new URLSearchParams();
  params.set("access_token", cfg.page_access_token);
  if (body.image_url) {
    // Photo post
    params.set("url", body.image_url);
    params.set("caption", body.message);
    if (body.link) params.set("caption", `${body.message}\n\n${body.link}`);
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${cfg.page_id}/photos?${params.toString()}`,
      { method: "POST" },
    );
    if (!res.ok) throw new Error(`FB photo ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  // Link or text post
  params.set("message", body.message);
  if (body.link) params.set("link", body.link);
  if (body.schedule_at) {
    params.set("published", "false");
    params.set("scheduled_publish_time", String(body.schedule_at));
  }
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${cfg.page_id}/feed?${params.toString()}`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`FB feed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function postToInstagram(cfg: FBConfig, body: { image_url?: string; video_url?: string; caption: string }) {
  if (!cfg.ig_business_id) throw new Error("No Instagram Business linked to this Page");
  const params = new URLSearchParams();
  params.set("access_token", cfg.page_access_token);
  if (body.image_url) {
    params.set("image_url", body.image_url);
  } else if (body.video_url) {
    params.set("media_type", "REELS");
    params.set("video_url", body.video_url);
  } else {
    throw new Error("image_url or video_url required");
  }
  params.set("caption", body.caption);

  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${cfg.ig_business_id}/media?${params.toString()}`,
    { method: "POST" },
  );
  if (!containerRes.ok) {
    throw new Error(`IG container ${containerRes.status}: ${(await containerRes.text()).slice(0, 300)}`);
  }
  const { id: containerId } = await containerRes.json();

  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${cfg.ig_business_id}/media_publish?` +
      new URLSearchParams({
        access_token: cfg.page_access_token,
        creation_id: containerId,
      }).toString(),
    { method: "POST" },
  );
  if (!publishRes.ok) {
    throw new Error(`IG publish ${publishRes.status}: ${(await publishRes.text()).slice(0, 300)}`);
  }
  return publishRes.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const shop_id = body?.shop_id as string;
    const action = body?.action as string;
    if (!shop_id || !action) return json({ error: "shop_id + action required" }, 400);
    await assertShopAdmin(ctx, shop_id);

    const cfg = await loadFb(ctx, shop_id);

    if (action === "publish_facebook") {
      const message = body?.message as string;
      if (!message) return json({ error: "message required" }, 400);
      const result = await postToFacebook(cfg, {
        message,
        link: body?.link,
        image_url: body?.image_url,
        schedule_at: body?.schedule_at,
      });
      return json({ ok: true, result });
    }

    if (action === "publish_instagram") {
      const caption = body?.caption as string;
      if (!caption) return json({ error: "caption required" }, 400);
      const result = await postToInstagram(cfg, {
        image_url: body?.image_url,
        video_url: body?.video_url,
        caption,
      });
      return json({ ok: true, result });
    }

    if (action === "distribute_blog_post") {
      const postId = body?.post_id as string;
      const channels = (body?.channels as string[]) ?? ["facebook"];
      if (!postId) return json({ error: "post_id required" }, 400);

      const { data: post, error } = await ctx.db
        .from("seo_blog_posts")
        .select("title, excerpt, meta_description, external_url, featured_image_url, focus_keyword, keywords")
        .eq("id", postId)
        .eq("shop_id", shop_id)
        .maybeSingle();
      if (error || !post) return json({ error: "Post not found" }, 404);
      if (!post.external_url) {
        return json({ error: "Post not yet published to WordPress — publish first" }, 400);
      }

      const blurb =
        post.excerpt ||
        post.meta_description ||
        `New post: ${post.title}`;
      const hashtags = (post.keywords ?? [])
        .slice(0, 5)
        .map((k: string) => `#${k.replace(/[^a-z0-9]/gi, "")}`)
        .join(" ");

      const results: Record<string, unknown> = {};
      if (channels.includes("facebook")) {
        try {
          results.facebook = await postToFacebook(cfg, {
            message: `${post.title}\n\n${blurb}`,
            link: post.external_url,
            image_url: post.featured_image_url ?? undefined,
          });
        } catch (e) {
          results.facebook = { error: e instanceof Error ? e.message : String(e) };
        }
      }
      if (channels.includes("instagram")) {
        if (!post.featured_image_url) {
          results.instagram = { error: "Instagram requires a featured image" };
        } else {
          try {
            results.instagram = await postToInstagram(cfg, {
              image_url: post.featured_image_url,
              caption: `${post.title}\n\n${blurb}\n\n${hashtags}\n\nLink in bio.`,
            });
          } catch (e) {
            results.instagram = { error: e instanceof Error ? e.message : String(e) };
          }
        }
      }
      return json({ ok: true, results });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-meta-publish] error", msg);
    return json({ error: msg }, 500);
  }
});
