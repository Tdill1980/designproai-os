/**
 * RevisionProgress — a live, visible progress bar shown WHILE a revision (or a
 * fresh design) is being generated. Used on BOTH sides of ApprovePro:
 *
 *   • CUSTOMER side — inside the ACE genie (AceRevisionRobot): whole-image
 *     revise (proof-revise-ai) and the precise spot edit (revise-render-masked).
 *   • ADMIN side — in the ApprovePro workbench while A.C.E is generating
 *     (metadata.autogen_status === "running", or a manual Regenerate).
 *
 * There are no real server-sent progress events for these single-shot renders,
 * so the bar is TIME-BASED: it climbs asymptotically toward ~96% over the
 * expected duration (never stalls, never hits 100% until the work actually
 * finishes) and the parent unmounts/hides it when the render lands. This gives
 * the customer and the shop the "I can see it's working" feedback they asked
 * for without lying about exact completion.
 *
 * `variant`:
 *   "dark"  — for the ACE genie overlay (cyan→magenta on translucent dark).
 *   "light" — for the white admin workbench (blue→magenta accent per the
 *             WHITE UI standard).
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const DEFAULT_MESSAGES = [
  "Reading your change…",
  "Repainting the design…",
  "Keeping everything else exactly as it was…",
  "Rendering the update…",
  "Almost there — quality-checking…",
];

interface RevisionProgressProps {
  /** While true the bar animates; flip to false (or unmount) when the render lands. */
  active: boolean;
  /** Expected duration in seconds (the bar paces itself to this). Default 55. */
  estimateSeconds?: number;
  variant?: "dark" | "light";
  /** Small label above the bar (e.g. "ACE is working" / "A.C.E is generating"). */
  label?: string;
  /** Rotating status lines. Defaults to a generic revise sequence. */
  messages?: string[];
  /** Slim mode — just the bar + %, no rotating copy (for tight overlays). */
  compact?: boolean;
  className?: string;
}

export const RevisionProgress = ({
  active,
  estimateSeconds = 55,
  variant = "dark",
  label,
  messages = DEFAULT_MESSAGES,
  compact = false,
  className,
}: RevisionProgressProps) => {
  const [elapsed, setElapsed] = useState(0);
  const [msgIndex, setMsgIndex] = useState(0);
  const startRef = useRef<number>(0);

  // Drive the clock only while active; reset cleanly each time it (re)starts.
  useEffect(() => {
    if (!active) return;
    startRef.current = Date.now();
    setElapsed(0);
    setMsgIndex(0);
    const tick = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
    }, 200);
    const rotate = setInterval(() => {
      setMsgIndex((p) => (p + 1) % messages.length);
    }, 3200);
    return () => { clearInterval(tick); clearInterval(rotate); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!active) return null;

  // Asymptotic climb toward a 96% cap — fast at first, never stalls, never
  // pretends to finish before the real render does.
  const tau = Math.max(6, estimateSeconds / 3);
  const pct = Math.min(96, 96 * (1 - Math.exp(-elapsed / tau)));
  const remaining = Math.max(1, Math.round(estimateSeconds - elapsed));

  const dark = variant === "dark";
  const gradient = dark
    ? "linear-gradient(90deg,#22d3ee,#a855f7,#d946ef,#22d3ee)"
    : "linear-gradient(90deg,#3b82f6,#ec4899)";

  return (
    <div
      className={cn(
        "w-full rounded-xl overflow-hidden border",
        dark ? "border-white/10 bg-white/5" : "border-gray-200 bg-white shadow-sm",
        className,
      )}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label || "Generating revision"}
    >
      {/* Bar */}
      <div className={cn("relative h-2 w-full overflow-hidden", dark ? "bg-white/10" : "bg-gray-100")}>
        <div className="h-full transition-all duration-700 ease-out relative" style={{ width: `${pct}%` }}>
          <div
            className="absolute inset-0 animate-gradient-x"
            style={{ background: gradient, backgroundSize: "200% 100%" }}
          />
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white/50 to-transparent" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
      </div>

      {!compact && (
        <div className="px-3.5 py-2.5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            {label && (
              <p className={cn("text-[10px] font-bold uppercase tracking-wider", dark ? "text-cyan-300" : "text-gray-500")}>
                {label}
              </p>
            )}
            <p className={cn("text-[13px] leading-snug truncate", dark ? "text-white/90" : "text-gray-700")}>
              {messages[msgIndex]}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className={cn("text-sm font-mono", dark ? "text-cyan-200" : "text-blue-600")}>{Math.round(pct)}%</p>
            <p className={cn("text-[11px]", dark ? "text-white/40" : "text-gray-400")}>~{remaining}s left</p>
          </div>
        </div>
      )}

      {compact && (
        <div className="px-3 py-1.5 flex items-center justify-between">
          <span className={cn("text-[12px]", dark ? "text-white/80" : "text-gray-600")}>{messages[msgIndex]}</span>
          <span className={cn("text-[12px] font-mono", dark ? "text-cyan-200" : "text-blue-600")}>{Math.round(pct)}% · ~{remaining}s</span>
        </div>
      )}
    </div>
  );
};
