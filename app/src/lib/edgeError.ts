/**
 * edgeError — get the REAL reason out of a failed edge-function call.
 *
 * supabase-js turns ANY non-2xx response into a `FunctionsHttpError` whose
 * message is the useless string "Edge Function returned a non-2xx status
 * code". The actual reason the function returned — `{ error: "..." }` — is
 * only in the raw `Response` hanging off `err.context`, which has to be
 * awaited to read.
 *
 * That single detail caused a real, long-lived bug: Content Studio's Canva
 * panels check `data.error === "canva_not_connected"` to show a friendly
 * "reconnect" state, but the function returns that with a 404 — so `data` is
 * null, the check never matches, and the operator got
 * "Couldn't load Canva folders: Edge Function returned a non-2xx status code"
 * for what was really just an expired connection.
 *
 * Use `readEdgeError` in every edge-function catch block so failures say why.
 */

export interface EdgeErrorInfo {
  /** Human-readable reason — the function's own `error`, or the raw message. */
  reason: string;
  /** The function's machine-readable error code, when it sent one. */
  code?: string;
  /** HTTP status, when the transport exposed one. */
  status?: number;
}

interface MaybeFunctionsError {
  message?: string;
  context?: { json?: () => Promise<unknown>; status?: number };
}

/**
 * Read a thrown/returned edge-function error into something worth showing.
 * Never throws — a body that can't be parsed just falls back to the message.
 */
export async function readEdgeError(err: unknown, fallback = "Unknown error"): Promise<EdgeErrorInfo> {
  const e = (err ?? {}) as MaybeFunctionsError;
  const info: EdgeErrorInfo = {
    reason: (typeof e.message === "string" && e.message) || (err ? String(err) : fallback),
    status: e.context?.status,
  };
  try {
    if (e.context && typeof e.context.json === "function") {
      const body = (await e.context.json()) as { error?: unknown } | null;
      const bodyError = body?.error;
      if (typeof bodyError === "string" && bodyError.trim()) {
        info.code = bodyError;
        info.reason = bodyError;
      }
    }
  } catch {
    /* unparseable body — keep the transport message */
  }
  return info;
}

/**
 * True when the failure is "this Canva account isn't connected / the token
 * expired" — the case the UI should answer with a reconnect prompt rather
 * than an error toast. Matches the body code, and the message as a fallback
 * for callers that only have a string.
 */
export function isCanvaNotConnected(info: EdgeErrorInfo | string | null | undefined): boolean {
  if (!info) return false;
  const s = typeof info === "string" ? info : `${info.code ?? ""} ${info.reason ?? ""}`;
  return /canva_not_connected/i.test(s);
}
