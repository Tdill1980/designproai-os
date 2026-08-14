/**
 * NarrativeArcBoard — the arc, as a thing you can look at.
 *
 * A narrative today is a label on a batch of simultaneous posts. This screen is
 * where it becomes a SEQUENCE: pick a narrative, see the five beats the library
 * can actually carry, in order, each with the clip, the timestamp and the line
 * behind it — and see, in the same list, the beats it CANNOT carry and the shot
 * that would fix them.
 *
 * ── WHY IT HAS TO BE VISIBLE ───────────────────────────────────────────────
 * An arc that only exists as rows is an arc nobody reviews, and unreviewed
 * generated copy is how a fabricated claim reaches a customer. Every beat here
 * shows its evidence inline — the clip name, the timecode, the verbatim line,
 * the frame description — so "is this true?" is answerable by reading, not by
 * running a query. The signal badge (BOTH / SPEECH / VISION) says which parse
 * backed it, because a beat with a line AND a picture is checkable in a way a
 * beat with only one is not.
 *
 * ── THE GAPS ARE THE OTHER HALF OF THE PRODUCT ─────────────────────────────
 * A short honest arc beats a complete invented one, and the gap rows are not an
 * apology — they are a shot list. "This arc needs a shot of the squeegee pull"
 * is something a crew can act on this week.
 *
 * ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 * It does not rank and it does not judge. `src/lib/narrativeArc.ts` plans (and
 * ranks through the existing `hookEngine`), `content-narrative-arc` writes and
 * enforces grounding server-side. This renders.
 *
 * WHITE UI standard (`docs/WHITE_UI_STANDARD.md`).
 */

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, Camera, Clapperboard, Film, Loader2, MessageSquare,
  Sparkles, Video,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  ARC_ROLES, joinMoments, planArc, parseBeatTitle, timecode,
  candidateKind, isArcKind, ARC_PRODUCER,
  type ArcCandidate, type ArcPlan, type BeatSignal, type MomentRow,
} from "@/lib/narrativeArc";

const db = supabase as any;

/**
 * How many moments of each kind to consider. Bounded because this is a browser
 * query over an 11,675-row table, and because a planner shown ten thousand
 * candidates picks no better than one shown a few hundred.
 */
const POOL = 400;

const SIGNAL_STYLE: Record<BeatSignal, { label: string; cls: string; icon: typeof Video }> = {
  both: { label: "SAID + SHOWN", cls: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: Video },
  speech: { label: "SAID only", cls: "bg-blue-100 text-blue-800 border-blue-300", icon: MessageSquare },
  vision: { label: "SHOWN only", cls: "bg-violet-100 text-violet-800 border-violet-300", icon: Camera },
};

function useNarratives(brand: string) {
  return useQuery({
    queryKey: ["arc-narratives", brand],
    queryFn: async () => {
      let q = db.from("content_narratives")
        .select("id, brand, topic, objective, created_at")
        .order("created_at", { ascending: false })
        .limit(80);
      if (brand && brand !== "all") q = q.eq("brand", brand);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Array<{ id: string; brand: string; topic: string; objective: string }>;
    },
  });
}

/**
 * The candidate pool: speech moments and vision moments, separately, so
 * `joinMoments` can marry them.
 *
 * Two things this query gets right that a naive one does not:
 *
 *   NULLS LAST. Postgres puts NULLs FIRST on a DESC sort, so ordering by
 *   `hook_score` descending without `nullsFirst: false` returns the UNSCORED
 *   rows ahead of the strong ones — backwards, and it looks like it works.
 *   2,878 of 2,920 video speech moments carry no score at all, so that mistake
 *   would hand the planner nothing but blanks. Same shape as `useBrandCast.ts`.
 *
 *   VIDEO ONLY. `media_sources.kind='music'` rows are transcribed HOUSE TRACKS
 *   — 106 clips, 738 "quotes" that are song lyrics. They score highest of
 *   anything in the table (hook_score 10 on "We don't just wrap vehicles, we
 *   wrap dreams"), so without this filter an arc is built out of lyrics and
 *   presented as things people said. The edge function refuses them too; this
 *   keeps them off the screen in the first place.
 */
function useCandidates(brand: string) {
  return useQuery({
    queryKey: ["arc-candidates", brand],
    queryFn: async () => {
      const base = () =>
        db.from("content_moments")
          .select("id, source_id, start_time, end_time, verbatim_quote, visual_description, hook_score, soundbite_score, broll_score, install_stage, media_sources!inner(id, title, filename, kind, brands)")
          .eq("media_sources.kind", "video");

      const order = (q: any) =>
        q.order("hook_score", { ascending: false, nullsFirst: false })
          .order("soundbite_score", { ascending: false, nullsFirst: false })
          .order("broll_score", { ascending: false, nullsFirst: false })
          .limit(POOL);

      const speechRes = await order(base().not("verbatim_quote", "is", null));
      if (speechRes.error) throw speechRes.error;

      // ── WHY THE VISION POOL IS FETCHED IN TWO PARTS ────────────────────
      // Ranking the two pools INDEPENDENTLY lands them on different clips,
      // and a speech row can only join a vision row on the SAME clip. Measured
      // against production on 2026-08-07: top-400 speech (47 clips) and
      // top-400 vision (29 clips) overlapped enough to produce THREE joined
      // beats out of 400. Pulling the vision rows for the clips the speech
      // pool actually covers produced 26 — 8.7× more — from the same budget.
      //
      // The second pull is still the open top-400, because clips nobody spoke
      // over are where "show the work" and "give the payoff" live: 171 clips
      // carry vision and only 97 carry both. Dropping them would cost the arc
      // its two picture beats to buy joins it does not need on every role.
      const clipIds = [...new Set((speechRes.data || []).map((r: any) => r.source_id))];
      const [sameClipRes, openRes] = await Promise.all([
        clipIds.length
          ? order(base().not("visual_description", "is", null).in("source_id", clipIds))
          : Promise.resolve({ data: [], error: null }),
        order(base().not("visual_description", "is", null)),
      ]);
      if (sameClipRes.error) throw sameClipRes.error;
      if (openRes.error) throw openRes.error;

      const visionRows = [...(sameClipRes.data || []), ...(openRes.data || [])];
      const visionDeduped = [...new Map(visionRows.map((r: any) => [r.id, r])).values()];

      const shape = (rows: any[]): MomentRow[] =>
        (rows || [])
          .filter((r) => {
            if (!brand || brand === "all") return true;
            const brands: string[] = r.media_sources?.brands || [];
            // Brand tags are hand-entered and inconsistently cased
            // ("WePrintWraps", "weprintwraps", "WePrintWraps.com"), so match
            // loosely rather than dropping most of the library on an exact
            // comparison. 133 of 375 video clips carry no brand tag at all.
            const want = brand.toLowerCase().replace(/[^a-z]/g, "");
            return brands.some((b) => String(b).toLowerCase().replace(/[^a-z]/g, "").includes(want));
          })
          .map((r) => ({
            id: r.id,
            source_id: r.source_id,
            start_time: r.start_time,
            end_time: r.end_time,
            verbatim_quote: r.verbatim_quote,
            visual_description: r.visual_description,
            hook_score: r.hook_score,
            soundbite_score: r.soundbite_score,
            broll_score: r.broll_score,
            install_stage: r.install_stage,
            clip_title: r.media_sources?.title || r.media_sources?.filename || null,
          }));

      return {
        speech: shape(speechRes.data),
        vision: shape(visionDeduped),
      };
    },
  });
}

/** The arc as it was actually saved, read back off the spine. */
function useSavedArc(narrativeId: string | null) {
  return useQuery({
    enabled: !!narrativeId,
    queryKey: ["arc-saved", narrativeId],
    queryFn: async () => {
      const { data, error } = await db
        .from("content_artifacts")
        .select("id, kind, title, body, target_table, target_id, links_to, produced_by")
        .eq("narrative_id", narrativeId)
        .eq("produced_by", ARC_PRODUCER)
        .order("kind");
      if (error) throw error;
      return (data || []).filter((a: any) => isArcKind(a.kind));
    },
  });
}

function SignalBadge({ signal }: { signal: BeatSignal }) {
  const s = SIGNAL_STYLE[signal];
  const Icon = s.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px] font-bold", s.cls)}>
      <Icon className="h-3 w-3" /> {s.label}
    </Badge>
  );
}

function EvidenceBlock({ c }: { c: ArcCandidate }) {
  return (
    <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Film className="h-3 w-3 text-gray-500" />
        <span className="font-mono text-gray-700">{c.clipTitle}</span>
        <span className="font-mono text-gray-500">
          {timecode(c.startTime)}–{timecode(c.endTime)}
        </span>
        <SignalBadge signal={c.signals} />
        <span className="text-gray-400">
          {c.score === null ? "unscored" : `score ${c.score}`} · reads as {candidateKind(c)}
        </span>
      </div>
      {c.verbatim && (
        <p className="mt-1.5 border-l-2 border-blue-300 pl-2 italic text-gray-800">“{c.verbatim}”</p>
      )}
      {c.visual && (
        <p className="mt-1.5 border-l-2 border-violet-300 pl-2 text-gray-600">{c.visual}</p>
      )}
    </div>
  );
}

export default function NarrativeArcBoard({ brand = "all" }: { brand?: string }) {
  const qc = useQueryClient();
  const [narrativeId, setNarrativeId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  const { data: narratives = [], isLoading: loadingNarratives } = useNarratives(brand);
  const { data: pool, isLoading: loadingPool } = useCandidates(brand);
  const { data: saved = [], isLoading: loadingSaved } = useSavedArc(narrativeId);

  const narrative = narratives.find((n) => n.id === narrativeId) || null;

  const candidates: ArcCandidate[] = useMemo(
    () => (pool ? joinMoments(pool.speech, pool.vision) : []),
    [pool],
  );

  const plan: ArcPlan | null = useMemo(() => {
    if (!narrative || !candidates.length) return null;
    return planArc(candidates, { brand: narrative.brand, topic: narrative.topic });
  }, [narrative, candidates]);

  async function writeArc(refresh = false) {
    if (!plan || !narrative) return;
    setWriting(true);
    try {
      const { data, error } = await supabase.functions.invoke("content-narrative-arc", {
        body: {
          narrative_id: narrative.id,
          refresh,
          beats: plan.beats.map((b) => ({
            roleKey: b.role.key,
            momentId: b.candidate.momentId,
            visionMomentId: b.candidate.visionMomentId,
          })),
          gaps: plan.gaps.map((g) => ({ roleKey: g.role.key, why: g.why })),
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if ((data as any)?.skipped === "already_arced") {
        toast.info("This exact arc was already written — nothing re-bought.");
      } else {
        const d = data as any;
        toast.success(`Arc saved — ${d.beats} beat(s), ${d.gaps} gap(s).`);
        if (d.rejected?.length) {
          toast.warning(`${d.rejected.length} beat(s) failed grounding and were recorded as gaps instead.`);
        }
      }
      qc.invalidateQueries({ queryKey: ["arc-saved", narrative.id] });
    } catch (e: any) {
      toast.error(e?.message || "the arc could not be written");
    } finally {
      setWriting(false);
    }
  }

  const poolNote = pool
    ? `${candidates.length} usable moment(s) from this pool — ${candidates.filter((c) => c.signals === "both").length} carry BOTH a line and a shot, ${candidates.filter((c) => c.signals === "speech").length} speech only, ${candidates.filter((c) => c.signals === "vision").length} vision only.`
    : "";

  return (
    <div className="space-y-4">
      <Card className="border-gray-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-gradient-to-br from-blue-500 to-pink-500 p-2">
            <Clapperboard className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900">Narrative Arcs</h2>
            <p className="text-sm text-gray-600">
              A topic becomes an ordered series — open the question, name what it costs, show the work,
              give the payoff, let someone else say it. Every beat is a real moment from the library,
              with the clip and the line behind it. Roles the footage cannot carry stay empty and say
              what to film.
            </p>
            {poolNote && <p className="mt-1 text-xs text-gray-500">{poolNote}</p>}
          </div>
        </div>
      </Card>

      <Card className="border-gray-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-bold text-gray-900">1 · Pick the narrative</h3>
        {loadingNarratives ? (
          <p className="text-sm text-gray-500">Loading narratives…</p>
        ) : narratives.length === 0 ? (
          <p className="text-sm text-gray-500">
            No narratives for this brand yet. One is created whenever an idea is approved or a pack
            fans out — this screen sequences an existing narrative, it never opens one.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {narratives.map((n) => (
              <button
                key={n.id}
                onClick={() => setNarrativeId(n.id)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-left text-xs transition",
                  n.id === narrativeId
                    ? "border-blue-500 bg-blue-50 text-blue-900"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300",
                )}
              >
                <span className="font-semibold">{n.topic}</span>
                <span className="ml-2 text-gray-400">{n.brand}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {narrative && (
        <Card className="border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-900">
              2 · The arc the footage can carry
            </h3>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!plan?.beats.length || writing}
                onClick={() => writeArc(false)}
                className="bg-gray-900 text-white hover:bg-gray-800"
              >
                {writing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
                Write this arc
              </Button>
              {saved.length > 0 && (
                <Button size="sm" variant="outline" disabled={writing} onClick={() => writeArc(true)}>
                  Rewrite
                </Button>
              )}
            </div>
          </div>

          {loadingPool ? (
            <p className="text-sm text-gray-500">Reading the library…</p>
          ) : !plan ? (
            <p className="text-sm text-gray-500">No footage in the pool for this brand.</p>
          ) : (
            <>
              <div
                className={cn(
                  "mb-3 rounded-lg border p-3 text-xs",
                  plan.complete
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-amber-300 bg-amber-50 text-amber-900",
                )}
              >
                <span className="font-bold">{plan.shortfall}</span>
              </div>

              <ol className="space-y-3">
                {ARC_ROLES.map((role) => {
                  const beat = plan.beats.find((b) => b.role.key === role.key);
                  const gap = plan.gaps.find((g) => g.role.key === role.key);
                  return (
                    <li
                      key={role.key}
                      className={cn(
                        "rounded-lg border p-3",
                        beat ? "border-gray-200 bg-white" : "border-dashed border-amber-300 bg-amber-50/50",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-gray-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                          {role.dayOffset === 0 ? "DAY 0" : `DAY ${role.dayOffset}`}
                        </span>
                        <span className="text-sm font-bold text-gray-900">{role.label}</span>
                        <span className="text-[11px] text-gray-500">→ {role.channel}</span>
                        <span className="text-[11px] text-gray-400">needs {role.needs}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-600">{role.job}</p>

                      {beat && <EvidenceBlock c={beat.candidate} />}

                      {gap && (
                        <div className="mt-2 rounded-md border border-amber-300 bg-white p-2 text-xs">
                          <div className="flex items-start gap-1.5">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                            <div>
                              <p className="text-amber-900">{gap.why}</p>
                              <p className="mt-1 font-bold text-gray-900">FILM THIS: {gap.missingShot}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </Card>
      )}

      {narrative && (
        <Card className="border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-bold text-gray-900">3 · What is saved on the spine</h3>
          {loadingSaved ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : saved.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nothing written yet. “Write this arc” sends the plan above to the model, checks every
              beat back against its own clip, and saves the survivors as{" "}
              <code className="rounded bg-gray-100 px-1">content_artifacts</code> rows under this
              narrative.
            </p>
          ) : (
            <ol className="space-y-2">
              {saved.map((a: any) => {
                const parsed = parseBeatTitle(a.title);
                const isGap = a.kind.startsWith("arc_gap_");
                return (
                  <li
                    key={a.id}
                    className={cn(
                      "rounded-lg border p-3 text-xs",
                      isGap ? "border-amber-300 bg-amber-50" : "border-gray-200 bg-white",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-gray-100 px-1 font-mono text-[10px] text-gray-600">
                        {a.kind}
                      </code>
                      <span className="font-bold text-gray-900">
                        {parsed ? parsed.headline : a.title}
                      </span>
                      {a.links_to?.length > 0 && (
                        <span className="text-[10px] text-gray-400">follows the previous beat</span>
                      )}
                    </div>
                    <pre className="mt-1.5 whitespace-pre-wrap font-sans text-gray-700">{a.body}</pre>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      )}
    </div>
  );
}
