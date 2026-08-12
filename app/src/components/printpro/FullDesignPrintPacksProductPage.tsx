import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSearchParams } from "react-router-dom";
import { PrintProCard, PrintProCardHeader, PrintProCardTitle, PrintProCardDescription, PrintProCardContent } from "./PrintProCard";
import { PrintProThumbnail } from "./PrintProThumbnail";
import { PrintProRenderCarousel } from "./PrintProRenderCarousel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trackQuoteEvent, generateQuoteId } from "@/lib/track-conversion";

// Production Files price ID - create this product in Stripe at $149
const PRODUCTION_FILES_PRICE_ID = "price_production_files_149"; // Replace with actual Stripe price ID

const FullDesignPrintPacksProductPage = () => {
  const [searchParams] = useSearchParams();
  const [selectedDesign, setSelectedDesign] = useState<number | null>(null);
  const [purchaseType, setPurchaseType] = useState<"printed" | "files">("printed");
  const [addHood, setAddHood] = useState(false);
  const [addFrontBumper, setAddFrontBumper] = useState(false);
  const [addRearBumper, setAddRearBumper] = useState(false);
  const [kitSize, setKitSize] = useState<"small" | "medium" | "large" | "xl">("medium");
  const [roofSize, setRoofSize] = useState<"small" | "medium" | "large" | "none">("none");
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false);
  const [renderViews, setRenderViews] = useState<Array<{ type: string; url: string }>>([]);
  const [isLoadingRenders, setIsLoadingRenders] = useState(false);

  // Fetch design library from database
  const { data: designs, isLoading } = useQuery({
    queryKey: ["designpanelpro-patterns-printpro"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("designpanelpro_patterns")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  // Handle URL parameters for pre-selection
  useEffect(() => {
    const designId = searchParams.get('design_id');
    const type = searchParams.get('type');
    
    if (designId && designs) {
      const designIndex = designs.findIndex(d => d.id === designId);
      if (designIndex !== -1) {
        setSelectedDesign(designIndex);
        handleDesignClick(designIndex);
      }
    }
    
    if (type === 'files' || type === 'printed') {
      setPurchaseType(type);
    }
  }, [searchParams, designs]);

  const handleDesignClick = async (index: number) => {
    setSelectedDesign(index);
    const design = designs?.[index];
    if (!design) return;

    setIsLoadingRenders(true);
    
    try {
      // Fetch pre-stored renders from vehicle_render_images table
      const { data: renders, error } = await supabase
        .from('vehicle_render_images')
        .select('*')
        .eq('swatch_id', design.id)
        .eq('product_type', 'designpacks')
        .eq('is_active', true);
      
      if (error) {
        console.error('Error fetching renders:', error);
        setRenderViews([]);
        return;
      }
      
      // Map database records to view format
      const views = renders?.map(render => ({
        type: render.vehicle_type,
        url: render.image_url
      })) || [];
      
      setRenderViews(views);
    } catch (error) {
      console.error('Error loading renders:', error);
      setRenderViews([]);
    } finally {
      setIsLoadingRenders(false);
    }
  };

  const calculatePrice = () => {
    if (purchaseType === "files") return 149;
    
    // FadeWraps pricing structure
    const kitPrices = {
      small: 600,
      medium: 710,
      large: 825,
      xl: 990,
    };
    
    let total = kitPrices[kitSize];
    
    // Add-ons
    if (addHood) total += 160;
    if (addFrontBumper) total += 200;
    if (addRearBumper) total += 395;
    
    // Roof pricing
    const roofPrices = {
      none: 0,
      small: 160,
      medium: 225,
      large: 330,
    };
    total += roofPrices[roofSize];
    
    return total;
  };

  const handleCheckout = async () => {
    if (selectedDesign === null || !designs) return;
    
    setIsCheckoutLoading(true);
    const design = designs[selectedDesign];
    const total = calculatePrice();
    const quoteId = generateQuoteId();
    
    // Track checkout started event (fire-and-forget)
    trackQuoteEvent({
      eventType: "checkout_started",
      quoteId,
      productType: "design_pack",
      metadata: { 
        designId: design.id,
        designName: design.name,
        purchaseType,
        total,
        kitSize,
        addHood,
        addFrontBumper,
        addRearBumper,
        roofSize 
      },
    });
    
    try {
      const payload = purchaseType === "files"
        ? {
            designId: design.id,
            purchaseType: "production_files",
            priceId: PRODUCTION_FILES_PRICE_ID,
          }
        : {
            designId: design.id,
            purchaseType: "printed_panels",
            priceAmount: total * 100, // Convert to cents
            productDescription: `Design Pack - ${design.name} (${kitSize.toUpperCase()} kit)`,
            metadata: {
              kit_size: kitSize,
              add_hood: addHood,
              add_front_bumper: addFrontBumper,
              add_rear_bumper: addRearBumper,
              roof_size: roofSize,
              design_name: design.name,
            },
          };
      
      const { data, error } = await supabase.functions.invoke('create-design-checkout', {
        body: payload,
      });
      
      if (error) throw error;
      
      if (data?.url) {
        window.open(data.url, '_blank');
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      toast.error('Unable to start checkout. Please try again.');
    } finally {
      setIsCheckoutLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle>Full-Design Print Packs</PrintProCardTitle>
            <PrintProCardDescription>
              Complete printed wrap kits from our 250+ design library. Pre-designed graphics, flames, racing stripes, and custom artwork. Choose printed panels ready to install OR production files to print yourself.
            </PrintProCardDescription>
          </PrintProCardHeader>
        </PrintProCard>

        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle className="text-lg">Select Design</PrintProCardTitle>
          </PrintProCardHeader>
          <PrintProCardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {designs?.map((design, idx) => (
                  <PrintProThumbnail
                    key={design.id}
                    imageUrl={design.clean_display_url || design.media_url}
                    title={design.name}
                    subtitle={design.category || "Design"}
                    selected={selectedDesign === idx}
                    onClick={() => handleDesignClick(idx)}
                  />
                ))}
              </div>
            )}
          </PrintProCardContent>
        </PrintProCard>

        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle className="text-lg">Purchase Type</PrintProCardTitle>
          </PrintProCardHeader>
          <PrintProCardContent className="space-y-6">
            <RadioGroup value={purchaseType} onValueChange={(value: any) => setPurchaseType(value)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="printed" id="printed" />
                <Label htmlFor="printed">Printed Panels (Ready to Install)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="files" id="files" />
                <Label htmlFor="files">Production Files (Print Yourself) - $149</Label>
              </div>
            </RadioGroup>

            {purchaseType === "printed" && (
              <div className="space-y-3">
                <Label className="text-base">Vehicle Info</Label>
                <p className="text-sm text-muted-foreground">GENIE Production Panelizer OS™ auto-sizes all panels from vehicle measurements - full wrap coverage included (sides, hood, bumpers, roof).</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Year</Label>
                    <input type="text" placeholder="2024" className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Make</Label>
                    <input type="text" placeholder="Ford" className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Model</Label>
                    <input type="text" placeholder="F-250" className="w-full h-9 px-3 rounded-md border border-border bg-background text-sm" />
                  </div>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-border">
              <p className="text-xl font-semibold">Total: ${calculatePrice()}</p>
            </div>
          </PrintProCardContent>
        </PrintProCard>

        {(selectedDesign !== null || isLoadingRenders) && (
          <PrintProCard className="mb-8">
            <PrintProCardHeader>
              <PrintProCardTitle className="text-lg">3D Vehicle Preview</PrintProCardTitle>
              <PrintProCardDescription>
                See how {designs?.[selectedDesign || 0]?.name} looks on a vehicle
              </PrintProCardDescription>
            </PrintProCardHeader>
            <PrintProCardContent>
              <PrintProRenderCarousel
                views={renderViews}
                colorName={designs?.[selectedDesign || 0]?.name || ""}
                colorHex="#9b87f5"
                finish="Design"
                isGenerating={isLoadingRenders}
              />
            </PrintProCardContent>
          </PrintProCard>
        )}

        <div className="flex justify-center">
          <Button 
            size="lg" 
            disabled={selectedDesign === null || isCheckoutLoading}
            onClick={handleCheckout}
            className="bg-gradient-to-r from-[#D946EF] to-[#9b87f5] hover:opacity-90"
          >
            {isCheckoutLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              <>
                {purchaseType === "files" 
                  ? `Buy Production Files - $${calculatePrice()}`
                  : `Buy Design Print Pack - $${calculatePrice()}`
                }
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default FullDesignPrintPacksProductPage;
