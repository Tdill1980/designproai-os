/**
 * ColorPro OS Film Registry Types
 * 
 * These types define the immutable film catalog structure.
 * Data comes ONLY from official manufacturer posters - never AI-generated.
 */

export type ManufacturerKey = 'avery' | '3m' | 'hexis' | 'kpmf' | 'inozetek' | 'teckwrap' | 'vvivid';
export type FinishType = 'gloss' | 'satin' | 'matte' | 'chrome' | 'texture';

/**
 * Single film color entry from official manufacturer catalog
 */
export interface FilmColor {
  /** Official product code (e.g., "SW900-190-O", "G12") - CANONICAL IDENTIFIER */
  product_code: string;
  /** Official name from manufacturer chart (display only, never for prompts) */
  official_name: string;
  /** Category from poster (e.g., "Gloss", "Satin Metallic", "ColorFlow") */
  category: string;
  /** Finish type for texture rendering */
  finish: FinishType;
  /** Has metallic flake/particles */
  metallic: boolean;
  /** Has pearl/iridescent effect */
  pearl: boolean;
  /** Is chrome/mirror finish */
  chrome: boolean;
}

/**
 * Complete film registry for one manufacturer series
 * This is the source of truth - database syncs FROM this, not the other way around
 */
export interface FilmRegistry {
  /** Normalized manufacturer key (lowercase) */
  manufacturer: ManufacturerKey;
  /** Product series (e.g., "sw900", "2080") */
  series: string;
  /** Registry version (YYYY-MM format from poster date) */
  version: string;
  /** Source PDF filename for audit trail */
  source_file: string;
  /** All colors in this series */
  colors: FilmColor[];
}

/**
 * Film selection payload for render requests
 * Only canonical identifiers - no names, no hex, no guessing
 */
export interface FilmSelection {
  manufacturer: ManufacturerKey;
  series: string;
  product_code: string;
}

// ============================================
// OS TYPE GUARDS & VALIDATORS
// ============================================

const AVERY_CODE_PATTERN = /^(SW900-\d{3,4}-[OMSXD]|SF100-\d{3}-S)$/;
const THREE_M_CODE_PATTERN = /^(G|S|M|DM|BR|CF|SP|GP|GC)\d{1,3}$/;

/**
 * Validate product code format for a manufacturer
 * OS invariant: only properly formatted codes are accepted
 */
export function isValidProductCode(code: string, manufacturer: ManufacturerKey): boolean {
  switch (manufacturer) {
    case 'avery':
      return AVERY_CODE_PATTERN.test(code);
    case '3m':
      return THREE_M_CODE_PATTERN.test(code);
    default:
      // Other manufacturers - basic validation
      return code.length >= 2 && code.length <= 20;
  }
}

/**
 * Assert film selection has all required canonical identifiers
 * Throws if invalid - use at render request boundary
 */
export function assertValidFilmSelection(selection: unknown): asserts selection is FilmSelection {
  if (!selection || typeof selection !== 'object') {
    throw new Error('OS: Film selection must be an object');
  }
  
  const sel = selection as Record<string, unknown>;
  
  if (typeof sel.manufacturer !== 'string' || !sel.manufacturer) {
    throw new Error('OS: manufacturer is required');
  }
  
  if (typeof sel.series !== 'string' || !sel.series) {
    throw new Error('OS: series is required');
  }
  
  if (typeof sel.product_code !== 'string' || !sel.product_code) {
    throw new Error('OS: product_code is required');
  }
}

/**
 * Build display label from film data (for UI only, never for prompts)
 */
export function buildFilmDisplayLabel(
  manufacturer: string,
  series: string,
  product_code: string,
  official_name: string
): string {
  return `${manufacturer.toUpperCase()} ${series.toUpperCase()} ${product_code} - ${official_name}`;
}

/**
 * Normalize manufacturer name to key
 */
export function normalizeManufacturer(name: string): ManufacturerKey {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  
  if (normalized.includes('avery')) return 'avery';
  if (normalized.includes('3m') || normalized === 'threeem') return '3m';
  if (normalized.includes('hexis')) return 'hexis';
  if (normalized.includes('kpmf')) return 'kpmf';
  if (normalized.includes('inozetek')) return 'inozetek';
  if (normalized.includes('teckwrap')) return 'teckwrap';
  if (normalized.includes('vvivid')) return 'vvivid';
  
  throw new Error(`OS: Unknown manufacturer "${name}"`);
}
