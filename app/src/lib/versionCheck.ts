// Auto-update the long-lived SPA when a new build is deployed.
//
// DesignProAI is a single-page app: users keep the tab open for hours/days and
// client-side route, so the browser NEVER re-requests index.html or the JS
// bundle it first loaded. Vercel cache headers can't help (no new request is
// ever made), and `vite:preloadError` only fires when an old chunk 404s.
//
// This polls the freshly-served index.html, fingerprints the hashed asset
// references, and reloads the tab when they change — so customers always end
// up on the latest UI without manually clearing cache.

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // re-check every 5 minutes

let bootedFingerprint: string | null = null;
let reloading = false;

async function fetchAssetFingerprint(): Promise<string | null> {
  try {
    // Cache-bust + no-store so we always see what the server is serving now.
    const res = await fetch(`/index.html?_v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    // Hashed bundle URLs, e.g. /assets/index-AbC123.js, /assets/x-9f8e.css
    const assets = html.match(/\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g);
    if (!assets || assets.length === 0) return null;
    return Array.from(new Set(assets)).sort().join("|");
  } catch {
    return null; // offline / transient — never disrupt the user
  }
}

async function checkForUpdate(reloadIfVisible: boolean) {
  if (reloading) return;
  const current = await fetchAssetFingerprint();
  if (!current) return;

  // First successful check establishes the baseline this tab booted with.
  if (bootedFingerprint === null) {
    bootedFingerprint = current;
    return;
  }

  if (current === bootedFingerprint) return;

  // A newer build is live. Reload when it won't interrupt active work:
  //  - reloadIfVisible (tab just refocused → user just arrived, safe), or
  //  - the tab is hidden (reload is invisible to the user).
  if (reloadIfVisible || document.hidden) {
    reloading = true;
    window.location.reload();
  }
}

// Answer "am I running current code?" on demand, from any page.
//
// The auto-reload below is silent by design, so there has never been a way to
// ASK — the build stamp renders on exactly one admin page. That gap is why a
// deployed fix and a stale tab produce the same observation: nothing changed.
// Returns the build this tab is running, what the server is serving right now,
// and whether they differ.
export async function buildStatus(): Promise<{
  build: string;
  stale: boolean | null;
  booted: string | null;
  served: string | null;
}> {
  const served = await fetchAssetFingerprint();
  return {
    build: typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev",
    // null when the check could not reach the server — unknown, not "fresh".
    stale: served === null || bootedFingerprint === null
      ? null
      : served !== bootedFingerprint,
    booted: bootedFingerprint,
    served,
  };
}

export function initVersionCheck() {
  // Establish the baseline from the bundle THIS tab actually loaded, before any
  // poll can overwrite it. Reading it from the live DOM (rather than the first
  // server fetch 10s later) closes the window where a deploy landing between
  // boot and that fetch would set the baseline to the NEW build while the tab
  // still ran the old one — making the tab permanently believe it was current.
  try {
    const loaded = Array.from(
      document.querySelectorAll<HTMLElement>("script[src], link[href]"),
    )
      .map((el) => el.getAttribute("src") || el.getAttribute("href") || "")
      .filter((u) => /^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/.test(u));
    if (loaded.length) {
      bootedFingerprint = Array.from(new Set(loaded)).sort().join("|");
    }
  } catch {
    // Fall through to the original behaviour: first poll sets the baseline.
  }

  // Say which build this is, once, on every page. One line in the console
  // turns "did my fix deploy?" from an inference into a five-second check.
  try {
    console.info(
      `[DesignProAI] build ${typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev"} — run __BUILD__.status() to check for a newer one`,
    );
    (window as unknown as Record<string, unknown>).__BUILD__ = {
      id: typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev",
      status: buildStatus,
      reload: () => window.location.reload(),
    };
  } catch {
    // Never let a diagnostic break boot.
  }

  return initVersionCheckTimers();
}

function initVersionCheckTimers() {
  // Establish baseline shortly after boot (don't block first paint).
  setTimeout(() => checkForUpdate(false), 10_000);

  // Periodic check — only auto-reloads while the tab is hidden.
  setInterval(() => checkForUpdate(false), CHECK_INTERVAL_MS);

  // When the user returns to the tab, reload immediately if a new build exists.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate(true);
  });
}
