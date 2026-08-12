/**
 * sentry.ts — Real-user error monitoring init.
 *
 * Called once from main.tsx before React mounts. Hooks into:
 *   - Unhandled JS errors
 *   - Unhandled Promise rejections
 *   - React render/effect errors (via global error handlers)
 *
 * Only activates when VITE_SENTRY_DSN is set. Safe to ship without — the
 * init silently no-ops if the DSN is missing, so local dev + preview
 * deploys don't spam the Sentry project.
 *
 * DSNs are PUBLIC by design (per Sentry docs) — they only permit POSTing
 * error reports, nothing else. Safe to expose via VITE_ env var.
 */

import * as Sentry from "@sentry/react";

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) {
    // No DSN configured — silently skip. Prevents local dev from polluting
    // the Sentry project and prevents "Sentry not configured" warnings.
    return;
  }

  const env = (import.meta.env.VITE_SENTRY_ENV as string | undefined)
    ?? (import.meta.env.PROD ? "production" : "development");

  Sentry.init({
    dsn,
    environment: env,
    // Sample 100% of errors; only 10% of performance traces to keep quota
    tracesSampleRate: 0.1,
    // Session replay disabled by default (can enable later if needed) —
    // avoids extra bundle weight and privacy considerations.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Don't report bot/crawler errors
    beforeSend(event) {
      if (typeof navigator !== "undefined" && /bot|crawler|spider/i.test(navigator.userAgent)) {
        return null;
      }
      return event;
    },
  });
}
