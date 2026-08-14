import { useState, useEffect, useMemo } from "react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Download, Share2, Filter, X, GitBranch, Sun, Moon, Package, Scissors, Palette, ClipboardSignature, Users } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProfessionalProofSheet } from "@/components/tools/ProfessionalProofSheet";
import { useCutFiles } from "@/hooks/useCutFiles";
import { ProductionPackDialog } from "@/components/designpanelpro/ProductionPackDialog";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { useNavigate } from "react-router-dom";
import { useRenderLimits } from "@/hooks/useRenderLimits";
import { useStudioToggle } from "@/hooks/useStudioToggle";
import { getColorFamily, getColorFamilyLabel } from "@/lib/tag-utils";
import { thumbnailUrl } from "@/lib/storage-thumbnail";
import { cn } from "@/lib/utils";

const VIEW_LABELS: Record<string, string> = {
  side: "Driver Side",
  "driver-side": "Driver Side",
  "passenger-side": "Passenger Side",
  hood_detail: "Hood",
  front: "Front",
  rear: "Rear",
  "close-up": "Close-Up Detail",
  roof: "Roof",
};

interface RenderRecord {
  id: string;
  mode_type: string;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  color_name: string;
  color_hex: string;
  finish_type: string;
  render_urls: any;
  created_at: string;
  custom_design_url?: string;
  custom_swatch_url?: string;
  design_file_name?: string;
}

const MyRenders = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [renders, setRenders] = useState<RenderRecord[]>([]);
  const [filteredRenders, setFilteredRenders] = useState<RenderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showTeamRenders, setShowTeamRenders] = useState(false);
  const [filterMode, setFilterMode] = useState<string>("all");
  const [filterManufacturer, setFilterManufacturer] = useState<string>("all");
  const [filterFinish, setFilterFinish] = useState<string>("all");
  const [filterColorFamily, setFilterColorFamily] = useState<string>("all");
  const { limitStatus, isLoading: limitsLoading } = useRenderLimits(email);
  const studio = useStudioToggle();
  const { isGeneratingCutFiles, handleGenerateCutFiles } = useCutFiles();
  const [showProductionDialog, setShowProductionDialog] = useState(false);
  const [selectedRenderForPack, setSelectedRenderForPack] = useState<RenderRecord | null>(null);
  const [showProofSheet, setShowProofSheet] = useState(false);
  const [proofRender, setProofRender] = useState<RenderRecord | null>(null);

  const loadRenders = async () => {
    if (!email) {
      toast.error("Please enter your email");
      return;
    }

    setLoading(true);
    try {
      let query = supabase
        .from('color_visualizations')
        .select('*')
        .eq('generation_status', 'completed')
        .order('created_at', { ascending: false });

      if (showTeamRenders) {
        // Find user's organization_id
        const { data: orgRow } = await supabase
          .from('color_visualizations')
          .select('organization_id')
          .eq('customer_email', email)
          .not('organization_id', 'is', null)
          .limit(1)
          .maybeSingle();

        if (orgRow?.organization_id) {
          query = query.or(`customer_email.eq.${email},organization_id.eq.${orgRow.organization_id}`);
        } else {
          query = query.eq('customer_email', email);
        }
      } else {
        query = query.eq('customer_email', email);
      }

      const { data, error } = await query;
      if (error) throw error;

      setRenders(data || []);
      setFilteredRenders(data || []);

      if (!data || data.length === 0) {
        toast.info("No renders found for this email");
      }
    } catch (error) {
      console.error('Error loading renders:', error);
      toast.error('Failed to load your renders');
    } finally {
      setLoading(false);
    }
  };

  // Extract unique manufacturers and finishes
  const uniqueManufacturers = useMemo(() => {
    const manufacturers = new Set<string>();
    renders.forEach(r => {
      // Check if render has custom_swatch_url (Custom Color mode)
      if (r.custom_swatch_url) {
        manufacturers.add('Custom Color');
      } else {
        // Try to extract manufacturer from color_name or mode_type
        if (r.mode_type === 'inkfusion') manufacturers.add('InkFusion');
        else if (r.mode_type === 'fadewraps') manufacturers.add('FadeWraps Gradients');
        else if (r.mode_type === 'wbty') manufacturers.add('WBTY Patterns');
        else if (r.mode_type === 'designpanelpro') manufacturers.add('DesignProAI Patterns');
      }
    });
    return Array.from(manufacturers).sort();
  }, [renders]);

  const uniqueFinishes = useMemo(() => {
    const finishes = new Set(renders.map(r => r.finish_type).filter(Boolean));
    return Array.from(finishes).sort();
  }, [renders]);

  // Apply all filters
  useEffect(() => {
    let filtered = renders;

    if (filterMode !== "all") {
      filtered = filtered.filter(r => r.mode_type === filterMode);
    }

    if (filterManufacturer !== "all") {
      filtered = filtered.filter(r => {
        if (filterManufacturer === 'Custom Color') {
          return r.custom_swatch_url !== null;
        }
        // Map mode_type to manufacturer
        const modeToManufacturer: Record<string, string> = {
          inkfusion: 'InkFusion',
          fadewraps: 'FadeWraps Gradients',
          wbty: 'WBTY Patterns',
          designpanelpro: 'DesignProAI Patterns'
        };
        return modeToManufacturer[r.mode_type] === filterManufacturer;
      });
    }

    if (filterFinish !== "all") {
      filtered = filtered.filter(r => r.finish_type === filterFinish);
    }

    if (filterColorFamily !== "all") {
      filtered = filtered.filter(r => {
        const family = getColorFamily(r.color_hex);
        return family === filterColorFamily;
      });
    }

    setFilteredRenders(filtered);
  }, [filterMode, filterManufacturer, filterFinish, filterColorFamily, renders]);

  const handleDownload = async (renderUrl: string, renderName: string) => {
    try {
      const response = await fetch(renderUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${renderName}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Download started');
    } catch (error) {
      console.error('Download error:', error);
      toast.error('Failed to download image');
    }
  };

  const handleShare = async (render: RenderRecord) => {
    const shareText = `Check out my ${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model} in ${render.color_name}!`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: shareText,
          text: shareText,
          url: window.location.href
        });
        toast.success('Shared successfully');
      } catch (error) {
        console.error('Share error:', error);
      }
    } else {
      // Fallback: Copy to clipboard
      navigator.clipboard.writeText(shareText);
      toast.success('Link copied to clipboard');
    }
  };

  const getModeLabel = (mode: string) => {
    const labels: Record<string, string> = {
      inkfusion: 'ColorPro™',
      colorpro: 'ColorPro™',
      fadewraps: 'FadeWraps™',
      wbty: 'WBTY™',
      designpanelpro: 'DesignProAI™',
      approvemode: 'ApproveMode'
    };
    return labels[mode] || mode;
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <title>My Renders - DesignProAI</title>
        <meta name="description" content="View and manage your AI-generated vehicle wrap designs. Download, revise, and share your renders." />
        <meta name="robots" content="noindex" />
      </Helmet>

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl font-bold mb-2">
            <span className="text-foreground">My </span>
            <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 text-transparent bg-clip-text">Renders</span>
          </h1>
          <p className="text-muted-foreground mb-8">View and manage all your generated designs</p>

          {/* Email Input & Usage Stats */}
          <Card className="p-6 mb-8">
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="email">Your Email</Label>
                <div className="flex gap-2">
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    onKeyDown={(e) => e.key === 'Enter' && loadRenders()}
                  />
                  <Button onClick={loadRenders} disabled={loading}>
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load Renders'}
                  </Button>
                  <Button
                    variant="outline"
                    size="default"
                    className={cn(
                      "gap-1.5 shrink-0",
                      showTeamRenders ? "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" : "",
                    )}
                    onClick={() => { setShowTeamRenders(!showTeamRenders); }}
                  >
                    <Users className="w-4 h-4" />
                    {showTeamRenders ? "Team" : "Mine"}
                  </Button>
                </div>
              </div>

              {limitStatus && (
                <div className="bg-muted p-4 rounded-lg">
                  <h3 className="font-semibold mb-2">Subscription Status</h3>
                  <div className="space-y-1 text-sm">
                    <p><span className="text-muted-foreground">Tier:</span> <span className="font-medium capitalize">{limitStatus.tier}</span></p>
                    <p><span className="text-muted-foreground">Used:</span> <span className="font-medium">{limitStatus.used} / {limitStatus.limit}</span></p>
                    <p><span className="text-muted-foreground">Remaining:</span> <span className="font-medium text-primary">{limitStatus.remaining} renders</span></p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Enhanced Filters */}
          {renders.length > 0 && (
            <Card className="p-6 mb-6">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="w-5 h-5 text-muted-foreground" />
                <h3 className="font-semibold">Filter Renders</h3>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Product Type Filter */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Product Type</Label>
                  <Select value={filterMode} onValueChange={setFilterMode}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Products</SelectItem>
                      <SelectItem value="inkfusion">ColorPro™</SelectItem>
                      <SelectItem value="fadewraps">FadeWraps™</SelectItem>
                      <SelectItem value="wbty">WBTY™</SelectItem>
                      <SelectItem value="designpanelpro">DesignProAI™</SelectItem>
                      <SelectItem value="approvemode">ApproveMode</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Manufacturer Filter */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Manufacturer</Label>
                  <Select value={filterManufacturer} onValueChange={setFilterManufacturer}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Manufacturers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Manufacturers</SelectItem>
                      {uniqueManufacturers.map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Finish Filter */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Finish Type</Label>
                  <Select value={filterFinish} onValueChange={setFilterFinish}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Finishes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Finishes</SelectItem>
                      {uniqueFinishes.map(f => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Color Family Filter */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Color Family</Label>
                  <Select value={filterColorFamily} onValueChange={setFilterColorFamily}>
                    <SelectTrigger>
                      <SelectValue placeholder="All Colors" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Colors</SelectItem>
                      <SelectItem value="blue">Blues</SelectItem>
                      <SelectItem value="red">Reds</SelectItem>
                      <SelectItem value="green">Greens</SelectItem>
                      <SelectItem value="teal">Teals/Cyans</SelectItem>
                      <SelectItem value="yellow">Yellows</SelectItem>
                      <SelectItem value="orange">Oranges</SelectItem>
                      <SelectItem value="purple">Purples</SelectItem>
                      <SelectItem value="black">Black</SelectItem>
                      <SelectItem value="white">White</SelectItem>
                      <SelectItem value="gray">Gray</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Active Filters Display */}
              {(filterMode !== "all" || filterManufacturer !== "all" || filterFinish !== "all" || filterColorFamily !== "all") && (
                <div className="mt-4 pt-4 border-t flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Active filters:</span>
                  {filterMode !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      {getModeLabel(filterMode)}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setFilterMode("all")} />
                    </Badge>
                  )}
                  {filterManufacturer !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      {filterManufacturer}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setFilterManufacturer("all")} />
                    </Badge>
                  )}
                  {filterFinish !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      {filterFinish}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setFilterFinish("all")} />
                    </Badge>
                  )}
                  {filterColorFamily !== "all" && (
                    <Badge variant="secondary" className="gap-1">
                      {getColorFamilyLabel(filterColorFamily)}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setFilterColorFamily("all")} />
                    </Badge>
                  )}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 text-xs ml-auto"
                    onClick={() => {
                      setFilterMode("all");
                      setFilterManufacturer("all");
                      setFilterFinish("all");
                      setFilterColorFamily("all");
                    }}
                  >
                    Clear All
                  </Button>
                </div>
              )}

              <div className="mt-3 text-sm text-muted-foreground">
                Showing {filteredRenders.length} of {renders.length} renders
              </div>
            </Card>
          )}

          {/* Renders Grid */}
          {filteredRenders.length > 0 ? (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredRenders.map((render) => {
                // DesignProAI: prefer side (original branded render) over hero
                const isDesignPro = render.mode_type === 'designpanelpro' || render.mode_type === 'designpro';
                const heroUrl = isDesignPro
                  ? (render.render_urls?.side || render.render_urls?.hero || Object.values(render.render_urls || {})[0])
                  : (render.render_urls?.hero || render.render_urls?.front || Object.values(render.render_urls || {})[0]);
                
                return (
                  <Card key={render.id} className="overflow-hidden">
                    {/* Render Image - click to open in RevisionStudioIQ */}
                    <div
                      className={cn(
                        "aspect-video relative overflow-hidden cursor-pointer group",
                        studio.isLight(render.id) ? "bg-gray-100" : "bg-muted"
                      )}
                      onClick={() => navigate(`/revision-studio?id=${render.id}`)}
                    >
                      {(() => {
                        const displayUrl = studio.getHeroUrl(render) || heroUrl;
                        return displayUrl ? (
                          <img
                            src={thumbnailUrl(displayUrl as string, 800)}
                            alt={`${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            No preview available
                          </div>
                        );
                      })()}
                      <div className="absolute top-2 right-2">
                        <span className={cn(
                          "px-2 py-1 rounded text-xs font-semibold text-white",
                          (render.mode_type === 'inkfusion' || render.mode_type === 'colorpro') ? "bg-cyan-500/90" : "bg-primary"
                        )}>
                          {getModeLabel(render.mode_type)}
                        </span>
                      </div>
                      {/* Light/dark studio toggle */}
                      <button
                        onClick={(e) => { e.stopPropagation(); studio.toggle(render); }}
                        className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center transition-colors z-10"
                        title={studio.isLight(render.id) ? "Switch to dark studio" : "Switch to light studio"}
                        disabled={studio.isGenerating(render.id)}
                      >
                        {studio.isGenerating(render.id) ? (
                          <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                        ) : studio.isLight(render.id) ? (
                          <Moon className="w-3.5 h-3.5 text-white" />
                        ) : (
                          <Sun className="w-3.5 h-3.5 text-yellow-400" />
                        )}
                      </button>
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center pointer-events-none">
                        <span className="text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 px-3 py-1.5 rounded-full">
                          View & Revise
                        </span>
                      </div>
                    </div>

                    {/* Render Details */}
                    <div className="p-4 space-y-3">
                      <div>
                        <h3 className="font-semibold text-lg">
                          {render.vehicle_year} {render.vehicle_make} {render.vehicle_model}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {render.color_name} • {render.finish_type}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Created: {new Date(render.created_at).toLocaleDateString()}
                        </p>

                        {/* Tag Badges */}
                        <div className="flex gap-2 flex-wrap mt-2">
                          {render.custom_swatch_url ? (
                            <Badge variant="outline" className="text-xs">Custom Color</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs">
                              {(render.mode_type === 'inkfusion' || render.mode_type === 'colorpro') && 'ColorPro™'}
                              {render.mode_type === 'fadewraps' && 'FadeWraps'}
                              {render.mode_type === 'wbty' && 'WBTY'}
                              {render.mode_type === 'designpanelpro' && 'DesignProAI™'}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">{render.finish_type}</Badge>
                          <Badge variant="outline" className="text-xs">
                            {getColorFamilyLabel(getColorFamily(render.color_hex))}
                          </Badge>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleDownload(
                            heroUrl as string,
                            `${render.vehicle_year}-${render.vehicle_make}-${render.vehicle_model}-${render.color_name}`
                          )}
                          disabled={!heroUrl}
                        >
                          <Download className="w-4 h-4 mr-1" />
                          Download
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => handleShare(render)}
                        >
                          <Share2 className="w-4 h-4 mr-1" />
                          Share
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-purple-500/50 text-purple-400 hover:bg-purple-900/30"
                          onClick={() => navigate(`/revision-studio?id=${render.id}`)}
                        >
                          <GitBranch className="w-4 h-4 mr-1" />
                          Revise
                        </Button>
                      </div>

                      {/* Show in ColorPro - for ColorPro renders */}
                      {(render.mode_type === 'inkfusion' || render.mode_type === 'colorpro') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full border-cyan-500/50 text-cyan-400 hover:bg-cyan-900/30"
                          onClick={() => navigate(`/colorpro?renderId=${render.id}`)}
                        >
                          <Palette className="w-4 h-4 mr-1" />
                          Show in ColorPro™
                        </Button>
                      )}

                      {/* Production Pack & Cut Files */}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-blue-500/50 text-blue-400 hover:bg-blue-900/30"
                          onClick={() => {
                            setSelectedRenderForPack(render);
                            setShowProductionDialog(true);
                          }}
                        >
                          <Package className="w-4 h-4 mr-1" />
                          Production Pack
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 border-purple-500/50 text-purple-400 hover:bg-purple-900/30"
                          onClick={() => handleGenerateCutFiles({
                            id: render.id,
                            mode_type: render.mode_type,
                            render_urls: render.render_urls as Record<string, string>,
                            vehicle_year: render.vehicle_year,
                            vehicle_make: render.vehicle_make,
                            vehicle_model: render.vehicle_model,
                            design_file_name: render.design_file_name,
                            color_name: render.color_name,
                          })}
                          disabled={isGeneratingCutFiles}
                        >
                          <Scissors className="w-4 h-4 mr-1" />
                          Cut Files
                        </Button>
                      </div>

                      {/* Generate 3D Proof */}
                      {render.render_urls && Object.keys(render.render_urls).length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full border-green-500/50 text-green-400 hover:bg-green-900/30"
                          onClick={() => { setProofRender(render); setShowProofSheet(true); }}
                        >
                          <ClipboardSignature className="w-4 h-4 mr-1" />
                          Generate 3D Proof Sheet
                        </Button>
                      )}

                      {/* MyVehiclePro */}
                      <MyVehicleProInline
                        colorName={render.color_name}
                        colorHex={render.color_hex}
                        finishType={render.finish_type}
                        modeType={render.mode_type}
                        vehicleYear={render.vehicle_year}
                        vehicleMake={render.vehicle_make}
                        vehicleModel={render.vehicle_model}
                        renderUrl={heroUrl as string}
                      />

                      {/* Additional Views */}
                      {render.render_urls && Object.keys(render.render_urls).length > 1 && (
                        <div className="pt-2 border-t">
                          <p className="text-xs text-muted-foreground mb-2">
                            {Object.keys(render.render_urls).length} views available
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(render.render_urls).map(([view, url]) => (
                              <Button
                                key={view}
                                variant="ghost"
                                size="sm"
                                className="text-xs"
                                onClick={() => handleDownload(
                                  url as string,
                                  `${render.vehicle_year}-${render.vehicle_make}-${render.vehicle_model}-${view}`
                                )}
                              >
                                {VIEW_LABELS[view] || view}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : !loading && email && (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground mb-4">No renders found for this email address</p>
              <p className="text-sm text-muted-foreground">
                Start creating renders with ColorPro™, FadeWraps™, RestyleLibrary™, or DesignProAI™
              </p>
            </Card>
          )}

          {!email && !loading && (
            <Card className="p-12 text-center">
              <p className="text-muted-foreground">Enter your email above to view your renders</p>
            </Card>
          )}
        </div>
      </main>

      {/* Production Pack Dialog */}
      <ProductionPackDialog
        open={showProductionDialog}
        onOpenChange={setShowProductionDialog}
        render={selectedRenderForPack ? {
          id: selectedRenderForPack.id,
          render_urls: selectedRenderForPack.render_urls as Record<string, string> | undefined,
          vehicle_year: selectedRenderForPack.vehicle_year,
          vehicle_make: selectedRenderForPack.vehicle_make,
          vehicle_model: selectedRenderForPack.vehicle_model,
          design_file_name: selectedRenderForPack.design_file_name,
          color_name: selectedRenderForPack.color_name,
          finish_type: selectedRenderForPack.finish_type,
        } : null}
      />

      {/* 3D Proof Sheet Dialog */}
      <Dialog open={showProofSheet} onOpenChange={setShowProofSheet}>
        <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
          {proofRender && (
            <ProfessionalProofSheet
              views={Object.entries(proofRender.render_urls || {}).map(([type, url]) => ({
                type,
                url: url as string,
                label: VIEW_LABELS[type] || type,
              }))}
              vehicleYear={String(proofRender.vehicle_year)}
              vehicleMake={proofRender.vehicle_make}
              vehicleModel={proofRender.vehicle_model}
              toolKey={(proofRender.mode_type === 'inkfusion' || proofRender.mode_type === 'colorpro') ? 'colorpro' : proofRender.mode_type}
              colorName={proofRender.color_name}
              finish={proofRender.finish_type}
              hex={proofRender.color_hex}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MyRenders;
