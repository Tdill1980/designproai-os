import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Upload, Loader2, Link as LinkIcon } from "lucide-react";
import { processPanelImage, uploadPanelImages } from "@/lib/panel-processor";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface WBTYPatternUploaderProps {
  onPatternUploaded: (pattern: any) => void;
}

export const WBTYPatternUploader = ({ onPatternUploaded }: WBTYPatternUploaderProps) => {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadedPattern, setUploadedPattern] = useState<any>(null);
  const [imageUrl, setImageUrl] = useState("");

  const finishImport = async (
    patternUrl: string,
    cleanUrl: string | undefined,
    fallbackName: string,
  ) => {
    // AI analysis for design name
    setIsAnalyzing(true);
    let aiName = fallbackName;
    try {
      const { data: analysisData, error: analysisError } = await renderClient.functions.invoke(
        'analyze-panel-design',
        { body: { panelImageUrl: patternUrl } }
      );
      if (!analysisError && analysisData?.name) {
        aiName = analysisData.name;
      }
    } catch {
      // optional
    }

    const { data: patternData, error: dbError } = await supabase
      .from('wbty_products')
      .insert({
        name: aiName,
        category: 'Custom',
        media_url: patternUrl,
        media_type: 'image',
        price: 95.50,
        is_active: true,
      })
      .select()
      .single();

    if (dbError) throw dbError;

    const enrichedPattern = {
      ...patternData,
      ai_generated_name: aiName,
      clean_display_url: cleanUrl ?? patternUrl,
    };

    setUploadedPattern(enrichedPattern);
    onPatternUploaded(enrichedPattern);

    toast({
      title: "Pattern ready",
      description: `AI Design Name: "${aiName}" — pick a vehicle and generate.`,
    });
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({ title: "Invalid file", description: "Please upload an image file", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "File too large", description: "Please upload an image smaller than 20MB", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Session expired", description: "Please log out and log back in to upload files", variant: "destructive" });
        setIsUploading(false);
        return;
      }

      const { cleanDataUrl, originalBlob } = await processPanelImage(file);
      const { originalUrl, cleanUrl } = await uploadPanelImages(
        originalBlob,
        cleanDataUrl,
        file.name,
        supabase,
        session.user?.id
      );

      await finishImport(originalUrl, cleanUrl, file.name.replace(/\.[^/.]+$/, ""));
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
      setIsAnalyzing(false);
    }
  };

  const handleUrlImport = async () => {
    const url = imageUrl.trim();
    if (!url) {
      toast({ title: "URL required", description: "Paste an image URL", variant: "destructive" });
      return;
    }

    if (!/^https?:\/\//i.test(url)) {
      toast({ title: "Invalid URL", description: "URL must start with http:// or https://", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Session expired", description: "Please log out and log back in", variant: "destructive" });
        setIsUploading(false);
        return;
      }

      // Fetch the image as a blob (handles CORS via no-cors fallback)
      let blob: Blob;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        blob = await res.blob();
      } catch (fetchErr) {
        // Fallback: route through edge function to bypass CORS
        const { data, error } = await renderClient.functions.invoke('proxy-image-fetch', {
          body: { url },
        });
        if (error || !data?.dataUrl) {
          throw new Error(`Could not fetch image. Try downloading it and using the file upload tab. (${(fetchErr as Error).message})`);
        }
        const r = await fetch(data.dataUrl);
        blob = await r.blob();
      }

      if (!blob.type.startsWith('image/')) {
        throw new Error(`URL did not return an image (got ${blob.type || 'unknown'})`);
      }
      if (blob.size > 20 * 1024 * 1024) {
        throw new Error('Image is larger than 20MB');
      }

      // Build a File so we can reuse the existing pipeline
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const filename = `pattern-from-url.${ext}`;
      const file = new File([blob], filename, { type: blob.type });

      const { cleanDataUrl, originalBlob } = await processPanelImage(file);
      const { originalUrl, cleanUrl } = await uploadPanelImages(
        originalBlob,
        cleanDataUrl,
        filename,
        supabase,
        session.user?.id,
      );

      await finishImport(originalUrl, cleanUrl, "Custom Pattern");
      setImageUrl("");
    } catch (error: any) {
      console.error('URL import error:', error);
      toast({ title: "URL import failed", description: error.message, variant: "destructive" });
    } finally {
      setIsUploading(false);
      setIsAnalyzing(false);
    }
  };

  const busy = isUploading || isAnalyzing;

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div>
          <Label className="text-lg font-semibold">Custom Pattern</Label>
          <p className="text-sm text-muted-foreground mt-1">
            Upload your own pattern OR paste any image URL from online (Google, Pinterest, Instagram, etc.)
          </p>
        </div>

        <Tabs defaultValue="file">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="file">
              <Upload className="w-4 h-4 mr-2" />
              Upload File
            </TabsTrigger>
            <TabsTrigger value="url">
              <LinkIcon className="w-4 h-4 mr-2" />
              Paste URL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="mt-4">
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary transition-colors">
              <Input
                id="wbty-upload"
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                disabled={busy}
                className="hidden"
              />
              <Label htmlFor="wbty-upload" className="cursor-pointer flex flex-col items-center gap-2">
                {busy ? (
                  <>
                    <Loader2 className="w-12 h-12 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {isAnalyzing ? "AI analyzing pattern..." : "Uploading..."}
                    </span>
                  </>
                ) : (
                  <>
                    <Upload className="w-12 h-12 text-muted-foreground" />
                    <span className="text-sm font-medium">Click to upload pattern</span>
                    <span className="text-xs text-muted-foreground">PNG, JPG, or WEBP (max 20MB)</span>
                  </>
                )}
              </Label>
            </div>
          </TabsContent>

          <TabsContent value="url" className="mt-4 space-y-3">
            <div>
              <Label htmlFor="pattern-url" className="text-sm font-medium">Image URL</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Right-click any image online → "Copy image address" → paste here
              </p>
              <div className="flex gap-2">
                <Input
                  id="pattern-url"
                  type="url"
                  placeholder="https://example.com/pattern.jpg"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  disabled={busy}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleUrlImport(); }}
                />
                <Button onClick={handleUrlImport} disabled={busy || !imageUrl.trim()}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Import"}
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground bg-secondary/40 rounded-md p-3 space-y-1">
              <p className="font-medium">Tips:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Use a direct image URL (ending in .jpg, .png, .webp)</li>
                <li>Higher resolution = better render quality</li>
                <li>Tileable / seamless patterns work best</li>
                <li>If a URL fails, download the image and use the Upload File tab</li>
              </ul>
            </div>
          </TabsContent>
        </Tabs>

        {uploadedPattern && (
          <Card className="p-4 bg-secondary/50">
            <div className="flex items-center gap-3">
              <img
                src={uploadedPattern.clean_display_url || uploadedPattern.media_url}
                alt={uploadedPattern.ai_generated_name || uploadedPattern.name}
                className="w-16 h-16 object-cover rounded-md border border-border"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {uploadedPattern.ai_generated_name || uploadedPattern.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  Ready — pick a vehicle and click Generate 3D Proof
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </Card>
  );
};
