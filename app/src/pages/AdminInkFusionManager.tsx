import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RealisticSwatch } from "@/components/ui/realistic-swatch";
import { inkFusionColors, type InkFusionColor } from "@/lib/restyleproai-colors";
import { Upload, Search, Wand2, Loader2, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";

type ColorLibrary = 'inkfusion' | 'avery_sw900' | '3m_2080';

export default function AdminInkFusionManager() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedLibrary, setSelectedLibrary] = useState<ColorLibrary>('inkfusion');
  const [generatingRenders, setGeneratingRenders] = useState<string | null>(null);
  const [renderDialogOpen, setRenderDialogOpen] = useState(false);
  const [selectedSwatchForRender, setSelectedSwatchForRender] = useState<any>(null);
  const [vehicleYear, setVehicleYear] = useState("2024");
  const [vehicleMake, setVehicleMake] = useState("Porsche");
  const [vehicleModel, setVehicleModel] = useState("911");
  const [selectedSwatches, setSelectedSwatches] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [pausedQueue, setPausedQueue] = useState<string[]>([]);
  const [processedCount, setProcessedCount] = useState(0);
  const [bulkProgress, setBulkProgress] = useState({
    currentIndex: 0,
    totalCount: 0,
    currentSwatchName: '',
    currentView: '',
    currentVehicle: '',
    successCount: 0,
    failCount: 0
  });
  const [generatingSwatches, setGeneratingSwatches] = useState(false);
  const [swatchProgress, setSwatchProgress] = useState({
    current: 0,
    total: 0,
    currentColor: ''
  });
  const { toast } = useToast();

  // Fetch database colors for Avery and 3M
  const { data: dbColors, refetch } = useQuery({
    queryKey: ['admin-color-swatches', selectedLibrary],
    queryFn: async () => {
      if (selectedLibrary === 'inkfusion') return null;
      
      const { data, error } = await supabase
        .from('inkfusion_swatches')
        .select('*')
        .eq('color_library', selectedLibrary)
        .order('finish', { ascending: true })
        .order('name', { ascending: true });
      
      if (error) throw error;
      return data?.map(color => ({
        id: color.id,
        name: color.name,
        hex: color.hex || '#000000',
        finish: color.finish as 'Gloss' | 'Satin' | 'Matte',
        family: 'Neutral' as const,
        media_url: color.media_url
      })) || [];
    },
    enabled: selectedLibrary !== 'inkfusion'
  });

  const allColors = selectedLibrary === 'inkfusion' 
    ? inkFusionColors 
    : (dbColors || []);

  const filteredColors = allColors.filter(color =>
    color.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    color.hex.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleGenerateRenders = async () => {
    if (!selectedSwatchForRender) return;
    
    setGeneratingRenders(selectedSwatchForRender.id);
    setRenderDialogOpen(false);
    
    try {
      const views = ['front', 'side', 'top'];
      const renderUrls: Record<string, string> = {};
      
      for (const viewType of views) {
        const { data, error } = await renderClient.functions.invoke('generate-color-render', {
          body: {
            vehicleYear,
            vehicleMake,
            vehicleModel,
            modeType: 'inkfusion',
            viewType,
            colorData: {
              colorName: selectedSwatchForRender.name,
              colorHex: selectedSwatchForRender.hex,
              finish: selectedSwatchForRender.finish,
              manufacturer: 'InkFusion™',
              colorLibrary: 'inkfusion'
            }
          }
        });
        
        if (error) throw error;
        
        if (data?.renderUrl) {
          renderUrls[viewType] = data.renderUrl;
          
          await supabase.from('vehicle_render_images').insert({
            swatch_id: selectedSwatchForRender.id,
            product_type: 'inkfusion',
            vehicle_type: viewType,
            image_url: data.renderUrl,
            vehicle_make: vehicleMake,
            vehicle_model: vehicleModel,
            vehicle_year: vehicleYear,
            is_active: true
          });
        }
      }
      
      // Save to gallery
      await supabase.from('color_visualizations').insert({
        vehicle_year: parseInt(vehicleYear),
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel,
        color_name: selectedSwatchForRender.name,
        color_hex: selectedSwatchForRender.hex,
        finish_type: selectedSwatchForRender.finish,
        mode_type: 'inkfusion',
        customer_email: 'admin@restylepro.ai',
        render_urls: renderUrls,
        generation_status: 'completed'
      });
      
      toast({
        title: "Renders generated!",
        description: `Successfully generated 3 renders for ${selectedSwatchForRender.name}`,
      });
    } catch (error: any) {
      console.error('Render generation error:', error);
      toast({
        title: "Generation failed",
        description: error.message || "Failed to generate renders",
        variant: "destructive",
      });
    } finally {
      setGeneratingRenders(null);
      setSelectedSwatchForRender(null);
    }
  };

  const handleBulkGenerate = async (resuming = false) => {
    // Use Top 20 vehicles from vehicle-selection.ts
    const { TOP_20_VEHICLES, getVehicleByIndex } = await import("@/lib/vehicle-selection");

    let swatchArray: string[];
    let startIndex = 0;

    if (resuming && pausedQueue.length > 0) {
      // Resume from paused state
      swatchArray = pausedQueue;
      startIndex = processedCount;
      setIsPaused(false);
    } else {
      // New generation
      if (selectedSwatches.size === 0) {
        toast({
          title: "No swatches selected",
          description: "Please select at least one swatch to generate renders",
          variant: "destructive",
        });
        return;
      }
      swatchArray = Array.from(selectedSwatches);
      setPausedQueue(swatchArray);
      setProcessedCount(0);
    }

    setBulkGenerating(true);
    setBulkProgress({
      currentIndex: startIndex,
      totalCount: swatchArray.length,
      currentSwatchName: '',
      currentView: '',
      currentVehicle: '',
      successCount: bulkProgress.successCount,
      failCount: bulkProgress.failCount
    });

    let successCount = resuming ? bulkProgress.successCount : 0;
    let failCount = resuming ? bulkProgress.failCount : 0;

    for (let i = startIndex; i < swatchArray.length; i++) {
      // Check if paused
      if (isPaused) {
        setProcessedCount(i);
        setBulkGenerating(false);
        toast({
          title: "Generation paused",
          description: `Paused at ${i} of ${swatchArray.length} swatches. Click Resume to continue.`,
        });
        return;
      }

      const swatchId = swatchArray[i];
      const swatch = allColors.find(c => c.id === swatchId);
      if (!swatch) continue;

      // Cycle through Top 20 vehicles
      const vehicle = getVehicleByIndex(i);

      setBulkProgress(prev => ({
        ...prev,
        currentIndex: i + 1,
        currentSwatchName: swatch.name,
        currentVehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`
      }));

      try {
        const views = ['front', 'side', 'top'];
        const renderUrls: Record<string, string> = {};

        for (const viewType of views) {
          // Check pause between views
          if (isPaused) {
            setProcessedCount(i);
            setBulkGenerating(false);
            return;
          }

          setBulkProgress(prev => ({
            ...prev,
            currentView: viewType
          }));

          const { data, error } = await renderClient.functions.invoke('generate-color-render', {
            body: {
              vehicleYear: vehicle.year,
              vehicleMake: vehicle.make,
              vehicleModel: vehicle.model,
              modeType: 'inkfusion',
              viewType,
              colorData: {
                colorName: swatch.name,
                colorHex: swatch.hex,
                finish: swatch.finish,
                manufacturer: 'InkFusion™',
                colorLibrary: 'inkfusion'
              }
            }
          });

          if (error) throw error;

          if (data?.renderUrl) {
            renderUrls[viewType] = data.renderUrl;

            await supabase.from('vehicle_render_images').insert({
              swatch_id: swatch.id,
              product_type: 'inkfusion',
              vehicle_type: viewType,
              image_url: data.renderUrl,
              vehicle_make: vehicle.make,
              vehicle_model: vehicle.model,
              vehicle_year: vehicle.year,
              is_active: true
            });
          }
        }

        await supabase.from('color_visualizations').insert({
          vehicle_year: parseInt(vehicle.year),
          vehicle_make: vehicle.make,
          vehicle_model: vehicle.model,
          color_name: swatch.name,
          color_hex: swatch.hex,
          finish_type: swatch.finish,
          mode_type: 'inkfusion',
          customer_email: 'admin@restylepro.ai',
          render_urls: renderUrls,
          generation_status: 'completed'
        });

        successCount++;
        setBulkProgress(prev => ({
          ...prev,
          successCount: successCount
        }));
      } catch (error) {
        console.error(`Failed to generate renders for ${swatch.name}:`, error);
        failCount++;
        setBulkProgress(prev => ({
          ...prev,
          failCount: failCount
        }));
      }

      setProcessedCount(i + 1);
    }

    // Completed
    setBulkGenerating(false);
    setSelectedSwatches(new Set());
    setPausedQueue([]);
    setProcessedCount(0);
    setIsPaused(false);
    setBulkProgress({
      currentIndex: 0,
      totalCount: 0,
      currentSwatchName: '',
      currentView: '',
      currentVehicle: '',
      successCount: 0,
      failCount: 0
    });

    toast({
      title: "Bulk generation complete",
      description: `Generated renders for ${successCount} swatches. ${failCount > 0 ? `${failCount} failed.` : ''}`,
    });
  };

  const handlePauseResume = () => {
    if (bulkGenerating && !isPaused) {
      // Pause
      setIsPaused(true);
    } else if (isPaused) {
      // Resume
      handleBulkGenerate(true);
    }
  };

  const toggleSwatchSelection = (swatchId: string) => {
    setSelectedSwatches(prev => {
      const next = new Set(prev);
      if (next.has(swatchId)) {
        next.delete(swatchId);
      } else {
        next.add(swatchId);
      }
      return next;
    });
  };

  const handleGenerateMissingSwatches = async () => {
    setGeneratingSwatches(true);
    
    // Get all InkFusion colors that need swatches
    const colorsNeedingSwatches = inkFusionColors.filter(color => !color.media_url);
    
    setSwatchProgress({
      current: 0,
      total: colorsNeedingSwatches.length,
      currentColor: ''
    });
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < colorsNeedingSwatches.length; i++) {
      const color = colorsNeedingSwatches[i];
      
      setSwatchProgress({
        current: i + 1,
        total: colorsNeedingSwatches.length,
        currentColor: `${color.name} (${color.finish})`
      });
      
      try {
        // Call edge function to generate swatch
        const { data, error } = await renderClient.functions.invoke('generate-vinyl-swatch', {
          body: {
            colorName: color.name,
            finish: color.finish,
            colorLibrary: 'inkfusion'
          }
        });
        
        if (error) throw error;
        
        // Update database with generated image URL
        if (data?.imageUrl) {
          const { error: updateError } = await supabase
            .from('inkfusion_swatches')
            .update({ media_url: data.imageUrl })
            .eq('name', color.name)
            .eq('finish', color.finish)
            .eq('color_library', 'inkfusion');
          
          if (updateError) {
            console.error(`Failed to update ${color.name}:`, updateError);
            failCount++;
          } else {
            successCount++;
          }
        }
      } catch (error: any) {
        console.error(`Failed to generate swatch for ${color.name}:`, error);
        failCount++;
      }
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    setGeneratingSwatches(false);
    refetch(); // Refresh the display
    
    toast({
      title: "Swatch Generation Complete",
      description: `Successfully generated ${successCount} swatches. ${failCount} failed.`,
      variant: failCount > 0 ? "destructive" : "default"
    });
  };

  const handleSwatchUpload = async (colorId: string, file: File) => {
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${selectedLibrary}/${colorId}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('swatches')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('swatches')
        .getPublicUrl(filePath);

      // Update database with real URL
      const { error: dbError } = await supabase
        .from('inkfusion_swatches')
        .update({ media_url: publicUrl })
        .eq('id', colorId);

      if (dbError) throw dbError;

      toast({
        title: "Swatch uploaded",
        description: "Swatch image updated successfully",
      });
      
      refetch();
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload swatch. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      
      <main className="flex-1 container mx-auto px-4 py-8">
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold">ColorPro™ Swatch Manager</h1>
                <p className="text-muted-foreground mt-1">
                  Upload swatch images for all color libraries
                </p>
              </div>
              <div className="flex items-center gap-3">
                {selectedLibrary === 'inkfusion' && (
                  <Button 
                    onClick={handleGenerateMissingSwatches}
                    disabled={generatingSwatches}
                    variant="outline"
                    size="lg"
                  >
                    {generatingSwatches ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating {swatchProgress.current}/{swatchProgress.total}
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Generate Missing Swatches
                      </>
                    )}
                  </Button>
                )}
                {(selectedSwatches.size > 0 || isPaused) && (
                  <>
                    <Button
                      onClick={() => handleBulkGenerate(false)}
                      disabled={bulkGenerating || isPaused}
                      size="lg"
                    >
                      {bulkGenerating && !isPaused ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Wand2 className="h-4 w-4 mr-2" />
                          {isPaused ? 'Paused' : `Bulk Generate (${selectedSwatches.size})`}
                        </>
                      )}
                    </Button>
                    
                    {(bulkGenerating || isPaused) && (
                      <Button
                        onClick={handlePauseResume}
                        variant={isPaused ? "default" : "outline"}
                        size="lg"
                      >
                        {isPaused ? 'Resume' : 'Pause'}
                      </Button>
                    )}
                  </>
                )}
                <Badge variant="secondary" className="text-lg px-4 py-2">
                  {filteredColors.length} Colors
                </Badge>
              </div>
            </div>
            
            {generatingSwatches && (
              <Card className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">Generating Swatch Images...</p>
                      <p className="text-sm text-muted-foreground">
                        Current: {swatchProgress.currentColor}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {swatchProgress.current} / {swatchProgress.total}
                    </Badge>
                  </div>
                  <Progress 
                    value={(swatchProgress.current / swatchProgress.total) * 100} 
                    className="h-2"
                  />
                </div>
              </Card>
            )}

          <Tabs value={selectedLibrary} onValueChange={(v) => setSelectedLibrary(v as ColorLibrary)}>
            <TabsList className="grid w-full max-w-2xl grid-cols-3">
              <TabsTrigger value="inkfusion">InkFusion™ Premium</TabsTrigger>
              <TabsTrigger value="avery_sw900">Avery SW900</TabsTrigger>
              <TabsTrigger value="3m_2080">3M 2080</TabsTrigger>
            </TabsList>

            <TabsContent value={selectedLibrary} className="space-y-6 mt-6">
              {/* Bulk Progress Indicator */}
              {bulkGenerating && (
                <Card className="p-6 bg-card/50 border-primary/20">
                  <div className="space-y-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <h3 className="text-lg font-semibold flex items-center gap-2">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          Bulk Generation in Progress
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Generating {bulkProgress.currentIndex} of {bulkProgress.totalCount} swatches
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-sm">
                        {Math.round((bulkProgress.currentIndex / bulkProgress.totalCount) * 100)}%
                      </Badge>
                    </div>

                    <Progress 
                      value={(bulkProgress.currentIndex / bulkProgress.totalCount) * 100} 
                      className="h-2"
                    />

                    <div className="space-y-2 pt-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div 
                          className="w-4 h-4 rounded-full border-2 border-primary"
                          style={{ backgroundColor: allColors.find(c => c.name === bulkProgress.currentSwatchName)?.hex }}
                        />
                        <span className="font-medium">
                          {bulkProgress.currentSwatchName}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {bulkProgress.currentView} view
                        </Badge>
                      </div>
                      
                      <div className="text-sm text-muted-foreground">
                        Vehicle: {bulkProgress.currentVehicle}
                      </div>
                      
                      <div className="flex gap-4 text-sm">
                        <span className="text-green-500">
                          ✓ {bulkProgress.successCount} completed
                        </span>
                        {bulkProgress.failCount > 0 && (
                          <span className="text-red-500">
                            ✗ {bulkProgress.failCount} failed
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {/* Search */}
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search colors..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Color Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredColors.map((color) => {
                  const hasMediaUrl = 'media_url' in color;
                  const mediaUrl = hasMediaUrl ? (color.media_url as string) : undefined;
                  const isPlaceholder = mediaUrl?.includes('placeholder') ?? true;
                  
                  return (
                    <Card key={color.id} className="p-3 relative">
                      <div className="space-y-3">
                        {/* Selection Checkbox */}
                        <div className="absolute top-2 right-2 z-10">
                          <input
                            type="checkbox"
                            checked={selectedSwatches.has(color.id)}
                            onChange={() => toggleSwatchSelection(color.id)}
                            className="w-5 h-5 rounded border-border cursor-pointer"
                          />
                        </div>
                        
                        {/* Swatch Preview */}
                        <div className="aspect-square rounded-lg overflow-hidden border-2 border-border">
                          {mediaUrl && !isPlaceholder ? (
                            <img 
                              src={mediaUrl} 
                              alt={color.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div 
                              className="w-full h-full flex items-center justify-center"
                              style={{ backgroundColor: color.hex }}
                            >
                              <Upload className="h-8 w-8 text-white/50" />
                            </div>
                          )}
                        </div>

                      {/* Color Info */}
                      <div className="space-y-1">
                        <h3 className="font-medium text-sm truncate">{color.name}</h3>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="text-xs">
                            {color.finish}
                          </Badge>
                          <span className="text-xs text-muted-foreground font-mono">
                            {color.hex}
                          </span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="space-y-2">
                        {selectedLibrary !== 'inkfusion' && (
                          <label
                            htmlFor={`swatch-${color.id}`}
                            className="block cursor-pointer"
                          >
                            <Button variant="outline" size="sm" className="w-full" asChild>
                              <span>
                                <Upload className="h-3 w-3 mr-2" />
                                Upload Swatch
                              </span>
                            </Button>
                            <input
                              id={`swatch-${color.id}`}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleSwatchUpload(color.id, file);
                              }}
                            />
                          </label>
                        )}
                        
                        {selectedLibrary === 'inkfusion' && (
                          <Button 
                            variant="secondary" 
                            size="sm" 
                            className="w-full"
                            disabled={generatingRenders === color.id}
                            onClick={() => {
                              setSelectedSwatchForRender(color);
                              setRenderDialogOpen(true);
                            }}
                          >
                            {generatingRenders === color.id ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                Generating...
                              </>
                            ) : (
                              <>
                                <Wand2 className="h-3 w-3 mr-2" />
                                Generate Renders
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
      
      {/* Render Generation Dialog */}
      <Dialog open={renderDialogOpen} onOpenChange={setRenderDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate 3D Renders</DialogTitle>
            <DialogDescription>
              Generate front, side, and top view renders for {selectedSwatchForRender?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="year">Vehicle Year</Label>
              <Input 
                id="year" 
                value={vehicleYear} 
                onChange={(e) => setVehicleYear(e.target.value)}
                placeholder="2024"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="make">Vehicle Make</Label>
              <Input 
                id="make" 
                value={vehicleMake} 
                onChange={(e) => setVehicleMake(e.target.value)}
                placeholder="Porsche"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Vehicle Model</Label>
              <Input 
                id="model" 
                value={vehicleModel} 
                onChange={(e) => setVehicleModel(e.target.value)}
                placeholder="911"
              />
            </div>
            <Button 
              onClick={handleGenerateRenders} 
              className="w-full"
              disabled={generatingRenders !== null}
            >
              {generatingRenders ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating Renders...
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4 mr-2" />
                  Generate 3 Renders
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
