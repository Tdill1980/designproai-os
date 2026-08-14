// AdminCreator — Creator Studio (/admin/creator)
//
// The UI face of the content-intelligence library + video pipeline:
// browse every parsed source (episodes, clips, music), play video and
// JUMP to scored moments (the hook = the timestamp), see transcripts,
// pick thumbnails from ingested shoot photos, and copy hooks as text
// overlays for reels/shorts/carousels. Data: media_sources +
// content_moments + music_analysis (authenticated read via RLS).
import { kickParse, kickMessage } from "@/lib/kickParse";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CutEditor from "@/components/engineroom/CutEditor";
import CreatorBuildPanel from "@/components/engineroom/CreatorBuildPanel";
import CreatorHowItWorks from "@/components/engineroom/CreatorHowItWorks";
import { toast } from "sonner";

// Drop-start edit — mashup cuts open ON the beat, never the intro
const HOUSE_MUSIC = "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/wrap-files/wraptv-music/the-wrap-game-drop.mp3";

// Build a VideoBlueprint from a source's scored moments — the same
// recipe as the hand-cut Houdini V2: fast takes, punch text, music-forward.
// deno-lint-ignore-file — plain client helper
function buildFastCut(src: any, moments: any[]) {
  const take = 4.0;
  const usable = (moments ?? [])
    .filter((m: any) => m.start_time !== null)
    .sort((a: any, b: any) => (b.hook_score ?? 0) - (a.hook_score ?? 0))
    .slice(0, 6)
    .sort((a: any, b: any) => Number(a.start_time) - Number(b.start_time));
  const scenes = (usable.length > 0 ? usable : [{ start_time: 0, verbatim_quote: "" }]).map((m: any, i: number, arr: any[]) => ({
    sceneId: `s${i + 1}`,
    clipId: src.id,
    clipUrl: src.storage_url,
    start: Number(m.start_time) || 0,
    end: (Number(m.start_time) || 0) + take,
    purpose: i === 0 ? "hook" : i === arr.length - 1 ? "cta" : (i % 3 === 0 ? "pattern_interrupt" : "proof"),
    text: i % 2 === 0 && m.verbatim_quote ? String(m.verbatim_quote).toUpperCase().slice(0, 42) : undefined,
    textPosition: "bottom" as const,
    animation: "punch" as const,
  }));
  return {
    id: `cut_${src.id.slice(0, 8)}_${Math.random().toString(36).slice(2, 7)}`,
    platform: "youtube",
    format: "reel",
    aspectRatio: "16:9",
    totalDuration: scenes.length * take + 3,
    scenes,
    endCard: { duration: 3, text: "EVERY SHOP HAS A STORY", cta: "WrapTVWorld · WePrintWraps · DesignProAI" },
    captionStyle: "sabri",
    brand: "weprintwraps",
    source: "manual",
    title: `Fast cut — ${src.title || src.filename}`,
  };
}

const fmtTs = (s?: number | null) => {
  if (s === null || s === undefined) return "?";
  const n = Number(s);
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
};

export default function AdminCreator() {
  const [selected, setSelected] = useState<string | null>(null);
  const [seek, setSeek] = useState<number | null>(null);
  const [parseUrl, setParseUrl] = useState("");
  const [parseTags, setParseTags] = useState("");
  const [uploading, setUploading] = useState(false);
  // Footage library + parsing is power-user plumbing — collapsed by default so
  // the page leads with Build + your videos, not the parse queue and clips.
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Direct upload: music or video file → base64 → sweep transcribe mode
  // (archives to storage, Whisper-transcribes, catalogs + agent-scores).
  // Edge body cap ≈20MB, so files ≤15MB here; bigger videos go via the
  // Drive-link parse pipeline above.
  const uploadMedia = async (file: File) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("Over 15MB — put it in Drive and paste the link above instead (no size limit there).");
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      let bin = ""; const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const { data, error } = await (supabase as any).functions.invoke("wpw-workforce-sweep", {
        body: { mode: "transcribe", filename: file.name, audio_base64: btoa(bin) },
      });
      if (error) throw error;
      toast.success(`Uploaded + cataloged: ${file.name} — transcribed and queued for hook scoring.`);
      qc.invalidateQueries({ queryKey: ["creator-sources"] });
    } catch (e: any) {
      toast.error(String(e.message ?? e));
    } finally { setUploading(false); }
  };

  // ── SAMPLE A TRACK from the list ─────────────────────────────────────────
  // Picking music by filename is guesswork. One shared Audio element, so only
  // one track ever plays and a second tap always stops the first.
  const [sampling, setSampling] = useState<string | null>(null);
  const sampleRef = useRef<HTMLAudioElement | null>(null);
  const sampleTrack = (id: string, url?: string | null) => {
    if (!url) return;
    if (sampleRef.current) { sampleRef.current.pause(); sampleRef.current = null; }
    if (sampling === id) { setSampling(null); return; }
    const a = new Audio(url);
    a.onended = () => setSampling(null);
    a.onerror = () => { toast.error("Couldn't play that track"); setSampling(null); };
    a.play().catch(() => { toast.error("Couldn't play that track"); setSampling(null); });
    sampleRef.current = a;
    setSampling(id);
  };
  // Never leave a track playing after the page unmounts.
  useEffect(() => () => { sampleRef.current?.pause(); }, []);

  const { data: sources } = useQuery({
    queryKey: ["creator-sources"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("media_sources")
        .select("id, kind, title, filename, storage_url, shoot, transcript, duration_seconds, emotional_tone, energy, recommended_formats, review_status, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: moments } = useQuery({
    queryKey: ["creator-moments", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("content_moments")
        .select("id, start_time, end_time, speaker, verbatim_quote, hook_score, soundbite_score, content_uses")
        .eq("source_id", selected)
        .order("hook_score", { ascending: false, nullsFirst: false })
        .limit(120);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: photos } = useQuery({
    queryKey: ["creator-photos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("agent_media_assets")
        .select("id, storage_url, original_filename, tags")
        .eq("asset_type", "image")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const qc = useQueryClient();
  const src = (sources ?? []).find((s: any) => s.id === selected);
  const videos = (sources ?? []).filter((s: any) => s.kind === "video");
  const music = (sources ?? []).filter((s: any) => s.kind === "music");

  const { data: jobs } = useQuery({
    queryKey: ["render-jobs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("video_render_jobs")
        .select("id, status, final_url, thumbnail_url, error, created_at, blueprint, brand")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15000,
  });

  // Team QC / edit surface — which finished render is open in the Cut Editor.
  const [editingJob, setEditingJob] = useState<any>(null);

  const { data: parseJobs } = useQuery({
    queryKey: ["parse-jobs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("video_parse_jobs")
        .select("id, kind, filename, media_url, status, segments, chunks, error, tags, created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15000,
  });

  // Queue a Drive file/folder (or any direct media URL) for the parse
  // worker: download → audio extract → Whisper → media_sources +
  // content_moments, then agent scoring. Runs on GitHub Actions every
  // ~10 min because multi-GB camera raws can't fit in an edge function.
  const queueParse = useMutation({
    mutationFn: async () => {
      const url = parseUrl.trim();
      if (!url) throw new Error("Paste a Google Drive file/folder link or a direct media URL");
      const kind = /\/folders\//.test(url) ? "drive_folder"
        : /drive\.google|drive\.usercontent/.test(url) ? "drive_file" : "url";
      const tags = parseTags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      const { error } = await (supabase as any).from("video_parse_jobs").insert({
        kind, media_url: url, tags,
        filename: kind === "url" ? url.split("/").pop()?.split("?")[0] : null,
      });
      if (error) throw error;
      return { kind, kick: await kickParse() };
    },
    onSuccess: ({ kind, kick }) => {
      setParseUrl("");
      toast.success(kind === "drive_folder"
        ? `${kickMessage(kick, "Folder queued")} The parser expands it into one job per video, then transcribes each.`
        : kickMessage(kick, "Footage queued"));
      qc.invalidateQueries({ queryKey: ["parse-jobs"] });
    },
    onError: (e: any) => toast.error(String(e.message ?? e)),
  });

  const renderCut = useMutation({
    mutationFn: async () => {
      if (!src?.storage_url) throw new Error("Select a video source first");
      const blueprint = buildFastCut(src, moments ?? []);
      const { data, error } = await (supabase as any).functions.invoke("video-render", {
        body: { blueprint, music_url: HOUSE_MUSIC, brand: "weprintwraps", source_ref: `creator_${src.id}` },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => {
      toast.success(d?.final_url
        ? "Cut rendered! Scroll to Render Jobs to watch."
        : "Cut dispatched — the render worker picks it up within ~5 minutes. Watch Render Jobs below.");
      qc.invalidateQueries({ queryKey: ["render-jobs"] });
    },
    onError: (e: any) => toast.error(String(e.message ?? e)),
  });

  const copyHook = (q: string) => {
    navigator.clipboard?.writeText(q);
    toast.success("Hook copied — paste as text overlay");
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 px-4 py-6 md:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl md:text-3xl font-bold">
            Creator <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Studio</span>
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Every parsed source, its scored moments, and the hooks — click a moment to jump the player; copy any hook as a text overlay.
          </p>
        </header>

        {/* Plain-language walkthrough — "show Amanda how it works" */}
        <CreatorHowItWorks />

        {/* Advanced — footage library + parsing. Collapsed by default so the
            page leads with Build + your videos, not the parse queue & clips. */}
        <button onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm">
          <span className="text-sm font-bold text-gray-700">🔧 Footage library &amp; parsing <span className="font-normal text-gray-400">(advanced — parse Drive links, browse clips, scored moments)</span></span>
          <span className="text-xs font-semibold text-gray-500">{showAdvanced ? "Hide ▲" : "Show ▼"}</span>
        </button>

        {showAdvanced && (<>
        {/* Parse footage — queue raw camera files / Drive folders from the UI */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">📥 Parse footage (Drive link → transcripts → scored hooks)</h2>
          <div className="flex flex-col md:flex-row gap-2">
            <input
              value={parseUrl}
              onChange={(e) => setParseUrl(e.target.value)}
              placeholder="Paste a Google Drive file or folder link (or direct video URL)"
              className="flex-1 rounded-lg bg-white border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#3b82f6] outline-none"
            />
            <input
              value={parseTags}
              onChange={(e) => setParseTags(e.target.value)}
              placeholder="tags: shoot, series (e.g. houdini-wraps, behind-shop-doors)"
              className="md:w-80 rounded-lg bg-white border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#3b82f6] outline-none"
            />
            <Button
              className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white font-bold"
              disabled={queueParse.isPending}
              onClick={() => queueParse.mutate()}>
              {queueParse.isPending ? "Queuing…" : "Parse it"}
            </Button>
          </div>
          <div className="flex flex-col md:flex-row gap-2 items-start md:items-center">
            <label className={`rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold cursor-pointer ${uploading ? "opacity-50" : "hover:border-[#FF2DC8]"}`}>
              {uploading ? "Uploading…" : "🎬 Upload video"}
              <input type="file" accept="video/*" className="hidden" disabled={uploading}
                onChange={(e) => e.target.files?.[0] && uploadMedia(e.target.files[0])} />
            </label>
            <label className={`rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold cursor-pointer ${uploading ? "opacity-50" : "hover:border-[#00C7FF]"}`}>
              {uploading ? "Uploading…" : "🎵 Upload music"}
              <input type="file" accept="audio/*" className="hidden" disabled={uploading}
                onChange={(e) => e.target.files?.[0] && uploadMedia(e.target.files[0])} />
            </label>
            <span className="text-xs text-gray-500">≤15MB direct (video audio is transcribed for verbal hooks + scored). Bigger footage: paste the Drive link above.</span>
          </div>
          {(parseJobs ?? []).length > 0 && (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
              {(parseJobs ?? []).map((j: any) => (
                <div key={j.id} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium truncate">{j.filename || j.media_url}</span>
                    <Badge className={
                      j.status === "complete" ? "bg-emerald-600"
                        : j.status === "failed" ? "bg-red-600"
                          : j.status === "processing" ? "bg-yellow-600" : "bg-gray-600"}>
                      {j.status}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {j.kind === "drive_folder"
                      ? (j.status === "complete" ? `expanded into ${j.chunks ?? 0} file jobs` : "folder")
                      : j.status === "complete" ? `${j.segments ?? 0} segments cataloged${(j.chunks ?? 1) > 1 ? ` · ${j.chunks} chunks` : ""}`
                        : j.status === "failed" ? String(j.error ?? "").slice(0, 80)
                          : "waiting for the parse worker (runs every ~10 min)"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Source library */}
          <section className="space-y-2 lg:max-h-[80vh] lg:overflow-y-auto pr-1">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">📼 Episodes & clips ({videos.length})</h2>
            {/* A THUMBNAIL, not just a filename. "20251214_CHRISA7-45029.MP4"
                tells you nothing about which clip it is — the frame does. */}
            {videos.map((s: any) => (
              <button key={s.id}
                onClick={() => { setSelected(s.id); setSeek(null); }}
                className={`flex w-full items-center gap-2.5 rounded-lg border p-2 text-left ${selected === s.id ? "border-[#3b82f6] bg-[#3b82f6]/5" : "border-gray-200 bg-white hover:border-gray-300"}`}>
                <span className="h-12 w-20 shrink-0 overflow-hidden rounded bg-black">
                  {s.storage_url && (
                    <video src={`${s.storage_url}#t=1`} preload="metadata" muted playsInline
                      className="h-full w-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.title || s.filename}</span>
                  <span className="block text-xs text-gray-500">
                    {s.shoot || "—"} · {s.review_status}{s.duration_seconds ? ` · ${fmtTs(s.duration_seconds)}` : ""}
                  </span>
                </span>
              </button>
            ))}
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 pt-3">
              🎵 Music ({music.length}) <span className="font-normal normal-case tracking-normal text-gray-400">— tap ▶ to sample without leaving the list</span>
            </h2>
            {music.map((s: any) => (
              <div key={s.id}
                className={`flex w-full items-center gap-2 rounded-lg border p-2 ${selected === s.id ? "border-[#ec4899] bg-[#ec4899]/5" : "border-gray-200 bg-white hover:border-gray-300"}`}>
                {/* SAMPLE IT. Picking a track by name alone is guesswork. */}
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); sampleTrack(s.id, s.storage_url); }}
                  disabled={!s.storage_url}
                  title={sampling === s.id ? "Stop" : "Sample this track"}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ${sampling === s.id ? "bg-[#ec4899] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"} disabled:opacity-40`}>
                  {sampling === s.id ? "■" : "▶"}
                </button>
                <button type="button" onClick={() => { setSelected(s.id); setSeek(null); }} className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-sm font-medium">{s.title || s.filename}</span>
                  <span className="block text-xs text-gray-500">
                    {s.energy || ""} {s.emotional_tone ? `· ${s.emotional_tone}` : ""}
                    {s.duration_seconds ? ` · ${fmtTs(s.duration_seconds)}` : ""}
                  </span>
                </button>
              </div>
            ))}
          </section>

          {/* Player + transcript */}
          <section className="lg:col-span-1 space-y-3">
            {src ? (
              <>
                {src.kind === "video" ? (
                  <video key={`${src.id}-${seek ?? 0}`} controls autoPlay={seek !== null} className="w-full rounded-xl border border-gray-200 bg-black"
                    src={src.storage_url ? `${src.storage_url}#t=${seek ?? 0}` : undefined} />
                ) : (
                  <audio key={`${src.id}-${seek ?? 0}`} controls autoPlay={seek !== null} className="w-full"
                    src={src.storage_url ? `${src.storage_url}#t=${seek ?? 0}` : undefined} />
                )}
                <div className="text-xs text-gray-600">
                  {src.recommended_formats?.length > 0 && (
                    <div className="mb-1">Formats: {src.recommended_formats.map((f: string) => <Badge key={f} variant="outline" className="mr-1 border-gray-300 text-gray-700">{f}</Badge>)}</div>
                  )}
                </div>
                {src.kind === "video" && (
                  <Button className="w-full bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white font-bold"
                    disabled={renderCut.isPending}
                    onClick={() => renderCut.mutate()}>
                    {renderCut.isPending ? "Dispatching…" : "⚡ Generate Fast Cut (auto-edit + music + overlays)"}
                  </Button>
                )}
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 max-h-64 overflow-y-auto">
                  <div className="text-xs uppercase text-gray-500 mb-1">Transcript</div>
                  <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{src.transcript || "Not transcribed yet."}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">Select a source to load the player.</p>
            )}
          </section>

          {/* Moments / hooks */}
          <section className="space-y-2 lg:max-h-[80vh] lg:overflow-y-auto pr-1">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">🎯 Scored moments — click to jump, copy for overlay</h2>
            {(moments ?? []).length === 0 && <p className="text-sm text-gray-500">No analyzed moments yet for this source.</p>}
            {(moments ?? []).map((m: any) => (
              <div key={m.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <button className="text-xs text-[#3b82f6] font-medium" onClick={() => setSeek(Number(m.start_time) || 0)}>
                    ▶ {fmtTs(m.start_time)}–{fmtTs(m.end_time)}
                  </button>
                  <div className="flex gap-1">
                    {m.hook_score != null && <Badge className="bg-[#ec4899] text-white">hook {m.hook_score}</Badge>}
                    {m.soundbite_score != null && <Badge variant="outline" className="border-gray-300 text-gray-700">bite {m.soundbite_score}</Badge>}
                  </div>
                </div>
                <p className="text-[13px] mt-1">{m.verbatim_quote}</p>
                <button className="text-xs text-gray-500 underline mt-1" onClick={() => copyHook(m.verbatim_quote)}>copy as overlay</button>
              </div>
            ))}
          </section>
        </div>
        </>)}

        {/* Build from library — Reel / Long-form / Carousel */}
        <CreatorBuildPanel />

        {/* Render jobs */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">🎬 Render jobs (the system's cuts)</h2>
          {(jobs ?? []).length === 0 && <p className="text-sm text-gray-500">No renders yet — select a source and hit Generate Fast Cut.</p>}
          <div className="grid md:grid-cols-2 gap-4">
            {(jobs ?? []).map((j: any) => (
              <div key={j.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs text-gray-600 min-w-0">
                    <Badge className={j.status === "complete" ? "bg-emerald-600" : j.status === "failed" ? "bg-red-600" : "bg-yellow-600"}>{j.status}</Badge>
                    <span className="ml-2 truncate">{j.blueprint?.title || j.id.slice(0, 8)}</span>
                  </div>
                  {j.blueprint?.scenes?.length > 0 && (
                    <Button size="sm" variant="outline" className="shrink-0 border-gray-300 text-gray-700"
                      onClick={() => setEditingJob(j)}
                      title="QC & edit this cut — swap music, edit/insert text overlays, reorder or trim scenes, then re-render">
                      ✂️ Edit
                    </Button>
                  )}
                </div>
                {j.final_url
                  ? <video controls src={j.final_url} className="w-full rounded-lg bg-black" />
                  : j.status === "failed"
                    ? <p className="text-xs text-red-600">{String(j.error).slice(0, 200)}</p>
                    : <p className="text-xs text-gray-500">Rendering — the worker drains the queue every ~5 min.</p>}
              </div>
            ))}
          </div>
        </section>

        {/* Team QC / Cut Editor — swap music, edit overlays, reorder/trim, re-render */}
        {editingJob && (
          <CutEditor
            job={editingJob}
            onClose={() => setEditingJob(null)}
            onQueued={() => qc.invalidateQueries({ queryKey: ["render-jobs"] })}
          />
        )}

        {/* Thumbnails */}
        <section>
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500 mb-2">🖼 Thumbnail & carousel picks (ingested shoot photos)</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {(photos ?? []).map((p: any) => (
              <a key={p.id} href={p.storage_url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-gray-200">
                <img src={p.storage_url} alt={p.original_filename} className="w-full h-28 object-cover" />
                <div className="text-[10px] text-gray-500 px-1 py-0.5 truncate">{p.original_filename}</div>
              </a>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
