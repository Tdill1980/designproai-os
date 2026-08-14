import { useState, useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { ProductHero } from "@/components/ProductHero";
import { SwatchUploader } from "@/components/visualize/SwatchUploader";
import { VehicleSelector } from "@/components/visualize/VehicleSelector";
import { FinishSelector } from "@/components/visualize/FinishSelector";
import { RenderResults } from "@/components/visualize/RenderResults";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useGenerationLimit } from "@/hooks/useGenerationLimit";
import { useRenderPolling } from "@/hooks/useRenderPolling";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { PaywallModal } from "@/components/PaywallModal";
import { Sparkles, Upload, Car, ChevronDown, X } from "lucide-react";
import { GenerationWizard, MATERIAL_TIPS } from "@/components/tools/GenerationWizard";
import { MyVehicleProToggle } from "@/components/tools/MyVehicleProToggle";
import { useMyVehicleMode } from "@/hooks/useMyVehicleMode";
import { BeforeAfterViewer } from "@/components/colorpro/BeforeAfterViewer";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

const MaterialMode = () => {
  const { toast } = useToast();
  const { hasReachedLimit, remainingGenerations, incrementGeneration } = useGenerationLimit();
  const mvp = useMyVehicleMode();
  const [mvpEditedImageUrl, setMvpEditedImageUrl] = useState<string | null>(null);
  const [mvpIsGenerating, setMvpIsGenerating] = useState(false);

  const [vehicle, setVehicle] = useState<{ year: string; make: string; model: string } | null>(null);
  const [finish, setFinish] = useState<string>("gloss");
  const [swatchData, setSwatchData] = useState<{ hex: string; name: string; url: string } | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [generatedViews, setGeneratedViews] = useState<any>(null);
  const [visualizationId, setVisualizationId] = useState<string | null>(null);

  const [isPolling, setIsPolling] = useState(false);
  const { allViews } = useRenderPolling(visualizationId, 7);

  useEffect(() => {
    if (visualizationId) {
      setIsPolling(true);
    }
  }, [visualizationId]);

  useEffect(() => {
    if (allViews.length > 0) {
      setGeneratedViews(allViews);
      setIsPolling(false);
    }
  }, [allViews]);

  const handleSwatchAnalysis = (result: { hex: string; name: string; url: string }) => {
    setSwatchData(result);
    toast({
      title: "Swatch Analyzed",
      description: `Extracted ${result.name} (${result.hex})`,
    });
  };

  const handleGenerate = async () => {
    if (!swatchData) {
      toast({
        title: "Missing Information",
        description: "Please upload a swatch material",
        variant: "destructive",
      });
      return;
    }

    // ─── MyVehiclePro Mode: render on uploaded photos ───
    if (mvp.isMyVehicleMode) {
      if (!mvp.hasPhotos) {
        toast({ title: "Upload a photo first", description: "Please upload a photo of your vehicle.", variant: "destructive" });
        return;
      }

      if (hasReachedLimit) {
        setPaywallOpen(true);
        return;
      }

      setMvpIsGenerating(true);
      setMvpEditedImageUrl(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user?.email) throw new Error("Please sign in to generate renders.");

        const { data, error } = await renderClient.functions.invoke("edit-vehicle-photo", {
          body: {
            userEmail: user.email,
            uploadedPhotoBase64: mvp.photoBase64,
            uploadedPhotoMimeType: mvp.photoMimeType,
            colorData: {
              colorName: swatchData.name,
              hex: swatchData.hex,
              finish: finish.toLowerCase(),
              manufacturer: "Custom Material",
              colorLibrary: "material",
              toolSource: "ColorPro",
            },
            vehicleInfo: mvp.detectedVehicleInfo || undefined,
          },
        });

        if (error) throw new Error(error.message || "Photo edit failed");
        if (data?.error) throw new Error(data.error);
        if (data?.renderUrl) {
          setMvpEditedImageUrl(data.renderUrl);
          incrementGeneration();
          toast({ title: "Wrap Preview Ready!", description: "Your vehicle photo has been edited with the selected material." });
        } else {
          throw new Error("No image returned from the editor.");
        }
      } catch (err: any) {
        toast({ title: "Edit Failed", description: err.message || "An unexpected error occurred.", variant: "destructive" });
      } finally {
        setMvpIsGenerating(false);
      }
      return;
    }

    // ─── Studio Mode: render on stock 3D model ───
    if (!vehicle) {
      toast({
        title: "Missing Information",
        description: "Please select a vehicle",
        variant: "destructive",
      });
      return;
    }

    if (hasReachedLimit) {
      setPaywallOpen(true);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const customerEmail = user?.email || "guest@example.com";

      const payload = {
        vehicleYear: vehicle.year,
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
        colorHex: swatchData.hex,
        colorName: swatchData.name,
        finishType: finish,
        customerEmail,
        modeType: "material",
        customSwatchUrl: swatchData.url,
      };

      const { data, error } = await renderClient.functions.invoke("generate-color-render", {
        body: payload,
      });

      if (error) throw error;

      setVisualizationId(data.visualizationId);
      incrementGeneration();

      toast({
        title: "Generating 3D Renders",
        description: "AI is creating your photorealistic vehicle preview...",
        duration: 3000,
      });
    } catch (error: any) {
      console.error("Generation error:", error);
      toast({
        title: "Generation Failed",
        description: error.message || "Failed to generate renders",
        variant: "destructive",
      });
    }
  };

  const handleBack = () => {
    setGeneratedViews(null);
    setVisualizationId(null);
  };

  if (generatedViews) {
    return (
      <div className="min-h-screen flex flex-col">
        <main className="flex-1 container mx-auto px-4 py-8">
          <RenderResults
            views={generatedViews}
            isPolling={isPolling}
            onBack={handleBack}
          />
        </main>

      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <title>MaterialMode - Vehicle Material & Texture Visualization | RestyleProAI</title>
        <meta name="description" content="Visualize custom materials and textures on any vehicle. Carbon fiber, brushed metal, leather, and more. Design it. Panel it. Print it. The world's first prompt-to-production vehicle wrap design software." />
        <link rel="canonical" href="https://www.restyleproai.com/material" />
        <meta property="og:title" content="MaterialMode - Vehicle Material Visualization | RestyleProAI" />
        <meta property="og:description" content="Visualize custom materials and textures on any vehicle with AI-powered photorealistic renders." />
        <meta property="og:url" content="https://www.restyleproai.com/material" />
      </Helmet>

      <main className="flex-1">
        <ProductHero
          productName="Material™"
          tagline="Upload any vinyl swatch or material sample. Our AI analyzes texture, color, and finish to generate photorealistic 3D vehicle wraps with studio-quality accuracy."
          leftSlides={[]}
          rightSlides={[]}
        />
        
        <section className="container mx-auto px-4 py-12">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-8 max-w-7xl mx-auto">
            {/* Left Column - Material Upload & Vehicle Selection */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="w-5 h-5" />
                    Upload Material Swatch
                  </CardTitle>
                  <CardDescription>
                    Upload a photo of any vinyl, marble, carbon fiber, or specialty material
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SwatchUploader onAnalysisComplete={handleSwatchAnalysis} />
                  
                  {swatchData && (
                    <div className="mt-4 p-4 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-16 h-16 rounded-lg border-2 border-border"
                          style={{ backgroundColor: swatchData.hex }}
                        />
                        <div>
                          <p className="font-semibold">{swatchData.name}</p>
                          <p className="text-sm text-muted-foreground">{swatchData.hex}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <MyVehicleProToggle
                isMyVehicleMode={mvp.isMyVehicleMode}
                onToggle={mvp.setIsMyVehicleMode}
                uploadMode={mvp.uploadMode}
                onUploadModeChange={mvp.setUploadMode}
                photoPreviewUrl={mvp.photoPreviewUrl}
                multiViewPhotos={mvp.multiViewPhotos}
                isAnalyzing={mvp.isAnalyzing}
                detectedVehicleInfo={mvp.detectedVehicleInfo}
                onPhotoUpload={mvp.handlePhotoUpload}
                onMultiViewPhotoUpload={mvp.handleMultiViewPhotoUpload}
                onRemoveMultiViewPhoto={mvp.removeMultiViewPhoto}
                onClearPhotos={mvp.clearPhotos}
              >
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Car className="w-5 h-5" />
                      Select Vehicle
                    </CardTitle>
                    <CardDescription>
                      Choose your vehicle for accurate 3D rendering
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <VehicleSelector onVehicleChange={setVehicle} />
                  </CardContent>
                </Card>
              </MyVehicleProToggle>

              <Card>
                <CardHeader>
                  <CardTitle>Material Finish</CardTitle>
                </CardHeader>
                <CardContent>
                  <FinishSelector value={finish} onChange={setFinish} />
                </CardContent>
              </Card>
            </div>

            {/* Right Column - Preview & Generate */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>3D Preview</CardTitle>
                  <CardDescription>
                    Generate photorealistic 3D renders
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="aspect-video bg-gradient-to-br from-muted to-background rounded-lg flex items-center justify-center border-2 border-dashed border-border">
                    {swatchData ? (
                      <div className="text-center space-y-4">
                        <div
                          className="w-32 h-32 rounded-lg mx-auto border-2 border-border shadow-lg"
                          style={{ backgroundColor: swatchData.hex }}
                        />
                        <p className="text-sm text-muted-foreground">
                          Ready to generate with {swatchData.name}
                        </p>
                      </div>
                    ) : (
                      <div className="text-center text-muted-foreground">
                        <Upload className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>Upload a material swatch to begin</p>
                      </div>
                    )}
                  </div>

                  {/* MyVehiclePro Before/After Result */}
                  {mvp.isMyVehicleMode && mvpEditedImageUrl && mvp.photoPreviewUrl && (
                    <div className="space-y-3">
                      <BeforeAfterViewer
                        beforeUrl={mvp.photoPreviewUrl}
                        afterUrl={mvpEditedImageUrl}
                        beforeLabel="Original"
                        afterLabel={`${swatchData?.name || "Wrapped"} ${finish}`}
                      />
                      <Button
                        onClick={() => { setMvpEditedImageUrl(null); mvp.clearPhotos(); }}
                        variant="destructive"
                        size="sm"
                        className="w-full"
                      >
                        <X className="h-4 w-4 mr-2" />
                        Clear & Start New
                      </Button>
                    </div>
                  )}

                  <Button
                    onClick={handleGenerate}
                    disabled={
                      !swatchData || isPolling || mvpIsGenerating ||
                      (mvp.isMyVehicleMode ? !mvp.hasPhotos : !vehicle)
                    }
                    className="w-full"
                    size="lg"
                  >
                    <Sparkles className="w-5 h-5 mr-2" />
                    {(isPolling || mvpIsGenerating) ? "Generating..." : mvp.isMyVehicleMode ? "Generate MyVehiclePro\u2122 Preview" : "Generate 3D Renders"}
                  </Button>

                  {isPolling && (
                    <GenerationWizard
                      isGenerating={isPolling}
                      tips={MATERIAL_TIPS}
                      currentTipIndex={0}
                      toolName="Material"
                      gradientFrom="from-amber-500"
                      gradientTo="to-orange-500"
                    />
                  )}

                  {!hasReachedLimit && (
                    <p className="text-sm text-center text-muted-foreground">
                      {remainingGenerations} free {remainingGenerations === 1 ? 'generation' : 'generations'} remaining
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-primary/20">
                <CardHeader>
                  <CardTitle className="text-sm">Material™ Features</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li>✓ AI-powered texture analysis</li>
                    <li>✓ Photorealistic 3D rendering</li>
                    <li>✓ Studio lighting & reflections</li>
                    <li>✓ Multiple camera angles</li>
                    <li>✓ Accurate material representation</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>
      </main>

      <PaywallModal 
        open={paywallOpen} 
        onClose={() => setPaywallOpen(false)}
        onShowExample={() => {}}
        productType="material"
      />
    </div>
  );
};

export default MaterialMode;