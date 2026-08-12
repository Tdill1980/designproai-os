import { cn } from "@/lib/utils";
import type { PackPanel } from "@/lib/panelizer-config";

/**
 * PanelizerProgressDiagram - Glowing panel layout that lights up as each panel completes.
 *
 * Shows a representative paneling diagram with each zone glowing darker neon blue
 * as UniversalPanelizer finishes processing it.
 * Tagline: "When All Panels Glow, It's a Go"
 */
interface PanelizerProgressDiagramProps {
  panels: PackPanel[];
  completedCount: number;
  totalCount: number;
  status: "pending" | "processing" | "complete" | "failed";
}

export function PanelizerProgressDiagram({
  panels,
  completedCount,
  totalCount,
  status,
}: PanelizerProgressDiagramProps) {
  const isComplete = status === "complete";
  const isProcessing = status === "processing";

  // Map panels to their completion state based on order
  const getPanelState = (index: number): "pending" | "active" | "done" => {
    if (isComplete) return "done";
    if (index < completedCount) return "done";
    if (index === completedCount && isProcessing) return "active";
    return "pending";
  };

  // Group panels for layout
  const sidePanels = panels.filter((p) => p.id === "driver-side" || p.id === "passenger-side");
  const topPanels = panels.filter((p) => p.id === "hood" || p.id === "roof");
  const bottomPanels = panels.filter(
    (p) => p.id === "front-bumper" || p.id === "rear" || p.id === "rear-bumper"
  );

  // Find each panel's index in the flat list
  const panelIndex = (id: string) => panels.findIndex((p) => p.id === id);

  const renderZone = (panel: PackPanel) => {
    const idx = panelIndex(panel.id);
    const state = getPanelState(idx);
    const isDone = state === "done";
    const isActive = state === "active";
    const isPending = state === "pending";

    return (
      <div
        key={panel.id}
        className={cn(
          "relative rounded transition-all duration-700 flex flex-col items-center justify-center text-center p-1.5",
          isDone && "border-2 border-blue-600 bg-blue-700/20 shadow-[0_0_18px_rgba(0,100,200,0.6),inset_0_0_22px_rgba(0,80,180,0.18)]",
          isActive && "border-2 border-blue-600/60 bg-blue-700/10 shadow-[0_0_14px_rgba(0,100,200,0.35)] animate-pulse",
          isPending && "border border-zinc-700 bg-zinc-800/40"
        )}
        style={{ minHeight: 36 }}
      >
        <span
          className={cn(
            "text-[9px] font-bold tracking-wide uppercase leading-tight",
            isDone && "text-blue-400",
            isActive && "text-blue-500/80",
            isPending && "text-zinc-600"
          )}
          style={isDone ? { textShadow: "0 0 10px rgba(0, 100, 200, 0.7)" } : undefined}
        >
          {panel.label.replace(/ \(.*\)/, "")}
        </span>
        {panel.widthInches > 0 && panel.heightInches > 0 && (
          <span
            className={cn(
              "text-[7px] leading-tight mt-0.5",
              isDone && "text-blue-500/60",
              isActive && "text-blue-600/40",
              isPending && "text-zinc-700"
            )}
          >
            {panel.widthInches}" x {panel.heightInches}"
          </span>
        )}
        {panel.mirrored && (
          <span
            className={cn(
              "text-[7px] leading-tight",
              isDone ? "text-blue-500/50" : "text-zinc-700"
            )}
          >
            mirrored
          </span>
        )}
        {/* Checkmark for done */}
        {isDone && (
          <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-blue-600 rounded-full flex items-center justify-center shadow-[0_0_10px_rgba(0,100,200,0.7)]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* UniversalPanelizer header */}
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(0, 120, 200, 0.9)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
          <span className="text-[10px] sm:text-xs font-bold tracking-widest uppercase text-blue-500" style={{ textShadow: "0 0 10px rgba(0, 100, 200, 0.5)" }}>
            GENIE Production Panelizer OS
          </span>
          {isComplete && (
            <span className="text-[9px] sm:text-[10px] font-semibold text-green-400 bg-green-500/10 px-1.5 sm:px-2 py-0.5 rounded border border-green-500/20">
              Complete
            </span>
          )}
          {isProcessing && (
            <span className="text-[9px] sm:text-[10px] font-semibold text-blue-400 bg-blue-600/10 px-1.5 sm:px-2 py-0.5 rounded border border-blue-600/20 animate-pulse">
              Processing
            </span>
          )}
        </div>
        {/* Tagline */}
        <span className="text-[7px] sm:text-[8px] font-semibold tracking-wider uppercase ml-6" style={{
          color: isComplete ? "#16a34a" : "rgba(0, 100, 180, 0.5)",
          textShadow: isComplete ? "0 0 8px rgba(22, 163, 106, 0.5)" : "none",
        }}>
          {isComplete ? "All Panels Glow - It's a Go" : "When All Panels Glow, It's a Go"}
        </span>
      </div>

      {/* Panel diagram */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
        {/* Side panels row */}
        {sidePanels.length > 0 && (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${sidePanels.length}, 1fr)` }}>
            {sidePanels.map(renderZone)}
          </div>
        )}

        {/* Top panels row (hood + roof) */}
        {topPanels.length > 0 && (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${topPanels.length}, 1fr)` }}>
            {topPanels.map(renderZone)}
          </div>
        )}

        {/* Bottom panels row (bumpers + rear) */}
        {bottomPanels.length > 0 && (
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${bottomPanels.length}, 1fr)` }}>
            {bottomPanels.map(renderZone)}
          </div>
        )}
      </div>

      {/* Status text */}
      <p className="text-[10px] text-center text-zinc-500">
        {isComplete
          ? "All panels print-ready. Each zone has been processed and exported."
          : isProcessing
          ? `As GENIE Production Panelizer OS finishes a panel, it glows. ${completedCount}/${totalCount} panels complete.`
          : "Panels will light up as they are processed."}
      </p>
    </div>
  );
}
