/**
 * UTM parameter utilities for tracking traffic sources.
 *
 * Usage:
 *   appendUtm("https://restyleproai.com/signup", {
 *     source: "instagram",
 *     medium: "social",
 *     campaign: "spring2026",
 *   })
 *   // => "https://restyleproai.com/signup?utm_source=instagram&utm_medium=social&utm_campaign=spring2026"
 */

export interface UtmParams {
  source: string;
  medium: string;
  campaign?: string;
  term?: string;
  content?: string;
}

/** Append UTM parameters to any URL string. */
export function appendUtm(baseUrl: string, utm: UtmParams): string {
  const url = new URL(baseUrl, window.location.origin);
  url.searchParams.set("utm_source", utm.source);
  url.searchParams.set("utm_medium", utm.medium);
  if (utm.campaign) url.searchParams.set("utm_campaign", utm.campaign);
  if (utm.term) url.searchParams.set("utm_term", utm.term);
  if (utm.content) url.searchParams.set("utm_content", utm.content);
  return url.toString();
}

/** Build a share URL with UTM attribution for social platforms. */
export function buildShareUrl(
  platform: "instagram" | "facebook" | "tiktok" | "twitter" | "email" | "web",
  path: string = "/"
): string {
  return appendUtm(`https://restyleproai.com${path}`, {
    source: platform,
    medium: platform === "email" ? "email" : "social",
    campaign: "user_share",
  });
}

/** Build an affiliate referral URL with UTM + ref code. */
export function buildAffiliateUrl(
  refCode: string,
  campaign: string = "affiliate"
): string {
  const url = appendUtm("https://restyleproai.com/signup", {
    source: "affiliate",
    medium: "referral",
    campaign,
    content: refCode,
  });
  // Also append the ref param for backend tracking
  const parsed = new URL(url);
  parsed.searchParams.set("ref", refCode);
  return parsed.toString();
}

/**
 * Capture UTM params from the current URL and store in sessionStorage.
 * Call this once on app load to persist attribution across navigation.
 */
export function captureUtmParams(): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"];

  utmKeys.forEach((key) => {
    const value = params.get(key);
    if (value) {
      sessionStorage.setItem(key, value);
    }
  });
}

/** Retrieve stored UTM params (for sending with conversion events). */
export function getStoredUtm(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref"];
  const result: Record<string, string> = {};
  utmKeys.forEach((key) => {
    const value = sessionStorage.getItem(key);
    if (value) result[key] = value;
  });
  return result;
}
