-- WALLPRO: TRY FREE, AND COMMERCIALPRO MEMBERS DESIGN FREE
-- ═══════════════════════════════════════════════════════════
--
-- Owner, 2026-09-14: "We shpuld have a try free. COmmercialPro members get free
-- wallpro", on the day WallPro debuts on weprintwraps.com.
--
-- WHY IT IS BLOCKING. reserve_wallpro_generation charges in this order:
-- privileged (admin/tester) -> active subscription under cap -> user_tokens,
-- and RAISES 'no_tokens' when none of those hold. A WePrintWraps customer
-- arriving on the wall wrap product page has no role, no subscription and no
-- tokens, so the FIRST click of Generate raised no_tokens behind a "Sign in to
-- generate" wall -- for a DesignProAI account, on a WePrintWraps page, before
-- they had seen a single pixel of their own room. Every dollar on that page sat
-- behind a signup for a company they did not come to.
--
-- Two new charge sources, both free, ahead of subscription/tokens:
--
--   'trial'         the first generation any owner ever runs. One, ever.
--   'commercialpro' free while the owner is a current CommercialPro member.
--
-- WHY THE TRIAL IS SAFE TO GIVE AWAY. The paywall on this product is not the
-- image, it is the PRINT-READY FILE -- panelized, seam-verified, at the wall's
-- real dimensions -- and that stays gated on wallpro_purchase_entitlements,
-- untouched here. A trial spends one model call and buys a person who has seen
-- their own wall wrapped. The honest cost: someone who clears their browser can
-- take another free preview. That is the same bet every try-before-you-buy tool
-- makes, and it is bounded at one image per identity.
--
-- A FAILED TRIAL IS NOT A SPENT TRIAL. The eligibility predicate ignores rows
-- in state 'failed', so a generation that errored leaves the customer their one
-- free attempt rather than charging them for our outage.
--
-- ⚠️ THE FUNCTION IS TEXT-PATCHED, NOT RESTATED, AND HERE IS WHAT THAT COST TO
-- LEARN. The first draft of this migration CREATE OR REPLACE'd the whole body,
-- reproduced from a truncated read of the original. The subscription cap line
-- really reads:
--     WHEN 'enterprise' THEN 999999 WHEN 'agency' THEN 999999 ELSE 0 END
-- and the restatement guessed "WHEN 'enterprise' THEN 400 ELSE 0 END" -- which
-- would have capped enterprise at 400 AND DELETED THE 'agency' TIER, dropping
-- every agency subscriber to cap=0, past the subscription branch, into
-- no_tokens. Patching the live body cannot make that class of mistake: the text
-- this migration never mentions is the text it cannot break.
--
-- ⚠️ NOTHING POPULATES commercialpro_members YET, AND THAT IS DELIBERATE.
-- CommercialPro today is four per-order WooCommerce coupons (FLEET5/10/15/20)
-- gated on cart dollars. There is no membership anywhere in either repository --
-- a page describing an enrolled tier was removed from the trade page earlier the
-- same day for exactly that reason. This migration builds the GRANT, not the
-- enrolment: who qualifies is an owner decision with a real data source behind
-- it (wpw_orders / wpw_order_items -- 62 customers cleared 500 sq ft in the last
-- twelve months). Until a row exists nobody is a member and the branch is inert.
-- Do not advertise membership until something writes to this table.

CREATE TABLE IF NOT EXISTS public.commercialpro_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Why they qualified, in words, so a support conversation can answer it.
  reason text NOT NULL,
  -- NULL = open-ended. A dated membership expires without anyone remembering to.
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.commercialpro_members IS
  'CommercialPro membership. Grants free WallPro design generation. Nothing populates this yet; enrolment is an owner decision (see 20260914230000).';

ALTER TABLE public.commercialpro_members ENABLE ROW LEVEL SECURITY;
-- A member may see their own row, so the UI can say "included with
-- CommercialPro" truthfully. Nobody writes from the client.
DROP POLICY IF EXISTS commercialpro_members_read_own ON public.commercialpro_members;
CREATE POLICY commercialpro_members_read_own ON public.commercialpro_members
  FOR SELECT TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON TABLE public.commercialpro_members FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.commercialpro_members TO authenticated;

-- ── Patch the LIVE body of reserve_wallpro_generation ──────────────────────
DO $patch$
DECLARE src text; patched text; anchor text; addition text; hits integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reserve_wallpro_generation';
  IF src IS NULL THEN RAISE EXCEPTION 'reserve_wallpro_generation not found'; END IF;

  -- Already patched (re-run, or applied out of order): leave it alone.
  IF position('commercialpro' in src) > 0 THEN RETURN; END IF;

  anchor := 'source:=''privileged'';';
  hits := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  IF hits <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 privileged branch, found %', hits;
  END IF;

  -- The two free branches sit between the privileged IF and the existing ELSE,
  -- so the subscription and token arms below are reached only when neither
  -- applies. Every line the original owns is untouched.
  addition :=
    E'\n  ELSIF EXISTS (SELECT 1 FROM public.commercialpro_members m'
    || E'\n                 WHERE m.user_id=p_owner AND (m.expires_at IS NULL OR m.expires_at>now()))'
    || E'\n    THEN source:=''commercialpro'';'
    || E'\n  ELSIF NOT EXISTS (SELECT 1 FROM public.wallpro_generations'
    || E'\n                    WHERE owner_id=p_owner AND state<>''failed'')'
    || E'\n    THEN source:=''trial'';';

  patched := replace(src, anchor, anchor || addition);
  EXECUTE patched;

  -- VALIDATE WHAT WAS PRODUCED, not only that the search string was found.
  -- Re-read the installed definition and require both new branches AND the
  -- untouched tiers the restatement would have destroyed.
  SELECT pg_get_functiondef(p.oid) INTO src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reserve_wallpro_generation';
  IF position('''commercialpro''' in src) = 0 OR position('''trial''' in src) = 0 THEN
    RAISE EXCEPTION 'patch applied but the free branches are absent';
  END IF;
  IF position('''agency''' in src) = 0 OR position('999999' in src) = 0 THEN
    RAISE EXCEPTION 'patch destroyed the subscription tier table';
  END IF;
  IF position('no_tokens' in src) = 0 THEN
    RAISE EXCEPTION 'patch destroyed the token arm';
  END IF;
END $patch$;

-- finish_wallpro_generation needs no change: it refunds only 'tokens' and
-- 'subscription', and neither free source consumes anything to refund. A failed
-- free generation is already re-offered by the 'trial' predicate, which is why
-- that predicate excludes state='failed' rather than counting every row.

-- ── Does this owner design free, and why? ──────────────────────────────────
-- One question the UI can ask BEFORE spending anything, so the page can promise
-- "your first design is free" or "included with CommercialPro" truthfully,
-- instead of discovering it at the point of failure.
CREATE OR REPLACE FUNCTION public.wallpro_free_generation_reason(p_owner uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=p_owner AND role::text IN ('admin','tester')) THEN 'privileged'
    WHEN EXISTS (SELECT 1 FROM public.commercialpro_members m
                 WHERE m.user_id=p_owner AND (m.expires_at IS NULL OR m.expires_at>now())) THEN 'commercialpro'
    WHEN NOT EXISTS (SELECT 1 FROM public.wallpro_generations
                     WHERE owner_id=p_owner AND state<>'failed') THEN 'trial'
    ELSE NULL
  END;
$$;
REVOKE ALL ON FUNCTION public.wallpro_free_generation_reason(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallpro_free_generation_reason(uuid) TO authenticated, service_role;
