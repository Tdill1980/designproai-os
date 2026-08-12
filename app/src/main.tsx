import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { OrganizationProvider } from "./contexts/OrganizationContext";
import { HelmetProvider } from "react-helmet-async";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { captureUtmParams } from "./lib/utm";
import { initSentry } from "./lib/sentry";
import { initErrorCapture } from "./lib/errorCapture";
import { initVersionCheck } from "./lib/versionCheck";

// Real-user error monitoring — no-ops if VITE_SENTRY_DSN isn't set
initSentry();

// Persist uncaught errors into our own DB (error_events) for the admin
// Error Dashboard + Claude Code fix pipeline. Independent of Sentry.
initErrorCapture();

// Capture UTM params from landing URL for attribution tracking
captureUtmParams();

// Auto-refresh on stale chunk errors after a new deploy.
// When Vercel deploys, old cached HTML references JS chunks that no longer exist.
// This catches the load failure and silently refreshes once.
window.addEventListener("vite:preloadError", () => {
  const hasRefreshed = sessionStorage.getItem("chunk-refresh");
  if (!hasRefreshed) {
    sessionStorage.setItem("chunk-refresh", "1");
    window.location.reload();
  }
});

// Auto-update the SPA when a new build is deployed. Without this, a tab left
// open keeps running the old bundle (it never re-requests index.html), so
// customers never see fixes until they manually clear cache / reopen.
initVersionCheck();

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <ErrorBoundary>
      <OrganizationProvider>
        <App />
      </OrganizationProvider>
    </ErrorBoundary>
  </HelmetProvider>
);
