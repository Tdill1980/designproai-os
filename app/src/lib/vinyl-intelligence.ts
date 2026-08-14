// --- RestyleProAI VINYL ENGINE ---
import { supabase } from "@/integrations/supabase/client";

export interface VinylSwatch {
  id: string;
  manufacturer: string;
  series?: string;
  name: string;
  code?: string;
  finish: string;
  material_type?: string;
  hex: string;
  metallic: boolean;
  flake_level?: string;
  pearl: boolean;
  chrome: boolean;
  ppf: boolean;
  media_url?: string;
  media_type?: string;
  ai_confidence?: number;
  verified: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export const saveToVinylSwatches = async (swatchData: Partial<VinylSwatch>) => {
  const { data: { user } } = await supabase.auth.getUser();
  
  const insertData: any = {
    manufacturer: swatchData.manufacturer,
    series: swatchData.series,
    name: swatchData.name,
    code: swatchData.code,
    finish: swatchData.finish,
    material_type: swatchData.material_type,
    hex: swatchData.hex,
    metallic: swatchData.metallic,
    flake_level: swatchData.flake_level,
    pearl: swatchData.pearl,
    chrome: swatchData.chrome,
    ppf: swatchData.ppf,
    media_url: swatchData.media_url,
    media_type: swatchData.media_type,
    ai_confidence: swatchData.ai_confidence,
    verified: true,
    created_by: user?.id
  };
  
  const { data, error } = await supabase
    .from('vinyl_swatches')
    .insert(insertData)
    .select()
    .single();
  
  if (error) throw error;
  return data as VinylSwatch;
};

export const loadAllVinylSwatches = async () => {
  // PRIORITY: Load from manufacturer_colors (authoritative source)
  // Include both is_verified=true AND is_verified=NULL rows
  const { data: mfcData, error: mfcError } = await supabase
    .from('manufacturer_colors')
    .select('*')
    .or('is_verified.eq.true,is_verified.is.null')
    .order('manufacturer', { ascending: true });
  
  if (mfcError) {
    console.error("❌ vinyl-intelligence: Error fetching manufacturer_colors:", mfcError);
    console.error("❌ LIKELY FIX: Run RLS policy SQL in External Supabase SQL Editor");
  }

  if (mfcData && mfcData.length > 0) {
    console.log(`✅ Loaded ${mfcData.length} colors from manufacturer_colors`);
    // Convert manufacturer_colors to VinylSwatch format
    return mfcData.map(mc => ({
      id: mc.id,
      manufacturer: mc.manufacturer,
      series: mc.series,
      name: mc.official_name,
      code: mc.product_code,
      finish: mc.finish,
      hex: mc.official_hex,
      metallic: false,
      pearl: false,
      chrome: mc.finish?.toLowerCase().includes('chrome') || false,
      ppf: mc.is_ppf || false,
      media_url: mc.official_swatch_url,
      verified: true,
      created_at: mc.created_at,
      updated_at: mc.updated_at,
    })) as VinylSwatch[];
  }
  
  // FALLBACK: vinyl_swatches if manufacturer_colors empty
  console.warn('⚠️ manufacturer_colors empty, using vinyl_swatches fallback');
  const { data, error } = await supabase
    .from('vinyl_swatches')
    .select('*')
    .eq('verified', true)
    .order('manufacturer', { ascending: true });
  
  if (error) throw error;
  return data as VinylSwatch[];
};

export const convertVinylSwatchToInkFusionColor = (swatch: VinylSwatch) => {
  return {
    id: swatch.id,
    name: swatch.name,
    hex: swatch.hex,
    finish: swatch.finish as 'Gloss' | 'Satin' | 'Matte',
    family: 'Neutral' as const,
    colorLibrary: 'verified_vinyl' as const,
    manufacturer: swatch.manufacturer,
    productCode: swatch.code,
    series: swatch.series,
    patternType: swatch.chrome ? 'chrome' : swatch.metallic ? 'metallic' : 'solid',
    hasMetallicFlakes: swatch.metallic,
    flakeLevel: swatch.flake_level,
    hasPearl: swatch.pearl,
    isChrome: swatch.chrome,
    isPPF: swatch.ppf,
    swatchImageUrl: swatch.media_url,
    aiConfidence: swatch.ai_confidence,
    verified: swatch.verified
  };
};
// --- END VINYL ENGINE ---
