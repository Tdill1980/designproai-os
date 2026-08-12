import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const ACE_LOADING_MESSAGES = [
  "Studying your vision board references\u2026",
  "Mixing your color palette\u2026",
  "Rendering your wrap on the vehicle\u2026",
  "Adding finishing details\u2026",
  "Almost there — quality checking the output\u2026",
];

const ACE_COMPLETE_MESSAGE = "Your wrap is ready! Let's see how it looks";

const WRAP_FACTS = [
  "A single vehicle wrap generates up to 70,000 impressions per day",
  "The average ROI on a commercial wrap is 3,400%",
  "Cast vinyl conforms to curves without lifting or cracking",
  "Matte and satin finishes reduce glare for better street visibility",
  "A well-designed wrap lasts 5\u20137 years with proper care",
  "Fleet wraps cost less per impression than any other advertising",
  "Glossy finishes reflect light and make colors appear more vibrant",
  "The wrap industry is growing at over 20% annually worldwide",
  "Every inch of letter height gives 10 feet of readability distance",
  "Partial wraps can cover 25\u201375% of a vehicle at half the cost",
];

interface DesignIQProgressBarProps {
  /** 1 = generating panel, 2 = rendering on vehicle */
  phase: 1 | 2;
  /** total elapsed seconds since pipeline started */
  elapsedSeconds: number;
}

export const DesignIQProgressBar = ({
  phase,
  elapsedSeconds,
}: DesignIQProgressBarProps) => {
  const [factIndex, setFactIndex] = useState(
    () => Math.floor(Math.random() * WRAP_FACTS.length)
  );
  const [aceMsgIndex, setAceMsgIndex] = useState(0);
  const [aceMsgFading, setAceMsgFading] = useState(false);
  const [factFading, setFactFading] = useState(false);
  const estimatedTotal = 90;

  // Rotate ACE status messages every 3 seconds with fade
  useEffect(() => {
    const interval = setInterval(() => {
      setAceMsgFading(true);
      setTimeout(() => {
        setAceMsgIndex((p) => (p + 1) % ACE_LOADING_MESSAGES.length);
        setAceMsgFading(false);
      }, 500);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  // Rotate facts every 4.5 seconds with fade transition
  useEffect(() => {
    const interval = setInterval(() => {
      setFactFading(true);
      setTimeout(() => {
        setFactIndex((p) => (p + 1) % WRAP_FACTS.length);
        setFactFading(false);
      }, 300);
    }, 4500);
    return () => clearInterval(interval);
  }, []);

  // Simulated progress: asymptotic within each phase, never stops moving
  const baseProgress = phase === 1 ? 0 : 50;
  const phaseElapsed =
    phase === 1 ? elapsedSeconds : Math.max(0, elapsedSeconds - 20);
  // Two-rate approach: fast climb to ~45%, then slow crawl so bar never appears stuck
  const fastComponent = 45 * (1 - Math.exp(-phaseElapsed / 12));
  const slowCrawl = phaseElapsed > 30 ? (phaseElapsed - 30) * 0.08 : 0;
  const simulated = baseProgress + Math.min(fastComponent + slowCrawl, 49);
  const progress = Math.min(simulated, phase === 1 ? 49 : 98);

  const remaining = Math.max(1, estimatedTotal - elapsedSeconds);

  const isComplete = progress >= 98;

  return (
    <div className="rounded-xl overflow-hidden border border-blue-500/20 bg-card">
      {/* Neon Progress Bar */}
      <div className="h-2 w-full bg-secondary/50 relative overflow-hidden">
        <div
          className="h-full transition-all duration-1000 ease-out relative"
          style={{ width: `${progress}%` }}
        >
          {/* Animated gradient fill */}
          <div
            className="absolute inset-0 animate-gradient-x"
            style={{
              background: "linear-gradient(90deg, #22d3ee, #a855f7, #d946ef, #22d3ee)",
              backgroundSize: "200% 100%",
            }}
          />
          {/* Glow effect on leading edge */}
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white/40 to-transparent" />
        </div>
        {/* Shimmer overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
      </div>

      {/* Content */}
      <div className="p-5 sm:p-6 space-y-4">
        {/* ACE Character + Rotating Status */}
        <div className="flex flex-col items-center gap-3">
          <img
            src="/characters/ace-desk-branded.png"
            alt="ACE designing your wrap"
            className="max-w-[200px] h-auto object-contain animate-ace-bounce"
          />
          <p
            className={cn(
              "text-lg font-semibold text-center text-cyan-400 transition-opacity duration-500 min-h-[28px]",
              aceMsgFading ? "opacity-0" : "opacity-100"
            )}
          >
            {isComplete ? ACE_COMPLETE_MESSAGE : ACE_LOADING_MESSAGES[aceMsgIndex]}
          </p>
        </div>

        {/* Phase indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img
              src={phase === 1 ? "/characters/sproket/planet-purple.png" : "/characters/sproket/planet-teal.png"}
              alt="Loading"
              className="w-10 h-10 object-contain animate-pulse shrink-0"
            />
            <div>
              <p className="text-xs text-muted-foreground">
                Prompt-to-Production&#8482;
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-mono text-blue-400">
              {Math.round(progress)}%
            </p>
            <p className="text-xs text-muted-foreground">
              ~{remaining}s remaining
            </p>
          </div>
        </div>

        {/* Phase steps */}
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                phase === 1
                  ? "bg-blue-400 animate-pulse"
                  : "bg-blue-400"
              )}
            />
            <span
              className={cn(
                phase === 1
                  ? "text-blue-400 font-medium"
                  : "text-muted-foreground"
              )}
            >
              Rendering
            </span>
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                phase === 2
                  ? "bg-purple-400 animate-pulse"
                  : "bg-muted-foreground/30"
              )}
            />
            <span
              className={cn(
                phase === 2
                  ? "text-purple-400 font-medium"
                  : "text-muted-foreground"
              )}
            >
              Complete
            </span>
          </div>
        </div>

        {/* Rotating fact */}
        <div className="bg-secondary/40 rounded-lg p-3 border border-border/50 min-h-[52px] flex items-center">
          <p
            className={cn(
              "text-sm text-muted-foreground italic leading-relaxed transition-opacity duration-300",
              factFading ? "opacity-0" : "opacity-100"
            )}
          >
            &ldquo;{WRAP_FACTS[factIndex]}&rdquo;
          </p>
        </div>

        {/* DesignIQ branding */}
        <p className="text-[10px] text-center text-muted-foreground/50 font-poppins">
          DesignIQ&#8482;
        </p>
      </div>
    </div>
  );
};
