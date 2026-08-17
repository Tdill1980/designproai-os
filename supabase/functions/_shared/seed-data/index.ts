// Master Vinyl Color Seed Data Index
// All 12 brands with complete color datasets

import { averySW900Colors } from "./avery-sw900.ts";
import { threeM2080Colors } from "./3m-2080.ts";
import { oracalColors } from "./oracal.ts";
import { hexisColors } from "./hexis.ts";
import { inozetekColors } from "./inozetek.ts";
import { kpmfColors } from "./kpmf.ts";
import { 
  arlonColors, 
  teckwrapColors, 
  vvividColors, 
  stekColors, 
  carlasColors, 
  flexishieldColors 
} from "./remaining-brands.ts";

// Color entry type definition
export interface SeedColorEntry {
  manufacturer: string;
  series: string;
  name: string;
  code: string;
  finish: string;
  color_type: string;
  metallic: boolean;
  pearl: boolean;
  chrome: boolean;
  ppf: boolean;
  hex?: string | null;
  media_url: string;
}

// Brand-organized exports
export const brandDatasets: Record<string, SeedColorEntry[]> = {
  "avery": averySW900Colors,
  "3m": threeM2080Colors,
  "oracal": oracalColors,
  "hexis": hexisColors,
  "inozetek": inozetekColors,
  "kpmf": kpmfColors,
  "arlon": arlonColors,
  "teckwrap": teckwrapColors,
  "vvivid": vvividColors,
  "stek": stekColors,
  "carlas": carlasColors,
  "flexishield": flexishieldColors,
};

// Get all colors flattened
export function getAllColors(): SeedColorEntry[] {
  return Object.values(brandDatasets).flat();
}

// Get colors by brand
export function getColorsByBrand(brand: string): SeedColorEntry[] {
  const normalizedBrand = brand.toLowerCase().replace(/\s+/g, "");
  return brandDatasets[normalizedBrand] || [];
}

// Get all supported brands
export function getSupportedBrands(): string[] {
  return Object.keys(brandDatasets);
}

// Get total color count
export function getTotalColorCount(): number {
  return getAllColors().length;
}

// Summary statistics
export function getDatasetStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [brand, colors] of Object.entries(brandDatasets)) {
    stats[brand] = colors.length;
  }
  stats["total"] = getTotalColorCount();
  return stats;
}

export {
  averySW900Colors,
  threeM2080Colors,
  oracalColors,
  hexisColors,
  inozetekColors,
  kpmfColors,
  arlonColors,
  teckwrapColors,
  vvividColors,
  stekColors,
  carlasColors,
  flexishieldColors,
};
