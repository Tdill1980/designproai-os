/**
 * /wpw/:rep — rep / influencer / partner shared link.
 *
 * Resolves the rep from the URL slug, then immediately forwards to
 * /designpro?ref=<rep>&promo=<coupon>&try=1 so the visitor lands ON
 * DesignPro with the $25 popup already open, branded in the rep's
 * accent color and showing their headshot. The popup IS the rep
 * landing — same bullets, same trust signals, same conversion CTA —
 * with the live DesignPro tool visible behind it so buyers can start
 * designing the moment they pay.
 *
 * Unknown slugs fall back to /try-design (the legacy public landing)
 * rather than 404'ing, so old bookmarks still convert.
 */

import { useEffect, useMemo } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { getWpwRep } from "@/lib/wpw-reps";

const WpwRepLanding = () => {
  const { rep: slug } = useParams<{ rep: string }>();
  const rep = useMemo(() => getWpwRep(slug), [slug]);

  // Use a full navigation (not a router redirect) so the DesignPro
  // page boots fresh with the URL params it needs to render the
  // rep-branded popup. A SPA redirect would race the modal's effect
  // that reads ?ref / ?promo on mount.
  useEffect(() => {
    if (!rep) return;
    const target = `/designpro?ref=${encodeURIComponent(
      rep.ref,
    )}&promo=${encodeURIComponent(rep.coupon)}&try=1`;
    window.location.replace(target);
  }, [rep]);

  if (!rep) {
    return <Navigate to="/try-design" replace />;
  }

  // Brief splash while the browser is mid-redirect. Keeps the brand
  // visible so the transition feels intentional, not a blank flash.
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center text-white"
      style={{
        background: `linear-gradient(180deg, ${rep.accent} 0%, #0b1220 100%)`,
      }}
    >
      <div className="text-[11px] uppercase tracking-[0.3em] font-bold opacity-80 mb-3">
        Direct from {rep.name}
      </div>
      <div className="text-3xl font-extrabold mb-4">
        Opening DesignProAI&trade;…
      </div>
      <Loader2 className="w-7 h-7 animate-spin opacity-80" />
    </div>
  );
};

export default WpwRepLanding;
