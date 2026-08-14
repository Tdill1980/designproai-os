/**
 * AdminHealth — internal systems health dashboard
 *
 * Session 1: UI shell only. Static placeholder data.
 * No API calls, no real checks, no Slack wiring yet.
 *
 * Future sessions will add:
 *   - per-tool check endpoints (non-destructive)
 *   - Slack alert integration (P1/P2/P3)
 *   - Supabase cron scheduling 4x/day
 *   - Auto-deploy safety fixes (gated, never destructive)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { RequireAuth } from "@/components/RequireAuth";
import { TOOL_GROUPS } from "@/lib/admin-health/tools-config";
import { RUNNERS } from "@/lib/admin-health/runners";
import type { Status, ToolCheck } from "@/lib/admin-health/types";

const STATUS_STYLES: Record<Status, { dot: string; label: string; text: string }> = {
  ok:       { dot: "bg-green-500",   label: "OK",       text: "text-green-400" },
  fail:     { dot: "bg-red-500",     label: "FAIL",     text: "text-red-400" },
  warn:     { dot: "bg-yellow-500",  label: "WARN",     text: "text-yellow-400" },
  checking: { dot: "bg-neutral-500", label: "CHECKING", text: "text-neutral-400" },
};

function buildInitialChecks(): Record<string, ToolCheck> {
  const map: Record<string, ToolCheck> = {};
  for (const group of TOOL_GROUPS) {
    for (const tool of group.tools) {
      map[tool.id] = {
        id: tool.id,
        name: tool.name,
        status: "checking",
        latency: null,
        message: "Awaiting first check",
        lastChecked: null,
      };
    }
  }
  return map;
}

// Auto-refresh interval — every 5 minutes while the page is open.
// Cron-based 4x/day monitoring will be added in a future server-side session.
const AUTO_REFRESH_MS = 5 * 60 * 1000;

export default function AdminHealth() {
  const [checks, setChecks] = useState<Record<string, ToolCheck>>(() => buildInitialChecks());
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false); // prevents overlapping runs from timer + button

  const totals = useMemo(() => {
    const list = Object.values(checks);
    return {
      total: list.length,
      ok: list.filter((c) => c.status === "ok").length,
      fail: list.filter((c) => c.status === "fail").length,
      warn: list.filter((c) => c.status === "warn").length,
      checking: list.filter((c) => c.status === "checking").length,
    };
  }, [checks]);

  // Runs every registered client-side runner in parallel. Unregistered tools
  // stay in "checking" state — future sessions add their runners.
  const handleRunChecks = async () => {
    if (runningRef.current) return; // guard against overlap
    runningRef.current = true;
    setRunning(true);

    // Mark all registered tools back to "checking" while they run
    setChecks((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(RUNNERS)) {
        if (next[id]) {
          next[id] = { ...next[id], status: "checking", message: "Running check..." };
        }
      }
      return next;
    });

    const entries = Object.entries(RUNNERS);
    await Promise.all(
      entries.map(async ([id, runner]) => {
        try {
          const result = await runner();
          setChecks((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              status: result.status,
              latency: result.latency,
              message: result.message,
              lastChecked: new Date().toLocaleTimeString(),
            },
          }));
        } catch (err: any) {
          setChecks((prev) => ({
            ...prev,
            [id]: {
              ...prev[id],
              status: "fail",
              latency: 0,
              message: err?.message ?? "Runner threw unexpectedly",
              lastChecked: new Date().toLocaleTimeString(),
            },
          }));
        }
      })
    );

    setLastRun(new Date().toLocaleString());
    setRunning(false);
    runningRef.current = false;
  };

  // Auto-run on mount + every AUTO_REFRESH_MS thereafter
  useEffect(() => {
    handleRunChecks();
    const id = setInterval(() => {
      handleRunChecks();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RequireAuth>
      <Helmet>
        <title>System Health — Admin</title>
      </Helmet>

      <div
        className="min-h-screen bg-black text-white"
        style={{ fontFamily: "'League Spartan', system-ui, -apple-system, sans-serif" }}
      >
        <div className="max-w-7xl mx-auto px-4 py-8">
          <header className="mb-8 pb-6 border-b border-neutral-800">
            <h1 className="text-3xl font-bold tracking-tight mb-1">System Health</h1>
            <p className="text-sm text-neutral-400">
              Live status of every DesignProAI tool and external dependency.
            </p>
          </header>

          <section className="mb-8 flex flex-wrap items-center gap-6 justify-between">
            <div className="flex flex-wrap gap-6">
              <SummaryStat label="Total"    value={totals.total}    tone="neutral" />
              <SummaryStat label="OK"       value={totals.ok}       tone="ok" />
              <SummaryStat label="Failing"  value={totals.fail}     tone="fail" />
              <SummaryStat label="Warnings" value={totals.warn}     tone="warn" />
              <SummaryStat label="Checking" value={totals.checking} tone="neutral" />
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-wider text-neutral-500">
                  Last checked
                </div>
                <div className="text-sm text-neutral-300">{lastRun ?? "never"}</div>
                <div className="text-[10px] text-neutral-500 mt-0.5">
                  Auto-refresh every 5m
                </div>
              </div>
              <button
                type="button"
                onClick={handleRunChecks}
                disabled={running}
                className="px-4 py-2 bg-white text-black rounded text-sm font-semibold hover:bg-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {running ? "Running…" : "Run checks"}
              </button>
            </div>
          </section>

          {TOOL_GROUPS.map((group) => (
            <section key={group.label} className="mb-10">
              <h2 className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-3">
                {group.label}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.tools.map((tool) => (
                  <ToolCard key={tool.id} check={checks[tool.id]} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </RequireAuth>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "fail" | "warn" | "neutral";
}) {
  const colorClass =
    tone === "ok"   ? "text-green-400" :
    tone === "fail" ? "text-red-400" :
    tone === "warn" ? "text-yellow-400" :
                      "text-white";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`text-2xl font-bold ${colorClass}`}>{value}</div>
    </div>
  );
}

function ToolCard({ check }: { check: ToolCheck }) {
  const style = STATUS_STYLES[check.status];
  return (
    <div className="border border-neutral-800 bg-neutral-950 rounded p-4 hover:border-neutral-700 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="font-semibold text-sm">{check.name}</div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-block w-2 h-2 rounded-full ${style.dot}`} />
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${style.text}`}>
            {style.label}
          </span>
        </div>
      </div>
      <div className="text-xs text-neutral-400 min-h-[16px]">{check.message}</div>
      <div className="mt-3 pt-3 border-t border-neutral-900 flex items-center justify-between text-[10px] text-neutral-500">
        <span>{check.latency != null ? `${check.latency}ms` : "—"}</span>
        <span>{check.lastChecked ?? "never"}</span>
      </div>
    </div>
  );
}
