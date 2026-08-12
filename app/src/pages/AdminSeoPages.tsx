import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  ExternalLink,
  Sparkles,
  CheckCircle2,
} from "lucide-react";

interface PageRow {
  id: string;
  url: string;
  page_type: string;
  current_title: string | null;
  current_meta_description: string | null;
  ai_suggested_title: string | null;
  ai_suggested_meta_description: string | null;
  ai_suggested_at: string | null;
  last_score: number | null;
  last_audited_at: string | null;
}

interface AuditRow {
  id: string;
  url: string;
  score: number | null;
  ran_at: string;
  findings: unknown;
}

export default function AdminSeoPages() {
  const { currentShop } = useOrganization();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [auditingId, setAuditingId] = useState<string | null>(null);

  const pages = useQuery({
    queryKey: ["seo-pages", currentShop?.id],
    enabled: !!currentShop?.id,
    queryFn: async (): Promise<PageRow[]> => {
      if (!currentShop) return [];
      const { data, error } = await supabase
        .from("seo_pages")
        .select(
          "id, url, page_type, current_title, current_meta_description, ai_suggested_title, ai_suggested_meta_description, ai_suggested_at, last_score, last_audited_at",
        )
        .eq("shop_id", currentShop.id)
        .eq("is_active", true)
        .order("last_audited_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as PageRow[];
    },
  });

  const runAudit = async (page: PageRow) => {
    if (!currentShop) return;
    setAuditingId(page.id);
    try {
      const { data, error } = await supabase.functions.invoke("seo-page-audit", {
        body: { shop_id: currentShop.id, url: page.url, persist: true },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) {
        throw new Error((data as { error: string }).error);
      }
    } finally {
      setAuditingId(null);
    }
  };

  const reAuditOne = useMutation({
    mutationFn: async (page: PageRow) => {
      await runAudit(page);
    },
    onSuccess: () => {
      toast({ title: "Audit complete" });
      qc.invalidateQueries({ queryKey: ["seo-pages", currentShop?.id] });
    },
    onError: (e: Error) =>
      toast({ title: "Audit failed", description: e.message, variant: "destructive" }),
  });

  const reAuditAll = useMutation({
    mutationFn: async () => {
      const list = pages.data ?? [];
      setBulkProgress({ done: 0, total: list.length });
      for (let i = 0; i < list.length; i++) {
        try {
          await runAudit(list[i]);
        } catch (e) {
          console.warn("[seo-pages] audit failed for", list[i].url, e);
        }
        setBulkProgress({ done: i + 1, total: list.length });
      }
    },
    onSuccess: () => {
      toast({ title: "Bulk audit complete" });
      qc.invalidateQueries({ queryKey: ["seo-pages", currentShop?.id] });
      setTimeout(() => setBulkProgress(null), 1500);
    },
    onError: (e: Error) => {
      toast({ title: "Bulk audit failed", description: e.message, variant: "destructive" });
      setBulkProgress(null);
    },
  });

  if (!currentShop) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 p-8">
        <p>Select a shop to view tracked pages.</p>
      </div>
    );
  }

  const rows = pages.data ?? [];
  const openPage = rows.find((r) => r.id === openId) ?? null;

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin/seo">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-semibold">Pages</h1>
              <p className="text-zinc-400 text-sm mt-1">
                Tracked URLs for this shop. Re-audit to refresh score, then click
                a row to review history and apply AI title/meta suggestions.
              </p>
            </div>
          </div>
          <Button
            onClick={() => reAuditAll.mutate()}
            disabled={reAuditAll.isPending || rows.length === 0}
          >
            {reAuditAll.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            Re-audit all
          </Button>
        </div>

        {bulkProgress && (
          <Card className="bg-zinc-950 border-zinc-800 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>
                Auditing {bulkProgress.done}/{bulkProgress.total}
              </span>
              <span>{Math.round((bulkProgress.done / Math.max(bulkProgress.total, 1)) * 100)}%</span>
            </div>
            <Progress
              value={(bulkProgress.done / Math.max(bulkProgress.total, 1)) * 100}
              className="h-2"
            />
          </Card>
        )}

        <Card className="bg-zinc-950 border-zinc-800">
          {pages.isLoading ? (
            <div className="p-12 text-center text-zinc-500">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center text-zinc-500 text-sm">
              No tracked pages yet. Run an audit from the{" "}
              <Link to="/admin/seo" className="text-cyan-400 hover:underline">
                SEO dashboard
              </Link>{" "}
              quick-audit panel — successful audits seed this list.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-zinc-800 hover:bg-transparent">
                  <TableHead className="text-zinc-400">URL</TableHead>
                  <TableHead className="text-zinc-400 w-28">Type</TableHead>
                  <TableHead className="text-zinc-400 w-20 text-right">Score</TableHead>
                  <TableHead className="text-zinc-400 w-32">Last audit</TableHead>
                  <TableHead className="text-zinc-400 w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => (
                  <TableRow
                    key={p.id}
                    className="border-zinc-800 cursor-pointer hover:bg-zinc-900/50"
                    onClick={() => setOpenId(p.id)}
                  >
                    <TableCell className="max-w-[420px]">
                      <div className="font-mono text-xs truncate flex items-center gap-1">
                        {p.url}
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-zinc-500 hover:text-cyan-400 shrink-0"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      {p.current_title && (
                        <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                          {p.current_title}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {p.page_type.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <ScorePill score={p.last_score} />
                    </TableCell>
                    <TableCell className="text-[11px] text-zinc-400 tabular-nums">
                      {p.last_audited_at
                        ? new Date(p.last_audited_at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          reAuditOne.mutate(p);
                        }}
                        disabled={auditingId === p.id || reAuditOne.isPending}
                      >
                        {auditingId === p.id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                        )}
                        Re-audit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <PageDrawer
        page={openPage}
        open={!!openPage}
        onOpenChange={(o) => !o && setOpenId(null)}
        shopId={currentShop.id}
      />
    </div>
  );
}

function ScorePill({ score }: { score: number | null }) {
  if (score === null) return <span className="text-xs text-zinc-500">—</span>;
  const cls =
    score >= 80
      ? "text-emerald-400"
      : score >= 60
      ? "text-amber-400"
      : "text-red-400";
  return <span className={`text-lg font-semibold ${cls}`}>{score}</span>;
}

interface DrawerProps {
  page: PageRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
}

function PageDrawer({ page, open, onOpenChange, shopId }: DrawerProps) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const history = useQuery({
    queryKey: ["seo-page-history", page?.id],
    enabled: open && !!page?.id,
    queryFn: async (): Promise<AuditRow[]> => {
      if (!page) return [];
      const { data, error } = await supabase
        .from("seo_audit_runs")
        .select("id, url, score, ran_at, findings")
        .eq("page_id", page.id)
        .order("ran_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as AuditRow[];
    },
  });

  const applyTitle = useMutation({
    mutationFn: async () => {
      if (!page?.ai_suggested_title) throw new Error("No suggestion");
      const { error } = await supabase
        .from("seo_pages")
        .update({ current_title: page.ai_suggested_title })
        .eq("id", page.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Title applied" });
      qc.invalidateQueries({ queryKey: ["seo-pages", shopId] });
    },
    onError: (e: Error) =>
      toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  const applyMeta = useMutation({
    mutationFn: async () => {
      if (!page?.ai_suggested_meta_description) throw new Error("No suggestion");
      const { error } = await supabase
        .from("seo_pages")
        .update({ current_meta_description: page.ai_suggested_meta_description })
        .eq("id", page.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Meta description applied" });
      qc.invalidateQueries({ queryKey: ["seo-pages", shopId] });
    },
    onError: (e: Error) =>
      toast({ title: "Apply failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-2xl bg-zinc-950 border-zinc-800 text-zinc-100 overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle className="text-zinc-100 break-all text-base">
            {page?.url}
          </SheetTitle>
        </SheetHeader>
        {!page ? null : (
          <div className="mt-6 space-y-6">
            <Card className="bg-zinc-900/50 border-zinc-800 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
                Current
              </div>
              <div className="space-y-2 text-sm">
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Title</div>
                  <div className="text-zinc-200">{page.current_title || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Meta description</div>
                  <div className="text-zinc-200 whitespace-pre-wrap">
                    {page.current_meta_description || "—"}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wide text-zinc-500 flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-400" /> AI suggestions
                </div>
                {page.ai_suggested_at && (
                  <div className="text-[10px] text-zinc-500">
                    {new Date(page.ai_suggested_at).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Title</div>
                  <div className="text-zinc-200">{page.ai_suggested_title || "—"}</div>
                  {page.ai_suggested_title && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => applyTitle.mutate()}
                      disabled={applyTitle.isPending}
                    >
                      {applyTitle.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      )}
                      Apply title
                    </Button>
                  )}
                </div>
                <div>
                  <div className="text-[10px] uppercase text-zinc-500">Meta description</div>
                  <div className="text-zinc-200 whitespace-pre-wrap">
                    {page.ai_suggested_meta_description || "—"}
                  </div>
                  {page.ai_suggested_meta_description && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => applyMeta.mutate()}
                      disabled={applyMeta.isPending}
                    >
                      {applyMeta.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      )}
                      Apply meta
                    </Button>
                  )}
                </div>
                {!page.ai_suggested_title && !page.ai_suggested_meta_description && (
                  <p className="text-[11px] text-zinc-500">
                    No AI suggestions cached yet for this page.
                  </p>
                )}
              </div>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800 p-4">
              <div className="text-xs uppercase tracking-wide text-zinc-500 mb-3">
                Audit history
              </div>
              {history.isLoading ? (
                <div className="text-zinc-500 text-sm">Loading…</div>
              ) : (history.data ?? []).length === 0 ? (
                <div className="text-zinc-500 text-sm">No runs yet.</div>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {(history.data ?? []).map((r) => (
                    <li
                      key={r.id}
                      className="py-2 flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="text-zinc-400 text-xs tabular-nums">
                        {new Date(r.ran_at).toLocaleString()}
                      </span>
                      <ScorePill score={r.score} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
