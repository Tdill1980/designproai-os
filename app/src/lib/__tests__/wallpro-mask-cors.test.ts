/**
 * "THE OPERATION IS INSECURE." (owner, Trish 2026-09-23, from her phone.)
 *
 * That red line sat directly above Generate on the live site, and it was not a
 * copy problem — it is Safari's wording for a DOM SecurityError, and the cause
 * was one missing attribute.
 *
 * A detected protected area arrives as a SIGNED SUPABASE URL, which is a
 * different origin from os.designproai.com. `wallpro-masks.ts` loaded it with
 * a bare `new Image()`, drew it into a canvas, and then called `getImageData`.
 * An image loaded without `crossOrigin` TAINTS the canvas, and every readback
 * from a tainted canvas throws. This file is the one place in the WallPro path
 * that reads pixels back, so the single loader that had to be CORS-clean was
 * the only one that was not.
 *
 * ⚠️ THE SIBLING HAD IT RIGHT ALL ALONG. `loadWallImage` in
 * `wallpro-render.ts` — the module that imports `maskFlags` FROM this one —
 * sets `crossOrigin` and loads from the same bucket, so the header was already
 * proven against this storage. The masks loader simply never got it. Two
 * loaders one file apart, and the unguarded one was the one doing the reading.
 *
 * ⚠️ AND THE EXISTING try/catch GUARDS COULD NOT HAVE CAUGHT IT. Two
 * `try { await loadImage(...) } catch` blocks already wrap the load. The taint
 * does not throw on load — the image loads perfectly — it throws on the
 * READBACK, which was unguarded. Catching the wrong half of an operation reads
 * as defensive code and defends nothing.
 *
 * Source assertions: reproducing a cross-origin taint needs a real browser
 * with a real remote image, which jsdom is not. What can be checked exactly is
 * that the attribute is set and that no readback is left bare.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const MASKS = src('../wallpro-masks.ts');
/** The comments quote the bug; judge the code. */
const CODE = MASKS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a mask is fetched CORS-clean, so the canvas it lands in stays readable', () => {
  it('sets crossOrigin on the only loader in the file', () => {
    expect(CODE).toContain("img.crossOrigin = 'anonymous'");
  });

  it('creates exactly one Image, so there is no second loader to forget', () => {
    // The defect was two loaders disagreeing. A third would be a third chance.
    expect((CODE.match(/new Image\(\)/g) ?? []).length).toBe(1);
  });

  it('keeps the attribute on the same statement list as the src assignment', () => {
    // `crossOrigin` MUST be set before `src`: assigning src first starts the
    // fetch, and a later attribute change does not re-issue it as CORS.
    const cors = CODE.indexOf('img.crossOrigin');
    const srcSet = CODE.indexOf('img.src = src');
    expect(cors).toBeGreaterThan(-1);
    expect(srcSet).toBeGreaterThan(-1);
    expect(cors, 'crossOrigin must be set BEFORE src or the fetch is not CORS').toBeLessThan(srcSet);
  });
});

describe('an unreadable mask means nothing is protected, never a broken page', () => {
  it('routes every readback through the soft helper', () => {
    expect(CODE).toContain('function readPixels(');
    expect(CODE).toContain('try { return ctx.getImageData(0, 0, width, height); } catch { return null; }');
  });

  it('leaves NO bare getImageData behind', () => {
    // One occurrence only, and it is the one inside `readPixels`.
    expect((CODE.match(/getImageData\(/g) ?? []).length).toBe(1);
  });

  it('falls back to the coarse box rather than losing the object', () => {
    // Same treatment a missing PNG already gets: a rectangle over the window
    // beats no protection at all.
    expect(CODE).toContain('if (!scratchPixels) { fill(left, top, w, h); continue; }');
  });

  it('returns empty flags instead of throwing out of maskFlags', () => {
    expect(CODE).toMatch(/if \(!pixels\) return flags;/);
  });
});
