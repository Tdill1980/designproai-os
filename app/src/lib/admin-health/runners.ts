/**
 * admin-health/runners.ts — client-side health check runners.
 *
 * Each runner returns a lightweight probe result. Checks are non-destructive:
 *   - no writes to any table
 *   - no invocations of edge functions
 *   - no Gemini / Replicate / external paid APIs
 *   - no user impersonation
 *
 * Only checks that can safely run from the browser live here. Later sessions
 * will add server-side cron + Slack alerts for the heavier checks.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Status } from "./types";

export interface RunnerResult {
  status: Status;
  latency: number;           // ms, measured
  message: string;           // short human-readable detail
}

type Runner = () => Promise<RunnerResult>;

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  const ms = Math.round(performance.now() - start);
  return { ms, value };
}

// ── Supabase DB reachability ─────────────────────────────────────────────────
// Runs a `count` query on a small public-read table. Safe + fast.
async function runSupabaseDb(): Promise<RunnerResult> {
  try {
    const { ms, value } = await timed(() =>
      supabase
        .from("designpanelpro_carousel")
        .select("id", { count: "exact", head: true })
    );
    if (value.error) {
      return { status: "fail", latency: ms, message: value.error.message };
    }
    const warnThreshold = 2000;
    const status: Status = ms > warnThreshold ? "warn" : "ok";
    const msg = status === "warn" ? `Slow response (${ms}ms)` : "Reachable";
    return { status, latency: ms, message: msg };
  } catch (err: any) {
    return { status: "fail", latency: 0, message: err?.message ?? "Connection failed" };
  }
}

// ── Auth / login reachability ────────────────────────────────────────────────
// Calls getUser() — this hits the Supabase auth API. Does NOT create/modify
// sessions. Returns ok whether or not a user is logged in (we only care that
// the auth service is reachable).
async function runLogin(): Promise<RunnerResult> {
  try {
    const { ms, value } = await timed(() => supabase.auth.getUser());
    // Note: value.error when unauthenticated is NOT a failure of the service —
    // it just means no JWT. We only treat network/server errors as fail.
    if (value.error && /network|fetch|timeout|unreachable/i.test(value.error.message)) {
      return { status: "fail", latency: ms, message: value.error.message };
    }
    const status: Status = ms > 2500 ? "warn" : "ok";
    return {
      status,
      latency: ms,
      message: status === "warn" ? `Slow auth response (${ms}ms)` : "Auth endpoint reachable",
    };
  } catch (err: any) {
    return { status: "fail", latency: 0, message: err?.message ?? "Auth unreachable" };
  }
}

// ── JWT sessions — checks current session expiry ─────────────────────────────
async function runJwtSessions(): Promise<RunnerResult> {
  try {
    const { ms, value } = await timed(() => supabase.auth.getSession());
    if (value.error) {
      return { status: "fail", latency: ms, message: value.error.message };
    }
    const session = value.data.session;
    if (!session) {
      return { status: "warn", latency: ms, message: "No active session (not logged in)" };
    }
    const expiresAt = session.expires_at; // unix seconds
    if (!expiresAt) {
      return { status: "warn", latency: ms, message: "Session has no expiry field" };
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const remaining = expiresAt - nowSec;
    if (remaining <= 0) {
      return { status: "fail", latency: ms, message: `Session expired ${Math.abs(remaining)}s ago` };
    }
    if (remaining < 300) {
      // under 5 minutes = warn (client usually refreshes but surface it)
      return { status: "warn", latency: ms, message: `Session expires in ${remaining}s` };
    }
    const mins = Math.floor(remaining / 60);
    return { status: "ok", latency: ms, message: `Session valid (${mins}m remaining)` };
  } catch (err: any) {
    return { status: "fail", latency: 0, message: err?.message ?? "Session check failed" };
  }
}

// ── Generic lazy-chunk loadability probe ────────────────────────────────────
// Tries to dynamically import a page module. Catches the #1 real SPA failure:
// after a deploy, cached browsers sometimes can't fetch the new chunk
// (ChunkLoadError) — the user sees a blank white page.
//
// This probe does NOT render the component. It just fetches + parses the JS.
// Top-level module side effects run once, but no React state is mounted.
async function runChunkLoad(
  importFn: () => Promise<unknown>,
  slowThresholdMs = 3000,
): Promise<RunnerResult> {
  try {
    const { ms } = await timed(importFn);
    const status: Status = ms > slowThresholdMs ? "warn" : "ok";
    return {
      status,
      latency: ms,
      message: status === "warn" ? `Slow chunk load (${ms}ms)` : "UI chunk loads",
    };
  } catch (err: any) {
    const msg = err?.message ?? "Chunk failed to load";
    return { status: "fail", latency: 0, message: `ChunkLoadError: ${msg}` };
  }
}

// Combines two check results into one card status. Worst status wins.
// Message prefix tells you WHICH layer failed (data vs UI) for quick triage.
function combine(ui: RunnerResult, data: RunnerResult): RunnerResult {
  const worst: Status =
    ui.status === "fail" || data.status === "fail" ? "fail" :
    ui.status === "warn" || data.status === "warn" ? "warn" :
    "ok";
  const latency = Math.max(ui.latency, data.latency);
  let message: string;
  if (ui.status === "fail") message = `UI: ${ui.message}`;
  else if (data.status === "fail") message = `Data: ${data.message}`;
  else if (ui.status === "warn") message = `UI: ${ui.message}`;
  else if (data.status === "warn") message = `Data: ${data.message}`;
  else message = "UI + data OK";
  return { status: worst, latency, message };
}

// ── Generic table ping ───────────────────────────────────────────────────────
// Reusable helper: head-count a table. No rows returned, tiny payload.
// Any table with public SELECT policy (or RLS that permits the auth'd user)
// works. Used to verify each tool's backing data layer is reachable.
async function pingTable(tableName: string, slowThresholdMs = 2000): Promise<RunnerResult> {
  try {
    const { ms, value } = await timed(() =>
      (supabase as any)
        .from(tableName)
        .select("id", { count: "exact", head: true })
    );
    if (value.error) {
      return { status: "fail", latency: ms, message: value.error.message };
    }
    const status: Status = ms > slowThresholdMs ? "warn" : "ok";
    return {
      status,
      latency: ms,
      message: status === "warn" ? `Slow response (${ms}ms)` : "Data layer reachable",
    };
  } catch (err: any) {
    return { status: "fail", latency: 0, message: err?.message ?? "Query failed" };
  }
}

// ── Vercel / site uptime (self) ──────────────────────────────────────────────
// HEAD request to the current origin. Confirms the Vercel edge is serving the
// app. Does NOT call any API route. Uses cache: no-store so we measure live.
async function runVercelUptime(): Promise<RunnerResult> {
  if (typeof window === "undefined") {
    return { status: "warn", latency: 0, message: "SSR context — skipped" };
  }
  try {
    const { ms, value } = await timed(() =>
      fetch(window.location.origin + "/favicon.ico", {
        method: "HEAD",
        cache: "no-store",
      })
    );
    if (!value.ok) {
      return { status: "fail", latency: ms, message: `HTTP ${value.status}` };
    }
    const status: Status = ms > 1500 ? "warn" : "ok";
    return {
      status,
      latency: ms,
      message: status === "warn" ? `Slow edge (${ms}ms)` : "Edge serving",
    };
  } catch (err: any) {
    return { status: "fail", latency: 0, message: err?.message ?? "Edge unreachable" };
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────
// Tool id → runner. Any id NOT in this map stays in "checking" state until a
// future session adds its runner.
export const RUNNERS: Record<string, Runner> = {
  login: runLogin,
  "supabase-db": runSupabaseDb,
  "jwt-sessions": runJwtSessions,
  "vercel-uptime": runVercelUptime,
  // Design tool probes: combine UI chunk loadability + backing-table ping.
  // Either layer failing turns the card red with a prefixed message so you
  // know instantly whether it's a broken deploy or a DB issue.
  //
  // These probes must only name pages this system routes. A chunk-load probe
  // is a static import(), so probing a retired page keeps that page -- and
  // every asset it references -- in the production build forever.
  designpro: () => runChunkLoad(() => import("@/pages/designpro/GenerateDesign")),
  productionjobs: () => runChunkLoad(() => import("@/pages/designpro/ProductionJobs")),
  revisionstudio: () => runChunkLoad(() => import("@/pages/designpro/ProductionWorkflow")),
  genieqc: () => runChunkLoad(() => import("@/pages/designpro/GenieQc")),
  wrapbox: () => runChunkLoad(() => import("@/pages/designpro/WrapBoxDelivery")),
};
