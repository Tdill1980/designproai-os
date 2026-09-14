-- Multi-tenant Phase 1: franchises, shops, shop_members, franchise_admins.
--
-- Owner, 2026-09-13: "the aim is franchising wallpro tool from
-- os.designproai.com so sign companies like signorama FASTSIGNS can use on
-- demand send links to thier customers to design and buy" — then, correcting
-- me: "The os has tenant architecture already."
--
-- SHE IS RIGHT ABOUT THE CODE AND IT IS HALF-PORTED. app/src/contexts/
-- OrganizationContext.tsx carries the whole model — Shop, Franchise,
-- ShopMembership, owner/admin/member, and the branding fields a white-label
-- header needs (shop.name, shop.slug, shop.logo_url; franchise.name,
-- franchise.logo_url, brand_primary_color, brand_secondary_color). It queries
-- `shop_members` on every load, and that table does not exist on this project:
-- the context logs "[OrganizationContext] failed to load memberships" and
-- carries on empty, which is why nobody noticed. The app came
-- over from the reference implementation with its tenant code; the schema
-- stayed behind.
--
-- RULE 1 — this is a PORT, not a design. The source is the reference
-- implementation's 20260411235000_multi_tenant_phase1.sql: same four tables,
-- same four SECURITY DEFINER helpers, same shop-scoped + franchise-scoped +
-- platform-admin RLS, same auto-shop-on-signup trigger. Running there since
-- April. Full provenance is in this migration's commit message, which is
-- outside the runtime closure the standalone-only guard protects.
--
-- FOUR DELIBERATE DELTAS, each because this project differs:
--
--   1. NO FRANCHISE SEEDS. The source seeded Tint World and Signarama, and its
--      own follow-up (20260411235500) deleted them again: "Those are prospects,
--      not signed franchise customers. When they onboard for real they should
--      go through the normal admin flow, not a checked-in seed." Porting the
--      corrected end state rather than re-importing a mistake that was already
--      fixed once.
--
--   2. NO LEGACY BRANDING BACKFILL. The source carried each user's existing
--      shop branding across from a per-user profile table this project does
--      not have, so its step 9a has no source rows at all. Every existing user
--      gets a plain shop instead, named from the signup trigger's default.
--
--   3. update_updated_at_column() IS CREATED HERE. The source depends on it;
--      this project has no such function. Defined defensively so it cannot
--      collide with a later one.
--
--   4. HOUSE CONVENTIONS. `(SELECT auth.uid())` rather than bare `auth.uid()`
--      so Postgres hoists it to an InitPlan instead of re-evaluating per row;
--      snake_case policy names; explicit REVOKE/GRANT. Functionally identical
--      to the source, consistent with every other migration here.
--
-- WHAT THIS DOES NOT DO, deliberately: it adds no shop_id to any WallPro table.
-- That is Phase 1b, exactly as the source phased it, and it wants its own
-- reviewable migration — scoping a customer's live designs to a tenant is the
-- change that must not be rushed.

-- 1 ── seat roles
DO $$ BEGIN
  CREATE TYPE public.shop_member_role AS ENUM ('owner','admin','member');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- The source's shared updated_at trigger, absent on this project.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

-- 2 ── franchises: the parent org a sign brand signs as (Signarama, FASTSIGNS).
CREATE TABLE IF NOT EXISTS public.franchises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  logo_url text,
  brand_primary_color text,
  brand_secondary_color text,
  website text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.franchises ENABLE ROW LEVEL SECURITY;

-- 3 ── shops: the tenant unit. One location, one link, one brand in the header.
CREATE TABLE IF NOT EXISTS public.shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id uuid REFERENCES public.franchises(id) ON DELETE SET NULL,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text UNIQUE,
  logo_url text,
  phone text,
  website text,
  default_include_disclaimer boolean NOT NULL DEFAULT false,
  seat_limit integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shops_franchise_id ON public.shops(franchise_id);
CREATE INDEX IF NOT EXISTS idx_shops_owner_user_id ON public.shops(owner_user_id);
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

-- 4 ── shop_members: the seats a shop buys.
CREATE TABLE IF NOT EXISTS public.shop_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.shop_member_role NOT NULL DEFAULT 'member',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_shop_members_user_id ON public.shop_members(user_id);
CREATE INDEX IF NOT EXISTS idx_shop_members_shop_id ON public.shop_members(shop_id);
ALTER TABLE public.shop_members ENABLE ROW LEVEL SECURITY;

-- 5 ── franchise_admins: one person over every shop in a brand.
CREATE TABLE IF NOT EXISTS public.franchise_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id uuid NOT NULL REFERENCES public.franchises(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (franchise_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_franchise_admins_user_id ON public.franchise_admins(user_id);
ALTER TABLE public.franchise_admins ENABLE ROW LEVEL SECURITY;

-- 6 ── helpers. SECURITY DEFINER because an RLS policy is evaluated with the
-- PRIVILEGES OF THE QUERYING USER: an inline EXISTS against shop_members from
-- an `authenticated` session can only read what that session could read
-- directly, and a policy that reaches further dies with "permission denied"
-- and takes the whole read down with it.
CREATE OR REPLACE FUNCTION public.user_shop_ids(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT shop_id FROM public.shop_members WHERE user_id = _user_id
  UNION
  SELECT s.id FROM public.shops s
    JOIN public.franchise_admins fa ON fa.franchise_id = s.franchise_id
   WHERE fa.user_id = _user_id
  UNION
  SELECT s.id FROM public.shops s
   WHERE public.has_role(_user_id, 'admin'::public.app_role)
$$;

CREATE OR REPLACE FUNCTION public.is_shop_member(_user_id uuid, _shop_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM public.shop_members
                  WHERE user_id = _user_id AND shop_id = _shop_id)
$$;

CREATE OR REPLACE FUNCTION public.is_shop_admin(_user_id uuid, _shop_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM public.shop_members
                  WHERE user_id = _user_id AND shop_id = _shop_id
                    AND role IN ('owner'::public.shop_member_role,
                                 'admin'::public.shop_member_role))
$$;

CREATE OR REPLACE FUNCTION public.is_franchise_admin(_user_id uuid, _franchise_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS (SELECT 1 FROM public.franchise_admins
                  WHERE user_id = _user_id AND franchise_id = _franchise_id)
$$;

-- 7 ── RLS.
-- Franchise branding is readable by anyone signed in: a partner's logo has to
-- render on the page BEFORE the visitor is a member of anything, which is the
-- whole point of a link a shop sends its own customer.
CREATE POLICY franchise_read_active ON public.franchises FOR SELECT TO authenticated
USING (is_active = true);
CREATE POLICY franchise_platform_admin_all ON public.franchises FOR ALL TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role))
WITH CHECK (public.has_role((SELECT auth.uid()),'admin'::public.app_role));

CREATE POLICY shop_member_read ON public.shops FOR SELECT TO authenticated
USING (
  public.is_shop_member((SELECT auth.uid()), id)
  OR (franchise_id IS NOT NULL AND public.is_franchise_admin((SELECT auth.uid()), franchise_id))
  OR public.has_role((SELECT auth.uid()),'admin'::public.app_role)
);
CREATE POLICY shop_admin_update ON public.shops FOR UPDATE TO authenticated
USING (public.is_shop_admin((SELECT auth.uid()), id) OR public.has_role((SELECT auth.uid()),'admin'::public.app_role))
WITH CHECK (public.is_shop_admin((SELECT auth.uid()), id) OR public.has_role((SELECT auth.uid()),'admin'::public.app_role));
CREATE POLICY shop_owner_insert ON public.shops FOR INSERT TO authenticated
WITH CHECK (owner_user_id = (SELECT auth.uid()));
CREATE POLICY shop_platform_admin_delete ON public.shops FOR DELETE TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role));

CREATE POLICY shop_member_read_teammates ON public.shop_members FOR SELECT TO authenticated
USING (public.is_shop_member((SELECT auth.uid()), shop_id) OR public.has_role((SELECT auth.uid()),'admin'::public.app_role));
CREATE POLICY shop_admin_manage_members ON public.shop_members FOR ALL TO authenticated
USING (public.is_shop_admin((SELECT auth.uid()), shop_id) OR public.has_role((SELECT auth.uid()),'admin'::public.app_role))
WITH CHECK (public.is_shop_admin((SELECT auth.uid()), shop_id) OR public.has_role((SELECT auth.uid()),'admin'::public.app_role));

CREATE POLICY franchise_admin_read_self ON public.franchise_admins FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()),'admin'::public.app_role));
CREATE POLICY franchise_admin_platform_manage ON public.franchise_admins FOR ALL TO authenticated
USING (public.has_role((SELECT auth.uid()),'admin'::public.app_role))
WITH CHECK (public.has_role((SELECT auth.uid()),'admin'::public.app_role));

-- 8 ── grants, explicit as everywhere else on this project.
REVOKE ALL ON public.franchises, public.shops, public.shop_members, public.franchise_admins FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.franchises TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.shops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_members TO authenticated;
GRANT SELECT ON public.franchise_admins TO authenticated;
GRANT ALL ON public.franchises, public.shops, public.shop_members, public.franchise_admins TO service_role;
REVOKE ALL ON FUNCTION public.user_shop_ids(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_shop_member(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_shop_admin(uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_franchise_admin(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_shop_ids(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_shop_member(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_shop_admin(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_franchise_admin(uuid,uuid) TO authenticated, service_role;

-- 9 ── updated_at
DROP TRIGGER IF EXISTS update_franchises_updated_at ON public.franchises;
CREATE TRIGGER update_franchises_updated_at BEFORE UPDATE ON public.franchises
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_shops_updated_at ON public.shops;
CREATE TRIGGER update_shops_updated_at BEFORE UPDATE ON public.shops
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10 ── backfill: every existing user owns a shop, so there is always a tenant
-- to attach work to and OrganizationContext stops failing on first load.
INSERT INTO public.shops (owner_user_id, name, created_at, updated_at)
SELECT u.id, 'My Shop', COALESCE(u.created_at, now()), now()
  FROM auth.users u
 WHERE NOT EXISTS (SELECT 1 FROM public.shops s WHERE s.owner_user_id = u.id);

INSERT INTO public.shop_members (shop_id, user_id, role, accepted_at, created_at)
SELECT s.id, s.owner_user_id, 'owner'::public.shop_member_role, s.created_at, s.created_at
  FROM public.shops s
 WHERE NOT EXISTS (SELECT 1 FROM public.shop_members m
                    WHERE m.shop_id = s.id AND m.user_id = s.owner_user_id);

-- 11 ── every new signup gets a shop, so a tenant always exists.
CREATE OR REPLACE FUNCTION public.handle_new_user_shop()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE new_shop_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.shops WHERE owner_user_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.shops (owner_user_id, name) VALUES (NEW.id, 'New Shop')
  RETURNING id INTO new_shop_id;
  INSERT INTO public.shop_members (shop_id, user_id, role, accepted_at)
  VALUES (new_shop_id, NEW.id, 'owner'::public.shop_member_role, now());
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.handle_new_user_shop() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created_shop ON auth.users;
CREATE TRIGGER on_auth_user_created_shop AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_shop();
