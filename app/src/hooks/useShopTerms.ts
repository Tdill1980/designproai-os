import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_TERMS_TEXT } from '@/lib/default-terms';

interface ShopTermsState {
  termsText: string;
  isLoading: boolean;
  isSaving: boolean;
  hasCustomTerms: boolean;
}

/**
 * Hook to load and save the shop's custom Terms & Conditions.
 * Falls back to DEFAULT_TERMS_TEXT if none set.
 */
export function useShopTerms() {
  const [state, setState] = useState<ShopTermsState>({
    termsText: DEFAULT_TERMS_TEXT,
    isLoading: true,
    isSaving: false,
    hasCustomTerms: false,
  });

  const loadTerms = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setState(prev => ({ ...prev, isLoading: false }));
        return;
      }

      const { data } = await supabase
        .from('shop_profiles')
        .select('custom_terms_text')
        .eq('user_id', user.id)
        .single();

      if (data?.custom_terms_text) {
        setState({
          termsText: data.custom_terms_text,
          isLoading: false,
          isSaving: false,
          hasCustomTerms: true,
        });
      } else {
        setState({
          termsText: DEFAULT_TERMS_TEXT,
          isLoading: false,
          isSaving: false,
          hasCustomTerms: false,
        });
      }
    } catch {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    loadTerms();
  }, [loadTerms]);

  const saveTerms = useCallback(async (newTerms: string): Promise<boolean> => {
    setState(prev => ({ ...prev, isSaving: true }));
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { error } = await supabase
        .from('shop_profiles')
        .upsert({
          user_id: user.id,
          custom_terms_text: newTerms,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

      if (error) throw error;

      setState(prev => ({
        ...prev,
        termsText: newTerms,
        isSaving: false,
        hasCustomTerms: true,
      }));
      return true;
    } catch (err) {
      console.error('Failed to save terms:', err);
      setState(prev => ({ ...prev, isSaving: false }));
      return false;
    }
  }, []);

  const setTermsText = useCallback((text: string) => {
    setState(prev => ({ ...prev, termsText: text }));
  }, []);

  return {
    ...state,
    setTermsText,
    saveTerms,
    reloadTerms: loadTerms,
  };
}
