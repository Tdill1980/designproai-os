/**
 * QuickQuoteProductPicker
 *
 * Renders multiple product-source dropdowns side-by-side (stacked on
 * mobile) instead of one mashed-together category picker. Which
 * dropdowns appear depends on the tenant:
 *
 *   WPW tenant (internal team + weprintwraps.com customers):
 *     ┌─ WePrintWraps.com ─┐  ← direct WPW catalog pricing, film only
 *     ┌─ Color Change ─────┐  ← solid-color change film, per-yard
 *     ┌─ PrintPro ─────────┐  ← same catalog, renders included per tier
 *
 *   Non-WPW tenant:
 *     ┌─ PrintPro ─────────┐  ← full PrintPro catalog
 *     ┌─ Color Change ─────┐  ← solid-color change film
 *     (Custom products are added via the "Add Custom Line" button in
 *     the parent card — no third dropdown needed here.)
 *
 * Each dropdown is INDEPENDENTLY selectable so the shop owner can
 * compare prices across sources. Selecting a product from any dropdown
 * makes that source the ACTIVE one — the product driving the quote's
 * line-item pricing is taken from the active source. Inactive
 * dropdowns stay populated with the shop's last pick so the comparison
 * remains visible at a glance.
 */
import { Calendar, Factory, Paintbrush, Printer } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getProductsForSource,
  findProductById,
  type QuoteSource,
  type QuoteProduct,
} from "@/lib/quote-product-catalog";
import { tierQuantityCaption } from "@/lib/quote-design-tools";
import { cn } from "@/lib/utils";

interface QuickQuoteProductPickerProps {
  /** The source currently driving the line-item pricing. */
  activeSource: QuoteSource;
  /** Selected product id within the active source. */
  productId: string;
  /** Per-source cached selection so inactive dropdowns still show a pick. */
  selections?: Partial<Record<QuoteSource, string>>;
  onChange: (next: {
    source: QuoteSource;
    product: QuoteProduct;
    selections: Partial<Record<QuoteSource, string>>;
  }) => void;
  compact?: boolean;
  /** WPW tenants see all three dropdowns. Others see PrintPro + Color Change. */
  isWpwTenant?: boolean;
}

interface SourceMeta {
  source: QuoteSource;
  label: string;
  accent: string;
  icon: typeof Factory;
  caption: string;
}

function getSourceMetas(isWpwTenant: boolean): SourceMeta[] {
  const wpw: SourceMeta = {
    source: "wpw",
    label: "WePrintWraps.com",
    accent: "text-amber-300",
    icon: Factory,
    caption: "Direct WePrintWraps.com catalog pricing.",
  };
  const colorChange: SourceMeta = {
    source: "color_change",
    label: "Color Change",
    accent: "text-[#60A5FA]",
    icon: Paintbrush,
    caption: "Solid-color change vinyl, priced per linear yard.",
  };
  const printpro: SourceMeta = {
    source: "printpro",
    label: "PrintPro",
    accent: "text-fuchsia-300",
    icon: Printer,
    caption: `Design + renders included with RestylePro tier — ${tierQuantityCaption()}.`,
  };
  const services: SourceMeta = {
    source: "services",
    label: "Install Services",
    accent: "text-emerald-400",
    icon: Calendar,
    caption: "Bookable jobs — quote + schedule in one step.",
  };
  return isWpwTenant ? [wpw, colorChange, printpro, services] : [printpro, colorChange, services];
}

export const QuickQuoteProductPicker = ({
  activeSource,
  productId,
  selections,
  onChange,
  compact = false,
  isWpwTenant = false,
}: QuickQuoteProductPickerProps) => {
  const metas = getSourceMetas(isWpwTenant);

  const resolvedSelections: Partial<Record<QuoteSource, string>> = {
    ...(selections ?? {}),
    [activeSource]: productId,
  };

  const handleSelect = (source: QuoteSource, nextProductId: string) => {
    const product = findProductById(nextProductId);
    if (!product) return;
    const nextSelections: Partial<Record<QuoteSource, string>> = {
      ...resolvedSelections,
      [source]: nextProductId,
    };
    onChange({ source, product, selections: nextSelections });
  };

  const triggerCls = cn(
    "w-full bg-black border-[#48484a] text-white font-semibold",
    compact ? "h-9 text-xs" : "h-10 text-sm",
  );

  return (
    <div className="space-y-2">
      {metas.map((meta) => {
        const active = activeSource === meta.source;
        const products = getProductsForSource(meta.source);
        const selectedId =
          resolvedSelections[meta.source] ??
          products[0]?.id ??
          "";
        const Icon = meta.icon;

        return (
          <div
            key={meta.source}
            className={cn(
              "rounded-xl border bg-black/40 p-3 transition",
              active
                ? "border-[#60A5FA] ring-1 ring-[#60A5FA]/50 bg-[#60A5FA]/5"
                : "border-[#48484a]",
            )}
          >
            <div className="flex items-start gap-2 mb-2">
              <div className="w-7 h-7 rounded-md bg-black border border-[#48484a] flex items-center justify-center shrink-0">
                <Icon className={cn("w-3.5 h-3.5", meta.accent)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn("font-bold text-xs", meta.accent)}>
                    {meta.label}
                  </span>
                  {active && (
                    <span className="text-[8px] font-bold uppercase tracking-[0.1em] px-1.5 py-0.5 rounded bg-[#60A5FA] text-black">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-white/55 leading-snug mt-0.5 break-words">
                  {meta.caption}
                </p>
              </div>
            </div>

            <Select
              value={selectedId}
              onValueChange={(v) => handleSelect(meta.source, v)}
            >
              <SelectTrigger
                className={triggerCls}
                aria-label={`${meta.label} product`}
              >
                <SelectValue placeholder="Select product…" />
              </SelectTrigger>
              <SelectContent className="bg-rp-surface border-[#48484a] text-white max-h-80">
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    <div className="flex flex-col">
                      <span className="font-semibold">{p.name}</span>
                      <span className="text-[10px] text-white/60">
                        {p.subName ?? ""}
                        {p.price > 0 && (
                          <>
                            {p.subName ? " · " : ""}${p.price.toFixed(2)} / {p.unit}
                          </>
                        )}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
};
