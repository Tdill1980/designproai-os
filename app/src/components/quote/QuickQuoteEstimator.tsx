/**
 * QuickQuoteEstimator — Phase 2 core component.
 *
 * Thrive-style line-item estimator that lives on the dashboard
 * /quick-quote page AND inside every design tool via the side drawer
 * (added in Phase 3). This file ships the CORE only — props are pure
 * data, callbacks are passthrough. The Phase 3 EstimatorDrawer wraps
 * this in a Sheet and threads it into DesignPro / ColorPro / etc.
 *
 * Design constraints:
 *   • Controlled component — parent owns EstimatorState. Mutations
 *     happen via the helpers in @/lib/quote-estimator (addItem,
 *     setBaseItem, …) and onChange.
 *   • Live render variants — when the parent regenerates a render
 *     (carbon hood, chrome delete, …), it calls addItem with a
 *     `variantKey`. Identical keys replace, new keys append. The total
 *     ticks live without any imperative API on this component.
 *   • Vocabulary mirrors Thrive: Subtotal · Tax · Total · Deposit ·
 *     Save draft · Send · Request Deposit.
 */

import { useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  FileDown,
  Send,
  ExternalLink,
  Sparkles,
  Printer,
  Paintbrush,
  Layers,
  ShieldCheck,
  Sun,
  Wrench,
  Factory,
  Crown,
  Store,
  ChevronLeft,
  Loader2,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  unitShort,
  COLOR_CHANGE_PRODUCTS,
  PRINTPRO_PRODUCTS,
  SERVICE_PRODUCTS,
  WPW_DESIGN_PRODUCTS,
  RP_DESIGN_PRODUCTS,
  findProductById,
  visibleProducts,
  type QuoteProduct,
} from "@/lib/quote-product-catalog";
import { generateQuotePDF, type QuotePDFData } from "@/lib/quote-pdf-generator";
import { buildPayUrl } from "@/lib/pay-link";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import {
  addItem,
  blankLineItem,
  computeTotals,
  formatMoney,
  lineItemFromProduct,
  lineItemFromUpsell,
  removeItem,
  updateItem,
  type EstimatorLineItem,
  type EstimatorState,
} from "@/lib/quote-estimator";
import { buildWpwCart } from "@/lib/wpw-cart";
import {
  useEffectiveUpsellCatalog,
  type EffectiveUpsell,
} from "@/hooks/useEffectiveUpsellCatalog";

export interface QuickQuoteEstimatorProps {
  value: EstimatorState;
  onChange: (next: EstimatorState) => void;
  /**
   * Optional upsell catalog override. By default the component pulls
   * the shop's effective upsell catalog (catalog defaults + shop
   * overrides from `shop_service_prices`) via the
   * `useEffectiveUpsellCatalog` hook.
   */
  upsells?: EffectiveUpsell[];
  /** Save the current estimate as a draft (no customer notification). */
  onSaveDraft?: (state: EstimatorState) => void | Promise<void>;
  /** Send the estimate to the customer (email + share link). */
  onSend?: (state: EstimatorState) => void | Promise<void>;
  /**
   * Phase 7 / Path B: open the WPW cart pre-loaded with the WPW SKUs
   * from the current estimate. Only the WPW print products go in the
   * cart — shop labor / precision mods stay on the RestylePro side.
   * Pass undefined to hide the button (e.g. for non-WPW shops).
   */
  onCheckoutOnWpw?: (state: EstimatorState, cartUrl: string) => void | Promise<void>;
  /** Hide the customer fields (e.g. when the drawer parent owns them). */
  hideCustomer?: boolean;
  /** Compact density — used in the drawer where vertical space is tight. */
  compact?: boolean;
  /** Disable inputs (e.g. while saving). */
  disabled?: boolean;
  className?: string;
  /** Title shown at the top — defaults to "QuickQuote Estimator". */
  title?: string;
  /**
   * When provided, clicking an upsell hands the upsell off to the parent
   * instead of just appending a line item locally. The parent is then
   * responsible for both the visual edit (e.g. firing
   * apply-quickquote-upsell on the active render) and adding the
   * resulting line item to the estimator state. Returning `false` (or
   * a Promise resolving to false) signals the parent did NOT handle the
   * upsell, in which case the local "add line item only" fallback runs.
   *
   * Lets DesignPro / ColorPro bind chrome-delete / carbon-roof / etc. to
   * the same Gemini stack-on-render flow that PrecisionModButtons uses,
   * without duplicating UI.
   */
  onUpsellApply?: (
    upsell: EffectiveUpsell,
  ) => boolean | void | Promise<boolean | void>;
  /** Optional service_key whose upsell button should show a spinner. */
  upsellPendingKey?: string | null;
}

// ── Category-button picker (mirrors dashboard QuickQuoteCard) ────────
type CategoryId =
  | "color_change"
  | "print_wrap"
  | "ppf"
  | "tint"
  | "chrome_delete"
  | "services"
  | "wpw"
  | "wpw_design"
  | "rp_design";

interface CategoryMeta {
  id: CategoryId;
  label: string;
  icon: LucideIcon;
  accent: string;
}

const BASE_CATEGORIES: CategoryMeta[] = [
  { id: "color_change",  label: "Color Change",  icon: Paintbrush,  accent: "text-[#60A5FA]" },
  { id: "print_wrap",    label: "Print Wrap",    icon: Layers,      accent: "text-fuchsia-300" },
  { id: "ppf",           label: "PPF",           icon: ShieldCheck, accent: "text-emerald-400" },
  { id: "tint",          label: "Window Tint",   icon: Sun,         accent: "text-amber-300" },
  { id: "chrome_delete", label: "Chrome Delete", icon: Sparkles,    accent: "text-purple-300" },
  { id: "services",      label: "Other Services", icon: Wrench,     accent: "text-white/85" },
  { id: "wpw_design",    label: "WPW Design Products", icon: Store, accent: "text-cyan-300" },
  { id: "rp_design",     label: "RestylePro Design Products", icon: Crown, accent: "text-fuchsia-300" },
];
const WPW_CATEGORY: CategoryMeta = {
  id: "wpw",
  label: "WePrintWraps",
  icon: Factory,
  accent: "text-amber-300",
};

function productsForCategory(catId: CategoryId): QuoteProduct[] {
  // Drops products flagged `hidden` (e.g. production packs pulled until the
  // DesignPro pipeline ships) via visibleProducts().
  switch (catId) {
    case "wpw":
    case "print_wrap":
      return visibleProducts(PRINTPRO_PRODUCTS);
    case "color_change":
      return visibleProducts(COLOR_CHANGE_PRODUCTS);
    case "ppf":
      return visibleProducts(SERVICE_PRODUCTS.filter((p) => p.id.includes("ppf")));
    case "tint":
      return visibleProducts(SERVICE_PRODUCTS.filter((p) => p.id === "svc-window-tint"));
    case "chrome_delete":
      return visibleProducts(SERVICE_PRODUCTS.filter((p) => p.id === "svc-chrome-delete"));
    case "services":
      return visibleProducts(
        SERVICE_PRODUCTS.filter(
          (p) =>
            !p.id.includes("ppf") &&
            p.id !== "svc-window-tint" &&
            p.id !== "svc-chrome-delete",
        ),
      );
    case "wpw_design":
      return visibleProducts(WPW_DESIGN_PRODUCTS);
    case "rp_design":
      return visibleProducts(RP_DESIGN_PRODUCTS);
  }
}

const sourceBadgeClass: Record<EstimatorLineItem["source"], string> = {
  base: "bg-[#60A5FA]/15 text-[#60A5FA] border-[#60A5FA]/30",
  render: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  upsell: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  manual: "bg-white/10 text-white/70 border-white/15",
  catalog: "bg-white/10 text-white/70 border-white/15",
};

const sourceBadgeLabel: Record<EstimatorLineItem["source"], string> = {
  base: "Base",
  render: "Render",
  upsell: "Upsell",
  manual: "Custom",
  catalog: "Catalog",
};

export function QuickQuoteEstimator({
  value,
  onChange,
  upsells: upsellsProp,
  onSaveDraft,
  onSend,
  onCheckoutOnWpw,
  hideCustomer = false,
  compact = false,
  disabled = false,
  className,
  title = "QuickQuote Estimator",
  onUpsellApply,
  upsellPendingKey,
}: QuickQuoteEstimatorProps) {
  const totals = useMemo(() => computeTotals(value), [value]);
  const vehicleSummary = useMemo(() => formatVehicle(value), [value]);

  // Phase 8b — pull the shop's effective upsell catalog (catalog
  // defaults + shop overrides from /admin/shop-pricing). Caller can
  // override with the `upsells` prop for tests / sandboxes.
  const effectiveUpsells = useEffectiveUpsellCatalog();
  const upsells = upsellsProp ?? effectiveUpsells;

  // ── Category-button picker (single reusable, at top) ─────────────
  const { data: isWpwTenant = false } = useIsWpwTenant();
  const categories = useMemo<CategoryMeta[]>(
    () => (isWpwTenant ? [WPW_CATEGORY, ...BASE_CATEGORIES] : BASE_CATEGORIES),
    [isWpwTenant],
  );
  const [pickerCategory, setPickerCategory] = useState<CategoryId | null>(null);
  const [pickerProductId, setPickerProductId] = useState<string | null>(null);

  const pickerProducts = pickerCategory ? productsForCategory(pickerCategory) : [];
  const pickerProduct = pickerProductId ? findProductById(pickerProductId) : undefined;

  const choosePickerCategory = (catId: CategoryId) => {
    setPickerCategory(catId);
    const first = productsForCategory(catId)[0];
    setPickerProductId(first?.id ?? null);
  };

  const cancelPicker = () => {
    setPickerCategory(null);
    setPickerProductId(null);
  };

  const addPickerProduct = () => {
    if (!pickerProduct) return;
    onChange(
      addItem(
        value,
        lineItemFromProduct(pickerProduct, { qty: 1, source: "catalog" }),
      ),
    );
    cancelPicker();
  };

  const updateVehicle = (patch: Partial<EstimatorState["vehicle"]>) =>
    onChange({ ...value, vehicle: { ...value.vehicle, ...patch } });

  // Phase 6/follow-up — Download PDF builds a draft PDF straight from
  // the in-memory state. No save is required; the PDF carries a
  // "DRAFT" quote number so the shop owner can preview before saving.
  // Saved-quote PDFs (with real RP-XXXXXX numbers) are downloaded
  // from /admin/quick-quote and /q/<share_token> via the same
  // generateQuotePDF helper.
  const { currentShop } = useOrganization();
  const downloadPdf = async () => {
    if (value.items.length === 0) return;
    const items = value.items.map((i) => ({
      label: i.label,
      detail: i.description ?? `${i.qty} ${unitShort(i.unit)} × $${i.unitPrice}`,
      amount: i.qty * i.unitPrice,
      wooProductId: (i as { productId?: number }).productId,
      quantity: i.qty,
    }));
    const pdfData: QuotePDFData = {
      quoteNumber: "DRAFT",
      createdAt: new Date().toISOString(),
      shopName: currentShop?.name ?? "Your Wrap Shop",
      shopLogoUrl: currentShop?.logo_url ?? null,
      shopWebsite: currentShop?.website ?? null,
      payUrl: buildPayUrl(currentShop?.website, items),
      customer: {
        name: value.customer.name,
        email: value.customer.email,
        phone: value.customer.phone,
      },
      vehicle: {
        year: value.vehicle.year,
        make: value.vehicle.make,
        model: value.vehicle.model,
      },
      sqFt: value.vehicle.sqFt ?? null,
      customerTotal: totals.total,
      shopCost: totals.subtotal,
      lineItems: items,
      renderUrl: value.baseRenderUrl,
      status: "draft",
    };
    await generateQuotePDF(pdfData);
  };

  const updateField = <K extends keyof EstimatorState>(
    key: K,
    next: EstimatorState[K],
  ) => onChange({ ...value, [key]: next });

  const updateCustomer = (patch: Partial<EstimatorState["customer"]>) =>
    onChange({ ...value, customer: { ...value.customer, ...patch } });

  const editItem = (id: string, patch: Partial<Omit<EstimatorLineItem, "id">>) =>
    onChange(updateItem(value, id, patch));

  const dropItem = (id: string) => onChange(removeItem(value, id));

  const addUpsellLocal = (opt: EffectiveUpsell) =>
    onChange(
      addItem(
        value,
        lineItemFromUpsell({
          label: opt.label,
          description: opt.description,
          unit_price: opt.unit_price,
          unit: opt.unit,
        }),
      ),
    );

  const addUpsell = async (opt: EffectiveUpsell) => {
    if (onUpsellApply) {
      const handled = await onUpsellApply(opt);
      // Parent returns explicit `false` when it could not handle the
      // upsell (e.g. no current render to edit, or no precision mod
      // mapped for this service_key). Fall back to a plain line-item
      // add so the upsell still lands on the estimate.
      if (handled === false) addUpsellLocal(opt);
      return;
    }
    addUpsellLocal(opt);
  };

  const addBlank = () => onChange(addItem(value, blankLineItem()));

  return (
    <section
      className={cn(
        "rounded-2xl border border-[#48484a] bg-rp-surface text-white",
        compact ? "p-4 space-y-4" : "p-5 space-y-5",
        className,
      )}
      aria-label="QuickQuote Estimator"
    >
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-[#60A5FA]">
            QuickQuote
          </div>
          <h2 className="text-lg font-semibold text-white mt-0.5 truncate">
            {title}
          </h2>
          {vehicleSummary && (
            <p className="text-xs text-white/60 mt-1 truncate">{vehicleSummary}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[11px] uppercase tracking-wide text-white/50">
            Total
          </div>
          <div className="text-2xl font-bold text-white tabular-nums">
            {formatMoney(totals.total)}
          </div>
        </div>
      </header>

      {/* ── Vehicle (free-text) ─────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label className="text-white/80 text-xs">Year</Label>
          <Input
            disabled={disabled}
            value={value.vehicle.year ?? ""}
            onChange={(e) => updateVehicle({ year: e.target.value })}
            placeholder="2024"
            className="bg-black border-[#48484a] text-white mt-1"
          />
        </div>
        <div>
          <Label className="text-white/80 text-xs">Make</Label>
          <Input
            disabled={disabled}
            value={value.vehicle.make ?? ""}
            onChange={(e) => updateVehicle({ make: e.target.value })}
            placeholder="BMW"
            className="bg-black border-[#48484a] text-white mt-1"
          />
        </div>
        <div>
          <Label className="text-white/80 text-xs">Model</Label>
          <Input
            disabled={disabled}
            value={value.vehicle.model ?? ""}
            onChange={(e) => updateVehicle({ model: e.target.value })}
            placeholder="M4"
            className="bg-black border-[#48484a] text-white mt-1"
          />
        </div>
      </div>

      {/* ── Add a product (category buttons → dropdown → Add) ───── */}
      <div className="rounded-xl border border-[#48484a] bg-black/30 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/90">Add a product</h3>
          {pickerCategory && (
            <button
              type="button"
              onClick={cancelPicker}
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white/65 hover:text-white"
            >
              <ChevronLeft className="w-3 h-3" />
              Change category
            </button>
          )}
        </div>

        {!pickerCategory ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isDesignTile =
                cat.id === "wpw_design" || cat.id === "rp_design";
              return (
                <button
                  key={cat.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => choosePickerCategory(cat.id)}
                  className={cn(
                    "flex flex-col items-start text-left rounded-lg border p-3 transition-all",
                    isDesignTile
                      ? cat.id === "wpw_design"
                        ? "border-cyan-400/40 bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-fuchsia-500/10 hover:border-cyan-300/70"
                        : "border-fuchsia-400/40 bg-gradient-to-br from-fuchsia-500/10 via-purple-500/5 to-blue-500/10 hover:border-fuchsia-300/70"
                      : "border-[#48484a] bg-black/40 hover:border-[#60A5FA]/60 hover:bg-[#60A5FA]/5",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  <Icon className={cn("w-4 h-4 mb-1.5", cat.accent)} />
                  <div className="text-xs font-bold text-white">{cat.label}</div>
                  {cat.id === "wpw_design" && (
                    <div className="text-[9px] text-cyan-200/80 mt-0.5 font-medium">
                      Resell WPW design SKUs
                    </div>
                  )}
                  {cat.id === "rp_design" && (
                    <div className="text-[9px] text-fuchsia-200/80 mt-0.5 font-medium">
                      DesignPro · GraphicsPro · upsells
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            <Select
              value={pickerProductId ?? undefined}
              onValueChange={setPickerProductId}
              disabled={disabled}
            >
              <SelectTrigger
                className="w-full h-10 bg-black border-[#48484a] text-white text-xs font-semibold"
                aria-label="Product"
              >
                <SelectValue placeholder="Select product…" />
              </SelectTrigger>
              <SelectContent className="bg-rp-surface border-[#48484a] text-white max-h-80">
                {pickerProducts.map((p) => (
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
            <Button
              type="button"
              disabled={disabled || !pickerProduct}
              onClick={addPickerProduct}
              className="w-full bg-[#60A5FA] text-black hover:bg-[#7ab6ff] font-semibold"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add to estimate
            </Button>
            <p className="text-[10px] text-white/50 text-center">
              Edit qty &amp; price on the line below after adding.
            </p>
          </div>
        )}
      </div>

      {/* ── Customer (required to save / send / convert to order) ─── */}
      {!hideCustomer && (
        <div className="rounded-xl border border-[#60A5FA]/30 bg-[#60A5FA]/5 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white/90">
              Customer details
            </h3>
            <span className="text-[10px] uppercase tracking-wide text-[#60A5FA]/80">
              Saves to CRM
            </span>
          </div>
          <p className="text-[11px] text-white/55 -mt-1">
            Required to save the quote, follow up later, or convert it to an order.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-white/80 text-xs">Customer name</Label>
              <Input
                disabled={disabled}
                value={value.customer.name ?? ""}
                onChange={(e) => updateCustomer({ name: e.target.value })}
                placeholder="Jane Smith"
                className="bg-black border-[#48484a] text-white mt-1"
              />
            </div>
            <div>
              <Label className="text-white/80 text-xs">Company (optional)</Label>
              <Input
                disabled={disabled}
                value={value.customer.company ?? ""}
                onChange={(e) => updateCustomer({ company: e.target.value })}
                placeholder="Acme Fleet Services"
                className="bg-black border-[#48484a] text-white mt-1"
              />
            </div>
            <div>
              <Label className="text-white/80 text-xs">Email</Label>
              <Input
                disabled={disabled}
                type="email"
                value={value.customer.email ?? ""}
                onChange={(e) => updateCustomer({ email: e.target.value })}
                placeholder="jane@example.com"
                className="bg-black border-[#48484a] text-white mt-1"
              />
            </div>
            <div>
              <Label className="text-white/80 text-xs">Phone</Label>
              <Input
                disabled={disabled}
                type="tel"
                value={value.customer.phone ?? ""}
                onChange={(e) => updateCustomer({ phone: e.target.value })}
                placeholder="(555) 123-4567"
                className="bg-black border-[#48484a] text-white mt-1"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Line items ──────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/90">Line items</h3>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={addBlank}
            className="h-8 text-white/80 hover:text-white"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add line
          </Button>
        </div>

        {value.items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#48484a] bg-black/20 p-6 text-center text-sm text-white/50">
            No line items yet. Add one from the upsells below or click
            <span className="text-white/80"> Add line</span>.
          </div>
        ) : (
          <ul className="space-y-2">
            {value.items.map((item) => (
              <LineRow
                key={item.id}
                item={item}
                disabled={disabled}
                compact={compact}
                onEdit={(patch) => editItem(item.id, patch)}
                onRemove={() => dropItem(item.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── One-click upsells ───────────────────────────────────── */}
      {upsells.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-white/90">
            <Sparkles className="h-3.5 w-3.5 text-amber-300" />
            Pitch an upsell
          </div>
          <div className="flex flex-wrap gap-2">
            {upsells.map((opt) => {
              const isPending = upsellPendingKey === opt.service_key;
              const anyPending =
                !!upsellPendingKey && upsellPendingKey.length > 0;
              return (
                <Button
                  key={opt.service_key}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled || anyPending}
                  onClick={() => void addUpsell(opt)}
                  className="h-8 border-[#48484a] bg-black/40 text-white/90 hover:bg-amber-500/10 hover:border-amber-500/40 hover:text-amber-200 disabled:opacity-50"
                  title={`${opt.label} — ${formatMoney(opt.unit_price)}${opt.is_override ? " (your shop's price)" : " (catalog default)"}`}
                >
                  {isPending ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Plus className="h-3 w-3 mr-1" />
                  )}
                  {opt.label}
                  <span className="ml-1.5 text-[11px] text-white/50 group-hover:text-amber-200/70 tabular-nums">
                    {formatMoney(opt.unit_price)}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Notes ──────────────────────────────────────────────── */}
      <div>
        <Label className="text-white/80 text-xs">Notes for the customer</Label>
        <Textarea
          disabled={disabled}
          value={value.notes}
          onChange={(e) => updateField("notes", e.target.value)}
          placeholder="Lead time, deposit terms, install notes…"
          className="bg-black border-[#48484a] text-white mt-1 min-h-[68px]"
        />
      </div>

      <Separator className="bg-[#48484a]" />

      {/* ── Totals ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2 text-sm">
          <TaxRow
            taxRate={value.taxRate}
            disabled={disabled}
            onChange={(rate) => updateField("taxRate", rate)}
          />
          <DepositRow
            depositRate={value.depositRate}
            disabled={disabled}
            onChange={(rate) => updateField("depositRate", rate)}
          />
        </div>
        <div className="rounded-xl bg-black/40 border border-[#48484a] p-3 space-y-1.5 tabular-nums">
          <div className="flex justify-between text-sm text-white/70">
            <span>Subtotal</span>
            <span>{formatMoney(totals.subtotal)}</span>
          </div>
          {value.taxRate > 0 && (
            <div className="flex justify-between text-sm text-white/70">
              <span>Tax ({(value.taxRate * 100).toFixed(2)}%)</span>
              <span>{formatMoney(totals.tax)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold text-white pt-1 border-t border-white/10">
            <span>Total</span>
            <span>{formatMoney(totals.total)}</span>
          </div>
          {value.depositRate > 0 && (
            <div className="flex justify-between text-xs text-amber-300/90 pt-1">
              <span>Deposit ({(value.depositRate * 100).toFixed(0)}%)</span>
              <span>{formatMoney(totals.deposit)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── WPW-only RestylePro pitch ───────────────────────────────
          Auto-appended to every WPW quote. Single line that pitches
          the full subscription value (designs + marketing + CMS).
          Non-WPW shops don't see this — they don't sell the RP
          subscription. Copy is owner-authored — keep verbatim. */}
      {isWpwTenant && (
        <div className="rounded-xl border border-fuchsia-500/30 bg-gradient-to-r from-fuchsia-500/10 via-purple-500/5 to-blue-500/10 p-3 text-center">
          <p className="text-[11px] text-white/80 leading-relaxed">
            Need Wrap Designs? Want to boost sales?{" "}
            <a
              href="/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fuchsia-300 font-semibold underline underline-offset-2 hover:text-fuchsia-200"
            >
              Subscribe to RestylePro for unlimited wrap designs + marketing + CMS →
            </a>
          </p>
        </div>
      )}

      {/* ── Action bar ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || value.items.length === 0}
          onClick={() => void downloadPdf()}
          className="border-[#48484a] bg-black/40 text-white hover:bg-white/5"
          title="Download a PDF copy of this estimate (no save required)"
        >
          <Printer className="h-4 w-4 mr-1.5" />
          Download PDF
        </Button>
        {onSaveDraft && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled || value.items.length === 0}
            onClick={() => void onSaveDraft(value)}
            className="border-[#48484a] bg-black/40 text-white hover:bg-white/5"
          >
            <FileDown className="h-4 w-4 mr-1.5" />
            Save draft
          </Button>
        )}
        {onCheckoutOnWpw && (() => {
          const wpw = buildWpwCart(value.items);
          if (!wpw.cartUrl) return null;
          return (
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => void onCheckoutOnWpw(value, wpw.cartUrl!)}
              className="border-purple-500/40 bg-purple-500/10 text-purple-200 hover:bg-purple-500/20"
              title={`${wpw.cartItems.length} WPW item${wpw.cartItems.length === 1 ? "" : "s"} in cart · ${wpw.shopOnlyItems.length} stay${wpw.shopOnlyItems.length === 1 ? "s" : ""} on the shop side`}
            >
              <ExternalLink className="h-4 w-4 mr-1.5" />
              Preview WPW cart
            </Button>
          );
        })()}
        {onSend && (
          <Button
            type="button"
            disabled={disabled || value.items.length === 0}
            onClick={() => void onSend(value)}
            className="bg-[#60A5FA] text-black hover:bg-[#7ab6ff]"
          >
            <Send className="h-4 w-4 mr-1.5" />
            Send estimate
          </Button>
        )}
      </div>
    </section>
  );
}

// ── Sub-components ────────────────────────────────────────────────

interface LineRowProps {
  item: EstimatorLineItem;
  disabled: boolean;
  compact: boolean;
  onEdit: (patch: Partial<Omit<EstimatorLineItem, "id">>) => void;
  onRemove: () => void;
}

function LineRow({ item, disabled, compact, onEdit, onRemove }: LineRowProps) {
  const lineTotal = item.qty * item.unitPrice;
  return (
    <li
      className={cn(
        "rounded-xl border border-[#48484a] bg-black/30",
        compact ? "p-2.5" : "p-3",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
            sourceBadgeClass[item.source],
          )}
        >
          {sourceBadgeLabel[item.source]}
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          <Input
            disabled={disabled}
            value={item.label}
            onChange={(e) => onEdit({ label: e.target.value })}
            placeholder="Line item description"
            className="bg-transparent border-0 px-0 py-0 h-auto text-sm font-medium text-white placeholder:text-white/30 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {(item.description || item.source !== "manual") && (
            <Input
              disabled={disabled}
              value={item.description ?? ""}
              onChange={(e) => onEdit({ description: e.target.value })}
              placeholder="Optional description"
              className="bg-transparent border-0 px-0 py-0 h-auto text-xs text-white/55 placeholder:text-white/25 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onRemove}
          aria-label="Remove line"
          className="h-7 w-7 text-white/40 hover:text-red-300 hover:bg-red-500/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-12 gap-2 items-center">
        <div className="col-span-3">
          <Label className="text-[10px] text-white/50 uppercase tracking-wide">
            Qty
          </Label>
          <Input
            disabled={disabled}
            type="number"
            min={0}
            step="0.01"
            value={item.qty}
            onChange={(e) =>
              onEdit({ qty: Math.max(0, Number(e.target.value) || 0) })
            }
            className="bg-black border-[#48484a] text-white h-8 mt-0.5 text-sm tabular-nums"
          />
        </div>
        <div className="col-span-4">
          <Label className="text-[10px] text-white/50 uppercase tracking-wide">
            Unit price
          </Label>
          <Input
            disabled={disabled}
            type="number"
            min={0}
            step="0.01"
            value={item.unitPrice}
            onChange={(e) =>
              onEdit({ unitPrice: Math.max(0, Number(e.target.value) || 0) })
            }
            className="bg-black border-[#48484a] text-white h-8 mt-0.5 text-sm tabular-nums"
          />
        </div>
        <div className="col-span-2 text-center">
          <div className="text-[10px] text-white/50 uppercase tracking-wide">
            Unit
          </div>
          <div className="text-xs text-white/70 mt-1.5">{unitShort(item.unit)}</div>
        </div>
        <div className="col-span-3 text-right">
          <div className="text-[10px] text-white/50 uppercase tracking-wide">
            Line total
          </div>
          <div className="text-sm font-semibold text-white mt-1 tabular-nums">
            {formatMoney(lineTotal)}
          </div>
        </div>
      </div>
    </li>
  );
}

interface RateRowProps {
  taxRate: number;
  disabled: boolean;
  onChange: (rate: number) => void;
}

function TaxRow({ taxRate, disabled, onChange }: RateRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#48484a] bg-black/30 p-3">
      <div>
        <div className="text-sm text-white/85">Tax rate</div>
        <div className="text-[11px] text-white/50">
          Decimal — leave 0 to omit the tax line.
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Input
          disabled={disabled}
          type="number"
          min={0}
          max={1}
          step="0.0025"
          value={taxRate}
          onChange={(e) =>
            onChange(Math.max(0, Math.min(1, Number(e.target.value) || 0)))
          }
          className="bg-black border-[#48484a] text-white h-8 w-24 text-sm tabular-nums"
        />
      </div>
    </div>
  );
}

interface DepositRowProps {
  depositRate: number;
  disabled: boolean;
  onChange: (rate: number) => void;
}

function DepositRow({ depositRate, disabled, onChange }: DepositRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[#48484a] bg-black/30 p-3">
      <div>
        <div className="text-sm text-white/85">Deposit %</div>
        <div className="text-[11px] text-white/50">
          Suggested at send time — actual collection happens via Stripe.
        </div>
      </div>
      <Input
        disabled={disabled}
        type="number"
        min={0}
        max={1}
        step="0.05"
        value={depositRate}
        onChange={(e) =>
          onChange(Math.max(0, Math.min(1, Number(e.target.value) || 0)))
        }
        className="bg-black border-[#48484a] text-white h-8 w-24 text-sm tabular-nums"
      />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────

function formatVehicle(state: EstimatorState): string {
  const v = state.vehicle;
  const parts = [v.year, v.make, v.model].filter(Boolean) as string[];
  const head = parts.join(" ");
  const sqFt = v.sqFt ? `${Math.round(v.sqFt)} sq ft` : null;
  return [head || null, sqFt].filter(Boolean).join(" · ");
}
