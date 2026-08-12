import { cn } from "@/lib/utils";

export type CoverageType = "quarter" | "half" | "full";

interface CoverageSelectorProps {
  coverageType: CoverageType;
  onCoverageChange: (coverage: CoverageType) => void;
}

const COVERAGE_OPTIONS: { value: CoverageType; label: string; sublabel: string }[] = [
  { value: "quarter", label: "1/4 Wrap", sublabel: "Rear panels" },
  { value: "half", label: "1/2 Wrap", sublabel: "Half vehicle" },
  { value: "full", label: "Full Wrap", sublabel: "All panels" },
];

export const CoverageSelector = ({ coverageType, onCoverageChange }: CoverageSelectorProps) => {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Wrap Coverage</h3>
      <div className="grid grid-cols-3 gap-3">
        {COVERAGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onCoverageChange(option.value)}
            className={cn(
              "rounded-lg border-2 transition-all p-3 flex flex-col items-center gap-1",
              coverageType === option.value
                ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                : "border-border hover:border-primary/50"
            )}
          >
            <span className={cn(
              "text-sm font-semibold",
              coverageType === option.value ? "text-primary" : "text-foreground"
            )}>
              {option.label}
            </span>
            <span className="text-[10px] text-muted-foreground leading-tight">
              {option.sublabel}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
