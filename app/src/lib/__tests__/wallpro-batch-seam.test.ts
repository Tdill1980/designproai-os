import { describe, expect, it } from 'vitest';
import { batchSeamDecision, designUpsertRow, type WallPromptEntry } from '../wallpro-catalog';
import { measureSeam, blendSeamless } from '../wallpro-seamless';
import library from '@/data/wallpro-prompt-library.json';

const LIB = library as WallPromptEntry[];
const clean = { width: 64, height: 64, edge: 1, interior: 1, ratio: 1, seamless: true };
const hard = { ...clean, edge: 40, interior: 2, ratio: 20, seamless: false };

describe('WallPro batch seam ladder — verified, then blend, then mirror', () => {
  it('publishes a tile that measures seamless as generated', () => {
    expect(batchSeamDecision(clean, null)).toMatchObject({ method: 'verified', verified: true, after: null });
  });
  it('closes a hard seam by blend when the blend measures clean, keeping motifs upright', () => {
    const d = batchSeamDecision(hard, { ...clean, ratio: 1.2 });
    expect(d).toMatchObject({ method: 'blend', verified: true });
    expect(d.after?.ratio).toBe(1.2);
  });
  it('falls back to mirror only when the blend still does not measure clean', () => {
    expect(batchSeamDecision(hard, { ...hard, ratio: 4 })).toMatchObject({ method: 'mirror', verified: true, after: null });
    expect(batchSeamDecision(hard, null)).toMatchObject({ method: 'mirror' });
  });
  it('the real blend closes a real hard seam on a synthetic tile', () => {
    // A smooth left-to-right gradient: continuous inside, a hard black|white
    // step at the wrap-around join — the shape of a real AI tile whose edges
    // simply do not meet.
    const w = 64, h = 64, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, v = Math.round(x / (w - 1) * 255); data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
    const before = measureSeam(data, w, h);
    expect(before.seamless).toBe(false);
    const after = measureSeam(blendSeamless(data, w, h), w, h);
    expect(after.ratio).toBeLessThan(before.ratio);
    expect(after.seamless).toBe(true);
    expect(batchSeamDecision(before, after).method).toBe('blend');
  });
  it('every ladder outcome satisfies the publish gate for a repeat', () => {
    const pattern = LIB.find(e => e.designType === 'Seamless Repeat Pattern')!;
    const base = { entry: pattern, mode: 'repeat' as const, generationId: '22222222-2222-4222-8222-222222222222', promptHash: 'a'.repeat(64), masterPath: 'catalog/33333333-3333-4333-8333-333333333333.png', masterSha256: 'a'.repeat(64), widthPx: 4096, heightPx: 4096, createdBy: '11111111-1111-4111-8111-111111111111' };
    for (const seam of [batchSeamDecision(clean, null), batchSeamDecision(hard, { ...clean, ratio: 1.2 }), batchSeamDecision(hard, null)]) expect(() => designUpsertRow({ ...base, seam })).not.toThrow();
  });
});
