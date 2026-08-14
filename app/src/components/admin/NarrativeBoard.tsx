/**
 * NarrativeBoard — the layer above content management.
 *
 * Marketing Hub's other tabs answer "what have we made?". This one answers
 * "what are we SAYING, why, and is it carried everywhere?" — a topic tied to a
 * business goal, the thirteen channels that should carry it, what exists, what
 * doesn't, and which pieces point at which.
 *
 * The gaps are the feature. A narrative that has a YouTube episode and nothing
 * else shows eleven honest blanks, because that is the actual state — the old
 * behaviour buried six of every seven pieces inside a task description where
 * they looked done and were unusable.
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Link2, Plus, Target, AlertTriangle, Hand } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { brandMeta } from "@/lib/content-tags";
import {
  ARTIFACT_KINDS, OBJECTIVES, artifactKind, coverage,
  type ArtifactRow, type NarrativeRow, type ObjectiveKey,
} from "@/lib/narrativeEngine";
import { createNarrative, relinkNarrative, countUnattached } from "@/lib/narrativeService";

const db = supabase as any;

/**
 * How much content lives OUTSIDE the spine.
 *
 * Without this the board reads "no narratives yet" as a clean slate when the
 * truth is that everything ever made is orphaned. Same failure shape as a
 * health check that only asks whether a process is alive — see
 * `src/lib/pipelineHealth.ts`.
 */
function UnattachedBanner() {
  const { data } = useQuery({
    queryKey: ["narrative-unattached"],
    queryFn: countUnattached,
    staleTime: 60_000,
  });
  if (!data || data.total === 0) return null;

  const parts = [
    data.socialPosts && `${data.socialPosts} social post${data.socialPosts === 1 ? "" : "s"}`,
    data.blogPosts && `${data.blogPosts} blog post${data.blogPosts === 1 ? "" : "s"}`,
    data.emailCampaigns && `${data.emailCampaigns} email campaign${data.emailCampaigns === 1 ? "" : "s"}`,
    data.renders && `${data.renders} render${data.renders === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="text-xs text-amber-900">
          <span className="font-bold">{data.total.toLocaleString()} pieces carry no narrative.</span>{" "}
          {parts.join(" · ")}. They exist, they're just not part of any story — made before the
          spine, or made somewhere that doesn't attach yet. New BrandCast packs attach automatically.
        </div>
      </div>
    </div>
  );
}

const STATUS_TINT: Record<string, string> = {
  planned: "bg-gray-100 text-gray-400 border-gray-200",
  drafted: "bg-amber-100 text-amber-800 border-amber-300",
  approved: "bg-blue-100 text-blue-800 border-blue-300",
  published: "bg-emerald-100 text-emerald-800 border-emerald-300",
};

function useNarratives(brand: string) {
  return useQuery({
    queryKey: ["narratives", brand],
    queryFn: async () => {
      let q = db.from("content_narratives").select("*").order("created_at", { ascending: false }).limit(60);
      if (brand && brand !== "all") q = q.eq("brand", brand);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as NarrativeRow[];
    },
  });
}

function useAllArtifacts(ids: string[]) {
  return useQuery({
    queryKey: ["narrative-artifacts", ids.slice().sort().join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await db.from("content_artifacts").select("*").in("narrative_id", ids);
      if (error) throw error;
      return (data || []) as ArtifactRow[];
    },
  });
}

function NarrativeCard({ n, artifacts, onRelink }: {
  n: NarrativeRow; artifacts: ArtifactRow[]; onRelink: () => void;
}) {
  const cov = useMemo(() => coverage(artifacts), [artifacts]);
  const byKind = useMemo(() => {
    const m = new Map<string, ArtifactRow>();
    for (const a of artifacts) m.set(a.kind, a);
    return m;
  }, [artifacts]);
  const objective = OBJECTIVES.find((o) => o.key === n.objective);
  const meta = brandMeta(n.brand);

  return (
    <Card className="overflow-hidden border border-gray-200 bg-white">
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ backgroundColor: meta.color }}>
        <span className="text-[10px] font-extrabold uppercase tracking-wide text-white">{meta.label}</span>
        <span className="ml-auto rounded bg-white/20 px-1.5 text-[10px] font-bold text-white">
          {cov.made}/{cov.total} made
        </span>
      </div>

      <div className="p-3">
        <h3 className="text-sm font-bold leading-snug text-gray-900">{n.topic}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-blue-300 bg-blue-50 text-[10px] text-blue-700">
            <Target className="mr-1 h-2.5 w-2.5" />
            {objective?.label || n.objective}
          </Badge>
          {cov.published > 0 && (
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700">
              {cov.published} live
            </Badge>
          )}
          {cov.orphans.length > 0 && (
            <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[10px] text-amber-700"
              title="Made, but linking to nothing — the chain is broken here">
              <AlertTriangle className="mr-1 h-2.5 w-2.5" />
              {cov.orphans.length} unlinked
            </Badge>
          )}
        </div>

        {/* Coverage bar — how much of the narrative actually exists. */}
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-600 to-pink-600"
            style={{ width: `${cov.percent}%` }} />
        </div>

        {/* Every channel and its role. A blank is shown as a blank, and a
            piece the machine cannot actually send says so — rendering X the
            same as Instagram would imply an autopilot that doesn't exist. */}
        <div className="mt-2.5 grid grid-cols-2 gap-1 sm:grid-cols-3">
          {ARTIFACT_KINDS.map((k) => {
            const a = byKind.get(k.key);
            const status = a?.status || "planned";
            const linked = (a?.links_to?.length ?? 0) > 0;
            const made = status !== "planned";
            const handPosted = made && !k.publish.auto;
            const tip = [
              k.role,
              a?.target_table ? `Lives in: ${a.target_table}` : null,
              made
                ? k.publish.auto
                  ? "content-deploy can publish this on approval."
                  : "No auto-publisher — a human posts this one by hand."
                : null,
            ].filter(Boolean).join("\n\n");
            return (
              <div key={k.key} title={tip}
                className={cn("flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] font-medium", STATUS_TINT[status])}>
                <span className="truncate">{k.label}</span>
                {handPosted && <Hand className="ml-auto h-2.5 w-2.5 shrink-0 opacity-50" />}
                {linked && <Link2 className={cn("h-2.5 w-2.5 shrink-0 opacity-60", !handPosted && "ml-auto")} />}
              </div>
            );
          })}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[10px] text-gray-400">
            {cov.missing.length ? `${cov.missing.length} not made yet` : "every channel covered"}
          </span>
          <Button size="sm" variant="outline" onClick={onRelink}
            className="h-7 border-gray-300 text-[11px]">
            <Link2 className="mr-1 h-3 w-3" />
            Rebuild links
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function NarrativeBoard({ brand = "all" }: { brand?: string }) {
  const qc = useQueryClient();
  const { data: narratives = [], isLoading, error } = useNarratives(brand);
  const ids = useMemo(() => narratives.map((n) => n.id), [narratives]);
  const { data: artifacts = [] } = useAllArtifacts(ids);

  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState<ObjectiveKey>("awareness");
  const [busy, setBusy] = useState(false);

  const artifactsFor = (id: string) => artifacts.filter((a) => a.narrative_id === id);

  const add = async () => {
    if (!topic.trim()) { toast.error("What's the topic?"); return; }
    setBusy(true);
    try {
      await createNarrative({
        brand: brand === "all" ? "restylepro" : brand,
        topic, objective,
      });
      setTopic("");
      toast.success("Narrative created — every channel starts as an honest blank.");
      qc.invalidateQueries({ queryKey: ["narratives"] });
      qc.invalidateQueries({ queryKey: ["narrative-artifacts"] });
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally { setBusy(false); }
  };

  const relink = async (id: string) => {
    try {
      const n = await relinkNarrative(id);
      toast.success(n ? `${n} link(s) rebuilt.` : "Chain already correct.");
      qc.invalidateQueries({ queryKey: ["narrative-artifacts"] });
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    }
  };

  // The tables ship in the same PR as this board, but a stale deploy or an
  // unapplied migration should say so plainly rather than render an empty
  // board that looks like "no narratives yet".
  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        Narrative tables aren't reachable yet ({String((error as Error).message)}). They arrive with this
        release's migration — once it's applied this board fills in.
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-base font-bold text-gray-900">
          Narrative{" "}
          <span className="bg-gradient-to-r from-blue-600 to-pink-600 bg-clip-text text-transparent">Engine</span>
        </h2>
        <p className="mt-1 text-xs text-gray-500">
          One topic → a business goal → every channel that should carry it, each with a defined role and
          links to the others. BrandCast packs fan out into this automatically — every piece its own
          row in the table that already owns it, never copy buried in a card. Blanks are shown as blanks.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)}
            placeholder="The topic — e.g. “Shops are paying $975 a mockup”"
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) add(); }}
            className="flex-1 border-gray-300 bg-white text-sm text-gray-900" />
          <select value={objective} onChange={(e) => setObjective(e.target.value as ObjectiveKey)}
            className="h-10 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900">
            {OBJECTIVES.map((o) => <option key={o.key} value={o.key} title={o.hint}>{o.label}</option>)}
          </select>
          <Button onClick={add} disabled={busy}
            className="border-0 bg-gradient-to-r from-blue-600 to-pink-600 text-white">
            <Plus className="mr-1 h-4 w-4" />
            {busy ? "Creating…" : "New narrative"}
          </Button>
        </div>
        <UnattachedBanner />
      </div>

      {isLoading ? (
        <p className="mt-4 text-sm text-gray-500">Loading narratives…</p>
      ) : narratives.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
          <p className="text-sm font-semibold text-gray-700">No narratives yet.</p>
          <p className="mt-1 text-xs text-gray-500">
            One arrives on its own the next time BrandCast sends a pack to the approval board — every
            piece it writes becomes a real row here. Or start one by hand with the topic you want to
            be known for.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {narratives.map((n) => (
            <NarrativeCard key={n.id} n={n} artifacts={artifactsFor(n.id)} onRelink={() => relink(n.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
