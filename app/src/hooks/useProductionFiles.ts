import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { toast } from "sonner";

// Production-enabled tiers
const PRODUCTION_TIERS = ['advanced', 'complete', 'agency'];
// Bypass roles - typed for Supabase app_role enum
const BYPASS_ROLES: Array<'admin' | 'tester'> = ['admin', 'tester'];

interface ProductionData {
  mask?: {
    coverageMask: string;
    panelMask: string;
    zoneMask: string;
  };
  vector?: {
    svg: string;
  };
  bleedVector?: {
    svg: string;
  };
  tiles?: string[];
  guide?: {
    materials: string[];
    panels: string[];
    sequence: string[];
    notes: string[];
  };
}

interface UseProductionFilesReturn {
  productionData: ProductionData | null;
  isGeneratingProduction: boolean;
  subscriptionRequired: boolean;
  generateProductionFiles: (renderUrl: string, prompt: string, vehicleId?: string) => Promise<void>;
  clearProductionFiles: () => void;
  checkProductionAccess: () => Promise<boolean>;
}

export const useProductionFiles = (): UseProductionFilesReturn => {
  const [productionData, setProductionData] = useState<ProductionData | null>(null);
  const [isGeneratingProduction, setIsGeneratingProduction] = useState(false);
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);

  const checkProductionAccess = async (): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      // Check for bypass roles
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', BYPASS_ROLES)
        .limit(1)
        .maybeSingle();

      if (roleData) return true;

      // Check subscription tier
      const { data: subData } = await supabase
        .from('user_subscriptions')
        .select('tier, status')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (subData && PRODUCTION_TIERS.includes(subData.tier)) {
        return true;
      }

      return false;
    } catch (error) {
      console.error('Error checking production access:', error);
      return false;
    }
  };

  const generateProductionFiles = async (renderUrl: string, prompt: string, vehicleId?: string) => {
    setIsGeneratingProduction(true);
    setSubscriptionRequired(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        toast.error('Please log in to generate production files');
        setSubscriptionRequired(true);
        return;
      }

      const response = await renderClient.functions.invoke('generate-production-files', {
        body: {
          renderUrl,
          prompt,
          vehicleId
        }
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      const data = response.data;

      if (data.status === 'subscription_required') {
        setSubscriptionRequired(true);
        toast.info(data.message || 'Upgrade to RestylePro Pro to unlock production features');
        return;
      }

      if (data.status === 'ok') {
        setProductionData({
          mask: data.mask,
          vector: data.vector,
          bleedVector: data.bleedVector,
          tiles: data.tiles,
          guide: data.guide
        });
        toast.success('Production files generated!');
      }
    } catch (error) {
      console.error('Error generating production files:', error);
      toast.error('Failed to generate production files');
    } finally {
      setIsGeneratingProduction(false);
    }
  };

  const clearProductionFiles = () => {
    setProductionData(null);
    setSubscriptionRequired(false);
  };

  return {
    productionData,
    isGeneratingProduction,
    subscriptionRequired,
    generateProductionFiles,
    clearProductionFiles,
    checkProductionAccess
  };
};
