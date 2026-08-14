/**
 * AssistRefusedCut — the human steps in when the editor brain says no.
 *
 * Owner, 2026-08-10: "make sure path includes a way for humans to assist in
 * editing if not approved".
 *
 * ── WHAT A REFUSAL ALREADY IS, AND WHAT IT WAS MISSING ─────────────────────
 * A refusal is CORRECT behaviour and it is already cheap: `contentRunner`
 * queues no render when the brain has nothing to reason over, and cards the
 * piece instead (`meta.refused_cut`). The Brand Board then prints the reason in
 * plain words — "this clip has never been parsed, so there are no beats to
 * reason over".
 *
 * What was missing is the next move. The board could tell you a piece was
 * stuck and could not help you unstick it, so 179 refused pieces sat there
 * while 171 editable clips sat unused in the library. Reading a diagnosis you
 * cannot act on is just a slower silence.
 *
 * ── THE ONE ACTION THAT ACTUALLY UNSTICKS A PIECE ──────────────────────────
 * Point it at a clip that HAS beats. This lists the brand's editable clips
 * ranked against the piece's own idea, and pins the operator's choice to
 * `generation_meta.assist_clip_url`. The runner honours that pin above its own
 * scorer — the operator can see the footage and knows things the terms do not
 * carry.
 *
 * Pinning also clears `refused_cut`, which is the flag that keeps the piece out
 * of the queue. Clearing it without changing anything would just re-derive the
 * same refusal five minutes later: the scorer is deterministic, so the same
 * idea meets the same clip and earns the same verdict forever.
 *
 * ── WHAT IT DELIBERATELY WILL NOT DO ───────────────────────────────────────
 * It never attaches the clip as the finished creative. Writing `media_urls`
 * would satisfy `needsCreative` and the piece would ship as a raw clip with no
 * edit at all — the exact one-clip stub this whole thread is about. The human
 * chooses the FOOTAGE; the pipeline still builds the CUT.
 *
 * It also never offers a clip with zero beats. Those are the clips that caused
 * the refusal; listing them would let a well-meant assist recreate it.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Scissors } from "lucide-react";
import { scoreCandidate, terms, cuttableMedia } from "@/lib/footageMatch";
import { sameBrand } from "@/lib/brandAliases";
import { candidateFromAsset, buildTranscriptIndex, MEDIA_SOURCE_COLUMNS } from "@/lib/sourceFootage";

export interface RefusedPost {
  id: string;
  brand?: string | null;
  caption?: string | null;
  generation_meta?: Record<string, unknown> | null;
}

/** The reason a piece is stuck, in the operator's words. */
export function refusalOf(post: RefusedPost): { stuck: boolean; reason: string } {
  const meta = (post.generation_meta || {}) as Record<string, unknown>;
  if (meta.refused_cut) {
    return {
      stuck: true,
      reason: String(meta.editor_brain_note || meta.refused_cut_reason || "The editor brain refused this cut."),
    };
  }
  if (meta.needs_footage) {
    return { stuck: true, reason: String(meta.needs_footage_reason || "No clip in the library matched this idea.") };
  }
  return { stuck: false, reason: "" };
}

export default function AssistRefusedCut({ post, onClose }: { post: RefusedPost; onClose: () => void }) {
  const qc = useQueryClient();
  const [chosen, setChosen] = useState<string | null>(null);
  const refusal = refusalOf(post);

  // The EDITABLE clips, ranked against this piece's own idea.
  //
  // Deliberately NOT filtered to the piece's brand, unlike `pickFootage` — an
  // operator assisting a stuck piece can see the footage and may reach for
  // another brand's clip on purpose, which is the whole point of a human step.
  // But a cross-brand pick must never be SILENT, so any row whose brand differs
  // from the piece's is labelled below. (The header of this file used to claim
  // this list was brand-filtered. It never was.)
  const { data: options, isLoading } = useQuery({
    queryKey: ["assist-editable-clips", post.id, post.brand],
    queryFn: async () => {
      const [{ data: assets }, { data: sources }, { data: moments }] = await Promise.all([
        (supabase as any)
          .from("agent_media_assets")
          .select("id, brand, title, original_filename, transcript, tags, content_type, content_types, content_category, visual_tags, storage_url, source_folder, created_at")
          .eq("asset_type", "video")
          .not("storage_url", "is", null)
          .order("created_at", { ascending: false })
          .limit(500),
        (supabase as any).from("media_sources").select(MEDIA_SOURCE_COLUMNS).limit(5000),
        (supabase as any).from("content_moments").select("source_id").limit(100000),
      ]);
      const beatsBySource = new Map<string, number>();
      for (const m of moments || []) {
        const id = String((m as any)?.source_id || "");
        if (id) beatsBySource.set(id, (beatsBySource.get(id) || 0) + 1);
      }
      const idx = buildTranscriptIndex(sources as never, beatsBySource);
      // THE REAL TERM EXTRACTOR, NOT A LOCAL SPLIT.
      //
      // This was `idea.toLowerCase().split(/\W+/).filter(Boolean)` — every word
      // in the caption, stopwords included. Live on 2026-08-10 the picker
      // reported clips "matched on the, of, design" and "matched on the, of,
      // it": `the` and `of` appear in every English sentence and every
      // transcript, so each of those was a zero-information match dressed as
      // three, and the list underneath was ordered by beat count rather than by
      // relevance to the idea.
      //
      // `terms()` is the same extractor `pickFootage` and the unattended pass
      // use — it drops the stopword list, drops tokens under three characters
      // (which is where `of` and `it` go), and dedupes. Routing through it also
      // buys the vision weighting for free, because `scoreCandidate` reads
      // `seenOnScreen` off the candidate: a clip the vision pass actually SAW
      // installing now outranks one that merely has "install" in its filename.
      //
      // Same lesson as the filler-word fix in `pickFootage`, one file later: a
      // second copy of a scorer is a scorer that will be wrong on its own
      // schedule. There is no third copy — this file now has none of its own.
      const ideaTerms = terms(post.caption);
      return (assets || [])
        .map((a: Record<string, unknown>) => {
          const c = candidateFromAsset(a, idx);
          return { asset: a, candidate: c, ...scoreCandidate(ideaTerms, c) };
        })
        // ONLY clips that can become an edit. Offering a beatless clip here
        // would let an assist recreate the refusal it is meant to resolve.
        .filter((r: any) => (r.candidate.beatCount || 0) > 0)
        // AND ONLY THINGS THAT ARE ACTUALLY VIDEO. `asset_type = 'video'` is
        // already in the query above and is correct on production today; this
        // is the guard for the day a mis-typed row slips through, which
        // CLAUDE.md records happening three separate times. It reads the URL,
        // never the filename — see `cuttableMedia`.
        .filter((r: any) => cuttableMedia(r.candidate.url))
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 8);
    },
  });

  const pin = useMutation({
    mutationFn: async (url: string) => {
      const meta = { ...(post.generation_meta || {}) } as Record<string, unknown>;
      meta.assist_clip_url = url;
      meta.assisted_at = new Date().toISOString();
      // Clearing the pause flags is what puts the piece back in the queue. It
      // is only honest to clear them BECAUSE the input changed — see the header.
      delete meta.refused_cut;
      delete meta.needs_footage;
      const { error } = await (supabase as any)
        .from("agent_social_posts")
        .update({ generation_meta: meta, updated_at: new Date().toISOString() })
        .eq("id", post.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Clip pinned — the next pass builds the cut from it.");
      qc.invalidateQueries({ queryKey: ["brand-board"] });
      // The lane this dialog opens FROM. It now lives in Content Director,
      // where nothing else refetches it — without this the piece stays on the
      // list after being unstuck, which reads as the pin not having worked.
      qc.invalidateQueries({ queryKey: ["assist-lane"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message || "Could not pin that clip"),
  });

  const idea = useMemo(() => String(post.caption || "").trim(), [post.caption]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-900">Assist this cut</div>
            <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{idea || "(no idea text)"}</div>
          </div>
          <button onClick={onClose} className="rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-100">✕</button>
        </div>

        {refusal.stuck && (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
            {refusal.reason}
          </p>
        )}

        <div className="mb-2 text-xs font-semibold text-gray-700">
          Clips that can actually be cut, ranked against this idea
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the library…
          </div>
        )}

        {!isLoading && !options?.length && (
          // An honest dead end beats a list of clips that would refuse again.
          <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
            No clip in the library has parsed beats yet, so there is nothing here that could
            become an edit. Parse footage from the Asset Library first — a clip needs beats
            before any cut can be built from it.
          </p>
        )}

        <div className="space-y-1.5">
          {(options || []).map((o: any) => {
            const url = o.candidate.url;
            const on = chosen === url;
            return (
              <button key={url} type="button" onClick={() => setChosen(url)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border p-2 text-left transition ${
                  on ? "border-[#3b82f6] bg-blue-50" : "border-gray-200 bg-white hover:bg-gray-50"
                }`}>
                <span className="min-w-0">
                  {/* `candidate.label`, not the raw title: on 151 rows the
                      stored name is the extracted audio track's (`…_reel.mp3`)
                      while the file is `…_reel.mp4`, so this list read as if it
                      were offering songs to cut from. See `clipLabel`. */}
                  <span className="block truncate text-xs font-medium text-gray-900">
                    {o.candidate.label || "untitled"}
                  </span>
                  <span className="block truncate text-[10px] text-gray-500">
                    {o.asset.source_folder || "—"}
                    {o.matchedOn?.length ? ` · matched on ${o.matchedOn.slice(0, 3).join(", ")}` : " · no shared terms"}
                    {/* Another brand's footage is a legitimate choice and a
                        costly accident. Named, never hidden. */}
                    {o.asset.brand && post.brand && !sameBrand(String(o.asset.brand), String(post.brand))
                      ? ` · ${o.asset.brand} footage`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                  {o.candidate.beatCount} beats
                </span>
              </button>
            );
          })}
        </div>

        {!!options?.length && (
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => chosen && pin.mutate(chosen)}
              disabled={!chosen || pin.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#3b82f6] to-[#ec4899] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {pin.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
              Build the cut from this clip
            </button>
            <span className="text-[11px] text-gray-500">
              Your choice outranks the scorer. The pipeline still builds the edit.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
