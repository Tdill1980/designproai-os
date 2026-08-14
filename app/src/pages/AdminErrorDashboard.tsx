/**
 * AdminErrorDashboard — /admin/errors
 *
 * Real-user error dashboard backed by the `error_events` table (populated by
 * src/lib/errorCapture.ts). Errors are grouped server-side by fingerprint, so
 * one row = one distinct bug with an occurrence count.
 *
 * Triage actions update `status` (acknowledged / resolved / ignored). The
 * "Fix with Claude" button invokes the `error-fix-dispatch` edge function,
 * which opens a labelled GitHub issue that the claude-autofix workflow turns
 * into a pull request.
 *
 * Internal admin tooling → dark theme (exempt from the white-UI standard).
 */

import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import {
  ArrowLeft,
  RefreshCw,
  Search,
  Loader2,
  Bug,
  AlertTriangle,
  Wrench,
  ExternalLink,
  CheckCircle2,
  EyeOff,
  Clock,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ── Types ──────────────────────────────────────────────────────────────────
interface ErrorEvent {
  id: string;
  fingerprint: string;
  message: string;
  error_name: string | null;
  stack: string | null;
  component_stack: string | null;
  source: string;
  severity: string;
  url: string | null;
  route: string | null;
  user_id: string | null;
  user_email: string | null;
  user_agent: string | null;
  app_version: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  fix_status: string | null;
  fix_issue_number: number | null;
  fix_issue_url: string | null;
  fix_pr_url: string | null;
  fix_dispatched_at: string | null;
  fix_error: string | null;
}

type StatusFilter = "open" | "resolved" | "ignored" | "all";

const SEVERITY_STYLES: Record<string, string> = {
  fatal: "bg-red-500/15 text-red-400 border-red-500/30",
  error: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  warning: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  info: "bg-sky-500/15 text-sky-400 border-sky-500/30",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-red-500/15 text-red-400 border-red-500/30",
  acknowledged: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  resolved: "bg-green-500/15 text-green-400 border-green-500/30",
  ignored: "bg-neutral-600/30 text-neutral-400 border-neutral-600/40",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return "—";
  }
}

export default function AdminErrorDashboard() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ErrorEvent | null>(null);

  const { data: rows = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["error_events", statusFilter, severityFilter],
    queryFn: async (): Promise<ErrorEvent[]> => {
      // `error_events` isn't in the auto-generated types.ts yet — cast to bypass.
      let q = (supabase.from("error_events" as never) as any)
        .select("*")
        .order("last_seen_at", { ascending: false })
        .limit(500);

      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      if (severityFilter !== "all") q = q.eq("severity", severityFilter);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as ErrorEvent[];
    },
    refetchInterval: 60_000, // refresh once a minute while the page is open
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.message?.toLowerCase().includes(s) ||
        r.error_name?.toLowerCase().includes(s) ||
        r.route?.toLowerCase().includes(s) ||
        r.user_email?.toLowerCase().includes(s),
    );
  }, [rows, search]);

  const stats = useMemo(() => {
    const open = rows.filter((r) => r.status === "open").length;
    const fatal = rows.filter((r) => r.severity === "fatal" && r.status !== "ignored").length;
    const inFix = rows.filter((r) => r.fix_status && r.fix_status !== "failed").length;
    const last24h = rows.filter(
      (r) => Date.now() - new Date(r.last_seen_at).getTime() < 86_400_000,
    ).length;
    return { open, fatal, inFix, last24h };
  }, [rows]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await (supabase.from("error_events" as never) as any)
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      toast.success(`Marked ${vars.status}`);
      queryClient.invalidateQueries({ queryKey: ["error_events"] });
      setSelected((prev) => (prev && prev.id === vars.id ? { ...prev, status: vars.status } : prev));
    },
    onError: (e: Error) => toast.error(`Update failed: ${e.message}`),
  });

  const fixWithClaude = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("error-fix-dispatch", {
        body: { errorId: id },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      return data as { issue_url?: string; issue_number?: number };
    },
    onSuccess: (data, id) => {
      toast.success(
        data?.issue_number
          ? `Dispatched to Claude — issue #${data.issue_number} opened`
          : "Dispatched to Claude",
      );
      queryClient.invalidateQueries({ queryKey: ["error_events"] });
      setSelected((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              fix_status: "dispatched",
              fix_issue_url: data?.issue_url ?? prev.fix_issue_url,
              fix_issue_number: data?.issue_number ?? prev.fix_issue_number,
            }
          : prev,
      );
    },
    onError: (e: Error) => toast.error(`Fix dispatch failed: ${e.message}`),
  });

  const fetching = isLoading || isFetching;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <Helmet>
        <title>Error Dashboard — Admin</title>
      </Helmet>

      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-neutral-400 hover:text-neutral-100">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                <Bug className="h-6 w-6 text-red-400" /> Error Dashboard
              </h1>
              <p className="text-sm text-neutral-500">
                Real-user errors captured from the app, grouped by fingerprint.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={fetching}
            className="border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Stat cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Open" value={stats.open} icon={<AlertTriangle className="h-4 w-4 text-red-400" />} />
          <StatCard label="Seen in 24h" value={stats.last24h} icon={<Clock className="h-4 w-4 text-sky-400" />} />
          <StatCard label="Fatal" value={stats.fatal} icon={<Bug className="h-4 w-4 text-orange-400" />} />
          <StatCard label="In fix pipeline" value={stats.inFix} icon={<Wrench className="h-4 w-4 text-violet-400" />} />
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <TabsList className="bg-neutral-900">
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
              <TabsTrigger value="ignored">Ignored</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>

          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-[150px] border-neutral-700 bg-neutral-900">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="fatal">Fatal</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
            <Input
              placeholder="Search message, route, user…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-neutral-700 bg-neutral-900 pl-9"
            />
          </div>
        </div>

        {/* List */}
        <Card className="border-neutral-800 bg-neutral-900/50 p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-neutral-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading errors…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-20 text-neutral-500">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <p>No errors match this filter. 🎉</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-800">
              {filtered.map((row) => (
                <button
                  key={row.id}
                  onClick={() => setSelected(row)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-800/40"
                >
                  <Badge variant="outline" className={`shrink-0 ${SEVERITY_STYLES[row.severity] ?? ""}`}>
                    {row.severity}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-neutral-100">
                      {row.error_name ? `${row.error_name}: ` : ""}
                      {row.message}
                    </p>
                    <p className="truncate text-xs text-neutral-500">
                      {row.route ?? row.url ?? "—"} · {row.source} · {timeAgo(row.last_seen_at)}
                    </p>
                  </div>
                  {row.fix_status && (
                    <Badge variant="outline" className="shrink-0 border-violet-500/30 bg-violet-500/15 text-violet-300">
                      <Wrench className="mr-1 h-3 w-3" />
                      {row.fix_status}
                    </Badge>
                  )}
                  <Badge variant="outline" className={`shrink-0 ${STATUS_STYLES[row.status] ?? ""}`}>
                    {row.status}
                  </Badge>
                  <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-neutral-300">
                    ×{row.occurrence_count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Detail dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto border-neutral-800 bg-neutral-950 text-neutral-100">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-start gap-2 pr-6 text-left">
                  <Badge variant="outline" className={SEVERITY_STYLES[selected.severity] ?? ""}>
                    {selected.severity}
                  </Badge>
                  <span className="break-words">
                    {selected.error_name ? `${selected.error_name}: ` : ""}
                    {selected.message}
                  </span>
                </DialogTitle>
              </DialogHeader>

              {/* Meta grid */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-3">
                <Meta label="Status" value={selected.status} />
                <Meta label="Occurrences" value={`×${selected.occurrence_count}`} />
                <Meta label="Source" value={selected.source} />
                <Meta label="First seen" value={timeAgo(selected.first_seen_at)} />
                <Meta label="Last seen" value={timeAgo(selected.last_seen_at)} />
                <Meta label="App version" value={selected.app_version ?? "—"} />
                <Meta label="Route" value={selected.route ?? "—"} />
                <Meta label="User" value={selected.user_email ?? (selected.user_id ? "authed" : "anon")} />
                <Meta label="Fingerprint" value={selected.fingerprint} mono />
              </div>

              {selected.url && (
                <div className="text-xs text-neutral-400">
                  <span className="text-neutral-500">URL: </span>
                  <span className="break-all">{selected.url}</span>
                </div>
              )}

              {/* Stack */}
              {selected.stack && (
                <Section title="Stack trace">
                  <pre className="max-h-64 overflow-auto rounded-lg bg-black/60 p-3 text-xs text-neutral-300">
                    {selected.stack}
                  </pre>
                </Section>
              )}
              {selected.component_stack && (
                <Section title="React component stack">
                  <pre className="max-h-48 overflow-auto rounded-lg bg-black/60 p-3 text-xs text-neutral-300">
                    {selected.component_stack}
                  </pre>
                </Section>
              )}
              {selected.user_agent && (
                <Section title="User agent">
                  <p className="break-all text-xs text-neutral-400">{selected.user_agent}</p>
                </Section>
              )}
              {selected.metadata && Object.keys(selected.metadata).length > 0 && (
                <Section title="Metadata">
                  <pre className="overflow-auto rounded-lg bg-black/60 p-3 text-xs text-neutral-300">
                    {JSON.stringify(selected.metadata, null, 2)}
                  </pre>
                </Section>
              )}

              {/* Fix pipeline status */}
              {(selected.fix_status || selected.fix_issue_url || selected.fix_pr_url) && (
                <div className="rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 text-sm">
                  <p className="mb-1 flex items-center gap-2 font-semibold text-violet-300">
                    <Wrench className="h-4 w-4" /> Claude fix pipeline
                  </p>
                  <p className="text-neutral-300">Status: {selected.fix_status ?? "—"}</p>
                  {selected.fix_issue_url && (
                    <a href={selected.fix_issue_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-400 hover:underline">
                      GitHub issue #{selected.fix_issue_number} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {selected.fix_pr_url && (
                    <a href={selected.fix_pr_url} target="_blank" rel="noreferrer" className="block inline-flex items-center gap-1 text-sky-400 hover:underline">
                      Pull request <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {selected.fix_error && <p className="text-red-400">Error: {selected.fix_error}</p>}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 border-t border-neutral-800 pt-4">
                <Button
                  onClick={() => fixWithClaude.mutate(selected.id)}
                  disabled={fixWithClaude.isPending || (!!selected.fix_status && selected.fix_status !== "failed")}
                  className="bg-violet-600 hover:bg-violet-500"
                >
                  {fixWithClaude.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wrench className="mr-2 h-4 w-4" />
                  )}
                  {selected.fix_status && selected.fix_status !== "failed" ? "Dispatched" : "Fix with Claude"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStatus.mutate({ id: selected.id, status: "acknowledged" })}
                  disabled={setStatus.isPending}
                  className="border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                >
                  Acknowledge
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStatus.mutate({ id: selected.id, status: "resolved" })}
                  disabled={setStatus.isPending}
                  className="border-green-700/50 bg-neutral-900 text-green-400 hover:bg-green-900/20"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Resolve
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setStatus.mutate({ id: selected.id, status: "ignored" })}
                  disabled={setStatus.isPending}
                  className="border-neutral-700 bg-neutral-900 text-neutral-400 hover:bg-neutral-800"
                >
                  <EyeOff className="mr-2 h-4 w-4" /> Ignore
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card className="border-neutral-800 bg-neutral-900/50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-neutral-500">{label}</span>
        {icon}
      </div>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </Card>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`truncate text-neutral-200 ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
      {children}
    </div>
  );
}
