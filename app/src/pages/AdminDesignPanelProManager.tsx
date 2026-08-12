import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Trash2, Eye, EyeOff, Download, Sparkles, AlertCircle, ChevronDown, ChevronUp, Link2, ImageIcon, LayoutGrid, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { PanelUploader } from "@/components/designpanelpro/PanelUploader";
import { AdminSmartUploader } from "@/components/admin/AdminSmartUploader";
import { getRandomVehicle, formatVehicleName } from "@/lib/vehicle-selection";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const AdminDesignPanelProManager = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedPanels, setExpandedPanels] = useState<string[]>([]);

  const downloadHiRes = async (panel: any) => {
    const url = panel.production_file_url || panel.clean_display_url || panel.media_url;
    if (!url) {
      toast({ title: "No file available", description: "This panel has no hi-res file stored.", variant: "destructive" });
      return;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const ext = blob.type.includes("jpeg") ? "jpg" : "png";
      const base = (panel.ai_generated_name || panel.name || "panel").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${base}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message || "Could not download file", variant: "destructive" });
    }
  };

  const { data: panels, isLoading } = useQuery({
    queryKey: ["designpanelpro_patterns_admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("designpanelpro_patterns")
        .select("*")
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch vehicle connections for panels
  const { data: vehicleConnections } = useQuery({
    queryKey: ["vehicle_render_connections"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_render_images")
        .select("*")
        .eq("product_type", "designpanelpro")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      // Check auth session before upload
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Session expired. Please log out and log back in.");
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${id}-${Date.now()}.${fileExt}`;
      const filePath = `curated-panels/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('patterns')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('patterns')
        .getPublicUrl(filePath);

      // Update BOTH media_url and clean_display_url
      const { error: updateError } = await supabase
        .from('designpanelpro_patterns')
        .update({ 
          media_url: publicUrl,
          clean_display_url: publicUrl 
        })
        .eq('id', id);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: "Panel uploaded successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to upload: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('designpanelpro_patterns')
        .update({ is_active: isActive })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: "Panel visibility updated",
      });
    },
  });

  const toggleCuratedMutation = useMutation({
    mutationFn: async ({ id, isCurated }: { id: string; isCurated: boolean }) => {
      const { error } = await supabase
        .from('designpanelpro_patterns')
        .update({ is_curated: isCurated })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: "Panel curated status updated",
      });
    },
  });

  const uploadPanelPatternMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      // Check auth session before upload
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Session expired. Please log out and log back in.");
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${id}-pattern-${Date.now()}.${fileExt}`;
      const filePath = `panel-patterns/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('patterns')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('patterns')
        .getPublicUrl(filePath);

      // Update BOTH media_url and clean_display_url to fix display issue
      const { error: updateError } = await supabase
        .from('designpanelpro_patterns')
        .update({ 
          media_url: publicUrl,
          clean_display_url: publicUrl 
        })
        .eq('id', id);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: "Panel pattern uploaded successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to upload panel pattern: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error, count } = await supabase
        .from('designpanelpro_patterns')
        .delete()
        .eq('id', id)
        .select();

      if (error) throw error;
      return { deleted: true };
    },
    onSuccess: () => {
      // Force hard refresh of data
      queryClient.removeQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns"] });
      toast({
        title: "Deleted",
        description: "Panel removed from database",
      });
    },
    onError: (error: any) => {
      console.error("Delete error:", error);
      toast({
        title: "Delete Failed",
        description: error?.message || "Check if you have admin permissions",
        variant: "destructive",
      });
    },
  });

  const deleteVehicleConnectionMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const { error } = await supabase
        .from('vehicle_render_images')
        .delete()
        .eq('id', connectionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicle_render_connections"] });
      toast({
        title: "Success",
        description: "Vehicle connection removed successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to remove connection: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const remove2DPanelImageMutation = useMutation({
    mutationFn: async (patternId: string) => {
      const { error } = await supabase
        .from('designpanelpro_patterns')
        .update({ media_url: '' })
        .eq('id', patternId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns"] });
      toast({
        title: "Success",
        description: "2D panel design image removed successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to remove 2D design: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const togglePanelExpanded = (panelId: string) => {
    setExpandedPanels(prev => 
      prev.includes(panelId) 
        ? prev.filter(id => id !== panelId)
        : [...prev, panelId]
    );
  };

  const getPanelConnections = (panelId: string) => {
    return vehicleConnections?.filter(conn => conn.swatch_id === panelId) || [];
  };

  const handleFileSelect = (id: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadMutation.mutate({ id, file });
    }
  };

  const handlePanelPatternFileSelect = (panelId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadPanelPatternMutation.mutate({ id: panelId, file });
    }
  };

  const uploadProductionFileMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fileExt = file.name.split('.').pop();
      const fileName = `${id}-production-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('production-files')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('production-files')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('designpanelpro_patterns')
        .update({ production_file_url: publicUrl })
        .eq('id', id);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: "Production file uploaded successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to upload production file: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const handleProductionFileSelect = (panelId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadProductionFileMutation.mutate({ id: panelId, file });
    }
  };

  const upload3DPreviewMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fileExt = file.name.split('.').pop();
      const fileName = `${id}-3d-preview-${Date.now()}.${fileExt}`;
      const filePath = `3d-previews/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('patterns')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('patterns')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('designpanelpro_patterns')
        .update({ example_render_url: publicUrl })
        .eq('id', id);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: "3D preview uploaded successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to upload 3D preview: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const handle3DPreviewFileSelect = (panelId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      upload3DPreviewMutation.mutate({ id: panelId, file });
    }
  };

  // Thumbnail upload mutation - for user-facing display (separate from media_url used by AI)
  const uploadThumbnailMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Session expired. Please log out and log back in.");
      }

      const fileExt = file.name.split('.').pop();
      const fileName = `${id}-thumbnail-${Date.now()}.${fileExt}`;
      const filePath = `panel-thumbnails/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('patterns')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('patterns')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('designpanelpro_patterns')
        .update({ thumbnail_url: publicUrl })
        .eq('id', id);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: "Thumbnail uploaded - users will now see this clean image",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to upload thumbnail: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const removeThumbnailMutation = useMutation({
    mutationFn: async (patternId: string) => {
      const { error } = await supabase
        .from('designpanelpro_patterns')
        .update({ thumbnail_url: null })
        .eq('id', patternId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: "Thumbnail removed - display will fall back to media_url",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to remove thumbnail: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const handleThumbnailFileSelect = (panelId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadThumbnailMutation.mutate({ id: panelId, file });
    }
  };

  const generate3DPreviewMutation = useMutation({
    mutationFn: async ({ id, mediaUrl, panelName }: { id: string; mediaUrl: string; panelName: string }) => {
      // Randomly select vehicle from TOP_20_VEHICLES list
      const randomVehicle = getRandomVehicle();
      const vehicleName = formatVehicleName(randomVehicle);
      console.log("🚗 Generating 3D preview with random vehicle:", vehicleName);
      
      const { data, error } = await renderClient.functions.invoke('generate-color-render', {
        body: {
          vehicleYear: randomVehicle.year.toString(),
          vehicleMake: randomVehicle.make,
          vehicleModel: randomVehicle.model,
          modeType: "designpanelpro",
          viewType: "side",
          colorData: {
            panelUrl: mediaUrl,
            panelName: panelName,
            finish: "Gloss"
          }
        }
      });

      if (error) throw error;
      if (!data?.renderUrl) throw new Error("No render URL returned");

      // Update pattern with 3D preview URL
      const { error: updateError } = await supabase
        .from('designpanelpro_patterns')
        .update({ example_render_url: data.renderUrl })
        .eq('id', id);

      if (updateError) throw updateError;

      // Also save to color_visualizations for Gallery display
      const { error: galleryError } = await supabase
        .from('color_visualizations')
        .insert({
          customer_email: 'admin@restylepro.com',
          vehicle_year: parseInt(randomVehicle.year.toString()),
          vehicle_make: randomVehicle.make,
          vehicle_model: randomVehicle.model,
          color_hex: '#000000',
          color_name: panelName,
          finish_type: 'Gloss',
          mode_type: 'designpanelpro',
          custom_swatch_url: mediaUrl,
          render_urls: { front: data.renderUrl },
          generation_status: 'complete',
          is_saved: true
        });

      if (galleryError) {
        console.error('Failed to save to gallery:', galleryError);
      }

      return data.renderUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: "3D preview generated and added to Gallery!",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to generate 3D preview: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const remove3DPreviewMutation = useMutation({
    mutationFn: async (patternId: string) => {
      const { error } = await supabase
        .from('designpanelpro_patterns')
        .update({ example_render_url: null })
        .eq('id', patternId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: "3D preview removed from pattern",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to remove 3D preview: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  // Generate additional views (side, rear, top) for a panel
  const [generatingViewsForPanel, setGeneratingViewsForPanel] = useState<string | null>(null);
  
  const generateAdditionalViewsMutation = useMutation({
    mutationFn: async ({ panelId, mediaUrl, panelName }: { panelId: string; mediaUrl: string; panelName: string }) => {
      setGeneratingViewsForPanel(panelId);
      
      const randomVehicle = getRandomVehicle();
      const additionalViews = ['side', 'rear', 'top'];
      const viewUrls: Record<string, string> = {};
      
      // Generate each additional view
      for (const viewType of additionalViews) {
        console.log(`🚗 Generating ${viewType} view for ${panelName}...`);
        const { data, error } = await renderClient.functions.invoke('generate-color-render', {
          body: {
            vehicleYear: randomVehicle.year.toString(),
            vehicleMake: randomVehicle.make,
            vehicleModel: randomVehicle.model,
            modeType: "designpanelpro",
            viewType: viewType,
            colorData: {
              panelUrl: mediaUrl,
              panelName: panelName,
              finish: "Gloss"
            }
          }
        });

        if (error) throw error;
        if (data?.renderUrl) {
          viewUrls[viewType] = data.renderUrl;
        }
      }

      // Find existing gallery entry for this pattern to update with additional views
      const { data: existingEntry } = await supabase
        .from('color_visualizations')
        .select('id, render_urls')
        .eq('customer_email', 'admin@restylepro.com')
        .eq('mode_type', 'designpanelpro')
        .eq('color_name', panelName)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingEntry) {
        const existingUrls = (existingEntry.render_urls as Record<string, string>) || {};
        const mergedUrls = { ...existingUrls, ...viewUrls };
        
        await supabase
          .from('color_visualizations')
          .update({ render_urls: mergedUrls })
          .eq('id', existingEntry.id);
      }

      return viewUrls;
    },
    onSuccess: (viewUrls) => {
      setGeneratingViewsForPanel(null);
      queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
      toast({
        title: "Success",
        description: `Generated ${Object.keys(viewUrls).length} additional views and saved to Gallery!`,
      });
    },
    onError: (error) => {
      setGeneratingViewsForPanel(null);
      toast({
        title: "Error",
        description: `Failed to generate views: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-8">
        <p>Loading panels...</p>
      </div>
    );
  }

  const curatedPanels = panels?.filter(p => p.is_curated) || [];
  const customPanels = panels?.filter(p => !p.is_curated) || [];

  return (
    <div className="container mx-auto p-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => navigate("/admin")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Admin
          </Button>
          <div>
            <h1 className="text-3xl font-bold">RestyleLibrary™ / DesignProAI™ Manager</h1>
            <p className="text-muted-foreground mt-1">
              Manage custom vinyl panel designs with AI naming and auto 3D generation
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/admin/bulk-design")}
            className="text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
          >
            <Zap className="w-4 h-4 mr-2" />
            Bulk DesignProAI Generator
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/admin/panel-library-generator")}
            className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
          >
            <LayoutGrid className="w-4 h-4 mr-2" />
            Flat Panel Library Generator
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/admin/production-packs")}
            className="text-blue-400 border-blue-500/30 hover:bg-blue-500/10"
          >
            <Download className="w-4 h-4 mr-2" />
            Production Packs Manager
          </Button>
        </div>
      </div>

      {/* Upload New Panel Section */}
      <div className="mb-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <AdminSmartUploader
            productType="designpanelpro"
            onUploadComplete={() => {
              queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
            }}
          />
          <PanelUploader 
            onPanelUploaded={() => {
              queryClient.invalidateQueries({ queryKey: ["designpanelpro_patterns_admin"] });
            }} 
          />
        </div>
      </div>

      {/* Curated Panels Section */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">Curated Panels ({curatedPanels.length})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {curatedPanels.map((panel) => (
            <Card key={panel.id} className="p-4">
              <div className="space-y-4">
                <div className="relative bg-black rounded-lg" style={{ aspectRatio: '16 / 9' }}>
                  {panel.media_url && panel.media_url.includes('supabase') ? (
                    <img
                      src={panel.clean_display_url || panel.media_url}
                      alt={panel.name}
                      className="w-full h-full object-contain rounded-lg"
                    />
                  ) : (
                    <div className="w-full h-full bg-secondary rounded-lg flex items-center justify-center">
                      <p className="text-sm text-muted-foreground">No image uploaded</p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{panel.ai_generated_name || panel.name}</h3>
                    {!panel.example_render_url && (
                      <div className="flex items-center gap-1 bg-amber-500/20 text-amber-500 px-2 py-1 rounded text-xs">
                        <AlertCircle className="w-3 h-3" />
                        <span>No 3D Preview</span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">186" × 56"</p>
                  {panel.production_file_url && (
                    <div className="flex items-center gap-1 mt-1">
                      <Download className="w-3 h-3 text-green-500" />
                      <span className="text-xs text-green-500 font-medium">Production Files Attached</span>
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => downloadHiRes(panel)}
                    disabled={!panel.media_url && !panel.production_file_url && !panel.clean_display_url}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download Hi-Res
                  </Button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`active-${panel.id}`} className="text-xs">Visible</Label>
                    <Switch
                      id={`active-${panel.id}`}
                      checked={panel.is_active}
                      onCheckedChange={(checked) =>
                        toggleActiveMutation.mutate({ id: panel.id, isActive: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`curated-${panel.id}`} className="text-xs">Curated</Label>
                    <Switch
                      id={`curated-${panel.id}`}
                      checked={panel.is_curated}
                      onCheckedChange={(checked) =>
                        toggleCuratedMutation.mutate({ id: panel.id, isCurated: checked })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  {/* User-Facing Thumbnail Section */}
                  <div className="border border-green-500/30 rounded-lg p-3 bg-green-500/10">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-green-400">
                        <ImageIcon className="w-3 h-3 inline mr-1" />
                        User-Facing Thumbnail
                      </p>
                      {panel.thumbnail_url && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-950/20"
                          onClick={() => {
                            if (confirm('Remove thumbnail? Display will fall back to media_url.')) {
                              removeThumbnailMutation.mutate(panel.id);
                            }
                          }}
                          disabled={removeThumbnailMutation.isPending}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    {panel.thumbnail_url ? (
                      <div className="mb-2 rounded border border-green-500/30 overflow-hidden">
                        <img src={panel.thumbnail_url} alt="Thumbnail" className="w-full h-20 object-cover" />
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground mb-2">No thumbnail set - showing media_url to users</p>
                    )}
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleThumbnailFileSelect(panel.id, e)}
                      className="hidden"
                      id={`thumbnail-${panel.id}`}
                    />
                    <Label htmlFor={`thumbnail-${panel.id}`}>
                      <Button 
                        variant={panel.thumbnail_url ? "outline" : "default"} 
                        className={`w-full ${!panel.thumbnail_url ? 'bg-green-600 hover:bg-green-700' : ''}`}
                        asChild
                      >
                        <span>
                          <Upload className="w-4 h-4 mr-2" />
                          {panel.thumbnail_url ? 'Replace Thumbnail' : 'Upload Clean Thumbnail'}
                        </span>
                      </Button>
                    </Label>
                  </div>

                  {/* 3D Render Preview Section */}
                  <div className="border border-blue-500/30 rounded-lg p-3 bg-blue-500/10">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-blue-400">
                        <Sparkles className="w-3 h-3 inline mr-1" />
                        3D Render Preview
                      </p>
                      {panel.example_render_url && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-950/20"
                          onClick={() => {
                            if (confirm('Remove 3D preview?')) {
                              remove3DPreviewMutation.mutate(panel.id);
                            }
                          }}
                          disabled={remove3DPreviewMutation.isPending}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                    {panel.example_render_url ? (
                      <div className="mb-2 rounded border border-blue-500/30 overflow-hidden">
                        <img src={panel.example_render_url} alt="3D Preview" className="w-full h-24 object-cover" />
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground mb-2">No 3D preview - generate or upload one</p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        className="flex-1 bg-gradient-to-r from-primary to-blue-500"
                        onClick={() => {
                          if (!panel.media_url) {
                            toast({
                              title: "Error",
                              description: "Panel must have a 2D design image to generate 3D render",
                              variant: "destructive"
                            });
                            return;
                          }
                          generate3DPreviewMutation.mutate({
                            id: panel.id,
                            mediaUrl: panel.media_url,
                            panelName: panel.ai_generated_name || panel.name
                          });
                        }}
                        disabled={generate3DPreviewMutation.isPending}
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        {generate3DPreviewMutation.isPending ? 'Generating...' : 'AI Generate'}
                      </Button>
                      <div className="flex-1">
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handle3DPreviewFileSelect(panel.id, e)}
                          className="hidden"
                          id={`3d-preview-${panel.id}`}
                        />
                        <Label htmlFor={`3d-preview-${panel.id}`}>
                          <Button 
                            variant="outline"
                            className="w-full" 
                            asChild
                          >
                            <span>
                              <Upload className="w-4 h-4 mr-2" />
                              Upload 3D
                            </span>
                          </Button>
                        </Label>
                      </div>
                    </div>
                    {/* Generate All Views Button - only show if 3D preview exists */}
                    {panel.example_render_url && (
                      <Button
                        variant="outline"
                        className="w-full mt-2 border-blue-500/50 text-blue-400 hover:bg-blue-500/20"
                        onClick={() => {
                          if (!panel.media_url) {
                            toast({
                              title: "Error",
                              description: "Panel must have a 2D design image",
                              variant: "destructive"
                            });
                            return;
                          }
                          generateAdditionalViewsMutation.mutate({
                            panelId: panel.id,
                            mediaUrl: panel.media_url,
                            panelName: panel.ai_generated_name || panel.name
                          });
                        }}
                        disabled={generatingViewsForPanel === panel.id}
                      >
                        <Sparkles className="w-4 h-4 mr-2" />
                        {generatingViewsForPanel === panel.id ? 'Generating Views...' : 'Generate All Views (Side, Rear, Top)'}
                      </Button>
                    )}
                  </div>
                  
                  {/* 2D Panel Design Section */}
                  <div className="border border-border rounded-lg p-3 bg-secondary/20">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-purple-400">2D Panel Design Image</p>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-950/20"
                        onClick={() => {
                          if (confirm('Remove 2D panel design image?')) {
                            remove2DPanelImageMutation.mutate(panel.id);
                          }
                        }}
                        disabled={!panel.media_url || remove2DPanelImageMutation.isPending}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={(e) => handlePanelPatternFileSelect(panel.id, e)}
                          className="hidden"
                          id={`pattern-file-${panel.id}`}
                        />
                        <Label htmlFor={`pattern-file-${panel.id}`}>
                          <Button variant="secondary" className="w-full" asChild>
                            <span>
                              <Upload className="w-4 h-4 mr-2" />
                              Upload 2D Design
                            </span>
                          </Button>
                        </Label>
                      </div>
                    </div>
                  </div>

                  {/* Production Files Section */}
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Input
                        type="file"
                        accept=".zip,.ai,.eps,.pdf"
                        onChange={(e) => handleProductionFileSelect(panel.id, e)}
                        className="hidden"
                        id={`production-file-${panel.id}`}
                      />
                      <Label htmlFor={`production-file-${panel.id}`}>
                        <Button 
                          variant={panel.production_file_url ? "default" : "outline"} 
                          className="w-full" 
                          asChild
                        >
                          <span>
                            <Download className="w-4 h-4 mr-2" />
                            {panel.production_file_url ? 'Update Production Files' : 'Upload Production Files'}
                          </span>
                        </Button>
                      </Label>
                    </div>
                  </div>

                  {/* Vehicle Connections Section */}
                  <Collapsible 
                    open={expandedPanels.includes(panel.id)}
                    onOpenChange={() => togglePanelExpanded(panel.id)}
                  >
                    <CollapsibleTrigger asChild>
                      <Button 
                        variant="ghost" 
                        className="w-full flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2">
                          <Link2 className="w-4 h-4" />
                          <span className="text-sm">
                            Vehicle Connections ({getPanelConnections(panel.id).length})
                          </span>
                        </div>
                        {expandedPanels.includes(panel.id) ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 space-y-2 p-3 bg-secondary/20 rounded-lg border border-border">
                        {getPanelConnections(panel.id).length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-2">
                            No vehicle connections
                          </p>
                        ) : (
                          getPanelConnections(panel.id).map((connection) => (
                            <div 
                              key={connection.id}
                              className="flex items-center justify-between p-2 bg-card rounded border border-border"
                            >
                              <div className="flex-1">
                                <p className="text-xs font-medium">
                                  {connection.vehicle_year} {connection.vehicle_make} {connection.vehicle_model}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {connection.vehicle_type}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm(`Remove this vehicle connection?`)) {
                                    deleteVehicleConnectionMutation.mutate(connection.id);
                                  }
                                }}
                                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Custom Panels Section */}
      {customPanels.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold mb-4">Custom Panels ({customPanels.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customPanels.map((panel) => (
              <Card key={panel.id} className="p-4">
                <div className="space-y-4">
                  <div className="relative bg-black rounded-lg" style={{ aspectRatio: '16 / 9' }}>
                    <img
                      src={panel.thumbnail_url || panel.clean_display_url || panel.media_url}
                      alt={panel.name}
                      className="w-full h-full object-contain rounded-lg"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{panel.ai_generated_name || panel.name}</h3>
                      {!panel.example_render_url && (
                        <div className="flex items-center gap-1 bg-amber-500/20 text-amber-500 px-2 py-1 rounded text-xs">
                          <AlertCircle className="w-3 h-3" />
                          <span>No 3D Preview</span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">Custom Upload</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      onClick={() => downloadHiRes(panel)}
                      disabled={!panel.media_url && !panel.production_file_url && !panel.clean_display_url}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Download Hi-Res
                    </Button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`active-custom-${panel.id}`} className="text-xs">Visible</Label>
                      <Switch
                        id={`active-custom-${panel.id}`}
                        checked={panel.is_active}
                        onCheckedChange={(checked) =>
                          toggleActiveMutation.mutate({ id: panel.id, isActive: checked })
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`curated-custom-${panel.id}`} className="text-xs">Curated</Label>
                      <Switch
                        id={`curated-custom-${panel.id}`}
                        checked={panel.is_curated}
                        onCheckedChange={(checked) =>
                          toggleCuratedMutation.mutate({ id: panel.id, isCurated: checked })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    {/* User-Facing Thumbnail Section */}
                    <div className="border border-green-500/30 rounded-lg p-3 bg-green-500/10">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-green-400">
                          <ImageIcon className="w-3 h-3 inline mr-1" />
                          User-Facing Thumbnail
                        </p>
                        {panel.thumbnail_url && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-950/20"
                            onClick={() => {
                              if (confirm('Remove thumbnail? Display will fall back to media_url.')) {
                                removeThumbnailMutation.mutate(panel.id);
                              }
                            }}
                            disabled={removeThumbnailMutation.isPending}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      {panel.thumbnail_url ? (
                        <div className="mb-2 rounded border border-green-500/30 overflow-hidden">
                          <img src={panel.thumbnail_url} alt="Thumbnail" className="w-full h-20 object-cover" />
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground mb-2">No thumbnail set - showing media_url to users</p>
                      )}
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleThumbnailFileSelect(panel.id, e)}
                        className="hidden"
                        id={`thumbnail-custom-${panel.id}`}
                      />
                      <Label htmlFor={`thumbnail-custom-${panel.id}`}>
                        <Button 
                          variant={panel.thumbnail_url ? "outline" : "default"} 
                          className={`w-full ${!panel.thumbnail_url ? 'bg-green-600 hover:bg-green-700' : ''}`}
                          asChild
                        >
                          <span>
                            <Upload className="w-4 h-4 mr-2" />
                            {panel.thumbnail_url ? 'Replace Thumbnail' : 'Upload Clean Thumbnail'}
                          </span>
                        </Button>
                      </Label>
                    </div>

                    {/* 3D Render Preview Section */}
                    <div className="border border-blue-500/30 rounded-lg p-3 bg-blue-500/10">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-blue-400">
                          <Sparkles className="w-3 h-3 inline mr-1" />
                          3D Render Preview
                        </p>
                        {panel.example_render_url && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-950/20"
                            onClick={() => {
                              if (confirm('Remove 3D preview?')) {
                                remove3DPreviewMutation.mutate(panel.id);
                              }
                            }}
                            disabled={remove3DPreviewMutation.isPending}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                      {panel.example_render_url ? (
                        <div className="mb-2 rounded border border-blue-500/30 overflow-hidden">
                          <img src={panel.example_render_url} alt="3D Preview" className="w-full h-24 object-cover" />
                        </div>
                      ) : (
                        <p className="text-[10px] text-muted-foreground mb-2">No 3D preview - generate or upload one</p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="default"
                          className="flex-1 bg-gradient-to-r from-primary to-blue-500"
                          onClick={() => {
                            if (!panel.media_url) {
                              toast({
                                title: "Error",
                                description: "Panel must have a 2D design image to generate 3D render",
                                variant: "destructive"
                              });
                              return;
                            }
                            generate3DPreviewMutation.mutate({
                              id: panel.id,
                              mediaUrl: panel.media_url,
                              panelName: panel.ai_generated_name || panel.name
                            });
                          }}
                          disabled={generate3DPreviewMutation.isPending}
                        >
                          <Sparkles className="w-4 h-4 mr-2" />
                          {generate3DPreviewMutation.isPending ? 'Generating...' : 'AI Generate'}
                        </Button>
                        <div className="flex-1">
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handle3DPreviewFileSelect(panel.id, e)}
                            className="hidden"
                            id={`3d-preview-custom-${panel.id}`}
                          />
                          <Label htmlFor={`3d-preview-custom-${panel.id}`}>
                            <Button 
                              variant="outline"
                              className="w-full" 
                              asChild
                            >
                              <span>
                                <Upload className="w-4 h-4 mr-2" />
                                Upload 3D
                              </span>
                            </Button>
                          </Label>
                        </div>
                      </div>
                    </div>
                    
                    {/* 2D Panel Design Section */}
                    <div className="border border-border rounded-lg p-3 bg-secondary/20">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-purple-400">2D Panel Design Image</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-red-950/20"
                          onClick={() => {
                            if (confirm('Remove 2D panel design image?')) {
                              remove2DPanelImageMutation.mutate(panel.id);
                            }
                          }}
                          disabled={!panel.media_url || remove2DPanelImageMutation.isPending}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handlePanelPatternFileSelect(panel.id, e)}
                            className="hidden"
                            id={`pattern-file-custom-${panel.id}`}
                          />
                          <Label htmlFor={`pattern-file-custom-${panel.id}`}>
                            <Button variant="secondary" className="w-full" asChild>
                              <span>
                                <Upload className="w-4 h-4 mr-2" />
                                Upload 2D Design
                              </span>
                            </Button>
                          </Label>
                        </div>
                      </div>
                    </div>

                    {/* Production Files Section */}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Input
                          type="file"
                          accept=".zip,.ai,.eps,.pdf"
                          onChange={(e) => handleProductionFileSelect(panel.id, e)}
                          className="hidden"
                          id={`production-file-custom-${panel.id}`}
                        />
                        <Label htmlFor={`production-file-custom-${panel.id}`}>
                          <Button 
                            variant={panel.production_file_url ? "default" : "outline"} 
                            className="w-full" 
                            asChild
                          >
                            <span>
                              <Download className="w-4 h-4 mr-2" />
                              {panel.production_file_url ? 'Update Production Files' : 'Upload Production Files'}
                            </span>
                          </Button>
                        </Label>
                      </div>
                    </div>

                    {/* Vehicle Connections Section */}
                    <Collapsible 
                      open={expandedPanels.includes(panel.id)}
                      onOpenChange={() => togglePanelExpanded(panel.id)}
                    >
                      <CollapsibleTrigger asChild>
                        <Button 
                          variant="ghost" 
                          className="w-full flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <Link2 className="w-4 h-4" />
                            <span className="text-sm">
                              Vehicle Connections ({getPanelConnections(panel.id).length})
                            </span>
                          </div>
                          {expandedPanels.includes(panel.id) ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-2 space-y-2 p-3 bg-secondary/20 rounded-lg border border-border">
                          {getPanelConnections(panel.id).length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-2">
                              No vehicle connections
                            </p>
                          ) : (
                            getPanelConnections(panel.id).map((connection) => (
                              <div 
                                key={connection.id}
                                className="flex items-center justify-between p-2 bg-card rounded border border-border"
                              >
                                <div className="flex-1">
                                  <p className="text-xs font-medium">
                                    {connection.vehicle_year} {connection.vehicle_make} {connection.vehicle_model}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {connection.vehicle_type}
                                  </p>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (confirm(`Remove this vehicle connection?`)) {
                                      deleteVehicleConnectionMutation.mutate(connection.id);
                                    }
                                  }}
                                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {panels?.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">No panels found. Upload some panels to get started.</p>
        </Card>
      )}
    </div>
  );
};

export default AdminDesignPanelProManager;
