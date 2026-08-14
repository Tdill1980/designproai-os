import { useEffect, useMemo, useState, useCallback, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getActiveUser } from "@/lib/auth-session";
import { findVehicle, VEHICLE_MEASUREMENTS } from "@/data/vehicle-measurements";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { saveQuote } from "@/lib/quickquote-db";
import {
  Calculator,
  ChevronLeft,
  Crown,
  Expand,
  ExternalLink,
  Factory,
  FileText,
  Layers,
  Mail,
  MapPin,
  Paintbrush,
  Percent,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Sun,
  Wand2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ToolWordmark } from "./ToolWordmark";
import type { QuickQuoteDialogInitialState } from "./QuickQuoteDialog";
const QuickQuoteDialog = lazy(() => import("./QuickQuoteDialog").then(m => ({ default: m.QuickQuoteDialog })));
import { DesignToolsPicker } from "./DesignToolsPicker";
import {
  WpwFadeWrapConfigurator,
  type WpwFadeWrapSelection,
} from "@/components/quote/WpwFadeWrapConfigurator";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { type DesignToolId } from "@/lib/quote-design-tools";
import {
  COLOR_CHANGE_PRODUCTS,
  PRINTPRO_PRODUCTS,
  SERVICE_PRODUCTS,
  WPW_DESIGN_PRODUCTS,
  RP_DESIGN_PRODUCTS,
  findProductById,
  unitShort,
  visibleProducts,
  type PriceUnit,
  type QuoteProduct,
} from "@/lib/quote-product-catalog";
import { buildWpwCartUrl } from "@/lib/wpw-catalog";
import type { EstimatorLineItem } from "@/lib/quote-estimator";

/**
 * Dashboard QuickQuoteCard
 *
 * Flow:
 *   1. Type Year / Make / Model (free-text — any vehicle, any year)
 *   2. For each line item:
 *        a. Click a product CATEGORY button (Color Change, Print Wrap, PPF,
 *           Window Tint, Chrome Delete, Other Services, WePrintWraps for
 *           WPW tenants)
 *        b. Pick a product from the category's dropdown
 *        c. Enter dimensions — sq ft / panel size / qty + rate
 *   3. "Add Another Product" repeats the same picker so a quote can mix
 *      e.g. Color Change + PPF Hood + Window Tint in one estimate.
 *   4. Optional Install Labor + custom lines + Studio Proof add-on.
 *
 * Save / Send / Calculate buttons open the branded QuickQuoteDialog
 * (lazy-loaded) which handles persistence and email send.
 */

const STUDIO_PROOF_PRICE = 100;
const DEFAULT_REGION = "Texas (TX)";

// Final-fallback estimate when both the static CSV and Gemini grounding
// fail to find a vehicle. Picks the closest-size vehicle from the DB by:
//   1. Same make + any model word match → median of those rows
//   2. Same make → median of all rows for that make
//   3. Median across the entire DB (sedan-class average)
function estimateClosestSize(
  make: string,
  model: string,
): {
  totalSqFt: number;
  corrSqFt: number;
  hoodSqFt: number;
  roofSqFt: number;
  source: "estimate";
  estimateBasis: string;
} | null {
  const median = (vals: number[]): number => {
    const xs = vals.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (!xs.length) return 0;
    const mid = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  };
  const buildFrom = (rows: typeof VEHICLE_MEASUREMENTS, basis: string) => {
    if (!rows.length) return null;
    const corr = median(rows.map((r) => r.corrSqFt ?? 0));
    if (!corr) return null;
    return {
      totalSqFt: median(rows.map((r) => r.totalSqFt ?? r.corrSqFt ?? 0)),
      corrSqFt: corr,
      hoodSqFt: median(rows.map((r) => r.hoodSqFt ?? 0)),
      roofSqFt: median(rows.map((r) => r.roofSqFt ?? 0)),
      source: "estimate" as const,
      estimateBasis: basis,
    };
  };
  const mk = make.toLowerCase().trim();
  const md = model.toLowerCase().trim();
  const modelWords = md.split(/\s+/).filter((w) => w.length > 1);

  // 1. Same make + at least one model word matches
  if (modelWords.length) {
    const sameMakeWordMatch = VEHICLE_MEASUREMENTS.filter(
      (v) =>
        v.make.toLowerCase().includes(mk) &&
        modelWords.some((w) => v.model.toLowerCase().includes(w)),
    );
    const r1 = buildFrom(sameMakeWordMatch, `similar ${make} models`);
    if (r1) return r1;
  }
  // 2. Same make, any model
  const sameMake = VEHICLE_MEASUREMENTS.filter((v) =>
    v.make.toLowerCase().includes(mk),
  );
  const r2 = buildFrom(sameMake, `${make} fleet average`);
  if (r2) return r2;
  // 3. Whole-DB median
  return buildFrom(VEHICLE_MEASUREMENTS, "fleet-wide median");
}

// ── Categories shown as buttons ───────────────────────────────────
type CategoryId =
  | "color_change"
  | "print_wrap"
  | "ppf"
  | "tint"
  | "chrome_delete"
  | "services"
  | "wpw"
  | "wpw_fadewraps"
  | "rl_fadewraps"
  | "wpw_design"
  | "rp_design";

interface CategoryMeta {
  id: CategoryId;
  label: string;
  blurb: string;
  icon: LucideIcon;
  accent: string;
}

const COLOR_CHANGE_CAT: CategoryMeta = {
  id: "color_change",
  label: "Color Change",
  blurb: "Solid-color vinyl",
  icon: Paintbrush,
  accent: "text-[#60A5FA]",
};
const PRINT_WRAP_CAT: CategoryMeta = {
  id: "print_wrap",
  label: "Print Wrap",
  blurb: "Custom printed graphics",
  icon: Layers,
  accent: "text-fuchsia-300",
};
const PPF_CAT: CategoryMeta = {
  id: "ppf",
  label: "PPF",
  blurb: "Paint protection film",
  icon: ShieldCheck,
  accent: "text-emerald-400",
};
const TINT_CAT: CategoryMeta = {
  id: "tint",
  label: "Window Tint",
  blurb: "All windows or selected",
  icon: Sun,
  accent: "text-amber-300",
};
const CHROME_CAT: CategoryMeta = {
  id: "chrome_delete",
  label: "Chrome Delete",
  blurb: "Blackout trim",
  icon: Sparkles,
  accent: "text-purple-300",
};
const SERVICES_CAT: CategoryMeta = {
  id: "services",
  label: "Other Services",
  blurb: "Partial wraps, design, fleet…",
  icon: Wrench,
  accent: "text-white/85",
};
const WPW_CAT: CategoryMeta = {
  id: "wpw",
  label: "WePrintWraps",
  blurb: "Direct WPW catalog pricing",
  icon: Factory,
  accent: "text-amber-300",
};
const WPW_FADEWRAPS_CAT: CategoryMeta = {
  id: "wpw_fadewraps",
  label: "WPW FadeWraps",
  blurb: "Pre-designed fade kits — exact WPW configurator",
  icon: Sparkles,
  accent: "text-orange-400",
};
const RL_FADEWRAPS_CAT: CategoryMeta = {
  id: "rl_fadewraps",
  label: "RestyleLibrary FadeWraps",
  blurb: "Same fade kit configurator, RestyleLibrary branding",
  icon: Sparkles,
  accent: "text-fuchsia-300",
};
const WPW_DESIGN_CAT: CategoryMeta = {
  id: "wpw_design",
  label: "WPW Design Products",
  blurb: "Hourly · custom wrap design · file output",
  icon: Store,
  accent: "text-cyan-300",
};
const RP_DESIGN_CAT: CategoryMeta = {
  id: "rp_design",
  label: "DesignProAI Design Products",
  blurb: "DesignPro · GraphicsPro · Production Pack · upsells",
  icon: Crown,
  accent: "text-fuchsia-300",
};

function categoriesFor(isWpwTenant: boolean): CategoryMeta[] {
  const base: CategoryMeta[] = [
    COLOR_CHANGE_CAT,
    PRINT_WRAP_CAT,
    WPW_FADEWRAPS_CAT,
    RL_FADEWRAPS_CAT,
    PPF_CAT,
    TINT_CAT,
    CHROME_CAT,
    SERVICES_CAT,
    WPW_DESIGN_CAT,
    RP_DESIGN_CAT,
  ];
  return isWpwTenant ? [WPW_CAT, ...base] : base;
}

function productsForCategory(catId: CategoryId): QuoteProduct[] {
  // Every branch drops products flagged `hidden` (e.g. production packs
  // pulled until the DesignPro pipeline ships) via visibleProducts().
  switch (catId) {
    case "wpw":
    case "print_wrap":
      return visibleProducts(PRINTPRO_PRODUCTS);
    case "wpw_fadewraps":
    case "rl_fadewraps":
      // Configurator-driven; no product dropdown.
      return [];
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

// Sentinel ids used for configurator-driven lines (FadeWraps via WPW or
// RestyleLibrary). Lets buildDialogInitial pick up the line even though
// it doesn't map to a real catalog product.
const WPW_FADEWRAPS_PRODUCT_ID = "wpw-fadewraps-config";
const RL_FADEWRAPS_PRODUCT_ID = "rl-fadewraps-config";

function fadewrapsProductIdFor(catId: CategoryId): string {
  return catId === "rl_fadewraps"
    ? RL_FADEWRAPS_PRODUCT_ID
    : WPW_FADEWRAPS_PRODUCT_ID;
}

function fadewrapsLabelFor(catId: CategoryId): string {
  return catId === "rl_fadewraps"
    ? "RestyleLibrary Fade Wrap"
    : "WPW Fade Wrap";
}

const DEFAULT_QTY_BY_UNIT: Record<PriceUnit, string> = {
  yard: "",
  sqft: "",
  // Itemized services (Design Setup, Full Wrap Design, Chrome Delete, …)
  // are almost always qty 1. Leaving this blank meant Save/Send silently
  // dropped the line because buildPersistLineItems guards on qty > 0.
  each: "1",
  linear_foot: "",
  hour: "",
  window: "",
};

// ── Per-line state ────────────────────────────────────────────────
interface QuoteLine {
  id: string;
  category: CategoryId | null;
  productId: string | null;
  qty: string;
  rate: string;
  unit: PriceUnit;
  panel: string;
}

const newLine = (): QuoteLine => ({
  id: Math.random().toString(36).slice(2, 9),
  category: null,
  productId: null,
  qty: "",
  rate: "",
  unit: "sqft",
  panel: "",
});

/**
 * Optional prefill payload for callers that already know the vehicle /
 * design (e.g. DesignPro hands the user off into a QuickQuote panel
 * for the exact vehicle + finish they were just working on). The card
 * still works with no props for the dashboard / standalone use case.
 */
export interface QuickQuoteCardInitial {
  year?: string;
  make?: string;
  model?: string;
  finish?: string;
  designName?: string;
  renderUrl?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerCompany?: string;
  /**
   * Free-form line items the caller already collected — e.g. chrome
   * delete / carbon accent / window tint upsells the user clicked in
   * ColorPro or GraphicsPro before opening QuickQuote. Seeded into
   * the Custom lines section so they show up on the saved/sent quote.
   */
  extraCustomLines?: Array<{ label: string; price: number }>;
  /**
   * Free-form order notes seeded into the notes box (e.g. customer's
   * color choice, finish, special install instructions). Persisted on
   * the saved quote so the customer-facing email and /quotes detail
   * view both surface it.
   */
  notes?: string;
  /**
   * Existing quote number to round-trip on edit. When set, the card
   * keeps this number for the lifetime of the mount instead of
   * generating a new one, so re-saving upserts the same row in
   * `quotes` (the unique index on shop_id+quote_number turns the second
   * save into an update).
   */
  quoteNumber?: string;
}

interface QuickQuoteCardProps {
  initial?: QuickQuoteCardInitial;
}

/**
 * Cross-surface prefill handoff. Tools that don't navigate directly to
 * /quick-quote (e.g. the Dashboard's QuickQuote tile) can't pass an
 * `initial` prop or location.state, so FadeWraps / DesignPro / etc.
 * stash a one-shot prefill payload here. The card reads + clears it
 * on mount, and an explicit `initial` prop always wins.
 */
export const QUICK_QUOTE_PREFILL_KEY = "restylepro_quickquote_prefill";

const consumePrefillFromStorage = (): QuickQuoteCardInitial | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(QUICK_QUOTE_PREFILL_KEY);
    if (!raw) return undefined;
    window.sessionStorage.removeItem(QUICK_QUOTE_PREFILL_KEY);
    return JSON.parse(raw) as QuickQuoteCardInitial;
  } catch {
    return undefined;
  }
};

export const QuickQuoteCard = ({ initial: initialProp }: QuickQuoteCardProps = {}) => {
  // One-shot read — explicit prop wins, otherwise consume any stashed
  // prefill from a tool handoff (FadeWraps, DesignPro, …). Captured
  // once on mount so the storage clear doesn't cause a re-read race.
  const [initial] = useState<QuickQuoteCardInitial | undefined>(
    () => initialProp ?? consumePrefillFromStorage(),
  );
  const { data: isWpwTenant = false } = useIsWpwTenant();
  const categories = useMemo(() => categoriesFor(isWpwTenant), [isWpwTenant]);
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // ── Customer (optional — bypassable) ──
  const [customerName, setCustomerName] = useState(initial?.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(initial?.customerEmail ?? "");
  const [customerPhone, setCustomerPhone] = useState(initial?.customerPhone ?? "");
  const [customerCompany, setCustomerCompany] = useState(initial?.customerCompany ?? "");
  const [customerOpen, setCustomerOpen] = useState(
    Boolean(
      initial?.customerName || initial?.customerEmail ||
      initial?.customerPhone || initial?.customerCompany,
    ),
  );
  const [customerMatches, setCustomerMatches] = useState<
    Array<{ id: string; name: string | null; email: string | null; phone: string | null }>
  >([]);
  const [showCustomerMatches, setShowCustomerMatches] = useState(false);

  // CRM lookup — debounced autocomplete from the shop's `customers` table.
  // Skipping the lookup entirely is fine; the quote can still save with
  // manual fields or no customer at all.
  useEffect(() => {
    const q = customerName.trim() || customerEmail.trim() || customerPhone.trim();
    if (!customerOpen || q.length < 2) {
      setCustomerMatches([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const user = await getActiveUser();
      if (!user) return;
      const { data: shop } = await supabase
        .from("shop_profiles")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!shop?.id || cancelled) return;
      const like = `%${q}%`;
      const { data } = await supabase
        .from("customers")
        .select("id, name, email, phone")
        .eq("shop_id", shop.id)
        .or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like}`)
        .limit(6);
      if (cancelled) return;
      setCustomerMatches(data ?? []);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [customerName, customerEmail, customerPhone, customerOpen]);

  const pickCustomerMatch = (m: {
    name: string | null;
    email: string | null;
    phone: string | null;
  }) => {
    if (m.name) setCustomerName(m.name);
    if (m.email) setCustomerEmail(m.email);
    if (m.phone) setCustomerPhone(m.phone);
    setShowCustomerMatches(false);
    setCustomerMatches([]);
  };

  // ── Vehicle (free-text, all optional) ──
  const [year, setYear] = useState(initial?.year ?? "");
  const [make, setMake] = useState(initial?.make ?? "");
  const [model, setModel] = useState(initial?.model ?? "");

  // Manual sq ft override — when set, beats the auto-derived
  // vehicleMeasurement.corrSqFt and is what gets persisted/shown on PDF.
  const [sqFtOverride, setSqFtOverride] = useState("");

  // ── Line items (start with one blank line at category-pick stage) ──
  // When a caller hands us a render / design (DesignPro handoff), seed
  // the first line with the Print Wrap category so the user lands on
  // the dimensions step instead of the category grid.
  const [lineItems, setLineItems] = useState<QuoteLine[]>(() => {
    const blank = newLine();
    if (initial?.renderUrl || initial?.designName) {
      const products = productsForCategory("print_wrap");
      const first = products[0];
      if (first) {
        return [
          {
            ...blank,
            category: "print_wrap",
            productId: first.id,
            qty: DEFAULT_QTY_BY_UNIT[first.unit],
            rate: first.price.toString(),
            unit: first.unit,
            panel: initial.designName ?? "",
          },
        ];
      }
    }
    return [blank];
  });

  const updateLine = (id: string, patch: Partial<QuoteLine>) =>
    setLineItems((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const removeLine = (id: string) =>
    setLineItems((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));

  const addLine = () => setLineItems((prev) => [...prev, newLine()]);

  // Helper: when a sqft product is picked and we already know the
  // vehicle's measured area, default qty to that area so the line item
  // immediately has a real price. Otherwise fall back to the catalog
  // default (empty / typed manually). Solves the "margin slider does
  // nothing" + "Add Roof shows no change" UX bugs that were both caused
  // by qty starting at 0.
  //
  // Safety guard: only auto-fill when the product's rate looks real
  // (≥ $0.50/sqft). Otherwise leave qty blank so the operator notices
  // they need to set a rate — prevents "$178 for Ferrari 488" where qty
  // gets the sqft and rate is $1 placeholder / empty.
  const defaultQtyFor = (unit: PriceUnit, productPrice?: number): string => {
    if (
      unit === "sqft"
      && vehicleMeasurement?.corrSqFt
      && typeof productPrice === "number"
      && productPrice >= 0.5
    ) {
      return vehicleMeasurement.corrSqFt.toFixed(1);
    }
    return DEFAULT_QTY_BY_UNIT[unit];
  };

  const handleCategoryPick = (lineId: string, catId: CategoryId) => {
    if (catId === "wpw_fadewraps" || catId === "rl_fadewraps") {
      // Configurator-driven — start at $0; configurator will write
      // the real total into rate as the user picks options.
      updateLine(lineId, {
        category: catId,
        productId: fadewrapsProductIdFor(catId),
        qty: "1",
        rate: "0",
        unit: "each",
        panel: "",
      });
      return;
    }
    const products = productsForCategory(catId);
    const first = products[0];
    if (!first) {
      updateLine(lineId, { category: catId, productId: null, qty: "", rate: "", unit: "sqft" });
      return;
    }
    updateLine(lineId, {
      category: catId,
      productId: first.id,
      qty: defaultQtyFor(first.unit, first.price),
      rate: first.price.toString(),
      unit: first.unit,
    });
  };

  const handleFadeWrapChange = (
    lineId: string,
    catId: CategoryId,
    sel: WpwFadeWrapSelection,
  ) => {
    updateLine(lineId, {
      category: catId,
      productId: fadewrapsProductIdFor(catId),
      qty: "1",
      rate: sel.total.toFixed(2),
      unit: "each",
      panel: sel.summary,
    });
  };

  const handleProductPick = (lineId: string, productId: string) => {
    const product = findProductById(productId);
    if (!product) return;
    updateLine(lineId, {
      productId,
      qty: defaultQtyFor(product.unit, product.price),
      rate: product.price.toString(),
      unit: product.unit,
    });
  };

  const resetLineCategory = (lineId: string) =>
    updateLine(lineId, { category: null, productId: null, qty: "", rate: "", unit: "sqft" });

  // ── Custom lines (free-form add-ons) ──
  type CustomLine = { id: string; label: string; price: string };
  const [customLines, setCustomLines] = useState<CustomLine[]>(() =>
    (initial?.extraCustomLines ?? []).map((l) => ({
      id: Math.random().toString(36).slice(2, 9),
      label: l.label,
      price: l.price.toString(),
    })),
  );
  const addCustomLine = () =>
    setCustomLines((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2, 9), label: "", price: "" },
    ]);
  const removeCustomLine = (id: string) =>
    setCustomLines((prev) => prev.filter((l) => l.id !== id));
  const updateCustomLine = (id: string, patch: Partial<CustomLine>) =>
    setCustomLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const customLinesTotal = useMemo(
    () => customLines.reduce((sum, l) => sum + (parseFloat(l.price) || 0), 0),
    [customLines],
  );

  const [laborHours, setLaborHours] = useState("");
  const [laborRate, setLaborRate] = useState("");
  const [laborMode, setLaborMode] = useState<"hourly" | "flat">("hourly");
  const [laborFlat, setLaborFlat] = useState("");

  // ── Order notes ──
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const [studioProofEnabled, setStudioProofEnabled] = useState(false);
  const [marginPanelOpen, setMarginPanelOpen] = useState(false);
  const [marginPct, setMarginPct] = useState(0);
  const [priceOverrideEnabled, setPriceOverrideEnabled] = useState(false);
  const [priceOverride, setPriceOverride] = useState("");

  // ── Vehicle measurement lookup ──
  const [vehicleMeasurement, setVehicleMeasurement] = useState<{
    totalSqFt: number;
    corrSqFt: number;
    hoodSqFt: number;
    roofSqFt: number;
    source: "database" | "lookup" | "estimate";
    estimateBasis?: string;
  } | null>(null);
  const [vehicleLookupState, setVehicleLookupState] = useState<
    "idle" | "loading" | "miss"
  >("idle");

  useEffect(() => {
    const mk = make.trim();
    const md = model.trim();
    const y = year.trim();
    if (!mk || !md) {
      setVehicleMeasurement(null);
      setVehicleLookupState("idle");
      return;
    }

    // 1. Static internal CSV (same one the 2D proof / panelizer uses)
    const v = findVehicle(mk, md, y || undefined);
    if (v?.corrSqFt) {
      setVehicleMeasurement({
        totalSqFt: v.totalSqFt ?? v.corrSqFt,
        corrSqFt: v.corrSqFt,
        hoodSqFt: v.hoodSqFt ?? 0,
        roofSqFt: v.roofSqFt ?? 0,
        source: "database",
      });
      setVehicleLookupState("idle");
      return;
    }

    // 2. Not in CSV — needs all three fields to query Gemini grounding
    if (!y) {
      setVehicleMeasurement(null);
      setVehicleLookupState("idle");
      return;
    }

    // 3. Edge function: checks vehicle_measurements_custom cache,
    //    then Gemini + Google Search grounding, then writes back to
    //    the cache so the next person who quotes this vehicle gets
    //    it instantly. Talks to Google, not WPW — no Cloudflare risk.
    let cancelled = false;
    setVehicleLookupState("loading");
    const t = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke("vehicle-lookup", {
          body: { make: mk, model: md, year: y },
        });
        if (cancelled) return;
        const veh = data?.vehicle;
        if (error || !veh || !veh.corr_sq_ft) {
          // 4. Closest-match estimate from existing DB
          const estimate = estimateClosestSize(mk, md);
          if (estimate) {
            setVehicleMeasurement(estimate);
            setVehicleLookupState("idle");
          } else {
            setVehicleMeasurement(null);
            setVehicleLookupState("miss");
          }
          return;
        }
        setVehicleMeasurement({
          totalSqFt: veh.total_sq_ft ?? veh.corr_sq_ft,
          corrSqFt: veh.corr_sq_ft,
          hoodSqFt: veh.hood_sq_ft ?? 0,
          roofSqFt: veh.roof_sq_ft ?? 0,
          source: "lookup",
        });
        setVehicleLookupState("idle");
      } catch {
        if (cancelled) return;
        const estimate = estimateClosestSize(mk, md);
        if (estimate) {
          setVehicleMeasurement(estimate);
          setVehicleLookupState("idle");
        } else {
          setVehicleMeasurement(null);
          setVehicleLookupState("miss");
        }
      }
    }, 800);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [year, make, model]);


  const [designToolId, setDesignToolId] = useState<DesignToolId | null>(null);

  // ── Dialog ──
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitial, setDialogInitial] =
    useState<QuickQuoteDialogInitialState | undefined>(undefined);

  const openDialog = (initial?: QuickQuoteDialogInitialState) => {
    setDialogInitial(initial);
    setDialogOpen(true);
  };

  // ── Totals ──
  const { productsTotal, laborTotal, subtotal, marginAmount, computedTotal, total } =
    useMemo(() => {
      const products = lineItems.reduce((sum, l) => {
        if (!l.productId) return sum;
        const q = parseFloat(l.qty) || 0;
        const r = parseFloat(l.rate) || 0;
        return sum + q * r;
      }, 0);
      const lHrs = parseFloat(laborHours) || 0;
      const lRate = parseFloat(laborRate) || 0;
      const lFlat = parseFloat(laborFlat) || 0;
      const labor =
        laborMode === "flat"
          ? Math.round(lFlat * 100) / 100
          : Math.round(lHrs * lRate * 100) / 100;
      const proofAmount = studioProofEnabled ? STUDIO_PROOF_PRICE : 0;
      const sub =
        Math.round(
          (products + labor + customLinesTotal + proofAmount) * 100,
        ) / 100;
      const margin = Math.round(sub * (marginPct / 100) * 100) / 100;
      const computed = Math.round((sub + margin) * 100) / 100;
      const overrideValue = parseFloat(priceOverride);
      const tot =
        priceOverrideEnabled && Number.isFinite(overrideValue) && overrideValue >= 0
          ? Math.round(overrideValue * 100) / 100
          : computed;
      return {
        productsTotal: Math.round(products * 100) / 100,
        laborTotal: labor,
        subtotal: sub,
        marginAmount: margin,
        computedTotal: computed,
        total: tot,
      };
    }, [lineItems, laborHours, laborRate, laborMode, laborFlat, customLinesTotal, studioProofEnabled, marginPct, priceOverrideEnabled, priceOverride]);

  const money = (n: number) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── WePrintWraps cart link ──
  // Any line whose product maps to a WooCommerce id is fulfillable on
  // weprintwraps.com — pre-load those SKUs into the WPW cart so the customer
  // (or the shop, on the customer's behalf) can check out on WPW directly.
  // Non-WPW lines (labor, RestyleLibrary fade, custom lines) are dropped;
  // WPW fade-wrap printing rides on Woo id 58391.
  const wpwCart = useMemo(() => {
    const items: { wooProductId: number; quantity: number }[] = [];
    for (const line of lineItems) {
      if (!line.productId) continue;
      const qty = parseFloat(line.qty) || 0;
      const rate = parseFloat(line.rate) || 0;
      if (qty <= 0 || rate <= 0) continue;
      let wooId: number | undefined;
      if (line.productId === WPW_FADEWRAPS_PRODUCT_ID) wooId = 58391;
      else if (line.productId === RL_FADEWRAPS_PRODUCT_ID) wooId = undefined;
      else wooId = findProductById(line.productId)?.wooProductId;
      if (!wooId) continue;
      items.push({ wooProductId: wooId, quantity: Math.max(1, Math.ceil(qty)) });
    }
    return { url: buildWpwCartUrl(items), count: items.length };
  }, [lineItems]);

  // ── Analytics ──
  const [quoteNumber] = useState(
    () =>
      initial?.quoteNumber ||
      `QQ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  );

  const trackEvent = useCallback(
    async (eventType: string, metadata?: Record<string, unknown>) => {
      try {
        await supabase.from("quote_events").insert({
          event_type: eventType,
          quote_id: quoteNumber,
          product_type: "Dashboard",
          source: "dashboard-quickquote",
          metadata: {
            vehicle: [year, make, model].filter(Boolean).join(" ") || "Not specified",
            lines: lineItems.map((l) => ({
              category: l.category,
              productId: l.productId,
              qty: l.qty,
              rate: l.rate,
              panel: l.panel,
            })),
            productsTotal,
            laborTotal,
            customLinesTotal,
            studioProofEnabled,
            subtotal,
            marginPct,
            marginAmount,
            total,
            ...metadata,
          } as Record<string, unknown>,
        });
      } catch {
        /* non-fatal */
      }
    },
    [quoteNumber, year, make, model, lineItems, productsTotal, laborTotal, customLinesTotal, studioProofEnabled, subtotal, marginPct, marginAmount, total],
  );

  // Convert what the user has typed into the card into estimator line
  // items so opening the dialog (Save / Send / Calculate / Expand)
  // carries the displayed total through to the persisted quote rather
  // than opening empty and saving $0.
  const buildDialogInitial = (): QuickQuoteDialogInitialState => {
    const items: EstimatorLineItem[] = [];

    for (const line of lineItems) {
      if (!line.productId) continue;
      const qty = parseFloat(line.qty) || 0;
      const rate = parseFloat(line.rate) || 0;
      if (qty <= 0 || rate <= 0) continue;

      // Configurator-driven lines (FadeWraps) have a sentinel productId
      // that doesn't exist in the catalog — synthesize the line item
      // from the category + panel summary instead of looking it up.
      if (
        line.productId === WPW_FADEWRAPS_PRODUCT_ID ||
        line.productId === RL_FADEWRAPS_PRODUCT_ID
      ) {
        items.push({
          id: `card_${line.id}`,
          label: fadewrapsLabelFor(line.category as CategoryId),
          description: line.panel || undefined,
          qty,
          unitPrice: rate,
          unit: line.unit,
          source: "manual",
        });
        continue;
      }

      const product = findProductById(line.productId);
      if (!product) continue;
      items.push({
        id: `card_${line.id}`,
        label: product.name,
        description: line.panel || product.subName,
        qty,
        unitPrice: rate,
        unit: line.unit,
        source: "catalog",
        productId: product.id,
      });
    }

    for (const c of customLines) {
      const price = parseFloat(c.price) || 0;
      if (price <= 0 && !c.label.trim()) continue;
      items.push({
        id: `card_custom_${c.id}`,
        label: c.label.trim() || "Custom line",
        qty: 1,
        unitPrice: price,
        unit: "each",
        source: "manual",
      });
    }

    const lh = parseFloat(laborHours) || 0;
    const lr = parseFloat(laborRate) || 0;
    const lf = parseFloat(laborFlat) || 0;
    if (laborMode === "flat" && lf > 0) {
      items.push({
        id: "card_labor",
        label: "Install Labor (flat)",
        qty: 1,
        unitPrice: lf,
        unit: "each",
        source: "manual",
      });
    } else if (laborMode === "hourly" && lh > 0 && lr > 0) {
      items.push({
        id: "card_labor",
        label: "Install Labor",
        qty: lh,
        unitPrice: lr,
        unit: "hour",
        source: "manual",
      });
    }

    if (studioProofEnabled) {
      items.push({
        id: "card_studio_proof",
        label: "Studio Proof Add-on",
        qty: 1,
        unitPrice: STUDIO_PROOF_PRICE,
        unit: "each",
        source: "manual",
      });
    }

    const overrideValue = parseFloat(priceOverride);
    const overrideActive =
      priceOverrideEnabled && Number.isFinite(overrideValue) && overrideValue >= 0;

    if (overrideActive) {
      const itemsSubtotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
      const targetWithoutMargin =
        marginPct > 0 ? overrideValue / (1 + marginPct / 100) : overrideValue;
      const adjustment = Math.round((targetWithoutMargin - itemsSubtotal) * 100) / 100;
      if (Math.abs(adjustment) >= 0.01) {
        items.push({
          id: "card_price_adjustment",
          label: "Price adjustment",
          qty: 1,
          unitPrice: adjustment,
          unit: "each",
          source: "manual",
        });
      }
    }

    return {
      year: year || undefined,
      make: make || undefined,
      model: model || undefined,
      customerName: customerName.trim() || undefined,
      customerEmail: customerEmail.trim() || undefined,
      customerPhone: customerPhone.trim() || undefined,
      customerCompany: customerCompany.trim() || undefined,
      lineItems: items.length > 0 ? items : undefined,
      marginRate: marginPct > 0 ? marginPct / 100 : undefined,
    };
  };

  const navigateToFullQuote = (_action?: string) => openDialog(buildDialogInitial());

  // Build the persisted quote line items. Mirrors what the dialog used to
  // do but runs straight from the card so Save/Send don't pop a second
  // wizard that drops the user's typed-in selections. Each line carries
  // type · size · color · qty so the saved quote (and PDF) match what
  // the user sees on the dashboard.
  const buildPersistLineItems = () => {
    const out: Array<{
      label: string;
      detail?: string;
      amount: number;
      quantity?: number;
      wooProductId?: number;
    }> = [];

    for (const line of lineItems) {
      if (!line.productId) continue;
      const qty = parseFloat(line.qty) || 0;
      const rate = parseFloat(line.rate) || 0;
      if (qty <= 0 || rate <= 0) continue;

      const isFadeWrap =
        line.productId === WPW_FADEWRAPS_PRODUCT_ID ||
        line.productId === RL_FADEWRAPS_PRODUCT_ID;

      const unitLbl = unitShort(line.unit);
      const qtyStr =
        line.unit === "each" && qty === 1
          ? "1 each"
          : `${qty} ${unitLbl} × $${rate.toFixed(2)}`;

      if (isFadeWrap) {
        out.push({
          label: fadewrapsLabelFor(line.category as CategoryId),
          // line.panel is the configurator summary:
          // "Medium sides · Hood · Front Bumper · Rear+Bumper · Roof Medium · Beige Gloss"
          detail: line.panel
            ? `${line.panel} · ${qtyStr}`
            : qtyStr,
          amount: qty * rate,
          quantity: qty,
          // 58391 = WPW Woo "Custom Fade Wrap Printing | Avery Film" SKU
          // (see wpw-seed-products.ts). Tagging this ID makes buildPayUrl
          // render a real "Pay Now → Add to Cart" link on the PDF + email
          // for fade wrap quotes — without it those quotes had no payable
          // path because the configurator doesn't pick a catalog product.
          wooProductId: 58391,
        });
        continue;
      }

      const product = findProductById(line.productId);
      if (!product) continue;
      const detailParts: string[] = [];
      if (line.panel) detailParts.push(line.panel);
      if (product.subName && product.subName !== line.panel) {
        detailParts.push(product.subName);
      }
      detailParts.push(qtyStr);
      out.push({
        label: product.name,
        detail: detailParts.join(" · "),
        amount: qty * rate,
        quantity: qty,
        wooProductId: product.wooProductId,
      });
    }

    for (const c of customLines) {
      const price = parseFloat(c.price) || 0;
      if (price <= 0 && !c.label.trim()) continue;
      out.push({
        label: c.label.trim() || "Custom line",
        amount: price,
        quantity: 1,
      });
    }

    const lh = parseFloat(laborHours) || 0;
    const lr = parseFloat(laborRate) || 0;
    const lf = parseFloat(laborFlat) || 0;
    if (laborMode === "flat" && lf > 0) {
      out.push({
        label: "Install Labor (flat)",
        amount: Math.round(lf * 100) / 100,
        quantity: 1,
      });
    } else if (laborMode === "hourly" && lh > 0 && lr > 0) {
      out.push({
        label: "Install Labor",
        detail: `${lh} hrs × $${lr.toFixed(2)}/hr`,
        amount: Math.round(lh * lr * 100) / 100,
        quantity: lh,
      });
    }

    if (studioProofEnabled) {
      out.push({
        label: "Studio Proof Add-on",
        amount: STUDIO_PROOF_PRICE,
        quantity: 1,
      });
    }

    return out;
  };

  const invalidateQuoteCaches = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-saved-quotes"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-latest-quotes"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-quote-rows"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-business-metrics"] });
    queryClient.invalidateQueries({ queryKey: ["pillar-recent-activity"] });
  };

  const persistDirect = async (
    intent: "draft" | "send",
  ): Promise<{ quoteId: string; quoteNumber: string } | null> => {
    const persistItems = buildPersistLineItems();
    if (persistItems.length === 0) {
      toast({
        title: "Add at least one line",
        description: "Pick a product and enter qty/rate before saving.",
        variant: "destructive",
      });
      return null;
    }

    if (intent === "send" && !customerEmail.trim() && !customerName.trim() && !customerPhone.trim()) {
      toast({
        title: "Customer info required",
        description: "Add a customer (name, email, or phone) before sending.",
        variant: "destructive",
      });
      return null;
    }

    const customerHasInfo =
      customerName.trim() ||
      customerEmail.trim() ||
      customerPhone.trim() ||
      customerCompany.trim();

    const overrideSqFtParsed = parseFloat(sqFtOverride);
    const finalSqFt =
      Number.isFinite(overrideSqFtParsed) && overrideSqFtParsed > 0
        ? overrideSqFtParsed
        : vehicleMeasurement?.corrSqFt;

    const result = await saveQuote({
      quoteNumber,
      vehicle: {
        year: year.trim() || undefined,
        make: make.trim() || undefined,
        model: model.trim() || undefined,
      },
      toolSource: "dashboard-quickquote",
      shopCost: subtotal,
      customerTotal: total,
      marginPercent: marginPct > 0 ? marginPct : undefined,
      sqFt: finalSqFt,
      lineItems: persistItems,
      notes: notes.trim() || undefined,
      customer: customerHasInfo
        ? {
            name: customerName.trim() || undefined,
            email: customerEmail.trim() || undefined,
            phone: customerPhone.trim() || undefined,
            company: customerCompany.trim() || undefined,
          }
        : undefined,
    });

    if (!result) {
      toast({
        title: "Couldn't save the estimate",
        description: "Please try again.",
        variant: "destructive",
      });
      return null;
    }

    invalidateQuoteCaches();
    return { quoteId: result.quoteId, quoteNumber };
  };

  const handleSaveDirect = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      void trackEvent("quote_saved");
      const res = await persistDirect("draft");
      if (!res) return;
      toast({
        title: `Saved ${res.quoteNumber}`,
        description: "Quote held in /quotes.",
        action: (
          <ToastAction
            altText="Open in Quotes"
            onClick={() => navigate(`/quotes?id=${res.quoteId}`)}
          >
            Open
          </ToastAction>
        ),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendDirect = async () => {
    if (isSending) return;
    setIsSending(true);
    try {
      void trackEvent("quote_emailed");
      const res = await persistDirect("send");
      if (!res) return;
      let sendErr: { message?: string } | null = null;
      try {
        const invokeRes = await supabase.functions.invoke(
          "send-estimate-email",
          { body: { quoteId: res.quoteId } },
        );
        sendErr = invokeRes.error as { message?: string } | null;
      } catch (e) {
        // supabase.functions.invoke can throw on network/auth failures
        // before the edge function ever sees the request — we were
        // silently swallowing those, so the operator thought the
        // customer got the email when nothing actually fired.
        sendErr = { message: (e as Error)?.message ?? "Network error" };
      }
      if (sendErr) {
        toast({
          title: `Saved ${res.quoteNumber}, but email send FAILED`,
          description:
            (sendErr.message ?? "Unknown error") +
            " — open /quotes and click Send Now to retry.",
          variant: "destructive",
          duration: 12000,
        });
        return;
      }
      toast({
        title: `Sent ${res.quoteNumber}${customerEmail.trim() ? ` to ${customerEmail.trim()}` : ""}`,
        description: "Customer also gets a link to the live estimate.",
        action: (
          <ToastAction
            altText="Open in Quotes"
            onClick={() => navigate(`/quotes?id=${res.quoteId}`)}
          >
            Open
          </ToastAction>
        ),
      });
    } finally {
      setIsSending(false);
    }
  };

  // ── Render helpers for a single line item ──
  const renderCategoryPicker = (line: QuoteLine) => (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#60A5FA] mb-2">
        Pick a product category
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {categories.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleCategoryPick(line.id, cat.id)}
              className={cn(
                "flex flex-col items-start text-left rounded-lg border p-3 transition-all",
                "border-[#48484a] bg-black/40 hover:border-[#60A5FA]/60 hover:bg-[#60A5FA]/5",
              )}
            >
              <Icon className={cn("w-4 h-4 mb-1.5", cat.accent)} />
              <div className="text-xs font-bold text-white">{cat.label}</div>
              <div className="text-[10px] text-white/55 mt-0.5">{cat.blurb}</div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderProductLine = (line: QuoteLine) => {
    const cat = categories.find((c) => c.id === line.category);
    const products = line.category ? productsForCategory(line.category) : [];
    const product = line.productId ? findProductById(line.productId) : undefined;
    const Icon = cat?.icon ?? Wand2;
    const lineTotal =
      (parseFloat(line.qty) || 0) * (parseFloat(line.rate) || 0);
    const unitShortLabel = unitShort(line.unit);

    const isFadeWrapConfig =
      line.category === "wpw_fadewraps" || line.category === "rl_fadewraps";

    if (isFadeWrapConfig && line.category) {
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => resetLineCategory(line.id)}
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white/65 hover:text-white"
            >
              <ChevronLeft className="w-3 h-3" />
              Change category
            </button>
            <div className="flex items-center gap-1.5">
              <div className="w-6 h-6 rounded-md bg-black border border-[#48484a] flex items-center justify-center">
                <Icon className={cn("w-3.5 h-3.5", cat?.accent ?? "text-white")} />
              </div>
              <span className={cn("text-xs font-bold", cat?.accent ?? "text-white")}>
                {cat?.label}
              </span>
            </div>
          </div>
          <WpwFadeWrapConfigurator
            onChange={(sel) =>
              handleFadeWrapChange(line.id, line.category as CategoryId, sel)
            }
          />
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => resetLineCategory(line.id)}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white/65 hover:text-white"
          >
            <ChevronLeft className="w-3 h-3" />
            Change category
          </button>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-md bg-black border border-[#48484a] flex items-center justify-center">
              <Icon className={cn("w-3.5 h-3.5", cat?.accent ?? "text-white")} />
            </div>
            <span className={cn("text-xs font-bold", cat?.accent ?? "text-white")}>
              {cat?.label}
            </span>
          </div>
        </div>

        <Select
          value={line.productId ?? undefined}
          onValueChange={(v) => handleProductPick(line.id, v)}
        >
          <SelectTrigger
            className="w-full h-10 bg-black border-[#48484a] text-white text-xs font-semibold"
            aria-label="Product"
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

        {product && (
          <div className="space-y-2 pt-2 border-t border-[#48484a]">
            <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#60A5FA]">
              Dimensions
            </div>
            {vehicleMeasurement && line.unit === "sqft" && (
              <div>
                <Label className="text-[10px] font-semibold text-white/75 mb-1 block">
                  Select Roof Option
                </Label>
                <Select
                  onValueChange={(v) => {
                    if (v === "no_roof") {
                      const qty = Math.max(
                        0,
                        vehicleMeasurement.corrSqFt - vehicleMeasurement.roofSqFt * 1.1,
                      );
                      updateLine(line.id, {
                        qty: qty.toFixed(1),
                        unit: "sqft",
                        panel: line.panel || "Full wrap (no roof)",
                      });
                    } else {
                      updateLine(line.id, {
                        qty: vehicleMeasurement.corrSqFt.toFixed(1),
                        unit: "sqft",
                        panel: line.panel || "Full wrap (roof included)",
                      });
                    }
                  }}
                >
                  <SelectTrigger
                    className="w-full h-10 bg-black border-[#48484a] text-white text-xs font-semibold"
                    aria-label="Select roof option"
                  >
                    <SelectValue placeholder="Select Roof Option" />
                  </SelectTrigger>
                  <SelectContent className="bg-rp-surface border-[#48484a] text-white">
                    <SelectItem value="no_roof" className="text-xs">
                      No Roof Included &mdash;{" "}
                      {Math.max(
                        0,
                        vehicleMeasurement.corrSqFt - vehicleMeasurement.roofSqFt * 1.1,
                      ).toFixed(0)}{" "}
                      sq ft
                    </SelectItem>
                    <SelectItem value="roof" className="text-xs">
                      Roof Included &mdash;{" "}
                      {vehicleMeasurement.corrSqFt.toFixed(0)} sq ft
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-[10px] font-semibold text-white/75 mb-1 block">
                Panel / area
              </Label>
              <Input
                value={line.panel}
                onChange={(e) => updateLine(line.id, { panel: e.target.value })}
                placeholder="Hood, Roof, Full wrap…"
                className="h-9 text-xs bg-black border-[#48484a] text-white"
              />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
              <div>
                <Label className="text-[10px] font-semibold text-white/75 mb-1 block">
                  {line.unit === "sqft"
                    ? "Sq Ft"
                    : line.unit === "yard"
                      ? "Yards"
                      : line.unit === "linear_foot"
                        ? "Linear Ft"
                        : line.unit === "hour"
                          ? "Hours"
                          : line.unit === "window"
                            ? "Windows"
                            : "Qty"}
                </Label>
                <Input
                  type="number"
                  step={line.unit === "each" ? "1" : "0.1"}
                  value={line.qty}
                  onChange={(e) => updateLine(line.id, { qty: e.target.value })}
                  className="h-9 text-xs bg-black border-[#48484a] text-white text-center min-w-0"
                />
              </div>
              <span className="text-[10px] text-white/65 whitespace-nowrap mt-5">
                {unitShortLabel} × $
              </span>
              <div>
                <Label className="text-[10px] font-semibold text-white/75 mb-1 block">
                  Rate
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={line.rate}
                  onChange={(e) => updateLine(line.id, { rate: e.target.value })}
                  className="h-9 text-xs bg-black border-[#48484a] text-white text-center min-w-0"
                />
              </div>
              <span className="text-[10px] text-white/65 whitespace-nowrap mt-5">
                /{unitShortLabel}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs pt-1">
              <span className="text-white/60">Line total</span>
              <span className="font-bold text-white">{money(lineTotal)}</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-[#48484a] bg-rp-surface">
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-rp-pop">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-md bg-white/15 border border-white/30 flex items-center justify-center shrink-0 backdrop-blur-sm">
              <Calculator className="w-4 h-4 text-white" />
            </div>
            <ToolWordmark
              toolKey="quickquote"
              size="xl"
              className="[&>span]:!text-white [&>span]:!bg-none"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openDialog(buildDialogInitial())}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/20 border border-white/40 text-white text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-white/30 transition backdrop-blur-sm"
              title="Open full QuickQuote (customer info + price)"
            >
              <Expand className="w-3 h-3" />
              Expand
            </button>
            <button
              type="button"
              onClick={() => navigateToFullQuote("studio-proof")}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-white/20 border border-white/40 text-white text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-white/30 transition backdrop-blur-sm"
            >
              <Plus className="w-3 h-3" />
              Studio Proof
            </button>
          </div>
        </div>

        {/* ── LINE ITEMS ── */}
        <div className="px-5 pt-4 pb-5 flex flex-col gap-3">
          {/* Customer info — optional, bypassable. Autofills from CRM. */}
          <div className="rounded-xl border border-[#48484a] bg-rp-elevated overflow-hidden">
            <button
              type="button"
              onClick={() => setCustomerOpen((o) => !o)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/5 transition"
            >
              <div className="text-left">
                <div className="text-sm font-bold text-white">Customer info</div>
                <div className="text-[10px] text-white/60 font-inter">
                  {customerName || customerEmail || customerPhone
                    ? [customerName, customerEmail, customerPhone].filter(Boolean).join(" · ")
                    : "Optional — quote a price without it, or autofill from your CRM"}
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/55">
                {customerOpen ? "Hide" : "Add"}
              </span>
            </button>
            {customerOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-[#48484a] space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="relative">
                    <Label className="text-[10px] font-semibold text-white/75 mb-1 block">
                      Name
                    </Label>
                    <Input
                      value={customerName}
                      onChange={(e) => {
                        setCustomerName(e.target.value);
                        setShowCustomerMatches(true);
                      }}
                      onFocus={() => setShowCustomerMatches(true)}
                      onBlur={() => setTimeout(() => setShowCustomerMatches(false), 150)}
                      placeholder="Customer name"
                      className="h-9 text-xs bg-black border-[#48484a] text-white"
                    />
                    {showCustomerMatches && customerMatches.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-lg border border-[#48484a] bg-rp-surface shadow-lg max-h-56 overflow-y-auto">
                        {customerMatches.map((m) => (
                          <button
                            type="button"
                            key={m.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              pickCustomerMatch(m);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 border-b border-[#48484a] last:border-b-0"
                          >
                            <div className="text-xs font-semibold text-white truncate">
                              {m.name || m.email || m.phone || "Unnamed"}
                            </div>
                            <div className="text-[10px] text-white/55 truncate">
                              {[m.email, m.phone].filter(Boolean).join(" · ")}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <Label className="text-[10px] font-semibold text-white/75 mb-1 block">
                      Email
                    </Label>
                    <Input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => {
                        setCustomerEmail(e.target.value);
                        setShowCustomerMatches(true);
                      }}
                      onFocus={() => setShowCustomerMatches(true)}
                      onBlur={() => setTimeout(() => setShowCustomerMatches(false), 150)}
                      placeholder="customer@email.com"
                      className="h-9 text-xs bg-black border-[#48484a] text-white"
                    />
                    {showCustomerMatches && customerMatches.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-lg border border-[#48484a] bg-rp-surface shadow-lg max-h-56 overflow-y-auto">
                        {customerMatches.map((m) => (
                          <button
                            type="button"
                            key={m.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              pickCustomerMatch(m);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 border-b border-[#48484a] last:border-b-0"
                          >
                            <div className="text-xs font-semibold text-white truncate">
                              {m.name || m.email || m.phone || "Unnamed"}
                            </div>
                            <div className="text-[10px] text-white/55 truncate">
                              {[m.email, m.phone].filter(Boolean).join(" · ")}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative">
                    <Label className="text-[10px] font-semibold text-white/75 mb-1 block">
                      Phone
                    </Label>
                    <Input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => {
                        setCustomerPhone(e.target.value);
                        setShowCustomerMatches(true);
                      }}
                      onFocus={() => setShowCustomerMatches(true)}
                      onBlur={() => setTimeout(() => setShowCustomerMatches(false), 150)}
                      placeholder="(555) 123-4567"
                      className="h-9 text-xs bg-black border-[#48484a] text-white"
                    />
                    {showCustomerMatches && customerMatches.length > 0 && (
                      <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-lg border border-[#48484a] bg-rp-surface shadow-lg max-h-56 overflow-y-auto">
                        {customerMatches.map((m) => (
                          <button
                            type="button"
                            key={m.id}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              pickCustomerMatch(m);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 border-b border-[#48484a] last:border-b-0"
                          >
                            <div className="text-xs font-semibold text-white truncate">
                              {m.name || m.email || m.phone || "Unnamed"}
                            </div>
                            <div className="text-[10px] text-white/55 truncate">
                              {[m.email, m.phone].filter(Boolean).join(" · ")}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label className="text-[10px] font-semibold text-white/75 mb-1 block">
                      Company (optional)
                    </Label>
                    <Input
                      value={customerCompany}
                      onChange={(e) => setCustomerCompany(e.target.value)}
                      placeholder="Acme Auto"
                      className="h-9 text-xs bg-black border-[#48484a] text-white"
                    />
                  </div>
                </div>
                <div className="text-[10px] text-white/55 font-inter">
                  Tip: start typing a name, email, or phone — matches from your CRM will autofill the rest.
                </div>
              </div>
            )}
          </div>

          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#60A5FA]">
            Line items
          </div>

          {/* Vehicle (free-text year/make/model — fully optional) */}
          <div className="rounded-xl border border-[#48484a] bg-rp-elevated p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#60A5FA]">
                Vehicle
              </div>
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] px-2 py-0.5 rounded text-white bg-[#48484a]">
                Optional
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px] font-semibold text-white/75 mb-1 block">Year</Label>
                <Input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="2024"
                  className="h-9 text-xs bg-black border-[#48484a] text-white"
                />
              </div>
              <div>
                <Label className="text-[10px] font-semibold text-white/75 mb-1 block">Make</Label>
                <Input
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  placeholder="BMW"
                  className="h-9 text-xs bg-black border-[#48484a] text-white"
                />
              </div>
              <div>
                <Label className="text-[10px] font-semibold text-white/75 mb-1 block">Model</Label>
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="M4"
                  className="h-9 text-xs bg-black border-[#48484a] text-white"
                />
              </div>
            </div>

            {/* Vehicle measurement readout */}
            {vehicleMeasurement && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-[#48484a] bg-black/40 px-3 py-2 text-[10px] font-inter">
                <div className="flex items-center gap-2 text-white/75">
                  <span className="font-bold text-[#60A5FA]">
                    {vehicleMeasurement.corrSqFt.toFixed(1)} sq ft
                  </span>
                  <span className="text-white/50">·</span>
                  <span>
                    Hood {vehicleMeasurement.hoodSqFt.toFixed(1)} sq ft
                  </span>
                  {vehicleMeasurement.source === "estimate" && vehicleMeasurement.estimateBasis && (
                    <>
                      <span className="text-white/50">·</span>
                      <span className="italic text-amber-200/80">
                        from {vehicleMeasurement.estimateBasis}
                      </span>
                    </>
                  )}
                </div>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider",
                    vehicleMeasurement.source === "database"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : vehicleMeasurement.source === "lookup"
                        ? "bg-fuchsia-500/20 text-fuchsia-300"
                        : "bg-amber-500/20 text-amber-300",
                  )}
                >
                  {vehicleMeasurement.source === "database"
                    ? "DB"
                    : vehicleMeasurement.source === "lookup"
                      ? "AI lookup"
                      : "Estimate"}
                </span>
              </div>
            )}
            {vehicleLookupState === "loading" && !vehicleMeasurement && (
              <div className="mt-3 rounded-lg border border-fuchsia-500/60 bg-fuchsia-500/10 px-3 py-2.5 flex items-center gap-2.5">
                <div className="w-4 h-4 rounded-full border-2 border-fuchsia-300 border-t-transparent animate-spin shrink-0" />
                <div className="min-w-0">
                  <div className="text-[11px] font-bold text-white">
                    Gathering sq ft info for {[year, make, model].filter(Boolean).join(" ")}…
                  </div>
                  <div className="text-[9px] text-white/65 font-inter">
                    Looking up wheelbase + dimensions, calculating panels, saving to your DB.
                  </div>
                </div>
              </div>
            )}
            {vehicleLookupState === "miss" && !vehicleMeasurement && (
              <div className="mt-3 rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-[10px] font-inter text-white">
                Couldn&apos;t find or calculate measurements — enter sq ft manually below.
              </div>
            )}

            {/* Manual Sq Ft override — beats the auto-derived value on the
                saved quote and the customer-facing PDF. */}
            <div className="mt-3">
              <Label className="text-[10px] font-semibold text-white/75 mb-1 block">
                Square Footage
                {vehicleMeasurement
                  ? ` (override — auto: ${vehicleMeasurement.corrSqFt.toFixed(1)} sq ft)`
                  : " (manual entry)"}
              </Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={sqFtOverride}
                onChange={(e) => setSqFtOverride(e.target.value)}
                placeholder={
                  vehicleMeasurement
                    ? vehicleMeasurement.corrSqFt.toFixed(1)
                    : "e.g. 275"
                }
                className="h-9 text-xs bg-black border-[#48484a] text-white"
                aria-label="Square footage override"
              />
            </div>
          </div>

          {/* Per-line product flow */}
          {lineItems.map((line, idx) => (
            <div
              key={line.id}
              className="rounded-xl border border-[#48484a] bg-rp-elevated p-3 sm:p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/55">
                  Product {idx + 1}
                </div>
                {lineItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    className="h-7 w-7 rounded flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-white/5 transition-all shrink-0"
                    aria-label="Remove product"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {line.category ? renderProductLine(line) : renderCategoryPicker(line)}
            </div>
          ))}

          {/* Add another product */}
          <Button
            onClick={addLine}
            className="w-full bg-gradient-rp-pop hover:brightness-110 text-white font-semibold text-sm h-11 rounded-xl"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Another Product
          </Button>

          {/* Design tools */}
          <div className="rounded-xl border border-[#48484a] bg-rp-elevated p-4">
            <DesignToolsPicker
              toolId={designToolId}
              onChange={setDesignToolId}
              isWpwTenant={isWpwTenant}
              compact
            />
          </div>

          {/* Custom (free-form) line items */}
          {customLines.map((line) => (
            <div
              key={line.id}
              className="rounded-xl border border-[#48484a] bg-rp-elevated p-3"
              style={{
                backgroundImage:
                  "linear-gradient(var(--rp-elevated),var(--rp-elevated)), linear-gradient(135deg,#2563eb,#a855f7)",
                backgroundOrigin: "border-box",
                backgroundClip: "padding-box, border-box",
                borderColor: "transparent",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Input
                  value={line.label}
                  onChange={(e) => updateCustomLine(line.id, { label: e.target.value })}
                  placeholder="Custom line (Removal, Design, Specialty…)"
                  className="h-9 text-xs bg-black border-[#48484a] text-white font-bold placeholder:font-normal flex-1"
                />
                <button
                  type="button"
                  onClick={() => removeCustomLine(line.id)}
                  className="h-8 w-8 rounded flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-white/5 transition-all shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-white/50">Price</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-white/40">$</span>
                  <Input
                    type="number"
                    value={line.price}
                    onChange={(e) => updateCustomLine(line.id, { price: e.target.value })}
                    placeholder="0.00"
                    className="h-8 w-24 text-xs bg-black border-[#48484a] text-white text-right font-bold"
                    step="25"
                  />
                </div>
              </div>
            </div>
          ))}

          <Button
            onClick={addCustomLine}
            variant="ghost"
            className="w-full bg-rp-elevated border border-[#48484a] text-white hover:bg-[#48484a] font-semibold text-xs h-10 rounded-xl"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Custom Line
          </Button>

          {/* Install Labor */}
          <div className="rounded-xl border border-fuchsia-500/60 bg-rp-elevated p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-bold text-white">Install Labor</div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setLaborMode("hourly")}
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition",
                    laborMode === "hourly"
                      ? "bg-gradient-rp-pop text-white"
                      : "bg-black border border-[#48484a] text-white/70 hover:border-fuchsia-500/60",
                  )}
                >
                  Hrs × Rate
                </button>
                <button
                  type="button"
                  onClick={() => setLaborMode("flat")}
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition",
                    laborMode === "flat"
                      ? "bg-gradient-rp-pop text-white"
                      : "bg-black border border-[#48484a] text-white/70 hover:border-fuchsia-500/60",
                  )}
                >
                  Flat $
                </button>
              </div>
            </div>
            {laborMode === "flat" ? (
              <div className="rounded-lg border border-fuchsia-500/60 bg-black py-2 px-3 flex items-center gap-2">
                <span className="text-white/50 text-base">$</span>
                <Input
                  type="number"
                  step="1"
                  min="0"
                  value={laborFlat}
                  onChange={(e) => setLaborFlat(e.target.value)}
                  placeholder="3000"
                  className="flex-1 h-9 bg-transparent border-0 text-white font-bold text-lg px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  aria-label="Flat install labor amount"
                />
              </div>
            ) : (
            <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
              <Input
                type="number"
                step="0.5"
                value={laborHours}
                onChange={(e) => setLaborHours(e.target.value)}
                className="h-9 text-xs bg-black border-[#48484a] text-white text-center min-w-0"
                aria-label="Labor hours"
              />
              <span className="text-[10px] text-white/65 whitespace-nowrap">hrs × $</span>
              <Input
                type="number"
                step="1"
                value={laborRate}
                onChange={(e) => setLaborRate(e.target.value)}
                className="h-9 text-xs bg-black border-[#48484a] text-white text-center min-w-0"
                aria-label="Labor rate"
              />
              <span className="text-[10px] text-white/65 whitespace-nowrap">/hr</span>
            </div>
            )}
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-white/60">Labor total</span>
              <span className="font-bold text-white">{money(laborTotal)}</span>
            </div>
          </div>

          {/* Order Notes */}
          <div className="rounded-xl border border-[#48484a] bg-rp-elevated p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <div className="text-sm font-bold text-white">Order Notes</div>
                <div className="text-[10px] text-white/60 font-inter mt-0.5">
                  Optional — color picked, install instructions, anything the team needs.
                </div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-[0.12em] px-2 py-0.5 rounded text-white bg-[#48484a]">
                Optional
              </span>
            </div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Color: Liquid Sunset · Gloss · Ship to install bay 2 · Customer requested matte windows"
              rows={3}
              className="bg-black border-[#48484a] text-white text-xs placeholder:text-white/30"
              aria-label="Order notes"
            />
          </div>

          {/* Add-Ons (opt-in) */}
          <div className="rounded-xl border border-[#48484a] bg-rp-elevated p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold text-white">Studio Proof Add-on</div>
                <div className="text-[10px] text-white/60 font-inter mt-0.5">
                  Optional — adds $100.00 to the quote
                </div>
              </div>
              <Switch
                checked={studioProofEnabled}
                onCheckedChange={setStudioProofEnabled}
                aria-label="Toggle Studio Proof add-on"
              />
            </div>
          </div>

          {/* Region */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigateToFullQuote("region")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-[#48484a] bg-rp-elevated text-xs font-semibold text-white hover:border-white/40 transition"
            >
              <MapPin className="w-3 h-3 text-[#60A5FA]" />
              {DEFAULT_REGION}
              <span className="text-white/60 text-[10px]">▾</span>
            </button>
            <span className="text-[10px] font-bold uppercase tracking-wide px-3 py-1 rounded-full bg-gradient-rp-pop text-white">
              Premium
            </span>
          </div>

          {/* Optional profit margin adjuster */}
          <div className="rounded-xl border border-[#48484a] bg-rp-elevated overflow-hidden">
            <button
              type="button"
              onClick={() => setMarginPanelOpen((o) => !o)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/5 transition"
            >
              <div className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-fuchsia-300" />
                <div className="text-left">
                  <div className="text-sm font-bold text-white">Adjust Profit Margin</div>
                  <div className="text-[10px] text-white/60 font-inter">
                    Optional — bump the customer price
                  </div>
                </div>
              </div>
              <span className="text-xs font-bold text-fuchsia-300 font-montserrat">
                +{marginPct}%
              </span>
            </button>
            {marginPanelOpen && (
              <div className="px-4 pb-4 pt-1 border-t border-[#48484a] space-y-3">
                <div className="flex items-center gap-2">
                  {[0, 10, 20, 35, 50, 65].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setMarginPct(p)}
                      className={cn(
                        "flex-1 h-8 rounded-md text-[11px] font-bold transition",
                        marginPct === p
                          ? "bg-gradient-rp-pop text-white"
                          : "bg-black border border-[#48484a] text-white/75 hover:border-fuchsia-500/60",
                      )}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={marginPct}
                    onChange={(e) => setMarginPct(parseInt(e.target.value, 10))}
                    className="flex-1 accent-fuchsia-500"
                    aria-label="Margin percentage"
                  />
                  <span className="text-xs font-bold text-white font-montserrat min-w-[3rem] text-right">
                    +{marginPct}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-inter pt-1 border-t border-[#48484a]">
                  <span className="text-white/65">Margin amount</span>
                  <span className="font-bold text-fuchsia-300">{money(marginAmount)}</span>
                </div>
                <Button
                  onClick={() => setMarginPanelOpen(false)}
                  className="w-full bg-gradient-rp-pop hover:brightness-110 text-white font-bold text-xs h-9 rounded-lg"
                >
                  Update Quote
                </Button>
              </div>
            )}
          </div>

          {/* TOTAL */}
          <div className="rounded-xl border border-[#48484a] bg-rp-elevated p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold uppercase tracking-[0.15em] text-[#60A5FA]">
                Total{priceOverrideEnabled && " · Custom"}
              </div>
              <span className="text-[10px] text-white/55">
                {priceOverrideEnabled ? "Type any amount below" : "Tap below to set your own price"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!priceOverrideEnabled && !priceOverride) {
                  setPriceOverride(computedTotal.toFixed(2));
                }
                setPriceOverrideEnabled((v) => !v);
              }}
              className={cn(
                "w-full text-xs font-bold uppercase tracking-wider py-2 rounded-lg transition mb-2",
                priceOverrideEnabled
                  ? "bg-gradient-rp-pop text-white"
                  : "bg-black border-2 border-fuchsia-500/60 text-fuchsia-300 hover:bg-fuchsia-500/10",
              )}
            >
              {priceOverrideEnabled ? "✓ Custom price ON · Tap to revert" : "Override Price"}
            </button>
            {priceOverrideEnabled ? (
              <div className="rounded-lg border border-fuchsia-500/60 bg-black py-3 px-4 flex items-center gap-2">
                <span className="text-white/50 text-lg">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceOverride}
                  onChange={(e) => setPriceOverride(e.target.value)}
                  placeholder={computedTotal.toFixed(2)}
                  className="flex-1 h-12 bg-transparent border-0 text-white font-montserrat text-3xl font-bold tracking-tight px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                  aria-label="Custom total price"
                />
              </div>
            ) : (
              <div className="rounded-lg border border-[#48484a] bg-black py-4 flex items-center justify-center">
                <span className="text-white/50 text-lg mr-2">$</span>
                <span className="font-montserrat text-3xl font-bold text-white tracking-tight">
                  {total.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            )}
            <div className="text-center text-[10px] text-white/55 mt-2 font-inter">
              {priceOverrideEnabled ? (
                <>
                  Custom price overrides the calculated total ({money(computedTotal)})
                </>
              ) : (
                <>
                  Products {money(productsTotal)} + Install {money(laborTotal)}
                  {customLinesTotal > 0 && ` + Custom ${money(customLinesTotal)}`}
                  {studioProofEnabled && " + Studio Proof $100.00"}
                  {marginPct > 0 && ` + ${marginPct}% margin (${money(marginAmount)})`}
                </>
              )}
            </div>
            {!priceOverrideEnabled && subtotal === 0 && marginPct > 0 && (
              <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200 leading-relaxed">
                Margin is set to {marginPct}% but the subtotal is $0. Add a
                product line with a qty and rate (or set Install Labor) and the
                margin will compound on top.
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={() => {
                trackEvent("quote_calculated");
                navigateToFullQuote("calculate");
              }}
              className="bg-gradient-rp-pop hover:brightness-110 text-white font-bold text-xs h-11 rounded-xl"
            >
              <Calculator className="w-4 h-4 mr-1.5" />
              Calculate
            </Button>
            <Button
              onClick={handleSaveDirect}
              disabled={isSaving}
              variant="ghost"
              className="bg-rp-elevated border border-[#48484a] text-white hover:bg-[#48484a] font-semibold text-xs h-11 rounded-xl disabled:opacity-60"
            >
              <FileText className="w-4 h-4 mr-1.5" />
              {isSaving ? "Saving…" : "Save Quote"}
            </Button>
          </div>
          <Button
            onClick={handleSendDirect}
            disabled={isSending}
            className="bg-gradient-rp-pop hover:brightness-110 text-white font-bold text-xs h-11 rounded-xl w-full disabled:opacity-60"
          >
            <Mail className="w-4 h-4 mr-1.5" />
            {isSending ? "Sending…" : "Send Quote by Email"}
          </Button>

          {/* WePrintWraps cart — only shown when a line maps to a WPW SKU */}
          {wpwCart.url && (
            <Button
              onClick={() => {
                void trackEvent("wpw_cart_opened", { items: wpwCart.count });
                window.open(wpwCart.url!, "_blank", "noopener,noreferrer");
              }}
              variant="ghost"
              className="bg-rp-elevated border border-[#48484a] text-white hover:bg-[#48484a] font-semibold text-xs h-11 rounded-xl w-full"
              title="Open the WePrintWraps cart pre-loaded with the WPW products on this quote"
            >
              <ShoppingCart className="w-4 h-4 mr-1.5" />
              Add {wpwCart.count} item{wpwCart.count === 1 ? "" : "s"} to WePrintWraps Cart
              <ExternalLink className="w-3 h-3 ml-1.5 opacity-70" />
            </Button>
          )}
        </div>
      </div>

      {dialogOpen && (
        <Suspense fallback={null}>
          <QuickQuoteDialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            initial={dialogInitial}
          />
        </Suspense>
      )}
    </>
  );
};
