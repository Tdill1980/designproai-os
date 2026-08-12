import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { emitSessionExpired } from '@/lib/session-expired-emitter';
import { beginAppBusy, endAppBusy } from '@/lib/app-busy';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL) {
  console.error('VITE_SUPABASE_URL is not set. Supabase requests will fail.');
}
if (!SUPABASE_PUBLISHABLE_KEY) {
  console.error('VITE_SUPABASE_PUBLISHABLE_KEY is not set. Supabase requests will fail.');
}

// Production project ID: kfapjdyythzyvnpdeghu
const EXPECTED_PROJECT_ID = 'kfapjdyythzyvnpdeghu';
if (SUPABASE_URL && !SUPABASE_URL.includes(EXPECTED_PROJECT_ID)) {
  console.error(
    `[RestyleProAI] WRONG SUPABASE PROJECT!\n` +
    `  Current URL: ${SUPABASE_URL}\n` +
    `  Expected project: ${EXPECTED_PROJECT_ID}\n` +
    `  Fix VITE_SUPABASE_URL in Vercel dashboard → Settings → Environment Variables`
  );
}

// Bounded auth lock — fixes the cross-tab deadlock.
//
// supabase-js serializes auth operations (getSession / getUser / token
// refresh) behind a Web Lock so two tabs can't rotate the refresh token at
// once. Its default lock waits FOREVER for the lock (acquireTimeout = -1).
// When a tab acquires the lock and is then suspended/backgrounded (or its
// network call stalls), the lock is never released and EVERY auth call in
// EVERY tab hangs indefinitely — getSession() never resolves, so useUserTier
// falls back to 'free' (tools show "Upgrade") and pages that await getUser()
// sit on "Loading…" forever.
//
// This wrapper keeps the normal cross-tab serialization but caps how long it
// will wait for the lock. If it can't get it in time, it proceeds WITHOUT the
// lock rather than hang. The worst case is a rare concurrent refresh, which
// autoRefreshToken + the 401 retry interceptor below already recover from —
// strictly better than a total deadlock.
const AUTH_LOCK_MAX_WAIT_MS = 8000;

async function boundedAuthLock<R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  // No Web Locks API (SSR / older browsers) — run directly, as supabase does.
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    return await fn();
  }

  // Cap any infinite (-1) or over-long wait so a stuck tab can't deadlock auth.
  const waitMs = acquireTimeout < 0
    ? AUTH_LOCK_MAX_WAIT_MS
    : Math.min(acquireTimeout, AUTH_LOCK_MAX_WAIT_MS);

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), waitMs);
  try {
    return await navigator.locks.request(
      name,
      { mode: 'exclusive', signal: ac.signal },
      async () => {
        // Lock acquired — cancel the abort so a long-running fn isn't cut off.
        clearTimeout(timer);
        return await fn();
      },
    );
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      // Couldn't acquire within the cap (another tab is holding it, possibly
      // deadlocked). Proceed without the lock instead of hanging.
      return await fn();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const supabase = createClient<Database>(
  SUPABASE_URL || '',
  SUPABASE_PUBLISHABLE_KEY || '',
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
      lock: boundedAuthLock,
    }
  }
);

// ── Global edge-function 401 interceptor ──────────────────────────
// Wraps supabase.functions.invoke so ALL callers (45+ pages) get
// automatic JWT refresh + retry on auth errors, plus the session-
// expired modal if the retry also fails. Zero changes to call sites.
//
// Also taps render functions (generate-color-render,
// design-panel-ai-generate) to populate the multi-window render
// queue (render_queue table). Queue tracking is best-effort and
// fully wrapped in try/catch so it can never break a render.

const _originalInvoke = supabase.functions.invoke.bind(supabase.functions);

const RENDER_FN_TO_TOOL: Record<string, string> = {
  'generate-color-render': 'colorpro',
  'design-panel-ai-generate': 'designpro',
};

// BACK-HALF pipeline functions that must ALSO hold the app-busy flag (but are
// NOT render-queue functions). Root cause of "kicked me out mid proof/panels"
// (Trish 2026-07-24): DeployVersionWatcher reloads on a new deploy whenever the
// app looks idle — and the busy flag only covered the two hero-render functions,
// so the entire multi-minute 2D-proof + panel-build phase was reload-bait. Any
// in-flight call from this set now defers the reload just like a render does.
const BUSY_FNS = new Set([
  'generate-2d-proof',
  'panelizer-step-validate',
  'panel-artboard-generator',
  'panelize-artboard',
  'panel-pro-extract',
  'save-production-panels',
  'auto-generate-artboard',
  'designpro-persist-assets',
  'extract-logo-elements',
  'revise-render',
  'activate-print-worker',
]);

const QUEUE_WINDOW_KEY = 'restylepro_window_id';
function getQueueWindowId(): string {
  try {
    let id = sessionStorage.getItem(QUEUE_WINDOW_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `w_${Math.random().toString(36).slice(2)}_${Date.now()}`;
      sessionStorage.setItem(QUEUE_WINDOW_KEY, id);
    }
    return id;
  } catch {
    return 'w_unknown';
  }
}

function inferTool(fnName: string, body: any): string {
  const base = RENDER_FN_TO_TOOL[fnName] ?? fnName;
  if (fnName !== 'design-panel-ai-generate') return base;
  // design-panel-ai-generate is shared by DesignPro and FadeWraps; sniff body
  const mode = (body?.modeType || body?.mode || body?.tool || '').toString().toLowerCase();
  if (mode.includes('fade')) return 'fadewraps';
  if (mode.includes('graphics')) return 'graphicspro';
  if (mode.includes('color')) return 'colorpro';
  return 'designpro';
}

function buildVehicleLabel(body: any): string | null {
  const y = body?.vehicleYear ?? body?.year;
  const mk = body?.vehicleMake ?? body?.make;
  const md = body?.vehicleModel ?? body?.model;
  const parts = [y, mk, md].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function buildPromptSummary(body: any): string | null {
  const p = body?.prompt ?? body?.userPrompt ?? body?.designPrompt ?? null;
  if (!p) return null;
  return String(p).slice(0, 280);
}

// Render-engine functions whose failures we persist to render_error_log so
// the team can diagnose "won't generate" reports (ColorPro / DesignPro /
// WallPro / GraphicsPro all route through these). Best-effort, never throws.
const RENDER_LOG_RE = /(^render-)|(-render$)|design-panel-ai-generate|wallpro/i;

async function logRenderError(functionName: string, error: any, body: any) {
  try {
    if (!RENDER_LOG_RE.test(functionName)) return;
    const { data: { session } } = await supabase.auth.getSession();
    const status = error?.context?.status ?? error?.status ?? null;
    await supabase.from('render_error_log' as never).insert({
      user_id: session?.user?.id ?? null,
      user_email: session?.user?.email ?? null,
      tool: inferTool(functionName, body),
      function_name: functionName,
      status_code: typeof status === 'number' ? status : null,
      error_code: error?.code ?? null,
      error_message: String(error?.message ?? error ?? 'Unknown render error').slice(0, 1000),
      request_meta: {
        vehicle: buildVehicleLabel(body),
        view_type: body?.viewType ?? body?.view ?? null,
        prompt_summary: buildPromptSummary(body),
        mode: body?.modeType ?? body?.mode ?? null,
      },
    } as never);
  } catch (e) {
    console.warn('[render-error-log] insert failed (non-fatal):', e);
  }
}

async function queueEnqueue(fnName: string, body: any): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return null;
    const tool = inferTool(fnName, body);
    const vehicle = buildVehicleLabel(body);
    const insert = await supabase.from('render_queue' as never).insert({
      user_id: userId,
      tool,
      status: 'running',
      label: vehicle,
      vehicle,
      view_type: body?.viewType ?? body?.view ?? null,
      prompt_summary: buildPromptSummary(body),
      window_id: getQueueWindowId(),
      progress: 5,
      started_at: new Date().toISOString(),
    } as never).select('id').single();
    const id = (insert.data as { id?: string } | null)?.id ?? null;
    return id;
  } catch {
    return null;
  }
}

async function queueComplete(jobId: string, data: any) {
  try {
    const renderUrl = data?.renderUrl ?? data?.imageUrl ?? data?.image_url ?? null;
    await supabase.from('render_queue' as never).update({
      status: 'succeeded',
      progress: 100,
      completed_at: new Date().toISOString(),
      result_url: renderUrl,
      thumbnail_url: data?.thumbnailUrl ?? renderUrl,
      design_name: data?.designName ?? null,
      generation_id: data?.generationId ?? null,
    } as never).eq('id', jobId);
  } catch {}
}

async function queueFail(jobId: string, error: any) {
  try {
    const message = error?.message ?? (typeof error === 'string' ? error : 'Render failed');
    await supabase.from('render_queue' as never).update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: String(message).slice(0, 500),
    } as never).eq('id', jobId);
  } catch {}
}

function isAuthError(error: any): boolean {
  if (!error) return false;
  try {
    const status = error?.context?.status ?? error?.status;
    if (status === 401 || status === 403) return true;
  } catch {}
  const msg = String(error?.message || error || '').toLowerCase();
  return (
    msg.includes('invalid jwt') ||
    msg.includes('jwt expired') ||
    msg.includes('invalid claim') ||
    msg.includes('token is expired') ||
    msg.includes('not authenticated') ||
    /\b401\b/.test(msg)
  );
}

// Races a promise against a timeout. Used to keep the best-effort auth
// preflight from ever blocking an edge-function call: supabase.auth's
// getSession()/refreshSession() run behind a cross-tab Web Lock and can
// deadlock when several app tabs are open, which would hang the invoke
// (and any spinner waiting on it) forever. If the preflight overruns we
// just proceed — the 401 interceptor below still recovers a stale token.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// Coalesce token refreshes into a single in-flight call. During an upload or
// a multi-view render the app fires many edge-function invokes at once, and
// each one used to call supabase.auth.refreshSession() independently. With a
// short access-token TTL those parallel refreshes race on the same refresh
// token — the loser gets "refresh token already used", which makes
// supabase-js emit SIGNED_OUT and pop the phantom "session expired" modal
// mid-upload. Sharing one refresh promise across all concurrent callers
// removes the race; everyone awaits the same result.
let _refreshInFlight: ReturnType<typeof supabase.auth.refreshSession> | null = null;
function coalescedRefresh() {
  if (!_refreshInFlight) {
    _refreshInFlight = supabase.auth.refreshSession();
    _refreshInFlight.finally(() => {
      _refreshInFlight = null;
    });
  }
  return _refreshInFlight;
}

supabase.functions.invoke = async function patchedInvoke(
  functionName: string,
  options?: any,
): Promise<any> {
  // Proactive refresh: if token expires within 60s, refresh before calling.
  // Time-boxed so a stalled auth lock can never block the actual call.
  try {
    const sessionRes = await withTimeout(supabase.auth.getSession(), 3000);
    const session = sessionRes?.data?.session ?? null;
    if (session) {
      const expiresAt = (session.expires_at ?? 0) * 1000;
      if (expiresAt - Date.now() < 60_000) {
        await withTimeout(coalescedRefresh(), 3000);
      }
    }
  } catch {}

  const isRenderFn = functionName in RENDER_FN_TO_TOOL;
  const holdsBusy = isRenderFn || BUSY_FNS.has(functionName);

  // Mark the app "busy" for the duration of a render OR any back-half pipeline
  // call so DeployVersionWatcher won't auto-reload the page mid-generation
  // (and bounce a mobile user to login). endAppBusy runs in finally so every
  // return path clears it.
  if (holdsBusy) beginAppBusy();
  try {
  const queueJobId = isRenderFn ? await queueEnqueue(functionName, options?.body) : null;

  const result = await _originalInvoke(functionName, options);

  // If auth error, refresh session and retry once
  if (result.error && isAuthError(result.error)) {
    console.warn(`[supabase] Auth error on "${functionName}", refreshing session…`);
    try {
      const { error: refreshErr } = await coalescedRefresh();
      if (!refreshErr) {
        const retry = await _originalInvoke(functionName, options);
        if (retry.error && isAuthError(retry.error)) {
          // Retry also failed — trigger session expired modal
          emitSessionExpired();
        }
        if (retry.error) logRenderError(functionName, retry.error, options?.body);
        if (queueJobId) {
          if (retry.error) queueFail(queueJobId, retry.error);
          else queueComplete(queueJobId, retry.data);
        }
        return retry;
      }
    } catch {}
    // Refresh itself failed — trigger modal
    emitSessionExpired();
    logRenderError(functionName, result.error, options?.body);
    if (queueJobId) queueFail(queueJobId, result.error);
    return result;
  }

  if (result.error) logRenderError(functionName, result.error, options?.body);
  if (queueJobId) {
    if (result.error) queueFail(queueJobId, result.error);
    else queueComplete(queueJobId, result.data);
  }

  return result;
  } finally {
    if (holdsBusy) endAppBusy();
  }
} as typeof supabase.functions.invoke;
