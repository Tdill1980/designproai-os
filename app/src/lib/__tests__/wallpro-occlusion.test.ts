import { describe, expect, it } from 'vitest';
import { splitDetectedMasks } from '../wallpro-occlusion';
import type { DetectedMask } from '../wallpro-masks';

const box = { x0: 0, y0: 0, x1: 0.1, y1: 0.1 };
const mask = (label: string, cls?: 'fixed' | 'movable'): DetectedMask => ({ label, box, png: 'data:image/png;base64,x', class: cls });

describe('splitDetectedMasks — the fixed/movable occlusion policy', () => {
  it('separates fixed (protected) from movable (removed) items', () => {
    const { fixed, movable } = splitDetectedMasks([mask('window', 'fixed'), mask('exercise bike', 'movable'), mask('mirror', 'fixed')]);
    expect(fixed.map(m => m.label)).toEqual(['window', 'mirror']);
    expect(movable.map(m => m.label)).toEqual(['exercise bike']);
  });
  it('defaults an item with no class -- legacy or unclassified data -- to fixed', () => {
    const { fixed, movable } = splitDetectedMasks([mask('unlabelled item')]);
    expect(fixed.map(m => m.label)).toEqual(['unlabelled item']);
    expect(movable).toEqual([]);
  });
  it('is empty in, empty out', () => {
    expect(splitDetectedMasks([])).toEqual({ fixed: [], movable: [] });
  });
});
