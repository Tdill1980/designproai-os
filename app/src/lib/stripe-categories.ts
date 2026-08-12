// Stripe Category Normalization
// All preset categories that should trigger stripe mode and bypass full config

export const STRIPE_CATEGORIES = ['bodylines', 'oem', 'vintage'] as const;

export type StripeCategoryType = typeof STRIPE_CATEGORIES[number];

/**
 * Check if a preset category is a stripe-based preset.
 * Stripe presets:
 * - Bypass multi-zone/body color config
 * - Enable stripe promotion UI
 * - Route to stripe mode in edge function
 */
export function isStripeCategory(category?: string | null): boolean {
  if (!category) return false;
  return STRIPE_CATEGORIES.includes(category as StripeCategoryType);
}

/**
 * Check if a preset (by label, prompt, or category) is stripe-based
 */
export function isStripeBasedPreset(preset: {
  category?: string;
  label?: string;
  prompt?: string;
}): boolean {
  // Category is authoritative
  if (preset.category && isStripeCategory(preset.category)) {
    return true;
  }
  
  // Fallback: keyword detection in label/prompt
  const stripeKeywords = [
    'stripe', 'rally', 'racing', 'hockey', 'bumblebee', 
    'heritage', 'retro', 'fade', 'swoosh', 'sweep'
  ];
  
  const labelLower = (preset.label || '').toLowerCase();
  const promptLower = (preset.prompt || '').toLowerCase();
  
  return stripeKeywords.some(kw => 
    labelLower.includes(kw) || promptLower.includes(kw)
  );
}
