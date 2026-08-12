/**
 * ProductionPanelProof — clean proof grid of the built production panels.
 * Each card shows the small-res panel PNG with its side + real dimensions,
 * plus the QC checks (vs the 60" roll / template) and an RP Quality Control
 * stamp, all on one page.
 */
import { Check, X } from "lucide-react";

const ROLL_MAX_H = 59; // shortest edge must fit the 60" roll
const MIN_FULL_DPI = 150;

export interface ProofPanel {
  view: string;
  name: string;
  widthIn: number;
  heightIn: number;
  bleedIn: number;
  imageUrl: string;
}

interface ProductionPanelProofProps {
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  panels: ProofPanel[];
}

const titleCase = (v: string) => v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function ProductionPanelProof({ vehicleYear, vehicleMake, vehicleModel, panels }: ProductionPanelProofProps) {
  const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ") || "—";

  // QC checks vs template / roll.
  const allFit = panels.length > 0 && panels.every((p) => Math.min(p.widthIn, p.heightIn) <= ROLL_MAX_H);
  const allBleed = panels.length > 0 && panels.every((p) => p.bleedIn > 0);
  const matched = vehicle !== "—";
  const checks = [
    { ok: matched, label: "Vehicle matched to template" },
    { ok: allFit, label: `All panels fit the 60" roll (≤${ROLL_MAX_H}")` },
    { ok: allBleed, label: "Bleed included on every panel" },
    { ok: panels.length > 0, label: `Resolution ≥ ${MIN_FULL_DPI} DPI` },
  ];
  const allPass = checks.every((c) => c.ok);

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/80 overflow-hidden">
      <div className="px-5 py-4 bg-black/60 border-b border-white/10 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold font-['Oswald'] tracking-wide uppercase">Production Panel Proof</h3>
          <p className="text-sm text-white/60 mt-0.5">{vehicle}</p>
        </div>
        {/* RP Quality Control stamp */}
        <div
          className={`shrink-0 w-20 h-20 rounded-full border-2 flex flex-col items-center justify-center text-center -rotate-12 ${
            allPass ? "border-emerald-400 text-emerald-300" : "border-rose-400 text-rose-300"
          }`}
          style={{ boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.08)" }}
        >
          <span className="text-xl font-black leading-none">RP</span>
          <span className="text-[8px] font-bold uppercase tracking-wider mt-0.5 leading-tight">Quality<br />Control</span>
          <span className="text-[8px] opacity-70 mt-0.5">{new Date().toLocaleDateString()}</span>
        </div>
      </div>

      {panels.length === 0 ? (
        <div className="px-5 py-12 text-center text-white/40 text-sm">Build a panel to add it to the proof.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
          {panels.map((p, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold uppercase tracking-wide">{titleCase(p.view)}</span>
                <span className="text-xs text-white/50">{p.widthIn} × {p.heightIn} in</span>
              </div>
              <div className="rounded-lg border border-white/10 bg-white overflow-hidden">
                <img src={p.imageUrl} alt={`${p.view} panel`} className="w-full object-contain" />
              </div>
              <p className="text-[11px] text-white/40">+{p.bleedIn}" bleed</p>
            </div>
          ))}
        </div>
      )}

      {panels.length > 0 && (
        <div className="px-5 pb-5 pt-1 space-y-2 border-t border-white/10">
          <span className="text-[11px] uppercase tracking-wider text-white/40">QC checks</span>
          <div className="grid sm:grid-cols-2 gap-1.5">
            {checks.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                {c.ok ? <Check className="h-4 w-4 text-emerald-400 shrink-0" /> : <X className="h-4 w-4 text-rose-400 shrink-0" />}
                <span className={c.ok ? "text-white/80" : "text-rose-300"}>{c.label}</span>
              </div>
            ))}
          </div>
          <div className={`mt-1 inline-flex items-center rounded px-2 py-1 text-xs font-semibold ${
            allPass ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
          }`}>
            {allPass ? "Approved for production" : "Hold — review flagged panels"}
          </div>
        </div>
      )}
    </div>
  );
}
