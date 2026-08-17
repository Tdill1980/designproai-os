/**
 * content-deploy — THE missing back half of the content pipeline.
 *
 * The content system generates into agent_social_posts (Content Studio /
 * Social Batch / Content Review / WrapCommandAI bridge via content-intake),
 * but until this function nothing ever consumed those rows — approved +
 * scheduled posts just sat in the calendar. This is the deploy executor
 * that closes the loop:
 *
 *   generate (Content Studio / Social Batch / WCAI video factory)
 *     → review + approve (Content Review, status 'approved'/'scheduled')
 *       → content-deploy publishes when scheduled_date is due
 *         → status 'posted' (+ published_post_id) or 'failed' (+ Engine Room task)
 *
 * Modes (POST JSON):
 *   { }                                — process all due posts (cron default)
 *   { "post_id": "<uuid>" }            — publish one post now (ignores schedule)
 *   { "dry_run": true }                — report what WOULD publish, post nothing
 *
 * Media: images publish immediately. VIDEO (post_type 'reel'/'video' or an
 * .mp4/.mov media URL) uses the IG REELS container flow — the container id is
 * persisted in engagement.ig_container_id, so if Instagram is still
 * processing when this run ends, the NEXT cron run resumes the same container
 * instead of re-uploading. Never a blind fixed sleep.
 *
 * Meta connections live in tenant_site_connections (platform 'meta_facebook')
 * — the SAME store seo-meta-publish uses. Multi-brand: set the
 * CONTENT_DEPLOY_SHOP_MAP secret to JSON mapping brand → shop_id, e.g.
 *   {"restylepro":"<shop-uuid>","weprintwraps":"<shop-uuid>"}
 * Falls back to CONTENT_DEPLOY_SHOP_ID, then to the single active connection.
 *
 * Called every 5 minutes via pg_cron — see sql/setup-content-deploy-cron.sql.
 * Caller must present the service role key as the bearer token (the cron
 * does); posts go OUT to social media, so this is not open to anon callers.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createExternalClient, getExternalServiceRoleKey } from "../_shared/external-db.ts";

const GRAPH = "https://graph.facebook.com/v19.0";
const MAX_ATTEMPTS = 3;
const BATCH_LIMIT = 10;

/**
 * ── MANUAL SURFACES ────────────────────────────────────────────────────────
 * Channels this ecosystem publishes BY HAND. There is no API integration, no
 * stored credential, and no plan for one — a person opens the app and posts.
 *
 * This is NOT a new policy. It is the exact set for which
 * `src/lib/contentDoctrine.ts` already declares `canAutoPublish: false`, and
 * that file stays the single source of truth. Deno cannot import from `src/`,
 * so this is a MIRROR, and `tests/content-deploy-manual-surfaces.test.ts`
 * reads both files and fails the build the moment they disagree. A second
 * hand-maintained list is exactly how the platform vocabulary drifted in the
 * first place.
 *
 * WHY THIS EXISTS AT ALL. Before it, a scheduled `x` / `linkedin` / `pinterest`
 * row fell through the dispatch to the unsupported-platform throw at the end of
 * `deployPost`, which BURNS AN ATTEMPT. (That phrase is deliberately not quoted
 * here: `tests/publishing-visibility.test.ts` and `tests/content-doctrine.test.ts`
 * both locate the dispatch chain by `indexOf` on it, so repeating it ABOVE the
 * dispatch silently truncates their slice to the empty string and every
 * coverage assertion passes vacuously.)
 * Three sweeps later the row is `failed` — a status the cron
 * never revisits. So the honest, permanent state of a piece nobody could ever
 * auto-post became "we tried three times and it broke", which is false: nothing
 * broke, the surface simply is not automated. The piece is fine, it is finished,
 * and it is waiting for a human.
 *
 * Measured 2026-08-07 on production: 3 scheduled rows sit on manual surfaces
 * (x, linkedin, pinterest — all `created_by='agent'`, all due since April).
 * They have never burned an attempt only because `restylepro` is blocked at the
 * Meta connection before they are ever reached. `tenant_site_connections` holds
 * ZERO `meta_facebook` rows, so the trap is armed and has not sprung: the day
 * somebody connects Meta, the brand unblocks and these dead-letter within three
 * five-minute sweeps.
 */
const MANUAL_SURFACES = new Set([
  "tiktok",
  "linkedin",
  "x",
  "pinterest",
  "threads",
  "email",
  "blog",
  "substack",
]);

/**
 * The terminal state for a piece that is finished but can only go out by hand.
 *
 * `agent_social_posts.status` has NO check constraint (verified 2026-08-07:
 * `pg_constraint` returns zero `c` rows for the table), so this cannot fail
 * loudly the way an out-of-constraint `panelizer_jobs` status would — it would
 * simply be accepted. That makes the choice of value a real decision rather
 * than a formality:
 *
 *   - It must NOT be `failed`. Nothing failed, and `failed` raises an Engine
 *     Room incident card for a human to go debug something that is not broken.
 *   - It must NOT stay `scheduled`. The sweep selects `approved`/`scheduled`,
 *     so the row would be re-read on every 5-minute pass forever, occupying a
 *     candidate slot to be re-skipped — the head-of-line pathology in a new
 *     costume. Leaving it also means the calendar keeps promising a post that
 *     is never coming.
 *   - It leaves the sweep's status filter permanently after one pass, which is
 *     what makes this self-limiting: each row is parked exactly once.
 *
 * `src/lib/queuedWork.ts` renders an unmodelled status as `Queued (manual)`
 * rather than hiding it, so the Brand Board keeps showing these rows and names
 * the state out loud instead of flattening it to "Queued".
 */
const MANUAL_STATUS = "manual";
/**
 * How many candidates to consider per run, as a multiple of BATCH_LIMIT.
 *
 * Only exists because a brand with no connection must not starve a brand that
 * has one. Wide enough to see past a fully-blocked brand's backlog — 45 posts
 * were past due when this was written — without turning the sweep into a table
 * scan.
 */
const BLOCKED_OVERFETCH = 5;
// In-run polling budget for IG video containers. If processing outlasts this,
// the container id is saved and the next cron run picks it back up.
const CONTAINER_POLLS = 6;
const CONTAINER_POLL_MS = 5000;

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

interface SocialPost {
  id: string;
  brand: string;
  platform: string;
  post_type: string | null;
  caption: string | null;
  hashtags: string[] | null;
  media_urls: string[] | null;
  status: string;
  scheduled_date: string | null;
  publish_attempts: number;
  engagement: Record<string, unknown> | null;
}

/** One tenant resolver for every outbound connection, not a Meta-only map. */
function contentDeployShopId(brand: string, requireExact = false): string | undefined {
  const exactBrand = String(brand || "").trim();
  const mapRaw = Deno.env.get("CONTENT_DEPLOY_SHOP_MAP");
  if (mapRaw) {
    try {
      const mapped = exactBrand ? JSON.parse(mapRaw)?.[exactBrand] : undefined;
      if (mapped) return String(mapped);
    } catch {
      throw new Error("CONTENT_DEPLOY_SHOP_MAP is not valid JSON");
    }
  }
  if (requireExact) return undefined;
  return Deno.env.get("CONTENT_DEPLOY_SHOP_ID") || undefined;
}

/** "still processing" is not a failure — signal it distinctly so attempts don't burn. */
class StillProcessing extends Error {}

function isVideoPost(post: SocialPost): boolean {
  const t = (post.post_type || "").toLowerCase();
  if (t === "reel" || t === "video") return true;
  const url = post.media_urls?.[0] || "";
  return /\.(mp4|mov)(\?|$)/i.test(url);
}

function buildCaption(post: SocialPost): string {
  const tags = (post.hashtags ?? []).filter(Boolean).join(" ");
  return [post.caption?.trim(), tags].filter(Boolean).join("\n\n");
}

// deno-lint-ignore no-explicit-any
async function loadMetaConfig(db: any, brand: string, cache: Map<string, FBConfig>): Promise<FBConfig> {
  const shopId = contentDeployShopId(brand);

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
  if (!data?.length) {
    throw new Error(
      shopId
        ? `No active meta_facebook connection for shop ${shopId} (brand '${brand}')`
        : "No active meta_facebook connection — connect one in /admin/seo/connections",
    );
  }
  if (data.length > 1) {
    throw new Error(
      `Multiple active meta_facebook connections (shops: ${data.map((d: { shop_id: string }) => d.shop_id).join(", ")}) — set CONTENT_DEPLOY_SHOP_MAP or CONTENT_DEPLOY_SHOP_ID`,
    );
  }
  const cfg = data[0].config as FBConfig;
  if (!cfg?.page_id || !cfg?.page_access_token) {
    throw new Error("Meta connection has no Page selected — choose a Page in /admin/seo/connections");
  }
  cache.set(cacheKey, cfg);
  return cfg;
}

async function publishFacebook(cfg: FBConfig, post: SocialPost): Promise<string> {
  const message = buildCaption(post);
  const mediaUrl = post.media_urls?.[0];
  const params = new URLSearchParams();
  params.set("access_token", cfg.page_access_token);
  let endpoint: string;
  if (mediaUrl && isVideoPost(post)) {
    params.set("file_url", mediaUrl);
    params.set("description", message);
    endpoint = `${GRAPH}/${cfg.page_id}/videos`;
  } else if (mediaUrl) {
    params.set("url", mediaUrl);
    params.set("caption", message);
    endpoint = `${GRAPH}/${cfg.page_id}/photos`;
  } else {
    params.set("message", message);
    endpoint = `${GRAPH}/${cfg.page_id}/feed`;
  }
  const res = await fetch(`${endpoint}?${params.toString()}`, { method: "POST" });
  if (!res.ok) throw new Error(`FB ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  return out.post_id || out.id || "";
}

async function igContainerStatus(cfg: FBConfig, containerId: string): Promise<string> {
  const res = await fetch(
    `${GRAPH}/${containerId}?fields=status_code&access_token=${cfg.page_access_token}`,
  );
  if (!res.ok) throw new Error(`IG container status ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  return out.status_code || "IN_PROGRESS";
}

async function igPublishContainer(cfg: FBConfig, containerId: string): Promise<string> {
  const res = await fetch(
    `${GRAPH}/${cfg.ig_business_id}/media_publish?` +
      new URLSearchParams({ access_token: cfg.page_access_token, creation_id: containerId }).toString(),
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`IG publish ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  return out.id || "";
}

/** IG carousel: child containers per image, then a CAROUSEL container. */
async function publishInstagramCarousel(cfg: FBConfig, post: SocialPost): Promise<string> {
  const urls = (post.media_urls || []).filter((u) => !/\.(mp4|mov)(\?|$)/i.test(u)).slice(0, 10);
  if (urls.length < 2) throw new Error("IG carousel needs at least 2 image media_urls");
  const children: string[] = [];
  for (const url of urls) {
    const params = new URLSearchParams();
    params.set("access_token", cfg.page_access_token);
    params.set("image_url", url);
    params.set("is_carousel_item", "true");
    const res = await fetch(`${GRAPH}/${cfg.ig_business_id}/media?${params.toString()}`, { method: "POST" });
    if (!res.ok) throw new Error(`IG carousel child ${res.status}: ${(await res.text()).slice(0, 300)}`);
    children.push((await res.json()).id);
  }
  const params = new URLSearchParams();
  params.set("access_token", cfg.page_access_token);
  params.set("media_type", "CAROUSEL");
  params.set("children", children.join(","));
  params.set("caption", buildCaption(post));
  const res = await fetch(`${GRAPH}/${cfg.ig_business_id}/media?${params.toString()}`, { method: "POST" });
  if (!res.ok) throw new Error(`IG carousel container ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const { id } = await res.json();
  return igPublishContainer(cfg, id);
}

// deno-lint-ignore no-explicit-any
async function publishInstagram(db: any, cfg: FBConfig, post: SocialPost): Promise<string> {
  if (!cfg.ig_business_id) throw new Error("No Instagram Business account linked to the connected Page");
  const mediaUrl = post.media_urls?.[0];
  if (!mediaUrl) throw new Error("Instagram requires media — post has no media_urls");

  // Carousels: multiple image URLs + post_type 'carousel'.
  if ((post.post_type || "").toLowerCase() === "carousel" && (post.media_urls?.length || 0) > 1) {
    return publishInstagramCarousel(cfg, post);
  }

  // Images: single container, publishable immediately.
  if (!isVideoPost(post)) {
    const params = new URLSearchParams();
    params.set("access_token", cfg.page_access_token);
    params.set("image_url", mediaUrl);
    params.set("caption", buildCaption(post));
    const res = await fetch(`${GRAPH}/${cfg.ig_business_id}/media?${params.toString()}`, { method: "POST" });
    if (!res.ok) throw new Error(`IG container ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const { id } = await res.json();
    return igPublishContainer(cfg, id);
  }

  // Video/REELS: containers take time to process. Resume a saved container if
  // a previous run created one; otherwise create it now.
  let containerId = (post.engagement?.ig_container_id as string) || "";
  if (!containerId) {
    const params = new URLSearchParams();
    params.set("access_token", cfg.page_access_token);
    params.set("media_type", "REELS");
    params.set("video_url", mediaUrl);
    params.set("caption", buildCaption(post));
    const res = await fetch(`${GRAPH}/${cfg.ig_business_id}/media?${params.toString()}`, { method: "POST" });
    if (!res.ok) throw new Error(`IG video container ${res.status}: ${(await res.text()).slice(0, 300)}`);
    containerId = (await res.json()).id;
    await db
      .from("agent_social_posts")
      .update({ engagement: { ...(post.engagement || {}), ig_container_id: containerId } })
      .eq("id", post.id);
  }

  for (let i = 0; i < CONTAINER_POLLS; i++) {
    const status = await igContainerStatus(cfg, containerId);
    if (status === "FINISHED") return igPublishContainer(cfg, containerId);
    if (status === "ERROR" || status === "EXPIRED") {
      // Dead container — clear it so the next attempt re-uploads.
      await db
        .from("agent_social_posts")
        .update({ engagement: { ...(post.engagement || {}), ig_container_id: null } })
        .eq("id", post.id);
      throw new Error(`IG video container ${status} — video may be invalid for Reels (check codec/aspect/duration)`);
    }
    await new Promise((r) => setTimeout(r, CONTAINER_POLL_MS));
  }
  // Still processing — leave the row scheduled; the next cron run resumes.
  throw new StillProcessing(`IG still processing container ${containerId}`);
}

// How many entries per show stay in the site rotation before older ones archive.
const WRAPTV_ROTATION_LIMIT = 12;

/**
 * WrapTVWorld site channel — "publishing" means inserting the post into
 * wraptv_site_content, which the public Fuel-style site (/wraptv) reads.
 * The show slug rides in engagement.wtw_show (set by the Content Director /
 * Video Studio); videos default to Behind the Install, images to Wrap of the
 * Week. Rotation: beyond WRAPTV_ROTATION_LIMIT live entries per show, the
 * oldest flip to 'archived'.
 */
// deno-lint-ignore no-explicit-any
/**
 * YOUTUBE — 16:9 and 9:16, via the youtube-publish function.
 *
 * Owner: "I need to post to youtube clean, also youtube should allow 16:9 and
 * 9:16 shorts." Before this, `youtube` fell through to the throw above, so 13
 * drafts and one SCHEDULED post could never publish — the scheduled one simply
 * failed the cron on every pass.
 *
 * The aspect lives on the RENDER, not here: YouTube has no "upload a Short"
 * endpoint, it classifies a vertical upload as a Short from the file itself.
 * What travels is the cut's aspect so the uploader can add the #Shorts hint
 * and refuse to call a landscape cut a Short.
 *
 * A scheduled post passes its own time through as publishAt, which is REAL
 * scheduled publishing on YouTube's side.
 */
async function publishYouTube(db: any, post: SocialPost): Promise<string> {
  const videoUrl = post.media_urls?.[0];
  if (!videoUrl) throw new Error("YouTube requires a video — post has no media_urls");

  const eng = (post.engagement || {}) as Record<string, unknown>;
  // yt_title/yt_description are written by the Brand Board caption button; the
  // caption's first line is the fallback so a hand-written post still works.
  const lines = String(post.caption || "").split("\n");
  const title = String(eng.yt_title || lines[0] || "").trim();
  const description = String(eng.yt_description || lines.slice(1).join("\n") || "").trim();
  if (!title) throw new Error("YouTube requires a title — none on the post");
  const brand = String(post.brand || "").trim();
  if (!brand) throw new Error("YouTube requires an exact nonempty brand for tenant resolution");
  const shopId = contentDeployShopId(brand, true);
  if (!shopId) {
    throw new Error(
      `No exact shop mapping for YouTube brand '${brand}' — set CONTENT_DEPLOY_SHOP_MAP`,
    );
  }

  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/youtube-publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      shop_id: shopId,
      video_url: videoUrl,
      title,
      description,
      tags: post.hashtags || [],
      aspect_ratio: eng.aspect_ratio || null,
      post_type: post.post_type || null,
      // Scheduling is genuine on YouTube: privacyStatus private + publishAt.
      publish_at: post.scheduled_date || null,
      // Never turn a missing setting into a public upload. A human can opt in
      // to public through yt_privacy; otherwise the presentation cut is unlisted.
      privacy: eng.yt_privacy || "unlisted",
      confirm_public_schedule: eng.yt_confirm_public_schedule === true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error || `youtube-publish failed (${res.status})`);
  }
  return String(data.video_id);
}

async function publishWrapTVSite(db: any, post: SocialPost): Promise<string> {
  const mediaUrl = post.media_urls?.[0];
  if (!mediaUrl) throw new Error("WrapTV site requires media — post has no media_urls");
  const video = isVideoPost(post);
  const eng = (post.engagement || {}) as Record<string, unknown>;
  const showSlug = (eng.wtw_show as string) || (video ? "behind-the-install" : "wrap-of-the-week");

  const { data: row, error } = await db
    .from("wraptv_site_content")
    .insert({
      post_id: post.id,
      brand: post.brand || "wraptvworld",
      show_slug: showSlug,
      title: (eng.wtw_title as string) || null,
      caption: post.caption,
      media_url: mediaUrl,
      thumbnail_url: (eng.wtw_thumbnail as string) || post.media_urls?.[1] || null,
      media_type: video ? "video" : "image",
      credit: (eng.wtw_credit as string) || null,
      tags: post.hashtags || [],
      status: "live",
      source: "content-deploy",
    })
    .select("id")
    .single();
  if (error) throw new Error(`WrapTV site insert failed: ${error.message}`);

  // Rotate: archive live entries beyond the per-show cap (oldest first).
  const { data: live } = await db
    .from("wraptv_site_content")
    .select("id")
    .eq("show_slug", showSlug)
    .eq("status", "live")
    .order("published_at", { ascending: false });
  const overflow = (live || []).slice(WRAPTV_ROTATION_LIMIT).map((r: { id: string }) => r.id);
  if (overflow.length) {
    await db.from("wraptv_site_content").update({ status: "archived" }).in("id", overflow);
  }
  return row.id as string;
}

/**
 * Platforms that genuinely publish THROUGH META, and therefore need its config.
 *
 * ── THIS WAS A DENYLIST, AND IT HID 32 POSTS FOR FOUR MONTHS ───────────────
 * It used to read `!["wraptv_site","wrapfeed","youtube","youtube_short"]
 * .includes(platform)` — everything not on that list was assumed to be Meta.
 * The file's own MANUAL_SURFACES note says why that shape is dangerous: "a
 * second hand-maintained list is exactly how the platform vocabulary drifted in
 * the first place." This is that drift, in the other direction.
 *
 * Measured on production 2026-08-11, of 40 past-due scheduled posts:
 *
 *   instagram / facebook          8   genuinely blocked on the Meta connection
 *   post / carousel / story      32   POST TYPES sitting in the platform column
 *
 * Those 32 are one batch (brand `restylepro`, post_type `founders`, all created
 * 2026-04-16, ZERO with media). Being unrecognised, they were treated as Meta
 * platforms, tried to load a Meta config that does not exist, and were caught by
 * the connection-level branch — which deliberately does not burn an attempt. So
 * they sat at `publish_attempts = 0`, `publish_error = null`, status
 * `scheduled`, indistinguishable from real posts waiting on a connection.
 *
 * That mattered twice over. It inflated "40 posts waiting on Meta" when the true
 * number is 8. And it armed a trap: connect Meta, the brand unblocks, and all 32
 * fall through to the unsupported-platform throw and dead-letter into `failed`
 * within three sweeps — 32 Engine Room incidents, landing the moment somebody
 * fixed the connection, blamed on the fix.
 *
 * An ALLOWLIST cannot drift that way: a platform this function does not know is
 * no longer silently assumed to be Meta's problem.
 */
const META_PLATFORMS = new Set(["facebook", "instagram"]);

function needsMetaConfig(platform: string): boolean {
  return META_PLATFORMS.has(platform);
}

/**
 * Platforms this function can actually dispatch. Derived from the branches in
 * `deployPost` — if you add a branch there, add it here, and the test pins them
 * to each other so they cannot separate.
 */
const ROUTABLE_PLATFORMS = new Set([
  "facebook",
  "instagram",
  "wraptv_site",
  "wrapfeed",
  "youtube",
  "youtube_short",
]);

/**
 * OUR OWN platform (WrapFeed, /feed) — publishing is a first-party insert
 * into social_feed_posts. No external API, no tokens, can't be throttled.
 * Engagement flows back through the social_interactions mirror trigger
 * into SocialIQ (docs/SOCIALIQ_SPEC.md).
 */
// deno-lint-ignore no-explicit-any
async function publishWrapFeed(db: any, post: SocialPost): Promise<string> {
  const { data, error } = await db
    .from("social_feed_posts")
    .insert({
      brand: post.brand || "weprintwraps",
      author_id: null,
      author_name: "WePrintWraps",
      caption: buildCaption(post) || null,
      media_urls: post.media_urls || [],
      status: "published",
    })
    .select("id")
    .single();
  if (error) throw new Error(`wrapfeed insert failed: ${error.message}`);
  return data.id as string;
}

// deno-lint-ignore no-explicit-any
async function deployPost(db: any, cfg: FBConfig | null, post: SocialPost) {
  try {
    const platform = (post.platform || "").toLowerCase();
    let publishedId: string;
    if (platform === "facebook") {
      publishedId = await publishFacebook(cfg!, post);
    } else if (platform === "instagram") {
      publishedId = await publishInstagram(db, cfg!, post);
    } else if (platform === "wraptv_site") {
      publishedId = await publishWrapTVSite(db, post);
    } else if (platform === "wrapfeed") {
      publishedId = await publishWrapFeed(db, post);
    } else if (platform === "youtube" || platform === "youtube_short") {
      // `youtube_short` is a distinct CHANNEL in contentDoctrine (its own hook
      // window and rule) and it declares `canAutoPublish: true` — but the
      // dispatch had no branch for it, so the doctrine promised an auto-post
      // this function would have thrown on. It is the same uploader either way:
      // YouTube classifies a Short from the FILE, not from a separate endpoint,
      // and publishYouTube already forwards aspect_ratio + post_type for that.
      // Zero rows carry this platform today, so this closes a latent
      // contradiction rather than fixing a live outage.
      publishedId = await publishYouTube(db, post);
    } else {
      throw new Error(`Platform '${post.platform}' has no publisher yet (supported: instagram, facebook, wraptv_site, wrapfeed, youtube, youtube_short)`);
    }

    await db
      .from("agent_social_posts")
      .update({
        status: "posted",
        posted_date: new Date().toISOString(),
        published_post_id: publishedId,
        publish_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", post.id);
    return { id: post.id, platform: post.platform, ok: true, published_post_id: publishedId };
  } catch (e) {
    if (e instanceof StillProcessing) {
      // Not a failure: attempts untouched, status untouched — next run resumes.
      return { id: post.id, platform: post.platform, ok: false, processing: true, note: e.message };
    }
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = (post.publish_attempts ?? 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await db
      .from("agent_social_posts")
      .update({
        publish_attempts: attempts,
        publish_error: msg,
        ...(failed ? { status: "failed" } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", post.id);
    if (failed) {
      // Surface permanently failed posts as an Engine Room card instead of
      // letting them die silently in the calendar.
      await db.from("slack_agent_tasks").insert({
        brand: post.brand || "restylepro",
        task_type: "social_post",
        title: `Publish FAILED after ${attempts} attempts: ${post.platform} post`,
        description: msg,
        priority: "high",
        status: "pending",
        metadata: { source: "content-deploy", post_id: post.id },
        created_by: "content-deploy",
      });
    }
    return { id: post.id, platform: post.platform, ok: false, error: msg, attempts, failed };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // Outbound publisher — service-role callers only (pg_cron sends this).
    const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!bearer || bearer !== getExternalServiceRoleKey()) {
      return json({ error: "content-deploy requires the service role key" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const db = createExternalClient();
    const nowIso = new Date().toISOString();

    let query = db
      .from("agent_social_posts")
      .select(
        "id, brand, platform, post_type, caption, hashtags, media_urls, status, scheduled_date, publish_attempts, engagement",
      )
      .lt("publish_attempts", MAX_ATTEMPTS);

    if (body.post_id) {
      // Manual "publish now" — any non-posted row, schedule ignored.
      query = query.eq("id", body.post_id).neq("status", "posted");
    } else {
      // Cron sweep — approved/scheduled rows whose time has come.
      query = query
        .in("status", ["approved", "scheduled"])
        .not("scheduled_date", "is", null)
        .lte("scheduled_date", nowIso)
        .order("scheduled_date", { ascending: true })
        // OVER-FETCH ON PURPOSE. See the head-of-line note in the loop below:
        // connection-blocked posts deliberately never burn an attempt, so with
        // a hard `.limit(BATCH_LIMIT)` the same blocked rows filled the entire
        // batch on every run, forever, and nothing behind them was ever
        // reached. We take a wider candidate set and still DEPLOY at most
        // BATCH_LIMIT of them.
        .limit(BATCH_LIMIT * BLOCKED_OVERFETCH);
    }

    const { data: due, error } = await query;
    if (error) return json({ error: error.message }, 500);
    if (!due?.length) return json({ ok: true, processed: 0, message: "No posts due" });

    if (body.dry_run) {
      return json({
        ok: true,
        dry_run: true,
        would_publish: due.map((p: SocialPost) => ({
          id: p.id,
          brand: p.brand,
          platform: p.platform,
          video: isVideoPost(p),
          scheduled_date: p.scheduled_date,
          has_media: !!p.media_urls?.length,
          // A dry run that lists a LinkedIn row under "would_publish" is lying
          // to the operator reading it. This one says which rows would be
          // parked as manual instead — the whole point of a preview.
          would_park_manual: MANUAL_SURFACES.has((p.platform || "").toLowerCase()),
        })),
      });
    }

    const cfgCache = new Map<string, FBConfig>();
    const results = [];
    /**
     * ── THE HEAD-OF-LINE BLOCK ────────────────────────────────────────────
     * A connection-level failure deliberately does NOT burn an attempt (see
     * the catch below — burning three would permanently fail good content for
     * a reason it cannot fix). Correct on its own. Combined with an
     * oldest-first `limit(BATCH_LIMIT)` it was fatal: the ten oldest due posts
     * were all restylepro Meta posts with no connection, so they were
     * re-selected on EVERY run and the batch never advanced past them.
     *
     * Measured 2026-08-07: 48 scheduled posts, 45 past due, exactly 10 ever
     * touched — the same 10, sweep after sweep. The other 35 included posts
     * for weprintwraps and wraptvworld, and 32 rows whose `platform` column
     * holds a FORMAT (`post`, `story`, `carousel`) rather than a platform,
     * which would have failed fast and dead-lettered themselves within three
     * runs had they ever been reached.
     *
     * The previous fix made this blockage VISIBLE. It did not make it
     * non-blocking. So: once a brand is known blocked in this run, skip its
     * remaining posts and spend the batch on brands that can actually publish.
     * The blocked ones are still reported, and still recorded on the row.
     */
    const blockedBrands = new Map<string, string>();
    let deployed = 0;
    let parkedManual = 0;
    // Rows whose platform value has no publisher at all — reported apart from
    // `manual` because "a human posts this" and "this is not a channel" are
    // different facts and only one of them is somebody's job.
    let parkedUnroutable = 0;
    for (const post of due as SocialPost[]) {
      /**
       * ── MANUAL SURFACE: PARK IT, DO NOT PRETEND TO PUBLISH IT ───────────
       * Checked FIRST, before the publish budget and before the blocked-brand
       * skip, because neither is relevant here: parking needs no Meta
       * connection and no network call, so a brand blocked at Meta must not
       * stop its LinkedIn post from being told the truth.
       *
       * This is the honest end of the road, not a failure:
       *   - no attempt is burned (nothing was attempted),
       *   - `failed` is never written (nothing failed),
       *   - no Engine Room incident is raised (there is nothing to debug),
       *   - the row leaves the sweep's status filter, so it is parked ONCE
       *     rather than re-read every five minutes forever.
       *
       * It also does not consume `deployed`: parking is a local write, not a
       * publish, and letting it eat the batch would starve the brands that CAN
       * post — the exact head-of-line failure this loop already exists to fix.
       */
      if (MANUAL_SURFACES.has((post.platform || "").toLowerCase())) {
        const note =
          `${post.platform} is a manual surface — this ecosystem has no publisher for it and is not ` +
          `getting one, so it was never going to auto-post. The piece is finished and approved; a human ` +
          `posts it. Parked as '${MANUAL_STATUS}' instead of being retried into 'failed', which would ` +
          `have claimed it broke.`;
        await db
          .from("agent_social_posts")
          .update({ status: MANUAL_STATUS, publish_error: note, updated_at: new Date().toISOString() })
          .eq("id", post.id)
          // Re-assert what we planned against: if a human moved this row
          // between the read and now, they win and this write matches nothing.
          .eq("status", post.status);
        parkedManual += 1;
        results.push({ id: post.id, platform: post.platform, ok: false, manual: true, note });
        continue;
      }

      /**
       * ── A PLATFORM WE CANNOT ROUTE AT ALL ───────────────────────────────
       * Checked here, beside the manual park and for the same reason: this row
       * is never going to publish, and every five-minute sweep spent
       * re-discovering that is a candidate slot stolen from a post that could.
       *
       * The 32 live rows in this state carry `post`, `carousel` and `story` —
       * POST TYPES in the platform column, from a 2026-04-16 seed batch with no
       * media at all. Until the `needsMetaConfig` allowlist above they hid
       * behind the Meta blockage; without this branch they would now do the
       * opposite and dead-letter into `failed`.
       *
       * `failed` WOULD BE A LIE, and the MANUAL_STATUS note above already
       * argues the case: nothing broke, so nothing should raise an Engine Room
       * incident for a human to go debug. Nobody wired a publisher for `post`
       * because `post` is not a destination. Three attempts would not discover
       * that; they would just spend two more sweeps arriving at it.
       *
       * So it parks, exactly once, with the value named in the note — which is
       * the actionable part, because the fix is to re-file the row against a
       * real channel (or delete it), not to retry it. Counted on its own axis
       * so "we cannot route these" never reads as "a connection is down".
       */
      if (!ROUTABLE_PLATFORMS.has((post.platform || "").toLowerCase())) {
        const note =
          `'${post.platform}' is not a destination this system publishes to — there is no publisher for it ` +
          `(routable: ${[...ROUTABLE_PLATFORMS].join(", ")}). It looks like a post TYPE in the platform ` +
          `column rather than a channel, so no number of retries would have got it out. Parked instead of ` +
          `being marked 'failed', which would have claimed it broke. Re-file it against a real channel, or ` +
          `delete it.`;
        await db
          .from("agent_social_posts")
          .update({ status: MANUAL_STATUS, publish_error: note, updated_at: new Date().toISOString() })
          .eq("id", post.id)
          // Same optimistic guard as the manual park: if a human moved this row
          // between the read and now, they win and this write matches nothing.
          .eq("status", post.status);
        parkedUnroutable += 1;
        results.push({ id: post.id, platform: post.platform, ok: false, unroutable: true, note });
        continue;
      }

      if (deployed >= BATCH_LIMIT) break;
      const brandKey = (post.brand || "restylepro").toLowerCase();
      const known = blockedBrands.get(brandKey);
      if (known) {
        // Not re-attempted, not re-written: the row already carries this exact
        // error from the first post of this brand in this run. Counted so the
        // response says how much work the blockage is holding up.
        results.push({ id: post.id, platform: post.platform, ok: false, blocked: true, skipped: true, error: known });
        continue;
      }
      deployed += 1;
      try {
        const cfg = needsMetaConfig((post.platform || "").toLowerCase())
          ? await loadMetaConfig(db, post.brand || "restylepro", cfgCache)
          : null;
        results.push(await deployPost(db, cfg, post));
      } catch (e) {
        // CONNECTION-LEVEL PROBLEM (no Meta account for this brand).
        //
        // Attempts are still not burned — the post is fine, the account is
        // missing, and burning three attempts would mark good content
        // permanently failed for a reason it cannot fix. But it is no longer
        // SILENT. This branch used to return the error to the caller and write
        // nothing, so the row kept publish_attempts=0 and publish_error=null
        // while the sweep reported `ok:true`. Measured 2026-08-06: 4,257
        // consecutive successful sweeps, 10 posts attempted every 5 minutes,
        // ZERO ever published, the oldest due since 2026-04-14, and not one
        // row or alert anywhere said so.
        const msg = e instanceof Error ? e.message : String(e);
        // Remember it for the rest of THIS run only. Nothing is persisted about
        // the brand's blocked-ness, so a connection made between two sweeps is
        // picked up on the very next one — no cache to bust, no flag to clear.
        blockedBrands.set(brandKey, msg);
        await db
          .from("agent_social_posts")
          .update({ publish_error: msg, updated_at: new Date().toISOString() })
          .eq("id", post.id);
        results.push({ id: post.id, platform: post.platform, ok: false, blocked: true, error: msg });
      }
    }
    const posted = results.filter((r) => r.ok).length;
    const blocked = results.filter((r) => (r as { blocked?: boolean }).blocked).length;

    // NOTHING GOT OUT, AND SOMETHING TRIED. That is an outage, not a quiet
    // afternoon, and it now raises exactly one Engine Room card per day per
    // reason instead of nothing at all. Deduped by title so a 5-minute sweep
    // cannot bury the board in 288 identical cards.
    if (blocked > 0 && posted === 0) {
      const reason = String((results.find((r) => (r as { blocked?: boolean }).blocked) as { error?: string })?.error || "unknown");
      const title = `Publishing BLOCKED — nothing can post: ${reason.slice(0, 90)}`;
      const { data: recent } = await db
        .from("slack_agent_tasks")
        .select("id")
        .eq("title", title)
        .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .limit(1);
      if (!recent?.length) {
        await db.from("slack_agent_tasks").insert({
          brand: "restylepro",
          task_type: "social_post",
          title,
          description:
            `${blocked} scheduled post(s) could not publish and 0 got out.\n\n${reason}\n\n` +
            `This is a CONNECTION problem, not a content problem — the posts are fine and are not being ` +
            `marked failed. Connect the account, and the next 5-minute sweep publishes them.`,
          priority: "high",
          status: "pending",
          metadata: { source: "content-deploy", blocked, reason },
          created_by: "content-deploy",
        });
      }
    }

    // Skipped = held behind a blocked brand. Reported separately from
    // `blocked` so "one brand is down" reads differently from "everything is
    // down", which is exactly the distinction four months of `ok:true` lost.
    const skipped = results.filter((r) => (r as { skipped?: boolean }).skipped).length;
    // `manual` is reported on its own axis and is deliberately NOT folded into
    // `blocked`. "Nobody can post because a connection is missing" is an
    // outage; "this piece was always going to be posted by hand" is the system
    // working. Conflating them would re-create, for manual surfaces, exactly
    // the ambiguity that let 4,257 sweeps report ok:true while nothing shipped.
    console.log(`[content-deploy] processed=${results.length} posted=${posted} blocked=${blocked} skipped_behind_block=${skipped} manual_parked=${parkedManual} unroutable_parked=${parkedUnroutable} other=${results.length - posted - blocked - parkedManual - parkedUnroutable}`);
    // `all_blocked` is the honest headline: the sweep ran fine and NOTHING got
    // out. A caller that only read `ok` saw success for four months.
    return json({ ok: true, processed: results.length, posted, blocked, skipped_behind_block: skipped, manual_parked: parkedManual, unroutable_parked: parkedUnroutable, all_blocked: blocked > 0 && posted === 0, results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[content-deploy] error", msg);
    return json({ error: msg }, 500);
  }
});
