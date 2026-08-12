import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, ShoppingCart, FileText, Trash2, Edit, Share2, Copy, Fingerprint } from "lucide-react";
import { toast } from "sonner";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { useOrganization } from "@/contexts/OrganizationContext";

interface MaterialEstimate {
  totalYards: number;
  totalSquareFeet: number;
  vehicleCategory: string;
  zones: Array<{
    zone: string;
    color: string;
    finish: string;
    yardsEstimate: number;
  }>;
}

interface DesignJob {
  id: string;
  type: 'panel' | 'pattern' | 'fadewrap' | 'custom_styling';
  name: string;
  vehicle: string;
  finish: string;
  heroUrl: string | null;
  createdAt: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  materialEstimate?: MaterialEstimate | null;
  stylingPrompt?: string;
}

const MyDesigns = () => {
  const navigate = useNavigate();
  const { currentShop, isLoading: orgLoading } = useOrganization();
  const [designs, setDesigns] = useState<DesignJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (orgLoading) return;
    if (!currentShop) {
      setDesigns([]);
      setLoading(false);
      return;
    }
    loadDesigns(currentShop.id);
  }, [currentShop?.id, orgLoading]);

  const loadDesigns = async (shopId: string) => {
    setLoading(true);
    try {
      // Fetch all design types in parallel, scoped to the current shop so
      // teammates share the same "My Designs" view via Phase 1b teammate RLS.
      const [panelResult, patternResult, fadeResult, customStylingResult] = await Promise.all([
        supabase
          .from('panel_designs')
          .select('*')
          .eq('shop_id', shopId)
          .order('created_at', { ascending: false }),
        supabase
          .from('pattern_designs')
          .select('*')
          .eq('shop_id', shopId)
          .order('created_at', { ascending: false }),
        supabase
          .from('fadewrap_designs')
          .select('*')
          .eq('shop_id', shopId)
          .order('created_at', { ascending: false }),
        supabase
          .from('custom_styling_jobs')
          .select('*')
          .eq('shop_id', shopId)
          .eq('status', 'completed')
          .order('created_at', { ascending: false }),
      ]);

      const allDesigns: DesignJob[] = [];

      // Process panel designs
      if (panelResult.data) {
        panelResult.data.forEach((d) => {
          const promptState = d.prompt_state as Record<string, unknown> | null;
          allDesigns.push({
            id: d.id,
            type: 'panel',
            name: (promptState?.panelName as string) || 'DesignProAI Design',
            vehicle: `${d.vehicle_year || ''} ${d.vehicle_make || ''} ${d.vehicle_model || ''}`.trim(),
            finish: d.finish || 'Gloss',
            heroUrl: (promptState?.heroUrl as string) || d.preview_image_url,
            createdAt: d.created_at || new Date().toISOString(),
            vehicleYear: d.vehicle_year || undefined,
            vehicleMake: d.vehicle_make || undefined,
            vehicleModel: d.vehicle_model || undefined,
          });
        });
      }

      // Process pattern designs
      if (patternResult.data) {
        patternResult.data.forEach((d) => {
          const textureProfile = d.texture_profile as Record<string, unknown> | null;
          allDesigns.push({
            id: d.id,
            type: 'pattern',
            name: d.pattern_name || 'PatternPro Design',
            vehicle: `${d.vehicle_year || ''} ${d.vehicle_make || ''} ${d.vehicle_model || ''}`.trim(),
            finish: d.finish || 'Gloss',
            heroUrl: (textureProfile?.heroUrl as string) || d.preview_image_url,
            createdAt: d.created_at || new Date().toISOString(),
            vehicleYear: d.vehicle_year || undefined,
            vehicleMake: d.vehicle_make || undefined,
            vehicleModel: d.vehicle_model || undefined,
          });
        });
      }

      // Process fadewrap designs
      if (fadeResult.data) {
        fadeResult.data.forEach((d) => {
          const gradientSettings = d.gradient_settings as Record<string, unknown> | null;
          allDesigns.push({
            id: d.id,
            type: 'fadewrap',
            name: d.fade_name || 'FadeWrap Design',
            vehicle: `${d.vehicle_year || ''} ${d.vehicle_make || ''} ${d.vehicle_model || ''}`.trim(),
            finish: d.finish || 'Gloss',
            heroUrl: (gradientSettings?.heroUrl as string) || d.preview_image_url,
            createdAt: d.created_at || new Date().toISOString(),
            vehicleYear: d.vehicle_year || undefined,
            vehicleMake: d.vehicle_make || undefined,
            vehicleModel: d.vehicle_model || undefined,
          });
        });
      }

      // Process custom styling jobs
      if (customStylingResult.data) {
        customStylingResult.data.forEach((d) => {
          const materialEst = d.material_estimate as unknown as MaterialEstimate | null;
          allDesigns.push({
            id: d.id,
            type: 'custom_styling',
            name: 'Custom Styling Design',
            vehicle: `${d.vehicle_year || ''} ${d.vehicle_make || ''} ${d.vehicle_model || ''}`.trim(),
            finish: 'Multi-Zone',
            heroUrl: d.hero_render_url,
            createdAt: d.created_at || new Date().toISOString(),
            vehicleYear: d.vehicle_year || undefined,
            vehicleMake: d.vehicle_make || undefined,
            vehicleModel: d.vehicle_model || undefined,
            materialEstimate: materialEst,
            stylingPrompt: d.styling_prompt,
          });
        });
      }

      // Sort by created date
      allDesigns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setDesigns(allDesigns);
    } catch (error) {
      console.error('Failed to load designs:', error);
      toast.error('Failed to load your designs');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (design: DesignJob) => {
    try {
      let error;
      if (design.type === 'panel') {
        const result = await supabase.from('panel_designs').delete().eq('id', design.id);
        error = result.error;
      } else if (design.type === 'pattern') {
        const result = await supabase.from('pattern_designs').delete().eq('id', design.id);
        error = result.error;
      } else if (design.type === 'custom_styling') {
        const result = await supabase.from('custom_styling_jobs').delete().eq('id', design.id);
        error = result.error;
      } else {
        const result = await supabase.from('fadewrap_designs').delete().eq('id', design.id);
        error = result.error;
      }

      if (error) throw error;
      
      setDesigns(prev => prev.filter(d => d.id !== design.id));
      toast.success('Design deleted');
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error('Failed to delete design');
    }
  };

  const handleOrderDesign = (design: DesignJob) => {
    if (design.type === 'panel') {
      navigate(`/printpro/designpanelpro?designId=${design.id}`);
    } else if (design.type === 'pattern') {
      navigate(`/printpro/wbty?designId=${design.id}`);
    } else if (design.type === 'custom_styling') {
      navigate(`/printpro/custom-styling?designId=${design.id}`);
    } else {
      navigate(`/printpro/fadewrap?designId=${design.id}`);
    }
  };

  const handleContinueEditing = (design: DesignJob) => {
    if (design.type === 'panel') {
      navigate(`/designpanelpro?resume=${design.id}`);
    } else if (design.type === 'pattern') {
      navigate(`/wbty?resume=${design.id}`);
    } else if (design.type === 'custom_styling') {
      navigate(`/colorpro?resume=${design.id}`);
    } else {
      navigate(`/fadewraps?resume=${design.id}`);
    }
  };

  const handleShareLink = async (design: DesignJob) => {
    const shareUrl = `${window.location.origin}/share/${design.type}/${design.id}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success('Share link copied to clipboard!');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const getTypeLabel = (type: string) => {
    if (type === 'panel') return 'DesignProAI™';
    if (type === 'pattern') return 'PatternPro™';
    if (type === 'custom_styling') return 'Custom Styling';
    return 'FadeWrap™';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
            My <span className="bg-gradient-to-r from-[#D946EF] to-[#9b87f5] bg-clip-text text-transparent">Designs</span>
          </h1>
          <p className="text-lg text-muted-foreground mt-2">
            View and manage your saved design projects
          </p>
        </div>

        {designs.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-xl text-muted-foreground mb-6">
              You haven't saved any designs yet.
            </p>
            <Button
              onClick={() => navigate('/designpro')}
              className="bg-gradient-to-r from-[#D946EF] to-[#9b87f5] hover:opacity-90"
            >
              Start Creating
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {designs.map((design) => (
              <div
                key={`${design.type}-${design.id}`}
                className="bg-card rounded-2xl shadow-lg border border-border overflow-hidden hover:shadow-xl transition-shadow"
              >
                {/* Preview Image */}
                <div className="aspect-video bg-muted relative">
                  {design.heroUrl ? (
                    <img
                      src={design.heroUrl}
                      alt={design.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      No preview
                    </div>
                  )}
                  {/* Type Badge */}
                  <span className="absolute top-3 left-3 px-2 py-1 bg-background/80 backdrop-blur-sm rounded-md text-xs font-medium text-foreground">
                    {getTypeLabel(design.type)}
                  </span>
                </div>

                {/* Content */}
                <div className="p-5 space-y-4">
                  <div>
                    <h3 className="font-semibold text-foreground truncate">
                      {design.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {design.vehicle || 'Vehicle not specified'}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-muted-foreground">
                        {new Date(design.createdAt).toLocaleDateString()}
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const shortId = design.id.substring(0, 8).toUpperCase();
                          navigator.clipboard.writeText(design.id).then(() => {
                            toast.success(`Thumbprint copied: ${shortId}`);
                          });
                        }}
                        className="flex items-center gap-1 px-1.5 py-0.5 bg-muted/60 hover:bg-muted rounded text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                        title={`Prompt Thumbprint™: ${design.id}`}
                      >
                        <Fingerprint className="w-3 h-3" />
                        {design.id.substring(0, 8).toUpperCase()}
                      </button>
                    </div>
                  </div>

                  {/* Material Estimate Display for Custom Styling */}
                  {design.type === 'custom_styling' && design.materialEstimate && (
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2">
                      <p className="text-xs font-medium text-foreground flex items-center gap-1">
                        <span className="text-primary">📊</span> Material Estimate
                      </p>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Total Yards:</span>
                        <span className="font-semibold text-foreground">{design.materialEstimate.totalYards} yds</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Sq. Feet:</span>
                        <span className="font-semibold text-foreground">{design.materialEstimate.totalSquareFeet} sq ft</span>
                      </div>
                      {design.materialEstimate.zones && design.materialEstimate.zones.length > 0 && (
                        <div className="pt-2 border-t border-border/50 space-y-1">
                          <p className="text-xs text-muted-foreground font-medium">Per-Color Breakdown:</p>
                          {design.materialEstimate.zones.map((zone, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">{zone.zone} ({zone.color} {zone.finish}):</span>
                              <span className="font-medium">{zone.yardsEstimate} yds</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 bg-gradient-to-r from-[#D946EF] to-[#9b87f5] hover:opacity-90"
                        onClick={() => handleOrderDesign(design)}
                      >
                        <ShoppingCart className="h-4 w-4 mr-1" />
                        Order
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => handleContinueEditing(design)}
                      >
                        <Edit className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => handleShareLink(design)}
                      >
                        <Share2 className="h-4 w-4 mr-1" />
                        Share
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => toast.info('Proof generation coming soon')}
                      >
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDelete(design)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    {/* MyVehiclePro */}
                    <MyVehicleProInline
                      colorName={design.name}
                      finishType={design.finish}
                      vehicleYear={design.vehicleYear}
                      vehicleMake={design.vehicleMake}
                      vehicleModel={design.vehicleModel}
                      renderUrl={design.heroUrl}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyDesigns;
