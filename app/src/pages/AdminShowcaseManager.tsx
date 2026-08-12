import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Trash2, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";

const AdminShowcaseManager = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [imageName, setImageName] = useState("");
  const [imageTitle, setImageTitle] = useState("");
  const [sortOrder, setSortOrder] = useState(0);

  const { data: showcaseImages, isLoading } = useQuery({
    queryKey: ["homepage_showcase"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("homepage_showcase")
        .select("*")
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) {
        throw new Error("Please select an image file");
      }

      // Convert file to base64 for Edge Function upload
      const arrayBuffer = await uploadFile.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const fileBase64 = btoa(binary);

      const fileName = `showcase-${Date.now()}-${uploadFile.name}`;
      const autoName = imageName || uploadFile.name.replace(/\.[^.]+$/, '');
      const autoTitle = imageTitle || autoName;

      // Upload file + insert DB row via Edge Function (bypasses both storage and table RLS)
      const { data: result, error } = await supabase.functions.invoke("admin-manage-showcase", {
        body: {
          action: "upload_and_insert",
          file_base64: fileBase64,
          file_name: fileName,
          content_type: uploadFile.type || "image/png",
          data: {
            name: autoName,
            title: autoTitle,
            alt_text: `${autoTitle} showcase image`,
            sort_order: sortOrder,
          },
        },
      });

      if (error) throw error;
      if (result?.error) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["homepage_showcase"] });
      toast({ title: "Success", description: "Showcase image uploaded successfully" });
      setUploadFile(null);
      setImageName("");
      setImageTitle("");
      setSortOrder(0);
    },
    onError: (error: any) => {
      toast({ 
        title: "Upload Failed", 
        description: error.message,
        variant: "destructive" 
      });
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
      queryClient.invalidateQueries({ queryKey: ["homepage_showcase"] });
      toast({ title: "Deleted", description: "Showcase image removed successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Delete Failed", 
        description: error.message,
        variant: "destructive" 
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

        <div className="mb-8 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold mb-2">Homepage Showcase Manager</h1>
            <p className="text-muted-foreground">
              Manage the showcase images displayed in the "Explore Your Wrap in Hyper-Realistic 3D" section
            </p>
          </div>
          <a
            href="/#showcase"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/25 whitespace-nowrap"
          >
            👁 Preview on Homepage ↗
          </a>
        </div>

        {/* Upload Form */}
        <Card className="p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Upload New Showcase Image</h2>
          <div className="grid gap-4">
            <div>
              <Label htmlFor="image">Image File</Label>
              <Input
                id="image"
                type="file"
                accept="image/*"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
            </div>
            
            <div>
              <Label htmlFor="name">Name (optional - defaults to filename)</Label>
              <Input
                id="name"
                placeholder="Optional - auto-uses filename if blank"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="title">Display Title (optional - defaults to name)</Label>
              <Input
                id="title"
                placeholder="Optional - auto-uses name if blank"
                value={imageTitle}
                onChange={(e) => setImageTitle(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="sort">Sort Order</Label>
              <Input
                id="sort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
              />
            </div>

            <Button
              onClick={() => uploadMutation.mutate()}
              disabled={!uploadFile || uploadMutation.isPending}
              className="w-full"
            >
              <Upload className="w-4 h-4 mr-2" />
              {uploadMutation.isPending ? "Uploading..." : "Upload Showcase Image"}
            </Button>
          </div>
        </Card>

        {/* Existing Images */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Existing Showcase Images</h2>
          
          {isLoading ? (
            <div className="grid md:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-64" />
              ))}
            </div>
          ) : showcaseImages && showcaseImages.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              {showcaseImages.map((image) => (
                <Card key={image.id} className="overflow-hidden">
                  <img 
                    src={image.image_url} 
                    alt={image.alt_text}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-semibold">{image.title}</h3>
                        <p className="text-sm text-muted-foreground">{image.name}</p>
                        <p className="text-xs text-muted-foreground">Sort: {image.sort_order}</p>
                      </div>
                      <Button
                        variant="destructive"
                        size="icon"
                        onClick={() => deleteMutation.mutate(image.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No showcase images yet. Upload your first one above.
            </p>
          )}
        </div>
      </main>

    </div>
  );
};

export default AdminShowcaseManager;
