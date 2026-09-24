import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* Owner, 2026-09-24: "condense step 1 should say upload and mark wall …
   So 4 steps on same row". */
const src = readFileSync(fileURLToPath(new URL('../../components/wallpro/WallProMagic.tsx', import.meta.url)), 'utf8');

describe('the WallPro magic row', () => {
  it('is four steps, upload and marking merged into step 1', () => {
    const titles = [...src.matchAll(/<Step n=\{(\d)\} title="([^"]+)"/g)].map(m => [Number(m[1]), m[2]]);
    expect(titles).toEqual([[1, 'Upload & Mark Wall'], [2, '1-Touch Masking'], [3, 'Preview On Your Wall'], [4, 'Print-Ready Panels']]);
  });
  it('sits on one row on desktop, with an arrow between each step', () => {
    expect(src).toContain('lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]');
    expect((src.match(/<Arrow \/>/g) || []).length).toBe(3);
  });
  it('uses the supplied full-size room photos and the flat artwork for panels', () => {
    expect(src).toContain('/wallpro/studio-original.jpg');
    expect(src).toContain('/wallpro/studio-floral-preview.jpg');
    expect(src).toContain('/wallpro/case-studio-artwork.jpg');
  });
});
