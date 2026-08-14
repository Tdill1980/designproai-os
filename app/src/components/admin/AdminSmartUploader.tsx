import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Upload, Loader2, Check, Sparkles } from "lucide-react";
import { getVehicleByIndex, formatVehicleName, TOP_20_VEHICLES } from "@/lib/vehicle-selection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

interface AdminSmartUploaderProps {
  productType: 'designpanelpro' | 'fadewraps' | 'wbty' | 'approvemode';
  onUploadComplete: () => void;
}

export const AdminSmartUploader = ({ productType, onUploadComplete }: AdminSmartUploaderProps) => {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingRenders, setIsGeneratingRenders] = useState(false);
  const [selectedVehicleIndex, setSelectedVehicleIndex] = useState<number>(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [uploadedPattern, setUploadedPattern] = useState<any>(null);

  const getTableName = () => {
    switch (productType) {
      case 'designpanelpro': return 'designpanelpro_patterns';
      case 'fadewraps': return 'fadewraps_patterns';
      case 'wbty': return 'wbty_products';
      case 'approvemode': return 'approvemode_examples';
      default: return 'designpanelpro_patterns';
    }
  };

  const getStorageBucket = () => {
    switch (productType) {
      case 'designpanelpro': return 'patterns';
      case 'fadewraps': return 'patterns';
      case 'wbty': return 'products';
      case 'approvemode': return 'before-after';
      default: return 'patterns';
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file",
        description: "Please upload an image file",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(10);
    setCurrentStep("Uploading image...");

    try {
      // 1. Upload to storage
      const fileExt = file.name.split('.').pop();
      const fileName = `${crypto.randomUUID()}.${fileExt}`;
      const bucket = getStorageBucket();
      const filePath = `${productType}/${fileName}`;

      setUploadProgress(20);
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(filePath);

      setUploadProgress(40);
      setCurrentStep("AI analyzing design...");

      // 2. AI Analysis
      setIsAnalyzing(true);
      const { data: analysisData, error: analysisError } = await renderClient.functions.invoke(
        'analyze-panel-design',
        { body: { panelImageUrl: publicUrl } }
      );

      if (analysisError) throw analysisError;

      setUploadProgress(60);
      setCurrentStep("Saving to database...");

      // 3. Save to database
      const tableName = getTableName();
      const insertData: any = {
        name: analysisData.name || file.name.replace(/\.[^/.]+$/, ""),
        media_url: publicUrl,
        is_active: true,
      };

      if (productType === 'designpanelpro') {
        insertData.ai_generated_name = analysisData.name;
        insertData.category = 'Custom';
        insertData.is_curated = false;
      } else if (productType === 'fadewraps') {
        insertData.media_type = 'image';
        insertData.category = 'Custom Gradient';
      } else if (productType === 'wbty') {
        insertData.media_type = 'image';
        insertData.category = 'Custom Pattern';
      } else if (productType === 'approvemode') {
        insertData.before_url = publicUrl;
        insertData.after_url = publicUrl; // Placeholder
        insertData.description = analysisData.name;
      }

      const { data: savedPattern, error: dbError } = await supabase
        .from(tableName)
        .insert(insertData)
        .select()
        .single();

      if (dbError) throw dbError;

      setUploadedPattern(savedPattern);
      setUploadProgress(80);
      setCurrentStep("Ready for 3D render generation");

      toast({
        title: "Upload successful",
        description: `AI generated name: "${analysisData.name}"`,
      });

    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
      setIsAnalyzing(false);
      setUploadProgress(0);
    }
  };

  // Helper to normalize vehicle names to proper case
  const toProperCase = (str: string) => {
    return str.toLowerCase().split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const generateRenders = async () => {
    if (!uploadedPattern) return;

    setIsGeneratingRenders(true);
    setGenerationProgress(0);
    const selectedVehicle = getVehicleByIndex(selectedVehicleIndex);
    const views = ['front', 'driver-side', 'passenger-side', 'rear', 'top', 'hood_detail'];
    let successCount = 0;
    let visualizationRecordId: string | null = null;
    const allRenderUrls: Record<string, string> = {};

    try {
      // Normalize vehicle names to proper title case
      const normalizedMake = toProperCase(selectedVehicle.make);
      const normalizedModel = toProperCase(selectedVehicle.model);

      // Step 1: Create ONE color_visualizations record FIRST
      const { data: visualizationRecord, error: insertError } = await supabase
        .from('color_visualizations')
        .insert({
          vehicle_year: parseInt(selectedVehicle.year),
          vehicle_make: normalizedMake,
          vehicle_model: normalizedModel,
          color_name: uploadedPattern.name || uploadedPattern.ai_generated_name || 'Custom Design',
          color_hex: '#000000',
          finish_type: 'gloss',
          customer_email: 'admin@system.com',
          mode_type: productType,
          generation_status: 'processing',
          render_urls: {},
          is_saved: true,
        })
        .select()
        .single();

      if (insertError || !visualizationRecord) {
        throw new Error('Failed to create visualization record');
      }

      visualizationRecordId = visualizationRecord.id;
      console.log('✅ Created single visualization record:', visualizationRecordId);

      // Step 2: Generate all 4 views
      for (let i = 0; i < views.length; i++) {
        const viewType = views[i];
        setCurrentStep(`Generating ${viewType} view on ${formatVehicleName(selectedVehicle)}...`);

        const colorData: any = {
          patternUrl: uploadedPattern.media_url,
          panelName: uploadedPattern.name || uploadedPattern.ai_generated_name,
          finish: 'gloss',
        };

        if (productType === 'designpanelpro') {
          colorData.panelUrl = uploadedPattern.media_url;
        }

        const { data, error } = await renderClient.functions.invoke('generate-color-render', {
          body: {
            vehicleYear: selectedVehicle.year,
            vehicleMake: normalizedMake,
            vehicleModel: normalizedModel,
            colorData,
            modeType: productType === 'wbty' ? 'wbty' : productType === 'fadewraps' ? 'fadewraps' : productType === 'designpanelpro' ? 'designpanelpro' : 'approvemode',
            viewType,
          },
        });

        if (error) {
          console.error(`Error generating ${viewType}:`, error);
          continue;
        }

        // Store render URL
        allRenderUrls[viewType] = data.renderUrl;

        // Save to vehicle_render_images
        await supabase.from('vehicle_render_images').insert({
          swatch_id: uploadedPattern.id,
          product_type: productType,
          vehicle_type: viewType,
          image_url: data.renderUrl,
          vehicle_make: normalizedMake,
          vehicle_model: normalizedModel,
          vehicle_year: selectedVehicle.year,
        });

        successCount++;
        setGenerationProgress((i + 1) / views.length * 100);
      }

      // Step 3: Update single record with ALL view URLs combined
      if (visualizationRecordId && Object.keys(allRenderUrls).length > 0) {
        await supabase
          .from('color_visualizations')
          .update({
            render_urls: allRenderUrls,
            generation_status: 'completed',
          })
          .eq('id', visualizationRecordId);

        console.log('✅ Updated single record with all views:', allRenderUrls);
      }

      toast({
        title: "3D renders generated",
        description: `${successCount}/${views.length} views created successfully`,
      });

      onUploadComplete();
      setUploadedPattern(null);
      
    } catch (error: any) {
      console.error('Render generation error:', error);
      toast({
        title: "Generation failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsGeneratingRenders(false);
      setGenerationProgress(0);
      setCurrentStep("");
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        <div>
          <Label className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Smart Upload & Auto-Generate
          </Label>
          <p className="text-sm text-muted-foreground mt-1">
            Upload design → AI names it → Select vehicle → Generate 6 views → Auto-save to gallery
          </p>
        </div>

        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary transition-colors">
          <Input
            id="smart-upload"
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            disabled={isUploading || isAnalyzing}
            className="hidden"
          />
          <Label
            htmlFor="smart-upload"
            className="cursor-pointer flex flex-col items-center gap-3"
          >
            {isUploading || isAnalyzing ? (
              <>
                <Loader2 className="w-12 h-12 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{currentStep}</span>
                {uploadProgress > 0 && (
                  <Progress value={uploadProgress} className="w-full max-w-xs" />
                )}
              </>
            ) : uploadedPattern ? (
              <>
                <Check className="w-12 h-12 text-green-500" />
                <span className="text-sm font-medium">
                  Ready: {uploadedPattern.ai_generated_name || uploadedPattern.name}
                </span>
              </>
            ) : (
              <>
                <Upload className="w-12 h-12 text-muted-foreground" />
                <span className="text-sm font-medium">Click to upload design</span>
                <span className="text-xs text-muted-foreground">
                  PNG, JPG, or WEBP (max 20MB)
                </span>
              </>
            )}
          </Label>
        </div>

        {uploadedPattern && (
          <>
            <div className="space-y-2">
              <Label>Select Vehicle from Top 20</Label>
              <Select
                value={selectedVehicleIndex.toString()}
                onValueChange={(val) => setSelectedVehicleIndex(parseInt(val))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOP_20_VEHICLES.map((vehicle, idx) => (
                    <SelectItem key={idx} value={idx.toString()}>
                      {formatVehicleName(vehicle)} ({vehicle.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={generateRenders}
              disabled={isGeneratingRenders}
              className="w-full bg-gradient-to-r from-[#D946EF] to-[#9b87f5] hover:opacity-90"
              size="lg"
            >
              {isGeneratingRenders ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {currentStep}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate All 6 Views + Save to Gallery
                </>
              )}
            </Button>

            {generationProgress > 0 && (
              <Progress value={generationProgress} className="w-full" />
            )}
          </>
        )}
      </div>
    </Card>
  );
};
