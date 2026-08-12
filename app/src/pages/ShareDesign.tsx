import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Fingerprint, Copy, Hash, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { formatDid } from "@/lib/designId";

interface SharedDesign {
  id: string;
  name: string;
  vehicle: string;
  finish: string;
  heroUrl: string | null;
  createdAt: string;
  type: string;
}

const ShareDesign = () => {
  const { type, id } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();
  const [design, setDesign] = useState<SharedDesign | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    loadDesign();
  }, [type, id]);

  const loadDesign = async () => {
    if (!type || !id) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    try {
      let data: any = null;

      if (type === 'panel') {
        const result = await supabase
          .from('panel_designs')
          .select('*')
          .eq('id', id)
          .single();
        if (result.data) {
          const promptState = result.data.prompt_state as Record<string, unknown> | null;
          data = {
            id: result.data.id,
            name: (promptState?.panelName as string) || 'DesignProAI Design',
            vehicle: `${result.data.vehicle_year || ''} ${result.data.vehicle_make || ''} ${result.data.vehicle_model || ''}`.trim(),
            finish: result.data.finish || 'Gloss',
            heroUrl: (promptState?.heroUrl as string) || result.data.preview_image_url,
            createdAt: result.data.created_at,
            type: 'DesignProAI™',
          };
        }
      } else if (type === 'pattern') {
        const result = await supabase
          .from('pattern_designs')
          .select('*')
          .eq('id', id)
          .single();
        if (result.data) {
          const textureProfile = result.data.texture_profile as Record<string, unknown> | null;
          data = {
            id: result.data.id,
            name: result.data.pattern_name || 'PatternPro Design',
            vehicle: `${result.data.vehicle_year || ''} ${result.data.vehicle_make || ''} ${result.data.vehicle_model || ''}`.trim(),
            finish: result.data.finish || 'Gloss',
            heroUrl: (textureProfile?.heroUrl as string) || result.data.preview_image_url,
            createdAt: result.data.created_at,
            type: 'PatternPro™',
          };
        }
      } else if (type === 'fadewrap') {
        const result = await supabase
          .from('fadewrap_designs')
          .select('*')
          .eq('id', id)
          .single();
        if (result.data) {
          const gradientSettings = result.data.gradient_settings as Record<string, unknown> | null;
          data = {
            id: result.data.id,
            name: result.data.fade_name || 'FadeWrap Design',
            vehicle: `${result.data.vehicle_year || ''} ${result.data.vehicle_make || ''} ${result.data.vehicle_model || ''}`.trim(),
            finish: result.data.finish || 'Gloss',
            heroUrl: (gradientSettings?.heroUrl as string) || result.data.preview_image_url,
            createdAt: result.data.created_at,
            type: 'FadeWrap™',
          };
        }
      } else if (type === 'render') {
        const result = await supabase
          .from('color_visualizations')
          .select('*')
          .eq('id', id)
          .single();
        if (result.data) {
          const renderUrls = result.data.render_urls as Record<string, string> | null;
          const heroUrl = renderUrls?.side || renderUrls?.['driver-side'] || renderUrls?.front || renderUrls?.hood_detail || Object.values(renderUrls || {})[0] || null;
          const modeLabel = result.data.mode_type === 'designpanelpro' ? 'DesignProAI™' : result.data.mode_type === 'fadewraps' ? 'FadeWraps™' : 'ColorPro™';
          data = {
            id: result.data.id,
            name: result.data.color_name || result.data.design_file_name || 'Vehicle Wrap Design',
            vehicle: `${result.data.vehicle_year || ''} ${result.data.vehicle_make || ''} ${result.data.vehicle_model || ''}`.trim(),
            finish: result.data.finish_type || 'Gloss',
            heroUrl,
            createdAt: result.data.created_at,
            type: modeLabel,
          };
        }
      } else if (type === 'vault') {
        const { data: fnData, error: fnError } = await supabase.functions.invoke('get-public-pack', {
          body: { id },
        });
        if (!fnError && fnData && !fnData.error) {
          const vInfo = fnData.vehicle_info;
          data = {
            id: fnData.id,
            name: fnData.design_name || 'Production Pack',
            vehicle: vInfo
              ? `${vInfo.year || ''} ${vInfo.make || ''} ${vInfo.model || ''}`.trim()
              : 'Vehicle',
            finish: fnData.finish_type || 'Gloss',
            heroUrl: fnData.thumbnail_url,
            createdAt: fnData.created_at,
            type: 'DesignVault™',
          };
        }
      }

      if (data) {
        setDesign(data);
      } else {
        setNotFound(true);
      }
    } catch (error) {
      console.error('Failed to load shared design:', error);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
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

  if (notFound || !design) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-20 text-center">
          <h1 className="text-2xl font-bold text-foreground mb-4">Design Not Found</h1>
          <p className="text-muted-foreground">This design may have been removed or the link is invalid.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Design Preview */}
        <div className="bg-card rounded-2xl shadow-xl border border-border overflow-hidden">
          {design.heroUrl ? (
            <img
              src={design.heroUrl}
              alt={design.name}
              className="w-full aspect-video object-cover"
            />
          ) : (
            <div className="w-full aspect-video bg-muted flex items-center justify-center">
              <span className="text-muted-foreground">No preview available</span>
            </div>
          )}
          
          <div className="p-6 space-y-4">
            {/* Type Badge + Design ID */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block px-3 py-1 bg-gradient-to-r from-[#D946EF] to-[#9b87f5] text-white rounded-full text-sm font-medium">
                {design.type}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(design.id).then(() => {
                    toast.success(`Thumbprint copied: ${design.id.substring(0, 8).toUpperCase()}`);
                  });
                }}
                className="flex items-center gap-1 px-2 py-1 bg-muted/60 hover:bg-muted rounded-full text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                title={`Prompt Thumbprint™: ${design.id}`}
              >
                <Fingerprint className="w-3 h-3" />
                {design.id.substring(0, 8).toUpperCase()}
                <Copy className="w-2.5 h-2.5 opacity-50" />
              </button>
            </div>

            <div>
              <h1 className="text-2xl font-bold text-foreground">{design.name}</h1>
              <p className="text-lg text-muted-foreground mt-1">{design.vehicle || 'Vehicle not specified'}</p>
            </div>
            
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>Finish: {design.finish}</span>
              <span>•</span>
              <span>Created: {new Date(design.createdAt).toLocaleDateString()}</span>
            </div>
            
            {/* DesignID badge for vault shares */}
            {type === 'vault' && (
              <div className="flex items-center gap-2">
                <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 font-mono text-xs gap-1">
                  <Hash className="w-3 h-3" />
                  {formatDid(design.id)}
                </Badge>
              </div>
            )}

            {/* MyVehiclePro */}
            <MyVehicleProInline
              colorName={design.name}
              finishType={design.finish}
              renderUrl={design.heroUrl}
            />

            {/* Reconfigure CTA for vault shares */}
            {type === 'vault' && (
              <Button
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white gap-2"
                onClick={() => navigate(`/printpro/design-packs?reconfigure=${design.id}`)}
              >
                <RefreshCw className="w-4 h-4" />
                Order This Design - $25 Reconfigure
              </Button>
            )}

            {/* Branding */}
            <div className="pt-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Generated with{' '}
                <span className="font-semibold bg-gradient-to-r from-blue-500 to-blue-600 bg-clip-text text-transparent">
                  RestyleProAI™ Vehicle Wrap Design Suite
                </span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ShareDesign;
