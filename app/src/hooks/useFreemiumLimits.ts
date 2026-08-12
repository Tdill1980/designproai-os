import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";

const STORAGE_KEY = "restylepro-freemium";
const FREE_LIMIT = 3;
const BONUS_LIMIT = 2;
/** One-time render grant for sharing on social (Instagram / TikTok / X / Facebook). */
const SOCIAL_SHARE_BONUS = 1;

export type SocialSharePlatform = "instagram" | "tiktok" | "x" | "facebook";

interface FreemiumState {
  generationCount: number;
  bonusUnlocked: boolean;
  bonusEmail: string | null;
  /** True after the user has claimed the one-time social share render. */
  socialShareUnlocked?: boolean;
  socialSharePlatform?: SocialSharePlatform | null;
}

type FreemiumPhase = 'free' | 'engagement' | 'bonus' | 'paywall';

export const useFreemiumLimits = () => {
  const [state, setState] = useState<FreemiumState>({
    generationCount: 0,
    bonusUnlocked: false,
    bonusEmail: null,
  });
  // Default to privileged while loading so the freemium gate never fires
  // before we've had a chance to check user_roles + the email allowlist.
  // checkPrivilegedAccess flips this to false only for confirmed non-admins.
  const [isPrivileged, setIsPrivileged] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  // Load state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setState(JSON.parse(stored));
      } catch (e) {
        console.error("Failed to parse freemium state:", e);
      }
    }
    checkPrivilegedAccess();
  }, []);

  // Check if user is admin or tester. Mirrors useSubscriptionLimits:
  // email allowlist is the immediate belt-and-suspenders so newly added
  // operators bypass the freemium gate even before their user_roles row
  // is synced (or if RLS blocks the read).
  const checkPrivilegedAccess = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) {
        setIsPrivileged(false);
        return;
      }

      if (isAllowlistedAdmin(user.email)) {
        setIsPrivileged(true);
        return;
      }

      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'tester']);

      setIsPrivileged(!!(roles && roles.length > 0));
    } catch (e) {
      console.error("Failed to check privileged access:", e);
      setIsPrivileged(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Save state to localStorage
  const saveState = (newState: FreemiumState) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    setState(newState);
  };

  /** Renders unlocked by the one-time social-share grant. */
  const socialShareGrant = state.socialShareUnlocked ? SOCIAL_SHARE_BONUS : 0;
  const totalAllowed = FREE_LIMIT + (state.bonusUnlocked ? BONUS_LIMIT : 0) + socialShareGrant;

  // Calculate current phase
  const getPhase = (): FreemiumPhase => {
    if (isPrivileged) return 'free';

    const { generationCount, bonusUnlocked } = state;

    if (generationCount < FREE_LIMIT) {
      return 'free';
    }

    if (!bonusUnlocked && generationCount >= totalAllowed) {
      return 'engagement';
    }

    if (generationCount < totalAllowed) {
      return 'bonus';
    }

    return 'paywall';
  };

  const phase = getPhase();

  // Can user generate? (privileged users bypass, others follow freemium)
  const canGenerate = isPrivileged || phase === 'free' || phase === 'bonus';

  // Remaining renders
  const remainingFree = Math.max(0, FREE_LIMIT - state.generationCount);
  const remainingBonus = state.bonusUnlocked || state.socialShareUnlocked
    ? Math.max(0, totalAllowed - state.generationCount)
    : 0;
  const totalRemaining = isPrivileged ? 999 : (remainingFree > 0 ? remainingFree : remainingBonus);

  // Increment generation count
  const incrementGeneration = useCallback(() => {
    if (isPrivileged) return;
    
    const newState = {
      ...state,
      generationCount: state.generationCount + 1,
    };
    saveState(newState);
  }, [state, isPrivileged]);

  // Unlock bonus renders (called after social share + email signup)
  const unlockBonus = useCallback(async (email: string) => {
    try {
      // Save to database
      await supabase.from('email_subscribers').insert({
        email,
        source: 'freemium_funnel',
        social_shared: true,
        renders_unlocked: true,
      });

      // Update local state
      const newState = {
        ...state,
        bonusUnlocked: true,
        bonusEmail: email,
      };
      saveState(newState);
      
      return { success: true };
    } catch (error: any) {
      // If email already exists, still unlock bonus locally
      if (error.code === '23505') {
        const newState = {
          ...state,
          bonusUnlocked: true,
          bonusEmail: email,
        };
        saveState(newState);
        return { success: true };
      }
      console.error("Failed to unlock bonus:", error);
      return { success: false, error: error.message };
    }
  }, [state]);

  /**
   * Grants the one-time +1 render in exchange for sharing on social.
   * Honor system + UTM tracking — we don't OAuth-verify the post in v1.
   * Optional email is logged to email_subscribers when provided so we
   * can attribute shares back to a known shop.
   */
  const unlockSocialShare = useCallback(
    async (platform: SocialSharePlatform, email?: string) => {
      // Already claimed — no-op (still report success so UI can close cleanly).
      if (state.socialShareUnlocked) return { success: true, alreadyClaimed: true };

      try {
        if (email) {
          await supabase
            .from("email_subscribers")
            .upsert(
              {
                email,
                source: "social_share_funnel",
                social_shared: true,
                renders_unlocked: true,
              } as never,
              { onConflict: "email" } as never,
            );
        }
        const newState: FreemiumState = {
          ...state,
          socialShareUnlocked: true,
          socialSharePlatform: platform,
        };
        saveState(newState);
        return { success: true };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Failed to unlock share render";
        return { success: false, error: msg };
      }
    },
    [state],
  );

  // Reset (for testing)
  const resetFreemium = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({
      generationCount: 0,
      bonusUnlocked: false,
      bonusEmail: null,
      socialShareUnlocked: false,
      socialSharePlatform: null,
    });
  }, []);

  return {
    canGenerate,
    phase,
    isPrivileged,
    isLoading,
    generationCount: state.generationCount,
    remainingFree,
    remainingBonus,
    totalRemaining,
    bonusUnlocked: state.bonusUnlocked,
    socialShareUnlocked: !!state.socialShareUnlocked,
    socialSharePlatform: state.socialSharePlatform ?? null,
    incrementGeneration,
    unlockBonus,
    unlockSocialShare,
    resetFreemium,
  };
};
