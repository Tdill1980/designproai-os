import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { ShoppingCart, FileText, Share2, Loader2, ArrowLeft, Clock, Layers, Palette, Library, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Vehicle360Viewer } from "@/components/visualize/Vehicle360Viewer";
import { trackQuoteEvent, generateQuoteId } from "@/lib/track-conversion";
import { findVehicle, getPanelBreakdown, calculatePricingTier } from "@/data/vehicle-measurements";

interface PromptState {
  panelName?: string;
  panelUrl?: string;
  allViews?: Array<{ type: string; url: string }>;
  heroUrl?: string;
}

interface DesignJob {
  id: string;
  user_id: string | null;
  panel_id: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  finish: string | null;
  preview_image_url: string | null;
  prompt_state: PromptState | null;
}

interface RevisionHistoryItem {
  id: string;
  revision_prompt: string;
  created_at: string;
}

interface LocationState {
  designUrl?: string;
  revisionPrompt?: string;
  revisionHistory?: RevisionHistoryItem[];
  sourceTool?: string;
  designName?: string;
}

const PrintPro = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const locationState = location.state as LocationState | null;
  
  const designId = searchParams.get("designId");
  const jobType = searchParams.get("type") || "panel";
  
  const [job, setJob] = useState<DesignJob | null>(null);
  const [loading, setLoading] = useState(!!designId);

  // Revision data from navigation state
  const incomingDesignUrl = locationState?.designUrl || null;
  const incomingRevisionPrompt = locationState?.revisionPrompt || '';
  const incomingHistory = locationState?.revisionHistory || [];
  const sourceTool = locationState?.sourceTool || '';
  const designName = locationState?.designName || 'Custom Design';

  // Fetch design job if designId is provided
  useEffect(() => {
    async function loadDesignJob() {
      if (!designId) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("panel_designs")
          .select("*")
          .eq("id", designId)
          .single();

        if (error) throw error;
        if (data) {
          setJob({
            id: data.id,
            user_id: data.user_id,
            panel_id: data.panel_id,
            vehicle_year: data.vehicle_year,
            vehicle_make: data.vehicle_make,
            vehicle_model: data.vehicle_model,
            finish: data.finish,
            preview_image_url: data.preview_image_url,
            prompt_state: data.prompt_state as PromptState | null,
          });
        }
      } catch (err) {
        console.error("Failed to load design job:", err);
        toast.error("Could not load design");
      } finally {
        setLoading(false);
      }
    }

    loadDesignJob();
  }, [designId]);

  // Map vehicle to WPW Universal Panelizer size based on side width
  const vehicleLookup = job?.vehicle_make && job?.vehicle_model
    ? findVehicle(job.vehicle_make, job.vehicle_model)
    : null;
  const vehicleBreakdown = vehicleLookup ? getPanelBreakdown(vehicleLookup) : null;
  const sideWidth = vehicleLookup?.sideW || 172; // default to Medium if no match
  const { tier, price } = calculatePricingTier(sideWidth);

  // Handle checkout
  const handleCheckout = () => {
    if (job?.id) {
      // Track conversion event (fire-and-forget)
      trackQuoteEvent({
        eventType: "order_now_clicked",
        quoteId: generateQuoteId(),
        productType: "printpro",
        metadata: { 
          jobId: job.id,
          tier,
          price,
          vehicleInfo: `${job.vehicle_year} ${job.vehicle_make} ${job.vehicle_model}`,
          designName: job.prompt_state?.panelName 
        },
      });
      
      window.location.href = `https://weprintwraps.com/cart?job_id=${job.id}&tier=${tier}`;
    }
  };

  // Get images for 360 viewer
  const get360Images = (): string[] => {
    if (!job?.prompt_state?.allViews) return [];
    return job.prompt_state.allViews.map(v => v.url).filter(Boolean);
  };

  const heroUrl = job?.prompt_state?.heroUrl || job?.preview_image_url;
  const spinImages = get360Images();
  const hasSpinView = spinImages.length >= 4;

  const toolCards = [
    {
      id: "wallpro",
      icon: Layers,
      name: "WallPro",
      tagline: "AI Wall Wrap Designer & Visualizer",
      description: "Design and visualize custom wall wraps, murals, and large-format graphics with AI-powered rendering.",
      status: "active" as const,
      route: "/printpro/wallpro",
      accentColor: "#0EA5E9",
    },
    {
      id: "patternpro",
      icon: Palette,
      name: "PatternPro Print Files",
      tagline: "Purchase print-ready pattern panels",
      description: "Browse and order pre-printed pattern rolls in any design — sold by the yard, ready to install.",
      status: "active" as const,
      route: "/printpro/wbty",
      accentColor: "#8B5CF6",
    },
    {
      id: "restylelibrary",
      icon: Library,
      name: "RestyleLibrary Print Panels",
      tagline: "Browse & buy production-ready designs",
      description: "Full design packs with print-ready panels, cut files, and production specs for any vehicle.",
      status: "active" as const,
      route: "/printpro/design-packs",
      accentColor: "#D946EF",
    },
  ];

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Apple-grade checkout UI when a design job is loaded
  if (job && designId) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8 max-w-7xl">
          {/* Back button */}
          <Button
            variant="ghost"
            onClick={() => navigate("/printpro")}
            className="mb-6"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Products
          </Button>

          {/* Page Header */}
          <div className="mb-8">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
              Print<span className="bg-gradient-to-r from-[#D946EF] to-[#9b87f5] bg-clip-text text-transparent">Pro</span>™ Checkout
            </h1>
            <p className="text-lg text-muted-foreground mt-2">
              Review your design and order printed wrap panels
            </p>
          </div>

          {/* Two-column Apple-style layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
            
            {/* LEFT COLUMN - Visuals */}
            <div className="lg:col-span-7 space-y-6">
              {/* Hero or 360 Viewer */}
              <div className="rounded-2xl overflow-hidden shadow-xl bg-card border border-border">
                {false && hasSpinView ? (
                  <Vehicle360Viewer
                    images={spinImages}
                    vehicleName={`${job.vehicle_year || ''} ${job.vehicle_make || ''} ${job.vehicle_model || ''}`}
                    designName={job.prompt_state?.panelName || "Custom Design"}
                  />
                ) : heroUrl ? (
                  <img 
                    src={heroUrl} 
                    alt="Design preview" 
                    className="w-full aspect-video object-cover"
                  />
                ) : (
                  <div className="w-full aspect-video bg-muted flex items-center justify-center">
                    <p className="text-muted-foreground">No preview available</p>
                  </div>
                )}
              </div>

              {/* Project Details Card */}
              <div className="p-6 bg-card rounded-2xl shadow-lg border border-border space-y-4">
                <h2 className="text-xl font-semibold text-foreground">Project Details</h2>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Vehicle</p>
                    <p className="font-medium text-foreground">
                      {job.vehicle_year} {job.vehicle_make} {job.vehicle_model}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Design</p>
                    <p className="font-medium text-foreground">
                      {job.prompt_state?.panelName || "Custom Wrap"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Finish</p>
                    <p className="font-medium text-foreground capitalize">
                      {job.finish || "Gloss"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Estimated Coverage</p>
                    <p className="font-medium text-foreground">{estimatedSqft} sq.ft.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN - Order Panel */}
            <div className="lg:col-span-5 space-y-6">
              {/* Revision Notes Section (if coming from a tool with revision) */}
              {incomingRevisionPrompt && (
                <div className="p-4 border border-border/40 rounded-xl bg-background/30">
                  <h3 className="font-semibold mb-2 text-foreground">Revision Notes</h3>
                  <p className="text-sm text-muted-foreground">{incomingRevisionPrompt}</p>
                </div>
              )}

              {incomingHistory && incomingHistory.length > 0 && (
                <div className="p-4 border border-border/40 rounded-xl bg-background/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <h3 className="font-semibold text-foreground">Revision History</h3>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1 max-h-[120px] overflow-y-auto">
                    {incomingHistory.map((h) => (
                      <li key={h.id} className="flex justify-between">
                        <span className="truncate flex-1">• {h.revision_prompt}</span>
                        <span className="text-[10px] opacity-50 ml-2 shrink-0">
                          {new Date(h.created_at).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Main CTA Card */}
              <div className="bg-card rounded-2xl shadow-xl border border-border p-8 space-y-6">
                <div>
                  <h2 className="text-2xl font-bold text-foreground">Ready to Order?</h2>
                  <p className="text-muted-foreground mt-1">
                    Your design is saved and ready for production
                  </p>
                </div>

                {/* Pricing */}
                <div className="p-4 bg-muted/50 rounded-xl">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-sm text-muted-foreground">Recommended Size</p>
                      <p className="text-lg font-bold text-foreground uppercase">{tier}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Starting at</p>
                      <p className="text-2xl font-bold text-primary">${price}</p>
                    </div>
                  </div>
                </div>

                {/* Primary CTA */}
                <Button
                  size="lg"
                  variant="gradient"
                  className="w-full py-6 text-lg"
                  onClick={handleCheckout}
                >
                  <ShoppingCart className="mr-2 h-5 w-5" />
                  Order Production Pack
                </Button>

                {/* Secondary Actions */}
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    className="w-full"
                    onClick={() => toast.info("PDF proof generation coming soon")}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Download Proof
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => toast.info("Share functionality coming soon")}
                  >
                    <Share2 className="mr-2 h-4 w-4" />
                    Share Design
                  </Button>
                </div>
              </div>

              {/* Size Guide */}
              <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Size Guide</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className={tier === "small" ? "font-bold text-primary" : "text-muted-foreground"}>Small 144×59.5 (side &lt; 144")</span>
                    <span className="font-medium">$600</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className={tier === "medium" ? "font-bold text-primary" : "text-muted-foreground"}>Medium 172×59.5 (side 144"–172")</span>
                    <span className="font-medium">$710</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-border">
                    <span className={tier === "large" ? "font-bold text-primary" : "text-muted-foreground"}>Large 200×59.5 (side 172"–200")</span>
                    <span className="font-medium">$825</span>
                  </div>
                  <div className="flex justify-between py-2">
                    <span className={tier === "xl" ? "font-bold text-primary" : "text-muted-foreground"}>XL 240×59.5 (side 200"+)</span>
                    <span className="font-medium">$990</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default product catalog view — white/light variant matching ProductionFlow
  return (
    <div style={{ minHeight: "100vh", background: "#FFFFFF" }}>
      <Helmet>
        <title>PrintPro - Print-Ready Tools & Production | RestyleProAI</title>
        <meta name="description" content="Design, price, and order print-ready graphics for any surface. Wall wraps, pattern panels, production packs, and more." />
        <link rel="canonical" href="https://www.restyleproai.com/printpro" />
        <meta property="og:title" content="PrintPro - Print-Ready Tools & Production | RestyleProAI" />
        <meta property="og:description" content="Design, price, and order print-ready graphics for any surface." />
      </Helmet>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 24px 64px" }}>
        {/* ── Header ── */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h1
            style={{
              fontFamily: "'League Spartan', sans-serif",
              fontSize: 48,
              fontWeight: 800,
              color: "#111111",
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            Print
            <span
              style={{
                background: "linear-gradient(135deg, #0EA5E9, #8B5CF6, #D946EF)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              Pro
            </span>
          </h1>
          <p
            style={{
              fontFamily: "'League Spartan', sans-serif",
              fontSize: 20,
              fontWeight: 500,
              color: "#111111",
              margin: "8px 0 0",
              letterSpacing: "-0.01em",
            }}
          >
            Print-Ready Tools & Production
          </p>
          <p
            style={{
              fontSize: 15,
              color: "#6B7280",
              margin: "12px 0 0",
              maxWidth: 480,
              marginLeft: "auto",
              marginRight: "auto",
              lineHeight: 1.5,
            }}
          >
            Design, price, and order print-ready graphics for any surface.
          </p>
        </div>

        {/* ── Tool Cards Grid ── */}
        <div
          style={{ gap: 20 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
        >
          {toolCards.map((card) => {
            const Icon = card.icon;
            const isComingSoon = card.status === "coming_soon";
            return (
              <div
                key={card.id}
                onClick={() => {
                  if (isComingSoon) {
                    toast.info("Coming soon — stay tuned!");
                    return;
                  }
                  if (card.route) navigate(card.route);
                }}
                style={{
                  background: "#F7F8FA",
                  borderRadius: 14,
                  border: "1px solid #E5E7EB",
                  padding: "28px 24px",
                  cursor: isComingSoon ? "default" : "pointer",
                  transition: "border-color 0.2s, box-shadow 0.2s, transform 0.2s",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  opacity: isComingSoon ? 0.7 : 1,
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  if (!isComingSoon) {
                    e.currentTarget.style.borderColor = card.accentColor;
                    e.currentTarget.style.boxShadow = `0 0 16px ${card.accentColor}22`;
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#E5E7EB";
                  e.currentTarget.style.boxShadow = "none";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                {/* Icon + Status Row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: isComingSoon ? "#F3F4F6" : `${card.accentColor}12`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon
                      size={22}
                      style={{ color: isComingSoon ? "#9CA3AF" : card.accentColor }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 1,
                      padding: "4px 10px",
                      borderRadius: 10,
                      background: isComingSoon ? "#F3F4F6" : "#ECFDF5",
                      color: isComingSoon ? "#9CA3AF" : "#059669",
                    }}
                  >
                    {isComingSoon ? "Coming Soon" : "Active"}
                  </span>
                </div>

                {/* Name */}
                <h3
                  style={{
                    fontFamily: "'League Spartan', sans-serif",
                    fontSize: 20,
                    fontWeight: 700,
                    color: "#111111",
                    margin: 0,
                    lineHeight: 1.2,
                  }}
                >
                  {card.name}
                </h3>

                {/* Tagline */}
                <p
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: isComingSoon ? "#9CA3AF" : card.accentColor,
                    margin: 0,
                    lineHeight: 1.3,
                  }}
                >
                  {card.tagline}
                </p>

                {/* Description */}
                <p
                  style={{
                    fontSize: 13,
                    color: "#6B7280",
                    margin: 0,
                    lineHeight: 1.5,
                    flex: 1,
                  }}
                >
                  {card.description}
                </p>

                {/* Action Footer */}
                {!isComingSoon && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: card.accentColor,
                      marginTop: 4,
                    }}
                  >
                    Open Tool
                    <ChevronRight size={14} style={{ color: card.accentColor }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Print fulfillment partner ── */}
        <div
          style={{
            marginTop: 64,
            textAlign: "center",
            borderTop: "1px solid #E5E7EB",
            paddingTop: 32,
          }}
        >
          <p style={{ fontSize: 13, color: "#6B7280" }}>
            Print fulfillment by{" "}
            <a
              href="https://weprintwraps.com"
              target="_blank"
              rel="noopener"
              style={{ color: "#0EA5E9", fontWeight: 500, textDecoration: "none" }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.textDecoration = "underline"; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.textDecoration = "none"; }}
            >
              WePrintWraps.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default PrintPro;
