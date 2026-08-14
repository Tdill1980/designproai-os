import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";

/**
 * CanonicalTag — emits a self-referential canonical for the CURRENT route.
 *
 * Why this exists: `index.html` shipped a hardcoded
 * `<link rel="canonical" href="https://designproai.com">`, and `vercel.json`
 * rewrites `/(.*)` -> `/`, so that one tag was served for EVERY route. Only 38
 * of ~284 page components override it via their own Helmet, so every other
 * page was telling Google "I am the homepage" — an instruction to drop it from
 * the index. That static tag has been removed from index.html; this renders the
 * correct per-path canonical instead.
 *
 * Mounted once inside BrowserRouter, above <Routes>. react-helmet-async lets a
 * deeper/later Helmet win for the same tag, so any page that already declares
 * its own canonical keeps it — this only fills the gap for pages that don't.
 *
 * Query strings and hashes are dropped: `?shop=wpw` and `/quote/x#section` are
 * the same document for indexing purposes, and folding them prevents duplicate
 * URLs competing with each other.
 */

const ORIGIN = "https://designproai.com";

export function canonicalFor(pathname: string): string {
  // Collapse duplicate slashes and drop a trailing slash so `/colorpro/` and
  // `/colorpro` cannot both be advertised as canonical. Root stays "/".
  const clean = pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return ORIGIN + (clean === "" ? "/" : clean);
}

export default function CanonicalTag() {
  const { pathname } = useLocation();
  return (
    <Helmet>
      <link rel="canonical" href={canonicalFor(pathname)} />
    </Helmet>
  );
}
