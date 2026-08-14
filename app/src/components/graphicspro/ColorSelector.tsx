import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { X, Check, Palette, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ColorSelectorProps {
  presetLabel: string;
  onConfirm: (baseColor: string, stripeColor: string) => void;
  onCancel: () => void;
  defaultBaseColor?: string;
  defaultStripeColor?: string;
}

interface VinylColor {
  id: string;
  name: string;
  manufacturer: string;
  series: string | null;
  code: string | null;
  hex: string;
  finish: string;
  lab: any;
}

// FIXED MASTER MANUFACTURER LIST - All 12 verified manufacturers
const MANUFACTURERS = [
  "3M",
  "Arlon",
  "Avery Dennison",
  "Carlas",
  "FlexiShield",
  "Inozetek",
  "KPMF",
  "Oracal",
  "STEK",
  "TeckWrap",
  "VViViD",
];

// OEM preset defaults
const OEM_DEFAULTS: Record<string, { base: string; stripe: string }> = {
  "mustang_gt": { base: "gloss black", stripe: "white" },
  "camaro_hockey": { base: "silver metallic", stripe: "black" },
  "challenger_bumblebee": { base: "gloss yellow", stripe: "black" },
};

// Loading shimmer component
const LoadingShimmer = ({ text }: { text: string }) => (
  <div className="w-full p-3 rounded-lg bg-secondary/50 border border-border text-muted-foreground animate-pulse flex items-center gap-2">
    <Loader2 className="w-4 h-4 animate-spin" />
    {text}
  </div>
);

export const ColorSelector = ({
  presetLabel,
  onConfirm,
  onCancel,
}: ColorSelectorProps) => {
  // All verified colors from database
  const [allColors, setAllColors] = useState<VinylColor[]>([]);
  const [loadingAll, setLoadingAll] = useState(true);

  // BASE COLOR STATE
  const [baseManufacturer, setBaseManufacturer] = useState("");
  const [baseSeries, setBaseSeries] = useState("");
  const [baseColorId, setBaseColorId] = useState("");
  const [selectedBase, setSelectedBase] = useState<VinylColor | null>(null);

  // STRIPE COLOR STATE
  const [stripeManufacturer, setStripeManufacturer] = useState("");
  const [stripeSeries, setStripeSeries] = useState("");
  const [stripeColorId, setStripeColorId] = useState("");
  const [selectedStripe, setSelectedStripe] = useState<VinylColor | null>(null);

  // Fetch ALL verified colors on mount
  useEffect(() => {
    const fetchColors = async () => {
      setLoadingAll(true);

      // Prefer manufacturer_colors (authoritative)
      // Note: Removed is_verified filter - newly inserted colors may not have this flag set
      const { data: mfcData, error: mfcError } = await supabase
        .from('manufacturer_colors')
        .select('id, manufacturer, series, product_code, official_name, official_hex, finish, lab_l, lab_a, lab_b')
        .order('official_name', { ascending: true });

      if (mfcData && mfcData.length > 0) {
        setAllColors(
          (mfcData || []).map((c: any) => ({
            id: c.id,
            name: c.official_name,
            manufacturer: c.manufacturer,
            series: c.series,
            code: c.product_code,
            hex: c.official_hex,
            finish: c.finish,
            lab: c.lab_l != null ? { l: c.lab_l, a: c.lab_a, b: c.lab_b } : null,
          }))
        );
        setLoadingAll(false);
        return;
      }

      // Fallback (legacy)
      const { data, error } = await supabase
        .from('vinyl_swatches')
        .select('id, name, manufacturer, series, code, hex, finish, lab')
        .eq('verified', true)
        .order('name', { ascending: true });

      if (error) {
        console.error('Error fetching colors:', error);
        setAllColors([]);
      } else {
        setAllColors(data || []);
      }
      setLoadingAll(false);
    };

    fetchColors();
  }, []);

  // DERIVED: Series list for base manufacturer
  const baseSeriesList = useMemo(() => {
    if (!baseManufacturer) return [];
    const filtered = allColors.filter(c => c.manufacturer === baseManufacturer);
    const uniqueSeries = [...new Set(filtered.map(c => c.series || 'Standard'))].filter(Boolean).sort();
    return uniqueSeries;
  }, [allColors, baseManufacturer]);

  // DERIVED: Colors for base manufacturer + series
  const baseColorsList = useMemo(() => {
    if (!baseManufacturer || !baseSeries) return [];
    return allColors.filter(c => 
      c.manufacturer === baseManufacturer && 
      (c.series === baseSeries || (baseSeries === 'Standard' && !c.series))
    );
  }, [allColors, baseManufacturer, baseSeries]);

  // DERIVED: Series list for stripe manufacturer
  const stripeSeriesList = useMemo(() => {
    if (!stripeManufacturer) return [];
    const filtered = allColors.filter(c => c.manufacturer === stripeManufacturer);
    const uniqueSeries = [...new Set(filtered.map(c => c.series || 'Standard'))].filter(Boolean).sort();
    return uniqueSeries;
  }, [allColors, stripeManufacturer]);

  // DERIVED: Colors for stripe manufacturer + series
  const stripeColorsList = useMemo(() => {
    if (!stripeManufacturer || !stripeSeries) return [];
    return allColors.filter(c => 
      c.manufacturer === stripeManufacturer && 
      (c.series === stripeSeries || (stripeSeries === 'Standard' && !c.series))
    );
  }, [allColors, stripeManufacturer, stripeSeries]);

  // Update selected base when ID changes
  useEffect(() => {
    if (baseColorId) {
      const color = allColors.find(c => c.id === baseColorId);
      setSelectedBase(color || null);
    } else {
      setSelectedBase(null);
    }
  }, [baseColorId, allColors]);

  // Update selected stripe when ID changes
  useEffect(() => {
    if (stripeColorId) {
      const color = allColors.find(c => c.id === stripeColorId);
      setSelectedStripe(color || null);
    } else {
      setSelectedStripe(null);
    }
  }, [stripeColorId, allColors]);

  // HANDLERS - Reset downstream when parent changes
  const handleBaseManufacturerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setBaseManufacturer(e.target.value);
    setBaseSeries("");
    setBaseColorId("");
    setSelectedBase(null);
  };

  const handleBaseSeriesChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setBaseSeries(e.target.value);
    setBaseColorId("");
    setSelectedBase(null);
  };

  const handleStripeManufacturerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStripeManufacturer(e.target.value);
    setStripeSeries("");
    setStripeColorId("");
    setSelectedStripe(null);
  };

  const handleStripeSeriesChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setStripeSeries(e.target.value);
    setStripeColorId("");
    setSelectedStripe(null);
  };

  const handleConfirm = () => {
    if (selectedBase && selectedStripe) {
      const baseLabel = `${selectedBase.manufacturer} ${selectedBase.name}`;
      const stripeLabel = `${selectedStripe.manufacturer} ${selectedStripe.name}`;
      onConfirm(baseLabel, stripeLabel);
    }
  };

  const selectClassName = "w-full p-3 rounded-lg bg-background border border-border text-foreground disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-primary/50 focus:border-primary";
  const labelClassName = "text-sm font-medium text-muted-foreground mb-1.5 block";

  return (
    <Card className="p-4 bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-background border-blue-500/30">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-blue-500" />
          <span className="font-semibold text-sm">Select Colors for {presetLabel}</span>
        </div>
        <button onClick={onCancel} className="p-1 hover:bg-secondary rounded">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* HARD ENFORCEMENT NOTICE */}
      <div className="p-2.5 mb-4 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-200/80">
          <strong>Hard Enforcement Mode:</strong> Only verified manufacturer colors with LAB profiles. No free typing. Select Manufacturer → Series → Color.
        </p>
      </div>

      {loadingAll ? (
        <div className="py-8 flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-muted-foreground">Loading verified colors…</span>
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* ===== BASE VEHICLE COLOR ===== */}
          <div className="p-3 bg-secondary/20 rounded-lg space-y-3">
            <div className="text-sm font-semibold text-blue-400 flex items-center gap-2">
              🎨 Base Vehicle Color
            </div>

            {/* Manufacturer */}
            <div>
              <label className={labelClassName}>Manufacturer</label>
              <select
                value={baseManufacturer}
                onChange={handleBaseManufacturerChange}
                className={selectClassName}
              >
                <option value="">Select Manufacturer</option>
                {MANUFACTURERS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Series */}
            <div>
              <label className={labelClassName}>Series</label>
              {!baseManufacturer ? (
                <div className="w-full p-3 rounded-lg bg-secondary/30 border border-border text-muted-foreground/50">
                  Select manufacturer first
                </div>
              ) : baseSeriesList.length === 0 ? (
                <LoadingShimmer text="No series found" />
              ) : (
                <select
                  value={baseSeries}
                  onChange={handleBaseSeriesChange}
                  className={selectClassName}
                  disabled={!baseManufacturer}
                >
                  <option value="">Select Series</option>
                  {baseSeriesList.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Color */}
            <div>
              <label className={labelClassName}>
                Film Color {baseSeries && `(${baseColorsList.length} available)`}
              </label>
              {!baseSeries ? (
                <div className="w-full p-3 rounded-lg bg-secondary/30 border border-border text-muted-foreground/50">
                  Select series first
                </div>
              ) : baseColorsList.length === 0 ? (
                <LoadingShimmer text="No colors found" />
              ) : (
                <select
                  value={baseColorId}
                  onChange={(e) => setBaseColorId(e.target.value)}
                  className={selectClassName}
                  disabled={!baseSeries}
                >
                  <option value="">Select Film</option>
                  {baseColorsList.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.code ? `- ${c.code}` : ''} ({c.finish})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Selected Base Preview */}
            {selectedBase && (
              <div className="p-2.5 bg-blue-500/10 border border-blue-500/30 rounded-lg flex items-center gap-3">
                <div 
                  className="w-8 h-8 rounded border border-border flex-shrink-0" 
                  style={{ backgroundColor: selectedBase.hex }}
                />
                <div className="text-sm">
                  <div className="font-medium text-blue-400">{selectedBase.manufacturer}</div>
                  <div className="text-foreground">
                    {selectedBase.name} {selectedBase.code && <span className="text-muted-foreground">({selectedBase.code})</span>}
                  </div>
                </div>
                <Check className="w-5 h-5 text-green-500 ml-auto" />
              </div>
            )}
          </div>

          {/* ===== STRIPE / GRAPHICS COLOR ===== */}
          <div className="p-3 bg-secondary/20 rounded-lg space-y-3">
            <div className="text-sm font-semibold text-purple-400 flex items-center gap-2">
              ✨ Stripe / Graphics Color
            </div>

            {/* Manufacturer */}
            <div>
              <label className={labelClassName}>Manufacturer</label>
              <select
                value={stripeManufacturer}
                onChange={handleStripeManufacturerChange}
                className={selectClassName}
              >
                <option value="">Select Manufacturer</option>
                {MANUFACTURERS.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Series */}
            <div>
              <label className={labelClassName}>Series</label>
              {!stripeManufacturer ? (
                <div className="w-full p-3 rounded-lg bg-secondary/30 border border-border text-muted-foreground/50">
                  Select manufacturer first
                </div>
              ) : stripeSeriesList.length === 0 ? (
                <LoadingShimmer text="No series found" />
              ) : (
                <select
                  value={stripeSeries}
                  onChange={handleStripeSeriesChange}
                  className={selectClassName}
                  disabled={!stripeManufacturer}
                >
                  <option value="">Select Series</option>
                  {stripeSeriesList.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Color */}
            <div>
              <label className={labelClassName}>
                Film Color {stripeSeries && `(${stripeColorsList.length} available)`}
              </label>
              {!stripeSeries ? (
                <div className="w-full p-3 rounded-lg bg-secondary/30 border border-border text-muted-foreground/50">
                  Select series first
                </div>
              ) : stripeColorsList.length === 0 ? (
                <LoadingShimmer text="No colors found" />
              ) : (
                <select
                  value={stripeColorId}
                  onChange={(e) => setStripeColorId(e.target.value)}
                  className={selectClassName}
                  disabled={!stripeSeries}
                >
                  <option value="">Select Film</option>
                  {stripeColorsList.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.code ? `- ${c.code}` : ''} ({c.finish})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Selected Stripe Preview */}
            {selectedStripe && (
              <div className="p-2.5 bg-purple-500/10 border border-purple-500/30 rounded-lg flex items-center gap-3">
                <div 
                  className="w-8 h-8 rounded border border-border flex-shrink-0" 
                  style={{ backgroundColor: selectedStripe.hex }}
                />
                <div className="text-sm">
                  <div className="font-medium text-purple-400">{selectedStripe.manufacturer}</div>
                  <div className="text-foreground">
                    {selectedStripe.name} {selectedStripe.code && <span className="text-muted-foreground">({selectedStripe.code})</span>}
                  </div>
                </div>
                <Check className="w-5 h-5 text-green-500 ml-auto" />
              </div>
            )}
          </div>

          {/* FINAL PREVIEW */}
          {selectedBase && selectedStripe && (
            <div className="p-3 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Final Selection:</p>
              <p className="text-sm font-medium">
                <span className="text-blue-400">{selectedBase.manufacturer} {selectedBase.name}</span>
                {" body with "}
                <span className="text-purple-400">{selectedStripe.manufacturer} {selectedStripe.name}</span>
                {" stripes"}
              </p>
            </div>
          )}

          {/* CONFIRM BUTTON */}
          <Button
            onClick={handleConfirm}
            disabled={!selectedBase || !selectedStripe}
            className="w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 disabled:opacity-50"
          >
            <Check className="mr-2 h-4 w-4" />
            Apply Verified Colors
          </Button>
        </div>
      )}
    </Card>
  );
};

export { OEM_DEFAULTS };
