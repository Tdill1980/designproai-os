/**
 * ServiceTilePicker — first step of the QuickQuote wizard.
 *
 * Renders a grid of service-type tiles. Returns the selected service via
 * onSelect. Used at the very top of the redesigned QuickQuote so the
 * shop owner picks the job category in one click before any free-text
 * input.
 *
 * Service ids match `ParsedJobSpec["service_type"]` from the
 * parse-quote-job edge function so a free-text parse can pre-select
 * the matching tile.
 */

import { type LucideIcon, Paintbrush, Layers, Scissors, ShieldCheck, Sun, Sparkles, Wand2, Tag } from "lucide-react";
import { cn } from "@/lib/utils";

export type QuoteServiceId =
  | "color_change"
  | "print_wrap"
  | "partial_wrap"
  | "tint"
  | "ppf"
  | "chrome_delete"
  | "design_only"
  | "other";

interface ServiceTile {
  id: QuoteServiceId;
  label: string;
  blurb: string;
  icon: LucideIcon;
}

const TILES: ServiceTile[] = [
  { id: "color_change",  label: "Color Change",   blurb: "Solid-color vinyl wrap",        icon: Paintbrush },
  { id: "print_wrap",    label: "Print Wrap",     blurb: "Custom printed graphics",       icon: Layers },
  { id: "partial_wrap",  label: "Partial Wrap",   blurb: "Hood, roof, accents",           icon: Scissors },
  { id: "tint",          label: "Window Tint",    blurb: "All windows or selected",       icon: Sun },
  { id: "ppf",           label: "PPF",            blurb: "Paint protection film",         icon: ShieldCheck },
  { id: "chrome_delete", label: "Chrome Delete",  blurb: "Blackout trim",                 icon: Sparkles },
  { id: "design_only",   label: "Design Only",    blurb: "Concept + renders",             icon: Wand2 },
  { id: "other",         label: "Other / Custom", blurb: "Describe it yourself",          icon: Tag },
];

interface ServiceTilePickerProps {
  value: QuoteServiceId | null;
  onSelect: (id: QuoteServiceId) => void;
  className?: string;
}

export function ServiceTilePicker({ value, onSelect, className }: ServiceTilePickerProps) {
  return (
    <div className={cn("grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3", className)}>
      {TILES.map((tile) => {
        const Icon = tile.icon;
        const selected = value === tile.id;
        return (
          <button
            key={tile.id}
            type="button"
            onClick={() => onSelect(tile.id)}
            className={cn(
              "rounded-2xl border p-4 text-left transition-colors",
              "bg-rp-surface hover:bg-rp-elevated",
              selected
                ? "border-[#60A5FA] ring-2 ring-[#60A5FA]/40"
                : "border-[#48484a]",
            )}
            aria-pressed={selected}
          >
            <Icon className={cn("h-6 w-6 mb-2", selected ? "text-[#60A5FA]" : "text-white/80")} />
            <div className="text-sm font-semibold text-white">{tile.label}</div>
            <div className="text-xs text-white/60 mt-0.5">{tile.blurb}</div>
          </button>
        );
      })}
    </div>
  );
}
