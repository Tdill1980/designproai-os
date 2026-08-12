/**
 * Admin Quote Pricing — per-shop pricing overrides for QuickQuote.
 *
 * Lets every shop adjust:
 * - Film cost per yard (by finish)
 * - Printed wrap cost per sq ft (by quality)
 * - Regional labor rates
 * - Add-on flat prices
 * - Default margin %
 * - Default region
 * - Shop branding (name + logo for quotes)
 *
 * Does NOT replace existing ColorPro / Tint / PPF pricing —
 * only overrides the QuickQuote estimator defaults.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, Save, RotateCcw, DollarSign, MapPin,
  Percent, Palette, Printer, Wrench, Upload, Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useShopPricing, type ShopPricingConfig } from "@/hooks/useShopPricing";
import { supabase } from "@/integrations/supabase/client";
import { REGIONS, type PriceRegion } from "@/lib/quick-quote";

const db = supabase as any;

const FINISH_LABELS: Record<string, string> = {
  gloss: "Gloss",
  satin: "Satin",
  matte: "Matte",
  metallic: "Metallic",
  chrome: "Chrome",
  color_flip: "Color Flip",
  brushed: "Brushed",
  carbon: "Carbon Fiber",
  textured: "Textured",
};

const PRINT_LABELS: Record<string, string> = {
  standard: "Standard Print",
  premium: "Premium Cast + Lamination",
  reflective: "Reflective Print",
};

const ADDON_LABELS: Record<string, string> = {
  ppf_hood: "PPF Hood Only",
  roof_wrap: "Roof Wrap",
  chrome_delete: "Chrome Delete",
  window_tint: "Window Tint",
  custom_graphics: "Custom Graphics",
};

const sectionCls = "rounded-2xl border border-[#48484a] bg-rp-surface p-5 space-y-4";
const headingCls = "text-xs font-bold text-[#60A5FA] uppercase tracking-[0.12em] flex items-center gap-2";
const inputCls = "h-9 bg-black border-[#48484a] rounded text-sm text-white placeholder:text-white/40 focus-visible:ring-[#60A5FA]/40";

const AdminQuotePricing = () => {
  const navigate = useNavigate();
  const { pricing, isLoading, save, isSaving, defaults } = useShopPricing();

  const [filmPrices, setFilmPrices] = useState<Record<string, number>>({});
  const [printPrices, setPrintPrices] = useState<Record<string, number>>({});
  const [laborRates, setLaborRates] = useState<Record<string, number>>({});
  const [addOnPrices, setAddOnPrices] = useState<Record<string, number>>({});
  const [marginPercent, setMarginPercent] = useState(65);
  const [defaultRegion, setDefaultRegion] = useState("standard");
  const [shopName, setShopName] = useState("");
  const [shopLogoUrl, setShopLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [dirty, setDirty] = useState(false);

  // Hydrate form from DB pricing
  useEffect(() => {
    if (!pricing) return;
    setFilmPrices(pricing.film_prices);
    setPrintPrices(pricing.print_prices);
    setLaborRates(pricing.labor_rates);
    setAddOnPrices(pricing.add_on_prices);
    setMarginPercent(pricing.default_margin_percent);
    setDefaultRegion(pricing.default_region);
  }, [pricing]);

  // Load shop branding
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      db.from("shop_profiles")
        .select("shop_name, shop_logo_url")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }: any) => {
          if (data) {
            setShopName(data.shop_name || "");
            setShopLogoUrl(data.shop_logo_url || null);
          }
        });
    });
  }, []);

  const updateFilm = (key: string, val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n)) {
      setFilmPrices((p) => ({ ...p, [key]: n }));
      setDirty(true);
    }
  };
  const updatePrint = (key: string, val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n)) {
      setPrintPrices((p) => ({ ...p, [key]: n }));
      setDirty(true);
    }
  };
  const updateLabor = (key: string, val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n)) {
      setLaborRates((p) => ({ ...p, [key]: n }));
      setDirty(true);
    }
  };
  const updateAddOn = (key: string, val: string) => {
    const n = parseFloat(val);
    if (!isNaN(n)) {
      setAddOnPrices((p) => ({ ...p, [key]: n }));
      setDirty(true);
    }
  };

  const handleSave = async () => {
    try {
      // Save pricing config
      await save({
        film_prices: filmPrices,
        print_prices: printPrices,
        labor_rates: laborRates,
        add_on_prices: addOnPrices,
        default_margin_percent: marginPercent,
        default_region: defaultRegion,
      });

      // Save shop branding if changed
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const brandingUpdate: any = {};
        if (shopName) brandingUpdate.shop_name = shopName;

        // Upload logo if new file selected
        if (logoFile) {
          const ext = logoFile.name.split(".").pop() || "png";
          const path = `shop-logos/${user.id}.${ext}`;
          await supabase.storage
            .from("wrap-files")
            .upload(path, logoFile, { upsert: true, contentType: logoFile.type });
          const { data: urlData } = supabase.storage
            .from("wrap-files")
            .getPublicUrl(path);
          if (urlData?.publicUrl) {
            brandingUpdate.shop_logo_url = urlData.publicUrl;
            setShopLogoUrl(urlData.publicUrl);
          }
        }

        if (Object.keys(brandingUpdate).length > 0) {
          await db
            .from("shop_profiles")
            .update(brandingUpdate)
            .eq("user_id", user.id);
        }
      }

      setDirty(false);
      setLogoFile(null);
      toast.success("Pricing & branding saved");
    } catch (err: any) {
      toast.error("Save failed: " + (err.message || "Unknown error"));
    }
  };

  const handleReset = () => {
    setFilmPrices(defaults.film_prices);
    setPrintPrices(defaults.print_prices);
    setLaborRates(defaults.labor_rates);
    setAddOnPrices(defaults.add_on_prices);
    setMarginPercent(defaults.default_margin_percent);
    setDefaultRegion(defaults.default_region);
    setDirty(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-pulse text-white/40 text-sm">Loading pricing config...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/quotes")} className="p-2 rounded-lg hover:bg-white/10 transition">
              <ArrowLeft className="w-4 h-4 text-white/60" />
            </button>
            <div>
              <h1 className="text-xl font-bold">Quote Pricing & Branding</h1>
              <p className="text-xs text-white/50">Customize your shop's pricing, margins, and branding for quotes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} className="border-[#48484a] text-white/70 hover:text-white">
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reset to Defaults
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving} className="bg-gradient-rp-pop text-white">
              <Save className="w-3.5 h-3.5 mr-1.5" /> {isSaving ? "Saving..." : "Save All"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* ── Shop Branding ── */}
          <div className={sectionCls}>
            <div className={headingCls}><Store className="w-4 h-4" /> Shop Branding</div>
            <div className="space-y-3">
              <div>
                <Label className="text-[10px] text-white/60 mb-1 block">Shop Name (appears on quotes)</Label>
                <Input
                  value={shopName}
                  onChange={(e) => { setShopName(e.target.value); setDirty(true); }}
                  placeholder="Your Shop Name"
                  className={inputCls}
                />
              </div>
              <div>
                <Label className="text-[10px] text-white/60 mb-1 block">Shop Logo</Label>
                <div className="flex items-center gap-3">
                  {shopLogoUrl ? (
                    <img src={shopLogoUrl} alt="Shop logo" className="w-12 h-12 object-contain rounded border border-[#48484a] bg-white/5" />
                  ) : (
                    <div className="w-12 h-12 rounded border border-dashed border-[#48484a] flex items-center justify-center text-white/20">
                      <Store className="w-5 h-5" />
                    </div>
                  )}
                  <label className="cursor-pointer text-xs text-[#60A5FA] hover:underline flex items-center gap-1">
                    <Upload className="w-3.5 h-3.5" />
                    {shopLogoUrl ? "Replace Logo" : "Upload Logo"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) { setLogoFile(f); setDirty(true); }
                      }}
                    />
                  </label>
                  {logoFile && <span className="text-[10px] text-white/40">{logoFile.name}</span>}
                </div>
              </div>
            </div>
          </div>

          {/* ── Default Margin & Region ── */}
          <div className={sectionCls}>
            <div className={headingCls}><Percent className="w-4 h-4" /> Margin & Region</div>
            <div className="space-y-3">
              <div>
                <Label className="text-[10px] text-white/60 mb-1 block">Default Margin: {marginPercent}%</Label>
                <Slider
                  value={[marginPercent]}
                  onValueChange={([v]) => { setMarginPercent(v); setDirty(true); }}
                  min={0}
                  max={200}
                  step={5}
                  className="w-full"
                />
                <div className="flex justify-between text-[9px] text-white/30 mt-1">
                  <span>0%</span><span>100%</span><span>200%</span>
                </div>
              </div>
              <div>
                <Label className="text-[10px] text-white/60 mb-1 block">Default Region</Label>
                <Select value={defaultRegion} onValueChange={(v) => { setDefaultRegion(v); setDirty(true); }}>
                  <SelectTrigger className={cn(inputCls, "w-full")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-rp-elevated border-[#48484a]">
                    {(Object.keys(REGIONS) as PriceRegion[]).map((r) => (
                      <SelectItem key={r} value={r}>
                        {REGIONS[r].label} — {REGIONS[r].description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* ── Film Cost Per Yard ── */}
          <div className={sectionCls}>
            <div className={headingCls}><Palette className="w-4 h-4" /> Film Cost Per Yard</div>
            <p className="text-[10px] text-white/40">Color change vinyl wrap film — priced per linear yard of 60" roll</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {Object.entries(FINISH_LABELS).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-[10px] text-white/50 mb-1 block">{label}</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
                    <Input
                      type="number"
                      step="0.50"
                      value={filmPrices[key] ?? ""}
                      onChange={(e) => updateFilm(key, e.target.value)}
                      className={cn(inputCls, "pl-6")}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Print Cost Per Sq Ft ── */}
          <div className={sectionCls}>
            <div className={headingCls}><Printer className="w-4 h-4" /> Print Cost Per Sq Ft</div>
            <p className="text-[10px] text-white/40">Printed wraps (FadeWraps, PatternPro, DesignPro) — priced per sq ft</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {Object.entries(PRINT_LABELS).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-[10px] text-white/50 mb-1 block">{label}</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
                    <Input
                      type="number"
                      step="0.25"
                      value={printPrices[key] ?? ""}
                      onChange={(e) => updatePrint(key, e.target.value)}
                      className={cn(inputCls, "pl-6")}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Regional Labor Rates ── */}
          <div className={sectionCls}>
            <div className={headingCls}><MapPin className="w-4 h-4" /> Regional Labor Rates ($/sq ft)</div>
            <p className="text-[10px] text-white/40">Installation labor cost per sq ft — based on market tier</p>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(REGIONS) as PriceRegion[]).map((r) => (
                <div key={r}>
                  <Label className="text-[10px] text-white/50 mb-1 block">
                    {REGIONS[r].label} <span className="text-white/30">({REGIONS[r].description})</span>
                  </Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
                    <Input
                      type="number"
                      step="0.25"
                      value={laborRates[r] ?? ""}
                      onChange={(e) => updateLabor(r, e.target.value)}
                      className={cn(inputCls, "pl-6")}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Add-On Prices ── */}
          <div className={sectionCls}>
            <div className={headingCls}><Wrench className="w-4 h-4" /> Add-On Services (flat price)</div>
            <p className="text-[10px] text-white/40">Flat-rate add-ons available in the QuickQuote estimator</p>
            <div className="grid grid-cols-2 gap-3">
              {Object.entries(ADDON_LABELS).map(([key, label]) => (
                <div key={key}>
                  <Label className="text-[10px] text-white/50 mb-1 block">{label}</Label>
                  <div className="relative">
                    <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30" />
                    <Input
                      type="number"
                      step="5"
                      value={addOnPrices[key] ?? ""}
                      onChange={(e) => updateAddOn(key, e.target.value)}
                      className={cn(inputCls, "pl-6")}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sticky save bar */}
        {dirty && (
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-rp-elevated/95 backdrop-blur border-t border-[#48484a] p-3">
            <div className="max-w-5xl mx-auto flex items-center justify-between">
              <span className="text-xs text-amber-400">You have unsaved changes</span>
              <Button size="sm" onClick={handleSave} disabled={isSaving} className="bg-gradient-rp-pop text-white">
                <Save className="w-3.5 h-3.5 mr-1.5" /> {isSaving ? "Saving..." : "Save All"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminQuotePricing;
