/**
 * QuickQuoteEditor
 *
 * Shared dark two-tone quote editor wrapper used by both:
 * - ColorPro "Get Quote" dialog
 * - EmailConfigurator "Configure Quote" section
 *
 * Wraps the <QuickQuote> widget with quote mode toggle, customer info,
 * category selector, add-ons, and pricing options — all in the dark theme
 * with bg-[#0d0d0d] outer, bg-[#2a2a2a] inner cards, and blue→magenta gradient buttons.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Sparkles, ClipboardSignature, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { QuickQuote } from "@/components/tools/QuickQuote";
import { DesignProductsCompareCard } from "@/components/quote/DesignProductsCompareCard";
import {
  SERVICE_CATEGORIES,
  ADD_ONS,
  getAddOnPriceWithOverrides,
  type ServiceCategory,
  type AddOnId,
} from "@/lib/quick-quote";
import { useShopPricing } from "@/hooks/useShopPricing";

interface QuoteSnapshot {
  quoteNumber: string;
  vehicle: string;
  colorName: string;
  manufacturer: string;
  finish: string;
  lineItems: { label: string; detail?: string; amount: number }[];
  total: string;
  region?: string;
}

interface QuickQuoteEditorProps {
  year: string;
  make: string;
  model: string;
  finish: string;
  colorName: string;
  manufacturer: string;
  colorHex?: string;
  productCode?: string;
  swatchImageUrl?: string;
  renderUrl?: string | null;
  visualizationId?: string | null;
  // Optional controlled state (from parent)
  quoteMode?: "quick" | "full";
  onQuoteModeChange?: (mode: "quick" | "full") => void;
  quantity?: string;
  onQuantityChange?: (q: string) => void;
  category?: ServiceCategory;
  onCategoryChange?: (c: ServiceCategory) => void;
  selectedAddOns?: Set<AddOnId>;
  onAddOnsChange?: (addOns: Set<AddOnId>) => void;
  includeLabor?: boolean;
  onIncludeLaborChange?: (v: boolean) => void;
  includeMargin?: boolean;
  onIncludeMarginChange?: (v: boolean) => void;
  marginPercent?: number;
  onMarginPercentChange?: (v: number) => void;
  customerName?: string;
  onCustomerNameChange?: (v: string) => void;
  customerEmail?: string;
  onCustomerEmailChange?: (v: string) => void;
  customerPhone?: string;
  onCustomerPhoneChange?: (v: string) => void;
  companyName?: string;
  onCompanyNameChange?: (v: string) => void;
  // Quote result callback
  onQuoteUpdate?: (data: QuoteSnapshot) => void;
  // Trigger email flow — parent should open EmailConfigurator with type=quote
  onEmailQuote?: () => void;
}

const darkInput = "bg-[#0d0d0d] border-[#2a2a2a] text-white placeholder:text-white/20 focus-visible:ring-[#00C7FF]/40";

export const QuickQuoteEditor = ({
  year, make, model, finish, colorName, manufacturer,
  colorHex, productCode, swatchImageUrl, renderUrl, visualizationId,
  quoteMode: ctrlQuoteMode,
  onQuoteModeChange,
  quantity: ctrlQuantity,
  onQuantityChange,
  category: ctrlCategory,
  onCategoryChange,
  selectedAddOns: ctrlAddOns,
  onAddOnsChange,
  includeLabor: ctrlIncludeLabor,
  onIncludeLaborChange,
  includeMargin: ctrlIncludeMargin,
  onIncludeMarginChange,
  marginPercent: ctrlMarginPercent,
  onMarginPercentChange,
  customerName: ctrlCustomerName,
  onCustomerNameChange,
  customerEmail: ctrlCustomerEmail,
  onCustomerEmailChange,
  customerPhone: ctrlCustomerPhone,
  onCustomerPhoneChange,
  companyName: ctrlCompanyName,
  onCompanyNameChange,
  onQuoteUpdate,
  onEmailQuote,
}: QuickQuoteEditorProps) => {
  // Uncontrolled fallback state
  const [uQuoteMode, setUQuoteMode] = useState<"quick" | "full">("quick");
  const [uQuantity, setUQuantity] = useState("1");
  const [uCategory, setUCategory] = useState<ServiceCategory>("full_wraps");
  const [uAddOns, setUAddOns] = useState<Set<AddOnId>>(new Set());
  // Per-quote add-on price overrides — empty string means "use default".
  const [addOnPriceOverrides, setAddOnPriceOverrides] = useState<
    Partial<Record<AddOnId, string>>
  >({});
  const { pricing: shopPricing } = useShopPricing();
  const [uIncludeLabor, setUIncludeLabor] = useState(true);
  const [uIncludeMargin, setUIncludeMargin] = useState(true);
  const [uMarginPercent, setUMarginPercent] = useState(65);
  const [uCustomerName, setUCustomerName] = useState("");
  const [uCustomerEmail, setUCustomerEmail] = useState("");
  const [uCustomerPhone, setUCustomerPhone] = useState("");
  const [uCompanyName, setUCompanyName] = useState("");

  const quoteMode = ctrlQuoteMode ?? uQuoteMode;
  const setQuoteMode = (v: "quick" | "full") => (onQuoteModeChange ?? setUQuoteMode)(v);
  const quantity = ctrlQuantity ?? uQuantity;
  const setQuantity = (v: string) => (onQuantityChange ?? setUQuantity)(v);
  const category = ctrlCategory ?? uCategory;
  const setCategory = (v: ServiceCategory) => (onCategoryChange ?? setUCategory)(v);
  const addOns = ctrlAddOns ?? uAddOns;
  const setAddOns = (v: Set<AddOnId>) => (onAddOnsChange ?? setUAddOns)(v);
  const includeLabor = ctrlIncludeLabor ?? uIncludeLabor;
  const setIncludeLabor = (v: boolean) => (onIncludeLaborChange ?? setUIncludeLabor)(v);
  const includeMargin = ctrlIncludeMargin ?? uIncludeMargin;
  const setIncludeMargin = (v: boolean) => (onIncludeMarginChange ?? setUIncludeMargin)(v);
  const marginPercent = ctrlMarginPercent ?? uMarginPercent;
  const setMarginPercent = (v: number) => (onMarginPercentChange ?? setUMarginPercent)(v);
  const customerName = ctrlCustomerName ?? uCustomerName;
  const setCustomerName = (v: string) => (onCustomerNameChange ?? setUCustomerName)(v);
  const customerEmail = ctrlCustomerEmail ?? uCustomerEmail;
  const setCustomerEmail = (v: string) => (onCustomerEmailChange ?? setUCustomerEmail)(v);
  const customerPhone = ctrlCustomerPhone ?? uCustomerPhone;
  const setCustomerPhone = (v: string) => (onCustomerPhoneChange ?? setUCustomerPhone)(v);
  const companyName = ctrlCompanyName ?? uCompanyName;
  const setCompanyName = (v: string) => (onCompanyNameChange ?? setUCompanyName)(v);

  const toggleAddOn = (id: AddOnId) => {
    const next = new Set(addOns);
    if (next.has(id)) next.delete(id); else next.add(id);
    setAddOns(next);
  };

  const setAddOnOverride = (id: AddOnId, raw: string) => {
    setAddOnPriceOverrides((prev) => ({ ...prev, [id]: raw }));
  };

  const clearAddOnOverride = (id: AddOnId) => {
    setAddOnPriceOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const addOnPriceFor = (id: AddOnId): number => {
    return getAddOnPriceWithOverrides(id, shopPricing as any);
  };

  // Numeric-only override map sent to QuickQuote for the total calc.
  const numericAddOnOverrides: Partial<Record<AddOnId, number>> = Object.fromEntries(
    Object.entries(addOnPriceOverrides)
      .map(([id, raw]) => {
        const n = parseFloat(raw || "");
        return Number.isFinite(n) ? [id, n] : null;
      })
      .filter(Boolean) as [AddOnId, number][],
  );

  return (
    <div className="bg-[#0d0d0d] rounded-xl border border-[#1a1a1a] p-4 space-y-4">
      {/* Quote Mode Toggle */}
      <div className="grid grid-cols-2 gap-0 border border-[#1a1a1a] rounded-lg overflow-hidden">
        <button
          onClick={() => setQuoteMode("quick")}
          className={cn(
            "flex items-center justify-center gap-2 h-10 text-xs font-semibold transition-all",
            quoteMode === "quick"
              ? "bg-gradient-to-r from-[#2563eb] to-[#a855f7] text-white"
              : "bg-[#2a2a2a] text-white/50 hover:bg-[#1a1a1a] hover:text-white/70"
          )}
        >
          <Sparkles className="w-3.5 h-3.5" /> Quick Price
        </button>
        <button
          onClick={() => setQuoteMode("full")}
          className={cn(
            "flex items-center justify-center gap-2 h-10 text-xs font-semibold transition-all",
            quoteMode === "full"
              ? "bg-gradient-to-r from-[#2563eb] to-[#a855f7] text-white"
              : "bg-[#2a2a2a] text-white/50 hover:bg-[#1a1a1a] hover:text-white/70"
          )}
        >
          <ClipboardSignature className="w-3.5 h-3.5" /> Full Quote
        </button>
      </div>

      {/* Customer Info (Full Quote) */}
      {quoteMode === "full" && (
        <div className="bg-[#2a2a2a] rounded-lg border border-[#1a1a1a] p-3 space-y-2">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Customer Info</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input placeholder="Customer Name *" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={cn("h-8 text-xs", darkInput)} />
            <Input placeholder="Email *" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={cn("h-8 text-xs", darkInput)} />
            <Input placeholder="Phone *" type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className={cn("h-8 text-xs", darkInput)} />
            <Input placeholder="Shop / Company *" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={cn("h-8 text-xs", darkInput)} />
          </div>
        </div>
      )}

      {/* Category */}
      <div>
        <p className="text-[10px] font-semibold text-white/30 mb-1.5 uppercase tracking-wider">Category</p>
        <div className="flex flex-wrap gap-1.5">
          {(["full_wraps", "partial_wraps", "chrome_delete", "ppf", "window_tint", "all_products"] as ServiceCategory[]).map((catId) => (
            <button
              key={catId}
              onClick={() => setCategory(catId)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[10px] font-semibold border transition-all",
                category === catId
                  ? "bg-gradient-to-r from-[#2563eb] to-[#a855f7] text-white border-transparent"
                  : "bg-[#2a2a2a] text-white/60 border-[#1a1a1a] hover:border-[#a855f7]/50 hover:text-white"
              )}
            >
              {SERVICE_CATEGORIES[catId].label}
            </button>
          ))}
        </div>
      </div>

      {/* Quantity & Finish */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] font-semibold text-white/30 mb-1 block uppercase tracking-wider">Quantity</Label>
          <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} className={cn("h-8 text-xs", darkInput)} />
        </div>
        <div>
          <Label className="text-[10px] font-semibold text-white/30 mb-1 block uppercase tracking-wider">Finish</Label>
          <div className="h-8 flex items-center px-2 bg-[#2a2a2a] border border-[#1a1a1a] rounded text-xs text-white/70 font-medium">
            {finish || "Gloss"}
          </div>
        </div>
      </div>

      {/* Add-Ons */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Add-Ons</p>
          <p className="text-[9px] text-white/30">Click to enable · edit $ to override</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {(["ppf_hood", "roof_wrap", "chrome_delete", "window_tint", "custom_graphics"] as AddOnId[]).map((id) => {
            const enabled = addOns.has(id);
            const defaultPrice = addOnPriceFor(id);
            const overrideRaw = addOnPriceOverrides[id];
            return (
              <div
                key={id}
                className={cn(
                  "rounded-lg border p-1.5 flex items-center gap-2 transition-all",
                  enabled
                    ? "bg-[#1a1a1a] border-[#a855f7]/40"
                    : "bg-[#2a2a2a] border-[#1a1a1a]"
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleAddOn(id)}
                  className={cn(
                    "flex-1 min-w-0 text-left px-2 py-1 rounded-md text-[10px] font-semibold transition-all",
                    enabled
                      ? "bg-gradient-to-r from-[#2563eb] to-[#a855f7] text-white"
                      : "text-white/60 hover:text-white"
                  )}
                >
                  {ADD_ONS[id].label}
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] text-white/40">$</span>
                  <Input
                    type="number"
                    value={overrideRaw ?? ""}
                    placeholder={String(defaultPrice)}
                    onChange={(e) => setAddOnOverride(id, e.target.value)}
                    disabled={!enabled}
                    className={cn(
                      "h-7 w-16 text-[11px] text-right px-1.5 font-semibold",
                      darkInput,
                      !enabled && "opacity-50",
                    )}
                    step="5"
                    min="0"
                    title={`Default $${defaultPrice}. Type to override for this quote.`}
                  />
                  {overrideRaw !== undefined && overrideRaw !== "" && (
                    <button
                      type="button"
                      onClick={() => clearAddOnOverride(id)}
                      className="text-[9px] text-white/40 hover:text-white px-1"
                      title="Reset to default"
                    >
                      ↺
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pricing Options */}
      <div className="bg-[#2a2a2a] rounded-lg border border-[#1a1a1a] p-3 space-y-3">
        <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wider">Pricing Options</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-white">Include Labor</p>
            <p className="text-[9px] text-white/40">Add installation labor costs</p>
          </div>
          <Switch checked={includeLabor} onCheckedChange={setIncludeLabor} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-white">Include Margin</p>
            <p className="text-[9px] text-white/40">Add profit margin</p>
          </div>
          <Switch checked={includeMargin} onCheckedChange={setIncludeMargin} />
        </div>
        {includeMargin && (
          <div>
            <p className="text-xs font-semibold text-white mb-1.5">Margin: {marginPercent}%</p>
            <Slider value={[marginPercent]} onValueChange={([v]) => setMarginPercent(v)} min={0} max={200} step={5} />
          </div>
        )}
      </div>

      {/* Design Products comparison — WPW tenants only (gated internally) */}
      <DesignProductsCompareCard />

      {/* QuickQuote Widget */}
      <QuickQuote
        year={year}
        make={make}
        model={model}
        finish={finish || "Gloss"}
        colorName={colorName}
        manufacturer={manufacturer}
        colorHex={colorHex}
        productCode={productCode}
        swatchImageUrl={swatchImageUrl}
        toolSource="ColorPro"
        renderUrl={renderUrl || null}
        visualizationId={visualizationId || null}
        quantity={parseInt(quantity) || 1}
        category={category}
        selectedAddOns={Array.from(addOns)}
        addOnPriceOverrides={numericAddOnOverrides}
        includeLabor={includeLabor}
        includeMargin={includeMargin}
        marginPercent={marginPercent}
        quoteMode={quoteMode}
        customerInfo={quoteMode === "full" ? { name: customerName, email: customerEmail, phone: customerPhone, company: companyName } : undefined}
        onQuoteUpdate={onQuoteUpdate}
      />

      {/* Email Quote Button — opens EmailConfigurator pre-set to quote mode */}
      {onEmailQuote && (
        <Button
          onClick={onEmailQuote}
          className="w-full h-11 rounded-lg bg-gradient-to-r from-[#2563eb] to-[#a855f7] hover:from-[#1d4ed8] hover:to-[#9333ea] text-white text-sm font-bold"
        >
          <Mail className="h-4 w-4 mr-2" />
          Email Quote to Customer
        </Button>
      )}
    </div>
  );
};
