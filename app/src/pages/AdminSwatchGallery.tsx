import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, X, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ManufacturerColor {
  id: string;
  manufacturer: string;
  product_code: string;
  official_name: string;
  official_hex: string;
  official_swatch_url: string | null;
  finish: string;
  series: string | null;
}

const AdminSwatchGallery = () => {
  const navigate = useNavigate();
  const [manufacturer, setManufacturer] = useState<'3M' | 'Avery Dennison'>('3M');

  const { data: colors, isLoading, refetch } = useQuery({
    queryKey: ['manufacturer-colors-gallery', manufacturer],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('manufacturer_colors')
        .select('*')
        .eq('manufacturer', manufacturer)
        .order('product_code', { ascending: true });
      
      if (error) throw error;
      return data as ManufacturerColor[];
    }
  });

  const getSwatchImageUrl = (color: ManufacturerColor) => {
    // Check if official swatch URL exists
    if (color.official_swatch_url) {
      return color.official_swatch_url;
    }
    
    // Construct expected storage URL based on manufacturer
    const mfgKey = color.manufacturer === '3M' ? '3m' : 'avery';
    return `https://abgevylqeazbydrtovzp.supabase.co/storage/v1/object/public/swatches/official/${mfgKey}/${color.product_code}.png`;
  };

  const SwatchCard = ({ color }: { color: ManufacturerColor }) => {
    const [imageError, setImageError] = useState(false);
    const [imageLoaded, setImageLoaded] = useState(false);
    const imageUrl = getSwatchImageUrl(color);

    return (
      <div className="bg-card border border-border rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
        {/* Swatch Image */}
        <div className="aspect-square bg-muted relative">
          {!imageError ? (
            <img
              src={imageUrl}
              alt={color.official_name}
              className="w-full h-full object-cover"
              onError={() => setImageError(true)}
              onLoad={() => setImageLoaded(true)}
            />
          ) : (
            <div 
              className="w-full h-full flex items-center justify-center"
              style={{ backgroundColor: color.official_hex }}
            >
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                No swatch image
              </span>
            </div>
          )}
          
          {/* Status indicator */}
          <div className="absolute top-2 right-2">
            {imageLoaded && !imageError ? (
              <div className="bg-green-500 rounded-full p-1">
                <Check className="h-3 w-3 text-white" />
              </div>
            ) : imageError ? (
              <div className="bg-red-500 rounded-full p-1">
                <X className="h-3 w-3 text-white" />
              </div>
            ) : null}
          </div>
          
          {/* Hex color preview */}
          <div 
            className="absolute bottom-2 left-2 w-6 h-6 rounded border-2 border-white shadow-md"
            style={{ backgroundColor: color.official_hex }}
            title={color.official_hex}
          />
        </div>
        
        {/* Color Info */}
        <div className="p-3 space-y-1">
          <div className="font-mono text-sm font-bold text-primary">
            {color.product_code}
          </div>
          <div className="text-sm font-medium text-foreground truncate" title={color.official_name}>
            {color.official_name}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="bg-muted px-1.5 py-0.5 rounded">{color.finish}</span>
            <span className="font-mono">{color.official_hex}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Swatch Gallery</h1>
              <p className="text-sm text-muted-foreground">
                View all manufacturer swatches with images and color codes
              </p>
            </div>
          </div>
          
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6">
        <Tabs value={manufacturer} onValueChange={(v) => setManufacturer(v as '3M' | 'Avery Dennison')}>
          <TabsList className="mb-6">
            <TabsTrigger value="3M" className="gap-2">
              <span className="font-bold">3M</span>
              <span className="text-xs text-muted-foreground">2080 Series</span>
            </TabsTrigger>
            <TabsTrigger value="Avery Dennison" className="gap-2">
              <span className="font-bold">Avery Dennison</span>
              <span className="text-xs text-muted-foreground">SW900 Series</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={manufacturer}>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : colors && colors.length > 0 ? (
              <>
                <div className="mb-4 text-sm text-muted-foreground">
                  Showing {colors.length} colors for {manufacturer}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {colors.map((color) => (
                    <SwatchCard key={color.id} color={color} />
                  ))}
                </div>
              </>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No colors found for {manufacturer}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminSwatchGallery;
