/**
 * Analytics helpers for GA4 + Meta Pixel event tracking.
 *
 * The GA4 snippet and the Meta Pixel are loaded in index.html; the pixel id
 * comes from VITE_FACEBOOK_PIXEL_ID. Everything here runs after that load.
 *
 * Every helper is a no-op when its global is missing, so a blocked script or a
 * consent tool that defers loading degrades to silence rather than throwing.
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
  }
}

// ── GA4 Events ─────────────────────────────────────────────────

export function gaEvent(
  eventName: string,
  params?: Record<string, string | number | boolean>
) {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", eventName, params);
  }
}

/** Track a signup conversion */
export function trackSignup(method: string = "email") {
  gaEvent("sign_up", { method });
  fbTrack("CompleteRegistration", { content_name: method });
}

/** Track when a user starts a render */
export function trackRenderStart(tool: string, vehicle?: string) {
  gaEvent("render_start", { tool, vehicle: vehicle || "" });
  fbTrack("InitiateCheckout", { content_category: tool });
}

/** Track a completed render */
export function trackRenderComplete(tool: string, vehicle?: string) {
  gaEvent("render_complete", { tool, vehicle: vehicle || "" });
}

/** Track when a user shares a design */
export function trackShare(platform: string, contentType: string = "design") {
  gaEvent("share", { method: platform, content_type: contentType });
  fbTrack("Lead", { content_name: platform });
}

/** Track a subscription/purchase */
export function trackPurchase(tier: string, value: number) {
  gaEvent("purchase", { currency: "USD", value, items: tier });
  fbTrack("Purchase", { currency: "USD", value, content_name: tier });
}

/**
 * GA4 measurement ID. Must stay in sync with the gtag snippet in index.html —
 * that snippet is what actually loads GA; this is only for calls made after
 * load.
 */
export const GA_MEASUREMENT_ID = "G-MZV0FBG7XJ";

/**
 * Track page views for SPA navigation (called from AnalyticsRouteTracker).
 *
 * Sends a `page_view` EVENT rather than re-running `gtag("config", …)`. The
 * config form re-initialises the property on every navigation, which restarts
 * the session-level setup and is not what GA4 wants for a route change — the
 * event form is the documented SPA pattern.
 *
 * `page_location` is sent as an absolute URL so GA attributes the hit to the
 * right host, and any utm_* params on the current URL stay attached.
 */
export function trackPageView(path: string, title?: string) {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", "page_view", {
      page_path: path,
      page_title: title || document.title,
      page_location: typeof location !== "undefined"
        ? `${location.origin}${path}`
        : path,
    });
  }
  fbTrack("PageView");
}

// ── Meta (Facebook) Pixel Events ───────────────────────────────

export function fbTrack(
  eventName: string,
  params?: Record<string, string | number | boolean>
) {
  if (typeof window !== "undefined" && window.fbq) {
    window.fbq("track", eventName, params);
  }
}
