import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mic } from "lucide-react";
import { PaywallModal } from "@/components/PaywallModal";
import { cn } from "@/lib/utils";

interface UnifiedWrapCloserToolProps {
  productType: 'inkfusion' | 'fadewraps' | 'wbty' | 'specialty' | 'approvemode';
  allowedTabs: Array<{ id: string; label: string }>;
  children: React.ReactNode; // Mode-specific content (swatch grids, etc.)
  selectedItem: any;
  pricing: {
    sqFt?: number;
    pricePerYard?: number;
    yards?: number;
    price: string;
  };
  productId: string;
  hasReachedLimit: boolean;
  remainingGenerations: number;
  showFallback: boolean;
  renderPreviewUrl?: string;
  onGenerate: () => void;
  onAddToCart: () => void;
  onShowExample: () => void;
}

export const UnifiedWrapCloserTool = ({
  productType,
  allowedTabs,
  children,
  selectedItem,
  pricing,
  productId,
  hasReachedLimit,
  remainingGenerations,
  showFallback,
  renderPreviewUrl,
  onGenerate,
  onAddToCart,
  onShowExample,
}: UnifiedWrapCloserToolProps) => {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [yearError, setYearError] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [lastGeneratedImage, setLastGeneratedImage] = useState<string | null>(null);
  const yearInputRef = useRef<HTMLInputElement>(null);

  // Load last generated image from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(`lastRender_${productType}`);
    if (stored) {
      setLastGeneratedImage(stored);
    }
  }, [productType]);

  // Save generated image when renderPreviewUrl changes
  useEffect(() => {
    if (renderPreviewUrl) {
      localStorage.setItem(`lastRender_${productType}`, renderPreviewUrl);
      setLastGeneratedImage(renderPreviewUrl);
    }
  }, [renderPreviewUrl, productType]);

  const validateYear = () => {
    if (!year || year.trim() === '') {
      setYearError(true);
      yearInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      yearInputRef.current?.focus();
      setTimeout(() => setYearError(false), 2000);
      return false;
    }
    return true;
  };

  const handleGenerateClick = () => {
    if (!validateYear()) {
      return;
    }
    if (hasReachedLimit) {
      setPaywallOpen(true);
    } else {
      onGenerate();
    }
  };

  return (
    <>
      <div className="w-full bg-background">
        {/* Tool Title Header - Clean Premium Design */}
        <div className="bg-background">
          <div className="max-w-7xl mx-auto px-4">
            <Card className="bg-secondary border-border/30 rounded-t-xl rounded-b-none p-2 md:p-3">
              <div className="flex flex-col md:flex-row items-center justify-between gap-2 md:gap-3">
              {/* Left: Title - Correct Branding Order */}
              <div className="animate-fade-in text-center md:text-left">
                <h2 className="text-lg md:text-2xl lg:text-3xl tracking-wide mb-2">
                  <span className="text-white font-bold">The Wrap</span>
                  <span className="bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 bg-clip-text text-transparent font-bold">Closer</span>
                  <span className="text-white font-bold">™</span>
                </h2>
                <h3 className="text-base md:text-lg font-semibold text-white tracking-wide mt-1 mb-1">
                  3D Vehicle Wrap Tool™
                </h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Visualize & Price Your Wrap in One Screen
                </p>
              </div>
              
              {/* Right: Powered by */}
              <div className="text-center md:text-right">
                <p className="text-xs md:text-sm text-muted-foreground">
                  Powered by{" "}
                  <span className="font-bold">
                    <span className="text-white">Wrap</span>
                    <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">Command AI®</span>
                  </span>
                </p>
              </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Top Header Section - Vehicle Inputs */}
        <div className="max-w-7xl mx-auto px-4">
          <Card className="bg-secondary border-border/30 rounded-xl p-4 md:p-6 mb-4 md:mb-6">
            <p className="text-sm text-muted-foreground mb-3">Select Your Vehicle</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="year" className="text-xs text-muted-foreground mb-1">Year</Label>
                <Input
                  ref={yearInputRef}
                  id="year"
                  type="text"
                  placeholder="2024"
                  value={year}
                  onChange={(e) => {
                    setYear(e.target.value);
                    setYearError(false);
                  }}
                  className={cn(
                    "bg-background border-2 border-border/50 transition-all",
                    yearError && "border-red-500 animate-pulse"
                  )}
                />
              </div>

              <div>
                <Label htmlFor="make" className="text-xs text-muted-foreground mb-1">Make</Label>
                <Input
                  id="make"
                  type="text"
                  placeholder="Nissan"
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  className="bg-background border-2 border-border/50"
                />
              </div>

              <div>
                <Label htmlFor="model" className="text-xs text-muted-foreground mb-1">Model</Label>
                <Input
                  id="model"
                  type="text"
                  placeholder="Z"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-background border-2 border-border/50"
                />
              </div>
            </div>
          </Card>
        </div>

        {/* Main Content Section */}
        <div className="max-w-7xl mx-auto px-4 animate-fade-in mb-20">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
            {/* Left Column - Color Selection & Info (1/3 width on desktop) - Clean Dark Card */}
            <div className="lg:col-span-1">
              <Card className="p-4 md:p-6 bg-secondary/50 border-border/30 h-full rounded-xl">
                <h3 className="text-lg font-semibold mb-4">3D Hero Preview</h3>
                <div className="aspect-video border border-border/30 rounded-xl flex items-center justify-center bg-background/50 overflow-hidden">
                  {showFallback || hasReachedLimit ? (
                    <img
                      src={selectedItem?.media_url || "/placeholder.svg"}
                      alt="3D Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : renderPreviewUrl ? (
                    <img
                      src={renderPreviewUrl}
                      alt="Generated 3D Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : lastGeneratedImage ? (
                    <img
                      src={lastGeneratedImage}
                      alt="Last Generated Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-8">
                      <p className="text-muted-foreground mb-4">
                        Select an InkFusion color to begin
                      </p>
                      {!hasReachedLimit && (
                        <p className="text-sm text-muted-foreground">
                          {remainingGenerations} free generations remaining
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Pricing Details */}
                <div className="mt-6 p-4 bg-secondary/20 rounded-lg border border-border">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-muted-foreground">Product ID:</span>
                    <span className="font-semibold">{productId}</span>
                  </div>
                  
                  {/* Conditional display based on product type */}
                  {productType === 'wbty' && pricing.pricePerYard && pricing.yards ? (
                    <>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-muted-foreground">Price per Yard:</span>
                        <span className="font-semibold">${pricing.pricePerYard.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-muted-foreground">Yards Needed:</span>
                        <span className="font-semibold">{pricing.yards}</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-muted-foreground">Coverage:</span>
                      <span className="font-semibold">{pricing.sqFt} sq ft</span>
                    </div>
                  )}
                  
                  <div className="flex justify-between items-center text-lg font-bold border-t border-border pt-2 mt-2">
                    <span>Total Price:</span>
                    <span className="text-primary">{pricing.price}</span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="mt-6 flex flex-col gap-3">
                  <Button
                    variant="default"
                    size="lg"
                    className="w-full bg-gradient-blue text-white"
                    onClick={handleGenerateClick}
                  >
                    Generate 3D Proof
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full"
                    onClick={onAddToCart}
                  >
                    Add to Cart
                  </Button>
                  <Button variant="outline" size="lg" className="w-full">
                    Upload Your Design
                  </Button>
                </div>
              </Card>
            </div>

            {/* Right Column - Mode Tabs & Content (1/3 width on desktop) - Clean Dark Card */}
            <div className="lg:col-span-1">
              <Card className="p-4 md:p-6 bg-secondary/50 border-border/30 h-full rounded-xl">
                <Tabs defaultValue={allowedTabs[0]?.id} className="w-full">
                  <TabsList className="grid w-full mb-6 bg-secondary" style={{ gridTemplateColumns: `repeat(${allowedTabs.length}, 1fr)` }}>
                    {allowedTabs.map((tab) => (
                      <TabsTrigger
                        key={tab.id}
                        value={tab.id}
                        className="data-[state=active]:bg-gradient-blue data-[state=active]:text-white text-xs md:text-sm"
                      >
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>

                  <TabsContent value={allowedTabs[0]?.id} className="mt-0">
                    {children}
                  </TabsContent>
                </Tabs>
              </Card>
            </div>
          </div>
        </div>

        {/* Bottom Sticky Bar - Clean Branding */}
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border/50 p-4 z-50">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div>
              <p className="text-sm font-bold">
                <span className="text-white">THE WRAP</span>
                <span className="bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 bg-clip-text text-transparent">CLOSER 3D TOOL™</span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right text-sm mr-3">
                <p className="font-semibold text-foreground">
                  {hasReachedLimit ? "Free renders used" : `${remainingGenerations} free ${remainingGenerations === 1 ? 'render' : 'renders'} left`}
                </p>
              </div>
              {hasReachedLimit && (
                <Button size="lg" className="shadow-lg">
                  Upgrade Now
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <PaywallModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        onShowExample={onShowExample}
        productType={productType}
      />
    </>
  );
};
