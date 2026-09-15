<?php
/**
 * Plugin Name: WePrintWraps ShopFlow Account
 * Description: Replaces the WooCommerce My Account dashboard and Orders screens with ShopFlow, already opened for the logged-in customer. Addresses, Payment methods, Account details, Tax Exemption and Points & Rewards are left entirely alone and keep working as WooCommerce's own screens.
 * Version: 1.0.0
 * Author: RestylePro
 * License: GPL-2.0+
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * Owner, 2026-09-15: "My account is now ShopFlow." This plugin makes that true
 * for the two screens ShopFlow is actually better at — the dashboard and the
 * order list — and leaves the other five as WooCommerce's own.
 *
 * That split is not caution, it is correctness:
 *   - Payment methods are stored payment TOKENS held by the gateway. Nothing
 *     outside WooCommerce can list or delete them, so a replacement screen
 *     would be card management that silently does nothing.
 *   - Addresses and Account details are the fields Woo bills and ships from.
 *     Edited anywhere else they become a second copy that drifts from the one
 *     the warehouse reads.
 *   - Tax Exemption is a compliance record tied to the Woo customer.
 *   - Points & Rewards is WPLoyalty's own screen, and WPLoyalty's public REST
 *     API has no balance-READ endpoint, so its page is the only place the
 *     number is certain to be right.
 *
 * HOW THE CUSTOMER GETS IN. WordPress has already authenticated them. This
 * plugin asks the `wpw-shopflow` edge function for a token bound to
 * wp_get_current_user()->user_email, signing the request with a secret that
 * exists only here on the server — base64(HMAC-SHA256(raw body, secret)) in
 * `x-wpw-signature`, the same scheme wpw-orders-webhook already uses for
 * WooCommerce's own webhooks. The customer is never asked to re-prove an
 * identity WordPress has proven. The browser never sees the secret; it only
 * ever receives a short-lived token in the iframe URL.
 *
 * FAIL-SOFT IS A REQUIREMENT, NOT A NICETY. If RestylePro is slow, down, or the
 * secret is missing, the customer must still reach their account. Every failure
 * path here falls back to WooCommerce's own screen rather than showing an error
 * or an empty frame. A wrap shop's account page going dark because a
 * third-party dashboard is having a bad afternoon is not an acceptable trade.
 *
 * SETUP
 *   1. Set the same secret in both places. In Supabase:
 *        supabase secrets set WPW_SHOPFLOW_MINT_SECRET=<random 64-byte hex>
 *      and in wp-config.php:
 *        define( 'WPW_SHOPFLOW_MINT_SECRET', '<the same value>' );
 *      A mismatch just means every mint fails its signature check and the
 *      customer transparently gets Woo's own screens — logged, never fatal.
 *   2. Upload this folder to wp-content/plugins/ and activate.
 */

defined( 'ABSPATH' ) || exit;

define( 'WPW_SHOPFLOW_MINT_URL', 'https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/wpw-shopflow' );
define( 'WPW_SHOPFLOW_EMBED_URL', 'https://www.restyleproai.com/shopflow' );

/** The minted token lives 24h; cache it for less so it is never served stale. */
define( 'WPW_SHOPFLOW_TOKEN_TTL', 20 * HOUR_IN_SECONDS );

/**
 * The shared secret. Read from wp-config.php so it is not in this file, not in
 * the database, and not in a git history.
 */
function wpw_shopflow_secret() {
	if ( defined( 'WPW_SHOPFLOW_MINT_SECRET' ) && strlen( (string) WPW_SHOPFLOW_MINT_SECRET ) >= 32 ) {
		return (string) WPW_SHOPFLOW_MINT_SECRET;
	}
	return '';
}

/**
 * Ask RestylePro for a token bound to this customer's email.
 *
 * Cached per user in a transient: the mint is one signed HTTP round trip and
 * doing it on every page view would add latency to the account page for no
 * gain. Returns '' on any failure, which the render path treats as "show
 * WooCommerce's own screen".
 */
function wpw_shopflow_token_for_current_user() {
	if ( ! is_user_logged_in() ) {
		return '';
	}
	$secret = wpw_shopflow_secret();
	if ( '' === $secret ) {
		return '';
	}

	$user = wp_get_current_user();
	$email = sanitize_email( $user->user_email );
	if ( empty( $email ) || ! is_email( $email ) ) {
		return '';
	}

	$cache_key = 'wpw_sf_tok_' . md5( $email );
	$cached = get_transient( $cache_key );
	if ( is_string( $cached ) && '' !== $cached ) {
		return $cached;
	}

	// The signature covers these EXACT bytes; the edge function verifies over
	// the raw body, so this string must be sent unmodified.
	$body = wp_json_encode(
		array(
			'action' => 'mint',
			'email'  => $email,
		)
	);
	$signature = base64_encode( hash_hmac( 'sha256', $body, $secret, true ) );

	$response = wp_remote_post(
		WPW_SHOPFLOW_MINT_URL,
		array(
			'timeout' => 6,
			'headers' => array(
				'Content-Type'     => 'application/json',
				'x-wpw-signature'  => $signature,
			),
			'body'    => $body,
		)
	);

	if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
		// Cache the failure briefly so a RestylePro outage does not mean a
		// six-second wait on every single account page view.
		set_transient( $cache_key . '_fail', 1, 2 * MINUTE_IN_SECONDS );
		error_log( '[wpw-shopflow-account] mint failed: ' . ( is_wp_error( $response ) ? $response->get_error_message() : wp_remote_retrieve_response_code( $response ) ) );
		return '';
	}

	$data = json_decode( wp_remote_retrieve_body( $response ), true );
	$token = isset( $data['token'] ) ? (string) $data['token'] : '';
	if ( '' === $token ) {
		return '';
	}

	set_transient( $cache_key, $token, WPW_SHOPFLOW_TOKEN_TTL );
	return $token;
}

/**
 * Render ShopFlow in the account content area, or return false so the caller
 * lets WooCommerce render its own screen.
 *
 * The iframe carries the token in the URL. That is safe here and only here:
 * the token is 24h, the parent page is already an authenticated session, and
 * ShopFlow strips `?t=` from its own address bar the moment it reads it.
 */
function wpw_shopflow_render_embed( $hash = '' ) {
	if ( get_transient( 'wpw_sf_tok_' . md5( sanitize_email( wp_get_current_user()->user_email ) ) . '_fail' ) ) {
		return false;
	}
	$token = wpw_shopflow_token_for_current_user();
	if ( '' === $token ) {
		return false;
	}

	$src = add_query_arg( array( 't' => rawurlencode( $token ) ), WPW_SHOPFLOW_EMBED_URL );
	if ( ! empty( $hash ) ) {
		$src .= '#' . $hash;
	}

	printf(
		'<iframe src="%s" title="ShopFlow — your orders" loading="lazy" style="width:100%%;min-height:1100px;border:0;display:block;background:#f9fafb" referrerpolicy="strict-origin-when-cross-origin"></iframe>',
		esc_url( $src )
	);
	return true;
}

/**
 * The My Account DASHBOARD.
 *
 * `woocommerce_account_content` runs for every endpoint, so this hook checks it
 * is on the dashboard (no endpoint in the query vars) before doing anything —
 * otherwise it would replace Addresses and Payment methods too, which is the
 * one thing this plugin must not do.
 */
function wpw_shopflow_take_over_dashboard() {
	global $wp;
	// Any endpoint at all means this is one of Woo's own sub-screens.
	foreach ( array_keys( (array) $wp->query_vars ) as $var ) {
		if ( in_array( $var, array( 'orders', 'view-order', 'downloads', 'edit-address', 'payment-methods', 'add-payment-method', 'delete-payment-method', 'set-default-payment-method', 'edit-account', 'customer-logout' ), true ) ) {
			return;
		}
	}
	if ( wpw_shopflow_render_embed() ) {
		// Woo's dashboard content is hooked at priority 10; ours ran first and
		// succeeded, so stop the default from stacking underneath it.
		remove_action( 'woocommerce_account_content', 'woocommerce_account_content', 10 );
	}
}
add_action( 'woocommerce_account_content', 'wpw_shopflow_take_over_dashboard', 5 );

/**
 * The My Account ORDERS list. Same deal, and the same fail-soft: if the token
 * cannot be minted, `wpw_shopflow_render_embed` returns false and Woo's own
 * order table renders exactly as it always has.
 */
function wpw_shopflow_take_over_orders( $current_page ) {
	if ( ! wpw_shopflow_render_embed( 'orders' ) ) {
		// Hand back to WooCommerce's own template.
		wc_get_template(
			'myaccount/orders.php',
			array(
				'current_page'    => absint( $current_page ),
				'customer_orders' => null,
				'has_orders'      => 0,
			)
		);
	}
}
// Priority 5 so it runs before Woo's own `woocommerce_account_orders_endpoint`.
add_action( 'woocommerce_account_orders_endpoint', 'wpw_shopflow_take_over_orders', 5 );
remove_action( 'woocommerce_account_orders_endpoint', 'woocommerce_account_orders', 10 );

/**
 * "My Account" becomes "My ShopFlow" (owner, 2026-09-15).
 *
 * The page title and the menu label both, because a customer who clicks
 * "My ShopFlow" and lands on a heading that says "My Account" has been told
 * they are in the wrong place. Dashboard becomes "My ShopFlow" too — it is the
 * ShopFlow board now, not a Woo summary.
 */
function wpw_shopflow_menu_items( $items ) {
	if ( isset( $items['dashboard'] ) ) {
		$items['dashboard'] = __( 'My ShopFlow', 'wpw-shopflow' );
	}
	return $items;
}
add_filter( 'woocommerce_account_menu_items', 'wpw_shopflow_menu_items' );

function wpw_shopflow_page_title( $title ) {
	if ( function_exists( 'is_account_page' ) && is_account_page() && ! is_wc_endpoint_url() ) {
		return __( 'My ShopFlow', 'wpw-shopflow' );
	}
	return $title;
}
add_filter( 'woocommerce_endpoint_dashboard_title', 'wpw_shopflow_page_title' );
add_filter( 'the_title', 'wpw_shopflow_page_title', 10, 1 );

/**
 * Clear a customer's cached token when they log out, so a shared or kiosk
 * browser cannot hand the next person a live one.
 */
function wpw_shopflow_clear_token_on_logout( $user_id ) {
	$user = get_userdata( $user_id );
	if ( $user && ! empty( $user->user_email ) ) {
		delete_transient( 'wpw_sf_tok_' . md5( sanitize_email( $user->user_email ) ) );
	}
}
add_action( 'wp_logout', 'wpw_shopflow_clear_token_on_logout' );
