<?php
/**
 * Plugin Name: WePrintWraps Loyalty Webhook
 * Description: Pushes a customer's live WPLoyalty point balance to RestylePro the instant it changes, so ShopFlow can show a real number instead of an estimate. Read-only from WPLoyalty's perspective — this plugin never writes to WPLoyalty's tables and never touches checkout, cart, or points logic. If it fails or WPLoyalty is inactive, nothing else on the site is affected.
 * Version: 1.0.0
 * Author: RestylePro
 * License: GPL-2.0+
 *
 * WHY THIS EXISTS: WPLoyalty's own public REST API (wc/v3/wployalty/*) only
 * supports ADDING/REDUCING points — there is no endpoint to READ a customer's
 * current balance. So RestylePro cannot poll it. WPLoyalty's core plugin does
 * fire a documented action on every balance change with the fresh balance
 * already computed:
 *
 *   do_action(
 *     'wlr_customer_points_balance_changed',
 *     $user_email, $points, $transaction_type, $action_type,
 *     $hook_data, $point_balance
 *   );
 *
 * (source: wployalty/App/Helpers/Base.php, firePointsBalanceChangedHook())
 *
 * This plugin hooks that action and forwards {email, points_balance, ...} to
 * RestylePro's wpw-loyalty-webhook edge function, HMAC-signed the same way
 * wpw-orders-webhook already verifies WooCommerce's own order webhooks
 * (base64 HMAC-SHA256 over the exact raw request body).
 *
 * No API keys or settings are required — the shared secret below must match
 * Supabase Vault's `wpw_loyalty_webhook_secret` byte-for-byte (seeded by
 * supabase/migrations/20260914160000_wpw_loyalty_points_webhook.sql). If you
 * ever need to rotate it, change it in BOTH places at once — a mismatch just
 * makes every push fail its signature check silently (logged, never fatal).
 */

defined( 'ABSPATH' ) || exit;

define( 'WPW_LOYALTY_WEBHOOK_URL', 'https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/wpw-loyalty-webhook' );
define( 'WPW_LOYALTY_WEBHOOK_SECRET', '09141b7e13dc47f3d3aa2993a2a8069cea214d77b687b6e592a7865326a57b0f' );

/**
 * Forward one balance-changed event to RestylePro. Fire-and-forget
 * (non-blocking) so a slow or unreachable RestylePro can NEVER add latency to
 * checkout, cart, or the WPLoyalty admin screens that trigger point changes.
 */
function wpw_loyalty_push_balance( $user_email, $points, $transaction_type, $action_type, $hook_data, $point_balance ) {
	$user_email = is_string( $user_email ) ? sanitize_email( $user_email ) : '';
	if ( empty( $user_email ) || ! is_email( $user_email ) ) {
		return;
	}

	$body = wp_json_encode(
		array(
			'user_email'        => $user_email,
			'points_changed'    => (int) $points,
			'transaction_type'  => is_string( $transaction_type ) ? $transaction_type : '',
			'action_type'       => is_string( $action_type ) ? $action_type : '',
			'point_balance'     => (int) $point_balance,
			'event_at'          => gmdate( 'c' ),
		)
	);
	if ( false === $body ) {
		return;
	}

	$signature = base64_encode( hash_hmac( 'sha256', $body, WPW_LOYALTY_WEBHOOK_SECRET, true ) );

	wp_remote_post(
		WPW_LOYALTY_WEBHOOK_URL,
		array(
			'method'      => 'POST',
			'timeout'     => 5,
			'blocking'    => false,
			'headers'     => array(
				'Content-Type'              => 'application/json',
				'X-Wpw-Loyalty-Signature'   => $signature,
			),
			'body'        => $body,
			'data_format' => 'body',
		)
	);
}
add_action( 'wlr_customer_points_balance_changed', 'wpw_loyalty_push_balance', 10, 6 );
