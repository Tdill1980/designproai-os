import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  Send,
  CheckCircle2,
  Zap,
  ExternalLink,
} from "lucide-react";

interface AnalysisRow {
  url: string;
  topQuery: string | null;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  currentTitle: string | null;
  currentMeta: string | null;
  suggestedTitle: string | null;
  suggestedMeta: string | null;
  rationale: string | null;
  error?: string;
}

type ApplyState = "idle" | "applying" | "applied" | "error";

interface RowState {
  apply: ApplyState;
  applyError?: string;
  // local edits before pushing to WP
  editedTitle: string;
  editedMeta: string;
}

export default function AdminSeoCtrSweep() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();

  const [days, setDays] = useState(28);
  const [posMin, setPosMin] = useState(5);
  const [posMax, setPosMax] = useState(20);
  const [minImpr, setMinImpr] = useState(50);
  const [limit, setLimit] = useState(50);

  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const analyze = useMutation({
    mutationFn: async (): Promise<AnalysisRow[]> => {
      if (!currentShop) throw new Error("No shop");
      const { data, error } = await supabase.functions.invoke("seo-ctr-sweep", {
        body: {
          action: "analyze",
          shop_id: currentShop.id,
          days,
          position_min: posMin,
          position_max: posMax,
          min_impressions: minImpr,
          limit,
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      return (data as { results: AnalysisRow[] }).results ?? [];
    },
    onSuccess: (results) => {
      setRows(results);
      const next: Record<string, RowState> = {};
      for (const r of results) {
        next[r.url] = {
          apply: "idle",
          editedTitle: r.suggestedTitle ?? "",
          editedMeta: r.suggestedMeta ?? "",
        };
      }
      setRowState(next);
      toast({
        title: `${results.length} CTR opportunities`,
        description: results.length
          ? "Review the suggestions and Apply to push live."
          : "No pages matched the position/impression filters.",
      });
    },
    onError: (e: Error) =>
      toast({ title: "Analyze failed", description: e.message, variant: "destructive" }),
  });

  const applyOne = async (row: AnalysisRow) => {
    if (!currentShop) return;
    const state = rowState[row.url];
    if (!state) return;
    setRowState((p) => ({ ...p, [row.url]: { ...state, apply: "applying", applyError: undefined } }));
    try {
      const { data, error } = await supabase.functions.invoke("seo-ctr-sweep", {
        body: {
          action: "apply",
          shop_id: currentShop.id,
          url: row.url,
          title: state.editedTitle.trim(),
          meta_description: state.editedMeta.trim(),
        },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
      setRowState((p) => ({ ...p, [row.url]: { ...state, apply: "applied" } }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRowState((p) => ({ ...p, [row.url]: { ...state, apply: "error", applyError: msg } }));
    }
  };

  const applyAll = useMutation({
    mutationFn: async () => {
      const targets = rows.filter((r) => {
        const s = rowState[r.url];
        return s && s.apply !== "applied" && s.editedTitle && s.editedMeta;
      });
      setBulkProgress({ done: 0, total: targets.length });
      for (let i = 0; i < targets.length; i++) {
        await applyOne(targets[i]);
        setBulkProgress({ done: i + 1, total: targets.length });
      }
    },
    onSuccess: () => {
      toast({ title: "Bulk apply complete" });
      setTimeout(() => setBulkProgress(null), 1500);
    },
    onError: (e: Error) => {
      toast({ title: "Bulk apply failed", description: e.message, variant: "destructive" });
      setBulkProgress(null);
    },
  });

  const expectedCtrLift = useMemo(() => {
    // Rough heuristic: if the average row sits at position ~10 with X impressions,
    // a CTR lift from baseline (~2%) toward (~5%) yields ~3% × impressions extra clicks.
    const total = rows.reduce((sum, r) => sum + r.impressions, 0);
    return Math.round(total * 0.03);
  }, [rows]);

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 p-8">
        <p>Select a shop to run a CTR sweep.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <Zap className="h-6 w-6 text-cyan-400" /> CTR sweep
              </h1>
              <p className="text-zinc-400 text-sm mt-1">
                Find pages that are ranking but not getting clicked, rewrite their
                title + meta description with Claude, and push the change live to
                WordPress in one click.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => applyAll.mutate()}
              disabled={
                rows.length === 0 ||
                applyAll.isPending ||
                rows.every((r) => rowState[r.url]?.apply === "applied")
              }
            >
              {applyAll.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-1" />
              )}
              Apply all to WordPress
            </Button>
          </div>
        </div>

        <Card className="bg-zinc-950 border-zinc-800 p-4 space-y-3">
          <div className="text-xs uppercase tracking-wide text-zinc-500">
            Targeting
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <Label className="text-[11px]">Window (days)</Label>
              <Input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-[11px]">Position min</Label>
              <Input type="number" value={posMin} onChange={(e) => setPosMin(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-[11px]">Position max</Label>
              <Input type="number" value={posMax} onChange={(e) => setPosMax(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-[11px]">Min impressions</Label>
              <Input type="number" value={minImpr} onChange={(e) => setMinImpr(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-[11px]">Limit</Label>
              <Input type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-zinc-500">
              Pulls Search Console "almost ranking" pages, fetches each live URL
              for its current title + meta, then asks Claude for CTR-optimized
              rewrites. Suggestions cache to <code>seo_pages</code> so the
              "Apply suggestion" buttons in <Link to="/admin/seo/pages" className="text-cyan-400 hover:underline">/admin/seo/pages</Link> stay in sync.
            </p>
            <Button onClick={() => analyze.mutate()} disabled={analyze.isPending}>
              {analyze.isPending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              Analyze
            </Button>
          </div>
        </Card>

        {bulkProgress && (
          <Card className="bg-zinc-950 border-zinc-800 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>
                Pushing to WordPress {bulkProgress.done}/{bulkProgress.total}
              </span>
              <span>
                {Math.round((bulkProgress.done / Math.max(bulkProgress.total, 1)) * 100)}%
              </span>
            </div>
            <Progress
              value={(bulkProgress.done / Math.max(bulkProgress.total, 1)) * 100}
              className="h-2"
            />
          </Card>
        )}

        {rows.length > 0 && (
          <Card className="bg-zinc-950 border-zinc-800 p-3 flex flex-wrap items-center gap-4 text-xs">
            <span>
              <span className="text-zinc-500">Pages: </span>
              <span className="font-semibold text-cyan-400">{rows.length}</span>
            </span>
            <span>
              <span className="text-zinc-500">Total impressions ({days}d): </span>
              <span className="font-semibold">{rows.reduce((s, r) => s + r.impressions, 0).toLocaleString()}</span>
            </span>
            <span>
              <span className="text-zinc-500">Est. extra clicks at +3% CTR: </span>
              <span className="font-semibold text-emerald-400">{expectedCtrLift.toLocaleString()}</span>
            </span>
          </Card>
        )}

        <Card className="bg-zinc-950 border-zinc-800">
          {rows.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 text-sm">
              {analyze.isPending
                ? "Analyzing — this can take a minute or two for 50 pages."
                : "Click Analyze to find ranking pages with low CTR."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400 w-[260px]">Page</TableHead>
                  <TableHead className="text-zinc-400 w-16 text-right">Pos.</TableHead>
                  <TableHead className="text-zinc-400 w-20 text-right">Impr.</TableHead>
                  <TableHead className="text-zinc-400 w-16 text-right">CTR</TableHead>
                  <TableHead className="text-zinc-400">Suggested rewrite</TableHead>
                  <TableHead className="text-zinc-400 w-32 text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const s = rowState[r.url];
                  return (
                    <TableRow key={r.url} className="border-zinc-800 align-top">
                      <TableCell>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-mono text-zinc-300 hover:text-cyan-400 inline-flex items-center gap-1"
                        >
                          <span className="truncate block max-w-[240px]">{r.url}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        {r.topQuery && (
                          <div className="text-[10px] text-zinc-500 mt-1">
                            top query: <span className="text-zinc-300">{r.topQuery}</span>
                          </div>
                        )}
                        {r.currentTitle && (
                          <div className="text-[10px] text-zinc-500 mt-2 line-clamp-2">
                            <span className="uppercase">Current:</span> {r.currentTitle}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className={positionColor(r.position)}>{r.position.toFixed(1)}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.impressions.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums text-zinc-400">
                        {(r.ctr * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell>
                        {r.error ? (
                          <div className="text-red-400 text-xs">{r.error}</div>
                        ) : !r.suggestedTitle ? (
                          <div className="text-zinc-500 text-xs italic">No suggestion</div>
                        ) : s ? (
                          <div className="space-y-2">
                            <div>
                              <div className="text-[10px] uppercase text-zinc-500 mb-0.5">
                                Title <span className="text-zinc-600">({s.editedTitle.length}/60)</span>
                              </div>
                              <Input
                                value={s.editedTitle}
                                onChange={(e) =>
                                  setRowState((p) => ({
                                    ...p,
                                    [r.url]: { ...s, editedTitle: e.target.value, apply: "idle" },
                                  }))
                                }
                                className="h-8 text-xs"
                              />
                            </div>
                            <div>
                              <div className="text-[10px] uppercase text-zinc-500 mb-0.5">
                                Meta <span className="text-zinc-600">({s.editedMeta.length}/160)</span>
                              </div>
                              <Input
                                value={s.editedMeta}
                                onChange={(e) =>
                                  setRowState((p) => ({
                                    ...p,
                                    [r.url]: { ...s, editedMeta: e.target.value, apply: "idle" },
                                  }))
                                }
                                className="h-8 text-xs"
                              />
                            </div>
                            {r.rationale && (
                              <p className="text-[10px] text-zinc-500 italic">{r.rationale}</p>
                            )}
                            {s.applyError && (
                              <p className="text-[10px] text-red-400">{s.applyError}</p>
                            )}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        {!s ? null : s.apply === "applied" ? (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600 text-[10px]">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Live
                          </Badge>
                        ) : s.apply === "error" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyOne(r)}
                            className="text-[11px]"
                          >
                            Retry
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyOne(r)}
                            disabled={
                              s.apply === "applying" ||
                              !s.editedTitle.trim() ||
                              !s.editedMeta.trim()
                            }
                            className="text-[11px]"
                          >
                            {s.apply === "applying" ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <Send className="h-3 w-3 mr-1" />
                            )}
                            Apply
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

function positionColor(pos: number): string {
  if (pos <= 3) return "text-emerald-400 font-semibold";
  if (pos <= 10) return "text-cyan-400";
  if (pos <= 20) return "text-amber-400";
  return "text-zinc-400";
}
