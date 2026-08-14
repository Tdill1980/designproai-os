-- DesignProAI account entitlements.
--
-- The migrated DesignPro product UI resolves what an operator is allowed to do
-- from three account tables: user_roles (admin/tester bypass), user_subscriptions
-- (paid tier) and user_tokens (single-use design tokens). Those tables were part
-- of the product this repository was carved out of and were never carried into
-- the standalone project, so every surface that asks "what tier is this account?"
-- fell through to `free` and the DesignIQ generator rendered its locked
-- "Upgrade to Unlock" state instead of the workspace.
--
-- This migration brings the tables across with the same shape the product's
-- generated types already describe (app/src/integrations/supabase/types.ts), so
-- the UI is wired to real rows rather than to a client-side allowlist.
--
-- Writes stay closed: entitlement rows are minted by the service role (billing
-- callbacks, operator bootstrap), never by the browser. Readers see only their
-- own row; admins may read across accounts for the billing/subscription views.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'app_role' AND n.nspname = 'public'
  ) THEN
    CREATE TYPE public.app_role AS ENUM ('admin','moderator','user','tester','designer');
  END IF;
END
$$;

-- ── user_roles ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_key
  ON public.user_roles(user_id, role);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Role lookups run inside other tables' policies, so this has to be SECURITY
-- DEFINER: a policy that queried user_roles directly under RLS would recurse.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$fn$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

DROP POLICY IF EXISTS user_roles_read_own ON public.user_roles;
CREATE POLICY user_roles_read_own ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'));

-- ── user_subscriptions ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  tier text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  billing_cycle_start timestamptz NOT NULL DEFAULT now(),
  billing_cycle_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  render_count integer DEFAULT 0,
  render_reset_date timestamptz DEFAULT now(),
  alacarte_renders_remaining integer NOT NULL DEFAULT 0,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  stripe_subscription_item_extra text,
  woo_customer_id integer,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_subscriptions_user_status_idx
  ON public.user_subscriptions(user_id, status);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_subscriptions_read_own ON public.user_subscriptions;
CREATE POLICY user_subscriptions_read_own ON public.user_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'));

-- ── user_tokens ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_tokens (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0,
  total_purchased integer NOT NULL DEFAULT 0,
  total_used integer NOT NULL DEFAULT 0,
  unlimited_revisions boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.user_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_tokens_read_own ON public.user_tokens;
CREATE POLICY user_tokens_read_own ON public.user_tokens
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.has_role((SELECT auth.uid()), 'admin'));

-- Browsers read entitlements; only the service role mints them.
GRANT SELECT ON public.user_roles, public.user_subscriptions, public.user_tokens TO authenticated;
GRANT ALL ON public.user_roles, public.user_subscriptions, public.user_tokens TO service_role;

-- ── operator bootstrap ────────────────────────────────────────────────────
-- Grant the DesignProAI operating accounts their admin role from the same
-- allowlist the frontend carries (app/src/lib/admin-allowlist.ts), so tier
-- resolution no longer depends on that client-side fallback. Accounts that do
-- not exist in this project are simply skipped.
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE lower(u.email) IN (
  'tdill@restyleproai.com',
  'trish@restyleproai.com',
  'trish@weprintwraps.com',
  'brice@weprintwraps.com',
  'jackson@weprintwraps.com',
  'lance@weprintwraps.com',
  'troy@weprintwraps.com',
  'wyatt-cto@weprintwraps.com',
  'carley@restyleproai.com',
  'amanda@restyleproai.com',
  'amandakinz1111@gmail.com',
  'canary-operator@designproai.com'
)
ON CONFLICT (user_id, role) DO NOTHING;
