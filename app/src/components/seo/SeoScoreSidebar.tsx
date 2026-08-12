import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, AlertCircle, Info } from "lucide-react";

export interface SeoFinding {
  id: string;
  severity: "good" | "improve" | "issue" | "critical";
  message: string;
  fix?: string;
}

interface SeoScoreSidebarProps {
  score: number | null;
  findings: SeoFinding[];
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  wordCount: number;
}

function severityIcon(s: SeoFinding["severity"]) {
  switch (s) {
    case "good":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "improve":
      return <Info className="h-4 w-4 text-blue-500" />;
    case "issue":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    case "critical":
      return <AlertCircle className="h-4 w-4 text-red-500" />;
  }
}

function scoreColor(s: number) {
  if (s >= 80) return "text-emerald-500";
  if (s >= 60) return "text-amber-500";
  if (s >= 40) return "text-orange-500";
  return "text-red-500";
}

function scoreBg(s: number) {
  if (s >= 80) return "bg-emerald-500";
  if (s >= 60) return "bg-amber-500";
  if (s >= 40) return "bg-orange-500";
  return "bg-red-500";
}

export function SeoScoreSidebar({
  score,
  findings,
  metaTitle,
  metaDescription,
  focusKeyword,
  wordCount,
}: SeoScoreSidebarProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">SEO Score</div>
        <div className={`text-5xl font-bold ${score === null ? "text-zinc-700" : scoreColor(score)}`}>
          {score === null ? "—" : score}
        </div>
        {score !== null && (
          <div className="mt-3 h-2 w-full bg-zinc-900 rounded-full overflow-hidden">
            <div
              className={`h-full ${scoreBg(score)} transition-all`}
              style={{ width: `${score}%` }}
            />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <div className="text-xs uppercase tracking-wide text-zinc-500">Live Meters</div>
        <Meter
          label="Meta title"
          value={metaTitle.length}
          min={30}
          max={60}
          good="50-60 chars"
        />
        <Meter
          label="Meta description"
          value={metaDescription.length}
          min={120}
          max={160}
          good="140-160 chars"
        />
        <Meter
          label="Word count"
          value={wordCount}
          min={600}
          max={3000}
          good="1200+ words"
          softMax
        />
        <div className="text-xs">
          <span className="text-zinc-500">Focus keyword: </span>
          <span className="text-zinc-200">{focusKeyword || "—"}</span>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="text-xs uppercase tracking-wide text-zinc-500 mb-3">
          Findings ({findings.length})
        </div>
        {findings.length === 0 ? (
          <p className="text-sm text-zinc-500">Run a scoring pass to see findings.</p>
        ) : (
          <ul className="space-y-3">
            {findings.map((f) => (
              <li key={f.id} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0">{severityIcon(f.severity)}</span>
                <div className="flex-1">
                  <p className="text-zinc-200">{f.message}</p>
                  {f.fix && <p className="text-xs text-zinc-500 mt-0.5">{f.fix}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Meter({
  label,
  value,
  min,
  max,
  good,
  softMax,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  good: string;
  softMax?: boolean;
}) {
  const isGood = value >= min && (softMax ? value >= min : value <= max);
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-zinc-300">{label}</span>
        <Badge variant={isGood ? "default" : "secondary"} className="text-[10px]">
          {value} / {good}
        </Badge>
      </div>
      <div className="mt-1 h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden">
        <div
          className={`h-full ${
            isGood ? "bg-emerald-500" : value < min ? "bg-amber-500" : "bg-orange-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
