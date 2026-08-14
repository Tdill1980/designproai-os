// Meta (Facebook) Pixel helpers.
//
// The pixel itself is loaded by <MetaPixel /> (src/components/MetaPixel.tsx).
// Every helper here is a no-op if fbq has not been initialized yet — that way
// callers never need to guard for "is the pixel ready?" at the call site.

export const FB_PIXEL_ID = import.meta.env.VITE_FACEBOOK_PIXEL_ID as
  | string
  | undefined;

declare global {
  interface Window {
    fbq?: (...args: any[]) => void;
    _fbq?: unknown;
  }
}

const isReady = () =>
  typeof window !== "undefined" && typeof window.fbq === "function";

export const pageview = () => {
  if (!isReady()) return;
  window.fbq!("track", "PageView");
};

export const trackEvent = (
  name: string,
  options: Record<string, unknown> = {},
) => {
  if (!isReady()) return;
  window.fbq!("track", name, options);
};

export const trackViewContent = (
  contentName: string,
  contentCategory: string,
) =>
  trackEvent("ViewContent", {
    content_name: contentName,
    content_category: contentCategory,
  });

export const trackLead = () => trackEvent("Lead");

export const trackInitiateCheckout = (value: number, currency = "USD") =>
  trackEvent("InitiateCheckout", { value, currency });

export const trackPurchase = (value: number, currency = "USD") =>
  trackEvent("Purchase", { value, currency });

export const trackCompleteRegistration = () =>
  trackEvent("CompleteRegistration");

export const trackSubscribe = (value: number, currency = "USD") =>
  trackEvent("Subscribe", { value, currency });
