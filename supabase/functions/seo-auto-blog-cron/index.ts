/**
 * seo-auto-blog-cron — Fully automatic blog generation + WordPress publish
 *
 * Called by pg_cron (or manual trigger). For each shop with a WordPress
 * connection and auto_blog_enabled = true:
 *   1. Picks a topic from the shop's keyword queue (or generates one)
 *   2. Calls seo-blog-generate to write the post
 *   3. Calls seo-wp-publish to push it live as a draft (or publish)
 *   4. Submits the URL to Google Search Console for indexing
 *
 * Config lives in tenant_site_connections.metadata:
 *   auto_blog_enabled: true
 *   auto_blog_frequency: "daily" | "3x_week" | "weekly"
 *   auto_blog_publish_status: "draft" | "publish"
 *   auto_blog_topics: string[]  — queue of topics to write about
 *   auto_blog_last_run: ISO date
 *   auto_blog_posts_generated: number
 */

import { createExternalClient, getExternalSupabaseUrl, getExternalServiceRoleKey } from "../_shared/external-db.ts";
import { corsHeaders } from "../_shared/cors.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Default topics for wrap shops when the queue is empty
const DEFAULT_TOPICS = [
  { topic: "How much does a full vehicle wrap cost?", keyword: "vehicle wrap cost", intent: "buyer_intent" },
  { topic: "Matte vs gloss vs satin wrap finish — which is right for you?", keyword: "matte vs gloss wrap", intent: "comparison" },
  { topic: "How long does a vinyl wrap last?", keyword: "vinyl wrap durability", intent: "informational" },
  { topic: "PPF vs vinyl wrap — which protection does your car need?", keyword: "ppf vs vinyl wrap", intent: "comparison" },
  { topic: "Chrome delete guide — what it costs and why it looks incredible", keyword: "chrome delete cost", intent: "buyer_intent" },
  { topic: "Best wrap colors for Tesla Model 3 and Model Y", keyword: "tesla wrap colors", intent: "informational" },
  { topic: "Can you wrap a leased vehicle? Everything you need to know", keyword: "wrap leased car", intent: "informational" },
  { topic: "Commercial fleet wraps — ROI, cost, and why businesses wrap their vehicles", keyword: "fleet wrap ROI", intent: "buyer_intent" },
  { topic: "How to care for your vehicle wrap — maintenance guide", keyword: "vehicle wrap care", intent: "how_to" },
  { topic: "What to expect at your wrap appointment — step by step", keyword: "wrap appointment guide", intent: "informational" },
  { topic: "Color change wrap vs paint — which is better for your car?", keyword: "wrap vs paint", intent: "comparison" },
  { topic: "Best wrap colors for trucks and SUVs", keyword: "truck wrap colors", intent: "informational" },
  { topic: "Sprinter van wraps — costs, designs, and ROI for businesses", keyword: "sprinter van wrap", intent: "buyer_intent" },
  { topic: "Ceramic coating after a wrap — is it worth it?", keyword: "ceramic coating wrap", intent: "informational" },
  { topic: "Partial wraps vs full wraps — cost comparison and when each makes sense", keyword: "partial wrap cost", intent: "comparison" },
  { topic: "Racing stripes and accent wraps — affordable ways to customize your ride", keyword: "racing stripes wrap", intent: "informational" },
  { topic: "Wrap removal — how it works and what it costs", keyword: "wrap removal cost", intent: "informational" },
  { topic: "Interior wraps — dashboard, trim, and console customization", keyword: "interior car wrap", intent: "informational" },
  { topic: "Wrap warranty — what's covered and what isn't", keyword: "wrap warranty", intent: "informational" },
  { topic: "Luxury car wraps — Porsche, BMW, Mercedes customization trends", keyword: "luxury car wrap", intent: "informational" },
];

function shouldRun(frequency: string, lastRun: string | null): boolean {
  if (!lastRun) return true;
  const last = new Date(lastRun).getTime();
  const now = Date.now();
  const hours = (now - last) / (1000 * 60 * 60);

  switch (frequency) {
    case "daily": return hours >= 22;
    case "3x_week": return hours >= 48;
    case "weekly": return hours >= 160;
    default: return hours >= 22;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createExternalClient();
    const baseUrl = getExternalSupabaseUrl();
    const serviceKey = getExternalServiceRoleKey();

    // Find all shops with auto-blog enabled
    const { data: connections } = await supabase
      .from("tenant_site_connections")
      .select("id, shop_id, metadata, site_url")
      .eq("platform", "wordpress")
      .eq("is_active", true);

    if (!connections?.length) {
      return json(200, { ok: true, message: "No WordPress connections found", processed: 0 });
    }

    const results: Array<{ shop_id: string; action: string; post_id?: string; error?: string }> = [];

    for (const conn of connections) {
      const meta = (conn as any).metadata || {};

      // Check if auto-blog is enabled (default to true for WPW)
      const enabled = meta.auto_blog_enabled !== false;
      if (!enabled) {
        results.push({ shop_id: (conn as any).shop_id, action: "skipped_disabled" });
        continue;
      }

      const frequency = meta.auto_blog_frequency || "daily";
      const lastRun = meta.auto_blog_last_run || null;

      if (!shouldRun(frequency, lastRun)) {
        results.push({ shop_id: (conn as any).shop_id, action: "skipped_too_soon" });
        continue;
      }

      // Pick a topic — from queue or defaults
      let topicQueue: Array<{ topic: string; keyword: string; intent: string }> = meta.auto_blog_topics || [];

      if (!topicQueue.length) {
        // Count existing posts to offset into defaults
        const { count } = await supabase
          .from("seo_blog_posts")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", (conn as any).shop_id);

        const offset = (count || 0) % DEFAULT_TOPICS.length;
        topicQueue = [DEFAULT_TOPICS[offset]];
      }

      const currentTopic = topicQueue[0];
      const remainingTopics = topicQueue.slice(1);

      try {
        // Generate the post
        console.log(`[auto-blog] Generating: "${currentTopic.topic}" for shop ${(conn as any).shop_id}`);

        const genRes = await fetch(`${baseUrl}/functions/v1/seo-blog-generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            shop_id: (conn as any).shop_id,
            topic: currentTopic.topic,
            focus_keyword: currentTopic.keyword,
            intent: currentTopic.intent,
            tone: "expert, no-fluff, practical, authoritative",
            target_word_count: 1200,
          }),
        });

        const genData = await genRes.json();
        if (!genData?.post?.id) throw new Error(genData?.error || "No post generated");

        const postId = genData.post.id;
        const publishStatus = meta.auto_blog_publish_status || "draft";

        // Publish to WordPress
        console.log(`[auto-blog] Publishing post ${postId} as ${publishStatus}`);

        const pubRes = await fetch(`${baseUrl}/functions/v1/seo-wp-publish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            post_id: postId,
            status: publishStatus,
          }),
        });

        const pubData = await pubRes.json();
        const externalUrl = pubData?.external_url;

        // Submit to Google for indexing if published
        if (publishStatus === "publish" && externalUrl) {
          fetch(`${baseUrl}/functions/v1/seo-google-search-console`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              shop_id: (conn as any).shop_id,
              action: "submit_url",
              url: externalUrl,
            }),
          }).catch(() => {}); // fire and forget
        }

        // Update connection metadata
        await supabase
          .from("tenant_site_connections")
          .update({
            metadata: {
              ...meta,
              auto_blog_last_run: new Date().toISOString(),
              auto_blog_posts_generated: (meta.auto_blog_posts_generated || 0) + 1,
              auto_blog_topics: remainingTopics,
            },
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", (conn as any).id);

        results.push({
          shop_id: (conn as any).shop_id,
          action: `generated_and_${publishStatus}ed`,
          post_id: postId,
        });

        console.log(`[auto-blog] Done: "${currentTopic.topic}" → ${postId}`);
      } catch (err: any) {
        console.error(`[auto-blog] Error for shop ${(conn as any).shop_id}:`, err.message);
        results.push({
          shop_id: (conn as any).shop_id,
          action: "error",
          error: err.message,
        });
      }
    }

    return json(200, { ok: true, processed: results.length, results });
  } catch (err: any) {
    console.error("[auto-blog-cron]", err);
    return json(500, { ok: false, error: err.message });
  }
});
