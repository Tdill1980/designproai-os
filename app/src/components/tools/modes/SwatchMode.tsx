import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { HeroRenderer } from "../../HeroRenderer";

export const SwatchMode = () => {
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  const { data: products, isLoading } = useQuery({
    queryKey: ["wbty_products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wbty_products")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <div className="grid md:grid-cols-2 gap-6">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 gap-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Select Product</h3>
        <ScrollArea className="h-96 border border-border rounded-lg p-4 bg-secondary/20">
          <div className="grid grid-cols-2 gap-4">
            {products?.map((product) => (
              <button
                key={product.id}
                onClick={() => setSelectedProduct(product)}
                className={`rounded-lg border-2 transition-all hover:scale-105 overflow-hidden ${
                  selectedProduct?.id === product.id
                    ? "border-primary shadow-lg shadow-primary/20"
                    : "border-border"
                }`}
              >
                <div className="aspect-square">
                  <img
                    src={product.media_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-3 bg-background/80">
                  <p className="font-medium text-sm">{product.name}</p>
                  {product.price && (
                    <p className="text-xs text-primary">${product.price}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>
        
        {selectedProduct && (
          <div className="mt-4 p-4 bg-secondary/20 rounded-lg border border-border">
            <h4 className="font-semibold mb-2">{selectedProduct.name}</h4>
            <div className="space-y-1 text-sm text-muted-foreground">
              {selectedProduct.price && <p>Price: ${selectedProduct.price}</p>}
              {selectedProduct.category && <p>Category: {selectedProduct.category}</p>}
            </div>
          </div>
        )}
      </div>
      
      <HeroRenderer product={selectedProduct?.media_url} />
    </div>
  );
};