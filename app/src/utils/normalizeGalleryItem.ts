/**
 * Gallery Item Normalization Utility
 * 
 * This file provides a single source of truth for normalizing gallery items
 * from different sources (carousels, design tables, render tables) into a 
 * consistent format for display.
 */

export interface NormalizedGalleryItem {
  id: string;
  heroUrl: string;
  beforeUrl?: string;
  title: string;
  subtitle: string;
  vehicleName: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  colorName: string;
  patternName: string;
  category: string;
  productType: string;
  createdAt: string;
  has360Spin: boolean;
  spinViewCount: number;
  renderUrls: Record<string, any>;
  finishType?: string;
  colorHex?: string;
  manufacturer?: string;
  modeType?: string;
}

/**
 * Extract the best hero URL from render_urls object
 * Default priority: hero > front > hood_detail > side > rear > top > first available
 * DesignProAI priority: side > hero (side is the original branded render with logos/text)
 */
export function extractHeroUrl(renderUrls: Record<string, any> | null | undefined, modeType?: string): string {
  if (!renderUrls) return '';

  // DesignProAI: prefer side (original branded render with logos/text)
  const isDesignPro = modeType === 'designpanelpro' || modeType === 'designpro';
  const priorities = isDesignPro
    ? ['side', 'roof', 'front', 'hood_detail', 'rear', 'top']
    : ['roof', 'front', 'hood_detail', 'side', 'rear', 'top'];

  for (const key of priorities) {
    if (renderUrls[key] && typeof renderUrls[key] === 'string' && renderUrls[key].startsWith('http')) {
      return renderUrls[key];
    }
  }

  // Fallback: find first valid URL (excluding spin_views)
  for (const [key, value] of Object.entries(renderUrls)) {
    if (key !== 'spin_views' && typeof value === 'string' && value.startsWith('http')) {
      return value;
    }
  }

  return '';
}

/**
 * Extract spin frames from render_urls if available
 */
export function extractSpinFrames(renderUrls: Record<string, any> | null | undefined): string[] {
  if (!renderUrls?.spin_views) return [];
  
  const spinViews = renderUrls.spin_views;
  if (typeof spinViews === 'object' && !Array.isArray(spinViews)) {
    return Object.values(spinViews).filter((v): v is string => typeof v === 'string');
  }
  
  if (Array.isArray(spinViews)) {
    return spinViews.filter((v): v is string => typeof v === 'string');
  }
  
  return [];
}

/**
 * Normalize product type to consistent format
 */
export function normalizeProductType(productType: string | undefined): string {
  if (!productType) return 'unknown';
  
  const type = productType.toLowerCase();
  
  // Map legacy/variant names to canonical names
  const mapping: Record<string, string> = {
    'inkfusion': 'colorpro',
    'infusion': 'colorpro',
    'wbty': 'wbty',
    'patternpro': 'wbty',
    'designpanelpro': 'designpanelpro',
    'panelpro': 'designpanelpro',
    'approvemode': 'approvemode',
    'approvepro': 'approvemode',
    'fadewraps': 'fadewraps',
    'colorpro': 'colorpro',
  };
  
  return mapping[type] || type;
}

/**
 * Get display name for product type
 */
export function getProductDisplayName(productType: string): string {
  const normalized = normalizeProductType(productType);
  
  const names: Record<string, string> = {
    'colorpro': 'ColorPro™',
    'wbty': 'PatternPro™',
    'designpanelpro': 'DesignProAI™',
    'approvemode': 'ApprovePro™',
    'fadewraps': 'FadeWraps™',
  };
  
  return names[normalized] || productType;
}

/**
 * Get route for product type
 */
export function getProductRoute(productType: string): string {
  const normalized = normalizeProductType(productType);
  
  const routes: Record<string, string> = {
    'colorpro': '/colorpro',
    'wbty': '/wbty',
    'designpanelpro': '/designpanelpro',
    'approvemode': '/approvemode',
    'fadewraps': '/fadewraps',
  };
  
  return routes[normalized] || '/';
}

/**
 * Extract best title from item data
 */
export function extractTitle(item: Record<string, any>): string {
  // First try explicit title
  if (item.title && item.title !== 'Untitled') {
    return item.title;
  }
  
  // Try vehicle info
  const year = item.vehicle_year || '';
  const make = item.vehicle_make || '';
  const model = item.vehicle_model || '';
  
  if (make && model) {
    return `${year} ${make} ${model}`.trim();
  }
  
  // Try color/pattern names
  return item.color_name || item.pattern_name || item.fade_name || 'Untitled Design';
}

/**
 * Normalize timestamp to consistent format
 */
export function normalizeTimestamp(item: Record<string, any>): string {
  return item.created_at || item.inserted_at || item.timestamp || new Date().toISOString();
}
