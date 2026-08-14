/**
 * BrandBoardUploadDialog — the team's door for content we already made.
 *
 * Content Director stays the tool for everything produced from here on. This
 * is for the back catalog: reels, photos and captions from before the system
 * existed, or anything cut by hand outside it. A team member drops the files
 * in, says where it ran, and it lands on the Brand Board as a real card with
 * status "needs review" — waiting on an approver (see `useContentApprover`).
 *
 * The AI panel is optional and never automatic: if the old copy is weak, or
 * there is no copy at all, it proposes a hook + caption that the uploader
 * accepts and edits before anything is saved.
 *
 * ── PROGRESS AND DONENESS ──────────────────────────────────────────────────
 * This used to be one `busy` boolean: the button said "Uploading…", the dialog
 * closed on success, and a toast carried the only evidence anything had
 * happened. Three files looked the same at the first byte and the last, and an
 * admin reported exactly that — "no progress bar, no indication that it's
 * done". So the upload now runs as STAGES (one per file, plus the row that
 * makes them a card), each rendered from `src/lib/uploadProgress.ts`, which is
 * built on `queuedWork` and therefore takes no clock: the bar moves when a
 * stage really lands and sits still when one is slow. The dialog stays open on
 * success and says so in words, and a failure names the stage that stopped and
 * how many steps never ran.
 */

import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, FileVideo, FileImage, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import CaptionAiPanel from "./CaptionAiPanel";
import {
  buildUploadStages, setStageStatus, uploadDoneness, stageStatusLabel,
  progressFor, isDone, isFailed, SAVE_STAGE_ID, type UploadStage,
} from "@/lib/uploadProgress";
import {
  LEGACY_CHANNELS,
  CHANNEL_ORDER,
  buildLegacyPostRow,
  legacyStoragePath,
  type ChannelKey,
  type LegacyState,
} from "@/lib/brandBoardUpload";

const BUCKET = "wrap-files";

export interface BrandBoardUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Brand slug → label, from the board's own brand table. */
  brands: Record<string, { label: string; color: string }>;
  defaultBrand?: string;
  /** Fires after a successful save so the board refetches. */
  onUploaded?: () => void;
}

export default function BrandBoardUploadDialog({
  open,
  onOpenChange,
  brands,
  defaultBrand = "restylepro",
  onUploaded,
}: BrandBoardUploadDialogProps) {
  const [brand, setBrand] = useState(defaultBrand);
  const [channel, setChannel] = useState<ChannelKey>("ig_reel");
  const [state, setState] = useState<LegacyState>("archive");
  const [originalDate, setOriginalDate] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [aiAssisted, setAiAssisted] = useState(false);
  const [hook, setHook] = useState("");

  // THE STAGES. `null` before anything has been attempted — which is a
  // different fact from "zero stages" and must not render as an empty bar.
  const [stages, setStages] = useState<UploadStage[] | null>(null);
  const doneness = uploadDoneness(stages);
  const busy = doneness.state === "working";

  const brandKeys = useMemo(() => Object.keys(brands), [brands]);

  // A local still the AI can read, so "write it for me" is grounded in the
  // actual image before anything is uploaded. Videos have no frame to send.
  const localStill = useMemo(() => {
    const img = files.find((f) => f.type.startsWith("image/"));
    return img ? URL.createObjectURL(img) : null;
  }, [files]);

  const reset = () => {
    setCaption(""); setHashtags(""); setNote(""); setFiles([]);
    setOriginalDate(""); setHook(""); setAiAssisted(false);
    setStages(null);
  };

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  /**
   * Run the upload, one stage at a time.
   *
   * A stage is marked `running` BEFORE the await and `complete` only after the
   * call returns clean, so the row on screen is a statement about work that has
   * actually happened. On a failure the loop STOPS and the remaining stages are
   * left `queued` — they never ran, and `uploadDoneness` says so out loud
   * rather than letting them fade into an ambiguous middle.
   */
  const save = async () => {
    if (!files.length && !caption.trim()) {
      toast.error("Add the file (or at least the caption) before uploading.");
      return;
    }

    let live = buildUploadStages(files.map((f) => f.name));
    const mark = (id: string, status: "running" | "complete" | "failed", detail?: string) => {
      live = setStageStatus(live, id, status, detail);
      setStages(live);
    };
    setStages(live);

    // 1 · files → the public bucket, one stage each
    const now = Date.now();
    const mediaUrls: string[] = [];
    for (const [i, file] of files.entries()) {
      const stageId = live[i].id;
      mark(stageId, "running");
      const path = legacyStoragePath(brand, file.name, i, now);
      const { error: upErr } = await (supabase as any).storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: true });
      if (upErr) {
        mark(stageId, "failed", upErr.message);
        toast.error(`${file.name}: ${upErr.message}`);
        return;
      }
      mediaUrls.push(
        (supabase as any).storage.from(BUCKET).getPublicUrl(path).data.publicUrl,
      );
      mark(stageId, "complete");
    }

    // 2 · the row — always pending, never scheduled (see brandBoardUpload.ts)
    mark(SAVE_STAGE_ID, "running");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const row = buildLegacyPostRow({
        brand,
        channel,
        caption,
        hashtags,
        hook,
        mediaUrls,
        state,
        originalPostedAt: originalDate ? new Date(originalDate).toISOString() : null,
        note,
        uploadedBy: user?.email || null,
        aiAssisted,
      });

      const { error } = await (supabase as any).from("agent_social_posts").insert(row);
      if (error) throw new Error(error.message);
    } catch (e) {
      mark(SAVE_STAGE_ID, "failed", String((e as Error).message ?? e));
      toast.error(String((e as Error).message ?? e));
      return;
    }
    mark(SAVE_STAGE_ID, "complete");

    toast.success(
      state === "archive"
        ? "Uploaded to the board — waiting on approval to file it into history."
        : "Uploaded to the board — waiting on approval.",
    );
    // The dialog STAYS OPEN. The finished panel below is the "indication that
    // it's done" — a toast that has already faded is not one, and closing the
    // dialog the instant it works removes the only place that could say so.
    onUploaded?.();
  };

  const channelDef = LEGACY_CHANNELS[channel];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-h-[88vh] w-[92vw] overflow-y-auto bg-white sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-base text-slate-900">
            Upload content we already made
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-slate-500">
          For the back catalog — anything made outside this system. It lands on the board as
          a card for review; an approver signs off. Content Director stays the tool for
          everything new.
        </p>

        {/* Brand + channel */}
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Brand</span>
            <select
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
            >
              {brandKeys.map((k) => (
                <option key={k} value={k}>{brands[k].label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Where it ran</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as ChannelKey)}
              className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
            >
              {CHANNEL_ORDER.map((k) => (
                <option key={k} value={k}>{LEGACY_CHANNELS[k].label}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Did it already run? This is the whole difference between filing it
            into history and putting it in the "not published yet" queue. */}
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Has it been posted?</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {([
              { key: "archive" as const, title: "Already posted", sub: "File it into history" },
              { key: "review" as const, title: "Never posted", sub: "Made, but never went out" },
            ]).map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setState(o.key)}
                className={`rounded-lg border p-2 text-left transition-colors ${
                  state === o.key
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="text-xs font-semibold text-slate-900">{o.title}</div>
                <div className="text-[10px] text-slate-500">{o.sub}</div>
              </button>
            ))}
          </div>
          {state === "archive" && (
            <label className="mt-2 block">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                When it originally ran <span className="normal-case text-slate-400">(optional)</span>
              </span>
              <Input
                type="date"
                value={originalDate}
                onChange={(e) => setOriginalDate(e.target.value)}
                className="mt-1 h-9 border-slate-300 bg-white text-sm text-slate-900"
              />
              <span className="mt-1 block text-[10px] text-slate-400">
                Recorded as history only — uploading never re-publishes anything.
              </span>
            </label>
          )}
        </div>

        {/* Files */}
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            The content {channelDef?.postType === "carousel" && <span className="normal-case text-slate-400">— pick every slide</span>}
          </span>
          <label className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-xs text-slate-500 hover:border-blue-400 hover:text-blue-600">
            <Upload className="h-4 w-4" />
            {files.length ? `Add more — ${files.length} selected` : "Choose video or images"}
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = ""; }}
            />
          </label>
          {!!files.length && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
                  {f.type.startsWith("video/") ? <FileVideo className="h-3.5 w-3.5 shrink-0 text-slate-400" /> : <FileImage className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                  <span className="truncate">{f.name}</span>
                  <span className="ml-auto shrink-0 text-slate-400">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="shrink-0 text-slate-400 hover:text-red-600"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Caption */}
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Caption <span className="normal-case text-slate-400">— paste the original, or let the AI write one</span>
          </span>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Paste the caption this ran with — or leave it empty and use the AI panel below."
            className="mt-1 min-h-[110px] border-slate-200 bg-white text-sm text-slate-900"
          />
        </div>

        <CaptionAiPanel
          brand={brand}
          caption={caption}
          imageUrl={localStill}
          format={channelDef?.copyFormat}
          context={note || undefined}
          onAccept={({ caption: next, hook: nextHook, hashtags: tags }) => {
            setCaption(next);
            if (nextHook) setHook(nextHook);
            if (tags?.length) setHashtags(tags.join(" "));
            setAiAssisted(true);
          }}
        />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Hashtags</span>
            <Input
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="#vehiclewraps #wrapshop"
              className="mt-1 h-9 border-slate-300 bg-white text-sm text-slate-900"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Note for the reviewer
            </span>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What it shows / why we're keeping it"
              className="mt-1 h-9 border-slate-300 bg-white text-sm text-slate-900"
            />
          </label>
        </div>

        {/* THE PROGRESS PANEL. Appears the moment Upload is pressed and stays
            afterwards — it is both the bar and the receipt. */}
        {stages && <UploadStagesPanel stages={stages} doneness={doneness} />}

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[10px] text-slate-400">
            Lands as <span className="font-semibold text-slate-600">Needs review</span> — an admin signs off.
          </span>
          <div className="flex items-center gap-2">
            {doneness.state === "done" ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={reset}
                  className="h-8 text-xs text-slate-500"
                >
                  Upload another
                </Button>
                <Button
                  size="sm"
                  onClick={() => { reset(); onOpenChange(false); }}
                  className="h-8 border-0 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                  className="h-8 text-xs text-slate-500"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={save}
                  disabled={busy}
                  className="h-8 border-0 bg-gradient-to-r from-blue-600 to-pink-600 text-xs text-white"
                >
                  {busy ? "Uploading…" : doneness.state === "failed" ? "Try again" : "Upload to the board"}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The stage list — one row per file, plus the row that makes them a card.
 *
 * WHAT A STALLED UPLOAD LOOKS LIKE: the aggregate bar stops, the file's own bar
 * sits at the halfway mark, and its label reads "Running" without moving. That
 * is the honest picture of "a worker has it and we know nothing finer", and it
 * is only a usable signal because nothing here advances on a timer — hence the
 * line under the bar, which is a promise to the reader, not decoration.
 *
 * Colours follow the ecosystem formula: the state's own colour, solid where it
 * is asserting something (done green, failed red), tinted where it is waiting.
 * White UI throughout — slate text, no `text-muted-foreground`.
 */
function UploadStagesPanel({
  stages, doneness,
}: {
  stages: UploadStage[];
  doneness: ReturnType<typeof uploadDoneness>;
}) {
  const failed = doneness.state === "failed";
  const done = doneness.state === "done";

  return (
    <div
      className={`rounded-xl border p-3 ${
        failed ? "border-red-200 bg-red-50" : done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 text-[11px] font-bold ${
          failed ? "text-red-800" : done ? "text-emerald-800" : "text-slate-800"
        }`}>
          {failed ? <AlertTriangle className="h-3.5 w-3.5" /> : done ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {doneness.line}
        </span>
        <span className={`shrink-0 text-[11px] font-semibold ${
          failed ? "text-red-700" : done ? "text-emerald-700" : "text-slate-600"
        }`}>
          {doneness.percent}%
        </span>
      </div>

      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${failed ? "bg-red-500" : done ? "bg-emerald-500" : "bg-blue-500"}`}
          style={{ width: `${doneness.percent}%` }}
        />
      </div>

      <div className="mt-2 space-y-1">
        {stages.map((s) => (
          <div key={s.id} className="rounded-lg bg-white p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-semibold text-slate-800">{s.label}</span>
              <span className={`shrink-0 text-[10px] font-bold ${
                isFailed(s) ? "text-red-600" : isDone(s) ? "text-emerald-600" : "text-slate-500"
              }`}>
                {stageStatusLabel(s)}
              </span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full ${
                  isFailed(s) ? "bg-red-500" : isDone(s) ? "bg-emerald-500" : "bg-blue-500"
                }`}
                style={{ width: `${progressFor(s)}%` }}
              />
            </div>
            {s.detail && <p className="mt-1 text-[10px] leading-snug text-red-600">{s.detail}</p>}
          </div>
        ))}
      </div>

      <p className="mt-2 text-[10px] leading-snug text-slate-500">
        {done
          ? "It is on the Brand Board now, as Needs review. Nothing is published — an admin approves it there."
          : "This bar moves only when a step actually finishes. It is never advanced on a timer, so a bar that has stopped means the step has stopped."}
      </p>
    </div>
  );
}
