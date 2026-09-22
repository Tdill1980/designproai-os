import { useLocation } from "react-router-dom";
import { isWallProPartnerHost } from "@/lib/designpro-host-routing";

/**
 * App routes use the new <AppShell> chrome (sticky top bar + sidebar + bottom tabs)
 * instead of the marketing <Header> / <Footer>.
 *
 * Any path that matches one of these prefixes is treated as "inside the app."
 */
const APP_ROUTE_PREFIXES = [
  "/dashboard",
  "/quotes",
  "/my-renders",
  "/my-designs",
  "/billing",
  "/account",
  "/colorpro",
  "/designpro",
  "/panelpro-file-output",
  "/restylelibrary",
  "/fadewraps",
  "/wbty",
  "/approvemode",
  "/graphics-pro",
  "/graphicspro",
  "/visualize",
  "/material",
  "/myvehiclepro",
  "/quick-quote",
  "/revision-studio",
  "/recreatepro",
  "/wrapbox",
  "/designvault",
  "/creatormarket",
  "/productionflow",
  "/production-flow",
  "/printpro",
  "/app-cart",
  // BOH manufacturing control tower uses the canonical SaaS shell (left sidebar
  // + branding) — opt this one admin path into AppShell chrome.
  "/admin/manufacturing-pipeline",
];

/**
 * /shopflow IS AN APP ROUTE — BUT ONLY ON THE OS HOST (owner, 2026-09-22).
 *
 * She reported "on os.designproai.com the navigation is showing shopflow
 * navigation instead of DesignPro", it was read as a banner in the sidebar,
 * the banner was removed, and she reported it again: "I did hard refresh and
 * I went private browsing yet still showing the blue shopflow side bar".
 *
 * The banner was genuinely gone — it is in none of the 184 chunks the live
 * site serves. What she was looking at is ShopFlow's OWN rail: a 268px
 * `from-[#0b1830] via-[#101b32] to-[#174a91]` aside inside the page itself.
 * `/shopflow` was not in the list above, so AppShell passed it straight
 * through and the DesignProAI sidebar never rendered at all. Clicking the
 * ShopFlow row in the OS navigation swapped the entire chrome.
 *
 * ⚠️ WHY THIS IS HOST-CONDITIONAL, AND DO NOT SIMPLIFY IT INTO THE LIST ABOVE.
 * The same app serves the partner host, by path. AppSidebar is DesignProAI's
 * own chrome — dark, carrying Admin Dashboard, WallPro Batch Generate, QC and
 * the plan tier — and putting it on wallpro.weprintwraps.com is the brand
 * collision App.tsx and WallProSidebar both warn about by name, half of it
 * staff navigation a customer must never see. So on a partner host /shopflow
 * keeps its own blue rail and its own identity, which is correct there: it IS
 * the WePrintWraps dashboard.
 */
export const shopflowWearsOsShell = (pathname: string, hostname: string): boolean =>
  (pathname === "/shopflow" || pathname.startsWith("/shopflow/")) &&
  !isWallProPartnerHost(hostname);

const currentHost = (): string =>
  typeof window === "undefined" ? "" : window.location.hostname;

export const useIsAppRoute = (): boolean => {
  const { pathname } = useLocation();
  return (
    APP_ROUTE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
    ) || shopflowWearsOsShell(pathname, currentHost())
  );
};

/**
 * Embedded in an iframe (ApprovePro's WPW proof / DesignPro panels): the page
 * fills the frame and AppShell renders no chrome at all.
 *
 * Lifted out of AppShell so a PAGE can ask the same question and get the same
 * answer. ShopFlow has to know whether its own rail would be a SECOND sidebar,
 * and two copies of "am I inside the shell" is exactly the drift this codebase
 * keeps paying for — the ShopFlow app list alone was wrong three times.
 */
export const isEmbeddedInIframe = (): boolean => {
  try { return typeof window !== "undefined" && window.self !== window.top; }
  catch { return true; }
};

/**
 * THE one answer to "is the DesignProAI shell around me right now".
 *
 * AppShell renders its chrome on exactly this condition, and any page that
 * needs to stand down for it must read this rather than re-deriving it.
 */
export const useInsideAppShell = (): boolean => useIsAppRoute() && !isEmbeddedInIframe();
