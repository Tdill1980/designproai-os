import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getActiveUser } from '@/lib/auth-session';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ShopMemberRole = 'owner' | 'admin' | 'member';

export interface Shop {
  id: string;
  franchise_id: string | null;
  owner_user_id: string;
  name: string;
  slug: string | null;
  logo_url: string | null;
  phone: string | null;
  website: string | null;
  default_include_disclaimer: boolean;
  seat_limit: number;
  created_at: string;
  updated_at: string;
}

export interface Franchise {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  brand_primary_color: string | null;
  brand_secondary_color: string | null;
  website: string | null;
  is_active: boolean;
}

export interface ShopMembership {
  shop: Shop;
  role: ShopMemberRole;
  franchise: Franchise | null;
  // shop_profiles.id for the shop's owner. Group 2 tables (quotes, customers,
  // designiq_generations, panelizer_jobs, ...) still store shop_id as a
  // shop_profiles.id, so teammates need this legacy id to narrow their reads.
  // null until the profile lookup resolves or if the owner never created a
  // shop_profiles row.
  ownerShopProfileId: string | null;
}

// Kept for backwards compatibility with existing callers like Visualize.tsx.
// New code should prefer `currentShop` / `currentMembership`.
export interface Organization {
  id: string;
  name: string;
  subscription_tier: 'free' | 'starter' | 'pro' | 'enterprise';
}

interface OrganizationContextType {
  // Legacy field — kept so existing `useOrganization().organization` calls
  // don't break. Mirrors the currently-selected shop.
  organization: Organization | null;
  setOrganization: (org: Organization | null) => void;

  // New multi-tenant fields
  memberships: ShopMembership[];
  currentShop: Shop | null;
  currentMembership: ShopMembership | null;
  currentFranchise: Franchise | null;
  // Legacy bridge: shop_profiles.id for the current shop's owner. Needed for
  // Group 2 tables (quotes, customers, designiq_generations, panelizer_jobs,
  // production_packs, ...) whose shop_id column still references
  // shop_profiles(id) rather than shops(id). Will become redundant after
  // the PR #1039 follow-up migration rewrites those references.
  currentShopProfileId: string | null;
  isShopOwner: boolean;
  isShopAdmin: boolean;
  isLoading: boolean;
  switchShop: (shopId: string) => void;
  refresh: () => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(
  undefined
);

const CURRENT_SHOP_STORAGE_KEY = 'restylepro_current_shop_id';

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const [memberships, setMemberships] = useState<ShopMembership[]>([]);
  const [currentShopId, setCurrentShopId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CURRENT_SHOP_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);

  const loadMemberships = useCallback(async () => {
    setIsLoading(true);
    try {
      // Cached session read (no /user network round-trip) — keeps this
      // global provider off the serialized auth lock so it doesn't pile up
      // with the dashboard's other auth calls on mount.
      const user = await getActiveUser();

      if (!user) {
        setMemberships([]);
        setIsLoading(false);
        return;
      }

      // Pull every shop_members row for the signed-in user, joined to the
      // shops and franchises tables. RLS makes sure a user can only ever see
      // their own memberships + any franchise they admin.
      const { data, error } = await supabase
        .from('shop_members')
        .select(
          `
            role,
            shop:shops (
              id,
              franchise_id,
              owner_user_id,
              name,
              slug,
              logo_url,
              phone,
              website,
              default_include_disclaimer,
              seat_limit,
              created_at,
              updated_at,
              franchise:franchises (
                id,
                slug,
                name,
                logo_url,
                brand_primary_color,
                brand_secondary_color,
                website,
                is_active
              )
            )
          `
        )
        .eq('user_id', user.id);

      if (error) {
        console.error('[OrganizationContext] failed to load memberships', error);
        setMemberships([]);
        setIsLoading(false);
        return;
      }

      // PostgREST returns `shop` as an object on each row (shop_id is a
      // many-to-one FK). The embedded `franchise` is likewise an object.
      // Cast through unknown so we can reshape into our hand-rolled
      // ShopMembership type without fighting the deep union TS inference
      // produces from the nested select.
      type RawRow = {
        role: ShopMemberRole;
        shop:
          | (Shop & { franchise: Franchise | null })
          | null;
      };
      const rows = (data ?? []) as unknown as RawRow[];
      const withoutProfileId: Omit<ShopMembership, 'ownerShopProfileId'>[] =
        rows
          .filter((row) => row.shop !== null)
          .map((row) => ({
            role: row.role,
            shop: row.shop as Shop,
            franchise:
              (row.shop as Shop & { franchise: Franchise | null })
                .franchise ?? null,
          }));

      // Resolve each shop owner's shop_profiles.id so Group 2 tables
      // (quotes, customers, designiq_generations, panelizer_jobs, ...) can
      // be narrowed by teammates. The lookup runs once per memberships
      // refresh; a missing row is acceptable — the member just won't see
      // legacy shop_profiles-scoped data for that shop until the owner
      // creates a profile via ShopSettings.
      const ownerUserIds = Array.from(
        new Set(withoutProfileId.map((m) => m.shop.owner_user_id))
      );

      const ownerProfileMap = new Map<string, string>();
      if (ownerUserIds.length > 0) {
        const { data: profileRows, error: profileErr } = await supabase
          .from('shop_profiles')
          .select('id, user_id')
          .in('user_id', ownerUserIds);

        if (profileErr) {
          console.error(
            '[OrganizationContext] failed to resolve owner shop_profiles',
            profileErr
          );
        } else if (profileRows) {
          for (const row of profileRows) {
            if (row.user_id && row.id) {
              ownerProfileMap.set(row.user_id, row.id);
            }
          }
        }
      }

      const parsed: ShopMembership[] = withoutProfileId.map((m) => ({
        ...m,
        ownerShopProfileId:
          ownerProfileMap.get(m.shop.owner_user_id) ?? null,
      }));

      setMemberships(parsed);

      // If the persisted shop isn't in the result set (deleted, role revoked,
      // different account), fall back to the first one we did get.
      setCurrentShopId((prev) => {
        if (prev && parsed.some((m) => m.shop.id === prev)) return prev;
        return parsed[0]?.shop.id ?? null;
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load + reload on auth state change
  useEffect(() => {
    loadMemberships();
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, _session) => {
        loadMemberships();
      }
    );
    return () => {
      subscription.subscription.unsubscribe();
    };
  }, [loadMemberships]);

  // Persist the current shop selection
  useEffect(() => {
    try {
      if (currentShopId) {
        localStorage.setItem(CURRENT_SHOP_STORAGE_KEY, currentShopId);
      } else {
        localStorage.removeItem(CURRENT_SHOP_STORAGE_KEY);
      }
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [currentShopId]);

  const currentMembership =
    memberships.find((m) => m.shop.id === currentShopId) ?? null;
  const currentShop = currentMembership?.shop ?? null;
  const currentFranchise = currentMembership?.franchise ?? null;
  const currentShopProfileId = currentMembership?.ownerShopProfileId ?? null;
  const isShopOwner = currentMembership?.role === 'owner';
  const isShopAdmin =
    currentMembership?.role === 'owner' || currentMembership?.role === 'admin';

  // Legacy `organization` mirrors `currentShop` so existing consumers keep
  // working without changes.
  const organization: Organization | null = currentShop
    ? {
        id: currentShop.id,
        name: currentShop.name,
        subscription_tier: 'free',
      }
    : null;

  const setOrganization = (_org: Organization | null) => {
    // no-op: the current shop is now driven by auth/membership, not by
    // arbitrary mutation. Kept on the type so legacy callers still compile.
  };

  const switchShop = (shopId: string) => {
    if (memberships.some((m) => m.shop.id === shopId)) {
      setCurrentShopId(shopId);
    }
  };

  return (
    <OrganizationContext.Provider
      value={{
        organization,
        setOrganization,
        memberships,
        currentShop,
        currentMembership,
        currentFranchise,
        currentShopProfileId,
        isShopOwner,
        isShopAdmin,
        isLoading,
        switchShop,
        refresh: loadMemberships,
      }}
    >
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within OrganizationProvider');
  }
  return context;
}
