import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Upload, Loader2 } from "lucide-react";
import { processPanelImage, uploadPanelImages } from "@/lib/panel-processor";

interface PanelUploaderProps {
  onPanelUploaded: (panel: any) => void;
}

export const PanelUploader = ({ onPanelUploaded }: PanelUploaderProps) => {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadedPanel, setUploadedPanel] = useState<any>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file",
        description: "Please upload an image file",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);

    try {
      // Check auth session before upload
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({
          title: "Session expired",
          description: "Please log out and log back in to upload files",
          variant: "destructive",
        });
        setIsUploading(false);
        return;
      }

      // Process panel image to remove dimension text
      const { cleanDataUrl, originalBlob } = await processPanelImage(file);
      
      // Upload both versions to storage
      const { originalUrl, cleanUrl } = await uploadPanelImages(
        originalBlob,
        cleanDataUrl,
        file.name,
        supabase,
        session.user?.id
      );

      const panelUrl = originalUrl; // AI uses original with full context

      // Analyze with AI
      setIsAnalyzing(true);
      const { data: analysisData, error: analysisError } = await renderClient.functions.invoke(
        'analyze-panel-design',
        { body: { panelImageUrl: panelUrl } }
      );

      if (analysisError) throw analysisError;

      // Save to database with both URLs
      const { data: panelData, error: dbError } = await supabase
        .from('designpanelpro_patterns')
        .insert({
          name: file.name.replace(/\.[^/.]+$/, ""),
          ai_generated_name: analysisData.name,
          category: 'Custom',
          media_url: panelUrl, // Original for AI
          clean_display_url: cleanUrl, // Clean for display
          is_curated: false,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      setUploadedPanel(panelData);
      onPanelUploaded(panelData);

      toast({
        title: "Panel uploaded successfully",
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
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <Label htmlFor="panel-upload" className="text-lg font-semibold">
            Upload Custom Panel Design
          </Label>
          <p className="text-sm text-muted-foreground mt-1">
            Panel Size: 186" x 56" • Landscape orientation • High resolution recommended
          </p>
        </div>

        <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors">
          <Input
            id="panel-upload"
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            disabled={isUploading || isAnalyzing}
            className="hidden"
          />
          <Label
            htmlFor="panel-upload"
            className="cursor-pointer flex flex-col items-center gap-2"
          >
            {isUploading || isAnalyzing ? (
              <>
                <Loader2 className="w-12 h-12 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {isUploading ? "Uploading..." : "AI analyzing design..."}
                </span>
              </>
            ) : (
              <>
                <Upload className="w-12 h-12 text-muted-foreground" />
                <span className="text-sm font-medium">Click to upload panel design</span>
                <span className="text-xs text-muted-foreground">
                  PNG, JPG, or WEBP (max 20MB)
                </span>
              </>
            )}
          </Label>
        </div>

        {uploadedPanel && (
          <Card className="p-4 bg-secondary/50">
            <p className="text-sm font-medium">
              AI Generated Name: <span className="text-primary">{uploadedPanel.ai_generated_name}</span>
            </p>
          </Card>
        )}
      </div>
    </Card>
  );
};
