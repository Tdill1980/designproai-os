/**
 * AssetLibrary — the one pool of RAW source material: video, photos, music.
 *
 * Everything the shop shoots lands here and is typed by what it IS (install /
 * vehicle-only / unboxing / UGC / documentary / film / music), so any tool can
 * ask for "installer footage" or "UGC" instead of hunting filenames.
 *
 *   RAW ONLY — finished renders (content_type='render') and the parser's
 *   audio masters are excluded from the raw pool by default; they're
 *   reachable behind their own filters, never mixed into source material.
 *
 * Classification runs through ONE deterministic implementation
 * (src/lib/assetContentType.ts, unit-tested) — the ⚡ Classify action reads
 * folder/filename/tags/transcript and writes the type plus the signal it
 * matched, so a human can see the reasoning and override it.
 *
 * Ingestion: paste a Google Drive folder link and the parser walks it,
 * registering every video AND photo, then transcribes/vision-scores the
 * video (video_parse_jobs → worker/media-parser).
 */
import { kickParse, kickMessage } from "@/lib/kickParse";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import AssetTranscriptPanel, { EMPTY_PARSE_STATE, parseVerdict, type ParseState } from "./AssetTranscriptPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, FolderOpen, Upload, RefreshCw, Search, Wand2, Film, Image as ImageIcon, Music } from "lucide-react";
import { toast } from "sonner";
import {
  CONTENT_TYPES, contentTypeMeta, classifyAsset, classifyAssetAll, assetServes, assetUses,
  detectAssetKind, resolveAssetType,
  type AssetContentType,
} from "@/lib/assetContentType";
import {
  INGEST_TAGS, buildIngestTags, shootSlug, contentTagsFrom, suggestShootName,
} from "@/lib/ingestTags";
import { assetThumb } from "@/lib/assetThumb";

type Pool = "video" | "photo" | "music";

const POOLS: Array<{ key: Pool; label: string; icon: typeof Film; assetTypes: string[] }> = [
  { key: "video", label: "Raw Video", icon: Film, assetTypes: ["video"] },
  { key: "photo", label: "Photos", icon: ImageIcon, assetTypes: ["image"] },
  { key: "music", label: "Music", icon: Music, assetTypes: ["audio"] },
];

export default function AssetLibrary() {
  const qc = useQueryClient();
  const [pool, setPool] = useState<Pool>("video");
  const [typeFilter, setTypeFilter] = useState<AssetContentType | "all">("all");
  // The HUMAN grouping filter, separate from the taxonomy filter above and
  // multi-select for the same reason the tags are: one clip can be Install AND
  // Wrap Material, so narrowing by one must not hide it from the other. AND
  // semantics — ticking two chips asks for clips that are both.
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [driveUrl, setDriveUrl] = useState("");
  // BATCH TAGGING at ingest. A Drive folder holds mixed footage, so these are
  // the tags that apply to the WHOLE dump (shoot name + what most of it is);
  // per-clip correction happens on the cards below once it lands.
  const [shootName, setShootName] = useState("");
  const [ingestTags, setIngestTags] = useState<string[]>([]);
  const [classifying, setClassifying] = useState(false);

  const poolSpec = POOLS.find((p) => p.key === pool)!;

  // WHICH CLIPS CAN ACTUALLY BE CUT — one read for the whole grid.
  //
  // Beats (`content_moments`) decide whether the editor brain can build an
  // edit; without them a piece ships as a one-clip stub. Nothing in this app
  // showed that per clip, so 256 of 427 clips were uncuttable and looked
  // identical to the 171 that were. Two small reads, no per-card query, no
  // model spend.
  const { data: parseIndex } = useQuery({
    queryKey: ["asset-parse-index"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<Map<string, ParseState>> => {
      const [{ data: sources }, { data: moments }] = await Promise.all([
        (supabase as any).from("media_sources").select("id, storage_url, transcript").limit(5000),
        // ~11,675 moments live and PostgREST pages at 1000 by default — without
        // this ceiling nearly every clip would read as beatless.
        (supabase as any).from("content_moments").select("source_id").limit(100000),
      ]);
      const beats = new Map<string, number>();
      for (const m of moments || []) {
        const id = String((m as any)?.source_id || "");
        if (id) beats.set(id, (beats.get(id) || 0) + 1);
      }
      const byUrl = new Map<string, ParseState>();
      for (const s of sources || []) {
        const u = String((s as any)?.storage_url || "").trim();
        if (!u) continue;
        byUrl.set(u, {
          sourceId: String((s as any).id),
          transcript: String((s as any).transcript || ""),
          beats: beats.get(String((s as any).id)) || 0,
        });
      }
      return byUrl;
    },
  });
  const [transcriptFor, setTranscriptFor] = useState<any>(null);

  const { data: assets, isLoading, refetch } = useQuery({
    queryKey: ["asset-library", pool],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("agent_media_assets")
        .select("id, title, original_filename, storage_url, thumbnail_url, drive_file_id, source_folder, asset_type, content_type, classified_reason, ingest_source, tags, file_size_bytes, created_at")
        .in("asset_type", poolSpec.assetTypes)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      // RAW POOL: renders and the parser's audio masters are not source
      // material — keep them out unless explicitly filtered for. The audio
      // masters are ~100 tracks of PEOPLE TALKING (a 32kbps mp3 of every
      // parsed clip); they are never a soundtrack.
      const rows = (data || []).filter((a: any) =>
        a.content_type !== "render" && a.content_type !== "audio_master");

      // MUSIC gets its own complete spot: the produced house tracks live in
      // their own table (video_music_library) and must appear here too, or
      // the library's music section is a half-catalog. Deduped by URL.
      if (pool !== "music") return rows;
      const { data: house } = await (supabase as any)
        .from("video_music_library")
        .select("id, title, storage_url, genre, created_at")
        .order("created_at", { ascending: false }).limit(200);
      const seen = new Set(rows.map((r: any) => r.storage_url));
      const houseRows = ((house || []) as any[])
        .filter((h) => h.storage_url && !seen.has(h.storage_url))
        .map((h) => ({
          id: `house_${h.id}`, title: h.title, original_filename: h.title,
          storage_url: h.storage_url, source_folder: `house track${h.genre ? ` · ${h.genre}` : ""}`,
          asset_type: "audio", content_type: "music",
          classified_reason: "produced house track", ingest_source: "video_music_library",
          tags: [], file_size_bytes: null, created_at: h.created_at,
          /** House-table rows aren't editable from here (different table). */
          readOnly: true,
        }));
      return [...rows, ...houseRows];
    },
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of assets || []) {
      const k = a.content_type || "unclassified";
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [assets]);

  /** How many assets carry each human grouping tag. */
  const tagCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of assets || []) {
      for (const k of contentTagsFrom(a.tags)) c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [assets]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (assets || []).filter((a: any) => {
      // "Does this asset SERVE the filtered use", not "is that its one label".
      // An install clip filed as the interview it also is used to vanish from
      // the Install shelf; `assetServes` reads every recorded use and falls
      // back to the single label for rows the pass has not reached yet.
      if (typeFilter !== "all") {
        const uses = assetUses(a);
        if (typeFilter === "unclassified") { if (uses.length) return false; }
        else if (!assetServes(a, typeFilter)) return false;
      }
      if (tagFilter.length) {
        const on = contentTagsFrom(a.tags);
        if (!tagFilter.every((k) => on.includes(k))) return false;
      }
      if (!needle) return true;
      return `${a.title || ""} ${a.original_filename || ""} ${a.source_folder || ""} ${(a.tags || []).join(" ")}`
        .toLowerCase().includes(needle);
    });
  }, [assets, typeFilter, tagFilter, q]);

  // ⚡ Classify — deterministic, in the browser, one row at a time so a
  // failure can never half-write the library. Only touches unclassified rows.
  const classifyAll = async () => {
    // Never write to synthesized house-track rows — they live in another table.
    const todo = (assets || []).filter((a: any) => !a.content_type && !a.readOnly);
    if (!todo.length) { toast.info("Everything in this pool is already typed."); return; }
    setClassifying(true);
    let done = 0, undecided = 0;
    for (const a of todo) {
      const { primary: type, primaryReason: reason, types } = classifyAssetAll({
        filename: a.original_filename || a.title,
        folder: a.source_folder,
        tags: a.tags,
        kind: detectAssetKind(a.storage_url || a.original_filename || ""),
      });
      if (type === "unclassified") { undecided++; continue; }
      const { error } = await (supabase as any).from("agent_media_assets")
        .update({ content_type: type, content_types: types, classified_reason: reason, classified_at: new Date().toISOString() })
        .eq("id", a.id);
      if (!error) done++;
    }
    setClassifying(false);
    qc.invalidateQueries({ queryKey: ["asset-library"] });
    toast.success(`Typed ${done} asset(s)${undecided ? ` · ${undecided} need a human call (no clear signal)` : ""}`);
  };

  const setType = useMutation({
    mutationFn: async ({ id, type }: { id: string; type: AssetContentType }) => {
      // A person choosing one chip is SAYING it is that one thing, so the
      // uses become exactly that — the classifier does not get to add more on
      // top of a human's call, and the pass then skips the row for good.
      const { error } = await (supabase as any).from("agent_media_assets")
        .update({ content_type: type, content_types: [type], classified_reason: "set by hand", classified_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["asset-library"] }); },
    onError: (e: any) => toast.error(e?.message || "Couldn't set the type"),
  });

  /**
   * Per-clip tag correction. A Drive folder is mixed, so the batch tags at
   * ingest are only a starting point — this is how the six talking-heads in a
   * folder of install footage get marked as what they actually are.
   *
   * tags[0] is the SHOOT and is preserved untouched: it drives source_folder
   * and the filename prefix, so rewriting it would scatter the dump.
   */
  const toggleTag = useMutation({
    mutationFn: async ({ id, tags, key }: { id: string; tags: string[] | null; key: string }) => {
      const head = (tags || [])[0];
      const rest = contentTagsFrom(tags);
      const next = rest.includes(key) ? rest.filter((k) => k !== key) : [...rest, key];
      const { error } = await (supabase as any).from("agent_media_assets")
        .update({ tags: head ? [head, ...next] : next })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["asset-library"] }); },
    onError: (e: any) => toast.error(e?.message || "Couldn't update the tags"),
  });

  // Drive ingest — queues the parser, which registers every video AND photo
  // in the folder (recursively) and transcribes + vision-scores the video.
  const parseDrive = useMutation({
    mutationFn: async () => {
      const url = driveUrl.trim();
      if (!url) throw new Error("Paste a Google Drive folder or file link first");
      const kind = /\/folders\//.test(url) ? "drive_folder"
        : /drive\.google|drive\.usercontent/.test(url) ? "drive_file"
        : /dropbox\.com\/(scl\/fo|sh)\//i.test(url) ? "dropbox_folder" : "url";
      // tags[0] IS THE SHOOT NAME — the parser turns it into source_folder and
      // the filename prefix, which is how a card dump stays grouped. Content
      // tags are appended after it, never before. See src/lib/ingestTags.ts.
      const { error } = await (supabase as any).from("video_parse_jobs").insert({
        kind, media_url: url, tags: buildIngestTags(shootName, ingestTags),
        filename: kind === "url" ? url.split("/").pop()?.split("?")[0] : null,
      });
      if (error) throw error;
      // Queueing must START the work. Without this the row waits for the
      // parse-media cron, which GitHub throttles to ~1h and up to 3h.
      return await kickParse();
    },
    onSuccess: (kick) => {
      setDriveUrl("");
      toast.success(
        `${kickMessage(kick, `Queued under "${shootSlug(shootName)}"`)} Every clip inherits these tags — fix any that differ on the cards below.`,
      );
    },
    onError: (e: any) => toast.error(e?.message || "Couldn't queue that link"),
  });

  const [uploading, setUploading] = useState(false);
  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      // ONE resolver decides asset_type for every uploader in the app — see
      // resolveAssetType. It reads extension AND mime, and cannot return
      // `rendered_video`.
      const { assetType } = resolveAssetType({ filename: file.name, mimeType: file.type });
      const kind = detectAssetKind(file.name);
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
      const path = `asset-library/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("wrap-files")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) { console.error(upErr.message); continue; }
      const url = supabase.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
      const { primary: type, primaryReason: reason, types } = classifyAssetAll({ filename: file.name, kind });
      const { error: insErr } = await (supabase as any).from("agent_media_assets").insert({
        asset_type: assetType, storage_url: url,
        title: safe.replace(/\.[^.]+$/, "").replace(/-/g, " "),
        original_filename: file.name, source_folder: shootSlug(shootName),
        tags: buildIngestTags(shootName, ingestTags),
        file_size_bytes: file.size, ingest_source: "upload",
        ...(type !== "unclassified"
          ? { content_type: type, content_types: types, classified_reason: reason, classified_at: new Date().toISOString() }
          : {}),
      });
      if (!insErr) ok++;
    }
    setUploading(false);
    qc.invalidateQueries({ queryKey: ["asset-library"] });
    toast.success(`${ok} file(s) added to the library`);
  };

  const unclassified = counts["unclassified"] || 0;

  return (
    <div className="space-y-4">
      {/* ── Ingest ── */}
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg text-gray-900">
            <FolderOpen className="w-5 h-5 text-[#3b82f6]" /> Asset Library
            <span className="ml-2 text-xs font-normal text-gray-500">
              raw video · photos · music — one pool, typed by what it is
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Paste a Google Drive folder link — the agent copies in every video + photo and parses it"
              value={driveUrl} onChange={(e) => setDriveUrl(e.target.value)}
              className="flex-1 bg-white text-gray-900 border-gray-300 placeholder:text-gray-400"
            />
            <Button onClick={() => parseDrive.mutate()} disabled={parseDrive.isPending}
              className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white font-semibold hover:opacity-90 shrink-0">
              {parseDrive.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Parse Drive folder"}
            </Button>
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#3b82f6] px-3 py-2 text-xs font-semibold text-[#3b82f6] hover:bg-blue-50 shrink-0 ${uploading ? "opacity-60 pointer-events-none" : ""}`}>
              <input type="file" accept="video/*,image/*,audio/*" multiple hidden
                onChange={(e) => { uploadFiles(e.target.files); e.currentTarget.value = ""; }} />
              {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</> : <><Upload className="w-3.5 h-3.5" /> Upload</>}
            </label>
          </div>
          {/* SHOOT + BATCH TAGS. A Drive folder is a mixed bag, so this is the
              batch default: name the dump (it becomes the shoot / source_folder
              so a card dump stays together) and tick what most of it is. Every
              clip inherits these; the ones that differ get fixed per-card
              below. Nothing here writes content_type — that stays the
              classifier's single value (see ingestTags.ts). */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex-1">
                <label className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                  Shoot name <span className="font-normal normal-case text-gray-400">— keeps this dump grouped</span>
                </label>
                <Input
                  value={shootName}
                  onChange={(e) => setShootName(e.target.value)}
                  placeholder={suggestShootName("jackson-sd")}
                  className="mt-1 h-8 border-gray-300 bg-white text-xs text-gray-900"
                />
              </div>
              <div className="text-[11px] text-gray-500 sm:self-end sm:pb-1.5">
                lands as <code className="rounded bg-white px-1 text-gray-700">{shootSlug(shootName)}</code>
              </div>
            </div>

            <div className="mt-2">
              <label className="text-[10px] font-bold uppercase tracking-wide text-gray-500">
                What is this batch? <span className="font-normal normal-case text-gray-400">— tick every one that applies</span>
              </label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {INGEST_TAGS.map((t) => {
                  const on = ingestTags.includes(t.key);
                  return (
                    <button key={t.key} type="button" title={t.hint}
                      onClick={() => setIngestTags((cur) => on ? cur.filter((k) => k !== t.key) : [...cur, t.key])}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                        on ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-600"
                      }`}>
                      {t.emoji} {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-gray-400">
            Drive folders are walked recursively. Video gets transcribed + vision-scored (that's what powers Story Edit and the hooks); photos are registered and typed.
            Batch tags are a starting point — every clip is also auto-typed, and you can correct any card individually.
          </p>
        </CardContent>
      </Card>

      {/* ── Pool tabs + type filter ── */}
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            {POOLS.map((p) => {
              const Icon = p.icon;
              return (
                <button key={p.key} onClick={() => { setPool(p.key); setTypeFilter("all"); }}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition ${pool === p.key
                    ? "border-transparent bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white shadow"
                    : "border-slate-200 bg-white text-gray-700 hover:border-slate-300"}`}>
                  <Icon className="w-4 h-4" /> {p.label}
                </button>
              );
            })}
            <div className="ml-auto flex items-center gap-2">
              {unclassified > 0 && (
                <Button size="sm" variant="outline" onClick={classifyAll} disabled={classifying}
                  className="border-[#ec4899]/40 text-[#be2d72]"
                  title="Read folder / filename / tags and type every untyped asset — deterministic, no AI cost">
                  {classifying ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />Typing…</> : <><Wand2 className="w-3.5 h-3.5 mr-1" />Classify {unclassified}</>}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, shoot or folder…"
                className="bg-white pl-8 text-gray-900 border-gray-300 placeholder:text-gray-400" />
            </div>
            <span className="text-xs text-gray-500">{visible.length} of {(assets || []).length}</span>
          </div>

          {/* Colour-coded type chips */}
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setTypeFilter("all")}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${typeFilter === "all" ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700"}`}>
              All {(assets || []).length}
            </button>
            {CONTENT_TYPES.filter((t) => (counts[t.key] || 0) > 0).map((t) => (
              <button key={t.key} onClick={() => setTypeFilter(t.key)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${typeFilter === t.key ? t.chip + " ring-2 ring-offset-1 ring-gray-300" : t.chip + " opacity-80 hover:opacity-100"}`}>
                <span>{t.emoji}</span> {t.label} {counts[t.key]}
              </button>
            ))}
          </div>

          {/* ── THE HUMAN GROUPINGS, as a filter ──────────────────────────────
              The chips above are the taxonomy: ONE value per clip, set by the
              deterministic classifier. These are the crew's own groupings,
              several of which can be true of one clip at once — which is why
              "Wrap Material" lives here rather than in the taxonomy (see
              src/lib/ingestTags.ts for the measured reason). Multi-select and
              AND-ed, so "Install + Wrap Material" is a real question you can
              ask the library. Only groupings something actually carries are
              offered — an empty chip is a dead end. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Groups</span>
            {INGEST_TAGS.filter((t) => (tagCounts[t.key] || 0) > 0).map((t) => {
              const on = tagFilter.includes(t.key);
              return (
                <button key={t.key} type="button" title={t.hint}
                  onClick={() => setTagFilter((cur) => on ? cur.filter((k) => k !== t.key) : [...cur, t.key])}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    on ? "border-transparent bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:border-blue-400 hover:text-blue-600"
                  }`}>
                  <span>{t.emoji}</span> {t.label} {tagCounts[t.key]}
                </button>
              );
            })}
            {!INGEST_TAGS.some((t) => (tagCounts[t.key] || 0) > 0) && (
              // Say WHY there is nothing here. An empty row reads as broken.
              <span className="text-[11px] text-gray-400">
                nothing in this pool is grouped yet — tick the groups on a card below, or at ingest
              </span>
            )}
            {tagFilter.length > 0 && (
              <button type="button" onClick={() => setTagFilter([])}
                className="text-[11px] text-[#3b82f6] underline">clear</button>
            )}
          </div>

          {isLoading && <p className="text-sm text-gray-500"><Loader2 className="mr-1 inline h-4 w-4 animate-spin" />Loading the library…</p>}
          {!isLoading && !visible.length && (
            <p className="text-sm text-gray-500">Nothing here yet — paste a Drive folder link above, or upload files.</p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((a: any) => {
              const meta = contentTypeMeta(a.content_type);
              // The OTHER uses this clip serves. Shown because a clip that can
              // answer two pickers is worth more than one that answers one,
              // and the operator has no other way to see that it does.
              const alsoServes = assetUses(a).slice(1);
              // ONE resolver decides what picture this card shows: stored
              // poster → Drive thumbnail → media fragment → honest placeholder.
              const thumb = assetThumb(a);
              return (
                <div key={a.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="relative aspect-video bg-gray-900">
                    {thumb.kind === "image" && (
                      <img src={thumb.src} alt={a.title || ""} loading="lazy" title={`preview via ${thumb.via}`}
                        className="h-full w-full object-cover"
                        // A Drive poster can 403 on a file that isn't shared —
                        // fall back to the placeholder instead of a broken icon.
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                    )}
                    {thumb.kind === "video" && (
                      <video src={thumb.src} preload="metadata" muted playsInline title={`preview via ${thumb.via}`}
                        className="h-full w-full object-cover" />
                    )}
                    {thumb.kind === "audio" && (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#3b82f6] to-[#ec4899]">
                        <Music className="h-8 w-8 text-white/90" />
                      </div>
                    )}
                    {thumb.kind === "none" && (
                      // Say WHY there's no picture. A black box reads as broken.
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-slate-100 px-2 text-center">
                        <span className="text-lg">🎞️</span>
                        <span className="text-[10px] font-medium leading-tight text-slate-500">
                          {a.storage_url ? "No preview frame" : "Not copied in yet"}
                        </span>
                      </div>
                    )}
                    <span className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${meta.chip}`}>
                        {meta.emoji} {meta.label}
                      </span>
                      {alsoServes.map((k) => {
                        const m = contentTypeMeta(k);
                        return (
                          <span key={k} title={`also usable as ${m.label}`}
                            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold opacity-90 ${m.chip}`}>
                            {m.emoji} {m.label}
                          </span>
                        );
                      })}
                    </span>
                    {!a.storage_url && (
                      <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">drive only</span>
                    )}
                  </div>
                  <div className="space-y-1 p-2">
                    <div className="truncate text-xs font-medium text-gray-900" title={a.title || a.original_filename}>
                      {a.title || a.original_filename || "untitled"}
                    </div>
                    <div className="truncate text-[10px] text-gray-500">
                      {a.source_folder || a.ingest_source || "—"}
                      {a.file_size_bytes ? ` · ${Math.round(a.file_size_bytes / 1e6)}MB` : ""}
                    </div>
                    {a.classified_reason && (
                      <div className="truncate text-[10px] text-gray-400" title={a.classified_reason}>{a.classified_reason}</div>
                    )}
                    {/* CAN THIS CLIP BECOME AN EDIT? The one fact that decides
                        whether a cut is possible, and the only screen that has
                        ever said it out loud. Video only — a still has no
                        speech and no beats, so the question is meaningless. */}
                    {!a.readOnly && a.asset_type === "video" && (() => {
                      const st = parseIndex?.get(String(a.storage_url || "").trim()) || EMPTY_PARSE_STATE;
                      const v = parseVerdict(st);
                      return (
                        <button type="button" onClick={() => setTranscriptFor(a)}
                          title="Open the transcript for this clip"
                          className={`w-full rounded border px-1.5 py-0.5 text-[10px] font-semibold transition hover:brightness-95 ${v.chip}`}>
                          {v.label}
                        </button>
                      );
                    })()}
                    {a.readOnly ? (
                      <div className="text-[10px] text-gray-400">house track (music library)</div>
                    ) : (
                      <select
                        value={a.content_type || "unclassified"}
                        onChange={(e) => setType.mutate({ id: a.id, type: e.target.value as AssetContentType })}
                        className="w-full rounded border border-gray-300 bg-white px-1 py-0.5 text-[10px] text-gray-700">
                        {CONTENT_TYPES.map((t) => (
                          <option key={t.key} value={t.key}>{t.emoji} {t.label}</option>
                        ))}
                      </select>
                    )}
                    {/* The human groupings — several can be true of one clip,
                        which is why they are tags and not the single
                        content_type above. */}
                    {!a.readOnly && (
                      <div className="flex flex-wrap gap-0.5">
                        {INGEST_TAGS.map((t) => {
                          const on = contentTagsFrom(a.tags).includes(t.key);
                          return (
                            <button key={t.key} type="button" title={t.hint}
                              onClick={() => toggleTag.mutate({ id: a.id, tags: a.tags, key: t.key })}
                              className={`rounded px-1 py-0.5 text-[9px] font-semibold leading-none transition ${
                                on ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                              }`}>
                              {t.emoji}{on ? ` ${t.label}` : ""}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {a.storage_url && (
                      <a href={a.storage_url} target="_blank" rel="noreferrer"
                        className="block truncate text-[10px] text-[#3b82f6] underline">open ↗</a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {transcriptFor && (
        <AssetTranscriptPanel
          asset={transcriptFor}
          state={parseIndex?.get(String(transcriptFor.storage_url || "").trim()) || EMPTY_PARSE_STATE}
          onClose={() => setTranscriptFor(null)}
        />
      )}
    </div>
  );
}
