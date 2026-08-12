/**
 * useAutoBuildVideo — one-button AI auto-build for the Engine Room Video Studio.
 *
 * Orchestrates the RestylePro-native pipeline (docs/VIDEO-AUTOCREATE-PILOT-KICKOFF.md):
 *   clips:  video-auto-assemble  (AI picks + trims clips from agent_media_assets)
 *   OR      content_moments      (Parse Footage hook-scored moments, long-form fast-cut)
 *   words:  video-captions       (timeline captions)
 *   sound:  video-music          (library match — optional, degrades silently)
 *   pixels: video-render         (enqueue video_render_jobs → ffmpeg worker)
 *
 * Formats: reel (9:16 ~24s) | short (9:16 ~50s) | youtube (16:9 long-form,
 * built from Parse Footage moments when available, else library clips).
 */
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BuildFormat = "reel" | "short" | "youtube" | "static" | "carousel";

export type StaticLayout =
  | "grid" | "search" | "filmstrip" | "features" | "echo"
  | "polaroid" | "stop_scrolling" | "incoming_call" | "whats_in_my_bag"
  | "serif_poster" | "framed_poster";

export const FORMAT_SPECS: Record<
  BuildFormat,
  { label: string; aspectRatio: "9:16" | "16:9" | "4:5"; duration: number; platform: string; maxScenes: number }
> = {
  reel: { label: "Reel (IG/TikTok)", aspectRatio: "9:16", duration: 24, platform: "instagram", maxScenes: 8 },
  short: { label: "YouTube Short", aspectRatio: "9:16", duration: 50, platform: "youtube", maxScenes: 12 },
  youtube: { label: "YouTube Long-Form", aspectRatio: "16:9", duration: 180, platform: "youtube", maxScenes: 40 },
  static: { label: "Static Post", aspectRatio: "9:16", duration: 0, platform: "instagram", maxScenes: 6 },
  carousel: { label: "Carousel (IG swipe)", aspectRatio: "4:5", duration: 0, platform: "instagram", maxScenes: 6 },
};

// Real WPW product facts for the features-callout template (never invented)
const WPW_FEATURE_PILLS = [
  "3M IJ180 & Avery MPI 1105 premium film",
  "Every file gets a human preflight",
  "Printed, laminated & panel-labeled",
  "Ships in 1-2 business days",
  "Premium Wrap Guarantee",
];

// Site URL burned onto static posts, per brand
const BRAND_SITE: Record<string, string> = {
  weprintwraps: "weprintwraps.com",
  restylepro: "restyleproai.com",
  designproai: "designproai.com",
  wraptvworld: "wraptvworld.com",
  inkandedge: "inkandedgemagazine.com",
};

export interface BuildProgress {
  step: "idle" | "clips" | "captions" | "music" | "render" | "queued" | "error";
  detail: string;
  renderJobId?: string;
  error?: string;
}

interface RendererCaption {
  text: string;
  time: number;
  duration: number;
  position?: "top" | "center" | "bottom";
}

export function useAutoBuildVideo() {
  const [progress, setProgress] = useState<BuildProgress>({ step: "idle", detail: "" });
  const [building, setBuilding] = useState(false);

  const autoBuild = async (opts: {
    format: BuildFormat;
    topic: string;
    brand?: string;
    style?: "standard" | "wpw_dark_clean";
    layout?: StaticLayout;
    /** Video-only composition template (e.g. "chaptered_vlog" stacked panels). */
    template?: "chaptered_vlog";
    /** Opt-in soundtrack. Reserved for deliberate installer mashups — never auto-applied. */
    musicUrl?: string;
  }) => {
    const spec = FORMAT_SPECS[opts.format];
    const brand = opts.brand || "weprintwraps";
    setBuilding(true);
    try {
      // ── 1. scenes ────────────────────────────────────────────────────────
      setProgress({ step: "clips", detail: "AI selecting clips…" });
      let scenes: Array<{
        sceneId: string; clipId: string; clipUrl: string; start: number; end: number;
        purpose: string; text?: string; textPosition?: "top" | "center" | "bottom";
      }> = [];
      let concept = opts.topic;
      let hook = "";
      let cta = "";

      // Long-form prefers Parse Footage moments (hook-scored, transcript-backed).
      if (opts.format === "youtube") {
        const { data: sources } = await supabase
          .from("media_sources" as any)
          .select("id, media_url, duration_seconds, transcript")
          .not("transcript", "is", null)
          .order("created_at", { ascending: false })
          .limit(10) as any;
        const withUrl = (sources || []).filter((s: any) => s.media_url);
        if (withUrl.length) {
          const ids = withUrl.map((s: any) => s.id);
          const { data: moments } = await supabase
            .from("content_moments" as any)
            .select("source_id, start_time, end_time, verbatim_quote, hook_score")
            .in("source_id", ids)
            .order("hook_score", { ascending: false })
            .limit(spec.maxScenes) as any;
          const urlById = Object.fromEntries(withUrl.map((s: any) => [s.id, s.media_url]));
          scenes = (moments || [])
            .filter((m: any) => urlById[m.source_id])
            .map((m: any, i: number) => ({
              sceneId: `moment_${i}`,
              clipId: String(m.source_id),
              clipUrl: urlById[m.source_id],
              start: Number(m.start_time || 0),
              end: Number(m.end_time || Number(m.start_time || 0) + 5),
              purpose: i === 0 ? "hook" : "proof",
            }));
          hook = moments?.[0]?.verbatim_quote || "";
        }
      }

      // Reels/shorts (and long-form fallback): AI library assembly.
      if (!scenes.length) {
        const { data, error } = await supabase.functions.invoke("video-auto-assemble", {
          body: { topic: opts.topic, video_duration: spec.duration || 15, content_type: opts.format },
        });
        if (error) throw new Error(`clip selection failed: ${error.message}`);
        if (data?.error) throw new Error(`clip selection: ${data.error}`);
        const picked = (data?.selected_videos || []).filter((v: any) => v.storage_url);
        if (!picked.length) throw new Error("No usable clips — hydrate the library (drive-sync) or parse footage first.");
        concept = data?.reel_concept || opts.topic;
        hook = data?.suggested_hook || "";
        cta = data?.suggested_cta || "";
        scenes = picked.slice(0, spec.maxScenes).map((v: any, i: number) => ({
          sceneId: `scene_${i}`,
          clipId: String(v.id),
          clipUrl: v.storage_url,
          start: Number(v.trim_start || 0),
          end: Number(v.trim_end ?? Number(v.trim_start || 0) + 4),
          purpose: i === 0 ? "hook" : "b_roll",
          text: v.suggested_overlay || undefined,
          textPosition: "bottom" as const,
        }));
      }

      const totalDuration = scenes.reduce((t, s) => t + Math.max(0.5, s.end - s.start), 0);

      // Static post / carousel: no captions/music — compose image(s) and stop.
      if (opts.format === "static" || opts.format === "carousel") {
        setProgress({ step: "render", detail: opts.format === "carousel" ? "Composing slides…" : "Composing post…" });
        const site = BRAND_SITE[brand] || "weprintwraps.com";
        const handle = "@" + site.replace(/\..*$/, "");
        const layout = opts.layout || "grid";
        // Per-layout text-slot defaults (docs/CONTENT-TEMPLATE-LIBRARY.md):
        // headline/suggestions/actions map onto each template's slots.
        const headline =
          layout === "search" ? opts.topic.split(/\s+/).slice(0, 3).join(" ")
          : layout === "echo" ? opts.topic.split(/\s+/).slice(0, 2).join(" ")
          : layout === "features" ? "Why shops print with us"
          : layout === "stop_scrolling" ? "stop scrolling!"
          : layout === "incoming_call" ? opts.topic.split(/\s+/).slice(0, 4).join(" ")
          : layout === "whats_in_my_bag" ? "What's in the box?"
          : (hook || concept);
        const suggestions =
          layout === "search" ? [hook, cta, `printed at ${site}`].filter(Boolean).slice(0, 3)
          : layout === "features" ? WPW_FEATURE_PILLS
          : layout === "whats_in_my_bag" ? (brand === "weprintwraps" ? WPW_FEATURE_PILLS : [hook, cta, concept].filter(Boolean))
          : layout === "incoming_call" ? [handle]
          : layout === "serif_poster" ? [hook, cta, site].filter(Boolean).slice(0, 4)
          : layout === "framed_poster" ? [hook || cta].filter(Boolean)
          : undefined;
        const blueprint = {
          id: `autobuild_${Date.now()}`,
          kind: opts.format === "carousel" ? "carousel" : "static_post",
          layout,
          platform: spec.platform,
          totalDuration: 0,
          aspectRatio: spec.aspectRatio,
          format: opts.format,
          source: "auto_assemble",
          brand,
          title: concept,
          headline: opts.format === "carousel" ? (hook || concept) : headline,
          suggestions,
          footer: ["polaroid", "stop_scrolling", "whats_in_my_bag", "framed_poster"].includes(layout)
            ? handle
            : cta || "Available now",
          siteUrl: site,
          scenes,
          ...(opts.format === "carousel" && cta ? { endCard: { text: concept, cta } } : {}),
        };
        const { data: renderData, error: renderErr } = await supabase.functions.invoke("video-render", {
          body: { blueprint, brand, source_ref: `videostudio_${opts.format}` },
        });
        if (renderErr) throw new Error(`render enqueue failed: ${renderErr.message}`);
        if (renderData?.ok === false) throw new Error(renderData?.error || "render failed");
        setProgress({
          step: "queued",
          detail: renderData?.final_url ? "Post ready!" : "Composing — track it in Renders below.",
          renderJobId: renderData?.render_job_id,
        });
        return renderData;
      }

      // ── 2. captions ──────────────────────────────────────────────────────
      setProgress({ step: "captions", detail: "Writing captions…" });
      let captions: RendererCaption[] = [];
      try {
        const { data: capData } = await supabase.functions.invoke("video-captions", {
          body: {
            prompt: `${concept}. Hook: ${hook}. CTA: ${cta}`,
            concept, hook, cta,
            duration: Math.round(totalDuration),
            style: "sabri",
          },
        });
        captions = (capData?.captions || []).map((c: any) => ({
          text: `${c.emoji ? c.emoji + " " : ""}${c.text}`,
          time: Number(c.start || 0),
          duration: Math.max(0.8, Number(c.end || 0) - Number(c.start || 0)),
          position: "center" as const,
        }));
      } catch {
        // captions are additive — never block the build
      }

      // ── 3. music ─────────────────────────────────────────────────────────
      // NO auto-music. "The Wrap Game" (and any anthem) is reserved for
      // deliberate installer mashups ONLY — it must never be slapped onto
      // every render, and never onto Behind Shop Doors documentary content
      // (natural sound only). Music is opt-in via opts.musicUrl; default none.
      const musicUrl: string | null = opts.musicUrl || null;

      // ── 4. render ────────────────────────────────────────────────────────
      setProgress({ step: "render", detail: "Queuing render…" });
      const blueprint = {
        id: `autobuild_${Date.now()}`,
        platform: spec.platform,
        totalDuration,
        aspectRatio: spec.aspectRatio,
        format: opts.format,
        source: "auto_assemble",
        brand,
        title: concept,
        scenes,
        // Keep the clips' ORIGINAL audio (owner 2026-07-29). This path never
        // set the flag, and the worker used to default it OFF — so every
        // Auto-Build reel rendered silent. Music, when chosen, ducks under it.
        keepNativeAudio: true,
        ...(opts.style && opts.style !== "standard" ? { stylePack: opts.style } : {}),
        ...(opts.template === "chaptered_vlog"
          ? { template: "chaptered_vlog", headline: hook || concept, subline: new Date().toLocaleDateString() }
          : {}),
        ...(cta && opts.template !== "chaptered_vlog" ? { endCard: { duration: 2.5, text: concept, cta } } : {}),
      };
      const { data: renderData, error: renderErr } = await supabase.functions.invoke("video-render", {
        body: { blueprint, music_url: musicUrl, captions, brand, source_ref: `videostudio_${opts.format}` },
      });
      if (renderErr) throw new Error(`render enqueue failed: ${renderErr.message}`);
      if (renderData?.ok === false) throw new Error(renderData?.error || "render failed");

      setProgress({
        step: "queued",
        detail: renderData?.final_url ? "Render complete!" : "Rendering — track it in Renders below.",
        renderJobId: renderData?.render_job_id,
      });
      return renderData;
    } catch (err: any) {
      setProgress({ step: "error", detail: "", error: err?.message || String(err) });
      throw err;
    } finally {
      setBuilding(false);
    }
  };

  return { autoBuild, building, progress, setProgress };
}
