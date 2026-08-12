import { type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  unit?: string;
  /** 0–100. Rendered as a thin gradient progress bar beneath the value. */
  progress?: number;
  /** Optional trend label like "+12 vs last week". */
  trend?: string;
  trendPositive?: boolean;
  /** When true the value number gets the magenta→blue pop gradient. */
  highlighted?: boolean;
}

export const KpiCard = ({
  icon: Icon,
  label,
  value,
  unit,
  progress,
  trend,
  trendPositive = true,
  highlighted = false,
}: KpiCardProps) => {
  return (
    <div className="relative rounded-2xl border border-[#48484a] bg-rp-surface p-4 h-full transition hover:border-[#48484a]">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-rp-elevated border border-[#48484a] flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-[#60A5FA]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.15em] text-white/70 font-semibold truncate">
            {label}
          </div>
          <div className="flex flex-col gap-0.5 mt-1 min-w-0">
            <span
              className={cn(
                "text-xl sm:text-2xl font-bold leading-tight tracking-tight break-words",
                highlighted
                  ? "bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent"
                  : "text-white"
              )}
              title={String(value)}
            >
              {value}
            </span>
            {unit && (
              <span className="text-[10px] text-white/70 font-inter truncate">
                {unit}
              </span>
            )}
          </div>
        </div>
      </div>

      {progress !== undefined && (
        <div className="mt-3 h-1 rounded-full bg-rp-elevated overflow-hidden">
          <div
            className="h-full bg-gradient-blue-deep transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      )}

      {trend && (
        <div className="mt-2 text-[11px] font-medium font-inter">
          <span className={trendPositive ? "text-[#60A5FA]" : "text-[#F87171]"}>
            {trend}
          </span>
        </div>
      )}
    </div>
  );
};
