// Hook to fetch vinyl colors from Supabase database
// Supports hierarchical Brand → Series → Finish → Color filtering

import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface VinylSwatch {
  id: string;
  manufacturer: string;
  series: string | null;
  name: string;
  code: string | null;
  finish: string;
  hex: string;
  color_type: string | null;
  metallic: boolean | null;
  pearl: boolean | null;
  chrome: boolean | null;
  ppf: boolean | null;
  media_url: string | null;
  verified: boolean | null;
}

interface UseVinylDatabaseReturn {
  // Data
  manufacturers: string[];
  seriesForManufacturer: string[];
  finishesForSelection: string[];
  colorsForSelection: VinylSwatch[];
  allColors: VinylSwatch[];
  searchResults: VinylSwatch[];
  
  // Loading states
  isLoading: boolean;
  isLoadingColors: boolean;
  
  // Selections
  selectedManufacturer: string;
  selectedSeries: string;
  selectedFinish: string;
  searchQuery: string;
  isSearching: boolean;
  
  // Actions
  setSelectedManufacturer: (manufacturer: string) => void;
  setSelectedSeries: (series: string) => void;
  setSelectedFinish: (finish: string) => void;
  setSearchQuery: (query: string) => void;
  resetSelections: () => void;
  clearSearch: () => void;
  
  // Stats
  totalColorCount: number;
}

export function useVinylDatabase(): UseVinylDatabaseReturn {
  const [allColors, setAllColors] = useState<VinylSwatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [selectedManufacturer, setSelectedManufacturer] = useState("");
  const [selectedSeries, setSelectedSeries] = useState("");
  const [selectedFinish, setSelectedFinish] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch all verified colors on mount (authoritative manufacturer_colors)
  useEffect(() => {
    async function fetchColors() {
      setIsLoading(true);
      try {
        // Include both is_verified=true AND is_verified=NULL rows
        const { data: mfcData, error: mfcError } = await supabase
          .from("manufacturer_colors")
          .select("id, manufacturer, series, product_code, official_name, official_hex, official_swatch_url, finish, is_ppf, is_verified")
          .or('is_verified.eq.true,is_verified.is.null')
          .order("manufacturer", { ascending: true })
          .order("official_name", { ascending: true });

        if (mfcError) {
          console.error("[useVinylDatabase] Error fetching manufacturer_colors:", mfcError);
        }

        if (mfcData && mfcData.length > 0) {
          const mapped = (mfcData as any[]).map((c) => ({
            id: c.id,
            manufacturer: c.manufacturer,
            series: c.series,
            name: c.official_name,
            code: c.product_code,
            finish: c.finish,
            hex: c.official_hex,
            color_type: null,
            metallic: null,
            pearl: null,
            chrome: null,
            ppf: c.is_ppf ?? null,
            media_url: c.official_swatch_url ?? null,
            verified: true,
          })) as VinylSwatch[];

          setAllColors(mapped);
          return;
        }

        // Fallback: legacy table
        const { data, error } = await supabase
          .from("vinyl_swatches")
          .select("*")
          .eq("verified", true)
          .order("manufacturer", { ascending: true })
          .order("name", { ascending: true });

        if (error) {
          console.error("[useVinylDatabase] Error fetching vinyl_swatches:", error);
          return;
        }

        setAllColors((data || []) as VinylSwatch[]);
      } catch (err) {
        console.error("[useVinylDatabase] Unexpected error:", err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchColors();
  }, []);

  // Get unique manufacturers
  const manufacturers = useMemo(() => {
    const uniqueManufacturers = [...new Set(allColors.map(c => c.manufacturer))];
    return uniqueManufacturers.sort();
  }, [allColors]);

  // Get series for selected manufacturer
  const seriesForManufacturer = useMemo(() => {
    if (!selectedManufacturer) return [];
    const filtered = allColors.filter(c => c.manufacturer === selectedManufacturer);
    const uniqueSeries = [...new Set(filtered.map(c => c.series).filter(Boolean))] as string[];
    return uniqueSeries.sort();
  }, [allColors, selectedManufacturer]);

  // Get finishes for selected manufacturer + series
  const finishesForSelection = useMemo(() => {
    let filtered = allColors;
    
    if (selectedManufacturer) {
      filtered = filtered.filter(c => c.manufacturer === selectedManufacturer);
    }
    if (selectedSeries) {
      filtered = filtered.filter(c => c.series === selectedSeries);
    }
    
    const uniqueFinishes = [...new Set(filtered.map(c => c.finish))];
    return uniqueFinishes.sort();
  }, [allColors, selectedManufacturer, selectedSeries]);

  // Get colors for current selection
  const colorsForSelection = useMemo(() => {
    let filtered = allColors;
    
    if (selectedManufacturer) {
      filtered = filtered.filter(c => c.manufacturer === selectedManufacturer);
    }
    if (selectedSeries) {
      filtered = filtered.filter(c => c.series === selectedSeries);
    }
    if (selectedFinish) {
      filtered = filtered.filter(c => c.finish === selectedFinish);
    }
    
    return filtered;
  }, [allColors, selectedManufacturer, selectedSeries, selectedFinish]);

  // Search results - filters across all colors
  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    
    const query = searchQuery.toLowerCase();
    return allColors.filter(c => 
      c.name.toLowerCase().includes(query) ||
      c.manufacturer.toLowerCase().includes(query) ||
      (c.code && c.code.toLowerCase().includes(query)) ||
      (c.series && c.series.toLowerCase().includes(query)) ||
      c.finish.toLowerCase().includes(query)
    ).slice(0, 50); // Limit to 50 results for performance
  }, [allColors, searchQuery]);

  const isSearching = searchQuery.length >= 2;

  // Reset all selections
  const resetSelections = () => {
    setSelectedManufacturer("");
    setSelectedSeries("");
    setSelectedFinish("");
    setSearchQuery("");
  };

  const clearSearch = () => {
    setSearchQuery("");
  };

  // Reset series and finish when manufacturer changes
  useEffect(() => {
    setSelectedSeries("");
    setSelectedFinish("");
  }, [selectedManufacturer]);

  // Reset finish when series changes
  useEffect(() => {
    setSelectedFinish("");
  }, [selectedSeries]);

  return {
    // Data
    manufacturers,
    seriesForManufacturer,
    finishesForSelection,
    colorsForSelection,
    allColors,
    searchResults,
    
    // Loading states
    isLoading,
    isLoadingColors: false,
    
    // Selections
    selectedManufacturer,
    selectedSeries,
    selectedFinish,
    searchQuery,
    isSearching,
    
    // Actions
    setSelectedManufacturer,
    setSelectedSeries,
    setSelectedFinish,
    setSearchQuery,
    resetSelections,
    clearSearch,
    
    // Stats
    totalColorCount: allColors.length,
  };
}
