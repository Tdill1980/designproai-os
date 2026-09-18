import type { PatternBrandKey } from './patternpro-brand';

/** The hero is the driver side. Missing angles stay missing, never relabelled. */
export function patternProofViews(hero: string | null, views: Record<string, string> | null) {
  const source: Record<string, string> = { ...views, side: views?.side || hero || '' };
  return [
    ['side', 'Driver Side'], ['passenger-side', 'Passenger Side'],
    ['front', 'Front'], ['rear', 'Rear'], ['hood_detail', 'Hood'],
    ['close-up', 'Close-Up'], ['roof', 'Roof'],
  ].flatMap(([type, label]) => {
    const url = source[type] || (type === 'close-up' ? views?.closeup : undefined);
    return url ? [{ type, label, url }] : [];
  });
}

export function designProofBrand(brand: PatternBrandKey, tool: 'patternpro' | 'wallpro' = 'patternpro') {
  const name = tool === 'wallpro' ? 'WallPro' : 'PatternPro';
  return brand === 'weprintwraps'
    ? { title: `WPW × ${name}`, footer: '® DesignProAI Software for WePrintWraps' }
    : { title: name, footer: '® DesignProAI Software' };
}
