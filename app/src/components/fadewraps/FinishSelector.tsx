import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FinishSelectorProps {
  selectedFinish: 'Gloss' | 'Satin' | 'Matte' | 'Sparkle';
  onFinishChange: (finish: 'Gloss' | 'Satin' | 'Matte' | 'Sparkle') => void;
}

const FINISHES = ['Gloss', 'Satin', 'Matte', 'Sparkle'] as const;

export const FinishSelector = ({ selectedFinish, onFinishChange }: FinishSelectorProps) => {
  return (
    <div className="space-y-3">
      <Label className="text-sm font-semibold">Lamination Finish</Label>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {FINISHES.map((finish) => (
          <button
            key={finish}
            onClick={() => onFinishChange(finish)}
            className={cn(
              "py-2.5 px-3 rounded-lg border-2 font-medium transition-all text-sm",
              selectedFinish === finish
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:border-primary/50"
            )}
          >
            {finish === 'Sparkle' ? '✨ Sparkle' : finish}
          </button>
        ))}
      </div>
      {selectedFinish === 'Sparkle' && (
        <p className="text-xs text-muted-foreground italic">
          Fine metallic sparkle visible on curves and highlights - not glitter or chrome
        </p>
      )}
    </div>
  );
};
