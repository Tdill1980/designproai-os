import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { wallMaskKey } from '../wallpro-masks';

const page = () => readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');
const render = () => readFileSync(fileURLToPath(new URL('../wallpro-render.ts', import.meta.url)), 'utf8');

/**
 * THE DEFECT THIS FILE EXISTS FOR (owner, 2026-09-24, on her own wall):
 * "i drew a mask on inside of closet yet still wrapped", then "I masked the
 * inside it should nothave wrapped that".
 *
 * The mask was correct and saved -- her project carried the closet rectangle
 * verbatim. It was never SENT, because the AI room view is cached and its
 * currency test compared the artwork, the photo and the scale and nothing
 * else. The view auto-paints the moment a design lands, which is before any
 * mask can exist; marking afterwards left a view that was still "current", so
 * it never repainted and the button went on reading "On your wall".
 *
 * Every one of these cases was verified to fail against the pre-fix tree.
 */
describe('a protected area a customer marks reaches the render', () => {
  it('changes the mask identity when a polygon is added', () => {
    const closet = [{ x: 0.3, y: 0.25 }, { x: 0.53, y: 0.25 }, { x: 0.53, y: 0.87 }, { x: 0.3, y: 0.87 }];
    expect(wallMaskKey([], null, null)).not.toBe(wallMaskKey([closet], null, null));
  });

  it('changes when a polygon MOVES, not merely when one is added', () => {
    const a = [{ x: 0.3, y: 0.25 }, { x: 0.53, y: 0.25 }, { x: 0.53, y: 0.87 }];
    const b = [{ x: 0.31, y: 0.25 }, { x: 0.53, y: 0.25 }, { x: 0.53, y: 0.87 }];
    expect(wallMaskKey([a], null, null)).not.toBe(wallMaskKey([b], null, null));
  });

  it('separates the protected mask from the remove mask', () => {
    expect(wallMaskKey([], 'a/protect.png', null)).not.toBe(wallMaskKey([], null, 'a/protect.png'));
  });

  // A re-signed url must not invalidate a good view: signing happens on every
  // reopen, and a spurious repaint is a ~30s image call the customer did not ask
  // for. The stored path is the stable identity.
  it('is stable for the same stored masks', () => {
    const poly = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.9 }];
    expect(wallMaskKey([poly], 'own/m.png', 'own/r.png')).toBe(wallMaskKey([poly], 'own/m.png', 'own/r.png'));
  });

  // Mirrors buildProtectedAreaMask, which skips a polygon under three points.
  // A scribble that paints nothing may not cost a render.
  it('ignores a polygon that could never paint anything', () => {
    expect(wallMaskKey([[{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }]], null, null)).toBe(wallMaskKey([], null, null));
  });

  // ⚠️ THE TWO SITES THAT ACTUALLY DECIDE IT. A key nothing consults is a key
  // that fixes nothing, and both of these read as ordinary lines of code.
  it('is consulted by the view-currency test', () => {
    expect(page()).toContain('aiView.forMask === maskKey');
  });

  it('is in the auto-paint dependency array, so marking repaints', () => {
    expect(page()).toContain("}, [tileArtwork?.url, photo?.url, aiAvailable, seamReady, maskKey]);");
  });

  it('is recorded on the view it produced', () => {
    expect(page()).toContain('forMask: maskKey');
  });
});

/**
 * Owner, same hour: "I clearly marked it correctly yet on step two doesnt show
 * that." The step-2 tile drew the wall quad and nothing else, so it showed no
 * closet while its own caption read "1 protected". A tile that contradicts its
 * caption is worse than no tile.
 */
describe('the step-2 tile shows what she marked', () => {
  it('takes the exclusions, not only the corners', () => {
    expect(render()).toContain('export async function renderCornerThumb(photoUrl: string, corners: Point[], exclusions: Point[][] = [], maxPx = 480)');
  });

  it('draws them', () => {
    const src = render().slice(render().indexOf('export async function renderCornerThumb'));
    expect(src).toContain('for (const poly of exclusions)');
  });

  it('re-renders when a protected area changes', () => {
    expect(page()).toContain("JSON.stringify(corners) + '|' + JSON.stringify(exclusions)");
    expect(page()).toContain('renderCornerThumb(photo.url, corners, exclusions)');
  });
});
