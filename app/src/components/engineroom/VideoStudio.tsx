/**
 * VideoStudio — native Engine Room video production studio.
 *
 * Replaces the old wrapcommandai.com launcher tab. One-button AI auto-build:
 * pick a format (Reel / Short / YouTube long-form), type a topic, press build —
 * the DesignProAI pipeline assembles clips, writes captions, matches music and
 * queues the ffmpeg render. Also: Parse Footage intake (Drive link →
 * transcripts + hook-scored moments), clip library browser, render tracker
 * with send-to-Drive.
 */
import { kickParse, kickMessage } from "@/lib/kickParse";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Film, Clapperboard, Youtube, Smartphone, Image as ImageIcon, Loader2, RefreshCw, Upload, CheckCircle2, XCircle, Clock, ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { useAutoBuildVideo, FORMAT_SPECS, type BuildFormat, type StaticLayout } from "@/hooks/useAutoBuildVideo";
import CutEditor from "@/components/engineroom/CutEditor";
import ClipTools from "@/components/engineroom/ClipTools";
import ContentFinder from "@/components/engineroom/ContentFinder";
import BrandCast from "@/components/engineroom/BrandCast";
import { sendRenderToBoard } from "@/lib/sendRenderToBoard";
import { resolveAssetType } from "@/lib/assetContentType";

const FORMAT_ICONS: Record<BuildFormat, typeof Film> = {
  reel: Clapperboard,
  short: Smartphone,
  youtube: Youtube,
  static: ImageIcon,
  carousel: ImageIcon,
};

const STATIC_LAYOUTS: Array<[StaticLayout, string]> = [
  ["grid", "Photo grid"],
  ["search", "Search-bar quote"],
  ["filmstrip", "Filmstrip split"],
  ["features", "Features callout"],
  ["echo", "Echo giveaway"],
  ["polaroid", "Polaroid"],
  ["stop_scrolling", "Stop scrolling!"],
  ["incoming_call", "Incoming call"],
  ["whats_in_my_bag", "What's in the box"],
  ["serif_poster", "Serif poster"],
  ["framed_poster", "Framed poster"],
];

// Ecosystem brands — the slug flows through the whole chain (blueprint.brand,
// video_render_jobs.brand, brand-os voice for hooks/captions).
const BRANDS: Array<{ slug: string; label: string }> = [
  { slug: "weprintwraps", label: "WePrintWraps.com" },
  { slug: "restylepro", label: "DesignProAI" },
  { slug: "designproai", label: "DesignProAI" },
  { slug: "wraptvworld", label: "WrapTVWorld" },
  { slug: "inkandedge", label: "Ink & Edge Magazine" },
  { slug: "creatormarket", label: "CreatorMarket" },
];

function StatusBadge({ status }: { status: string }) {
  if (status === "complete") return <Badge className="bg-green-50 text-green-700 border-green-300"><CheckCircle2 className="w-3 h-3 mr-1" />complete</Badge>;
  if (status === "failed") return <Badge className="bg-red-50 text-red-700 border-red-300"><XCircle className="w-3 h-3 mr-1" />failed</Badge>;
  if (status === "rendering") return <Badge className="bg-blue-50 text-blue-700 border-blue-300"><Loader2 className="w-3 h-3 mr-1 animate-spin" />rendering</Badge>;
  return <Badge className="bg-gray-100 text-gray-600 border-gray-300"><Clock className="w-3 h-3 mr-1" />{status}</Badge>;
}

export default function VideoStudio() {
  const qc = useQueryClient();
  const { autoBuild, building, progress } = useAutoBuildVideo();
  const [format, setFormat] = useState<BuildFormat>("reel");
  const [brand, setBrand] = useState("weprintwraps");
  const [style, setStyle] = useState<"standard" | "wpw_dark_clean">("wpw_dark_clean");
  const [staticLayout, setStaticLayout] = useState<StaticLayout>("grid");
  const [vlogTemplate, setVlogTemplate] = useState(false);
  const [topic, setTopic] = useState("");
  const [parseUrl, setParseUrl] = useState("");
  const [episodeSource, setEpisodeSource] = useState("");
  const [episodeThesis, setEpisodeThesis] = useState("");
  const [editingJob, setEditingJob] = useState<any | null>(null);
  const [editTab, setEditTab] = useState<"scenes" | "text" | "music" | "finish">("scenes");
  const [clipJob, setClipJob] = useState<any | null>(null);
  const [hookTopic, setHookTopic] = useState("");
  const [hooks, setHooks] = useState<Array<{ text: string; style?: string; score?: number }>>([]);
  // The expert cards (Auto-Create, Hook Creator, Parse, Finder, Episode
  // Builder) collapse behind one toggle — the default page is the simple
  // flow: BrandCast → Renders → Clip Library.
  const [showPro, setShowPro] = useState(false);

  // ── data ──────────────────────────────────────────────────────────────────
  const { data: clips } = useQuery({
    queryKey: ["videostudio-clips"],
    queryFn: async () => {
      // The VIDEO + AUDIO clip library — Drive-synced clips, direct uploads,
      // finished renders, AND any songs uploaded here (asset_type='audio' —
      // they get a 🎵 badge below, never a broken video/img tag). Explicitly
      // EXCLUDES still images (asset_type='image'): imported product
      // swatches (Modern & Trippy, WBTY, etc.) are static product photos,
      // not footage, and were burying the real clips here. They live in the
      // product/image library for static posts instead.
      const { data, error } = await (supabase as any)
        .from("agent_media_assets")
        .select("id, title, original_filename, storage_url, source_folder, file_size_bytes, asset_type, drive_file_id")
        .or("asset_type.is.null,asset_type.neq.image")
        .order("created_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 60_000,
  });

  const { data: renders, refetch: refetchRenders } = useQuery({
    queryKey: ["videostudio-renders"],
    queryFn: async () => {
      // 100, not 20: older renders (an episode from last week) were simply
      // NOT in the list, so "hit Edit on that video" was impossible.
      const { data, error } = await (supabase as any)
        .from("video_render_jobs")
        .select("id, brand, status, final_url, thumbnail_url, error, blueprint, music_url, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as any[];
    },
    refetchInterval: 10_000,
  });

  // Find the exact render — by title, or by pasting the mp4 URL / job id
  // straight out of the browser tab you're watching it in.
  const [renderQ, setRenderQ] = useState("");
  const openExact = useMutation({
    mutationFn: async (raw: string) => {
      const id = (raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
      if (!id) throw new Error("Paste the video's URL (or its job id) — I'll open that exact render.");
      const { data, error } = await (supabase as any)
        .from("video_render_jobs")
        .select("id, brand, status, final_url, thumbnail_url, error, blueprint, music_url, created_at")
        .eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("No render with that id — check the link.");
      return data as any;
    },
    onSuccess: (job) => { setEditingJob(job); toast.success(`Opened "${job.blueprint?.title || job.id.slice(0, 8)}"`); },
    onError: (e: any) => toast.error(e?.message || "Couldn't open that render"),
  });

  // DEEP LINK — ?render=<id> opens the Cut Editor ON THAT RENDER, and
  // &edit=<section> picks the tab. Brand Board's "Refine in Cut Editor" used to
  // link at the bare studio page, which dropped you on a wall of cards with no
  // way to find the video you just clicked. Runs once per id.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkId = searchParams.get("render");
  const deepLinkTab = searchParams.get("edit") as typeof editTab | null;
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkId || openedRef.current === deepLinkId) return;
    openedRef.current = deepLinkId;
    (async () => {
      const { data, error } = await (supabase as any)
        .from("video_render_jobs")
        .select("id, brand, status, final_url, thumbnail_url, error, blueprint, music_url, created_at")
        .eq("id", deepLinkId).maybeSingle();
      if (error || !data) { toast.error("Couldn't find that render — it may have been deleted."); return; }
      if (deepLinkTab && ["scenes", "text", "music", "finish"].includes(deepLinkTab)) setEditTab(deepLinkTab);
      setEditingJob(data);
      // Drop the params so a refresh doesn't fight you re-opening the dialog.
      const next = new URLSearchParams(searchParams);
      next.delete("render"); next.delete("edit");
      setSearchParams(next, { replace: true });
    })();
  }, [deepLinkId, deepLinkTab, searchParams, setSearchParams]);

  const visibleRenders = (renders || []).filter((j: any) => {
    const q = renderQ.trim().toLowerCase();
    if (!q) return true;
    return `${j.blueprint?.title || ""} ${j.brand || ""} ${j.id}`.toLowerCase().includes(q);
  });

  const { data: parsedSources } = useQuery({
    queryKey: ["videostudio-sources"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("media_sources")
        .select("id, filename, duration_seconds, review_status")
        .not("transcript", "is", null)
        .order("created_at", { ascending: false })
        .limit(25);
      return (data || []) as any[];
    },
  });

  // ── actions ───────────────────────────────────────────────────────────────
  const build = useMutation({
    mutationFn: () => autoBuild({
      format, topic: topic.trim(), brand, style, layout: staticLayout,
      ...(vlogTemplate && (format === "reel" || format === "short") ? { template: "chaptered_vlog" as const } : {}),
    }),
    onSuccess: () => {
      toast.success("Build queued — watch it in Renders");
      qc.invalidateQueries({ queryKey: ["videostudio-renders"] });
    },
    onError: (e: any) => toast.error(e?.message || "Build failed"),
  });

  const queueParse = useMutation({
    mutationFn: async () => {
      const url = parseUrl.trim();
      if (!url) throw new Error("Paste a Drive link or video URL first");
      const kind = /\/folders\//.test(url) ? "drive_folder"
        : /drive\.google|drive\.usercontent/.test(url) ? "drive_file" : "url";
      const { error } = await (supabase as any).from("video_parse_jobs").insert({
        kind, media_url: url,
        filename: kind === "url" ? url.split("/").pop()?.split("?")[0] : null,
        tags: ["videostudio"],
      });
      if (error) throw error;
      return await kickParse();
    },
    onSuccess: (kick) => {
      setParseUrl("");
      toast.success(kickMessage(kick, "Parse queued"));
    },
    onError: (e: any) => toast.error(e?.message || "Parse failed"),
  });

  // Story-Edit Engine: one parsed master → long-form episode + shorts + promo
  // (editor-os brain; Behind Shop Doors doctrine — native audio, review card).
  const buildEpisode = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { action: "episode_build" };
      // "shoot:lucid" in the source picker cuts SHOOT-WIDE (all that shoot's files)
      if (episodeSource.startsWith("shoot:")) body.shoot = episodeSource.slice(6);
      else if (episodeSource) body.source_id = episodeSource;
      if (episodeThesis.trim()) body.thesis = episodeThesis.trim();
      const { data, error } = await supabase.functions.invoke("marketing-agent", { body });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      toast.success(`"${d.title || "Episode"}" cut — long-form + ${Array.isArray(d.jobs?.shorts) ? d.jobs.shorts.length : 0} shorts + promo queued. Rough-cut review card sent.`);
      qc.invalidateQueries({ queryKey: ["videostudio-renders"] });
    },
    onError: (e: any) => toast.error(e?.message || "Episode build failed"),
  });

  // Multi-part series: the editor splits the shoot into Part 1/2/3 episodes.
  const seriesBuild = useMutation({
    mutationFn: async () => {
      const shoot = episodeSource.startsWith("shoot:") ? episodeSource.slice(6) : "houdini";
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "series_build", shoot, parts: 3 },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      const n = (d.parts || []).filter((p: any) => p.render_job_id).length;
      toast.success(`"${d.series_title}" — ${n}-part series rendering. Review each part in Renders.`);
      qc.invalidateQueries({ queryKey: ["videostudio-renders"] });
    },
    onError: (e: any) => toast.error(e?.message || "Series build failed"),
  });

  // MTV Cribs: a brash, room-by-room hype tour of the shop, anthem-scored.
  const cribsBuild = useMutation({
    mutationFn: async () => {
      const shoot = episodeSource.startsWith("shoot:") ? episodeSource.slice(6) : "houdini";
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "cribs_build", shoot },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      toast.success(`"${d.title}" — ${d.stops} stops, Cribs tour rendering. Review in Renders.`);
      qc.invalidateQueries({ queryKey: ["videostudio-renders"] });
    },
    onError: (e: any) => toast.error(e?.message || "Cribs build failed"),
  });

  // Edit-by-transcript: read the interview lines, keep the story, render.
  const [paperEdit, setPaperEdit] = useState<any[] | null>(null);
  const transcriptCut = useMutation({
    mutationFn: async () => {
      const shoot = episodeSource.startsWith("shoot:") ? episodeSource.slice(6) : "houdini";
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "transcript_cut", shoot },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      setPaperEdit(d.paper_edit || []);
      toast.success(`"${d.title}" — ${d.lines_kept} lines kept, render queued. Read the paper edit below.`);
      qc.invalidateQueries({ queryKey: ["videostudio-renders"] });
    },
    onError: (e: any) => toast.error(e?.message || "Transcript cut failed"),
  });

  // Doctrine step 3: atomize the approved master into the full channel pack
  // (reels + site teaser + statics + Ink & Edge feature; newsletter automatic).
  const atomizeEpisode = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("marketing-agent", { body: { action: "episode_atomize" } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => {
      toast.success(`"${d.episode}" atomized — ${d.created?.length ?? 0} pieces. Reels + site teaser are in the Director queue.`);
      qc.invalidateQueries({ queryKey: ["videostudio-renders"] });
    },
    onError: (e: any) => toast.error(e?.message || "Atomize failed"),
  });

  // Get the raw full transcript for the picked shoot and download it as a
  // .txt — so the team can paste it into ChatGPT for hooks / reels / captions.
  const getTranscript = useMutation({
    mutationFn: async () => {
      const shoot = episodeSource.startsWith("shoot:") ? episodeSource.slice(6) : "houdini";
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "transcript_export", shoot },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      const text = String(data?.full_text || "");
      if (!text) throw new Error("No transcript text found for this shoot");
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${shoot}-transcript.txt`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      return data;
    },
    onSuccess: (d) => toast.success(`Transcript downloaded — ${d.count} clips, ${Math.round((d.total_chars || 0) / 1000)}K chars`),
    onError: (e: any) => toast.error(e?.message || "Transcript export failed"),
  });

  const generateHooks = useMutation({
    mutationFn: async () => {
      const t = (hookTopic || topic).trim();
      // If a shoot is picked, ground the hooks in its real transcript; the
      // typed topic (if any) becomes the angle. Otherwise topic is required.
      const shoot = episodeSource.startsWith("shoot:") ? episodeSource.slice(6) : "";
      if (!t && !shoot) throw new Error("Type a topic, or pick a shoot to pull hooks from its transcript");
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "hooks", ...(t ? { topic: t } : {}), ...(shoot ? { shoot } : {}), brand, format, count: 10 },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return { hooks: (data?.hooks || []) as Array<{ text: string; style?: string; score?: number }>, grounded: !!data?.grounded };
    },
    onSuccess: (r) => {
      setHooks(r.hooks);
      if (!r.hooks.length) toast.info("No hooks returned — try a more specific topic");
      else if (r.grounded) toast.success(`${r.hooks.length} hooks pulled from the shoot's real transcript`);
    },
    onError: (e: any) => toast.error(e?.message || "Hook generation failed"),
  });

  // One click: shoot → grounded hooks → draft posts in the Director queue
  // (per brand). Approve them at /engine-room/approvals to publish.
  const hooksToDrafts = useMutation({
    mutationFn: async () => {
      const shoot = episodeSource.startsWith("shoot:") ? episodeSource.slice(6) : "";
      if (!shoot) throw new Error("Pick a shoot in the source picker first");
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "hooks_to_drafts", shoot, brands: [brand], format, per_brand: 4 },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (d) => toast.success(`${d.total_drafts} hook drafts sent to the approval queue${d.media_attached ? " (with clip)" : ""}. Approve at /engine-room/approvals.`),
    onError: (e: any) => toast.error(e?.message || "Send to queue failed"),
  });

  // Put a finished render on the Content Review board — the route that didn't
  // exist for anything BrandCast didn't build (Auto-Build, Cut Editor
  // re-renders, older batches). Idempotent per render: re-sending refreshes
  // the card's file instead of stacking duplicates.
  const sendToBoard = useMutation({
    mutationFn: async (job: any) => {
      const res = await sendRenderToBoard(job);
      if (!res.ok) throw new Error(res.error || "Send to board failed");
      return res;
    },
    onSuccess: (res) => toast.success(
      res.refreshed
        ? "Card refreshed on the approval board with the current file"
        : "On the approval board → Needs Approval. Approve at /engine-room/approvals to give it a calendar date.",
    ),
    onError: (e: any) => toast.error(e?.message || "Send to board failed"),
  });

  const sendToDrive = useMutation({
    mutationFn: async (job: any) => {
      const name = `${(job.blueprint?.title || "render").replace(/[^\w\- ]+/g, "").slice(0, 60)}_${job.id.slice(0, 8)}.${job.blueprint?.kind === "static_post" ? "jpg" : "mp4"}`;
      const { data, error } = await supabase.functions.invoke("drive-sync", {
        body: { action: "upload-render", file_url: job.final_url, filename: name },
      });
      if (error) throw new Error(error.message);
      if (data?.ok === false) throw new Error(data?.error || "upload failed");
    },
    onSuccess: () => toast.success("Sent to Drive → 05 – Finished Content & Renders"),
    onError: (e: any) => toast.error(e?.message || "Drive upload failed"),
  });

  // Direct local-file → library upload (the missing piece: put a video into the
  // clip library without the Google Drive round-trip). Uploads to the wrap-files
  // bucket and registers an agent_media_assets row so Auto-Build can use it.
  const libFileRef = useRef<HTMLInputElement>(null);
  const [uploadingLib, setUploadingLib] = useState(false);
  const uploadToLibrary = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploadingLib(true);
    let ok = 0, fail = 0;
    for (const file of Array.from(files)) {
      // AUDIO must be its own type — this exact gap (an mp3 falling through
      // to "video" or "image") is why a whole song catalog went missing:
      // mislabeled 'video' shows a song as a broken thumbnail in every video
      // picker; mislabeled 'image' is silently excluded from the Clip
      // Library query itself (asset_type.neq.image).
      //
      // The rule now lives in ONE place (resolveAssetType) rather than being
      // re-derived here, because it was re-derived at eleven call sites and
      // five of them got it wrong. Same fix shape as the content classifier.
      const { assetType } = resolveAssetType({ filename: file.name, mimeType: file.type });
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
      const path = `content-uploads/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("wrap-files")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) { fail++; console.error("upload failed", file.name, upErr.message); continue; }
      const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
      const { error: insErr } = await (supabase as any).from("agent_media_assets").insert({
        asset_type: assetType,
        storage_url: urlData.publicUrl,
        title: safe.replace(/\.[^.]+$/, "").replace(/-/g, " "),
        original_filename: file.name,
        source_folder: "uploads",
        file_size_bytes: file.size,
        brand,
      });
      if (insErr) { fail++; console.error("insert failed", file.name, insErr.message); continue; }
      ok++;
    }
    setUploadingLib(false);
    if (libFileRef.current) libFileRef.current.value = "";
    if (ok) { toast.success(`${ok} file(s) added to the library`); qc.invalidateQueries({ queryKey: ["videostudio-clips"] }); }
    if (fail) toast.error(`${fail} upload(s) failed — check the console`);
  };

  const hydratedCount = (clips || []).filter((c) => c.storage_url).length;

  return (
    <div className="space-y-6">
      {/* ── BrandCast — upload the install, broadcast everywhere ── */}
      <BrandCast onQueued={() => qc.invalidateQueries({ queryKey: ["videostudio-renders"] })} />

      {/* ── Pro tools toggle ── */}
      <button
        onClick={() => setShowPro((p) => !p)}
        className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-left text-sm font-medium text-gray-600 hover:border-gray-300 shadow-sm"
      >
        ⚙️ Pro tools — Auto-Create, Hook Creator, Parse Footage, Content Finder, Episode Builder {showPro ? "▲" : "▼"}
      </button>

      {showPro && (<>
      {/* ── Auto-Create ── */}
      <Card className="border-gray-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-gray-900">
            <Film className="w-5 h-5 text-[#3b82f6]" /> AI Auto-Create
            <span className="text-xs font-normal text-gray-500 ml-2">clips → captions → music → render, one button</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Brand</div>
            <div className="flex flex-wrap gap-1.5">
              {BRANDS.map((b) => (
                <button
                  key={b.slug}
                  onClick={() => setBrand(b.slug)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${brand === b.slug ? "border-transparent bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Style</div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setStyle("wpw_dark_clean")}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${style === "wpw_dark_clean" ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
              >
                Dark Clean — scrim + big bold type
              </button>
              <button
                onClick={() => setStyle("standard")}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${style === "standard" ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
              >
                Standard — boxed captions
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {(Object.keys(FORMAT_SPECS) as BuildFormat[]).map((f) => {
              const Icon = FORMAT_ICONS[f];
              const spec = FORMAT_SPECS[f];
              return (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`rounded-lg border p-3 text-left transition ${format === f ? "border-[#3b82f6] bg-[#3b82f6]/5" : "border-gray-200 bg-white hover:border-gray-300"}`}
                >
                  <div className="flex items-center gap-2 font-medium text-sm text-gray-900">
                    <Icon className="w-4 h-4" /> {spec.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{spec.aspectRatio} · {spec.duration === 0 ? (f === "carousel" ? "swipe slides" : "static image") : `~${spec.duration >= 60 ? `${Math.round(spec.duration / 60)}min` : `${spec.duration}s`}`}</div>
                </button>
              );
            })}
          </div>
          {format === "static" && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Post layout</div>
              <div className="flex flex-wrap gap-1.5">
                {STATIC_LAYOUTS.map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setStaticLayout(k)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition ${staticLayout === k ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {(format === "reel" || format === "short") && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Video template</div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setVlogTemplate(false)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${!vlogTemplate ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
                >
                  Standard cuts
                </button>
                <button
                  onClick={() => setVlogTemplate(true)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${vlogTemplate ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
                >
                  Chaptered vlog — stacked panels + serif title
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder='Topic — e.g. "cybertruck fade wrap reveal" or "shop tour: how we print"'
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="flex-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
            />
            <Button
              onClick={() => build.mutate()}
              disabled={building || !topic.trim()}
              className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:opacity-90 text-white font-semibold"
            >
              {building ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{progress.detail || "Building…"}</> : "⚡ Auto-Build"}
            </Button>
          </div>
          {progress.step === "error" && <p className="text-sm text-red-600">{progress.error}</p>}
          {progress.step === "queued" && <p className="text-sm text-green-600">{progress.detail}</p>}
          <p className="text-xs text-gray-500">
            {hydratedCount} clips ready in the library · {(parsedSources || []).length} parsed sources (long-form uses hook-scored moments when available)
          </p>
        </CardContent>
      </Card>

      {/* ── Hook Creator ── */}
      <Card className="border-gray-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-gray-900">🎯 Hook Creator <span className="text-xs font-normal text-gray-500">topic OR a picked shoot → 10 ranked hooks in the brand's voice (a shoot pulls hooks from its real transcript)</span></CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder={topic.trim() ? `Topic (blank = "${topic.trim().slice(0, 40)}")` : 'Topic — e.g. "chrome delete on a Tesla"'}
              value={hookTopic}
              onChange={(e) => setHookTopic(e.target.value)}
              className="flex-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
            />
            <Button variant="outline" onClick={() => generateHooks.mutate()} disabled={generateHooks.isPending}>
              {generateHooks.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Writing…</> : "Generate Hooks"}
            </Button>
            <Button
              onClick={() => hooksToDrafts.mutate()}
              disabled={hooksToDrafts.isPending}
              className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:opacity-90 text-white font-semibold"
              title="Pick a shoot → send its top hooks straight to the approval queue as draft posts (approve = published)"
            >
              {hooksToDrafts.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Queuing…</> : "→ Send to Approval Queue"}
            </Button>
          </div>
          {hooks.length > 0 && (
            <div className="space-y-1.5">
              {hooks.map((h, i) => (
                <div key={i} className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-1.5">
                  <span className="text-xs font-bold text-[#ec4899] w-8 shrink-0">{h.score ?? "—"}</span>
                  <span className="text-sm text-gray-800 flex-1">{h.text}</span>
                  {h.style && <Badge variant="outline" className="border-gray-300 text-gray-500 text-[10px] shrink-0">{h.style}</Badge>}
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs shrink-0"
                    onClick={() => { navigator.clipboard?.writeText(h.text); toast.success("Hook copied"); }}>
                    copy
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs shrink-0"
                    onClick={() => { setTopic(h.text); toast.success("Set as build topic"); }}>
                    use
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Parse Footage ── */}
      <Card className="border-gray-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-gray-900">📥 Parse Footage <span className="text-xs font-normal text-gray-500">Drive link → transcript + hook-scored moments (feeds long-form builds)</span></CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Google Drive file/folder link or direct video URL"
            value={parseUrl}
            onChange={(e) => setParseUrl(e.target.value)}
            className="flex-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
          />
          <Button variant="outline" onClick={() => queueParse.mutate()} disabled={queueParse.isPending}>
            {queueParse.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Parse it"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Content Finder — search the index, build from anything ── */}
      <ContentFinder />

      {/* ── Episode Builder — the Story-Edit Engine ── */}
      <Card className="border-gray-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-gray-900">
            🎞️ Episode Builder{" "}
            <span className="text-xs font-normal text-gray-500">
              one parsed master → long-form episode (documentary, natural audio) + shorts + promo. Rough cut goes to Amanda/Trish for notes.
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="space-y-2">
            <select
              value={episodeSource}
              onChange={(e) => setEpisodeSource(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="">Newest parsed master</option>
              <option value="shoot:lucid">🎬 LUCID WRAPS (Denver) — whole shoot</option>
              <option value="shoot:houdini">🎬 HOUDINI WRAPS (Las Vegas) — whole shoot</option>
              {(parsedSources || []).map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.filename || s.id.slice(0, 8)} {s.duration_seconds ? `(${Math.round(s.duration_seconds / 60)}min)` : ""}
                </option>
              ))}
            </select>
            <Input
              placeholder='Thesis / notes (optional) — e.g. "no one way for success"'
              value={episodeThesis}
              onChange={(e) => setEpisodeThesis(e.target.value)}
              className="w-full bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => buildEpisode.mutate()}
                disabled={buildEpisode.isPending || !(parsedSources || []).length}
                className="flex-1 min-w-[10rem] bg-gradient-to-r from-[#3b82f6] to-[#ec4899] hover:opacity-90 text-white font-semibold"
              >
                {buildEpisode.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Cutting…</> : "🎬 Cut Episode"}
              </Button>
              <Button
                variant="outline" className="flex-1 min-w-[9rem]"
                onClick={() => transcriptCut.mutate()}
                disabled={transcriptCut.isPending}
                title="Edit by reading the transcript — keep the lines that tell the story, render the interview cut"
              >
                {transcriptCut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "📝 Cut by Transcript"}
              </Button>
              <Button
                variant="outline" className="flex-1 min-w-[9rem]"
                onClick={() => seriesBuild.mutate()}
                disabled={seriesBuild.isPending}
                title="Split the shoot into a multi-part series (Part 1 / 2 / 3), one episode each"
              >
                {seriesBuild.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "🎬 Build Series (Parts)"}
              </Button>
              <Button
                variant="outline" className="flex-1 min-w-[9rem]"
                onClick={() => cribsBuild.mutate()}
                disabled={cribsBuild.isPending}
                title="MTV Cribs tour: a brash, room-by-room hype tour of the shop, anthem-scored, 16:9"
              >
                {cribsBuild.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "🕶️ MTV Cribs Tour"}
              </Button>
              <Button
                variant="outline" className="flex-1 min-w-[9rem]"
                onClick={() => getTranscript.mutate()}
                disabled={getTranscript.isPending}
                title="Download the full raw transcript for this shoot (.txt) — paste into ChatGPT for hooks / reels / captions"
              >
                {getTranscript.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "📄 Get Transcript"}
              </Button>
              <Button
                variant="outline" className="flex-1 min-w-[7rem]"
                onClick={() => atomizeEpisode.mutate()}
                disabled={atomizeEpisode.isPending}
                title="After the rough cut is approved: derive reels + site teaser + statics + Ink & Edge feature from the finished renders"
              >
                {atomizeEpisode.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "⚛ Atomize"}
              </Button>
            </div>
          </div>
          {paperEdit && (
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Paper edit — the lines kept, in order</div>
              <ol className="space-y-1 text-sm text-gray-700">
                {paperEdit.map((p: any) => (
                  <li key={p.n} className="flex gap-2">
                    <span className="shrink-0 font-mono text-xs text-gray-400">{Math.floor(p.in / 60)}:{String(Math.round(p.in % 60)).padStart(2, "0")}</span>
                    <span>{p.speaker ? <span className="font-semibold">{p.speaker}: </span> : null}{p.line}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="text-xs text-gray-500">
            Behind Shop Doors doctrine enforced: interview spine, natural sound, lower-thirds only — anthem tracks never score the episode. Shorts + promo derive from the same cut.
          </p>
        </CardContent>
      </Card>
      </>)}

      {/* ── Renders ── */}
      <Card className="border-gray-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-gray-900 flex items-center justify-between">
            <span>🎬 Renders</span>
            <Button size="sm" variant="ghost" onClick={() => refetchRenders()}><RefreshCw className="w-4 h-4" /></Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Find the EXACT video — search, or paste the URL you're watching */}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Search renders by title, brand or id…"
              value={renderQ} onChange={(e) => setRenderQ(e.target.value)}
              className="flex-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
            />
            <Button variant="outline" onClick={() => openExact.mutate(renderQ)} disabled={openExact.isPending}
              title="Paste the video's mp4 URL (or job id) and jump straight into its editor">
              {openExact.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "✂️ Open pasted link in editor"}
            </Button>
          </div>
          {!renders?.length && <p className="text-sm text-gray-500">No renders yet — build one above.</p>}
          {!!renders?.length && !visibleRenders.length && (
            <p className="text-sm text-gray-500">Nothing matches "{renderQ}" in the last 100 renders — paste the video's URL and hit Open instead.</p>
          )}
          {/* Reels are PHONE-SHAPED: vertical 9:16 tiles in a dense grid (no
              letterbox bars, no wasted space); 16:9 long-form spans wide. */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
            {visibleRenders.map((job) => (
              <div key={job.id} className={`rounded-lg border border-gray-200 bg-white p-3 space-y-2 shadow-sm ${job.blueprint?.aspectRatio === "16:9" ? "col-span-2" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate text-gray-900">{job.blueprint?.title || job.blueprint?.id || job.id.slice(0, 8)}</span>
                  <div className="flex items-center gap-1">
                    {job.blueprint?.scenes?.length > 0 && (
                      <Button size="sm" variant="ghost" title="Cut Editor — adjust this cut and re-render" onClick={() => { setEditTab("scenes"); setEditingJob(job); }}>✂️</Button>
                    )}
                    {job.final_url && !/\.jpg$/.test(job.final_url) && job.blueprint?.kind !== "static_post" && job.blueprint?.kind !== "frame_grab" && (
                      <Button size="sm" variant="ghost" title="Clip a reel or grab a still at any social size" onClick={() => setClipJob(job)}>🎞️</Button>
                    )}
                    <StatusBadge status={job.status} />
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {job.blueprint?.format || "reel"} · {job.blueprint?.aspectRatio || "9:16"} · {new Date(job.created_at).toLocaleString()}
                  {" · "}<span className="font-mono text-gray-400">{job.id.slice(0, 8)}</span>
                </div>
                {/* Deep-links: land on the tab that does the job you clicked */}
                {job.blueprint?.scenes?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <button onClick={() => { setEditTab("finish"); setEditingJob(job); }}
                      className="rounded-full border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:border-gray-400">🏷️ Logo</button>
                    <button onClick={() => { setEditTab("text"); setEditingJob(job); }}
                      className="rounded-full border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:border-gray-400">🔤 Font</button>
                    <button onClick={() => { setEditTab("music"); setEditingJob(job); }}
                      className="rounded-full border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:border-gray-400">🎵 Music</button>
                    <button onClick={() => { setEditTab("scenes"); setEditingJob(job); }}
                      className="rounded-full border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:border-gray-400">✂️ Scenes</button>
                  </div>
                )}
                {job.status === "failed" && job.error && <p className="text-xs text-red-600 line-clamp-2">{job.error}</p>}
                {job.final_url && (
                  <>
                    {job.blueprint?.kind === "static_post"
                      ? <img src={job.final_url} alt={job.blueprint?.title || "post"} className="w-full rounded max-h-64 object-contain bg-black" />
                      : <video playsInline src={job.final_url} poster={job.thumbnail_url || undefined} controls preload="none"
                          className={`w-full rounded bg-black object-contain ${job.blueprint?.aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]"}`} />}
                    <div className="flex gap-2">
                      <a href={job.final_url} download className="flex-1">
                        <Button size="sm" variant="outline" className="w-full">Download</Button>
                      </a>
                      <Button size="sm" variant="outline" onClick={() => sendToDrive.mutate(job)} disabled={sendToDrive.isPending}>
                        <Upload className="w-3 h-3 mr-1" /> Drive
                      </Button>
                    </div>
                    {/* The approval route: any finished render → Content Review */}
                    <Button
                      size="sm"
                      className="w-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:opacity-90"
                      title="Send to the Content Review board for approval + a calendar date"
                      onClick={() => sendToBoard.mutate(job)}
                      disabled={sendToBoard.isPending}
                    >
                      <ClipboardCheck className="w-3 h-3 mr-1" /> Send to Approval Board
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Clip Library ── */}
      <Card className="border-gray-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base text-gray-900 flex items-center justify-between gap-2">
            <span>📁 Clip Library <span className="text-xs font-normal text-gray-500">Drive sync + direct upload</span></span>
            <label className={`inline-flex items-center gap-1.5 rounded-md border border-[#3b82f6] px-3 py-1.5 text-xs font-semibold text-[#3b82f6] cursor-pointer hover:bg-blue-50 ${uploadingLib ? "opacity-60 pointer-events-none" : ""}`}>
              <input
                ref={libFileRef}
                type="file"
                accept="video/*,image/*,audio/*"
                multiple
                hidden
                onChange={(e) => uploadToLibrary(e.target.files)}
              />
              {uploadingLib ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</> : <><Upload className="w-3.5 h-3.5" /> Upload to Library</>}
            </label>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!clips?.length && <p className="text-sm text-gray-500">Library is empty — run a Drive scan (drive-sync) to register clips.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(clips || []).map((c) => (
              <div key={c.id} className="rounded border border-gray-200 bg-white px-3 py-2 text-sm flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-gray-900">{c.title || c.original_filename}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {c.source_folder?.split("/")[0]} · {c.file_size_bytes ? `${Math.round(c.file_size_bytes / 1e6)}MB` : "—"}
                  </div>
                </div>
                {c.asset_type === "rendered_video"
                  ? <Badge className="shrink-0 bg-purple-50 text-purple-700 border-purple-300">render</Badge>
                  : c.asset_type === "audio"
                    ? <Badge className="shrink-0 bg-amber-50 text-amber-700 border-amber-300">🎵 song</Badge>
                    : c.storage_url
                      ? <Badge className="shrink-0 bg-green-50 text-green-700 border-green-300">ready</Badge>
                      : <Badge className="shrink-0 bg-gray-100 text-gray-500 border-gray-300">drive only</Badge>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {editingJob && (
        <CutEditor job={editingJob} initialTab={editTab} onClose={() => setEditingJob(null)}
          onQueued={() => qc.invalidateQueries({ queryKey: ["videostudio-renders"] })} />
      )}
      {clipJob && (
        <ClipTools job={clipJob} onClose={() => setClipJob(null)}
          onQueued={() => qc.invalidateQueries({ queryKey: ["videostudio-renders"] })} />
      )}
    </div>
  );
}
