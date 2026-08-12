/**
 * AdminEngineRoomReports — team-wide bug + feature queue.
 *
 * Everyone with admin access sees the same queue. Filter by status,
 * severity, or category. Click a row to see full detail (description,
 * screenshot, console errors, page context). Status can be advanced by
 * any admin. The "Copy as Claude Code Ticket" button generates a
 * markdown bundle Trish can paste directly into a Claude Code prompt.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Bug, Copy, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";

type Status = "new" | "triaged" | "in_progress" | "fixed" | "wont_fix";
type Severity = "blocker" | "high" | "medium" | "low";
type Category = "bug" | "ui" | "feature" | "workflow" | "other";

interface Report {
  id: string;
  created_at: string;
  updated_at: string;
  reporter_email: string;
  category: Category;
  severity: Severity;
  description: string;
  page_url: string | null;
  page_title: string | null;
  user_agent: string | null;
  console_errors: any;
  screenshot_url: string | null;
  status: Status;
  triaged_by: string | null;
  triaged_at: string | null;
  claude_ticket: string | null;
}

const STATUSES: Status[] = ["new", "triaged", "in_progress", "fixed", "wont_fix"];
const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, high: 1, medium: 2, low: 3 };

const STATUS_COLOR: Record<Status, string> = {
  new: "bg-pink-50 text-pink-700 border-pink-200",
  triaged: "bg-blue-50 text-blue-700 border-blue-200",
  in_progress: "bg-purple-50 text-purple-700 border-purple-200",
  fixed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  wont_fix: "bg-slate-100 text-slate-500 border-slate-200",
};

const SEVERITY_COLOR: Record<Severity, string> = {
  blocker: "bg-red-50 text-red-700 border-red-200",
  high: "bg-pink-50 text-pink-700 border-pink-200",
  medium: "bg-yellow-50 text-yellow-800 border-yellow-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  triaged: "Triaged",
  in_progress: "In Progress",
  fixed: "Fixed",
  wont_fix: "Won't Fix",
};

function formatClaudeTicket(r: Report): string {
  const lines: string[] = [];
  lines.push(`# EngineRoom Report — ${r.id}`);
  lines.push("");
  lines.push(`**Report ID (for status updates):** \`${r.id}\``);
  lines.push(`**Reporter:** ${r.reporter_email}`);
  lines.push(`**Reported:** ${new Date(r.created_at).toLocaleString()}`);
  lines.push(`**Category:** ${r.category}`);
  lines.push(`**Severity:** ${r.severity}`);
  lines.push(`**Current status:** ${r.status}`);
  lines.push(`**Page:** ${r.page_title || "(unknown)"} — ${r.page_url || "(no URL)"}`);
  lines.push("");
  lines.push("## Description");
  lines.push(r.description);
  if (r.screenshot_url) {
    lines.push("");
    lines.push(`**Screenshot:** ${r.screenshot_url}`);
  }
  if (r.console_errors && Array.isArray(r.console_errors) && r.console_errors.length > 0) {
    lines.push("");
    lines.push("## Recent console errors");
    lines.push("```json");
    lines.push(JSON.stringify(r.console_errors, null, 2));
    lines.push("```");
  }
  if (r.user_agent) {
    lines.push("");
    lines.push(`**User agent:** \`${r.user_agent}\``);
  }
  lines.push("");
  lines.push("---");
  lines.push("## When you ship the fix, mark this report fixed");
  lines.push("");
  lines.push("Run this via the Supabase MCP `execute_sql` tool so the team queue self-updates:");
  lines.push("");
  lines.push("```sql");
  lines.push(`UPDATE engineroom_reports`);
  lines.push(`SET status = 'fixed', triaged_at = now()`);
  lines.push(`WHERE id = '${r.id}';`);
  lines.push("```");
  return lines.join("\n");
}

export default function AdminEngineRoomReports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<Category | "all">("all");
  const [selected, setSelected] = useState<Report | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("engineroom_reports" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setReports((data || []) as any as Report[]);
    } catch (err: any) {
      toast.error(err.message || "Failed to load reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return reports
      .filter(r => statusFilter === "all" || r.status === statusFilter)
      .filter(r => severityFilter === "all" || r.severity === severityFilter)
      .filter(r => categoryFilter === "all" || r.category === categoryFilter)
      .sort((a, b) => {
        const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (sev !== 0) return sev;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [reports, statusFilter, severityFilter, categoryFilter]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { new: 0, triaged: 0, in_progress: 0, fixed: 0, wont_fix: 0 };
    for (const r of reports) c[r.status]++;
    return c;
  }, [reports]);

  const updateStatus = async (id: string, status: Status) => {
    setSavingStatus(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("engineroom_reports" as any)
        .update({
          status,
          triaged_by: user?.id || null,
          triaged_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      setReports(prev => prev.map(r => r.id === id ? { ...r, status } : r));
      if (selected?.id === id) setSelected({ ...selected, status });
      toast.success(`Status → ${STATUS_LABEL[status]}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to update status");
    } finally {
      setSavingStatus(false);
    }
  };

  const copyTicket = async (r: Report) => {
    const md = formatClaudeTicket(r);
    try {
      await navigator.clipboard.writeText(md);
      toast.success("Claude Code ticket copied to clipboard");
    } catch {
      toast.error("Could not copy — select and copy manually below");
    }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bug className="w-5 h-5 text-pink-500" />
              <h1 className="text-2xl font-semibold text-gray-900">EngineRoom Reports</h1>
            </div>
            <p className="text-sm text-gray-500">
              Team-wide bug, UI, and feature queue. Visible to everyone. Anyone with admin access can change status.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
            Refresh
          </Button>
        </header>

        {/* Status pill row */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${statusFilter === "all" ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"}`}
          >
            All ({reports.length})
          </button>
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${STATUS_COLOR[s]} ${statusFilter === s ? "ring-2 ring-offset-1 ring-gray-300" : "hover:brightness-95"}`}
            >
              {STATUS_LABEL[s]} ({counts[s]})
            </button>
          ))}
        </div>

        {/* Secondary filters */}
        <div className="flex flex-wrap gap-2">
          <Select value={severityFilter} onValueChange={(v) => setSeverityFilter(v as any)}>
            <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue placeholder="All severities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="blocker">Blocker</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as any)}>
            <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="bug">Bug</SelectItem>
              <SelectItem value="ui">UI / Visual</SelectItem>
              <SelectItem value="feature">Feature Request</SelectItem>
              <SelectItem value="workflow">Workflow</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* List */}
        <Card className="p-0 overflow-hidden bg-white border-gray-200">
          {loading ? (
            <div className="p-12 text-center text-gray-400">
              <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
              Loading reports...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-gray-400 text-sm">
              No reports match these filters. Use the floating "Report" button (bottom-left of any page) to file one.
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filtered.map(r => (
                <li
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col gap-1 shrink-0">
                      <Badge variant="outline" className={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                      <Badge variant="outline" className={SEVERITY_COLOR[r.severity]}>{r.severity}</Badge>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">{r.category}</span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className="text-xs text-gray-500">{r.reporter_email}</span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className="text-xs text-gray-400">{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                      <p className="text-sm leading-snug whitespace-pre-wrap line-clamp-3 text-gray-800">{r.description}</p>
                      {r.page_url && (
                        <div className="text-[10px] text-gray-400 mt-1 truncate">{r.page_url}</div>
                      )}
                    </div>
                    {r.screenshot_url && (
                      <img
                        src={r.screenshot_url}
                        alt="screenshot"
                        className="w-16 h-12 object-cover rounded border border-gray-200 shrink-0"
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Detail drawer */}
        {selected && (
          <div
            className="fixed inset-0 z-50 bg-black/60 flex justify-end"
            onClick={() => setSelected(null)}
          >
            <div
              className="w-full max-w-xl bg-white border-l border-gray-200 h-full overflow-y-auto p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex gap-2 mb-2">
                    <Badge variant="outline" className={STATUS_COLOR[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
                    <Badge variant="outline" className={SEVERITY_COLOR[selected.severity]}>{selected.severity}</Badge>
                    <Badge variant="outline">{selected.category}</Badge>
                  </div>
                  <div className="text-xs text-gray-500">
                    Report <code>{selected.id.slice(0, 8)}</code> · {selected.reporter_email} · {new Date(selected.created_at).toLocaleString()}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => setSelected(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-1">
                <h3 className="text-xs font-semibold uppercase text-gray-400 tracking-wide">Description</h3>
                <p className="text-sm whitespace-pre-wrap text-gray-800">{selected.description}</p>
              </div>

              {selected.screenshot_url && (
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase text-gray-400 tracking-wide">Screenshot</h3>
                  <a href={selected.screenshot_url} target="_blank" rel="noreferrer">
                    <img src={selected.screenshot_url} alt="screenshot" className="w-full rounded border border-gray-200" />
                  </a>
                </div>
              )}

              {selected.page_url && (
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase text-gray-400 tracking-wide">Page</h3>
                  <p className="text-xs text-gray-700">{selected.page_title || "(no title)"}</p>
                  <a href={selected.page_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline break-all">
                    {selected.page_url}
                  </a>
                </div>
              )}

              {selected.console_errors && Array.isArray(selected.console_errors) && selected.console_errors.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase text-gray-400 tracking-wide">Console errors ({selected.console_errors.length})</h3>
                  <pre className="text-[10px] bg-gray-50 border border-gray-200 text-gray-700 rounded p-2 overflow-x-auto max-h-48">{JSON.stringify(selected.console_errors, null, 2)}</pre>
                </div>
              )}

              {selected.user_agent && (
                <div className="space-y-1">
                  <h3 className="text-xs font-semibold uppercase text-gray-400 tracking-wide">User agent</h3>
                  <code className="text-[10px] text-gray-500 break-all">{selected.user_agent}</code>
                </div>
              )}

              <div className="border-t border-gray-200 pt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-gray-700">Status:</Label>
                  <Select
                    value={selected.status}
                    onValueChange={(v) => updateStatus(selected.id, v as Status)}
                    disabled={savingStatus}
                  >
                    <SelectTrigger className="w-[200px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {selected.status !== "fixed" && (
                    <Button
                      onClick={() => updateStatus(selected.id, "fixed")}
                      disabled={savingStatus}
                      className="bg-emerald-500 hover:bg-emerald-400 text-black"
                    >
                      Mark Fixed
                    </Button>
                  )}
                  <Button onClick={() => copyTicket(selected)} className={`bg-gradient-to-r from-blue-500 to-pink-500 text-white border-0 hover:from-blue-600 hover:to-pink-600 ${selected.status !== "fixed" ? "" : "col-span-2"}`}>
                    <Copy className="w-3.5 h-3.5 mr-1.5" />
                    Copy as Claude Code Ticket
                  </Button>
                </div>

                <p className="text-[10px] text-gray-400">
                  Claude Code can also auto-mark this fixed when it ships — the ticket includes a SQL update with this report's ID.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

