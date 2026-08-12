/**
 * WPW FadeWraps Configurator
 *
 * Mirrors the dropdowns on
 * https://weprintwraps.com/our-products/pre-designed-fade-wraps/
 * (WooCommerce product 58391) so a shop can build an exact-WPW
 * fade-wrap quote inside QuickQuote without leaving the app.
 *
 * Fields exactly as shown on the WPW product page:
 *   • Choose Color — Beige / Blue / Green / LightBlue / Orange /
 *     Pink / Purple / Red / Yellow + Custom Color
 *   • Choose Size (sides only) — Small / Medium / Large / XL
 *     (sides 1 + 2 are ALWAYS included; this picks the kit length)
 *   • Add Hood / Front Bumper / Rear-incl-Bumper (optional)
 *   • Add Roof — Small / Medium / Large (optional)
 *   • Finish — Gloss (Avery 1105 EZRS)
 *
 * The configurator emits a `WpwFadeWrapSelection` whenever the
 * user touches anything; the parent (QuickQuoteCard) writes that
 * into the line item's qty (=1), rate (= total), and panel (= a
 * human-readable summary like "Medium · Hood · Roof Small ·
 * Pink Gloss") so the line shows up correctly on the saved /
 * printed estimate.
 */
import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Pricing — taken verbatim from WPW product 58391 ──────────────
type SizeKey = "small" | "medium" | "large" | "xl";

const SIZE_OPTIONS: {
  key: SizeKey;
  label: string;
  dimensions: string;
  price: number;
}[] = [
  { key: "small", label: "Small", dimensions: "144×59.5", price: 600 },
  { key: "medium", label: "Medium", dimensions: "172×59.5", price: 710 },
  { key: "large", label: "Large", dimensions: "200×59.5", price: 825 },
  { key: "xl", label: "XL", dimensions: "240×59.5", price: 990 },
];

const ADDON_HOOD = { label: "Add Hood", dimensions: "72×59.5", price: 160 };
const ADDON_FRONT_BUMPER = {
  label: "Add Front Bumper",
  dimensions: "38×120.5",
  price: 200,
};
const ADDON_REAR = {
  label: "Add Rear, Including Bumper",
  dimensions: "59×72.5 Rear, 38×120 Bumper",
  price: 395,
};

type RoofKey = "none" | "small" | "medium" | "large";
const ROOF_OPTIONS: {
  key: Exclude<RoofKey, "none">;
  label: string;
  dimensions: string;
  price: number;
}[] = [
  { key: "small", label: "Roof — Small", dimensions: "72×59.5", price: 160 },
  { key: "medium", label: "Roof — Medium", dimensions: "110×59.5", price: 225 },
  { key: "large", label: "Roof — Large", dimensions: "160×59.5", price: 330 },
];

// Color palette from WPW page. Hex values are the on-screen swatch
// shown to the customer; printed output uses the spec'd Avery ink.
const COLORS: { id: string; name: string; hex: string }[] = [
  { id: "beige", name: "Beige", hex: "#D7C8A8" },
  { id: "blue", name: "Blue", hex: "#0057FF" },
  { id: "green", name: "Green", hex: "#1FA84A" },
  { id: "lightblue", name: "LightBlue", hex: "#4FC3F7" },
  { id: "orange", name: "Orange", hex: "#FF7A1A" },
  { id: "pink", name: "Pink", hex: "#FF2EA1" },
  { id: "purple", name: "Purple", hex: "#7B2D8E" },
  { id: "red", name: "Red", hex: "#C1121F" },
  { id: "yellow", name: "Yellow", hex: "#F5D300" },
];

export interface WpwFadeWrapSelection {
  size: SizeKey;
  addHood: boolean;
  addFrontBumper: boolean;
  addRear: boolean;
  roof: RoofKey;
  colorId: string | "custom";
  customColor?: string;
  finish: "Gloss";
  total: number;
  /** Human-readable line summary, e.g. "Medium · Hood · Roof Small · Pink Gloss" */
  summary: string;
}

interface Props {
  onChange: (selection: WpwFadeWrapSelection) => void;
}

export const WpwFadeWrapConfigurator = ({ onChange }: Props) => {
  const [size, setSize] = useState<SizeKey>("medium");
  const [addHood, setAddHood] = useState(false);
  const [addFrontBumper, setAddFrontBumper] = useState(false);
  const [addRear, setAddRear] = useState(false);
  const [roof, setRoof] = useState<RoofKey>("none");
  const [colorId, setColorId] = useState<string>("blue");
  const [customColor, setCustomColor] = useState("");

  const total = useMemo(() => {
    const sizePrice = SIZE_OPTIONS.find((s) => s.key === size)?.price ?? 0;
    let t = sizePrice;
    if (addHood) t += ADDON_HOOD.price;
    if (addFrontBumper) t += ADDON_FRONT_BUMPER.price;
    if (addRear) t += ADDON_REAR.price;
    if (roof !== "none") {
      const r = ROOF_OPTIONS.find((o) => o.key === roof);
      if (r) t += r.price;
    }
    return t;
  }, [size, addHood, addFrontBumper, addRear, roof]);

  const summary = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${SIZE_OPTIONS.find((s) => s.key === size)?.label ?? size} sides`);
    if (addHood) parts.push("Hood");
    if (addFrontBumper) parts.push("Front Bumper");
    if (addRear) parts.push("Rear+Bumper");
    if (roof !== "none") {
      parts.push(`Roof ${roof[0].toUpperCase()}${roof.slice(1)}`);
    }
    const colorName =
      colorId === "custom"
        ? customColor.trim() || "Custom Color"
        : COLORS.find((c) => c.id === colorId)?.name ?? colorId;
    parts.push(`${colorName} Gloss`);
    return parts.join(" · ");
  }, [size, addHood, addFrontBumper, addRear, roof, colorId, customColor]);

  // Intentionally omit `onChange` from the dep array — parent passes an
  // inline closure every render, and including it here would trigger an
  // infinite render loop. We only want to push selections when the user
  // actually changes something.
  useEffect(() => {
    onChange({
      size,
      addHood,
      addFrontBumper,
      addRear,
      roof,
      colorId: colorId === "custom" ? "custom" : colorId,
      customColor: colorId === "custom" ? customColor : undefined,
      finish: "Gloss",
      total,
      summary,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, addHood, addFrontBumper, addRear, roof, colorId, customColor, total, summary]);

  const money = (n: number) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      {/* Color picker — mirrors WPW swatch grid */}
      <div>
        <Label className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#60A5FA] mb-2 block">
          Choose Color
        </Label>
        <div className="grid grid-cols-5 gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setColorId(c.id)}
              className={cn(
                "rounded-lg border p-1.5 transition flex flex-col items-center gap-1",
                colorId === c.id
                  ? "border-[#60A5FA] ring-1 ring-[#60A5FA]/60 bg-[#60A5FA]/5"
                  : "border-[#48484a] hover:border-white/40",
              )}
              aria-label={c.name}
            >
              <div
                className="w-8 h-8 rounded border border-white/20"
                style={{ backgroundColor: c.hex }}
              />
              <span className="text-[9px] font-semibold text-white/80">
                {c.name}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setColorId("custom")}
            className={cn(
              "rounded-lg border p-1.5 transition flex flex-col items-center gap-1",
              colorId === "custom"
                ? "border-[#60A5FA] ring-1 ring-[#60A5FA]/60 bg-[#60A5FA]/5"
                : "border-[#48484a] hover:border-white/40",
            )}
          >
            <div
              className="w-8 h-8 rounded border border-white/20"
              style={{
                background:
                  "conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)",
              }}
            />
            <span className="text-[9px] font-semibold text-white/80">
              Custom
            </span>
          </button>
        </div>
        {colorId === "custom" && (
          <Input
            value={customColor}
            onChange={(e) => setCustomColor(e.target.value)}
            placeholder="Describe custom color (Pantone, hex, name…)"
            className="h-9 text-xs bg-black border-[#48484a] text-white mt-2"
          />
        )}
      </div>

      {/* Choose Size (sides only) */}
      <div>
        <Label className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#60A5FA] mb-2 block">
          Choose Size (sides only)
        </Label>
        <Select value={size} onValueChange={(v) => setSize(v as SizeKey)}>
          <SelectTrigger className="w-full h-10 bg-black border-[#48484a] text-white text-xs font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-rp-surface border-[#48484a] text-white">
            {SIZE_OPTIONS.map((s) => (
              <SelectItem key={s.key} value={s.key} className="text-xs">
                <div className="flex items-center justify-between gap-3 w-full">
                  <span className="font-semibold">
                    {s.label} ({s.dimensions})
                  </span>
                  <span className="text-[#60A5FA] font-bold">
                    {money(s.price)}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-white/55 mt-1.5 font-inter">
          Includes driver + passenger side. Match to the longest side of the
          vehicle (round up if between sizes).
        </p>
      </div>

      {/* Body add-ons */}
      <div className="rounded-lg border border-[#48484a] bg-black/30 p-3 space-y-2">
        <AddonRow
          label={ADDON_HOOD.label}
          dimensions={ADDON_HOOD.dimensions}
          price={ADDON_HOOD.price}
          checked={addHood}
          onChange={setAddHood}
          money={money}
        />
        <AddonRow
          label={ADDON_FRONT_BUMPER.label}
          dimensions={ADDON_FRONT_BUMPER.dimensions}
          price={ADDON_FRONT_BUMPER.price}
          checked={addFrontBumper}
          onChange={setAddFrontBumper}
          money={money}
        />
        <AddonRow
          label={ADDON_REAR.label}
          dimensions={ADDON_REAR.dimensions}
          price={ADDON_REAR.price}
          checked={addRear}
          onChange={setAddRear}
          money={money}
        />
      </div>

      {/* Add Roof — single-pick (radio behavior on top of WPW checkboxes) */}
      <div className="rounded-lg border border-[#48484a] bg-black/30 p-3 space-y-2">
        <Label className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#60A5FA] mb-1 block">
          Add Roof
        </Label>
        {ROOF_OPTIONS.map((r) => (
          <AddonRow
            key={r.key}
            label={r.label}
            dimensions={r.dimensions}
            price={r.price}
            checked={roof === r.key}
            onChange={(v) => setRoof(v ? r.key : "none")}
            money={money}
          />
        ))}
      </div>

      {/* Finish */}
      <div className="flex items-center justify-between rounded-lg border border-[#48484a] bg-black/30 px-3 py-2">
        <Label className="text-xs font-semibold text-white/80">
          Finish
        </Label>
        <span className="text-xs font-bold text-white">Gloss</span>
      </div>

      {/* Live total */}
      <div className="rounded-lg border border-[#60A5FA]/60 bg-[#60A5FA]/5 px-3 py-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#60A5FA]">
            Total
          </div>
          <div className="text-[10px] text-white/65 font-inter mt-0.5">
            {summary}
          </div>
        </div>
        <span className="font-montserrat text-2xl font-bold text-white tracking-tight">
          {money(total)}
        </span>
      </div>

      <p className="text-[10px] text-white/50 font-inter leading-snug">
        Mirrors WPW product 58391 (pre-designed-fade-wraps). Sides 1 + 2 are
        always included. Hood, bumpers, and roof panels are optional add-ons.
      </p>
    </div>
  );
};

interface AddonRowProps {
  label: string;
  dimensions: string;
  price: number;
  checked: boolean;
  onChange: (v: boolean) => void;
  money: (n: number) => string;
}

const AddonRow = ({
  label,
  dimensions,
  price,
  checked,
  onChange,
  money,
}: AddonRowProps) => (
  <label className="flex items-center justify-between gap-3 cursor-pointer">
    <div className="flex items-center gap-2 min-w-0">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(Boolean(v))}
      />
      <div className="min-w-0">
        <div className="text-xs font-semibold text-white truncate">
          {label}
        </div>
        <div className="text-[10px] text-white/55 truncate">({dimensions})</div>
      </div>
    </div>
    <span className="text-xs font-bold text-[#60A5FA]">{money(price)}</span>
  </label>
);
