/**
 * WALLPRO AT weprintwraps.com/wall-wrap — Cloudflare Worker
 * ═════════════════════════════════════════════════════════
 *
 * Owner decision, 2026-09-14: the WallPro tool replaces WePrintWraps' wall
 * product page, and it must live ON weprintwraps.com — not on a subdomain that
 * starts its search life at zero while the page that actually ranks stays a
 * plain WooCommerce product.
 *
 * weprintwraps.com is already behind Cloudflare (verified: `server: cloudflare`,
 * A records 104.21.49.98 / 172.67.161.155), so the proxy costs nothing at the
 * WordPress host and needs no plugin, no iframe and no theme change.
 *
 * WHY A WORKER AND NOT AN ORIGIN RULE. The app is a single-page build whose
 * assets are referenced from the ROOT — `/assets/index-<hash>.js`, not
 * `/wall-wrap/assets/...`. An Origin Rule matching only `/wall-wrap*` would
 * serve the HTML and then send every script to WordPress, which would return its
 * 404 page with a text/html content type, and the browser would refuse to
 * execute it. The result is a blank white page. The prefix list below is
 * therefore not decoration: it is the complete set of same-origin paths the page
 * actually requests, recorded from a real browser load rather than guessed.
 *
 * COLLISION CHECK (run 2026-09-14, all returned 404 on weprintwraps.com, so
 * nothing here shadows a WordPress URL):
 *   /assets/  /characters/  /sprocket/  /wallpro/  /wall-wrap
 *   /wpw-logo-mark.png  /favicon.png
 * Re-run that check before adding a prefix. A prefix that WordPress does use
 * would silently take that page away from the site.
 *
 * ── DEPLOY ────────────────────────────────────────────────────────────────
 * 1. Cloudflare dashboard → Workers & Pages → Create Worker → paste this file.
 * 2. Add these routes to the worker (Settings → Triggers → Routes), zone
 *    weprintwraps.com:
 *        weprintwraps.com/wall-wrap*
 *        weprintwraps.com/wallwrap-design*
 *        weprintwraps.com/assets/*
 *        weprintwraps.com/characters/*
 *        weprintwraps.com/sprocket/*
 *        weprintwraps.com/wallpro/*
 *        weprintwraps.com/wpw-logo-mark.png
 *        weprintwraps.com/favicon.png
 * 3. Load https://weprintwraps.com/wall-wrap. The tool should paint with the
 *    WePrintWraps lockup, and the URL bar must still read weprintwraps.com.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 * It does not touch /our-products/wall-wrap-printed-vinyl/. That page is the
 * WooCommerce product (id 70093) the tool's own "Add N sq ft to cart" button
 * depends on — the cart URL is /cart/?add-to-cart=70093 — and it is the URL
 * holding the search equity for "wall wrap printing". Proxying it away would
 * break the checkout the tool sells through. Point its primary call to action
 * at /wall-wrap instead; the equity then flows to the tool through an internal
 * link and the product stays purchasable.
 */

const ORIGIN = 'https://os.designproai.com';

/** Every same-origin path the WallPro page requests, recorded from a real load. */
const PROXY_PREFIXES = [
  '/wall-wrap',
  '/wallwrap-design',
  '/assets/',
  '/characters/',
  '/sprocket/',
  '/wallpro/',
];
const PROXY_EXACT = ['/wpw-logo-mark.png', '/favicon.png'];

function shouldProxy(pathname) {
  return PROXY_EXACT.includes(pathname)
    || PROXY_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!shouldProxy(url.pathname)) return fetch(request);

    const target = new URL(url.pathname + url.search, ORIGIN);

    // Forward the request, but never the visitor's weprintwraps.com cookies:
    // they belong to WordPress and WooCommerce sessions and have no business
    // reaching a different origin. The app authenticates with its own tokens.
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    headers.set('host', target.host);
    // So the origin can tell proxied traffic from direct traffic in its logs.
    headers.set('x-forwarded-host', url.host);

    const response = await fetch(target.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    });

    // Strip the origin's own Set-Cookie: a cookie scoped to os.designproai.com
    // cannot be set on weprintwraps.com anyway, and letting it through only
    // invites a session to be written against the wrong domain.
    const out = new Headers(response.headers);
    out.delete('set-cookie');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: out,
    });
  },
};
