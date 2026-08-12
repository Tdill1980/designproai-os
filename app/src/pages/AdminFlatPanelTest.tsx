/**
 * AdminFlatPanelTest — Standalone sandbox: Prompt → Flat Print-Ready Panels
 *
 * Two-column layout:
 *   Left sidebar: ACE assistant (typewriter intro + rotating messages) + pipeline status
 *   Main area: input form (fills space) → generated panels
 */

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Loader2, CheckCircle2, XCircle, Sparkles } from "lucide-react";

interface PanelResult {
  name: string;
  url: string;
  width_inches: number;
  height_inches: number;
  width_px: number;
  height_px: number;
  method: string;
  duration_ms?: number;
  note?: string;
}

type StepStatus = "pending" | "running" | "done" | "error";
interface ProgressStep {
  label: string;
  status: StepStatus;
  detail?: string;
}

interface RecentGen {
  id: string;
  raw_prompt: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: string;
  hero_render_url: string;
  design_name: string | null;
  finish: string;
}

/* ── ACE messages ── */
const ACE_INTRO = "Hi, I'm ACE! I'll turn your design into flat print-ready panels.";

const ACE_IDLE_MESSAGES = [
  "Enter a prompt and vehicle to get started!",
  "I can generate Driver, Passenger, Hood, Roof & Rear panels.",
  "Tip: Be descriptive — colors, textures, themes all help.",
  "I'll auto-rewrite your prompt for optimal flat panel output.",
];

const ACE_WORKING_MESSAGES = [
  "Studying your design vision...",
  "Mixing your color palette...",
  "Crafting flat panel artwork...",
  "Adding finishing details...",
  "Almost there — quality checking...",
];

const ACE_DONE_MESSAGE = "Your panels are ready! Take a look.";

/* ── Typewriter hook ── */
function useTypewriter(text: string, speed = 40) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) {
        setDone(true);
        clearInterval(interval);
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return { displayed, done };
}

export default function AdminFlatPanelTest() {
  // Inputs
  const [prompt, setPrompt] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [finish, setFinish] = useState("Gloss");
  const [referenceUrl, setReferenceUrl] = useState("");

  // Recent generations for quick-pick
  const [recentGens, setRecentGens] = useState<RecentGen[]>([]);
  const [showRecent, setShowRecent] = useState(false);

  // Pipeline state
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [rewrittenPrompt, setRewrittenPrompt] = useState("");
  const [panels, setPanels] = useState<PanelResult[]>([]);
  const [vehicleInfo, setVehicleInfo] = useState<any>(null);

  const resultsRef = useRef<HTMLDivElement>(null);

  // ACE rotating messages
  const [aceMsgIndex, setAceMsgIndex] = useState(0);
  const [aceMsgFading, setAceMsgFading] = useState(false);
  const aceState = running ? "working" : panels.length > 0 ? "done" : "idle";

  // Typewriter for intro
  const { displayed: introText, done: introDone } = useTypewriter(ACE_INTRO, 35);

  // Rotate ACE messages every 3.5s
  useEffect(() => {
    const msgs = aceState === "working" ? ACE_WORKING_MESSAGES : ACE_IDLE_MESSAGES;
    const interval = setInterval(() => {
      setAceMsgFading(true);
      setTimeout(() => {
        setAceMsgIndex((p) => (p + 1) % msgs.length);
        setAceMsgFading(false);
      }, 400);
    }, 3500);
    return () => clearInterval(interval);
  }, [aceState]);

  // Reset message index when state changes
  useEffect(() => {
    setAceMsgIndex(0);
  }, [aceState]);

  const aceMessage = aceState === "done"
    ? ACE_DONE_MESSAGE
    : (aceState === "working" ? ACE_WORKING_MESSAGES : ACE_IDLE_MESSAGES)[aceMsgIndex];

  // Load recent generations
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("designiq_generations")
        .select("id, raw_prompt, vehicle_make, vehicle_model, vehicle_year, hero_render_url, design_name, finish")
        .not("hero_render_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(12);
      if (data) setRecentGens(data as RecentGen[]);
    })();
  }, []);

  const pickGeneration = (gen: RecentGen) => {
    setPrompt(gen.raw_prompt || "");
    setVehicleMake(gen.vehicle_make || "");
    setVehicleModel(gen.vehicle_model || "");
    setVehicleYear(gen.vehicle_year || "");
    setFinish(gen.finish || "Gloss");
    setReferenceUrl(gen.hero_render_url || "");
    setShowRecent(false);
    setPanels([]);
    setSteps([]);
  };

  // One-click pipeline: rewrite → dimensions → generate panels
  const runPipeline = async () => {
    if (!prompt.trim() || !vehicleMake || !vehicleModel) return;

    setRunning(true);
    setPanels([]);
    setRewrittenPrompt("");
    setVehicleInfo(null);

    const pSteps: ProgressStep[] = [
      { label: "Rewriting prompt for flat panels", status: "running" },
      { label: "Looking up vehicle dimensions", status: "pending" },
      { label: "Generating Driver Side", status: "pending" },
      { label: "Generating Hood", status: "pending" },
      { label: "Generating Roof", status: "pending" },
      { label: "Generating Rear", status: "pending" },
      { label: "Mirroring Passenger Side", status: "pending" },
    ];
    setSteps([...pSteps]);

    try {
      // Step 1: Rewrite prompt
      const { data: rewriteData, error: rewriteErr } = await supabase.functions.invoke("prompt-rewriter", {
        body: { customer_prompt: prompt, finish },
      });

      if (rewriteErr || !rewriteData?.rewritten) {
        pSteps[0].status = "error";
        pSteps[0].detail = rewriteData?.error || rewriteErr?.message || "Failed";
        setSteps([...pSteps]);
        throw new Error("Prompt rewrite failed");
      }

      pSteps[0].status = "done";
      pSteps[0].detail = `${rewriteData.char_count} chars`;
      pSteps[1].status = "running";
      setSteps([...pSteps]);
      setRewrittenPrompt(rewriteData.rewritten);

      // Step 2-7: Generate panels (edge function handles dimensions + generation)
      const { data: genData, error: genErr } = await supabase.functions.invoke("generate-flat-panel-test", {
        body: {
          rewritten_prompt: rewriteData.rewritten,
          finish,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          vehicle_year: vehicleYear,
          render_url: referenceUrl || undefined,
        },
      });

      if (genErr || !genData?.success) {
        pSteps.forEach((s) => {
          if (s.status !== "done") s.status = "error";
        });
        pSteps[1].detail = genData?.error || genErr?.message || "Failed";
        setSteps([...pSteps]);
        throw new Error(genData?.error || "Panel generation failed");
      }

      // Mark all done
      pSteps.forEach((s) => { s.status = "done"; });
      if (genData.vehicle) {
        pSteps[1].detail = `${genData.vehicle.sku} — ${genData.vehicle.source}`;
        setVehicleInfo(genData.vehicle);
      }
      genData.panels?.forEach((p: PanelResult) => {
        const step = pSteps.find((s) => s.label.includes(p.name));
        if (step && p.duration_ms) {
          step.detail = `${(p.duration_ms / 1000).toFixed(1)}s`;
        }
        if (p.method === "mirrored_from_driver") {
          const mirrorStep = pSteps.find((s) => s.label.includes("Mirroring"));
          if (mirrorStep) mirrorStep.detail = "instant flip";
        }
      });
      setSteps([...pSteps]);
      setPanels(genData.panels || []);

      // Scroll to results
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);

    } catch (err: any) {
      console.error("[FlatPanelTest] Pipeline error:", err);
    }

    setRunning(false);
  };

  const reset = () => {
    setPrompt("");
    setVehicleMake("");
    setVehicleModel("");
    setVehicleYear("");
    setFinish("Gloss");
    setReferenceUrl("");
    setPanels([]);
    setSteps([]);
    setRewrittenPrompt("");
    setVehicleInfo(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6 overflow-x-hidden">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-cyan-400" />
          Flat Panel Generator — Sandbox
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Prompt → flat print-ready wrap panels via Gemini
        </p>
      </div>

      {/* ACE Card — mobile: top banner, desktop: in sidebar */}
      <div className="sm:hidden mb-4">
        <Card className="p-4 border-cyan-500/20">
          <div className="flex items-center gap-3">
            <img
              src="/characters/ace-desk-branded.png"
              alt="ACE"
              className={cn("w-16 h-auto object-contain", running && "animate-bounce")}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-cyan-400 min-h-[20px]">
                {introText}
                {!introDone && <span className="animate-pulse">|</span>}
              </p>
              {introDone && (
                <p className={cn(
                  "text-xs text-muted-foreground transition-opacity duration-400 mt-1",
                  aceMsgFading ? "opacity-0" : "opacity-100"
                )}>
                  {aceMessage}
                </p>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Two-column layout */}
      <div className="flex gap-6">
        {/* LEFT SIDEBAR — ACE + Progress (desktop only) */}
        <div className="hidden sm:block w-72 shrink-0 space-y-4">
          {/* ACE Character Card — always visible */}
          <Card className="p-4 border-cyan-500/20">
            <div className="flex flex-col items-center gap-3">
              <img
                src="/characters/ace-desk-branded.png"
                alt="ACE"
                className={cn(
                  "w-32 h-auto object-contain",
                  running && "animate-bounce"
                )}
              />
              {/* Typewriter intro */}
              <p className="text-sm font-semibold text-cyan-400 text-center min-h-[40px]">
                {introText}
                {!introDone && <span className="animate-pulse">|</span>}
              </p>
              {/* Rotating status message */}
              {introDone && (
                <p
                  className={cn(
                    "text-xs text-muted-foreground text-center transition-opacity duration-400 min-h-[32px]",
                    aceMsgFading ? "opacity-0" : "opacity-100"
                  )}
                >
                  {aceMessage}
                </p>
              )}
            </div>
          </Card>

          {/* Pipeline Status — shows when running or complete */}
          {steps.length > 0 && (
            <Card className="p-4 space-y-2 font-mono text-xs">
              <h3 className="text-sm font-semibold text-foreground mb-2">Pipeline Status</h3>
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-2">
                  {step.status === "done" && <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                  {step.status === "running" && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />}
                  {step.status === "pending" && <span className="w-3.5 h-3.5 rounded-full border border-border shrink-0" />}
                  {step.status === "error" && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                  <span className={`text-[11px] ${step.status === "done" ? "text-foreground" : step.status === "error" ? "text-red-400" : "text-muted-foreground"}`}>
                    {step.label}
                  </span>
                  {step.detail && <span className="text-[9px] text-muted-foreground ml-auto">{step.detail}</span>}
                </div>
              ))}
            </Card>
          )}

          {/* Rewritten prompt */}
          {rewrittenPrompt && (
            <Card className="p-4">
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">Rewritten Prompt</h3>
              <p className="text-[11px] text-foreground/80 leading-relaxed">{rewrittenPrompt}</p>
            </Card>
          )}

          {/* Vehicle info */}
          {vehicleInfo && (
            <Card className="p-4">
              <h3 className="text-xs font-semibold text-muted-foreground mb-1">Vehicle</h3>
              <p className="text-xs text-foreground">
                {vehicleInfo.year} {vehicleInfo.make} {vehicleInfo.model}
              </p>
              <p className="text-[11px] text-muted-foreground">SKU: {vehicleInfo.sku}</p>
              <p className="text-[11px] text-muted-foreground">Source: {vehicleInfo.source}</p>
            </Card>
          )}
        </div>

        {/* MAIN AREA — Input form + Results */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* INPUT SECTION — fills available space */}
          {panels.length === 0 && (
            <Card className="p-6 sm:p-8 space-y-5">
              {/* Quick pick from recent renders */}
              {recentGens.length > 0 && (
                <div>
                  <Button variant="outline" size="sm" onClick={() => setShowRecent(!showRecent)}>
                    {showRecent ? "Hide" : "Pick from recent renders"}
                  </Button>
                  {showRecent && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-3 max-h-[300px] overflow-y-auto">
                      {recentGens.map((gen) => (
                        <button
                          key={gen.id}
                          onClick={() => pickGeneration(gen)}
                          className="text-left rounded-lg border border-border bg-card p-2 hover:border-cyan-500/50 transition-all"
                        >
                          {gen.hero_render_url && (
                            <img src={gen.hero_render_url} alt="" className="w-full h-20 object-cover rounded mb-1" />
                          )}
                          <p className="text-[10px] font-semibold truncate">{gen.design_name || gen.raw_prompt?.slice(0, 30)}</p>
                          <p className="text-[9px] text-muted-foreground">{gen.vehicle_year} {gen.vehicle_make} {gen.vehicle_model}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Prompt — large textarea */}
              <div>
                <Label className="text-sm font-semibold">Design Prompt</Label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="mt-2 w-full bg-card border border-border rounded-lg px-4 py-3 text-sm min-h-[160px] resize-y"
                  placeholder="e.g. cyberpunk spaceship with neon accents, galaxy theme, matte black stealth..."
                />
              </div>

              {/* Vehicle + Finish — larger inputs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <Label className="text-xs font-medium">Year</Label>
                  <Input value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} placeholder="2022" className="mt-1 h-11" />
                </div>
                <div>
                  <Label className="text-xs font-medium">Make</Label>
                  <Input value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} placeholder="Ford" className="mt-1 h-11" />
                </div>
                <div>
                  <Label className="text-xs font-medium">Model</Label>
                  <Input value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} placeholder="F-150" className="mt-1 h-11" />
                </div>
                <div>
                  <Label className="text-xs font-medium">Finish</Label>
                  <select
                    value={finish}
                    onChange={(e) => setFinish(e.target.value)}
                    className="mt-1 w-full bg-card border border-border rounded-lg px-3 py-2 text-sm h-11"
                  >
                    <option value="Gloss">Gloss</option>
                    <option value="Satin">Satin</option>
                    <option value="Matte">Matte</option>
                  </select>
                </div>
              </div>

              {/* Optional reference render */}
              {referenceUrl && (
                <div>
                  <Label className="text-xs text-muted-foreground">Reference Render (Gemini will match this design)</Label>
                  <img src={referenceUrl} alt="Reference" className="w-full max-w-lg h-auto rounded-lg border border-border mt-1" />
                  <Button variant="ghost" size="sm" className="mt-1 text-xs text-muted-foreground" onClick={() => setReferenceUrl("")}>
                    Remove reference
                  </Button>
                </div>
              )}

              {/* GENERATE BUTTON */}
              <Button
                onClick={runPipeline}
                disabled={running || !prompt.trim() || !vehicleMake || !vehicleModel}
                size="lg"
                className="w-full bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600 text-white text-lg h-14"
              >
                {running ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Sparkles className="w-5 h-5 mr-2" />}
                {running ? "Generating Flat Panels..." : "Generate Flat Panels"}
              </Button>
            </Card>
          )}

          {/* Mobile pipeline status — below form */}
          {steps.length > 0 && (
            <div className="sm:hidden">
              <Card className="p-4 space-y-2 font-mono text-xs">
                <h3 className="text-sm font-semibold text-foreground mb-2">Pipeline Status</h3>
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {step.status === "done" && <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                    {step.status === "running" && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />}
                    {step.status === "pending" && <span className="w-3.5 h-3.5 rounded-full border border-border shrink-0" />}
                    {step.status === "error" && <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                    <span className={`text-[11px] ${step.status === "done" ? "text-foreground" : step.status === "error" ? "text-red-400" : "text-muted-foreground"}`}>
                      {step.label}
                    </span>
                    {step.detail && <span className="text-[9px] text-muted-foreground ml-auto">{step.detail}</span>}
                  </div>
                ))}
              </Card>
            </div>
          )}

          {/* RESULTS — replaces form after generation */}
          {panels.length > 0 && (
            <div ref={resultsRef} className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Generated Panels</h2>
                <div className="flex gap-2">
                  <Button onClick={() => { setPanels([]); setSteps([]); }} variant="outline" size="sm">
                    Edit Prompt
                  </Button>
                  <Button onClick={reset} variant="outline" size="sm">
                    Start Over
                  </Button>
                </div>
              </div>

              {/* Reference render if present */}
              {referenceUrl && (
                <Card className="p-4">
                  <Label className="text-xs text-muted-foreground mb-1 block">Reference 3D Render</Label>
                  <img src={referenceUrl} alt="Reference" className="w-full max-w-2xl rounded-lg border border-border" />
                </Card>
              )}

              {/* Each panel */}
              {panels.map((panel) => (
                <Card key={panel.name} className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold">{panel.name}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {panel.width_inches}" x {panel.height_inches}"
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {panel.width_px} x {panel.height_px}px
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${panel.method === "mirrored_from_driver" ? "text-yellow-400 border-yellow-400/30" : "text-green-400 border-green-400/30"}`}
                    >
                      {panel.method === "mirrored_from_driver" ? "Mirrored" : "Gemini"}
                    </Badge>
                    {panel.duration_ms && (
                      <span className="text-[10px] text-muted-foreground">{(panel.duration_ms / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                  <div className="border border-border rounded-lg overflow-hidden bg-white">
                    <img
                      src={panel.url}
                      alt={panel.name}
                      className={`w-full h-auto ${panel.method === "mirrored_from_driver" ? "scale-x-[-1]" : ""}`}
                    />
                  </div>
                </Card>
              ))}

              {/* Bottom actions */}
              <div className="flex gap-3">
                <Button onClick={runPipeline} variant="outline" disabled={running} size="lg">
                  Generate Again
                </Button>
                <Button onClick={reset} variant="outline" size="lg">
                  Start Over
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
