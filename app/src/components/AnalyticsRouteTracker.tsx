import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { trackPageView } from "@/lib/analytics";

/**
 * Sends a GA4 page_view on every client-side route change.
 *
 * Why: this is a single-page app, so after the first load React Router swaps
 * views without a document navigation. `trackPageView` existed in
 * src/lib/analytics.ts but had ZERO callers, which left GA depending entirely
 * on Enhanced Measurement's history-event heuristic — and that reports the
 * stale `document.title` from before the new view mounted, so pages show up
 * under the previous page's name. Campaign landings arriving with the UTM tags
 * the Klaviyo drafts now carry are exactly the traffic that has to be
 * attributed correctly, so this fires explicitly instead of hoping.
 *
 * The title is read after paint (rAF), because route components set
 * document.title as they mount — reading it synchronously captures the
 * OUTGOING page's title.
 *
 * The very first load is skipped: the gtag snippet in index.html already sends
 * that page_view with the full landing URL (UTMs included). Firing again here
 * would double-count every session's entry page.
 */
export const AnalyticsRouteTracker = () => {
  const { pathname, search } = useLocation();
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    const id = requestAnimationFrame(() => {
      trackPageView(`${pathname}${search}`);
    });
    return () => cancelAnimationFrame(id);
  }, [pathname, search]);

  return null;
};
