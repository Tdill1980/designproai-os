import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { HeroRenderer } from "../../HeroRenderer";

export const FadeWrapsMode = () => {
  const [selectedPattern, setSelectedPattern] = useState<any>(null);

  const { data: patterns, isLoading } = useQuery({
    queryKey: ["fadewraps_patterns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fadewraps_patterns")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      
      if (error) {
        console.error("[fadewraps_patterns] query error:", error.message, error.code);
        throw error;
      }
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
        <h3 className="text-lg font-semibold mb-4">Select Fade Pattern</h3>
        <ScrollArea className="h-96 border border-border rounded-lg p-4 bg-secondary/20">
          <div className="grid grid-cols-2 gap-4">
            {patterns?.map((pattern) => (
              <button
                key={pattern.id}
                onClick={() => setSelectedPattern(pattern)}
                className={`aspect-video rounded-lg border-2 transition-all hover:scale-105 overflow-hidden ${
                  selectedPattern?.id === pattern.id
                    ? "border-primary shadow-lg shadow-primary/20"
                    : "border-border"
                }`}
              >
                <img
                  src={pattern.media_url}
                  alt={pattern.name}
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </ScrollArea>
        
        {selectedPattern && (
          <div className="mt-4 p-4 bg-secondary/20 rounded-lg border border-border">
            <h4 className="font-semibold mb-2">{selectedPattern.name}</h4>
            {selectedPattern.category && (
              <p className="text-sm text-muted-foreground">
                Category: {selectedPattern.category}
              </p>
            )}
          </div>
        )}
      </div>
      
      <HeroRenderer pattern={selectedPattern?.media_url} />
    </div>
  );
};