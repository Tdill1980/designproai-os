import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

const STANDARD_FINISHES = [
  { value: 'Gloss', label: 'Gloss', icon: '✨' },
  { value: 'Satin', label: 'Satin', icon: '💎' },
  { value: 'Matte', label: 'Matte', icon: '🎨' }
];

const FINISHES_3M = [
  { value: 'All', label: 'All Finishes', icon: '🎯' },
  { value: 'Gloss', label: 'Gloss', icon: '✨' },
  { value: 'Satin', label: 'Satin', icon: '💎' },
  { value: 'Matte', label: 'Matte', icon: '🎨' },
  { value: 'Flip', label: 'Flip', icon: '🔄' },
  { value: 'Brushed', label: 'Brushed', icon: '🖌️' },
  { value: 'Textured', label: 'Textured', icon: '🧱' }
];

interface FinishSelectorProps {
  value: string;
  onChange: (finish: string) => void;
  colorLibrary?: 'inkfusion' | 'avery' | '3m';
}

export function FinishSelector({ value, onChange, colorLibrary = 'inkfusion' }: FinishSelectorProps) {
  const finishes = colorLibrary === '3m' ? FINISHES_3M : STANDARD_FINISHES;
  const gridCols = colorLibrary === '3m' ? 'grid-cols-4' : 'grid-cols-3';
  
  return (
    <div className="space-y-3">
      <Label>Finish Type</Label>
      <RadioGroup value={value} onValueChange={onChange} className={`grid ${gridCols} gap-2`}>
        {finishes.map((finish) => (
          <div key={finish.value} className="relative">
            <RadioGroupItem
              value={finish.value}
              id={finish.value}
              className="peer sr-only"
            />
            <Label
              htmlFor={finish.value}
              className="flex flex-col items-center justify-center gap-2 p-3 border-2 rounded-lg cursor-pointer transition-all peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:border-primary/50"
            >
              <span className="text-xl">{finish.icon}</span>
              <span className="text-xs font-medium text-center">{finish.label}</span>
            </Label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}