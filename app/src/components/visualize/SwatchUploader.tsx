import { useState } from "react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Upload, Loader2 } from "lucide-react";
import { UnknownSwatchModal } from "./UnknownSwatchModal";

interface SwatchAnalysisResult {
  hex: string; 
  name: string; 
  url: string;
  manufacturer?: string;
  finishType?: string;
  productCode?: string;
  series?: string;
  metallic?: boolean;
  chrome?: boolean;
  pearl?: boolean;
  confidence?: number;
  swatchId?: string;
  isVerifiedMatch?: boolean;
  materialProfile?: {
    lab?: any;
    reflectivity?: number;
    metallic_flake?: number;
    finish_profile?: any;
    material_validated?: boolean;
  };
}

interface SwatchUploaderProps {
  onAnalysisComplete: (result: SwatchAnalysisResult) => void;
}

export function SwatchUploader({ onAnalysisComplete }: SwatchUploaderProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  
  // Modal state for unknown swatches
  const [showUnknownModal, setShowUnknownModal] = useState(false);
  const [pendingAnalysis, setPendingAnalysis] = useState<{
    publicUrl: string;
    analysisData: any;
  } | null>(null);

  // Check if manufacturer AND color are readable
  const isSwatchLabelReadable = (analysis: any): boolean => {
    const manufacturer = analysis?.manufacturer;
    const colorName = analysis?.colorName || analysis?.dbColorName;
    
    // Must have BOTH manufacturer and color name to be considered readable
    const hasManufacturer = manufacturer && 
      manufacturer !== 'Unknown' && 
      manufacturer.toLowerCase() !== 'unknown' &&
      manufacturer.trim().length > 0;
    
    const hasColorName = colorName && 
      colorName !== 'Unknown' && 
      colorName !== 'Unknown Color' &&
      colorName.toLowerCase() !== 'unknown' &&
      colorName.trim().length > 0;
    
    console.log('📋 SwatchUploader: Label check:', { manufacturer, colorName, hasManufacturer, hasColorName });
    
    return hasManufacturer && hasColorName;
  };

  // Complete the render with the given analysis data
  const completeWithAnalysis = (publicUrl: string, analysis: any, userOverride?: { manufacturer: string; colorName: string; finish: string }) => {
    const finalManufacturer = userOverride?.manufacturer || analysis?.manufacturer || 'Unknown';
    const finalColorName = userOverride?.colorName || analysis?.dbColorName || analysis?.colorName || 'Unknown';
    const finalFinish = userOverride?.finish || analysis?.dbFinish || analysis?.finishType || 'Gloss';
    
    console.log('🎯 SwatchUploader: Completing with:', { finalManufacturer, finalColorName, finalFinish, userOverride: !!userOverride });
    
    onAnalysisComplete({
      hex: analysis?.hexColor || "#000000",
      name: finalColorName,
      url: publicUrl,
      manufacturer: finalManufacturer,
      finishType: finalFinish,
      productCode: analysis?.productCode,
      series: analysis?.series,
      metallic: analysis?.metallic,
      chrome: analysis?.chrome,
      pearl: analysis?.pearl,
      confidence: userOverride ? 0.9 : (analysis?.confidence || 0.5),
      swatchId: analysis?.swatchId,
      isVerifiedMatch: analysis?.isVerifiedMatch,
      materialProfile: analysis?.materialProfile,
    });

    toast({
      title: userOverride ? "✓ Vinyl Confirmed" : "✓ Swatch Analyzed",
      description: `Color: ${finalManufacturer} ${finalColorName}`,
    });
    
    // Reset modal state
    setShowUnknownModal(false);
    setPendingAnalysis(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast({
        title: "Invalid File",
        description: "Please upload an image file",
        variant: "destructive",
      });
      return;
    }

    setUploadedFile(file);
    setIsUploading(true);

    try {
      console.log("📤 SwatchUploader: Starting upload for file:", file.name, "size:", file.size, "type:", file.type);
      
      // Check authentication status
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) {
        console.error("🔐 SwatchUploader: Auth error:", authError);
        throw new Error(`Authentication error: ${authError.message}. Please log in again.`);
      }
      if (!user) {
        console.error("🔐 SwatchUploader: No authenticated user");
        throw new Error("You must be logged in to upload swatches. Please log in and try again.");
      }
      console.log("🔐 SwatchUploader: User authenticated:", user.email);

      // Upload to Supabase Storage
      const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      console.log("📦 SwatchUploader: Uploading to patterns/swatches/", fileName);
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("patterns")
        .upload(`swatches/${fileName}`, file);

      if (uploadError) {
        console.error("❌ SwatchUploader: Storage upload error:", uploadError);
        if (uploadError.message?.includes("not found") || uploadError.message?.includes("bucket")) {
          throw new Error("Storage bucket not configured. Please contact support.");
        }
        if (uploadError.message?.includes("policy") || uploadError.message?.includes("permission")) {
          throw new Error("Upload permission denied. Please ensure you're logged in with a valid account.");
        }
        throw new Error(`Storage upload failed: ${uploadError.message}`);
      }

      console.log("✅ SwatchUploader: Upload successful, path:", uploadData.path);

      const { data: { publicUrl } } = supabase.storage
        .from("patterns")
        .getPublicUrl(uploadData.path);

      console.log("🔗 SwatchUploader: Public URL:", publicUrl);

      // Call AI analysis edge function
      console.log("🤖 SwatchUploader: Calling analyze-vinyl-swatch function...");
      const { data: analysisData, error: analysisError } = await renderClient.functions.invoke(
        "analyze-vinyl-swatch",
        {
          body: {
            swatchImageUrl: publicUrl,
            uploadedFileName: file.name,
          },
        }
      );

      if (analysisError) {
        console.error("❌ SwatchUploader: Analysis function error:", analysisError);
        throw new Error(`AI analysis failed: ${analysisError.message}`);
      }

      console.log("✅ SwatchUploader: Analysis complete:", analysisData);

      // Check for invalid swatch response (success: false means it's not a valid swatch)
      if (analysisData?.success === false || analysisData?.error) {
        console.log("⚠️ SwatchUploader: Invalid swatch detected:", analysisData?.error);
        toast({
          title: "Invalid Image",
          description: analysisData?.error || "This doesn't appear to be a vinyl swatch. Please upload a photo of a vinyl wrap swatch with visible manufacturer labeling.",
          variant: "destructive",
        });
        setUploadedFile(null);
        return;
      }

      // 🔒 HARD RULE: Check if label is readable
      const isReadable = isSwatchLabelReadable(analysisData.analysis);
      
      if (isReadable) {
        // ✅ AUTO-PROCEED: Label is readable, no modal needed
        console.log('✅ SwatchUploader: Label readable - auto-proceeding');
        completeWithAnalysis(publicUrl, analysisData.analysis);
      } else {
        // ⚠️ SHOW MODAL: Label is NOT readable, need user confirmation
        console.log('⚠️ SwatchUploader: Label NOT readable - showing modal');
        setPendingAnalysis({ publicUrl, analysisData: analysisData.analysis });
        setShowUnknownModal(true);
      }
      
    } catch (error: any) {
      console.error("❌ SwatchUploader: Full error details:", {
        message: error.message,
        name: error.name,
        stack: error.stack,
        error
      });
      
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to analyze swatch. Check console for details.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // Handle modal confirmation
  const handleModalConfirm = (selection: { manufacturer: string; colorName: string; finish: string }) => {
    if (pendingAnalysis) {
      completeWithAnalysis(pendingAnalysis.publicUrl, pendingAnalysis.analysisData, selection);
    }
  };

  // Handle modal skip (proceed with abstract preview)
  const handleModalSkip = () => {
    if (pendingAnalysis) {
      // Proceed with whatever AI detected (even if incomplete) - render will happen
      completeWithAnalysis(pendingAnalysis.publicUrl, pendingAnalysis.analysisData);
    }
  };

  return (
    <>
      <div className="space-y-4">
        <div className="border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
          <Input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            disabled={isUploading}
            className="hidden"
            id="swatch-upload"
          />
          <label
            htmlFor="swatch-upload"
            className="cursor-pointer flex flex-col items-center gap-3"
          >
            {isUploading ? (
              <Loader2 className="w-12 h-12 animate-spin text-primary" />
            ) : (
              <Upload className="w-12 h-12 text-muted-foreground" />
            )}
            <div>
              <p className="font-medium text-foreground">
                {uploadedFile ? uploadedFile.name : "Click to upload swatch photo"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                PNG, JPG, HEIC up to 10MB
              </p>
            </div>
          </label>
        </div>

        {isUploading && (
          <p className="text-xs text-center text-muted-foreground">
            Analyzing vinyl color and finish...
          </p>
        )}
      </div>

      {/* Unknown Swatch Modal - only shows when label is unreadable */}
      <UnknownSwatchModal
        open={showUnknownModal}
        onClose={() => {
          setShowUnknownModal(false);
          setPendingAnalysis(null);
        }}
        swatchImageUrl={pendingAnalysis?.publicUrl || ''}
        onConfirm={handleModalConfirm}
        onSkip={handleModalSkip}
      />
    </>
  );
}
