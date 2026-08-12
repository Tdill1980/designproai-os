import { useLocation } from "react-router-dom";

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

export const useIsAppRoute = (): boolean => {
  const { pathname } = useLocation();
  return APP_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/")
  );
};
