import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { renderClient } from '@/integrations/supabase/renderClient';
import { useToast } from '@/hooks/use-toast';
import { getAllAngles, getSpinViewAngle } from '@/lib/spin-view-angles';

interface Use360SpinLogicProps {
  visualizationId?: string;
  vehicleData: {
    year: string;
    make: string;
    model: string;
    type?: string;
  };
  colorData: {
    colorName: string;
    colorHex: string;
    finish: string;
    manufacturer?: string;
    colorLibrary?: string;
    [key: string]: any;
  };
  /** Hero render URL — passed as reference for cross-view consistency */
  heroRenderUrl?: string;
}

export function use360SpinLogic({
  visualizationId,
  vehicleData,
  colorData,
  heroRenderUrl
}: Use360SpinLogicProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentAngle, setCurrentAngle] = useState(0);
  const [currentAngleLabel, setCurrentAngleLabel] = useState('');
  const [generatedPreviews, setGeneratedPreviews] = useState<{angle: number, url: string, label: string}[]>([]);
  const [spinViewUrls, setSpinViewUrls] = useState<Record<number, string>>({});
  const [has360Spin, setHas360Spin] = useState(false);
  const { toast } = useToast();

  const angles = getAllAngles(); // [0, 30, 60, ..., 330]

  /** Render a single spin angle. Returns the URL or null on failure. */
  const renderAngle = async (angle: number): Promise<{ angle: number; url: string | null; label: string }> => {
    const angleInfo = getSpinViewAngle(angle);
    try {
      const { data, error } = await renderClient.functions.invoke('generate-color-render', {
        body: {
          vehicleYear: vehicleData.year,
          vehicleMake: vehicleData.make,
          vehicleModel: vehicleData.model,
          vehicleType: vehicleData.type,
          modeType: colorData.mode_type || 'colorpro',
          colorData: {
            ...colorData,
            mode_type: 'spin_view'
          },
          cameraAngle: angle,
          viewType: 'spin',
          // Pass hero render for cross-view consistency
          heroReferenceUrl: heroRenderUrl || undefined,
          renderOptions: {
            quality: 'high',
            aspectRatio: '16:9'
          }
        }
      });

      if (error) {
        console.error(`❌ Error generating angle ${angle}°:`, error);
        return { angle, url: null, label: angleInfo?.label || `${angle}°` };
      }

      const imageUrl = data?.renderUrl || data?.imageUrl;
      if (!imageUrl) {
        console.error(`No image URL returned for angle ${angle}°`);
        return { angle, url: null, label: angleInfo?.label || `${angle}°` };
      }

      return { angle, url: imageUrl, label: angleInfo?.label || `${angle}°` };
    } catch (error) {
      console.error(`❌ Failed to generate angle ${angle}°:`, error);
      return { angle, url: null, label: angleInfo?.label || `${angle}°` };
    }
  };

  const generate360Spin = useCallback(async () => {
    if (!vehicleData.year || !vehicleData.make || !vehicleData.model) {
      toast({
        title: "Missing vehicle information",
        description: "Please select a vehicle before generating 360° view",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);
    setCurrentAngle(0);
    setCurrentAngleLabel('Starting parallel generation...');
    setGeneratedPreviews([]);
    const generatedUrls: Record<number, string> = {};
    let completedCount = 0;

    try {
      console.log('🚀 Starting parallel-batched 360° generation (3 concurrent)...');

      // Batch 3 concurrent renders at a time — 4 batches total
      // Much faster than sequential (12 calls) while staying under Gemini rate limits
      const batches: number[][] = [
        [0, 30, 60],       // Batch 1: front quadrant
        [90, 120, 150],    // Batch 2: right + rear-right
        [180, 210, 240],   // Batch 3: rear + rear-left
        [270, 300, 330],   // Batch 4: left + front-left
      ];

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];

        // Stagger batches by 2s to avoid Gemini 429 rate limits
        if (batchIdx > 0) {
          console.log(`[360°] Waiting 2s before batch ${batchIdx + 1}...`);
          await new Promise(r => setTimeout(r, 2000));
        }

        console.log(`[360°] Batch ${batchIdx + 1}/${batches.length}: [${batch.join('°, ')}°]`);

        // Fire all 3 angles in this batch concurrently
        const batchResults = await Promise.allSettled(
          batch.map(angle => renderAngle(angle))
        );

        // Process results as they complete
        for (const settled of batchResults) {
          if (settled.status === 'fulfilled' && settled.value.url) {
            const { angle, url, label } = settled.value;
            generatedUrls[angle] = url;
            completedCount++;

            // Update progress immediately
            setCurrentAngle(completedCount);
            setCurrentAngleLabel(`${completedCount} of ${angles.length} complete`);

            // Add to preview strip immediately (sorted)
            setGeneratedPreviews(prev =>
              [...prev, { angle, url, label }].sort((a, b) => a.angle - b.angle)
            );

            // Once we have 4+ frames, enable the viewer for early preview
            if (completedCount >= 4 && !has360Spin) {
              setSpinViewUrls({ ...generatedUrls });
              setHas360Spin(true);
            }

            console.log(`✅ Angle ${angle}° completed (${completedCount}/${angles.length})`);
          } else {
            const failedAngle = settled.status === 'fulfilled' ? settled.value.angle : 'unknown';
            console.error(`❌ Angle ${failedAngle}° failed`);
          }
        }

        // Update the spin viewer with latest frames after each batch
        setSpinViewUrls({ ...generatedUrls });
      }

      const successCount = Object.keys(generatedUrls).length;
      const failureCount = angles.length - successCount;

      console.log(`📊 360° Generation Complete: ${successCount} succeeded, ${failureCount} failed`);

      if (successCount === 0) {
        throw new Error('All 360° angle generations failed. Please try again.');
      }

      if (failureCount > 0) {
        toast({
          title: "Partial Success",
          description: `${successCount} of ${angles.length} angles generated. Some angles failed but you can still view the 360° spin.`,
          variant: "default"
        });
      }

      // Update database with spin view URLs
      if (visualizationId) {
        const { data: existingViz } = await supabase
          .from('color_visualizations')
          .select('render_urls')
          .eq('id', visualizationId)
          .single();

        const existingRenderUrls = (existingViz?.render_urls as Record<string, any>) || {};

        const { error: updateError } = await supabase
          .from('color_visualizations')
          .update({
            render_urls: {
              ...existingRenderUrls,
              spin_views: generatedUrls
            },
            has_360_spin: true,
            spin_view_count: successCount
          })
          .eq('id', visualizationId);

        if (updateError) {
          console.error('Error updating visualization with 360° data:', updateError);
        }
      }

      setSpinViewUrls(generatedUrls);
      setHas360Spin(true);

      toast({
        title: "360° Spin View Complete!",
        description: `${successCount} angles generated. Drag to rotate your vehicle.`
      });
    } catch (error) {
      console.error('Error generating 360° spin:', error);
      toast({
        title: "Generation Failed",
        description: error instanceof Error ? error.message : "Failed to generate 360° view",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
      setCurrentAngle(0);
    }
  }, [vehicleData, colorData, heroRenderUrl, visualizationId, angles, toast]);

  const clear360Spin = useCallback(() => {
    setSpinViewUrls({});
    setHas360Spin(false);
    setCurrentAngle(0);
    setGeneratedPreviews([]);
  }, []);

  // Convert spinViewUrls object to ordered array for Vehicle360Viewer
  // Only include angles that have URLs (handles partial generation)
  const getSpinImagesArray = useCallback(() => {
    return angles.map(angle => spinViewUrls[angle]).filter(Boolean);
  }, [spinViewUrls, angles]);

  return {
    // State
    isGenerating,
    currentAngle,
    currentAngleLabel,
    generatedPreviews,
    spinViewUrls,
    has360Spin,
    totalAngles: angles.length,

    // Actions
    generate360Spin,
    clear360Spin,
    getSpinImagesArray
  };
}
