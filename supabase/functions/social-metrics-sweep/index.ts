/**
 * social-metrics-sweep — SocialIQ inbound metrics loop.
 *
 * Meta posts use the existing Meta connection. YouTube / YouTube Shorts use
 * the exact brand→shop mapping and that shop's `platform = youtube` Google
 * OAuth connection. Unsupported/owned surfaces are skipped rather than being
 * mis-read as Facebook.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { getValidGoogleAccessToken } from "../_shared/seo/google-oauth.ts";
import type { GoogleService } from "../_shared/seo/google-oauth.ts";

const GRAPH = "https://graph.facebook.com/v19.0";
const BATCH_LIMIT = 40;

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

interface PostedRow {
  id: string;
  brand: string;
  platform: string;
  published_post_id: string;
  engagement: Record<string, unknown> | null;
}

interface Counts {
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  video_views: number | null;
  raw: Record<string, unknown>;
  extras?: Record<string, number | null>;
}

function configuredShopId(brand: string, requireExact = false): string | undefined {
  const exactBrand = String(brand || "").trim();
  const mapRaw = Deno.env.get("CONTENT_DEPLOY_SHOP_MAP");
  if (mapRaw) {
    try {
      const map = JSON.parse(mapRaw) as Record<string, string>;
      const direct = exactBrand ? map[exactBrand] : undefined;
      if (direct) return String(direct);
    } catch {
      throw new Error("CONTENT_DEPLOY_SHOP_MAP is not valid JSON");
    }
  }
  if (requireExact) return undefined;
  return Deno.env.get("CONTENT_DEPLOY_SHOP_ID") || undefined;
}

// deno-lint-ignore no-explicit-any
async function loadMetaConfig(db: any, brand: string, cache: Map<string, FBConfig>): Promise<FBConfig> {
  const shopId = configuredShopId(brand);
  const cacheKey = shopId || "__single__";
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  let q = db
    .from("tenant_site_connections")
    .select("shop_id, config")
    .eq("platform", "meta_facebook")
    .eq("is_active", true);
  if (shopId) q = q.eq("shop_id", shopId);
  const { data, error } = await q;
  if (error) throw new Error(`Meta connection lookup failed: ${error.message}`);
  if (!data?.length) throw new Error(`No active meta_facebook connection for brand '${brand}'`);
  if (data.length > 1) throw new Error("Multiple active meta_facebook connections — set CONTENT_DEPLOY_SHOP_MAP");
  const cfg = data[0].config as FBConfig;
  if (!cfg?.page_id || !cfg?.page_access_token) throw new Error("Meta connection has no Page selected");
  cache.set(cacheKey, cfg);
  return cfg;
}

async function graphGet(path: string, token: string): Promise<Record<string, unknown>> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  const body = await res.json();
  if (!res.ok) throw new Error((body?.error?.message as string) || `Graph ${res.status} on ${path.split("?")[0]}`);
  return body;
}

function insightMap(body: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of (body.data as Array<Record<string, unknown>>) || []) {
    const v = (m.values as Array<{ value: unknown }>)?.[0]?.value;
    if (typeof v === "number") out[m.name as string] = v;
  }
  return out;
}

async function fetchInstagramCounts(mediaId: string, token: string): Promise<Counts> {
  const basic = await graphGet(`${mediaId}?fields=like_count,comments_count,media_type`, token);
  let ins: Record<string, number> = {};
  let insightsError: string | undefined;
  try {
    ins = insightMap(await graphGet(`${mediaId}/insights?metric=reach,saved,shares,views`, token));
  } catch (e) {
    insightsError = (e as Error).message;
  }
  return {
    reach: ins.reach ?? null,
    likes: (basic.like_count as number) ?? null,
    comments: (basic.comments_count as number) ?? null,
    shares: ins.shares ?? null,
    saves: ins.saved ?? null,
    video_views: ins.views ?? null,
    raw: { basic, insights: ins, ...(insightsError ? { insights_error: insightsError } : {}) },
  };
}

async function fetchFacebookCounts(postId: string, token: string): Promise<Counts> {
  const basic = await graphGet(`${postId}?fields=shares,likes.summary(true).limit(0),comments.summary(true).limit(0)`, token);
  let ins: Record<string, number> = {};
  let insightsError: string | undefined;
  try {
    ins = insightMap(await graphGet(`${postId}/insights?metric=post_impressions_unique`, token));
  } catch (e) {
    insightsError = (e as Error).message;
  }
  // deno-lint-ignore no-explicit-any
  const b = basic as any;
  return {
    reach: ins.post_impressions_unique ?? null,
    likes: b.likes?.summary?.total_count ?? null,
    comments: b.comments?.summary?.total_count ?? null,
    shares: b.shares?.count ?? null,
    saves: null,
    video_views: null,
    raw: { basic, insights: ins, ...(insightsError ? { insights_error: insightsError } : {}) },
  };
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// YouTube intentionally has NO default/single-tenant fallback. Publishing and
// inbound metrics must resolve the same exact content brand to the same shop.
// deno-lint-ignore no-explicit-any
async function youtubeToken(db: any, brand: string): Promise<string> {
  const shopId = configuredShopId(brand, true);
  if (!shopId) {
    throw new Error(`No exact shop mapping for YouTube brand '${brand}' — set CONTENT_DEPLOY_SHOP_MAP`);
  }
  const { access_token } = await getValidGoogleAccessToken(
    db,
    shopId,
    "youtube" as GoogleService,
  );
  return access_token;
}

async function fetchYouTubeCounts(videoId: string, token: string): Promise<Counts> {
  const vRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(videoId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const vBody = await vRes.json().catch(() => ({}));
  if (!vRes.ok) throw new Error(`YouTube statistics ${vRes.status}: ${vBody?.error?.message || "unknown error"}`);
  const stats = vBody?.items?.[0]?.statistics || {};

  const end = new Date();
  const start = new Date(Date.now() - 365 * 86400_000);
  const params = new URLSearchParams({
    ids: "channel==MINE",
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    metrics: "views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained,subscribersLost",
    filters: `video==${videoId}`,
  });
  let analytics: Record<string, unknown> = {};
  let analyticsError: string | undefined;
  try {
    const aRes = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const aBody = await aRes.json().catch(() => ({}));
    if (!aRes.ok) throw new Error(aBody?.error?.message || `HTTP ${aRes.status}`);
    const headers = (aBody.columnHeaders || []).map((h: { name: string }) => h.name);
    const row = aBody.rows?.[0] || [];
    analytics = Object.fromEntries(headers.map((name: string, i: number) => [name, row[i]]));
  } catch (e) {
    // Existing connections created before the analytics scope was granted still
    // return public video statistics; detailed analytics resumes after reconnect.
    analyticsError = (e as Error).message;
  }

  const views = numberOrNull(stats.viewCount ?? analytics.views);
  return {
    reach: null,
    likes: numberOrNull(stats.likeCount ?? analytics.likes),
    comments: numberOrNull(stats.commentCount ?? analytics.comments),
    shares: null,
    saves: null,
    video_views: views,
    raw: { statistics: stats, analytics, ...(analyticsError ? { analytics_error: analyticsError } : {}) },
    extras: {
      watch_time_minutes: numberOrNull(analytics.estimatedMinutesWatched),
      average_view_duration: numberOrNull(analytics.averageViewDuration),
      subscribers_gained: numberOrNull(analytics.subscribersGained),
      subscribers_lost: numberOrNull(analytics.subscribersLost),
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const days = Math.min(Number(body.days) || 90, 365);
    const db = createExternalClient();

    let q = db
      .from("agent_social_posts")
      .select("id, brand, platform, published_post_id, engagement")
      .eq("status", "posted")
      .not("published_post_id", "is", null)
      .gte("posted_date", new Date(Date.now() - days * 86400_000).toISOString())
      .order("posted_date", { ascending: false })
      .limit(BATCH_LIMIT);
    if (body.post_id) q = db
      .from("agent_social_posts")
      .select("id, brand, platform, published_post_id, engagement")
      .eq("id", body.post_id)
      .not("published_post_id", "is", null);

    const { data: posts, error } = await q;
    if (error) throw new Error(`post lookup failed: ${error.message}`);

    const cfgCache = new Map<string, FBConfig>();
    const results: Array<Record<string, unknown>> = [];

    for (const post of (posts || []) as PostedRow[]) {
      const platform = (post.platform || "").toLowerCase();
      try {
        let counts: Counts;
        if (platform === "youtube" || platform === "youtube_short" || platform === "youtube shorts") {
          counts = await fetchYouTubeCounts(post.published_post_id, await youtubeToken(db, post.brand));
        } else if (platform.includes("instagram") || platform === "ig") {
          const cfg = await loadMetaConfig(db, post.brand, cfgCache);
          counts = await fetchInstagramCounts(post.published_post_id, cfg.page_access_token);
        } else if (platform === "facebook" || platform === "fb") {
          const cfg = await loadMetaConfig(db, post.brand, cfgCache);
          counts = await fetchFacebookCounts(post.published_post_id, cfg.page_access_token);
        } else {
          results.push({ post_id: post.id, brand: post.brand, platform: post.platform, ok: true, skipped: "no_external_metrics_adapter" });
          continue;
        }

        const { error: upErr } = await db.from("social_post_metrics").upsert(
          {
            post_id: post.id,
            brand: post.brand,
            platform: post.platform,
            external_post_id: post.published_post_id,
            captured_on: new Date().toISOString().slice(0, 10),
            reach: counts.reach,
            likes: counts.likes,
            comments: counts.comments,
            shares: counts.shares,
            saves: counts.saves,
            video_views: counts.video_views,
            raw: counts.raw,
          },
          { onConflict: "external_post_id,captured_on" },
        );
        if (upErr) throw new Error(`metrics upsert failed: ${upErr.message}`);

        await db.from("agent_social_posts").update({
          engagement: {
            ...(post.engagement || {}),
            reach: counts.reach,
            likes: counts.likes,
            comments: counts.comments,
            shares: counts.shares,
            saves: counts.saves,
            video_views: counts.video_views,
            ...(counts.extras || {}),
            metrics_updated_at: new Date().toISOString(),
          },
        }).eq("id", post.id);

        results.push({
          post_id: post.id,
          brand: post.brand,
          platform: post.platform,
          ok: true,
          likes: counts.likes,
          comments: counts.comments,
          views: counts.video_views,
          ...(counts.extras || {}),
        });
      } catch (e) {
        results.push({ post_id: post.id, brand: post.brand, platform: post.platform, ok: false, error: (e as Error).message });
      }
    }

    const swept = results.filter((r) => r.ok && !r.skipped).length;
    return json({ success: true, swept, failed: results.filter((r) => !r.ok).length, results });
  } catch (e) {
    console.error("social-metrics-sweep error:", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});
