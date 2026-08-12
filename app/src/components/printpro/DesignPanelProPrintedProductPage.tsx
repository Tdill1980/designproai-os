import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PrintProCard, PrintProCardHeader, PrintProCardTitle, PrintProCardDescription, PrintProCardContent } from "./PrintProCard";
import { PrintProThumbnail } from "./PrintProThumbnail";
import { PrintProRenderCarousel } from "./PrintProRenderCarousel";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Check } from "lucide-react";
import { trackQuoteEvent, generateQuoteId } from "@/lib/track-conversion";

interface DesignContext {
  panelId?: string;
  panelName?: string;
  panelUrl?: string;
  thumbnailUrl?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  finish?: string;
  renderUrl?: string;
  allViews?: Array<{ type: string; url: string }>;
}

interface SavedDesignJob {
  id: string;
  panel_id: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  finish: string | null;
  preview_image_url: string | null;
  prompt_state: {
    panelName?: string;
    panelUrl?: string;
    thumbnailUrl?: string;
    allViews?: Array<{ type: string; url: string }>;
    heroUrl?: string;
  } | null;
}

const DesignPanelProPrintedProductPage = () => {
  const [searchParams] = useSearchParams();
  const [selectedPanel, setSelectedPanel] = useState<number | null>(null);
  const [renderViews, setRenderViews] = useState<Array<{ type: string; url: string }>>([]);
  const [isLoadingRenders, setIsLoadingRenders] = useState(false);
  const [kitSize, setKitSize] = useState<string>("medium");
  const [designContext, setDesignContext] = useState<DesignContext | null>(null);
  const [savedDesign, setSavedDesign] = useState<SavedDesignJob | null>(null);

  // Product IDs for WePrintWraps.com
  const PRODUCTION_FILE_PRODUCT_IDS: Record<string, number> = {
    small: 69664,
    medium: 69671,
    large: 69680,
    xlarge: 69686,
  };

  // Fetch curated DesignPanelPro patterns
  const { data: panels, isLoading } = useQuery({
    queryKey: ["designpanelpro-patterns-printpro"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("designpanelpro_patterns")
        .select("*")
        .eq("is_active", true)
        .eq("is_curated", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return data;
    },
  });

  // Load design from database (designId) or fallback to localStorage
  useEffect(() => {
    const loadDesign = async () => {
      const designIdFromUrl = searchParams.get('designId');
      const panelIdFromUrl = searchParams.get('panelId');
      
      // Priority 1: Load from database using designId
      if (designIdFromUrl) {
        setIsLoadingRenders(true);
        try {
          const { data: design, error } = await supabase
            .from('panel_designs')
            .select('*')
            .eq('id', designIdFromUrl)
            .single();
          
          if (error) throw error;
          
          if (design) {
            setSavedDesign(design as SavedDesignJob);
            
            // Build render views from saved design
            const promptState = design.prompt_state as SavedDesignJob['prompt_state'];
            const views: Array<{ type: string; url: string }> = [];
            
            if (promptState?.heroUrl) {
              views.push({ type: 'roof', url: promptState.heroUrl });
            } else if (design.preview_image_url) {
              views.push({ type: 'roof', url: design.preview_image_url });
            }
            
            if (promptState?.allViews) {
              views.push(...promptState.allViews.filter(v => v.type !== 'roof'));
            }
            
            setRenderViews(views);
            
            // Build design context from saved design
            setDesignContext({
              panelId: design.panel_id || undefined,
              panelName: promptState?.panelName,
              panelUrl: promptState?.panelUrl,
              thumbnailUrl: promptState?.thumbnailUrl,
              vehicleYear: design.vehicle_year || undefined,
              vehicleMake: design.vehicle_make || undefined,
              vehicleModel: design.vehicle_model || undefined,
              finish: design.finish || undefined,
              renderUrl: promptState?.heroUrl || design.preview_image_url || undefined,
              allViews: promptState?.allViews
            });
            
            // Clear localStorage since we loaded from DB
            localStorage.removeItem('designpanelpro-purchase-context');
          }
        } catch (e) {
          console.error('Error loading design from database:', e);
        } finally {
          setIsLoadingRenders(false);
        }
        return;
      }
      
      // Priority 2: Fallback to localStorage
      const storedContext = localStorage.getItem('designpanelpro-purchase-context');
      
      if (storedContext) {
        try {
          const context = JSON.parse(storedContext) as DesignContext;
          setDesignContext(context);
          
          if (context.renderUrl) {
            const views = context.allViews || [];
            if (!views.find(v => v.type === 'roof' || v.type === 'front')) {
              views.unshift({ type: 'roof', url: context.renderUrl });
            }
            setRenderViews(views);
          }
          
          if (panelIdFromUrl && panels) {
            const panelIndex = panels.findIndex(p => p.id === panelIdFromUrl);
            if (panelIndex !== -1) {
              setSelectedPanel(panelIndex);
            }
          }
        } catch (e) {
          console.error('Error parsing design context:', e);
        }
      } else if (panelIdFromUrl && panels) {
        const panelIndex = panels.findIndex(p => p.id === panelIdFromUrl);
        if (panelIndex !== -1) {
          setSelectedPanel(panelIndex);
          handlePanelClick(panelIndex);
        }
      }
    };
    
    loadDesign();
  }, [searchParams, panels]);

  const handlePanelClick = async (index: number) => {
    setSelectedPanel(index);
    const panel = panels?.[index];
    if (!panel) return;

    // If this is the same panel as in context, use context renders
    if (designContext?.panelId === panel.id && designContext.renderUrl) {
      return; // Already have renders from context
    }

    setIsLoadingRenders(true);
    
    try {
      // Fetch pre-stored renders from vehicle_render_images table
      const { data: renders, error } = await supabase
        .from('vehicle_render_images')
        .select('*')
        .eq('swatch_id', panel.id)
        .eq('product_type', 'designpanelpro')
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
      // Clear context since we're loading a different panel
      setDesignContext(null);
    } catch (error) {
      console.error('Error loading renders:', error);
      setRenderViews([]);
    } finally {
      setIsLoadingRenders(false);
    }
  };

  const handleAddToCart = () => {
    const productId = PRODUCTION_FILE_PRODUCT_IDS[kitSize];
    const panel = panels?.[selectedPanel || 0];
    
    // Build cart URL with design metadata
    let cartUrl = `https://weprintwraps.com/cart/?add-to-cart=${productId}`;
    
    // Add design context as metadata if available
    const designName = designContext?.panelName || panel?.ai_generated_name || panel?.name;
    const vehicleInfo = designContext 
      ? `${designContext.vehicleYear} ${designContext.vehicleMake} ${designContext.vehicleModel}`.trim()
      : '';
    
    // Track conversion event (fire-and-forget)
    trackQuoteEvent({
      eventType: "order_now_clicked",
      quoteId: generateQuoteId(),
      productType: "designpro",
      metadata: { 
        panelId: panel?.id,
        designName, 
        vehicleInfo, 
        kitSize,
        savedDesignId: savedDesign?.id 
      },
    });
    
    // WooCommerce can accept custom data via URL params
    if (designName) {
      cartUrl += `&design_name=${encodeURIComponent(designName)}`;
    }
    // Include design job ID for order tracking
    if (savedDesign?.id) {
      cartUrl += `&job_id=${savedDesign.id}`;
    }
    if (vehicleInfo) {
      cartUrl += `&vehicle=${encodeURIComponent(vehicleInfo)}`;
    }
    
    window.open(cartUrl, "_blank");
  };

  const currentPanel = panels?.[selectedPanel || 0];
  const displayVehicle = designContext 
    ? `${designContext.vehicleYear} ${designContext.vehicleMake} ${designContext.vehicleModel}`.trim()
    : '';

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12">
        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle>DesignProAI™ Production Files</PrintProCardTitle>
            <PrintProCardDescription>
              Print-ready design files from our curated library. Professional digital files ready for production on automotive-grade vinyl. Files include vectorized designs with proper sizing and bleed for wrap installation.
            </PrintProCardDescription>
          </PrintProCardHeader>
        </PrintProCard>

        {/* Design Context Banner - Show when coming from tool */}
        {designContext && designContext.renderUrl && (
          <PrintProCard className="mb-8 border-primary/50 bg-primary/5">
            <PrintProCardHeader>
              <PrintProCardTitle className="text-lg flex items-center gap-2">
                <Check className="w-5 h-5 text-green-500" />
                Your Custom Design is Ready
                {savedDesign && (
                  <span className="text-xs font-normal text-muted-foreground ml-2">
                    (Saved to account)
                  </span>
                )}
              </PrintProCardTitle>
              <PrintProCardDescription>
                {designContext.panelName} {displayVehicle && `on ${displayVehicle}`} • {designContext.finish} finish
              </PrintProCardDescription>
            </PrintProCardHeader>
            <PrintProCardContent>
              <div className="aspect-video max-w-xl mx-auto rounded-lg overflow-hidden border border-border">
                <img 
                  src={designContext.renderUrl} 
                  alt={`${designContext.panelName} preview`}
                  className="w-full h-full object-cover"
                />
              </div>
            </PrintProCardContent>
          </PrintProCard>
        )}

        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle className="text-lg">
              {designContext ? 'Change Design (Optional)' : 'Select Design Panel'}
            </PrintProCardTitle>
          </PrintProCardHeader>
          <PrintProCardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {panels?.map((panel, idx) => (
                  <PrintProThumbnail
                    key={panel.id}
                    imageUrl={panel.thumbnail_url || panel.clean_display_url || panel.media_url}
                    title={panel.ai_generated_name || panel.name}
                    subtitle={panel.category || "Design Panel"}
                    selected={selectedPanel === idx || (designContext?.panelId === panel.id && selectedPanel === null)}
                    onClick={() => handlePanelClick(idx)}
                  />
                ))}
              </div>
            )}
          </PrintProCardContent>
        </PrintProCard>

        {(selectedPanel !== null || isLoadingRenders || (designContext && renderViews.length > 0)) && (
          <PrintProCard className="mb-8">
            <PrintProCardHeader>
              <PrintProCardTitle className="text-lg">3D Vehicle Preview</PrintProCardTitle>
              <PrintProCardDescription>
                {designContext?.panelName || currentPanel?.ai_generated_name || currentPanel?.name}
                {displayVehicle && ` on ${displayVehicle}`}
              </PrintProCardDescription>
            </PrintProCardHeader>
            <PrintProCardContent>
              <PrintProRenderCarousel
                views={renderViews}
                colorName={designContext?.panelName || currentPanel?.ai_generated_name || currentPanel?.name || ""}
                colorHex="#9b87f5"
                finish={designContext?.finish || "Design Panel"}
                isGenerating={isLoadingRenders}
              />
            </PrintProCardContent>
          </PrintProCard>
        )}

        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle className="text-lg">Order Production Files</PrintProCardTitle>
            <PrintProCardDescription>
              Print-ready design files for professional wrap installers
            </PrintProCardDescription>
          </PrintProCardHeader>
          <PrintProCardContent>
            <div className="space-y-6">
              {/* GENIE OS Auto-Sized */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Vehicle Info</label>
                <p className="text-xs text-muted-foreground">GENIE Production Panelizer OS™ auto-sizes all panels from vehicle measurements</p>
                <div className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <span className="text-xs text-blue-400">
                    Panel size auto-determined from {designContext?.vehicleYear} {designContext?.vehicleMake} {designContext?.vehicleModel || "vehicle"} - full wrap coverage included
                  </span>
                </div>
              </div>

              {/* Price Display */}
              <div className="text-center py-6 border-t border-b border-border">
                <span className="text-4xl font-bold text-primary">$119.00</span>
                <p className="text-sm text-muted-foreground mt-2">Digital Production Files</p>
              </div>

              {/* Add to Cart Button */}
              <Button 
                size="lg" 
                className="w-full bg-gradient-to-r from-[#D946EF] to-[#9b87f5] hover:opacity-90 text-lg py-6"
                onClick={handleAddToCart}
                disabled={selectedPanel === null && !designContext}
              >
                Add to Cart
              </Button>

              {/* Info Text */}
              <p className="text-xs text-muted-foreground text-center">
                Instant digital delivery • Print-ready files • Professional quality
              </p>
            </div>
          </PrintProCardContent>
        </PrintProCard>
      </div>
    </div>
  );
};

export default DesignPanelProPrintedProductPage;