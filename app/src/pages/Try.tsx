/**
 * /try — public landing page for the $25 Custom Wrap Design offer.
 *
 * Content is CMS-driven via `try_landing_config` + `try_landing_examples`
 * (managed at /admin/try-landing). The page falls back to baked-in
 * defaults if the tables are empty so it ships before the migration
 * runs.
 *
 * Surfaces:
 *   - Headline + sub-headline (config)
 *   - Three RP $25 token coins (config-gated)
 *   - "What you get" bullet list (config)
 *   - Custom-design gallery (examples · proof_type='design')
 *   - 2D proof tile (examples · proof_type='2d_proof', first)
 *   - 3D proof tile (examples · proof_type='3d_proof', first)
 *   - Pay $25 CTA + share button
 *   - $299 production-pack callout (config-gated, post-approval upsell)
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  ArrowRight,
  Check,
  Share2,
  Printer,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { RpToken } from "@/components/RpToken";
import {
  useTryLandingContent,
  type TryLandingExample,
} from "@/hooks/useTryLandingContent";

const PRICE_LABEL = "$25";

export default function Try() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [shareCopied, setShareCopied] = useState(false);
  const { config, examples, isLoading } = useTryLandingContent();

  // CTA opens the guest-friendly $25 modal on DesignPro (which uses
  // create-guest-design-checkout — magic-link, no signup, no password).
  // Replaces the old create-try-checkout flow that forced visitors to
  // /login first, since that broke the "no signup form" promise.
  const startCheckout = () => {
    navigate("/designpro?try=1");
  };

  // Clean any legacy query params still floating around from the
  // original session-required flow.
  useEffect(() => {
    let needsClean = false;
    const next = new URLSearchParams(params);
    if (next.has("buy")) {
      next.delete("buy");
      needsClean = true;
    }
    if (next.has("canceled")) {
      toast({
        title: "Checkout canceled",
        description: "No charge — come back anytime.",
      });
      next.delete("canceled");
      needsClean = true;
    }
    if (needsClean) setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}/try` : "/try";

  const handleShare = async () => {
    const shareData = {
      title: "Custom Wrap Design — $25 — RestylePro",
      text: "Custom AI vehicle wrap design for $25. Try it before you commit.",
      url: shareUrl,
    };
    try {
      if (
        typeof navigator !== "undefined" &&
        (navigator as { share?: (d: typeof shareData) => Promise<void> })
          .share
      ) {
        await (
          navigator as { share: (d: typeof shareData) => Promise<void> }
        ).share(shareData);
        return;
      }
    } catch {
      // user dismissed — fall through to clipboard
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
      toast({ title: "Link copied", description: shareUrl });
    } catch {
      toast({ title: "Copy this link", description: shareUrl });
    }
  };

  const proof2d = examples.proof_2d[0];
  const proof3d = examples.proof_3d[0];
  const designs = examples.design;

  return (
    <>
      <Helmet>
        <title>{`${config.headline} — ${PRICE_LABEL} — RestylePro`}</title>
        <meta
          name="description"
          content={
            config.subheadline ??
            `Custom AI vehicle wrap design for ${PRICE_LABEL}. 3D + 2D proofs, 3 revisions, no subscription.`
          }
        />
        <meta property="og:title" content={`${config.headline} — ${PRICE_LABEL}`} />
        <meta property="og:url" content={shareUrl} />
        <meta name="twitter:card" content="summary_large_image" />
      </Helmet>

      <main className="min-h-screen bg-gradient-to-b from-[#F0F9FF] via-white to-white text-gray-900">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 pt-12 sm:pt-16 pb-16">
          {/* Hero */}
          <div className="text-center">
            <p className="text-[11px] uppercase tracking-[0.3em] text-[#0284C7] font-bold mb-3">
              RestyleProAI&trade; · No subscription required
            </p>
            <h1 className="font-display text-[40px] sm:text-[60px] font-black leading-[1.02] tracking-tight">
              <span className="text-gray-900">{config.headline}</span>
            </h1>
            <div className="mt-3 inline-flex items-baseline gap-2.5">
              <span className="text-5xl sm:text-6xl font-extrabold bg-gradient-to-r from-[#0284C7] via-[#38BDF8] to-[#0EA5E9] bg-clip-text text-transparent">
                {PRICE_LABEL}
              </span>
              <span className="text-sm font-semibold text-gray-500">
                one-time
              </span>
            </div>
            {config.subheadline && (
              <p className="mt-5 text-base sm:text-lg text-gray-700 max-w-2xl mx-auto leading-relaxed">
                {config.subheadline}
              </p>
            )}

            {/* RP token coins */}
            {config.show_token_coins && (
              <div className="mt-7 rounded-2xl bg-gradient-to-br from-[#F0F9FF] via-white to-[#FAF5FF] border border-[#BAE6FD] mx-auto max-w-xl p-5">
                <div className="flex items-center justify-center gap-4">
                  <RpToken size="md" />
                  <RpToken size="md" />
                  <RpToken size="md" />
                </div>
                <div className="mt-3 text-center text-[11px] uppercase tracking-[0.18em] font-semibold text-[#0369A1]">
                  3 design tokens · 1 custom design + 3 revisions
                </div>
              </div>
            )}

            {/* Primary CTA */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                size="lg"
                onClick={startCheckout}
                className="h-14 px-8 text-base font-bold text-white bg-gradient-to-r from-[#0284C7] to-[#38BDF8] hover:brightness-110 border-0 shadow-lg shadow-[#38BDF8]/30"
              >
                Get my custom design — {PRICE_LABEL}
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={handleShare}
                className="h-14 border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                <Share2 className="h-4 w-4 mr-2" />
                {shareCopied ? "Copied!" : "Share"}
              </Button>
            </div>
          </div>

          {/* What you get */}
          {config.what_you_get.length > 0 && (
            <section className="mt-14 rounded-2xl bg-white border border-gray-200 shadow-sm p-6 sm:p-8">
              <h2 className="text-xs uppercase tracking-[0.22em] font-bold text-gray-500 mb-4">
                What you get
              </h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {config.what_you_get.map((b, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <Check className="h-4 w-4 text-[#0EA5E9] mt-0.5 shrink-0" />
                    <span className="text-gray-800 leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* 3D + 2D proof tiles */}
          {(proof3d || proof2d) && (
            <section className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5">
              {proof3d && <ProofTile example={proof3d} label="3D proof" />}
              {proof2d && (
                <ProofTile example={proof2d} label="2D flat-panel proof" />
              )}
            </section>
          )}

          {/* Custom-design gallery */}
          {designs.length > 0 && (
            <section className="mt-12">
              <h2 className="text-xs uppercase tracking-[0.22em] font-bold text-gray-500 mb-4 text-center">
                What "Custom Wrap Design" looks like
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {designs.map((d) => (
                  <DesignTile key={d.id} example={d} />
                ))}
              </div>
            </section>
          )}

          {/* $299 production pack */}
          {config.production_pack_enabled && config.production_pack_copy && (
            <section className="mt-12 rounded-2xl bg-gradient-to-br from-[#0F172A] to-[#1E293B] text-white p-6 sm:p-8 shadow-xl">
              <div className="flex flex-col sm:flex-row items-start gap-5">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-[#38BDF8] to-[#0EA5E9] flex items-center justify-center shrink-0 shadow-lg">
                  <Printer className="w-7 h-7 text-white" />
                </div>
                <div className="flex-1">
                  <div className="text-[11px] uppercase tracking-[0.22em] font-bold text-[#38BDF8] mb-1.5">
                    Approved your design?
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold leading-tight">
                    Production-ready print files —{" "}
                    <span className="text-[#38BDF8]">
                      ${config.production_pack_price}
                    </span>
                  </h3>
                  <p className="mt-2.5 text-sm sm:text-base text-white/80 leading-relaxed">
                    {config.production_pack_copy}
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-white/60">
                    <ShieldCheck className="h-3.5 w-3.5 text-white/40" />
                    Optional add-on — only pay if you love your design
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Subscription cross-link */}
          <p className="mt-10 text-center text-xs text-gray-500">
            Running these every week?{" "}
            <a
              href="/pricing"
              className="text-[#0284C7] hover:text-[#0369A1] font-semibold hover:underline"
            >
              See monthly plans →
            </a>
          </p>

          {isLoading && (
            <p className="mt-4 text-center text-[10px] uppercase tracking-wider text-gray-400">
              Refreshing latest content…
            </p>
          )}
        </div>
      </main>
    </>
  );
}

// ============================================================ Tiles

const ProofTile = ({
  example,
  label,
}: {
  example: TryLandingExample;
  label: string;
}) => (
  <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm">
    <div className="aspect-[4/3] bg-gray-100 overflow-hidden">
      <img
        src={example.image_url}
        alt={example.title}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
    <div className="p-4">
      <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#0284C7] mb-1">
        {label}
      </div>
      <div className="text-base font-bold text-gray-900">{example.title}</div>
      {example.description && (
        <p className="text-sm text-gray-600 mt-1 leading-snug">
          {example.description}
        </p>
      )}
    </div>
  </div>
);

const DesignTile = ({ example }: { example: TryLandingExample }) => (
  <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition">
    <div className="aspect-[4/3] bg-gray-100 overflow-hidden">
      <img
        src={example.image_url}
        alt={example.title}
        className="w-full h-full object-cover"
        loading="lazy"
      />
    </div>
    <div className="p-3.5">
      <div className="text-sm font-semibold text-gray-900 leading-tight">
        {example.title}
      </div>
      {example.description && (
        <p className="text-xs text-gray-600 mt-1 line-clamp-2">
          {example.description}
        </p>
      )}
    </div>
  </div>
);
