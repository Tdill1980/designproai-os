import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Lock, Paintbrush, Briefcase, Sparkles, Check, ChevronDown, Loader2, Film, ImagePlus, X, Layers, AlertTriangle } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { GenerateReadiness, type ReadinessChip, type ReadinessState } from "./GenerateReadiness";
import {
  COMMERCIAL_INDUSTRIES,
  SUBSTRATE_SPECS,
  type DesignIQParams,
  type VisionBoardImage,
  type VisionBoardIntent,
  type PrintSubstrate,
} from "@/lib/designiq-engine";
import { VisionBoardUploader } from "./VisionBoardUploader";
import { GenerationWizard } from "@/components/tools/GenerationWizard";
import { useNavigate } from "react-router-dom";
import { useUserTier } from "@/hooks/useUserTier";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

const VISIONBOARD_STORAGE_KEY = "designiq_visionboard_images_v1";
const DESIGN_INTAKE_DRAFT_KEY = "designiq_intake_draft_v1";
// v2 (2026-07-18): key bumped so sessions sticky on the old exact_reference
// default start fresh on style_inspiration — see the default's comment below.
const VISIONBOARD_INTENT_STORAGE_KEY = "designiq_visionboard_intent_v2";

// VisionBoard references are cached so an uploaded reference survives the
// generation re-render cycle (a render can briefly unmount this component via a
// subscription refetch). The cache is TIME-BOXED: anything older than this
// window belongs to a PREVIOUS design session and must NOT auto-populate a new
// design's inspo drawer. That stale-leak — "the cache is keeping the older
// versions on the inspo draws" when starting a new design — was the bug. 20 min
// easily covers a render cycle (seconds) while keeping a fresh design clean.
const VISIONBOARD_CACHE_TTL_MS = 20 * 60 * 1000;

type DesignIntakeDraft = {
  savedAt: number;
  prompt: string;
  mode: "restyle" | "commercial";
};

function readFreshDesignIntakeDraft(): DesignIntakeDraft | null {
  try {
    const saved = sessionStorage.getItem(DESIGN_INTAKE_DRAFT_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Partial<DesignIntakeDraft>;
    if (
      typeof parsed.savedAt === "number"
      && Date.now() - parsed.savedAt < VISIONBOARD_CACHE_TTL_MS
      && typeof parsed.prompt === "string"
      && (parsed.mode === "restyle" || parsed.mode === "commercial")
    ) {
      return parsed as DesignIntakeDraft;
    }
    sessionStorage.removeItem(DESIGN_INTAKE_DRAFT_KEY);
  } catch {
    /* ignore malformed or unavailable session storage */
  }
  return null;
}

/** Wipe both VisionBoard cache keys (images + intent) so the next design starts clean. */
function clearVisionBoardCache() {
  try {
    sessionStorage.removeItem(VISIONBOARD_STORAGE_KEY);
    sessionStorage.removeItem(VISIONBOARD_INTENT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Read cached VisionBoard images ONLY if the cache is fresh. A bare-array
 * (legacy) payload, an expired payload, or any parse error is treated as stale:
 * we clear the cache and return [] so a brand-new design never inherits the
 * previous design's reference images.
 */
function readFreshVisionBoardCache(): VisionBoardImage[] {
  try {
    const saved = sessionStorage.getItem(VISIONBOARD_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        Array.isArray(parsed.images) &&
        typeof parsed.savedAt === "number" &&
        Date.now() - parsed.savedAt < VISIONBOARD_CACHE_TTL_MS
      ) {
        return parsed.images as VisionBoardImage[];
      }
    }
  } catch {
    /* fall through to clear */
  }
  clearVisionBoardCache();
  return [];
}

const DESIGNIQ_TIPS = [
  "DesignIQ\u2122 is rendering your vehicle wrap...",
  "The world\u2019s first Prompt-to-Production\u2122 wrap system",
  "Your design renders directly on the vehicle \u2014 no flat panel step",
  "Tip: Be specific \u2014 mention colors, themes, and energy you want",
  "Every render is print-ready and production-file compatible",
  "Tip: Try different styles \u2014 Racing for speed, Organic for flow",
];

const LOCKED_FEATURES = [
  "AI-generated panel designs",
  "ReStyle artistic mode with 9 style presets",
  "Commercial fleet & brand mode",
  "Print-ready 186\u2033 \u00d7 56\u2033 output",
  "Unlimited creative prompts",
];

interface AiPanelGeneratorProps {
  onPanelGenerated: (panel: any) => void;
  isGenerating: boolean;
  onGenerate: (params: DesignIQParams) => Promise<void>;
  initialPrompt?: string;
  /** When true, auto-fire the generation once on mount (used by the
   *  DesignProAIHome one-prompt handoff: the customer already typed their brief
   *  and clicked "Generate Designs", so we kick the pipeline without a second
   *  click). Only fires for restyle mode where the prompt alone is sufficient. */
  autoGenerate?: boolean;
  initialVisionBoardUrls?: string[];
  /** Layer-2 (logo/text) reference images from the home VisionBoard, tagged "Logo". */
  initialTextLayerUrls?: string[];
  /** Commercial brief carried from the home (Business & Fleet mode) so the
   *  auto-generate fires a real commercial pass → Layer-2 text extraction. */
  initialMode?: "restyle" | "commercial";
  initialCompanyName?: string;
  initialPhone?: string;
  initialWebsite?: string;
  /** Logo finalized in the sibling LogoProLauncher. When set, we drop it into
   *  the VisionBoard as an exact-reference image, switch to Commercial mode,
   *  and pre-fill the company name so the next "Create with DesignIQ" render
   *  actually applies the logo to the wrap. */
  injectedLogo?: { storageUrl: string; companyName?: string } | null;
  onInjectedLogoConsumed?: () => void;
  /** Rendered at the top of the LEFT control column (e.g. Vehicle Details) so
   *  it sits in the two-column grid instead of spanning full width above it. */
  leftColumnHeader?: React.ReactNode;
  /** Appropriate-tool handoff: called with the uploaded reference URL(s) when the
   *  customer picks "Recreate Exactly" and taps Continue in RecreatePro. The
   *  parent (which holds the vehicle) carries refs + year/make/model into
   *  RecreatePro so reproduction happens in the tool built for it. */
  onExactReproHandoff?: (refs: string[]) => void;
  /** The vehicle the parent holds, so the readiness strip can say whether we
   *  have one. It is not in this component's state -- year/make/model live in
   *  `leftColumnHeader`, which the parent renders. */
  vehicle?: { year?: string; make?: string; model?: string };
  /** GENIE's verdict on that vehicle, resolved by the parent WHILE the form is
   *  being filled. `warn` means no authoritative record: the run still goes
   *  through, with provisional geometry, and this is how the customer finds
   *  that out before they press the button rather than after. */
  dimensionsState?: ReadinessState;
  /** Offered only when `dimensionsState` is `warn` -- the one dimension control
   *  on the page, and only when there is genuinely a geometry problem. */
  onResolveDimensions?: () => void;
  /** The panel the ⚠ chip opens. Rendered by the parent, which owns the
   *  vehicle fields it edits. */
  dimensionHelp?: React.ReactNode;
}

/**
 * Premium access check - returns true for users who should have
 * AI Design Studio access.  Update this single function when tier
 * names / pricing are finalized.
 */
function checkPremiumAccess(userTier: string): boolean {
  // TODO: Replace with final tier gating logic once pricing is set.
  // For now, "complete" and "agency" are treated as premium.
  const premiumTiers = ["complete", "agency"];
  return premiumTiers.includes(userTier);
}

export const AiPanelGenerator = ({
  onPanelGenerated,
  isGenerating,
  onGenerate,
  initialPrompt,
  autoGenerate,
  initialVisionBoardUrls,
  initialTextLayerUrls,
  initialMode,
  initialCompanyName,
  initialPhone,
  initialWebsite,
  injectedLogo,
  onInjectedLogoConsumed,
  leftColumnHeader,
  onExactReproHandoff,
  vehicle,
  dimensionsState = "neutral",
  onResolveDimensions,
  dimensionHelp,
}: AiPanelGeneratorProps) => {
  const userTier = useUserTier();
  const navigate = useNavigate();

  // Also unlock if the user has design tokens available (e.g. the 3
  // welcome tokens granted to every WPW Connect Portal campaign signup).
  // Token-holders get to spend the token here without an upgrade pitch.
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("user_tokens")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) setTokenBalance((data as { balance?: number } | null)?.balance ?? 0);
    })();
    return () => { cancelled = true; };
  }, []);

  const hasPremiumAccess = checkPremiumAccess(userTier) || tokenBalance > 0;

  const intakeDraftRef = useRef<DesignIntakeDraft | null>(readFreshDesignIntakeDraft());
  const [mode, setMode] = useState<"restyle" | "commercial">(
    initialMode || intakeDraftRef.current?.mode || "restyle",
  );
  const [prompt, setPrompt] = useState(initialPrompt || intakeDraftRef.current?.prompt || "");
  useEffect(() => {
    try {
      sessionStorage.setItem(DESIGN_INTAKE_DRAFT_KEY, JSON.stringify({
        savedAt: Date.now(), prompt, mode,
      } satisfies DesignIntakeDraft));
    } catch {
      /* the immutable server request remains the authority */
    }
  }, [prompt, mode]);
  const [finish, setFinish] = useState("Gloss");
  const [substrate, setSubstrate] = useState<PrintSubstrate>("standard");
  // Film Grounding — "Customize Color Change Film" toggle
  const [filmGroundingEnabled, setFilmGroundingEnabled] = useState(false);
  const [filmManufacturer, setFilmManufacturer] = useState("");
  const [filmColorName, setFilmColorName] = useState("");
  const [filmSwatchPreview, setFilmSwatchPreview] = useState<string | null>(null);
  const [filmGroundingResult, setFilmGroundingResult] = useState<any>(null);
  const [isGroundingFilm, setIsGroundingFilm] = useState(false);
  const filmSwatchRef = useRef<HTMLInputElement>(null);
  const [companyName, setCompanyName] = useState(initialCompanyName || "");
  const [phone, setPhone] = useState(initialPhone || "");
  const [mascot, setMascot] = useState("");
  const [industryType, setIndustryType] = useState("");
  const [bulletPoints, setBulletPoints] = useState<string[]>(["", "", "", "", ""]);
  const [brandColors, setBrandColors] = useState("");
  const [fontStyle, setFontStyle] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  // VisionBoard references persist to sessionStorage so an uploaded reference
  // survives the generation cycle (a render can trigger a subscription refetch
  // / re-render that would otherwise drop in-memory state and leave the
  // VisionBoard looking empty right after the user clicks generate).
  const [visionBoardImages, setVisionBoardImages] = useState<VisionBoardImage[]>(() => {
    if (initialVisionBoardUrls?.length) {
      return initialVisionBoardUrls.map((url, i) => ({ slotLabel: `Reference ${i + 1}`, storageUrl: url }));
    }
    // Only restore a FRESH cache (within the TTL). A stale/legacy cache is
    // wiped here so the inspo drawer doesn't inherit a previous design's refs.
    return readFreshVisionBoardCache();
  });
  const [visionBoardIntent, setVisionBoardIntent] = useState<VisionBoardIntent>(() => {
    try {
      const saved = sessionStorage.getItem(VISIONBOARD_INTENT_STORAGE_KEY);
      if (saved === "exact_reference" || saved === "style_inspiration") return saved;
    } catch { /* ignore */ }
    // Default to STYLE INSPIRATION (Trish, 2026-07-18): an uploaded example is
    // INPUT, never output — the generator must always produce an ORIGINAL 3D
    // on-vehicle proof informed by the reference, not feed the uploaded design
    // back to the customer. Exact Reference remains an explicit opt-in on the
    // uploader for "recreate this on my vehicle" jobs (RecreatePro-class); it
    // is never the silent default again, because in practice it echoed the
    // upload — including someone else's branding — as the customer's design.
    return "style_inspiration";
  });

  // ── Layer 2 (Text & Logo) — new two-layer flow. Describes the editable
  //    text/logo objects that get composited on top of the background in
  //    RevisionStudio (NOT rendered into the background artwork).
  const [textLayerPrompt, setTextLayerPrompt] = useState(initialWebsite ? `Website: ${initialWebsite}` : "");
  const [textLayerImages, setTextLayerImages] = useState<VisionBoardImage[]>(
    () => (initialTextLayerUrls?.length ? initialTextLayerUrls.map((url, i) => ({ slotLabel: `Logo ${i + 1}`, storageUrl: url })) : []),
  );

  // Mirror VisionBoard state into sessionStorage on every change, stamped with
  // the save time so a later design session can detect (and discard) a stale
  // cache. When the user clears every reference, wipe the cache entirely so the
  // next design starts with an empty inspo drawer instead of resurrecting old
  // refs.
  useEffect(() => {
    try {
      if (visionBoardImages.length > 0) {
        sessionStorage.setItem(
          VISIONBOARD_STORAGE_KEY,
          JSON.stringify({ savedAt: Date.now(), images: visionBoardImages }),
        );
      } else {
        clearVisionBoardCache();
      }
    } catch { /* ignore */ }
  }, [visionBoardImages]);
  useEffect(() => {
    try {
      sessionStorage.setItem(VISIONBOARD_INTENT_STORAGE_KEY, visionBoardIntent);
    } catch { /* ignore */ }
  }, [visionBoardIntent]);
  const [commercialDetailsOpen, setCommercialDetailsOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);

  // Timer + tip rotation during generation
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let tipInterval: NodeJS.Timeout | null = null;

    if (isGenerating) {
      interval = setInterval(() => setElapsedSeconds((p) => p + 1), 1000);
      tipInterval = setInterval(
        () => setCurrentTipIndex((p) => (p + 1) % DESIGNIQ_TIPS.length),
        5000
      );
    } else {
      setElapsedSeconds(0);
      setCurrentTipIndex(0);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (tipInterval) clearInterval(tipInterval);
    };
  }, [isGenerating]);

  // LogoPro hand-off: when a sibling LogoProLauncher finalizes a logo, drop it
  // into VisionBoard as an exact-reference image, switch to Commercial mode,
  // and pre-fill the company name so the next render applies the logo to the
  // wrap instead of leaving it stranded in the brand kit.
  useEffect(() => {
    if (!injectedLogo?.storageUrl) return;
    setVisionBoardImages((prev) => {
      if (prev.some((img) => img.storageUrl === injectedLogo.storageUrl)) return prev;
      return [...prev, { slotLabel: "Company Logo", storageUrl: injectedLogo.storageUrl }];
    });
    setVisionBoardIntent("exact_reference");
    setMode("commercial");
    setCommercialDetailsOpen(true);
    if (injectedLogo.companyName && !companyName.trim()) {
      setCompanyName(injectedLogo.companyName);
    }
    toast({
      title: "Logo added to your wrap",
      description: "DesignIQ will apply this logo when you click Create.",
    });
    onInjectedLogoConsumed?.();
  }, [injectedLogo?.storageUrl, injectedLogo?.companyName, companyName, onInjectedLogoConsumed]);

  const updateBulletPoint = (index: number, value: string) => {
    setBulletPoints((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    // If film grounding is enabled, look up the real film first
    let filmContext = "";
    if (filmGroundingEnabled && filmManufacturer.trim() && filmColorName.trim()) {
      setIsGroundingFilm(true);
      try {
        const { data, error } = await supabase.functions.invoke("film-grounding", {
          body: { manufacturer: filmManufacturer.trim(), colorName: filmColorName.trim() },
        });
        if (!error && data?.promptContext) {
          filmContext = data.promptContext;
          setFilmGroundingResult(data);
        } else {
          // Fallback: just use the names directly
          filmContext = `This design is printed on ${filmManufacturer.trim()} ${filmColorName.trim()} vinyl film. The base film's color, finish, and effect show through the printed ink layer.`;
        }
      } catch (e) {
        filmContext = `This design is printed on ${filmManufacturer.trim()} ${filmColorName.trim()} vinyl film. The base film's color, finish, and effect show through the printed ink layer.`;
      } finally {
        setIsGroundingFilm(false);
      }
    }

    // Append film context to the user prompt so it flows through the existing pipeline
    const enrichedPrompt = filmContext
      ? `${prompt.trim()}\n\n[PRINT SUBSTRATE — REAL FILM]: ${filmContext}`
      : prompt.trim();

    await onGenerate({
      mode,
      prompt: enrichedPrompt,
      finish,
      substrate: filmGroundingEnabled ? "color_change_film" : (substrate !== "standard" ? substrate : undefined),
      // SEND WHAT THEY ENTERED. A taxonomy choice may not delete their data.
      //
      // Each of these was `mode === "commercial" ? x : undefined`, so the nine
      // fields below existed only if the customer had highlighted the right
      // card first. A phone number typed on the ReStyle side never reached the
      // wrap, and nothing told them. Mode is inferred downstream from exactly
      // these values, so gating them on it was also circular.
      companyName: companyName?.trim() ? companyName : undefined,
      phone: phone.trim() ? phone.trim() : undefined,
      mascot: mascot?.trim() ? mascot : undefined,
      bulletPoints: (() => {
        const points = bulletPoints.filter((b) => b.trim() !== "");
        return points.length ? points : undefined;
      })(),
      industryType: industryType?.trim() ? industryType : undefined,
      brandColors: brandColors.trim() ? brandColors.trim() : undefined,
      fontStyle: fontStyle || undefined,
      qrEnabled: qrUrl.trim() ? true : undefined,
      qrUrl: qrUrl.trim() ? qrUrl.trim() : undefined,
      visionBoardImages: (() => {
        const imgs = [...visionBoardImages];
        if (filmSwatchPreview) {
          imgs.push({ slotLabel: "Film Swatch", storageUrl: filmSwatchPreview });
        }
        return imgs.length > 0 ? imgs : undefined;
      })(),
      visionboard_intent: visionBoardImages.length > 0 ? visionBoardIntent : undefined,
      // Layer 2 — editable text/logo layer (two-layer flow). Carried forward to
      // RevisionStudio; not baked into the Layer 1 background artwork.
      // ONE creative prompt → the SAME text also feeds the Layer-2 parser
      // (designpro-parse-brief), which extracts only the brand pieces
      // (company / phone / website / tagline) and never invents. The customer
      // types naturally in one box; the system splits Layer 1 vs Layer 2.
      //
      // Do NOT fall back to enrichedPrompt here (regression from #2120): the
      // whole creative/scene paragraph then flowed into layer2Source and the
      // line-parser dumped it as a bogus "tagline" overlay. Leave it undefined
      // when the user typed no explicit Layer-2 text — designpro-parse-brief
      // already receives params.prompt and extracts clean brand pieces from it.
      textLayerPrompt: textLayerPrompt.trim() || undefined,
      textLayerVisionBoardImages: textLayerImages.length > 0 ? textLayerImages : undefined,
    });
  };

  // NO HARD BLOCKS. (Trish 2026-08-28: "No hard blocks -- just add the enter
  // button, it sends to DesignProAI to process appropriately.")
  //
  // The readiness strip tells the customer what the system already knows about
  // their job; it never stands between them and Generate. What remains here is
  // a double-submit guard and the two in-flight states -- none of which is a
  // judgement about whether their input is good enough.
  const canGenerate = !isGenerating && !isGroundingFilm;

  // WHAT WE HAVE, NOT WHAT IS MISSING.
  //
  // This was a "To continue, add ..." sentence whose only job was explaining a
  // greyed-out button. Nothing greys the button out now, so the same
  // information becomes a statement of what the system is holding for this job.
  //
  // Brand and Logo report `neutral` when absent rather than `warn`: a restyle
  // wrap has no company name, and flagging that as a deficiency would be the
  // Commercial/ReStyle question we just deleted, smuggled back as an icon.
  const readinessChips: ReadinessChip[] = [
    {
      label: "Vehicle",
      state:
        vehicle?.year?.trim() && vehicle?.make?.trim() && vehicle?.model?.trim()
          ? "ok"
          : "neutral",
    },
    { label: "Brief", state: prompt.trim().length > 0 ? "ok" : "neutral" },
    {
      label: "Brand",
      state:
        companyName.trim() || phone.trim() || brandColors.trim() ? "ok" : "neutral",
    },
    {
      label: "Logo",
      state: textLayerImages.length > 0 ? "ok" : "neutral",
    },
    {
      label: "Dimensions",
      state: dimensionsState,
      hint: dimensionsState === "warn" ? "Confirm" : undefined,
      onClick: dimensionsState === "warn" ? onResolveDimensions : undefined,
    },
  ];

  // ─── One-prompt handoff auto-fire ──────────────────────────────
  // DesignProAIHome navigates here with the customer's brief and autoGenerate.
  // Kick the SAME production pipeline (onGenerate → handlePipelineStart) exactly
  // once, after access resolves and the prompt is seeded — no second click, no
  // bypass of the render/Layer-2/proof flow.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoFiredRef.current) return;
    if (!hasPremiumAccess || !canGenerate) return;
    autoFiredRef.current = true;
    void handleGenerate();
  }, [autoGenerate, hasPremiumAccess, canGenerate]);

  // ─── Locked State ──────────────────────────────────────────────
  if (!hasPremiumAccess) {
    return (
      <div className="border-gradient-designiq rounded-xl">
        <div className="rounded-xl bg-card p-5 space-y-5">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-500/15 mb-1">
              <Lock className="w-6 h-6 text-blue-400" />
            </div>
            <h3 className="text-lg font-bold text-gradient-designiq">
              DesignIQ&#8482; AI Design Studio
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Create custom wrap designs with AI&#8209;powered wrap intelligence
            </p>
          </div>

          {/* Feature list */}
          <ul className="space-y-2.5">
            {LOCKED_FEATURES.map((feature) => (
              <li key={feature} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <div className="w-5 h-5 rounded-full bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-blue-400" />
                </div>
                {feature}
              </li>
            ))}
          </ul>

          {/* Upgrade CTA */}
          <Button
            onClick={() => navigate("/pricing")}
            className="w-full btn-designiq text-white font-semibold border-0"
            size="lg"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            Upgrade to Unlock
          </Button>

          {/* Footer */}
          <p className="text-[11px] text-center text-muted-foreground/60">
            DesignIQ&#8482;
          </p>
        </div>
      </div>
    );
  }

  // ─── Unlocked State (Premium) ──────────────────────────────────
  return (
    <div className="grid grid-cols-1 gap-4 items-start">
      {/* ── LEFT COLUMN — design controls ───────────────────────────── */}
      <div className="space-y-5">
      {/* Vehicle Details (or any caller-supplied header) sits in the left column */}
      {leftColumnHeader}

      {/* Mode Selector - original DesignProAI experience cards. The selected
          mode is part of the immutable request input; downstream may infer a
          mode only for older callers that do not supply one. */}
      <div className="space-y-3" aria-label="Design type">
        {/* ReStyle card */}
        <Card
          role="button"
          tabIndex={0}
          aria-pressed={mode === "restyle"}
          className={cn(
            "p-4 cursor-pointer transition-all border",
            mode === "restyle"
              ? "border-2 border-transparent bg-[#1c1c1e] shadow-[0_0_18px_rgba(236,72,153,0.45)] [background:linear-gradient(#1c1c1e,#1c1c1e)_padding-box,linear-gradient(to_right,#3b82f6,#ec4899)_border-box]"
              : "border-white/10 bg-[#1c1c1e] hover:border-blue-500/40"
          )}
          onClick={() => setMode("restyle")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setMode("restyle");
            }
          }}
        >
          <div className="flex items-start gap-3">
            <div className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
              mode === "restyle" ? "bg-blue-500/20" : "bg-secondary"
            )}>
              <Paintbrush className={cn("w-5 h-5", mode === "restyle" ? "text-blue-400" : "text-muted-foreground")} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Artistic &amp; Style Wraps</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">ReStyle</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Create bold aesthetic designs with style presets like Racing, Organic, Geometric, Camo &amp; more
              </p>
            </div>
          </div>
        </Card>

        {/* Commercial card */}
        <Card
          role="button"
          tabIndex={0}
          aria-pressed={mode === "commercial"}
          className={cn(
            "p-4 cursor-pointer transition-all border",
            mode === "commercial"
              ? "border-2 border-transparent bg-[#1c1c1e] shadow-[0_0_18px_rgba(236,72,153,0.45)] [background:linear-gradient(#1c1c1e,#1c1c1e)_padding-box,linear-gradient(to_right,#3b82f6,#ec4899)_border-box]"
              : "border-white/10 bg-[#1c1c1e] hover:border-blue-500/40"
          )}
          onClick={() => setMode("commercial")}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setMode("commercial");
            }
          }}
        >
          <div className="flex items-start gap-3">
            <div className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
              mode === "commercial" ? "bg-blue-500/20" : "bg-secondary"
            )}>
              <Briefcase className={cn("w-5 h-5", mode === "commercial" ? "text-blue-400" : "text-muted-foreground")} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">Business &amp; Fleet Wraps</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Commercial</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Brand-focused commercial designs with company identity, mascots, and industry-optimized layouts
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Creative Workspace */}
      <Card className="p-4 bg-[#1c1c1e] border-white/10 space-y-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {mode === "restyle" ? "Creative Direction" : "Brand Direction"}
        </p>

        {/* Commercial-specific fields - company name always visible, rest collapsible */}
        {mode === "commercial" && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1">
                Company Name{" "}
                {textLayerImages.length > 0 ? (
                  <span className="text-muted-foreground/50">(optional — using your uploaded logo)</span>
                ) : (
                  <span className="text-red-400">*</span>
                )}
              </Label>
              <Input
                placeholder="e.g., Marz Mechanical"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="bg-background"
              />
            </div>

            <div>
              <Label className="text-xs text-muted-foreground mb-1">
                Phone / Website <span className="text-muted-foreground/50">(optional)</span>
              </Label>
              <Input
                placeholder="e.g., (555) 123-4567 or www.example.com"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="bg-background"
              />
            </div>

            {/* ── YOUR LOGO (Layer 2) — lives in Brand Direction, commercial only.
                Drop your real logo here and it becomes ONE editable overlay on the
                wrap (move/resize/rotate in LayerLiftIQ). When a logo is uploaded the
                system uses IT as the brand mark and stops drawing the company name
                onto the design — so Company Name above becomes optional. The box's
                background-stripping (cleanLogoBg) cleans a solid/white background to
                a transparent cutout. SEPARATE from "Match this wrap style" below,
                which is the background DESIGN reference, not the logo. */}
            <div>
              <Label className="text-[11px] font-bold uppercase tracking-wider text-fuchsia-400 mb-1 block">
                Your logo <span className="text-muted-foreground/50 font-normal normal-case">(optional)</span>
                <span className="ml-2 inline-block rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-fuchsia-300">
                  Transparent PNG recommended
                </span>
              </Label>
              <VisionBoardUploader
                images={textLayerImages}
                onChange={setTextLayerImages}
                intent="exact_reference"
                onIntentChange={() => { /* logos are always placed exactly */ }}
                disabled={isGenerating}
                hideIntent
                cleanLogoBg
                compact
                proTip={(
                  <>
                    <span className="font-semibold text-fuchsia-400">Drop your logo here.</span>{" "}
                    It becomes ONE editable layer on the wrap you can move, resize &amp; rotate —
                    and the company name above won't be redrawn onto the design.{" "}
                    <span className="font-semibold text-fuchsia-300">A transparent PNG works best</span>{" "}
                    (no background to remove). A solid/white background is fine too; a busy photo
                    background won't cut out cleanly.
                  </>
                )}
              />
            </div>

            <Collapsible open={commercialDetailsOpen} onOpenChange={setCommercialDetailsOpen}>
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full py-1">
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", commercialDetailsOpen && "rotate-180")} />
                  {commercialDetailsOpen ? "Hide" : "Show"} brand details (mascot, industry, keywords)
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-3 pt-2">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1">
                    Mascot <span className="text-muted-foreground/50">(optional)</span>
                  </Label>
                  <Input
                    placeholder="e.g., Tony the Tiger"
                    value={mascot}
                    onChange={(e) => setMascot(e.target.value)}
                    className="bg-background"
                  />
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1">
                    Brand Colors <span className="text-muted-foreground/50">(optional)</span>
                  </Label>
                  <Input
                    placeholder="e.g., royal blue, white, black with a blue gradient"
                    value={brandColors}
                    onChange={(e) => setBrandColors(e.target.value)}
                    className="bg-background"
                  />
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1">
                    Font Style <span className="text-muted-foreground/50">(optional)</span>
                  </Label>
                  <Select value={fontStyle} onValueChange={setFontStyle}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Logo-style typeface..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="a bold modern sans-serif logo typeface — clean, heavy weight, highly legible">Bold Modern Sans</SelectItem>
                      <SelectItem value="a condensed athletic logo typeface — tall, tight, sporty and aggressive">Condensed / Athletic</SelectItem>
                      <SelectItem value="an italic speed/script logo typeface — dynamic, energetic, leaning forward">Speed / Script</SelectItem>
                      <SelectItem value="a heavy slab/industrial logo typeface — blocky, rugged, trade-strong">Slab / Industrial</SelectItem>
                      <SelectItem value="a geometric tech logo typeface — precise, futuristic, even strokes">Geometric / Tech</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1">
                    QR Code URL <span className="text-muted-foreground/50">(optional)</span>
                  </Label>
                  <Input
                    placeholder="e.g., https://hvachero.com"
                    value={qrUrl}
                    onChange={(e) => setQrUrl(e.target.value)}
                    className="bg-background"
                  />
                  <p className="text-[10px] text-muted-foreground/70 mt-1 leading-snug">
                    A real scannable QR code is added to the rear quarter after the render — the wrap reserves a clean space for it.
                  </p>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1">
                    Industry Type
                  </Label>
                  <Select value={industryType} onValueChange={setIndustryType}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select industry..." />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMERCIAL_INDUSTRIES.map((i) => (
                        <SelectItem key={i.key} value={i.key}>
                          {i.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs text-muted-foreground mb-1">
                    Brand Keywords{" "}
                    <span className="text-muted-foreground/50">(up to 5)</span>
                  </Label>
                  <div className="space-y-2">
                    {bulletPoints.map((bp, idx) => (
                      <Input
                        key={idx}
                        placeholder={`Keyword ${idx + 1}`}
                        value={bp}
                        onChange={(e) => updateBulletPoint(idx, e.target.value)}
                        className="bg-background text-sm"
                      />
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {/* Finish selector */}
        <div>
          <Label className="text-xs text-muted-foreground mb-1">Finish</Label>
          <div className="grid grid-cols-3 gap-2">
            {(["Gloss", "Matte", "Satin"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFinish(f)}
                className={cn(
                  "py-3 px-3 rounded-lg border-2 text-sm font-medium transition-all min-h-[44px]",
                  finish === f
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-primary/50"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Customize Color Change Film — toggle + manufacturer/color input */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setFilmGroundingEnabled(!filmGroundingEnabled)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-3 rounded-lg border-2 transition-all text-left",
              filmGroundingEnabled
                ? "border-transparent bg-gradient-to-r from-blue-500/15 to-pink-500/15 ring-1 ring-pink-500/50 shadow-[0_0_14px_rgba(236,72,153,0.45)]"
                : "border-border hover:border-pink-500/40"
            )}
          >
            <div className={cn(
              "w-9 h-5 rounded-full flex items-center transition-all shrink-0",
              filmGroundingEnabled ? "bg-gradient-to-r from-blue-500 to-pink-500 justify-end" : "bg-zinc-600 justify-start"
            )}>
              <div className="w-4 h-4 bg-white rounded-full mx-0.5 shadow-sm" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Film className={cn("w-4 h-4 shrink-0", filmGroundingEnabled ? "text-pink-400" : "text-muted-foreground")} />
                <span className={cn("text-sm font-semibold", filmGroundingEnabled ? "text-pink-400" : "text-foreground")}>
                  Print on Color Change Film
                </span>
                <Badge className="bg-pink-500/15 text-pink-400 border-0 text-[9px] font-bold px-1.5 py-0 shrink-0">
                  SPECIALTY
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Specialty Customization Tool — design renders on your manufacturer film color
              </p>
            </div>
          </button>

          {filmGroundingEnabled && (
            <div className="space-y-2 p-3 bg-pink-500/5 border border-pink-500/20 rounded-lg">
              <p className="text-[10px] text-pink-400 font-bold uppercase tracking-wider">
                Must be a real manufacturer name &amp; exact color name
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed -mt-1">
                AI uses Google to search for the real film — fake or generic names will produce inaccurate results.
              </p>
              <div className="flex gap-2 items-start">
                {/* Manufacturer + Color inputs */}
                <div className="flex-1 space-y-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground mb-0.5">Manufacturer</Label>
                    <Input
                      placeholder="e.g., 3M, Avery, Hexis"
                      value={filmManufacturer}
                      onChange={(e) => setFilmManufacturer(e.target.value)}
                      className="bg-background text-sm h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground mb-0.5">Exact Color Name</Label>
                    <Input
                      placeholder="e.g., Ghost Flip Pearl"
                      value={filmColorName}
                      onChange={(e) => setFilmColorName(e.target.value)}
                      className="bg-background text-sm h-9"
                    />
                  </div>
                </div>
                {/* Swatch upload */}
                <div className="shrink-0">
                  <Label className="text-[10px] text-muted-foreground mb-0.5">Film Swatch</Label>
                  {filmSwatchPreview ? (
                    <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-pink-500/40 group">
                      <img src={filmSwatchPreview} alt="Film swatch" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => { setFilmSwatchPreview(null); if (filmSwatchRef.current) filmSwatchRef.current.value = ""; }}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/90"
                      >
                        <X className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ) : (
                    <div
                      onClick={() => filmSwatchRef.current?.click()}
                      className="w-20 h-20 rounded-lg border-2 border-dashed border-pink-500/30 hover:border-pink-500/60 cursor-pointer flex flex-col items-center justify-center gap-0.5 transition-colors"
                    >
                      <ImagePlus className="w-4 h-4 text-pink-400/60" />
                      <span className="text-[8px] text-pink-400/60">Upload</span>
                    </div>
                  )}
                  <input
                    ref={filmSwatchRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const { data: { user } } = await supabase.auth.getUser();
                        const userId = user?.id || "anonymous";
                        const ext = file.name.split(".").pop();
                        const filePath = `vision-board-refs/${userId}/film-swatch-${Date.now()}.${ext}`;
                        const { error } = await supabase.storage.from("patterns").upload(filePath, file, { cacheControl: "3600", upsert: false });
                        if (error) throw error;
                        const { data: { publicUrl } } = supabase.storage.from("patterns").getPublicUrl(filePath);
                        setFilmSwatchPreview(publicUrl);
                      } catch (err: any) {
                        toast({ title: "Upload failed", description: err.message, variant: "destructive" });
                      }
                    }}
                  />
                </div>
              </div>
              {filmManufacturer.trim() && filmColorName.trim() && (
                <p className="text-[10px] text-pink-300/80 leading-relaxed">
                  Your design will render as printed artwork on{" "}
                  <span className="font-semibold text-pink-400">
                    {filmManufacturer.trim()} {filmColorName.trim()}
                  </span>
                  {" "}— the real film's color, finish, and effect will show through the printed design.
                </p>
              )}
              {isGroundingFilm && (
                <div className="flex items-center gap-2 text-[10px] text-pink-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Searching for film specs...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Generation loading state */}
      {isGenerating && (
        <GenerationWizard
          elapsedSeconds={elapsedSeconds}
          tips={DESIGNIQ_TIPS}
          currentTipIndex={currentTipIndex}
          toolName="DesignIQ\u2122 Vehicle Render"
          gradientFrom="from-blue-500"
          gradientTo="to-fuchsia-500"
        />
      )}

      {/* Footer branding */}
      <p className="text-[11px] text-center text-muted-foreground/60">
        DesignIQ&#8482;
      </p>
      </div>
      {/* ── END LEFT COLUMN ─────────────────────────────────────────── */}

      {/* ── RIGHT COLUMN — the two layer vision boards ──────────────── */}
      <div className="space-y-5">
        {/* ── ONE creative input. The customer types naturally and drops their
            files; the system splits Layer 1 (background wrap) vs Layer 2 (text &
            logos → editable LayerLiftIQ nodes) automatically under the hood.
            No "two-prompt" homework for the customer. ─────────────────────── */}
        <Card className="p-4 bg-[#1c1c1e] border-white/10">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
              Describe your wrap
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-blue-500 to-pink-500 px-2 py-0.5 text-[9px] font-bold text-white shadow-sm shadow-pink-500/20">
              <Layers className="h-2.5 w-2.5" /> LayerLiftIQ&#8482;
            </span>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground mb-3">
            Type your idea naturally — colors, style, and any company name, phone, website,
            or text you want on the vehicle. Drop a <span className="font-semibold text-blue-400">design to match</span> below
            and the wrap artwork follows it. Your <span className="font-semibold text-fuchsia-400">logo</span> (added under
            Brand Direction) rides on top as an editable layer you can
            move, resize, and rotate.
          </p>
          <Textarea
            placeholder={"e.g. Modern collegiate trailer wrap in navy and gold for Arctic Air.\nInclude our phone (386) 675-9861 and arcticair.com.\nUse our uploaded logo."}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="bg-background min-h-[150px] focus:ring-1 focus:ring-blue-500/30 mb-4"
          />
          {/* ── STYLE REFERENCE — VisionBoard IQ™ — "match this wrap style".
              Bound to visionBoardImages, which handleGenerate sends to the render
              (with visionboard_intent) so the AI actually FOLLOWS the uploaded
              example. This uploader was dropped in a refactor — which is why
              uploaded examples stopped reaching the render AND the compare view
              vanished. Restored here. SEPARATE from the logo box below: the wrap
              ARTWORK follows this; the logo rides on top as an editable layer. */}
          <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/[0.04] p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-blue-500 to-pink-500 px-2 py-0.5 text-[9px] font-bold text-white">
                <Layers className="h-2.5 w-2.5" /> VisionBoard IQ&#8482;
              </span>
              <p className="text-[11px] font-bold uppercase tracking-wider text-blue-400">
                Match this wrap style
              </p>
            </div>
            <VisionBoardUploader
              images={visionBoardImages}
              onChange={setVisionBoardImages}
              intent={visionBoardIntent}
              onIntentChange={setVisionBoardIntent}
              disabled={isGenerating}
              recreateProRedirect
              onRecreateProHandoff={() =>
                onExactReproHandoff?.(
                  visionBoardImages.map((v) => v.storageUrl).filter(Boolean) as string[],
                )
              }
              proTip={(
                <>
                  <span className="font-semibold text-blue-400">Drop a design you love.</span>{" "}
                  <span className="font-semibold">Style Inspiration</span> (default) riffs on its colors &amp; energy into a NEW design;
                  switch to <span className="font-semibold">Recreate Exactly</span> to reproduce that design on your vehicle.
                </>
              )}
            />
            {visionBoardImages.length > 0 && (
              <div className="mt-3 rounded-md border border-white/10 bg-black/30 p-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                  Matching this reference against your prompt
                </p>
                <p className="text-[11px] leading-snug text-foreground/80 whitespace-pre-wrap line-clamp-4">
                  {prompt.trim() || "Add your prompt above so we can blend it with this reference…"}
                </p>
              </div>
            )}
            {visionBoardImages.length > 0 && visionBoardIntent === "exact_reference" && (
              <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-2 py-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                <p className="text-[10px] leading-snug text-amber-200/90">
                  To lock in an <span className="font-semibold">exact logo match</span> without AI redraws, drop your logo into the <span className="font-semibold text-fuchsia-300">Your logo</span> box under Brand Direction.
                </p>
              </div>
            )}
          </div>

          {/* The "Your logo" uploader now lives inside the commercial Brand
              Direction block above (grouped with Company Name / Phone), and only
              shows for Business & Fleet Wraps — see the {mode === "commercial"}
              section. Restyle (artistic) wraps don't carry a brand logo. */}

          {/* Generate Button — the money action. Moved UNDER the VisionBoard
              uploader so "Create with DesignIQ" sits at the BOTTOM of the input
              flow: describe the wrap → drop references/logo → create. */}
          <Button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="w-full btn-designiq text-white font-semibold text-base border-0 mt-4"
            size="lg"
          >
            {isGenerating ? (
              <>
                <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                DesignIQ&#8482; is crafting your design...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Create with DesignIQ&#8482;
              </>
            )}
          </Button>

          {/* What DesignProAI is holding for this job. Informational: it sits
              under a button that is never disabled by it. */}
          {!isGenerating && (
            <>
              <GenerateReadiness chips={readinessChips} className="mt-3" />
              {dimensionHelp}
            </>
          )}
        </Card>
      </div>
      {/* ── END RIGHT COLUMN ────────────────────────────────────────── */}
    </div>
  );
};
