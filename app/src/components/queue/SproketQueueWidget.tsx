import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, CheckCircle2, AlertCircle, ListChecks } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRenderQueue, type RenderJob } from "@/hooks/useRenderQueue";

const TOOL_LABELS: Record<string, string> = {
  colorpro: "ColorPro",
  designpro: "DesignPro",
  fadewraps: "FadeWraps",
  graphicspro: "GraphicsPro",
  visualize: "Visualize",
  material: "MaterialMode",
};

function relTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function StatusIcon({ status }: { status: RenderJob["status"] }) {
  if (status === "succeeded")
    return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (status === "failed")
    return <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />;
  return <Loader2 className="h-4 w-4 text-cyan-400 animate-spin shrink-0" />;
}

export function SproketQueueWidget() {
  const { jobs, counts, userId, remove } = useRenderQueue();
  const [open, setOpen] = useState(false);

  const recent = useMemo(() => jobs.slice(0, 6), [jobs]);

  if (!userId) return null;

  const ready = counts.ready;
  const active = counts.active;

  const headline =
    active > 0
      ? `${active} render${active === 1 ? "" : "s"} cooking`
      : ready > 0
      ? `${ready} render${ready === 1 ? "" : "s"} ready`
      : "Queue empty";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Render queue"
          className={cn(
            "relative flex items-center gap-2 rounded-full border border-border/60",
            "bg-card/40 hover:bg-card/80 transition-colors px-2 py-1",
            active > 0 && "ring-1 ring-cyan-400/60"
          )}
        >
          <span className="relative inline-flex">
            <img
              src="/characters/sproket/sproket-avatar.png"
              alt="Sproket"
              className="h-7 w-7 rounded-full object-cover"
              draggable={false}
            />
            {active > 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-cyan-400 ring-2 ring-background animate-pulse" />
            )}
          </span>
          {(active > 0 || ready > 0) && (
            <Badge
              variant="secondary"
              className={cn(
                "h-5 px-1.5 text-[11px] font-semibold",
                active > 0
                  ? "bg-cyan-500/15 text-cyan-200 border-cyan-400/30"
                  : "bg-emerald-500/15 text-emerald-200 border-emerald-400/30"
              )}
            >
              {active > 0 ? active : ready}
            </Badge>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[340px] p-0 bg-card border-border z-[100]"
      >
        <div className="flex items-start gap-3 p-3 border-b border-border/60 bg-gradient-to-br from-cyan-500/10 via-transparent to-fuchsia-500/10">
          <img
            src={
              ready > 0 && active === 0
                ? "/characters/sproket/sproket-designmasterpiece.png"
                : "/characters/sproket/sproket-announce.png"
            }
            alt="Sproket"
            className="h-14 w-14 object-contain shrink-0"
            draggable={false}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground leading-tight">
              {headline}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {active > 0
                ? "Keep designing in another tab — I'll keep an eye on these."
                : ready > 0
                ? "Tap a job to open the result."
                : "Fire up a render and I'll track it here."}
            </div>
          </div>
        </div>

        <div className="max-h-[320px] overflow-y-auto">
          {recent.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No jobs yet.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {recent.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-accent/40"
                >
                  <StatusIcon status={j.status} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] uppercase tracking-wide text-cyan-300/80 font-semibold">
                        {TOOL_LABELS[j.tool] ?? j.tool}
                      </span>
                      {j.view_type && (
                        <span className="text-[11px] text-muted-foreground">
                          · {j.view_type}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-foreground truncate">
                      {j.design_name || j.label || j.prompt_summary || j.vehicle || "Render"}
                    </div>
                    {j.status === "running" && (
                      <div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-cyan-400/80 transition-all"
                          style={{ width: `${Math.max(8, j.progress || 10)}%` }}
                        />
                      </div>
                    )}
                    {j.status === "failed" && j.error && (
                      <div className="text-[11px] text-red-400 truncate">
                        {j.error}
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {relTime(j.completed_at || j.started_at || j.created_at)}
                  </div>
                  {j.status !== "running" && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        remove(j.id);
                      }}
                      className="text-[10px] text-muted-foreground hover:text-foreground px-1"
                      aria-label="Dismiss job"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="p-2 border-t border-border/60 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted-foreground pl-1">
            {counts.total} total · {counts.failed} failed
          </span>
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setOpen(false)}
          >
            <Link to="/queue">
              <ListChecks className="h-3.5 w-3.5 mr-1" />
              Open Queue
            </Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
