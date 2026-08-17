/**
 * youtube-publish — tenant-scoped YouTube publishing + management adapter.
 *
 * Every action requires shop_id and the caller must be that shop's admin (or
 * the internal service role). The function loads platform=youtube from
 * tenant_site_connections, refreshes that token, resolves mine=true, and
 * refuses any channel mismatch before it touches YouTube.
 *
 * Actions:
 *   upload (default), channel, update, delete, set_thumbnail,
 *   playlist_add, comments, reply_comment
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { authenticate, assertShopAdmin } from "../_shared/seo/auth.ts";
import { getValidGoogleAccessToken } from "../_shared/seo/google-oauth.ts";
import type { GoogleService } from "../_shared/seo/google-oauth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface YouTubeChannel {
  id: string;
  title: string;
}

async function ytJson(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=UTF-8");
  }
  const res = await fetch(url, { ...init, headers });
  if (res.status === 204) return {};
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    // deno-lint-ignore no-explicit-any
    const msg = (out as any)?.error?.message || JSON.stringify(out).slice(0, 300);
    throw new Error(`YouTube API ${res.status}: ${msg}`);
  }
  return out;
}

async function getYouTubeChannel(accessToken: string): Promise<YouTubeChannel> {
  const data = await ytJson(
    "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=1",
    accessToken,
  );
  // deno-lint-ignore no-explicit-any
  const channel = Array.isArray((data as any)?.items) ? (data as any).items[0] : null;
  const id = String(channel?.id || "").trim();
  const title = String(channel?.snippet?.title || "").trim();
  if (!id || !title) throw new Error("No YouTube channel was found for the connected Google account");
  return { id, title };
}

async function getOwnedVideo(
  accessToken: string,
  channelId: string,
  videoId: unknown,
): Promise<Record<string, unknown>> {
  const id = String(videoId || "").trim();
  if (!id) throw new Error("video_id required");
  const out = await ytJson(
    `https://www.googleapis.com/youtube/v3/videos?part=id,snippet,status&id=${encodeURIComponent(id)}`,
    accessToken,
  );
  // deno-lint-ignore no-explicit-any
  const video = (out as any)?.items?.[0];
  if (!video) throw new Error("YouTube video not found");
  if (String(video?.snippet?.channelId || "") !== channelId) {
    throw new Error("That video does not belong to the connected YouTube channel");
  }
  return video as Record<string, unknown>;
}

async function assertOwnedPlaylist(accessToken: string, channelId: string, playlistId: unknown): Promise<string> {
  const id = String(playlistId || "").trim();
  if (!id) throw new Error("playlist_id required");
  const out = await ytJson(
    `https://www.googleapis.com/youtube/v3/playlists?part=id,snippet&id=${encodeURIComponent(id)}`,
    accessToken,
  );
  // deno-lint-ignore no-explicit-any
  const playlist = (out as any)?.items?.[0];
  if (!playlist) throw new Error("YouTube playlist not found");
  if (String(playlist?.snippet?.channelId || "") !== channelId) {
    throw new Error("That playlist does not belong to the connected YouTube channel");
  }
  return id;
}

/** 9:16 (or anything taller than wide) is a Short. Landscape never is. */
export function isShortFormat(input: {
  aspectRatio?: string | null;
  postType?: string | null;
  durationSeconds?: number | null;
}): boolean {
  const ar = String(input.aspectRatio || "").trim();
  const pt = String(input.postType || "").toLowerCase();
  if (ar) {
    const [w, h] = ar.split(":").map((n) => Number(n));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return h > w;
  }
  return pt.includes("short") || pt.includes("reel") || pt.includes("story");
}

export function withShortsTag(text: string, short: boolean): string {
  const value = String(text || "");
  if (!short || /#shorts\b/i.test(value)) return value;
  return `${value.trim()}\n\n#Shorts`.trim();
}

export type YouTubePrivacy = "private" | "unlisted" | "public";

export function youtubePrivacy(value: unknown): YouTubePrivacy | null {
  const privacy = String(value || "unlisted").toLowerCase();
  return privacy === "private" || privacy === "unlisted" || privacy === "public"
    ? privacy
    : null;
}

/** Reject non-HTTPS and obvious local targets before the server fetches media. */
export function safeVideoSource(value: unknown): string | null {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (
      host === "localhost"
      || host === "127.0.0.1"
      || host === "0.0.0.0"
      || host === "::1"
      || host.endsWith(".local")
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^169\.254\./.test(host)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function upload(
  body: Record<string, unknown>,
  accessToken: string,
  channelId: string,
) {
  const videoUrl = safeVideoSource(body.video_url);
  const title = String(body.title || "").trim().slice(0, 100);
  const description = String(body.description || "").trim().slice(0, 4900);
  const tags: string[] = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 15) : [];
  const publishAt = body.publish_at ? String(body.publish_at) : null;
  const aspectRatio = body.aspect_ratio ? String(body.aspect_ratio) : null;
  const postType = body.post_type ? String(body.post_type) : null;
  const requestedPrivacy = youtubePrivacy(body.privacy);
  const confirmPublicSchedule = body.confirm_public_schedule === true;

  if (!videoUrl) throw new Error("video_url must be a public HTTPS URL");
  if (!title) throw new Error("title required — YouTube rejects an untitled upload");
  if (!requestedPrivacy) throw new Error("privacy must be private, unlisted, or public");
  if (requestedPrivacy === "public" && (!publishAt || !confirmPublicSchedule)) {
    throw new Error("Public publishing requires publish_at and confirm_public_schedule=true");
  }

  const short = isShortFormat({ aspectRatio, postType });
  const scheduledPublic = Boolean(publishAt && requestedPrivacy === "public" && confirmPublicSchedule);
  const privacyStatus: YouTubePrivacy = scheduledPublic ? "private" : requestedPrivacy;
  const metadata = {
    snippet: {
      title,
      description: withShortsTag(description, short),
      tags,
      categoryId: String(body.category_id || "2"),
    },
    status: {
      privacyStatus,
      selfDeclaredMadeForKids: Boolean(body.made_for_kids ?? false),
      ...(scheduledPublic ? { publishAt } : {}),
    },
  };

  const start = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!start.ok) {
    const errorText = await start.text().catch(() => "");
    throw new Error(`YouTube rejected the upload session (${start.status}): ${errorText.slice(0, 300)}`);
  }
  const uploadUrl = start.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return an upload URL");

  const source = await fetch(videoUrl);
  if (!source.ok || !source.body) throw new Error(`Could not read the video file (${source.status})`);
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": source.headers.get("content-type") || "video/mp4",
      ...(source.headers.get("content-length")
        ? { "Content-Length": source.headers.get("content-length")! }
        : {}),
    },
    body: source.body,
  });
  const output = await put.json().catch(() => ({}));
  if (!put.ok || !output.id) {
    throw new Error(`YouTube upload failed (${put.status}): ${JSON.stringify(output).slice(0, 300)}`);
  }

  // The upload response is created using the current pinned channel, but verify
  // ownership once more before returning a mutable platform id to Content OS.
  await getOwnedVideo(accessToken, channelId, output.id);
  return {
    video_id: output.id,
    url: `https://www.youtube.com/watch?v=${output.id}`,
    is_short: short,
    privacy: privacyStatus,
    publish_at: scheduledPublic ? publishAt : null,
  };
}

async function updateVideo(body: Record<string, unknown>, accessToken: string, channelId: string) {
  // deno-lint-ignore no-explicit-any
  const existing = await getOwnedVideo(accessToken, channelId, body.video_id) as any;
  const id = String(existing.id);
  const snippet = {
    ...existing.snippet,
    ...(body.title != null ? { title: String(body.title).trim().slice(0, 100) } : {}),
    ...(body.description != null ? { description: String(body.description).slice(0, 5000) } : {}),
    ...(Array.isArray(body.tags) ? { tags: body.tags.map(String).slice(0, 15) } : {}),
    ...(body.category_id != null ? { categoryId: String(body.category_id) } : {}),
  };
  const requestedPrivacy = body.privacy == null ? null : youtubePrivacy(body.privacy);
  if (body.privacy != null && !requestedPrivacy) throw new Error("privacy must be private, unlisted, or public");
  const status = {
    ...existing.status,
    ...(requestedPrivacy ? { privacyStatus: requestedPrivacy } : {}),
    ...(body.made_for_kids != null ? { selfDeclaredMadeForKids: Boolean(body.made_for_kids) } : {}),
  };
  const out = await ytJson(
    "https://www.googleapis.com/youtube/v3/videos?part=snippet,status",
    accessToken,
    { method: "PUT", body: JSON.stringify({ id, snippet, status }) },
  );
  return { video_id: id, video: out };
}

async function deleteVideo(body: Record<string, unknown>, accessToken: string, channelId: string) {
  const existing = await getOwnedVideo(accessToken, channelId, body.video_id);
  const id = String(existing.id);
  await ytJson(
    `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(id)}`,
    accessToken,
    { method: "DELETE" },
  );
  return { video_id: id, deleted: true };
}

async function setThumbnail(body: Record<string, unknown>, accessToken: string, channelId: string) {
  const existing = await getOwnedVideo(accessToken, channelId, body.video_id);
  const videoId = String(existing.id);
  const thumbnailUrl = safeVideoSource(body.thumbnail_url);
  if (!thumbnailUrl) throw new Error("thumbnail_url must be a public HTTPS URL");
  const source = await fetch(thumbnailUrl);
  if (!source.ok || !source.body) throw new Error(`Could not read thumbnail (${source.status})`);
  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": source.headers.get("content-type") || "image/jpeg",
      },
      body: source.body,
    },
  );
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube thumbnail upload failed (${res.status}): ${JSON.stringify(out).slice(0, 300)}`);
  return { video_id: videoId, thumbnail: out };
}

async function addToPlaylist(body: Record<string, unknown>, accessToken: string, channelId: string) {
  const video = await getOwnedVideo(accessToken, channelId, body.video_id);
  const videoId = String(video.id);
  const playlistId = await assertOwnedPlaylist(accessToken, channelId, body.playlist_id);
  const out = await ytJson(
    "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet",
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({
        snippet: {
          playlistId,
          resourceId: { kind: "youtube#video", videoId },
        },
      }),
    },
  );
  return { video_id: videoId, playlist_id: playlistId, playlist_item_id: out.id || null };
}

async function listComments(body: Record<string, unknown>, accessToken: string, channelId: string) {
  const video = await getOwnedVideo(accessToken, channelId, body.video_id);
  const videoId = String(video.id);
  const max = Math.min(Math.max(Number(body.max_results) || 50, 1), 100);
  const out = await ytJson(
    `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&videoId=${encodeURIComponent(videoId)}&maxResults=${max}&order=time&textFormat=plainText`,
    accessToken,
  );
  return { video_id: videoId, items: out.items || [], next_page_token: out.nextPageToken || null };
}

async function replyComment(body: Record<string, unknown>, accessToken: string, channelId: string) {
  const parentId = String(body.parent_comment_id || "").trim();
  const text = String(body.text || "").trim().slice(0, 10000);
  if (!parentId || !text) throw new Error("parent_comment_id + text required");

  const parent = await ytJson(
    `https://www.googleapis.com/youtube/v3/comments?part=snippet&id=${encodeURIComponent(parentId)}`,
    accessToken,
  );
  // deno-lint-ignore no-explicit-any
  const comment = (parent as any)?.items?.[0];
  const videoId = String(comment?.snippet?.videoId || "").trim();
  if (!comment || !videoId) throw new Error("Parent YouTube comment not found");
  await getOwnedVideo(accessToken, channelId, videoId);

  const out = await ytJson(
    "https://www.googleapis.com/youtube/v3/comments?part=snippet",
    accessToken,
    { method: "POST", body: JSON.stringify({ snippet: { parentId, textOriginal: text } }) },
  );
  return { video_id: videoId, comment: out };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const ctx = await authenticate(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "upload").trim().toLowerCase();
    const shopId = String(body.shop_id || "").trim();
    if (!shopId) return json({ ok: false, error: "shop_id required" }, 400);
    await assertShopAdmin(ctx, shopId);

    const { access_token, metadata: connection } = await getValidGoogleAccessToken(
      ctx.service,
      shopId,
      "youtube" as GoogleService,
    );
    const channelId = String(connection?.youtube_channel_id || "").trim();
    if (!channelId) {
      return json({ ok: false, error: "YouTube connection has no validated channel — reconnect it" }, 400);
    }

    const currentChannel = await getYouTubeChannel(access_token);
    if (currentChannel.id !== channelId) {
      return json(
        { ok: false, error: "The connected YouTube channel changed — reconnect the intended channel" },
        409,
      );
    }

    let result: Record<string, unknown>;
    if (action === "upload") result = await upload(body, access_token, channelId);
    else if (action === "channel") {
      const channel = await ytJson(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true&maxResults=1",
        access_token,
      );
      // deno-lint-ignore no-explicit-any
      result = { channel: (channel as any)?.items?.[0] || null };
    } else if (action === "update") result = await updateVideo(body, access_token, channelId);
    else if (action === "delete") result = await deleteVideo(body, access_token, channelId);
    else if (action === "set_thumbnail") result = await setThumbnail(body, access_token, channelId);
    else if (action === "playlist_add") result = await addToPlaylist(body, access_token, channelId);
    else if (action === "comments") result = await listComments(body, access_token, channelId);
    else if (action === "reply_comment") result = await replyComment(body, access_token, channelId);
    else return json({ ok: false, error: `Unknown YouTube action: ${action}` }, 400);

    return json({
      ok: true,
      action,
      shop_id: shopId,
      channel_id: channelId,
      channel_title: connection?.youtube_channel_title || currentChannel.title,
      ...result,
    });
  } catch (e) {
    if (e instanceof Response) {
      const message = await e.text().catch(() => "Authentication failed");
      return new Response(message, {
        status: e.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
