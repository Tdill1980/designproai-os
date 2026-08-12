/**
 * IdeasLane — square cards showing IDEAS. Approve, and the content gets made.
 *
 * Owner, 2026-08-05: "THERE SHOULD BE SQUARE CARDS SHOWING IDEAS THEN WE
 * APPROVE AND CONTENT GETS MADE. CONTENT DIRECTOR IS BROKEN."
 *
 * It wasn't broken so much as missing a whole half. `content_hooks` held 534
 * ideas — 505 from a single week — and nothing anywhere consumed them.
 * `hooks_to_drafts` generates NEW hooks from a shoot transcript and never
 * reads that table; the Director queue reads social drafts and email campaigns
 * only. Ideas accumulated forever with no surface and no action.
 *
 * Approving here fans the idea out into every platform that can carry it —
 * reel, Short, Facebook, X, LinkedIn — each a real draft that lands in the
 * queue below. One idea in, many pieces out.
 *
 * Nothing published: every piece is created as a DRAFT.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Lightbulb, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Idea {
  id: string;
  brand?: string | null;
  idea_text: string;
  hook_type?: string | null;
  pillar_key?: string | null;
  score?: number | null;
  source?: string | null;
  created_at?: string | null;
}

interface IdeasResponse {
  ideas: Idea[];
  totals: { ideas: number; shown: number; truncated: number };
}

const BRAND_TINT: Record<string, string> = {
  wraptvworld: "from-fuchsia-500 to-pink-600",
  weprintwraps: "from-blue-500 to-indigo-600",
  restylepro: "from-cyan-500 to-blue-600",
  designproai: "from-violet-500 to-purple-600",
  inkandedge: "from-amber-500 to-orange-600",
  creatormarket: "from-emerald-500 to-teal-600",
};

export default function IdeasLane({ brand }: { brand?: string }) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<IdeasResponse>({
    queryKey: ["content-director-ideas", brand || "all"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "director_ideas", ...(brand && brand !== "all" ? { brand } : {}) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as IdeasResponse;
    },
    refetchInterval: 60_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["content-director-ideas"] });
    // The new drafts land in the queue below — refresh it too, or approving
    // looks like it did nothing.
    qc.invalidateQueries({ queryKey: ["content-director-queue"] });
  };

  const approve = useMutation({
    mutationFn: async (idea: Idea) => {
      setBusyId(idea.id);
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "idea_approve", idea_id: idea.id, ...(idea.brand ? { brand: idea.brand } : {}) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as {
        drafts: Array<{ platform: string }>;
        media_attached: boolean;
        media_match?: { matchedOn: string[]; label: string | null; finished: boolean } | null;
        failed?: unknown[];
        builds?: Array<{ aspect: string; id: string; surfaces: string[] }>;
        build_gaps?: string[];
      };
    },
    onSuccess: (r) => {
      const names = (r.drafts || []).map((d) => d.platform).join(", ");
      // Name the clip AND why it was chosen. A pick nobody can see is a pick
      // nobody can correct — and the old behaviour silently attached whatever
      // rendered most recently, which was the wrong video nearly every time.
      const m = r.media_match;
      const media = m
        ? ` Matched a ${m.finished ? "finished cut" : "raw clip"}${m.label ? ` (${m.label})` : ""} on: ${m.matchedOn.join(", ")}.`
        : r.media_attached
          ? " Footage attached."
          : " No footage matched — copy only. Attach a clip on the card below.";
      // THE CUTS. Approving now queues a render per SHAPE — one 9:16 file for
      // the reel and the Short, one 4:5 for the feeds, one 16:9 for X and
      // LinkedIn — because handing every surface the same file means two of
      // three are cropped by the platform at upload. Stating the count here is
      // what makes "it's building" visible instead of inferred; the Brand Board
      // then shows each job's progress.
      const cuts = r.builds || [];
      const build = cuts.length
        ? ` Building ${cuts.length} cut${cuts.length === 1 ? "" : "s"} (${cuts.map((c) => c.aspect).join(", ")}) — watch it on the Brand Board.`
        : r.build_gaps?.length
          ? ` No cut queued: ${r.build_gaps[0]}`
          : "";
      toast.success(
        r.drafts?.length ? `${r.drafts.length} drafts made — ${names}.${media}${build}` : "Nothing was made from that idea.",
        { duration: 9000 },
      );
      refresh();
    },
    onError: (e: Error) => toast.error(e.message || "Couldn't make content from that idea"),
    onSettled: () => setBusyId(null),
  });

  const reject = useMutation({
    mutationFn: async (idea: Idea) => {
      setBusyId(idea.id);
      const { data, error } = await supabase.functions.invoke("marketing-agent", {
        body: { action: "idea_reject", idea_id: idea.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => { toast.success("Idea rejected."); refresh(); },
    onError: (e: Error) => toast.error(e.message || "Couldn't reject that idea"),
    onSettled: () => setBusyId(null),
  });

  const ideas = data?.ideas || [];
  const totals = data?.totals;

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h2 className="text-base font-bold text-gray-900">Ideas</h2>
          {totals && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
              {totals.ideas.toLocaleString()} waiting
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500">
          Approve one and the content gets made — reel, Short, Facebook, X and LinkedIn drafts land in the queue below.
          Footage is matched from your library and transcripts (Drive clips included, once parsed); no match means copy-only, never a random clip.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading ideas…</p>
      ) : ideas.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white py-8 text-center">
          <Lightbulb className="mx-auto mb-2 h-8 w-8 text-gray-300" />
          <p className="text-sm font-semibold text-gray-700">No ideas waiting.</p>
          <p className="mt-1 text-xs text-gray-500">
            New hooks land here as they're written. Approving one turns it into real drafts.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {ideas.map((idea) => {
              const b = String(idea.brand || "restylepro").toLowerCase();
              const busy = busyId === idea.id;
              return (
                <div
                  key={idea.id}
                  className="flex aspect-square flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md"
                >
                  <div className={cn("bg-gradient-to-r px-2.5 py-1.5", BRAND_TINT[b] || BRAND_TINT.restylepro)}>
                    <div className="truncate text-[10px] font-bold uppercase tracking-wide text-white">
                      {idea.brand || "restylepro"}
                      {idea.hook_type ? ` · ${idea.hook_type}` : ""}
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2.5">
                    <p className="text-[13px] font-medium leading-snug text-gray-900">{idea.idea_text}</p>
                    {idea.pillar_key && (
                      <p className="mt-1.5 text-[10px] uppercase tracking-wide text-gray-400">{idea.pillar_key}</p>
                    )}
                  </div>

                  <div className="flex gap-1.5 border-t border-gray-100 p-2">
                    <button
                      onClick={() => approve.mutate(idea)}
                      disabled={busy}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gradient-to-r from-blue-600 to-fuchsia-600 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      Make it
                    </button>
                    <button
                      onClick={() => reject.mutate(idea)}
                      disabled={busy}
                      title="Reject this idea"
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-gray-500 hover:border-rose-400 hover:text-rose-600 disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Never let a cap read as the inventory — that is how the queue's
              own limit got mistaken for "150 waiting on you". */}
          {!!totals?.truncated && (
            <p className="mt-2 text-[11px] text-gray-500">
              Showing {totals.shown.toLocaleString()} of {totals.ideas.toLocaleString()} — {totals.truncated.toLocaleString()} more not shown.
            </p>
          )}
        </>
      )}
    </section>
  );
}
