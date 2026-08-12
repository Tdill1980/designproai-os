import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, RotateCcw, AlignLeft, AlignCenter, AlignRight, Sparkles } from "lucide-react";
import {
  Layer, TextLayer, LayerFilters, NEUTRAL_FILTERS, FONT_FAMILIES, FontStyle, TextAlign,
} from "./types";
import { cn } from "@/lib/utils";

interface LayerInspectorProps {
  layer: Layer | undefined;
  onUpdate: (id: string, patch: Partial<Layer>, actionKey?: string) => void;
}

function FilterRow({
  label, value, min, max, step, format, onChange, actionKey,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void; actionKey: string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px] text-gray-500">
        <span>{label}</span>
        <span>{format(value)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0] ?? value)} />
    </div>
  );
}

export function LayerInspector({ layer, onUpdate }: LayerInspectorProps) {
  const maskRef = useRef<HTMLInputElement>(null);
  const [maskBusy, setMaskBusy] = useState(false);

  if (!layer) {
    return (
      <div className="w-72 rounded-lg border border-gray-200 bg-white p-4 text-center text-xs text-gray-400">
        Select a layer to edit its properties.
      </div>
    );
  }

  const filters: LayerFilters = layer.filters || NEUTRAL_FILTERS;
  const setFilter = (patch: Partial<LayerFilters>, key: string) =>
    onUpdate(layer.id, { filters: { ...filters, ...patch } }, `filter-${key}-${layer.id}`);

  const onAddMask = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMaskBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in to add a mask.");
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `canvas-layers/${user.id}/masks/${Date.now()}_${layer.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("wrap-files")
        .upload(path, file, { contentType: file.type || "image/png", upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: signed } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60 * 24 * 30);
      if (!signed?.signedUrl) throw new Error("Could not sign mask.");
      onUpdate(layer.id, { mask: { src: signed.signedUrl } }, `mask-${layer.id}`);
      toast.success("Mask applied.");
    } catch (err: any) {
      toast.error(err?.message || "Could not apply mask.");
    } finally {
      setMaskBusy(false);
    }
  };

  const isText = layer.type === "text";
  const t = layer as TextLayer;

  return (
    <div className="flex w-72 flex-col gap-4 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 text-gray-900">
      <div className="text-sm font-medium">{isText ? "Text" : "Image"} properties</div>

      {/* Text-specific controls */}
      {isText && (
        <div className="space-y-2 border-b border-gray-100 pb-3">
          <Textarea
            value={t.text}
            onChange={(e) => onUpdate(layer.id, { text: e.target.value, name: e.target.value.slice(0, 24) }, `text-${layer.id}`)}
            rows={2}
            className="text-sm"
            placeholder="Type your text"
          />
          <div className="flex gap-2">
            <Select value={t.fontFamily} onValueChange={(v) => onUpdate(layer.id, { fontFamily: v }, `font-${layer.id}`)}>
              <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map((f) => (
                  <SelectItem key={f} value={f} className="text-xs">{f}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="color"
              value={t.fill}
              onChange={(e) => onUpdate(layer.id, { fill: e.target.value }, `fill-${layer.id}`)}
              className="h-8 w-10 p-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={t.fontStyle} onValueChange={(v) => onUpdate(layer.id, { fontStyle: v as FontStyle }, `style-${layer.id}`)}>
              <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["normal", "bold", "italic", "bold italic"] as FontStyle[]).map((s) => (
                  <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex rounded-md border border-gray-200">
              {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as [TextAlign, any][]).map(
                ([a, Icon]) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => onUpdate(layer.id, { align: a }, `align-${layer.id}`)}
                    className={cn("p-1.5", t.align === a ? "bg-blue-50 text-blue-600" : "text-gray-400 hover:text-gray-900")}
                    aria-label={`Align ${a}`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <Sparkles className="h-3.5 w-3.5 text-gray-400" /> Adjustments
          <button
            type="button"
            onClick={() => onUpdate(layer.id, { filters: { ...NEUTRAL_FILTERS } }, `filter-reset-${layer.id}`)}
            className="ml-auto flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-900"
          >
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
        <FilterRow label="Brightness" value={filters.brightness} min={0} max={2} step={0.01}
          format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setFilter({ brightness: v }, "bri")} actionKey="bri" />
        <FilterRow label="Contrast" value={filters.contrast} min={0} max={2} step={0.01}
          format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setFilter({ contrast: v }, "con")} actionKey="con" />
        <FilterRow label="Saturation" value={filters.saturation} min={0} max={2} step={0.01}
          format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setFilter({ saturation: v }, "sat")} actionKey="sat" />
        <FilterRow label="Blur" value={filters.blur} min={0} max={50} step={1}
          format={(v) => `${Math.round(v)}px`} onChange={(v) => setFilter({ blur: v }, "blur")} actionKey="blur" />
      </div>

      {/* Mask */}
      <div className="space-y-2 border-t border-gray-100 pt-3">
        <div className="text-xs font-medium text-gray-700">Layer mask</div>
        <input ref={maskRef} type="file" accept="image/*" hidden onChange={onAddMask} />
        {layer.mask ? (
          <div className="flex items-center gap-2">
            <img src={layer.mask.src} alt="mask" className="h-10 w-10 rounded border border-gray-200 object-cover" />
            <Button variant="outline" size="sm" className="text-xs" onClick={() => onUpdate(layer.id, { mask: null }, `mask-rm-${layer.id}`)}>
              Remove
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full text-xs" disabled={maskBusy} onClick={() => maskRef.current?.click()}>
            {maskBusy ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
            Add mask (white = visible)
          </Button>
        )}
      </div>
    </div>
  );
}
