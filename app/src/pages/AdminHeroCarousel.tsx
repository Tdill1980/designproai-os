import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Trash2, Eye, EyeOff, ExternalLink } from "lucide-react";

const AdminHeroCarousel = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [link, setLink] = useState("");

  // Fetch hero carousel images
  const { data: carouselImages, isLoading } = useQuery({
    queryKey: ["hero_carousel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hero_carousel")
        .select("*")
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile || !sortOrder) {
        throw new Error("Please fill required fields (image, sort order)");
      }

      // Upload to storage
      const fileName = `hero/${Date.now()}_${uploadFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("carousel-images")
        .upload(fileName, uploadFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("carousel-images")
        .getPublicUrl(fileName);

      // Insert into database
      const { error: insertError } = await supabase
        .from("hero_carousel")
        .insert({
          image_url: publicUrl,
          title: title || null,
          subtitle: subtitle || null,
          link: link || null,
          sort_order: parseInt(sortOrder),
          is_active: true,
        });

      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hero_carousel"] });
      toast({ title: "Success", description: "Hero carousel image uploaded successfully" });
      setUploadFile(null);
      setTitle("");
      setSubtitle("");
      setSortOrder("");
      setLink("");
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to upload image",
        variant: "destructive" 
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("hero_carousel")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hero_carousel"] });
      toast({ title: "Success", description: "Image deleted successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to delete image",
        variant: "destructive" 
      });
    },
  });

  // Toggle active mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("hero_carousel")
        .update({ is_active: !isActive })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hero_carousel"] });
      toast({ title: "Success", description: "Image status updated" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update status",
        variant: "destructive" 
      });
    },
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-8">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/admin")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-3xl font-bold">Hero Carousel Manager</h1>
                <p className="text-muted-foreground">Manage landing page carousel images</p>
              </div>
            </div>
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-md bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/25 whitespace-nowrap"
            >
              👁 Preview Live Homepage
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {/* Upload Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload New Image
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="image">Image File *</Label>
                  <Input
                    id="image"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sortOrder">Sort Order *</Label>
                  <Input
                    id="sortOrder"
                    type="number"
                    placeholder="e.g., 1"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="title">Title (optional - images display without text)</Label>
                  <Input
                    id="title"
                    placeholder="Optional alt text for accessibility"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subtitle">Subtitle</Label>
                  <Input
                    id="subtitle"
                    placeholder="Optional subtitle"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="link">Link URL (optional)</Label>
                  <Input
                    id="link"
                    placeholder="e.g., /inkfusion"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                  />
                </div>

              </div>

              <Button 
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending}
                className="w-full"
              >
                <Upload className="h-4 w-4 mr-2" />
                {uploadMutation.isPending ? "Uploading..." : "Upload Image"}
              </Button>
            </CardContent>
          </Card>

          {/* Images Grid */}
          <Card>
            <CardHeader>
              <CardTitle>Current Carousel Images</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-center text-muted-foreground py-8">Loading...</p>
              ) : !carouselImages || carouselImages.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No images uploaded yet</p>
              ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {carouselImages.map((image) => (
                    <Card key={image.id} className="overflow-hidden">
                      <div className="aspect-video relative">
                        <img
                          src={image.image_url}
                          alt={image.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-2 right-2 flex gap-2">
                          <Badge variant={image.is_active ? "default" : "secondary"}>
                            {image.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </div>
                      <CardContent className="p-4 space-y-2">
                        <div>
                          <p className="font-semibold text-sm">{image.title}</p>
                          {image.subtitle && (
                            <p className="text-xs text-muted-foreground">{image.subtitle}</p>
                          )}
                          {image.link && (
                            <p className="text-xs text-primary mt-1">Link: {image.link}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Sort: {image.sort_order}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggleActiveMutation.mutate({ 
                              id: image.id, 
                              isActive: image.is_active 
                            })}
                            className="flex-1"
                          >
                            {image.is_active ? (
                              <EyeOff className="h-4 w-4 mr-1" />
                            ) : (
                              <Eye className="h-4 w-4 mr-1" />
                            )}
                            {image.is_active ? "Hide" : "Show"}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => deleteMutation.mutate(image.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

    </div>
  );
};

export default AdminHeroCarousel;
