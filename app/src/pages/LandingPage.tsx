import { useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ArrowRight, CheckCircle2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLandingHeroRenders } from "@/hooks/useLandingHeroRenders";

/**
 * /landing — public, no auth.
 *
 * The "You're Invited" page linked from the WePrintWraps.com header.
 * Long-form invitation with hero, capabilities lists, ShopEngine
 * dashboard checklist, single membership price ($399/mo, $50 off
 * with WPW invite -> $349), ProductionPacks $299, and a single
 * "Claim Your Dashboard" CTA.
 *
 * Palette matches /pricing exactly: black bg, blue-500 -> fuchsia-500
 * gradient accents, [#1c1c1e] cards with [#48484a] borders, montserrat
 * for headlines, gradient-rp-pop for the primary CTA.
 */

const HERO_VIEWS = [
  {
    src: "/landing-hero/colorpro.png",
    fallbackSrc: "/colorpro-hero-corvette.png",
    label: "ColorPro™",
  },
  {
    src: "/landing-hero/designpro.png",
    fallbackSrc: "/screenshots/porsche-distressed-hero.png",
    label: "DesignProAI™",
  },
  {
    src: "/landing-hero/myvehiclepro.png",
    fallbackSrc: "/screenshots/designproai-system.png",
    label: "MyVehiclePro™",
  },
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

const DASHBOARD_FEATURES = [
  { name: "DesignProAI™",         body: "Full custom wrap design tools" },
  { name: "WallPro™",             body: "Wall wrap & environmental graphic tools" },
  { name: "GraphicsPro™",         body: "Cut contour graphics for vehicles, windows, walls & flat surfaces" },
  { name: "MyVehiclePro™",        body: "Show designs on customer vehicle photos" },
  { name: "ColorPro™",            body: "Visualize real manufacturer wrap films" },
  { name: "QuickQuote™",          body: "Design and quote at the same time" },
  { name: "RevisionStudioIQ™",    body: "Manage revisions & proofs" },
  { name: "ProductionFlow™",      body: "From proof to print workflow" },
  { name: "Customer visualization & sales tools", body: "" },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { data: liveHero } = useLandingHeroRenders();
  const heroViews = HERO_VIEWS.map((view, i) => {
    const live = liveHero?.[i];
    if (!live?.src) return view;
    return { ...view, src: live.src };
  });

  const claimDashboard = () => navigate("/signup?promo=wpw50");

  return (
    <div className="min-h-screen bg-black text-white">
      <Helmet>
        <title>You're Invited · The Future of Vehicle Wrap Design | RestyleProAI</title>
        <meta
          name="description"
          content="RestyleProAI was built to help wrap shops, sign companies, and restyle shops 10X their design capabilities, customer visuals, and sales workflow. WePrintWraps customers receive $50 off membership."
        />
      </Helmet>

      <div className="w-full max-w-[1200px] mx-auto px-4 sm:px-6 py-12 sm:py-16">
        {/* ── Hero ── */}
        <section className="text-center mb-14 sm:mb-16">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/60 mb-3">
            RestyleProAI™ for WePrintWraps
          </div>
          <h1 className="font-montserrat text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight mb-6">
            You're Invited to the{" "}
            <span className="bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
              Future of Vehicle Wrap Design
            </span>
          </h1>
          <p className="text-base sm:text-lg text-white/80 leading-relaxed max-w-3xl mx-auto mb-4">
            RestyleProAI™ was built to help wrap shops, sign companies, and restyle shops{" "}
            <strong className="text-white">10X</strong> their design capabilities, customer visuals, and sales workflow.
          </p>
          <p className="text-sm sm:text-base text-white/70 leading-relaxed max-w-3xl mx-auto">
            Whether you're a solo operator or a high-volume graphics company, RestyleProAI™ gives you the power to create premium-level visuals faster than ever before.
          </p>
        </section>

        {/* ── 3 image row ── */}
        <div className="grid grid-cols-3 gap-3 sm:gap-5 mb-14 sm:mb-16">
          {heroViews.map((view, i) => (
            <ImageTile key={i} view={view} />
          ))}
        </div>

        {/* ── Create / for lists ── */}
        <section className="mb-14 sm:mb-16">
          <div className="rounded-2xl border border-[#48484a] bg-[#1c1c1e] p-6 sm:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h3 className="font-montserrat text-xs sm:text-sm font-bold uppercase tracking-[0.2em] text-white/60 mb-4">
                  Create
                </h3>
                <ul className="space-y-2.5">
                  {CREATE_LIST.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2.5 text-sm sm:text-[15px] text-white/85 leading-snug"
                    >
                      <Check className="w-4 h-4 text-[#60A5FA] shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-montserrat text-xs sm:text-sm font-bold uppercase tracking-[0.2em] text-white/60 mb-4">
                  For
                </h3>
                <ul className="space-y-2.5">
                  {FOR_LIST.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2.5 text-sm sm:text-[15px] text-white/85 leading-snug"
                    >
                      <Check className="w-4 h-4 text-[#60A5FA] shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="text-center text-sm text-white/60 italic mt-6 pt-4 border-t border-[#48484a]">
              — all from one connected system.
            </p>
          </div>
        </section>

        {/* ── ShopEngine dashboard checklist ── */}
        <section className="mb-14 sm:mb-16">
          <h2 className="font-montserrat text-2xl sm:text-3xl font-bold text-center mb-8 leading-tight tracking-tight">
            Your{" "}
            <span className="bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
              ShopEngine™
            </span>{" "}
            Dashboard Includes
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {DASHBOARD_FEATURES.map((f) => (
              <div
                key={f.name}
                className="flex items-start gap-3 rounded-xl border border-[#48484a] bg-[#1c1c1e] px-4 py-3"
              >
                <CheckCircle2 className="w-5 h-5 text-[#60A5FA] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-montserrat text-sm font-bold text-white leading-tight">
                    {f.name}
                  </div>
                  {f.body && (
                    <div className="text-xs text-white/65 leading-snug mt-0.5">
                      {f.body}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Membership pricing ── */}
        <section className="mb-14 sm:mb-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* DesignPro Membership */}
            <div className="rounded-2xl border border-fuchsia-500/50 bg-[#1c1c1e] p-6 sm:p-8 shadow-[0_0_24px_rgba(217,70,239,0.14)]">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 mb-2">
                DesignPro™ Memberships
              </div>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-xs uppercase tracking-wider text-white/55">Starting at</span>
                <span className="font-montserrat text-4xl sm:text-5xl font-bold text-white tracking-tight leading-none">
                  $399
                </span>
                <span className="text-sm text-white/55 font-inter">/mo</span>
              </div>
              <p className="text-sm text-white/80 leading-relaxed">
                Create custom wrap designs inside RestyleProAI™ with access to the full design and visualization system.
              </p>
            </div>

            {/* ProductionPacks */}
            <div className="rounded-2xl border border-[#48484a] bg-[#1c1c1e] p-6 sm:p-8">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/60 mb-2">
                ProductionPacks™
              </div>
              <p className="text-sm text-white/80 leading-relaxed mb-3">
                Need finalized production-ready output?
              </p>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-xs uppercase tracking-wider text-white/55">Only</span>
                <span className="font-montserrat text-4xl sm:text-5xl font-bold text-white tracking-tight leading-none">
                  $299
                </span>
              </div>
              <p className="text-sm text-white/80 leading-relaxed mb-4">
                Finalized by a human design team.
              </p>
              <ul className="space-y-1.5">
                {[
                  "Print-ready production files",
                  "File ownership included",
                  "Stored inside your personal WrapBox™ library",
                ].map((b) => (
                  <li key={b} className="flex items-start gap-2 text-xs text-white/75">
                    <Check className="w-3.5 h-3.5 text-[#60A5FA] shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Exclusive invitation + CTA ── */}
        <section className="text-center">
          <div className="rounded-2xl border border-[#48484a] bg-[#1c1c1e] p-8 sm:p-10">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/60 mb-4">
              Exclusive Invitation
            </div>
            <h2 className="font-montserrat text-2xl sm:text-3xl md:text-4xl font-bold leading-tight tracking-tight mb-2 max-w-2xl mx-auto">
              As part of this invitation, receive{" "}
              <span className="bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
                $50 OFF
              </span>{" "}
              your membership.
            </h2>
            <button
              onClick={claimDashboard}
              className="mt-7 inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-bold text-sm sm:text-base font-montserrat uppercase tracking-[0.08em] text-white bg-gradient-to-r from-blue-500 to-fuchsia-500 hover:brightness-110 shadow-[0_12px_36px_rgba(217,70,239,0.3)] transition"
            >
              Claim Your Dashboard
              <ArrowRight className="w-4 h-4" />
            </button>
            <div className="mt-5">
              <button
                onClick={() => navigate("/pricing")}
                className="text-xs text-white/50 hover:text-white/85 transition"
              >
                See full plan details + add-ons →
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ImageTile({ view }: { view: typeof HERO_VIEWS[number] }) {
  const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.src.endsWith(view.fallbackSrc)) return;
    img.src = view.fallbackSrc;
  };
  return (
    <div className="rounded-2xl overflow-hidden border border-[#48484a] bg-[#1c1c1e] aspect-[16/10] relative">
      <img
        src={view.src}
        alt={view.label}
        onError={handleError}
        className="absolute inset-0 w-full h-full object-contain"
        loading="lazy"
      />
      <div className="absolute inset-x-0 bottom-0 px-3 py-2 bg-gradient-to-t from-black/85 via-black/35 to-transparent">
        <div className="text-[11px] sm:text-xs font-bold font-montserrat text-white tracking-tight">
          {view.label}
        </div>
      </div>
    </div>
  );
}
