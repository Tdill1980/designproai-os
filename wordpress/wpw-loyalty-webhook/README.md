# WePrintWraps Loyalty Webhook

Pushes a customer's live WPLoyalty point balance to RestylePro the instant it changes, so ShopFlow and the RestylePro dashboard can show a real number instead of an estimate.

## Why this exists

WPLoyalty's own public REST API (`wc/v3/wployalty/*`) only supports **adding or reducing** points — there is no endpoint to **read** a customer's current balance, so RestylePro cannot poll it.

WPLoyalty's core plugin does fire a documented action on every balance change, with the fresh balance already computed:

```php
do_action(
    'wlr_customer_points_balance_changed',
    $user_email, $points, $transaction_type, $action_type, $hook_data, $point_balance
);
```

(source: `wployalty/App/Helpers/Base.php`, `firePointsBalanceChangedHook()` — confirmed present in the plugin's public WordPress.org source, 2026-09-14.)

This plugin hooks that action and forwards `{email, points_balance, ...}` to RestylePro's `wpw-loyalty-webhook` edge function, signed the same way `wpw-orders-webhook` already verifies WooCommerce's own order webhooks (base64 HMAC-SHA256 over the exact raw request body).

## What it does NOT do

- Does not read, write, or modify anything in WPLoyalty's own tables (`wp_wlr_users`, `wp_wlr_levels`, etc.).
- Does not touch checkout, cart, or WooCommerce order flow.
- Does not block or slow anything down — the outbound push is non-blocking (`blocking => false`), so a slow or unreachable RestylePro can never add latency to a customer action or a WPLoyalty admin screen.
- Fails silently (logged by WordPress, never a fatal error, never surfaced to a customer) if RestylePro is unreachable or the signature check fails on RestylePro's side.

## Install (do not deploy from the repair bundle)

1. Copy the `wpw-loyalty-webhook` directory to `wp-content/plugins/` on `weprintwraps.com`, or zip the directory and upload it in WordPress → Plugins → Add New → Upload Plugin.
2. Activate **WePrintWraps Loyalty Webhook**.
3. That's it. No API keys or settings screen — the shared secret is baked into the plugin file and must byte-for-byte match Supabase Vault's `wpw_loyalty_webhook_secret`, seeded by `supabase/migrations/20260914160000_wpw_loyalty_points_webhook.sql`. If you ever need to rotate it, change it in **both** places at once (a mismatch just makes every push fail its signature check — logged, never fatal, never customer-visible).

Requires WPLoyalty (free or PRO) active on the same site. If WPLoyalty is deactivated or uninstalled, this plugin's hook simply never fires — no error, no crash.

## Production acceptance test

1. As a test customer (or via WPLoyalty's admin → Customers → adjust points), trigger any point-earning or point-redeeming action — a real order, a manual admin point adjustment, a redemption.
2. In RestylePro, query (or ask an admin to check) `wpw_loyalty_points` for that customer's email and confirm `points_balance` matches what WPLoyalty's own customer page (`https://weprintwraps.com/loyalty-reward-page/`) shows, and `updated_at` is recent.
3. Open `/shopflow` or the RestylePro dashboard as that customer (or a linked test account) and confirm the Club WPW Rewards card shows the real point count instead of the "View my points" link-out-only state.
4. Confirm nothing about checkout timing changed — the WordPress site log (or `error_log`) should show no fatal errors referencing this plugin even if RestylePro is briefly unreachable.

## Rollback

Deactivate and remove the plugin. `wpw_loyalty_points` in RestylePro simply stops receiving updates — existing rows are left as the last known balance, and the UI falls back to whatever the linking logic already does for a customer with no synced row (before this plugin existed, that was the only state — nothing regresses). No WPLoyalty data or settings are touched.
