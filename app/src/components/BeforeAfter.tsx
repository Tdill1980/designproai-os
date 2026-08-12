import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { useState } from "react";

export const BeforeAfter = () => {
  const [sliderPosition, setSliderPosition] = useState(50);

  const { data: examples, isLoading } = useQuery({
    queryKey: ["approvemode_carousel_examples"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approvemode_carousel")
        .select("*")
        .eq("is_active", true)
        .not("before_url", "is", null)
        .not("media_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(3);
      
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) {
    return (
      <section className="container mx-auto px-4 py-20 bg-card/30">
        <h2 className="text-3xl font-bold mb-8 text-center">Before & After</h2>
        <div className="grid md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="aspect-video" />
          ))}
        </div>
      </section>
    );
  }

  if (!examples || examples.length === 0) {
    return null;
  }

  return (
    <section className="container mx-auto px-4 py-20 bg-card/30">
      <h2 className="text-3xl font-bold mb-8 text-center">Before & After</h2>
      
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {examples.map((example) => (
          <Card key={example.id} className="overflow-hidden border-border">
            <div className="relative aspect-video">
            <div className="grid grid-cols-2 h-full">
                <div className="relative overflow-hidden">
                  <img
                    src={example.before_url || ''}
                    alt="Before - 2D Design Proof"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-2 left-2 bg-background/80 px-2 py-1 rounded text-xs font-semibold z-10">
                    Before
                  </div>
                </div>
                <div className="relative overflow-hidden">
                  <img
                    src={example.media_url}
                    alt="After - 3D Render"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-2 right-2 bg-primary/80 px-2 py-1 rounded text-xs font-semibold text-primary-foreground z-10">
                    After
                  </div>
                </div>
              </div>
            </div>
            {(example.subtitle || example.vehicle_name) && (
              <div className="p-4">
                <p className="text-sm text-muted-foreground">
                  {example.subtitle || `${example.vehicle_name || ''} ${example.color_name || ''}`.trim()}
                </p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
};