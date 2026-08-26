/**
 * THE DESIGNPRO DESIGN LIBRARY — the last four months of real work.
 *
 * RevisionStudioIQ could open one design and could not tell you which designs
 * exist. Its card feed was keyed on `designpro_workflow_runs`, and a run is
 * created by the PRODUCTION HANDOFF -- so over the last four months that feed
 * represented 8 of 48 real generations. Everything still in Calls 1-7 and
 * everything that failed there had no run and so no row, and the grid then
 * dropped whatever survived that had no image yet. That is the "recent work
 * crowded out of the window" defect, and it was not a sort order: it was an
 * entirely wrong table.
 *
 * So this reads `dpApi.listDesignLibrary`, which reads the generation records
 * themselves -- the one table with a row for every design from the moment
 * Create Design is pressed. ONE table: no union with a featured list, no legacy
 * render table, no ColorPro visualizations. There is nothing here to curate and
 * nothing that can take a recent design's place.
 *
 * NOTHING IS INVENTED. Every value on a card is one the server stated. A design
 * with no thumbnail shows the reason it has none; a design with no company name
 * shows its vehicle instead of a placeholder; a failed design appears as a
 * failed design rather than being hidden to make the grid look healthier than
 * the work.
 *
 * NOT A PRODUCER. The two actions are navigation -- open this design here, or
 * open it in PanelPro. Nothing on this surface generates, re-cuts or mutates.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Search, RefreshCw, ImageOff, Layers, ExternalLink, Clock, AlertTriangle,
  CheckCircle2, Loader2, PackageCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dpApi, type DesignLibraryEntry } from "@/lib/designpro-api";
import { cn } from "@/lib/utils";

/** The default window the product promises, and the two a designer asks for. */
const WINDOWS = [
  { key: "4m", label: "Last 4 months", months: 4 },
  { key: "1m", label: "Last 30 days", months: 1 },
  { key: "12m", label: "Last 12 months", months: 12 },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];
type PipelineFilter = "all" | "atlas" | "standard";
type StatusFilter = "all" | "completed" | "failed" | "working" | "production";

/**
 * One design's status, as one word.
 *
 * `production` wins over `completed` because it is the later fact about the
 * same design: a job whose pack is being built is not merely finished designing.
 */
export function statusOf(entry: DesignLibraryEntry): StatusFilter {
  if (entry.production) return "production";
  if (entry.state === "outputs_ready") return "completed";
  if (entry.state === "failed" || entry.state === "cancelled") return "failed";
  return "working";
}

const STATUS_LABEL: Record<Exclude<StatusFilter, "all">, string> = {
  completed: "Completed",
  failed: "Failed",
  working: "In progress",
  production: "In production",
};

const STATUS_TONE: Record<Exclude<StatusFilter, "all">, string> = {
  completed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  failed: "border-red-500/40 bg-red-500/10 text-red-300",
  working: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  production: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
};

function StatusIcon({ status }: { status: Exclude<StatusFilter, "all"> }) {
  if (status === "completed") return <CheckCircle2 className="h-3 w-3" />;
  if (status === "failed") return <AlertTriangle className="h-3 w-3" />;
  if (status === "production") return <PackageCheck className="h-3 w-3" />;
  return <Loader2 className="h-3 w-3 animate-spin" />;
}

/**
 * THE CARD READS THE WAY THE PRODUCT READS.
 *
 * RevisionStudioIQ names a design by its VEHICLE and subtitles it with the
 * company and the finish -- "2020 ford f 150" over "Flamingo Pools · Gloss".
 * That is the existing card's convention and this surface follows it, so the
 * library looks like part of the studio rather than an admin table bolted to
 * the top of it. The vehicle string is shown exactly as it was recorded,
 * lower-case and all: it is what the customer typed.
 */
function titleOf(entry: DesignLibraryEntry): string {
  const vehicle = [entry.vehicle?.year, entry.vehicle?.make, entry.vehicle?.model]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  if (vehicle) return vehicle;
  return (entry.companyName || entry.designName || "").trim() || entry.designId;
}

/** "Flamingo Pools · Gloss", and only the halves that exist. */
function subtitleOf(entry: DesignLibraryEntry): string {
  const named = (entry.companyName || entry.designName || "").trim();
  return [named, String(entry.finish || "").trim()].filter(Boolean).join(" · ")
    || String(entry.vehicle?.type || "").trim()
    || "No company recorded";
}

function vehicleLine(entry: DesignLibraryEntry): string {
  if (!entry.vehicle) return "Vehicle not recorded";
  const { year, make, model, type } = entry.vehicle;
  const ymm = [year, make, model].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  const kind = String(type || "").trim();
  return [ymm || "Vehicle not recorded", kind].filter(Boolean).join(" · ");
}

function shortDate(value: string | null): string {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * "5 days ago" — the card's own way of stating age.
 *
 * The exact date is kept as the element's title, because "5 days ago" is what
 * a person scans by and the timestamp is what they need when it matters.
 */
function relativeAge(value: string | null): string {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  const units: Array<[number, string]> = [
    [60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"],
  ];
  let amount = seconds;
  let unit = "second";
  for (const [size, nextUnit] of units) {
    if (amount < size) break;
    amount = Math.floor(amount / size);
    unit = nextUnit;
  }
  if (unit === "second" && amount < 45) return "just now";
  return `${amount} ${unit}${amount === 1 ? "" : "s"} ago`;
}

/**
 * Does this design match what was typed.
 *
 * Company and design name, the generation id and the Design ID, and the
 * vehicle. All four are what a person actually has in hand when they are
 * looking for a job, so all four match.
 */
export function matchesQuery(entry: DesignLibraryEntry, needle: string): boolean {
  const query = needle.trim().toLowerCase();
  if (!query) return true;
  return [
    entry.companyName,
    entry.designName,
    entry.generationId,
    entry.designId,
    entry.vehicle?.year,
    entry.vehicle?.make,
    entry.vehicle?.model,
    entry.vehicle?.type,
    entry.finish,
    entry.production?.orderNumber,
  ].some((field) => String(field || "").toLowerCase().includes(query));
}

export function DesignLibrary({
  onOpen,
  query: externalQuery,
  pipeline: externalPipeline,
  emptySlot,
  className,
}: {
  /** Open this design in the studio, in place. */
  onOpen?: (generationId: string) => void;
  /**
   * The studio's own search box drives this when it is supplied, and the
   * library renders no second one. Two search fields over one list is the
   * duplication this surface exists to remove.
   */
  query?: string;
  /**
   * A.T.L.A.S. / Standard, when the page's own control drives it. The library
   * then renders no second set of pipeline buttons -- one control per question.
   */
  pipeline?: "all" | "atlas" | "standard";
  /**
   * Rendered inside the empty state. The studio's SPROKET tips slideshow lived
   * in the grid this library replaced, so it is carried here rather than lost
   * with it -- the empty shelf is exactly where a tip is worth reading.
   */
  emptySlot?: React.ReactNode;
  className?: string;
}) {
  const [entries, setEntries] = useState<DesignLibraryEntry[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [windowKey, setWindowKey] = useState<WindowKey>("4m");
  const [ownQuery, setOwnQuery] = useState("");
  const query = externalQuery === undefined ? ownQuery : externalQuery;
  const [ownPipeline, setOwnPipeline] = useState<PipelineFilter>("all");
  const pipeline = externalPipeline === undefined ? ownPipeline : externalPipeline;
  const [status, setStatus] = useState<StatusFilter>("all");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    const months = WINDOWS.find((entry) => entry.key === windowKey)?.months ?? 4;
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    dpApi.listDesignLibrary({ since })
      .then((rows) => { if (live) setEntries(rows); })
      .catch((cause) => {
        if (!live) return;
        setEntries([]);
        setError(cause instanceof Error ? cause.message : "The design library could not be read.");
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [windowKey, reloadKey]);

  // Filtering happens in memory on purpose: this is one shop's work over a
  // window, not a volume worth a round trip per keystroke, and every field the
  // filters read is already on the row.
  const visible = useMemo(() => {
    if (!entries) return [];
    return entries.filter((entry) => {
      if (pipeline !== "all" && entry.pipeline !== pipeline) return false;
      if (status !== "all" && statusOf(entry) !== status) return false;
      return matchesQuery(entry, query);
    });
  }, [entries, pipeline, status, query]);

  const counts = useMemo(() => {
    const total = entries?.length ?? 0;
    const atlas = entries?.filter((entry) => entry.pipeline === "atlas").length ?? 0;
    return { total, atlas, standard: total - atlas };
  }, [entries]);

  return (
    <div className={cn("w-full space-y-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="h-4 w-4 text-blue-400" />
        <span className="font-poppins text-sm font-bold text-zinc-200">Design Library</span>
        <span className="text-[11px] text-zinc-500">
          {loading && !entries
            ? "reading…"
            : `${visible.length} of ${counts.total} design${counts.total === 1 ? "" : "s"}`}
          {/* No pipeline vocabulary here: which engine authored a design is
              production-floor language, and this is the customer's shelf of
              past designs. PanelPro carries the full technical record. */}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 border-zinc-700 text-[11px] text-zinc-300"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={loading}
        >
          <RefreshCw className={cn("mr-1.5 h-3 w-3", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {externalQuery === undefined && (
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              value={ownQuery}
              onChange={(event) => setOwnQuery(event.target.value)}
              placeholder="Company, design name, vehicle, generation id or DID…"
              className="h-8 border-zinc-700 bg-zinc-950 pl-8 text-[12px] text-zinc-200 placeholder:text-zinc-600"
            />
          </div>
        )}
        {/* The window is a real query parameter, not a client-side slice: a
            wider window asks the server for more rows. */}
        <div className="flex items-center gap-1">
          {WINDOWS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              onClick={() => setWindowKey(entry.key)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
                windowKey === entry.key
                  ? "border-blue-500 bg-blue-500/15 text-blue-200"
                  : "border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {externalPipeline === undefined && (
          <div className="flex items-center gap-1">
            {([["all", "All"], ["atlas", "Current"], ["standard", "Classic"]] as const).map(
              ([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOwnPipeline(key)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
                    pipeline === key
                      ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                      : "border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200",
                  )}
                >
                  {label}
                </button>
              ),
            )}
          </div>
        )}
        <div className="flex items-center gap-1">
          {([
            ["all", "Any status"],
            ["completed", "Completed"],
            ["production", "In production"],
            ["working", "In progress"],
            ["failed", "Failed"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatus(key)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
                status === key
                  ? "border-zinc-400 bg-zinc-700/40 text-zinc-100"
                  : "border-zinc-700 bg-zinc-950/60 text-zinc-400 hover:text-zinc-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-300">
          {error}
        </p>
      )}

      {entries && entries.length === 0 && !error && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-3">
          <p className="text-[11px] text-zinc-400">
            No DesignPro generations in this window. Widen it, or create a design.
          </p>
          {emptySlot}
        </div>
      )}

      {entries && entries.length > 0 && visible.length === 0 && (
        <p className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-3 text-[11px] text-zinc-400">
          No design in this window matches those filters.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((entry) => {
          const state = statusOf(entry);
          return (
            <div
              key={entry.generationId}
              className="flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900"
            >
              {/* THE HERO IMAGE, AS THE STUDIO SHOWS IT: the design large, the
                  version stamped top-right, the pipeline top-left. Same card
                  language as the existing RevisionStudioIQ grid, so the library
                  reads as part of the product rather than a table bolted above
                  it. */}
              <button
                type="button"
                onClick={() => onOpen?.(entry.generationId)}
                className="group relative block aspect-video w-full bg-zinc-950"
                title={`Open ${titleOf(entry)}`}
              >
                {entry.thumbnailUrl ? (
                  <img
                    src={entry.thumbnailUrl}
                    alt={titleOf(entry)}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
                  />
                ) : (
                  // Honest, and specific about which of the two reasons it is.
                  <span className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-zinc-600">
                    <ImageOff className="h-6 w-6" />
                    <span className="px-3 text-center text-[10px] leading-tight">
                      {entry.viewsSuperseded
                        ? "Proofs withheld — superseded architecture"
                        : state === "failed"
                          ? "This design produced no image"
                          : "Still rendering"}
                    </span>
                  </span>
                )}
                {/* The pipeline badge is deliberately absent (owner,
                    2026-08-26): a customer's past design is a design, not an
                    engine name. The pipeline still filters internally and
                    PanelPro shows the whole lineage. */}
                {/* The version the design stands at, where the studio's own
                    cards put it. A Standard run has no A.T.L.A.S. revision to
                    number, so it carries no badge rather than a fake V1. */}
                {entry.currentRevision ? (
                  <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold text-zinc-100 backdrop-blur">
                    V{entry.currentRevision}
                    {entry.revisionCount > 1 ? ` · ${entry.revisionCount} designs` : ""}
                  </span>
                ) : null}
                <span
                  className={cn(
                    "absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide backdrop-blur",
                    STATUS_TONE[state],
                  )}
                >
                  <StatusIcon status={state} />
                  {STATUS_LABEL[state]}
                </span>
              </button>

              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="truncate font-poppins text-[15px] font-bold text-zinc-100" title={titleOf(entry)}>
                  {titleOf(entry)}
                </p>
                <p className="truncate text-[12px] text-zinc-400" title={subtitleOf(entry)}>
                  {subtitleOf(entry)}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] font-semibold text-zinc-300">
                    DesignProAI™
                  </span>
                  <span
                    className="ml-auto text-[10px] text-zinc-500"
                    title={`${shortDate(entry.createdAt)} · ${entry.createdAt || ""}`}
                  >
                    <Clock className="mr-1 inline h-2.5 w-2.5" />
                    {relativeAge(entry.createdAt)}
                  </span>
                </div>

                {/* The identities a designer quotes on the phone. Small, but
                    never hidden behind a hover: a Design ID you cannot read is
                    a Design ID you cannot give anyone. */}
                {/* No identity facts on the customer card (owner, 2026-08-26):
                    Design ID, generation and order number are the production
                    record, shown in PanelPro Studio. The card is the design. */}

                <div className="mt-auto flex gap-1.5 pt-2.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1 border-cyan-500/40 bg-cyan-500/5 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/10"
                    onClick={() => onOpen?.(entry.generationId)}
                  >
                    Open design
                  </Button>
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="h-8 border-fuchsia-500/40 bg-fuchsia-500/5 text-[11px] font-semibold text-fuchsia-200 hover:bg-fuchsia-500/10"
                  >
                  {/* The PanelPro link left the customer card with the rest
                      of the production identity; staff reach it from the
                      Production jobs cards. */}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
