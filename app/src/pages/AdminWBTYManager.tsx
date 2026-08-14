import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Upload, Trash2, ArrowLeft, FileArchive, RefreshCw, Wand2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { AdminSmartUploader } from "@/components/admin/AdminSmartUploader";
import { STATIC_PATTERNS } from "@/data/patternpro-patterns";

const CATEGORIES = [
  "Metal & Marble",
  "Wicked & Wild",
  "Camo & Carbon",
  "Bape Camo",
  "Modern & Trippy"
];

const AdminWBTYManager = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedCategories, setExpandedCategories] = useState<string[]>(CATEGORIES);

  const { data: products, isLoading } = useQuery({
    queryKey: ["wbty_products_admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wbty_products")
        .select("*")
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const fileExt = file.name.split('.').pop();
      const fileName = `${id}-${Date.now()}.${fileExt}`;
      const filePath = `wbty/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('products')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('products')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('wbty_products')
        .update({ media_url: publicUrl })
        .eq('id', id);

      if (updateError) throw updateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wbty_products_admin"] });
      toast({
        title: "Success",
        description: "Pattern swatch updated successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to upload: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('wbty_products')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wbty_products_admin"] });
      toast({
        title: "Success",
        description: "Pattern deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to delete: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const bulkUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);

      const { data, error } = await supabase.functions.invoke('bulk-upload-wbty-swatches', {
        body: formData,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["wbty_products_admin"] });
      toast({
        title: "Bulk Upload Complete",
        description: `${data.summary.successful} uploaded, ${data.summary.failed} failed, ${data.summary.notFound} not found`,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Bulk upload failed: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const syncToWooCommerceMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('sync-wbty-to-woocommerce');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "WooCommerce Sync Complete",
        description: `${data.success} swatches uploaded, ${data.failed} failed, ${data.skipped} skipped`,
      });
    },
    onError: (error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generateSwatchesMutation = useMutation({
    mutationFn: async () => {
      // Send all static patterns to the swatch generator
      const patterns = STATIC_PATTERNS.map(p => ({
        slug: p.id.replace('wpw-', ''),
        name: p.name,
        category: p.category,
        description: p.description || `${p.name} pattern from the ${p.category} collection`,
      }));

      const { data, error } = await supabase.functions.invoke('generate-pattern-swatches', {
        body: { patterns },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["wbty_products_admin"] });
      toast({
        title: "Swatch Generation Complete",
        description: `${data.generated} generated, ${data.failed} failed out of ${data.total} patterns`,
      });
    },
    onError: (error) => {
      toast({
        title: "Swatch Generation Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleBulkUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.zip')) {
      bulkUploadMutation.mutate(file);
    } else {
      toast({
        title: "Invalid File",
        description: "Please select a ZIP file",
        variant: "destructive",
      });
    }
  };

  const handleFileUpload = (id: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      uploadMutation.mutate({ id, file });
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  };

  const getProductsByCategory = (category: string) => {
    return products?.filter(p => p.category === category) || [];
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-muted-foreground">Loading patterns...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Button
            onClick={() => navigate("/admin")}
            variant="outline"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>

          <div className="flex gap-3">
            <Card className="p-4 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <FileArchive className="h-5 w-5 text-muted-foreground" />
                <Label htmlFor="bulk-upload" className="cursor-pointer text-sm font-medium">
                  Bulk Upload ZIP
                </Label>
              </div>
              <Input
                id="bulk-upload"
                type="file"
                accept=".zip"
                onChange={handleBulkUpload}
                disabled={bulkUploadMutation.isPending}
                className="w-auto"
              />
              {bulkUploadMutation.isPending && (
                <span className="text-sm text-muted-foreground">Uploading...</span>
              )}
            </Card>

            <Button
              onClick={() => generateSwatchesMutation.mutate()}
              disabled={generateSwatchesMutation.isPending}
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
            >
              <Wand2 className={`mr-2 h-4 w-4 ${generateSwatchesMutation.isPending ? 'animate-spin' : ''}`} />
              {generateSwatchesMutation.isPending ? 'Generating Swatches...' : `Generate AI Swatches (${STATIC_PATTERNS.length})`}
            </Button>

            <Button
              onClick={() => syncToWooCommerceMutation.mutate()}
              disabled={syncToWooCommerceMutation.isPending}
              className="bg-gradient-to-r from-blue-500 to-blue-500 hover:from-blue-600 hover:to-blue-600"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${syncToWooCommerceMutation.isPending ? 'animate-spin' : ''}`} />
              {syncToWooCommerceMutation.isPending ? 'Syncing...' : 'Sync to WooCommerce'}
            </Button>
          </div>
        </div>

        <div className="mb-8">
          <h1 className="text-4xl font-bold text-foreground mb-2">
            PatternPro™ Swatches Manager
          </h1>
          <p className="text-muted-foreground">
            Upload and manage pattern swatches with AI naming and auto 3D generation
          </p>
        </div>

        <div className="mb-8">
          <AdminSmartUploader
            productType="wbty"
            onUploadComplete={() => {
              queryClient.invalidateQueries({ queryKey: ["wbty_products_admin"] });
            }}
          />
        </div>

        <div className="space-y-4">
          {CATEGORIES.map((category) => {
            const categoryProducts = getProductsByCategory(category);
            const isExpanded = expandedCategories.includes(category);

            return (
              <Collapsible
                key={category}
                open={isExpanded}
                onOpenChange={() => toggleCategory(category)}
                className="border border-border rounded-lg bg-card"
              >
                <CollapsibleTrigger className="flex items-center justify-between w-full p-4 hover:bg-accent/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-semibold">{category}</h2>
                    <span className="text-sm text-muted-foreground">
                      ({categoryProducts.length} patterns)
                    </span>
                  </div>
                  <ChevronDown
                    className={`h-5 w-5 transition-transform ${
                      isExpanded ? "transform rotate-180" : ""
                    }`}
                  />
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="p-4 pt-0">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                      {categoryProducts.map((product) => (
                        <div
                          key={product.id}
                          className="group relative aspect-square border border-border rounded-lg overflow-hidden hover:border-primary/50 transition-all"
                        >
                          <img
                            src={product.media_url}
                            alt={product.name}
                            className="w-full h-full object-cover"
                          />
                          
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 p-2">
                            <p className="text-white text-xs font-medium text-center line-clamp-2">
                              {product.name}
                            </p>
                            
                            <label className="cursor-pointer">
                              <input
                                type="file"
                                accept="image/*,video/*"
                                className="hidden"
                                onChange={(e) => handleFileUpload(product.id, e)}
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                className="w-full text-xs h-7"
                                asChild
                              >
                                <span>
                                  <Upload className="h-3 w-3 mr-1" />
                                  Upload
                                </span>
                              </Button>
                            </label>

                            <Button
                              size="sm"
                              variant="destructive"
                              className="w-full text-xs h-7"
                              onClick={() => deleteMutation.mutate(product.id)}
                            >
                              <Trash2 className="h-3 w-3 mr-1" />
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AdminWBTYManager;
