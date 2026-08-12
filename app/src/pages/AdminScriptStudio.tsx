// AdminScriptStudio — ContentDirectorIQ Script Studio (/admin/script-studio)
//
// The strategy is always VISIBLE: every generated script shows the brand,
// pillar, hook family, audience, awareness level, platform format, and the
// evidence backing it (transcript clips / product demonstrations / verified
// facts). The footage provides the truth; the Brand Pillars Library decides
// what story matters; the Hooks Library decides how it earns attention.
//
// ONE workflow, built on the existing video system (no second app/queue/DB):
//   Upload / paste Google Drive URL → Transcribe (video_parse_jobs → the
//   existing transcription worker: download, ffmpeg audio extract, Whisper
//   with timestamps, visual pass, content_moments) → Review transcript →
//   Analyze against the brand's EXISTING pillars → lock strategy (pillar /
//   audience / awareness / platform / objective / format / approved hook,
//   editing brain auto-selected by content type) → Generate → review
//   per-line provenance → revise with directives → APPROVE (human gate) →
//   Send to editor (existing video pipeline; refine in the Engine Room
//   CutEditor).
import { kickParse, kickMessage } from "@/lib/kickParse";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, ShieldCheck, AlertTriangle, Film, Sparkles, Send, UploadCloud, ChevronDown, Copy, Download, Search, HelpCircle } from "lucide-react";
import { brandMeta } from "@/lib/content-tags";
import { assetThumb } from "@/lib/assetThumb";
import {
  cdiq,
  CDIQ_BRANDS,
  CDIQ_FORMATS,
  CDIQ_OBJECTIVES,
  CDIQ_PLATFORMS,
  AWARENESS_LEVELS,
  type BrandId,
  type BrandPillarMatch,
  type CdiqGenerateResult,
  type CdiqHook,
} from "@/lib/contentDirectorIQ";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import MarketingSuiteGuide from "@/components/admin/MarketingSuiteGuide";
import MarketingSystemMap from "@/components/admin/MarketingSystemMap";
import { groupByShow, matchWrapTVShow } from "@/lib/wraptvShowMatch";
import { WRAPTV_SHOWS } from "@/data/wraptvShows";
import { Link } from "react-router-dom";
import {
  shotsForScript, shotCardLink, type ShotRow,
} from "@/lib/shotScriptLink";

/** A MASTER SCRIPT row, as Script Studio reads it. */
type ScriptRow = {
  id: string; brand: string | null; campaign: string | null;
  shot_title: string | null; filming_instruction: string | null; notes: string | null;
};

const fmtTime = (s?: number | null) => {
  if (s == null || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

const PROVENANCE_META: Record<string, { label: string; cls: string }> = {
  transcript_verified: { label: "transcript", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  demonstrated_output: { label: "product demo", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  approved_brand_fact: { label: "verified fact", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  verified_offer: { label: "offer", cls: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  unverified: { label: "UNVERIFIED", cls: "bg-amber-50 text-amber-700 border-amber-300" },
};

const DIRECTIVE_BUTTONS: { key: string; label: string }[] = [
  { key: "more_problem_aware", label: "More problem-aware" },
  { key: "more_feature_forward", label: "More feature-forward" },
  { key: "more_authoritative", label: "More authoritative" },
  { key: "remove_generic_ai_language", label: "Remove generic AI language" },
  { key: "add_product_proof", label: "Add product proof" },
  { key: "add_output_file_proof", label: "Add output-file proof" },
];

interface MediaRow {
  id: string;
  title: string | null;
  filename: string | null;
  shoot: string | null;
  duration_seconds: number | null;
  transcript: string | null;
  storage_url: string | null;
  drive_id: string | null;
}

/** Source rows are named after the extracted audio proxy (…-clip.mp3) even
 *  though the media itself is the .mp4 — show the human name, not the proxy. */
const sourceLabel = (m: MediaRow) =>
  (m.title || m.filename || m.id.slice(0, 8)).replace(/\.(mp3|mp4|mov|m4a|wav|webm)$/i, "");

async function copyText(text: string, what: string) {
  if (!text.trim()) { toast.error("Nothing to copy yet."); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied — ${text.length.toLocaleString()} characters.`);
  } catch {
    // Clipboard API needs a secure context + permission; the textarea below is
    // always selectable, so say that instead of failing silently.
    toast.error("Clipboard blocked by the browser — select the text in the window and copy manually.");
  }
}

interface PillarRow {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  description: string | null;
}

/** Google Drive folder/file URL or any direct media URL → video_parse_jobs kind. */
function parseJobKind(url: string): "drive_folder" | "drive_file" | "url" {
  if (/\/folders\/[\w-]{20,}/.test(url)) return "drive_folder";
  if (/\/file\/d\/[\w-]{20,}/.test(url) || /[?&]id=[\w-]{20,}/.test(url)) return "drive_file";
  return "url";
}

const JOB_STATUS_CLS: Record<string, string> = {
  queued: "bg-gray-100 text-gray-600",
  processing: "bg-blue-50 text-blue-700",
  complete: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  skipped: "bg-gray-100 text-gray-400",
};

interface ShowRow {
  id: string;
  brand: string | null;
  campaign: string | null;
  shot_title: string | null;
  notes: string | null;
  status: string | null;
}

export default function AdminScriptStudio() {
  const [brand, setBrand] = useState<BrandId>("designproai");
  const [sourceMediaId, setSourceMediaId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [matches, setMatches] = useState<BrandPillarMatch[]>([]);
  const [pillarId, setPillarId] = useState<string>("");
  const [audienceId, setAudienceId] = useState<string>("");
  const [awareness, setAwareness] = useState<string>("problem_aware");
  const [platform, setPlatform] = useState<string>("meta");
  const [objective, setObjective] = useState<string>("awareness");
  const [outputFormat, setOutputFormat] = useState<string>("meta_ad");
  const [hookId, setHookId] = useState<string>("");
  const [transcriptOnly, setTranscriptOnly] = useState(false);
  const [result, setResult] = useState<CdiqGenerateResult | null>(null);
  const [approved, setApproved] = useState(false);
  const [ingestUrl, setIngestUrl] = useState("");
  const [ingestTitle, setIngestTitle] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  // Script viewer — a show card's script rows open here for reading in
  // full (owner 2026-08-04: "there is no button to push to view scripts").
  const [viewScript, setViewScript] = useState<ShowRow | null>(null);
  const [transcriptView, setTranscriptView] = useState<"full" | "timecoded">("full");
  const [mediaQuery, setMediaQuery] = useState("");
  // Tiles whose media could not be decoded (codec the browser lacks, 403, dead
  // link). A black <video> box reads as "broken app"; say what it actually is.
  const [thumbFailed, setThumbFailed] = useState<Record<string, true>>({});
  const [showCoverage, setShowCoverage] = useState(false);
  const qc = useQueryClient();

  // ── Ingest: paste a Drive/direct URL → the EXISTING transcription queue ────
  // Same queue Creator Studio uses (video_parse_jobs); the transcription
  // worker (worker/media-parser — GitHub Actions drain or the Railway
  // service) downloads, extracts audio, transcribes with timestamps, runs
  // the visual pass, and catalogs media_sources + content_moments.
  const enqueueTranscription = useMutation({
    mutationFn: async () => {
      const url = ingestUrl.trim();
      if (!url) throw new Error("Paste a Google Drive link or direct video URL first.");
      const { error } = await (supabase as any).from("video_parse_jobs").insert({
        kind: parseJobKind(url),
        media_url: url,
        filename: ingestTitle.trim() || null,
        tags: [brand],
        status: "queued",
        created_by: "script-studio",
      });
      if (error) throw error;
      return await kickParse();
    },
    onSuccess: (kick) => {
      setIngestUrl(""); setIngestTitle("");
      toast.success(`${kickMessage(kick, "Queued for transcription")} The worker downloads it, transcribes with timestamps, and catalogs it below.`);
      qc.invalidateQueries({ queryKey: ["cdiq-parse-jobs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Live transcription job status (polls while anything is in flight)
  const { data: parseJobs } = useQuery({
    queryKey: ["cdiq-parse-jobs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("video_parse_jobs")
        .select("id, kind, media_url, filename, status, error, duration_seconds, created_at")
        .eq("created_by", "script-studio")
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as { id: string; kind: string; media_url: string; filename: string | null; status: string; error: string | null; duration_seconds: number | null }[];
    },
    refetchInterval: (q) =>
      (q.state.data ?? []).some((j) => j.status === "queued" || j.status === "processing") ? 8000 : false,
  });

  // Parsed footage for the brand (footage = the truth)
  const { data: media } = useQuery({
    queryKey: ["cdiq-media", brand],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("media_sources")
        .select("id, title, filename, shoot, duration_seconds, transcript, storage_url, drive_id")
        .eq("kind", "video")
        .not("transcript", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as MediaRow[];
    },
    refetchInterval: 30000, // pick up freshly transcribed sources
  });

  // Transcript + timecodes review for the selected source (the "review
  // transcript" step between transcription and generation)
  const { data: reviewMoments } = useQuery({
    queryKey: ["cdiq-review-moments", sourceMediaId],
    enabled: !!sourceMediaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("content_moments")
        .select("id, start_time, end_time, speaker, verbatim_quote, visual_description, hook_score")
        .eq("source_id", sourceMediaId)
        .order("start_time")
        .limit(400);
      if (error) throw error;
      return (data ?? []) as { id: string; start_time: number | null; end_time: number | null; speaker: string | null; verbatim_quote: string | null; visual_description: string | null; hook_score: number | null }[];
    },
  });

  // The brand's Pillars Library (authoritative)
  const { data: pillars } = useQuery({
    queryKey: ["cdiq-pillars", brand],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("brand_pillars")
        .select("id, slug, name, category, description")
        .eq("brand", brand)
        .eq("active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as PillarRow[];
    },
  });

  // The brand's content brain (audiences, cross-brand permissions)
  const { data: brain } = useQuery({
    queryKey: ["cdiq-brain", brand],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("brand_content_brains")
        .select("brand, audiences, prohibited_claims, cross_brand_allowed")
        .eq("brand", brand)
        .maybeSingle();
      if (error) throw error;
      return data as { audiences: { id: string; label: string }[]; prohibited_claims: string[] } | null;
    },
  });

  // Eligible hooks for the locked strategy (the Hooks Library decides attention)
  const { data: hooks, refetch: refetchHooks, isFetching: hooksLoading } = useQuery({
    queryKey: ["cdiq-hooks", projectId, pillarId, platform, audienceId, awareness, objective, transcriptOnly],
    enabled: !!projectId && !!pillarId,
    queryFn: async () => {
      const res = await cdiq.eligibleHooks({
        projectId, pillarId, platform, audienceId: audienceId || undefined,
        awarenessLevel: awareness, objective, transcriptBackedOnly: transcriptOnly,
      });
      return res.hooks;
    },
  });

  // Every SHOT row, so each script can show what it is actually filmed as —
  // and link to the exact card where that footage gets uploaded. A script with
  // nowhere to point is how scripts and shots drifted apart in the first place.
  const { data: allShots } = useQuery({
    queryKey: ["script-studio-shots"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shot_list_items")
        .select("id, brand, campaign, shot_title, content_type, status, script_id, raw_asset_ids")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ShotRow[];
    },
  });

  // Shoot scripts — MASTER SCRIPT cards written on the Shot List. The real
  // spoken script lives there; surfacing it here keeps studio + shot list in sync.
  const { data: shootScripts } = useQuery({
    queryKey: ["shoot-master-scripts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shot_list_items")
        .select("id, brand, campaign, shot_title, filming_instruction, notes")
        .ilike("shot_title", "MASTER SCRIPT%")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ScriptRow[];
    },
  });

  // WrapTVWorld ideas + scripts, grouped per SHOW. Ideas and scripts are the
  // same table — a script is a row the Shot List titled "MASTER SCRIPT…", an
  // idea is everything else — so one query feeds both columns.
  const { data: wraptvRows } = useQuery({
    queryKey: ["wraptv-show-rows"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shot_list_items")
        .select("id, brand, campaign, shot_title, notes, status")
        .in("brand", ["wraptvworld", "wraptv"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ShowRow[];
    },
  });

  const showGroups = useMemo(() => groupByShow(wraptvRows ?? []), [wraptvRows]);

  // Coverage numbers for the collapsible message above the grid — computed
  // from the same grouping the grid renders, so the two can never disagree.
  const showCoverage_total = wraptvRows?.length ?? 0;
  const showCoverage_unassigned = useMemo(() => {
    const u = showGroups.find((g) => g.slug === "unassigned");
    return (u?.ideas.length ?? 0) + (u?.scripts.length ?? 0);
  }, [showGroups]);
  const showCoverage_assigned = showCoverage_total - showCoverage_unassigned;

  const pillarById = useMemo(() => new Map((pillars ?? []).map((p) => [p.id, p])), [pillars]);

  const selectedMedia = useMemo(
    () => (media ?? []).find((m) => m.id === sourceMediaId) ?? null,
    [media, sourceMediaId],
  );

  const visibleMedia = useMemo(() => {
    const q = mediaQuery.trim().toLowerCase();
    if (!q) return media ?? [];
    return (media ?? []).filter((m) =>
      [m.title, m.filename, m.shoot, m.transcript].some((f) => String(f ?? "").toLowerCase().includes(q)),
    );
  }, [media, mediaQuery]);

  // ── The full transcript, for the copyable window ──────────────────────────
  // Whisper's full text lives on media_sources.transcript; the timecoded
  // segments live in content_moments. Prefer the stored full text (it is the
  // complete pass), fall back to stitching the segments when a source was
  // catalogued before the full text was persisted.
  const moments = useMemo(() => reviewMoments ?? [], [reviewMoments]);
  const fullTranscript = useMemo(() => {
    const stored = (selectedMedia?.transcript ?? "").trim();
    if (stored) return stored;
    return moments.map((m) => (m.verbatim_quote ?? "").trim()).filter(Boolean).join("\n\n");
  }, [selectedMedia, moments]);

  const timecodedTranscript = useMemo(
    () =>
      moments
        .map((m) => {
          const tc = `[${fmtTime(m.start_time)}–${fmtTime(m.end_time)}]`;
          const who = m.speaker ? ` ${m.speaker}:` : "";
          const line = (m.verbatim_quote ?? "").trim();
          const vis = m.visual_description ? `  (visual: ${m.visual_description})` : "";
          return `${tc}${who} ${line}${vis}`.trimEnd();
        })
        .join("\n"),
    [moments],
  );

  const transcriptText = transcriptView === "full" ? fullTranscript : timecodedTranscript;

  const downloadTranscript = () => {
    const name = selectedMedia ? sourceLabel(selectedMedia) : "transcript";
    const blob = new Blob([transcriptText], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}${transcriptView === "timecoded" ? "-timecoded" : ""}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const analyze = useMutation({
    mutationFn: () => cdiq.analyze({ brand, sourceMediaId }),
    onSuccess: (d) => {
      setProjectId(d.project_id);
      setMatches(d.matches);
      setResult(null); setApproved(false); setPillarId("");
      toast.success(
        d.matches.length
          ? `${d.matches.length} pillar${d.matches.length === 1 ? "" : "s"} supported by this footage (${d.momentCount} moments).`
          : "No pillar is genuinely supported by this footage — pick different source video.",
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generate = useMutation({
    mutationFn: () =>
      cdiq.generate({
        projectId, pillarId, hookTemplateId: hookId || undefined,
        audienceId: audienceId || undefined, awarenessLevel: awareness,
        platform, objective, outputFormat,
      }),
    onSuccess: (d) => { setResult(d); setApproved(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  const revise = useMutation({
    mutationFn: (directives: string[]) =>
      cdiq.revise({ scriptVersionId: result!.script_version_id, directives, hookTemplateId: hookId || undefined, pillarId }),
    onSuccess: (d) => { setResult(d); setApproved(false); toast.success(`Revision v${d.version} ready.`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [roughCutUrl, setRoughCutUrl] = useState<string | null>(null);
  const renderRoughCut = useMutation({
    mutationFn: () => cdiq.renderRoughCut({ scriptVersionId: result!.script_version_id }),
    onSuccess: (d) => {
      setRoughCutUrl(d.final_url);
      toast.success(
        d.final_url
          ? "Rough cut rendered — watch it below, then approve."
          : `Rough cut rendering (job ${d.render_job_id?.slice(0, 8) ?? "queued"}) — it will appear in the Engine Room Video Studio in a few minutes.`,
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const approve = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      return cdiq.approve({ scriptVersionId: result!.script_version_id, approvedBy: u?.user?.email ?? "admin" });
    },
    onSuccess: () => { setApproved(true); toast.success("Script approved — you can now send it to the editor."); },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendToEditor = useMutation({
    mutationFn: () => cdiq.sendToEditor({ scriptVersionId: result!.script_version_id }),
    onSuccess: (d) =>
      toast.success(
        d.status === "rendered"
          ? "Rendered — open the Engine Room Video Studio to review."
          : `Sent to the editor (render job ${d.render_job_id?.slice(0, 8) ?? "queued"}) — refine it in the Engine Room CutEditor.`,
      ),
    onError: (e: Error) => toast.error(e.message),
  });

  const strategy = result?.strategy;
  const selectedPillar = pillarById.get(pillarId);
  const audiences = brain?.audiences ?? [];

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-5 py-10">
        <div className="text-xs font-bold uppercase tracking-widest text-gray-500">
          ContentDirectorIQ · footage is the truth · pillars pick the story · hooks earn attention
        </div>
        <h1 className="mt-1 text-4xl font-bold text-gray-900">
          Script <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Studio</span>
        </h1>
        <div className="mt-4"><MarketingSystemMap page="script" /></div>
        <div className="mt-6"><MarketingSuiteGuide /></div>

        {/* ── WrapTVWorld: what each SHOW already has, and what it still needs ── */}
        <div className="mt-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">
            WrapTVWorld — ideas &amp; scripts per show
          </h2>
          {/* Coverage, stated in-product rather than only in a handover note:
              most rows do not name a show, so the grid looks sparse for a
              reason. Collapsed = the one number that matters; expanded = why
              and what to do. Same shape as MarketingSystemMap. */}
          <div className="mt-2 rounded-xl border border-gray-200 bg-white shadow-sm">
            <button
              onClick={() => setShowCoverage((o) => !o)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
            >
              <HelpCircle className="h-4 w-4 shrink-0 text-blue-600" />
              <span className="flex-1 text-[13px] font-bold text-gray-900">
                {showCoverage_total === 0
                  ? "No WrapTVWorld ideas or scripts yet."
                  : `${showCoverage_assigned} of ${showCoverage_total} WrapTVWorld rows name a show — ${showCoverage_unassigned} are Unassigned.`}
              </span>
              <span className="shrink-0 text-[11px] font-semibold text-blue-600">Learn more</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${showCoverage ? "rotate-180" : ""}`} />
            </button>
            {showCoverage && (
              <div className="border-t border-gray-100 px-4 py-3 text-[12px] leading-relaxed text-gray-600">
                <p>
                  Every show on the slate is listed below, including empty ones, so a gap reads as a
                  gap instead of disappearing.
                </p>
                <p className="mt-2">
                  There is no <b>show</b> field on a Shot List row — the show is only ever stated in
                  free text (e.g. <i>"Behind Shop Doors — funny/BTS"</i>). So it is read from the
                  row's <b>campaign</b>, then its <b>title</b>, then its <b>notes</b>, and a row that
                  names no show lands in <b>Unassigned</b> rather than being guessed into the wrong
                  one — a wrong show is worse than no show, because the slate is what the AI frames
                  episodes against. Hover a show tag on a script to see which words it matched on.
                </p>
                <p className="mt-2">
                  <b>That is why Unassigned is large.</b> It reflects the rows, not a broken matcher.
                  To shrink it, name the show in the row's campaign when you add an idea — those rows
                  file themselves from then on.
                </p>
              </div>
            )}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {showGroups.map((g) => {
              const total = g.ideas.length + g.scripts.length;
              return (
                <div
                  key={g.slug}
                  className="rounded-xl border border-gray-200 bg-white p-4"
                  style={{ borderTopColor: g.accent, borderTopWidth: 3 }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-sm font-extrabold text-gray-900">{g.title}</div>
                    <div className="text-[11px] font-semibold text-gray-500">
                      {g.scripts.length} script{g.scripts.length === 1 ? "" : "s"} · {g.ideas.length} idea{g.ideas.length === 1 ? "" : "s"}
                    </div>
                  </div>

                  {total === 0 ? (
                    <p className="mt-2 text-xs text-gray-400">
                      Nothing yet — no ideas or scripts for this show.
                    </p>
                  ) : (
                    <>
                      {g.scripts.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {g.scripts.map((s) => (
                            <li key={s.id}>
                              {/* The script's OWN title (not the campaign —
                                  two scripts in one campaign rendered as
                                  identical rows), and a BUTTON: tap to read
                                  the full script in the viewer. */}
                              <button
                                onClick={() => setViewScript(s)}
                                className="flex w-full items-center gap-1 truncate rounded-md bg-amber-50 px-2 py-1 text-left text-xs font-semibold text-amber-900 hover:bg-amber-100"
                                title={s.shot_title || ""}
                              >
                                📄 {(s.shot_title || s.campaign || "Script").replace(/^MASTER SCRIPT\s*[—-]?\s*/i, "")}
                                <span className="ml-auto shrink-0 text-[10px] font-bold text-amber-600">READ →</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {g.ideas.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {g.ideas.slice(0, 6).map((s) => (
                            <li key={s.id} className="truncate text-xs text-gray-600" title={s.shot_title || ""}>
                              • {s.shot_title || s.campaign}
                            </li>
                          ))}
                          {g.ideas.length > 6 && (
                            <li className="text-[11px] text-gray-400">+ {g.ideas.length - 6} more</li>
                          )}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {(shootScripts?.length ?? 0) > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Shoot scripts — live from the Shot List</h2>
            {shootScripts!.map((s) => (
              <div key={s.id} className="mt-2 rounded-xl border border-gray-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-bold text-gray-900">{s.campaign || "Shoot script"}
                    <span className="ml-2 text-xs font-semibold" style={{ color: brandMeta(s.brand).color }}>{brandMeta(s.brand).label}</span>
                    {(() => {
                      // Which show this script belongs to, when the row names one.
                      const hit = matchWrapTVShow(s);
                      const show = hit && WRAPTV_SHOWS.find((w) => w.slug === hit.slug);
                      return show ? (
                        <span
                          className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                          style={{ backgroundColor: show.accent }}
                          title={`Matched on ${hit!.field}: "${hit!.signal}"`}
                        >
                          {show.title}
                        </span>
                      ) : null;
                    })()}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(s.filming_instruction || ""); toast.success("Script copied"); }}>
                    <Copy className="mr-1 h-3.5 w-3.5" /> Copy script
                  </Button>
                </div>
                <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-800" style={{ fontFamily: "inherit" }}>{s.filming_instruction}</pre>
                {s.notes && <div className="mt-2 whitespace-pre-wrap text-xs text-gray-500">{s.notes}</div>}

                {/* THE SHOTS THIS SCRIPT IS FILMED AS — and the card where the
                    footage gets uploaded. Without this a script was a dead end:
                    you could read the words but not reach the card that
                    receives the footage. */}
                {(() => {
                  const covered = shotsForScript(s as ShotRow, allShots ?? []);
                  if (!covered.length) {
                    return (
                      <p className="mt-3 rounded-md bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-700">
                        No shots linked to this script yet — open a card in the Shot List and pick it under 📜 Script.
                      </p>
                    );
                  }
                  return (
                    <div className="mt-3">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500">
                        Filmed as — {covered.length} shot{covered.length === 1 ? "" : "s"} · upload the footage on the card
                      </div>
                      <div className="mt-1.5 flex flex-col gap-1">
                        {covered.map((shot) => {
                          const shotCount = shot.raw_asset_ids?.length ?? 0;
                          return (
                            <Link key={shot.id} to={shotCardLink(shot.id)}
                              className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 hover:border-blue-400 hover:text-blue-700">
                              <span className="truncate font-medium">{shot.shot_title}</span>
                              <span className="ml-auto shrink-0 text-[10px] text-gray-400">
                                {shotCount ? `${shotCount} file${shotCount === 1 ? "" : "s"}` : "no footage yet"}
                              </span>
                              <UploadCloud className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 max-w-2xl text-sm text-gray-600">
          Every script is generated from the selected brand's approved Pillars Library and Hooks Library,
          grounded in real transcript evidence. Nothing reaches the editor without your approval.
        </p>

        {/* 1 · Brand */}
        <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-gray-500">1 · Brand</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {CDIQ_BRANDS.map((b) => (
            <button key={b.slug}
              onClick={() => { setBrand(b.slug); setProjectId(""); setMatches([]); setResult(null); setPillarId(""); setHookId(""); setAudienceId(""); }}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${brand === b.slug ? "border-transparent text-white" : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"}`}
              style={brand === b.slug ? { background: brandMeta(b.slug).color } : undefined}>
              {b.label}
            </button>
          ))}
        </div>

        {/* 2 · Ingest — paste a Drive URL into the existing transcription queue */}
        <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-gray-500">2 · Ingest new footage (Google Drive or direct URL)</h2>
        <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input value={ingestUrl} onChange={(e) => setIngestUrl(e.target.value)}
              placeholder="https://drive.google.com/file/d/… or /folders/… or any direct video URL"
              className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400" />
            <input value={ingestTitle} onChange={(e) => setIngestTitle(e.target.value)}
              placeholder="Title (optional)"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm sm:w-44" />
            <Button onClick={() => enqueueTranscription.mutate()} disabled={enqueueTranscription.isPending}
              className="bg-gray-900 text-white hover:bg-gray-800 shrink-0">
              {enqueueTranscription.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
              Transcribe
            </Button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Queues the existing transcription worker (same pipeline as Creator Studio): download → audio extract →
            Whisper with timestamps → visual pass (speakers, actions, B-roll) → cataloged below as source footage.
          </p>
          {(parseJobs ?? []).length > 0 && (
            <div className="mt-3 space-y-1.5">
              {(parseJobs ?? []).map((j) => (
                <div key={j.id} className="flex items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${JOB_STATUS_CLS[j.status] ?? JOB_STATUS_CLS.queued}`}>{j.status}</span>
                  <span className="truncate text-gray-700">{j.filename || j.media_url}</span>
                  {j.error && <span className="truncate text-red-500" title={j.error}>{j.error.slice(0, 80)}</span>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3 · Source footage */}
        <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-gray-500">3 · Source footage (transcribed)</h2>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <input value={mediaQuery} onChange={(e) => setMediaQuery(e.target.value)}
              placeholder="Search footage by title, shoot, or anything said in it…"
              className="w-full rounded-md border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm text-gray-900 placeholder:text-gray-400" />
          </div>
          <Button onClick={() => analyze.mutate()} disabled={!sourceMediaId || analyze.isPending}
            className="bg-gray-900 text-white hover:bg-gray-800 shrink-0">
            {analyze.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Film className="mr-2 h-4 w-4" />}
            Analyze footage
          </Button>
        </div>

        {/* Footage library — real thumbnails, not a blind dropdown. ONE resolver
            (assetThumb) picks the picture: stored poster → Drive JPEG → a #t=
            media fragment so the browser paints an actual frame → labeled
            placeholder. media_sources has no thumbnail_url column, so nearly
            every card here comes from the media fragment. */}
        <div className="mt-3 max-h-[26rem] overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-3">
          {!(media ?? []).length && <p className="text-sm text-gray-500">No transcribed footage yet — ingest something above.</p>}
          {!!(media ?? []).length && !visibleMedia.length && (
            <p className="text-sm text-gray-500">Nothing matches “{mediaQuery}”.</p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {visibleMedia.map((m) => {
              const resolved = assetThumb({ asset_type: "video", storage_url: m.storage_url, drive_file_id: m.drive_id });
              const thumb = thumbFailed[m.id] ? { ...resolved, kind: "none" as const } : resolved;
              const active = sourceMediaId === m.id;
              return (
                <button key={m.id} type="button"
                  onClick={() => { setSourceMediaId(m.id); setShowTranscript(true); }}
                  className={`overflow-hidden rounded-lg border bg-white text-left transition ${active ? "border-transparent ring-2 ring-[#3b82f6]" : "border-gray-200 hover:border-gray-300"}`}>
                  <div className="relative aspect-video bg-gray-900">
                    {thumb.kind === "image" && (
                      <img src={thumb.src} alt="" loading="lazy" title={`preview via ${thumb.via}`}
                        className="h-full w-full object-cover"
                        onError={() => setThumbFailed((f) => ({ ...f, [m.id]: true }))} />
                    )}
                    {thumb.kind === "video" && (
                      <video src={thumb.src} preload="metadata" muted playsInline title={`preview via ${thumb.via}`}
                        className="h-full w-full object-cover"
                        onError={() => setThumbFailed((f) => ({ ...f, [m.id]: true }))} />
                    )}
                    {(thumb.kind === "none" || thumb.kind === "audio") && (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-100 px-2 text-center">
                        <span className="text-lg">🎞️</span>
                        <span className="text-[10px] font-medium leading-tight text-slate-500">
                          {thumbFailed[m.id] ? "Preview won't play here" : m.storage_url ? "No preview frame" : "Not copied in yet"}
                        </span>
                      </div>
                    )}
                    {m.duration_seconds != null && (
                      <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                        {fmtTime(m.duration_seconds)}
                      </span>
                    )}
                  </div>
                  <div className="space-y-0.5 p-2">
                    <div className="truncate text-xs font-medium text-gray-900" title={sourceLabel(m)}>{sourceLabel(m)}</div>
                    <div className="truncate text-[10px] text-gray-500">
                      {m.shoot || "—"} · {(m.transcript?.length ?? 0).toLocaleString()} chars transcribed
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Review transcript before generating — the FULL Whisper text in a
            copyable window (for our own editing), plus the timecoded segment
            view the strategy is actually built from. */}
        {sourceMediaId && (fullTranscript || moments.length > 0) && (
          <div className="mt-3 rounded-xl border border-gray-200 bg-white">
            <button onClick={() => setShowTranscript((o) => !o)}
              className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-semibold text-gray-900">
              <span>
                Transcript · {fullTranscript.length.toLocaleString()} characters · {moments.length} timecoded segments
              </span>
              <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${showTranscript ? "rotate-180" : ""}`} />
            </button>
            {showTranscript && (
              <div className="border-t border-gray-100 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex overflow-hidden rounded-md border border-gray-300">
                    {(["full", "timecoded"] as const).map((v) => (
                      <button key={v} onClick={() => setTranscriptView(v)}
                        className={`px-3 py-1.5 text-xs font-semibold transition ${transcriptView === v ? "bg-gray-900 text-white" : "bg-white text-gray-700 hover:bg-gray-50"}`}>
                        {v === "full" ? "Full transcript" : "With timecodes"}
                      </button>
                    ))}
                  </div>
                  <div className="ml-auto flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => copyText(fullTranscript, "Full transcript")}
                      className="border-gray-300 text-gray-700">
                      <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy text
                    </Button>
                    <Button size="sm" variant="outline" disabled={!timecodedTranscript}
                      onClick={() => copyText(timecodedTranscript, "Timecoded transcript")}
                      className="border-gray-300 text-gray-700">
                      <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy with timecodes
                    </Button>
                    <Button size="sm" variant="outline" onClick={downloadTranscript} className="border-gray-300 text-gray-700">
                      <Download className="mr-1.5 h-3.5 w-3.5" /> .txt
                    </Button>
                  </div>
                </div>

                {/* A real textarea, so select-all / drag-select / Cmd-C all work
                    even when the Clipboard API is blocked. readOnly, not
                    disabled — disabled text can't be selected. */}
                <textarea
                  readOnly
                  value={transcriptText || "No transcript text on this source yet."}
                  onFocus={(e) => e.currentTarget.select()}
                  spellCheck={false}
                  className="mt-3 h-80 w-full resize-y rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[13px] leading-relaxed text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  Whisper output for <span className="font-medium text-gray-700">{selectedMedia ? sourceLabel(selectedMedia) : "—"}</span>.
                  {transcriptView === "full"
                    ? " Full text — click in the window to select it all."
                    : " Every segment with its in/out timecode, for the editor."}
                </p>

                {moments.length > 0 && (
                  <details className="mt-3 rounded-lg border border-gray-200">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-700">
                      Segment review · hook scores + visual notes
                    </summary>
                    <div className="max-h-72 space-y-1.5 overflow-y-auto border-t border-gray-100 px-3 py-2">
                      {moments.map((m) => (
                        <div key={m.id} className="flex gap-3 text-sm">
                          <span className="shrink-0 font-mono text-xs text-gray-400">{fmtTime(m.start_time)}–{fmtTime(m.end_time)}</span>
                          <div className="min-w-0">
                            {m.speaker && <span className="mr-1 text-xs font-semibold text-gray-500">{m.speaker}:</span>}
                            <span className="text-gray-800">{m.verbatim_quote}</span>
                            {m.visual_description && <span className="ml-1 text-xs italic text-gray-400">[{m.visual_description}]</span>}
                            {m.hook_score != null && m.hook_score >= 7 && (
                              <span className="ml-1 rounded-full bg-pink-50 px-1.5 text-[10px] font-bold text-pink-600">hook {m.hook_score}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
        )}

        {/* 4 · Pillar matches — only what the footage supports */}
        {matches.length > 0 && (
          <>
            <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-gray-500">
              4 · Pillar — what this footage actually supports
            </h2>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {matches.map((m) => {
                const p = (pillars ?? []).find((x) => x.id === m.pillarId || x.slug === m.pillarSlug);
                const active = pillarId === m.pillarId;
                return (
                  <button key={m.pillarId} onClick={() => { setPillarId(m.pillarId); setHookId(""); }}
                    className={`rounded-xl border p-4 text-left transition ${active ? "border-transparent ring-2 ring-[#3b82f6]" : "border-gray-200 hover:border-gray-300"}`}>
                    <div className="font-semibold text-gray-900">{p?.name ?? m.pillarSlug}</div>
                    <div className="mt-1 text-xs text-gray-500">{p?.description?.slice(0, 120)}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">relevance {(m.relevanceScore * 100).toFixed(0)}%</span>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700">evidence {(m.evidenceStrength * 100).toFixed(0)}%</span>
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{m.sourceSegmentIds.length} clips</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* 4 · Strategy + approved hook */}
        {pillarId && (
          <>
            <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-gray-500">5 · Audience · objective · format</h2>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
              <select value={audienceId} onChange={(e) => setAudienceId(e.target.value)} className="rounded-md border border-gray-300 px-2 py-2 text-sm">
                <option value="">Audience…</option>
                {audiences.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <select value={awareness} onChange={(e) => setAwareness(e.target.value)} className="rounded-md border border-gray-300 px-2 py-2 text-sm">
                {AWARENESS_LEVELS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="rounded-md border border-gray-300 px-2 py-2 text-sm">
                {CDIQ_PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <select value={objective} onChange={(e) => setObjective(e.target.value)} className="rounded-md border border-gray-300 px-2 py-2 text-sm">
                {CDIQ_OBJECTIVES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} className="rounded-md border border-gray-300 px-2 py-2 text-sm">
                {CDIQ_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">Approved hooks ({hooks?.length ?? 0})</h3>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={transcriptOnly}
                  onChange={(e) => { setTranscriptOnly(e.target.checked); setTimeout(() => refetchHooks(), 0); }} />
                Show only transcript-backed hooks
              </label>
            </div>
            <div className="mt-2 space-y-2">
              {hooksLoading && <p className="text-sm text-gray-500">Filtering the hook library…</p>}
              {!hooksLoading && (hooks ?? []).length === 0 && (
                <p className="text-sm text-gray-500">
                  No eligible hooks for this strategy — curate some in the Hooks Manager (/admin/hooks), or generate without a template.
                </p>
              )}
              {(hooks ?? []).map((h: CdiqHook) => (
                <button key={h.id} onClick={() => setHookId(hookId === h.id ? "" : h.id)}
                  className={`block w-full rounded-lg border px-3 py-2 text-left text-sm transition ${hookId === h.id ? "border-transparent ring-2 ring-[#ec4899]" : "border-gray-200 hover:border-gray-300"}`}>
                  <span className="text-gray-900">{h.text}</span>
                  {h.hook_type && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{h.hook_type}</span>}
                </button>
              ))}
            </div>

            <Button onClick={() => generate.mutate()} disabled={generate.isPending}
              className="mt-4 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] font-bold text-white">
              {generate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              Generate script
            </Button>
          </>
        )}

        {/* 5 · The script + visible strategy */}
        {result && strategy && (
          <div className="mt-10 grid gap-6 lg:grid-cols-[280px,1fr]">
            {/* Strategy card — the spec's visible strategy panel */}
            <div className="h-fit rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="rounded-md px-2 py-1 text-center text-xs font-bold uppercase tracking-widest text-white"
                style={{ background: brandMeta(strategy.brand).color }}>
                {brandMeta(strategy.brand).label}
              </div>
              {[
                ["Pillar", strategy.pillarName],
                ["Hook", strategy.hookText ? `"${strategy.hookText}"` : "(no template — strongest moment)"],
                ["Audience", strategy.audienceLabel ?? strategy.audienceId ?? "—"],
                ["Awareness", AWARENESS_LEVELS.find((a) => a.id === strategy.awarenessLevel)?.label ?? "—"],
                ["Format", CDIQ_FORMATS.find((f) => f.id === strategy.outputFormat)?.label ?? strategy.outputFormat ?? "—"],
                ["Editing brain", strategy.editingBrain?.label ?? "—"],
              ].map(([k, v]) => (
                <div key={k as string} className="mt-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{k}</div>
                  <div className="text-sm font-medium text-gray-900">{v}</div>
                </div>
              ))}
              <div className="mt-3">
                <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Evidence</div>
                <div className="text-sm text-gray-900">
                  {strategy.evidenceCounts.transcriptClips} transcript clips<br />
                  {strategy.evidenceCounts.productDemonstrations} product demonstrations<br />
                  {strategy.evidenceCounts.verifiedFacts} verified facts
                </div>
              </div>
              {strategy.flags.length > 0 && (
                <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                  {strategy.flags.join(" · ")}
                </div>
              )}
            </div>

            {/* Script */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-gray-900">{result.package.title || "Untitled concept"}</h3>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">v{result.version}</span>
              </div>
              {result.package.angle && <p className="mt-1 text-sm text-gray-600">{result.package.angle}</p>}

              <div className="mt-4 space-y-2">
                {result.package.lines.map((l, i) => {
                  const meta = PROVENANCE_META[l.provenanceStatus] ?? PROVENANCE_META.unverified;
                  return (
                    <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-bold uppercase text-gray-400">{l.role}</span>
                        <span className={`rounded-full border px-2 py-0.5 font-semibold ${meta.cls}`}>{meta.label}</span>
                        {l.startTime != null && (
                          <span className="font-mono text-gray-500">{fmtTime(l.startTime)}–{fmtTime(l.endTime)}</span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm text-gray-900">{l.text}</p>
                      {l.visualDirection && <p className="mt-1 text-xs italic text-gray-500">🎬 {l.visualDirection}</p>}
                    </div>
                  );
                })}
              </div>

              {result.package.caption && (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Caption</div>
                  <p className="whitespace-pre-wrap">{result.package.caption}</p>
                  {result.package.cta && <p className="mt-1 font-semibold">{result.package.cta}</p>}
                </div>
              )}

              {/* Controls */}
              <div className="mt-4 flex flex-wrap gap-2">
                {DIRECTIVE_BUTTONS.map((d) => (
                  <Button key={d.key} size="sm" variant="outline" className="border-gray-300 text-gray-700"
                    disabled={revise.isPending} onClick={() => revise.mutate([d.key])}>
                    {d.label}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-400">
                Change the pillar or hook above and hit a control (or Generate) to re-run with the new strategy.
              </p>

              {/* Rough cut first → human reviews the video → approve → export */}
              {roughCutUrl && (
                <video src={roughCutUrl} controls className="mt-4 w-full max-w-md rounded-lg bg-black" />
              )}
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                <Button onClick={() => renderRoughCut.mutate()} disabled={renderRoughCut.isPending}
                  variant="outline" className="border-gray-300">
                  {renderRoughCut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Film className="mr-2 h-4 w-4" />}
                  Render rough cut
                </Button>
                <Button onClick={() => approve.mutate()} disabled={approve.isPending || approved}
                  className="bg-gray-900 text-white hover:bg-gray-800">
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {approved ? "Approved" : "Approve script"}
                </Button>
                <Button onClick={() => sendToEditor.mutate()} disabled={!approved || sendToEditor.isPending}
                  className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] font-bold text-white">
                  {sendToEditor.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Send to editor
                </Button>
                {!approved && <span className="text-xs text-gray-500">Approval is required before anything reaches the editor.</span>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Script viewer — full read of a MASTER SCRIPT from a show card.
          Built to be READ ON SET from an iPad/Kindle (owner 2026-08-04):
          near-full-screen on tablets, large line-spaced type, high-contrast
          dark-on-cream, big touch targets. */}
      <Dialog open={!!viewScript} onOpenChange={(o) => !o && setViewScript(null)}>
        {viewScript && (
          <DialogContent className="max-h-[92vh] w-[96vw] max-w-3xl overflow-y-auto rounded-xl bg-white p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="pr-8 text-lg font-extrabold leading-snug text-gray-900 sm:text-xl">
                📄 {(viewScript.shot_title || "Script").replace(/^MASTER SCRIPT\s*[—-]?\s*/i, "")}
              </DialogTitle>
            </DialogHeader>
            {viewScript.campaign && (
              <div className="text-sm font-semibold text-gray-500">{viewScript.campaign}</div>
            )}
            <div className="whitespace-pre-wrap rounded-lg bg-amber-50 p-4 text-[16px] leading-7 text-amber-950 sm:p-5 sm:text-[17px] sm:leading-8">
              {viewScript.notes || "No script text on this row yet."}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-11 px-5 text-sm font-semibold"
                onClick={() => {
                  navigator.clipboard.writeText(viewScript.notes || "");
                  toast.success("Script copied");
                }}
              >
                <Copy className="mr-1.5 h-4 w-4" />Copy script
              </Button>
              <Button variant="outline" className="h-11 px-5 text-sm font-semibold" onClick={() => setViewScript(null)}>Close</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
