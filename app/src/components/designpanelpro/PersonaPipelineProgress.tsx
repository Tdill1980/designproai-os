import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Sparkles, Palette, Camera } from "lucide-react";

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

export type PersonaPipelinePhase =
  | "designer"
  | "photographer"
  | "complete";

interface PersonaPipelineProgressProps {
  phase: PersonaPipelinePhase;
  elapsedSeconds: number;
  photographerProgress?: { completed: number; total: number };
}

const PHASE_CONFIG: Record<
  PersonaPipelinePhase,
  { label: string; sublabel: string; icon: typeof Sparkles; progress: number }
> = {
  designer: {
    label: "Designing your wrap\u2026",
    sublabel: "Pro Wrap Designer \u2014 Creating hero shot",
    icon: Palette,
    progress: 40,
  },
  photographer: {
    label: "Shooting 6 angles\u2026",
    sublabel: "Automotive Photographer \u2014 Magazine-quality shots",
    icon: Camera,
    progress: 70,
  },
  complete: {
    label: "All views ready",
    sublabel: "6 magazine-quality shots complete",
    icon: Sparkles,
    progress: 100,
  },
};

export const PersonaPipelineProgress = ({
  phase,
  elapsedSeconds,
  photographerProgress,
}: PersonaPipelineProgressProps) => {
  const [factIndex, setFactIndex] = useState(
    () => Math.floor(Math.random() * WRAP_FACTS.length)
  );
  const [factFading, setFactFading] = useState(false);

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

  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;

  // Asymptotic progress within each phase
  const baseProgress = config.progress - 20;
  const phaseRange = 18;
  const simulated = baseProgress + phaseRange * (1 - Math.exp(-elapsedSeconds / 15));
  let progress = Math.min(simulated, config.progress);

  // For photographer, use actual shot count
  if (phase === "photographer" && photographerProgress) {
    const shotPct = photographerProgress.completed / photographerProgress.total;
    progress = 40 + shotPct * 58;
  }

  if (phase === "complete") progress = 100;

  const phases: PersonaPipelinePhase[] = ["designer", "photographer", "complete"];
  const phaseIndex = phases.indexOf(phase);

  return (
    <div className="rounded-xl overflow-hidden border border-blue-500/20 bg-card">
      {/* Neon Progress Bar */}
      <div className="h-2 w-full bg-secondary/50 relative overflow-hidden">
        <div
          className="h-full transition-all duration-1000 ease-out relative"
          style={{ width: `${progress}%` }}
        >
          <div
            className="absolute inset-0 animate-gradient-x"
            style={{
              background:
                "linear-gradient(90deg, #22d3ee, #a855f7, #d946ef, #22d3ee)",
              backgroundSize: "200% 100%",
            }}
          />
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white/40 to-transparent" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
      </div>

      <div className="p-5 sm:p-6 space-y-4">
        {/* Phase indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
              <Icon
                className={cn(
                  "w-4 h-4 text-blue-400",
                  phase !== "complete" && "animate-pulse"
                )}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                {config.label}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {config.sublabel}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-mono text-blue-400">
              {Math.round(progress)}%
            </p>
            {phase === "photographer" && photographerProgress && (
              <p className="text-[11px] text-muted-foreground">
                {photographerProgress.completed}/{photographerProgress.total} shots
              </p>
            )}
          </div>
        </div>

        {/* Phase steps - 3-step chain */}
        <div className="flex items-center gap-2 text-xs">
          {phases.map((p, i) => {
            const isActive = i === phaseIndex;
            const isDone = i < phaseIndex;
            const labels = ["Design", "Photo", "Done"];
            return (
              <div key={p} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0 transition-colors",
                      isDone
                        ? "bg-blue-400"
                        : isActive
                          ? "bg-blue-400 animate-pulse"
                          : "bg-muted-foreground/30"
                    )}
                  />
                  <span
                    className={cn(
                      "truncate",
                      isDone || isActive
                        ? "text-blue-400 font-medium"
                        : "text-muted-foreground"
                    )}
                  >
                    {labels[i]}
                  </span>
                </div>
                {i < phases.length - 1 && (
                  <div
                    className={cn(
                      "flex-1 h-px",
                      isDone ? "bg-blue-400/50" : "bg-border"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Rotating fact */}
        <div className="bg-secondary/40 rounded-lg p-3 border border-border/50 min-h-[52px] flex items-center">
          <p
            className={cn(
              "text-xs text-muted-foreground italic leading-relaxed transition-opacity duration-300",
              factFading ? "opacity-0" : "opacity-100"
            )}
          >
            &ldquo;{WRAP_FACTS[factIndex]}&rdquo;
          </p>
        </div>

        <p className="text-[10px] text-center text-muted-foreground/50">
          GENIE&#8482; Universal Panelizer
        </p>
      </div>
    </div>
  );
};
