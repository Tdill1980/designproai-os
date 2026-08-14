/**
 * TryForTwentyFiveModal — in-tool "$25 buys 1 Custom Wrap Design
 * (includes 2 revisions)" offer modal.
 *
 * Lives ON the DesignPro page so ad traffic, organic visitors, and rep
 * referrals can buy without leaving the tool. Replaces the redirect to
 * /try-design as the primary conversion surface; that standalone page
 * stays alive as marketing surface (SEO + a destination for non-modal
 * clients), but everyone who lands inside the tool gets this popup.
 *
 * Triggers:
 *   - URL `?try=1` — explicit "open the modal" intent (from nav)
 *   - URL `?ref=<slug>` or `?promo=<code>` — rep funnel landing
 *   - Programmatic open via the `open` prop (caller-controlled)
 *
 * On submit, posts { email, name?, ref?, promo? } to the existing
 * `create-guest-design-checkout` edge function (already supports
 * affiliate_coupons lookup + ref attribution + 20% commission).
 * Stripe redirects back to /designpro/try-success which delivers a
 * magic-link the user clicks to land back in DesignPro authenticated
 * with 1 RP design token.
 */

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Sparkles,
  ShieldCheck,
  Tag,
  X,
  Mail,
  Check,
  Printer,
  Clock,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  WPW_REPS,
  defaultHeadshotPath,
  defaultHeroPath,
  defaultOrgLogoPath,
  getWpwRepByPartnerCode,
  type WpwRep,
} from "@/lib/wpw-reps";
import { Link } from "react-router-dom";
import { RpToken } from "@/components/RpToken";

const FALLBACK_HERO =
  "https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/email-assets/McLaren%20koi%20proof%203d.jpeg";

interface TryForTwentyFiveModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Attribution slug — e.g. "troy". Persists to Stripe metadata.
   * Named `refSlug` (not `ref`) so React doesn't intercept it as a
   * forwarded DOM ref on a function component.
   */
  refSlug?: string;
  /** Coupon code — e.g. "TROY10". Auto-applies via affiliate_coupons. */
  promo?: string;
}

const sanitizeRef = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
const sanitizePromo = (s: string) =>
  s.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);

export const TryForTwentyFiveModal = ({
  open,
  onClose,
  refSlug: refProp,
  promo: promoProp,
}: TryForTwentyFiveModalProps) => {
  const refValue = useMemo(
    () => (refProp ? sanitizeRef(refProp) : ""),
    [refProp],
  );
  const promoValue = useMemo(
    () => (promoProp ? sanitizePromo(promoProp) : ""),
    [promoProp],
  );

  // Try to resolve the rep from either the promo code (links directly
  // to a partner via affiliate_coupons) or the ref slug (matches the
  // rep's URL slug). Display rep branding when we get a hit.
  const rep: WpwRep | null = useMemo(() => {
    if (promoValue) {
      const byCoupon = Object.values(WPW_REPS).find(
        (r) => r.coupon.toUpperCase() === promoValue,
      );
      if (byCoupon) return byCoupon;
    }
    if (refValue) {
      const direct = WPW_REPS[refValue];
      if (direct) return direct;
      const byPartner = getWpwRepByPartnerCode(refValue.toUpperCase());
      if (byPartner) return byPartner;
    }
    return null;
  }, [refValue, promoValue]);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset form fields when modal closes so subsequent opens don't show
  // stale state from a previous attempt.
  useEffect(() => {
    if (!open) {
      setSubmitting(false);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "create-guest-design-checkout",
        {
          body: {
            email: trimmedEmail,
            name: name.trim() || undefined,
            ref: refValue || undefined,
            promo: promoValue || undefined,
          },
        },
      );
      if (error) throw error;
      if (!data?.url) throw new Error("No checkout URL returned");
      window.location.href = data.url;
    } catch (err: any) {
      console.error("[try-25-modal] checkout error:", err);
      toast.error(err?.message || "Couldn't start checkout. Please try again.");
      setSubmitting(false);
    }
  };

  const priceLabel = promoValue ? "$225" : "$250";

  // When a rep is identified, paint the modal in their accent color so
  // the shared link feels personal — same color story as /wpw/<rep>.
  const accent = rep?.accent ?? "#0284C7";
  const accentSoft = rep?.accentSoft ?? "#E0F2FE";
  const repHeadshot = rep ? defaultHeadshotPath(rep) : null;
  const heroImage = rep ? defaultHeroPath(rep) : FALLBACK_HERO;
  const orgLogo = rep ? defaultOrgLogoPath(rep) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-5xl p-0 overflow-hidden gap-0 bg-white border border-gray-200 rounded-2xl shadow-2xl light text-gray-900 max-h-[94vh] overflow-y-auto"
        overlayClassName="bg-gray-900/75 backdrop-blur-sm"
      >
        {/* Brand gradient strip — accent-tinted when a rep is identified
            so the shared link reads as personal from the first pixel. */}
        <div
          className="h-1.5"
          style={{
            background: `linear-gradient(90deg, ${accent}, ${accent}aa, ${accent})`,
          }}
        />

        {/* Custom close button (replaces the default dark-mode X from
            shadcn/ui dialog so the contrast reads on white). */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 z-10 rounded-full p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Two-column hero: text + bullets + CTA on the left, signature
            wrap photo on the right. Big button sits high so it's above
            the fold on every viewport. The form + WPW footer live below
            the hero in a single full-width column. */}
        <div className="grid grid-cols-1 md:grid-cols-[1.15fr_1fr]">
        <div className="p-6 sm:p-7 md:pr-5">
          {/* Brand mark + eyebrow. When a rep is identified the eyebrow
              upgrades to "Direct from <Rep>" with their headshot so the
              popup IS the rep landing — same trust signal that lived on
              /wpw/<rep>, now in the conversion surface. */}
          <div className="flex items-center gap-3 mb-5">
            {repHeadshot ? (
              <img
                src={repHeadshot}
                alt={rep!.name}
                className="w-12 h-12 rounded-full object-cover shadow-sm ring-2"
                style={{ borderColor: accent, boxShadow: `0 0 0 2px ${accent}55` }}
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ring-1"
                style={{
                  background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
                  borderColor: `${accent}55`,
                }}
              >
                <Sparkles className="w-5 h-5 text-white" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div
                className="text-[10px] uppercase tracking-[0.22em] font-bold"
                style={{ color: accent }}
              >
                {rep ? `Direct from ${rep.name}` : "DesignProAI™"}
              </div>
              <div className="text-[11px] text-gray-500 leading-tight">
                {rep
                  ? `${rep.title} · We believe in it that much.`
                  : "We believe in it that much."}
              </div>
            </div>
            {/* Org logo co-brand — small mark next to the rep eyebrow
                so the popup reads as "from <Rep> @ <Shop>". Renders
                only when the rep has an org logo file. */}
            {orgLogo && (
              <img
                src={orgLogo}
                alt={rep?.org ?? "Shop"}
                className="h-8 sm:h-9 w-auto object-contain shrink-0"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = "none";
                }}
              />
            )}
          </div>

          <h2 className="text-[26px] sm:text-[32px] font-extrabold leading-[1.05] tracking-tight text-gray-900">
            Custom Wrap Design &mdash;{" "}
            <span
              style={{
                background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {priceLabel}
            </span>
          </h2>
          <p className="text-sm text-gray-700 mt-2.5 leading-relaxed">
            We&apos;re so confident in DesignProAI&trade;, we&apos;re handing
            you the keys for{" "}
            <span className="font-semibold text-gray-900">{priceLabel}</span>.
            Build a real custom wrap design and see for yourself why our
            customers don&apos;t go back.
          </p>

          {/* Placeholder card — Trish will drop a DesignPro screenshot
              (the tool UI with a design rendered inside it) into this
              slot later. Dashed-border thumbnail keeps the layout
              spaced correctly until the asset lands. Replace the inner
              <div> with an <img src="..."> when the image is ready. */}
          <div
            className="mt-4 aspect-[16/9] w-full max-w-sm rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-center px-4 py-3"
            style={{
              borderColor: `${accent}55`,
              background: `${accentSoft}40`,
            }}
            data-image-slot="designpro-preview"
          >
            <ImageIcon
              className="w-5 h-5 mb-1.5"
              style={{ color: accent }}
            />
            <div
              className="text-[10px] uppercase tracking-[0.18em] font-bold"
              style={{ color: accent }}
            >
              DesignPro preview
            </div>
            <div className="text-[11px] text-gray-500 mt-0.5 leading-snug">
              Screenshot of DesignProAI&trade; with a live design
            </div>
          </div>

          {/* Coupon chip — visible when the rep's link carries a promo
              code so the discount is impossible to miss. */}
          {promoValue && (
            <div
              className="mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-mono font-bold tracking-wider"
              style={{
                background: `${accent}14`,
                borderColor: `${accent}55`,
                color: accent,
              }}
            >
              <Tag className="w-3.5 h-3.5" />
              {promoValue}
              <span className="font-sans font-semibold text-xs">
                &mdash; 10% off ($225)
              </span>
            </div>
          )}

          {/* Rep's personal first-person intro — quote-styled with
              their accent on the left bar. Frames the offer in THEIR
              voice (the WPW production specialist, the exotic-wrap
              shop owner, the founder) so the popup reads as a personal
              recommendation, not a generic landing. Sits above the
              bullets so the rep is who's making the offer. */}
          {rep && (
            <blockquote
              className="mt-5 rounded-lg bg-white border-l-4 p-3.5 text-[13px] text-gray-800 leading-relaxed italic shadow-sm"
              style={{ borderLeftColor: accent }}
            >
              &ldquo;{rep.intro}&rdquo;
              <div
                className="mt-2 not-italic text-[10px] uppercase tracking-[0.18em] font-bold"
                style={{ color: accent }}
              >
                &mdash; {rep.name}, {rep.title}
              </div>
            </blockquote>
          )}

          {/* What you get for $25 — the canonical benefit list shared
              by every conversion surface (rep landings, /try, this
              popup). Edit here = edit everywhere. The RP token coin row
              up top makes the "what you're buying" literal: $25 = 1 RP
              token = 1 Custom Wrap Design + 2 revisions. */}
          <div
            className="mt-5 rounded-xl border p-4 sm:p-5"
            style={{ background: `${accentSoft}80`, borderColor: `${accent}40` }}
          >
            <div
              className="text-[10px] uppercase tracking-[0.22em] font-bold mb-3"
              style={{ color: accent }}
            >
              What you get for {priceLabel}
            </div>

            {/* The 1 RP design token the buyer is purchasing — same
                coin visual as the dashboard balance card so the unit
                of value is consistent across the product. */}
            <div className="flex items-center gap-3 mb-4">
              <RpToken size="md" />
              <div className="leading-tight">
                <div className="text-[13px] sm:text-sm font-extrabold text-gray-900">
                  1 RP Design Token
                </div>
                <div className="text-[11px] text-gray-600">
                  Redeems for{" "}
                  <span className="font-semibold text-gray-800">
                    1 Custom Wrap Design (includes 2 revisions)
                  </span>
                </div>
              </div>
            </div>

            <ul className="space-y-2 text-[13px] sm:text-sm text-gray-800 leading-snug">
              <li className="flex gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: accent }} />
                <span>
                  <span className="font-semibold">1 Custom Wrap Design</span>{" "}
                  on your{" "}
                  <span className="font-semibold">year &middot; make &middot; model</span>
                </span>
              </li>
              <li className="flex gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: accent }} />
                <span>
                  Rendered from{" "}
                  <span className="font-semibold">7 photorealistic angles</span>{" "}
                  &mdash; full 360 view of the wrap on your vehicle
                </span>
              </li>
              <li className="flex gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: accent }} />
                <span>
                  <span className="font-semibold">3D proof</span> &mdash; see
                  the wrap on the actual vehicle, not a flat mockup
                </span>
              </li>
              <li className="flex gap-2">
                <Check className="w-4 h-4 mt-0.5 shrink-0" style={{ color: accent }} />
                <span>
                  <span className="font-semibold">2 revisions included</span>{" "}
                  in Revision Studio &mdash; refine color, layout, or concept
                  until it&apos;s yours
                </span>
              </li>
              <li className="flex gap-2">
                <Printer className="w-4 h-4 mt-0.5 shrink-0" style={{ color: accent }} />
                <span>
                  Option to purchase{" "}
                  <span className="font-semibold">real print-ready files</span>{" "}
                  &mdash; <span className="font-semibold">$299</span>, output
                  by a real graphic designer,{" "}
                  <span className="font-semibold">delivered in 48 hours</span>
                </span>
              </li>
              <li className="flex gap-2">
                <Mail className="w-4 h-4 mt-0.5 shrink-0" style={{ color: accent }} />
                <span>Magic-link delivery &mdash; no subscription, no password</span>
              </li>
            </ul>
          </div>

          {/* GIANT CTA — placed inside the left column above the fold
              so the buy action is visible without scrolling. Click jumps
              to (or auto-submits) the form section below. */}
          <a
            href="#try25-checkout"
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById("try25-checkout")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
              setTimeout(
                () => document.getElementById("try25-email")?.focus(),
                350,
              );
            }}
            className="mt-5 flex items-center justify-center w-full h-14 text-lg font-extrabold text-white rounded-md shadow-xl hover:brightness-110 transition"
            style={{
              background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
              boxShadow: `0 10px 28px ${accent}66`,
            }}
          >
            {priceLabel} &mdash; Buy Custom Wrap Design
            <Sparkles className="w-4 h-4 ml-2" />
          </a>
          <p className="mt-2 text-center text-[11px] text-gray-500">
            Secure Stripe checkout &middot; one-time charge &middot; no subscription
          </p>
        </div>

        {/* Right column — rep's signature wrap photo (or fallback hero).
            On mobile this stacks above the text via order-first; on
            desktop it sits to the right. Acts as the visual proof
            balancing the bullet copy on the left. */}
        <div className="relative bg-gray-100 order-first md:order-none">
          <img
            src={heroImage}
            alt={rep ? `Signature wrap work by ${rep.name}` : "Custom wrap design example"}
            className="w-full h-full max-h-[420px] md:max-h-none object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = FALLBACK_HERO;
            }}
          />
          {/* Overlay badge — frames the photo as a live example of what
              a $25 buyer walks away with. */}
          <div
            className="absolute top-4 left-4 right-4 flex items-center justify-between"
            style={{ pointerEvents: "none" }}
          >
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.18em] font-bold backdrop-blur"
              style={{
                background: "rgba(15,23,42,0.78)",
                color: "#fff",
              }}
            >
              <Sparkles className="w-3 h-3" />
              {rep ? `${rep.name}'s actual work` : "Example output"}
            </span>
            <span
              className="rounded-full px-2.5 py-0.5 text-[10px] uppercase tracking-[0.18em] font-bold text-white"
              style={{ background: accent }}
            >
              7 angles
            </span>
          </div>
        </div>
        </div>

        {/* Bottom section — form + reassurance + WPW footer. Full width
            below the two-column hero, so the email/name inputs get the
            breathing room they need without competing with the photo. */}
        <div className="px-6 sm:px-7 pb-6 sm:pb-7" id="try25-checkout">
          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-2 space-y-3 max-w-2xl mx-auto">
            <div>
              <Label
                htmlFor="try25-name"
                className="text-xs font-medium text-gray-700"
              >
                Your name{" "}
                <span className="text-gray-400 font-normal">
                  (so we can label your designs)
                </span>
              </Label>
              <Input
                id="try25-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional"
                className="mt-1 h-11 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:border-[#38BDF8] focus-visible:ring-[#38BDF8]/30"
                disabled={submitting}
                autoComplete="name"
              />
            </div>
            <div>
              <Label
                htmlFor="try25-email"
                className="text-xs font-medium text-gray-700"
              >
                Email{" "}
                <span className="text-gray-400 font-normal">
                  — we&apos;ll send your design link here
                </span>
              </Label>
              <Input
                id="try25-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1 h-11 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus-visible:border-[#38BDF8] focus-visible:ring-[#38BDF8]/30"
                disabled={submitting}
                autoComplete="email"
              />
            </div>
            <Button
              type="submit"
              disabled={submitting || !email.trim()}
              className="w-full h-14 text-lg font-extrabold text-white border-0 shadow-lg hover:brightness-110 disabled:opacity-60"
              style={{
                background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
                boxShadow: `0 8px 24px ${accent}55`,
              }}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Redirecting to checkout…
                </>
              ) : (
                <>
                  {priceLabel} &mdash; Buy Custom Wrap Design
                  <Sparkles className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </form>

          {/* Three short reassurance lines: trust (Stripe), no-rush
              (buy now use later), and the "save = account" rule so
              there are no surprises after they click. */}
          <div className="mt-3 max-w-2xl mx-auto space-y-1.5 text-[11.5px] text-gray-600 leading-relaxed">
            <div className="flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
              Secure checkout by Stripe &middot; one-time charge &middot; no subscription.
            </div>
            <div className="flex items-start gap-1.5">
              <Clock className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
              Not ready to design? Buy now &mdash; your token waits in your
              account. Log in any time to use it.
            </div>
            <div className="flex items-start gap-1.5">
              <Sparkles className="w-3.5 h-3.5 mt-0.5 text-gray-400 shrink-0" />
              When you save a design, we&apos;ll ask you to create a free
              account (or opt in to keep your info) so your work follows you.
            </div>
          </div>

          {/* WePrintWraps · ShopEngine footer callout — for the wrap-shop
              audience this popup serves. Free ShopEngine dashboard wins
              future revenue even when the visitor doesn't buy today. */}
          <div className="mt-5 max-w-2xl mx-auto rounded-xl border border-gray-200 bg-gradient-to-br from-[#0F172A] to-[#1E293B] text-white p-4">
            <div className="text-[10px] uppercase tracking-[0.22em] font-bold text-cyan-300 mb-1.5">
              Are you a WePrintWraps.com customer?
            </div>
            <p className="text-[13px] text-white/85 leading-snug">
              Get a free{" "}
              <span className="font-extrabold">
                <span className="text-white">Shop</span>
                <span className="bg-gradient-to-r from-blue-400 to-fuchsia-400 bg-clip-text text-transparent">
                  Engine
                </span>
              </span>{" "}
              dashboard &mdash; view past orders, get an instant quote, create
              a quote, and even place orders on{" "}
              <a
                href="https://weprintwraps.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-cyan-300 hover:text-cyan-200"
              >
                WePrintWraps.com
              </a>
              . It&apos;s free.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Link
                to="/signup"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold px-3 py-1.5 transition"
              >
                Get ShopEngine free
              </Link>
              <a
                href="https://weprintwraps.com/quote"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-white/20 hover:bg-white/5 text-white text-xs font-semibold px-3 py-1.5 transition"
              >
                Instant quote on WPW
              </a>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-200 text-center text-xs text-gray-500">
            <Mail className="w-3.5 h-3.5 inline mr-1 -mt-0.5 text-gray-400" />
            Already paid?{" "}
            <Link
              to="/login"
              className="hover:underline font-semibold"
              style={{ color: accent }}
              onClick={onClose}
            >
              Sign in to your account
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
