import { Card } from "@/components/ui/card";
import { Loader2, Lightbulb, Check, Sparkles, Star, TrendingUp, ShoppingBag, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

interface GenerationWizardProps {
  elapsedSeconds: number;
  tips: string[];
  currentTipIndex: number;
  toolName?: string;
  gradientFrom?: string;
  gradientTo?: string;
  /** For multi-view tools like ApproveMode */
  multiView?: { current: number; total: number };
  /** Override progress steps */
  steps?: Array<{ label: string; completed: boolean }>;
  /** Expected total seconds for progress bar (default 45) */
  expectedDuration?: number;
  /** Self-contained mode: component manages its own timer. Pass isGenerating instead of elapsedSeconds. */
  isGenerating?: boolean;
  /** Enable DesignIQ showcase mode with typewriter expectations + system facts */
  designIQShowcase?: boolean;
  /** Enable ColorPro showcase mode with Sproket astronaut + film facts */
  colorProShowcase?: boolean;
  /** Starred render image URLs for showcase backgrounds */
  starredImageUrls?: string[];
}

// ─── SPROKET INSTALL FACTS (rotate during generation) ─────────────────
const SPROKET_POSES = [
  "/sprocket/sprocket-painter.png",
  "/sprocket/sprocket-clipboard.png",
  "/sprocket/sprocket-camera.png",
  "/sprocket/sprocket-rocket.png",
  "/sprocket/sprocket-beam.png",
  "/sprocket/sprocket-telescope.png",
  "/sprocket/sprocket-wave.png",
  "/sprocket/sprocket-desk.png",
];

const INSTALL_FACTS = [
  "Clean the surface with IPA before applying vinyl — oils cause lifting.",
  "Use a heat gun at 180°F to stretch vinyl around curves and recesses.",
  "Post-heat every edge and channel at 200°F+ for long-term adhesion.",
  "Always squeegee from center outward to push air bubbles to the edge.",
  "Knifeless tape saves paint — never cut directly on the vehicle surface.",
  "Let fresh wraps cure 24 hours before washing or driving in rain.",
  "Cold weather installs? Warm the vehicle AND the vinyl to 70°F+ first.",
  "Overlap seams by 3-5mm on printed wraps for seamless panel transitions.",
  "Use a clay bar before wrapping — contaminants cause adhesion failures.",
  "Tuck edges into channels with a micro squeegee — fingers leave marks.",
  "Matte and satin finishes show fingerprints — wear nitrile gloves.",
  "Door jambs first, then panels — install sequence matters for clean edges.",
  "Print at 150 DPI minimum for large format vehicle wraps.",
  "Laminate all printed wraps — UV laminate adds 2-3 years of life.",
  "Measure twice, cut once — template your panels before printing.",
  "Avoid wrapping in direct sunlight — adhesive activates too fast.",
];

// ─── DESIGNIQ SHOWCASE: Typewriter sequence ───────────────────────────
// Phases timed to render duration (~30-60s). Each phase auto-advances.

export interface ShowcaseSlide {
  category?: "amazing" | "meh" | "miss" | "system" | "equity";
  headline: string;
  body: string;
  stars?: number;
  /** Show a starred render image as full-bleed background */
  showImage?: boolean;
  /** SPROKET pose image to show next to the text */
  sproketImage?: string;
}

// PRE-RENDER slides — shown in DesignIQExpectations before generation starts
export const PRE_RENDER_SLIDES: ShowcaseSlide[] = [
  {
    category: "system",
    headline: "Like hiring a real designer.",
    body: "A real designer studies your brief, picks colors, builds compositions, and presents options. ACE does the same - in seconds, not days.",
    sproketImage: "/sprocket/sprocket-desk.png",
  },
  {
    category: "system",
    headline: "DesignIQ\u2122 Render Engine",
    body: "Proprietary render engine. Photorealistic output, material-accurate vinyl textures, real lighting physics.",
    sproketImage: "/sprocket/sprocket-painter.png",
  },
  {
    category: "equity",
    headline: "DesignVault - Your Design Equity",
    body: "Every design ACE creates is stamped with your DesignID and stored in your vault. That's YOUR IP. Re-render, sell, or license anytime.",
    sproketImage: "/characters/sproket/sproket-vault-cash.png",
  },
  {
    category: "system",
    headline: "The ONLY one in the world.",
    body: "There is no other photorealistic custom vehicle wrap design software. ACE is the first and only AI wrap designer that goes from prompt to production.",
    sproketImage: "/characters/sproket/sproket-ace-flags.png",
  },
  {
    category: "equity",
    headline: "Sell on CreatorMarket - 60/40",
    body: "Love what ACE made? List it. Other wrap shops buy your designs. You keep 60% of every sale; the 40% platform cut funds Google + Meta ads that drive paid traffic to your listing. Turn renders into recurring revenue.",
    sproketImage: "/characters/sproket/sproket-boombox.png",
  },
];

// DURING-RENDER slides — shown in GenerationWizard while generating
const SHOWCASE_SLIDES: ShowcaseSlide[] = [
  {
    headline: "ACE is designing your wrap.",
    body: "Sit back. ACE is powered by DesignIQ - the only photorealistic custom wrap design engine in the world. Sprocket is your system guide.",
    showImage: true,
    sproketImage: "/characters/ace-desk-branded.png",
  },
  {
    category: "amazing",
    headline: "THE AMAZING",
    body: "Photorealistic wraps that look ready to print. Custom designs no human could draft this fast. ACE designs like a real pro.",
    stars: 5,
    showImage: true,
    sproketImage: "/characters/sproket/sproket-loves-it.png",
  },
  {
    category: "system",
    headline: "GENIE Prompt Helper",
    body: "Type a rough idea, and GENIE elevates it into a detailed creative brief. Like having a senior designer translate your vision into precise design direction.",
    sproketImage: "/characters/sproket/sproket-tips.png",
  },
  {
    category: "system",
    headline: "7 camera angles. 7 fresh takes.",
    body: "A real designer presents options from different perspectives. ACE gives you 7 creative interpretations - each angle is a new take on your concept.",
    sproketImage: "/characters/sproket/sproket-camera.png",
  },
  {
    category: "system",
    headline: "RevisionStudio",
    body: "Like giving notes to your designer. 'Love the side, redo the hood.' Your hero stays locked - only the angle you pick gets refreshed.",
    sproketImage: "/characters/sproket/sproket-revision.png",
  },
  {
    category: "system",
    headline: "ProductionFlow\u2122 \u2192 WrapBox",
    body: "Order a Production Pack and it lands in your WrapBox - print-ready panels, cut files, and install specs. Ready for the printer.",
    sproketImage: "/characters/sproket/sproket-announce.png",
  },
  {
    category: "equity",
    headline: "DesignVault\u2122 - Your Design Equity",
    body: "Every Production Pack gets QC\u2019d by a real human designer, stamped with your DesignID, and stored in your DesignVault. That\u2019s YOUR IP. Your equity.",
    sproketImage: "/characters/sproket/sproket-vault-cash.png",
  },
  {
    category: "equity",
    headline: "You\u2019re building DesignEquity.",
    body: "Every render you create, every revision you dial in - that\u2019s your design portfolio. Re-render it anytime. Sell it. License it. It\u2019s yours.",
    sproketImage: "/characters/sproket/sproket-starred.png",
  },
  {
    category: "system",
    headline: "Rate every render \u2605\u2605\u2605\u2605\u2605",
    body: "Your star ratings help ACE learn what great looks like. Real designers learn from feedback - so does ACE.",
    sproketImage: "/characters/sproket/sproket-rating.png",
  },
];

// ─── COLORPRO SHOWCASE: Film facts with Sproket astronaut ────────────
const COLORPRO_SHOWCASE_SLIDES: ShowcaseSlide[] = [
  {
    category: "system",
    headline: "Color Change Film 101",
    body: "Premium cast vinyl films from 3M, Avery, and others are engineered at the molecular level. Cast films conform to complex curves without lifting or shrinking.",
    sproketImage: "/characters/sproket/sproket-rocket-wave.png",
  },
  {
    category: "system",
    headline: "Why Cast > Calendered",
    body: "Cast vinyl is made by pouring liquid PVC onto a casting sheet — no stretching. This means zero memory, so it won't shrink back on curves and recesses.",
    sproketImage: "/characters/sproket/sproket-tips.png",
  },
  {
    category: "amazing",
    headline: "5-7 Year Durability",
    body: "Premium color change films last 5-7 years on vertical surfaces. Horizontal surfaces like hoods and roofs see more UV, so expect 3-5 years there.",
    sproketImage: "/characters/sproket/sproket-starred.png",
  },
  {
    category: "system",
    headline: "Air Release Technology",
    body: "Modern films have micro air-release channels built into the adhesive. This lets installers push air bubbles out easily — no more needle poking.",
    sproketImage: "/characters/sproket/sproket-jetpack.png",
  },
  {
    category: "equity",
    headline: "Finish Matters",
    body: "Gloss reflects light like factory paint. Matte absorbs it for a stealth look. Satin splits the difference. Chrome and color-flip films shift hue with viewing angle.",
    sproketImage: "/characters/sproket/sproket-presenting.png",
  },
  {
    category: "system",
    headline: "3M 2080 Series",
    body: "The industry standard for color change. Dual-cast technology, Controltac repositionable adhesive, and Comply air release. Available in 80+ colors.",
    sproketImage: "/characters/sproket/sproket-camera.png",
  },
  {
    category: "system",
    headline: "Avery Dennison SW900",
    body: "Supreme Wrapping Film with Easy Apply RS adhesive. Known for vivid metallics and conformability. Over 100 colors including their popular ColorFlow series.",
    sproketImage: "/characters/sproket/sproket-loves-it.png",
  },
  {
    category: "amazing",
    headline: "Protect Your Paint",
    body: "A full color change wrap acts as a giant paint protection film. Remove it years later and your OEM paint is pristine underneath — boosting resale value.",
    sproketImage: "/characters/sproket/sproket-success.png",
  },
];

const SLIDE_DURATION_MS = 5000; // 5 seconds per slide

export const DesignIQShowcase = ({ elapsedSeconds, starredImageUrls }: { elapsedSeconds: number; starredImageUrls?: string[] }) => {
  const [slideIndex, setSlideIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [headlineDone, setHeadlineDone] = useState(false);
  const [bodyVisible, setBodyVisible] = useState(false);

  // Advance slides on timer
  useEffect(() => {
    const interval = setInterval(() => {
      setSlideIndex(prev => (prev + 1) % SHOWCASE_SLIDES.length);
      setCharIndex(0);
      setHeadlineDone(false);
      setBodyVisible(false);
    }, SLIDE_DURATION_MS);
    return () => clearInterval(interval);
  }, []);

  // Typewriter for headline
  const slide = SHOWCASE_SLIDES[slideIndex];
  useEffect(() => {
    if (headlineDone) return;
    if (charIndex >= slide.headline.length) {
      setHeadlineDone(true);
      setTimeout(() => setBodyVisible(true), 200);
      return;
    }
    const timer = setTimeout(() => setCharIndex(prev => prev + 1), 25);
    return () => clearTimeout(timer);
  }, [charIndex, headlineDone, slide.headline.length]);

  const headlineColor = slide.category === "amazing" ? "text-green-400"
    : slide.category === "meh" ? "text-yellow-400"
    : slide.category === "miss" ? "text-red-400"
    : slide.category === "equity" ? "text-purple-400"
    : "text-cyan-400";

  const bgGlow = slide.category === "amazing" ? "from-green-500/10 to-green-500/5"
    : slide.category === "meh" ? "from-yellow-500/10 to-yellow-500/5"
    : slide.category === "miss" ? "from-red-500/10 to-red-500/5"
    : slide.category === "equity" ? "from-purple-500/10 to-purple-500/5"
    : "from-cyan-500/10 to-cyan-500/5";

  const renderStars = (count: number) => {
    return (
      <div className="flex items-center gap-2 mt-4">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            className={cn(
              "w-8 h-8 transition-all duration-500",
              i < count ? "text-yellow-400 fill-yellow-400" : "text-muted-foreground/20"
            )}
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>
    );
  };

  return (
    <div className={cn(
      "relative flex flex-col items-start justify-start w-full h-full px-8 pt-4 pb-6 overflow-hidden",
      "transition-all duration-700",
      "bg-gradient-to-br via-background/80",
      bgGlow,
    )}>
      {/* Content */}
      <div className="relative z-10 flex items-start justify-center w-full gap-6 px-4 mt-2">
        {/* SPROKET image — left side, large */}
        {slide.sproketImage && (
          <div className="hidden sm:flex items-center justify-center shrink-0">
            <img
              src={slide.sproketImage}
              alt="SPROKET"
              className="w-28 h-28 md:w-36 md:h-36 lg:w-44 lg:h-44 object-contain animate-sproket-bob"
            />
          </div>
        )}

        {/* Text content — right side */}
        <div className="flex flex-col items-center sm:items-start flex-1 min-w-0">
          {/* Typewriter headline - BIG */}
          <h2 className={cn(
            "text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-center sm:text-left font-poppins leading-tight",
            headlineColor,
            "transition-colors duration-500",
            (slide.category === "amazing" || slide.category === "meh" || slide.category === "miss") && "uppercase tracking-wider"
          )}>
            {slide.headline.slice(0, charIndex)}
            {!headlineDone && (
              <span className="inline-block w-[3px] h-[1.1em] bg-cyan-400 ml-1 animate-pulse align-text-bottom" />
            )}
          </h2>

          {/* Stars for rated categories */}
          {slide.stars && headlineDone && renderStars(slide.stars)}

          {/* Body text - large, fades in */}
          <p className={cn(
            "text-base sm:text-lg md:text-xl text-center sm:text-left max-w-2xl mt-4 leading-relaxed transition-all duration-700 font-poppins",
            "text-muted-foreground",
            bodyVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          )}>
            {slide.body}
          </p>

          {/* SPROKET image — mobile only, below text */}
          {slide.sproketImage && (
            <div className="flex sm:hidden items-center justify-center mt-4">
              <img
                src={slide.sproketImage}
                alt="SPROKET"
                className="w-12 h-12 object-contain"
              />
            </div>
          )}
        </div>
      </div>

      {/* Slide progress dots - bottom */}
      <div className="relative z-10 flex items-center gap-2 pt-6 mt-auto self-center">
        {SHOWCASE_SLIDES.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-2 rounded-full transition-all duration-500",
              i === slideIndex ? "bg-cyan-400 w-8" : "bg-muted-foreground/15 w-2"
            )}
          />
        ))}
      </div>
    </div>
  );
};

// ─── COLORPRO SHOWCASE ───────────────────────────────────────────────

export const ColorProShowcase = ({ elapsedSeconds }: { elapsedSeconds: number }) => {
  const [slideIndex, setSlideIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [headlineDone, setHeadlineDone] = useState(false);
  const [bodyVisible, setBodyVisible] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setSlideIndex(prev => (prev + 1) % COLORPRO_SHOWCASE_SLIDES.length);
      setCharIndex(0);
      setHeadlineDone(false);
      setBodyVisible(false);
    }, SLIDE_DURATION_MS);
    return () => clearInterval(interval);
  }, []);

  const slide = COLORPRO_SHOWCASE_SLIDES[slideIndex];
  useEffect(() => {
    if (headlineDone) return;
    if (charIndex >= slide.headline.length) {
      setHeadlineDone(true);
      setTimeout(() => setBodyVisible(true), 200);
      return;
    }
    const timer = setTimeout(() => setCharIndex(prev => prev + 1), 25);
    return () => clearTimeout(timer);
  }, [charIndex, headlineDone, slide.headline.length]);

  const headlineColor = "text-[#00C7FF]";

  const bgGlow = "from-cyan-500/10 to-cyan-500/5";

  return (
    <div className={cn(
      "relative flex flex-col items-start justify-start w-full h-full px-6 pt-3 pb-4 overflow-hidden",
      "transition-all duration-700",
      "bg-gradient-to-br via-background/80",
      bgGlow,
    )}>
      <div className="relative z-10 flex items-start justify-center w-full gap-5 px-2 mt-1">
        {slide.sproketImage && (
          <div className="hidden sm:flex items-center justify-center shrink-0">
            <img
              src={slide.sproketImage}
              alt="SPROKET"
              className="w-24 h-24 md:w-32 md:h-32 lg:w-40 lg:h-40 object-contain animate-sproket-bob"
            />
          </div>
        )}
        <div className="flex flex-col items-center sm:items-start flex-1 min-w-0">
          <h2 className={cn(
            "text-xl sm:text-2xl md:text-3xl lg:text-4xl font-black text-center sm:text-left font-poppins leading-tight",
            headlineColor,
            "transition-colors duration-500",
          )}>
            {slide.headline.slice(0, charIndex)}
            {!headlineDone && (
              <span className="inline-block w-[3px] h-[1.1em] bg-cyan-400 ml-1 animate-pulse align-text-bottom" />
            )}
          </h2>
          <p className={cn(
            "text-sm sm:text-base md:text-lg text-center sm:text-left max-w-2xl mt-3 leading-relaxed transition-all duration-700 font-poppins",
            "text-muted-foreground",
            bodyVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          )}>
            {slide.body}
          </p>
          {slide.sproketImage && (
            <div className="flex sm:hidden items-center justify-center mt-3">
              <img
                src={slide.sproketImage}
                alt="SPROKET"
                className="w-12 h-12 object-contain"
              />
            </div>
          )}
        </div>
      </div>
      <div className="relative z-10 flex items-center gap-2 pt-4 mt-auto self-center">
        {COLORPRO_SHOWCASE_SLIDES.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-2 rounded-full transition-all duration-500",
              i === slideIndex ? "bg-cyan-400 w-8" : "bg-muted-foreground/15 w-2"
            )}
          />
        ))}
      </div>
    </div>
  );
};

// ─── MAIN WIZARD ──────────────────────────────────────────────────────

export const GenerationWizard = ({
  elapsedSeconds: externalElapsed,
  tips,
  currentTipIndex: externalTipIndex,
  toolName = "Design",
  gradientFrom = "from-blue-500",
  gradientTo = "to-purple-500",
  multiView,
  steps,
  expectedDuration = 45,
  isGenerating,
  designIQShowcase,
  colorProShowcase,
  starredImageUrls,
}: GenerationWizardProps) => {
  // Self-contained timer when isGenerating is provided
  const [internalElapsed, setInternalElapsed] = useState(0);
  const [internalTipIndex, setInternalTipIndex] = useState(0);

  const selfContained = isGenerating !== undefined;
  const elapsedSeconds = selfContained ? internalElapsed : externalElapsed;
  const currentTipIndex = selfContained ? internalTipIndex : externalTipIndex;

  useEffect(() => {
    if (!selfContained) return;
    let interval: NodeJS.Timeout | null = null;
    if (isGenerating) {
      setInternalElapsed(0);
      setInternalTipIndex(0);
      interval = setInterval(() => {
        setInternalElapsed(prev => prev + 1);
      }, 1000);
    } else {
      setInternalElapsed(0);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isGenerating, selfContained]);

  // Rotate tips every 5 seconds for self-contained mode
  useEffect(() => {
    if (!selfContained || !isGenerating) return;
    const interval = setInterval(() => {
      setInternalTipIndex(prev => (prev + 1) % Math.max(tips.length, 1));
    }, 5000);
    return () => clearInterval(interval);
  }, [isGenerating, selfContained, tips.length]);

  // For multi-view, scale expected duration
  const totalExpected = multiView
    ? expectedDuration * multiView.total
    : expectedDuration;

  const progressPercent = multiView
    ? Math.min(((multiView.current / multiView.total) * 100) + ((elapsedSeconds / expectedDuration) * (100 / multiView.total)), 95)
    : Math.min((elapsedSeconds / totalExpected) * 100, 95);

  const getProgressSteps = () => {
    if (steps) return steps;
    if (multiView) {
      return Array.from({ length: multiView.total }, (_, i) => ({
        label: `View ${i + 1} of ${multiView.total}`,
        completed: i < multiView.current,
      }));
    }
    return [
      { label: "Vehicle identified", completed: elapsedSeconds >= 2 },
      { label: "Design analyzed", completed: elapsedSeconds >= 5 },
      { label: "Applying materials", completed: elapsedSeconds >= 10 },
      { label: "Rendering photorealistic", completed: elapsedSeconds >= 18 },
    ];
  };

  const getStatusMessage = () => {
    if (multiView) {
      if (multiView.current === 0) return "Starting multi-view render...";
      if (multiView.current < multiView.total) return `Rendering view ${multiView.current + 1} of ${multiView.total}...`;
      return "Finalizing views...";
    }
    if (elapsedSeconds < 5) return "Starting AI render...";
    if (elapsedSeconds < 15) return "Processing vehicle details...";
    if (elapsedSeconds < 25) return `Applying ${toolName.toLowerCase()}...`;
    if (elapsedSeconds < 40) return "Rendering photorealistic details...";
    return "Almost done, hang tight...";
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
  };

  return (
    <Card className={cn(
      "p-6 border",
      (designIQShowcase || colorProShowcase) ? "min-h-[520px]" : "min-h-[320px]",
      `bg-gradient-to-br ${gradientFrom}/10 via-background ${gradientTo}/10`
    )}>
      <div className="flex flex-col items-center justify-center h-full space-y-6">
        {/* Progress Bar with Gradient */}
        <div className="w-full max-w-md">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-primary font-medium">{getStatusMessage()}</span>
            <span className="text-muted-foreground">{Math.round(progressPercent)}%</span>
          </div>
          <div className="h-3 bg-secondary rounded-full overflow-hidden relative">
            <div
              className={cn(
                "h-full transition-all duration-1000 rounded-full relative",
                `bg-gradient-to-r ${gradientFrom} via-blue-500 ${gradientTo}`
              )}
              style={{ width: `${progressPercent}%` }}
            >
              {/* Animated shimmer overlay */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-shimmer" />
            </div>
          </div>
        </div>

        {/* Timer Display */}
        <div className="flex items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground tabular-nums">
              {formatTime(elapsedSeconds)}
            </p>
            <p className="text-xs text-muted-foreground">elapsed</p>
          </div>
        </div>

        {/* DesignIQ Showcase OR standard steps + tips */}
        {designIQShowcase ? (
          <DesignIQShowcase elapsedSeconds={elapsedSeconds} starredImageUrls={starredImageUrls} />
        ) : colorProShowcase ? (
          <ColorProShowcase elapsedSeconds={elapsedSeconds} />
        ) : (
          <>
            {/* Progress Steps */}
            <div className={cn(
              "gap-3 w-full max-w-md",
              multiView && multiView.total > 4 ? "grid grid-cols-3" : "grid grid-cols-2"
            )}>
              {getProgressSteps().map((step, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center transition-all duration-500",
                    step.completed
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary border border-border"
                  )}>
                    {step.completed && <Check className="w-3 h-3" />}
                  </div>
                  <span className={cn(
                    "text-sm transition-colors duration-500",
                    step.completed ? "text-foreground" : "text-muted-foreground"
                  )}>
                    {step.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Sproket Install Tips */}
            <div className="flex items-start gap-3 p-4 bg-secondary/50 rounded-lg max-w-md w-full">
              <img
                src={SPROKET_POSES[currentTipIndex % SPROKET_POSES.length]}
                alt="Sproket"
                className="w-10 h-10 object-contain flex-shrink-0"
              />
              <div>
                <p className="text-sm text-foreground font-medium mb-0.5">
                  {INSTALL_FACTS[currentTipIndex % INSTALL_FACTS.length]}
                </p>
                <p className="text-xs text-muted-foreground italic">
                  {tips[currentTipIndex % tips.length] || "Pro Tip: Great things take time..."}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
};

// Tool-specific tips
export const GRAPHICSPRO_TIPS = [
  "Pro Tip: Two-tone designs use darker color as base layer",
  "Did you know? Chrome accents require hard-light studio rendering",
  "Pro Tip: Racing stripes should flow hood \u2192 roof \u2192 trunk continuously",
  "Fun Fact: Proper chrome delete adds 8-12 hours to install time",
  "Pro Tip: OEM stripes follow factory-correct geometry and proportions",
  "Did you know? Multi-layer vinyl creates depth with stacked colors",
  "Pro Tip: Satin finishes hide imperfections better than gloss",
  "Fun Fact: A full wrap can increase vehicle resale value"
];

export const DESIGNPANELPRO_TIPS = [
  "DesignIQ works like a real wrap designer - each angle is a fresh creative take. Variations are options, not errors.",
  "Pro Tip: Premium panels print at 186\" \u00d7 56\" for full coverage",
  "Don't worry - that's what revisions are for.",
  "Did you know? Panel designs seamlessly wrap around body curves",
  "Real designers iterate. DesignIQ is no different - dial it in with RevisionStudio.",
  "Pro Tip: Gloss lamination enhances color vibrancy",
  "Hood looks different than the side? That's DesignIQ offering you creative variants. Pick your favorite.",
  "Fun Fact: Custom panels can be designed for any vehicle make",
  "Pro Tip: Matte finishes reduce glare and fingerprints",
  "Even the best wrap studios don't nail every angle on the first proof. That's why we built revisions.",
  "Pro Tip: Satin finish offers the best of both gloss and matte",
  "Fun Fact: Panel wraps last 5-7 years with proper care"
];

export const FADEWRAPS_TIPS = [
  "Pro Tip: Gradient direction dramatically changes the look",
  "Did you know? FadeWraps blend colors seamlessly across panels",
  "Pro Tip: Front-to-back gradients emphasize vehicle length",
  "Fun Fact: Diagonal gradients create dynamic movement",
  "Pro Tip: Top-to-bottom gradients work great on tall vehicles",
  "Did you know? FadeWraps are printed with precision color matching",
  "Pro Tip: Choose colors that complement each other for best results",
  "Fun Fact: Gradient wraps are unique to each vehicle shape"
];

export const PATTERNPRO_TIPS = [
  "Pro Tip: Pattern scale affects how the design tiles on panels",
  "Did you know? There are 92+ specialty patterns available",
  "Pro Tip: Carbon fiber patterns look best at 1:1 scale",
  "Fun Fact: Camo patterns are popular for trucks and off-road vehicles",
  "Pro Tip: Marble patterns create a luxurious premium look",
  "Did you know? Patterns seamlessly wrap around body curves",
  "Pro Tip: Galaxy patterns look stunning on dark vehicles",
  "Fun Fact: Forged carbon is one of our most requested patterns"
];

export const COLORPRO_TIPS = [
  "Pro Tip: Matte finishes hide imperfections better than gloss",
  "Did you know? 3M 2080 series is the industry standard for color change",
  "Fun Fact: A full wrap can increase vehicle resale value",
  "Pro Tip: Darker colors show dust more easily than lighter ones",
  "Did you know? Chrome wraps require more maintenance than standard vinyl",
  "Pro Tip: PPF can be combined with color change for ultimate protection",
  "Fun Fact: Vehicle wraps can last 5-7 years with proper care",
  "Pro Tip: Always have your wrap installed in a dust-free environment"
];

export const APPROVEMODE_TIPS = [
  "Pro Tip: Upload any 2D design and we'll render it on your vehicle in 3D",
  "Did you know? ApproveMode generates 6 professional proof angles",
  "Pro Tip: Higher resolution uploads produce sharper wrap renders",
  "Fun Fact: Clients approve wraps 3x faster with professional proof sheets",
  "Pro Tip: Use the PDF export to send proofs directly to your client",
  "Pro Tip: Each view angle shows different design details for client review",
  "Fun Fact: ApproveMode supports any image format - JPG, PNG, SVG, PDF"
];

export const MATERIAL_TIPS = [
  "Pro Tip: Material textures look best on vehicles with large flat panels",
  "Did you know? Carbon fiber is the most popular material wrap finish",
  "Pro Tip: Brushed metal wraps create a premium industrial look",
  "Fun Fact: Material wraps can simulate wood, leather, and more",
  "Pro Tip: Forged carbon patterns are unique - no two are alike",
  "Did you know? Material wraps add depth without changing the color",
  "Pro Tip: Combine material wraps with accent colors for contrast",
  "Fun Fact: Textured wraps can last just as long as smooth vinyl"
];

export const REVISION_TIPS = [
  "Pro Tip: Use revision notes to track exactly what changed between versions",
  "Did you know? Clients can compare V1 vs V2 side by side",
  "Pro Tip: Small revisions (color tweak, resize logo) render faster",
  "Fun Fact: Most designs are approved within 2-3 revision rounds",
  "Pro Tip: Reference images help the AI understand your revision intent",
  "Did you know? RevisionStudio keeps a full version history of every design",
  "Pro Tip: Be specific in revision notes for best results",
  "Fun Fact: VisionBoard lets you attach reference images to guide revisions"
];
