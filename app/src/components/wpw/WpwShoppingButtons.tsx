/**
 * WPW shopping buttons — surfaces "WPW Wholesale Printing (PrintPro)" and
 * "WPW Design Products" anywhere a customer might be building a quote.
 *
 * Visibility:
 *   - Visible to everyone (logged-in or not, WPW or not)
 *   - Logged-in WPW members see WPW pricing as the active price, with the
 *     standard price slashed-through (proof of savings)
 *   - Everyone else sees the standard price as the active price, with the
 *     WPW price labeled — plus a subscribe link to /pricing
 *
 * Hover behavior: HoverCard opens after a short delay revealing the
 * tooltip copy + the full product/price grid. Click on the trigger button
 * is a no-op (hover-only).
 *
 * Mounted in:
 *   - src/pages/RestyleDashboardContent.tsx (QuickQuote dashboard toolbar)
 *   - src/components/quote/EstimatorDrawer.tsx (every design tool's quote modal)
 */

import { Printer, Brush, Sparkles, ArrowRight, Wand2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

const GRAD = "linear-gradient(135deg, #0ea5e9, #3b82f6, #6366f1)";

// Product catalogs sourced from the shared wholesale lib so the admin
// page (/admin/shop-pricing) and these dropdowns stay in lockstep.
import {
  PRINT_PRODUCTS,
  DESIGN_SERVICES,
  type WholesaleRow,
} from "@/lib/wpw-wholesale-catalog";

type PriceRow = Pick<WholesaleRow, "name" | "wpw">;

// ── Subscription tiers (mirrors WpwOfferShared TIERS) ────────────────
// Shown in the third button so visitors — including non-subscribers —
// can see qtys + WPW pricing and convert into a paid tier.
interface TierRow {
  name: string;
  wpw: string;
  std: string;
  qty: string;
}

const RESTYLEPRO_TIERS: TierRow[] = [
  { name: "Starter",          wpw: "$300/mo", std: "$350/mo", qty: "50 renders · combined across all tools" },
  { name: "DesignPro Lite",   wpw: "$449/mo", std: "$499/mo", qty: "75 renders · adds MyVehiclePro" },
  { name: "DesignPro Studio", wpw: "$649/mo", std: "$699/mo", qty: "150 renders · real human designer · packs $249 each" },
  { name: "DesignPro Plus",   wpw: "$945/mo", std: "$995/mo", qty: "300 renders · 24-hr priority · packs $199 each" },
];

const RESTYLEPRO_TOOLTIP =
  "RestylePro Design Tool — your prompt-based AI wrap design engine. Render quotas are shared across the entire suite. WPW Customer pricing locks in $50/mo less than standard, for life.";

const PRINT_TOOLTIP =
  "Your on-call printing partner. PrintPro takes care of your printing needs and ships anywhere in the USA with FREE shipping over $750 — whether you need a rush job printed or you don't have a printer at all and want to expand to selling printed wrap film.";

const DESIGN_TOOLTIP =
  "Design Products — the human kind. WPW design pricing if you want to go that route. (Compare to a $300/mo RestylePro Starter subscription for AI-only design.)";

// ── Price row UI ────────────────────────────────────────────────────

const PriceRowItem = ({ row }: { row: PriceRow }) => (
  <li className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-100 last:border-0">
    <span className="text-[12px] text-slate-700 leading-tight">{row.name}</span>
    <span className="font-mono text-[11px] font-bold text-sky-700 shrink-0">
      {row.wpw}
    </span>
  </li>
);

// Tier row renders a 2-column block: tier name + qtys on the left,
// stacked Standard (slashed) over WPW price on the right.
const TierRowItem = ({ row, isWpw }: { row: TierRow; isWpw: boolean }) => (
  <li className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
    <div className="min-w-0">
      <p className="text-[13px] font-bold text-slate-900 leading-tight">{row.name}</p>
      <p className="text-[11px] text-slate-500 leading-snug mt-0.5">{row.qty}</p>
    </div>
    <div className="text-right shrink-0">
      <p className="font-mono text-[10px] text-slate-400 line-through leading-none">{row.std}</p>
      <p className="font-mono text-[12px] font-bold text-sky-700 leading-tight mt-0.5">{row.wpw}</p>
      {!isWpw && (
        <p className="font-mono text-[9px] text-rose-500 leading-none mt-0.5">WPW save $50/mo</p>
      )}
    </div>
  </li>
);

// ── Hover panel content ──────────────────────────────────────────────

interface PanelProps {
  title: string;
  tooltip: string;
  rows: PriceRow[];
  isWpw: boolean;
  /** Optional CTA link for adding/customizing this catalog. */
  manageHref?: string;
}

const HoverPanel = ({ title, tooltip, rows, isWpw, manageHref }: PanelProps) => (
  <div className="space-y-3">
    <div>
      <h4 className="text-sm font-bold text-slate-900 mb-1">{title}</h4>
      <p className="text-[12px] text-slate-600 leading-relaxed">{tooltip}</p>
    </div>

    <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-200">
      <span>Product</span>
      <span>WPW Wholesale</span>
    </div>

    <ul className="max-h-[340px] overflow-y-auto pr-1">
      {rows.map((r) => (
        <PriceRowItem key={r.name} row={r} />
      ))}
    </ul>

    <p className="text-[10px] text-slate-500 italic leading-snug pt-1">
      You set your own customer-facing margin in Shop Pricing.
    </p>

    {/* Manage own catalog (add custom products + margins). */}
    {manageHref && (
      <Link
        to={manageHref}
        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold transition-all border border-slate-300 bg-white text-slate-700 hover:border-sky-400 hover:text-sky-700"
      >
        Manage Shop Pricing & Custom Products
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    )}

    {/* Subscribe / upgrade CTA — shown to EVERYONE, including current
        subscribers (they can use this link to move to a higher tier).
        End goal of every visit through this dropdown is RestylePro
        dashboard access. */}
    <Link
      to="/pricing"
      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold text-white transition-all hover:opacity-90"
      style={{ background: GRAD, boxShadow: "0 4px 12px rgba(59,130,246,0.25)" }}
    >
      <Sparkles className="w-3.5 h-3.5" />
      {isWpw
        ? "See WPW pricing tiers — subscribe / upgrade"
        : "See subscription tiers — WPW pricing from $349/mo"}
      <ArrowRight className="w-3.5 h-3.5" />
    </Link>
  </div>
);

// ── Trigger buttons ──────────────────────────────────────────────────

interface TriggerProps {
  icon: React.ReactNode;
  label: string;
  className?: string;
}

const TriggerButton = ({ icon, label, className }: TriggerProps) => (
  <button
    type="button"
    className={
      "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-bold transition-all " +
      "border border-slate-200 bg-white text-slate-700 " +
      "hover:border-sky-400 hover:bg-sky-50 hover:text-sky-700 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)] " +
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 " +
      (className ?? "")
    }
  >
    {icon}
    {label}
  </button>
);

// ── Public component ─────────────────────────────────────────────────

interface WpwShoppingButtonsProps {
  /** Optional layout tweaks for the wrapping flex row. */
  className?: string;
}

export const WpwShoppingButtons = ({ className }: WpwShoppingButtonsProps) => {
  const { isWpw, loading } = useIsWpwTenant();
  if (loading) return null;

  return (
    <div className={"flex flex-wrap items-center gap-2 " + (className ?? "")}>
      <HoverCard openDelay={120} closeDelay={150}>
        <HoverCardTrigger asChild>
          <TriggerButton
            icon={<Printer className="w-3.5 h-3.5" />}
            label="WPW Wholesale Printing"
          />
        </HoverCardTrigger>
        <HoverCardContent
          side="bottom"
          align="end"
          className="w-[380px] p-4 bg-white border border-slate-200 shadow-xl"
        >
          <HoverPanel
            title="WPW Wholesale Printing (PrintPro)"
            tooltip={PRINT_TOOLTIP}
            rows={PRINT_PRODUCTS}
            isWpw={isWpw}
            manageHref="/admin/shop-pricing"
          />
        </HoverCardContent>
      </HoverCard>

      <HoverCard openDelay={120} closeDelay={150}>
        <HoverCardTrigger asChild>
          <TriggerButton
            icon={<Brush className="w-3.5 h-3.5" />}
            label="WPW Design Products"
          />
        </HoverCardTrigger>
        <HoverCardContent
          side="bottom"
          align="end"
          className="w-[380px] p-4 bg-white border border-slate-200 shadow-xl"
        >
          <HoverPanel
            title="WPW Design Products (human design team)"
            tooltip={DESIGN_TOOLTIP}
            rows={DESIGN_SERVICES}
            isWpw={isWpw}
            manageHref="/admin/shop-pricing"
          />
        </HoverCardContent>
      </HoverCard>

      {/* RestylePro Design Products — subscription tier qtys + WPW pricing.
          End goal: non-subscribers convert; current subscribers see upgrade. */}
      <HoverCard openDelay={120} closeDelay={150}>
        <HoverCardTrigger asChild>
          <TriggerButton
            icon={<Wand2 className="w-3.5 h-3.5" />}
            label="RestylePro Design Products"
          />
        </HoverCardTrigger>
        <HoverCardContent
          side="bottom"
          align="end"
          className="w-[380px] p-4 bg-white border border-slate-200 shadow-xl"
        >
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-bold text-slate-900 mb-1">RestylePro Design Products — subscription tiers</h4>
              <p className="text-[12px] text-slate-600 leading-relaxed">{RESTYLEPRO_TOOLTIP}</p>
            </div>

            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-200">
              <span>Tier · Quantities</span>
              <span>Standard / WPW</span>
            </div>

            <ul>
              {RESTYLEPRO_TIERS.map((t) => (
                <TierRowItem key={t.name} row={t} isWpw={isWpw} />
              ))}
            </ul>

            <Link
              to="/pricing"
              className="flex items-center justify-center gap-1.5 mt-2 px-3 py-2 rounded-lg text-[12px] font-bold text-white transition-all hover:opacity-90"
              style={{ background: GRAD, boxShadow: "0 4px 12px rgba(59,130,246,0.25)" }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isWpw ? "Subscribe / upgrade tier" : "Subscribe — unlock the design tool"}
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
};
