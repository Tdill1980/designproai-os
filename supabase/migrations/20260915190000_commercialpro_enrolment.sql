-- COMMERCIALPRO ENROLMENT — the thing that writes to commercialpro_members.
--
-- 20260915020000 built the GRANT and deliberately left enrolment unbuilt: "who
-- qualifies is an owner decision with a real data source behind it … Do not
-- advertise membership until something writes to this table." This is that
-- decision, and this is that something.
--
-- OWNER'S RULE, 2026-09-15: "if they have ever had more than 500 sq ft gives
-- them commercialpro perks — not discount, that's based on bulk orders."
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY LIFETIME EARNS THE PERKS AND ONLY A BULK ORDER EARNS THE DISCOUNT.
--
-- These are two different rewards for two different behaviours, and the split is
-- the whole point rather than an inconsistency to tidy up later:
--
--   FLEET 5/10/15/20     earned by THIS ORDER's size, every time.
--                        A bulk discount pays for itself operationally — one
--                        setup, one print run, one shipment, better roll
--                        utilisation. Three 200 sq ft orders deliver none of
--                        that, so rewarding their SUM with a margin percentage
--                        on low margins is a leak, not a programme. Untouched
--                        by this migration, and it must stay untouched.
--
--   COMMERCIALPRO        earned by LIFETIME volume, once, forever.
--                        Costs a fixed and tiny amount — a few model calls —
--                        whether the customer orders big or small, which is
--                        exactly why loyalty can earn it and a percentage
--                        cannot.
--
-- Discount rewards the ORDER. Status rewards the CUSTOMER. Do not wire
-- membership to a price.
--
-- MEASURED on live WePrintWraps data the day this was written (orders excluding
-- cancelled/refunded/failed):
--
--     customers with a single 500+ sq ft order ............... 16
--     customers at 500+ sq ft LIFETIME ...................... 67
--     customers at 250–499 sq ft (one order away) ........... 116
--     avg spend, 500+ lifetime .......................... $26,709   (7.8 orders)
--     avg spend, everyone else ........................... $2,292   (1.8 orders)
--
-- The line already isolates the trade buyer: 11.7x the spend, 4.3x the orders.
-- Single-order would have made this a 16-person programme that misses the shop
-- buying 80 sq ft every month — which is precisely the CommercialPro customer.
--
-- NEVER EXPIRES. expires_at stays NULL. A rolling window would be 65 members
-- instead of 67 today (663 of 666 customers ordered within twelve months, so
-- the two rules are the same rule right now) and would start REVOKING status
-- from a loyal shop that had a quiet year. Taking a trade badge away is the
-- fastest way to lose a trade account; there is no version of that worth two
-- members.
-- ─────────────────────────────────────────────────────────────────────────────

-- The bar, defined once. Everything below reads it; nothing hardcodes 500.
CREATE OR REPLACE FUNCTION public.commercialpro_sqft_threshold()
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT 500::numeric $$;

-- ---------------------------------------------------------------------------
-- LIFETIME SQUARE FEET for an email.
--
-- Read from what the customer actually BOUGHT: WooCommerce's TM Extra Product
-- Options writes a "Total Area (sq. ft.)" meta row per line item, and an order's
-- footage is the sum across its items (a wrap is ordered one line per panel).
-- Never estimated from the order total — that would silently re-rate every
-- membership the next time a price changed.
--
-- Cancelled, refunded and failed orders do not count. They did not happen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercialpro_lifetime_sqft(p_email text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_item AS (
    SELECT oi.id AS item_id,
           MAX((m->>'value')::numeric)
             FILTER (WHERE m->>'display_key' = 'Total Area (sq. ft.)') AS sqft
    FROM public.wpw_order_items oi
    JOIN public.wpw_orders o ON o.id = oi.order_id
    CROSS JOIN LATERAL jsonb_array_elements(to_jsonb(oi.meta)) m
    WHERE jsonb_typeof(to_jsonb(oi.meta)) = 'array'
      AND lower(o.customer_email) = lower(trim(p_email))
      AND o.status NOT IN ('cancelled', 'refunded', 'failed')
    GROUP BY oi.id
  )
  SELECT COALESCE(SUM(sqft), 0)::numeric FROM per_item WHERE sqft IS NOT NULL;
$$;

-- Has this EMAIL earned it? Email-keyed on purpose: ShopFlow's guest door
-- proves an email, not a session, and 8 of 809 WePrintWraps customer emails
-- have an account here. A membership test that needed auth.uid() would answer
-- "no" for almost every real member.
CREATE OR REPLACE FUNCTION public.is_commercialpro_email(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.commercialpro_lifetime_sqft(p_email)
         >= public.commercialpro_sqft_threshold();
$$;

-- ---------------------------------------------------------------------------
-- "COMMERCIALPRO SINCE 2024" — the year they CROSSED the line.
--
-- Owner, 2026-09-15: "show year of". It is the year the running total first
-- reached the threshold, not the year of their first order and not the year the
-- row was written. Three different numbers, and only this one is true of the
-- membership:
--
--   first-order year  flatters a customer who bought one small job in 2018 and
--                     qualified last week.
--   created_at year   is the year WE got round to enrolling them, which for
--                     every one of the 67 founding members is today. Sixty-seven
--                     identical badges reading 2026 is not status, it is a
--                     migration timestamp.
--
-- The crossing year makes early members senior and cannot be bought, which is
-- the entire point of putting a date on a badge. It is derived, so a backfill
-- of older orders corrects it rather than freezing a wrong year forever.
--
-- NULL for anyone who has not crossed — the UI shows progress instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercialpro_member_since(p_email text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH per_item AS (
    SELECT oi.id AS item_id, o.id AS order_id, o.date_created,
           MAX((m->>'value')::numeric)
             FILTER (WHERE m->>'display_key' = 'Total Area (sq. ft.)') AS sqft
    FROM public.wpw_order_items oi
    JOIN public.wpw_orders o ON o.id = oi.order_id
    CROSS JOIN LATERAL jsonb_array_elements(to_jsonb(oi.meta)) m
    WHERE jsonb_typeof(to_jsonb(oi.meta)) = 'array'
      AND lower(o.customer_email) = lower(trim(p_email))
      AND o.status NOT IN ('cancelled', 'refunded', 'failed')
    GROUP BY oi.id, o.id, o.date_created
  ),
  per_order AS (
    SELECT order_id, MIN(date_created) AS date_created, SUM(sqft) AS sqft
    FROM per_item WHERE sqft IS NOT NULL
    GROUP BY order_id
  ),
  running AS (
    SELECT date_created,
           SUM(sqft) OVER (ORDER BY date_created, order_id
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cume
    FROM per_order
  )
  SELECT EXTRACT(YEAR FROM date_created)::integer
  FROM running
  WHERE cume >= public.commercialpro_sqft_threshold()
  ORDER BY date_created
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- PROGRESS, for everyone who has not earned it yet.
--
-- 116 customers sit between 250 and 499 sq ft — one order away, and seven times
-- the size of the single-order group. A padlock with no number is a wall; a
-- padlock with a number is a target. This is what the rail shows them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercialpro_progress(p_email text)
RETURNS TABLE (sqft numeric, threshold numeric, remaining numeric, member boolean, member_since integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s, t, GREATEST(t - s, 0), s >= t,
         CASE WHEN s >= t THEN public.commercialpro_member_since(p_email) END
  FROM (SELECT public.commercialpro_lifetime_sqft(p_email) AS s,
               public.commercialpro_sqft_threshold() AS t) q;
$$;

-- ---------------------------------------------------------------------------
-- ENROL an account holder.
--
-- The membership TABLE is keyed by auth user because that is what the WallPro
-- grant charges against (reserve_wallpro_generation reads commercialpro_members
-- by user_id). So this runs when we know both: a signed-in user AND the
-- WePrintWraps email their orders are under.
--
-- IDEMPOTENT and safe to call on every ShopFlow load and every Woo order sync.
-- ON CONFLICT DO NOTHING, so an existing membership — including one granted BY
-- HAND — is never overwritten, never re-dated, and never has its reason
-- rewritten. A hand grant reads 'invited by …' forever; this one reads 'earned'
-- with the footage that earned it, so a support conversation can answer "why am
-- I a member?" without anyone guessing.
--
-- It never REMOVES anyone. Membership does not expire (see the header), and a
-- refund that drops someone below the line leaves the badge alone — clawing
-- back status is a worse outcome than a member we were slightly generous to.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enrol_commercialpro_member(
  p_user_id uuid,
  p_email   text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sqft numeric;
BEGIN
  IF p_user_id IS NULL OR p_email IS NULL OR trim(p_email) = '' THEN
    RETURN FALSE;
  END IF;

  v_sqft := public.commercialpro_lifetime_sqft(p_email);
  IF v_sqft < public.commercialpro_sqft_threshold() THEN
    RETURN EXISTS (SELECT 1 FROM public.commercialpro_members WHERE user_id = p_user_id);
  END IF;

  INSERT INTO public.commercialpro_members (user_id, reason, expires_at)
  VALUES (
    p_user_id,
    'earned — ' || round(v_sqft)::text || ' sq ft lifetime with WePrintWraps'
      || COALESCE(', CommercialPro since ' || public.commercialpro_member_since(p_email)::text, ''),
    NULL
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN TRUE;
END;
$$;

COMMENT ON TABLE public.commercialpro_members IS
  'CommercialPro membership. Grants free WallPro/PatternPro design generation and the status badge — never a price. Earned at 500 sq ft LIFETIME (enrol_commercialpro_member) or granted by hand; never expires. Fleet 5/10/15/20 discounts remain per-order and gated on the bulk minimum.';

-- Server-side only. ShopFlow reads these through an edge function that resolved
-- the email itself from a verified token or a session — never from the browser.
REVOKE EXECUTE ON FUNCTION public.commercialpro_lifetime_sqft(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_commercialpro_email(text)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commercialpro_progress(text)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commercialpro_member_since(text)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enrol_commercialpro_member(uuid, text) FROM PUBLIC, anon, authenticated;
