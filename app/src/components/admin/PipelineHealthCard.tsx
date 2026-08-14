/**
 * PipelineHealthCard — one place that says whether the system is producing.
 *
 * Built after a day in which the media-parser was dead for 12 days, the
 * Content Director was showing three-week-old drafts, and the Brand Board was
 * rendering blank cards — and NOTHING reported any of it. Two pages already
 * called "Health" watch neither the parser, the renderer, nor transcription.
 *
 * Every row here asks the same question: WHEN DID THIS LAST PRODUCE SOMETHING
 * REAL? Not "is the process up" — the parser was up the entire time, claiming
 * the same broken file 110 times.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  judge, overall, hoursSince, LEVEL_STYLE, type HealthSignal,
} from "@/lib/pipelineHealth";

const db = supabase as any;

async function loadSignals(): Promise<HealthSignal[]> {
  const now = new Date();
  const one = async (fn: () => Promise<any>) => { try { return await fn(); } catch { return null; } };

  const [parseDone, parseQueued, parseStuck, lastTranscript, lastRender, renderFail, lastAsset, oldestDraft] =
    await Promise.all([
      one(() => db.from("video_parse_jobs").select("updated_at").eq("status", "complete").order("updated_at", { ascending: false }).limit(1).maybeSingle()),
      one(() => db.from("video_parse_jobs").select("id", { count: "exact", head: true }).eq("status", "queued")),
      one(() => db.from("video_parse_jobs").select("id", { count: "exact", head: true }).eq("status", "processing").lt("claimed_at", new Date(Date.now() - 2 * 3600e3).toISOString())),
      one(() => db.from("media_sources").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle()),
      one(() => db.from("video_render_jobs").select("created_at").eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle()),
      one(() => db.from("video_render_jobs").select("id", { count: "exact", head: true }).eq("status", "failed")),
      one(() => db.from("agent_media_assets").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle()),
      one(() => db.from("agent_social_posts").select("created_at").eq("status", "draft").order("created_at", { ascending: true }).limit(1).maybeSingle()),
    ]);

  return [
    {
      key: "parser",
      label: "Media parser",
      measures: "Copies Drive footage in, transcribes it and scores it. Nothing can be cut until this runs.",
      hoursSinceOutput: hoursSince(parseDone?.data?.updated_at, now),
      warnAfterHours: 24,
      downAfterHours: 48,
      queued: parseQueued?.count ?? 0,
      stuck: parseStuck?.count ?? 0,
      // NOT Railway. The parser runs as the `parse-media` GitHub Actions
      // workflow (every 10 min, drain-once); Railway only hosts the DesignProAI
      // genie worker. Naming the wrong service sends you to restart something
      // that was never involved — which is exactly what happened on 2026-08-05.
      remedy: "Run the “Parse Media” GitHub Actions workflow. If it's green but nothing lands, one bad file is blocking the queue — jobs are claimed oldest-first.",
    },
    {
      key: "transcripts",
      label: "Transcription",
      measures: "Whisper transcripts. Story Edit and the music rule both depend on these.",
      hoursSinceOutput: hoursSince(lastTranscript?.data?.created_at, now),
      warnAfterHours: 48,
      downAfterHours: 96,
      remedy: "Follows the parser — fix that first.",
    },
    {
      key: "renderer",
      label: "Video renderer",
      measures: "Finished cuts coming out of BrandCast.",
      hoursSinceOutput: hoursSince(lastRender?.data?.created_at, now),
      warnAfterHours: 72,
      downAfterHours: 168,
      stuck: 0,
      // Also GitHub Actions (`render-videos`, every 5 min), not Railway.
      remedy: renderFail?.count
        ? `${renderFail.count} render(s) have failed — open the Cut Editor to see why.`
        : "Run the “Render Videos” GitHub Actions workflow to drain the queue now.",
    },
    {
      key: "library",
      label: "Asset library",
      measures: "New raw footage arriving in the pool.",
      hoursSinceOutput: hoursSince(lastAsset?.data?.created_at, now),
      warnAfterHours: 72,
      downAfterHours: 168,
      remedy: "Paste a Drive folder in the Asset Library, or check the parser row above.",
    },
    {
      key: "director",
      label: "Content Director queue",
      measures: "The oldest draft still waiting on a human.",
      // Here "output" is the age of the OLDEST unreviewed draft — a queue
      // nobody clears is its own kind of stall.
      hoursSinceOutput: hoursSince(oldestDraft?.data?.created_at, now),
      warnAfterHours: 24 * 14,
      downAfterHours: 24 * 30,
      remedy: "Approve or reject the backlog — the newest work sits behind it.",
    },
  ];
}

export default function PipelineHealthCard() {
  const { data: signals = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["pipeline-health"],
    queryFn: loadSignals,
    refetchInterval: 60_000,
  });

  const level = overall(signals);
  const style = LEVEL_STYLE[level];

  return (
    <Card className="border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn("h-2.5 w-2.5 rounded-full", style.dot)} />
          <h3 className="text-base font-bold text-slate-900">Is the system producing?</h3>
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-bold", style.chip)}>
            {style.label}
          </span>
        </div>
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:border-blue-400 hover:text-blue-600"
        >
          <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          Check now
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Each row asks when it last produced something real — not whether the process answers a ping.
        The parser was “up” for the twelve days it produced nothing.
      </p>

      {isLoading ? (
        <p className="mt-3 text-sm text-slate-500">Checking…</p>
      ) : (
        <div className="mt-3 space-y-2">
          {signals.map((s) => {
            const v = judge(s);
            const st = LEVEL_STYLE[v.level];
            const Icon = v.level === "ok" ? CheckCircle2 : v.level === "warn" ? AlertTriangle : XCircle;
            return (
              <div key={s.key} className={cn("rounded-lg border p-2.5", st.chip)}>
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold">{s.label}</div>
                    <div className="text-xs">{v.summary}</div>
                    <div className="mt-0.5 text-[11px] opacity-75">{s.measures}</div>
                    {v.level !== "ok" && s.remedy && (
                      <div className="mt-1 text-[11px] font-semibold">→ {s.remedy}</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
