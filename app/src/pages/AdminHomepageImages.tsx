import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Trash2, Upload, ImageIcon } from "lucide-react";
import { Link } from "react-router-dom";

const SECTIONS = [
  // ── RestyleDashboard hero carousel ─────────────────────────────
  // Pinned to the TOP so admins don't have to hunt for the ShopEngine
  // dashboard hero slots. These rotate on the Brand Hero card at
  // /dashboard. Leave blank to fall back to the user's own renders.
  { key: "section:dashboard-hero-1", label: "Dashboard Hero 1" },
  { key: "section:dashboard-hero-2", label: "Dashboard Hero 2" },
  { key: "section:dashboard-hero-3", label: "Dashboard Hero 3" },
  { key: "section:dashboard-hero-4", label: "Dashboard Hero 4" },
  { key: "section:dashboard-hero-5", label: "Dashboard Hero 5" },
  // ── Anchor tool card images ─────────────────────────────────
  // ColorPro + DesignProAI are the two anchor tools that get a
  // full-bleed hero image on the dashboard tool grid. Every other
  // tool keeps its icon tile. Add more section:tool-* rows later if
  // you want to promote another tool to image treatment.
  { key: "section:tool-colorpro", label: "ToolCard \u2014 ColorPro (Anchor)" },
  { key: "section:tool-designpro", label: "ToolCard \u2014 DesignProAI (Anchor)" },
  // ── Homepage (marketing) section images ──────────────────────
  { key: "section:founder", label: "Founder Photo" },
  { key: "section:feature-visionboardiq", label: "VisionBoardIQ\u2122 Example" },
  { key: "section:feature-prompt-designer", label: "Prompt-Based Designer Example" },
  { key: "section:feature-revisionstudioiq", label: "RevisionStudioIQ\u2122 Example" },
  { key: "section:feature-universalpanelizer", label: "UniversalPanelizer\u2122 Example" },
  { key: "section:feature-designvault", label: "DesignVault Example" },
  { key: "section:feature-wrapbox", label: "WrapBox Example" },
  { key: "section:feature-creatormarket", label: "CreatorMarket Example" },
];

/** Resize an image file to fit within maxDim and return a compressed JPEG/PNG base64 string */
async function compressImage(file: File, maxDim = 1200, quality = 0.82): Promise<{ base64: string; contentType: string }> {
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
      // Use original type if PNG, otherwise JPEG for better compression
      const isPng = file.type === "image/png";
      const mimeType = isPng ? "image/png" : "image/jpeg";
      const dataUrl = canvas.toDataURL(mimeType, quality);
      const base64 = dataUrl.split(",")[1];
      resolve({ base64, contentType: mimeType });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image for compression"));
    };
    img.src = url;
  });
}

const AdminHomepageImages = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploadFiles, setUploadFiles] = useState<Record<string, File | null>>({});
  const [uploadingSection, setUploadingSection] = useState<string | null>(null);

  const { data: sectionImages, isLoading } = useQuery({
    queryKey: ["homepage_section_images"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homepage_showcase")
        .select("*")
        .like("name", "section:%");
      if (error) throw error;
      return data;
    },
  });

  const getImageForSection = (sectionKey: string) => {
    return sectionImages?.find((img) => img.name === sectionKey) || null;
  };

  const uploadMutation = useMutation({
    mutationFn: async ({ sectionKey, label }: { sectionKey: string; label: string }) => {
      const file = uploadFiles[sectionKey];
      if (!file) {
        throw new Error("No file selected");
      }

      setUploadingSection(sectionKey);

      // Compress image client-side to avoid exceeding edge function body limits
      const { base64: fileBase64, contentType } = await compressImage(file);

      // Sanitize file name: strip spaces, parens, and special chars to avoid storage path issues
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileName = `section-${sectionKey.replace("section:", "")}-${Date.now()}-${safeName}`;

      // Upload file + insert DB row via Edge Function (bypasses both storage and table RLS)
      const { data: result, error } = await supabase.functions.invoke("admin-manage-showcase", {
        body: {
          action: "upload_and_insert",
          file_base64: fileBase64,
          file_name: fileName,
          content_type: contentType,
          data: {
            name: sectionKey,
            title: label,
            alt_text: label,
            sort_order: 0,
            is_active: true,
          },
        },
      });

      if (error) {
        // Try to extract the actual error message from the edge function response
        let msg: string | null = null;
        try {
          const ctx = (error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            msg = body?.error;
          }
        } catch { /* ignore parse failures */ }
        throw new Error(msg || error.message);
      }
      if (result?.error) throw new Error(result.error);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["homepage_section_images"] });
      toast({ title: "Success", description: `Image for "${variables.label}" uploaded successfully` });
      setUploadFiles((prev) => ({ ...prev, [variables.sectionKey]: null }));
      setUploadingSection(null);
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      });
      setUploadingSection(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("admin-manage-showcase", {
        body: { action: "delete", id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["homepage_section_images"] });
      toast({ title: "Deleted", description: "Section image removed successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen flex flex-col">

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="mb-6">
          <Button variant="ghost" asChild>
            <Link to="/admin">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Homepage Section Images</h1>
          <p className="text-muted-foreground">
            Upload example images for each section of the homepage. These appear as backgrounds behind feature cards and in the founder section.
          </p>
        </div>

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {SECTIONS.map((section) => (
              <Card key={section.key} className="p-6 animate-pulse">
                <div className="h-6 bg-muted rounded w-3/4 mb-4" />
                <div className="h-40 bg-muted rounded mb-4" />
                <div className="h-10 bg-muted rounded" />
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {SECTIONS.map((section) => {
              const existing = getImageForSection(section.key);
              const selectedFile = uploadFiles[section.key] || null;
              const isUploading = uploadingSection === section.key && uploadMutation.isPending;

              return (
                <Card key={section.key} className="p-6 border border-border bg-card">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-foreground">{section.label}</h3>
                    {existing && (
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => deleteMutation.mutate(existing.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  {existing ? (
                    <div className="mb-4 rounded-md overflow-hidden border border-border">
                      <img
                        src={existing.image_url}
                        alt={existing.alt_text || section.label}
                        className="w-full h-40 object-cover"
                      />
                    </div>
                  ) : (
                    <div className="mb-4 rounded-md border border-dashed border-border flex flex-col items-center justify-center h-40 bg-muted/30">
                      <ImageIcon className="w-10 h-10 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">No image uploaded</p>
                    </div>
                  )}

                  <div className="space-y-3">
                    <Input
                      type="file"
                      accept="image/*"
                      onChange={(e) =>
                        setUploadFiles((prev) => ({
                          ...prev,
                          [section.key]: e.target.files?.[0] || null,
                        }))
                      }
                    />
                    <Button
                      onClick={() =>
                        uploadMutation.mutate({
                          sectionKey: section.key,
                          label: section.label,
                        })
                      }
                      disabled={!selectedFile || isUploading}
                      className="w-full"
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {isUploading
                        ? "Uploading..."
                        : existing
                          ? "Replace Image"
                          : "Upload Image"}
                    </Button>
                  </div>

                  <p className="text-xs text-muted-foreground mt-3 break-all">{section.key}</p>
                </Card>
              );
            })}
          </div>
        )}
      </main>

    </div>
  );
};

export default AdminHomepageImages;
