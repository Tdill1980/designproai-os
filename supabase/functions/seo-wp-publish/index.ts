/**
 * seo-wp-publish — Publish or update a seo_blog_posts row to a shop's WordPress.
 *
 * Body: { post_id: <seo_blog_posts.id>, status?: 'draft' | 'publish' }
 *
 * Pulls the post from DB, pulls the WordPress connection for its shop,
 * uploads the featured image (if URL is offsite), creates or updates the
 * post via REST, sets Yoast/Rank Math meta, and writes the external_*
 * fields back to the DB row.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { authenticate, assertShopAdmin } from "../_shared/seo/auth.ts";
import {
  createPost,
  updatePost,
  uploadMediaFromUrl,
  WordPressCredentials,
} from "../_shared/seo/wordpress-adapter.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const ctx = await authenticate(req);
    const body = await req.json();
    const postId = body?.post_id as string;
    const desiredStatus = (body?.status as "draft" | "publish") ?? "draft";
    if (!postId) return json({ error: "post_id required" }, 400);

    const { data: post, error: postErr } = await ctx.db
      .from("seo_blog_posts")
      .select("*")
      .eq("id", postId)
      .maybeSingle();
    if (postErr || !post) return json({ error: "Post not found" }, 404);

    await assertShopAdmin(ctx, post.shop_id);

    const { data: conn, error: connErr } = await ctx.db
      .from("tenant_site_connections")
      .select("site_url, config")
      .eq("shop_id", post.shop_id)
      .eq("platform", "wordpress")
      .eq("is_active", true)
      .maybeSingle();
    if (connErr || !conn) {
      return json({ error: "No active WordPress connection for this shop" }, 400);
    }
    const config = conn.config as {
      username: string;
      app_password: string;
      seo_plugin?: WordPressCredentials["seo_plugin"];
    };
    const creds: WordPressCredentials = {
      site_url: conn.site_url ?? "",
      username: config.username,
      app_password: config.app_password,
      seo_plugin: config.seo_plugin ?? "none",
    };

    // Validate required content
    if (!post.title || !post.body_html) {
      return json({ error: "Post is missing title or body — cannot publish" }, 400);
    }

    // Upload featured image if it's an offsite URL
    let featuredMediaId: number | undefined;
    if (post.featured_image_url) {
      try {
        const isOffsite = !post.featured_image_url.startsWith(creds.site_url);
        if (isOffsite) {
          const media = await uploadMediaFromUrl(creds, post.featured_image_url);
          featuredMediaId = media.id;
        }
      } catch (e) {
        console.warn("[seo-wp-publish] featured image upload failed", e);
        // continue without — non-fatal
      }
    }

    const meta = {
      title: post.meta_title ?? undefined,
      description: post.meta_description ?? undefined,
      focus_keyword: post.focus_keyword ?? undefined,
      og_image_url: post.og_image_url ?? undefined,
      canonical_url: post.canonical_url ?? undefined,
      schema_json: post.schema_json ?? undefined,
    };

    let result: { id: number; link: string; status: string; slug: string };
    if (post.external_post_id) {
      result = await updatePost(creds, post.external_post_id, {
        title: post.title,
        slug: post.slug || undefined,
        content: post.body_html,
        excerpt: post.excerpt ?? undefined,
        status: desiredStatus,
        featured_media: featuredMediaId,
        meta,
      });
    } else {
      result = await createPost(creds, {
        title: post.title,
        slug: post.slug || undefined,
        content: post.body_html,
        excerpt: post.excerpt ?? undefined,
        status: desiredStatus,
        featured_media: featuredMediaId,
        meta,
      });
    }

    const updates: Record<string, unknown> = {
      external_platform: "wordpress",
      external_post_id: String(result.id),
      external_url: result.link,
      external_status: result.status,
      external_synced_at: new Date().toISOString(),
      external_last_error: null,
    };
    if (desiredStatus === "publish") {
      updates.status = "published";
      updates.published_at = new Date().toISOString();
    }
    const { error: updateErr } = await ctx.service
      .from("seo_blog_posts")
      .update(updates)
      .eq("id", postId);
    if (updateErr) {
      console.error("[seo-wp-publish] DB update failed", updateErr);
    }

    return json({ ok: true, external: result });
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[seo-wp-publish] error", msg);
    return json({ error: msg }, 500);
  }
});
