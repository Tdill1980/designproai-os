// Universal Color Extractor Utilities

import { ExtractedColor } from "./color-extractor-types.ts";

/**
 * Fetches HTML content from a URL
 */
export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    }
  });
  
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  
  return await res.text();
}

/**
 * Normalizes color data to standard format
 */
export function normalizeColor(color: Partial<ExtractedColor>, manufacturer: string, sourceUrl: string): ExtractedColor {
  return {
    code: color.code || null,
    name: color.name || null,
    hex: color.hex || null,
    imageUrl: color.imageUrl || null,
    swatchUrl: color.swatchUrl || null,
    series: color.series || null,
    finish: color.finish || detectFinish(color.name || ''),
    colorType: color.colorType || detectColorType(color.name || '', color.finish || ''),
    manufacturer,
    productCode: color.code || null,
    sourceUrl,
  };
}

/**
 * Detects color type from name and finish
 */
export function detectColorType(name: string, finish: string): string {
  const n = name.toLowerCase();
  const f = finish.toLowerCase();
  
  // Check for special types
  if (n.includes('chrome') || f.includes('chrome')) return 'chrome';
  if (n.includes('carbon') || n.includes('fiber')) return 'carbon_fiber';
  if (n.includes('metallic') || n.includes('metal')) return 'metallic';
  if (n.includes('pearl') || n.includes('pearlescent')) return 'pearl';
  if (n.includes('flip') || n.includes('shift') || n.includes('chameleon')) return 'color_shift';
  if (n.includes('brushed')) return 'brushed_metal';
  if (n.includes('wood') || n.includes('grain')) return 'wood_grain';
  if (n.includes('camo') || n.includes('camouflage')) return 'camo';
  if (n.includes('galaxy') || n.includes('sparkle') || n.includes('glitter')) return 'sparkle';
  
  // Default solid colors
  return 'solid';
}

/**
 * Detects finish from color name
 */
export function detectFinish(name: string): string {
  const n = name.toLowerCase();
  
  if (n.includes('gloss') || n.includes('glossy')) return 'Gloss';
  if (n.includes('matte') || n.includes('matt')) return 'Matte';
  if (n.includes('satin')) return 'Satin';
  if (n.includes('chrome')) return 'Chrome';
  if (n.includes('metallic')) return 'Metallic';
  if (n.includes('brushed')) return 'Brushed';
  
  return 'Unknown';
}

/**
 * Stub for saving to Supabase (Phase 4)
 */
export async function saveToSupabase(_colors: ExtractedColor[]): Promise<{ saved: number; skipped: number }> {
  // Phase 4: Real database writes
  return { saved: 0, skipped: 0 };
}
