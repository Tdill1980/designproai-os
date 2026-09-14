const MARKETING_HOSTS = new Set(["designproai.com", "www.designproai.com"]);

export const isDesignProMarketingHost = (hostname: string): boolean =>
  MARKETING_HOSTS.has(normalizeHost(hostname));

/**
 * PARTNER HOSTS — a WallPro tool served under someone else's brand.
 *
 * Owner, 2026-09-14, on the WePrintWraps launch: the jumbo menu's Wall Wrap and
 * WallWrap Design entries must not bounce the customer onto a visibly different
 * domain mid-funnel. WePrintWraps already runs tools this way
 * (quote.weprintwraps.com), so WallPro joins that pattern rather than inventing
 * a new one: one subdomain of the partner's own brand, serving this same app.
 *
 * On a partner host the ROOT is the Wall Wrap page, because a customer typing
 * or clicking wallpro.weprintwraps.com is asking for exactly one thing. The
 * rest of the app stays reachable by path, so /printpro/wallpro is still the
 * designer and a deep link from anywhere keeps working.
 *
 * This is the aim behind the aim (owner, 2026-09-13): "the aim is franchising
 * wallpro tool ... so sign companies like signorama FASTSIGNS can use on demand
 * send links to thier customers to design and buy." WePrintWraps is the first
 * partner, not a special case, so the check is a SET rather than one string --
 * adding the next franchise is one entry here plus one Caddy block, and the
 * per-shop branding then comes from the multi-tenant spine (shops.slug,
 * shops.logo_url) rather than from more code.
 */
const WALLPRO_PARTNER_HOSTS = new Set(["wallpro.weprintwraps.com"]);

export const isWallProPartnerHost = (hostname: string): boolean =>
  WALLPRO_PARTNER_HOSTS.has(normalizeHost(hostname));

/** Lowercase, trimmed, and without the DNS root dot a browser may include. */
function normalizeHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}
