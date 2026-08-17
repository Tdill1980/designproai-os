// Universal Color Extractor Type Definitions

export interface ExtractedColor {
  code: string | null;
  name: string | null;
  hex: string | null;
  imageUrl: string | null;
  swatchUrl: string | null;
  series: string | null;
  finish: string | null;
  colorType: string | null;
  manufacturer: string;
  productCode: string | null;
  sourceUrl: string;
}

export interface BrandOverride {
  parse: ($: any, sourceUrl: string) => Promise<ExtractedColor[]>;
  baseUrl?: string;
  colorListUrls?: string[];
}

export interface ExtractionResult {
  brand: string;
  extracted: number;
  rawColors: ExtractedColor[];
  message: string;
  errors?: string[];
}
