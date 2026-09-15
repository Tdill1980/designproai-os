-- ============================================================================
-- WPLoyalty points webhook — real Club WPW points, pushed from WordPress.
-- ============================================================================
--
-- Context (2026-09-14): the dashboard used to show a "Club WPW" tier/points
-- number computed as SUM(wpw_orders.total)/10 with invented tier breakpoints.
-- It had ZERO connection to the shop's real rewards program. The real program
-- is WPLoyalty (confirmed live on weprintwraps.com — its REST namespace
-- registers under wc/v3/wployalty/*, customer page at
-- https://weprintwraps.com/loyalty-reward-page/). WPLoyalty's own public REST
-- API only supports ADDING/REDUCING points (its PRO add-on) — there is no
-- endpoint to READ a balance, so RestylePro cannot poll it.
--
-- WPLoyalty's free/core plugin DOES fire a documented WordPress action hook
-- on every balance change, with the fresh balance as an argument:
--
--   do_action(
--     'wlr_customer_points_balance_changed',
--     $user_email, $points, $transaction_type, $action_type,
--     $hook_data, $point_balance
--   );
--
-- (source: wployalty/App/Helpers/Base.php, firePointsBalanceChangedHook())
--
-- So instead of polling, a small WordPress plugin (wordpress/wpw-loyalty-
-- webhook/) hooks that action and PUSHES the new balance to
-- wpw-loyalty-webhook, the same signed-webhook pattern already proven by
-- wpw-orders-webhook / wpw_woo_webhook_secret
-- (20260820203000_wpw_woo_webhooks_and_reversals.sql) — same HMAC-over-raw-
-- body scheme, same Vault-secret verifier pattern, different secret.
--
-- Unlike the Woo order webhook (a native Woo REST topic RestylePro can
-- self-register via the WooCommerce API), WPLoyalty's hook is plugin-internal
-- — WooCommerce's webhook system has no visibility into it. There is no way
-- to avoid installing the small WordPress plugin for this one. The secret
-- below is generated once here and shipped hardcoded in that plugin file
-- (mirroring the "No API keys or settings required" install of
-- wordpress/wpw-quote-attribution) — nobody has to copy a secret between
-- systems by hand.
-- ============================================================================

do $migration$
declare
  webhook_secret_count integer;
begin
  if to_regnamespace('vault') is null then
    raise exception 'WPW loyalty webhook requires Vault';
  end if;
  if to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then
    raise exception 'WPW loyalty webhook requires pgcrypto hmac(bytea, bytea, text)';
  end if;

  select count(*) into webhook_secret_count
  from vault.secrets
  where name = 'wpw_loyalty_webhook_secret';

  if webhook_secret_count > 1 then
    raise exception 'Vault contains multiple wpw_loyalty_webhook_secret entries';
  elsif webhook_secret_count = 0 then
    -- Fixed value, not random: it must byte-for-byte match the constant
    -- hardcoded in wordpress/wpw-loyalty-webhook/wpw-loyalty-webhook.php.
    -- A random secret here (like wpw_woo_webhook_secret's) would leave the
    -- WordPress plugin permanently unable to sign a request this side accepts.
    perform vault.create_secret(
      '09141b7e13dc47f3d3aa2993a2a8069cea214d77b687b6e592a7865326a57b0f',
      'wpw_loyalty_webhook_secret',
      'HMAC secret shared only by the wpw-loyalty-webhook WordPress plugin and wpw-loyalty-webhook edge function'
    );
  end if;
end
$migration$;

create or replace function public.verify_wpw_loyalty_webhook_signature(
  payload text,
  candidate text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, extensions
as $$
  select coalesce(
    payload is not null
    and candidate is not null
    and length(candidate) between 40 and 128
    and exists (
      select 1
      from vault.decrypted_secrets
      where name = 'wpw_loyalty_webhook_secret'
        and encode(
          extensions.hmac(
            pg_catalog.convert_to(payload, 'UTF8'),
            pg_catalog.convert_to(decrypted_secret, 'UTF8'),
            'sha256'
          ),
          'base64'
        ) = candidate
    ),
    false
  );
$$;

revoke all on function public.verify_wpw_loyalty_webhook_signature(text, text)
  from public, anon, authenticated;
grant execute on function public.verify_wpw_loyalty_webhook_signature(text, text)
  to service_role;

comment on function public.verify_wpw_loyalty_webhook_signature(text, text) is
  'Service-role-only verification of the WPLoyalty webhook plugin''s X-Wpw-Loyalty-Signature over the exact raw request body.';

-- ────────────────────────────────────────────────────────────────────────────
-- wpw_loyalty_points — ONE row per customer email, kept current by the
-- webhook. This is a live mirror pushed by WordPress, never computed or
-- estimated here. `points_balance` is WPLoyalty's own $point_balance at the
-- moment of the last event; there is nothing to reconcile it against because
-- WPLoyalty exposes no read API to check it against.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.wpw_loyalty_points (
  customer_email text primary key,
  points_balance integer not null default 0,
  last_points_changed integer,
  last_transaction_type text,
  last_action_type text,
  updated_at timestamptz not null default now()
);

comment on table public.wpw_loyalty_points is
  'Live mirror of WPLoyalty point balances, pushed by wordpress/wpw-loyalty-webhook on every wlr_customer_points_balance_changed event. Not computed, not estimated.';

alter table public.wpw_loyalty_points enable row level security;

-- No client-side policy: this table is read only through an edge function
-- (mirrors wpw_orders / wpw-orders-read) that resolves "the caller's own
-- linked email" the same way wpw-orders-read resolves woo_customer_id, so
-- there is exactly one place that identity check is implemented.
drop policy if exists "service_role_all_wpw_loyalty_points" on public.wpw_loyalty_points;
create policy "service_role_all_wpw_loyalty_points" on public.wpw_loyalty_points
  for all
  to service_role
  using (true)
  with check (true);
