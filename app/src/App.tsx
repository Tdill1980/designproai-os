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
const WallPro = lazyWithRetry(() => import("./pages/WallPro"));
const WallProLanding = lazyWithRetry(() => import("./pages/WallProLanding"));
const AdminWallProLanding = lazyWithRetry(() => import("./pages/AdminWallProLanding"));
// MY SHOPFLOW — the WePrintWraps account page, ported from restylepro-os
// 2026-09-15. It replaces weprintwraps.com/my-account/ (see
// wordpress/wpw-shopflow-account), so it is PUBLIC on purpose: its door is an
// email proven with one order number, not a RestylePro session. Almost no WPW
// customer has an account here — 8 of 809 distinct customer emails — so behind
// a sign-in wall this page reaches nobody, which is the dead end it replaced.
const ShopFlow = lazyWithRetry(() => import("./pages/ShopFlow"));
const DesignProofs = lazyWithRetry(() => import("./pages/DesignProofs"));
// The WallPro case study: one real wall, bare to installed.
const WallProCaseStudy = lazyWithRetry(() => import("./pages/WallProCaseStudy"));
// The WallPro FAQ: the corner/mask geometry, the panelizer pipeline, the prices.
const WallProFaq = lazyWithRetry(() => import("./pages/WallProFaq"));
const AdminWallProBatch = lazyWithRetry(() => import("./pages/AdminWallProBatch"));
// PatternPro worn by a partner: the WePrintWraps pattern-wrap page (owner,
// 2026-09-15: "all these need to be in os.designpro repo"). Same tool as the
// DesignPro route, different words in the header — see lib/patternpro-brand.ts.
const PatternWrap = lazyWithRetry(() => import("./pages/PatternWrap"));
// PatternPro's paid path (phase 2): Stripe sends the buyer back here, and the
// design team runs the library and the order board from the two admin pages.
const WBTYOrderSuccess = lazyWithRetry(() => import("./pages/WBTYOrderSuccess"));
const AdminWBTYManager = lazyWithRetry(() => import("./pages/AdminWBTYManager"));
const AdminWBTYOrders = lazyWithRetry(() => import("./pages/AdminWBTYOrders"));
// GraphicsPro — cut-contour graphics on a wall, a vehicle or a storefront.
// The V1 tool is the product (surface → Konva ZoneMasker on the customer's
// photo → mockup → cut graphics proof / CutContour PDF / production files).
// It was carried into this repo intact and never routed; see
// docs/GRAPHICSPRO-END-TO-END.md.
const GraphicsProV1 = lazyWithRetry(() => import("./pages/GraphicsProV1"));
const GraphicsProWall = lazyWithRetry(() => import("./pages/GraphicsProWall"));
const GraphicsProWindow = lazyWithRetry(() => import("./pages/GraphicsProWindow"));
// The GraphicsPro FAQ: the cut-vinyl rates, the plotter files, the pipeline.
const GraphicsProFaq = lazyWithRetry(() => import("./pages/GraphicsProFaq"));
// The before/after band, run by the curator instead of by a release.
const AdminWallProProofs = lazyWithRetry(() => import("./pages/AdminWallProProofs"));
// The WallPro answer to the vehicle PanelPro board: every generation, whether it
// took, designer QC and the release gate (owner, 2026-09-12).
const WallPanelProStudio = lazyWithRetry(() => import("./pages/WallPanelProStudio"));
import { SessionGuard } from "@/components/SessionGuard";
import { RequireAdmin } from "@/components/RequireAdmin";
import { RequirePanelOutputReviewer } from "@/components/RequirePanelOutputReviewer";
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
import { isDesignProMarketingHost, isWallProPartnerHost } from "@/lib/designpro-host-routing";
import { OS_TOOL_ALIASES, activeOsTool } from "@/lib/os-brand";
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
const AdminGeminiCompareStudio = lazyWithRetry(() => import("./pages/AdminGeminiCompareStudio"));
const GenieProgress = lazyWithRetry(() => import("./pages/designpro/GenieProgress"));
const PanelProFileOutput = lazyWithRetry(() => import("./pages/PanelProFileOutput"));
const PanelProFileOutputPreparation = lazyWithRetry(() => import("./pages/PanelProFileOutput").then((module) => ({ default: module.PanelProFileOutputPreparation })));
const PanelProTemplateReview = lazyWithRetry(() => import("./pages/PanelProTemplateReview"));
const DesignProGenieQc = lazyWithRetry(() => import("./pages/designpro/GenieQc"));
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
const ResetPasswordRequest = lazyWithRetry(() => import("./pages/ResetPasswordRequest"));
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
  // A partner host serves ONE thing at its root. Someone who clicked "Wall
  // Wrap" on weprintwraps.com and landed on wallpro.weprintwraps.com is asking
  // for the wall wrap page, not a DesignProAI dashboard or a login wall. Every
  // other route still resolves normally on that host, so /printpro/wallpro is
  // the designer and existing deep links keep working.
  // THE PARTNER'S FRONT DOOR IS THEIR LANDING, not the bare tool (2026-09-17).
  // /wall-wrap became the landing and this line still returned the tool, so the
  // same brand would have behaved two different ways depending on whether the
  // customer arrived by host or by path — the drift the brand-aware page exists
  // to remove. A domain root serves the landing; the tool is one click in, at
  // /wallwrap-design, exactly as /wallpro → /printpro/wallpro on this host.
  if (isWallProPartnerHost(hostname)) return <WallProLanding brand="weprintwraps" />;
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
/**
 * A PARTNER'S PRODUCT PAGE IS NOT A DESIGNPROAI PAGE.
 *
 * The WePrintWraps wall wrap product page carries its own header and sells
 * WePrintWraps' product. The DesignProAI marketing chrome on top of it -- a nav
 * reading "Vehicle Wrap Design System" above a wall wrap, a Start Free button,
 * the footer -- contradicts the page and breaks the brand continuity the whole
 * subdomain exists to protect. So the partner routes render standalone, the
 * same way the customer proof portal already does.
 */
/**
 * A TOOL PAGE IS NOT A WEBSITE (owner, 2026-09-16: "SHOULD LOOK LIKE A TOOL
 * PAGE IN A SAAS NOT A WEBSITE").
 *
 * On /printpro/wallpro the app shell already supplies the SaaS chrome -- a
 * branded left sidebar with the plan, the tool list and the account links --
 * and the marketing <Header> renders ON TOP of it: a second brand lockup, a
 * second navigation, Home/Design/Output/Profit dropdowns above a page that has
 * all of that in the rail. Two navigations for one product is what makes it
 * read as a website with an app bolted inside.
 *
 * SCOPED TO WALLPRO ON PURPOSE. Header.tsx says in as many words that it is
 * "now persistent on every route (marketing + app)" -- a deliberate decision
 * someone made, and other app pages may lean on it for navigation. Reversing
 * that across twenty-odd routes is a product decision, not a fix, so this
 * removes the duplication where it was reported and nowhere else. Extending it
 * is one more entry in this predicate once that call is made.
 */
/**
 * SCOPED TO WALLPRO NO LONGER. The comment this predicate carried on
 * 2026-09-16 named the extension explicitly: "Extending it is one more entry
 * in this predicate once that call is made." VehiclePro and CutPro were
 * shown carrying the exact double-navigation WallPro's fix removed — the
 * marketing <Header> (Home/Design/Output/Profit) stacked on top of the same
 * AppSidebar rail — so they join it here. Each now owns its own sticky
 * ToolHeader (see ToolHeader.tsx), reusing os-brand.ts's own route list so
 * this predicate and the sidebar's active-tool detection can never disagree
 * about which routes are "inside a tool".
 */
const isSelfHeaderedToolRoute = (pathname: string) =>
  Boolean(activeOsTool(pathname)) ||
  pathname === "/wallpro" ||
  pathname === "/printpro/wallpro" || pathname.startsWith("/printpro/wallpro/");

const isWallProPartnerRoute = (pathname: string, hostname: string) =>
  pathname === "/wall-wrap" ||
  // The case study wears the same partner header and must not get DesignProAI
  // chrome stacked on top of it either.
  pathname === "/wall-wrap/how-it-works" ||
  pathname === "/wall-wrap/faq" ||
  pathname === "/wallwrap-design" ||
  // PatternPro's partner page carries the same WePrintWraps header.
  pathname === "/pattern-wrap" ||
  (pathname === "/" && isWallProPartnerHost(hostname));

const HideOnCustomerProof = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  // Full-screen ApprovedPro surfaces render their own app shell, so strip the
  // global marketing chrome: the customer proof portal (/approve/*) and the
  // owner ApprovedPro dashboard both fill the window like a standalone app.
  const isStandaloneApprovedPro =
    (pathname.startsWith("/approve/") && !pathname.startsWith("/approve/manage")) ||
    pathname === "/admin/approve-revisions";
  const hostname = typeof window === "undefined" ? "" : window.location.hostname;
  if (isStandaloneApprovedPro || isWallProPartnerRoute(pathname, hostname) || isSelfHeaderedToolRoute(pathname)) return null;
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
            {/* The partner's product page carries its own header; the
                DesignProAI nav on top of it contradicts the brand. Also
                unmounts the Sprocket helper and the decorative planets there --
                a chat bubble sitting over the price of a wall wrap is not what
                "premium" reads like. */}
            {!inIframe && <HideOnCustomerProof><Header /></HideOnCustomerProof>}
            {/* RestyleProQuestionsWidget removed: a second floating helper stacked
                on top of SprocketHelper in the bottom-left corner, so the two
                pills overlapped and its bubble covered the Vehicle Type field on
                the generation form. SprocketHelper is the DesignProAI one. */}
            {!inIframe && <HideOnCustomerProof><SprocketHelper /></HideOnCustomerProof>}
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
          <Route path="/designpro/revisions/new" element={<RequireAuth><Navigate to="/designpro" replace /></RequireAuth>} />
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
          {/* THE PANELPRO ROUTE IS THE ADMIN STUDIO. It is the design team's
              complete production control room for one order: job header,
              every A.T.L.A.S. version with the prompt that made it, the six
              surfaces with their proofs and panels, the logo inventory, the
              correction bench, human QC, RUN UPSCALE, Build Print Files and
              the Production Pack / ZIP / WrapBox record.

              The Admin Studio was routed at /designpro/studio-board -- a URL
              nobody asked for -- while this one, the URL the team actually
              opens, kept the per-surface validator. So the full workspace was
              deployed and unreachable in practice, which is indistinguishable
              from not having built it.

              The per-surface board keeps its own URL below. It is the
              proof-beside-panel validation view, not the workspace, and
              nothing is lost by moving it one path down. */}
          <Route path="/designpro/jobs/:generationId/panelpro" element={<RequireAuth><AdminGeminiCompareStudio /></RequireAuth>} />
          <Route path="/designpro/jobs/:generationId/panelpro/surfaces" element={<RequireAuth><PanelProStudioBoard /></RequireAuth>} />
          <Route path="/designpro/studio-board" element={<RequireAuth><AdminGeminiCompareStudio /></RequireAuth>} />
          <Route path="/panelpro-file-output" element={<RequireAuth><PanelProFileOutput /></RequireAuth>} />
          <Route path="/panelpro-file-output/runs/:runId" element={<RequireAuth><PanelProFileOutput /></RequireAuth>} />
          <Route path="/panelpro-file-output/prepare" element={<RequireAuth><RequirePanelOutputReviewer capability="canPrepare"><PanelProFileOutputPreparation /></RequirePanelOutputReviewer></RequireAuth>} />
          <Route path="/panelpro-file-output/templates" element={<RequireAuth><RequirePanelOutputReviewer capability="canReview"><PanelProTemplateReview /></RequirePanelOutputReviewer></RequireAuth>} />
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
          <Route path="/printpro/wallpro" element={<WallPro />} />
          {/* THE PRODUCT PAGE. Owner, 2026-09-14: "No its THE Product Page ...
              that they will purchase design and files and print from", and it
              "should BE the tool". So both jumbo-menu entries render the REAL
              designer wearing the WePrintWraps name -- photo upload, corner
              pinning, the five entry paths, style reference, match upload,
              before/after, print files -- with the design/files checkout and
              the WooCommerce print purchase on the same page. It is the same
              component as /printpro/wallpro, never a copy, so a fix can never
              land on one and miss the other.
              /wall-wrap mirrors the WPW product slug; /wallwrap-design is the
              Design-area entry, its own URL so the two menu items stay
              separately measurable rather than one link pretending to be two. */}
          {/* THE PARTNER'S LANDING, mirroring DesignProAI's /wallpro exactly
              (owner, 2026-09-17: "wpw wallpro was the old UI, didn't have the
              edits I asked for"). /wall-wrap showed the TOOL because #462 built
              the landing for DesignProAI only, so the partner page was the one
              WallPro surface with no landing — and it is the one shown to the
              partner. The TOOL did not move: it has answered /wallwrap-design
              since the tenant shipped, and every CTA here points at it. */}
          <Route path="/wall-wrap" element={<WallProLanding brand="weprintwraps" />} />
          {/* PUBLIC on purpose — the access check lives in wpw-shopflow, not the
              route. See the note on the import above. */}
          <Route path="/shopflow" element={<ShopFlow />} />
          <Route path="/design-proofs" element={<DesignProofs />} />
          <Route path="/wallwrap-design" element={<WallPro brand="weprintwraps" />} />
          {/* The case study: one real wall, bare to installed. Its numbers and
              diagrams are computed by the tool's own libraries, so it cannot
              drift from the product the way a page of screenshots would. */}
          {/* TWO VERSIONS, ONE COMPONENT (owner, 2026-09-16: "I need it to be a
              wallpro page on os.designpro — the WPW version is another
              version"). /wall-wrap/how-it-works is the partner's, with their
              mark, their film price and their order button; the DesignProAI one
              lives beside the tool it belongs to and carries none of that. The
              /printpro/wallpro/ prefix also puts it under isSelfHeaderedToolRoute,
              so it wears the app shell rather than the marketing nav. */}
          <Route path="/wall-wrap/how-it-works" element={<WallProCaseStudy brand="weprintwraps" />} />
          <Route path="/printpro/wallpro/how-it-works" element={<WallProCaseStudy />} />
          {/* The FAQ, the same way and for the same reason. It carries the
              corner/mask geometry the editor actually draws, the GENIE Wall
              Panelizer rail, and the price ladder -- all read from the
              product's own code, so it is wrong only if the product is. */}
          <Route path="/wall-wrap/faq" element={<WallProFaq brand="weprintwraps" />} />
          <Route path="/printpro/wallpro/faq" element={<WallProFaq />} />
          {/* PATTERNPRO, the same way: one component, worn by a brand. /pattern-wrap
              is the WePrintWraps page (white, blue gradient, WPW mark in the
              lockup, a render on the right); /printpro/patternpro is the same
              tool under the DesignProAI name. Owner, 2026-09-15. */}
          {/* TWO PATTERNPRO PAGES ON THIS HOST, ON PURPOSE (owner, 2026-09-16: "I
              should have a WPW PatternPro page and a stand alone PatternPro page
              both on the os.designpro — WPW is a tenant and I need to sell
              DesignPro to other shops"). /pattern-wrap is the WePrintWraps
              TENANT page, on every host this app serves, exactly like
              /wall-wrap; /printpro/patternpro is the standalone DesignProAI
              page the OS sidebar links. Same component, one brand switch —
              the next tenant is one entry in PATTERN_BRANDS and one route. */}
          <Route path="/pattern-wrap" element={<PatternWrap brand="weprintwraps" />} />
          <Route path="/printpro/patternpro" element={<PatternWrap />} />
          {/* /wbty is PatternPro's old address (the suite's sidebar still says
              it); the tool lives at /printpro/patternpro here. The order-success
              page keeps the /wbty path because create-wbty-checkout's Stripe
              success_url names it. */}
          <Route path="/wbty" element={<Navigate to="/printpro/patternpro" replace />} />
          <Route path="/wbty/order-success" element={<WBTYOrderSuccess />} />
          <Route path="/admin/wallpro-batch" element={<RequireAdmin><AdminWallProBatch /></RequireAdmin>} />
          {/* ONE WALL QC SURFACE (owner, 2026-09-16: "The QC page should be part
              of wallpanelpro admin that's the entire point ... Yes I need qc
              gate"). /admin/wallpro-production was a read-only download board
              with NO release control in it -- measured: zero QC or release
              references in the whole file -- while WallPanelProStudio carries
              the real gate: the per-check list, canRelease refusing until every
              applicable check is ticked, Release for print, Hold, and a review
              history where a later verdict supersedes without erasing.
              Two boards meant the team could be looking at print files on a
              page that cannot release them, which is how a job sits "ready"
              with nobody realising a human still has to sign it.
              REDIRECTED, NOT DELETED: the path is in the team's hands and in
              the sidebar, and a dead bookmark on a production tool is its own
              small outage. The page file is retired with the route. */}
          <Route path="/admin/wallpro-production" element={<Navigate to="/wallpanelprostudio" replace />} />
          <Route path="/admin/wallpro-proofs" element={<RequireAdmin><AdminWallProProofs /></RequireAdmin>} />
          <Route path="/admin/wbty-manager" element={<RequireAdmin><AdminWBTYManager /></RequireAdmin>} />
          <Route path="/admin/wbty-orders" element={<RequireAdmin><AdminWBTYOrders /></RequireAdmin>} />
          {/* WallPanelProStudio, named as the owner names it. Index by DesignID,
              then one design with its version rail. */}
          <Route path="/wallpanelprostudio" element={<RequireAdmin><WallPanelProStudio /></RequireAdmin>} />
          <Route path="/wallpanelprostudio/:projectId" element={<RequireAdmin><WallPanelProStudio /></RequireAdmin>} />
          <Route path="/admin/wallpro-studio" element={<Navigate to="/wallpanelprostudio" replace />} />
          <Route path="/wallpro" element={<WallProLanding />} />
          <Route path="/admin/wallpro-landing" element={<RequireAdmin><AdminWallProLanding /></RequireAdmin>} />
          <Route path="/graphics-pro" element={<RequireAuth><GraphicsProV1 /></RequireAuth>} />
          <Route path="/graphics-pro-wall" element={<RequireAuth><GraphicsProWall /></RequireAuth>} />
          <Route path="/graphics-pro-window" element={<RequireAuth><GraphicsProWindow /></RequireAuth>} />
          {/* PUBLIC, unlike the three tool routes. It is the page that
              answers "what does this cost" -- gating that behind a sign-in
              asks somebody to create an account to read a price list. */}
          <Route path="/graphics-pro/faq" element={<GraphicsProFaq />} />
          <Route path="/graphicspro" element={<Navigate to="/graphics-pro" replace />} />
          {/* CUSTOMER-FACING NAME ALIASES (os-brand.ts, Trish 2026-09-16). The vehicle
              tool is VehiclePro and the cut tool is CutPro in every customer-facing
              word, but their routes are the ones above and stay so: bookmarks,
              emails, analytics and stored project links all carry them. These
              short names redirect INTO the served routes; nothing redirects out. */}
          {OS_TOOL_ALIASES.map((alias) => (
            <Route key={alias.from} path={alias.from} element={<Navigate to={alias.to} replace />} />
          ))}
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
          {/* The login page has linked here since the shell was copied, but
              the route was never served -- "set a password" landed on the
              404, which is why password login looked impossible. */}
          <Route path="/reset-password-request" element={<ResetPasswordRequest />} />
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
