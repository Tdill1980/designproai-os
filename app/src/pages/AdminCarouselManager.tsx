import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, Trash2, Edit } from "lucide-react";

type ProductType = "inkfusion" | "fadewraps" | "wbty" | "approvemode" | "designpanelpro";

const PRODUCT_TABLES = {
  inkfusion: "inkfusion_carousel",
  fadewraps: "fadewraps_carousel",
  wbty: "wbty_carousel",
  approvemode: "approvemode_carousel",
  designpanelpro: "designpanelpro_carousel",
};

const AdminCarouselManager = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [selectedProduct, setSelectedProduct] = useState<ProductType>("inkfusion");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [imageName, setImageName] = useState("");
  const [sortOrder, setSortOrder] = useState("");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [gradientDirection, setGradientDirection] = useState<string>("");

  const tableName = PRODUCT_TABLES[selectedProduct];

  // Fetch carousel images for selected product
  const { data: carouselImages, isLoading } = useQuery({
    queryKey: ["carousel_images", selectedProduct],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(tableName as any)
        .select("*")
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data as any[];
    },
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile || !sortOrder) {
        throw new Error("Please fill required fields (image, sort order)");
      }

      // Validate gradient direction for FadeWraps
      if (selectedProduct === "fadewraps" && !gradientDirection) {
        throw new Error("Please select a gradient direction for FadeWraps images");
      }

      // Upload to storage
      const fileName = `${selectedProduct}/${Date.now()}_${uploadFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("carousel-images")
        .upload(fileName, uploadFile);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from("carousel-images")
        .getPublicUrl(fileName);

      // Insert into database
      const insertData: any = {
        name: imageName || uploadFile.name.replace(/\.[^.]+$/, ''),
        media_url: publicUrl,
        sort_order: parseInt(sortOrder),
        is_active: true,
        title: title || "",
        subtitle: subtitle || "",
      };

      // Add gradient_direction for FadeWraps
      if (selectedProduct === "fadewraps" && gradientDirection) {
        insertData.gradient_direction = gradientDirection;
      }

      const { error: insertError } = await supabase
        .from(tableName as any)
        .insert(insertData);

      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carousel_images", selectedProduct] });
      toast({ title: "Success", description: "Carousel image uploaded successfully" });
      setUploadFile(null);
      setImageName("");
      setSortOrder("");
      setTitle("");
      setSubtitle("");
      setGradientDirection("");
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
        .from(tableName as any)
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carousel_images", selectedProduct] });
      toast({ title: "Success", description: "Carousel image deleted successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to delete image",
        variant: "destructive" 
      });
    },
  });

  // Update text mutation
  const updateTextMutation = useMutation({
    mutationFn: async ({ id, title, subtitle }: { id: string; title: string; subtitle: string }) => {
      const { error } = await supabase
        .from(tableName as any)
        .update({ title, subtitle })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carousel_images", selectedProduct] });
      toast({ title: "Success", description: "Text updated successfully" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error.message || "Failed to update text",
        variant: "destructive" 
      });
    },
  });

  return (
    <div className="min-h-screen flex flex-col">
      
      <main className="flex-1 container mx-auto px-4 py-12">
        <Button 
          variant="ghost" 
          onClick={() => navigate(-1)}
          className="mb-6"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>
        
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <h1 className="text-3xl font-bold tracking-tight">Hero Carousel Manager</h1>
            <Badge variant="outline" className="text-xs">Large Sliding Images</Badge>
          </div>
          <p className="text-muted-foreground">
            Upload large hero images that slide at the top of product pages
          </p>
          <p className="text-sm text-amber-600 dark:text-amber-400 mt-2 font-medium">
            ⚠️ This is NOT for pattern swatches - go to Pattern Manager for that
          </p>
        </div>
        
        {/* Product Selector */}
        <div className="mb-8">
          <Label htmlFor="product-select">Select Product</Label>
          <Select 
            value={selectedProduct} 
            onValueChange={(value) => setSelectedProduct(value as ProductType)}
          >
            <SelectTrigger id="product-select" className="w-[300px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inkfusion">InkFusion™</SelectItem>
              <SelectItem value="fadewraps">FadeWraps™</SelectItem>
              <SelectItem value="wbty">Wrap By The Yard</SelectItem>
              <SelectItem value="approvemode">ApproveMode</SelectItem>
              <SelectItem value="designpanelpro">RestyleLibrary™</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Upload Form */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Upload New Carousel Image</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="file-upload">Image File</Label>
              <Input
                id="file-upload"
                type="file"
                accept="image/*"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              />
            </div>
            
            <div>
              <Label htmlFor="image-name">Image Name (optional - defaults to filename)</Label>
              <Input
                id="image-name"
                placeholder="Optional - auto-uses filename if blank"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
              />
            </div>
            
            <div>
              <Label htmlFor="sort-order">Sort Order (Position in Carousel)</Label>
              <Input
                id="sort-order"
                type="number"
                placeholder="1 = leftmost/first, 2 = second, 3 = third, etc."
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Lower numbers appear first (left to right). Example: 1, 2, 3, 4...
              </p>
            </div>

            {selectedProduct === "fadewraps" && (
              <div>
                <Label htmlFor="gradient-direction">Gradient Direction <span className="text-destructive">*</span></Label>
                <Select value={gradientDirection} onValueChange={setGradientDirection}>
                  <SelectTrigger id="gradient-direction">
                    <SelectValue placeholder="Select gradient direction" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="front-to-back">Front → Back</SelectItem>
                    <SelectItem value="back-to-front">Back → Front</SelectItem>
                    <SelectItem value="top-to-bottom">Top → Bottom</SelectItem>
                    <SelectItem value="bottom-to-top">Bottom → Top</SelectItem>
                    <SelectItem value="diagonal-front">Diagonal ↘</SelectItem>
                    <SelectItem value="diagonal-rear">Diagonal ↙</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  This example will appear in the tool when this direction is selected
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Text Overlay (optional - leave blank for clean images)</Label>
              <Input
                placeholder="Title (leave blank for no text)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Input
                placeholder="Subtitle (leave blank for no text)"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave both blank to display clean hero images with no text overlay
              </p>
            </div>
            
            <Button 
              onClick={() => uploadMutation.mutate()}
              disabled={
                uploadMutation.isPending ||
                !uploadFile ||
                !sortOrder ||
                (selectedProduct === "fadewraps" && !gradientDirection)
              }
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Image
            </Button>
            {selectedProduct === "fadewraps" && !gradientDirection && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Gradient direction is required for FadeWraps images
              </p>
            )}
          </CardContent>
        </Card>
        
        {/* Image Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : carouselImages && carouselImages.length > 0 ? (
            carouselImages.map((image) => (
              <Card key={image.id}>
                <div className="relative">
                  <img 
                    src={image.media_url} 
                    alt={image.name} 
                    className="w-full aspect-video object-cover rounded-t-lg"
                  />
                  {(image.title || image.subtitle) && (
                    <div className="absolute bottom-3 left-3 right-3 bg-black/60 backdrop-blur-sm p-3 rounded-lg text-white">
                      {image.title && (
                        <p className="font-bold text-sm mb-1">{image.title}</p>
                      )}
                      {image.subtitle && (
                        <p className="text-xs opacity-90">{image.subtitle}</p>
                      )}
                    </div>
                  )}
                </div>
                <CardContent className="pt-4">
                  <h3 className="font-semibold mb-2">{image.name}</h3>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <Badge variant="secondary">
                      Sort: {image.sort_order}
                    </Badge>
                    {selectedProduct === "fadewraps" && image.gradient_direction && (
                      <Badge variant="outline">
                        {image.gradient_direction}
                      </Badge>
                    )}
                  </div>

                  {/* Editable Text Fields */}
                  <div className="space-y-2 mb-3">
                    <Label className="text-xs">Overlay Text</Label>
                    <Input
                      placeholder="Title (leave blank to remove)"
                      defaultValue={image.title || ""}
                      onBlur={(e) => {
                        const newTitle = e.target.value;
                        if (newTitle !== image.title) {
                          updateTextMutation.mutate({
                            id: image.id,
                            title: newTitle,
                            subtitle: image.subtitle || ""
                          });
                        }
                      }}
                      className="text-sm"
                    />
                    <Input
                      placeholder="Subtitle (leave blank to remove)"
                      defaultValue={image.subtitle || ""}
                      onBlur={(e) => {
                        const newSubtitle = e.target.value;
                        if (newSubtitle !== image.subtitle) {
                          updateTextMutation.mutate({
                            id: image.id,
                            title: image.title || "",
                            subtitle: newSubtitle
                          });
                        }
                      }}
                      className="text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Edit text and click outside to save
                    </p>
                  </div>
                  
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteMutation.mutate(image.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete
                  </Button>
                </CardContent>
              </Card>
            ))
          ) : (
            <p className="text-muted-foreground col-span-full">
              No carousel images found. Upload your first image above.
            </p>
          )}
        </div>
      </main>

    </div>
  );
};

export default AdminCarouselManager;
