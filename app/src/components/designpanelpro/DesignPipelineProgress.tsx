import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles, Image as ImageIcon, Layers, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { GenerationRequestState } from "@/lib/designpro-api";

/**
 * DesignPipelineProgress — live, granular status for the DesignProAI generate run
 * so the customer is NEVER left blind (or thinks it's frozen) while the edge
 * functions execute. Reflects the durable server-owned generation stages:
 *   analyzing  → parsing the brief / vehicle
 *   rendering  → canonical design / flat master
 *   finishing  → seven conditioned 3D proof views
 *
 * Status comes from the durable server request. Elapsed time remains visible,
 * but it is never presented as percent-complete because time is not progress.
 *
 * Purely presentational + additive. It does not conduct the render pipeline.
 */
export type PipelineStage = "analyzing" | "rendering" | "finishing";

const STEPS: {
  key: PipelineStage;
  label: string;
  sub: string[];
  icon: typeof Sparkles;
}[] = [
  {
    key: "analyzing",
    label: "Reading your brief",
    sub: ["Studying your brief", "Locking your vehicle", "Setting the creative direction"],
    icon: Sparkles,
  },
  {
    key: "rendering",
    label: "A.C.E. is designing your wrap",
    sub: [
      "Interpreting your prompt",
      "Composing the layout & focal point",
      "Building depth, texture & motion",
      "Setting the color story",
      "Refining the typography & logo lockup",
      "Sharpening every detail to pro-grade",
    ],
    icon: ImageIcon,
  },
  {
    key: "finishing",
    label: "Rendering your 3D proof views",
    sub: ["Projecting the canonical design", "Checking side consistency", "Finishing all seven angles"],
    icon: Layers,
  },
];

// A.C.E. — the AI Creative Engine, the branded astronaut shown working while the
// render runs. Bundled brand asset; hides itself on error so it can never break
// the loader.
const ACE_IMG = "/characters/ace-astronaut.png";

// mm:ss timer label (e.g. 0:07, 1:23) so the elapsed time reads as a real timer.
const fmtTimer = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

type MarketDesign = { id: string; title: string | null; price: number | null; thumbnail_url: string | null; render_urls: string[] | null };
const marketImg = (d: MarketDesign) => d?.thumbnail_url || d?.render_urls?.[0] || "";

export function DesignPipelineProgress({
  stage,
  elapsed,
  requestState,
  isAtlas = false,
  atlasReady = false,
}: {
  stage: PipelineStage | null;
  elapsed: number;
  requestState?: GenerationRequestState | null;
  isAtlas?: boolean;
  atlasReady?: boolean;
}) {
  // Default to "rendering" if the pipeline is active but no explicit stage was set
  // (defensive — the customer always sees a live step, never a bare spinner).
  const activeKey: PipelineStage =
    requestState?.phase === "photographer" || requestState?.phase === "complete"
      ? "finishing"
      : stage ?? "rendering";
  const activeIndex = Math.max(0, STEPS.findIndex((s) => s.key === activeKey));
  const activeStep = STEPS[activeIndex];

  // Rotate the reassurance sub-message so a long step never looks stalled.
  const [subIdx, setSubIdx] = useState(0);
  useEffect(() => {
    setSubIdx(0);
    const id = setInterval(() => setSubIdx((i) => i + 1), 2200);
    return () => clearInterval(id);
  }, [activeKey]);
  const legacySubMsg = activeStep.sub[subIdx % activeStep.sub.length];

  // Live Creator Market designs — ONLY real listed wraps (never app screenshots).
  // Fetched once; on any error the carousel simply hides. Independent of the render
  // pipeline, so it can never affect generation.
  const [designs, setDesigns] = useState<MarketDesign[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from("marketplace_listings")
          .select("id, title, price, thumbnail_url, render_urls")
          .eq("status", "listed")
          .order("listed_at", { ascending: false })
          .limit(24);
        if (!cancelled && Array.isArray(data)) {
          setDesigns(data.filter((d: MarketDesign) => marketImg(d)));
        }
      } catch { /* carousel just hides */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-advancing carousel (customer can also step through with the arrows).
  const [designIdx, setDesignIdx] = useState(0);
  useEffect(() => {
    if (designs.length < 2) return;
    const id = setInterval(() => setDesignIdx((i) => i + 1), 2800);
    return () => clearInterval(id);
  }, [designs.length]);
  const curDesign = designs.length ? designs[((designIdx % designs.length) + designs.length) % designs.length] : null;

  const shotsComplete = requestState?.shotsComplete ?? 0;
  const shotsTotal = requestState?.shotsTotal ?? 7;
  const hasProofProgress = requestState?.phase === "photographer" && shotsTotal > 0;
  const proofPct = hasProofProgress ? Math.min(100, (shotsComplete / shotsTotal) * 100) : 0;
  const legacyServerStatus = !requestState
    ? "Submitting to server"
    : requestState.state === "queued"
      ? "Queued on server"
      : requestState.state === "retryable"
        ? `Server retry ${requestState.attempt ?? ""}`.trim()
        : requestState.phase === "photographer"
          ? `${shotsComplete} of ${shotsTotal} proof views complete`
          : requestState.phase === "complete" || requestState.state === "outputs_ready"
            ? "Proof views complete"
            : "Creating the approved design on server";
  const atlasProofStatus = `${Math.min(shotsComplete, 7)} of 7 proof views ready`;
  const headline = isAtlas
    ? atlasReady
      ? "Projecting 3D proofs from your A.T.L.A.S. master"
      : "Painting your canonical flattened A.T.L.A.S. master"
    : "Creating your custom wrap design";
  const subMsg = isAtlas
    ? atlasReady
      ? atlasProofStatus
      : "Gemini is painting the canonical flattened A.T.L.A.S. master"
    : legacySubMsg;
  const activeLabel = isAtlas
    ? atlasReady
      ? "Rendering your 3D proof views"
      : "Painting canonical flattened A.T.L.A.S. master"
    : activeStep.label;
  const serverStatus = isAtlas
    ? atlasReady
      ? atlasProofStatus
      : "Canonical flattened master is being painted"
    : legacyServerStatus;

  // Honest long-wait signal instead of a frozen-looking bar.
  const longWait = elapsed >= 75 && activeKey !== "finishing";

  return (
    <div className="w-full max-w-md mx-auto px-6 py-8 flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        {/* A.C.E. — the branded astronaut, front and center while he designs. */}
        <div className="relative h-28 w-28 sm:h-32 sm:w-32 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full border-2 border-cyan-400/30 border-t-cyan-400 animate-spin" />
          <img
            src={ACE_IMG}
            alt="A.C.E."
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            className="h-24 w-24 sm:h-28 sm:w-28 object-contain drop-shadow-[0_0_18px_rgba(34,211,238,0.35)]"
          />
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-cyan-400/80">
          DesignProAI™ · A.C.E.
        </p>
        <p className="text-lg font-bold text-white">{headline}</p>
        <p className="text-xs text-white/55 min-h-[16px] transition-opacity">{subMsg}…</p>
      </div>

      {/* LARGE live timer — the headline number, so the customer always sees time
          moving. The stage % rides small beside the progress bar below. */}
      <div className="flex flex-col items-center gap-1">
        <span className="text-6xl font-bold tabular-nums bg-gradient-to-r from-cyan-300 via-blue-400 to-pink-400 bg-clip-text text-transparent leading-none">
          {fmtTimer(elapsed)}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/40">Elapsed</span>
      </div>

      {/* Server-owned status. Only proof-view counts are determinate. */}
      <div className="w-full">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-white/60">{activeLabel}</span>
          <span className="text-xs font-bold tabular-nums text-pink-300">{serverStatus}</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full bg-gradient-to-r from-blue-500 to-pink-500 transition-all duration-700 ease-out",
              !hasProofProgress && "w-1/3 animate-pulse",
            )}
            style={hasProofProgress ? { width: `${proofPct}%` } : undefined}
          />
        </div>
      </div>

      {/* Creator Market — real one-off wrap designs, browsable while A.C.E. works.
          Links open in a NEW TAB so browsing never abandons the in-progress render. */}
      {curDesign && (
        <div className="w-full flex flex-col items-center">
          {/* CreatorMarket wordmark logo */}
          <p className="text-lg font-bold tracking-tight text-white">
            Creator<span className="bg-gradient-to-r from-fuchsia-400 via-violet-400 to-blue-400 bg-clip-text text-transparent">Market</span>
          </p>
          <p className="text-[11px] text-white/55 text-center mb-2 max-w-[260px]">
            Check out our Creator Market for designs for sale.
          </p>

          {/* Carousel image — fills the panel width (capped by the max-w-md
              container) so it's prominent without blowing out full-viewport. */}
          <div className="relative w-full aspect-video rounded-xl overflow-hidden ring-1 ring-white/10 bg-white/5">
            <a
              key={curDesign.id}
              href={`/creatormarket?listing=${curDesign.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute inset-0 block"
            >
              <img
                src={marketImg(curDesign)}
                alt={curDesign.title || "Creator Market design"}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                className="absolute inset-0 h-full w-full object-cover animate-in fade-in duration-700"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 py-2 flex items-end justify-between gap-2">
                <span className="text-xs font-semibold text-white truncate">{curDesign.title || "Wrap design"}</span>
                {typeof curDesign.price === "number" && curDesign.price > 0 && (
                  <span className="text-xs font-bold text-cyan-300 shrink-0">${Number(curDesign.price).toFixed(0)}</span>
                )}
              </div>
            </a>
            {designs.length > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous design"
                  onClick={() => setDesignIdx((i) => i - 1)}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full bg-black/50 text-white/90 hover:bg-black/70 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next design"
                  onClick={() => setDesignIdx((i) => i + 1)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full bg-black/50 text-white/90 hover:bg-black/70 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </>
            )}
          </div>

          <a
            href="/creatormarket"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center justify-center gap-1.5 w-full rounded-lg py-2 text-xs font-semibold text-white bg-gradient-to-r from-blue-600 to-pink-500 hover:from-blue-500 hover:to-pink-400 transition-colors"
          >
            Browse all Creator Market designs
          </a>
        </div>
      )}

      {/* Step list */}
      <ol className="w-full flex flex-col gap-2">
        {STEPS.map((step, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          const Icon = step.icon;
          return (
            <li
              key={step.key}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                active && "bg-white/10 text-white",
                done && "text-white/70",
                !active && !done && "text-white/35",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                  active && "border-cyan-400 text-cyan-400",
                  done && "border-emerald-400/60 bg-emerald-400/15 text-emerald-300",
                  !active && !done && "border-white/20 text-white/35",
                )}
              >
                {done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : active ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Icon className="h-3.5 w-3.5" />
                )}
              </span>
              <span className="font-medium">{step.label}</span>
            </li>
          );
        })}
      </ol>

      <p className="text-[11px] text-white/40">
        {elapsed}s • A pro-grade design usually takes 20–60 seconds
      </p>
      {longWait && (
        <p className="text-[11px] text-cyan-300/70 text-center -mt-3">
          The server is still processing this run. You may safely leave this tab and
          return later; avoid starting a duplicate generation.
        </p>
      )}
    </div>
  );
}
