import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface RenderLimitStatus {
  canGenerate: boolean;
  tier: string;
  limit: number;
  used: number;
  remaining: number;
  message: string;
}

export const useRenderLimits = (userEmail: string | null) => {
  const [limitStatus, setLimitStatus] = useState<RenderLimitStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showUpsell, setShowUpsell] = useState(false);

  const checkLimits = async () => {
    if (!userEmail) {
      setLimitStatus({
        canGenerate: false,
        tier: 'none',
        limit: 0,
        used: 0,
        remaining: 0,
        message: 'Please provide an email to check render limits.'
      });
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc('can_generate_render', {
        user_email: userEmail
      });

      if (error) throw error;

      if (data) {
        const status = {
          canGenerate: (data as any).can_generate,
          tier: (data as any).tier,
          limit: (data as any).limit,
          used: (data as any).used,
          remaining: (data as any).remaining,
          message: (data as any).message
        };
        setLimitStatus(status);
        
        // Show upsell ONLY if user has an actual plan but exceeded limit
        // Don't show for 'none' tier users - they should see login/signup prompts instead
        if (!status.canGenerate && status.tier !== 'none' && status.limit > 0 && status.used >= status.limit) {
          setShowUpsell(true);
        }
      }
    } catch (error) {
      console.error('Error checking render limits:', error);
      toast.error('Failed to check render limits');
      setLimitStatus({
        canGenerate: false,
        tier: 'none',
        limit: 0,
        used: 0,
        remaining: 0,
        message: 'Error checking limits'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const trackRenderUsage = async (renderType: string) => {
    if (!userEmail) return;

    try {
      // Get user's subscription to get billing cycle start
      const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select('tier, billing_cycle_start, user_id')
        .eq('email', userEmail)
        .eq('status', 'active')
        .single();

      if (!subscription) {
        console.error('No active subscription found');
        return;
      }

      // Insert render usage record
      const { error } = await supabase
        .from('render_usage')
        .insert({
          user_id: subscription.user_id,
          email: userEmail,
          tier: subscription.tier,
          render_type: renderType,
          billing_cycle_start: subscription.billing_cycle_start
        });

      if (error) throw error;

      // Refresh limit status
      await checkLimits();
    } catch (error) {
      console.error('Error tracking render usage:', error);
    }
  };

  useEffect(() => {
    if (userEmail) {
      checkLimits();
    }
  }, [userEmail]);

  return {
    limitStatus,
    isLoading,
    checkLimits,
    trackRenderUsage,
    showUpsell,
    setShowUpsell,
  };
};
