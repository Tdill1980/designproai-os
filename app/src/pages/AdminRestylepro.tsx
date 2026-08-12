import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Upload, ArrowLeft } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

const VEHICLE_TYPES = ["sedan", "suv", "truck", "coupe", "sports", "van", "exotic"] as const;

const AdminRestylepro = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedColorId, setExpandedColorId] = useState<string | null>(null);
  const [uploadingFor, setUploadingFor] = useState<{ swatchId: string; vehicleType: string } | null>(null);
  const { toast } = useToast();

  const { data: swatches, isLoading, refetch } = useQuery({
    queryKey: ["inkfusion_swatches_admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("inkfusion_swatches").select("*").eq("is_active", true).order("sort_order", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const { data: renderImages } = useQuery({
    queryKey: ["vehicle_render_images"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicle_render_images").select("*").eq("product_type", "inkfusion").eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const getImageCountForSwatch = (swatchId: string) => renderImages?.filter(img => img.swatch_id === swatchId).length || 0;

  const handleFileUpload = async (swatchId: string, vehicleType: string, file: File) => {
    setUploadingFor({ swatchId, vehicleType });
    try {
      const fileName = `${swatchId}_${vehicleType}_${Date.now()}.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage.from('vehicle-renders').upload(fileName, file);
      if (uploadError) throw uploadError;
      
      const { data: { publicUrl } } = supabase.storage.from('vehicle-renders').getPublicUrl(fileName);
      const { error: dbError } = await supabase.from('vehicle_render_images').insert({ product_type: 'inkfusion', swatch_id: swatchId, vehicle_type: vehicleType, image_url: publicUrl });
      if (dbError) throw dbError;
      
      toast({ title: "Upload successful", description: `${vehicleType} render uploaded successfully` });
      refetch();
    } catch (error) {
      toast({ title: "Upload failed", description: "Failed to upload the render image", variant: "destructive" });
    } finally {
      setUploadingFor(null);
    }
  };

  const filteredSwatches = swatches?.filter(swatch => swatch.name.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 container mx-auto px-4 py-12">
        <Button variant="ghost" className="mb-4" onClick={() => window.history.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />Back to Dashboard
        </Button>
        <h1 className="text-4xl font-bold mb-2">InkFusion Color Image Manager</h1>
        <p className="text-muted-foreground mb-6">Manage vehicle images for all 50 InkFusion colors</p>
        <Input placeholder="Search colors..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="max-w-md bg-secondary border-border mb-6" />
        <div className="mb-4 text-sm text-muted-foreground">Showing {filteredSwatches?.length || 0} of {swatches?.length || 0} colors</div>
        
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-48" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSwatches?.map((swatch) => {
              const imageCount = getImageCountForSwatch(swatch.id);
              const isExpanded = expandedColorId === swatch.id;
              return (
                <Card key={swatch.id} className="p-4 bg-card border-border">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-lg border-2 border-border overflow-hidden flex-shrink-0" style={{ backgroundColor: swatch.hex || '#000' }}>
                      <img src={swatch.media_url} alt={swatch.name} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{swatch.name}</h3>
                      <Badge variant="secondary" className="mt-1">{swatch.finish || "Gloss"} Finish</Badge>
                      <div className="mt-2 flex items-center justify-between">
                        <Badge variant="outline">{imageCount} images</Badge>
                        <Button variant="ghost" size="sm" onClick={() => setExpandedColorId(isExpanded ? null : swatch.id)}>
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-border space-y-3">
                      <h4 className="text-sm font-semibold">Upload Vehicle Renders</h4>
                      {VEHICLE_TYPES.map((vehicleType) => {
                        const existingRender = renderImages?.find(img => img.swatch_id === swatch.id && img.vehicle_type === vehicleType);
                        const isUploading = uploadingFor?.swatchId === swatch.id && uploadingFor?.vehicleType === vehicleType;
                        return (
                          <div key={vehicleType} className="flex items-center justify-between p-2 bg-secondary/20 rounded">
                            <span className="text-sm capitalize">{vehicleType}</span>
                            <div className="flex items-center gap-2">
                              {existingRender && <Badge variant="outline" className="text-xs">✓</Badge>}
                              <label>
                                <input type="file" accept="image/*" className="hidden" disabled={isUploading} onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFileUpload(swatch.id, vehicleType, file); }} />
                                <Button variant="outline" size="sm" disabled={isUploading} asChild>
                                  <span className="cursor-pointer">{isUploading ? "Uploading..." : <Upload className="h-3 w-3" />}</span>
                                </Button>
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </main>

    </div>
  );
};

export default AdminRestylepro;
