// CutEditor — the team-assists-AI editing tool.
//
// Every render card gets ✂️ Edit: it opens the job's ACTUAL blueprint so a
// human can fix what the AI got wrong — trim scene in/out points, rewrite or
// remove overlay text, reorder or drop scenes, swap the music track, skip a
// slow intro (music start), change the end card — then Re-render sends the
// edited blueprint back through the same deterministic ffmpeg worker via
// video-render. AI cuts, humans direct, the machine re-renders.
import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { musicPolicy } from "@/lib/musicPolicy";
import { assetThumb } from "@/lib/assetThumb";
import { resolveAssetType } from "@/lib/assetContentType";

/**
 * A still, not footage. The worker decides the same way (extension on the
 * clipUrl) and loops the image for the scene's duration — so the UI must
 * render it with <img>. A <video> tag pointed at a .jpg is the black-tile bug.
 */
function isImageUrl(u?: string): boolean {
  return /\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(u || "");
}
import { Loader2, ArrowUp, ArrowDown, X, Copy, Scissors } from "lucide-react";
import { toast } from "sonner";

interface Scene {
  sceneId?: string;
  clipUrl: string;
  start: number;
  end: number;
  text?: string;
  textPosition?: string;
  purpose?: string;
}

export default function CutEditor({
  job,
  onClose,
  onQueued,
  initialTab,
}: {
  job: { id: string; brand?: string; music_url?: string | null; blueprint?: any; final_url?: string | null; thumbnail_url?: string | null };
  onClose: () => void;
  onQueued: () => void;
  /** Open straight on a section (render cards deep-link to "finish" for logo). */
  initialTab?: "scenes" | "text" | "music" | "finish";
}) {
  const bp = job.blueprint || {};
  const [title, setTitle] = useState<string>(bp.title || "");
  const [scenes, setScenes] = useState<Scene[]>(
    (bp.scenes || []).map((s: any) => ({ ...s, start: Number(s.start || 0), end: Number(s.end || 0) })),
  );
  const [musicUrl, setMusicUrl] = useState<string>(job.music_url || "");
  const [musicStart, setMusicStart] = useState<number>(Number(bp.musicStart || 0));
  const [musicEnd, setMusicEnd] = useState<number>(Number(bp.musicEnd || 0));
  // Audio player for the chosen track, so start/end are set by ear, not blind.
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const [musicDur, setMusicDur] = useState<number>(0);
  const [endText, setEndText] = useState<string>(bp.endCard?.text || "");
  const [endCta, setEndCta] = useState<string>(bp.endCard?.cta || "");

  // ── THE BOTTOM TICKER ─────────────────────────────────────────────────────
  // The worker has drawn this since 2026-08-05 (tickerFilters) and BrandCast's
  // BTI treatment sets it — but the Cut Editor, the ONE place an existing cut
  // gets revised, had no control for it. So a finished cut could never have a
  // ticker added: the only route was starting a brand-new BTI cut from
  // scratch. Every WrapTVWorld render on the board predates the feature and
  // has none.
  //
  // One name per line, because shop names contain commas ("Royalty Wraps,
  // Tampa") and a comma-split would shred them.
  const [tickerLabel, setTickerLabel] = useState<string>(bp.ticker?.label || "FEATURED SHOPS");
  const [tickerNames, setTickerNames] = useState<string>((bp.ticker?.names || []).join("\n"));

  // Logo bug (stamped top-right by the render worker). The worker honors
  // blueprint.logoUrl (explicit) / logo:false (none), else a brand default.
  // Switching here + Re-render stamps the chosen logo over the corner —
  // covering a corner watermark baked into the source footage.
  // NOTE: this file is NAMED "wraptv-bug" but is actually the WePrintWraps
  // logo (verified 2026-07-29) — which is why wraptvworld renders came out
  // stamped WPW. Labeled honestly in the picker below.
  const WPW_LOGO = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/brand-logos/1784237894028-wraptv-bug.png";
  const [logoChoice, setLogoChoice] = useState<string>(
    bp.logo === false ? "none" : bp.logoUrl === WPW_LOGO ? "wpw" : bp.logoUrl ? "custom" : "brand",
  );
  const [customLogo, setCustomLogo] = useState<string>(
    bp.logoUrl && bp.logoUrl !== WPW_LOGO ? bp.logoUrl : "",
  );
  // Logos are often flat RGB with no alpha and stamp as a WHITE BOX — this
  // knocks the white out. Size + corner are tunable too.
  const [logoKnockWhite, setLogoKnockWhite] = useState<boolean>(bp.logoKnockWhite ?? true);
  const [logoScale, setLogoScale] = useState<number>(Number(bp.logoScale) || 0.15);
  const [logoPosition, setLogoPosition] = useState<string>(bp.logoPosition || "tr");

  // Format (9:16 reel / 16:9 long-form) — the worker renders to bp.aspectRatio.
  const [aspectRatio, setAspectRatio] = useState<string>(
    bp.aspectRatio || (bp.format === "youtube" || bp.format === "long" ? "16:9" : "9:16"),
  );
  // Documentary color grade — deterministic worker presets. The doc-edit
  // brain picks one; here the human keeps or changes it on re-render.
  const [grade, setGrade] = useState<string>(bp.grade || "");
  // Mirrors the worker's audio-intent rule exactly (see video-renderer):
  // explicit flag wins; otherwise native audio is ON unless the job already
  // has a MUSIC TRACK, in which case it opens music-led. That last case is
  // what protects the WrapTVWorld music videos — opening one and re-rendering
  // must not duck its song under shop noise.
  const [keepAudio, setKeepAudio] = useState<boolean>(
    bp.keepNativeAudio === undefined || bp.keepNativeAudio === null
      ? !job.music_url
      : bp.keepNativeAudio !== false,
  );
  // Overlay font (Google fonts bundled in the worker). "oswald" pairs with the
  // bold dark-scrim look; "playfair"/"clean" use the boxed style.
  const [font, setFont] = useState<string>(
    bp.font || (bp.stylePack === "wpw_dark_clean" ? "oswald" : "clean"),
  );
  // Text size — global multiplier on every overlay/caption. Reels chop long
  // lines at the default; the worker now wraps to fit, and S/M/L tunes size.
  const [textScale, setTextScale] = useState<number>(Number(bp.textScale) || 1);
  // Auto-smooth ("beauty") — softens skin + evens harsh/flat lighting, then
  // re-sharpens edges. Whole-frame, opt-in; applied by the worker on re-render.
  const [autoSmooth, setAutoSmooth] = useState<boolean>(!!bp.autoSmooth);
  // "skin" = smooth only skin-tone pixels (face + neck), leaving clothes/bg
  // sharp; "frame" = whole-frame edge-preserving smooth.
  const [autoSmoothTarget, setAutoSmoothTarget] = useState<string>(bp.autoSmoothTarget || "skin");

  // Preview player: which scene is expanded to watch/scrub, so a human can set
  // trim points by eye instead of typing seconds blind.
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  // Full length of the clip being previewed — drives the visual trim slider.
  const [previewDur, setPreviewDur] = useState<number>(0);
  const secLabel = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

  // Plain-language "how to use this" strip — for showing Amanda. Collapsible.
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // Section tabs — every control gets an obvious home ("where are the fonts /
  // how do I add music" should never be a scroll hunt).
  const [tab, setTab] = useState<"scenes" | "text" | "music" | "finish">(initialTab || "scenes");
  // Show the FINISHED render right at the top — proof you opened the video you
  // were actually watching ("edit doesn't take me to the exact video").
  const [showFinished, setShowFinished] = useState<boolean>(!!job.final_url);

  // ALWAYS-VISIBLE live preview ("I need to see video while I edit"): a
  // sticky player that loops the selected scene's exact trimmed cut, with
  // the overlay text drawn on it in the chosen font/size — visible from
  // every tab, so font/size/text changes show instantly.
  const [pv, setPv] = useState(0);
  const pvVideoRef = useRef<HTMLVideoElement | null>(null);
  const PV_FONT: Record<string, string> = {
    anton: "'Anton', Impact, sans-serif",
    bebas: "'Bebas Neue', Impact, sans-serif",
    oswald: "Oswald, sans-serif",
    playfair: "'Playfair Display', Georgia, serif",
    clean: "Inter, sans-serif",
  };
  // Display fonts render UPPERCASE in the worker's dark-scrim style.
  const PV_UPPER = new Set(["oswald", "anton", "bebas"]);
  // Swap a scene's clip for another from the library (⇄ on each scene).
  const [swapIdx, setSwapIdx] = useState<number | null>(null);
  const { data: swapClips } = useQuery({
    queryKey: ["cuteditor-swap-library"],
    enabled: swapIdx !== null,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("agent_media_assets")
        .select("id, title, original_filename, storage_url, thumbnail_url, drive_file_id, asset_type")
        .not("storage_url", "is", null)
        .neq("asset_type", "image")
        .order("created_at", { ascending: false })
        .limit(48);
      return ((data || []) as any[])
        .filter((a) => !/\.(mp3|wav|m4a|aac)(\?.*)?$/i.test(a.storage_url || ""));
    },
  });

  // ── ADD footage or a PHOTO to the edit ────────────────────────────────────
  // The editor could swap, split, duplicate and delete — but never ADD. There
  // was no way to put another clip, or any photo, INTO a cut. Photos were
  // doubly blocked: the swap picker filters asset_type='image' out entirely.
  // The worker already renders a still (it loops an image URL for the scene's
  // duration), so an image scene is just a scene whose clipUrl is an image.
  const [addOpen, setAddOpen] = useState(false);
  const [uploadingAdd, setUploadingAdd] = useState(false);
  const { data: addLibrary } = useQuery({
    queryKey: ["cuteditor-add-library"],
    enabled: addOpen,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("agent_media_assets")
        .select("id, title, original_filename, storage_url, thumbnail_url, drive_file_id, asset_type, content_type")
        .not("storage_url", "is", null)
        .in("asset_type", ["video", "image"])
        .order("created_at", { ascending: false })
        .limit(90);
      return ((data || []) as any[])
        // RAW source only — finished renders and archived audio masters are
        // not material you cut FROM.
        .filter((a) => a.content_type !== "render" && a.content_type !== "audio_master")
        .filter((a) => !/\.(mp3|wav|m4a|aac|flac|ogg)(\?.*)?$/i.test(a.storage_url || ""));
    },
  });

  /** Append a scene. Stills get 3s (long enough to read, short enough to move). */
  const addScene = (url: string, label?: string) => {
    const still = isImageUrl(url);
    setScenes((prev) => [...prev, {
      sceneId: `s${prev.length}_${Date.now().toString(36)}`,
      clipId: label || "added",
      clipUrl: url,
      start: 0,
      end: still ? 3 : 4,
      purpose: "b_roll",
    } as Scene]);
    setAddOpen(false);
    toast.success(`${still ? "Photo" : "Clip"} added at the end — drag it up with ⬆, trim it, then Re-render.`);
  };

  const uploadAndAdd = async (file: File) => {
    setUploadingAdd(true);
    try {
      // HAD NO AUDIO BRANCH: `isImg ? "image" : "video"` typed every dropped
      // mp3 as `video`, the exact fall-through CLAUDE.md records as having
      // made the song catalogue vanish three times. One resolver now, reading
      // extension AND mime.
      const { assetType } = resolveAssetType({ filename: file.name, mimeType: file.type });
      const isImg = assetType === "image";
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
      const path = `content-uploads/cut-editor/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("wrap-files")
        .upload(path, file, { contentType: file.type || (isImg ? "image/jpeg" : "video/mp4"), upsert: false });
      if (upErr) throw upErr;
      const url = supabase.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
      await (supabase as any).from("agent_media_assets").insert({
        asset_type: assetType, storage_url: url,
        title: safe.replace(/\.[^.]+$/, "").replace(/-/g, " "),
        original_filename: file.name, source_folder: "cut-editor",
        file_size_bytes: file.size,
      });
      await qc.invalidateQueries({ queryKey: ["cuteditor-add-library"] });
      addScene(url, file.name);
    } catch (e: any) {
      toast.error("Upload failed: " + (e?.message || e));
    } finally {
      setUploadingAdd(false);
    }
  };

  // Saved hooks (Hooks Manager → content_hooks) for this job's brand, to drop
  // onto a scene as an overlay.
  const [brandHooks, setBrandHooks] = useState<{ id: string; text: string }[]>([]);
  useEffect(() => {
    const brand = job.brand || bp.brand || "weprintwraps";
    let cancelled = false;
    (async () => {
      const { data } = await (supabase as any)
        .from("content_hooks")
        .select("id, text")
        .eq("brand", brand)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(50);
      if (!cancelled) setBrandHooks((data || []) as { id: string; text: string }[]);
    })();
    return () => { cancelled = true; };
  }, [job.brand, bp.brand]);

  const qc = useQueryClient();
  // Upload a new song straight into the music library, then select it.
  const [uploadingSong, setUploadingSong] = useState(false);
  const uploadSong = async (file: File) => {
    if (!file) return;
    setUploadingSong(true);
    try {
      const path = `music-library/${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
      const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, file, { contentType: file.type || "audio/mpeg", upsert: false });
      if (upErr) throw upErr;
      const url = supabase.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
      const { error: insErr } = await (supabase as any).from("video_music_library")
        .insert({ title: file.name.replace(/\.[^.]+$/, ""), storage_url: url, genre: "uploaded" });
      if (insErr) throw insErr;
      toast.success(`Added "${file.name}" to the music library.`);
      await qc.invalidateQueries({ queryKey: ["music-library"] });
      setMusicUrl(url); setMusicStart(0); setMusicEnd(0);
    } catch (e: any) {
      toast.error("Song upload failed: " + (e?.message || e));
    } finally {
      setUploadingSong(false);
    }
  };

  // THE FULL CATALOG, unified: video_music_library (the produced "house"
  // tracks — mood/genre/bpm metadata used by video-music's auto-match) PLUS
  // any song sitting in the general clip library (agent_media_assets,
  // asset_type='audio' — Drive syncs, the VideoStudio uploader, or anything
  // dropped in before that upload path knew how to detect audio). This is
  // the actual root fix for "I had a catalog of 10 songs" — half of them
  // were only ever in the general library and this tab never looked there.
  // Deduped by storage_url so a song registered in both never shows twice.
  const { data: tracks } = useQuery({
    queryKey: ["music-library"],
    queryFn: async () => {
      const [house, library] = await Promise.all([
        (supabase as any).from("video_music_library")
          .select("title, storage_url, genre").order("created_at", { ascending: false }).limit(100),
        // MUSIC ONLY. The parser archives a 32kbps mp3 of every parsed clip
        // (content_type='audio_master') — ~100 tracks of people TALKING. They
        // are source audio, never a soundtrack, and they buried the real
        // catalog in this list. Excluded here; `or` (not neq) because a plain
        // `content_type != 'audio_master'` is NULL-false and would also drop
        // every untyped song.
        (supabase as any).from("agent_media_assets")
          .select("title, original_filename, storage_url").eq("asset_type", "audio")
          .or("content_type.is.null,content_type.neq.audio_master")
          .order("created_at", { ascending: false }).limit(100),
      ]);
      const seen = new Set<string>();
      const merged: { title: string; storage_url: string; genre?: string }[] = [];
      for (const t of (house.data || []) as any[]) {
        if (!t.storage_url || seen.has(t.storage_url)) continue;
        seen.add(t.storage_url); merged.push(t);
      }
      for (const a of (library.data || []) as any[]) {
        if (!a.storage_url || seen.has(a.storage_url)) continue;
        seen.add(a.storage_url);
        merged.push({ title: a.title || a.original_filename || "song", storage_url: a.storage_url, genre: "your library" });
      }
      return merged;
    },
  });

  // Upload a logo straight into brand-logos/ and select it (the only way to
  // get a brand's mark on a video when no asset exists yet — e.g. WrapTVWorld).
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const uploadLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
      const path = `brand-logos/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("wrap-files")
        .upload(path, file, { contentType: file.type || "image/png", upsert: false });
      if (upErr) throw upErr;
      const url = supabase.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
      setCustomLogo(url);
      setLogoChoice("custom");
      toast.success("Logo uploaded and selected — hit Re-render to stamp it.");
    } catch (e: any) {
      toast.error("Logo upload failed: " + (e?.message || e));
    } finally {
      setUploadingLogo(false);
    }
  };

  // Upload a NEW video clip straight into the library from the swap panel.
  const [uploadingClip, setUploadingClip] = useState(false);
  const uploadClipAndSwap = async (i: number, file: File) => {
    setUploadingClip(true);
    try {
      // HARDCODED `asset_type: "video"` before this — a photo or a song
      // swapped in here was registered in the library as video. Resolved from
      // the file now, like every other uploader.
      const { assetType } = resolveAssetType({ filename: file.name, mimeType: file.type });
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
      const path = `content-uploads/cut-editor/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("wrap-files")
        .upload(path, file, { contentType: file.type || "video/mp4", upsert: false });
      if (upErr) throw upErr;
      const url = supabase.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
      await (supabase as any).from("agent_media_assets").insert({
        asset_type: assetType, storage_url: url,
        title: safe.replace(/\.[^.]+$/, "").replace(/-/g, " "),
        original_filename: file.name, source_folder: "cut-editor",
        file_size_bytes: file.size,
      });
      await qc.invalidateQueries({ queryKey: ["cuteditor-swap-library"] });
      setScenes((s) => s.map((sc, j) => j === i
        ? { ...sc, clipUrl: url, start: 0, end: Math.max(1.5, Number(sc.end) - Number(sc.start)) || 4 }
        : sc));
      setSwapIdx(null);
      toast.success("Clip uploaded + swapped in — trim it, then Re-render.");
    } catch (e: any) {
      toast.error("Clip upload failed: " + (e?.message || e));
    } finally {
      setUploadingClip(false);
    }
  };

  // What IS this footage? The clips carry their Asset Library classification;
  // the policy turns that into "may this cut have a music bed".
  const { data: clipTypes } = useQuery({
    queryKey: ["cuteditor-clip-types", job.id],
    queryFn: async () => {
      const urls = [...new Set(scenes.map((s) => s.clipUrl).filter(Boolean))].slice(0, 40);
      if (!urls.length) return [] as string[];
      const { data } = await (supabase as any)
        .from("agent_media_assets").select("storage_url, content_type").in("storage_url", urls);
      return ((data || []) as any[]).map((a) => a.content_type).filter(Boolean) as string[];
    },
  });
  const musicVerdict = musicPolicy(clipTypes || []);

  const update = (i: number, patch: Partial<Scene>) =>
    setScenes((s) => s.map((sc, j) => (j === i ? { ...sc, ...patch } : sc)));
  const move = (i: number, dir: -1 | 1) =>
    setScenes((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const remove = (i: number) => setScenes((s) => s.filter((_, j) => j !== i));
  // Cut tools for the human editor to assist the AI:
  const duplicate = (i: number) =>
    setScenes((s) => [...s.slice(0, i + 1), { ...s[i], sceneId: undefined }, ...s.slice(i + 1)]);
  const split = (i: number) =>
    setScenes((s) => {
      const sc = s[i];
      const mid = Number(((Number(sc.start) + Number(sc.end)) / 2).toFixed(2));
      if (mid <= Number(sc.start) + 0.2 || mid >= Number(sc.end) - 0.2) { toast.info("Scene too short to split"); return s; }
      return [...s.slice(0, i), { ...sc, end: mid, sceneId: undefined }, { ...sc, start: mid, sceneId: undefined }, ...s.slice(i + 1)];
    });
  // Slice tool: cut a scene at the exact playhead position (where you scrubbed
  // the preview to), so the team can split on a specific frame — not the midpoint.
  const sliceAt = (i: number, t: number) =>
    setScenes((s) => {
      const sc = s[i];
      const cut = Number(t.toFixed(2));
      if (cut <= Number(sc.start) + 0.2 || cut >= Number(sc.end) - 0.2) { toast.info("Scrub the player into the middle of the clip, then Slice here."); return s; }
      return [...s.slice(0, i), { ...sc, end: cut, sceneId: undefined }, { ...sc, start: cut, sceneId: undefined }, ...s.slice(i + 1)];
    });

  // AI hook options ("what the AI sees" → scroll-stopping overlay lines), plus
  // the brand's saved hooks. The team picks one per scene as the on-screen text.
  const [hookPool, setHookPool] = useState<{ text: string; score?: number }[]>([]);
  // The customer we're selling to — steers who every hook speaks to.
  const [audience, setAudience] = useState<string>(bp.audience || "");
  const suggestHooks = useMutation({
    // angle "why" = SELL THE WHY: benefit/reason-led lines, not descriptions.
    mutationFn: async (angle?: "why") => {
      const baseTopic = title || bp.title || "";
      const aud = audience.trim() ? ` AUDIENCE = the customer we're selling to: ${audience.trim()}. Speak directly to them.` : "";
      const topic = (angle === "why"
        ? `${baseTopic}. ANGLE = SELL THE WHY. Every hook must make the viewer feel WHY they need this now — the cost of a cheap or worn wrap, what they lose by waiting, and the payoff of doing it right. Lead with the reason and the benefit, never a flat description. End-worthy on a strong reason-to-act.`
        : baseTopic) + aud;
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "hooks", topic, brand: job.brand || bp.brand || "weprintwraps", count: 10, audience: audience.trim() || undefined },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return (data?.hooks || []) as { text: string; score?: number }[];
    },
    onSuccess: (h) => {
      setHookPool(h);
      toast.success(h.length ? `${h.length} hook ideas — pick one on any scene.` : "No hooks came back — try a clearer title.");
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't get hook ideas"),
  });
  // Combined overlay options offered on each scene: AI hooks first, then saved.
  const overlayOptions = [
    ...hookPool.map((h) => h.text).filter(Boolean),
    ...brandHooks.map((h) => h.text),
  ].filter((t, i, a) => t && a.indexOf(t) === i);

  // ⚡ AI Auto-Cut — the mashup recipe: hook-first order, 1.5-4s beat cuts,
  // punch text, music drop at frame one. Loads the result into the editor
  // for review; nothing renders until the human hits Re-render.
  const autocut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "autocut", blueprint: { ...bp, title, scenes } },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      setScenes((d.scenes || []).map((s: any) => ({ ...s, start: Number(s.start || 0), end: Number(s.end || 0) })));
      if (d.title) setTitle(d.title);
      if (d.musicStart > 0) setMusicStart(d.musicStart);
      toast.success("Auto-cut applied — review the scenes, then Re-render.");
    },
    onError: (e: any) => toast.error(e?.message || "Auto-cut failed"),
  });

  const rerender = useMutation({
    mutationFn: async () => {
      if (!scenes.length) throw new Error("Keep at least one scene");
      // Resolve the logo bug for the worker: none → logo:false; wraptv/custom →
      // explicit logoUrl; brand default → clear both so the worker uses the
      // brand's default. Undefined clears any prior value on the blueprint.
      // One name per line; blanks and duplicates dropped so the crawl doesn't
      // stutter on a repeated shop.
      const tickerList = Array.from(new Set(
        tickerNames.split("\n").map((n) => n.trim()).filter(Boolean),
      ));

      const logoFields = {
        ...(logoChoice === "none" ? { logo: false, logoUrl: undefined }
          : logoChoice === "wpw" ? { logo: undefined, logoUrl: WPW_LOGO }
          : logoChoice === "custom" ? { logo: undefined, logoUrl: customLogo.trim() || undefined }
          : { logo: undefined, logoUrl: undefined }),
        ...(logoChoice === "none"
          ? { logoKnockWhite: undefined, logoScale: undefined, logoPosition: undefined }
          : {
              logoKnockWhite: logoKnockWhite || undefined,
              logoScale: Math.abs(logoScale - 0.15) > 0.001 ? logoScale : undefined,
              logoPosition: logoPosition !== "tr" ? logoPosition : undefined,
            }),
      };
      const blueprint = {
        ...bp,
        id: `${bp.id || job.id}_edit_${Date.now().toString(36)}`,
        title,
        aspectRatio,
        format: aspectRatio === "16:9" ? "youtube" : "reel",
        font,
        // Oswald pairs with the bold dark-scrim look; others use the boxed style.
        ...(font === "oswald" ? { stylePack: "wpw_dark_clean" } : { stylePack: undefined }),
        ...(grade ? { grade } : { grade: undefined }),
        keepNativeAudio: keepAudio,
        scenes: scenes.map((s, i) => ({ ...s, sceneId: s.sceneId || `s${i}` })),
        ...(musicStart > 0 ? { musicStart } : { musicStart: undefined }),
        ...(musicEnd > musicStart ? { musicEnd } : { musicEnd: undefined }),
        ...(audience.trim() ? { audience: audience.trim() } : { audience: undefined }),
        ...(textScale !== 1 ? { textScale } : { textScale: undefined }),
        ...(autoSmooth ? { autoSmooth: true, autoSmoothTarget } : { autoSmooth: undefined, autoSmoothTarget: undefined }),
        ...logoFields,
        // Names typed here become the bottom crawl. Empty = no ticker at all,
        // never an empty bar — the worker already refuses to draw one with no
        // names, and this keeps the blueprint honest too.
        ticker: tickerList.length
          ? { label: tickerLabel.trim() || "FEATURED SHOPS", names: tickerList, cycleSeconds: bp.ticker?.cycleSeconds || 12 }
          : undefined,
        endCard: endText ? { duration: bp.endCard?.duration || 2.5, text: endText, ...(endCta ? { cta: endCta } : {}) } : undefined,
        totalDuration: scenes.reduce((t, s) => t + Math.max(0.5, s.end - s.start), 0),
        source: "human_edit",
      };
      const { data, error } = await supabase.functions.invoke("video-render", {
        body: { blueprint, music_url: musicUrl || null, brand: job.brand || bp.brand || "weprintwraps", source_ref: "cut_editor" },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error || "re-render failed");
      return data;
    },
    onSuccess: () => {
      toast.success("Edited cut queued — watch it in Renders.");
      onQueued();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || "Re-render failed"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      {/* WIDTH IS AN INLINE STYLE ON PURPOSE. DialogContent's own base class is
          `w-full max-w-lg`; a `max-w-*` utility passed in here was losing that
          fight on wide monitors, so the editor rendered edge-to-edge (~1800px)
          — a giant video with every control shoved below the fold. Inline
          style can't be overridden by a class, so the cap always holds. */}
      <DialogContent
        style={{ maxWidth: aspectRatio === "16:9" ? "1120px" : "920px" }}
        className="w-[calc(100vw-1rem)] max-h-[92vh] overflow-y-auto bg-white p-4 sm:p-6"
      >
        <DialogHeader>
          <DialogTitle className="text-gray-900">
            {aspectRatio === "16:9" ? "🎬 YouTube Long-Form Editor — wide canvas" : "✂️ Cut Editor — direct the AI's edit"}
          </DialogTitle>
          {/* WHICH video is this? Title + short id + a link to the exact file. */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
            <span className="font-semibold text-gray-700">{bp.title || "(untitled)"}</span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">{job.id.slice(0, 8)}</span>
            {job.final_url && (
              <a href={job.final_url} target="_blank" rel="noreferrer" className="text-[#3b82f6] underline">open the rendered file ↗</a>
            )}
          </div>
        </DialogHeader>

        {/* How-to strip — show Amanda what each control does */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 text-gray-700">
          <button type="button" onClick={() => setShowHelp((h) => !h)}
            className="flex w-full items-center justify-between px-3 py-2 text-left">
            <span className="text-xs font-bold text-gray-900">ℹ️ How this editor works</span>
            <span className="text-[11px] font-semibold text-gray-500">{showHelp ? "Hide ▲" : "Show ▼"}</span>
          </button>
          {showHelp && (
            <div className="border-t border-gray-200 px-3 py-2.5 text-[12.5px] leading-relaxed">
              <p className="mb-1.5">You're editing the video the AI already built. Change what you want, then hit <b>🎬 Re-render</b> at the bottom to make a fresh version. Nothing changes until you re-render.</p>
              <ul className="space-y-1">
                <li>🎬 <b>Format</b> — 9:16 for reels/TikTok, 16:9 for YouTube.</li>
                <li>🔤 <b>Overlay font</b> &amp; <b>Text size (S/M/L)</b> — the on-screen text style and size. Long lines now auto-wrap to fit the reel instead of getting chopped; drop to <b>S</b> if you want it smaller.</li>
                <li>✂️ <b>Scenes</b> — click a thumbnail to <b>watch &amp; scrub</b>, then <b>Set IN / Set OUT</b> to trim, or <b>✂️ Slice here</b> to cut the clip in two at the exact frame you're on. Icons: ⬆⬇ reorder · ✂️ split · ⧉ duplicate · ✕ delete.</li>
                <li>📝 <b>Text overlay</b> — type in each scene's text box, or hit <b>✨ Get AI hook ideas</b> / <b>💡 Sell the why</b> (top of Scenes) and pick a suggested line from the <b>✨ hook options</b> dropdown on any scene. "Sell the why" gives benefit/reason-led lines that make the viewer feel why they need it.</li>
                <li>🎵 <b>Music</b> — pick any track from your library in the dropdown, or <b>＋ Upload song</b> to add a new one. Then <b>play it</b> and hit <b>Set start / Set end</b> to trim to just the part you want (e.g. the chorus).</li>
                <li>🏷️ <b>Logo bug</b> — the top-right corner logo. Switch to <b>WrapTV</b>, remove it, or paste a custom one. (Covers a corner watermark; can't remove a logo baked into the middle of the footage.)</li>
                <li>✨ <b>Auto-smooth</b> — softens skin / evens harsh lighting. “Skin only” keeps clothes &amp; background sharp.</li>
                <li>🃏 <b>End card</b> — the closing line + call-to-action.</li>
                <li>⚡ <b>AI Auto-Cut</b> — let the AI re-arrange it all (hook-first, beat cuts); review, then re-render.</li>
              </ul>
            </div>
          )}
        </div>

        {/* TWO COLUMNS, ALWAYS: the video stays pinned on the left while you
            work the controls on the right. 16:9 used to stack into one full-
            width column, which pushed every control off-screen under a huge
            video — you could see the cut or edit it, never both. */}
        <div className={`lg:grid lg:gap-4 lg:items-start ${aspectRatio === "16:9"
          ? "lg:grid-cols-[420px_minmax(0,1fr)]"
          : "lg:grid-cols-[280px_minmax(0,1fr)]"}`}>
          {/* ── Live preview — always on screen, every tab ── */}
          {(() => {
            const s = scenes[Math.min(pv, Math.max(0, scenes.length - 1))];
            if (!s) return null;
            const isImg = /\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(s.clipUrl || "");
            const posCls = s.textPosition === "top" ? "top-5" : s.textPosition === "center" ? "top-1/2 -translate-y-1/2" : "bottom-10";
            return (
              <div className="mb-4 space-y-1.5 lg:mb-0 lg:sticky lg:top-0">
                {job.final_url && (
                  <div className="flex gap-1 rounded-md border border-gray-200 bg-gray-50 p-0.5">
                    <button onClick={() => setShowFinished(true)}
                      className={`flex-1 rounded px-2 py-1 text-[11px] font-semibold ${showFinished ? "bg-gray-900 text-white" : "text-gray-600"}`}>
                      ▶ The finished video
                    </button>
                    <button onClick={() => setShowFinished(false)}
                      className={`flex-1 rounded px-2 py-1 text-[11px] font-semibold ${!showFinished ? "bg-gray-900 text-white" : "text-gray-600"}`}>
                      ✂️ Scene preview
                    </button>
                  </div>
                )}
                {showFinished && job.final_url ? (
                  <>
                    <video src={job.final_url} poster={job.thumbnail_url || undefined} controls playsInline
                      className={`w-full rounded bg-black object-contain ${aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]"}`} />
                    <p className="text-[10px] leading-snug text-gray-400">
                      This is the render you clicked ✂️ on. Change anything below and hit Re-render — it makes a NEW video; this one stays untouched.
                    </p>
                  </>
                ) : (
                <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Live preview</span>
                  <span className="text-[11px] text-gray-400">scene {Math.min(pv + 1, scenes.length)}/{scenes.length} · {Math.max(0, s.end - s.start).toFixed(1)}s loop</span>
                </div>
                <div className={`relative overflow-hidden rounded-lg bg-black ${aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]"}`}>
                  {isImg ? (
                    <img src={s.clipUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <video ref={pvVideoRef} key={`pv-${s.clipUrl}-${pv}`} src={s.clipUrl} playsInline muted autoPlay controls
                      className="absolute inset-0 h-full w-full object-cover"
                      onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = Number(s.start) || 0; } catch { /* ignore */ } }}
                      onTimeUpdate={(e) => {
                        const v = e.currentTarget;
                        // Loop the scene's exact trimmed cut, not the whole clip.
                        if (v.currentTime >= Number(s.end) - 0.05 || v.currentTime < Number(s.start) - 0.5) {
                          v.currentTime = Number(s.start) || 0;
                        }
                      }} />
                  )}
                  {font === "oswald" && <div className="pointer-events-none absolute inset-0 bg-black/40" />}
                  {s.text?.trim() && (
                    <div className={`pointer-events-none absolute inset-x-0 px-3 ${posCls}`}>
                      <p style={{ fontFamily: PV_FONT[font] || PV_FONT.clean, fontSize: `${Math.round((font === "oswald" ? 22 : 17) * textScale)}px` }}
                        className={`leading-tight text-white drop-shadow-md ${font === "oswald"
                          ? "text-left font-bold uppercase"
                          : "mx-auto w-fit rounded bg-black/55 px-2 py-1 text-center"}`}>
                        {s.text}
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {scenes.map((sc, i) => {
                    const thumbImg = /\.(jpe?g|png|webp|gif)(\?.*)?$/i.test(sc.clipUrl || "");
                    return (
                      <button key={i} type="button" onClick={() => setPv(i)}
                        className={`relative h-14 w-10 shrink-0 overflow-hidden rounded ${pv === i ? "ring-2 ring-[#3b82f6]" : "opacity-70 hover:opacity-100"}`}>
                        {thumbImg
                          ? <img src={sc.clipUrl} alt="" className="h-full w-full object-cover" />
                          : <video src={sc.clipUrl} preload="metadata" muted className="h-full w-full object-cover"
                              onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = Math.max(0.1, sc.start || 0.1); } catch { /* ignore */ } }} />}
                        <span className="absolute bottom-0 right-0 bg-black/70 px-0.5 text-[8px] font-bold text-white">{i + 1}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] leading-snug text-gray-400">Plays this scene's trimmed cut on loop. Overlay text shows your font + size live (close approximation — the render is exact).</p>
                </>
                )}
              </div>
            );
          })()}

          <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Title</div>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="bg-white text-gray-900 border-gray-300" />
          </div>

          {/* Section tabs — Scenes / Text & Font / Music / Finish */}
          <div className="sticky top-0 z-10 -mx-1 flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
            {([
              ["scenes", "✂️ Scenes"],
              ["text", "🔤 Text & Font"],
              ["music", musicUrl ? "🎵 Music ✓" : "🎵 Music"],
              ["finish", "🎨 Finish"],
            ] as Array<[typeof tab, string]>).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`flex-1 rounded-md px-2 py-2 text-xs font-semibold transition ${tab === k
                  ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white shadow"
                  : "text-gray-600 hover:bg-white"}`}>
                {l}
              </button>
            ))}
          </div>

          {tab === "text" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Overlay font — see it in the preview</div>
              <div className="space-y-1">
                {[
                  { v: "anton", label: "ANTON", note: "heavy poster impact", css: "'Anton', Impact, sans-serif" },
                  { v: "bebas", label: "BEBAS NEUE", note: "tall broadcast caps", css: "'Bebas Neue', Impact, sans-serif" },
                  { v: "oswald", label: "OSWALD", note: "bold condensed", css: "Oswald, sans-serif" },
                  { v: "playfair", label: "Playfair", note: "elegant serif", css: "'Playfair Display', Georgia, serif" },
                  { v: "clean", label: "Clean", note: "simple sans", css: "Inter, sans-serif" },
                ].map((f) => (
                  <button key={f.v} type="button" onClick={() => setFont(f.v)}
                    className={`flex w-full items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-left transition ${font === f.v ? "border-[#3b82f6] bg-blue-50/60 ring-1 ring-[#3b82f6]/30" : "border-gray-200 hover:border-gray-400"}`}>
                    <span style={{ fontFamily: f.css }} className="text-lg leading-none text-gray-900">{f.label}</span>
                    <span className="text-[10px] text-gray-500">{f.note}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Text size</div>
              <div className="flex gap-1.5">
                {[{ v: 0.75, l: "S" }, { v: 1, l: "M" }, { v: 1.3, l: "L" }].map((z) => (
                  <button key={z.l} onClick={() => setTextScale(z.v)}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-bold transition ${Math.abs(textScale - z.v) < 0.01
                      ? "border-transparent bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                      : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
                    {z.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Drop a saved hook</div>
              <select value="" disabled={!brandHooks.length}
                onChange={(e) => { if (e.target.value) update(0, { text: e.target.value }); }}
                className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 disabled:opacity-50"
                title={brandHooks.length ? "Sets the opening scene's overlay text" : "No saved hooks for this brand — add them in the Hooks Manager"}>
                <option value="">{brandHooks.length ? "→ opening overlay…" : "no saved hooks"}</option>
                {brandHooks.map((h) => (
                  <option key={h.id} value={h.text}>{h.text.length > 40 ? h.text.slice(0, 40) + "…" : h.text}</option>
                ))}
              </select>
              <p className="mt-2 text-[11px] text-gray-400 leading-snug">
                The words themselves live on each scene — type them in the ✂️ Scenes tab, or use ✨ Get AI hook ideas there. This tab sets the LOOK: font + size for every overlay and caption.
              </p>
            </div>
          </div>
          )}

          {tab === "scenes" && (
          <div>
            {/* Who we're selling to — steers both hook buttons below */}
            <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="text-xs font-semibold text-gray-600">🎯 Selling to</span>
              <input value={audience} onChange={(e) => setAudience(e.target.value)}
                placeholder="the customer — e.g. 'shop owner tired of cheap wraps peeling'"
                className="min-w-[10rem] flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400" />
              <span className="text-[11px] text-gray-400">the hook buttons speak to this customer</span>
            </div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Scenes — trim in/out, slice, rewrite text, reorder, drop
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" className="border-[#ec4899]/40 text-[#be2d72]"
                  onClick={() => suggestHooks.mutate(undefined)} disabled={suggestHooks.isPending}
                  title="AI reads the footage/topic and suggests scroll-stopping overlay lines — then pick one per scene">
                  {suggestHooks.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : "✨ "}
                  Get AI hook ideas
                </Button>
                <Button size="sm" variant="outline" className="border-[#3b82f6]/40 text-[#2563eb]"
                  onClick={() => suggestHooks.mutate("why")} disabled={suggestHooks.isPending}
                  title="Sell the WHY — benefit/reason-led lines that make the viewer feel why they need it (not just a description)">
                  💡 Sell the why
                </Button>
                <Button size="sm"
                  className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] font-semibold text-white hover:opacity-90"
                  onClick={() => setAddOpen((v) => !v)}
                  title="Add another clip — or a photo — into this edit">
                  ＋ Add clip or photo
                </Button>
              </div>
            </div>
            {addOpen && (
              <div className="mb-2 rounded-lg border border-[#3b82f6]/40 bg-blue-50/40 p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-gray-700">
                    Tap anything to add it to the END of the cut — then ⬆ move it where you want it.
                    <span className="ml-1 font-normal text-gray-500">Photos work too (they hold on screen for 3s).</span>
                  </span>
                  <label className={`cursor-pointer rounded-md border border-[#3b82f6] px-2 py-1 text-[11px] font-semibold text-[#3b82f6] hover:bg-blue-50 ${uploadingAdd ? "pointer-events-none opacity-50" : ""}`}>
                    {uploadingAdd ? "Uploading…" : "＋ Upload video or photo"}
                    <input type="file" accept="video/*,image/*" className="hidden" disabled={uploadingAdd}
                      onChange={(e) => e.target.files?.[0] && uploadAndAdd(e.target.files[0])} />
                  </label>
                </div>
                <div className="grid max-h-56 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-5">
                  {(addLibrary || []).map((c: any) => (
                    <button key={c.id} type="button" onClick={() => addScene(c.storage_url, c.title || c.original_filename)}
                      className="overflow-hidden rounded border border-gray-200 bg-white text-left hover:border-[#3b82f6]">
                      {(() => {
                        // Same resolver as the Asset Library — a Drive link is a
                        // web page, so <video src> on it renders black.
                        const t = assetThumb(c);
                        if (t.kind === "video") return <video playsInline src={t.src} preload="metadata" muted className="h-14 w-full bg-black object-cover" />;
                        if (t.kind === "image") return <img src={t.src} alt="" loading="lazy" className="h-14 w-full bg-gray-100 object-cover" />;
                        return <div className="flex h-14 w-full items-center justify-center bg-slate-100 text-[9px] text-slate-400">no preview</div>;
                      })()}
                      <div className="flex items-center gap-1 px-1 py-0.5">
                        <span className="text-[9px]">{isImageUrl(c.storage_url) || c.asset_type === "image" ? "🖼️" : "🎬"}</span>
                        <span className="truncate text-[9px] text-gray-500">{c.title || c.original_filename}</span>
                      </div>
                    </button>
                  ))}
                  {!(addLibrary || []).length && (
                    <p className="col-span-full py-2 text-xs text-gray-400">
                      Nothing in the Asset Library yet — upload above, or add footage in Marketing Hub → Asset Library.
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="space-y-2">
              {scenes.map((s, i) => (
                <div key={i} className="rounded-lg border border-gray-200 bg-white p-2.5 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setPreviewIdx(previewIdx === i ? null : i)}
                      className="relative h-16 w-24 shrink-0 overflow-hidden rounded bg-black"
                      title="Click to watch & scrub this clip, then set in/out">
                      {isImageUrl(s.clipUrl)
                        ? <img src={s.clipUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                        : <video playsInline src={s.clipUrl} preload="metadata" muted
                            onLoadedMetadata={(e) => { try { (e.currentTarget as HTMLVideoElement).currentTime = Math.max(0.1, s.start || 0.1); } catch { /* ignore */ } }}
                            className="h-full w-full object-cover" />}
                      <span className="absolute inset-0 flex items-center justify-center text-white/90 text-lg">{previewIdx === i ? "▲" : "▶"}</span>
                    </button>
                    <span className="text-xs font-bold text-gray-500">#{i + 1}</span>
                    <label className="text-xs text-gray-500">
                      in{" "}
                      <input type="number" step="0.5" min="0" value={s.start}
                        onChange={(e) => update(i, { start: Number(e.target.value) })}
                        className="w-16 rounded border border-gray-300 px-1.5 py-1 text-sm text-gray-900" />
                    </label>
                    <label className="text-xs text-gray-500">
                      out{" "}
                      <input type="number" step="0.5" min="0" value={s.end}
                        onChange={(e) => update(i, { end: Number(e.target.value) })}
                        className="w-16 rounded border border-gray-300 px-1.5 py-1 text-sm text-gray-900" />
                    </label>
                    <input value={s.text || ""} placeholder="overlay text (blank = none)"
                      onChange={(e) => update(i, { text: e.target.value || undefined })}
                      className="min-w-[8rem] flex-1 basis-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400 sm:basis-auto" />
                    {overlayOptions.length > 0 && (
                      <select value="" onChange={(e) => { if (e.target.value) update(i, { text: e.target.value }); }}
                        className="basis-full rounded border border-[#ec4899]/40 bg-white px-2 py-1 text-xs text-gray-900 sm:basis-auto sm:max-w-[12rem]"
                        title="Drop an AI or saved hook as this scene's overlay text">
                        <option value="">✨ hook options…</option>
                        {overlayOptions.map((h, k) => (
                          <option key={k} value={h}>{h.length > 44 ? h.slice(0, 44) + "…" : h}</option>
                        ))}
                      </select>
                    )}
                    <Button size="sm" variant="ghost" className="px-2" onClick={() => move(i, -1)} disabled={i === 0} title="Move up"><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="px-2" onClick={() => move(i, 1)} disabled={i === scenes.length - 1} title="Move down"><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="px-2" onClick={() => split(i)} title="Split this scene in two (trim each half separately)"><Scissors className="h-4 w-4 text-gray-600" /></Button>
                    <Button size="sm" variant="ghost" className="px-2" onClick={() => duplicate(i)} title="Duplicate this scene"><Copy className="h-4 w-4 text-gray-600" /></Button>
                    <Button size="sm" variant="ghost" className={`px-2 text-xs font-bold ${swapIdx === i ? "text-[#3b82f6]" : "text-gray-600"}`}
                      onClick={() => setSwapIdx(swapIdx === i ? null : i)} title="Swap this clip for another from the library (keeps the slot + text)">⇄</Button>
                    <Button size="sm" variant="ghost" className="px-2" onClick={() => remove(i)} title="Delete scene"><X className="h-4 w-4 text-red-500" /></Button>
                  </div>
                  {swapIdx === i && (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-gray-500">Tap a clip to swap it in (the scene keeps its length + text):</span>
                        <label className={`cursor-pointer rounded-md border border-[#3b82f6] px-2 py-1 text-[11px] font-semibold text-[#3b82f6] hover:bg-blue-50 ${uploadingClip ? "opacity-50 pointer-events-none" : ""}`}>
                          {uploadingClip ? "Uploading…" : "＋ Upload new video"}
                          <input type="file" accept="video/*" className="hidden" disabled={uploadingClip}
                            onChange={(e) => e.target.files?.[0] && uploadClipAndSwap(i, e.target.files[0])} />
                        </label>
                      </div>
                      <div className="grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-5">
                        {(swapClips || []).map((c: any) => (
                          <button key={c.id} type="button"
                            onClick={() => {
                              const len = Math.max(1.5, Number(s.end) - Number(s.start)) || 4;
                              update(i, { clipUrl: c.storage_url, start: 0, end: Number(len.toFixed(1)) });
                              setSwapIdx(null);
                              toast.success("Clip swapped — trim it, then Re-render.");
                            }}
                            className="overflow-hidden rounded border border-gray-200 text-left hover:border-[#3b82f6]">
                            {(() => {
                              const t = assetThumb(c);
                              if (t.kind === "image") return <img src={t.src} alt="" loading="lazy" className="h-14 w-full bg-gray-100 object-cover" />;
                              if (t.kind === "video") return <video playsInline src={t.src} preload="metadata" muted className="h-14 w-full bg-black object-cover" />;
                              return <div className="flex h-14 w-full items-center justify-center bg-slate-100 text-[9px] text-slate-400">no preview</div>;
                            })()}
                            <div className="truncate px-1 py-0.5 text-[9px] text-gray-500">{c.title || c.original_filename}</div>
                          </button>
                        ))}
                        {!(swapClips || []).length && <p className="col-span-full text-xs text-gray-400">No library clips yet.</p>}
                      </div>
                    </div>
                  )}
                  {previewIdx === i && (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      {isImageUrl(s.clipUrl)
                        ? <img src={s.clipUrl} alt="" className={`w-full rounded bg-black object-contain ${aspectRatio === "16:9" ? "aspect-video" : "max-h-72"}`} />
                        : <video ref={previewRef} key={s.clipUrl} src={s.clipUrl} controls playsInline preload="metadata"
                            className={`w-full rounded bg-black ${aspectRatio === "16:9" ? "aspect-video" : "max-h-72"}`}
                            onLoadedMetadata={(e) => { const v = e.currentTarget as HTMLVideoElement; setPreviewDur(v.duration || 0); try { v.currentTime = Number(s.start) || 0; } catch { /* ignore */ } }} />}

                      {/* Visual trim — drag the IN / OUT handles instead of typing seconds */}
                      {previewDur > 0 && (
                        <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-2.5">
                          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-gray-500">
                            <span>Drag to trim</span>
                            <span className="text-gray-700">IN {secLabel(s.start)} · OUT {secLabel(s.end)} · <b>{Math.max(0, s.end - s.start).toFixed(1)}s</b></span>
                          </div>
                          {/* selected region bar */}
                          <div className="relative h-2 w-full rounded-full bg-gray-200">
                            <div className="absolute h-2 rounded-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899]"
                              style={{ left: `${(Math.min(s.start, s.end) / previewDur) * 100}%`, width: `${(Math.max(0, s.end - s.start) / previewDur) * 100}%` }} />
                          </div>
                          <div className="mt-1.5 space-y-1">
                            <label className="flex items-center gap-2 text-[11px] text-gray-500">
                              <span className="w-7 shrink-0 font-semibold">IN</span>
                              <input type="range" min={0} max={previewDur} step={0.1} value={Math.min(s.start, s.end)}
                                onChange={(e) => { const t = Math.min(Number(e.target.value), s.end - 0.2); update(i, { start: Number(Math.max(0, t).toFixed(2)) }); if (previewRef.current) previewRef.current.currentTime = Math.max(0, t); }}
                                className="w-full accent-[#3b82f6]" />
                            </label>
                            <label className="flex items-center gap-2 text-[11px] text-gray-500">
                              <span className="w-7 shrink-0 font-semibold">OUT</span>
                              <input type="range" min={0} max={previewDur} step={0.1} value={s.end}
                                onChange={(e) => { const t = Math.max(Number(e.target.value), s.start + 0.2); update(i, { end: Number(Math.min(previewDur, t).toFixed(2)) }); if (previewRef.current) previewRef.current.currentTime = Math.min(previewDur, t); }}
                                className="w-full accent-[#ec4899]" />
                            </label>
                          </div>
                        </div>
                      )}

                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" className="border-gray-300 text-gray-700"
                          onClick={() => { const t = previewRef.current?.currentTime; if (t != null) update(i, { start: Number(t.toFixed(2)) }); }}>
                          ◁ Set IN to current
                        </Button>
                        <Button size="sm" variant="outline" className="border-gray-300 text-gray-700"
                          onClick={() => { const t = previewRef.current?.currentTime; if (t != null) update(i, { end: Number(t.toFixed(2)) }); }}>
                          Set OUT to current ▷
                        </Button>
                        <Button size="sm" variant="ghost" className="text-gray-500"
                          onClick={() => { const v = previewRef.current; if (v) { v.currentTime = Number(s.start) || 0; v.play(); } }}>
                          ↻ Play from IN
                        </Button>
                        <Button size="sm" variant="outline" className="border-[#ec4899]/40 text-[#be2d72]"
                          onClick={() => { const t = previewRef.current?.currentTime; if (t != null) sliceAt(i, Number(t)); }}
                          title="Cut this scene into two at the current playhead frame">
                          ✂️ Slice here
                        </Button>
                        <span className="text-[11px] text-gray-400">scrub the player, then set in/out — or slice at the frame you want</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          )}

          {tab === "music" && (
          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Music — pick a track, then trim it by ear</span>
              <span className="basis-full order-last">
                <label className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                  <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} className="h-4 w-4" />
                  <span className="text-sm font-medium text-gray-800">🎙️ Keep the original audio</span>
                  <span className="text-[11px] text-gray-500">
                    {keepAudio
                      ? (musicUrl ? "the footage's real sound leads; the track sits under it" : "the footage's real sound plays")
                      : "footage muted — music only"}
                  </span>
                </label>
              </span>
              <label className={`cursor-pointer rounded-md border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:border-gray-400 ${uploadingSong ? "opacity-50" : ""}`}
                title="Upload a new song into the library">
                {uploadingSong ? "Uploading…" : "＋ Upload song"}
                <input type="file" accept="audio/*" className="hidden" disabled={uploadingSong}
                  onChange={(e) => e.target.files?.[0] && uploadSong(e.target.files[0])} />
              </label>
            </div>
            {/* THE RULE, ON SCREEN. Owner (2026-07-30): music is for Behind-
                The-Install footage; documentary and UGC keep their own sound
                because a bed buries the person talking. Shown, not silently
                enforced — an editor can still override deliberately. */}
            {!musicVerdict.allowMusic && (
              <div className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11.5px] leading-snug text-amber-900">
                <b>Natural sound recommended.</b> {musicVerdict.reason}
                {musicUrl && <> <b>A track is currently on this cut</b> — keep “🎙️ Keep the original audio” ticked so the speech still leads, or clear the track below.</>}
              </div>
            )}
            {/* ALL your songs, visible as a list — tap one to use it (loads
                the player below to preview + trim). */}
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-1.5">
              <button type="button" onClick={() => { setMusicUrl(""); setMusicStart(0); setMusicEnd(0); }}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${!musicUrl ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-50"}`}>
                🔇 No music — natural sound
              </button>
              {(tracks || []).map((t: any) => (
                <button key={t.storage_url} type="button"
                  onClick={() => { setMusicUrl(t.storage_url); setMusicStart(0); setMusicEnd(0); }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${musicUrl === t.storage_url ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white" : "text-gray-800 hover:bg-gray-50"}`}>
                  <span className="shrink-0">{musicUrl === t.storage_url ? "🎵" : "▶"}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                  <span className={`shrink-0 rounded-full border px-1.5 text-[10px] ${musicUrl === t.storage_url ? "border-white/40" : "border-gray-300 text-gray-500"}`}>{t.genre || "track"}</span>
                </button>
              ))}
              {!(tracks || []).length && (
                <p className="px-2 py-1.5 text-xs text-gray-400">No songs yet — hit ＋ Upload song above to add your first track.</p>
              )}
            </div>

            {musicUrl && (
              <div className="mt-3 space-y-2">
                {/* Play the track to find the part you want, then set start/end by ear */}
                <audio ref={musicRef} key={musicUrl} src={musicUrl} controls preload="metadata" className="w-full"
                  onLoadedMetadata={(e) => setMusicDur((e.currentTarget as HTMLAudioElement).duration || 0)} />
                {/* Hear the track OVER the looping video preview (left panel) —
                    video + music together, exactly how the cut will feel. */}
                <Button size="sm"
                  className="w-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] font-semibold text-white hover:opacity-90"
                  onClick={() => {
                    const v = pvVideoRef.current;
                    const a = musicRef.current;
                    if (v) { try { v.currentTime = Number(scenes[Math.min(pv, scenes.length - 1)]?.start) || 0; v.play(); } catch { /* ignore */ } }
                    if (a) { a.currentTime = musicStart || 0; a.play(); }
                  }}
                  title="Restarts the video preview and the track together — the video panel stays on screen in this tab">
                  ▶ Play with video — hear the track over the preview
                </Button>
                {musicDur > 0 && (
                  <div className="rounded-lg bg-gray-50 border border-gray-200 p-2.5">
                    <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-gray-500">
                      <span>Drag to trim the song</span>
                      <span className="text-gray-700">{secLabel(musicStart)} → {musicEnd > musicStart ? secLabel(musicEnd) : "video end"}</span>
                    </div>
                    <div className="relative h-2 w-full rounded-full bg-gray-200">
                      <div className="absolute h-2 rounded-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899]"
                        style={{ left: `${(musicStart / musicDur) * 100}%`, width: `${(((musicEnd > musicStart ? musicEnd : musicDur) - musicStart) / musicDur) * 100}%` }} />
                    </div>
                    <div className="mt-1.5 space-y-1">
                      <label className="flex items-center gap-2 text-[11px] text-gray-500">
                        <span className="w-8 shrink-0 font-semibold">START</span>
                        <input type="range" min={0} max={musicDur} step={0.5} value={musicStart}
                          onChange={(e) => { const t = Number(e.target.value); setMusicStart(t); if (musicEnd && musicEnd <= t) setMusicEnd(0); if (musicRef.current) musicRef.current.currentTime = t; }}
                          className="w-full accent-[#3b82f6]" />
                      </label>
                      <label className="flex items-center gap-2 text-[11px] text-gray-500">
                        <span className="w-8 shrink-0 font-semibold">END</span>
                        <input type="range" min={0} max={musicDur} step={0.5} value={musicEnd > musicStart ? musicEnd : musicDur}
                          onChange={(e) => { const t = Number(e.target.value); setMusicEnd(t >= musicDur ? 0 : Math.max(t, musicStart + 1)); if (musicRef.current) musicRef.current.currentTime = t; }}
                          className="w-full accent-[#ec4899]" />
                      </label>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" className="border-gray-300 text-gray-700"
                    onClick={() => { const t = musicRef.current?.currentTime; if (t != null) setMusicStart(Number(t.toFixed(1))); }}
                    title="Use where the player is as the music start">
                    ◁ Set start to here
                  </Button>
                  <Button size="sm" variant="outline" className="border-gray-300 text-gray-700"
                    onClick={() => { const t = musicRef.current?.currentTime; if (t != null) setMusicEnd(Number(t.toFixed(1))); }}
                    title="Use where the player is as the music end">
                    Set end to here ▷
                  </Button>
                  <Button size="sm" variant="ghost" className="text-gray-500"
                    onClick={() => { const a = musicRef.current; if (a) { a.currentTime = musicStart || 0; a.play(); } }}
                    title="Preview from the start point you set">
                    ↻ Play from start
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="text-xs text-gray-500">
                    Starts at (s){" "}
                    <input type="number" min="0" step="0.5" value={musicStart}
                      onChange={(e) => setMusicStart(Number(e.target.value))}
                      className="w-20 rounded border border-gray-300 px-1.5 py-1 text-sm text-gray-900" />
                  </label>
                  <label className="text-xs text-gray-500">
                    Ends at (s){" "}
                    <input type="number" min="0" step="0.5" value={musicEnd}
                      onChange={(e) => setMusicEnd(Number(e.target.value))}
                      className="w-20 rounded border border-gray-300 px-1.5 py-1 text-sm text-gray-900"
                      title="Leave 0 to play until the video ends" />
                  </label>
                  <span className="text-[11px] text-gray-400">
                    {musicEnd > musicStart
                      ? `Using ${(musicEnd - musicStart).toFixed(1)}s of the track (0 end = until the video ends).`
                      : "End at 0 = music plays until the video ends."}
                  </span>
                </div>
              </div>
            )}
          </div>
          )}

          {tab === "finish" && (<>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Color grade — the documentary look</div>
            <div className="flex flex-wrap gap-1.5">
              {[
                { v: "", l: "None — as shot" },
                { v: "cinematic", l: "🎬 Cinematic — teal/orange" },
                { v: "gritty", l: "🔧 Gritty shop" },
                { v: "golden", l: "🌇 Golden hour" },
              ].map((g) => (
                <button key={g.v} onClick={() => setGrade(g.v)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${grade === g.v
                    ? "border-transparent bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
                  {g.l}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-gray-400">Deterministic ffmpeg look applied to every scene on Re-render — same input, same grade, every time.</p>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Format</div>
            <div className="flex gap-1.5">
              {[{ v: "9:16", l: "9:16 Reel" }, { v: "16:9", l: "16:9 Long-form" }].map((f) => (
                <button key={f.v} onClick={() => setAspectRatio(f.v)}
                  className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition ${aspectRatio === f.v
                    ? "border-transparent bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}>
                  {f.l}
                </button>
              ))}
            </div>
          </div>

          {/* ── LOGO — pick it by SIGHT, or upload your own ── */}
          <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">🏷️ Logo — what gets stamped on the corner</span>
              <label className={`cursor-pointer rounded-md border border-[#3b82f6] px-2 py-1 text-[11px] font-semibold text-[#3b82f6] hover:bg-blue-50 ${uploadingLogo ? "opacity-50 pointer-events-none" : ""}`}>
                {uploadingLogo ? "Uploading…" : "＋ Upload a logo (PNG)"}
                <input type="file" accept="image/png,image/webp,image/jpeg" className="hidden" disabled={uploadingLogo}
                  onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { v: "brand", label: "Brand default", url: "" },
                { v: "wpw", label: "WePrintWraps", url: WPW_LOGO },
                { v: "custom", label: customLogo ? "Your uploaded logo" : "Custom URL…", url: customLogo },
                { v: "none", label: "No logo", url: "" },
              ].map((o) => (
                <button key={o.v} type="button" onClick={() => setLogoChoice(o.v)}
                  className={`overflow-hidden rounded-lg border p-2 text-left transition ${logoChoice === o.v ? "border-[#3b82f6] ring-2 ring-[#3b82f6]/30" : "border-gray-200 hover:border-gray-400"}`}>
                  <div className="mb-1 flex h-12 items-center justify-center rounded bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#ffffff_0%_50%)] bg-[length:12px_12px]">
                    {o.url
                      ? <img src={o.url} alt={o.label} className="max-h-11 max-w-full object-contain" />
                      : <span className="text-lg">{o.v === "none" ? "🚫" : o.v === "custom" ? "⬆️" : "🏷️"}</span>}
                  </div>
                  <div className="truncate text-[11px] font-medium text-gray-800">{o.label}</div>
                </button>
              ))}
            </div>
            {logoChoice === "custom" && (
              <Input value={customLogo} onChange={(e) => setCustomLogo(e.target.value)}
                placeholder="https://…/logo.png — or use ＋ Upload above"
                className="mt-2 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400" />
            )}
            {logoChoice !== "none" && (
              <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
                <label className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" checked={logoKnockWhite} onChange={(e) => setLogoKnockWhite(e.target.checked)} className="h-4 w-4" />
                  <span className="text-sm font-medium text-gray-800">Knock out the white background</span>
                  <span className="text-[11px] text-gray-500">most logos are flat PNGs with no transparency and stamp as a white box — leave this on</span>
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span className="font-semibold">SIZE</span>
                    <input type="range" min={0.06} max={0.3} step={0.01} value={logoScale}
                      onChange={(e) => setLogoScale(Number(e.target.value))} className="w-32 accent-[#3b82f6]" />
                    <span className="w-8 text-gray-700">{Math.round(logoScale * 100)}%</span>
                  </label>
                  <div className="flex gap-1">
                    {[["tl", "↖"], ["tr", "↗"], ["bl", "↙"], ["br", "↘"]].map(([v, icon]) => (
                      <button key={v} type="button" onClick={() => setLogoPosition(v)}
                        className={`rounded border px-2 py-1 text-xs ${logoPosition === v ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-600"}`}>
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-snug text-gray-400">
              Stamped fresh on Re-render. It covers a corner watermark — it can't remove a logo baked into the middle of the footage.
              {" "}WrapTVWorld has no logo on file yet: upload it once here and pick it.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <label className="flex flex-wrap items-center gap-2">
              <input type="checkbox" checked={autoSmooth} onChange={(e) => setAutoSmooth(e.target.checked)} className="h-4 w-4" />
              <span className="text-sm font-medium text-gray-800">✨ Auto-smooth (beauty)</span>
              <span className="text-[11px] text-gray-500">softens skin + evens harsh / flat lighting on Re-render</span>
            </label>
            {autoSmooth && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                <select value={autoSmoothTarget} onChange={(e) => setAutoSmoothTarget(e.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900">
                  <option value="skin">Skin only — face + neck (keeps clothes/bg sharp)</option>
                  <option value="frame">Whole frame</option>
                </select>
                {autoSmoothTarget === "skin" && (
                  <span className="text-[11px] text-amber-600">beta — skin-tone based; if it looks off it auto-falls back to whole-frame. Test one render.</span>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">End card text</div>
              <Input value={endText} onChange={(e) => setEndText(e.target.value)} placeholder="blank = no end card"
                className="bg-white text-gray-900 border-gray-300 placeholder:text-gray-400" />
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">End card CTA</div>
              <Input value={endCta} onChange={(e) => setEndCta(e.target.value)}
                className="bg-white text-gray-900 border-gray-300" />
            </div>
          </div>

          {/* BOTTOM TICKER — the crawl that names the shops and installers.
              The worker has drawn this since 2026-08-05 and BrandCast's BTI
              treatment sets it, but this editor had no control, so a finished
              cut could never have one ADDED. */}
          <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Bottom ticker — shops &amp; installers
              </span>
              <span className="text-[11px] text-gray-400">
                {tickerNames.split("\n").filter((n) => n.trim()).length || "no"} name
                {tickerNames.split("\n").filter((n) => n.trim()).length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <div>
                <div className="mb-1 text-[11px] font-semibold text-gray-500">Bar label</div>
                <Input
                  value={tickerLabel}
                  onChange={(e) => setTickerLabel(e.target.value)}
                  placeholder="FEATURED SHOPS"
                  className="bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold text-gray-500">
                  Names — one per line
                </div>
                <textarea
                  value={tickerNames}
                  onChange={(e) => setTickerNames(e.target.value)}
                  rows={4}
                  placeholder={"Royalty Wraps, Tampa\nVinyl Vixen\nRJ The Wrapper"}
                  className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-900 placeholder:text-gray-400"
                />
              </div>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-500">
              One per line — shop names contain commas, so a comma-separated list would shred them.
              Leave it empty for no ticker; an empty bar is never drawn. Changes apply on re-render.
            </p>
          </div>
          </>)}

          <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-gray-100 bg-white px-4 pt-3 sm:mx-0 sm:flex-row sm:justify-end sm:border-0 sm:px-0">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => autocut.mutate()} disabled={autocut.isPending}
              title="Mashup recipe: hook-first, 1.5-4s beat cuts, punch text — review before rendering">
              {autocut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : "⚡"} AI Auto-Cut
            </Button>
            <Button variant="outline" className="w-full sm:w-auto" onClick={onClose}>Cancel</Button>
            <Button onClick={() => rerender.mutate()} disabled={rerender.isPending}
              className="w-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white font-semibold hover:opacity-90 sm:w-auto">
              {rerender.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Queuing…</> : "🎬 Re-render this cut"}
            </Button>
          </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
