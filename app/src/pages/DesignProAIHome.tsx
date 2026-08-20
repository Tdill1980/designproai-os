import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, Infinity as InfinityIcon, FileText, Clock, ChevronLeft, ChevronRight,
  Bell, HelpCircle, Truck, Car, Flag, Boxes, Search, MessageCircle, Plus,
  Upload, CarFront, Images, Wand2, CheckCircle2, Layers,
  PencilRuler, FileEdit, Package, Cog, Printer, ArrowRight, Play,
  Bike, Bus, Caravan, X,
} from "lucide-react";
import { useStarredRenders } from "@/hooks/useStarredRenders";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import DesignPanelProPremium from "./DesignPanelProPremium";
import {
  FLAT_FIRST_ATLAS_PIPELINE_MODE,
  type GenerationPipelineMode,
} from "@/lib/designpro-api";
import { FLAT_FIRST_ATLAS_UI_ENABLED } from "@/lib/designpro-flat-first";
import type { VehicleType } from "@/components/tools/VehicleTypeSelector";

/**
 * DesignProAIHome — the /designpro front door (matches the DesignProAI mockup).
 *
 * Motivating + functional: showcases real work (starred DesignPro renders), the
 * proof deliverables, and a SINGLE "Describe your wrap idea" prompt box. The AI
 * parses that one brief (designpro-parse-brief) downstream into editable layers.
 * Generate Designs → /designpro/create carrying the prompt to kick off the run.
 *
 * Dark branded suite UI (authenticated tool home; top bar always black).
 */

const TABS = ["DesignProAI™", "RevisionStudioIQ™", "ProductionPack™", "ProductionFlow™"];

const MODES = ["Commercial", "Restyle"];

const VEHICLE_TYPES = [
  { icon: Car, label: "Car", value: "car" },
  { icon: Car, label: "SUV", value: "suv" },
  { icon: Truck, label: "Truck", value: "truck" },
  { icon: CarFront, label: "Van", value: "van" },
  { icon: Bike, label: "Motorcycle", value: "motorcycle" },
  { icon: Caravan, label: "Trailer", value: "trailer" },
  { icon: Bus, label: "Bus", value: "bus" },
  { icon: Caravan, label: "RV", value: "rv" },
] as const;

function PipelineModeSelector({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: GenerationPipelineMode;
  onChange: (mode: GenerationPipelineMode) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (!FLAT_FIRST_ATLAS_UI_ENABLED) return null;
  return (
    <div className={cn("rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-2.5", className)}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">Pipeline test</div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={value === "legacy"}
          onClick={() => onChange("legacy")}
          className={cn(
            "rounded-lg border px-2 py-1.5 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-70",
            value === "legacy"
              ? "border-white/30 bg-white/10 text-white"
              : "border-white/10 text-white/50 hover:bg-white/5",
          )}
        >
          Legacy
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={value === FLAT_FIRST_ATLAS_PIPELINE_MODE}
          onClick={() => onChange(FLAT_FIRST_ATLAS_PIPELINE_MODE)}
          className={cn(
            "rounded-lg border px-2 py-1.5 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-70",
            value === FLAT_FIRST_ATLAS_PIPELINE_MODE
              ? "border-cyan-400 bg-cyan-400/15 text-cyan-200"
              : "border-white/10 text-white/50 hover:bg-white/5",
          )}
        >
          A.T.L.A.S. (flat-first test)
        </button>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-white/55">
        {disabled
          ? "Pipeline is locked for this run. Start a new run to change it."
          : "Opt-in diagnostic: stores the flat guide + master, then renders seven proofs. It stops before production handoff."}
      </p>
    </div>
  );
}

const CAPABILITIES = [
  { icon: Sparkles, label: "Professional Designs" },
  { icon: Images, label: "7 Hi-Res Proof Angles" },
  { icon: FileEdit, label: "Fast Revisions" },
  { icon: FileText, label: "Production Ready" },
  { icon: CheckCircle2, label: "QC Checked by Experts" },
];

const INSPIRATION = [
  { title: "StreetFire Tacos", sub: "Food Truck Wrap" },
  { title: "Ridgeline Pools", sub: "Commercial Wrap" },
  { title: "HVAC Hero", sub: "Fleet Wrap" },
  { title: "Stealth Panther", sub: "Luxury Restyle" },
];

// Real, copy-paste-ready prompt starters — fill in the [blanks].
const POPULAR_PROMPTS = [
  "Bold HVAC wrap, blue & white ice theme for [Company]. Add logo, phone, website. Clean and professional.",
  "Modern landscaping wrap, green & earth tones for [Company]. Show services, phone, website.",
  "Vibrant food truck wrap for [Truck Name]. Bold colors, appetizing, big logo and menu vibe.",
  "Professional plumbing van wrap, navy & chrome for [Company]. 24/7 service, phone, license #.",
  "Electrician service truck, electric-blue accents for [Company]. Logo, phone, licensed & insured.",
  "Pest control wrap, clean modern look for [Company]. Friendly mascot, guarantee, phone.",
];

const WORKFLOW = [
  { n: 1, icon: Wand2, step: "Prompt Your Design", sub: "Describe it — ACE designs it" },
  { n: 2, icon: Layers, step: "Use LayerLiftIQ", sub: "Make fast edits instantly" },
  { n: 3, icon: Package, step: "Order Production Pack", sub: "Order your print-ready files" },
  { n: 4, icon: Boxes, step: "Follow Progress", sub: "ProductionFlow — GENIE Panelizer" },
  { n: 5, icon: Truck, step: "WrapBox Delivery", sub: "Human-QC'd pack fits templates → your WrapBox" },
];

const HOW_IT_WORKS = [
  "Prompt Your Design",
  "Use LayerLiftIQ — Make Fast Edits",
  "Order Your Production Pack",
  "Follow Progress in ProductionFlow",
  "WrapBox Delivery — Human QC'd",
];

// Real example media from the public "DesignPro Page Assets" bucket — one per
// workflow step (2D proof → ProductionPack, 3D proofs → ProductionFlow/WrapBox).
const ASSET = (p: string) =>
  `https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/DesignPro%20Page%20Assets/${p}`;
const STEP_IMAGES: (string | undefined)[] = [
  ASSET("BomberFordF150.png"),                                         // 1 Prompt → finished design
  undefined,                                                           // 2 LayerLiftIQ → starred render
  ASSET("2%20D%20Proof%20Example/APEX_2d-proof%20%281%29.jpg"),        // 3 ProductionPack → 2D proof
  ASSET("3D%20Proof/APEX.png"),                                        // 4 ProductionFlow → single 3D proof
  undefined,                                                           // 5 WrapBox → starred render
];

// Our showcase designs — shown when the user doesn't have enough of their own
// recent work yet, so the home never looks empty.
const OURS = [
  ASSET("Restyle/3DProofKoiFerrari.png"),
  ASSET("BomberFordF150.png"),
  ASSET("3D%20Proof/APEX.png"),
];

const PRODUCTIONPACK_FEATURES = [
  "All print-ready panel files · 2″ bleed",
  "2D Production Proof + 3D Realistic Proof",
  "7 Hi-Res Proof Angles",
  "Production Panel Proof artboard (PNG)",
  "Vector overlays + background files",
  "Real human QC · delivered in 48h",
];

const FEATURE_STRIP = [
  { icon: Boxes, title: "Engineered for Pros", sub: "Built for wrap shops, designers & installers" },
  { icon: Cog, title: "Smarter Workflow", sub: "Save hours on every project" },
  { icon: FileText, title: "Real Production Files", sub: "From concept to print-ready" },
  { icon: CheckCircle2, title: "QC by Real Designers", sub: "Every ProductionPack checked within 48h" },
  { icon: Clock, title: "Delivered Fast", sub: "ProductionPack delivered within 48 hours" },
];

export default function DesignProAIHome() {
  const navigate = useNavigate();
  const { data: renders = [] } = useStarredRenders();
  const [heroIdx, setHeroIdx] = useState(0);
  const [prompt, setPrompt] = useState("");
  // When set, the design studio renders INLINE on this same page (no navigation,
  // no new window) — brief on the left, Konva canvas in the center.
  const [studioBrief, setStudioBrief] = useState<any | null>(null);
  const [pipelineMode, setPipelineMode] = useState<GenerationPipelineMode>("legacy");
  const [showPromptHelp, setShowPromptHelp] = useState(false);
  // Left-rail "Start Your Design" state
  const [mode, setMode] = useState("Commercial");
  const [vehicleType, setVehicleType] = useState<VehicleType>("car");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  // Commercial brief (Business & Fleet) — drives the studio's Layer-2 text extraction.
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  // VisionBoard references, each tagged so the system knows what to parse it as:
  // "background" → Layer-1 style reference; "overlay" → Layer-2 logo/text example.
  const [visionRefs, setVisionRefs] = useState<{ url: string; kind: "background" | "overlay" }[]>([]);
  const [uploadingRef, setUploadingRef] = useState(false);

  const uploadRef = async (file: File) => {
    setUploadingRef(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const path = `vision-board-refs/${user?.id || "anon"}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "")}`;
      const { error } = await supabase.storage.from("patterns").upload(path, file, { upsert: false });
      if (!error) {
        const { data } = supabase.storage.from("patterns").getPublicUrl(path);
        setVisionRefs((prev) => [...prev, { url: data.publicUrl, kind: "background" }]);
      }
    } finally {
      setUploadingRef(false);
    }
  };
  const toggleRefKind = (i: number) =>
    setVisionRefs((prev) => prev.map((v, j) => (j === i ? { ...v, kind: v.kind === "background" ? "overlay" : "background" } : v)));

  // Inspiration rotates DAILY — the gallery quietly surfaces a fresh few each
  // day from past work, so the home feels alive without any manual curation.
  // Deterministic per-day offset (same all day, advances at midnight UTC).
  const showcase = useMemo(() => {
    // Prefer the user's own work; fall back to our showcase so it's never empty.
    const base = renders.length ? renders : OURS;
    if (!base.length) return [] as string[];
    const dayOffset = Math.floor(Date.now() / 86_400_000) % base.length;
    return base.map((_, i) => base[(i + dayOffset) % base.length]);
  }, [renders]);

  // "Your Recent Designs" — the user's most recent designs first; if they don't
  // have enough yet, pad with ours so the rail always shows six.
  const recentDesigns = useMemo(() => {
    const mine = renders.filter(Boolean);
    if (mine.length >= 6) return mine.slice(0, 6);
    return [...mine, ...OURS.filter((u) => !mine.includes(u))].slice(0, 6);
  }, [renders]);

  const heroUrl = showcase[heroIdx % Math.max(showcase.length, 1)] || "";
  const dots = Math.min(Math.max(showcase.length, 1), 5);
  const displayedPipelineMode = studioBrief?.pipelineMode ?? pipelineMode;

  // Open the studio INLINE on this page (no navigation, no new window).
  const startNewDesign = () => setStudioBrief({
    pipelineMode,
    vehicleType,
    year: year.trim() || undefined,
    make: make.trim() || undefined,
    model: model.trim() || undefined,
  });
  const startDesign = () =>
    setStudioBrief({
      acePrompt: prompt.trim() || undefined,
      mode, vehicleType,
      pipelineMode,
      year: year.trim() || undefined,
      make: make.trim() || undefined,
      model: model.trim() || undefined,
      // Commercial (Business & Fleet) text → studio Layer-2 extraction.
      companyName: mode === "Commercial" ? (companyName.trim() || undefined) : undefined,
      phone: mode === "Commercial" ? (phone.trim() || undefined) : undefined,
      website: mode === "Commercial" ? (website.trim() || undefined) : undefined,
      // Background examples → Layer 1; logo/overlay examples → Layer 2.
      visionBoardUrls: visionRefs.filter((v) => v.kind === "background").map((v) => v.url),
      overlayUrls: visionRefs.filter((v) => v.kind === "overlay").map((v) => v.url),
    });
  // Clicking a popular prompt fills the prompt box (copy-paste ready) — they tweak the [blanks], then Start.
  const usePrompt = (p: string) => {
    setPrompt(p);
    document.getElementById("start-design-prompt")?.scrollIntoView({ behavior: "smooth", block: "center" });
    (document.getElementById("start-design-prompt") as HTMLTextAreaElement | null)?.focus();
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto flex max-w-[1600px] gap-5 px-5 py-5">
        {/* LEFT RAIL — Start Your Design */}
        <aside className="hidden lg:flex w-72 shrink-0 flex-col gap-4">
          <div className="rounded-2xl border border-blue-500/40 bg-neutral-800 p-4 shadow-lg shadow-blue-500/10 ring-1 ring-blue-500/20">
            <div className="text-base font-extrabold">
              Start Your <span className="bg-gradient-to-r from-blue-400 to-pink-400 bg-clip-text text-transparent">Design</span>
            </div>
            <p className="text-[11px] text-white/70">Pick a vehicle, add make & model, describe it.</p>

            <PipelineModeSelector
              className="mt-3"
              value={displayedPipelineMode}
              onChange={setPipelineMode}
              disabled={!!studioBrief}
            />

            {/* Primary CTA at the top so it's always visible — fill the info below, then Create. */}
            <button onClick={startDesign} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-pink-500 py-2.5 text-sm font-bold text-white shadow transition hover:opacity-90">
              <Wand2 className="h-4 w-4" /> Create Design
            </button>

            {/* Mode */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {MODES.map((m) => (
                <button key={m} onClick={() => setMode(m)} className={cn("rounded-lg border px-3 py-2 text-xs font-bold transition", mode === m ? "border-transparent bg-gradient-to-r from-blue-600 to-fuchsia-500 text-white shadow" : "border-white/10 text-white/70 hover:bg-white/5")}>{m}</button>
              ))}
            </div>

            {/* Vehicle type */}
            <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-white/60">Vehicle Type</div>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {VEHICLE_TYPES.map((v) => (
                <button key={v.value} onClick={() => setVehicleType(v.value)} className={cn("flex flex-col items-center gap-1 rounded-lg border px-1 py-2 transition", vehicleType === v.value ? "border-blue-500 bg-blue-500/15 text-white" : "border-white/10 text-white/70 hover:bg-white/5")}>
                  <v.icon className="h-4 w-4" />
                  <span className="text-[9px] leading-none">{v.label}</span>
                </button>
              ))}
            </div>

            {/* Exact vehicle snapshot for the embedded studio. */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" placeholder="Year" className="rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none" />
              <input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Make" className="rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none" />
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" className="rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none" />
            </div>

            {/* Commercial (Business & Fleet) brand fields — these feed the studio's
                Layer-2 text extraction so the design gets editable logo/phone/website. */}
            {mode === "Commercial" && (
              <div className="mt-3 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-fuchsia-300">Business details (for logo & text layers)</div>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name" className="w-full rounded-lg border border-fuchsia-500/30 bg-neutral-900 px-2.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-fuchsia-500/60 focus:outline-none" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none" />
                  <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Website" className="rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-2 text-xs text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none" />
                </div>
              </div>
            )}

            {/* Prompt */}
            <textarea
              id="start-design-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Describe your wrap idea… (or click a Popular Prompt to fill this in)"
              className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-xs text-white placeholder:text-white/30 focus:border-blue-500/50 focus:outline-none"
            />

            {/* Need help? — click to open a compact horizontal-scroll prompt
                carousel on a blue→magenta gradient background. Collapsed by
                default so the brief stays short. */}
            <button
              type="button"
              onClick={() => setShowPromptHelp((v) => !v)}
              className="mt-2 flex w-full items-center justify-between rounded-lg bg-gradient-to-r from-blue-600/25 to-fuchsia-500/25 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white/80 hover:from-blue-600/40 hover:to-fuchsia-500/40"
            >
              <span className="flex items-center gap-1.5"><Search className="h-3 w-3" /> Need help? Popular prompts</span>
              <ChevronRight className={cn("h-3 w-3 transition-transform", showPromptHelp && "rotate-90")} />
            </button>
            {showPromptHelp && (
              <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {POPULAR_PROMPTS.map((p) => (
                  <button key={p} onClick={() => { usePrompt(p); setShowPromptHelp(false); }} className="w-32 shrink-0 rounded-md bg-gradient-to-br from-blue-600/30 to-fuchsia-500/30 px-2 py-1 text-left text-[9px] leading-snug text-white/85 transition hover:from-blue-600/50 hover:to-fuchsia-500/50 hover:text-white">
                    <span className="line-clamp-2">{p}</span>
                  </button>
                ))}
              </div>
            )}

            {/* VisionBoard — reference images for the AI */}
            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-white/60">VisionBoard — tag each: Background or Logo</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {visionRefs.map((v, i) => (
                  <div key={i} className="w-14">
                    <div className="relative h-14 w-14 overflow-hidden rounded-lg border border-white/10">
                      <img src={v.url} alt="" className="h-full w-full object-cover" />
                      <button onClick={() => setVisionRefs((p) => p.filter((_, j) => j !== i))} className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center bg-black/70 text-white"><X className="h-3 w-3" /></button>
                    </div>
                    <button onClick={() => toggleRefKind(i)} className={cn("mt-0.5 w-full rounded px-1 py-0.5 text-[8px] font-bold uppercase", v.kind === "background" ? "bg-blue-500/20 text-blue-300" : "bg-pink-500/20 text-pink-300")}>
                      {v.kind === "background" ? "Background" : "Logo"}
                    </button>
                  </div>
                ))}
                <label className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-lg border border-dashed border-white/20 text-white/60 hover:border-blue-500/50 hover:text-white">
                  {uploadingRef ? <span className="text-[9px]">…</span> : <Upload className="h-4 w-4" />}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadRef(f); }} />
                </label>
              </div>
            </div>

          </div>

          <button onClick={() => navigate("/dashboard")} className="flex items-center justify-between rounded-xl border border-white/10 bg-neutral-800 px-3 py-3 text-sm hover:bg-neutral-800">
            <span className="flex items-center gap-2"><Boxes className="h-4 w-4 text-white/60" /> My Recent Designs</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">{renders.length || 0}</span>
          </button>
        </aside>

        {/* CENTER */}
        <main className="min-w-0 flex-1 space-y-5">
          <PipelineModeSelector
            className="lg:hidden"
            value={displayedPipelineMode}
            onChange={setPipelineMode}
            disabled={!!studioBrief}
          />
          {studioBrief ? (
            /* ONE unified page: the canvas renders right here in the center — the
               left brief stays put, no swap to a separate studio, no re-entry. */
            <div className="min-h-[78vh] overflow-hidden rounded-2xl border border-white/10 bg-black">
              <DesignPanelProPremium embedded embeddedBrief={studioBrief} />
            </div>
          ) : (
          <>
          {/* Hero carousel — words over the photo with a soft left fade (the fade
              sits only behind the text and dissolves to transparent, so it never
              covers the vehicle photo). */}
          <section className="relative min-h-[300px] overflow-hidden rounded-2xl border border-white/10 bg-neutral-900">
            {heroUrl
              ? <img src={heroUrl} alt="Design example" className="absolute inset-0 h-full w-full object-cover" />
              : <div className="absolute inset-0 flex items-center justify-center text-white/30"><Sparkles className="h-10 w-10" /></div>}
            {/* legibility fade — behind the text only, fades out before the photo */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent md:to-transparent" />
            <div className="relative max-w-md p-7">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-pink-400 [text-shadow:0_1px_8px_rgba(0,0,0,0.7)]">Meet Your New Graphic Designer</div>
              <h1 className="mt-2 text-4xl font-extrabold leading-tight [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]">
                Prompt to<br />
                <span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Print Production™</span>
              </h1>
              <p className="mt-3 max-w-md text-sm text-white/70 [text-shadow:0_1px_8px_rgba(0,0,0,0.7)]">DesignProAI™ is engineered to design like a pro, revise in minutes, and deliver print-ready production files.</p>
              <div className="mt-5 flex gap-1.5">
                {Array.from({ length: dots }).map((_, i) => (
                  <span key={i} className={cn("h-1.5 rounded-full transition-all", i === heroIdx % dots ? "w-6 bg-blue-500" : "w-1.5 bg-white/20")} />
                ))}
              </div>
            </div>
            {showcase.length > 1 && (
              <>
                <button onClick={() => setHeroIdx((p) => (p - 1 + showcase.length) % showcase.length)} className="absolute left-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 hover:bg-black/80"><ChevronLeft className="h-4 w-4" /></button>
                <button onClick={() => setHeroIdx((p) => (p + 1) % showcase.length)} className="absolute right-2 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 hover:bg-black/80"><ChevronRight className="h-4 w-4" /></button>
              </>
            )}
          </section>

          {/* The DesignProAI Workflow — one job, end to end (with real step images) */}
          <section className="rounded-2xl border border-white/10 bg-neutral-800 p-5">
            <div className="mb-3 text-sm font-bold">The DesignPro<span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">AI</span>™ Workflow: <span className="text-white/60 font-medium">One Job. End to End.</span></div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {HOW_IT_WORKS.map((caption, i) => (
                <button key={caption} onClick={startNewDesign} className="group flex w-44 shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-left transition hover:border-white/25">
                  <div className="aspect-[4/3] overflow-hidden bg-neutral-800">
                    {(STEP_IMAGES[i] || showcase[i]) ? <img src={STEP_IMAGES[i] || showcase[i]} alt={caption} className="h-full w-full object-cover transition group-hover:scale-105" /> : <div className="flex h-full items-center justify-center text-white/20"><Sparkles className="h-6 w-6" /></div>}
                  </div>
                  <div className="p-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">Step {i + 1}</div>
                    <div className="mt-0.5 text-xs font-medium leading-snug text-white/80">{caption}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Bottom feature strip — why pros choose DesignProAI */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {FEATURE_STRIP.map((f) => (
              <div key={f.title} className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-neutral-800 p-4">
                <f.icon className="h-5 w-5 text-blue-400" />
                <div className="text-[11px] font-bold uppercase tracking-wider text-white/80">{f.title}</div>
                <div className="text-[11px] leading-snug text-white/65">{f.sub}</div>
              </div>
            ))}
          </section>
          </>
          )}
        </main>

        {/* RIGHT RAIL — hidden while designing so the canvas owns the width */}
        {!studioBrief && (
        <aside className="hidden xl:flex w-72 shrink-0 flex-col gap-5">
          {/* ProductionPack — $299 */}
          <div className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-purple-500/10 p-4">
            <div className="text-sm font-bold">ProductionPack™</div>
            <div className="mt-1 text-3xl font-extrabold">$299</div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-white/60">
              <Package className="h-3 w-3" /> Zip file includes
            </div>
            <ul className="mt-1.5 space-y-1 text-[11px] text-white/75">
              {PRODUCTIONPACK_FEATURES.map((x) => (
                <li key={x} className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> {x}</li>
              ))}
            </ul>
            <button onClick={startNewDesign} className="mt-3 w-full rounded-xl bg-gradient-to-r from-blue-600 to-purple-600 py-2 text-xs font-semibold hover:from-blue-500 hover:to-purple-500">View ProductionPack</button>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-[11px] font-bold uppercase tracking-wider text-transparent">Your Recent Designs</span>
              <button onClick={() => navigate("/dashboard")} className="text-[11px] text-blue-400 hover:underline">View All</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(recentDesigns.length ? recentDesigns : Array.from({ length: 3 })).map((url: any, i) => (
                <button key={i} onClick={startNewDesign} className="aspect-square overflow-hidden rounded-lg border border-white/5 bg-neutral-900">
                  {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-white/20"><Sparkles className="h-4 w-4" /></div>}
                </button>
              ))}
            </div>
          </div>
        </aside>
        )}
      </div>
    </div>
  );
}
