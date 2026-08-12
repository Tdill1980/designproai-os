import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useState, useRef } from "react";
import { useFreemiumLimits } from "@/hooks/useFreemiumLimits";
import { PaywallModal } from "../PaywallModal";
import { SocialEngagementModal } from "../SocialEngagementModal";
import { FreemiumCounter } from "../FreemiumCounter";
import { useToast } from "@/hooks/use-toast";
import { Upload } from "lucide-react";
import { VehicleSelector, VehicleSelectorRef } from "@/components/visualize/VehicleSelector";

export const InkFusionToolComplete = () => {
  const [selectedSwatch, setSelectedSwatch] = useState<any>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [socialModalOpen, setSocialModalOpen] = useState(false);
  const [vehicle, setVehicle] = useState<{ year: string; make: string; model: string } | null>(null);
  const vehicleSelectorRef = useRef<VehicleSelectorRef>(null);
  const { 
    canGenerate, phase, isPrivileged, totalRemaining, 
    incrementGeneration, unlockBonus 
  } = useFreemiumLimits();
  const { toast } = useToast();

  const { data: swatches, isLoading } = useQuery({
    queryKey: ["inkfusion_swatches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inkfusion_swatches")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  // Calculate rolls needed (assuming ~350 sqft per roll)
  const calculateRolls = () => {
    // Placeholder vehicle sqft - would be calculated based on year/make/model
    const vehicleSqFt = 200; // Example
    const sqFtPerRoll = 350;
    return Math.ceil(vehicleSqFt / sqFtPerRoll);
  };

  const rollsNeeded = calculateRolls();
  const pricePerRoll = 2075;
  const totalPrice = rollsNeeded * pricePerRoll;

  if (isLoading) {
    return (
      <div className="grid lg:grid-cols-2 gap-6">
        <Skeleton className="h-[600px]" />
        <Skeleton className="h-[600px]" />
      </div>
    );
  }

  const handleGenerate = () => {
    // Validate year field
    if (!vehicleSelectorRef.current?.validateYear()) {
      return;
    }

    if (!canGenerate) {
      if (phase === 'engagement') {
        setSocialModalOpen(true);
      } else if (phase === 'paywall') {
        setPaywallOpen(true);
      }
      return;
    }
    
    incrementGeneration();
    setShowFallback(false);
    toast({
      title: "3D Preview Generated",
      description: isPrivileged ? "Unlimited access" : `${totalRemaining - 1} free previews remaining`,
    });
  };

  const handleShowExample = () => {
    setShowFallback(true);
  };

  const handleAddToCart = () => {
    // Product ID logic here
    toast({
      title: "Added to Cart",
      description: `${rollsNeeded} InkFusion rolls added to cart`,
    });
  };

  return (
    <>
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left Side - Swatch Selector & Vehicle Info */}
        <div className="space-y-6">
          {/* Vehicle Selector */}
          <Card className="p-6 bg-card border-border">
            <h3 className="text-lg font-semibold mb-4">Vehicle Information</h3>
            <VehicleSelector ref={vehicleSelectorRef} onVehicleChange={setVehicle} />
          </Card>

          {/* Color Swatch Selector */}
          <Card className="p-6 bg-card border-border">
            <h3 className="text-lg font-semibold mb-4">Select InkFusion Color</h3>
            <ScrollArea className="h-96">
              <div className="grid grid-cols-3 gap-3 pr-4">
                {swatches?.map((swatch) => (
                  <button
                    key={swatch.id}
                    onClick={() => setSelectedSwatch(swatch)}
                    className={`aspect-square rounded-lg border-2 transition-all hover:scale-105 ${
                      selectedSwatch?.id === swatch.id
                        ? "border-primary shadow-lg shadow-primary/20"
                        : "border-border"
                    }`}
                    style={{ backgroundColor: swatch.hex || "#333" }}
                  >
                    <div className="w-full h-full flex items-end justify-center p-2">
                      <span className="text-xs font-medium bg-background/80 px-2 py-1 rounded">
                        {swatch.name}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
            
            {selectedSwatch && (
              <div className="mt-4 p-4 bg-secondary/20 rounded-lg border border-border">
                <h4 className="font-semibold mb-2">{selectedSwatch.name}</h4>
                <div className="space-y-1 text-sm text-muted-foreground">
                  {selectedSwatch.hex && <p>Hex: {selectedSwatch.hex}</p>}
                  {selectedSwatch.finish && <p>Finish: {selectedSwatch.finish}</p>}
                </div>
              </div>
            )}
          </Card>

          {/* Pricing Calculator */}
          <Card className="p-6 bg-card border-border">
            <h3 className="text-lg font-semibold mb-4">Quick Price Calculator</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Price per Roll</span>
                <span className="font-semibold">${pricePerRoll.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Rolls Needed</span>
                <span className="font-semibold">{rollsNeeded}</span>
              </div>
              <div className="h-px bg-border"></div>
              <div className="flex justify-between">
                <span className="font-semibold">Total</span>
                <span className="font-bold text-primary">${totalPrice.toLocaleString()}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Side - 3D Preview */}
        <div className="space-y-6">
          {/* 3D Preview Window */}
          <Card className="p-6 bg-card border-border">
            <h3 className="text-lg font-semibold mb-4">3D Preview</h3>
            <div className="aspect-video border-2 border-border rounded-lg flex items-center justify-center bg-secondary/20 overflow-hidden">
              {showFallback ? (
                <img 
                  src="/images/fallback/inkfusion/default.png" 
                  alt="Example 3D Preview" 
                  className="w-full h-full object-cover" 
                />
              ) : selectedSwatch ? (
                <div 
                  className="w-full h-full flex items-center justify-center" 
                  style={{ backgroundColor: selectedSwatch.hex }}
                >
                  <span className="text-white bg-black/50 px-4 py-2 rounded">
                    3D Car Preview
                  </span>
                </div>
              ) : (
                <div className="text-center text-muted-foreground">
                  <p className="mb-2">Select a color to preview</p>
                  <p className="text-sm">3D render will appear here</p>
                </div>
              )}
            </div>
          </Card>

          {/* Action Buttons */}
          <Card className="p-6 bg-card border-border space-y-4">
            {/* Freemium Counter */}
            <div className="flex justify-center">
              <FreemiumCounter phase={phase} totalRemaining={totalRemaining} isPrivileged={isPrivileged} />
            </div>

            <Button 
              onClick={handleGenerate}
              disabled={!selectedSwatch}
              variant="default"
              size="lg"
              className="w-full"
            >
              {!canGenerate && phase === 'paywall' ? "Upgrade to Continue" : "Generate 3D Proof"}
            </Button>

            <Button 
              variant="outline"
              size="lg"
              className="w-full"
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Your Design
            </Button>

            <Button 
              onClick={handleAddToCart}
              disabled={!selectedSwatch}
              variant="gradient"
              size="lg"
              className="w-full"
            >
              Add {rollsNeeded} InkFusion Roll{rollsNeeded > 1 ? 's' : ''} to Cart
            </Button>
          </Card>
        </div>
      </div>

      <SocialEngagementModal
        open={socialModalOpen}
        onClose={() => setSocialModalOpen(false)}
        onUnlock={unlockBonus}
      />

      <PaywallModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        onShowExample={handleShowExample}
        productType="inkfusion"
      />
    </>
  );
};
