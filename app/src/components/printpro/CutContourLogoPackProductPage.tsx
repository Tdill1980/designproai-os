import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PrintProCard, PrintProCardHeader, PrintProCardTitle, PrintProCardDescription, PrintProCardContent } from "./PrintProCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Scissors, Upload, Loader2, ArrowRight, CheckCircle2 } from "lucide-react";
import { useCutFiles } from "@/hooks/useCutFiles";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const COMPATIBLE_RIPS = ["VersaWorks", "Onyx", "Caldera", "Flexi", "SAi", "EFI Fiery"];
const CUT_MODES = ["Contour", "Kiss Cut", "Perf Cut", "Through Cut"];

const CutContourLogoPackProductPage = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isGeneratingCutFiles, handleGenerateCutFiles } = useCutFiles();

  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (PNG, JPG, or WEBP).");
      return;
    }

    setUploadedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleGenerate = async () => {
    if (!uploadedFile) {
      toast.error("Please upload a render image first.");
      return;
    }

    setIsUploading(true);
    try {
      // Upload the file to Supabase storage
      const fileName = `cut-contour-uploads/${Date.now()}-${uploadedFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("renders")
        .upload(fileName, uploadedFile, { contentType: uploadedFile.type });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("renders").getPublicUrl(fileName);
      const publicUrl = urlData?.publicUrl;

      if (!publicUrl) throw new Error("Could not get public URL for uploaded file.");

      // Call the cut files generator via the hook
      await handleGenerateCutFiles({
        id: `upload-${Date.now()}`,
        render_urls: { roof: publicUrl },
        design_file_name: uploadedFile.name.replace(/\.[^.]+$/, ""),
      });
    } catch (err: any) {
      console.error("Upload error:", err);
      toast.error(err.message || "Failed to upload file.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-5xl">
        {/* Hero */}
        <PrintProCard className="mb-8">
          <PrintProCardHeader>
            <PrintProCardTitle>
              <span className="text-foreground">Cut Contour</span>
              <span className="text-gradient-designpro"> Logo Pack™</span>
            </PrintProCardTitle>
            <PrintProCardDescription>
              AI-extracted vector cut files with CutContour spot color - ready for your RIP software. Upload any render or design image and get production-ready cut paths in seconds.
            </PrintProCardDescription>
          </PrintProCardHeader>
        </PrintProCard>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Upload & Generate */}
          <PrintProCard>
            <PrintProCardHeader>
              <PrintProCardTitle className="text-lg">Upload Your Design</PrintProCardTitle>
              <PrintProCardDescription>
                Upload a render or design image to extract logo and text elements as cut-ready contour files.
              </PrintProCardDescription>
            </PrintProCardHeader>
            <PrintProCardContent className="space-y-4">
              <div
                className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {previewUrl ? (
                  <div className="space-y-3">
                    <img src={previewUrl} alt="Upload preview" className="max-h-48 mx-auto rounded-md" />
                    <p className="text-sm text-muted-foreground">{uploadedFile?.name}</p>
                    <p className="text-xs text-muted-foreground">Click to replace</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-10 h-10 mx-auto text-muted-foreground" />
                    <p className="text-sm font-medium">Click to upload render image</p>
                    <p className="text-xs text-muted-foreground">PNG, JPG, or WEBP</p>
                  </div>
                )}
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              <Button
                className="w-full bg-purple-600 hover:bg-purple-700 text-white h-11"
                onClick={handleGenerate}
                disabled={!uploadedFile || isGeneratingCutFiles || isUploading}
              >
                {isGeneratingCutFiles || isUploading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Cut Files...</>
                ) : (
                  <><Scissors className="w-4 h-4 mr-2" /> Generate Cut Contour Logo Pack</>
                )}
              </Button>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => navigate("/productionflow?tool=cut_map")}
              >
                <ArrowRight className="w-4 h-4 mr-2" /> Open in Production Flow
              </Button>
            </PrintProCardContent>
          </PrintProCard>

          {/* What's Included */}
          <div className="space-y-6">
            <PrintProCard>
              <PrintProCardHeader>
                <PrintProCardTitle className="text-lg">What's Included</PrintProCardTitle>
              </PrintProCardHeader>
              <PrintProCardContent className="space-y-3">
                {[
                  "SVG cut file with vector contour paths",
                  "PNG overlay with CutContour spot color (#FF00FF)",
                  "Magenta spot layer at 0.25pt stroke, zero fill",
                  "Background removal + silhouette contour",
                  "Individual element extraction (logos & text)",
                  "Direct-to-RIP compatible output",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span className="text-sm text-muted-foreground">{item}</span>
                  </div>
                ))}
              </PrintProCardContent>
            </PrintProCard>

            <PrintProCard>
              <PrintProCardHeader>
                <PrintProCardTitle className="text-lg">Compatible RIP Software</PrintProCardTitle>
              </PrintProCardHeader>
              <PrintProCardContent>
                <div className="flex flex-wrap gap-2">
                  {COMPATIBLE_RIPS.map((rip) => (
                    <span
                      key={rip}
                      className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20"
                    >
                      {rip}
                    </span>
                  ))}
                </div>
              </PrintProCardContent>
            </PrintProCard>

            <PrintProCard>
              <PrintProCardHeader>
                <PrintProCardTitle className="text-lg">Supported Cut Modes</PrintProCardTitle>
              </PrintProCardHeader>
              <PrintProCardContent>
                <div className="flex flex-wrap gap-2">
                  {CUT_MODES.map((mode) => (
                    <span
                      key={mode}
                      className="px-3 py-1 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20"
                    >
                      {mode}
                    </span>
                  ))}
                </div>
              </PrintProCardContent>
            </PrintProCard>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CutContourLogoPackProductPage;
