import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/* Owner, 2026-09-24: "condense step 1 should say upload and mark wall …
   So 4 steps on same row". */
const src = readFileSync(fileURLToPath(new URL('../../components/wallpro/WallProMagic.tsx', import.meta.url)), 'utf8');

describe('the WallPro magic row', () => {
  it('is four steps, upload, pinning and prompting merged into step 1', () => {
    const titles = [...src.matchAll(/<Step n=\{(\d)\} title="([^"]+)"/g)].map(m => [Number(m[1]), m[2]]);
    expect(titles).toEqual([[1, 'Upload, Pin & Prompt'], [2, '1-Touch Masking'], [3, 'Preview On Your Wall'], [4, 'Your Print-Ready Files']]);
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

describe('the step 4 panel example matches the real planner', () => {
  it('shows 53 + 53 + 16 for the 120-inch wall, as planWallPrint returns', async () => {
    const { planWallPrint, DEFAULT_WALL_PRINT } = await import('../wallpro-print-plan');
    const widths = planWallPrint(120, 96, DEFAULT_WALL_PRINT).panels.map(p => p.width);
    expect(widths).toEqual([53, 53, 16]);
    expect(src).toContain('[53, 53, 16].map(');
  });
});
