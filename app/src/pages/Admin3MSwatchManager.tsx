import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Search, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";

type FinishType = 'Gloss' | 'Satin' | 'Matte' | 'Flip' | 'Brushed' | 'Textured';

export default function Admin3MSwatchManager() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFinish, setSelectedFinish] = useState<FinishType>('Gloss');
  const { toast } = useToast();

  // Fetch 3M colors from database
  const { data: colors3M, refetch } = useQuery({
    queryKey: ['admin-3m-swatches'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inkfusion_swatches')
        .select('*')
        .eq('color_library', '3m_2080')
        .order('finish', { ascending: true })
        .order('name', { ascending: true });
      
      if (error) throw error;
      return data || [];
    }
  });

  // Group colors by finish
  const groupedColors = (colors3M || []).reduce((acc, color) => {
    const finish = (color.finish || 'Gloss') as FinishType;
    if (!acc[finish]) acc[finish] = [];
    acc[finish].push(color);
    return acc;
  }, {} as Record<FinishType, typeof colors3M>);

  const currentColors = groupedColors[selectedFinish] || [];
  const filteredColors = currentColors.filter(color =>
    color.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSwatchUpload = async (colorId: string, colorName: string, file: File) => {
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `3m_2080/${colorId}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('swatches')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('swatches')
        .getPublicUrl(filePath);

      // Update database with real URL
      const { error: dbError } = await supabase
        .from('inkfusion_swatches')
        .update({ media_url: publicUrl })
        .eq('id', colorId);

      if (dbError) throw dbError;

      toast({
        title: "Swatch uploaded",
        description: `${colorName} swatch updated successfully`,
      });
      
      refetch();
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: "Failed to upload swatch. Please try again.",
        variant: "destructive",
      });
    }
  };

  const getTotalUploaded = () => {
    return (colors3M || []).filter(c => c.media_url && !c.media_url.includes('placeholder')).length;
  };

  const getTotalColors = () => {
    return (colors3M || []).length;
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">3M 2080 Series Swatch Manager</h1>
              <p className="text-muted-foreground mt-1">
                Upload official 3M vinyl swatch images organized by finish type
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="text-lg px-4 py-2">
                {getTotalUploaded()} / {getTotalColors()} Uploaded
              </Badge>
            </div>
          </div>

          {/* Finish Tabs */}
          <Tabs value={selectedFinish} onValueChange={(v) => setSelectedFinish(v as FinishType)}>
            <TabsList className="grid w-full max-w-3xl grid-cols-6 bg-card">
              <TabsTrigger value="Gloss">Gloss</TabsTrigger>
              <TabsTrigger value="Satin">Satin</TabsTrigger>
              <TabsTrigger value="Matte">Matte</TabsTrigger>
              <TabsTrigger value="Flip">Flip</TabsTrigger>
              <TabsTrigger value="Brushed">Brushed</TabsTrigger>
              <TabsTrigger value="Textured">Textured</TabsTrigger>
            </TabsList>

            <TabsContent value={selectedFinish} className="space-y-6 mt-6">
              {/* Search */}
              <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={`Search ${selectedFinish} colors...`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 bg-card"
                  />
                </div>
                <Badge variant="outline" className="px-3 py-1.5">
                  {filteredColors.length} {selectedFinish} colors
                </Badge>
              </div>

              {/* Color Grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredColors.map((color) => {
                  const hasRealSwatch = color.media_url && !color.media_url.includes('placeholder');
                  
                  return (
                    <Card key={color.id} className="p-3 bg-card border-border hover:border-primary/50 transition-colors">
                      <div className="space-y-3">
                        {/* Swatch Preview */}
                        <div className="aspect-square rounded-lg overflow-hidden border-2 border-border relative">
                          {hasRealSwatch ? (
                            <>
                              <img 
                                src={color.media_url} 
                                alt={color.name}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute top-2 right-2 bg-green-500 rounded-full p-1">
                                <CheckCircle2 className="h-4 w-4 text-white" />
                              </div>
                            </>
                          ) : (
                            <div 
                              className="w-full h-full flex items-center justify-center"
                              style={{ backgroundColor: color.hex || '#cccccc' }}
                            >
                              <Upload className="h-8 w-8 text-white/50" />
                            </div>
                          )}
                        </div>

                        {/* Color Info */}
                        <div className="space-y-1">
                          <h3 className="font-medium text-sm text-foreground truncate" title={color.name}>
                            {color.name}
                          </h3>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-xs">
                              {color.finish}
                            </Badge>
                          </div>
                        </div>

                        {/* Upload Button */}
                        <label
                          htmlFor={`swatch-${color.id}`}
                          className="block cursor-pointer"
                        >
                          <Button 
                            variant={hasRealSwatch ? "secondary" : "default"} 
                            size="sm" 
                            className="w-full" 
                            asChild
                          >
                            <span>
                              <Upload className="h-3 w-3 mr-2" />
                              {hasRealSwatch ? 'Replace' : 'Upload'} Swatch
                            </span>
                          </Button>
                          <input
                            id={`swatch-${color.id}`}
                            type="file"
                            accept="image/png,image/jpeg,image/jpg"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleSwatchUpload(color.id, color.name, file);
                            }}
                          />
                        </label>
                      </div>
                    </Card>
                  );
                })}
              </div>

              {filteredColors.length === 0 && (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">No {selectedFinish} colors found</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>

    </div>
  );
}
