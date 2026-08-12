import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Upload, Loader2, X, Check, Sparkles } from "lucide-react";
import { extractColorsFromImage } from "@/lib/color-extractor";

interface FileMetadata {
  file: File;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  colorName: string;
  colorHex: string;
  finishType: string;
  modeType: string;
  preview?: string;
}

const AdminRenderUpload = () => {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzingIndex, setAnalyzingIndex] = useState<number | null>(null);
  const [fileMetadata, setFileMetadata] = useState<FileMetadata[]>([]);
  const [currentStep, setCurrentStep] = useState<"select" | "review">("select");

  const parseFilename = (filename: string) => {
    // Remove extension and convert to lowercase for matching
    const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
    const lower = nameWithoutExt.toLowerCase();
    
    // Split by common delimiters
    const parts = nameWithoutExt.split(/[-_\s]+/).filter(p => p.length > 0);
    
    let year = "";
    let make = "";
    let model = "";
    let color = "";
    let finish = "gloss";
    
    // Find year (4 digits anywhere in filename)
    const yearMatch = parts.find(p => /^\d{4}$/.test(p));
    if (yearMatch) {
      year = yearMatch;
    }
    
    // Find finish keywords (case-insensitive)
    const finishKeywords = ["gloss", "matte", "satin", "metallic"];
    const finishMatch = parts.find(p => finishKeywords.includes(p.toLowerCase()));
    if (finishMatch) {
      finish = finishMatch.toLowerCase();
    }
    
    // Remove view types, finish, and year from parts to get make/model/color
    const viewTypes = ["front", "rear", "side", "top", "hood", "detail", "angle"];
    const cleanParts = parts.filter(p => {
      const pLower = p.toLowerCase();
      return p !== yearMatch && 
             p !== finishMatch && 
             !viewTypes.includes(pLower) &&
             !/^\d+$/.test(p); // Remove any other numbers
    });
    
    // Common vehicle makes (add more as needed)
    const commonMakes = ["ford", "chevy", "chevrolet", "dodge", "ram", "toyota", "honda", 
                         "nissan", "bmw", "mercedes", "audi", "porsche", "tesla", "jeep",
                         "gmc", "cadillac", "lexus", "infiniti", "acura", "mazda", "subaru",
                         "volkswagen", "vw", "hyundai", "kia", "volvo"];
    
    // Try to find make in parts
    const makeMatch = cleanParts.find(p => commonMakes.includes(p.toLowerCase()));
    if (makeMatch) {
      make = makeMatch.charAt(0).toUpperCase() + makeMatch.slice(1).toLowerCase();
      const makeIndex = cleanParts.indexOf(makeMatch);
      
      // Model is likely the next part after make
      if (cleanParts[makeIndex + 1]) {
        model = cleanParts[makeIndex + 1].charAt(0).toUpperCase() + cleanParts[makeIndex + 1].slice(1).toLowerCase();
      }
      
      // Color is anything remaining after make and model
      if (cleanParts.length > makeIndex + 2) {
        color = cleanParts.slice(makeIndex + 2).map(p => 
          p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
        ).join(" ");
      }
    } else if (cleanParts.length >= 2) {
      // If no known make found, assume first part is make, second is model
      make = cleanParts[0].charAt(0).toUpperCase() + cleanParts[0].slice(1).toLowerCase();
      model = cleanParts[1].charAt(0).toUpperCase() + cleanParts[1].slice(1).toLowerCase();
      if (cleanParts.length > 2) {
        color = cleanParts.slice(2).map(p => 
          p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
        ).join(" ");
      }
    }
    
    console.log("Parsed filename:", filename, "→", { year, make, model, color, finish });
    
    return { year, make, model, color, finish };
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    
    setIsAnalyzing(true);
    const selectedFiles = Array.from(e.target.files);
    const metadata: FileMetadata[] = [];
    
    for (const file of selectedFiles) {
      const parsed = parseFilename(file.name);
      let detectedHex = "#000000";
      
      try {
        const colors = await extractColorsFromImage(file);
        detectedHex = colors.primary;
      } catch (error) {
        console.error("Color extraction failed:", error);
      }
      
      // Create preview URL
      const preview = URL.createObjectURL(file);
      
      metadata.push({
        file,
        vehicleMake: parsed.make || "",
        vehicleModel: parsed.model || "",
        vehicleYear: parsed.year || "",
        colorName: parsed.color || "",
        colorHex: detectedHex,
        finishType: parsed.finish,
        modeType: "ColorPro",
        preview
      });
    }
    
    setFileMetadata(metadata);
    setIsAnalyzing(false);
    setCurrentStep("review");
  };

  const handleSmartFill = async (index: number) => {
    const item = fileMetadata[index];
    setAnalyzingIndex(index);

    try {
      // Convert file to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(item.file);
      });

      const imageData = await base64Promise;

      // Call edge function to analyze image
      const { data, error } = await renderClient.functions.invoke('analyze-vehicle-image', {
        body: { imageData }
      });

      if (error) throw error;

      if (data.success) {
        const aiData = data.data;
        setFileMetadata(prev => prev.map((m, i) => 
          i === index ? {
            ...m,
            vehicleMake: aiData.make || m.vehicleMake,
            vehicleModel: aiData.model || m.vehicleModel,
            vehicleYear: aiData.year || m.vehicleYear,
            colorName: aiData.color || m.colorName,
            finishType: aiData.finish || m.finishType
          } : m
        ));

        toast({
          title: "AI Analysis Complete",
          description: `Detected: ${aiData.make} ${aiData.model} in ${aiData.color}`
        });
      } else {
        throw new Error(data.error || "AI analysis failed");
      }
    } catch (error) {
      console.error("Smart fill error:", error);
      toast({
        title: "AI Analysis Failed",
        description: "Could not analyze image. Please fill manually.",
        variant: "destructive"
      });
    } finally {
      setAnalyzingIndex(null);
    }
  };

  const updateMetadata = (index: number, field: keyof FileMetadata, value: string) => {
    setFileMetadata(prev => prev.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ));
  };

  const removeFile = (index: number) => {
    setFileMetadata(prev => prev.filter((_, i) => i !== index));
  };

  const handleBulkUpload = async () => {
    if (!fileMetadata.length) {
      toast({ title: "Error", description: "No files to upload", variant: "destructive" });
      return;
    }

    // Validate only essential fields (make, model, color)
    const invalidFiles = fileMetadata.filter(m => 
      !m.vehicleMake || !m.vehicleModel || !m.colorName
    );
    
    if (invalidFiles.length > 0) {
      const missingInfo = invalidFiles.map(f => {
        const missing = [];
        if (!f.vehicleMake) missing.push("Make");
        if (!f.vehicleModel) missing.push("Model");
        if (!f.colorName) missing.push("Color");
        return `${f.file.name}: ${missing.join(", ")}`;
      }).join("\n");
      
      console.log("Files with missing data:", missingInfo);
      
      toast({ 
        title: "Missing Required Fields", 
        description: `Please fill Make, Model, and Color for all images. Use Smart Fill or edit manually.`,
        variant: "destructive",
        duration: 5000
      });
      return;
    }

    setIsUploading(true);

    try {
      let successCount = 0;

      for (const metadata of fileMetadata) {
        const renderUrls: Record<string, string> = {};
        const fileName = `${Date.now()}_${metadata.vehicleMake}_${metadata.vehicleModel}_${metadata.file.name}`;
        const filePath = `renders/${metadata.modeType}/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("wrap-files")
          .upload(filePath, metadata.file);

        if (uploadError) {
          console.error("Upload error:", uploadError);
          continue;
        }

        const { data: { publicUrl } } = supabase.storage
          .from("wrap-files")
          .getPublicUrl(filePath);

        // Determine view type from filename
        const viewType = metadata.file.name.toLowerCase().includes("front") ? "front" :
                        metadata.file.name.toLowerCase().includes("rear") ? "rear" :
                        metadata.file.name.toLowerCase().includes("side") ? "side" :
                        metadata.file.name.toLowerCase().includes("top") ? "top" :
                        metadata.file.name.toLowerCase().includes("hood") ? "hood_detail" :
                        "main";

        renderUrls[viewType] = publicUrl;

        const { error: dbError } = await supabase
          .from("color_visualizations")
          .insert({
            customer_email: "admin@restylepro.com",
            vehicle_make: metadata.vehicleMake,
            vehicle_model: metadata.vehicleModel,
            vehicle_year: metadata.vehicleYear ? parseInt(metadata.vehicleYear) : 2020,
            color_name: metadata.colorName,
            color_hex: metadata.colorHex,
            finish_type: metadata.finishType,
            mode_type: metadata.modeType,
            render_urls: renderUrls,
            generation_status: "completed",
            subscription_tier: "admin"
          });

        if (!dbError) successCount++;
      }

      toast({ 
        title: "Upload Complete", 
        description: `Successfully uploaded ${successCount} of ${fileMetadata.length} renders` 
      });

      // Reset
      setFileMetadata([]);
      setCurrentStep("select");
      const fileInput = document.getElementById("file-input") as HTMLInputElement | null;
      if (fileInput) {
        fileInput.value = "";
      }

    } catch (error) {
      console.error("Bulk upload error:", error);
      toast({ 
        title: "Error", 
        description: "Failed to complete bulk upload", 
        variant: "destructive" 
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Bulk Upload Renders</h1>
            <p className="text-muted-foreground">Upload multiple renders with auto-detected metadata</p>
          </div>

          {currentStep === "select" && (
            <Card>
              <CardHeader>
                <CardTitle>Select Images</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="file-input">Choose Render Images</Label>
                  <Input
                    id="file-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileSelect}
                    className="cursor-pointer"
                    disabled={isAnalyzing}
                  />
                  <p className="text-sm text-muted-foreground">
                    📋 Supported formats: year_make_model_color_finish.jpg or make-model-year-color.png
                    <br />
                    💡 Examples: "2022_ford_raptor_blue_gloss.jpg", "ford-raptor-2022-red.png", "rat-rod-1932-matte-black.jpg"
                    <br />
                    ✨ Auto-detects: Year (4 digits), Make/Model (from common brands), Color (remaining text), Finish (gloss/matte/satin/metallic)
                  </p>
                </div>
                
                {isAnalyzing && (
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Analyzing images and extracting colors...
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {currentStep === "review" && fileMetadata.length > 0 && (
            <>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Review and edit metadata for {fileMetadata.length} images
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    💡 Tip: Use "Smart Fill" button on each image for AI auto-detection
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  onClick={() => {
                    setFileMetadata([]);
                    setCurrentStep("select");
                  }}
                >
                  Start Over
                </Button>
              </div>

              <div className="space-y-4">
                {fileMetadata.map((item, index) => (
                  <Card key={index}>
                    <CardContent className="pt-6">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Preview */}
                        <div className="space-y-2">
                          {item.preview && (
                            <img 
                              src={item.preview} 
                              alt="Preview" 
                              className="w-full h-32 object-cover rounded border border-border"
                            />
                          )}
                          <p className="text-xs text-muted-foreground truncate" title={item.file.name}>
                            {item.file.name}
                          </p>
                          {(!item.vehicleMake || !item.vehicleModel || !item.colorName) && (
                            <div className="text-xs">
                              <p className="text-yellow-500 font-medium">⚠️ Missing:</p>
                              {!item.vehicleMake && <p className="text-yellow-500">• Make</p>}
                              {!item.vehicleModel && <p className="text-yellow-500">• Model</p>}
                              {!item.colorName && <p className="text-yellow-500">• Color</p>}
                            </div>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleSmartFill(index)}
                            disabled={analyzingIndex === index}
                            className="w-full h-8"
                          >
                            {analyzingIndex === index ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                Analyzing...
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-3 h-3 mr-1" />
                                Smart Fill
                              </>
                            )}
                          </Button>
                        </div>

                        {/* Vehicle Info */}
                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs">Make *</Label>
                            <Input
                              value={item.vehicleMake}
                              onChange={(e) => updateMetadata(index, "vehicleMake", e.target.value)}
                              placeholder="Ford"
                              className="h-8"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Model *</Label>
                            <Input
                              value={item.vehicleModel}
                              onChange={(e) => updateMetadata(index, "vehicleModel", e.target.value)}
                              placeholder="Raptor"
                              className="h-8"
                            />
                          </div>
                        </div>

                        {/* Color Info */}
                        <div className="space-y-3">
                          <div>
                            <Label className="text-xs">Year (optional)</Label>
                            <Input
                              value={item.vehicleYear}
                              onChange={(e) => updateMetadata(index, "vehicleYear", e.target.value)}
                              placeholder="2020"
                              className="h-8"
                            />
                          </div>
                          <div>
                            <Label className="text-xs">Color Name *</Label>
                            <Input
                              value={item.colorName}
                              onChange={(e) => updateMetadata(index, "colorName", e.target.value)}
                              placeholder="Blue"
                              className="h-8"
                            />
                          </div>
                        </div>

                        {/* Settings */}
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <Label className="text-xs">Hex</Label>
                              <Input
                                type="color"
                                value={item.colorHex}
                                onChange={(e) => updateMetadata(index, "colorHex", e.target.value)}
                                className="h-8"
                              />
                            </div>
                            <div className="flex-1">
                              <Label className="text-xs">Finish</Label>
                              <Select 
                                value={item.finishType} 
                                onValueChange={(v) => updateMetadata(index, "finishType", v)}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="gloss">Gloss</SelectItem>
                                  <SelectItem value="matte">Matte</SelectItem>
                                  <SelectItem value="satin">Satin</SelectItem>
                                  <SelectItem value="metallic">Metallic</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">Tool</Label>
                            <Select 
                              value={item.modeType} 
                              onValueChange={(v) => updateMetadata(index, "modeType", v)}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ColorPro">ColorPro</SelectItem>
                                <SelectItem value="fadewraps">FadeWraps</SelectItem>
                                <SelectItem value="designpanelpro">DesignProAI</SelectItem>
                                <SelectItem value="wbty">WBTY</SelectItem>
                                <SelectItem value="approvemode">ApproveMode</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeFile(index)}
                            className="w-full h-8"
                          >
                            <X className="w-4 h-4 mr-1" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Button 
                onClick={handleBulkUpload} 
                disabled={isUploading}
                size="lg"
                className="w-full"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading {fileMetadata.length} renders...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Upload All {fileMetadata.length} Renders
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </main>

    </div>
  );
};

export default AdminRenderUpload;
