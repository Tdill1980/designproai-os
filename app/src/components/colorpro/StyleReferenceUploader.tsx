import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, X, Image, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface StyleReferenceUploaderProps {
  onReferenceUploaded: (url: string | null, description?: string) => void;
  referenceUrl: string | null;
  className?: string;
}

export const StyleReferenceUploader = ({
  onReferenceUploaded,
  referenceUrl,
  className
}: StyleReferenceUploaderProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please upload an image file (JPG, PNG, WebP)",
        variant: "destructive"
      });
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload an image smaller than 10MB",
        variant: "destructive"
      });
      return;
    }

    setIsUploading(true);

    try {
      // Get user for folder organization
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || 'anonymous';
      
      // Generate unique filename
      const timestamp = Date.now();
      const ext = file.name.split('.').pop();
      const filePath = `style-references/${userId}/${timestamp}.${ext}`;

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from('patterns')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      if (error) throw error;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('patterns')
        .getPublicUrl(filePath);

      onReferenceUploaded(publicUrl, description);
      
      toast({
        title: "Reference uploaded!",
        description: "Your styling inspiration image is ready to use"
      });
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload reference image",
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleClearReference = () => {
    onReferenceUploaded(null);
    setDescription("");
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card className={cn("p-4 bg-secondary/30 border-border/50", className)}>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Image className="w-4 h-4 text-primary" />
            Style Reference (Optional)
          </Label>
          {referenceUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearReference}
              className="h-7 text-xs text-muted-foreground hover:text-destructive"
            >
              <X className="w-3 h-3 mr-1" />
              Clear
            </Button>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Upload a photo of styling you like - the AI will study it to guide your custom design
        </p>

        {referenceUrl ? (
          <div className="relative aspect-video rounded-lg overflow-hidden border border-border">
            <img
              src={referenceUrl}
              alt="Style reference"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-2 left-2 right-2">
              <span className="text-xs text-white/90 bg-black/50 px-2 py-1 rounded">
                Reference uploaded ✓
              </span>
            </div>
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed border-border/60 rounded-lg p-6 cursor-pointer",
              "hover:border-primary/50 hover:bg-primary/5 transition-all",
              "flex flex-col items-center justify-center gap-2",
              isUploading && "pointer-events-none opacity-70"
            )}
          >
            {isUploading ? (
              <>
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <span className="text-sm text-muted-foreground">Uploading...</span>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Click to upload inspiration photo
                </span>
                <span className="text-xs text-muted-foreground/70">
                  JPG, PNG, WebP • Max 10MB
                </span>
              </>
            )}
          </div>
        )}

        <Input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {referenceUrl && (
          <div>
            <Label className="text-xs text-muted-foreground mb-1">
              Describe what you like about this reference (optional)
            </Label>
            <Textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                onReferenceUploaded(referenceUrl, e.target.value);
              }}
              placeholder="e.g., I like the two-tone hood, the pinstripe placement along the body lines..."
              className="bg-background border-border/50 text-sm min-h-[60px]"
            />
          </div>
        )}
      </div>
    </Card>
  );
};
