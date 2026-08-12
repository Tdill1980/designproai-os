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
import RestyleProQuestionsWidget from "@/components/restylepro/RestyleProQuestionsWidget";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppCartProvider } from "@/contexts/AppCartContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { MetaPixel } from "@/components/MetaPixel";
import { AppCartBubble } from "@/components/AppCartBubble";
import { AppCartDrawer } from "@/components/AppCartDrawer";
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

// ── Lazy imports - Core tools ────────────────────────────────────
const ColorPro = lazyWithRetry(() => import("./pages/ColorPro"));
const AdminMarketingAgent = lazyWithRetry(() => import("./pages/AdminMarketingAgent"));
const AdminContentOS = lazyWithRetry(() => import("./pages/AdminContentOS"));
const AdminNarrativeArcs = lazyWithRetry(() => import("./pages/AdminNarrativeArcs"));
const GraphicsPro = lazyWithRetry(() => import("./pages/GraphicsPro"));
const GraphicsProV1 = lazyWithRetry(() => import("./pages/GraphicsProV1"));
const GraphicsProWall = lazyWithRetry(() => import("./pages/GraphicsProWall"));
const DesignPro = lazyWithRetry(() => import("./pages/DesignPro"));
const FlattenTool = lazyWithRetry(() => import("./pages/FlattenTool"));
const DesignAssets = lazyWithRetry(() => import("./pages/DesignAssets"));
const DesignPanelProPremium = lazyWithRetry(() => import("./pages/DesignPanelProPremium"));
const ArtboardFirstDesignPro = lazyWithRetry(() => import("./pages/ArtboardFirstDesignPro"));
const AdminCarWrapPro = lazyWithRetry(() => import("./pages/AdminCarWrapPro"));
const AdminPanelArtboard = lazyWithRetry(() => import("./pages/AdminPanelArtboard"));
const AdminDesignProV2Test = lazyWithRetry(() => import("./pages/AdminDesignProV2Test"));
const CarWrapProLanding = lazyWithRetry(() => import("./pages/CarWrapProLanding"));
const PanelSizer = lazyWithRetry(() => import("./pages/PanelSizer"));
const DesignProAIHome = lazyWithRetry(() => import("./pages/DesignProAIHome"));
const DesignStudio = lazyWithRetry(() => import("./pages/DesignStudio"));
const DesignProStudio = lazyWithRetry(() => import("./pages/DesignProStudio"));
const LogoPro = lazyWithRetry(() => import("./pages/LogoPro"));
const FadeWraps = lazyWithRetry(() => import("./pages/FadeWraps"));
const WBTY = lazyWithRetry(() => import("./pages/WBTY"));
const WBTYOrderSuccess = lazyWithRetry(() => import("./pages/WBTYOrderSuccess"));
const ApproveMode = lazyWithRetry(() => import("./pages/ApproveMode"));
const Visualize = lazyWithRetry(() => import("./pages/Visualize"));
const DesignProAISuite = lazyWithRetry(() => import("./pages/DesignProAISuite"));
const MaterialMode = lazyWithRetry(() => import("./pages/MaterialMode"));
const MyVehiclePro = lazyWithRetry(() => import("./pages/MyVehiclePro"));
const QuickQuotePage = lazyWithRetry(() => import("./pages/QuickQuotePage"));
const QuoteToolProduct = lazyWithRetry(() => import("./pages/QuoteToolProduct"));
const PublicQuotePage = lazyWithRetry(() => import("./pages/PublicQuotePage"));
const TryDesign = lazyWithRetry(() => import("./pages/TryDesign"));
const WrapTVSubmit = lazyWithRetry(() => import("./pages/WrapTVSubmit"));
const WrapTVWorld = lazyWithRetry(() => import("./pages/WrapTVWorld"));
const WrapTVShow = lazyWithRetry(() => import("./pages/WrapTVShow"));
const TryDesignSuccess = lazyWithRetry(() => import("./pages/TryDesignSuccess"));
const ClubWpwDrop = lazyWithRetry(() => import("./pages/ClubWpwDrop"));
const WpwWrapCalculator = lazyWithRetry(() => import("./pages/WpwWrapCalculator"));
const WrapGuru = lazyWithRetry(() => import("./pages/WrapGuru"));
const AdminWotwWinners = lazyWithRetry(() => import("./pages/AdminWotwWinners"));
const PreviewModal = lazyWithRetry(() => import("./pages/PreviewModal"));
const WpwRepLanding = lazyWithRetry(() => import("./pages/WpwRepLanding"));
const HelpRestyleProWalkthrough = lazyWithRetry(() => import("./pages/HelpRestyleProWalkthrough"));
const HelpWpwRepGuide = lazyWithRetry(() => import("./pages/HelpWpwRepGuide"));
const HowToProductionPack = lazyWithRetry(() => import("./pages/HowToProductionPack"));
const SellKit = lazyWithRetry(() => import("./pages/SellKit"));
const SubAccountQuotePage = lazyWithRetry(() => import("./pages/SubAccountQuotePage"));
const AdminAvailability = lazyWithRetry(() => import("./pages/AdminAvailability"));
const AdminShopPricing = lazyWithRetry(() => import("./pages/AdminShopPricing"));
const QuikTextApprove = lazyWithRetry(() => import("./pages/QuikTextApprove"));
const RevisionStudioIQ = lazyWithRetry(() => import("./pages/RevisionStudioIQ"));
const WrapBox = lazyWithRetry(() => import("./pages/WrapBox"));
const DesignVault = lazyWithRetry(() => import("./pages/DesignVault"));
const CreatorMarket = lazyWithRetry(() => import("./pages/CreatorMarket"));
const CreatorMarketCategory = lazyWithRetry(() => import("./pages/CreatorMarketCategory"));
const CreatorMarketDesign = lazyWithRetry(() => import("./pages/CreatorMarketDesign"));
const PanelLab = lazyWithRetry(() => import("@/pages/PanelLab"));
const ProofViewer = lazyWithRetry(() => import("./pages/ProofViewer"));
const Proof = lazyWithRetry(() => import("./pages/Proof"));
const ProofManage = lazyWithRetry(() => import("./pages/ProofManage"));
const Proofs = lazyWithRetry(() => import("./pages/Proofs"));
const AdminProofSupport = lazyWithRetry(() => import("./pages/AdminProofSupport"));
const AdminSprocketAgent = lazyWithRetry(() => import("./pages/AdminSprocketAgent"));
const AdminWrapGuruChats = lazyWithRetry(() => import("./pages/AdminWrapGuruChats"));
const AdminAgentTest = lazyWithRetry(() => import("./pages/AdminAgentTest"));
const ApproveProPage = lazyWithRetry(() => import("./pages/ApproveProPage"));
const DesignPanelProWorkspace = lazyWithRetry(() => import("./pages/DesignPanelProWorkspace"));
const ProductionProof = lazyWithRetry(() => import("./pages/ProductionProof"));
const RenderQueue = lazyWithRetry(() => import("./pages/RenderQueue"));

// ── Lazy imports - User pages ────────────────────────────────────
const RestyleDashboard = lazyWithRetry(() => import("./pages/RestyleDashboard"));
const MyWpwOrders = lazyWithRetry(() => import("./pages/MyWpwOrders"));
const TeamOrders = lazyWithRetry(() => import("./pages/TeamOrders"));
const WpwProofSheet = lazyWithRetry(() => import("./pages/WpwProofSheet"));
const WpwOrderPrint = lazyWithRetry(() => import("./pages/WpwOrderPrint"));
const Quotes = lazyWithRetry(() => import("./pages/Quotes"));
const MightyMail = lazyWithRetry(() => import("./pages/MightyMail"));
const MightyMailInfo = lazyWithRetry(() => import("./pages/MightyMailInfo"));
const WpwConnectPortal = lazyWithRetry(() => import("./pages/WpwConnectPortal"));
const MyRenders = lazyWithRetry(() => import("./pages/MyRenders"));
const MyDesigns = lazyWithRetry(() => import("./pages/MyDesigns"));
const ShareDesign = lazyWithRetry(() => import("./pages/ShareDesign"));
const UserGuide = lazyWithRetry(() => import("./pages/UserGuide"));
const Pricing = lazyWithRetry(() => import("./pages/PricingColorPro"));
const Landing = lazyWithRetry(() => import("./pages/LandingPage"));
const PayPerUseLanding = lazyWithRetry(() => import("./pages/PayPerUseLanding"));
const Try = lazyWithRetry(() => import("./pages/Try"));
const AppCart = lazyWithRetry(() => import("./pages/AppCart"));
const Billing = lazyWithRetry(() => import("./pages/Billing"));
const ResetPasswordRequest = lazyWithRetry(() => import("./pages/ResetPasswordRequest"));
const ResetPassword = lazyWithRetry(() => import("./pages/ResetPassword"));
const FAQ = lazyWithRetry(() => import("./pages/FAQ"));
const FAQColorPro = lazyWithRetry(() => import("./pages/FAQColorPro"));
const FAQDesignPro = lazyWithRetry(() => import("./pages/FAQDesignPro"));
const FAQFadeWraps = lazyWithRetry(() => import("./pages/FAQFadeWraps"));
const FAQPhotorealisticRenders = lazyWithRetry(() => import("./pages/FAQPhotorealisticRenders"));
const FAQVehicleTypes = lazyWithRetry(() => import("./pages/FAQVehicleTypes"));
const FAQPricing = lazyWithRetry(() => import("./pages/FAQPricing"));
const Affiliate = lazyWithRetry(() => import("./pages/Affiliate"));
const Blog = lazyWithRetry(() => import("./pages/Blog"));
const BlogPostWrapCost2026 = lazyWithRetry(() => import("./pages/BlogPostWrapCost2026"));
const BlogPostWrapColors2026 = lazyWithRetry(() => import("./pages/BlogPostWrapColors2026"));
const BlogPostMattVsGloss = lazyWithRetry(() => import("./pages/BlogPostMattVsGloss"));
const BlogPost = lazyWithRetry(() => import("./pages/BlogPost"));
const BlogCover = lazyWithRetry(() => import("./pages/BlogCover"));
const VehicleGallery = lazyWithRetry(() => import("./pages/VehicleGallery"));
const Showcase = lazyWithRetry(() => import("./pages/Showcase"));
const DownloadSuccess = lazyWithRetry(() => import("./pages/DownloadSuccess"));
const CheckoutPage = lazyWithRetry(() => import("./pages/Checkout"));
const ProjectPass = lazyWithRetry(() => import("./pages/ProjectPass"));
const NeverMissALead = lazyWithRetry(() => import("./pages/NeverMissALead"));
const BookingPro = lazyWithRetry(() => import("./pages/BookingPro"));
const CheckoutReturn = lazyWithRetry(() => import("./pages/CheckoutReturn"));
const FleetServices = lazyWithRetry(() => import("./pages/FleetServices"));
const PublicBookingPage = lazyWithRetry(() => import("./pages/PublicBookingPage"));
const TesterWelcome = lazyWithRetry(() => import("./pages/TesterWelcome"));
const FromWePrintWraps = lazyWithRetry(() => import("./pages/FromWePrintWraps"));
const AdminCampaignVideos = lazyWithRetry(() => import("./pages/AdminCampaignVideos"));

const ShopSettings = lazyWithRetry(() => import("./pages/ShopSettings"));
const AcceptShopInvite = lazyWithRetry(() => import("./pages/AcceptShopInvite"));

// ── Lazy imports - PrintPro ──────────────────────────────────────
const PrintPro = lazyWithRetry(() => import("./pages/PrintPro"));
const PrintProShop = lazyWithRetry(() => import("./pages/PrintProShop"));
const WBTYPrintedProductPage = lazyWithRetry(() => import("./components/printpro/WBTYPrintedProductPage"));
const DesignPanelProPrintedProductPage = lazyWithRetry(() => import("./components/printpro/DesignPanelProPrintedProductPage"));
const FadeWrapPrintedProductPage = lazyWithRetry(() => import("./components/printpro/FadeWrapPrintedProductPage"));
const PrintableReflectiveProductPage = lazyWithRetry(() => import("./components/printpro/PrintableReflectiveProductPage"));
const FullDesignPrintPacksProductPage = lazyWithRetry(() => import("./components/printpro/FullDesignPrintPacksProductPage"));
const CustomPrintUploadProductPage = lazyWithRetry(() => import("./components/printpro/CustomPrintUploadProductPage"));
const PrintProductionPipeline = lazyWithRetry(() => import("./components/printpro/PrintProductionPipeline"));
const CutContourLogoPackProductPage = lazyWithRetry(() => import("./components/printpro/CutContourLogoPackProductPage"));
const WallPro = lazyWithRetry(() => import("./pages/WallPro"));
const ProductionOS = lazyWithRetry(() => import("./pages/ProductionOS"));
const ProductionFlow = lazyWithRetry(() => import("./pages/ProductionFlow"));

// ── Lazy imports - Admin pages ───────────────────────────────────
const AdminBlogManager = lazyWithRetry(() => import("./pages/AdminBlogManager"));
const AdminSeoDashboard = lazyWithRetry(() => import("./pages/AdminSeoDashboard"));
const AdminSeoConnections = lazyWithRetry(() => import("./pages/AdminSeoConnections"));
const AdminSeoBlogList = lazyWithRetry(() => import("./pages/AdminSeoBlogList"));
const AdminSeoBlogEditor = lazyWithRetry(() => import("./pages/AdminSeoBlogEditor"));
const AdminSeoBlogBatch = lazyWithRetry(() => import("./pages/AdminSeoBlogBatch"));
const SeoPro = lazyWithRetry(() => import("./pages/SeoPro"));
const AdminSeoKeywords = lazyWithRetry(() => import("./pages/AdminSeoKeywords"));
const AdminSeoReviews = lazyWithRetry(() => import("./pages/AdminSeoReviews"));
const AdminSeoIndexing = lazyWithRetry(() => import("./pages/AdminSeoIndexing"));
const AdminSeoPages = lazyWithRetry(() => import("./pages/AdminSeoPages"));
const AdminSeoGbpPosts = lazyWithRetry(() => import("./pages/AdminSeoGbpPosts"));
const AdminSeoReports = lazyWithRetry(() => import("./pages/AdminSeoReports"));
const AdminSeoCtrSweep = lazyWithRetry(() => import("./pages/AdminSeoCtrSweep"));
const AdminSeoLocalLanding = lazyWithRetry(() => import("./pages/AdminSeoLocalLanding"));
const AdminDashboard = lazyWithRetry(() => import("./pages/AdminDashboard"));
const AdminLogin = lazyWithRetry(() => import("./pages/AdminLogin"));
const AdminRenders = lazyWithRetry(() => import("./pages/AdminRenders"));
const AdminUserRenderDashboard = lazyWithRetry(() => import("./pages/AdminUserRenderDashboard"));
const AdminManufacturingPipeline = lazyWithRetry(() => import("./pages/AdminManufacturingPipeline"));
const AdminCarouselManager = lazyWithRetry(() => import("./pages/AdminCarouselManager"));
const AdminInkFusionManager = lazyWithRetry(() => import("./pages/AdminInkFusionManager"));
const AdminWBTYManager = lazyWithRetry(() => import("./pages/AdminWBTYManager"));
const AdminWBTYOrders = lazyWithRetry(() => import("./pages/AdminWBTYOrders"));
const AdminGuestDesignSales = lazyWithRetry(() => import("./pages/AdminGuestDesignSales"));
const AdminApproveProManager = lazyWithRetry(() => import("./pages/AdminApproveProManager"));
const ApprovedProDashboard = lazyWithRetry(() => import("./pages/ApprovedProDashboard"));
const AdminPopupManager = lazyWithRetry(() => import("./pages/AdminPopupManager"));
const AdminFadeWrapsManager = lazyWithRetry(() => import("./pages/AdminFadeWrapsManager"));
const AdminRenderCarousel = lazyWithRetry(() => import("./pages/AdminRenderCarousel"));
const AdminSwatchCleaner = lazyWithRetry(() => import("./pages/AdminSwatchCleaner"));
const AdminSwatchMapper = lazyWithRetry(() => import("./pages/AdminSwatchMapper"));
const AdminGallery = lazyWithRetry(() => import("./pages/AdminGallery"));
const AdminDesignPanelProManager = lazyWithRetry(() => import("./pages/AdminDesignPanelProManager"));
const AdminProductionPacks = lazyWithRetry(() => import("./pages/AdminProductionPacks"));
const AdminProductionTest = lazyWithRetry(() => import("./pages/AdminProductionTest"));
const AdminColorProManager = lazyWithRetry(() => import("./pages/AdminColorProManager"));
const AdminHeroCarousel = lazyWithRetry(() => import("./pages/AdminHeroCarousel"));
const AdminWpwHomepageSliders = lazyWithRetry(() => import("./pages/AdminWpwHomepageSliders"));
const AdminTryLanding = lazyWithRetry(() => import("./pages/AdminTryLanding"));
const AdminQualityReview = lazyWithRetry(() => import("./pages/AdminQualityReview"));
const AdminShowcaseManager = lazyWithRetry(() => import("./pages/AdminShowcaseManager"));
const AdminHomepageImages = lazyWithRetry(() => import("./pages/AdminHomepageImages"));
const AdminWpwFounderAssets = lazyWithRetry(() => import("./pages/AdminWpwFounderAssets"));
const AdminProductImages = lazyWithRetry(() => import("./pages/AdminProductImages"));
const AdminWpwFounderCampaign = lazyWithRetry(() => import("./pages/AdminWpwFounderCampaign"));
const AdminGraphicsProHero = lazyWithRetry(() => import("./pages/AdminGraphicsProHero"));
const AdminGraphicsProBatchTest = lazyWithRetry(() => import("./pages/AdminGraphicsProBatchTest"));
const AdminSubscriptions = lazyWithRetry(() => import("./pages/AdminSubscriptions"));
const AdminAIAutoFix = lazyWithRetry(() => import("./pages/AdminAIAutoFix"));
const AdminWaitlist = lazyWithRetry(() => import("./pages/AdminWaitlist"));
const AdminBilling = lazyWithRetry(() => import("./pages/AdminBilling"));
const AdminRenderUpload = lazyWithRetry(() => import("./pages/AdminRenderUpload"));
const AdminGalleryManager = lazyWithRetry(() => import("./pages/AdminGalleryManager"));
const AdminQuotePdfCards = lazyWithRetry(() => import("./pages/AdminQuotePdfCards"));
const AdminSendInvites = lazyWithRetry(() => import("./pages/AdminSendInvites"));
const AdminHeroRenderPicker = lazyWithRetry(() => import("./pages/AdminHeroRenderPicker"));
const AdminEnrichSwatches = lazyWithRetry(() => import("./pages/AdminEnrichSwatches"));
const AdminSwatchUrlUpdater = lazyWithRetry(() => import("./pages/AdminSwatchUrlUpdater"));
const Admin3MSwatchGenerator = lazyWithRetry(() => import("@/pages/Admin3MSwatchGenerator"));
const AdminAverySwatchGenerator = lazyWithRetry(() => import("@/pages/AdminAverySwatchGenerator"));
const Admin3MSwatchManager = lazyWithRetry(() => import("@/pages/Admin3MSwatchManager"));
const AdminSwatchValidation = lazyWithRetry(() => import("./pages/AdminSwatchValidation"));
const AdminQuickQuote = lazyWithRetry(() => import("./pages/AdminQuickQuote"));
const AdminQuotePricing = lazyWithRetry(() => import("./pages/AdminQuotePricing"));
const AdminShopProducts = lazyWithRetry(() => import("./pages/AdminShopProducts"));
const AdminEmailEditor = lazyWithRetry(() => import("./pages/AdminEmailEditor"));
const AdminInkFusionSampleChart = lazyWithRetry(() => import("./pages/AdminInkFusionSampleChart"));
const AdminShopSettings = lazyWithRetry(() => import("./pages/AdminShopSettings"));
const AdminMightyMail = lazyWithRetry(() => import("./pages/AdminMightyMail"));
const AdminMightyMailLanding = lazyWithRetry(() => import("./pages/AdminMightyMailLanding"));
const AdminLandingPages = lazyWithRetry(() => import("./pages/AdminLandingPages"));
const AdminWpwEnroll = lazyWithRetry(() => import("./pages/AdminWpwEnroll"));
const AdminWpwGrantConnect = lazyWithRetry(() => import("./pages/AdminWpwGrantConnect"));
const WpwConnect = lazyWithRetry(() => import("./pages/WpwConnect"));
const ShopEmailTemplates = lazyWithRetry(() => import("./pages/ShopEmailTemplates"));
const AdminEmailCampaigns = lazyWithRetry(() => import("./pages/AdminEmailCampaigns"));
const AdminSmsCampaigns = lazyWithRetry(() => import("./pages/AdminSmsCampaigns"));
const AdminRetargetingDashboard = lazyWithRetry(() => import("./pages/AdminRetargetingDashboard"));
const AdminSwatchQA = lazyWithRetry(() => import("./pages/AdminSwatchQA"));
const AdminLABMonitor = lazyWithRetry(() => import("./pages/AdminLABMonitor"));
const AdminSwatchExtractor = lazyWithRetry(() => import("./pages/AdminSwatchExtractor"));
const AdminManufacturerColors = lazyWithRetry(() => import("./pages/AdminManufacturerColors"));
const AdminColorAudit = lazyWithRetry(() => import("./pages/AdminColorAudit"));
const AdminConversionDashboard = lazyWithRetry(() => import("./pages/AdminConversionDashboard"));
const AdminRateDesigns = lazyWithRetry(() => import("./pages/AdminRateDesigns"));
const AdminRenderQC = lazyWithRetry(() => import("./pages/AdminRenderQC"));
const AdminClipDropEvidence = lazyWithRetry(() => import("./pages/AdminClipDropEvidence"));
const AdminBatchRender = lazyWithRetry(() => import("./pages/AdminBatchRender"));
const AdminFlatPanelTest = lazyWithRetry(() => import("./pages/AdminFlatPanelTest"));
const AdminPanelLibraryGenerator = lazyWithRetry(() => import("./pages/AdminPanelLibraryGenerator"));
const AdminBatchResults = lazyWithRetry(() => import("./pages/AdminBatchResults"));
const AdminBatchQAStudio = lazyWithRetry(() => import("./pages/AdminBatchQAStudio"));
const AdminBulkDesignPro = lazyWithRetry(() => import("./pages/AdminBulkDesignPro"));
const AdminDesignPanelBatch = lazyWithRetry(() => import("./pages/AdminDesignPanelBatch"));
const AdminFlatPanelFromRender = lazyWithRetry(() => import("./pages/AdminFlatPanelFromRender"));
const AdminDesignFileBatch = lazyWithRetry(() => import("./pages/AdminDesignFileBatch"));
const AdminUpscaleSingle = lazyWithRetry(() => import("./pages/AdminUpscaleSingle"));
const AdminEngineRoomReports = lazyWithRetry(() => import("./pages/AdminEngineRoomReports"));
const AdminWallProBatch = lazyWithRetry(() => import("./pages/AdminWallProBatch"));
const AdminSystemHealth = lazyWithRetry(() => import("./pages/AdminSystemHealth"));
const AdminBulkBackfill = lazyWithRetry(() => import("./pages/AdminBulkBackfill"));
const AdminStudioShowcase = lazyWithRetry(() => import("./pages/AdminStudioShowcase"));
const AdminOperatorGuide = lazyWithRetry(() => import("./pages/AdminOperatorGuide"));
const AdminHealth = lazyWithRetry(() => import("./pages/AdminHealth"));
const AdminErrorDashboard = lazyWithRetry(() => import("./pages/AdminErrorDashboard"));
const AdminProductionFiles = lazyWithRetry(() => import("./pages/AdminProductionFiles"));
// Standalone 1/24 mini-wrap-kit experiment — READ-ONLY over the vault, writes
// nothing to the pipeline. Reachable only by URL; no pipeline surface links here.
const AdminMiniWrapKit = lazyWithRetry(() => import("./pages/AdminMiniWrapKit"));
const AdminGeminiCompareStudio = lazyWithRetry(() => import("./pages/AdminGeminiCompareStudio"));
const AdminOperatorOnboarding = lazyWithRetry(() => import("./pages/AdminOperatorOnboarding"));
const AdminCreatorMarket = lazyWithRetry(() => import("./pages/AdminCreatorMarket"));
const AdminCreatorMarketManager = lazyWithRetry(() => import("./pages/AdminCreatorMarketManager"));
const AdminMarketplaceInventory = lazyWithRetry(() => import("./pages/AdminMarketplaceInventory"));
const AdminActivityLog = lazyWithRetry(() => import("./pages/AdminActivityLog"));
const AdminContentStudio = lazyWithRetry(() => import("./pages/AdminContentStudio"));
const AdminSocialBatch = lazyWithRetry(() => import("./pages/AdminSocialBatch"));
const AdminSocialIQ = lazyWithRetry(() => import("./pages/AdminSocialIQ"));
const SocialJoin = lazyWithRetry(() => import("./pages/SocialJoin"));
const WrapFeed = lazyWithRetry(() => import("./pages/WrapFeed"));
const AdminAdsLaunchPack = lazyWithRetry(() => import("./pages/AdminAdsLaunchPack"));
const AdminBannerPreview = lazyWithRetry(() => import("./pages/AdminBannerPreview"));
const AdminEmailSignature = lazyWithRetry(() => import("./pages/AdminEmailSignature"));
const AdminContentEngine = lazyWithRetry(() => import("./pages/AdminContentEngine"));
const AdminArtboardGenerator = lazyWithRetry(() => import("./pages/AdminArtboardGenerator"));
const AdminMarketingHub = lazyWithRetry(() => import("./pages/AdminMarketingHub"));
const AdminLeadReplies = lazyWithRetry(() => import("./pages/AdminLeadReplies"));
const AdminAdsPerformance = lazyWithRetry(() => import("./pages/AdminAdsPerformance"));
const AdminBrandBoard = lazyWithRetry(() => import("./pages/AdminBrandBoard"));
const AdminMarketingPro = lazyWithRetry(() => import("./pages/AdminMarketingPro"));
const AdminApprovalBoard = lazyWithRetry(() => import("./pages/AdminApprovalBoard"));
const AdminWorkforce = lazyWithRetry(() => import("./pages/AdminWorkforce"));
const AdminContentDirector = lazyWithRetry(() => import("./pages/AdminContentDirector"));
const AdminScriptStudio = lazyWithRetry(() => import("./pages/AdminScriptStudio"));
const AdminComposer = lazyWithRetry(() => import("./pages/AdminComposer"));
const AdminCreator = lazyWithRetry(() => import("./pages/AdminCreator"));
const AdminHooks = lazyWithRetry(() => import("./pages/AdminHooks"));
const AdminAffiliates = lazyWithRetry(() => import("./pages/AdminAffiliates"));
const AdminWrapPanelStudio = lazyWithRetry(() => import("./pages/AdminWrapPanelStudio"));
const AdminAffiliateContent = lazyWithRetry(() => import("./pages/AdminAffiliateContent"));
const AdminRepMarketingKits = lazyWithRetry(() => import("./pages/AdminRepMarketingKits"));
const AdminAffiliatePayouts = lazyWithRetry(() => import("./pages/AdminAffiliatePayouts"));
const AdminBulk = lazyWithRetry(() => import("./pages/AdminBulk"));
const AdminRenderIntelligence = lazyWithRetry(() => import("./pages/AdminRenderIntelligence"));
const AdminSubscriberGallery = lazyWithRetry(() => import("./pages/AdminSubscriberGallery"));
const AdminSwatchGallery = lazyWithRetry(() => import("./pages/AdminSwatchGallery"));
const AdminSwatchImport = lazyWithRetry(() => import("./pages/AdminSwatchImport"));
const AdminUserActivity = lazyWithRetry(() => import("./pages/AdminUserActivity"));
const AdminPackCredits = lazyWithRetry(() => import("./pages/AdminPackCredits"));
const AdminTeamUsage = lazyWithRetry(() => import("./pages/AdminTeamUsage"));
const QCCutContour = lazyWithRetry(() => import("./pages/QCCutContour"));
const FlatPanelPro = lazyWithRetry(() => import("./pages/FlatPanelPro"));
const AdminPrintProduction = lazyWithRetry(() => import("./pages/AdminPrintProduction"));
const FlatPanelBuilderPage = lazyWithRetry(() => import("./pages/FlatPanelBuilderPage"));
const FlatPanelExport = lazyWithRetry(() => import("./pages/FlatPanelExport"));

// ── Lazy imports - Affiliate pages ───────────────────────────────
const AffiliateJoin = lazyWithRetry(() => import("./pages/affiliate/AffiliateJoin"));
const AffiliateOnboarding = lazyWithRetry(() => import("./pages/affiliate/AffiliateOnboarding"));
const AffiliateDashboard = lazyWithRetry(() => import("./pages/affiliate/AffiliateDashboard"));
const AffiliateSharingKit = lazyWithRetry(() => import("./pages/affiliate/AffiliateSharingKit"));
const AffiliateMarketing = lazyWithRetry(() => import("./pages/affiliate/AffiliateMarketing"));
const AffiliateSettings = lazyWithRetry(() => import("./pages/affiliate/AffiliateSettings"));
const AffiliateAdmin = lazyWithRetry(() => import("./pages/affiliate/AffiliateAdmin"));
const AffiliateLogin = lazyWithRetry(() => import("./pages/affiliate/AffiliateLogin"));

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

// Redirect legacy standalone email routes into the unified MightyMail hub,
// preserving any existing query params (e.g. ?template=) and selecting the tab.
const MightyMailRedirect = ({ tab }: { tab: string }) => {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  return <Navigate to={`/admin/mightymail?${params.toString()}`} replace />;
};

// The public customer proof portal (/approve/:token) is fully self-branded
// (shop wordmark + ApprovePro). It must NOT show the RestyleProAI marketing
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
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false);

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
            {!inIframe && <RestyleProQuestionsWidget />}
            {!inIframe && <SprocketHelper />}
            {/* OwnerSprocketDock unmounted 2026-08-04 (Trish): its bottom-left
                chip floated over page content. The component is kept in the
                repo — re-add <OwnerSprocketDock /> here to bring it back. */}
            <DeployVersionWatcher />
            <AppShell>
            <ErrorBoundary>
            <Suspense fallback={<Loading />}>
            <Routes>
          <Route path="/" element={<AuthedRootRedirect />} />
          <Route path="/dashboard" element={<RequireAuth><RestyleDashboard /></RequireAuth>} />
          <Route path="/dashboard/my-orders" element={<RequireAuth><MyWpwOrders /></RequireAuth>} />
          <Route path="/orders" element={<RequireAuth><TeamOrders /></RequireAuth>} />
          <Route path="/wpw-proof/:proofId" element={<ApproveProUnavailable />} />
          <Route path="/wpw-orders/:id/print" element={<RequireAuth><WpwOrderPrint /></RequireAuth>} />
          <Route path="/quotes" element={<RequireAuth><Quotes /></RequireAuth>} />
          <Route path="/mightymail" element={<RequireAuth><MightyMail /></RequireAuth>} />
          <Route path="/mightymail-info" element={<MightyMailInfo />} />
          <Route path="/wpw" element={<WpwConnectPortal />} />
          <Route path="/wpw-connect" element={<WpwConnectPortal />} />
          <Route path="/connect-portal" element={<WpwConnectPortal />} />
          {/* Free-designs promo retired — the "3 free designs" offer has ended.
              Redirect any inbound traffic (old emails, SMS, ads, QR codes) to
              /pricing, matching the /wpw-offer redirect below. */}
          <Route path="/free-wrap-designs" element={<Navigate to="/pricing" replace />} />
          <Route path="/3-free-designs" element={<Navigate to="/pricing" replace />} />
          <Route path="/free-designs" element={<Navigate to="/pricing" replace />} />
          <Route path="/colorpro" element={<ColorPro />} />
          <Route path="/graphicspro" element={<Navigate to="/graphics-pro" replace />} />
          <Route path="/graphics-pro" element={<RequireAuth><GraphicsProV1 /></RequireAuth>} />
          <Route path="/graphics-pro-wall" element={<RequireAuth><GraphicsProWall /></RequireAuth>} />
          <Route path="/restylelibrary" element={<DesignPro />} />
          {/* Single unified studio page — the real brief + big Konva canvas.
              /create is the deleted duplicate → redirect so nothing splits. */}
          <Route path="/designpro" element={<DesignPanelProPremium />} />
          <Route path="/flatten" element={<RequireAuth><FlattenTool /></RequireAuth>} />
          <Route path="/designpro/artboard-first" element={<RequireAuth><ArtboardFirstDesignPro /></RequireAuth>} />
          {/* CarWrapPro™ — public SEO/AEO product page + the Design Assets admin production page */}
          <Route path="/carwrappro" element={<CarWrapProLanding />} />
          <Route path="/admin/carwrappro" element={<RequireAdmin><AdminCarWrapPro /></RequireAdmin>} />
          <Route path="/admin/panel-artboard" element={<RequireAdmin><AdminPanelArtboard /></RequireAdmin>} />
          {/* DesignPro v2 object-graph engine — isolated experimental module, admin test bench only */}
          <Route path="/admin/designpro-v2-test" element={<RequireAdmin><AdminDesignProV2Test /></RequireAdmin>} />
          <Route path="/designpro/panel-sizer" element={<RequireAuth><PanelSizer /></RequireAuth>} />
          <Route path="/designpro/create" element={<Navigate to="/designpro" replace />} />
          <Route path="/designpro/studio" element={<RequireAuth><DesignProStudio /></RequireAuth>} />
          <Route path="/designpro/premium" element={<Navigate to="/designpro" replace />} />
          <Route path="/designpro/raster" element={<RequireAuth><DesignStudio /></RequireAuth>} />
          <Route path="/logopro" element={<RequireAuth><LogoPro /></RequireAuth>} />
          {/* FadeWrap generator hidden — use DesignProAI for fade wraps via prompt */}
          <Route path="/fadewraps" element={<Navigate to="/restylelibrary" replace />} />
          <Route path="/designpanelpro" element={<Navigate to="/restylelibrary" replace />} />
          <Route path="/designpanelpro/premium" element={<Navigate to="/designpro" replace />} />
          <Route path="/wbty" element={<WBTY />} />
          <Route path="/wbty/order-success" element={<WBTYOrderSuccess />} />
          <Route path="/patternpro" element={<Navigate to="/wbty" replace />} />
          <Route path="/approvemode" element={<ApproveProUnavailable />} />
          <Route path="/tools" element={<DesignProAISuite />} />
          <Route path="/visualize" element={<Visualize />} />
          <Route path="/material" element={<MaterialMode />} />
          <Route path="/myvehiclepro" element={<MyVehiclePro />} />
          <Route path="/quick-quote" element={<QuickQuotePage />} />
          <Route path="/try-design" element={<TryDesign />} />
          <Route path="/wraptv/submit" element={<WrapTVSubmit />} />
          <Route path="/wraptv" element={<WrapTVWorld />} />
          <Route path="/wraptv/shows/:slug" element={<WrapTVShow />} />
          <Route path="/try-design/success" element={<TryDesignSuccess />} />
          <Route path="/club-wpw-drop" element={<ClubWpwDrop />} />
          <Route path="/design-drop" element={<ClubWpwDrop />} />
          <Route path="/wpw-wrap-calculator" element={<WpwWrapCalculator />} />
          <Route path="/wrapguru" element={<WrapGuru />} />
          <Route path="/admin/wotw-winners" element={<RequireAdmin><AdminWotwWinners /></RequireAdmin>} />
          <Route path="/preview-modal" element={<RequireAdmin><PreviewModal /></RequireAdmin>} />
          <Route path="/wpw/:rep" element={<WpwRepLanding />} />
          <Route path="/help/restylepro-walkthrough" element={<HelpRestyleProWalkthrough />} />
          <Route path="/help/wpw-rep-guide" element={<HelpWpwRepGuide />} />
          <Route path="/help/production-pack" element={<HowToProductionPack />} />
          <Route path="/sell-kit" element={<RequireAuth><SellKit /></RequireAuth>} />
          <Route path="/quotetool" element={<QuoteToolProduct />} />
          <Route path="/q/:token" element={<PublicQuotePage />} />
          <Route path="/quote/:shopSlug" element={<SubAccountQuotePage />} />
          <Route path="/book/:shopSlug" element={<PublicBookingPage />} />
          <Route path="/quiktext-approve" element={<QuikTextApprove />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/renders" element={<AdminRenders />} />
          <Route path="/admin/user-renders" element={<RequireAdmin><AdminUserRenderDashboard /></RequireAdmin>} />
          <Route path="/admin/manufacturing-pipeline" element={<RequireAdmin><AdminManufacturingPipeline /></RequireAdmin>} />
          <Route path="/admin-restylepro" element={<Navigate to="/admin" replace />} />
          <Route path="/admin/shop-settings" element={<AdminShopSettings />} />
          <Route path="/admin/carousel" element={<AdminCarouselManager />} />
          <Route path="/admin/inkfusion-manager" element={<AdminInkFusionManager />} />
          <Route path="/admin/wbty-manager" element={<AdminWBTYManager />} />
          <Route path="/admin/wbty-orders" element={<AdminWBTYOrders />} />
          <Route path="/admin/guest-design-sales" element={<RequireAdmin><AdminGuestDesignSales /></RequireAdmin>} />
          <Route path="/admin/fadewraps-manager" element={<AdminFadeWrapsManager />} />
          <Route path="/admin/designpanelpro-manager" element={<AdminDesignPanelProManager />} />
          <Route path="/admin/production-packs" element={<AdminProductionPacks />} />
          <Route path="/admin/production-test" element={<AdminProductionTest />} />
          <Route path="/admin/render-carousel" element={<AdminRenderCarousel />} />
          <Route path="/admin/swatch-cleaner" element={<AdminSwatchCleaner />} />
          <Route path="/admin/swatch-mapper" element={<AdminSwatchMapper />} />
          <Route path="/admin/gallery" element={<AdminGallery />} />
          <Route path="/admin/hero-carousel" element={<AdminHeroCarousel />} />
          <Route path="/admin/try-landing" element={<RequireAdmin><AdminTryLanding /></RequireAdmin>} />
          <Route path="/admin/colorpro-manager" element={<AdminColorProManager />} />
          <Route path="/admin/showcase-manager" element={<AdminShowcaseManager />} />
          <Route path="/admin/homepage-images" element={<AdminHomepageImages />} />
          <Route path="/admin/wpw-homepage-sliders" element={<RequireAdmin><AdminWpwHomepageSliders /></RequireAdmin>} />
          <Route path="/admin/wpw-founder-assets" element={<AdminWpwFounderAssets />} />
          <Route path="/admin/product-images" element={<AdminProductImages />} />
          <Route path="/admin/wpw-founder-campaign" element={<AdminWpwFounderCampaign />} />
          <Route path="/admin/graphicspro-hero" element={<AdminGraphicsProHero />} />
          <Route path="/admin/graphicspro-batch-test" element={<AdminGraphicsProBatchTest />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin/quality-review" element={<RequireAdmin><AdminQualityReview /></RequireAdmin>} />
          <Route path="/admin/ai-auto-fix" element={<AdminAIAutoFix />} />
          <Route path="/admin/3m-swatch-generator" element={<Admin3MSwatchGenerator />} />
          <Route path="/admin/avery-swatch-generator" element={<AdminAverySwatchGenerator />} />
          <Route path="/admin/wbty" element={<AdminWBTYManager />} />
          <Route path="/admin/approvemode" element={<ApproveProUnavailable />} />
          <Route path="/admin/approve-revisions" element={<ApproveProUnavailable />} />
          <Route path="/admin/popup-manager" element={<AdminPopupManager />} />
          <Route path="/admin/swatches" element={<Admin3MSwatchManager />} />
          <Route path="/admin/subscriptions" element={<AdminSubscriptions />} />
          <Route path="/admin/waitlist" element={<AdminWaitlist />} />
          <Route path="/admin/operator-guide" element={<AdminOperatorGuide />} />
          <Route path="/admin/health" element={<AdminHealth />} />
          <Route path="/admin/errors" element={<RequireAdmin><AdminErrorDashboard /></RequireAdmin>} />
          <Route path="/admin/production-files" element={<RequireAdmin><AdminProductionFiles /></RequireAdmin>} />
          <Route path="/admin/mini-wrap-kit" element={<RequireAdmin><AdminMiniWrapKit /></RequireAdmin>} />
          <Route path="/admin/studio-board" element={<RequireAdmin><AdminGeminiCompareStudio /></RequireAdmin>} />
          <Route path="/admin/gemini-compare" element={<RequireAdmin><AdminGeminiCompareStudio /></RequireAdmin>} />
          <Route path="/admin/operator-onboarding" element={<AdminOperatorOnboarding />} />
          <Route path="/admin/billing" element={<AdminBilling />} />
          <Route path="/admin/render-upload" element={<AdminRenderUpload />} />
          <Route path="/admin/gallery-manager" element={<AdminGalleryManager />} />
          <Route path="/admin/quote-pdf-cards" element={<RequireAdmin><AdminQuotePdfCards /></RequireAdmin>} />
          {/* /admin/quick-quote was the old Quote Management page. The user
              consolidated onto /quotes (working action icons + MightyMail
              + inbound). This route just redirects so external links keep
              working. Pricing/branding lives at /admin/quote-pricing. */}
          <Route path="/admin/quick-quote" element={<Navigate to="/quotes" replace />} />
          <Route path="/admin/quote-pricing" element={<AdminQuotePricing />} />
          <Route path="/admin/availability" element={<RequireAuth><AdminAvailability /></RequireAuth>} />
          <Route path="/admin/shop-pricing" element={<RequireAuth><AdminShopPricing /></RequireAuth>} />
          <Route path="/admin/shop-products" element={<AdminShopProducts />} />
          <Route path="/admin/email-editor" element={<MightyMailRedirect tab="editor" />} />
          <Route path="/admin/send-invites" element={<AdminSendInvites />} />
          <Route path="/admin/hero-render-picker" element={<AdminHeroRenderPicker />} />
          <Route path="/admin/enrich-swatches" element={<AdminEnrichSwatches />} />
          <Route path="/admin/swatch-url-updater" element={<AdminSwatchUrlUpdater />} />
          <Route path="/admin/swatch-validation" element={<AdminSwatchValidation />} />
          <Route path="/admin/inkfusion-sample-chart" element={<AdminInkFusionSampleChart />} />
          <Route path="/admin/mightymail" element={<RequireAdmin><AdminMightyMail /></RequireAdmin>} />
          <Route path="/admin/mightymail-landing" element={<MightyMailRedirect tab="landing" />} />
          <Route path="/admin/landing-pages" element={<AdminLandingPages />} />
          <Route path="/admin/wpw-enroll" element={<RequireAdmin><AdminWpwEnroll /></RequireAdmin>} />
          <Route path="/admin/wpw-grant-connect" element={<RequireAdmin><AdminWpwGrantConnect /></RequireAdmin>} />
          <Route path="/wpw-connect" element={<WpwConnect />} />
          <Route path="/email-templates" element={<RequireAuth><ShopEmailTemplates /></RequireAuth>} />
          <Route path="/admin/campaigns" element={<MightyMailRedirect tab="campaigns" />} />
          <Route path="/admin/sms-campaigns" element={<RequireAdmin><AdminSmsCampaigns /></RequireAdmin>} />
          <Route path="/admin/retargeting" element={<MightyMailRedirect tab="retargeting" />} />
          <Route path="/admin/swatch-qa" element={<AdminSwatchQA />} />
          <Route path="/admin/lab-monitor" element={<AdminLABMonitor />} />
          <Route path="/admin/swatch-extractor" element={<AdminSwatchExtractor />} />
          <Route path="/admin/manufacturer-colors" element={<AdminManufacturerColors />} />
          <Route path="/admin/color-audit" element={<AdminColorAudit />} />
          <Route path="/admin/conversion-dashboard" element={<AdminConversionDashboard />} />
          <Route path="/admin/rate-designs" element={<AdminRateDesigns />} />
          <Route path="/admin/render-qc" element={<RequireAdmin><AdminRenderQC /></RequireAdmin>} />
          <Route path="/admin/clipdrop-evidence" element={<RequireAdmin><AdminClipDropEvidence /></RequireAdmin>} />
          {/* Legacy QC page retired — superseded by QC ProductionFlow, which now lives inside /productionflow (QCProductionFlowContainer). */}
          <Route path="/admin/graphic-designer-qc" element={<Navigate to="/productionflow" replace />} />
          <Route path="/admin/artboard-generator" element={<AdminArtboardGenerator />} />
          <Route path="/admin/marketing-hub" element={<RequireAuth><AdminMarketingHub /></RequireAuth>} />
          <Route path="/admin/lead-replies" element={<RequireAdmin><AdminLeadReplies /></RequireAdmin>} />
          <Route path="/admin/ads-performance" element={<RequireAuth><AdminAdsPerformance /></RequireAuth>} />
          <Route path="/admin/brand-board" element={<RequireAuth><AdminBrandBoard /></RequireAuth>} />
          <Route path="/admin/marketing-pro" element={<RequireAuth><AdminMarketingPro /></RequireAuth>} />
          <Route path="/admin/marketing-agent" element={<RequireAuth><AdminMarketingAgent /></RequireAuth>} />
          {/* The Content OS status screen. Admin-guarded rather than RequireAuth
              because it reports queue depth, spend and failure counts across
              every brand — operator information, not customer information. */}
          <Route path="/admin/content-os" element={<RequireAdmin><AdminContentOS /></RequireAdmin>} />
          <Route path="/admin/narrative-arcs" element={<RequireAdmin><AdminNarrativeArcs /></RequireAdmin>} />
          {/* Standalone Content Calendar retired (duplicate of the Marketing Hub
              calendar tab — owner decision 2026-07-28: the Hub tab is canonical). */}
          <Route path="/admin/content-calendar" element={<Navigate to="/admin/marketing-hub?tab=calendar" replace />} />
          <Route path="/admin/workforce" element={<RequireAuth><AdminWorkforce /></RequireAuth>} />
          <Route path="/admin/content-director" element={<RequireAuth><AdminContentDirector /></RequireAuth>} />
          <Route path="/admin/script-studio" element={<RequireAuth><AdminScriptStudio /></RequireAuth>} />
          <Route path="/admin/composer" element={<RequireAuth><AdminComposer /></RequireAuth>} />
          <Route path="/admin/creator" element={<RequireAuth><AdminCreator /></RequireAuth>} />
          <Route path="/admin/hooks" element={<RequireAuth><AdminHooks /></RequireAuth>} />
          {/* Queue merge (Content OS priority 1): the second approval queue is
              retired — the Content Director is THE one queue. Bookmarks and
              Canva OAuth returns land here, so keep the redirect forever. */}
          <Route path="/admin/content-review" element={<Navigate to="/admin/content-director" replace />} />
          <Route path="/admin/affiliates" element={<RequireAdmin><AdminAffiliates /></RequireAdmin>} />
          <Route path="/admin/wrap-panel-studio" element={<RequireAdmin><AdminWrapPanelStudio /></RequireAdmin>} />
          <Route path="/admin/affiliate-content" element={<RequireAdmin><AdminAffiliateContent /></RequireAdmin>} />
          <Route path="/admin/rep-marketing-kits" element={<RequireAdmin><AdminRepMarketingKits /></RequireAdmin>} />
          <Route path="/admin/affiliate-payouts" element={<RequireAdmin><AdminAffiliatePayouts /></RequireAdmin>} />
          <Route path="/admin/bulk" element={<RequireAdmin><AdminBulk /></RequireAdmin>} />
          <Route path="/admin/render-intelligence" element={<RequireAdmin><AdminRenderIntelligence /></RequireAdmin>} />
          <Route path="/admin/subscriber-gallery" element={<RequireAdmin><AdminSubscriberGallery /></RequireAdmin>} />
          <Route path="/admin/swatch-gallery" element={<RequireAdmin><AdminSwatchGallery /></RequireAdmin>} />
          <Route path="/admin/swatch-import" element={<RequireAdmin><AdminSwatchImport /></RequireAdmin>} />
          <Route path="/admin/user-activity" element={<RequireAdmin><AdminUserActivity /></RequireAdmin>} />
          <Route path="/admin/pack-credits" element={<RequireAdmin><AdminPackCredits /></RequireAdmin>} />
          <Route path="/admin/team-usage" element={<RequireAdmin><AdminTeamUsage /></RequireAdmin>} />
          <Route path="/engine-room" element={<RequireAuth><AdminMarketingHub /></RequireAuth>} />
          <Route path="/engine-room/approvals" element={<RequireAuth><AdminApprovalBoard /></RequireAuth>} />
          {/* WPW-tenant Engine Room — scoped to WePrintWraps internal team */}
          <Route path="/wpw/engine-room" element={<RequireWPWTenant><AdminMarketingHub tenantMode="wpw" /></RequireWPWTenant>} />
          <Route path="/wpw/marketing-hub" element={<RequireWPWTenant><AdminMarketingHub tenantMode="wpw" /></RequireWPWTenant>} />
          <Route path="/wpw/approvals" element={<RequireWPWTenant><AdminApprovalBoard /></RequireWPWTenant>} />
          <Route path="/wpw/content-calendar" element={<Navigate to="/wpw/engine-room?tab=calendar" replace />} />
          <Route path="/qc-cutcontour" element={<RequireAdmin><QCCutContour /></RequireAdmin>} />
          <Route path="/flat-panel-pro" element={<RequireAdmin><FlatPanelPro /></RequireAdmin>} />
          <Route path="/admin/print-production" element={<RequireAdmin><AdminPrintProduction /></RequireAdmin>} />
          {/* Builder removed — it cropped the vehicle proof (distorted output). Use the deterministic export. */}
          <Route path="/flat-panel-builder" element={<Navigate to="/flat-panel-export" replace />} />
          <Route path="/flat-panel-export" element={<RequireAdmin><FlatPanelExport /></RequireAdmin>} />
          <Route path="/admin/batch-render" element={<AdminBatchRender />} />
          <Route path="/admin/flat-panel-test" element={<AdminFlatPanelTest />} />
          <Route path="/admin/panel-library-generator" element={<RequireAdmin><AdminPanelLibraryGenerator /></RequireAdmin>} />
          <Route path="/admin/batch-results" element={<AdminBatchResults />} />
          <Route path="/admin/batch-qa-studio" element={<AdminBatchQAStudio />} />
          <Route path="/admin/bulk-design" element={<AdminBulkDesignPro />} />
          <Route path="/admin/panel-batch" element={<RequireSingleFlatPanel><AdminDesignPanelBatch /></RequireSingleFlatPanel>} />
          <Route path="/admin/flat-panel-from-render" element={<AdminFlatPanelFromRender />} />
          <Route path="/admin/design-file-batch" element={<AdminDesignFileBatch />} />
          <Route path="/admin/upscale-single" element={<AdminUpscaleSingle />} />
          <Route path="/admin/engineroom-reports" element={<RequireAuth><AdminEngineRoomReports /></RequireAuth>} />
          <Route path="/admin/wallpro-batch" element={<AdminWallProBatch />} />
          <Route path="/admin/system-health" element={<AdminSystemHealth />} />
          <Route path="/admin/bulk-backfill" element={<AdminBulkBackfill />} />
          <Route path="/batch-generate" element={<RequireAdmin><AdminBulkBackfill /></RequireAdmin>} />
          <Route path="/admin/studio-showcase" element={<AdminStudioShowcase />} />
          <Route path="/admin/creator-market" element={<AdminCreatorMarket />} />
          <Route path="/admin/creatormarket-manager" element={<RequireAdmin><AdminCreatorMarketManager /></RequireAdmin>} />
          <Route path="/admin/marketplace-inventory" element={<AdminMarketplaceInventory />} />
          <Route path="/admin/activity-log" element={<AdminActivityLog />} />
          <Route path="/admin/content-studio" element={<RequireAdmin><AdminContentStudio /></RequireAdmin>} />
          <Route path="/admin/social-batch" element={<RequireAdmin><AdminSocialBatch /></RequireAdmin>} />
          <Route path="/admin/social-iq" element={<RequireAdmin><AdminSocialIQ /></RequireAdmin>} />
          <Route path="/social/join" element={<SocialJoin />} />
          <Route path="/feed" element={<WrapFeed />} />
          <Route path="/admin/ads-launch-pack" element={<RequireAdmin><AdminAdsLaunchPack /></RequireAdmin>} />
          <Route path="/admin/banner-preview" element={<RequireAdmin><AdminBannerPreview /></RequireAdmin>} />
          <Route path="/admin/email-signature" element={<RequireAdmin><AdminEmailSignature /></RequireAdmin>} />
          <Route path="/admin/content-engine" element={<RequireAdmin><AdminContentEngine /></RequireAdmin>} />
          <Route path="/admin/blog" element={<RequireAdmin><AdminBlogManager /></RequireAdmin>} />
          <Route path="/admin/seo" element={<RequireAuth><AdminSeoDashboard /></RequireAuth>} />
          <Route path="/admin/seo/connections" element={<RequireAuth><AdminSeoConnections /></RequireAuth>} />
          <Route path="/admin/seo/blog" element={<RequireAuth><AdminSeoBlogList /></RequireAuth>} />
          <Route path="/admin/seo/blog/batch" element={<RequireAuth><AdminSeoBlogBatch /></RequireAuth>} />
          <Route path="/seopro" element={<SeoPro />} />
          <Route path="/admin/seo/blog/:id" element={<RequireAuth><AdminSeoBlogEditor /></RequireAuth>} />
          <Route path="/admin/seo/keywords" element={<RequireAuth><AdminSeoKeywords /></RequireAuth>} />
          <Route path="/admin/seo/reviews" element={<RequireAuth><AdminSeoReviews /></RequireAuth>} />
          <Route path="/admin/seo/indexing" element={<RequireAuth><AdminSeoIndexing /></RequireAuth>} />
          <Route path="/admin/seo/pages" element={<RequireAuth><AdminSeoPages /></RequireAuth>} />
          <Route path="/admin/seo/gbp-posts" element={<RequireAuth><AdminSeoGbpPosts /></RequireAuth>} />
          <Route path="/admin/seo/reports" element={<RequireAuth><AdminSeoReports /></RequireAuth>} />
          <Route path="/admin/seo/ctr-sweep" element={<RequireAuth><AdminSeoCtrSweep /></RequireAuth>} />
          <Route path="/admin/seo/local-landing" element={<RequireAuth><AdminSeoLocalLanding /></RequireAuth>} />
          <Route path="/admin/studio-replay" element={<Navigate to="/revision-studio" replace />} />
          <Route path="/revision-studio" element={<RequireAuth><RevisionStudioIQ /></RequireAuth>} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/showcase" element={<Showcase />} />
          <Route path="/printpro" element={<PrintPro />} />
          <Route path="/printpro/shop" element={<PrintProShop />} />
          <Route path="/printpro/wbty" element={<WBTYPrintedProductPage />} />
          <Route path="/printpro/designpanelpro" element={<DesignPanelProPrintedProductPage />} />
          <Route path="/printpro/fadewrap" element={<FadeWrapPrintedProductPage />} />
          <Route path="/printpro/reflective" element={<PrintableReflectiveProductPage />} />
          <Route path="/printpro/design-packs" element={<FullDesignPrintPacksProductPage />} />
          <Route path="/printpro/custom-upload" element={<CustomPrintUploadProductPage />} />
          <Route path="/printpro/production" element={<PrintProductionPipeline />} />
          <Route path="/printpro/production-os" element={<ProductionOS />} />
          <Route path="/printpro/cut-contour" element={<CutContourLogoPackProductPage />} />
          <Route path="/printpro/wallpro" element={<WallPro />} />
          <Route path="/wrapbox" element={<WrapBox />} />
          <Route path="/designvault" element={<DesignVault />} />
          <Route path="/creatormarket" element={<CreatorMarket />} />
          {/* SEO: individual design pages (declare before the category
              catch so `/design/:id` never resolves as a category). */}
          <Route path="/creatormarket/design/:slugId" element={<CreatorMarketDesign />} />
          <Route path="/creatormarket/:categorySlug" element={<CreatorMarketCategory />} />
          <Route path="/productionflow" element={<ProductionFlow />} />
          <Route path="/productionflow/:jobId" element={<RequireAuth><ProductionFlow /></RequireAuth>} />
          <Route path="/production-flow" element={<Navigate to="/productionflow" replace />} />
          {/* Designer-side production QC — files land here first; writes to the SAME
              panelizer_jobs row the customer GENIE page on ProductionFlow polls. */}
          {/* RecreatePro is now a single flow inside ProductionFlow's prep tab */}
          <Route path="/recreatepro" element={<Navigate to="/productionflow?tab=prep" replace />} />
          <Route path="/my-renders" element={<RequireAuth><MyRenders /></RequireAuth>} />
          <Route path="/my-designs" element={<RequireAuth><MyDesigns /></RequireAuth>} />
          <Route path="/user-guide" element={<UserGuide />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/landing" element={<Landing />} />
          <Route path="/join" element={<Landing />} />
          <Route path="/pay-per-use" element={<PayPerUseLanding />} />
          <Route path="/try" element={<Try />} />
          <Route path="/project-pass" element={<ProjectPass />} />
          <Route path="/never-miss-a-lead" element={<NeverMissALead />} />
          <Route path="/never-miss-a-lead/success" element={<NeverMissALead />} />
          <Route path="/quicktext" element={<NeverMissALead />} />
          <Route path="/quicktext/success" element={<NeverMissALead />} />
          <Route path="/bookingpro" element={<BookingPro />} />
          <Route path="/billing" element={<RequireAuth><Billing /></RequireAuth>} />
          <Route path="/account/shop" element={<RequireAuth><ShopSettings /></RequireAuth>} />
          <Route path="/invite/:token" element={<AcceptShopInvite />} />
          <Route path="/app-cart" element={<RequireAuth><AppCart /></RequireAuth>} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/checkout/return" element={<RequireAuth><CheckoutReturn /></RequireAuth>} />
          <Route path="/download-success" element={<DownloadSuccess />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/reset-password-request" element={<ResetPasswordRequest />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/auth" element={<Navigate to="/login" replace />} />
          <Route path="/fleet" element={<FleetServices />} />
          <Route path="/from/weprintwraps" element={<FromWePrintWraps />} />
          <Route path="/from/weprintwraps-dark" element={<FromWePrintWraps theme="dark" />} />
          {/* /wpw-offer, /wpw-offer-vertical, /launch, /launch-vertical retired —
              redirect any inbound traffic (old emails, SMS, ads) to /pricing */}
          <Route path="/wpw-offer" element={<Navigate to="/pricing" replace />} />
          <Route path="/wpw-offer-vertical" element={<Navigate to="/pricing" replace />} />
          <Route path="/launch" element={<Navigate to="/pricing" replace />} />
          <Route path="/launch-vertical" element={<Navigate to="/pricing" replace />} />
          <Route path="/admin/campaign-videos" element={<RequireAdmin><AdminCampaignVideos /></RequireAdmin>} />

          <Route path="/tester-welcome" element={<TesterWelcome />} />
          <Route path="/share/:type/:id" element={<ShareDesign />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/faq/colorpro" element={<FAQColorPro />} />
          <Route path="/faq/designpro" element={<FAQDesignPro />} />
          <Route path="/faq/fadewraps" element={<FAQFadeWraps />} />
          <Route path="/faq/photorealistic-renders" element={<FAQPhotorealisticRenders />} />
          <Route path="/faq/vehicles" element={<FAQVehicleTypes />} />
          <Route path="/faq/pricing" element={<FAQPricing />} />
          <Route path="/blog" element={<Blog />} />
          <Route path="/blog/how-much-does-a-vehicle-wrap-cost-2026" element={<BlogPostWrapCost2026 />} />
          <Route path="/blog/best-vehicle-wrap-colors-2026" element={<BlogPostWrapColors2026 />} />
          <Route path="/blog/matte-vs-gloss-vs-satin-wrap-finish" element={<BlogPostMattVsGloss />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/blog/:slug/cover" element={<BlogCover />} />
          <Route path="/gallery/:vehicleSlug" element={<VehicleGallery />} />
          <Route path="/affiliate" element={<Affiliate />} />
          <Route path="/affiliate/login" element={<AffiliateLogin />} />
          <Route path="/affiliate/join" element={<AffiliateJoin />} />
          <Route path="/affiliate/onboarding" element={<RequireAuth><AffiliateOnboarding /></RequireAuth>} />
          <Route path="/affiliate/dashboard" element={<RequireAuth><AffiliateDashboard /></RequireAuth>} />
          <Route path="/affiliate/sharing-kit" element={<RequireAuth><AffiliateSharingKit /></RequireAuth>} />
          <Route path="/affiliate/marketing" element={<RequireAuth><AffiliateMarketing /></RequireAuth>} />
          <Route path="/affiliate/settings" element={<RequireAuth><AffiliateSettings /></RequireAuth>} />
          <Route path="/affiliate/admin" element={<AffiliateAdmin />} />
          <Route path="/proof/:token" element={<ApproveProUnavailable />} />
          {/* Proof Approval System (Phase 2) — public client sign page */}
          <Route path="/approve/:token" element={<ApproveProUnavailable />} />
          {/* Proof Approval System (Phase 3) — shop-side review + push new version */}
          <Route path="/approve/manage/:token" element={<ApproveProUnavailable />} />
          {/* Proof Approval System (Phase 5) — admin Tier-3 support dashboard */}
          <Route path="/admin/proof-support" element={<ApproveProUnavailable />} />
          <Route path="/admin/sprocket" element={<RequireAdmin><AdminSprocketAgent /></RequireAdmin>} />
          <Route path="/admin/wrapguru" element={<RequireAdmin><AdminWrapGuruChats /></RequireAdmin>} />
          <Route path="/admin/agent-test" element={<RequireAdmin><AdminAgentTest /></RequireAdmin>} />
          {/* Proof Approval System (Phase 7) — shop owner dashboard.
              Folded into ApprovePro: /proofs was a strict subset of the
              workbench, so one job no longer lives in two places. Redirect
              keeps old links/bookmarks working. */}
          <Route path="/proofs" element={<ApproveProUnavailable />} />
          {/* ApprovePro — shop workbench (split pane: orders list + detail) */}
          <Route path="/approvepro" element={<ApproveProUnavailable />} />
          <Route path="/designpanelpro-workspace" element={<RequireAuth><DesignPanelProWorkspace /></RequireAuth>} />
          <Route path="/panel-lab" element={<RequireAdmin><PanelLab /></RequireAdmin>} />
          <Route path="/production-proof" element={<RequireAdmin><ProductionProof /></RequireAdmin>} />
          {/* Multi-window render queue */}
          <Route path="/queue" element={<RequireAuth><RenderQueue /></RequireAuth>} />
          <Route path="/design-assets" element={<RequireAuth><DesignAssets /></RequireAuth>} />
          <Route path="/design-assets/:generationId" element={<RequireAuth><DesignAssets /></RequireAuth>} />
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
        <AppCartBubble onClick={() => setIsCartDrawerOpen(true)} />
        <AppCartDrawer isOpen={isCartDrawerOpen} onClose={() => setIsCartDrawerOpen(false)} />
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
