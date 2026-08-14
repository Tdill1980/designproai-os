/**
 * RestyleProAI QuickQuote
 *
 * Dark-themed deterministic wrap pricing card:
 * - Vehicle sq ft from 1,664-vehicle database
 * - Linear yards of film (60" roll + 15% waste) for vinyl
 * - Sq ft pricing for printed products
 * - Film material cost by finish type
 * - Labor cost by US state/region
 * - Shop products as quotable line items
 * - Editable total price
 * - Quote number tied to render
 * - Convert to Job button
 */

import { useState, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Calculator, DollarSign, MapPin, Copy, Check,
  FileText, Briefcase, Car, Plus, X, Mail, Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  calculateEstimate,
  US_STATES,
  REGIONS,
  ADD_ONS,
  SERVICE_CATEGORIES,
  applyMargin,
  getAddOnPriceWithOverrides,
  type WrapEstimate,
  type PriceRegion,
  type ServiceCategory,
  type AddOnId,
  type ShopPricingOverrides,
} from "@/lib/quick-quote";
import { saveQuote as saveQuoteToDb } from "@/lib/quickquote-db";
import { useShopProducts, type ShopProduct } from "@/hooks/useShopProducts";

interface CustomerInfo {
  name: string;
  email: string;
  phone: string;
  company: string;
}

interface QuickQuoteProps {
  year: string;
  make: string;
  model: string;
  finish: string;
  colorName: string;
  manufacturer: string;
  colorHex?: string;
  productCode?: string;
  swatchImageUrl?: string;
  toolSource: "ColorPro" | "PatternPro" | "FadeWraps" | "DesignPro";
  renderUrl?: string | null;
  visualizationId?: string | null;
  className?: string;
  quantity?: number;
  category?: ServiceCategory;
  selectedAddOns?: AddOnId[];
  /**
   * Per-quote add-on price overrides keyed by AddOnId. Wins over the
   * per-shop and global defaults. Lets the QuickQuoteEditor expose a
   * price field next to each enabled add-on so quoters can adjust the
   * charge for a specific job without changing shop-wide defaults.
   */
  addOnPriceOverrides?: Partial<Record<AddOnId, number>>;
  includeLabor?: boolean;
  includeMargin?: boolean;
  marginPercent?: number;
  quoteMode?: "quick" | "full";
  customerInfo?: CustomerInfo;
  onEmailClick?: () => void;
  onSaveSuccess?: () => void;
  shopPricing?: ShopPricingOverrides;
  /**
   * Sub-account shop slug for public quote submissions. Threaded down to
   * saveQuote which routes to submit-public-quote when no auth session.
   * Defaults to "wpw" (mothership) when omitted.
   */
  shopSlug?: string;
  /**
   * Seeds the film-rate override so the line item shows the correct price
   * for the selected QuickQuote product (Avery / 3M / Color Change /
   * PrintPro). When provided, replaces the rate auto-derived from finish.
   */
  initialRateOverride?: { perYard?: number; perSqFt?: number };
  /**
   * Seeds the quantity override for the line item — e.g. when the user
   * enters sq ft directly, or enters height × width and we convert to
   * sq ft on the page. Mirrors the per-line Qty input but lets the
   * parent page (WPW-style size entry) drive it.
   */
  initialQtyOverride?: { sqFt?: number; yards?: number };
  /**
   * Force the line item into printed-wrap (sq-ft) pricing mode regardless
   * of `toolSource`. Used by the QuickQuotePage dropdown when the user
   * picks an Avery / 3M / PrintPro printed wrap product from ColorPro.
   */
  forcePrintPro?: boolean;
  /**
   * Force the line item into WallPro (linear-foot) pricing mode. Reuses
   * the sq-ft math path but relabels the unit as "linear ft" / "lf"
   * everywhere (line item, email detail, saved quote).
   */
  forceWallPro?: boolean;
  onQuoteUpdate?: (data: {
    quoteNumber: string;
    vehicle: string;
    colorName: string;
    manufacturer: string;
    finish: string;
    lineItems: { label: string; detail?: string; amount: number }[];
    total: string;
    region?: string;
  }) => void;
}

export const QuickQuote = ({
  year, make, model, finish, colorName, manufacturer,
  colorHex, productCode, swatchImageUrl,
  toolSource, renderUrl, visualizationId, className,
  quantity = 1,
  category = "full_wraps",
  selectedAddOns = [],
  addOnPriceOverrides,
  includeLabor = true,
  includeMargin = false,
  marginPercent = 65,
  quoteMode = "quick",
  shopPricing,
  shopSlug,
  customerInfo,
  onEmailClick,
  onSaveSuccess,
  onQuoteUpdate,
  initialRateOverride,
  initialQtyOverride,
  forcePrintPro,
  forceWallPro,
}: QuickQuoteProps) => {
  // WallPro uses linear-foot pricing but piggybacks on the sq-ft math path
  // (qty × rate). When this flag is true, every "sq ft" label becomes
  // "linear ft" — so the line item, email detail, and saved quote
  // accurately reflect wall-wrap billing.
  const qtyLabelLong = forceWallPro ? "linear ft" : "sq ft";
  const { toast } = useToast();
  const [stateCode, setStateCode] = useState("TX");
  const [customPrice, setCustomPrice] = useState<string>("");
  const [priceManuallySet, setPriceManuallySet] = useState(false);
  const [copied, setCopied] = useState(false);
  const [convertedToJob, setConvertedToJob] = useState(false);
  const [shopName, setShopName] = useState("");
  const [yardsOverride, setYardsOverride] = useState<string>(
    initialQtyOverride?.yards ? initialQtyOverride.yards.toString() : "",
  );
  const [sqFtOverride, setSqFtOverride] = useState<string>(
    initialQtyOverride?.sqFt ? initialQtyOverride.sqFt.toString() : "",
  );
  // Keep the qty override in sync when the parent-driven WPW-style size
  // entry (sq ft / yards / H × W) updates.
  useEffect(() => {
    if (initialQtyOverride?.yards !== undefined) {
      setYardsOverride(initialQtyOverride.yards.toString());
    }
    if (initialQtyOverride?.sqFt !== undefined) {
      setSqFtOverride(initialQtyOverride.sqFt.toString());
    }
  }, [initialQtyOverride?.yards, initialQtyOverride?.sqFt]);
  const [customerName, setCustomerName] = useState("");
  const [customLineLabel, setCustomLineLabel] = useState("");
  const [customLinePrice, setCustomLinePrice] = useState("");
  // Multi custom lines (supplement to the legacy single custom line above)
  type ExtraLine = { id: string; label: string; price: string };
  const [extraLines, setExtraLines] = useState<ExtraLine[]>([]);
  const addExtraLine = () =>
    setExtraLines((prev) => [...prev, { id: Math.random().toString(36).slice(2, 9), label: "", price: "" }]);
  const removeExtraLine = (id: string) =>
    setExtraLines((prev) => prev.filter((l) => l.id !== id));
  const updateExtraLine = (id: string, patch: Partial<ExtraLine>) =>
    setExtraLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  // Shop products — quotable items from the shop's product catalog
  const { products: shopProducts } = useShopProducts();
  const quotableProducts = useMemo(
    () => shopProducts.filter((p) => p.is_quotable && p.is_active),
    [shopProducts]
  );
  type ProductLine = { id: string; productId: string; name: string; price: number; qty: number; wooProductId?: number };
  const [productLines, setProductLines] = useState<ProductLine[]>([]);
  const addProductLine = (product: ShopProduct) => {
    const existing = productLines.find((l) => l.productId === product.id);
    if (existing) {
      setProductLines((prev) =>
        prev.map((l) => l.productId === product.id ? { ...l, qty: l.qty + 1 } : l)
      );
    } else {
      setProductLines((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).slice(2, 9),
          productId: product.id,
          name: product.name,
          price: Number(product.price),
          qty: 1,
          wooProductId: product.woo_product_id ?? undefined,
        },
      ]);
    }
  };
  const removeProductLine = (id: string) =>
    setProductLines((prev) => prev.filter((l) => l.id !== id));
  const updateProductLineQty = (id: string, qty: number) =>
    setProductLines((prev) => prev.map((l) => l.id === id ? { ...l, qty: Math.max(1, qty) } : l));

  const productLinesTotal = useMemo(
    () => productLines.reduce((sum, l) => sum + l.price * l.qty, 0),
    [productLines]
  );

  // Per-yard rate override (vinyl film pricing)
  const [filmCostPerYardOverride, setFilmCostPerYardOverride] = useState<string>(
    initialRateOverride?.perYard ? initialRateOverride.perYard.toString() : "",
  );
  // Per-sq-ft rate override (DesignPro printed wrap / GraphicsPro cut contour)
  const [materialCostPerUnitOverride, setMaterialCostPerUnitOverride] = useState<string>(
    initialRateOverride?.perSqFt ? initialRateOverride.perSqFt.toString() : "",
  );
  const [quoteCalculated, setQuoteCalculated] = useState(false);

  // Keep the rate override in sync when the parent swaps the selected product
  // (e.g. user picks "Avery 1105 EZRS" → $5.27/sqft, then switches to
  // "3M IJ180 Contour-Cut" → $6.95/sqft).
  useEffect(() => {
    if (initialRateOverride?.perYard !== undefined) {
      setFilmCostPerYardOverride(initialRateOverride.perYard.toString());
    }
    if (initialRateOverride?.perSqFt !== undefined) {
      setMaterialCostPerUnitOverride(initialRateOverride.perSqFt.toString());
    }
  }, [initialRateOverride?.perYard, initialRateOverride?.perSqFt]);

  type InstallMode = "hourly" | "flat" | "custom";
  const [installMode, setInstallMode] = useState<InstallMode>("hourly");
  const [installHourlyRate, setInstallHourlyRate] = useState<string>("75");
  const [installHours, setInstallHours] = useState<string>("8");
  const [installFlatPrice, setInstallFlatPrice] = useState<string>("");

  const estimate = useMemo(() => {
    if (!make || !model) return null;
    const raw = calculateEstimate({
      year, make, model, finish, colorName, manufacturer,
      stateCode, toolSource, renderUrl, visualizationId,
      shopPricing,
    });
    // Optional override: when the QuickQuotePage product dropdown picks an
    // Avery / 3M / PrintPro (printed wrap) product, we must force the line
    // item into sq-ft pricing regardless of the underlying toolSource.
    // WallPro also needs sq-ft-style math (qty × rate), just with a
    // "linear ft" label.
    const wantsSqFt = forceWallPro === true || forcePrintPro === true;
    if (wantsSqFt && !raw.isPrintPro) {
      return { ...raw, isPrintPro: true };
    }
    if (forcePrintPro === false && raw.isPrintPro && !forceWallPro) {
      return { ...raw, isPrintPro: false };
    }
    return raw;
  }, [year, make, model, finish, colorName, manufacturer, stateCode, toolSource, renderUrl, visualizationId, shopPricing, forcePrintPro, forceWallPro]);

  const installCost = useMemo(() => {
    if (installMode === "hourly") {
      const rate = parseFloat(installHourlyRate) || 0;
      const hours = parseFloat(installHours) || 0;
      return Math.round(rate * hours * 100) / 100;
    }
    if (installMode === "flat") {
      return estimate?.laborTotal || 0;
    }
    return 0;
  }, [installMode, installHourlyRate, installHours, estimate?.laborTotal]);

  useEffect(() => {
    if (estimate && installMode === "flat") {
      setInstallFlatPrice(estimate.laborTotal.toFixed(2));
    }
  }, [estimate?.laborTotal, installMode]);

  const categoryMultiplier = SERVICE_CATEGORIES[category]?.sqFtMultiplier || 1.0;

  const addOnsTotal = useMemo(() => {
    return selectedAddOns.reduce((sum, id) => {
      const override = addOnPriceOverrides?.[id];
      const price =
        typeof override === "number" && !Number.isNaN(override)
          ? override
          : getAddOnPriceWithOverrides(id, shopPricing);
      return sum + price;
    }, 0);
  }, [selectedAddOns, shopPricing, addOnPriceOverrides]);

  const extraLinesTotal = useMemo(
    () => extraLines.reduce((sum, l) => sum + (parseFloat(l.price) || 0), 0),
    [extraLines]
  );

  // Effective (overridable) film values — drive totals, line item, copy & export
  const effectiveYards = useMemo(
    () => parseInt(yardsOverride) || estimate?.yardsNeeded || 0,
    [yardsOverride, estimate?.yardsNeeded]
  );
  const effectiveFilmCostPerYard = useMemo(
    () => parseFloat(filmCostPerYardOverride) || estimate?.filmCostPerYard || 0,
    [filmCostPerYardOverride, estimate?.filmCostPerYard]
  );
  const effectiveSqFt = useMemo(
    () => parseFloat(sqFtOverride) || estimate?.sqFt || 0,
    [sqFtOverride, estimate?.sqFt]
  );
  const effectiveMaterialCostPerUnit = useMemo(
    () => parseFloat(materialCostPerUnitOverride) || estimate?.materialCostPerUnit || 0,
    [materialCostPerUnitOverride, estimate?.materialCostPerUnit]
  );
  const effectiveFilmCostTotal = useMemo(() => {
    if (!estimate) return 0;
    if (estimate.isPrintPro) return effectiveSqFt * effectiveMaterialCostPerUnit;
    return effectiveYards * effectiveFilmCostPerYard;
  }, [estimate?.isPrintPro, effectiveSqFt, effectiveMaterialCostPerUnit, effectiveYards, effectiveFilmCostPerYard]);

  const totalEstimate = useMemo(() => {
    const film = effectiveFilmCostTotal * categoryMultiplier;
    const labor = includeLabor ? installCost : 0;
    const customLine = parseFloat(customLinePrice) || 0;
    let subtotal = (film + labor + customLine + extraLinesTotal + productLinesTotal + addOnsTotal) * (quantity || 1);
    if (includeMargin && marginPercent > 0) {
      subtotal = applyMargin(subtotal, marginPercent);
    }
    return Math.round(subtotal * 100) / 100;
  }, [effectiveFilmCostTotal, installCost, customLinePrice, extraLinesTotal, productLinesTotal, categoryMultiplier, addOnsTotal, quantity, includeLabor, includeMargin, marginPercent]);

  // Auto-populate customPrice from the calculated estimate, but ONLY if the
  // user hasn't manually overridden it. Once they type a custom value, stop
  // auto-overwriting so they can keep their override.
  useEffect(() => {
    if (totalEstimate > 0 && !priceManuallySet) {
      setCustomPrice(totalEstimate.toFixed(2));
    }
  }, [totalEstimate, priceManuallySet]);

  const trackEvent = async (eventType: string, metadata?: Record<string, unknown>) => {
    if (!estimate) return;
    try {
      await supabase.from("quote_events").insert({
        event_type: eventType,
        quote_id: estimate.quoteNumber,
        product_type: toolSource,
        source: "quick-quote",
        metadata: {
          vehicle: `${year} ${make} ${model}`,
          colorName, manufacturer, finish,
          sqFt: estimate.sqFt,
          yardsNeeded: estimate.yardsNeeded,
          price: customPrice,
          stateCode,
          region: estimate.region,
          installMode,
          ...metadata,
        } as any,
      });
    } catch {}
  };

  useEffect(() => {
    if (customerInfo?.name && !customerName) {
      setCustomerName(customerInfo.name);
    }
  }, [customerInfo?.name]);

  useEffect(() => {
    if (estimate) trackEvent("estimate_viewed");
  }, [estimate?.quoteNumber]);

  // Emit quote data to parent when total changes
  useEffect(() => {
    if (!estimate || !onQuoteUpdate) return;
    const filmAmount = effectiveFilmCostTotal * categoryMultiplier;
    const laborAmount = includeLabor ? installCost : 0;
    const customLine = parseFloat(customLinePrice) || 0;
    const items: { label: string; detail?: string; amount: number }[] = [
      {
        label: `${estimate.manufacturer} ${estimate.colorName} (${estimate.finish})`,
        detail: estimate.isPrintPro
          ? `${effectiveSqFt} ${qtyLabelLong} @ $${effectiveMaterialCostPerUnit.toFixed(2)}/${qtyLabelLong}`
          : `${effectiveYards} yds @ $${effectiveFilmCostPerYard.toFixed(2)}/yd`,
        amount: filmAmount,
      },
    ];
    if (includeLabor) {
      items.push({
        label: "Install Labor",
        detail: installMode === "hourly"
          ? `${installHours} hrs @ $${installHourlyRate}/hr`
          : `${estimate.sqFt} sq ft @ $${estimate.laborPerSqFt}/sq ft`,
        amount: laborAmount,
      });
    }
    if (addOnsTotal > 0) {
      items.push({ label: "Add-Ons", amount: addOnsTotal });
    }
    if (customLineLabel && customLine > 0) {
      items.push({ label: customLineLabel, amount: customLine });
    }
    extraLines.forEach((l) => {
      const amt = parseFloat(l.price) || 0;
      if (l.label && amt > 0) items.push({ label: l.label, amount: amt });
    });
    productLines.forEach((l) => {
      items.push({ label: l.name, detail: l.qty > 1 ? `${l.qty} x $${l.price.toFixed(2)}` : undefined, amount: l.price * l.qty });
    });
    // Customer-facing line items must sum to the marked-up total.
    // Scale each raw line by (customerTotal / rawSubtotal) so the email/export
    // shows the marked-up prices, never the raw shop cost.
    const rawSubtotal = items.reduce((s, it) => s + it.amount, 0);
    const customerTotal = parseFloat(customPrice) || totalEstimate;
    const scale =
      rawSubtotal > 0 && customerTotal > 0 ? customerTotal / rawSubtotal : 1;
    const customerItems = items.map((it) => ({
      ...it,
      amount: Math.round(it.amount * scale * 100) / 100,
    }));
    onQuoteUpdate({
      quoteNumber: estimate.quoteNumber,
      vehicle: `${estimate.vehicle.year} ${estimate.vehicle.make} ${estimate.vehicle.model}`,
      colorName: estimate.colorName,
      manufacturer: estimate.manufacturer,
      finish: estimate.finish,
      lineItems: customerItems,
      total: customerTotal.toFixed(2),
      region: estimate.region,
    });
  }, [totalEstimate, customPrice, onQuoteUpdate]);

  const handleSaveQuote = () => {
    if (!estimate) return;
    const adjustedFilmCost = effectiveFilmCostTotal * categoryMultiplier;
    const customLineCost = parseFloat(customLinePrice) || 0;
    const laborAmount = includeLabor ? installCost : 0;
    let lineNum = 1;
    const lines: string[] = [
      shopName || `RestyleProAI`,
      `Quote #${estimate.quoteNumber}`,
      quoteMode === "full" ? `Mode: Full Quote` : `Mode: Quick Price`,
      ``,
    ];
    if (customerInfo?.name || customerName) {
      lines.push(`Customer: ${customerInfo?.name || customerName}`);
    }
    if (customerInfo?.email) lines.push(`Email: ${customerInfo.email}`);
    if (customerInfo?.phone) lines.push(`Phone: ${customerInfo.phone}`);
    if (customerInfo?.company) lines.push(`Company: ${customerInfo.company}`);
    lines.push(
      `Vehicle: ${estimate.vehicle.year} ${estimate.vehicle.make} ${estimate.vehicle.model}`,
      `Category: ${SERVICE_CATEGORIES[category]?.label || category}`,
      quantity > 1 ? `Quantity: ${quantity}` : '',
      ``,
      `--- LINE ITEMS ---`,
      ``,
      `${lineNum}. ${estimate.manufacturer}${productCode ? ` ${productCode}` : ""} — ${estimate.colorName} (${estimate.finish})`,
      estimate.isPrintPro
        ? `   ${effectiveSqFt} ${qtyLabelLong} × $${effectiveMaterialCostPerUnit.toFixed(2)}/${qtyLabelLong} = $${adjustedFilmCost.toFixed(2)}`
        : `   ${effectiveYards} yards × $${effectiveFilmCostPerYard.toFixed(2)}/yd = $${adjustedFilmCost.toFixed(2)}`,
    );
    lineNum++;
    if (includeLabor) {
      lines.push(
        ``,
        `${lineNum}. Install Labor`,
        installMode === "hourly"
          ? `   ${installHours} hrs × $${installHourlyRate}/hr = $${laborAmount.toFixed(2)}`
          : `   ${estimate.sqFt} sq ft × $${estimate.laborPerSqFt}/sq ft = $${laborAmount.toFixed(2)}`,
      );
      lineNum++;
    }
    if (selectedAddOns.length > 0) {
      lines.push(``, `${lineNum}. Add-Ons`);
      selectedAddOns.forEach((id) => {
        const addon = ADD_ONS[id];
        if (addon) lines.push(`   ${addon.label}: $${addon.flatPrice.toFixed(2)}`);
      });
      lines.push(`   Add-Ons Subtotal: $${addOnsTotal.toFixed(2)}`);
      lineNum++;
    }
    if (customLineLabel && customLineCost > 0) {
      lines.push(``, `${lineNum}. ${customLineLabel}`, `   $${customLineCost.toFixed(2)}`);
      lineNum++;
    }
    extraLines.forEach((l) => {
      const amt = parseFloat(l.price) || 0;
      if (l.label && amt > 0) {
        lines.push(``, `${lineNum}. ${l.label}`, `   $${amt.toFixed(2)}`);
        lineNum++;
      }
    });
    productLines.forEach((l) => {
      const amt = l.price * l.qty;
      lines.push(``, `${lineNum}. ${l.name}${l.qty > 1 ? ` (x${l.qty})` : ''}`, `   $${amt.toFixed(2)}`);
      lineNum++;
    });
    if (includeMargin && marginPercent > 0) {
      lines.push(``, `Margin: ${marginPercent}%`);
    }
    if (quantity > 1) {
      lines.push(`Quantity: ${quantity}`);
    }
    lines.push(``, `--- TOTAL ---`, `$${customPrice || totalEstimate.toFixed(2)}`, ``);
    lines.push(`Region: ${US_STATES.find(s => s.code === estimate.stateCode)?.name}`);

    const text = lines.filter(Boolean).join("\n");

    navigator.clipboard.writeText(text);
    setCopied(true);
    setQuoteCalculated(true);
    setTimeout(() => setCopied(false), 2000);
    trackEvent("quote_saved");

    // Persist to the shop's quotes table so it shows up in Admin Quotes Manager.
    // Runs in parallel with the clipboard copy; failure does not block the UI.
    const shopCost = Math.round(
      (filmCost * categoryMultiplier +
        (includeLabor ? installCost : 0) +
        customLineCost +
        extraLinesTotal +
        productLinesTotal +
        addOnsTotal) *
        (quantity || 1) *
        100
    ) / 100;
    const customerTotalNum = parseFloat(customPrice) || totalEstimate;
    const rawSubtotal =
      (estimate.isPrintPro ? effectiveSqFt * effectiveMaterialCostPerUnit : effectiveYards * effectiveFilmCostPerYard) *
        categoryMultiplier +
      (includeLabor ? installCost : 0) +
      customLineCost +
      extraLinesTotal +
      productLinesTotal +
      addOnsTotal;
    const scale = rawSubtotal > 0 ? customerTotalNum / rawSubtotal : 1;

    const savedLineItems: { label: string; detail?: string; amount: number; wooProductId?: number; quantity?: number }[] = [
      {
        label: `${estimate.manufacturer} ${estimate.colorName} (${estimate.finish})`,
        detail: estimate.isPrintPro
          ? `${effectiveSqFt} ${qtyLabelLong} @ $${effectiveMaterialCostPerUnit.toFixed(2)}/${qtyLabelLong}`
          : `${effectiveYards} yds @ $${effectiveFilmCostPerYard.toFixed(2)}/yd`,
        amount: Math.round(effectiveFilmCostTotal * categoryMultiplier * scale * 100) / 100,
      },
    ];
    if (includeLabor) {
      savedLineItems.push({
        label: "Install Labor",
        detail: installMode === "hourly" ? `${installHours} hrs @ $${installHourlyRate}/hr` : undefined,
        amount: Math.round(installCost * scale * 100) / 100,
      });
    }
    if (addOnsTotal > 0) {
      savedLineItems.push({ label: "Add-Ons", amount: Math.round(addOnsTotal * scale * 100) / 100 });
    }
    if (customLineLabel && customLineCost > 0) {
      savedLineItems.push({ label: customLineLabel, amount: Math.round(customLineCost * scale * 100) / 100 });
    }
    extraLines.forEach((l) => {
      const amt = parseFloat(l.price) || 0;
      if (l.label && amt > 0) {
        savedLineItems.push({ label: l.label, amount: Math.round(amt * scale * 100) / 100 });
      }
    });
    productLines.forEach((l) => {
      const amt = l.price * l.qty;
      savedLineItems.push({
        label: l.name,
        detail: l.qty > 1 ? `${l.qty} x $${l.price.toFixed(2)}` : undefined,
        amount: Math.round(amt * scale * 100) / 100,
        wooProductId: l.wooProductId,
        quantity: l.qty,
      });
    });

    saveQuoteToDb({
      quoteNumber: estimate.quoteNumber,
      vehicle: { year, make, model },
      manufacturer,
      finish,
      colorName,
      category,
      toolSource,
      sqFt: estimate.sqFt,
      yardsNeeded: effectiveYards,
      shopCost,
      customerTotal: customerTotalNum,
      marginPercent: includeMargin ? marginPercent : 0,
      lineItems: savedLineItems,
      renderUrl: renderUrl || null,
      visualizationId: visualizationId || null,
      customer: customerInfo || (customerName ? { name: customerName } : undefined),
      shopSlug,
    }).then((res) => {
      if (res?.pipeline === "internal") {
        toast({
          title: "Quote Saved",
          description: `Quote #${estimate.quoteNumber} saved to your Admin Quotes Manager.`,
        });
        onSaveSuccess?.();
      } else if (res?.pipeline === "public") {
        toast({
          title: "Quote Submitted",
          description: `Quote #${estimate.quoteNumber} sent. The shop has been notified and will follow up.`,
        });
        onSaveSuccess?.();
      } else {
        toast({
          variant: "destructive",
          title: "Quote Not Saved",
          description: `Quote #${estimate.quoteNumber} could not be submitted. Please try again or contact the shop directly.`,
        });
      }
    });
  };

  const handleConvertToJob = () => {
    if (!estimate) return;
    setConvertedToJob(true);
    trackEvent("converted_to_job", { finalPrice: customPrice });
    toast({
      title: "Converted to Job",
      description: `Quote #${estimate.quoteNumber} is now a job. Customer can be invoiced.`,
    });
  };

  if (!estimate) return null;

  const regionInfo = REGIONS[estimate.region];
  const filmCost = effectiveFilmCostTotal;
  const customLineCost = parseFloat(customLinePrice) || 0;

  /* ── Shared dark input classes ── */
  const inputCls = "bg-[#1a1a1a] border-[#2a2a2a] text-white placeholder:text-white/20 focus-visible:ring-[#00C7FF]/40";

  return (
    <div className={cn("bg-[#0d0d0d] rounded-2xl overflow-hidden border border-[#252525]", className)}>
      {/* ─── Header ─── */}
      <div className="bg-gradient-to-r from-[#2563eb] to-[#a855f7] px-4 py-3">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <Input
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="Your Shop Name"
              className="h-6 bg-transparent border-none shadow-none px-0 text-sm font-bold text-white placeholder:text-white/50 focus-visible:ring-0"
            />
            <p className="text-[9px] text-white/50 font-mono mt-0.5">Quote #{estimate.quoteNumber}</p>
          </div>
          <div className="text-right flex-shrink-0 ml-3">
            <p className="text-[10px] font-bold text-white leading-tight">
              Restyle<span className="text-white/60">Pro</span>
            </p>
            <p className="text-[8px] text-white/40">QuickQuote</p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* ─── Customer Name ─── */}
        <div>
          <Label className="text-[10px] text-white/30 mb-1">Customer</Label>
          <Input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Customer name"
            className={cn("h-8 text-xs", inputCls)}
          />
        </div>

        {/* ─── Customer Info ─── */}
        {customerInfo && (customerInfo.email || customerInfo.phone || customerInfo.company) && (
          <div className="bg-[#1a1a1a] rounded-lg px-3 py-2 border border-[#252525] space-y-0.5">
            {customerInfo.email && <p className="text-[9px] text-white/30">Email: <span className="text-white/60">{customerInfo.email}</span></p>}
            {customerInfo.phone && <p className="text-[9px] text-white/30">Phone: <span className="text-white/60">{customerInfo.phone}</span></p>}
            {customerInfo.company && <p className="text-[9px] text-white/30">Company: <span className="text-white/60">{customerInfo.company}</span></p>}
          </div>
        )}

        {/* ─── Attached Render ─── */}
        {renderUrl && (
          <div
            className="relative rounded-lg overflow-hidden"
            style={{
              padding: "1.5px",
              background: "linear-gradient(135deg,#2563eb,#a855f7)",
            }}
          >
            <div className="relative bg-[#1a1a1a] rounded-[6px] overflow-hidden">
              <img src={renderUrl} alt={`${year} ${make} ${model}`} className="w-full aspect-video object-cover" />
              <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[8px] font-bold text-white uppercase tracking-wider">
                Attached to Quote
              </div>
            </div>
          </div>
        )}

        {/* ─── Vehicle ─── */}
        <div className="flex items-center gap-2 text-[10px] text-white/50 bg-[#1a1a1a] rounded-lg px-3 py-2 border border-[#252525]">
          <Car className="w-3 h-3 flex-shrink-0 text-[#00C7FF]/60" />
          <span className="font-semibold text-white">{estimate.vehicle.year} {estimate.vehicle.make} {estimate.vehicle.model}</span>
          {quantity > 1 && <span className="text-[9px] text-white/30">x{quantity}</span>}
          {!estimate.vehicle.matched && (
            <span className="text-white/40 text-[9px] ml-auto">(est.)</span>
          )}
        </div>

        {/* ─── Category & Add-ons badges ─── */}
        {(category !== "full_wraps" || selectedAddOns.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {category !== "full_wraps" && (
              <span className="text-[8px] px-2 py-0.5 rounded-full bg-[#00C7FF]/10 border border-[#00C7FF]/20 text-[#00C7FF] font-medium">
                {SERVICE_CATEGORIES[category]?.label}
              </span>
            )}
            {selectedAddOns.map((id) => (
              <span key={id} className="text-[8px] px-2 py-0.5 rounded-full bg-[#a855f7]/10 border border-[#a855f7]/20 text-[#a855f7] font-medium">
                + {ADD_ONS[id]?.label}
              </span>
            ))}
          </div>
        )}

        {/* ─── LINE ITEMS ─── */}
        <div className="space-y-1.5">
          <p className="text-[9px] font-semibold text-[#00C7FF]/60 uppercase tracking-wider">Line Items</p>

          {/* Line 1: Film / Print Material */}
          <div className="bg-[#1a1a1a] rounded-lg p-3 border border-[#252525] space-y-2">
            <div className="flex items-start gap-2">
              <div className="flex-shrink-0 w-8 h-8 rounded border border-[#2a2a2a] overflow-hidden mt-0.5">
                {swatchImageUrl ? (
                  <img src={swatchImageUrl} alt={colorName} className="w-full h-full object-cover" />
                ) : colorHex ? (
                  <div className="w-full h-full" style={{ backgroundColor: colorHex }} />
                ) : (
                  <div className="w-full h-full bg-[#1a1a1a]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-white truncate">
                  {manufacturer} {colorName}
                </p>
                <p className="text-[9px] text-white/40">
                  {productCode && `${productCode} · `}{finish}
                </p>
              </div>
            </div>
            {/* Qty x Price — yards for vinyl, sq ft for printed */}
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1">
                {estimate.isPrintPro ? (
                  <>
                    <Input
                      type="number"
                      value={sqFtOverride || estimate.sqFt.toString()}
                      onChange={(e) => setSqFtOverride(e.target.value)}
                      className={cn("h-6 w-14 text-[11px] text-center px-1 font-semibold", inputCls)}
                      step="1"
                    />
                    <span className="text-white/40">{qtyLabelLong} x $</span>
                    <div
                      className="relative rounded"
                      style={
                        materialCostPerUnitOverride
                          ? {
                              padding: "1px",
                              background: "linear-gradient(135deg,#2563eb,#a855f7)",
                            }
                          : undefined
                      }
                    >
                      <Input
                        type="number"
                        value={materialCostPerUnitOverride || (estimate.materialCostPerUnit || 0).toString()}
                        onChange={(e) => setMaterialCostPerUnitOverride(e.target.value)}
                        className={cn("h-6 w-14 text-[11px] text-center px-1 font-semibold", inputCls)}
                        step="0.25"
                        title={`Override price per ${qtyLabelLong}`}
                      />
                    </div>
                    <span className="text-white/40">/{qtyLabelLong}</span>
                    {materialCostPerUnitOverride && (
                      <button
                        type="button"
                        onClick={() => setMaterialCostPerUnitOverride("")}
                        className="h-5 w-5 rounded flex items-center justify-center text-white/40 hover:text-white transition-all"
                        title="Reset to default"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <Input
                      type="number"
                      value={yardsOverride || estimate.yardsNeeded.toString()}
                      onChange={(e) => setYardsOverride(e.target.value)}
                      className={cn("h-6 w-14 text-[11px] text-center px-1 font-semibold", inputCls)}
                      step="1"
                    />
                    <span className="text-white/40">yds x $</span>
                    <div
                      className="relative rounded"
                      style={
                        filmCostPerYardOverride
                          ? {
                              padding: "1px",
                              background: "linear-gradient(135deg,#2563eb,#a855f7)",
                            }
                          : undefined
                      }
                    >
                      <Input
                        type="number"
                        value={filmCostPerYardOverride || (estimate.filmCostPerYard || 0).toString()}
                        onChange={(e) => setFilmCostPerYardOverride(e.target.value)}
                        className={cn("h-6 w-14 text-[11px] text-center px-1 font-semibold", inputCls)}
                        step="0.25"
                        title="Override price per yard"
                      />
                    </div>
                    <span className="text-white/40">/yd</span>
                    {filmCostPerYardOverride && (
                      <button
                        type="button"
                        onClick={() => setFilmCostPerYardOverride("")}
                        className="h-5 w-5 rounded flex items-center justify-center text-white/40 hover:text-white transition-all"
                        title="Reset to default"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
              <span className="font-bold text-white">${filmCost.toFixed(2)}</span>
            </div>
          </div>

          {/* Line 2: Install Labor — magenta-accented so it's never forgotten */}
          {includeLabor ? (
            <div
              className="rounded-lg p-3 space-y-2 shadow-[0_0_14px_rgba(168,85,247,0.25)]"
              style={{
                backgroundImage:
                  "linear-gradient(#1a1a1a,#1a1a1a), linear-gradient(135deg,#2563eb,#a855f7)",
                backgroundOrigin: "border-box",
                backgroundClip: "padding-box, border-box",
                border: "1.5px solid transparent",
              }}
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-white">Install Labor</p>
                <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#a855f7]/20 text-[#e9d5ff] border border-[#a855f7]/40">
                  Don't forget
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    value={installHours}
                    onChange={(e) => setInstallHours(e.target.value)}
                    className={cn("h-6 w-14 text-[11px] text-center px-1 font-semibold", inputCls)}
                    step="0.5"
                  />
                  <span className="text-white/40">hrs x</span>
                  <div className="relative">
                    <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] text-white/30">$</span>
                    <Input
                      type="number"
                      value={installHourlyRate}
                      onChange={(e) => setInstallHourlyRate(e.target.value)}
                      className={cn("h-6 w-14 text-[11px] text-center pl-3 px-1 font-semibold", inputCls)}
                      step="5"
                    />
                  </div>
                  <span className="text-white/40">/hr</span>
                </div>
                <span className="font-bold text-white">${installCost.toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div
              className="rounded-lg p-3 text-center shadow-[0_0_14px_rgba(168,85,247,0.35)]"
              style={{ background: "linear-gradient(135deg, #2563eb, #a855f7)" }}
            >
              <p className="text-[11px] font-bold text-white">⚠ Install Labor is OFF</p>
              <p className="text-[9px] text-white/85 mt-0.5">
                Turn it back on in the Pricing section so you don't forget to charge for installation.
              </p>
            </div>
          )}

          {/* Line 3: Custom line item (legacy single) */}
          <div className="bg-[#1a1a1a] rounded-lg p-3 border border-[#252525] space-y-2">
            <Input
              value={customLineLabel}
              onChange={(e) => setCustomLineLabel(e.target.value)}
              placeholder="Add custom item (Removal, Design, PPF...)"
              className={cn("h-6 text-[11px] font-bold placeholder:font-normal", inputCls)}
            />
            {customLineLabel && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-white/40">Price</span>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white/30">$</span>
                  <Input
                    type="number"
                    value={customLinePrice}
                    onChange={(e) => setCustomLinePrice(e.target.value)}
                    placeholder="0.00"
                    className={cn("h-6 w-24 text-[11px] text-right pl-5 pr-2 font-bold", inputCls)}
                    step="25"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Extra custom lines (unlimited) */}
          {extraLines.map((line) => (
            <div
              key={line.id}
              className="relative bg-[#1a1a1a] rounded-lg p-3 border border-[#252525] space-y-2"
              style={{
                backgroundImage: "linear-gradient(#1a1a1a,#1a1a1a), linear-gradient(135deg,#2563eb,#a855f7)",
                backgroundOrigin: "border-box",
                backgroundClip: "padding-box, border-box",
                borderColor: "transparent",
              }}
            >
              <div className="flex items-center gap-2">
                <Input
                  value={line.label}
                  onChange={(e) => updateExtraLine(line.id, { label: e.target.value })}
                  placeholder="Custom line label"
                  className={cn("h-6 text-[11px] font-bold placeholder:font-normal flex-1", inputCls)}
                />
                <button
                  type="button"
                  onClick={() => removeExtraLine(line.id)}
                  className="h-6 w-6 rounded flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-white/5 transition-all"
                  title="Remove line"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-white/40">Price</span>
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-white/30">$</span>
                  <Input
                    type="number"
                    value={line.price}
                    onChange={(e) => updateExtraLine(line.id, { price: e.target.value })}
                    placeholder="0.00"
                    className={cn("h-6 w-24 text-[11px] text-right pl-5 pr-2 font-bold", inputCls)}
                    step="25"
                  />
                </div>
              </div>
            </div>
          ))}

          {/* Shop Products — add quotable products from catalog */}
          {productLines.length > 0 && (
            <div className="bg-[#1a1a1a] rounded-lg p-3 border border-[#00C7FF]/20 space-y-1">
              <p className="text-[11px] font-bold text-[#00C7FF]">Products</p>
              {productLines.map((pl) => (
                <div key={pl.id} className="flex items-center justify-between text-[10px]">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => removeProductLine(pl.id)}
                      className="text-white/30 hover:text-red-400 shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                    <span className="text-white/70 truncate">{pl.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => updateProductLineQty(pl.id, pl.qty - 1)}
                      className="w-4 h-4 rounded bg-white/5 text-white/40 hover:text-white flex items-center justify-center text-[9px] font-bold"
                    >-</button>
                    <span className="text-white/60 w-4 text-center">{pl.qty}</span>
                    <button
                      type="button"
                      onClick={() => updateProductLineQty(pl.id, pl.qty + 1)}
                      className="w-4 h-4 rounded bg-white/5 text-white/40 hover:text-white flex items-center justify-center text-[9px] font-bold"
                    >+</button>
                    <span className="font-semibold text-white ml-1">${(pl.price * pl.qty).toFixed(2)}</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#252525]">
                <span className="text-white/40">Products subtotal</span>
                <span className="font-bold text-white">${productLinesTotal.toFixed(2)}</span>
              </div>
            </div>
          )}

          {/* Add Product or Custom Line — dropdown + button row */}
          <div className="flex gap-2">
            {quotableProducts.length > 0 && (
              <Select onValueChange={(id) => {
                const p = quotableProducts.find((pr) => pr.id === id);
                if (p) addProductLine(p);
              }}>
                <SelectTrigger className="h-8 flex-1 bg-[#1a1a1a] border-[#00C7FF]/20 text-[11px] text-[#00C7FF] font-bold rounded-lg">
                  <SelectValue placeholder="+ Add Product" />
                </SelectTrigger>
                <SelectContent className="max-h-60 bg-[#1a1a1a] border-[#2a2a2a]">
                  {quotableProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs text-white">
                      <span className="truncate">{p.name}</span>
                      <span className="text-white/40 ml-2">${Number(p.price).toFixed(2)}{p.price_unit !== "each" ? `/${p.price_unit}` : ""}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <button
              type="button"
              onClick={addExtraLine}
              className="h-8 px-3 rounded-lg text-[11px] font-bold text-white flex items-center justify-center gap-1.5 transition-all hover:opacity-90 shadow-[0_0_10px_rgba(168,85,247,0.25)] shrink-0"
              style={{ background: "linear-gradient(135deg, #2563eb, #a855f7)" }}
            >
              <Plus className="w-3.5 h-3.5" />
              Custom Line
            </button>
          </div>

          {/* Add-ons line items */}
          {selectedAddOns.length > 0 && (
            <div className="bg-[#1a1a1a] rounded-lg p-3 border border-[#252525] space-y-1">
              <p className="text-[11px] font-bold text-white">Add-Ons</p>
              {selectedAddOns.map((id) => {
                const addon = ADD_ONS[id];
                if (!addon) return null;
                return (
                  <div key={id} className="flex items-center justify-between text-[10px]">
                    <span className="text-white/50">{addon.label}</span>
                    <span className="font-semibold text-white">${addon.flatPrice.toFixed(2)}</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#252525]">
                <span className="text-white/40">Add-ons subtotal</span>
                <span className="font-bold text-white">${addOnsTotal.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* ─── State / Region ─── */}
        <div className="flex items-center gap-2">
          <Select value={stateCode} onValueChange={setStateCode}>
            <SelectTrigger className="h-7 bg-[#1a1a1a] border-[#2a2a2a] text-[10px] text-white w-auto min-w-[100px]">
              <MapPin className="w-2.5 h-2.5 mr-1 text-[#00C7FF]/50" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-60 bg-[#1a1a1a] border-[#2a2a2a]">
              {US_STATES.map((s) => (
                <SelectItem key={s.code} value={s.code} className="text-xs text-white">
                  {s.name} ({s.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge
            className={cn(
              "text-[8px]",
              estimate.region === "luxury" && "bg-purple-600",
              estimate.region === "premium" && "bg-blue-600",
              estimate.region === "standard" && "bg-emerald-600",
              estimate.region === "budget" && "bg-zinc-600",
            )}
          >
            {regionInfo.label}
          </Badge>
        </div>

        {/* ─── Shop Owner Cost vs Customer Price ─── */}
        {(() => {
          const shopCost = Math.round(
            (filmCost * categoryMultiplier + (includeLabor ? installCost : 0) + customLineCost + extraLinesTotal + productLinesTotal + addOnsTotal) *
              (quantity || 1) * 100
          ) / 100;
          const customerPrice = parseFloat(customPrice) || totalEstimate;
          const profit = Math.max(0, customerPrice - shopCost);
          const profitPct = shopCost > 0 ? Math.round((profit / shopCost) * 100) : 0;
          return (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-[#1a1a1a] rounded-lg p-2 border border-[#2a2a2a]">
                <p className="text-[8px] text-white/50 uppercase tracking-wider font-bold">Shop Cost</p>
                <p className="text-sm font-extrabold text-white">${shopCost.toFixed(0)}</p>
              </div>
              <div
                className="rounded-lg p-2 border"
                style={{
                  borderColor: "transparent",
                  backgroundImage:
                    "linear-gradient(#1a1a1a,#1a1a1a), linear-gradient(135deg,#2563eb,#a855f7)",
                  backgroundOrigin: "border-box",
                  backgroundClip: "padding-box, border-box",
                }}
              >
                <p className="text-[8px] text-white/70 uppercase tracking-wider font-bold">Profit</p>
                <p className="text-sm font-extrabold text-white">
                  ${profit.toFixed(0)}
                  <span className="text-[9px] font-semibold text-white/60 ml-1">({profitPct}%)</span>
                </p>
              </div>
              <div className="bg-[#1a1a1a] rounded-lg p-2 border border-[#00C7FF]/30">
                <p className="text-[8px] text-[#00C7FF]/80 uppercase tracking-wider font-bold">Customer</p>
                <p className="text-sm font-extrabold text-[#00C7FF]">${customerPrice.toFixed(0)}</p>
              </div>
            </div>
          );
        })()}

        {/* ─── TOTAL ─── */}
        <div className="bg-gradient-to-br from-[#1a1a1a] to-[#111] rounded-xl p-4 space-y-2 border border-[#00C7FF]/20">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#00C7FF]/60 uppercase tracking-wider font-bold">Total</span>
            <DollarSign className="w-3.5 h-3.5 text-[#00C7FF]/30" />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-[#00C7FF]/50 font-bold">$</span>
            <Input
              type="number"
              value={customPrice}
              onChange={(e) => {
                setCustomPrice(e.target.value);
                setPriceManuallySet(true);
              }}
              className="h-11 bg-black/50 border-[#00C7FF]/20 text-xl font-extrabold text-white text-center pl-8 placeholder:text-white/20 focus-visible:ring-[#00C7FF]/40"
              step="50"
            />
          </div>
          <p className="text-[8px] text-white/25 text-center">
            Film ${(filmCost * categoryMultiplier).toFixed(0)}{includeLabor ? ` + Install $${installCost.toFixed(0)}` : ''}{productLinesTotal > 0 ? ` + Products $${productLinesTotal.toFixed(0)}` : ''}{addOnsTotal > 0 ? ` + Add-ons $${addOnsTotal.toFixed(0)}` : ''}{customLineCost > 0 ? ` + ${customLineLabel} $${customLineCost.toFixed(0)}` : ''}{quantity > 1 ? ` x ${quantity}` : ''}{includeMargin ? ` + ${marginPercent}% margin` : ''}
          </p>
        </div>

        {/* ─── Actions ─── */}
        <div className="flex gap-2">
          <Button
            onClick={() => {
              setQuoteCalculated(true);
              trackEvent("quote_calculated");
              toast({ title: "Quote Calculated", description: `Total: $${customPrice}` });
            }}
            className="flex-1 h-10 rounded-lg bg-gradient-to-r from-[#2563eb] to-[#a855f7] hover:from-[#1d4ed8] hover:to-[#9333ea] text-white text-xs font-bold"
          >
            <Calculator className="h-3.5 w-3.5 mr-1.5" />
            Calculate
          </Button>
          <Button
            onClick={handleSaveQuote}
            variant="outline"
            className="flex-1 h-10 rounded-lg border-transparent hover:bg-[#1a1a1a] text-xs font-semibold text-white/80 hover:text-white bg-[#1a1a1a]"
            style={{
              backgroundImage:
                "linear-gradient(#1a1a1a,#1a1a1a), linear-gradient(135deg,#2563eb,#a855f7)",
              backgroundOrigin: "border-box",
              backgroundClip: "padding-box, border-box",
              borderWidth: 1,
              borderStyle: "solid",
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-400" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
            {copied ? "Saved!" : "Save Quote"}
          </Button>
        </div>

        <Button
          onClick={() => {
            if (!estimate) return;
            const text = [
              shopName || "RestyleProAI",
              `Quote #${estimate.quoteNumber}`,
              "",
              ...(customerInfo?.name || customerName ? [`Customer: ${customerInfo?.name || customerName}`] : []),
              ...(customerInfo?.email ? [`Email: ${customerInfo.email}`] : []),
              ...(customerInfo?.phone ? [`Phone: ${customerInfo.phone}`] : []),
              ...(customerInfo?.company ? [`Company: ${customerInfo.company}`] : []),
              `Vehicle: ${estimate.vehicle.year} ${estimate.vehicle.make} ${estimate.vehicle.model}`,
              `Category: ${SERVICE_CATEGORIES[category]?.label || category}`,
              "",
              "--- LINE ITEMS ---",
              "",
              `${estimate.manufacturer} ${estimate.colorName} (${estimate.finish})`,
              estimate.isPrintPro
                ? `  ${effectiveSqFt} ${qtyLabelLong} × $${effectiveMaterialCostPerUnit.toFixed(2)}/${qtyLabelLong} = $${(effectiveFilmCostTotal * categoryMultiplier).toFixed(2)}`
                : `  ${effectiveYards} yards × $${effectiveFilmCostPerYard.toFixed(2)}/yd = $${(effectiveFilmCostTotal * categoryMultiplier).toFixed(2)}`,
              ...(includeLabor ? [
                "",
                "Install Labor",
                installMode === "hourly"
                  ? `  ${installHours} hrs × $${installHourlyRate}/hr = $${installCost.toFixed(2)}`
                  : `  ${estimate.sqFt} sq ft × $${estimate.laborPerSqFt}/sq ft = $${installCost.toFixed(2)}`,
              ] : []),
              ...(addOnsTotal > 0 ? ["", `Add-Ons: $${addOnsTotal.toFixed(2)}`] : []),
              ...(includeMargin ? ["", `Margin: ${marginPercent}%`] : []),
              "",
              "--- TOTAL ---",
              `$${customPrice || totalEstimate.toFixed(2)}`,
            ].join("\n");

            const blob = new Blob([text], { type: "text/plain" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `Quote-${estimate.quoteNumber}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          variant="outline"
          className="w-full h-8 rounded-lg border-[#2a2a2a] hover:bg-[#1a1a1a] text-[10px] font-semibold text-white/60 hover:text-white bg-[#111]"
        >
          <Download className="h-3 w-3 mr-1.5" />
          Download Quote
        </Button>

        {onEmailClick && (
          <Button
            onClick={onEmailClick}
            className="w-full h-10 rounded-lg text-white text-xs font-bold hover:opacity-90 shadow-[0_0_14px_rgba(168,85,247,0.3)]"
            style={{ background: "linear-gradient(135deg, #2563eb, #a855f7)" }}
          >
            <Mail className="h-3.5 w-3.5 mr-1.5" />
            Send Quote by Email
          </Button>
        )}

        {quoteCalculated && (
          <Button
            onClick={handleConvertToJob}
            disabled={convertedToJob}
            className={cn(
              "w-full h-10 rounded-lg text-xs font-bold",
              convertedToJob
                ? "bg-emerald-600 hover:bg-emerald-600 text-white"
                : "bg-[#00C7FF] hover:bg-[#00B4E6] text-black"
            )}
          >
            {convertedToJob ? (
              <><Check className="h-3.5 w-3.5 mr-1.5" /> Job Created</>
            ) : (
              <><Briefcase className="h-3.5 w-3.5 mr-1.5" /> Convert to Job</>
            )}
          </Button>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-[#252525]">
          <span className="text-[8px] text-white/20">
            {estimate.sqFt} sq ft &bull; {estimate.yardsNeeded} yds &bull; 15% waste
            {includeMargin && marginPercent > 0 ? ` · ${marginPercent}% margin` : ''}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-[8px] px-1.5 py-0.5 rounded border border-[#252525] text-white/20 font-medium">
              {quoteMode === "full" ? "Full" : "Quick"}
            </span>
            <span className="text-[8px] px-1.5 py-0.5 rounded border border-[#252525] text-white/20 font-medium">
              {toolSource}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
