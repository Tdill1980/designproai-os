import type { VinylFinish } from "./types";
import { VINYL_FINISHES } from "./types";

interface VinylFinishSelectorProps {
  value: VinylFinish;
  onChange: (finish: VinylFinish) => void;
}

export function VinylFinishSelector({ value, onChange }: VinylFinishSelectorProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">Vinyl Finish</h4>
      <div className="flex flex-wrap gap-2">
        {VINYL_FINISHES.map((f) => (
          <button
            key={f.value}
            onClick={() => onChange(f.value)}
            className={`px-3 py-2 rounded-lg border transition-all text-left ${
              value === f.value
                ? 'bg-gradient-to-r from-blue-600 via-purple-600 to-fuchsia-600 border-transparent text-white'
                : 'border-border/30 hover:border-border'
            }`}
          >
            <span className={`text-xs font-medium block ${value === f.value ? 'text-blue-500' : 'text-foreground'}`}>
              {f.label}
            </span>
            <span className="text-xs text-muted-foreground">{f.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
