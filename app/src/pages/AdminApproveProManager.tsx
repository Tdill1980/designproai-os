import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Trash2, Upload, Loader2, Image, Star, Eye, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { AdminSmartUploader } from "@/components/admin/AdminSmartUploader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent } from "@/components/ui/dialog";

// View order for consistent display - matches locked VIEW_ORDER from view-angles-os.ts
const VIEW_ORDER = ['side', 'passenger-side', 'hood_detail', 'rear', 'close-up', 'roof'];
const VIEW_LABELS: Record<string, string> = {
  side: 'Driver Side',
  'driver-side': 'Driver Side',
  'passenger-side': 'Passenger',
  hood_detail: 'Hood',
  rear: 'Rear',
  roof: 'Roof',
  front: 'Front',
  'close-up': 'Close-Up',
  hero: 'Hero',
};

const AdminApproveProManager = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Carousel upload state
  const [beforeFile, setBeforeFile] = useState<File | null>(null);
  const [afterFile, setAfterFile] = useState<File | null>(null);
  const [beforePreview, setBeforePreview] = useState<string | null>(null);
  const [afterPreview, setAfterPreview] = useState<string | null>(null);
  const [vehicleName, setVehicleName] = useState("");
  const [designName, setDesignName] = useState("");
  const [isUploadingCarousel, setIsUploadingCarousel] = useState(false);
  const [showLivePreview, setShowLivePreview] = useState(false);
  
  // Modal state for viewing full render
  const [selectedRender, setSelectedRender] = useState<{ url: string; label: string } | null>(null);

  // Design proof upload state
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofName, setProofName] = useState("");
  const [proofDescription, setProofDescription] = useState("");
  const [isUploadingProof, setIsUploadingProof] = useState(false);

  // Fetch examples
  const { data: examples, isLoading: examplesLoading } = useQuery({
    queryKey: ["approvemode_examples_admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approvemode_examples")
        .select("*")
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch carousel items
  const { data: carouselItems, isLoading: carouselLoading } = useQuery({
    queryKey: ["approvemode_carousel_admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approvemode_carousel")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch past renders from color_visualizations
  const { data: pastRenders, isLoading: pastRendersLoading } = useQuery({
    queryKey: ["approvemode_past_renders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("*")
        .eq("mode_type", "approvemode")
        .order("created_at", { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data;
    },
  });

  // Approve → Build Print Files: runs the pixel-exact panel chain on this
  // design (clean background layer preferred) and registers the result as a
  // production job on /admin/production-files. Test path for the future
  // automatic on-approval trigger; fallback for ApprovePro's broken file maker.
  const approveBuildMutation = useMutation({
    mutationFn: async (render: any) => {
      let layers: any = {};
      try { layers = typeof render.admin_notes === "string" ? JSON.parse(render.admin_notes) : (render.admin_notes || {}); } catch { layers = {}; }
      const views = (render.render_urls && typeof render.render_urls === "object") ? render.render_urls : {};
      const designUrl = layers.layer_background_url || render.custom_design_url || "";
      if (!Object.keys(views).length && !designUrl) throw new Error("No approved views or design file on this render");
      const { data, error } = await renderClient.functions.invoke("panel-artboard-generator", {
        body: {
          step: "production", views, designUrl,
          vehicleMake: render.vehicle_make, vehicleModel: render.vehicle_model,
          vehicleYear: String(render.vehicle_year || ""), bodyType: "truck",
          finish: render.finish_type || "gloss", bleedInches: 2,
          userId: (await supabase.auth.getUser()).data.user?.id,
          orderLabel: `${render.color_name || "ApprovePro design"} — APPROVED`,
        },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || "failed to start");
      return data.productionJobId;
    },
    onSuccess: () => {
      toast({ title: "Approved — production build started", description: "Panels build server-side and appear on /admin/production-files over the next few minutes." });
    },
    onError: (e: any) => toast({ title: "Build failed", description: e?.message || String(e), variant: "destructive" }),
  });

  const deleteExampleMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('approvemode_examples')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvemode_examples_admin"] });
      toast({ title: "Success", description: "Example deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to delete: ${error.message}`, variant: "destructive" });
    },
  });

  const deleteCarouselMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('approvemode_carousel')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvemode_carousel_admin"] });
      toast({ title: "Success", description: "Carousel item deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to delete: ${error.message}`, variant: "destructive" });
    },
  });

  const deleteVisualizationMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('color_visualizations')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvemode_past_renders"] });
      toast({ title: "Success", description: "Render deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to delete: ${error.message}`, variant: "destructive" });
    },
  });

  const promoteToCarouselMutation = useMutation({
    mutationFn: async (render: any) => {
      const renderUrls = render.render_urls as Record<string, string> | null;
      const heroUrl = renderUrls?.hero || renderUrls?.front || Object.values(renderUrls || {})[0];
      
      if (!heroUrl) throw new Error("No render URL available");

      const { error } = await supabase
        .from('approvemode_carousel')
        .insert({
          name: `${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`,
          media_url: heroUrl,
          before_url: render.custom_design_url || '',
          vehicle_name: `${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`,
          color_name: render.design_file_name || 'Custom Design',
          title: `${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`,
          subtitle: 'ApprovePro™',
          is_active: true
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvemode_carousel_admin"] });
      toast({ title: "Success", description: "Promoted to carousel!" });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to promote: ${error.message}`, variant: "destructive" });
    },
  });

  // Fetch design proofs
  const { data: designProofs, isLoading: designProofsLoading } = useQuery({
    queryKey: ["approvemode_design_proofs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approvemode_examples")
        .select("*")
        .eq("description", "design-proof")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const deleteDesignProofMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('approvemode_examples')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvemode_design_proofs"] });
      toast({ title: "Success", description: "Design proof deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Error", description: `Failed to delete: ${error.message}`, variant: "destructive" });
    },
  });

  const handleProofFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProofFile(file);
      setProofPreview(URL.createObjectURL(file));
    }
  };

  const handleProofUpload = async () => {
    if (!proofFile || !proofName) {
      toast({ title: "Missing fields", description: "Please upload an image and enter a name", variant: "destructive" });
      return;
    }

    setIsUploadingProof(true);
    try {
      const ext = proofFile.name.split('.').pop();
      const filePath = `approvemode/proof-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('before-after')
        .upload(filePath, proofFile);
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('before-after')
        .getPublicUrl(filePath);

      const { error: dbError } = await supabase
        .from('approvemode_examples')
        .insert({
          name: proofName,
          description: "design-proof",
          before_url: publicUrl,
          after_url: publicUrl,
          is_active: true,
        });

      if (dbError) throw dbError;

      toast({ title: "Success", description: "Design proof uploaded" });
      queryClient.invalidateQueries({ queryKey: ["approvemode_design_proofs"] });

      setProofFile(null);
      setProofPreview(null);
      setProofName("");
      setProofDescription("");
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploadingProof(false);
    }
  };

  const handleBeforeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setBeforeFile(file);
      setBeforePreview(URL.createObjectURL(file));
    }
  };

  const handleAfterFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAfterFile(file);
      setAfterPreview(URL.createObjectURL(file));
    }
  };

  const handleCarouselUpload = async () => {
    if (!beforeFile || !afterFile || !vehicleName) {
      toast({ title: "Missing fields", description: "Please upload both images and enter vehicle name", variant: "destructive" });
      return;
    }

    setIsUploadingCarousel(true);
    try {
      // Upload before image
      const beforeExt = beforeFile.name.split('.').pop();
      const beforePath = `approvemode/before-${crypto.randomUUID()}.${beforeExt}`;
      const { error: beforeError } = await supabase.storage
        .from('before-after')
        .upload(beforePath, beforeFile);
      if (beforeError) throw beforeError;

      const { data: { publicUrl: beforeUrl } } = supabase.storage
        .from('before-after')
        .getPublicUrl(beforePath);

      // Upload after image
      const afterExt = afterFile.name.split('.').pop();
      const afterPath = `approvemode/after-${crypto.randomUUID()}.${afterExt}`;
      const { error: afterError } = await supabase.storage
        .from('before-after')
        .upload(afterPath, afterFile);
      if (afterError) throw afterError;

      const { data: { publicUrl: afterUrl } } = supabase.storage
        .from('before-after')
        .getPublicUrl(afterPath);

      // Save to carousel table
      const { error: dbError } = await supabase
        .from('approvemode_carousel')
        .insert({
          name: `${vehicleName} - ${designName || 'Custom Design'}`,
          media_url: afterUrl,
          before_url: beforeUrl,
          vehicle_name: vehicleName,
          color_name: designName || 'Custom Design',
          title: vehicleName,
          subtitle: designName || 'ApprovePro™',
          is_active: true
        });

      if (dbError) throw dbError;

      toast({ title: "Success", description: "Before/After uploaded to carousel" });
      queryClient.invalidateQueries({ queryKey: ["approvemode_carousel_admin"] });
      
      // Reset form
      setBeforeFile(null);
      setAfterFile(null);
      setBeforePreview(null);
      setAfterPreview(null);
      setVehicleName("");
      setDesignName("");
      setShowLivePreview(false);
    } catch (error: any) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploadingCarousel(false);
    }
  };

  // Helper to get sorted views from render_urls
  const getSortedViews = (renderUrls: Record<string, string> | null) => {
    if (!renderUrls) return [];
    
    const views = Object.entries(renderUrls).map(([type, url]) => ({
      type,
      url,
      label: VIEW_LABELS[type] || type
    }));

    return views.sort((a, b) => {
      const aIndex = VIEW_ORDER.indexOf(a.type);
      const bIndex = VIEW_ORDER.indexOf(b.type);
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    });
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <Button onClick={() => navigate("/admin")} variant="outline" className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Button>

        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">ApprovePro™ Manager</h1>
          <p className="text-muted-foreground">Upload and manage 2D-to-3D client approval proof examples</p>
        </div>

        <Tabs defaultValue="past-renders" className="space-y-6">
          <TabsList>
            <TabsTrigger value="past-renders">Past Renders</TabsTrigger>
            <TabsTrigger value="carousel">Carousel (Before/After)</TabsTrigger>
            <TabsTrigger value="design-proofs">Design Proofs</TabsTrigger>
            <TabsTrigger value="examples">Examples</TabsTrigger>
          </TabsList>

          {/* Past Renders Tab */}
          <TabsContent value="past-renders" className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Past ApprovePro™ Renders</h2>
                <p className="text-sm text-muted-foreground">
                  View all generated proofs with original 2D designs and multi-view 3D renders
                </p>
              </div>
              <span className="text-sm text-muted-foreground">
                {pastRenders?.length || 0} renders
              </span>
            </div>

            {pastRendersLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin mr-2" />
                <span className="text-muted-foreground">Loading past renders...</span>
              </div>
            ) : pastRenders?.length === 0 ? (
              <Card className="p-12 text-center">
                <p className="text-muted-foreground">No ApprovePro renders found yet.</p>
              </Card>
            ) : (
              <div className="space-y-6">
                {pastRenders?.map((render) => {
                  const renderUrls = render.render_urls as Record<string, string> | null;
                  const sortedViews = getSortedViews(renderUrls);
                  const vehicleInfo = `${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`;

                  return (
                    <Card key={render.id} className="overflow-hidden">
                      {/* Header */}
                      <div className="bg-muted/50 px-4 py-3 border-b border-border flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-lg">{vehicleInfo}</h3>
                          <p className="text-sm text-muted-foreground">
                            Design: {render.design_file_name || 'Custom Design'} • 
                            Created: {new Date(render.created_at || '').toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => approveBuildMutation.mutate(render)}
                            disabled={approveBuildMutation.isPending}
                            className="bg-gradient-to-r from-blue-500 to-pink-500 text-white hover:opacity-90"
                          >
                            {approveBuildMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
                            Approve → Build Print Files
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => promoteToCarouselMutation.mutate(render)}
                            disabled={promoteToCarouselMutation.isPending}
                          >
                            <Star className="w-4 h-4 mr-1" />
                            Promote
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteVisualizationMutation.mutate(render.id)}
                            disabled={deleteVisualizationMutation.isPending}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Content - 2D Proof + 3D Views */}
                      <div className="p-4">
                        <div className="grid lg:grid-cols-[300px_1fr] gap-6">
                          {/* Left: 2D Design Proof */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="bg-blue-500/20 text-blue-400 text-xs font-bold px-2 py-1 rounded">
                                ORIGINAL 2D PROOF
                              </span>
                            </div>
                            {render.custom_design_url ? (
                              <div 
                                className="relative aspect-video bg-muted rounded-lg overflow-hidden border-2 border-blue-500/30 cursor-pointer hover:border-blue-500/60 transition-colors"
                                onClick={() => setSelectedRender({ url: render.custom_design_url!, label: '2D Design Proof' })}
                              >
                                <img
                                  src={render.custom_design_url}
                                  alt="2D Design Proof"
                                  className="w-full h-full object-contain"
                                />
                                <div className="absolute top-2 right-2">
                                  <Eye className="w-5 h-5 text-white drop-shadow-lg" />
                                </div>
                              </div>
                            ) : (
                              <div className="aspect-video bg-muted rounded-lg flex items-center justify-center border-2 border-dashed border-border">
                                <p className="text-sm text-muted-foreground">No 2D proof uploaded</p>
                              </div>
                            )}
                          </div>

                          {/* Right: 3D Render Views */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="bg-primary/20 text-primary text-xs font-bold px-2 py-1 rounded">
                                3D RENDER VIEWS
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {sortedViews.length} view{sortedViews.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            
                            {sortedViews.length > 0 ? (
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                {sortedViews.map((view) => (
                                  <div 
                                    key={view.type}
                                    className="relative aspect-video bg-muted rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary transition-all"
                                    onClick={() => setSelectedRender({ url: view.url, label: view.label })}
                                  >
                                    <img
                                      src={view.url}
                                      alt={view.label}
                                      className="w-full h-full object-cover"
                                    />
                                    <span className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
                                      {view.label}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="bg-muted rounded-lg p-8 text-center border-2 border-dashed border-border">
                                <p className="text-sm text-muted-foreground">No 3D renders generated yet</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Carousel Tab */}
          <TabsContent value="carousel" className="space-y-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Upload Before & After Images</h3>
              <div className="grid md:grid-cols-2 gap-6">
                {/* Before Upload */}
                <div className="space-y-3">
                  <Label>Before (2D Design Proof)</Label>
                  <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleBeforeFileChange}
                      className="hidden"
                      id="before-upload"
                    />
                    <Label htmlFor="before-upload" className="cursor-pointer">
                      {beforePreview ? (
                        <img src={beforePreview} alt="Before" className="w-full aspect-video object-contain rounded" />
                      ) : (
                        <div className="py-8 space-y-2">
                          <Image className="w-10 h-10 mx-auto text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">Click to upload 2D proof</p>
                        </div>
                      )}
                    </Label>
                  </div>
                </div>

                {/* After Upload */}
                <div className="space-y-3">
                  <Label>After (3D Render)</Label>
                  <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleAfterFileChange}
                      className="hidden"
                      id="after-upload"
                    />
                    <Label htmlFor="after-upload" className="cursor-pointer">
                      {afterPreview ? (
                        <img src={afterPreview} alt="After" className="w-full aspect-video object-contain rounded" />
                      ) : (
                        <div className="py-8 space-y-2">
                          <Image className="w-10 h-10 mx-auto text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">Click to upload 3D render</p>
                        </div>
                      )}
                    </Label>
                  </div>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div className="space-y-2">
                  <Label>Vehicle Name *</Label>
                  <Input
                    placeholder="e.g., 2024 Ford Mustang"
                    value={vehicleName}
                    onChange={(e) => setVehicleName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Design Name</Label>
                  <Input
                    placeholder="e.g., Custom Wrap Design"
                    value={designName}
                    onChange={(e) => setDesignName(e.target.value)}
                  />
                </div>
              </div>

              {/* Live Preview Toggle */}
              {beforePreview && afterPreview && (
                <div className="mt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold">Preview How It Will Display</Label>
                    <Button
                      variant={showLivePreview ? "default" : "outline"}
                      size="sm"
                      onClick={() => setShowLivePreview(!showLivePreview)}
                    >
                      {showLivePreview ? "Hide Preview" : "Show Preview"}
                    </Button>
                  </div>
                  
                  {showLivePreview && (
                    <Card className="p-4 bg-background border-2 border-primary/30">
                      <p className="text-sm text-muted-foreground mb-3 text-center">
                        This is how your before/after will appear on the site:
                      </p>
                      <div className="grid grid-cols-2 gap-1 aspect-video rounded-lg overflow-hidden border border-border">
                        <div className="relative">
                          <img 
                            src={beforePreview} 
                            alt="Before Preview" 
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-2 left-2 bg-black/80 text-white text-xs px-2 py-1 rounded font-semibold">
                            Before
                          </span>
                        </div>
                        <div className="relative">
                          <img 
                            src={afterPreview} 
                            alt="After Preview" 
                            className="w-full h-full object-cover"
                          />
                          <span className="absolute bottom-2 right-2 bg-primary/80 text-white text-xs px-2 py-1 rounded font-semibold">
                            After
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-center mt-3 text-amber-500 font-medium">
                        ⚠️ Verify: 2D Design Proof should be on LEFT (Before), 3D Render should be on RIGHT (After)
                      </p>
                    </Card>
                  )}
                </div>
              )}

              <Button
                onClick={handleCarouselUpload}
                disabled={isUploadingCarousel || !beforeFile || !afterFile || !vehicleName}
                className="w-full mt-4"
              >
                {isUploadingCarousel ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload to Carousel
                  </>
                )}
              </Button>
            </Card>

            {/* Carousel Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {carouselLoading ? (
                <p className="text-muted-foreground">Loading carousel items...</p>
              ) : carouselItems?.length === 0 ? (
                <Card className="col-span-full p-12 text-center">
                  <p className="text-muted-foreground">No carousel items yet. Upload your first before/after pair above.</p>
                </Card>
              ) : (
                  carouselItems?.map((item) => (
                    <Card key={item.id} className="overflow-hidden">
                      <div className="grid grid-cols-2 aspect-video">
                        <div className="relative order-1">
                          <img src={item.before_url || ''} alt="Before - 2D Proof" className="w-full h-full object-cover" />
                          <span className="absolute bottom-1 left-1 bg-black/70 text-white text-xs px-2 py-0.5 rounded z-10">Before</span>
                        </div>
                        <div className="relative order-2">
                          <img src={item.media_url} alt="After - 3D Render" className="w-full h-full object-cover" />
                          <span className="absolute bottom-1 right-1 bg-primary/80 text-white text-xs px-2 py-0.5 rounded z-10">After</span>
                        </div>
                      </div>
                    <div className="p-4">
                      <h3 className="font-semibold truncate">{item.vehicle_name || item.name}</h3>
                      <p className="text-sm text-muted-foreground truncate">{item.color_name}</p>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="w-full mt-3"
                        onClick={() => deleteCarouselMutation.mutate(item.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Design Proofs Tab */}
          <TabsContent value="design-proofs" className="space-y-6">
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Upload Design Proof</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Upload a real design proof image to use in approval sheets.
              </p>

              <div className="grid md:grid-cols-2 gap-6">
                {/* Image Upload */}
                <div className="space-y-3">
                  <Label>Design Proof Image</Label>
                  <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={handleProofFileChange}
                      className="hidden"
                      id="proof-upload"
                    />
                    <Label htmlFor="proof-upload" className="cursor-pointer">
                      {proofPreview ? (
                        <img src={proofPreview} alt="Proof preview" className="w-full aspect-video object-contain rounded" />
                      ) : (
                        <div className="py-8 space-y-2">
                          <Image className="w-10 h-10 mx-auto text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">Click to upload design proof</p>
                        </div>
                      )}
                    </Label>
                  </div>
                </div>

                {/* Info Fields */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input
                      placeholder="e.g., 2024 Mustang Full Wrap Proof"
                      value={proofName}
                      onChange={(e) => setProofName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Input
                      placeholder="Optional notes about this proof"
                      value={proofDescription}
                      onChange={(e) => setProofDescription(e.target.value)}
                    />
                  </div>

                  <Button
                    onClick={handleProofUpload}
                    disabled={isUploadingProof || !proofFile || !proofName}
                    className="w-full mt-4"
                  >
                    {isUploadingProof ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Design Proof
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Existing Design Proofs Grid */}
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Uploaded Design Proofs</h3>
              <span className="text-sm text-muted-foreground">{designProofs?.length || 0} proofs</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {designProofsLoading ? (
                <p className="text-muted-foreground">Loading design proofs...</p>
              ) : designProofs?.length === 0 ? (
                <Card className="col-span-full p-12 text-center">
                  <p className="text-muted-foreground">No design proofs uploaded yet.</p>
                </Card>
              ) : (
                designProofs?.map((proof) => (
                  <Card key={proof.id} className="overflow-hidden">
                    <div
                      className="relative aspect-video cursor-pointer"
                      onClick={() => setSelectedRender({ url: proof.after_url, label: proof.name })}
                    >
                      <img src={proof.after_url} alt={proof.name} className="w-full h-full object-cover" />
                      <div className="absolute top-2 right-2">
                        <Eye className="w-5 h-5 text-white drop-shadow-lg" />
                      </div>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-lg mb-1">{proof.name}</h3>
                      <p className="text-xs text-muted-foreground mb-3">
                        {new Date(proof.created_at || '').toLocaleDateString()}
                      </p>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="w-full"
                        onClick={() => deleteDesignProofMutation.mutate(proof.id)}
                        disabled={deleteDesignProofMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>

          {/* Examples Tab */}
          <TabsContent value="examples" className="space-y-6">
            <AdminSmartUploader
              productType="approvemode"
              onUploadComplete={() => queryClient.invalidateQueries({ queryKey: ["approvemode_examples_admin"] })}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {examplesLoading ? (
                <p className="text-muted-foreground">Loading examples...</p>
              ) : examples?.length === 0 ? (
                <Card className="col-span-full p-12 text-center">
                  <p className="text-muted-foreground">No examples uploaded yet.</p>
                </Card>
              ) : (
                examples?.map((example) => (
                  <Card key={example.id} className="overflow-hidden">
                    <div className="relative aspect-video">
                      <img src={example.after_url} alt={example.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-lg mb-2">{example.name}</h3>
                      {example.description && (
                        <p className="text-sm text-muted-foreground mb-4">{example.description}</p>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        className="w-full"
                        onClick={() => deleteExampleMutation.mutate(example.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </Button>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Full-screen render modal */}
      <Dialog open={!!selectedRender} onOpenChange={() => setSelectedRender(null)}>
        <DialogContent className="max-w-5xl w-full p-0 bg-black/95">
          <div className="relative">
            <div className="absolute top-4 left-4 bg-black/70 text-white px-3 py-1.5 rounded-lg text-sm font-medium">
              {selectedRender?.label}
            </div>
            {selectedRender && (
              <img
                src={selectedRender.url}
                alt={selectedRender.label}
                className="w-full h-auto max-h-[85vh] object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminApproveProManager;
