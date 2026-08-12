import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, ImageIcon, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

const SECTION_KEY = "section:graphicspro-hero";

async function compressImage(file: File, maxDim = 2400, quality = 0.85): Promise<{ base64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      const isPng = file.type === "image/png";
      const mimeType = isPng ? "image/png" : "image/jpeg";
      const dataUrl = canvas.toDataURL(mimeType, quality);
      const base64 = dataUrl.split(",")[1];
      resolve({ base64, contentType: mimeType });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}

const AdminGraphicsProHero = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: heroImage, isLoading } = useQuery({
    queryKey: ["graphicspro_hero_image"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homepage_showcase")
        .select("*")
        .eq("name", SECTION_KEY)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      setUploading(true);

      const { base64, contentType } = await compressImage(file);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileName = `graphicspro-hero-${Date.now()}-${safeName}`;

      const { data: result, error } = await supabase.functions.invoke("admin-manage-showcase", {
        body: {
          action: "upload_and_insert",
          file_base64: base64,
          file_name: fileName,
          content_type: contentType,
          data: {
            name: SECTION_KEY,
            title: "GraphicsPro Hero Banner",
            alt_text: "GraphicsPro hero banner",
            sort_order: 0,
            is_active: true,
          },
        },
      });

      if (error) throw error;
      if (result?.error) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["graphicspro_hero_image"] });
      toast({ title: "Hero image updated" });
      setFile(null);
      setPreview(null);
      setUploading(false);
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
      setUploading(false);
    },
  });

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/admin">
            <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4 mr-1" /> Admin</Button>
          </Link>
          <h1 className="text-xl font-bold text-foreground">GraphicsPro Hero Image</h1>
        </div>

        {/* Current Image */}
        <Card className="p-4 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">Current Hero Banner</h2>
          {isLoading ? (
            <div className="h-40 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : heroImage?.image_url ? (
            <img src={heroImage.image_url} alt="Current hero" className="w-full h-48 object-cover rounded-lg border border-border" />
          ) : (
            <div className="h-40 flex flex-col items-center justify-center bg-secondary/30 rounded-lg border border-border">
              <ImageIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Using default (hero-mustang.jpg)</p>
            </div>
          )}
        </Card>

        {/* Upload New */}
        <Card className="p-4 space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground">Upload New Hero Image</h2>
          <p className="text-xs text-muted-foreground">Wide landscape image recommended (1920x600 or similar). JPG or PNG.</p>

          <label className="block border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-blue-500/50 transition-colors">
            {preview ? (
              <img src={preview} alt="Preview" className="w-full h-40 object-cover rounded-lg mb-2" />
            ) : (
              <div className="space-y-2">
                <Upload className="w-8 h-8 mx-auto text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">Click to select image</p>
              </div>
            )}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFileSelect} />
          </label>

          {file && (
            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={uploading}
              className="w-full bg-gradient-to-r from-blue-600 via-purple-600 to-fuchsia-600 text-white"
            >
              {uploading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading...</> : "Save Hero Image"}
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
};

export default AdminGraphicsProHero;
