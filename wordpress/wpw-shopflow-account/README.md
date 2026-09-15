# WePrintWraps ShopFlow Account

Replaces WooCommerce's My Account **dashboard** and **Orders** screens with
ShopFlow, already opened for the logged-in customer. Everything else on
`/my-account/` is untouched.

## What changes and what doesn't

| My Account screen | After this plugin |
|---|---|
| Dashboard | **ShopFlow** — track the current order, past orders, saved quotes |
| Orders | **ShopFlow** |
| Addresses | WooCommerce, unchanged |
| Payment methods | WooCommerce, unchanged |
| Account details | WooCommerce, unchanged |
| Tax Exemption | WooCommerce, unchanged |
| Points & Rewards | WPLoyalty, unchanged |

The five that stay are not laziness. Payment methods are gateway tokens nothing
outside Woo can list or delete. Addresses and account details are what the
warehouse ships from; a second copy drifts from the one that matters. Tax
exemption is a compliance record. WPLoyalty's REST API has no balance-read
endpoint, so its own page is the only place the number is certainly right.

## Setup

1. Generate a secret and set it in **both** places, identically:

   ```bash
   openssl rand -hex 32
   ```

   Supabase:
   ```bash
   supabase secrets set WPW_SHOPFLOW_MINT_SECRET=<value>
   ```

   `wp-config.php`:
   ```php
   define( 'WPW_SHOPFLOW_MINT_SECRET', '<value>' );
   ```

2. Upload this folder to `wp-content/plugins/` and activate.

That is the whole configuration. There is no settings screen on purpose — one
secret, defined in the file that already holds the site's other secrets.

## If something is wrong

**Nothing breaks.** Every failure path — missing secret, wrong secret,
RestylePro slow or down — falls back to WooCommerce's own screen. The customer
sees the account page they have always seen. Failures are written to the PHP
error log as `[wpw-shopflow-account] mint failed: …`, and a failure is cached
for two minutes so an outage does not add a six-second wait to every page view.

If the dashboard shows Woo's default content when you expect ShopFlow, check in
this order:

1. `WPW_SHOPFLOW_MINT_SECRET` defined in `wp-config.php` and at least 32 chars.
2. The same value set as a Supabase secret (a mismatch fails silently, by
   design — a signature check that announced itself would be a probe oracle).
3. The error log for the line above.

## How the customer gets in

WordPress has already authenticated them. The plugin asks the `wpw-shopflow`
edge function for a token bound to their account email, signing the request
with `base64(HMAC-SHA256(raw body, secret))` in `x-wpw-signature` — the same
scheme `wpw-orders-webhook` uses for WooCommerce's own webhooks. The secret
never leaves the server. The browser receives only a 24-hour token in the
iframe URL, which ShopFlow strips from its address bar the moment it reads it.

The token is cached per customer for 20 hours and cleared on logout, so a
shared or kiosk browser cannot hand the next person a live one.
