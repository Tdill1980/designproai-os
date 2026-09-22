/**
 * A BOX IS AN ANSWER. THE SYSTEM USED TO HAVE NO MIDDLE STATE.
 *
 * Owner, 2026-09-22, with a photograph of WallPro showing three labelled
 * rectangles over the drapes, the window and the doorway: "It should be doing
 * this." She had already reported, three separate times, that masking was not
 * working: "Also it's not doing the one touch masking", "How do you mask the
 * closet? It's not masking".
 *
 * ── WHAT WAS ACTUALLY WRONG ───────────────────────────────────────────────
 *
 * Nothing in the client. The detector runs on EVERY upload
 * (`detectInBackground(asset, true)`), the items are passed to the editor
 * (`items={items}`), and the editor draws each one as a tappable labelled
 * rectangle from `item.box` — which is exactly the picture she sent.
 *
 * The loss was one `continue` in the edge handler. `detect-wall-openings` asks
 * Gemini for a label, a box, a class AND a grayscale mask PNG per object, and
 * `normalizeMasks` dropped the ENTIRE item when that PNG was missing,
 * malformed, or over 2 MB. So a model that located the window exactly and
 * fumbled only its mask returned zero protected areas, and the page honestly
 * reported that nothing was found.
 *
 * The mask channel is the flaky one, and the deployed function's own comment
 * says so in as many words: "every thinking-on call today answered 0 masks"
 * — a `thinkingBudget: 0` workaround shipped on 2026-09-12 for that exact
 * symptom. The architecture had two states, a pixel-perfect outline or
 * nothing, and the owner's screenshot is the middle one.
 *
 * ── THE HONEST COST, STATED RATHER THAN HIDDEN ────────────────────────────
 *
 * A rectangle around "window with drapes" covers the wall beside it too. That
 * is the 2026-09-11 complaint that retired coarse polygons in the first place
 * ("it's way over and masking wall and items"). Three things make it the right
 * trade anyway, and all three are asserted here:
 *
 *  1. masks are PREVIEW-ONLY — print panels stay full rectangles — so the cost
 *     is preview fidelity, never a print file;
 *  2. the box is drawn differently and announced differently, so she can see
 *     it is coarse;
 *  3. one tap paints it through. An item nobody can see is an item nobody can
 *     correct, which is what "dropped it" really meant.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeMasks } from '../../../../supabase/functions/detect-wall-openings/handler';
import { toWallItems, splitItems } from '../wallpro-items';

const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const masksLib = source('../wallpro-masks.ts');
const editor = source('../../components/wallpro/WallPhotoEditor.tsx');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWk1v8QAAAABJRU5ErkJggg==';

describe('the edge keeps an object it located but could not outline', () => {
  it('survives a missing mask, a non-PNG mask and an oversized mask', () => {
    const out = normalizeMasks([
      { box_2d: [250, 400, 700, 600], mask: png, label: 'window', class: 'fixed' },
      { box_2d: [100, 100, 300, 300], label: 'no mask at all', class: 'fixed' },
      { box_2d: [100, 100, 300, 300], mask: 'not a data url', label: 'bad mask', class: 'fixed' },
      { box_2d: [0, 0, 500, 500], mask: 'data:image/png;base64,' + 'A'.repeat(2_000_001), label: 'huge mask' },
    ]);
    expect(out.map(m => m.label)).toEqual(['window', 'no mask at all', 'bad mask', 'huge mask']);
    expect(out.map(m => m.png === null)).toEqual([false, true, true, true]);
  });

  it('still drops an item with no usable BOX, because the rectangle IS the fallback', () => {
    expect(normalizeMasks([
      { mask: png, label: 'no box' },
      { box_2d: [1, 2, 3], mask: png, label: 'short box' },
      { box_2d: ['a', 1, 2, 3], mask: png, label: 'non-numeric box' },
      { box_2d: [10, 10, 12, 12], mask: png, label: 'speck below the size floor' },
    ])).toEqual([]);
  });

  it('keeps the fixed/movable classification on a box-only item', () => {
    // Otherwise the coarse fallback would silently protect an exercise bike
    // the detector correctly said to paint through.
    const out = normalizeMasks([
      { box_2d: [100, 100, 300, 300], label: 'bike', class: 'movable' },
      { box_2d: [100, 100, 300, 300], label: 'window' },
    ]);
    expect(out.map(m => m.class)).toEqual(['movable', 'fixed']);
    const { fixed, movable } = splitItems(toWallItems(out));
    expect(fixed.map(i => i.label)).toEqual(['window']);
    expect(movable.map(i => i.label)).toEqual(['bike']);
  });

  it('reports box-only separately, because "found nothing" and "could not outline it" need different fixes', () => {
    const handler = source('../../../../supabase/functions/detect-wall-openings/handler.ts');
    expect(handler).toContain("event: 'wall_segmentation_box_only'");
    expect(handler).toContain('outlined: masks.filter(m => !!m.png).length');
  });
});

describe('the client fills a box-only item as its rectangle', () => {
  it('no longer skips an item whose mask will not load', () => {
    // The `continue` in this loop was the client's own copy of the same bug:
    // an unreadable PNG lost the object rather than falling back to its box.
    expect(masksLib).toContain('if (!img) { fill(left, top, w, h); continue; }');
    expect(masksLib).not.toContain('try { img = await loadImage(mask.png); } catch { continue; }');
  });

  it('accepts a nullable mask in the type, so the fallback cannot be typed away', () => {
    expect(masksLib).toContain('png: string | null');
  });
});

describe('a coarse answer is shown as a coarse answer', () => {
  it('draws a box-only item with its own dash rather than passing it off as an outline', () => {
    expect(editor).toContain("strokeDasharray={!kept ? '1.4 1' : item.png ? undefined : '2.4 1.2'}");
  });

  it('says so to a screen reader too', () => {
    expect(editor).toContain("as a rectangle rather than its exact outline");
  });

  it('is still one tap to reject — which is the whole reason showing it beats dropping it', () => {
    expect(editor).toContain('p.onToggleItem(item.id)');
    expect(editor).toContain('aria-pressed={kept}');
  });
});
