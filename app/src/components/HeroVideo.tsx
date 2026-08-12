import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

interface HeroVideoProps {
  productType: "inkfusion" | "fadewraps" | "wbty" | "approvemode";
}

export const HeroVideo = ({ productType }: HeroVideoProps) => {
  const { data: video, isLoading } = useQuery({
    queryKey: [`${productType}_videos`],
    queryFn: async () => {
      const tableName = `${productType}_videos` as any;
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .limit(1)
        .single();
      
      if (error) throw error;
      return data as any;
    },
  });

  if (isLoading) {
    return (
      <section className="container mx-auto px-4 py-12">
        <Card className="overflow-hidden bg-card">
          <Skeleton className="w-full aspect-video" />
        </Card>
      </section>
    );
  }

  if (!video) {
    return null;
  }

  return (
    <section className="container mx-auto px-4 py-12">
      <Card className="overflow-hidden bg-card border-border">
        <video
          src={video.media_url}
          className="w-full aspect-video object-cover"
          controls
          autoPlay
          muted
          loop
        />
      </Card>
    </section>
  );
};