import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Checks if the user has completed terms onboarding.
 * Returns true if they need to set up terms (no custom_terms_text in shop_profiles).
 * Only triggers once per session via sessionStorage flag.
 */
export function useTermsOnboarding() {
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    const SESSION_KEY = 'restylepro_terms_onboarded';
    if (sessionStorage.getItem(SESSION_KEY) === 'true') return;

    const check = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await supabase
          .from('shop_profiles')
          .select('custom_terms_text')
          .eq('user_id', user.id)
          .single();

        // If no profile or no custom terms, trigger onboarding
        if (!data || !(data as any).custom_terms_text) {
          setNeedsOnboarding(true);
        } else {
          sessionStorage.setItem(SESSION_KEY, 'true');
        }
      } catch {
        // No profile found — needs onboarding
        setNeedsOnboarding(true);
      }
    };

    check();
  }, []);

  const markComplete = () => {
    sessionStorage.setItem('restylepro_terms_onboarded', 'true');
    setNeedsOnboarding(false);
  };

  return { needsOnboarding, markComplete };
}
