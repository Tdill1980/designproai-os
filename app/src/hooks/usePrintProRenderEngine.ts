import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { renderClient } from '@/integrations/supabase/renderClient';
import { toast } from 'sonner';

interface ProductData {
  swatchColor?: string;
  swatchName?: string;
  finish?: string;
  designUrl?: string;
  designName?: string;
}

interface RenderView {
  type: string;
  url: string;
}

export function usePrintProRenderEngine() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [views, setViews] = useState<RenderView[]>([]);

  const generateRender = async (
    vehicle: { year: string; make: string; model: string },
    productData: ProductData,
    viewType: string = 'hood_detail'
  ) => {
    try {
      setIsGenerating(true);
      
      console.log('PrintPro generating render:', { vehicle, productData, viewType });

      const { data, error } = await renderClient.functions.invoke('generate-printpro-render', {
        body: {
          vehicleYear: vehicle.year,
          vehicleMake: vehicle.make,
          vehicleModel: vehicle.model,
          productData,
          viewType,
          userEmail: (await supabase.auth.getUser()).data.user?.email
        }
      });

      if (error) {
        console.error('PrintPro render error:', error);
        throw error;
      }

      if (!data?.renderUrl) {
        throw new Error('No render URL returned');
      }

      const newView: RenderView = {
        type: viewType,
        url: data.renderUrl
      };

      setViews(prev => {
        // Replace view if it exists, otherwise add it
        const existingIndex = prev.findIndex(v => v.type === viewType);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = newView;
          return updated;
        }
        return [...prev, newView];
      });

      toast.success('Render generated successfully');
      return data.renderUrl;

    } catch (error) {
      console.error('PrintPro render generation failed:', error);
      toast.error('Failed to generate render');
      throw error;
    } finally {
      setIsGenerating(false);
    }
  };

  const generateAdditionalViews = async (
    vehicle: { year: string; make: string; model: string },
    productData: ProductData
  ) => {
    try {
      setIsGenerating(true);
      
      const additionalViews = ['front', 'side', 'rear'];
      
      await Promise.all(
        additionalViews.map(viewType => generateRender(vehicle, productData, viewType))
      );

      toast.success('All views generated successfully');

    } catch (error) {
      console.error('Additional views generation failed:', error);
      toast.error('Failed to generate additional views');
    } finally {
      setIsGenerating(false);
    }
  };

  const clearRenders = () => {
    setViews([]);
  };

  return {
    isGenerating,
    views,
    generateRender,
    generateAdditionalViews,
    clearRenders
  };
}
