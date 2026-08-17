/**
 * youtube-metadata — WrapTVWorld YouTube helper. Two actions (the project is
 * at its edge-function cap, so upload lives here rather than a 2nd function):
 *
 *   action "generate" (default): AI "text creator" — per video, per format
 *     (long-form 16:9 vs Shorts 9:16): title, description, tags[], thumbnail_text,
 *     hashtags[], category. Uses OPENAI_API_KEY (gpt-4o). Persists to
 *     public.youtube_metadata when post_id/render_job_id given.
 *
 *   action "upload": publish a rendered video to the WrapTVWorld YouTube channel
 *     via YouTube Data API v3 (resumable). Works for long-form AND Shorts (a 9:16
 *     clip with "#Shorts" in the title is auto-classified a Short). Requires
 *     secrets YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN (one-time OAuth
 *     consent with youtube.upload scope on the channel's Google account; service
 *     accounts cannot upload to YouTube). Returns needs_auth until set.
 *
 * Registered in config.toml with verify_jwt = false.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function sb() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

const SYSTEM = `You are a YouTube growth strategist for WrapTVWorld, an automotive
vehicle-wrap entertainment channel. Its "Behind the Install" show is fast-cut,
MTV/CapCut-style install + printed-wrap-film montages set to music — no talking.
You write metadata that ranks in YouTube search and maximizes click-through, and
you NEVER invent fake claims, prices, or names. Voice: pro-installer, punchy,
specific. Keep the automotive-wrap search intent front and center (vehicle wrap,
car wrap, vinyl wrap, wrap install, color change, satisfying).`;

function userPrompt(song: string, format: "long" | "short", summary: string, brand: string) {
  const isShort = format === "short";
  return `Create YouTube metadata for a ${isShort ? "SHORT (9:16 vertical, YouTube Shorts)" : "LONG-FORM (16:9 horizontal)"} video.

Channel: WrapTVWorld · Show: Behind the Install · Brand: ${brand}
Song/theme: "${song}"
What the video is: ${summary}

Return STRICT JSON (no markdown) with EXACTLY these keys:
{
  "title": ${isShort ? "'<= 60 chars, hook-first, MUST end with #Shorts, front-load a wrap keyword'" : "'<= 70 chars, keyword-front-loaded, compelling, no clickbait lies'"},
  "description": "${isShort ? "1 punchy line + 1 context line, then 4-6 hashtags on the last line" : "First 2 lines keyword-rich for search; then 2-3 lines on whats shown; a CTA to subscribe and to submit install footage to WrapTVWorld; end with 6-10 hashtags"}",
  "tags": [${isShort ? "10-15" : "15-25"} lowercase SEO tags],
  "thumbnail_text": "2-4 BOLD words for the thumbnail overlay (ALL CAPS ok)",
  "hashtags": ["6-10 hashtags"],
  "category": "Autos & Vehicles"
}
Rules: no emojis in the title; never promise prices/results; truthful to an install montage.`;
}

async function generate(body: any) {
  const format: "long" | "short" = body.format === "short" ? "short" : "long";
  const song = String(body.song || body.title || "Behind the Install");
  const brand = String(body.brand || "WrapTVWorld");
  const summary = String(
    body.content_summary ||
      "A fast-cut, beat-synced montage of real vehicle wrap installs and printed wrap film — squeegee work, panel wraps, color changes, and finished-wrap reveals. No talking; the install and the track carry it.",
  );
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) return json({ ok: false, error: "OPENAI_API_KEY not configured" }, 500);

  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt(song, format, summary, brand) },
      ],
    }),
  });
  if (!res.ok) return json({ ok: false, error: `openai ${res.status}: ${(await res.text()).slice(0, 200)}` }, 502);
  const data = await res.json();
  let metadata: any = {};
  try {
    metadata = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  } catch {
    return json({ ok: false, error: "AI returned non-JSON" }, 502);
  }
  metadata.format = format;
  metadata.song = song;

  if (body.post_id || body.render_job_id) {
    try {
      await sb().from("youtube_metadata").upsert({
        post_id: body.post_id ?? null,
        render_job_id: body.render_job_id ?? null,
        format, song,
        title: metadata.title ?? null,
        description: metadata.description ?? null,
        tags: metadata.tags ?? [],
        thumbnail_text: metadata.thumbnail_text ?? null,
        hashtags: metadata.hashtags ?? [],
        category: metadata.category ?? "Autos & Vehicles",
      }, { onConflict: "render_job_id,format" });
    } catch (_) { /* best-effort */ }
  }
  return json({ ok: true, metadata });
}

async function ytAccessToken(): Promise<string> {
  const id = Deno.env.get("YT_CLIENT_ID");
  const secret = Deno.env.get("YT_CLIENT_SECRET");
  const refresh = Deno.env.get("YT_REFRESH_TOKEN");
  if (!id || !secret || !refresh) throw Object.assign(new Error("YouTube not authorized"), { needsAuth: true });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`token exchange failed: ${JSON.stringify(data).slice(0, 200)}`);
  return data.access_token as string;
}

async function upload(body: any) {
  const videoUrl = String(body.video_url || "");
  if (!videoUrl) return json({ ok: false, error: "video_url required" }, 400);
  const title = String(body.title || "WrapTVWorld — Behind the Install").slice(0, 100);
  const description = String(body.description || "");
  const tags: string[] = Array.isArray(body.tags) ? body.tags.slice(0, 50) : [];
  const privacy = ["public", "unlisted", "private"].includes(body.privacy) ? body.privacy : "private";
  const categoryId = String(body.category_id || "2"); // Autos & Vehicles

  let token: string;
  try {
    token = await ytAccessToken();
  } catch (e: any) {
    if (e?.needsAuth) {
      return json({ ok: false, needs_auth: true, error: "YouTube not authorized. Set YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (one-time OAuth consent, youtube.upload scope, on the WrapTVWorld channel's Google account)." }, 428);
    }
    throw e;
  }

  const vid = await fetch(videoUrl);
  if (!vid.ok) return json({ ok: false, error: `fetch video ${vid.status}` }, 400);
  const bytes = new Uint8Array(await vid.arrayBuffer());
  const meta = { snippet: { title, description, tags, categoryId }, status: { privacyStatus: privacy, selfDeclaredMadeForKids: false } };

  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(bytes.length),
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) return json({ ok: false, error: `initiate ${init.status}: ${(await init.text()).slice(0, 200)}` }, 502);
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) return json({ ok: false, error: "no resumable upload URL" }, 502);

  const up = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.length) }, body: bytes });
  if (!up.ok) return json({ ok: false, error: `upload ${up.status}: ${(await up.text()).slice(0, 200)}` }, 502);
  const result = await up.json();
  const videoId = result.id;
  const watchUrl = `https://youtu.be/${videoId}`;

  if (body.render_job_id || body.post_id) {
    try {
      const db = sb();
      if (body.render_job_id) await db.from("youtube_metadata").update({ youtube_video_id: videoId, youtube_url: watchUrl }).eq("render_job_id", body.render_job_id);
      if (body.post_id) await db.from("agent_social_posts").update({ published_post_id: videoId, posted_date: new Date().toISOString() }).eq("id", body.post_id);
    } catch (_) { /* non-fatal */ }
  }
  return json({ ok: true, video_id: videoId, watch_url: watchUrl });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action === "upload" ? "upload" : "generate";
    return action === "upload" ? await upload(body) : await generate(body);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
