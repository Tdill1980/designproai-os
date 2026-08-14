/**
 * TintQuoteForm — focused form for window tint jobs.
 *
 * Window tint pricing is much simpler than wraps (per-window or per-set
 * pricing, no panel sq-ft calc) so it gets its own form on the wizard
 * instead of overloading the wrap flow.
 *
 * The form is a controlled component — parent owns state. We just
 * render inputs + a derived total preview based on the parent-supplied
 * pricePerWindow / fullSetPrice values.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface TintQuoteFormValue {
  /** VLT % per area, e.g. "20" */
  windshield: string;
  front: string;
  rear: string;
  /** Whether to charge per-window or as a full-set bundle. */
  fullSet: boolean;
  /** Number of windows when fullSet === false. */
  windowCount: number;
}

interface TintQuoteFormProps {
  value: TintQuoteFormValue;
  onChange: (next: TintQuoteFormValue) => void;
  pricePerWindow: number;
  fullSetPrice: number;
  className?: string;
}

export function TintQuoteForm({
  value,
  onChange,
  pricePerWindow,
  fullSetPrice,
  className,
}: TintQuoteFormProps) {
  const total = value.fullSet
    ? fullSetPrice
    : value.windowCount * pricePerWindow;

  const set = (patch: Partial<TintQuoteFormValue>) => onChange({ ...value, ...patch });

  return (
    <div className={cn("rounded-2xl border border-[#48484a] bg-rp-surface p-5 space-y-4", className)}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-[#60A5FA]">Window tint</div>
          <h3 className="text-lg font-semibold text-white mt-1">Specify VLT %</h3>
        </div>
        <div className="text-right">
          <div className="text-xs text-white/60">Estimated</div>
          <div className="text-2xl font-bold text-white">${total.toLocaleString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-white/80 text-xs">Windshield VLT</Label>
          <Input
            value={value.windshield}
            onChange={(e) => set({ windshield: e.target.value })}
            placeholder="70%"
            className="bg-black border-[#48484a] text-white mt-1"
          />
        </div>
        <div>
          <Label className="text-white/80 text-xs">Front VLT</Label>
          <Input
            value={value.front}
            onChange={(e) => set({ front: e.target.value })}
            placeholder="35%"
            className="bg-black border-[#48484a] text-white mt-1"
          />
        </div>
        <div>
          <Label className="text-white/80 text-xs">Rear VLT</Label>
          <Input
            value={value.rear}
            onChange={(e) => set({ rear: e.target.value })}
            placeholder="20%"
            className="bg-black border-[#48484a] text-white mt-1"
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-[#48484a] bg-black/30 p-3">
        <div>
          <div className="text-sm text-white">Charge as full set</div>
          <div className="text-xs text-white/60 mt-0.5">
            ${fullSetPrice.toLocaleString()} flat · otherwise ${pricePerWindow}/window
          </div>
        </div>
        <Switch
          checked={value.fullSet}
          onCheckedChange={(c) => set({ fullSet: c })}
        />
      </div>

      {!value.fullSet && (
        <div className="flex items-center gap-3">
          <Label className="text-white/80 text-xs">Window count</Label>
          <Input
            type="number"
            min={1}
            max={20}
            value={value.windowCount}
            onChange={(e) => set({ windowCount: Math.max(1, Number(e.target.value) || 1) })}
            className="bg-black border-[#48484a] text-white w-24"
          />
        </div>
      )}
    </div>
  );
}
