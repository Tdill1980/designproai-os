/**
 * ErrorMonitorCard — admin-only error monitor surfaced on the /admin hub.
 *
 * Shows live counts from public.error_events (open / fatal / seen-24h / in
 * Claude fix pipeline) plus the newest open errors, with a link to the full
 * Error Dashboard at /admin/errors.
 *
 * White UI: white surface, dark text, red accent for the error counts.
 * Renders nothing for non-admins. error_events isn't in the auto-generated
 * types.ts, so the query is cast through `as any`.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getActiveUser } from "@/lib/auth-session";
import { useQuery } from "@tanstack/react-query";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import { Button } from "@/components/ui/button";
import { Bug, AlertTriangle, Wrench, Clock, ArrowRight, RefreshCw, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface Row {
  id: string;
  message: string;
  error_name: string | null;
  severity: string;
  status: string;
  route: string | null;
  occurrence_count: number;
  last_seen_at: string;
  fix_status: string | null;
}

export default function ErrorMonitorCard() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    getActiveUser().then(async (user) => {
      if (!user) {
        if (active) setChecked(true);
        return;
      }
      if (isAllowlistedAdmin(user.email)) {
        if (active) { setIsAdmin(true); setChecked(true); }
        return;
      }
      const { data: role } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "tester"])
        .limit(1)
        .maybeSingle();
      if (active) { setIsAdmin(!!role); setChecked(true); }
    });
    return () => { active = false; };
  }, []);

  const { data: rows = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ["error-monitor-card"],
    enabled: isAdmin,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await (supabase.from("error_events" as never) as any)
        .select("id,message,error_name,severity,status,route,occurrence_count,last_seen_at,fix_status")
        .order("last_seen_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const stats = useMemo(() => {
    const open = rows.filter((r) => r.status === "open").length;
    const fatal = rows.filter((r) => r.severity === "fatal" && r.status !== "ignored").length;
    const inFix = rows.filter((r) => r.fix_status && r.fix_status !== "failed").length;
    const last24h = rows.filter((r) => Date.now() - new Date(r.last_seen_at).getTime() < 86_400_000).length;
    return { open, fatal, inFix, last24h };
  }, [rows]);

  const recentOpen = useMemo(
    () => rows.filter((r) => r.status === "open").slice(0, 5),
    [rows],
  );

  if (!checked || !isAdmin) return null;

  return (
    <div className="mb-8 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50">
            <Bug className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900">Error Monitor</h3>
            <p className="text-xs text-gray-500">Live frontend errors captured from the app</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} className="text-gray-500 hover:text-gray-900">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Link to="/admin/errors">
            <Button size="sm" className="bg-gray-900 text-white hover:bg-gray-800">
              Open dashboard <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Open" value={stats.open} icon={<AlertTriangle className="h-4 w-4 text-red-500" />} accent="text-red-600" />
        <Stat label="Seen 24h" value={stats.last24h} icon={<Clock className="h-4 w-4 text-sky-500" />} accent="text-gray-900" />
        <Stat label="Fatal" value={stats.fatal} icon={<Bug className="h-4 w-4 text-orange-500" />} accent="text-orange-600" />
        <Stat label="In fix" value={stats.inFix} icon={<Wrench className="h-4 w-4 text-violet-500" />} accent="text-violet-600" />
      </div>

      {/* Recent open */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6 text-gray-400">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : recentOpen.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">No open errors. 🎉</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {recentOpen.map((r) => (
            <li key={r.id}>
              <Link to="/admin/errors" className="flex items-center gap-3 py-2 hover:opacity-70">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  r.severity === "fatal" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"
                }`}>
                  {r.severity}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                  {r.error_name ? `${r.error_name}: ` : ""}{r.message}
                </span>
                <span className="shrink-0 text-xs text-gray-400">{r.route ?? "—"}</span>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                  ×{r.occurrence_count}
                </span>
                <span className="shrink-0 text-xs text-gray-400">
                  {(() => { try { return formatDistanceToNow(new Date(r.last_seen_at), { addSuffix: true }); } catch { return ""; } })()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value, icon, accent }: { label: string; value: number; icon: React.ReactNode; accent: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
        {icon}
      </div>
      <p className={`mt-1 text-2xl font-bold ${accent}`}>{value}</p>
    </div>
  );
}
