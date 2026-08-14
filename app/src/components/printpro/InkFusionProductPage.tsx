import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Info, Check, Zap, Shield, Package } from "lucide-react";
import { PrintProSwatch } from "./PrintProSwatch";
import { ProductRenderDisplay } from "./ProductRenderDisplay";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ViewMode = "2d" | "3d";
type FinishFilter = "all" | "gloss" | "satin" | "matte";

const InkFusionProductPage = () => {
  const [searchParams] = useSearchParams();
  const [selectedSwatch, setSelectedSwatch] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number>(1);
  const [finish, setFinish] = useState<string>("gloss");
  const [viewMode, setViewMode] = useState<ViewMode>("2d");
  const [finishFilter, setFinishFilter] = useState<FinishFilter>("all");

  // Fetch InkFusion swatches
  const { data: swatches, isLoading: swatchesLoading } = useQuery({
    queryKey: ["inkfusion-swatches-printpro"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inkfusion_swatches")
        .select("*")
        .eq("is_active", true)
        .eq("color_library", "inkfusion")
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  // Fetch renders for selected swatch
  const { data: renders, isLoading: rendersLoading } = useQuery({
    queryKey: ["inkfusion-renders", selectedSwatch],
    queryFn: async () => {
      if (!selectedSwatch) return [];
      
      const { data, error } = await supabase
        .from("vehicle_render_images")
        .select("*")
        .eq("swatch_id", selectedSwatch)
        .eq("product_type", "inkfusion")
        .eq("is_active", true);

      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedSwatch && viewMode === "3d",
  });

  // Handle URL parameters
  useEffect(() => {
    const colorId = searchParams.get('color_id');
    if (colorId && swatches) {
      setSelectedSwatch(colorId);
      setViewMode("3d");
    }
  }, [searchParams, swatches]);

  const currentSwatch = swatches?.find(s => s.id === selectedSwatch);
  const pricePerRoll = 2075;
  const totalPrice = pricePerRoll * quantity;

  // Filter swatches by finish
  const filteredSwatches = swatches?.filter(swatch => {
    if (finishFilter === "all") return true;
    return swatch.finish?.toLowerCase() === finishFilter;
  });

  const handleSwatchClick = (swatchId: string) => {
    setSelectedSwatch(swatchId);
    setViewMode("3d");
  };

  const handleAddToCart = () => {
    if (selectedSwatch) {
      window.open(
        `https://weprintwraps.com/cart/?add-to-cart=INKFUSION_${selectedSwatch}`,
        "_blank"
      );
    }
  };

  return (
    <div className="min-h-screen bg-background">
      
      {/* Small Header Banner */}
      <div className="relative w-full h-[280px] bg-black overflow-hidden border-b border-border">
        <img
          src="/inkfusion/nissan-z-celestial-aqua.jpg"
          alt="InkFusion Nissan Z"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0">
          <div className="container mx-auto px-4 h-full flex items-center">
            <div className="space-y-3">
              <div className="inline-block bg-gradient-to-r from-black/70 to-black/50 backdrop-blur-sm px-6 py-3 rounded-lg">
                <h1 className="text-4xl md:text-5xl font-bold drop-shadow-lg">
                  <span className="text-white">Ink</span><span className="text-gradient-designpro">Fusion™</span><span className="text-white"> Finish System</span>
                </h1>
              </div>
              <div className="inline-block bg-gradient-to-r from-black/70 to-black/50 backdrop-blur-sm px-6 py-2 rounded-lg">
                <p className="text-xl text-gray-200 drop-shadow-md max-w-2xl">
                  50 automotive paint-quality colors on premium SW900 cast vinyl
                </p>
              </div>
              <p className="text-sm text-white/90 px-2">
                Nissan Z Shown in Celestial Aqua
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - 2 Column Layout */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid lg:grid-cols-[1fr_380px] gap-8 max-w-7xl mx-auto">
          
          {/* LEFT COLUMN - Color Selection & 3D Render */}
          <div className="space-y-6">
            {viewMode === "2d" && (
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-2">
                  All 50 InkFusion™ Colors
                </h2>
                <p className="text-muted-foreground">
                  Tap a color to preview. All colors available in Gloss, Satin, or Matte finish.
                </p>
              </div>
            )}

            {/* Finish Filter Tabs */}
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-medium text-foreground">Filter by Finish:</span>
              <div className="flex gap-2">
                {[
                  { value: "all", label: "All" },
                  { value: "gloss", label: "Gloss" },
                  { value: "satin", label: "Satin" },
                  { value: "matte", label: "Matte" }
                ].map((option) => (
                  <Button
                    key={option.value}
                    variant={finishFilter === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFinishFilter(option.value as FinishFilter)}
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
                  2D Swatches
                </ToggleGroupItem>
                <ToggleGroupItem value="3d" aria-label="3D Renders">
                  3D Renders
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* 2-Column Layout: Swatches + Render Side by Side */}
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Color Swatch Grid */}
              <div>
                {viewMode === "3d" && (
                  <h2 className="text-xl font-bold text-foreground mb-4">
                    Select Color
                  </h2>
                )}
                {swatchesLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-3">
                    {filteredSwatches?.map((swatch) => (
                      <PrintProSwatch
                        key={swatch.id}
                        color={{
                          name: swatch.name,
                          hex: swatch.hex || "#000000",
                          finish: swatch.finish || "Gloss"
                        }}
                        selected={selectedSwatch === swatch.id}
                        onClick={() => handleSwatchClick(swatch.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* 3D Render Display (beside swatches) */}
              {viewMode === "3d" && (
                <div>
                  {selectedSwatch && currentSwatch ? (
                    <>
                      <h3 className="text-xl font-bold text-foreground mb-4">
                        3D Preview - {currentSwatch.name}
                      </h3>
                      <ProductRenderDisplay
                        renders={renders || []}
                        colorName={currentSwatch.name}
                        colorHex={currentSwatch.hex || "#000000"}
                        finish={currentSwatch.finish || "Gloss"}
                        isLoading={rendersLoading}
                      />
                    </>
                  ) : (
                    <div className="h-full flex items-center justify-center p-8 border border-border rounded-lg bg-muted/30">
                      <p className="text-muted-foreground text-center">
                        Select a color to view 3D renders
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
                <p className="text-sm text-muted-foreground">Premium printed vinyl system</p>
              </div>

              {/* Pricing */}
              <div className="py-4 border-y border-border">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-3xl font-bold text-foreground">${pricePerRoll.toLocaleString()}</span>
                  <span className="text-muted-foreground">/ roll</span>
                </div>
                <p className="text-sm text-muted-foreground">375 sq ft per roll (~24 yards)</p>
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
                    <p className="text-xs text-muted-foreground">DOL1360 Max Gloss</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Zap className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">FINISH OPTIONS</p>
                    <p className="text-xs text-muted-foreground">Gloss or Luster</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">WIDTH</p>
                    <p className="text-xs text-muted-foreground">60 inches</p>
                  </div>
                </div>
              </div>

              {/* Quantity Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Quantity (Rolls)</label>
                <Select value={quantity.toString()} onValueChange={(v) => setQuantity(parseInt(v))}>
                  <SelectTrigger className="w-full bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-[100]">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} Roll{num > 1 ? 's' : ''} ({num * 375} sq ft)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Finish Selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Finish</label>
                <Select value={finish} onValueChange={setFinish}>
                  <SelectTrigger className="w-full bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover z-[100]">
                    <SelectItem value="gloss">Gloss</SelectItem>
                    <SelectItem value="luster">Luster</SelectItem>
                    <SelectItem value="matte">Matte (Not Recommended)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Total Price */}
              <div className="pt-4 border-t border-border">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-lg font-bold text-foreground">Total:</span>
                  <span className="text-2xl font-bold text-primary">${totalPrice.toLocaleString()}</span>
                </div>

                <Button 
                  size="lg" 
                  onClick={handleAddToCart}
                  disabled={!selectedSwatch}
                  className="w-full bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))] hover:opacity-90 text-lg font-semibold"
                >
                  Add to Cart
                </Button>

                <p className="text-xs text-muted-foreground text-center mt-3">
                  1-2 business days turnaround • Free shipping
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Product Details Section */}
      <div className="container mx-auto px-4 py-16 border-t border-border">
        <div className="max-w-6xl mx-auto">
          
          {/* What is InkFusion */}
          <div className="bg-card border border-border rounded-lg p-8 mb-8">
            <div className="flex items-start gap-4 mb-4">
              <Info className="w-6 h-6 text-primary flex-shrink-0 mt-1" />
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-4">What is InkFusion™?</h2>
                <p className="text-foreground mb-4">
                  InkFusion™ is DesignProAI™'s proprietary ink formula that delivers automotive paint-quality 
                  finishes on premium Avery SW900 cast vinyl. Each color is precision-matched and calibrated 
                  for perfect consistency.
                </p>
                <p className="text-muted-foreground">
                  Our proprietary color calibration system optimizes ink density, metallic particle alignment, 
                  and gloss level to create finishes that are visually indistinguishable from actual automotive 
                  paint-but reversible and lower cost.
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
                <li>• DOL1360 Max Gloss overlaminate</li>
                <li>• Air-release adhesive technology</li>
                <li>• UV-printed with proprietary inks</li>
              </ul>
            </div>
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-bold text-foreground mb-3">Coverage & Size</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• 375 sq ft per roll (~24 yards)</li>
                <li>• 60" width for full coverage</li>
                <li>• Excellent conformability</li>
                <li>• Full vehicle wrap capable</li>
              </ul>
            </div>
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-bold text-foreground mb-3">What's Included</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• UV-printed SW900 vinyl roll</li>
                <li>• DOL1360 protective overlaminate</li>
                <li>• AI calibration report</li>
                <li>• Installation recommendations</li>
              </ul>
            </div>
          </div>

          {/* FAQs */}
          <div className="bg-card border border-border rounded-lg p-8">
            <h2 className="text-2xl font-bold text-foreground mb-6">Frequently Asked Questions</h2>
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold text-foreground mb-2">Can I order less than a full roll?</h3>
                <p className="text-muted-foreground text-sm">
                  No. InkFusion™ is sold in complete rolls (~24 yards, 375 sq ft) to maintain color consistency 
                  and quality standards.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">What finish options are available?</h3>
                <p className="text-muted-foreground text-sm">
                  Gloss or Luster finishes are available at the same price. Matte is available but not recommended 
                  as it reduces the paint-like appearance.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">How long does InkFusion™ last?</h3>
                <p className="text-muted-foreground text-sm">
                  7-9 years outdoor durability with vertical exposure, backed by the proven performance of 
                  Avery SW900 cast vinyl.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">Do you offer custom color matching?</h3>
                <p className="text-muted-foreground text-sm">
                  Yes! Contact us for a custom calibration quote. We can match OEM paint codes and custom 
                  automotive finishes.
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-2">Can I see a physical sample?</h3>
                <p className="text-muted-foreground text-sm">
                  Yes, physical samples are available separately. Contact us to request specific color samples.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default InkFusionProductPage;