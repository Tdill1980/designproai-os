import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Palette, Layers, Package, CheckCircle, Video, Image, ArrowRight, Grid3x3, Star, Wand2, Download, Trash2, AlertTriangle, Zap, Users, Mail, MessageSquare, Target, Megaphone, Sparkles, ImagePlus, BookOpen, FileText, Calculator, MonitorSmartphone, LayoutDashboard, FileImage, Rocket, Store, Gift, Plug } from "lucide-react";
import { generatePrintProPoster } from "@/lib/printpro-poster-generator";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import EngineRoomUrgentReportsCard from "@/components/engineroom/EngineRoomUrgentReportsCard";
import ErrorMonitorCard from "@/components/dashboard/ErrorMonitorCard";
import ProductionAgentReportsCard from "@/components/production/ProductionAgentReportsCard";

const OPERATOR_EMAILS = [
  "tdill@restyleproai.com",
  "jackson@weprintwraps.com",
  "carley@restyleproai.com",
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupStats, setCleanupStats] = useState<any>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data?.user?.email || null);
    });
  }, []);

  // Fetch cleanup stats
  const { data: cleanupStatsData, refetch: refetchStats } = useQuery({
    queryKey: ["cleanup-stats"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
      
      const response = await supabase.functions.invoke('cleanup-renders', {
        body: { action: 'stats' }
      });
      
      if (response.error) throw response.error;
      return response.data?.stats || null;
    },
    refetchOnWindowFocus: false,
  });

  const handleCleanDatabase = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete ALL broken renders?\n\nThis will permanently delete:\n- Records with "custom" or "unknown" labels\n- Records with pipe "|" characters\n- All GraphicsPro/CustomStyling mode renders\n\nThis action cannot be undone.'
    );
    
    if (!confirmed) return;
    
    setCleanupLoading(true);
    toast.loading("Cleaning database...");
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.dismiss();
        toast.error("Not authenticated");
        return;
      }
      
      const response = await supabase.functions.invoke('cleanup-renders', {
        body: { action: 'clean' }
      });
      
      toast.dismiss();
      
      if (response.error) {
        toast.error(`Cleanup failed: ${response.error.message}`);
        return;
      }
      
      const results = response.data?.results;
      toast.success(
        `Database cleaned! Deleted ${results?.vehicle_renders || 0} vehicle renders and ${results?.color_visualizations || 0} visualizations.`
      );
      
      // Refetch stats
      refetchStats();
      // Invalidate gallery queries
      queryClient.invalidateQueries();
      
    } catch (error) {
      toast.dismiss();
      toast.error("Cleanup failed");
      console.error(error);
    } finally {
      setCleanupLoading(false);
    }
  };

  const handleDownloadCatalog = async () => {
    toast.loading("Generating PrintPro Color Catalog PDF...");
    try {
      await generatePrintProPoster();
      toast.dismiss();
      toast.success("PDF downloaded successfully!");
    } catch (error) {
      toast.dismiss();
      toast.error("Failed to generate PDF");
      console.error(error);
    }
  };

  // Fetch counts for each content type
  const { data: inkfusionCount } = useQuery({
    queryKey: ["inkfusion-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("inkfusion_carousel")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: swatchCount } = useQuery({
    queryKey: ["swatch-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("inkfusion_swatches")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: fadewrapsCount } = useQuery({
    queryKey: ["fadewraps-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("fadewraps_carousel")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: patternsCount } = useQuery({
    queryKey: ["patterns-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("fadewraps_patterns")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: wbtyCount } = useQuery({
    queryKey: ["wbty-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("wbty_carousel")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: productsCount } = useQuery({
    queryKey: ["products-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("wbty_products")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: approveModeCount } = useQuery({
    queryKey: ["approvemode-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("approvemode_carousel")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: examplesCount } = useQuery({
    queryKey: ["examples-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("approvemode_examples")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: designPanelProCount } = useQuery({
    queryKey: ["designpanelpro-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("designpanelpro_carousel")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: panelPatternsCount } = useQuery({
    queryKey: ["panel-patterns-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("designpanelpro_patterns")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: vinylSwatchCount } = useQuery({
    queryKey: ["vinyl-swatch-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("vinyl_swatches")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: heroCarouselCount } = useQuery({
    queryKey: ["hero-carousel-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("hero_carousel")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: showcaseCount } = useQuery({
    queryKey: ["showcase-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("homepage_showcase")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });

  const { data: featuredHeroCount } = useQuery({
    queryKey: ["featured-hero-count"],
    queryFn: async () => {
      const { count } = await supabase
        .from("color_visualizations")
        .select("*", { count: "exact", head: true })
        .eq("is_featured_hero", true);
      return count || 0;
    },
  });

  // Public-listed CreatorMarket cards (drives the count badge on the
  // admin dashboard CreatorMarket section).
  const { data: creatorMarketCount } = useQuery({
    queryKey: ["creator-market-listed-count"],
    queryFn: async () => {
      const { count } = await (supabase as never as { from: (t: string) => any })
        .from("marketplace_listings")
        .select("*", { count: "exact", head: true })
        .eq("status", "listed")
        .eq("is_hidden", false);
      return count || 0;
    },
  });

  const contentSections = [
    {
      // FIRST, AND ON ITS OWN. Every external account the system signs into
      // lives on ONE page — Canva, Meta, YouTube, Google, Klaviyo — and that
      // page was reachable only as `/admin/seo/connections`, filed under SEO
      // with no nav entry anywhere. Six other surfaces deep-link to it
      // (AdsPerformancePanel, YouTubeConnectionButton, WrapGuruPublishCard,
      // SeoPro, AdminSeoGbpPosts), so the page was never lost — only unfindable
      // unless you were already on a page that mentioned it.
      //
      // It sits first because it gates the others: Canva autofill, social
      // publishing and ads reporting all read their tokens from here, and
      // `canva_integrations` has ZERO rows — measured 2026-08-10 — which is why
      // no post in the system has ever carried a Canva export.
      id: "connections",
      title: "Connections — Canva · Meta · YouTube · Google · Klaviyo",
      description: "Every external account the system signs into. Connect them here; the agents read their tokens from this one page.",
      icon: Plug,
      color: "text-emerald-400",
      bgColor: "bg-emerald-500/10",
      items: [
        { label: "All connections (connect / disconnect external apps)", action: () => navigate("/admin/seo/connections") },
        { label: "Canva — connect, then map a brand template per brand", action: () => navigate("/admin/seo/connections#canva") },
        { label: "Social publishing (Meta · YouTube · X · LinkedIn)", action: () => navigate("/admin/seo/connections#social") },
      ],
    },
    {
      // The Azure Outlook email agent's approval queue: AI-drafted replies to
      // leads in trish@/hello@/design@, plus the trish@ mailbox cleanup and
      // delete-from-mailbox controls. Backend lives in the WrapCommand
      // Supabase project — see docs/AZURE_OUTLOOK_MARKETING_API.md.
      id: "lead-replies",
      title: "Lead Replies — Email Agent",
      description: "AI-drafted replies to inbox leads (trish@ · hello@ · design@) waiting for your approval, plus mailbox cleanup",
      icon: Mail,
      color: "text-purple-400",
      bgColor: "bg-purple-500/10",
      items: [
        { label: "Review & approve lead replies (nothing sends without you)", action: () => navigate("/admin/lead-replies") },
        { label: "Noise / cleanup — see filtered junk, delete email from the mailbox", action: () => navigate("/admin/lead-replies") },
      ],
    },
    {
      id: "ai-workforce",
      title: "AI Workforce",
      description: "The agent system — review queues, approvals, scoreboard, and the video/content creator",
      icon: Megaphone,
      color: "text-pink-400",
      bgColor: "bg-pink-500/10",
      items: [
        { label: "Content Director (THE approval queue — approve = scheduled = published)", action: () => navigate("/admin/content-director") },
        { label: "Script Studio (ContentDirectorIQ — footage → transcript → script → rough cut)", action: () => navigate("/admin/script-studio") },
        { label: "Content Composer (brand → format → destination → assembled candidates)", action: () => navigate("/admin/composer") },
        { label: "Video Studio (AI video crew — renders, Episode Builder, Cut Editor)", action: () => navigate("/engine-room") },
        { label: "Workforce Dashboard (agent review queues + scoreboard)", action: () => navigate("/admin/workforce") },
        { label: "Creator Studio (footage library, hooks, video cuts)", action: () => navigate("/admin/creator") },
      ],
    },
    {
      id: "marketing-engine-room",
      title: "Marketing Hub / Engine Room",
      description: "Campaigns, content & growth — Marketing Hub and Engine Room are the same surface",
      icon: Megaphone,
      color: "text-cyan-400",
      bgColor: "bg-cyan-500/10",
      items: [
        { label: "Marketing Hub", action: () => navigate("/admin/marketing-hub") },
        { label: "Engine Room", action: () => navigate("/engine-room") },
        { label: "Engine Room Reports (bug / issue queue)", action: () => navigate("/admin/engineroom-reports") },
        { label: "Marketing Agent", action: () => navigate("/admin/marketing-agent") },
        { label: "Narrative Arcs (one topic → an ordered series, grounded in footage)", action: () => navigate("/admin/narrative-arcs") },
      ],
    },
    {
      id: "designpanelpro-admin",
      title: "DesignPanelPro™ Admin",
      description: "All design assets (artboard, 3D, separated files) per design",
      icon: LayoutDashboard,
      color: "text-fuchsia-500",
      bgColor: "bg-fuchsia-500/10",
      items: [
        { label: "Open DesignPanelPro Admin (latest design)", action: () => navigate("/design-assets") },
        { label: "QC ProductionFlow (after Order Production Pack)", action: () => navigate("/productionflow") },
      ],
    },
    {
      id: "approvemode",
      title: "ApprovePro™ Admin",
      description: "Orders, proofs & approvals — the daily driver",
      icon: CheckCircle,
      color: "text-orange-500",
      bgColor: "bg-orange-500/10",
      items: [
        { label: "ApprovePro Manager (Orders & Proofs)", action: () => navigate("/admin/approvemode") },
        { label: "Hero Carousel Images", count: approveModeCount, action: () => navigate("/admin/carousel?product=approvemode") },
        { label: "Before/After Examples", count: examplesCount, action: () => navigate("/admin/carousel?product=approvemode") },
      ],
    },
    {
      id: "sprocket",
      title: "SprocketChat Admin",
      description: "Live helper · every ticket · every transcript",
      icon: MessageSquare,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      items: [
        { label: "Sprocket Agent (Chat · Tickets · Transcripts)", action: () => navigate("/admin/sprocket") },
      ],
    },
    {
      id: "wrapguru",
      title: "WrapGuru",
      description: "Live test chat · transcripts · geo · leads · print-file checks",
      icon: MessageSquare,
      color: "text-pink-500",
      bgColor: "bg-pink-500/10",
      items: [
        // The customer-facing chat itself — the page to test quoting, order
        // status and the print-file check against before it goes out on WPW.
        { label: "Test WrapGuru Chat (live customer page)", action: () => navigate("/wrapguru") },
        { label: "WrapGuru Chats (Transcripts · Location · Leads)", action: () => navigate("/admin/wrapguru") },
        { label: "Print-File Checks (scores · flagged for review)", action: () => navigate("/admin/wrapguru#file-checks") },
      ],
    },
    {
      id: "shopengine",
      title: "ShopEngine Dashboard",
      description: "Hero + tool card images shown at /dashboard",
      icon: LayoutDashboard,
      color: "text-cyan-400",
      bgColor: "bg-cyan-500/10",
      items: [
        { label: "Dashboard Hero Images (1–5)", action: () => navigate("/admin/homepage-images?section=dashboard-hero") },
        { label: "Tool Card Images", action: () => navigate("/admin/homepage-images?section=tool") },
        { label: "All Homepage + Dashboard Sections", action: () => navigate("/admin/homepage-images") },
      ],
    },
    {
      id: "landing",
      title: "Landing Page",
      description: "Public marketing homepage carousels",
      icon: Star,
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
      items: [
        { label: "Hero Carousel Images", count: heroCarouselCount, action: () => navigate("/admin/hero-carousel") },
        { label: "Hero Render Picker", count: featuredHeroCount, action: () => navigate("/admin/hero-render-picker") },
        { label: "Showcase Gallery", count: showcaseCount, action: () => navigate("/admin/showcase-manager") },
        { label: "Homepage Section Images", action: () => navigate("/admin/homepage-images") },
        { label: "Product Page Images (carousel)", action: () => navigate("/admin/product-images") },
        { label: "GraphicsPro Hero Image", action: () => navigate("/admin/graphicspro-hero") },
        { label: "GraphicsPro Batch Test", action: () => navigate("/admin/graphicspro-batch-test") },
        { label: "WPW Founder & Team Assets (Meet-the-Team Reels)", action: () => navigate("/admin/wpw-founder-assets") },
        { label: "WPW Founder Page — Send Campaign", action: () => navigate("/admin/wpw-founder-campaign") },
        { label: "WePrintWraps.com Homepage Sliders", action: () => navigate("/admin/wpw-homepage-sliders") },
      ],
    },
    {
      id: "colorpro",
      title: "ColorPro™",
      description: "AI Swatch Generator",
      icon: Palette,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
      items: [
        { label: "Generate AI Swatches", count: swatchCount, action: () => navigate("/admin/colorpro-manager") },
        { label: "Vinyl Swatch QA Dashboard", count: vinylSwatchCount, action: () => navigate("/admin/swatch-qa") },
        { label: "LAB Extraction Monitor", count: vinylSwatchCount, action: () => navigate("/admin/lab-monitor") },
      ],
    },
    {
      id: "inkfusion",
      title: "InkFusion",
      description: "Appears on /inkfusion page",
      icon: Palette,
      color: "text-purple-500",
      bgColor: "bg-purple-500/10",
      items: [
        { label: "Hero Carousel Images", count: inkfusionCount, action: () => navigate("/admin/carousel?product=inkfusion") },
        { label: "Color Swatches", count: swatchCount, action: () => navigate("/admin/inkfusion-manager") },
      ],
    },
    {
      id: "fadewraps",
      title: "FadeWraps",
      description: "Appears on /fadewraps page",
      icon: Layers,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      items: [
        { label: "Hero Carousel Images", count: fadewrapsCount, action: () => navigate("/admin/carousel?product=fadewraps") },
        { label: "Pattern Library", count: patternsCount, action: () => navigate("/admin/fadewraps-manager") },
      ],
    },
    {
      id: "wbty",
      title: "PatternPro™",
      description: "Appears on /wbty page",
      icon: Package,
      color: "text-green-500",
      bgColor: "bg-green-500/10",
      items: [
        { label: "Hero Carousel Images", count: wbtyCount, action: () => navigate("/admin/carousel?product=wbty") },
        { label: "Products", count: productsCount, action: () => navigate("/admin/wbty-manager") },
      ],
    },
    {
      id: "designpanelpro",
      title: "RestyleLibrary™",
      description: "Appears on /designpanelpro page",
      icon: Grid3x3,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      items: [
        { label: "Hero Carousel Images", count: designPanelProCount, action: () => navigate("/admin/carousel?product=designpanelpro") },
        { label: "Pattern Library", count: panelPatternsCount, action: () => navigate("/admin/designpanelpro-manager") },
      ],
    },
    {
      id: "blog",
      title: "Blog",
      description: "Content calendar & posts",
      icon: FileText,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      items: [
        { label: "Blog Manager", action: () => navigate("/admin/blog") },
      ],
    },
    {
      id: "creatormarket",
      title: "CreatorMarket",
      description: "Public /creatormarket cards + creator settings",
      icon: Store,
      color: "text-fuchsia-500",
      bgColor: "bg-fuchsia-500/10",
      items: [
        // Listing manager — primary entry: create new cards (7 views +
        // 2D panel + "Created by" name), hide / pin / reorder, trade
        // tags, wrap-shipping toggle.
        { label: "Listing Manager — Add / Hide / Pin Cards", count: creatorMarketCount, action: () => navigate("/admin/creatormarket-manager") },
        // Settings hub — revenue split, creator review queue, hero
        // video, Instagram auto-publish.
        { label: "Settings, Creators & IG Auto-Post", action: () => navigate("/admin/creator-market") },
      ],
    },
  ];

  return (
    <div className="light min-h-screen flex flex-col bg-background text-foreground">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">Admin Dashboard</h1>
            <p className="text-muted-foreground">Manage all content across your website</p>
          </div>

          {/* AI Workforce + Creator Studio — top of the dashboard per Trish */}
          <a href="/admin/workforce" className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div>
              <p className="text-lg font-bold text-gray-900">
                AI <span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Workforce</span>
              </p>
              <p className="text-sm text-gray-500">The agent system — review queues, campaign approvals, team scoreboard, and every draft the agents prepared for you.</p>
            </div>
            <span className="rounded-lg bg-gradient-to-r from-blue-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white">Open</span>
          </a>

          <a href="/admin/creator" className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div>
              <p className="text-lg font-bold text-gray-900">
                Creator <span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Studio</span>
              </p>
              <p className="text-sm text-gray-500">Footage library, scored hooks and sound bites, click-to-jump player, one-click video cuts, render jobs, thumbnails.</p>
            </div>
            <span className="rounded-lg bg-gradient-to-r from-blue-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white">Open</span>
          </a>

          {/* Production Files — the print-ready panel hub (top placement per Trish) */}
          <a href="/admin/production-files" className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div>
              <p className="text-lg font-bold text-gray-900">
                Production<span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Files</span>
              </p>
              <p className="text-sm text-gray-500">Print-ready panels by job — WrapDesignJobs (ApprovePro) + DesignProAI — download, Build Print Files, Topaz upscale.</p>
            </div>
            <span className="rounded-lg bg-gradient-to-r from-blue-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white">Open</span>
          </a>

          {/* PanelProStudio — upload PanelPro Extract artwork per side and compare against the job's real design files */}
          <a href="/admin/studio-board" className="mb-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
            <div>
              <p className="text-lg font-bold text-gray-900">
                PanelPro<span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Studio</span>
              </p>
              <p className="text-sm text-gray-500">Search a job, upload the PanelPro Extract files you create per side, then slide them over the real design proof to compare and approve.</p>
            </div>
            <span className="rounded-lg bg-gradient-to-r from-blue-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white">Open</span>
          </a>

          {/* Production Pipeline Agent — auto-fixes safe job failures + flags the rest */}
          <ProductionAgentReportsCard />

          {/* Urgent bug reports from users + team — copy straight into Claude */}
          <EngineRoomUrgentReportsCard />

          {/* Live frontend error monitor — links to the full Error Dashboard */}
          <ErrorMonitorCard />

          {/* Quick Launch - Batch Render, QA Studio, Batch Results, Production Test */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <Card className="border-2 border-blue-500/50 bg-gradient-to-br from-blue-500/10 to-purple-500/10 hover:shadow-lg hover:shadow-blue-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/batch-render")}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500">
                    <Zap className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Batch Control Center</CardTitle>
                    <CardDescription>Trigger &amp; monitor batch renders</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:opacity-90 text-white font-semibold">
                  Open Control Center
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-green-500/50 bg-gradient-to-br from-green-500/10 to-emerald-500/10 hover:shadow-lg hover:shadow-green-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/batch-qa-studio")}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500">
                    <Star className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Batch QA Studio</CardTitle>
                    <CardDescription>Curate, rate, promote renders</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-gradient-to-r from-green-500 to-emerald-500 hover:opacity-90 text-white font-semibold">
                  Open QA Studio
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-yellow-500/50 bg-gradient-to-br from-yellow-500/10 to-amber-500/10 hover:shadow-lg hover:shadow-yellow-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/batch-results")}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-yellow-500 to-amber-500">
                    <Star className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Batch Results</CardTitle>
                    <CardDescription>Grid + list view of all renders</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-gradient-to-r from-yellow-500 to-amber-500 hover:opacity-90 text-white font-semibold">
                  Open Batch Results
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-fuchsia-500/50 bg-gradient-to-br from-fuchsia-500/10 to-purple-500/10 hover:shadow-lg hover:shadow-fuchsia-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/panel-batch")}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-fuchsia-500 to-purple-500">
                    <Layers className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Panel Batch Generate</CardTitle>
                    <CardDescription>Flat panels for RestyleLibrary</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-gradient-to-r from-fuchsia-500 to-purple-500 hover:opacity-90 text-white font-semibold">
                  Open Panel Batch
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-cyan-500/50 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 hover:shadow-lg hover:shadow-cyan-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/design-file-batch")}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500">
                    <FileImage className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Design File Batch Generator</CardTitle>
                    <CardDescription>Upload a wrapped vehicle → batch flat panels of the wrap</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 text-white font-semibold">
                  Open Design File Batch
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-emerald-500/50 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 hover:shadow-lg hover:shadow-emerald-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/wallpro-batch")}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500">
                    <Layers className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">WallPro Batch Generate</CardTitle>
                    <CardDescription>Wall wrap designs — 100 prompts across 10 categories</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:opacity-90 text-white font-semibold">
                  Open WallPro Batch
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-orange-500/50 bg-gradient-to-br from-orange-500/10 to-red-500/10 hover:shadow-lg hover:shadow-orange-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/production-test")}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-orange-500 to-red-500">
                    <Package className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Production Pipeline Test</CardTitle>
                    <CardDescription>Universal Panelizer Tool - print production output</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white font-semibold">
                  Open Production Test
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Backend Admin: All User Renders — see every user's renders */}
          <div className="grid grid-cols-1 gap-4 mb-8">
            <Card className="border-2 border-pink-500/50 bg-gradient-to-br from-pink-500/10 to-purple-500/10 hover:shadow-lg hover:shadow-pink-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/user-renders")}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-pink-500 to-purple-500">
                    <Users className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Admin · All User Renders</CardTitle>
                    <CardDescription>Backend monitor — every user on the platform &amp; their full render history</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:opacity-90 text-white font-semibold">
                  Open Backend Render Monitor
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Comp Production Packs — grant free packs that bypass tier */}
          <div className="grid grid-cols-1 gap-4 mb-8">
            <Card className="border-2 border-cyan-500/50 bg-gradient-to-br from-cyan-500/10 to-teal-500/10 hover:shadow-lg hover:shadow-cyan-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/pack-credits")}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-500">
                    <Gift className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Comp Production Packs</CardTitle>
                    <CardDescription>Grant a user free production packs that bypass their subscription tier</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button className="w-full bg-gradient-to-r from-cyan-500 to-teal-500 hover:opacity-90 text-white font-semibold">
                  Open Comp Packs
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Operator Tools - restricted to Trish & Jackson */}
          {userEmail && OPERATOR_EMAILS.includes(userEmail) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <Card className="border-2 border-cyan-500/50 bg-gradient-to-br from-cyan-500/10 to-teal-500/10 hover:shadow-lg hover:shadow-cyan-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/operator-guide")}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-500">
                      <BookOpen className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-xl">Operator Guide</CardTitle>
                      <CardDescription>Edge functions, tables, Claude Code templates</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button className="w-full bg-gradient-to-r from-cyan-500 to-teal-500 hover:opacity-90 text-white font-semibold">
                    Open Operator Guide
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-2 border-purple-500/50 bg-gradient-to-br from-purple-500/10 to-cyan-500/10 hover:shadow-lg hover:shadow-purple-500/20 transition-all cursor-pointer" onClick={() => navigate("/admin/operator-onboarding")}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-lg bg-gradient-to-r from-purple-500 to-cyan-500">
                      <Users className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-xl">System &amp; Stripe Wizard</CardTitle>
                      <CardDescription>Onboard operators — Supabase, Stripe, admin tools</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button className="w-full bg-gradient-to-r from-purple-500 to-cyan-500 hover:opacity-90 text-white font-semibold">
                    Open Onboarding Wizard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {contentSections.map((section) => {
              const Icon = section.icon;
              return (
                <Card key={section.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`p-3 rounded-lg ${section.bgColor}`}>
                        <Icon className={`h-6 w-6 ${section.color}`} />
                      </div>
                      <div>
                        <CardTitle>{section.title}</CardTitle>
                        <CardDescription>{section.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {section.items.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Image className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium text-sm">{item.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.count !== undefined ? `${item.count} items` : "Loading..."}
                            </p>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={item.action}
                          className="hover:bg-background"
                        >
                          Manage
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <Card className="border-2 border-cyan-500/50 bg-gradient-to-br from-cyan-500/10 to-blue-500/10">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-cyan-500/10">
                    <ImagePlus className="h-6 w-6 text-cyan-500" />
                  </div>
                  <div>
                    <CardTitle>Hero Carousel</CardTitle>
                    <CardDescription>Upload and manage the main landing page hero carousel images</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button onClick={() => navigate("/admin/hero-carousel")} className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 text-white">
                  Manage Images
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button onClick={() => navigate("/admin/hero-render-picker")} variant="outline">
                  Pick Renders
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-sky-500/50 bg-gradient-to-br from-sky-500/10 to-cyan-500/10">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-sky-500/10">
                    <ImagePlus className="h-6 w-6 text-sky-500" />
                  </div>
                  <div>
                    <CardTitle>Try Landing ($25)</CardTitle>
                    <CardDescription>Edit the public /try page — headline, bullets, image gallery, 2D + 3D proof tiles, $299 production-pack section</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex gap-2">
                <Button onClick={() => navigate("/admin/try-landing")} className="bg-gradient-to-r from-sky-500 to-cyan-500 hover:opacity-90 text-white">
                  Manage Try Page
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button onClick={() => window.open("/try", "_blank")} variant="outline">
                  Preview /try
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-pink-500/10">
                    <Image className="h-6 w-6 text-pink-500" />
                  </div>
                  <div>
                    <CardTitle>Homepage Showcase</CardTitle>
                    <CardDescription>Manage the featured wrap images on homepage</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/showcase-manager")} variant="outline">
                  Manage Showcase
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-red-500/10">
                    <Video className="h-6 w-6 text-red-500" />
                  </div>
                  <div>
                    <CardTitle>Video Management</CardTitle>
                    <CardDescription>Manage hero videos for all products</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/carousel")} variant="outline">
                  Manage Videos
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-green-500/10">
                    <Image className="h-6 w-6 text-green-500" />
                  </div>
                  <div>
                    <CardTitle>Gallery Management</CardTitle>
                    <CardDescription>Manage and delete gallery carousel items</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/gallery-manager")} variant="outline">
                  Advanced Gallery Manager
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-yellow-500/10">
                    <Star className="h-6 w-6 text-yellow-500" />
                  </div>
                  <div>
                    <CardTitle>Quality Review</CardTitle>
                    <CardDescription>Monitor render quality ratings and flagged issues</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/quality-review")} variant="outline">
                  Review Quality
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-blue-500 to-blue-500">
                    <Star className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>Rate Designs</CardTitle>
                    <CardDescription>Star-rate renders to train DesignIQ RAG - the more you rate, the smarter it gets</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/rate-designs")} variant="outline">
                  Start Rating
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-orange-500/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500">
                    <Star className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>QA &amp; Curation Studio</CardTitle>
                    <CardDescription>Grid view, star ratings, error flagging, winner testing pipeline, promote to gallery &amp; library.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/batch-qa-studio")} className="bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-90 text-white">
                  Open QA Studio
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-cyan-500/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-500">
                    <Package className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>QC ProductionFlow</CardTitle>
                    <CardDescription>Review production-pack jobs, validate panels on vehicle templates, run the G.E.N.I.E.™ Deterministic Slicer, and ship the WrapBox™ Production Pack</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/productionflow")} className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:opacity-90 text-white">
                  Open QC ProductionFlow
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            {/* Print Production Queue — paid production-pack orders land here
                (print_production_requests). Review the proof, attach panels, run
                the slicer, and ship to WrapBox. Surfaced next to QC ProductionFlow
                so it's easy to find. */}
            <Card className="border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-blue-500/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600">
                    <Package className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>Print Production Queue</CardTitle>
                    <CardDescription>Paid production-pack orders — review the approved proof, attach the print-ready panels, and ship the WrapBox™ Production Pack</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/print-production")} className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:opacity-90 text-white">
                  Open Print Production Queue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500">
                    <Wand2 className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>AI Auto-Fix</CardTitle>
                    <CardDescription>Automatically analyze and fix quality issues with AI</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/ai-auto-fix")} variant="outline">
                  Run AI Analysis
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-[#38BDF8] to-[#D946EF]">
                    <Layers className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>Bulk DesignProAI Generator</CardTitle>
                    <CardDescription>Generate 25 AI wrap designs at once - star rate, revise, test with VisionBoardIQ & MyVehiclePro</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/bulk-design")} className="bg-gradient-to-r from-[#38BDF8] to-[#D946EF] hover:opacity-90 text-white">
                  Launch Bulk Generator
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-pink-500/30 bg-gradient-to-br from-pink-500/5 to-purple-500/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-pink-500 to-purple-500">
                    <Palette className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>Content Studio</CardTitle>
                    <CardDescription>Templates, text overlays, hooks library, brand kit — create Meta ads, IG stories, reels & more</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/content-studio")} className="bg-gradient-to-r from-pink-500 to-purple-500 hover:opacity-90 text-white">
                  Open Content Studio
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-black bg-gradient-to-br from-neutral-50 to-neutral-100">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-black">
                    <Rocket className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>Ads Launch Pack</CardTitle>
                    <CardDescription>10 paste-ready Meta ad creatives baked from your ColorPro + MyVehiclePro renders. One click → zip of PNGs.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/ads-launch-pack")} className="bg-black hover:opacity-90 text-white">
                  Open Ads Launch Pack
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-fuchsia-500/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500 to-fuchsia-500">
                    <MonitorSmartphone className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>WPW Banner Preview</CardTitle>
                    <CardDescription>1600×500 dashboard + DesignPro banner for the WePrintWraps homepage. Pick screenshots, export PNG.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/banner-preview")} className="bg-gradient-to-r from-cyan-500 to-fuchsia-500 hover:opacity-90 text-white">
                  Open Banner Preview
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-fuchsia-500/30 bg-gradient-to-br from-fuchsia-500/5 to-cyan-500/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-fuchsia-500 to-cyan-500">
                    <Mail className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>WPW Email Signature</CardTitle>
                    <CardDescription>600×200 promo banner for the bottom of every WePrintWraps Outlook email — pick copy, export PNG, copy the Outlook HTML snippet.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/email-signature")} className="bg-gradient-to-r from-fuchsia-500 to-cyan-500 hover:opacity-90 text-white">
                  Open Email Signature
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-[#D946EF] to-[#9b87f5]">
                    <Download className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>PrintPro™ Color Catalog</CardTitle>
                    <CardDescription>Download branded PDF with Pantone colors, InkFusion swatches & renders</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button 
                  onClick={handleDownloadCatalog} 
                  className="bg-gradient-to-r from-[#D946EF] to-[#9b87f5] hover:opacity-90"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Color Catalog PDF
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Email Marketing & Retargeting */}
          <div className="grid grid-cols-1 md:grid-cols-1 gap-6 mt-6">
            <Card className="border-2 border-orange-500/30 bg-gradient-to-br from-orange-500/5 to-red-500/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-orange-500 to-red-500">
                    <Target className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Email Marketing & Retargeting</CardTitle>
                    <CardDescription>Campaigns, SMS, templates, subscriber management & conversion tracking</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <Target className="h-4 w-4 text-orange-400" />
                    <div>
                      <p className="font-medium text-sm">Retargeting Dashboard</p>
                      <p className="text-xs text-muted-foreground">All emails, conversions, retarget scheduling</p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/retargeting")} className="hover:bg-background">
                    Open <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <Megaphone className="h-4 w-4 text-cyan-400" />
                    <div>
                      <p className="font-medium text-sm">Email Campaigns</p>
                      <p className="text-xs text-muted-foreground">Create, send & track email campaigns</p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/campaigns")} className="hover:bg-background">
                    Manage <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-4 w-4 text-green-400" />
                    <div>
                      <p className="font-medium text-sm">SMS Campaigns</p>
                      <p className="text-xs text-muted-foreground">Send text message campaigns via Twilio</p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/sms-campaigns")} className="hover:bg-background">
                    Manage <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-purple-400" />
                    <div>
                      <p className="font-medium text-sm">Email Templates</p>
                      <p className="text-xs text-muted-foreground">MightyMail template library</p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/mightymail")} className="hover:bg-background">
                    Manage <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <Button
                  onClick={() => navigate("/admin/retargeting")}
                  className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:opacity-90 text-white font-semibold"
                >
                  Open Retargeting Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Content Studio */}
          <div className="grid grid-cols-1 md:grid-cols-1 gap-6 mt-6">
            <Card className="border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-purple-500/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500 to-purple-500">
                    <Sparkles className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Content Studio</CardTitle>
                    <CardDescription>Create promotional content — FB ads, IG posts, stories, reels, carousels</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-4 w-4 text-cyan-400" />
                    <div>
                      <p className="font-medium text-sm">Canvas Editor</p>
                      <p className="text-xs text-muted-foreground">Templates, text overlays, hooks library, brand kit</p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/content-studio")} className="hover:bg-background">
                    Open <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <Button
                  onClick={() => navigate("/admin/content-studio")}
                  className="w-full bg-gradient-to-r from-cyan-500 to-purple-500 hover:opacity-90 text-white font-semibold"
                >
                  Open Content Studio
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Affiliate Partner Portal */}
          <div className="grid grid-cols-1 md:grid-cols-1 gap-6 mt-6">
            <Card className="border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-blue-500/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500">
                    <Users className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">Affiliate Partner Portal</CardTitle>
                    <CardDescription>Manage affiliate wrap artists, commissions, content, and payouts</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/40 hover:bg-cyan-500/15 transition-colors">
                  <div className="flex items-center gap-3">
                    <ImagePlus className="h-5 w-5 text-cyan-500" />
                    <div>
                      <p className="font-semibold text-sm">Per-Rep Marketing Kits</p>
                      <p className="text-xs text-muted-foreground">Upload images & customize each rep's content</p>
                    </div>
                  </div>
                  <Button size="sm" onClick={() => navigate("/admin/rep-marketing-kits")} className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 text-white">
                    Upload <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium text-sm">Partner Dashboard</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/affiliates")} className="hover:bg-background">
                    Manage <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <Video className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium text-sm">Content Review</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/affiliate-content")} className="hover:bg-background">
                    Review <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <Image className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium text-sm">Payouts</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate("/admin/affiliate-payouts")} className="hover:bg-background">
                    Manage <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium text-sm">Rep Sharing Kit</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate("/affiliate/sharing-kit")} className="hover:bg-background">
                    Open <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <Button
                  onClick={() => navigate("/affiliate/admin")}
                  className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:opacity-90 text-white font-semibold"
                >
                  Open Affiliate Admin
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Danger Zone - Database Cleanup */}
          <div className="mt-8">
            <Card className="border-destructive/50 bg-destructive/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-destructive/20">
                    <AlertTriangle className="h-6 w-6 text-destructive" />
                  </div>
                  <div>
                    <CardTitle className="text-destructive">Danger Zone</CardTitle>
                    <CardDescription>Clean up broken renders and invalid database entries</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                  <p className="text-sm font-medium">This will permanently delete:</p>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>Records with "custom" or "unknown" color labels</li>
                    <li>Records with pipe "|" characters in names</li>
                    <li>All GraphicsPro/CustomStyling mode renders</li>
                  </ul>
                  {cleanupStatsData && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-sm font-medium mb-2">Current problematic records:</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2 rounded bg-background">
                          <span className="font-medium">vehicle_renders:</span> {cleanupStatsData.vehicle_renders?.total || 0}
                        </div>
                        <div className="p-2 rounded bg-background">
                          <span className="font-medium">color_visualizations:</span> {cleanupStatsData.color_visualizations?.total || 0}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <Button 
                  onClick={handleCleanDatabase}
                  disabled={cleanupLoading}
                  variant="destructive"
                  className="w-full"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {cleanupLoading ? "Cleaning..." : "Clean Database"}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-blue-500/5">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600">
                    <Calculator className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>QuickQuote</CardTitle>
                    <CardDescription>Manage film prices, print prices, regional labor rates, shop branding, and view quote analytics</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/quote-pricing")} className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:opacity-90 text-white">
                  Manage Pricing
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500">
                    <MonitorSmartphone className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle>Popup Manager</CardTitle>
                    <CardDescription>Upload carousel images and set copy for the site-wide promo popup</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Button onClick={() => navigate("/admin/popup-manager")} variant="outline">
                  Manage Popup
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

    </div>
  );
}
