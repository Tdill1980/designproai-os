import { Helmet } from "react-helmet-async";
import { Button } from "@/components/ui/button";
import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Mail,
  Play,
  ImageIcon,
} from "lucide-react";
import { useWpwFounderAssets } from "@/hooks/useWpwFounderAssets";
import { isVideoUrl, getEmbedUrl } from "@/lib/wpw-founder-slots";

/**
 * /from/weprintwraps — Founder invitation from Trish to past WPW customers.
 *
 * Offer: ShopEngine™ Dashboard included + 1 complimentary custom wrap
 *        design + $50 off membership.
 * DesignPro™ memberships start at $399/mo. ProductionPacks™ $299 each.
 *
 * Founder video and per-tool explainer images are uploaded from
 * /admin/wpw-founder-assets and read at runtime via useWpwFounderAssets.
 */

const INDUSTRY_PROBLEMS = [
  "Design delays",
  "Customers unable to visualize",
  "Endless revisions",
  "Shops needing stronger sales tools",
  "Not enough designers",
  "Not enough available wrap designs",
  "Disconnected systems",
];

const CREATE_LIST = [
  "Custom vehicle wrap designs",
  "Commercial fleet wraps",
  "Wall wraps with WallPro™",
  "Cut contour graphics with GraphicsPro™",
  "Window graphics",
  "Flat surface graphics",
  "Restyle projects",
  "Photorealistic customer mockups",
];

const FOR_LIST = [
  "Cars",
  "Trucks",
  "Vans",
  "Boats",
  "Motorcycles",
  "Walls",
  "Windows",
  "Storefronts",
  "Commercial spaces",
];

interface ToolExplainer {
  key: string; // matches WPW_FOUNDER_TOOL_KEYS
  name: string;
  tagline: string;
  body: string;
}

const TOOL_EXPLAINERS: ToolExplainer[] = [
  {
    key: "designproai",
    name: "DesignProAI",
    tagline: "Full custom wrap design tools",
    body:
      "Build complete custom wrap designs with professional 2D and 3D customer renders you can send straight to clients. Set custom terms and conditions directly on every proof and presentation. No more after-hours Photoshop, no more waiting on a designer.",
  },
  {
    key: "wallpro",
    name: "WallPro",
    tagline: "Wall wrap & environmental graphic tools",
    body:
      "Visualize wall wraps, conference rooms, lobby graphics, retail interiors and storefront installs the same way you visualize vehicles. Quote larger jobs faster — and let the customer see the room before the install crew rolls in.",
  },
  {
    key: "graphicspro",
    name: "GraphicsPro",
    tagline: "Cut contour graphics for vehicles, windows, walls & flat surfaces",
    body:
      "Generate cut-ready contour graphics for any surface. Layouts come out clean, contour-pathed and production-friendly — ready for your plotter or the WePrintWraps print queue.",
  },
  {
    key: "myvehiclepro",
    name: "MyVehiclePro",
    tagline: "Show designs on customer vehicle photos",
    body:
      "Upload your customer's actual vehicle photo and instantly visualize wrap colors or full custom designs on their car, truck, van, fleet or boat. The closer is the customer seeing the wrap on the vehicle they already own.",
  },
  {
    key: "colorpro",
    name: "ColorPro",
    tagline: "Visualize real manufacturer wrap films",
    body:
      "Show any 3M, Avery Dennison, KPMF or manufacturer wrap film on any make and model. Manufacturer-accurate finishes, reflections and lighting — so the customer sees the exact film they're approving before you order a single yard.",
  },
  {
    key: "quickquote",
    name: "QuickQuote",
    tagline: "Design and quote at the same time",
    body:
      "Build custom quotes using the same WPW pricing — faster than the WPW website. Branded customer quotes that go out the door while you're still in the booth. Captured leads, captured revenue.",
  },
  {
    key: "revisionstudio",
    name: "RevisionStudioIQ",
    tagline: "Manage revisions & proofs",
    body:
      "Iterate on a customer concept the moment they send feedback. Adjust panels, swap colors, tweak the layout — and keep the geometry, lighting and angle locked. The proof your customer already signed off on stays the proof you build off of.",
  },
  {
    key: "productionflow",
    name: "ProductionFlow",
    tagline: "From proof to print workflow",
    body:
      "Every job moves through clear stages: proof, approval, production, install. Customers stay informed automatically and your shop stops losing track of where each project is.",
  },
];

// ─── Founder video player ──────────────────────────────────────────────────
// Renders a clean thumbnail (no YouTube title/date/branding) until the user
// taps. On tap, swaps to the iframe with autoplay so they only see the chrome
// AFTER they've committed to watching.
function FounderVideoPlayer({
  url,
  poster,
  embedUrl,
}: {
  url: string;
  poster: string;
  embedUrl: string | null;
}) {
  const [activated, setActivated] = useState(false);

  // Direct video file (mp4/mov/webm) - just render <video>
  if (!embedUrl) {
    return (
      <video
        className="relative z-10 w-full h-full object-cover"
        src={url}
        poster={poster || undefined}
        controls
        playsInline
        preload="metadata"
      />
    );
  }

  // YouTube/Vimeo embed - thumbnail until tapped
  // Pull a thumbnail from YouTube if we can derive the video ID.
  const ytId = embedUrl.match(/\/embed\/([A-Za-z0-9_-]{6,})/)?.[1] || "";
  const thumbnail =
    poster ||
    (ytId ? `https://img.youtube.com/vi/${ytId}/maxresdefault.jpg` : "");

  if (activated) {
    // YouTube renders ~50px of title chrome at the top + ~40px of controls
    // at the bottom of the iframe. We crop both off by sizing the iframe
    // taller than its container and clipping with overflow:hidden on the
    // wrapper so the visible region is just the video content.
    const TOP_CROP = 56; // px of title bar to clip
    const BOTTOM_CROP = 0; // keep play/pause controls visible
    return (
      <div className="relative z-10 w-full h-full overflow-hidden">
        <iframe
          className="absolute left-0 w-full"
          style={{
            top: `-${TOP_CROP}px`,
            height: `calc(100% + ${TOP_CROP + BOTTOM_CROP}px)`,
          }}
          src={`${embedUrl}${embedUrl.includes("?") ? "&" : "?"}autoplay=1`}
          title="Founder note"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setActivated(true)}
      className="relative z-10 w-full h-full block group"
      aria-label="Play founder note"
    >
      {thumbnail ? (
        <img
          src={thumbnail}
          alt="Founder note"
          className="w-full h-full object-cover"
          loading="eager"
        />
      ) : (
        <div className="w-full h-full bg-neutral-900" />
      )}
      {/* Soft dim so the play button reads on any thumbnail */}
      <div className="absolute inset-0 bg-black/15 group-hover:bg-black/25 transition-colors" />
      {/* Centered play button */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-white/95 flex items-center justify-center shadow-[0_8px_30px_rgba(0,0,0,0.35)] group-hover:scale-105 transition-transform">
          <Play className="w-7 h-7 text-black fill-black ml-1" />
        </div>
      </div>
    </button>
  );
}

// ─── Floating glimpse card used in the cinematic hero ───────────────────────
function FloatingCard({
  src,
  label,
  isDark,
  t,
}: {
  src: string;
  label: string;
  isDark: boolean;
  t: { cardBg: string; cardBorder: string; cardShadow: string; placeholderText: string; placeholderBg: string; placeholderIcon: string };
}) {
  const renderVideo = src && isVideoUrl(src);
  return (
    <div className={`w-full h-full ${t.cardBg} ${t.cardBorder} ${t.cardShadow}`}>
      {src ? (
        renderVideo ? (
          <video
            src={src}
            className="w-full h-full object-cover"
            muted
            playsInline
            loop
            autoPlay
            preload="metadata"
          />
        ) : (
          <img
            src={src}
            alt={label}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-4">
          <div className={`w-9 h-9 rounded-full ${t.placeholderBg} flex items-center justify-center mb-2`}>
            <ImageIcon className={`w-4 h-4 ${t.placeholderIcon}`} />
          </div>
          <div className={`text-[11px] font-bold ${t.placeholderText}`}>
            {label}
          </div>
        </div>
      )}
      {/* Bottom gradient + label so the card always reads as a UI proof */}
      {src && (
        <>
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-12 ${
              isDark
                ? "bg-gradient-to-t from-black/90 to-transparent"
                : "bg-gradient-to-t from-black/55 to-transparent"
            }`}
          />
          <div className="pointer-events-none absolute bottom-2 left-3 right-3 text-[10px] font-bold tracking-[0.18em] uppercase text-white/90">
            {label}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Reusable media slot (image or video, 9:16 phone-shaped by default) ─────
function MediaSlot({
  src,
  alt,
  ratio = "aspect-[9/16]",
  placeholderHint = "9:16 image or video goes here",
}: {
  src: string;
  alt: string;
  ratio?: string;
  placeholderHint?: string;
}) {
  const renderVideo = src && isVideoUrl(src);

  return (
    <div
      className={`relative w-full ${ratio} rounded-2xl overflow-hidden border border-black/10 bg-neutral-50 dark:bg-[#111114] mx-auto`}
    >
      {src ? (
        renderVideo ? (
          <video
            src={src}
            className="w-full h-full object-cover"
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          <img
            src={src}
            alt={alt}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        )
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-center px-4 border-2 border-dashed border-black/15 rounded-2xl">
          <div className="w-12 h-12 rounded-full bg-black/5 border border-black/10 flex items-center justify-center mb-3">
            <ImageIcon className="w-5 h-5 text-black/40 dark:text-white/40" />
          </div>
          <div className="font-montserrat font-bold text-black/70 dark:text-white/70 text-sm">
            {alt}
          </div>
          <div className="text-[11px] text-black/40 dark:text-white/40 mt-0.5">
            {placeholderHint}
          </div>
        </div>
      )}
    </div>
  );
}

const FromWePrintWraps = ({ theme = "light" }: { theme?: "light" | "dark" } = {}) => {
  const [searchParams] = useSearchParams();
  const { data: assets = {} } = useWpwFounderAssets();
  const founderVideoUrl = assets["video"] || "";
  const founderVideoPoster = assets["video-poster"] || "";
  const heroPhotoreal = assets["tool-myvehiclepro"] || assets["tool-colorpro"] || "";
  const heroProofUi = assets["tool-productionflow"] || assets["tool-revisionstudio"] || "";
  const heroDashboard = assets["tool-designproai"] || assets["tool-quickquote"] || "";
  const isDark = theme === "dark";

  useEffect(() => {
    const source = searchParams.get("utm_source") || "weprintwraps";
    const medium = searchParams.get("utm_medium") || "founder-invite";
    const campaign = searchParams.get("utm_campaign") || "wpw-founder";
    localStorage.setItem(
      "restylepro_referral",
      JSON.stringify({
        source,
        medium,
        campaign,
        offer: "wpw-founder-dashboard-1-design-50-off",
        landed: new Date().toISOString(),
      })
    );
  }, [searchParams]);

  // Theme tokens — keep both palettes co-located so the JSX stays clean.
  const t = isDark
    ? {
        bg: "bg-[#0a0a0b] text-white",
        ribbon: "border-b border-white/10 bg-[#0a0a0b]",
        ribbonText: "text-white/55",
        ribbonIcon: "text-white/40",
        eyebrow: "text-white/45",
        headline: "text-white",
        body: "text-white/70",
        bodyDim: "text-white/55",
        cardBg: "bg-white/[0.04]",
        cardBorder: "border-white/10",
        cardShadow: "shadow-[0_24px_60px_-30px_rgba(0,0,0,0.8)]",
        videoFrameBg: "bg-[#111114]",
        videoFrameBorder: "border-white/10",
        glowFrom: "from-blue-500/30",
        glowTo: "to-fuchsia-500/25",
        ctaPrimary:
          "bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:opacity-90 text-white",
        ctaOutline:
          "border-white/20 text-white hover:bg-white/5",
        placeholderBg: "bg-white/5 border border-white/10",
        placeholderIcon: "text-white/40",
        placeholderText: "text-white/70",
        placeholderHint: "text-white/30",
        placeholderRing: "border-white/15",
      }
    : {
        bg: "bg-white text-black dark:text-white",
        ribbon: "border-b border-black/10 dark:border-white/10 bg-white dark:border-white/10 dark:bg-white/[0.03]",
        ribbonText: "text-black/60 dark:text-white/55",
        ribbonIcon: "text-black/50 dark:text-white/45",
        eyebrow: "text-black/45 dark:text-white/40",
        headline: "text-black dark:text-white",
        body: "text-black/70 dark:text-white/70",
        bodyDim: "text-black/55 dark:text-white/50",
        cardBg: "bg-white",
        cardBorder: "border-black/10",
        cardShadow: "shadow-[0_24px_60px_-30px_rgba(15,23,42,0.18)]",
        videoFrameBg: "bg-neutral-50 dark:bg-[#111114]",
        videoFrameBorder: "border-black/10",
        glowFrom: "from-blue-500/15",
        glowTo: "to-fuchsia-500/10",
        ctaPrimary:
          "bg-gradient-to-r from-blue-600 to-fuchsia-600 hover:opacity-90 text-white",
        ctaOutline:
          "border-black/15 text-black hover:bg-black/5 dark:border-white/20 dark:text-white dark:hover:bg-white/5",
        placeholderBg: "bg-black/5 border border-black/10",
        placeholderIcon: "text-black/40 dark:text-white/40",
        placeholderText: "text-black/70 dark:text-white/70",
        placeholderHint: "text-black/40 dark:text-white/40",
        placeholderRing: "border-black/15",
      };

  return (
    <div className={`min-h-screen ${isDark ? "dark" : ""} ${t.bg}`}>
      <Helmet>
        <title>You're Invited — RestyleProAI™ Founder Invitation for WPW Customers</title>
        <meta
          name="description"
          content="A personal invitation from Trish Dill to past WePrintWraps customers. Your ShopEngine Dashboard, your first custom wrap design, and $50 off your RestyleProAI membership."
        />
      </Helmet>

      <main className="flex-1">
        {/* ── Founder ribbon ── */}
        <div className={t.ribbon}>
          <div className="container mx-auto px-4 py-3 text-center">
            <p className={`text-[11px] sm:text-xs font-semibold tracking-[0.2em] uppercase ${t.ribbonText}`}>
              <Mail className={`w-3.5 h-3.5 inline mr-2 -mt-0.5 ${t.ribbonIcon}`} />
              An Invitation for Past WePrintWraps Customers
            </p>
          </div>
        </div>

        {/* ── Cinematic hero ── */}
        <section className="relative overflow-hidden">
          {/* Atmospheric gradient — extremely subtle, never neon */}
          {/* Atmospheric background gradients removed -- pure clean canvas */}

          <div className="container relative mx-auto px-4 sm:px-6 py-6 sm:py-12 lg:py-24">
            <div className="grid lg:grid-cols-12 gap-10 lg:gap-12 items-center">
              {/* ── Left: copy ── */}
              {/* On mobile we render the video FIRST (order-1 below) so the
                  founder reel sits above the fold. On desktop the copy sits
                  on the left as the lg:col-span-5 grid item. */}
              <div className="lg:col-span-5 lg:pr-4 order-2 lg:order-1">
                {/* Eyebrow — pure typography, no pill / no gradient */}
                <div className="flex items-center gap-3 mb-7">
                  <span
                    aria-hidden
                    className={`block w-8 h-px ${isDark ? "bg-white/40" : "bg-black/40"}`}
                  />
                  <span
                    className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.32em] ${
                      isDark ? "text-white/65" : "text-black/65"
                    }`}
                  >
                    An Invitation for Past WePrintWraps Customers
                  </span>
                </div>

                <h1
                  className={`font-montserrat text-4xl sm:text-5xl lg:text-[3.75rem] font-bold leading-[1.04] tracking-tight mb-6 ${t.headline}`}
                >
                  The Future of Vehicle Wrap Design{" "}
                  <span className="text-black dark:text-white">
                    Starts Here.
                  </span>
                </h1>

                <p className={`font-montserrat text-lg sm:text-xl font-semibold ${t.headline} mb-3`}>
                  Hey there — Trish here from WePrintWraps.
                </p>
                <p className={`text-base sm:text-lg leading-relaxed ${t.body} mb-5 max-w-xl`}>
                  For years, I watched wrap shops struggle with design delays,
                  customer approvals, revisions, and disconnected systems.
                </p>
                <p className={`text-base sm:text-lg leading-relaxed ${t.body} mb-7 max-w-xl`}>
                  So I built{" "}
                  <span className="font-bold text-black dark:text-white">
                    RestyleProAI™
                  </span>{" "}
                  — a powerful new design and visualization platform created
                  to fundamentally change how vehicle wraps are designed,
                  sold, and brought to life.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 mb-6">
                  <Button asChild size="lg" className={`px-7 text-base font-bold ${t.ctaPrimary}`}>
                    <Link to="/signup?ref=wpw-founder">
                      Claim Your Dashboard
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Link>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className={t.ctaOutline}
                  >
                    <Link to="/pricing">See Membership Plans</Link>
                  </Button>
                </div>
              </div>

              {/* ── Right: founder video as the centerpiece + asymmetric floating glimpses ── */}
              {/* order-1 on mobile pulls the video above the copy so it
                  lands above the fold; on desktop it stays in column 7. */}
              <div className="lg:col-span-7 relative order-1 lg:order-2">
                {/* Backdrop halo removed -- pure clean canvas */}

                <div className="relative mx-auto max-w-[460px] lg:max-w-[480px]">
                  {/* The 9:16 founder video — primary focal point */}
                  <div
                    className={`relative aspect-[9/16] rounded-[28px] overflow-hidden border ${t.videoFrameBorder} ${t.videoFrameBg} ${t.cardShadow}`}
                  >
                    {/* Gradient ring removed -- pure clean canvas */}
                    {founderVideoUrl ? (
                      <FounderVideoPlayer
                        url={founderVideoUrl}
                        poster={founderVideoPoster}
                        embedUrl={getEmbedUrl(founderVideoUrl)}
                      />
                    ) : (
                      <div
                        className={`relative z-10 w-full h-full flex flex-col items-center justify-center text-center px-6 border-2 border-dashed ${t.placeholderRing} rounded-[28px]`}
                      >
                        <div className={`w-16 h-16 rounded-full ${t.placeholderBg} flex items-center justify-center mb-4`}>
                          <Play className={`w-7 h-7 fill-current ml-0.5 ${t.placeholderIcon}`} />
                        </div>
                        <div className={`font-montserrat font-bold text-base mb-1 ${t.placeholderText}`}>
                          Founder video
                        </div>
                        <div className={`text-[11px] leading-snug ${t.placeholderHint}`}>
                          9:16 reels-size video goes here
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Floating glimpse #1: photoreal vehicle render (top-left) ── */}
                  <div
                    className="hidden md:block absolute -left-16 lg:-left-24 top-12 w-[230px] aspect-[16/10] rounded-[18px] overflow-hidden border backdrop-blur-md transition-transform"
                  >
                    <FloatingCard
                      src={heroPhotoreal}
                      label="Photoreal Render"
                      isDark={isDark}
                      t={t}
                    />
                  </div>

                  {/* ── Floating glimpse #2: production proof UI (bottom-right) ── */}
                  <div
                    className="hidden md:block absolute -right-12 lg:-right-20 bottom-16 w-[220px] aspect-[4/3] rounded-[18px] overflow-hidden border backdrop-blur-md transition-transform"
                  >
                    <FloatingCard
                      src={heroProofUi}
                      label="Production Proof"
                      isDark={isDark}
                      t={t}
                    />
                  </div>

                  {/* ── Floating glimpse #3: dashboard crop (bottom-left, smaller) ── */}
                  <div
                    className="hidden lg:block absolute -left-10 bottom-4 w-[170px] aspect-[5/4] rounded-[16px] overflow-hidden border backdrop-blur-md transition-transform"
                  >
                    <FloatingCard
                      src={heroDashboard}
                      label="DesignProAI™"
                      isDark={isDark}
                      t={t}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Industry problems ── */}
        <section className="pb-12 sm:pb-16">
          <div className="container mx-auto px-4">
            <div className="max-w-2xl mx-auto">
              <ul className="space-y-3">
                {INDUSTRY_PROBLEMS.map((problem) => (
                  <li
                    key={problem}
                    className="flex items-start gap-3 text-base sm:text-lg text-black/80 dark:text-white/75 leading-snug"
                  >
                    <span className="block w-1.5 h-1.5 rounded-full bg-black dark:bg-white mt-2.5 shrink-0" />
                    <span>{problem}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-10 text-base sm:text-lg text-black/75 dark:text-white/70 leading-relaxed">
                So for the last year, I've been building something to help
                fundamentally change that.
              </p>
            </div>
          </div>
        </section>

        {/* ── Introducing RestyleProAI ── */}
        <section className="py-20 sm:py-24 border-t border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-[#111114]">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/50 dark:text-white/45 mb-5">
                Introducing
              </div>
              <h2 className="font-montserrat text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-7">
                <span className="text-black dark:text-white">
                  RestyleProAI™
                </span>
              </h2>
              <p className="text-lg text-black/80 dark:text-white/75 leading-relaxed mb-5">
                A revenue-generating design and visualization system built
                specifically for wrap shops, sign companies, and restyle
                businesses looking to{" "}
                <span className="text-black dark:text-white font-semibold">
                  10X their design capabilities
                </span>
                , customer visuals, and workflow.
              </p>
              <p className="text-base text-black/65 dark:text-white/60 leading-relaxed">
                Whether you're a solo operator or a high-volume graphics
                company, RestyleProAI™ gives you the ability to create
                premium-level visuals faster than ever before.
              </p>
            </div>
          </div>
        </section>

        {/* ── Create / For grid ── */}
        <section className="py-20 border-t border-black/10 dark:border-white/10">
          <div className="container mx-auto px-4">
            <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-5">
              <div className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03] p-7 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/50 dark:text-white/45 mb-5">
                  Create
                </div>
                <ul className="space-y-3">
                  {CREATE_LIST.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2.5 text-sm sm:text-base text-black/85 dark:text-white/85 leading-snug"
                    >
                      <CheckCircle2 className="w-4 h-4 text-black dark:text-white shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03] p-7 sm:p-8 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/50 dark:text-white/45 mb-5">
                  For
                </div>
                <ul className="space-y-3">
                  {FOR_LIST.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2.5 text-sm sm:text-base text-black/85 dark:text-white/85 leading-snug"
                    >
                      <CheckCircle2 className="w-4 h-4 text-black dark:text-white shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 pt-5 border-t border-black/10 dark:border-white/10 text-sm text-black/55 dark:text-white/50 italic">
                  — all from one connected system.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Tool-by-tool explainer (image + copy, alternating) ── */}
        <section className="py-20 sm:py-24 border-t border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-[#111114]">
          <div className="container mx-auto px-4">
            <div className="max-w-3xl mx-auto text-center mb-16 sm:mb-20">
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/50 dark:text-white/45 mb-4">
                What's inside
              </div>
              <h2 className="font-montserrat text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-black mb-4">
                Your{" "}
                <span className="text-black dark:text-white">
                  ShopEngine™
                </span>{" "}
                Dashboard Includes:
              </h2>
              <p className="text-base text-black/65 dark:text-white/60 max-w-2xl mx-auto leading-relaxed">
                Customer visualization and sales tools, all in one connected
                system.
              </p>
            </div>

            <div className="max-w-5xl mx-auto space-y-20 sm:space-y-24">
              {TOOL_EXPLAINERS.map((tool, i) => {
                const reverse = i % 2 === 1;
                return (
                  <div
                    key={tool.key}
                    className={`grid md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] gap-8 sm:gap-12 items-center ${
                      reverse
                        ? "md:[&>*:first-child]:order-2 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)]"
                        : ""
                    }`}
                  >
                    <div className="w-full max-w-[300px] mx-auto">
                      <MediaSlot
                        src={assets[`tool-${tool.key}`] || ""}
                        alt={`${tool.name}™`}
                        placeholderHint="9:16 image or video goes here"
                      />
                    </div>
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/45 dark:text-white/40 mb-3">
                        {String(i + 1).padStart(2, "0")} · ShopEngine Tool
                      </div>
                      <h3 className="font-montserrat text-3xl sm:text-4xl font-bold tracking-tight mb-3">
                        <span className="text-black dark:text-white">
                          {tool.name}
                        </span>
                        <span className="text-black/80 dark:text-white/75">™</span>
                      </h3>
                      <p className="text-base sm:text-lg font-semibold text-black mb-3 leading-snug">
                        {tool.tagline}
                      </p>
                      <p className="text-sm sm:text-base text-black/65 dark:text-white/60 leading-relaxed">
                        {tool.body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Exclusive Invitation ── */}
        <section className="py-20 sm:py-24 border-t border-black/10 dark:border-white/10">
          <div className="container mx-auto px-4">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-12">
                <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/50 dark:text-white/45 mb-4">
                  Exclusive Invitation
                </div>
                <h2 className="font-montserrat text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-4 text-black dark:text-white">
                  As part of this invitation, receive{" "}
                  <span className="text-black dark:text-white">
                    $50 OFF
                  </span>{" "}
                  your membership.
                </h2>
              </div>

              <div className="grid sm:grid-cols-3 gap-4 mb-10">
                <div className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03] p-7 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-black/45 dark:text-white/40 mb-3">
                    Included
                  </div>
                  <div className="font-montserrat text-xl font-bold mb-2 text-black dark:text-white">
                    ShopEngine™ Dashboard
                  </div>
                  <p className="text-xs text-black/55 dark:text-white/50 leading-snug">
                    The full toolkit above, on us.
                  </p>
                </div>

                <div className="rounded-2xl border-2 border-black dark:border-white shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
                  <div className="rounded-[15px] bg-white dark:bg-black p-7 text-center h-full">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] mb-3 text-black dark:text-white">
                      Complimentary
                    </div>
                    <div className="font-montserrat text-xl font-bold mb-2 text-black dark:text-white">
                      One Custom Wrap Design
                    </div>
                    <p className="text-xs text-black/55 dark:text-white/50 leading-snug">
                      Your first design — on the house.
                    </p>
                  </div>
                </div>

                <div className="rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03] p-7 text-center shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-black/45 dark:text-white/40 mb-3">
                    Membership
                  </div>
                  <div className="font-montserrat text-xl font-bold mb-2 text-black dark:text-white">
                    $50 Off Your Plan
                  </div>
                  <p className="text-xs text-black/55 dark:text-white/50 leading-snug">
                    Applied if you decide to continue.
                  </p>
                </div>
              </div>

              {/* Membership tier ladder — mirrors /pricing exactly */}
              <div className="mb-10 pb-10 border-b border-black/10 dark:border-white/10">
                <div className="text-center mb-6">
                  <h3 className="font-montserrat text-2xl sm:text-3xl font-bold mb-2 text-black dark:text-white">
                    Pick your plan.
                  </h3>
                  <p className="text-sm sm:text-base text-black/65 dark:text-white/60 max-w-xl mx-auto leading-relaxed">
                    Four standalone plans, each built for a specific shop size.
                    Cancel anytime. Render quota shared across every tool.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {[
                    {
                      name: "DesignPro",
                      highlight: "Starter",
                      price: "$350",
                      bestFor:
                        "Built for solo operators, mobile installers, and smaller wrap shops looking to level up customer visuals and design capabilities.",
                      bullets: [
                        "DesignProAI™ — custom vehicle wrap designs faster",
                        "ColorPro™ — manufacturer wrap film visualizer",
                        "GraphicsPro™ — cut contour graphics for vehicles, walls & flat surfaces",
                        "PatternPro™ — wrap-by-the-yard visualizer & PatternLibrary™",
                        "RestyleLibrary™ — visual inspiration & design assets",
                        "QuickQuote™ — design and quote at the same time",
                        "RevisionStudioIQ™ — revise and refine designs",
                        "ProductionFlow™ — proof-to-print workflow",
                        "ShopEngine™ Dashboard",
                        "50 renders / month combined usage",
                        "Customer visualization tools",
                        "Past WPW order access & reorder tools",
                        "WPW pricing integrated into quoting",
                        "ProductionPacks™ available from $299",
                      ],
                      featured: false,
                      special: false,
                    },
                    {
                      name: "DesignPro",
                      highlight: "Lite",
                      price: "$499",
                      bestFor:
                        "Built for wrap shops doing customer demos and vehicle visualizations in real time.",
                      bullets: [
                        "Everything in Starter, plus:",
                        "MyVehiclePro™ — wraps on customer's actual vehicle photo",
                        "Sales-floor visualization tools",
                        "Real customer mockup workflow",
                        "Enhanced proofing & presentation workflow",
                        "Faster customer approvals",
                        "Stronger close rates through visualization",
                        "Higher render usage limits",
                        "ProductionPacks™ available from $299",
                      ],
                      featured: true,
                      special: false,
                    },
                    {
                      name: "DesignPro",
                      highlight: "Studio",
                      price: "$699",
                      bestFor:
                        "Built for growing wrap shops ready for production-level design support.",
                      bullets: [
                        "Everything in Lite, plus:",
                        "Real human designer support",
                        "48-hour turnaround production support",
                        "Human-assisted design refinement",
                        "RecreatePro™ — rebuild low-res artwork into production-ready files",
                        "Priority design workflow",
                        "Advanced production support",
                        "Faster revision workflow",
                        "Higher rendering & project capacity",
                        "ProductionPacks™ finalized by a human design team",
                      ],
                      featured: false,
                      special: false,
                    },
                    {
                      name: "DesignPro",
                      highlight: "Plus",
                      price: "$995",
                      bestFor:
                        "Built for high-volume wrap shops, sign companies, and enterprise-level graphics operations.",
                      bullets: [
                        "Everything in Studio, plus:",
                        "Priority 24-hour workflow queue",
                        "Highest rendering limits",
                        "Enterprise-level project handling",
                        "Priority support & production routing",
                        "Advanced workflow management",
                        "Premium CreatorMarket™ access",
                        "Large-scale commercial & fleet workflow support",
                        "Multi-user operational scaling",
                        "Full production ecosystem access",
                        "Highest-level production priority",
                        "ProductionPacks™ finalized by human production team",
                      ],
                      featured: false,
                      special: true,
                    },
                  ].map((tier) => (
                    <div
                      key={tier.name + (tier.highlight ?? "")}
                      className={`relative rounded-2xl p-5 flex flex-col text-left bg-white dark:bg-white/[0.04] ${
                        tier.special
                          ? "border-2 border-fuchsia-500/60 shadow-[0_0_28px_-12px_rgba(217,70,239,0.55)]"
                          : tier.featured
                          ? "border-2 border-fuchsia-500/40 shadow-[0_0_24px_-12px_rgba(217,70,239,0.35)]"
                          : "border border-black/10 dark:border-white/10"
                      }`}
                    >
                      {tier.featured && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center text-[9px] font-bold uppercase tracking-[0.18em] px-2.5 py-1 rounded-full text-white bg-black dark:bg-white dark:text-black whitespace-nowrap">
                          Most popular
                        </span>
                      )}
                      {tier.special && (
                        <span className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center text-[9px] font-bold uppercase tracking-[0.18em] px-2.5 py-1 rounded-full text-white bg-black dark:bg-white dark:text-black whitespace-nowrap">
                          Unlimited
                        </span>
                      )}

                      <h4 className="font-montserrat text-2xl font-bold leading-none tracking-tight mb-2">
                        <span className="text-black dark:text-white">{tier.name}</span>
                        {tier.highlight && (
                          <span className="text-black dark:text-white">
                            {tier.highlight}
                          </span>
                        )}
                      </h4>

                      <div className="flex items-baseline gap-1 mb-3 pb-3 border-b border-black/10 dark:border-white/10">
                        <span className="font-montserrat text-3xl font-bold text-black dark:text-white tracking-tight">
                          {tier.price}
                        </span>
                        <span className="text-xs text-black/55 dark:text-white/50">/mo</span>
                      </div>

                      <p className="text-xs text-black/65 dark:text-white/60 leading-relaxed mb-4 min-h-[60px]">
                        {tier.bestFor}
                      </p>

                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-black/55 dark:text-white/45 mb-2">
                        Included
                      </div>

                      <ul className="flex-1 flex flex-col gap-1.5 mb-2">
                        {tier.bullets.map((b, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-xs text-black/75 dark:text-white/70 leading-snug"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-black/70 dark:text-white/65 shrink-0 mt-0.5" />
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                <p className="text-center text-xs text-black/50 dark:text-white/45 mt-5">
                  WPW founder invitation: $50 off your first month on any plan.
                  See full details at <Link to="/pricing" className="underline">/pricing</Link>.
                </p>
              </div>

              {/* ProductionPacks */}
              <div className="mb-10">
                <div className="text-center mb-6">
                  <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-black/45 dark:text-white/45 mb-2">
                    À la carte
                  </div>
                  <h3 className="font-montserrat text-2xl sm:text-3xl font-bold mb-2">
                    <span className="text-black dark:text-white">
                      ProductionPacks™
                    </span>
                  </h3>
                  <p className="text-sm sm:text-base text-black/70 dark:text-white/70">
                    From{" "}
                    <span className="text-black dark:text-white font-semibold">$299</span>{" "}
                    — finalize your project into production-ready output.
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-2.5 max-w-2xl mx-auto">
                  {[
                    "Print-ready production files",
                    "Human design team output review",
                    "File ownership included",
                    "Stored in your personal WrapBox™",
                    "Production-ready layout setup",
                    "Customer-ready proofing workflow",
                    "Built for real-world printing & installation",
                  ].map((perk) => (
                    <div
                      key={perk}
                      className="flex items-start gap-2 text-xs sm:text-sm text-black/75 dark:text-white/70 leading-snug"
                    >
                      <CheckCircle2 className="w-4 h-4 text-black dark:text-white shrink-0 mt-0.5" />
                      <span>{perk}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  asChild
                  size="lg"
                  className="bg-gradient-to-r from-blue-600 to-fuchsia-600 hover:opacity-90 text-white px-7 text-base font-bold"
                >
                  <Link to="/signup?ref=wpw-founder">
                    Claim Your Dashboard
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="border-black/15 text-black hover:bg-black/5 dark:border-white/20 dark:text-white dark:hover:bg-white/5"
                >
                  <Link to="/pricing">
                    See Membership Plans
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* ── Sign-off ── */}
        <section className="py-24 border-t border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-[#111114]">
          <div className="container mx-auto px-4">
            <div className="max-w-2xl mx-auto text-center">
              <p className="font-montserrat text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight mb-10 text-black dark:text-white">
                This is just{" "}
                <span className="text-black dark:text-white">
                  the beginning.
                </span>
              </p>

              <div className="mb-12">
                <p className="font-montserrat text-base font-bold text-black mb-1">
                  Trish Dill
                </p>
                <p className="text-sm text-black/55 dark:text-white/50">
                  Founder, WePrintWraps™ &amp; RestyleProAI™
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button
                  asChild
                  size="lg"
                  className="bg-gradient-to-r from-blue-600 to-fuchsia-600 hover:opacity-90 text-white px-7 text-base font-bold"
                >
                  <Link to="/signup?ref=wpw-founder">
                    Claim Your Dashboard
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="border-black/15 text-black hover:bg-black/5 dark:border-white/20 dark:text-white dark:hover:bg-white/5"
                >
                  <Link to="/gallery">Browse Gallery</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default FromWePrintWraps;
