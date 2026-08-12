import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Card } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { SafeImage } from "./SafeImage";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, Sun, Moon } from "lucide-react";

interface ImageCarouselProps {
  productType: "inkfusion" | "fadewraps" | "wbty" | "approvemode";
}

export const ImageCarousel = ({ productType }: ImageCarouselProps) => {
  const [fullscreenImage, setFullscreenImage] = useState<any | null>(null);
  const [cardLightBg, setCardLightBg] = useState<Record<string, boolean>>({});
  const [fullscreenLightBg, setFullscreenLightBg] = useState(false);
  
  const { data: images, isLoading } = useQuery({
    queryKey: [`${productType}_carousel`],
    queryFn: async () => {
      const tableName = `${productType}_carousel` as any;
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .limit(2);
      
      if (error) {
        console.error(`[${tableName}] carousel query error:`, error.message, error.code);
        throw error;
      }
      return data as any[];
    },
  });

  // Add preconnect for faster image loading
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'preconnect';
       link.href = 'https://kfapjdyythzyvnpdeghu.supabase.co';

    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
    
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  if (isLoading) {
    return (
      <section className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      </section>
    );
  }

  if (!images || images.length === 0) {
    return null;
  }

  return (
    <>
      <section className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 bg-card/30">
        <Carousel className="w-full max-w-5xl mx-auto touch-manipulation">
          <CarouselContent className="-ml-2 sm:-ml-4">
            {images.map((image) => (
              <CarouselItem key={image.id} className="pl-2 sm:pl-4 md:basis-1/2 lg:basis-1/3">
                <Card
                  className="overflow-hidden border-border transition-transform active:scale-95 cursor-pointer group"
                  onClick={() => setFullscreenImage(image)}
                >
                  <div
                    className="gallery-card-image-wrapper relative transition-colors duration-300"
                    style={cardLightBg[image.id] ? { background: '#f0f0f0' } : undefined}
                  >
                    <SafeImage
                      src={image.media_url}
                      alt={image.name}
                      className="gallery-card-image transition-transform duration-300 md:group-hover:scale-105"
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCardLightBg(prev => ({ ...prev, [image.id]: !prev[image.id] }));
                      }}
                      className={`absolute top-2 left-2 z-30 flex items-center gap-1 px-2 py-1 rounded-full backdrop-blur-sm transition-all duration-200 active:scale-90 touch-manipulation ${
                        cardLightBg[image.id] ? 'bg-black/15 hover:bg-black/25 text-black' : 'bg-white/15 hover:bg-white/25 text-white'
                      }`}
                      title={cardLightBg[image.id] ? 'Switch to dark studio' : 'Switch to light studio'}
                    >
                      {cardLightBg[image.id] ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                      <span className="text-[10px] font-semibold uppercase tracking-wider">{cardLightBg[image.id] ? 'Dark' : 'Light'}</span>
                    </button>
                  </div>
                </Card>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="text-foreground hover:bg-primary/10 active:bg-primary/20 -left-8 sm:-left-12 h-10 w-10 sm:h-12 sm:w-12 touch-manipulation" />
          <CarouselNext className="text-foreground hover:bg-primary/10 active:bg-primary/20 -right-8 sm:-right-12 h-10 w-10 sm:h-12 sm:w-12 touch-manipulation" />
        </Carousel>
      </section>

      {/* Fullscreen Modal */}
      <Dialog open={!!fullscreenImage} onOpenChange={() => setFullscreenImage(null)}>
        <DialogContent className={`max-w-full w-full h-full p-0 border-0 transition-colors duration-300 ${fullscreenLightBg ? 'bg-[#f0f0f0]' : 'bg-black/95'}`}>
          <button
            onClick={() => setFullscreenImage(null)}
            className="absolute top-4 right-4 z-50 p-3 sm:p-2 rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors touch-manipulation"
            aria-label="Close fullscreen"
          >
            <X className="h-7 w-7 sm:h-6 sm:w-6 text-white" />
          </button>
          <button
            onClick={() => setFullscreenLightBg(prev => !prev)}
            className={`absolute top-4 right-16 z-50 flex items-center gap-1.5 px-3 py-2 rounded-full backdrop-blur-sm transition-all duration-200 active:scale-90 touch-manipulation ${
              fullscreenLightBg ? 'bg-black/20 hover:bg-black/30 text-black' : 'bg-white/15 hover:bg-white/25 text-white'
            }`}
            title={fullscreenLightBg ? 'Switch to dark studio' : 'Switch to light studio'}
          >
            {fullscreenLightBg ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            <span className="text-xs font-semibold uppercase tracking-wider">{fullscreenLightBg ? 'Dark' : 'Light'}</span>
          </button>
          {fullscreenImage && (
            <div className="w-full h-full flex items-center justify-center p-4">
              <SafeImage
                src={fullscreenImage.media_url}
                alt={fullscreenImage.name}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
