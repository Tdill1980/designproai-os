/**
 * errorCapture.ts — real-user error capture into Supabase (`error_events`).
 *
 * Complements Sentry (src/lib/sentry.ts): Sentry is great for triage but lives
 * outside our stack. This persists uncaught errors into our own DB so the
 * admin Error Dashboard (/admin/errors) can group, triage, and kick off the
 * Claude Code fix pipeline — without depending on a third-party dashboard.
 *
 * Sources captured:
 *   - window 'error'            → uncaught JS exceptions
 *   - window 'unhandledrejection' → unhandled promise rejections
 *   - React render errors        → forwarded from ErrorBoundary.componentDidCatch
 *   - manual                     → captureError(err, { source: 'manual' })
 *
 * Design notes:
 *   - Best-effort and never throws. A failure to log an error must never
 *     create a second error.
 *   - Errors are grouped server-side by `fingerprint`; we compute a stable
 *     fingerprint from the error name + message + first stack frame.
 *   - Client-side throttling: the same fingerprint is sent at most once per
 *     THROTTLE_MS, and we cap total sends per page load, so a render loop
 *     can't hammer the DB.
 *   - Noise filters: chunk-load errors (already handled by a silent reload),
 *     browser-extension errors, ResizeObserver loop warnings, and bot UAs are
 *     dropped before they ever hit the network.
 */

import { supabase } from "@/integrations/supabase/client";

type ErrorSource = "window" | "unhandledrejection" | "react" | "manual";
type ErrorSeverity = "info" | "warning" | "error" | "fatal";

interface CaptureContext {
  source?: ErrorSource;
  severity?: ErrorSeverity;
  componentStack?: string | null;
  metadata?: Record<string, unknown>;
}

const THROTTLE_MS = 30_000;     // don't resend the same fingerprint within 30s
const MAX_SENDS_PER_LOAD = 50;  // hard cap per page load to avoid floods

const recentlySent = new Map<string, number>();
let sendCount = 0;
let initialized = false;

/** djb2 string hash → short hex, used to build a stable fingerprint. */
function hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

/** First "real" stack frame (strips line/col noise that varies per build). */
function topFrame(stack?: string | null): string {
  if (!stack) return "";
  const line = stack
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("at ") || l.includes("@"));
  if (!line) return "";
  // Strip :line:col so the same call site fingerprints identically across builds.
  return line.replace(/:\d+:\d+\)?$/, "").replace(/\?[^)]*\)/, ")");
}

function fingerprintFor(name: string, message: string, stack?: string | null): string {
  // Normalise volatile bits (uuids, numbers, urls) so "load 12 failed" and
  // "load 13 failed" group together.
  const normMsg = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 300);
  return hash(`${name}|${normMsg}|${topFrame(stack)}`);
}

const NOISE_PATTERNS = [
  "ResizeObserver loop",                       // benign browser warning
  "Failed to fetch dynamically imported module", // chunk error → silent reload
  "Importing a module script failed",
  "Loading chunk",
  "Loading CSS chunk",
  "ChunkLoadError",
  "Non-Error promise rejection captured",
];

function isNoise(message: string, stack?: string | null): boolean {
  if (NOISE_PATTERNS.some((p) => message.includes(p))) return true;
  // Errors thrown from browser extensions — not our code.
  if (stack && /(chrome|moz|safari)-extension:\/\//.test(stack)) return true;
  if (typeof navigator !== "undefined" && /bot|crawler|spider/i.test(navigator.userAgent)) return true;
  return false;
}

function appVersion(): string | null {
  // Vite inlines defined env vars; fall back gracefully when unset.
  const v =
    (import.meta.env.VITE_COMMIT_SHA as string | undefined) ??
    (import.meta.env.VITE_APP_VERSION as string | undefined);
  return v ?? null;
}

/**
 * Persist a single error. Safe to call from anywhere — swallows all failures.
 */
export async function captureError(error: unknown, ctx: CaptureContext = {}): Promise<void> {
  try {
    const err =
      error instanceof Error
        ? error
        : new Error(typeof error === "string" ? error : JSON.stringify(error ?? "Unknown error"));

    const name = err.name || "Error";
    const message = (err.message || "Unknown error").slice(0, 2000);
    const stack = err.stack ?? null;

    if (isNoise(message, stack)) return;

    const fingerprint = fingerprintFor(name, message, stack);

    // Throttle duplicates + cap floods.
    const now = Date.now();
    const last = recentlySent.get(fingerprint);
    if (last && now - last < THROTTLE_MS) return;
    if (sendCount >= MAX_SENDS_PER_LOAD) return;
    recentlySent.set(fingerprint, now);
    sendCount++;

    await supabase.rpc("log_client_error", {
      p_fingerprint: fingerprint,
      p_message: message,
      p_error_name: name,
      p_stack: stack ? stack.slice(0, 20_000) : null,
      p_component_stack: ctx.componentStack ? ctx.componentStack.slice(0, 20_000) : null,
      p_source: ctx.source ?? "window",
      p_severity: ctx.severity ?? "error",
      p_url: typeof location !== "undefined" ? location.href.slice(0, 1000) : null,
      p_route: typeof location !== "undefined" ? location.pathname.slice(0, 500) : null,
      p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
      p_app_version: appVersion(),
      p_metadata: (ctx.metadata ?? {}) as never,
    } as never);
  } catch (e) {
    // Never let the logger create a new error.
    console.warn("[errorCapture] failed to log error (non-fatal):", e);
  }
}

/**
 * Register global error handlers. Call once from main.tsx after initSentry().
 */
export function initErrorCapture(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    // Resource load errors (img/script) surface as ErrorEvent with no `error`.
    const err = event.error ?? new Error(event.message || "Unknown window error");
    void captureError(err, { source: "window", severity: "error" });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    void captureError(reason, { source: "unhandledrejection", severity: "error" });
  });
}
