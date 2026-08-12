import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

type ProductType = 'inkfusion' | 'wbty' | 'approvemode' | 'fadewraps';

const CAROUSEL_TABLES = {
  inkfusion: 'inkfusion_carousel',
  wbty: 'wbty_carousel',
  approvemode: 'approvemode_carousel',
  fadewraps: 'fadewraps_carousel'
} as const;

export default function AdminRenderCarousel() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedProduct, setSelectedProduct] = useState<ProductType>('inkfusion');

  const { data: carouselItems, isLoading } = useQuery({
    queryKey: ['carousel-items', selectedProduct],
    queryFn: async () => {
      const tableName = CAROUSEL_TABLES[selectedProduct];
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .order('sort_order', { ascending: false });

      if (error) throw error;
      return data;
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const tableName = CAROUSEL_TABLES[selectedProduct];
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['carousel-items', selectedProduct] });
      toast.success('Carousel item deleted');
    },
    onError: (error) => {
      console.error('Delete error:', error);
      toast.error('Failed to delete item');
    }
  });

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => navigate('/admin')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Button>
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Carousel Manager</h1>
          <p className="text-muted-foreground">
            Manage auto-generated carousel images for each product page
          </p>
        </div>

        <Card className="p-6 mb-6">
          <div className="flex items-center gap-4">
            <label className="text-sm font-medium">Product Type:</label>
            <Select value={selectedProduct} onValueChange={(value) => setSelectedProduct(value as ProductType)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inkfusion">InkFusion</SelectItem>
                <SelectItem value="wbty">Wrap By The Yard</SelectItem>
                <SelectItem value="approvemode">Approve Mode</SelectItem>
                <SelectItem value="fadewraps">Fade Wraps</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {isLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="p-4">
                <Skeleton className="w-full aspect-video mb-4" />
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </Card>
            ))}
          </div>
        ) : !carouselItems?.length ? (
          <Card className="p-12">
            <div className="text-center text-muted-foreground">
              <p className="text-lg font-medium mb-2">No carousel items yet</p>
              <p className="text-sm">
                Generate designs using the {selectedProduct} tool and they will appear here automatically
              </p>
            </div>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {carouselItems.map((item: any) => (
              <Card key={item.id} className="p-4 group relative">
                <img
                  src={item.media_url}
                  alt={item.name}
                  className="w-full aspect-video object-cover rounded-lg mb-4"
                />
                <div className="space-y-2">
                  <h3 className="font-semibold">{item.title || item.name}</h3>
                  <div className="text-sm text-muted-foreground space-y-1">
                    {item.vehicle_name && <p>Vehicle: {item.vehicle_name}</p>}
                    {item.color_name && <p>Color: {item.color_name}</p>}
                    {item.pattern_name && <p>Pattern: {item.pattern_name}</p>}
                    {item.subtitle && <p>{item.subtitle}</p>}
                    <p className="text-xs">
                      Added: {new Date(item.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => deleteMutation.mutate(item.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Card>
            ))}
          </div>
        )}
      </main>

    </div>
  );
}
