import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { ArrowLeft, Wand2, Download } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";

export default function AdminSwatchCleaner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(0);
  const [currentSwatch, setCurrentSwatch] = useState('');

  const { data: wbtySwatches, isLoading } = useQuery({
    queryKey: ['wbty-swatches-for-cleaning'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wbty_products')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data;
    }
  });

  const { data: inkfusionSwatches } = useQuery({
    queryKey: ['inkfusion-swatches-for-cleaning'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inkfusion_swatches')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      return data;
    }
  });

  const cleanSwatchMutation = useMutation({
    mutationFn: async ({ id, mediaUrl, name, table }: { id: string; mediaUrl: string; name: string; table: 'wbty_products' | 'inkfusion_swatches' }) => {
      setCurrentSwatch(name);

      // Call edge function to clean the swatch
      const { data, error } = await renderClient.functions.invoke('clean-swatch-image', {
        body: {
          imageUrl: mediaUrl,
          instruction: 'Remove all text, labels, and words from this image. Keep only the pattern/texture/color. Make it a clean seamless texture with no overlays, no text, no watermarks. The output should be just the pure material pattern.'
        }
      });

      if (error) throw error;
      if (!data?.editedImageUrl) throw new Error('No edited image returned');

      // Convert base64 to blob
      const base64Response = await fetch(data.editedImageUrl);
      const blob = await base64Response.blob();

      // Upload cleaned image
      const fileName = `cleaned-${Date.now()}-${name.replace(/\s+/g, '-')}.png`;
      const bucketName = table === 'wbty_products' ? 'products' : 'swatches';
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(fileName, blob, {
          contentType: 'image/png',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from(bucketName)
        .getPublicUrl(uploadData.path);

      // Update database with cleaned image URL
      const { error: updateError } = await supabase
        .from(table)
        .update({ media_url: publicUrl })
        .eq('id', id);

      if (updateError) throw updateError;

      return { name, publicUrl };
    },
    onSuccess: (data) => {
      toast.success(`Cleaned: ${data.name}`);
      queryClient.invalidateQueries({ queryKey: ['wbty-swatches-for-cleaning'] });
      queryClient.invalidateQueries({ queryKey: ['inkfusion-swatches-for-cleaning'] });
    },
    onError: (error, variables) => {
      console.error('Clean error:', error);
      toast.error(`Failed to clean: ${variables.name}`);
    }
  });

  const cleanAllWBTYSwatches = async () => {
    if (!wbtySwatches) return;

    const total = wbtySwatches.length;
    let processed = 0;
    
    for (const swatch of wbtySwatches) {
      processed++;
      setProgress((processed / total) * 100);
      
      try {
        await cleanSwatchMutation.mutateAsync({
          id: swatch.id,
          mediaUrl: swatch.media_url,
          name: swatch.name,
          table: 'wbty_products'
        });
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Failed to clean ${swatch.name}:`, error);
      }
    }
    
    setProgress(0);
    setCurrentSwatch('');
    toast.success('Batch cleaning complete!');
  };

  const cleanAllInkFusionSwatches = async () => {
    if (!inkfusionSwatches) return;

    const total = inkfusionSwatches.length;
    let processed = 0;
    
    for (const swatch of inkfusionSwatches) {
      processed++;
      setProgress((processed / total) * 100);
      
      try {
        await cleanSwatchMutation.mutateAsync({
          id: swatch.id,
          mediaUrl: swatch.media_url,
          name: swatch.name,
          table: 'inkfusion_swatches'
        });
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Failed to clean ${swatch.name}:`, error);
      }
    }
    
    setProgress(0);
    setCurrentSwatch('');
    toast.success('Batch cleaning complete!');
  };

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
          <h1 className="text-3xl font-bold mb-2">Swatch Image Cleaner</h1>
          <p className="text-muted-foreground">
            Remove text overlays and labels from swatch images using AI
          </p>
        </div>

        {progress > 0 && (
          <Card className="p-6 mb-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Cleaning in progress...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} />
              {currentSwatch && (
                <p className="text-sm text-muted-foreground">Current: {currentSwatch}</p>
              )}
            </div>
          </Card>
        )}

        {/* WBTY Swatches Section */}
        <Card className="p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">WBTY Pattern Swatches</h2>
            <Button
              onClick={cleanAllWBTYSwatches}
              disabled={cleanSwatchMutation.isPending || progress > 0}
              className="gap-2"
            >
              <Wand2 className="h-4 w-4" />
              Clean All WBTY ({wbtySwatches?.length || 0})
            </Button>
          </div>

          {isLoading ? (
            <div className="grid md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-32" />
              ))}
            </div>
          ) : (
            <div className="grid md:grid-cols-4 lg:grid-cols-6 gap-4">
              {wbtySwatches?.slice(0, 12).map((swatch) => (
                <div key={swatch.id} className="space-y-2">
                  <img
                    src={swatch.media_url}
                    alt={swatch.name}
                    className="w-full aspect-square object-cover rounded border"
                  />
                  <p className="text-xs text-center truncate">{swatch.name}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => cleanSwatchMutation.mutate({
                      id: swatch.id,
                      mediaUrl: swatch.media_url,
                      name: swatch.name,
                      table: 'wbty_products'
                    })}
                    disabled={cleanSwatchMutation.isPending || progress > 0}
                  >
                    <Wand2 className="h-3 w-3 mr-1" />
                    Clean
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* InkFusion Swatches Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">InkFusion Color Swatches</h2>
            <Button
              onClick={cleanAllInkFusionSwatches}
              disabled={cleanSwatchMutation.isPending || progress > 0}
              className="gap-2"
            >
              <Wand2 className="h-4 w-4" />
              Clean All InkFusion ({inkfusionSwatches?.length || 0})
            </Button>
          </div>

          <div className="grid md:grid-cols-4 lg:grid-cols-6 gap-4">
            {inkfusionSwatches?.slice(0, 12).map((swatch) => (
              <div key={swatch.id} className="space-y-2">
                <img
                  src={swatch.media_url}
                  alt={swatch.name}
                  className="w-full aspect-square object-cover rounded border"
                />
                <p className="text-xs text-center truncate">{swatch.name}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  onClick={() => cleanSwatchMutation.mutate({
                    id: swatch.id,
                    mediaUrl: swatch.media_url,
                    name: swatch.name,
                    table: 'inkfusion_swatches'
                  })}
                  disabled={cleanSwatchMutation.isPending || progress > 0}
                >
                  <Wand2 className="h-3 w-3 mr-1" />
                  Clean
                </Button>
              </div>
            ))}
          </div>
        </Card>
      </main>

    </div>
  );
}
