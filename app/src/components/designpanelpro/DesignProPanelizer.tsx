import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface OperatorPanelProps {
  projectId: string;
  renderId: string;
  /** Trim (visible) panel size in inches. Default: F-150 side = 227 × 76.4. */
  widthInches?: number;
  heightInches?: number;
  bleedInches?: number;
  panelName?: string;
  /** "cover" = proportionate (no squash), "fill" = exact stretch. */
  fit?: "exact" | "cover" | "fill";
  onPipelineLockConfirmed?: (panelId: string) => void;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export const DesignProPanelizer: React.FC<OperatorPanelProps> = ({
  projectId,
  renderId,
  widthInches = 227,
  heightInches = 76.4,
  bleedInches = 2,
  panelName = "DRIVER SIDE",
  fit = "cover",
  onPipelineLockConfirmed,
}) => {
  const [pipelineState, setPipelineState] = useState<"idle" | "running" | "success" | "failed">("idle");
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [outputMetrics, setOutputMetrics] = useState<{ w: number; h: number } | null>(null);

  const finalW = widthInches + bleedInches * 2;
  const finalH = heightInches + bleedInches * 2;

  const appendLog = (msg: string) =>
    setTerminalLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const executeUniversalMatrixPipeline = async () => {
    setPipelineState("running");
    setTerminalLogs([]);
    appendLog("DesignProAI interface validated.");
    appendLog(`Enforcing trim: ${widthInches}" × ${heightInches}" (+${bleedInches}" bleed → ${finalW}" × ${finalH}").`);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Operator session credentials missing or timed out.");

      appendLog("Bypassing vehicle clipping. Placing design pixel-accurate, proportionate...");

      const response = await fetch(`${SUPABASE_URL}/functions/v1/universal-panelizer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: ANON_KEY,
        },
        body: JSON.stringify({
          projectId,
          renderId,
          panelName,
          targetWidthInches: widthInches,
          targetHeightInches: heightInches,
          bleedInches,
          fit,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Edge calculation error.");

      const d = result.payload.dimensions;
      appendLog("Deterministic transform matrix generated.");
      appendLog(`Canvas locked: ${d.final_print_width_inches}" × ${d.final_print_height_inches}".`);
      appendLog("Asset queued → GENIE worker → ProductionFlow QC.");

      setOutputMetrics({ w: d.final_print_width_inches, h: d.final_print_height_inches });
      setPipelineState("success");
      onPipelineLockConfirmed?.(result.panelId);
    } catch (err: any) {
      appendLog(`Critical Error: ${err.message}`);
      setPipelineState("failed");
    }
  };

  return (
    <div className="w-full bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl text-slate-100 max-w-xl font-sans">
      <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-xs font-black tracking-widest text-blue-500 uppercase font-mono">DesignProAI Automation Layer</h2>
          <h1 className="text-lg font-bold text-white mt-1">UniversalPanelizer Print Interface</h1>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono text-xs px-2.5 py-1 rounded-md font-bold">
          Pipeline Connected
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6 font-mono text-center">
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
          <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">Trim Size</div>
          <div className="text-sm font-bold text-white">{widthInches}" × {heightInches}"</div>
        </div>
        <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
          <div className="text-[10px] uppercase text-slate-500 font-bold mb-1">Bleed Buffer</div>
          <div className="text-sm font-bold text-blue-400">+{bleedInches}" All Sides</div>
        </div>
        <div className="bg-slate-950 p-3 rounded-lg border border-blue-900/30 bg-gradient-to-br from-slate-950 to-blue-950/20">
          <div className="text-[10px] uppercase text-blue-400 font-bold mb-1">Print Envelope</div>
          <div className="text-sm font-bold text-emerald-400">{finalW}" × {finalH}"</div>
        </div>
      </div>

      <button
        onClick={executeUniversalMatrixPipeline}
        disabled={pipelineState === "running"}
        className={`w-full py-4 rounded-lg font-bold uppercase text-xs tracking-wider transition-all duration-150 ${
          pipelineState === "running"
            ? "bg-slate-800 text-slate-500 cursor-not-allowed"
            : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg active:scale-[0.995]"
        }`}
      >
        {pipelineState === "running" ? "Calculating Bounding Vectors..." : "Lock Pixel Layout & Build Print File"}
      </button>

      {terminalLogs.length > 0 && (
        <div className="mt-6">
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block mb-2 font-mono">Console Pipeline Stream</span>
          <div className="w-full bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-[11px] text-slate-400 space-y-1 max-h-36 overflow-y-auto">
            {terminalLogs.map((log, index) => (
              <div key={index} className={log.includes("Critical") ? "text-red-400" : log.includes("QC") ? "text-emerald-400 font-bold" : ""}>
                {log}
              </div>
            ))}
          </div>
        </div>
      )}

      {pipelineState === "success" && outputMetrics && (
        <div className="mt-6 bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4 flex justify-between items-center">
          <div>
            <span className="text-xs font-bold uppercase text-emerald-400 block tracking-wide">Asset Queued Into ProductionFlow</span>
            <span className="text-sm font-mono text-slate-200 mt-1 block">{outputMetrics.w}" × {outputMetrics.h}" Solid Rectangle Template</span>
          </div>
          <span className="text-[10px] uppercase font-mono font-bold bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/30 animate-pulse">
            QC Pending
          </span>
        </div>
      )}
    </div>
  );
};

export default DesignProPanelizer;
