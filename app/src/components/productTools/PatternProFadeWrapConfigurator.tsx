import {
  DEFAULT_FADEWRAP_CONFIG,
  WPW_FADEWRAP_ADDONS,
  WPW_FADEWRAP_COLORS,
  WPW_FADEWRAP_PRINT_NOTE,
  WPW_FADEWRAP_ROOFS,
  WPW_FADEWRAP_SIDES,
  fadeWrapHex,
  fadeWrapTotal,
  type PatternProFadeWrapConfig,
} from "@/lib/patternpro-fadewraps";

interface Props {
  value: PatternProFadeWrapConfig;
  onChange: (next: PatternProFadeWrapConfig) => void;
}

export function PatternProFadeWrapConfigurator({ value, onChange }: Props) {
  const patch = (next: Partial<PatternProFadeWrapConfig>) => onChange({ ...value, ...next });
  const selectedHex = value.colorKey === "custom" ? (value.customHex || "#8B00FF") : fadeWrapHex(value);

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-card p-4">
      <div>
        <h3 className="font-bold">FadeWraps™</h3>
        <p className="text-sm text-muted-foreground">Choose the exact WPW FadeWrap configuration, then see it on your vehicle.</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold">Fade Color</label>
        <div className="grid grid-cols-6 gap-2">
          {WPW_FADEWRAP_COLORS.map((color) => (
            <button key={color.key} type="button" title={color.name}
              aria-label={color.name}
              onClick={() => patch({ colorKey: color.key })}
              className={"h-10 rounded-lg border-2 " + (value.colorKey === color.key ? "border-primary" : "border-border")}
              style={{ backgroundColor: color.hex }} />
          ))}
          <button type="button" onClick={() => patch({ colorKey: "custom", customHex: value.customHex || "#8B00FF" })}
            className={"col-span-2 rounded-lg border px-2 text-xs font-semibold " + (value.colorKey === "custom" ? "border-primary" : "border-border")}>
            Custom Color
          </button>
        </div>
        {value.colorKey === "custom" && (
          <div className="flex items-center gap-3">
            <input aria-label="Custom FadeWrap color" type="color" value={selectedHex}
              onChange={(e) => patch({ customHex: e.target.value.toUpperCase() })} className="h-11 w-16" />
            <input aria-label="Custom FadeWrap hex" value={value.customHex || ""}
              onChange={(e) => patch({ customHex: e.target.value.toUpperCase() })}
              placeholder="#8B00FF" className="h-10 rounded-md border bg-background px-3 font-mono text-sm" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold">Choose Size — Sides Only</label>
        <select value={value.sideSize} onChange={(e) => patch({ sideSize: e.target.value as PatternProFadeWrapConfig["sideSize"] })}
          className="h-11 w-full rounded-md border bg-background px-3">
          {Object.entries(WPW_FADEWRAP_SIDES).map(([key, s]) => (
            <option key={key} value={key}>{s.label} — {s.widthIn} × {s.heightIn} in — ${s.price}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="rounded-xl border p-3 text-sm"><input type="checkbox" checked={value.hood} onChange={(e) => patch({ hood: e.target.checked })} /> <b>Hood</b><br />72 × 59.5 — +${WPW_FADEWRAP_ADDONS.hood.price}</label>
        <label className="rounded-xl border p-3 text-sm"><input type="checkbox" checked={value.frontBumper} onChange={(e) => patch({ frontBumper: e.target.checked })} /> <b>Front Bumper</b><br />38 × 120.5 — +${WPW_FADEWRAP_ADDONS.frontBumper.price}</label>
        <label className="rounded-xl border p-3 text-sm"><input type="checkbox" checked={value.rear} onChange={(e) => patch({ rear: e.target.checked })} /> <b>Rear Including Bumper</b><br />+ ${WPW_FADEWRAP_ADDONS.rear.price}</label>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold">Roof Size</label>
        <select value={value.roofSize} onChange={(e) => patch({ roofSize: e.target.value as PatternProFadeWrapConfig["roofSize"] })}
          className="h-11 w-full rounded-md border bg-background px-3">
          {Object.entries(WPW_FADEWRAP_ROOFS).map(([key, roof]) => (
            <option key={key} value={key}>{roof.label}{roof.price ? ` — +$${roof.price}` : ""}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-semibold">Finish</label>
        <div className="grid grid-cols-3 gap-2">
          {(["gloss", "satin", "matte"] as const).map((finish) => (
            <button key={finish} type="button" onClick={() => patch({ finish })}
              className={"rounded-lg border px-3 py-2 capitalize " + (value.finish === finish ? "border-primary font-bold" : "border-border")}>{finish}</button>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-muted/50 p-3">
        <p className="text-sm">{WPW_FADEWRAP_PRINT_NOTE}</p>
        <p className="mt-3 text-xl font-black">Configured total: ${fadeWrapTotal(value).toFixed(2)}</p>
      </div>
    </div>
  );
}

export { DEFAULT_FADEWRAP_CONFIG };
