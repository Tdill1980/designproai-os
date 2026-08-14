/**
 * DeployVersionWatcher
 *
 * Fixes the recurring "I can't see the update" problem: when a browser is
 * holding a stale index.html, it keeps running old JS even after a deploy.
 *
 * This compares the currently-running app bundle hash (read from the live
 * <script> tag) against the bundle referenced by the freshly-fetched HTML.
 * When they differ, a newer deploy is out — so it reloads the page. The check
 * runs on an interval and whenever the tab regains focus (a natural pause
 * point, so we don't interrupt active typing). Renders nothing.
 */

import { useEffect, useRef } from "react";
import { isAppBusy } from "@/lib/app-busy";
import { toast } from "sonner";

// The bundle the running app booted from (captured once at module load).
function currentBundle(): string | null {
  try {
    const els = Array.from(document.querySelectorAll('script[src*="/assets/index-"]'));
    for (const el of els) {
      const src = (el as HTMLScriptElement).getAttribute("src") || "";
      const m = src.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
      if (m) return m[0];
    }
  } catch {
    /* ignore */
  }
  return null;
}

const BOOTED_BUNDLE = currentBundle();

async function deployedBundle(): Promise<string | null> {
  try {
    const res = await fetch(`/?_v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

export const DeployVersionWatcher = () => {
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!BOOTED_BUNDLE) return; // dev mode / nothing to compare
    // Never auto-reload when running inside an iframe (e.g. the embedded
    // DesignPro / proof view in ApprovePro). A reload there would yank the
    // embedded tool out from under the user and make the panel "shake".
    try {
      if (window.self !== window.top) return;
    } catch {
      // Cross-origin access throws → we're framed; bail out too.
      return;
    }

    // Track the user's last interaction so a deploy never yanks a page they are
    // ACTIVELY REVIEWING (Trish 2026-07-24: "before I could review it
    // reloaded"). Recently-active users get a "refresh when ready" prompt
    // instead of a forced reload; idle/hidden tabs still auto-reload so stale
    // bundles never linger.
    let lastInteraction = Date.now();
    const markInteraction = () => { lastInteraction = Date.now(); };
    const INTERACTION_WINDOW_MS = 3 * 60 * 1000;
    window.addEventListener("pointerdown", markInteraction, { passive: true });
    window.addEventListener("keydown", markInteraction, { passive: true });
    window.addEventListener("scroll", markInteraction, { passive: true });
    let promptShown = false;

    const check = async () => {
      if (reloadingRef.current) return;
      // Never reload mid-render. A new version can wait until the user is idle;
      // reloading during an active generation yanks the page out from under
      // them (and on mobile can bounce them to the login screen). The next
      // scheduled/visibility check picks up the new version once work is done.
      if (isAppBusy()) return;
      const latest = await deployedBundle();
      if (latest && latest !== BOOTED_BUNDLE) {
        const activeRecently =
          document.visibilityState === "visible" &&
          Date.now() - lastInteraction < INTERACTION_WINDOW_MS;
        if (activeRecently) {
          // The user is mid-review — prompt instead of pulling the page away.
          if (!promptShown) {
            promptShown = true;
            toast.info("A new version of RestylePro is ready", {
              description: "Refresh when you're done reviewing to pick it up.",
              duration: Infinity,
              action: { label: "Refresh now", onClick: () => window.location.reload() },
            });
          }
          return;
        }
        reloadingRef.current = true;
        // Force a fresh fetch of HTML + assets.
        window.location.reload();
      }
    };

    // Check ~every 3 minutes and whenever the tab regains focus.
    const interval = window.setInterval(check, 3 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    // One check shortly after load to catch users who left a tab open.
    const initial = window.setTimeout(check, 15 * 1000);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
      window.removeEventListener("scroll", markInteraction);
    };
  }, []);

  return null;
};
