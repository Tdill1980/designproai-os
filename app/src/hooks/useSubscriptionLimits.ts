import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";

const AGENCY_UNLIMITED = {
  id: "admin-unlimited",
  tier: "agency",
  status: "active",
  render_count: 0,
  stripe_subscription_item_extra: null,
  render_reset_date: null,
  billing_cycle_start: new Date().toISOString(),
  billing_cycle_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
};

const RENDER_LIMITS: Record<string, number> = {
  starter: 50,
  advanced: 50,
  professional: 100,
  complete: 200,
  proshop: 200,
  enterprise: 999999,
  agency: 999999,
  free: 0
};

interface Subscription {
  id: string;
  tier: string;
  status: string;
  render_count: number;
  stripe_subscription_item_extra: string | null;
  render_reset_date: string | null;
  billing_cycle_start: string;
  billing_cycle_end: string;
}

export const useSubscriptionLimits = () => {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSubscription();
    
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        checkSubscription();
      }
      if (event === 'SIGNED_OUT') {
        setSubscription(null);
        setLoading(false);
      }
    });
    
    return () => authSub.unsubscribe();
  }, []);

  const checkSubscription = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        setLoading(false);
        return;
      }

      // Email allowlist check first — lets operators in immediately,
      // even before their user_roles row is synced or if RLS fails.
      if (isAllowlistedAdmin(user.email)) {
        setSubscription({ ...AGENCY_UNLIMITED });
        setLoading(false);
        return;
      }

      // Check for admin or tester role - grants unlimited access
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'tester'])
        .limit(1)
        .maybeSingle();

      if (roleError) {
        console.error('Error checking admin/tester role (possible RLS issue):', roleError);
      }

      if (roleData) {
        setSubscription({ ...AGENCY_UNLIMITED });
        setLoading(false);
        return;
      }

      const { data, error: subError } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      if (subError) {
        console.error('Error fetching subscription:', subError);
      }

      setSubscription(data);
    } catch (error) {
      console.error('Error checking subscription:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkCanGenerate = async (): Promise<boolean> => {
    // No subscription = use freemium funnel (handled elsewhere)
    if (!subscription) {
      return true; // Let freemium handle it
    }

    // Admins/testers bypass all limits
    if (subscription.tier === 'agency') {
      return true;
    }

    const limit = RENDER_LIMITS[subscription.tier as keyof typeof RENDER_LIMITS] || 0;
    const currentCount = subscription.render_count || 0;

    if (currentCount >= limit) {
      // Design-token pool fallback. Free-tier (and exhausted paid) users can
      // still render if they hold purchased / welcome design tokens — the
      // server token-gate (_shared/token-gate.ts) deducts one per render and
      // is the source of truth. Without this check the client blocked the
      // request before it ever reached that gate, stranding paid tokens.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (userId) {
          const { data: tokRow } = await supabase
            .from('user_tokens')
            .select('balance')
            .eq('user_id', userId)
            .maybeSingle();
          if (Number((tokRow as { balance?: number } | null)?.balance ?? 0) > 0) {
            return true;
          }
        }
      } catch (e) {
        console.warn('[useSubscriptionLimits] token balance check failed:', e);
      }

      if (subscription.stripe_subscription_item_extra) {
        try {
          const { error } = await supabase.functions.invoke('report-extra-render', {
            body: { subscription_item_id: subscription.stripe_subscription_item_extra }
          });
          if (error) {
            toast.error('Failed to track usage');
            return false;
          }
          toast.info('Extra render will be added to your next invoice');
        } catch (error) {
          return false;
        }
      } else {
        toast.error(
          limit > 0
            ? `Monthly limit of ${limit} renders reached`
            : "You're out of design tokens — purchase more to keep rendering"
        );
        return false;
      }
    }

    return true;
  };

  const incrementRenderCount = async () => {
    if (!subscription || subscription.tier === 'agency') return;

    try {
      const newCount = (subscription.render_count || 0) + 1;
      
      const { error } = await supabase
        .from('user_subscriptions')
        .update({ render_count: newCount } as any)
        .eq('id', subscription.id);

      if (!error) {
        setSubscription({ ...subscription, render_count: newCount });
      }
    } catch (error) {
      console.error('Error updating render count:', error);
    }
  };

  return {
    subscription,
    loading,
    checkCanGenerate,
    incrementRenderCount,
    refetch: checkSubscription
  };
};
