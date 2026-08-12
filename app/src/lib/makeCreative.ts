/**
 * makeCreative — turn a TEXT-ONLY queued post into a real, viewable asset.
 *
 * The Content Director queue fills with caption drafts (the agent's weekly
 * plan, hooks, ad copy). A card with no `media_urls` is just words: there is
 * nothing to judge, so "approve" is a coin flip. This builds the missing
 * middle — the copy plus REAL imagery from the Asset Library, composed by the
 * existing deterministic static-post composer in worker/video-renderer.
 *
 * Three rules, because they're what make it trustworthy:
 *  1. REAL PIXELS ONLY. The visual comes from the Asset Library
 *     (agent_media_assets) — footage and photos the shop actually shot. No
 *     image model invents a wrap that was never installed.
 *  2. PROVENANCE IS RECORDED. Which assets were used is written back onto the
 *     post, so a human can see what the creative is made of before approving.
 *  3. HONEST REFUSAL. No usable assets for that brand → it says so and makes
 *     nothing. An empty card is better than a fabricated one.
 *
 * Human QC stays exactly where it was: the same approval queue, except now
 * there is something to look at.
 */
import { supabase } from "@/integrations/supabase/client";
import { preferredContentTypes, headlineFrom, bulletsFrom } from "@/lib/creativeBrief";

/** Layouts the composer supports (worker/video-renderer static paths). */
export type CreativeLayout =
  | "grid" | "search" | "filmstrip" | "features" | "echo" | "polaroid"
  | "stop_scrolling" | "serif_poster" | "framed_poster";

export interface CreativeAsset {
  id: string;
  url: string;
  title: string;
  contentType?: string | null;
}

export interface MakeCreativeResult {
  ok: boolean;
  /** The composed image/video URL, when it worked. */
  url?: string;
  /** Assets the creative was built from — the provenance a human can check. */
  usedAssets: CreativeAsset[];
  /** Set when nothing was made, in plain language. */
  refusedBecause?: string;
  renderJobId?: string;
}

const BRAND_SITE: Record<string, string> = {
  weprintwraps: "weprintwraps.com",
  restylepro: "restyleproai.com",
  designproai: "designproai.com",
  wraptvworld: "wraptvworld.com",
  wraptv: "wraptvworld.com",
  inkandedge: "inkandedgemagazine.com",
  creatormarket: "restyleproai.com",
};


/**
 * Pull candidate imagery from the Asset Library. Photos are preferred for a
 * static post (a video frame grab is a fallback, never the first choice), and
 * anything that isn't raw source material is excluded.
 */
export async function pickLibraryAssets(opts: {
  brand: string;
  caption: string;
  count?: number;
}): Promise<CreativeAsset[]> {
  const want = Math.max(1, Math.min(opts.count ?? 4, 6));
  const preferred = preferredContentTypes(opts.caption);

  const { data } = await (supabase as any)
    .from("agent_media_assets")
    .select("id, title, original_filename, storage_url, asset_type, content_type, brand")
    .not("storage_url", "is", null)
    .in("asset_type", ["image", "video"])
    .order("created_at", { ascending: false })
    .limit(400);

  const rows = ((data || []) as any[]).filter((a) =>
    // RAW ONLY — renders and audio masters are not source material.
    a.content_type !== "render" && a.content_type !== "audio_master");
  if (!rows.length) return [];

  const score = (a: any) => {
    let s = 0;
    if (a.asset_type === "image") s += 40;              // stills compose cleanest
    const ci = preferred.indexOf(String(a.content_type || ""));
    if (ci === 0) s += 30; else if (ci === 1) s += 20; else if (ci === 2) s += 10;
    if (a.brand && a.brand === opts.brand) s += 15;     // on-brand footage first
    if (!a.content_type) s -= 5;                        // untyped is a weaker bet
    return s;
  };

  return rows
    .map((a) => ({ row: a, s: score(a) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, want)
    .map(({ row }) => ({
      id: String(row.id),
      url: row.storage_url,
      title: row.title || row.original_filename || "asset",
      contentType: row.content_type,
    }));
}


/**
 * Compose the creative for one queued post and attach it to that post.
 *
 * Returns an honest result: `ok:false` with `refusedBecause` when there was
 * nothing real to build from, rather than a fabricated card.
 */
export async function makeCreativeForPost(post: {
  id: string;
  brand?: string | null;
  caption?: string | null;
  post_type?: string | null;
}, opts?: { layout?: CreativeLayout }): Promise<MakeCreativeResult> {
  const brand = post.brand || "weprintwraps";
  const caption = post.caption || "";
  if (caption.trim().length < 8) {
    return { ok: false, usedAssets: [], refusedBecause: "The draft has no real copy yet — write the caption first." };
  }

  const assets = await pickLibraryAssets({ brand, caption, count: 4 });
  if (!assets.length) {
    return {
      ok: false, usedAssets: [],
      refusedBecause: "No raw photos or footage in the Asset Library to build from. Add footage (Marketing Hub → Asset Library) and try again.",
    };
  }

  const site = BRAND_SITE[brand] || "restyleproai.com";
  const layout: CreativeLayout = opts?.layout || (assets.length >= 3 ? "grid" : "framed_poster");
  const blueprint = {
    id: `creative_${post.id.slice(0, 8)}_${Date.now()}`,
    kind: "static_post",
    layout,
    platform: "instagram",
    totalDuration: 0,
    aspectRatio: "9:16",
    format: "static",
    source: "auto_assemble",
    brand,
    title: headlineFrom(caption),
    headline: headlineFrom(caption),
    suggestions: bulletsFrom(caption),
    footer: `@${site.replace(/\..*$/, "")}`,
    siteUrl: site,
    scenes: assets.map((a, i) => ({
      sceneId: `asset_${i}`,
      clipId: a.id,
      clipUrl: a.url,
      start: 0,
      end: 2,
      purpose: i === 0 ? "hook" : "b_roll",
    })),
  };

  const { data, error } = await supabase.functions.invoke("video-render", {
    body: { blueprint, brand, source_ref: `make_creative_${post.id}` },
  });
  if (error) return { ok: false, usedAssets: assets, refusedBecause: `Composer failed: ${error.message}` };
  if (data?.ok === false) return { ok: false, usedAssets: assets, refusedBecause: data?.error || "Composer failed" };

  const url: string | undefined = data?.final_url || undefined;
  if (!url) {
    // STILL COMPOSING — the usual path, not the exception. A real compose takes
    // minutes, so this branch is what almost every press lands in.
    //
    // It used to say "give it a minute, then refresh the queue" and stop there.
    // Nothing refreshed it: no poll, no callback, no second pass. The render
    // finished, the file landed on the Brand Board as an anonymous card, and
    // the post stayed copy-only forever — proven live, post 2030115d still
    // empty 21h after render 739c93a7 completed. Pressing the button again
    // would spend a second render to produce the same file.
    //
    // So the link is RECORDED here, and `worker/video-renderer/reattach.js`
    // completes it on the next five-minute pass. The marker is also what the
    // Director and the Brand Board render the in-progress clock from — work in
    // flight is visible instead of looking like nothing happened.
    const jobId = data?.render_job_id ? String(data.render_job_id) : null;
    if (jobId) {
      const { data: cur } = await (supabase as any)
        .from("agent_social_posts").select("generation_meta").eq("id", post.id).maybeSingle();
      const meta = (cur?.generation_meta && typeof cur.generation_meta === "object") ? cur.generation_meta : {};
      await (supabase as any).from("agent_social_posts").update({
        generation_meta: { ...meta, pending_render_job_id: jobId, pending_render_since: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }).eq("id", post.id);
    }
    return {
      ok: false, usedAssets: assets, renderJobId: jobId || undefined,
      refusedBecause: jobId
        ? "Composing now — it attaches itself when the render finishes (within about five minutes). You can leave this page."
        : "Composer did not return a job id, so this creative cannot be tracked. Press again.",
    };
  }

  // Attach to the post + record PROVENANCE so a human can see what it's made
  // of. Never overwrite media a person already attached by hand.
  const { data: current } = await (supabase as any)
    .from("agent_social_posts").select("media_urls").eq("id", post.id).maybeSingle();
  const existing: string[] = Array.isArray(current?.media_urls) ? current.media_urls : [];
  const { error: upErr } = await (supabase as any)
    .from("agent_social_posts")
    .update({
      media_urls: existing.length ? [...existing, url] : [url],
      updated_at: new Date().toISOString(),
    })
    .eq("id", post.id);
  if (upErr) return { ok: false, url, usedAssets: assets, refusedBecause: `Composed, but couldn't attach it: ${upErr.message}` };

  return { ok: true, url, usedAssets: assets, renderJobId: data?.render_job_id };
}
