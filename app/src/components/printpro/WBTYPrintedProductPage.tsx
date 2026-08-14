import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Info, Check, Zap, Shield, Package } from "lucide-react";
import { PrintProThumbnail } from "./PrintProThumbnail";
import { ProductRenderDisplay } from "./ProductRenderDisplay";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PrintProCard, PrintProCardHeader, PrintProCardTitle, PrintProCardDescription, PrintProCardContent } from "./PrintProCard";
import { trackQuoteEvent, generateQuoteId } from "@/lib/track-conversion";
import { BuyPatternModal } from "@/components/productTools/BuyPatternModal";

type ViewMode = "2d" | "3d";
type CategoryFilter = "all" | "Metal & Marble" | "Wicked & Wild" | "Camo & Carbon" | "Bape Camo" | "Modern & Trippy";

interface PatternContext {
  productId?: string;
  patternName?: string;
  patternUrl?: string;
  patternCategory?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  finish?: string;
  renderUrl?: string;
  additionalViews?: {
    side?: string;
    rear?: string;
    top?: string;
    closeup?: string;
  };
}

// Product IDs from WooCommerce mapping (by category name in DB) — AUTHORITATIVE
const CATEGORY_PRODUCT_IDS: Record<string, number> = {
  "Camo & Carbon": 1726,
  "Metal & Marble": 39698,
  "Wicked & Wild": 4181,
  "Bape Camo": 42809,
  "Modern & Trippy": 52489,
};

const WBTYPrintedProductPage = () => {
  const [searchParams] = useSearchParams();
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null);
  const [yards, setYards] = useState<number>(25);
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [patternContext, setPatternContext] = useState<PatternContext | null>(null);
  const [contextRenders, setContextRenders] = useState<Array<{ id: string; vehicle_type: string; image_url: string }>>([]);
  const [showBuyModal, setShowBuyModal] = useState(false);

  // Fetch WBTY patterns from database
  const { data: patterns, isLoading: patternsLoading } = useQuery({
    queryKey: ["wbty-patterns-printpro"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wbty_products")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  // Fetch renders for selected pattern
  const { data: renders, isLoading: rendersLoading } = useQuery({
    queryKey: ["wbty-renders", selectedPattern],
    queryFn: async () => {
      if (!selectedPattern) return [];
      
      const { data, error } = await supabase
        .from("vehicle_render_images")
        .select("*")
        .eq("swatch_id", selectedPattern)
        .eq("product_type", "wbty")
        .eq("is_active", true);

      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedPattern && viewMode === "3d" && !patternContext?.renderUrl,
  });

  // Handle URL parameters and localStorage context
  useEffect(() => {
    const patternId = searchParams.get('pattern_id');
    const storedContext = localStorage.getItem('patternpro-purchase-context');
    
    if (storedContext) {
      try {
        const context = JSON.parse(storedContext) as PatternContext;
        setPatternContext(context);
        
        // Build renders from context with generated IDs
        if (context.renderUrl) {
          const views: Array<{ id: string; vehicle_type: string; image_url: string }> = [
            { id: 'context-roof', vehicle_type: 'roof', image_url: context.renderUrl }
          ];
          if (context.additionalViews?.side) {
            views.push({ id: 'context-side', vehicle_type: 'side', image_url: context.additionalViews.side });
          }
          if (context.additionalViews?.rear) {
            views.push({ id: 'context-rear', vehicle_type: 'rear', image_url: context.additionalViews.rear });
          }
          if (context.additionalViews?.top) {
            views.push({ id: 'context-top', vehicle_type: 'top', image_url: context.additionalViews.top });
          }
          setContextRenders(views);
          setViewMode("3d");
        }
        
        if (context.productId) {
          setSelectedPattern(context.productId);
        }
      } catch (e) {
        console.error('Error parsing pattern context:', e);
      }
    }
    
    if (patternId && patterns) {
      setSelectedPattern(patternId);
      setViewMode("3d");
    }
  }, [searchParams, patterns]);

  const currentPattern = patterns?.find(p => p.id === selectedPattern);
  const pricePerYard = 95.50;
  const totalPrice = pricePerYard * yards;

  // Filter patterns by category
  const filteredPatterns = patterns?.filter(pattern => {
    if (categoryFilter === "all") return true;
    return pattern.category === categoryFilter;
  });

  const handlePatternClick = (patternId: string) => {
    setSelectedPattern(patternId);
    setViewMode("3d");
    // Clear context if selecting a different pattern
    if (patternContext?.productId !== patternId) {
      setPatternContext(null);
      setContextRenders([]);
    }
  };

  const handleAddToCart = () => {
    if (selectedPattern && currentPattern) {
      // Track conversion event (fire-and-forget)
      trackQuoteEvent({
        eventType: "order_now_clicked",
        quoteId: generateQuoteId(),
        productType: "wbty",
        metadata: {
          patternId: currentPattern.id,
          patternName: currentPattern.name,
          category: currentPattern.category,
          yards,
          totalPrice,
        },
      });

      // Open the BuyPatternModal — same flow as PatternPro tool
      setShowBuyModal(true);
    }
  };

  // Build vehicle object for BuyPatternModal from saved patternContext (or empty if just browsing)
  const modalVehicle = {
    year: patternContext?.vehicleYear || "",
    make: patternContext?.vehicleMake || "",
    model: patternContext?.vehicleModel || "",
  };
  const modalAdditionalViews = patternContext?.additionalViews
    ? {
        side: patternContext.additionalViews.side,
        rear: patternContext.additionalViews.rear,
        top: patternContext.additionalViews.top,
        closeup: patternContext.additionalViews.closeup,
      }
    : undefined;

  // Use context renders if available, otherwise use database renders
  const displayRenders = contextRenders.length > 0 ? contextRenders : renders || [];
  const displayVehicle = patternContext 
    ? `${patternContext.vehicleYear} ${patternContext.vehicleMake} ${patternContext.vehicleModel}`.trim()
    : '';

  return (
    <div className="min-h-screen bg-background">
      
      {/* Small Header Banner */}
      <div className="relative w-full h-[280px] bg-black overflow-hidden border-b border-border">
        <img
          src="/wbty-yards-guide.jpg"
          alt="PatternPro Wrap By The Yard"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0">
          <div className="container mx-auto px-4 h-full flex items-center">
            <div className="space-y-3">
              <div className="inline-block bg-gradient-to-r from-black/70 to-black/50 backdrop-blur-sm px-6 py-3 rounded-lg">
                <h1 className="text-4xl md:text-5xl font-bold drop-shadow-lg">
                  <span className="text-white">Pattern</span><span className="text-gradient-designpro">Pro™</span><span className="text-white"> Wrap By The Yard</span>
                </h1>
              </div>
              <div className="inline-block bg-gradient-to-r from-black/70 to-black/50 backdrop-blur-sm px-6 py-2 rounded-lg">
                <p className="text-xl text-gray-200 drop-shadow-md max-w-2xl">
                  Premium printed patterns on Avery SW900 cast vinyl - priced per yard at $95.50
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Design Context Banner - Show when coming from tool */}
      {patternContext && patternContext.renderUrl && (
        <div className="container mx-auto px-4 pt-8">
          <PrintProCard className="border-primary/50 bg-primary/5">
            <PrintProCardHeader>
              <PrintProCardTitle className="text-lg flex items-center gap-2">
                <Check className="w-5 h-5 text-green-500" />
                Your Custom Design is Ready
              </PrintProCardTitle>
              <PrintProCardDescription>
                {patternContext.patternName} {displayVehicle && `on ${displayVehicle}`} • {patternContext.finish} finish
              </PrintProCardDescription>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="aspect-video max-w-xl mx-auto rounded-lg overflow-hidden border border-border">
                <img 
                  src={patternContext.renderUrl} 
                  alt={`${patternContext.patternName} preview`}
                  className="w-full h-full object-cover"
                />
              </div>
            </PrintProCardContent>
          </PrintProCard>
        </div>
      )}

      {/* Main Content - 2 Column Layout */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid lg:grid-cols-[1fr_380px] gap-8 max-w-7xl mx-auto">
          
          {/* LEFT COLUMN - Pattern Selection & 3D Render */}
          <div className="space-y-6">
            {viewMode === "2d" && (
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-2">
                  PatternPro™ Library
                </h2>
                <p className="text-muted-foreground">
                  Select a pattern to preview. All patterns printed on premium Avery SW900 cast vinyl.
                </p>
              </div>
            )}

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-medium text-foreground">Filter by Category:</span>
              <div className="flex gap-2 flex-wrap">
                {[
                  { value: "all", label: "All Patterns" },
                  { value: "Metal & Marble", label: "Metal & Marble" },
                  { value: "Wicked & Wild", label: "Wicked & Wild" },
                  { value: "Camo & Carbon", label: "Camo & Carbon" },
                  { value: "Bape Camo", label: "Bape Camo" },
                  { value: "Modern & Trippy", label: "Modern & Trippy" }
                ].map((option) => (
                  <Button
                    key={option.value}
                    variant={categoryFilter === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCategoryFilter(option.value as CategoryFilter)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* 2D/3D Toggle */}
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-foreground">View Mode:</span>
              <ToggleGroup type="single" value={viewMode} onValueChange={(v) => v && setViewMode(v as ViewMode)}>
                <ToggleGroupItem value="2d" aria-label="2D Swatches">
                  2D Patterns
                </ToggleGroupItem>
                <ToggleGroupItem value="3d" aria-label="3D Renders">
                  3D Renders
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* 2-Column Layout: Patterns + Render Side by Side */}
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Pattern Grid */}
              <div>
                {viewMode === "3d" && (
                  <h2 className="text-xl font-bold text-foreground mb-4">
                    Select Pattern
                  </h2>
                )}
                {patternsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {filteredPatterns?.map((pattern) => (
                      <PrintProThumbnail
                        key={pattern.id}
                        imageUrl={pattern.media_url}
                        title={pattern.name}
                        subtitle={pattern.category || "Pattern"}
                        selected={selectedPattern === pattern.id}
                        onClick={() => handlePatternClick(pattern.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* 3D Render Display (beside patterns) */}
              {viewMode === "3d" && (
                <div>
                  {selectedPattern && currentPattern ? (
                    <>
                      <h3 className="text-xl font-bold text-foreground mb-4">
                        3D Preview - {patternContext?.patternName || currentPattern.name}
                        {displayVehicle && <span className="text-muted-foreground text-base font-normal"> on {displayVehicle}</span>}
                      </h3>
                      <ProductRenderDisplay
                        renders={displayRenders}
                        colorName={patternContext?.patternName || currentPattern.name}
                        colorHex="#9b87f5"
                        finish={patternContext?.finish || currentPattern.category || "Pattern"}
                        isLoading={rendersLoading && contextRenders.length === 0}
                      />
                    </>
                  ) : (
                    <div className="h-full flex items-center justify-center p-8 border border-border rounded-lg bg-muted/30">
                      <p className="text-muted-foreground text-center">
                        Select a pattern to view 3D renders
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN - Technical Specs & Pricing (Sticky) */}
          <div className="lg:sticky lg:top-24 h-fit">
            <div className="bg-card border border-border rounded-lg p-6 shadow-lg space-y-6">
              <div>
                <h3 className="text-xl font-bold text-foreground mb-2">Technical Specifications</h3>
                <p className="text-sm text-muted-foreground">Premium printed pattern vinyl</p>
              </div>

              {/* Pricing */}
              <div className="py-4 border-y border-border">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-3xl font-bold text-foreground">${pricePerYard}</span>
                  <span className="text-muted-foreground">/ yard</span>
                </div>
                <p className="text-sm text-muted-foreground">60" width • Sold by linear yard</p>
              </div>

              {/* Spec Icons */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <Package className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">BASE FILM</p>
                    <p className="text-xs text-muted-foreground">SW900 Cast Vinyl</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Shield className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">LAMINATE</p>
                    <p className="text-xs text-muted-foreground">DOL1360 Gloss</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">WIDTH</p>
                    <p className="text-xs text-muted-foreground">60 inches</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">FINISH</p>
                    <p className="text-xs text-muted-foreground">High Gloss</p>
                  </div>
                </div>
              </div>

              {/* Yards Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Yards Needed</label>
                <Select value={yards.toString()} onValueChange={(v) => setYards(parseInt(v))}>
                  <SelectTrigger className="w-full bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-[100]">
                    {[10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} yards ({(num * 5).toFixed(0)} sq ft)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Total Price */}
              <div className="pt-4 border-t border-border">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-lg font-bold text-foreground">Total:</span>
                  <span className="text-2xl font-bold text-primary">${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>

                <Button 
                  size="lg" 
                  onClick={handleAddToCart}
                  disabled={!selectedPattern}
                  className="w-full bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))] hover:opacity-90 text-lg font-semibold"
                >
                  Add to Cart
                </Button>

                <p className="text-xs text-muted-foreground text-center mt-3">
                  2-3 business days turnaround • Free shipping over $500
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Product Details Section */}
      <div className="container mx-auto px-4 py-16 border-t border-border">
        <div className="max-w-6xl mx-auto">
          
          {/* What is PatternPro */}
          <div className="bg-card border border-border rounded-lg p-8 mb-8">
            <div className="flex items-start gap-4 mb-4">
              <Info className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-4">What is PatternPro™ Wrap By The Yard?</h2>
                <p className="text-foreground mb-4">
                  PatternPro™ delivers premium printed pattern wraps on Avery SW900 cast vinyl, 
                  sold by the linear yard at $95.50/yard. Perfect for carbon fiber, marble, camo, 
                  and custom texture applications.
                </p>
                <p className="text-muted-foreground">
                  Each pattern is UV-printed with high-resolution detail and overlaminated with 
                  DOL1360 for maximum durability and gloss. 60" width ensures full panel coverage 
                  without seams.
                </p>
              </div>
            </div>
          </div>

          {/* Specifications Grid */}
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-bold text-foreground mb-3">Material Specs</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• Avery SW900 cast vinyl base</li>
                <li>• DOL1360 gloss overlaminate</li>
                <li>• Air-release adhesive</li>
                <li>• High-resolution UV printing</li>
              </ul>
            </div>
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-bold text-foreground mb-3">Coverage & Size</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• 60" width (full panel coverage)</li>
                <li>• Sold by linear yard</li>
                <li>• ~5 sq ft per yard</li>
                <li>• Seamless full-vehicle capable</li>
              </ul>
            </div>
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-bold text-foreground mb-3">What's Included</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• UV-printed SW900 vinyl</li>
                <li>• DOL1360 protective overlaminate</li>
                <li>• Pattern alignment guide</li>
                <li>• Installation recommendations</li>
              </ul>
            </div>
          </div>

          {/* FAQs */}
          <div className="bg-card border border-border rounded-lg p-8">
            <h2 className="text-2xl font-bold text-foreground mb-6">Frequently Asked Questions</h2>
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-foreground mb-2">How much do I need for a full wrap?</h3>
                <p className="text-muted-foreground text-sm">
                  Sedans: 55-65 yards | SUVs: 70-85 yards | Trucks: 75-90 yards. Add 10% for waste/trimming.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">Can I order less than 10 yards?</h3>
                <p className="text-muted-foreground text-sm">
                  Yes, minimum order is 10 yards. Perfect for hoods, roofs, or accent panels.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">What's the turnaround time?</h3>
                <p className="text-muted-foreground text-sm">
                  2-3 business days for printing and shipping. Orders over $500 ship free.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <BuyPatternModal
        open={showBuyModal}
        onOpenChange={setShowBuyModal}
        pattern={currentPattern ? {
          id: currentPattern.id,
          name: currentPattern.name,
          media_url: currentPattern.media_url,
          category: currentPattern.category,
        } : null}
        vehicle={modalVehicle}
        finish={patternContext?.finish || "Gloss"}
        renderUrl={patternContext?.renderUrl}
        additionalViews={modalAdditionalViews}
      />
    </div>
  );
};

export default WBTYPrintedProductPage;
