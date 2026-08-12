/**
 * EngineRoomUrgentReportsCard — surfaces the newest / highest-severity bug
 * reports filed from anywhere in the app (users + team) right on the
 * EngineRoom hub. Trish, Jackson, or Carley can read them at a glance and
 * hit "Copy for Claude" to drop a ready-to-paste ticket into Claude Code.
 *
 * White UI: white surface, dark text, magenta accent (no orange).
 * Data: public.engineroom_reports (cast through `as any` — types.ts is
 * auto-generated and does not yet include this table).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bug, Copy, Loader2, RefreshCw, ArrowRight } from "lucide-react";
import { toast } from "sonner";

type Severity = "blocker" | "high" | "medium" | "low";

interface Report {
  id: string;
  created_at: string;
  reporter_email: string;
  category: string;
  severity: Severity;
  description: string;
  page_url: string | null;
  page_title: string | null;
  user_agent: string | null;
  console_errors: any;
  screenshot_url: string | null;
  status: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { blocker: 0, high: 1, medium: 2, low: 3 };

// White-UI severity chips — magenta replaces the old orange "high".
const SEVERITY_COLOR: Record<Severity, string> = {
  blocker: "bg-red-50 text-red-700 border-red-200",
  high: "bg-pink-50 text-pink-700 border-pink-200",
  medium: "bg-yellow-50 text-yellow-800 border-yellow-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
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

export default function EngineRoomUrgentReportsCard() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  // Team-only: never surface other users' reports to a customer, even if this
  // card is dropped onto a non-admin page. null = still checking.
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (isAllowlistedAdmin(user?.email)) { setAllowed(true); return; }
      if (!user) { setAllowed(false); return; }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "tester"]);
      if (!cancelled) setAllowed(!!(roles && roles.length > 0));
    })();
    return () => { cancelled = true; };
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("engineroom_reports" as any)
        .select("*")
        .in("status", ["new", "triaged", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      setReports((data || []) as any as Report[]);
    } catch (err: any) {
      toast.error(err.message || "Failed to load bug reports");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (allowed) load(); }, [allowed]);

  // Most urgent first (severity, then newest), capped to keep the card tight.
  const urgent = useMemo(() => {
    return [...reports]
      .sort((a, b) => {
        const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (sev !== 0) return sev;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .slice(0, 6);
  }, [reports]);

  const openCount = reports.length;

  const copyTicket = async (r: Report) => {
    try {
      await navigator.clipboard.writeText(formatClaudeTicket(r));
      toast.success("Claude Code ticket copied — paste it into Claude");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  // Hidden for non-team viewers (and while the privilege check is pending).
  if (!allowed) return null;

  return (
    <div className="rounded-xl border border-pink-200 bg-white shadow-sm overflow-hidden mb-6">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-pink-50">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-pink-500 text-white shrink-0">
            <Bug className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-bold text-gray-900 flex items-center gap-2">
              Urgent Bug Reports
              {openCount > 0 && (
                <Badge variant="outline" className="bg-pink-50 text-pink-700 border-pink-200">
                  {openCount} open
                </Badge>
              )}
            </div>
            <div className="text-[11px] text-gray-500">
              Live reports from users &amp; team — copy any one straight into Claude
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-8">
            {loading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <RefreshCw className="w-3.5 h-3.5" />}
          </Button>
          <Link to="/admin/engineroom-reports">
            <Button variant="ghost" size="sm" className="h-8 text-pink-700 hover:text-pink-800 hover:bg-pink-50">
              All <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-400 text-sm">
          <Loader2 className="w-5 h-5 mx-auto mb-2 animate-spin" />
          Loading reports…
        </div>
      ) : urgent.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm">
          No open bug reports right now. 🎉
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {urgent.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
              <Badge variant="outline" className={`${SEVERITY_COLOR[r.severity]} shrink-0`}>
                {r.severity}
              </Badge>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{r.category}</span>
                  <span className="text-[11px] text-gray-400">·</span>
                  <span className="text-[11px] text-gray-500 truncate">{r.reporter_email}</span>
                  <span className="text-[11px] text-gray-400">·</span>
                  <span className="text-[11px] text-gray-400">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-gray-800 leading-snug line-clamp-2 whitespace-pre-wrap">{r.description}</p>
                {r.page_url && (
                  <div className="text-[10px] text-gray-400 mt-0.5 truncate">{r.page_url}</div>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyTicket(r)}
                className="shrink-0 h-8 border-pink-200 text-pink-700 hover:bg-pink-50 hover:text-pink-800"
              >
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                Copy
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
