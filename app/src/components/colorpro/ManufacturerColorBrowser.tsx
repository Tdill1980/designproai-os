import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Search, X, Check, Palette } from "lucide-react";

// NEW: Use manufacturer_colors as the SOLE source of truth
interface ManufacturerColor {
  id: string;
  manufacturer: string;
  series: string | null;
  product_code: string;
  official_name: string;
  official_hex: string;
  official_swatch_url: string | null;
  lab_l: number | null;
  lab_a: number | null;
  lab_b: number | null;
  finish: string;
  is_ppf: boolean;
  is_verified: boolean;
}

// Compatibility interface for existing consumers
export interface VinylSwatch {
  id: string;
  manufacturer: string;
  series: string | null;
  name: string;
  code: string | null;
  finish: string;
  hex: string;
  media_url: string | null;
  ppf: boolean | null;
  metallic: boolean | null;
  pearl: boolean | null;
  chrome: boolean | null;
  // NEW: LAB values for color accuracy
  lab_l?: number | null;
  lab_a?: number | null;
  lab_b?: number | null;
  // Flag indicating this is from the verified manufacturer_colors table
  isOfficialManufacturerColor?: boolean;
}

interface ManufacturerColorBrowserProps {
  selectedSwatch: { id: string; name: string; hex: string; finish?: string } | null;
  onSwatchSelect: (swatch: VinylSwatch) => void;
}

type CategoryType = "color-change" | "ppf";

// Brands shown in the ColorPro Library picker. Others are hidden until their
// official poster swatches are loaded. (Reversible: add a brand back here.)
const VISIBLE_MANUFACTURERS = ["3M", "Avery Dennison"];

// Convert ManufacturerColor to VinylSwatch for compatibility
function convertToVinylSwatch(mc: ManufacturerColor): VinylSwatch {
  return {
    id: mc.id,
    manufacturer: mc.manufacturer,
    series: mc.series,
    name: mc.official_name,
    code: mc.product_code,
    finish: mc.finish,
    hex: mc.official_hex,
    media_url: mc.official_swatch_url,
    ppf: mc.is_ppf,
    metallic: null,
    pearl: null,
    chrome: null,
    lab_l: mc.lab_l,
    lab_a: mc.lab_a,
    lab_b: mc.lab_b,
    isOfficialManufacturerColor: true,
  };
}

export const ManufacturerColorBrowser = ({
  selectedSwatch,
  onSwatchSelect,
}: ManufacturerColorBrowserProps) => {
  const [allColors, setAllColors] = useState<VinylSwatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<CategoryType>("color-change");
  const [selectedManufacturer, setSelectedManufacturer] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualHex, setManualHex] = useState("#");
  const [manualName, setManualName] = useState("");

  // Fetch from manufacturer_colors (authoritative source)
  useEffect(() => {
    const fetchColors = async () => {
      setIsLoading(true);
      setFetchError(null);

      const { data: mfcData, error: mfcError } = await supabase
        .from("manufacturer_colors")
        .select("*")
        .or('is_verified.eq.true,is_verified.is.null')
        .eq('show_in_picker', true)
        .order("manufacturer", { ascending: true })
        .order("official_name", { ascending: true });

      if (mfcError) {
        console.error("❌ Error fetching manufacturer_colors:", mfcError);
        console.error("❌ Error details:", JSON.stringify(mfcError, null, 2));
        console.error("❌ LIKELY CAUSE: RLS policy is blocking reads. Run this SQL in Supabase SQL Editor:");
        console.error(`
-- Run this in External Supabase SQL Editor (kfapjdyythzyvnpdeghu)
DROP POLICY IF EXISTS "Anyone can view verified manufacturer colors" ON public.manufacturer_colors;
CREATE POLICY "Anyone can read manufacturer colors" ON public.manufacturer_colors FOR SELECT USING (true);
        `);
        setFetchError("Database access blocked. Check console for RLS fix instructions.");
      }

      if (mfcData && mfcData.length > 0) {
        setAllColors(
          mfcData
            .map(convertToVinylSwatch)
            .filter((c) => VISIBLE_MANUFACTURERS.includes(c.manufacturer))
        );
        setIsLoading(false);
        return;
      }

      // FALLBACK: Use vinyl_swatches if manufacturer_colors is empty
      const { data, error } = await supabase
        .from("vinyl_swatches")
        .select("*")
        .eq("verified", true)
        .order("manufacturer", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        console.error("Error fetching vinyl swatches:", error);
        setFetchError("Database access blocked. RLS policy needs to be updated.");
      } else if (!data || data.length === 0) {
        setFetchError("No colors found. RLS policy may be blocking reads - check browser console for fix.");
      } else {
        setAllColors((data || [])
          .map(d => ({
            ...d,
            isOfficialManufacturerColor: false,
          }))
          .filter((c) => VISIBLE_MANUFACTURERS.includes(c.manufacturer)));
      }
      setIsLoading(false);
    };

    fetchColors();
  }, []);

  const { colorChangeFilms, ppfFilms } = useMemo(() => {
    const colorChange = allColors.filter((c) => c.ppf !== true);
    const ppf = allColors.filter((c) => c.ppf === true);
    return { colorChangeFilms: colorChange, ppfFilms: ppf };
  }, [allColors]);

  const manufacturers = useMemo(() => {
    const colors = selectedCategory === "color-change" ? colorChangeFilms : ppfFilms;
    const manufacturerCounts = colors.reduce((acc, color) => {
      acc[color.manufacturer] = (acc[color.manufacturer] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(manufacturerCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
  }, [selectedCategory, colorChangeFilms, ppfFilms]);

  const [selectedFinishFilter, setSelectedFinishFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const displayColors = useMemo(() => {
    const colors = selectedCategory === "color-change" ? colorChangeFilms : ppfFilms;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return colors.filter((c) => {
        const matchName = c.name?.toLowerCase().includes(q);
        const matchCode = c.code?.toLowerCase().includes(q);
        const matchMfr = c.manufacturer?.toLowerCase().includes(q);
        const matchFinish = c.finish?.toLowerCase().includes(q);
        return matchName || matchCode || matchMfr || matchFinish;
      });
    }

    if (!selectedManufacturer) return [];
    const mfrColors = colors.filter((c) => c.manufacturer === selectedManufacturer);
    if (selectedFinishFilter) {
      return mfrColors.filter((c) => c.finish.toLowerCase() === selectedFinishFilter.toLowerCase());
    }
    return mfrColors;
  }, [selectedManufacturer, selectedCategory, colorChangeFilms, ppfFilms, selectedFinishFilter, searchQuery]);

  const finishGroups = useMemo(() => {
    if (!selectedManufacturer) return [];
    const colors = selectedCategory === "color-change" ? colorChangeFilms : ppfFilms;
    const mfrColors = colors.filter((c) => c.manufacturer === selectedManufacturer);
    const groups = mfrColors.reduce((acc, c) => {
      const f = c.finish || 'Gloss';
      acc[f] = (acc[f] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const order = ['Gloss', 'Matte', 'Satin', 'Metallic', 'Chrome', 'Brushed'];
    return Object.entries(groups).sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [selectedManufacturer, selectedCategory, colorChangeFilms, ppfFilms]);

  useEffect(() => {
    setSelectedManufacturer(null);
    setSelectedFinishFilter(null);
  }, [selectedCategory]);

  useEffect(() => {
    if (!selectedManufacturer && manufacturers.length > 0) {
      setSelectedManufacturer(manufacturers[0].name);
    }
  }, [manufacturers, selectedManufacturer]);

  useEffect(() => {
    setSelectedFinishFilter(null);
  }, [selectedManufacturer]);

  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0 });
  }, [selectedManufacturer, selectedFinishFilter, searchQuery]);

  const handleImageError = (colorId: string) => {
    setFailedImages(prev => new Set(prev).add(colorId));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden bg-zinc-800 space-y-3">
      {/* Header */}
      <div className="bg-black px-3 pt-3 pb-2 rounded-t-xl flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-white tracking-wide">ColorPro Library™</h3>
        {selectedSwatch && (
          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-[#00C7FF]/15 border border-[#00C7FF]/40">
            <div
              className="w-4 h-4 rounded-full border border-white/40 flex-shrink-0"
              style={{ backgroundColor: selectedSwatch.hex }}
            />
            <span className="text-[11px] font-semibold text-white truncate max-w-[160px]">
              {selectedSwatch.name}
            </span>
            <Check className="w-3 h-3 text-[#00C7FF]" strokeWidth={3} />
          </div>
        )}
      </div>
      <div className="px-3 pb-3 space-y-3 bg-zinc-800">

      {/* Manufacturer Tabs — blue-magenta gradient active */}
      {manufacturers.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {manufacturers.map((mfr) => (
            <button
              key={mfr.name}
              onClick={() => { setManualMode(false); setSelectedManufacturer(mfr.name); setSelectedFinishFilter(null); }}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-[40px] ${
                !manualMode && selectedManufacturer === mfr.name
                  ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                  : "bg-white border border-zinc-200 text-zinc-700 hover:border-zinc-400 active:scale-95"
              }`}
            >
              {mfr.name}
              <span className={`ml-1 text-[10px] font-normal ${
                !manualMode && selectedManufacturer === mfr.name ? "text-white/70" : "text-zinc-400"
              }`}>{mfr.count}</span>
            </button>
          ))}
          <button
            onClick={() => setManualMode(true)}
            className={`px-3 py-2 rounded-lg text-xs font-bold transition-all min-h-[40px] flex items-center gap-1 ${
              manualMode
                ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                : "bg-white border border-zinc-200 text-zinc-700 hover:border-zinc-400 active:scale-95"
            }`}
          >
            <Palette className="w-3 h-3" />
            Manual
          </button>
        </div>
      ) : fetchError ? (
        <div className="text-center py-4 space-y-2">
          <p className="text-amber-500 text-sm font-medium">Database Configuration Issue</p>
          <p className="text-zinc-500 text-xs">{fetchError}</p>
          <p className="text-zinc-500 text-xs">Open browser DevTools (F12) → Console tab for fix instructions</p>
        </div>
      ) : (
        <p className="text-zinc-500 text-center py-4 text-sm">
          No {selectedCategory === "ppf" ? "PPF" : "color change"} films available
        </p>
      )}

      {/* Search Box — below manufacturer tabs */}
      {!manualMode && <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 pointer-events-none" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search colors, codes, manufacturers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-9 py-2 rounded-lg bg-white border border-zinc-200 text-sm text-neutral-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-400 transition-colors"
        />
        {searchQuery && (
          <button
            onClick={() => { setSearchQuery(""); searchInputRef.current?.focus(); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>}

      {/* Manual Entry */}
      {manualMode && (
        <div className="space-y-3 bg-white rounded-lg p-3 border border-zinc-200">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">Color Name</label>
              <input
                type="text"
                placeholder="e.g. Midnight Blue"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-sm text-neutral-900 placeholder:text-zinc-400 focus:outline-none focus:border-blue-400"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 block mb-1">Hex Color</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="#1a2b3c"
                  value={manualHex}
                  onChange={(e) => setManualHex(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-200 text-sm text-neutral-900 font-mono placeholder:text-zinc-400 focus:outline-none focus:border-blue-400"
                />
                {manualHex.length >= 4 && (
                  <div className="w-9 h-9 rounded-lg border border-zinc-200" style={{ backgroundColor: manualHex }} />
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              if (manualName && manualHex.length >= 4) {
                onSwatchSelect({
                  id: `manual-${Date.now()}`,
                  manufacturer: 'Custom',
                  series: null,
                  name: manualName,
                  code: null,
                  finish: 'Gloss',
                  hex: manualHex,
                  media_url: null,
                  ppf: null,
                  metallic: null,
                  pearl: null,
                  chrome: null,
                });
              }
            }}
            disabled={!manualName || manualHex.length < 4}
            className="w-full py-2 rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 text-white text-xs font-bold transition-all disabled:opacity-40"
          >
            <Check className="w-3.5 h-3.5 inline mr-1" />
            Use This Color
          </button>
        </div>
      )}

      {/* Colors Grid — flows in page, no scroll trap */}
      {!manualMode && displayColors.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-500">
              {searchQuery ? `${displayColors.length} results for "${searchQuery}"` : (
                <>
                  {selectedManufacturer} • {displayColors.length} colors
                </>
              )}
              {displayColors[0]?.isOfficialManufacturerColor && (
                <span className="ml-2 text-green-500">✓ Official</span>
              )}
            </p>
            {/* Finish sort within manufacturer */}
            {finishGroups.length > 1 && (
              <div className="flex gap-1 overflow-x-auto scrollbar-none">
                <button
                  onClick={() => setSelectedFinishFilter(null)}
                  className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                    selectedFinishFilter === null
                      ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                      : "text-zinc-500 hover:text-zinc-800"
                  }`}
                >
                  All ({finishGroups.reduce((sum, [, count]) => sum + count, 0)})
                </button>
                {finishGroups.map(([finish, count]) => (
                  <button
                    key={finish}
                    onClick={() => setSelectedFinishFilter(finish)}
                    className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${
                      selectedFinishFilter === finish
                        ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white"
                        : "text-zinc-500 hover:text-zinc-800"
                    }`}
                  >
                    {finish} ({count})
                  </button>
                ))}
              </div>
            )}
          </div>
          <div ref={gridRef} className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {displayColors.map((color) => {
              const isSelected = selectedSwatch?.id === color.id;
              const imageUrl = color.media_url;
              const showFallback = !imageUrl || failedImages.has(color.id);
              const isLightColor = color.hex ? (() => {
                const hex = color.hex.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);
                return (r * 299 + g * 587 + b * 114) / 1000 > 200;
              })() : color.name?.toLowerCase().includes('white');

              return (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => onSwatchSelect(color)}
                  title={`${color.manufacturer} ${color.name} (${color.code})`}
                  className={`swatch-card relative rounded-xl overflow-hidden text-left transition-all duration-200 bg-white active:scale-[0.98] ${
                    isSelected
                      ? "ring-4 ring-[#00C7FF] shadow-lg shadow-[#00C7FF]/30"
                      : "border border-zinc-300 hover:border-zinc-400"
                  }`}
                >
                  {/* Selected badge */}
                  {isSelected && (
                    <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#00C7FF] text-white text-[9px] font-bold shadow-md">
                      <Check className="w-3 h-3" strokeWidth={3} />
                      SELECTED
                    </div>
                  )}

                  {/* Swatch Image — top section */}
                  <div className={`w-full flex items-center justify-center overflow-hidden aspect-[4/3] ${isLightColor ? "bg-zinc-500" : "bg-zinc-200"}`}>
                    {!showFallback ? (
                      <img
                        src={imageUrl}
                        alt={color.name}
                        className="w-full h-full object-cover scale-105"
                        onError={() => handleImageError(color.id)}
                      />
                    ) : color.hex ? (
                      <div
                        className="rounded-lg w-4/5 h-4/5"
                        style={{
                          backgroundColor: color.hex,
                          backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.15) 25%, transparent 50%, rgba(0,0,0,0.1) 75%, rgba(0,0,0,0.2) 100%)',
                        }}
                      />
                    ) : (
                      <div className="w-4/5 h-4/5 rounded-lg bg-zinc-200 flex items-center justify-center">
                        <span className="text-[9px] text-zinc-600 text-center px-1">{color.name}</span>
                      </div>
                    )}
                  </div>
                  {/* Info — bottom white card section: finish → name → code */}
                  <div className="px-2 py-1.5 bg-white">
                    <p className="text-[8px] font-bold uppercase tracking-[0.08em] leading-none bg-gradient-to-r from-blue-500 to-purple-600 bg-clip-text text-transparent">
                      {color.finish}
                    </p>
                    <p className="font-bold text-black uppercase leading-tight tracking-wide text-[10px] line-clamp-2 min-h-[1.25rem] mt-0.5">
                      {color.name}
                    </p>
                    {color.code && (
                      <p className="text-zinc-400 font-mono mt-0.5 font-medium text-[9px] leading-none">
                        {color.code}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

    </div>
    </div>
  );
};
