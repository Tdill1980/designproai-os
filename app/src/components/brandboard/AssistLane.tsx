/**
 * AssistLane — the refused pieces, each with the move that unsticks it.
 *
 * `StuckReasons` above this says WHY, once per distinct sentence, and that is
 * the right shape for a reshoot list. It cannot say WHICH PIECE or offer to do
 * anything about it, so the board could diagnose 179 stuck pieces and help with
 * none of them while 171 editable clips sat unused in the library.
 *
 * This lists the pieces themselves and opens `AssistRefusedCut` on one. It is
 * deliberately a short list: a lane that shows two hundred rows is another wall
 * to scroll past, and the pieces are ordered so the freshest refusals — the
 * ones an operator still remembers commissioning — come first.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Hand } from "lucide-react";
import AssistRefusedCut, { refusalOf, type RefusedPost } from "./AssistRefusedCut";

export default function AssistLane({ brand }: { brand?: string | null }) {
  const [assisting, setAssisting] = useState<RefusedPost | null>(null);

  const { data: stuck } = useQuery({
    queryKey: ["assist-lane", brand ?? "all"],
    queryFn: async (): Promise<RefusedPost[]> => {
      let q = (supabase as any)
        .from("agent_social_posts")
        .select("id, brand, caption, generation_meta, updated_at")
        .eq("status", "draft")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (brand) q = q.eq("brand", brand);
      const { data } = await q;
      // The flags live inside jsonb, so the filter is done here rather than in
      // the query — 200 rows is nothing, and a jsonb predicate that silently
      // matches neither shape would just hide the lane.
      return (data || []).filter((p: RefusedPost) => refusalOf(p).stuck).slice(0, 12);
    },
  });

  if (!stuck?.length) return null;

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center gap-2">
        <Hand className="h-4 w-4 text-[#ec4899]" />
        <span className="text-xs font-bold text-gray-900">
          {stuck.length} piece{stuck.length === 1 ? "" : "s"} waiting on a human
        </span>
      </div>
      <p className="mb-2 text-[11px] text-gray-500">
        The pipeline refused these rather than spend on a cut it could not build. Point one at a
        clip that has beats and it will build the edit from your choice.
      </p>
      <div className="space-y-1.5">
        {stuck.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 rounded border border-gray-200 p-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-gray-900">{p.caption || "(no idea text)"}</div>
              <div className="truncate text-[10px] text-gray-500">{refusalOf(p).reason}</div>
            </div>
            <button
              onClick={() => setAssisting(p)}
              className="shrink-0 rounded-lg bg-gray-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-gray-700"
            >
              Assist
            </button>
          </div>
        ))}
      </div>
      {assisting && <AssistRefusedCut post={assisting} onClose={() => setAssisting(null)} />}
    </div>
  );
}
