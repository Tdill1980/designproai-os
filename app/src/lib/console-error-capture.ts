/**
 * console-error-capture — global ring buffer of recent JS errors
 *
 * Mounted once at app start. Captures the last N runtime errors and
 * unhandled promise rejections so the EngineRoom Report widget can
 * attach them to a bug report — saves the triager (and Claude Code)
 * from asking "what was in the console?"
 *
 * Intentionally lightweight: no networking, no PII scrubbing beyond
 * stripping URL query strings, no overlap with Sentry/etc. Just a
 * small ring buffer in memory.
 */

export interface CapturedError {
  ts: string;
  type: "error" | "unhandledrejection";
  message: string;
  source?: string;     // file URL (query string stripped)
  line?: number;
  col?: number;
  stack?: string;
}

const MAX = 10;
const _buffer: CapturedError[] = [];
let _installed = false;

function stripQuery(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(u);
    return `${url.origin}${url.pathname}`;
  } catch {
    return u;
  }
}

function push(err: CapturedError) {
  _buffer.push(err);
  if (_buffer.length > MAX) _buffer.shift();
}

export function installConsoleErrorCapture(): void {
  if (_installed || typeof window === "undefined") return;
  _installed = true;

  window.addEventListener("error", (ev) => {
    push({
      ts: new Date().toISOString(),
      type: "error",
      message: ev.message || String(ev.error || "unknown error"),
      source: stripQuery(ev.filename),
      line: ev.lineno,
      col: ev.colno,
      stack: ev.error?.stack,
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason;
    push({
      ts: new Date().toISOString(),
      type: "unhandledrejection",
      message:
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : JSON.stringify(reason).slice(0, 500),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
}

export function getCapturedErrors(): CapturedError[] {
  return [..._buffer];
}

export function clearCapturedErrors(): void {
  _buffer.length = 0;
}
