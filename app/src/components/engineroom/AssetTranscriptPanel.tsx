/**
 * AssetTranscriptPanel — what the system actually heard on this clip, and the
 * only place a human can correct it.
 *
 * Owner, 2026-08-10: "When we upload I see no transcript editor."
 *
 * ── WHY THIS DID NOT EXIST, AND WHY THAT HURT ──────────────────────────────
 * Transcripts are written to `media_sources`, never to the library row, and
 * nothing in the Asset Library ever displayed them — grepped 2026-08-10, the
 * word "transcript" appeared in that file only inside a comment. So an
 * operator uploading footage had no way to see whether a clip had been heard,
 * mis-heard, or never processed at all.
 *
 * That blindness is expensive, because BEATS are what decide whether a cut can
 * be built. The editor brain reasons over `content_moments`; handed a clip with
 * none it refuses, and the piece ships as a one-clip stub. The Brand Board
 * carries 179 of those. Measured the same day: of 427 raw clips, 171 were
 * editable and 256 were not — and no screen in the app distinguished them.
 *
 * So this panel states the one fact that matters per clip, in the operator's
 * words rather than the schema's:
 *
 *   "7 beats — ready to cut"        the editor brain has something to reason over
 *   "parsed, but 0 beats"           heard, nothing usable came out of it
 *   "never parsed"                  no source row at all; offers to queue one
 *
 * ── IT COSTS NOTHING TO OPEN ───────────────────────────────────────────────
 * The index is loaded ONCE for the visible cards by the parent, not per card.
 * Editing a transcript writes text to a row; it buys no model call. Queuing a
 * parse is the only action here that spends, it is explicit, and it is priced
 * on the button (~$0.006/min — the entire library to date cost $2.36).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Mic, MicOff, Save, Sparkles } from "lucide-react";

/** One clip's parse state, resolved by the parent's single index read. */
export interface ParseState {
  /** `media_sources.id`, or null when nothing has ever parsed this clip. */
  sourceId: string | null;
  /** Whisper's text. Empty for b-roll, which is normal and not a fault. */
  transcript: string;
  /** `content_moments` on that source — what an edit is actually built from. */
  beats: number;
}

export const EMPTY_PARSE_STATE: ParseState = { sourceId: null, transcript: "", beats: 0 };

/**
 * The one-line verdict for a card, and the colour that carries it.
 *
 * Pure and exported so a test can pin the wording: these three states are the
 * whole point of the panel, and collapsing any two of them puts us back where
 * we started.
 */
export function parseVerdict(state: ParseState): {
  label: string;
  tone: "ready" | "thin" | "none";
  chip: string;
} {
  if (!state.sourceId) {
    return { label: "never parsed", tone: "none", chip: "border-gray-300 bg-gray-100 text-gray-600" };
  }
  if (state.beats > 0) {
    return {
      label: `${state.beats} beat${state.beats === 1 ? "" : "s"} — ready to cut`,
      tone: "ready",
      chip: "border-emerald-300 bg-emerald-50 text-emerald-700",
    };
  }
  return { label: "parsed, 0 beats", tone: "thin", chip: "border-amber-300 bg-amber-50 text-amber-700" };
}

export default function AssetTranscriptPanel({
  asset,
  state,
  onClose,
}: {
  asset: { id: string; storage_url?: string | null; title?: string | null; original_filename?: string | null };
  state: ParseState;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(state.transcript);
  const verdict = parseVerdict(state);
  const dirty = draft.trim() !== state.transcript.trim();

  const save = useMutation({
    mutationFn: async () => {
      if (!state.sourceId) throw new Error("There is no parsed source to attach this text to yet.");
      const { error } = await (supabase as any)
        .from("media_sources")
        .update({ transcript: draft })
        .eq("id", state.sourceId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Transcript saved — selection and the editor brain read this text.");
      qc.invalidateQueries({ queryKey: ["asset-parse-index"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || "Could not save the transcript"),
  });

  const queueParse = useMutation({
    mutationFn: async () => {
      const url = String(asset.storage_url || "").trim();
      if (!url) throw new Error("This clip has no stored file to parse.");
      // The same shape the Drive ingest uses. `kind:"url"` because the file is
      // already in storage; the parser upserts on storage_url with
      // ignoreDuplicates, so re-queuing cannot duplicate the library row.
      const { error } = await (supabase as any).from("video_parse_jobs").insert({
        kind: "url",
        media_url: url,
        filename: asset.original_filename || null,
        created_by: "asset-library",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Queued for parsing. The parser claims jobs every 10 minutes.");
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || "Could not queue this clip"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-gray-900">
              {asset.title || asset.original_filename || "untitled clip"}
            </div>
            <span className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${verdict.chip}`}>
              {verdict.tone === "ready" ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
              {verdict.label}
            </span>
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-100">✕</button>
        </div>

        {/* NEVER PARSED — the honest state, with the one action that fixes it. */}
        {!state.sourceId && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Nothing has parsed this clip, so there are no beats for the editor brain to reason
              over. Any cut built from it now would come out a one-clip stub.
            </p>
            <button
              onClick={() => queueParse.mutate()}
              disabled={queueParse.isPending || !asset.storage_url}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#3b82f6] to-[#ec4899] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {queueParse.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Parse this clip
            </button>
            <p className="text-[11px] text-gray-400">
              Transcription runs about $0.006 a minute — the whole library to date has cost $2.36.
            </p>
          </div>
        )}

        {/* PARSED — show the text, and let a human fix it. */}
        {state.sourceId && (
          <div className="space-y-3">
            {verdict.tone === "thin" && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                This clip was parsed but produced no usable moments. That is normal for silent
                b-roll. An edit needs beats, so this clip will lose to one that has them.
              </p>
            )}
            <label className="block text-xs font-semibold text-gray-700">
              What the system heard
              {!state.transcript.trim() && <span className="ml-1 font-normal text-gray-400">— nothing spoken</span>}
            </label>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={12}
              placeholder="No speech was transcribed for this clip. Type what is said if you want selection to find it by its words."
              className="w-full rounded-lg border border-gray-300 p-2 font-mono text-xs text-gray-800"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => save.mutate()}
                disabled={!dirty || save.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save transcript
              </button>
              {dirty && <span className="text-[11px] text-gray-500">unsaved changes</span>}
            </div>
            <p className="text-[11px] text-gray-400">
              Selection matches ideas against this text. Correcting a mis-heard company or vehicle
              name here is the cheapest way to make a clip findable.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
