import { useState, lazy, Suspense, ComponentType } from "react";

// Retry wrapper for lazy imports — when Vercel deploys new chunks the browser
// can hold stale HTML that points at old chunk filenames, so the dynamic
// import 404s. We reload ONCE to pull fresh HTML. This must never loop: a
// genuinely-missing chunk would otherwise reload → fail → reload forever,
// which shows up as the whole screen flashing/blinking. Guard with a
// timestamp window (reload at most once per 15s) and clear it on success.
const CHUNK_RELOAD_KEY = "chunk_reload_at";
const CHUNK_RELOAD_WINDOW_MS = 15_000;

function lazyWithRetry(importFn: () => Promise<{ default: ComponentType<any> }>) {
  return lazy(() =>
    importFn()
      .then((mod) => {
        // Loaded fine — clear any prior reload marker so a future stale
        // deploy can reload again when it legitimately needs to.
        try { sessionStorage.removeItem(CHUNK_RELOAD_KEY); } catch { /* private mode */ }
        return mod;
      })
      .catch((err) => {
        let last = 0;
        try { last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0; } catch { /* ignore */ }
        const now = Date.now();
        // Only reload if we haven't already tried within the window. If we
        // just reloaded and it STILL fails, stop reloading and let the error
        // surface to the ErrorBoundary instead of flashing forever.
        if (now - last > CHUNK_RELOAD_WINDOW_MS) {
          try { sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now)); } catch { /* ignore */ }
          window.location.reload();
          // Block rendering until the reload takes over — never flash content.
          return new Promise<{ default: ComponentType<any> }>(() => {});
        }
        throw err;
      })
  );
}
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import SprocketHelper from "@/components/SprocketHelper";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppCartProvider } from "@/contexts/AppCartContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { MetaPixel } from "@/components/MetaPixel";
import { MobileToolNav } from "@/components/MobileToolNav";
import { DesktopToolNav } from "@/components/DesktopToolNav";
import { OfflineBanner } from "@/components/OfflineBanner";
import { Footer } from "@/components/Footer";
import ReportIssueWidget from "@/components/engineroom/ReportIssueWidget";
import { installConsoleErrorCapture } from "@/lib/console-error-capture";

installConsoleErrorCapture();

const ApproveProUnavailable = () => (
  <main className="min-h-screen bg-white px-6 py-24 text-slate-950">
    <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 p-8 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-wider text-blue-600">DesignProAI</p>
      <h1 className="mt-3 text-3xl font-bold">ApprovePro is not live</h1>
      <p className="mt-4 text-base leading-7 text-slate-600">
        ApprovePro is offline while it is being integrated into the DesignProAI operating system.
        No proof action, revision, message, signature, or order was submitted from this page.
      </p>
    </div>
  </main>
);
import { RequireAuth } from "@/components/RequireAuth";
import { SessionGuard } from "@/components/SessionGuard";
import { RequireAdmin } from "@/components/RequireAdmin";
import { RequireSingleFlatPanel } from "@/components/RequireSingleFlatPanel";
import { RequireWPWTenant } from "@/components/RequireWPWTenant";
import { ScrollToTop } from "@/components/ScrollToTop";
import { AnalyticsRouteTracker } from "@/components/AnalyticsRouteTracker";
import CanonicalTag from "@/components/seo/CanonicalTag";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Header } from "@/components/Header";
import { DeployVersionWatcher } from "@/components/DeployVersionWatcher";
import { AppShell } from "@/components/layout/AppShell";
import { AuthedRootRedirect } from "@/components/AuthedRootRedirect";
import { isDesignProMarketingHost } from "@/lib/designpro-host-routing";
import { WaitlistPopup } from "@/components/WaitlistPopup";
import { PaywallTokenModal } from "@/components/PaywallTokenModal";
import { PackPaymentResume } from "@/components/PackPaymentResume";
import { CorporateOnboardingWizard } from "@/components/CorporateOnboardingWizard";
import { ShopOnboardingWizard } from "@/components/onboarding/ShopOnboardingWizard";
import { WpwConnectPortalWizard } from "@/components/onboarding/WpwConnectPortalWizard";
import { AdminViewAsCustomerToggle } from "@/components/AdminViewAsCustomerToggle";
import { SproketGreeter } from "@/components/ui/SproketGreeter";

// ── Eager imports (critical path - homepage, auth, 404) ──────────
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Gallery from "./pages/Gallery";

// ── Lazy imports - DesignProAI operating surfaces ────────────────
// These are the server-owned surfaces: the browser reports state and asks for
// the two human release gates, and never orchestrates the pipeline itself.
// THE CUSTOMER-FACING DESIGNPRO PRODUCT. These two pages are the DesignPro the
// customer knows -- A.C.E., MyVehiclePro, Restyle vs Business & Fleet, the
// VisionBoardIQ reference upload, the DesignIQ prompt, logo behaviour, finish,
// LayerLift and the seven generated views. They were carried into this repo
// intact and then routed away from, which is why the customer landed in the
// server-owned intake instead of the product. The intake pages below remain,
// as operating surfaces.
const DesignProAIHome = lazyWithRetry(() => import("./pages/DesignProAIHome"));
const DesignPanelProPremium = lazyWithRetry(() => import("./pages/DesignPanelProPremium"));
const DesignProGenerate = lazyWithRetry(() => import("./pages/designpro/GenerateDesign"));
const DesignProJobs = lazyWithRetry(() => import("./pages/designpro/ProductionJobs"));
const DesignProWorkflow = lazyWithRetry(() => import("./pages/designpro/ProductionWorkflow"));
// The design team's per-side validation board and the customer's build-progress
// page. Both were RestylePro surfaces driven from the browser; these are the
// server-backed rebuilds that read the run through the gateway only.
const PanelProStudioBoard = lazyWithRetry(() => import("./pages/designpro/PanelProStudioBoard"));
const GenieProgress = lazyWithRetry(() => import("./pages/designpro/GenieProgress"));
const DesignProGenieQc = lazyWithRetry(() => import("./pages/designpro/GenieQc"));
const DesignProNewRevision = lazyWithRetry(() => import("./pages/designpro/NewRevisionSource"));
const DesignProWrapBox = lazyWithRetry(() =>
  import("./pages/designpro/WrapBoxDelivery").then((mod) => ({ default: mod.WrapBoxList })),
);
const DesignProWrapBoxPack = lazyWithRetry(() =>
  import("./pages/designpro/WrapBoxDelivery").then((mod) => ({ default: mod.WrapBoxPackDetail })),
);

// ── Lazy imports - Core tools ────────────────────────────────────
const AdminDesignProV2Test = lazyWithRetry(() => import("./pages/AdminDesignProV2Test"));
const PanelSizer = lazyWithRetry(() => import("./pages/PanelSizer"));
const DesignStudio = lazyWithRetry(() => import("./pages/DesignStudio"));
const DesignProStudio = lazyWithRetry(() => import("./pages/DesignProStudio"));
const RevisionStudioIQ = lazyWithRetry(() => import("./pages/RevisionStudioIQ"));
const ProductionProof = lazyWithRetry(() => import("./pages/ProductionProof"));

// ── Lazy imports - User pages ────────────────────────────────────
const RestyleDashboard = lazyWithRetry(() => import("./pages/RestyleDashboard"));
const Pricing = lazyWithRetry(() => import("./pages/PricingColorPro"));
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const VehicleGallery = lazyWithRetry(() => import("./pages/VehicleGallery"));


// ── Lazy imports - PrintPro ──────────────────────────────────────
const DesignPanelProPrintedProductPage = lazyWithRetry(() => import("./components/printpro/DesignPanelProPrintedProductPage"));
const PrintProductionPipeline = lazyWithRetry(() => import("./components/printpro/PrintProductionPipeline"));
const ProductionOS = lazyWithRetry(() => import("./pages/ProductionOS"));

// ── Lazy imports - Admin pages ───────────────────────────────────
const AdminDashboard = lazyWithRetry(() => import("./pages/AdminDashboard"));
const AdminGallery = lazyWithRetry(() => import("./pages/AdminGallery"));
const AdminDesignPanelProManager = lazyWithRetry(() => import("./pages/AdminDesignPanelProManager"));
const AdminProductionPacks = lazyWithRetry(() => import("./pages/AdminProductionPacks"));
const AdminProductionTest = lazyWithRetry(() => import("./pages/AdminProductionTest"));
const AdminGalleryManager = lazyWithRetry(() => import("./pages/AdminGalleryManager"));
const AdminProductionFiles = lazyWithRetry(() => import("./pages/AdminProductionFiles"));
// Standalone 1/24 mini-wrap-kit experiment — READ-ONLY over the vault, writes
// nothing to the pipeline. Reachable only by URL; no pipeline surface links here.
const AdminPrintProduction = lazyWithRetry(() => import("./pages/AdminPrintProduction"));

// ── Lazy imports - Affiliate pages ───────────────────────────────

const queryClient = new QueryClient();

const Loading = () => (
  <div className="flex flex-col items-center min-h-screen bg-background gap-6 pt-32">
    <img
      src="/characters/sproket/planet-purple.png"
      alt="Loading"
      className="w-28 h-28 md:w-36 md:h-36 object-contain animate-pulse"
    />
    <img
      src="/characters/sproket/sproket-loading.png"
      alt="SPROKET loading"
      className="w-20 h-20 object-contain animate-sproket-bob"
    />
    <p className="text-sm text-blue-200/60 animate-pulse font-poppins">Loading...</p>
  </div>
);

// The apex is the selling site even when a browser has an existing OS session.
// Authentication-based root routing belongs only to the OS host.
const HostAwareRoot = () => {
  const hostname = typeof window === "undefined" ? "" : window.location.hostname;
  return isDesignProMarketingHost(hostname) ? <Index /> : <AuthedRootRedirect />;
};

// Redirect legacy standalone email routes into the unified MightyMail hub,
// preserving any existing query params (e.g. ?template=) and selecting the tab.
const MightyMailRedirect = ({ tab }: { tab: string }) => {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  return <Navigate to={`/admin/mightymail?${params.toString()}`} replace />;
};

// The public customer proof portal (/approve/:token) is fully self-branded
// (shop wordmark + ApprovePro). It must NOT show the DesignProAI marketing
// chrome (top nav, footer, helper docks). The shop's /approve/manage page is
// staff-facing and keeps the normal chrome. Rendered inside BrowserRouter so
// useLocation is available.
const HideOnCustomerProof = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  // Full-screen ApprovedPro surfaces render their own app shell, so strip the
  // global marketing chrome: the customer proof portal (/approve/*) and the
  // owner ApprovedPro dashboard both fill the window like a standalone app.
  const isStandaloneApprovedPro =
    (pathname.startsWith("/approve/") && !pathname.startsWith("/approve/manage")) ||
    pathname === "/admin/approve-revisions";
  if (isStandaloneApprovedPro) return null;
  return <>{children}</>;
};

const App = () => {
  // The App Cart is RestylePro storefront commerce; this product sells
  // nothing from the operator shell, and its drawer rendered as a dead panel
  // pinned over the right third of every page.

  // When the app is rendered inside an iframe (ApprovePro's embedded WPW
  // proof / DesignPro panels), strip the global chrome — header, footer,
  // tool navs, cart, helpers — so the embedded page fills the frame instead
  // of stacking a second full app UI inside the window (wasted + cut off).
  const inIframe = (() => {
    try { return typeof window !== "undefined" && window.self !== window.top; }
    catch { return true; }
  })();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppCartProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
          <BrowserRouter>
            <MetaPixel />
            <CanonicalTag />
            <SessionGuard>
            <ScrollToTop />
            <AnalyticsRouteTracker />
            <div className="min-h-[100dvh] pb-16 md:pb-0 relative">
            {/* Planet decor - floating on every page */}
            <img src="/sprocket/planet-purple.png" alt="" className="fixed top-20 right-[-40px] w-20 sm:w-28 opacity-15 pointer-events-none z-0 hidden md:block" style={{ animation: 'float 6s ease-in-out infinite' }} />
            <img src="/sprocket/planet-cyan.png" alt="" className="fixed bottom-32 left-[-20px] w-16 sm:w-24 opacity-10 pointer-events-none z-0 hidden md:block" style={{ animation: 'float 8s ease-in-out infinite 2s' }} />
            {!inIframe && <Header />}
            {/* RestyleProQuestionsWidget removed: a second floating helper stacked
                on top of SprocketHelper in the bottom-left corner, so the two
                pills overlapped and its bubble covered the Vehicle Type field on
                the generation form. SprocketHelper is the DesignProAI one. */}
            {!inIframe && <SprocketHelper />}
            {/* OwnerSprocketDock unmounted 2026-08-04 (Trish): its bottom-left
                chip floated over page content. The component is kept in the
                repo — re-add <OwnerSprocketDock /> here to bring it back. */}
            <DeployVersionWatcher />
            <AppShell>
            <ErrorBoundary>
            <Suspense fallback={<Loading />}>
            <Routes>
          <Route path="/" element={<HostAwareRoot />} />
          <Route path="/dashboard" element={<RequireAuth><RestyleDashboard /></RequireAuth>} />
          {/* Free-designs promo retired — the "3 free designs" offer has ended.
              Redirect any inbound traffic (old emails, SMS, ads, QR codes) to
              /pricing, matching the /wpw-offer redirect below. */}
          {/* Single unified studio page — the real brief + big Konva canvas.
              /create is the deleted duplicate → redirect so nothing splits. */}
          {/* ── The server-owned DesignProAI operating path ──────────────
              Calls 1-7 generate the seven immutable source views; Calls 8-12
              turn them into a verified production pack. Every one of these
              surfaces reports state the gateway owns. The legacy browser-side
              orchestration pages below redirect in here rather than 404,
              because the edge functions they drove are not part of this
              standalone system. */}
          <Route path="/designpro" element={<RequireAuth><DesignProAIHome /></RequireAuth>} />
          <Route path="/designpro/jobs" element={<RequireAuth><DesignProJobs /></RequireAuth>} />
          <Route path="/designpro/jobs/:generationId" element={<RequireAuth><DesignProWorkflow /></RequireAuth>} />
          <Route path="/designpro/generate" element={<RequireAuth><DesignProGenerate /></RequireAuth>} />
          <Route path="/designpro/revisions/new" element={<RequireAuth><DesignProNewRevision /></RequireAuth>} />
          <Route path="/designpro/genie-qc" element={<RequireAuth><DesignProGenieQc /></RequireAuth>} />
          <Route path="/designpro/wrapbox" element={<RequireAuth><DesignProWrapBox /></RequireAuth>} />
          <Route path="/designpro/wrapbox/:packId" element={<RequireAuth><DesignProWrapBoxPack /></RequireAuth>} />
          {/* Artboard-first drove designpro-flat-art / designpro-recreate-3d from
              the browser -- a second design producer beside Calls 1-7, and the
              flat-first projection the design path was deliberately taken off.
              The runtime owns generation, so this redirects rather than 404s. */}
          <Route path="/designpro/artboard-first" element={<Navigate to="/designpro" replace />} />
          {/* CarWrapPro™ — public SEO/AEO product page + the Design Assets admin production page */}
          {/* DesignPro v2 object-graph engine — isolated experimental module, admin test bench only */}
          <Route path="/admin/designpro-v2-test" element={<RequireAdmin><AdminDesignProV2Test /></RequireAdmin>} />
          <Route path="/designpro/panel-sizer" element={<RequireAuth><PanelSizer /></RequireAuth>} />
          <Route path="/designpro/create" element={<RequireAuth><DesignPanelProPremium /></RequireAuth>} />
          <Route path="/designpro/studio" element={<RequireAuth><DesignProStudio /></RequireAuth>} />
          <Route path="/designpro/jobs/:generationId/panel-studio" element={<RequireAuth><DesignProStudio /></RequireAuth>} />
          <Route path="/designpro/jobs/:generationId/panelpro" element={<RequireAuth><PanelProStudioBoard /></RequireAuth>} />
          <Route path="/designpro/jobs/:generationId/progress" element={<RequireAuth><GenieProgress /></RequireAuth>} />
          <Route path="/designpro/premium" element={<RequireAuth><DesignPanelProPremium /></RequireAuth>} />
          <Route path="/designpro/raster" element={<RequireAuth><DesignStudio /></RequireAuth>} />
          {/* FadeWrap generator hidden — use DesignProAI for fade wraps via prompt */}
          {/* /restylelibrary is a RestylePro surface this system does not
              serve, so this redirect used to land on the 404 page. */}
          <Route path="/designpanelpro" element={<RequireAuth><DesignPanelProPremium /></RequireAuth>} />
          <Route path="/designpanelpro/premium" element={<RequireAuth><DesignPanelProPremium /></RequireAuth>} />
          <Route path="/approvemode" element={<ApproveProUnavailable />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/designpanelpro-manager" element={<AdminDesignPanelProManager />} />
          <Route path="/admin/production-packs" element={<AdminProductionPacks />} />
          <Route path="/admin/production-test" element={<AdminProductionTest />} />
          <Route path="/admin/gallery" element={<AdminGallery />} />
          <Route path="/admin/approve-revisions" element={<ApproveProUnavailable />} />
          <Route path="/admin/production-files" element={<RequireAdmin><AdminProductionFiles /></RequireAdmin>} />
          <Route path="/admin/gallery-manager" element={<AdminGalleryManager />} />
          {/* /admin/quick-quote was the old Quote Management page. The user
              consolidated onto /quotes (working action icons + MightyMail
              + inbound). This route just redirects so external links keep
              working. Pricing/branding lives at /admin/quote-pricing. */}
          {/* Legacy QC pages retired. Production Layers on the job page is the
              one QC surface: it consumes Calls 9-11 and regenerates nothing. */}
          {/* The Content OS status screen. Admin-guarded rather than RequireAuth
              because it reports queue depth, spend and failure counts across
              every brand — operator information, not customer information. */}
          {/* Standalone Content Calendar retired (duplicate of the Marketing Hub
              calendar tab — owner decision 2026-07-28: the Hub tab is canonical). */}
          {/* Queue merge (Content OS priority 1): the second approval queue is
              retired — the Content Director is THE one queue. Bookmarks and
              Canva OAuth returns land here, so keep the redirect forever. */}
          {/* WPW-tenant Engine Room — scoped to WePrintWraps internal team */}
          <Route path="/admin/print-production" element={<RequireAdmin><AdminPrintProduction /></RequireAdmin>} />
          {/* Builder removed — it cropped the vehicle proof (distorted output). Use the deterministic export. */}
          {/* THE CANONICAL REVISIONSTUDIO. `RevisionStudioIQ.tsx` is the
              migrated product editor -- the design grid, the seven-view
              carousel, GalleryMode, the layered canvas, the revision box and
              Production Layers. It was unrouted while its data layer still
              read RestylePro tables, and this route redirected away to the job
              list instead, which is how a status page came to stand in for the
              product. The data layer is now `dpApi` end to end, so the page it
              was always meant to be is what /revision-studio renders. */}
          <Route path="/revision-studio" element={<RequireAuth><RevisionStudioIQ /></RequireAuth>} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/printpro/designpanelpro" element={<DesignPanelProPrintedProductPage />} />
          <Route path="/printpro/production" element={<PrintProductionPipeline />} />
          <Route path="/printpro/production-os" element={<ProductionOS />} />
          <Route path="/wrapbox" element={<Navigate to="/designpro/wrapbox" replace />} />
          {/* SEO: individual design pages (declare before the category
              catch so `/design/:id` never resolves as a category). */}
          {/* ProductionFlow drove run-production-flow / generate-2d-proof from
              the browser. The runtime owns the whole pipeline now, so the job
              page is the one place a job's state is reported. */}
          <Route path="/productionflow" element={<Navigate to="/designpro/jobs" replace />} />
          {/* The GENIE progress page exists again, server-backed. The bare
              /productionflow still lands on the job list because it names no job. */}
          <Route path="/productionflow/:generationId" element={<RequireAuth><GenieProgress /></RequireAuth>} />
          <Route path="/production-flow" element={<Navigate to="/designpro/jobs" replace />} />
          {/* Designer-side production QC — files land here first; writes to the SAME
              panelizer_jobs row the customer GENIE page on ProductionFlow polls. */}
          {/* RecreatePro is now a single flow inside ProductionFlow's prep tab */}
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth" element={<Navigate to="/login" replace />} />
          {/* /wpw-offer, /wpw-offer-vertical, /launch, /launch-vertical retired —
              redirect any inbound traffic (old emails, SMS, ads) to /pricing */}

          <Route path="/gallery/:vehicleSlug" element={<VehicleGallery />} />
          {/* Proof Approval System (Phase 2) — public client sign page */}
          <Route path="/approve/:token" element={<ApproveProUnavailable />} />
          {/* Proof Approval System (Phase 3) — shop-side review + push new version */}
          <Route path="/approve/manage/:token" element={<ApproveProUnavailable />} />
          {/* Proof Approval System (Phase 5) — admin Tier-3 support dashboard */}
          {/* Proof Approval System (Phase 7) — shop owner dashboard.
              Folded into ApprovePro: /proofs was a strict subset of the
              workbench, so one job no longer lives in two places. Redirect
              keeps old links/bookmarks working. */}
          {/* ApprovePro — shop workbench (split pane: orders list + detail) */}
          <Route path="/approvepro" element={<ApproveProUnavailable />} />
          {/* The workspace listed designs out of color_visualizations and their
              built panels out of production_flow_assets. Both are RestylePro
              tables; the jobs list is the standalone equivalent and is keyed by
              the generationId everything downstream already uses. */}
          <Route path="/designpanelpro-workspace" element={<Navigate to="/designpro/jobs" replace />} />
          <Route path="/production-proof" element={<RequireAdmin><ProductionProof /></RequireAdmin>} />
          {/* Multi-window render queue */}
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
            </Suspense>
            </ErrorBoundary>
            </AppShell>
            </div>
        {!inIframe && (
          <HideOnCustomerProof>
        <Footer />
          <MobileToolNav />
          <DesktopToolNav />
          <OfflineBanner />
          <WaitlistPopup />
          <PaywallTokenModal />
          <PackPaymentResume />
          <ReportIssueWidget />
          <CorporateOnboardingWizard />
          <ShopOnboardingWizard />
          <WpwConnectPortalWizard />
          <AdminViewAsCustomerToggle />
          </HideOnCustomerProof>
        )}
            </SessionGuard>
        </BrowserRouter>
      </TooltipProvider>
    </AppCartProvider>
  </ThemeProvider>
</QueryClientProvider>
  );
};

export default App;
