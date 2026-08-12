/**
 * ColorTabs — a labeled row of color-coded filter pills (brand / channel /
 * team member). Selected pill fills with its color; the rest show a soft tint.
 * Shared by Content Review and Content Director so the color language matches.
 */
import { tint } from "@/lib/content-tags";

export type ColorOption = { key: string; label: string; color: string; count: number };

function Pill({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3 py-1 text-xs font-semibold transition"
      style={
        active
          ? { background: color, color: "#fff", boxShadow: `0 0 0 1.5px ${color}` }
          : { background: tint(color), color }
      }
    >
      {children}
    </button>
  );
}

export function ColorTabRow({
  label,
  options,
  active,
  onSelect,
  allCount,
}: {
  label: string;
  options: ColorOption[];
  active: string;
  onSelect: (key: string) => void;
  allCount: number;
}) {
  if (options.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-[4.5rem] shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <Pill active={active === "all"} color="#64748b" onClick={() => onSelect("all")}>
        All ({allCount})
      </Pill>
      {options.map((o) => (
        <Pill key={o.key} active={active === o.key} color={o.color} onClick={() => onSelect(o.key)}>
          {o.label} ({o.count})
        </Pill>
      ))}
    </div>
  );
}
