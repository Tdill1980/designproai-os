import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { FB_PIXEL_ID, pageview } from "@/lib/pixel";

/**
 * Loads the Meta Pixel base code on first mount and fires PageView on every
 * client-side route change. Must be rendered inside <BrowserRouter> because
 * it depends on useLocation().
 *
 * The pixel ID comes from VITE_FACEBOOK_PIXEL_ID. If the env var is missing
 * the component renders nothing and never injects the script.
 *
 * The static <noscript> fallback lives in index.html.
 */
export function MetaPixel() {
  const location = useLocation();
  const initialized = useRef(false);
  const firstRoute = useRef(true);

  useEffect(() => {
    if (initialized.current) return;
    if (!FB_PIXEL_ID) return;
    if (typeof window === "undefined") return;

    if (typeof window.fbq !== "function") {
      // Official Meta Pixel base snippet — injects fbevents.js
      /* eslint-disable */
      (function (f: any, b: any, e: string, v: string) {
        if (f.fbq) return;
        const n: any = (f.fbq = function () {
          n.callMethod
            ? n.callMethod.apply(n, arguments)
            : n.queue.push(arguments);
        });
        if (!f._fbq) f._fbq = n;
        n.push = n;
        n.loaded = !0;
        n.version = "2.0";
        n.queue = [];
        const t = b.createElement(e) as HTMLScriptElement;
        t.async = !0;
        t.src = v;
        const s = b.getElementsByTagName(e)[0];
        s.parentNode!.insertBefore(t, s);
      })(
        window,
        document,
        "script",
        "https://connect.facebook.net/en_US/fbevents.js",
      );
      /* eslint-enable */
    }

    window.fbq!("init", FB_PIXEL_ID);
    window.fbq!("track", "PageView");
    initialized.current = true;
  }, []);

  useEffect(() => {
    if (!FB_PIXEL_ID) return;
    // Skip the very first run — initial PageView already fired during init.
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    pageview();
  }, [location.pathname]);

  return null;
}

export default MetaPixel;
