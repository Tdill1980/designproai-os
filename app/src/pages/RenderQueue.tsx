import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Trash2,
  ExternalLink,
  Filter,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useRenderQueue, type RenderJob } from "@/hooks/useRenderQueue";

type FilterKey = "all" | "active" | "ready" | "failed";

const TOOL_LABELS: Record<string, string> = {
  colorpro: "ColorPro",
  designpro: "DesignPro",
  fadewraps: "FadeWraps",
  graphicspro: "GraphicsPro",
  visualize: "Visualize",
  material: "MaterialMode",
};

const TOOL_ROUTES: Record<string, string> = {
  colorpro: "/colorpro",
  designpro: "/designpro",
  fadewraps: "/fadewraps",
  graphicspro: "/graphics-pro",
  visualize: "/visualize",
  material: "/material",
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtElapsed(start: string | null, end: string | null): string {
  if (!start) return "—";
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  const s = Math.max(0, Math.floor((b - a) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

function StatusCell({ job }: { job: RenderJob }) {
  if (job.status === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" /> Ready
      </span>
    );
  }
  if (job.status === "failed") {
    return (
      <span className="inline-flex items-center gap-1.5 text-red-400 text-xs font-medium">
        <AlertCircle className="h-3.5 w-3.5" /> Failed
      </span>
    );
  }
  if (job.status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
        <XCircle className="h-3.5 w-3.5" /> Cancelled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-cyan-300 text-xs font-medium">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rendering
    </span>
  );
}

function ProgressBar({ job }: { job: RenderJob }) {
  if (job.status === "succeeded") {
    return (
      <div className="h-2 w-full rounded-sm bg-emerald-500/15 overflow-hidden">
        <div className="h-full w-full bg-emerald-400/70" />
      </div>
    );
  }
  if (job.status === "failed") {
    return (
      <div className="h-2 w-full rounded-sm bg-red-500/15 overflow-hidden">
        <div className="h-full w-1/3 bg-red-400/70" />
      </div>
    );
  }
  if (job.status === "cancelled") {
    return <div className="h-2 w-full rounded-sm bg-muted/50" />;
  }
  return (
    <div className="h-2 w-full rounded-sm bg-muted overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 transition-all animate-pulse"
        style={{ width: `${Math.max(8, job.progress || 10)}%` }}
      />
    </div>
  );
}

export default function RenderQueue() {
  const { jobs, counts, loading, remove, clearCompleted } = useRenderQueue();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [toolFilter, setToolFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (filter === "active" && !(j.status === "running" || j.status === "pending"))
        return false;
      if (filter === "ready" && j.status !== "succeeded") return false;
      if (filter === "failed" && j.status !== "failed") return false;
      if (toolFilter !== "all" && j.tool !== toolFilter) return false;
      return true;
    });
  }, [jobs, filter, toolFilter]);

  const tools = useMemo(() => {
    const set = new Set<string>();
    jobs.forEach((j) => set.add(j.tool));
    return Array.from(set);
  }, [jobs]);

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-start gap-4 mb-6">
          <img
            src="/characters/sproket/sproket-designmasterpiece.png"
            alt="Sproket"
            className="h-20 w-20 object-contain shrink-0 hidden sm:block"
            draggable={false}
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Render Queue
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              All your renders, every tool, every window — synced live.{" "}
              <span className="text-emerald-400 font-medium">
                {counts.ready} ready
              </span>
              {" · "}
              <span className="text-cyan-300 font-medium">
                {counts.active} active
              </span>
              {counts.failed > 0 && (
                <>
                  {" · "}
                  <span className="text-red-400 font-medium">
                    {counts.failed} failed
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          {(["all", "active", "ready", "failed"] as FilterKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                filter === k
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {k === "all"
                ? `All (${counts.total})`
                : k === "active"
                ? `Active (${counts.active})`
                : k === "ready"
                ? `Ready (${counts.ready})`
                : `Failed (${counts.failed})`}
            </button>
          ))}

          {tools.length > 1 && (
            <div className="flex items-center gap-1 ml-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
                className="bg-card border border-border rounded-md text-xs px-2 py-1"
              >
                <option value="all">All tools</option>
                {tools.map((t) => (
                  <option key={t} value={t}>
                    {TOOL_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearCompleted}
              disabled={counts.ready === 0 && counts.failed === 0}
              className="h-7 text-xs"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Clear completed
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="hidden md:grid grid-cols-[64px_minmax(0,2.2fr)_minmax(0,1fr)_120px_minmax(0,1.4fr)_110px_90px_60px] items-center gap-3 px-3 py-2 border-b border-border bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <div></div>
            <div>Name</div>
            <div>Tool / View</div>
            <div>Status</div>
            <div>Progress</div>
            <div>Started</div>
            <div>Elapsed</div>
            <div className="text-right">Actions</div>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Loading queue…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center">
              <img
                src="/characters/sproket/sproket-clipboard.png"
                alt="Sproket"
                className="h-24 w-24 object-contain mx-auto opacity-80 mb-3"
                draggable={false}
              />
              <div className="text-sm text-muted-foreground">
                {filter === "all"
                  ? "No renders yet. Fire one up and Sproket will track it here."
                  : `Nothing in "${filter}" right now.`}
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border/70">
              {filtered.map((j) => {
                const route = TOOL_ROUTES[j.tool];
                const thumb = j.thumbnail_url || j.result_url;
                return (
                  <li
                    key={j.id}
                    className={cn(
                      "grid md:grid-cols-[64px_minmax(0,2.2fr)_minmax(0,1fr)_120px_minmax(0,1.4fr)_110px_90px_60px] grid-cols-[56px_minmax(0,1fr)_70px] items-center gap-3 px-3 py-2.5 hover:bg-accent/30 transition-colors",
                      j.status === "running" && "bg-cyan-500/[0.04]"
                    )}
                  >
                    <div className="h-12 w-14 rounded-md bg-muted overflow-hidden border border-border/60 shrink-0">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                          draggable={false}
                        />
                      ) : (
                        <div className="h-full w-full grid place-items-center text-[10px] text-muted-foreground">
                          {j.status === "running" ? "..." : "—"}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {j.design_name || j.label || j.prompt_summary || j.vehicle || "Render"}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate md:hidden">
                        {(TOOL_LABELS[j.tool] ?? j.tool)}
                        {j.view_type ? ` · ${j.view_type}` : ""}
                      </div>
                      {j.vehicle && (j.design_name || j.label) && (
                        <div className="text-[11px] text-muted-foreground truncate hidden md:block">
                          {j.vehicle}
                        </div>
                      )}
                      {j.status === "failed" && j.error && (
                        <div className="text-[11px] text-red-400 truncate">
                          {j.error}
                        </div>
                      )}
                    </div>

                    <div className="hidden md:block min-w-0">
                      <Badge
                        variant="outline"
                        className="bg-cyan-500/10 border-cyan-400/30 text-cyan-200 text-[10px] uppercase tracking-wide"
                      >
                        {TOOL_LABELS[j.tool] ?? j.tool}
                      </Badge>
                      {j.view_type && (
                        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                          {j.view_type}
                        </div>
                      )}
                    </div>

                    <div className="hidden md:block">
                      <StatusCell job={j} />
                    </div>

                    <div className="hidden md:block">
                      <ProgressBar job={j} />
                    </div>

                    <div className="hidden md:block text-[11px] text-muted-foreground tabular-nums">
                      {fmtTime(j.started_at || j.created_at)}
                    </div>

                    <div className="hidden md:block text-[11px] text-muted-foreground tabular-nums">
                      {fmtElapsed(j.started_at, j.completed_at)}
                    </div>

                    <div className="flex items-center justify-end gap-1">
                      {j.status === "succeeded" && j.result_url && (
                        <a
                          href={j.result_url}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                          title="Open render"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {j.status === "succeeded" && route && (
                        <Link
                          to={route}
                          className="hidden md:inline-flex p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground text-[11px] font-medium"
                          title={`Open ${TOOL_LABELS[j.tool] ?? j.tool}`}
                        >
                          Open
                        </Link>
                      )}
                      {j.status !== "running" && (
                        <button
                          onClick={() => remove(j.id)}
                          className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-red-400"
                          title="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="md:hidden col-span-3">
                      <div className="flex items-center gap-3">
                        <StatusCell job={j} />
                        <div className="flex-1">
                          <ProgressBar job={j} />
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {fmtElapsed(j.started_at, j.completed_at)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground mt-3 text-center">
          Tip: keep ColorPro open in one tab and DesignPro in another — Sproket
          tracks every render here in real time.
        </p>
      </div>
    </div>
  );
}
