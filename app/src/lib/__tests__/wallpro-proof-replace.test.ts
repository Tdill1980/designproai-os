/**
 * "WallPro won't let me replace hero before and after slider bar image"
 * (owner, 2026-09-22, on /admin/wallpro-proofs).
 *
 * TWO DEFECTS, AND BOTH LOOK IDENTICAL FROM THE CHAIR: the picker opens, a
 * file is chosen, and nothing happens at all.
 *
 * 1. THE FAILURE WAS UNHANDLED AND THEREFORE INVISIBLE. `take` is async and
 *    the call site was `void take(...)`, so a rejected `createImageBitmap`
 *    went nowhere — no half, no preview, no error, no console path the
 *    curator would ever see. And it rejects on ordinary inputs: Chrome cannot
 *    decode HEIC, which is exactly what `accept="image/*"` offers from a
 *    phone, and it throws on corrupt or unsupported files too.
 *
 * 2. RE-CHOOSING THE SAME FILE WAS A NO-OP. The input's value was never
 *    cleared, so `change` does not fire the second time. That IS the replace
 *    workflow — look at the crop, dislike it, pick the same file again — and
 *    the page sits there. `WallPro.tsx` has cleared `e.target.value` since it
 *    was written; this page never learned it.
 *
 * The decode now goes through `prepareWallUpload` rather than a new converter
 * (RULE 1: recover the proven implementation), so a phone photo works here
 * exactly as it does on the customer upload.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const page = readFileSync(fileURLToPath(new URL('../../pages/AdminWallProProofs.tsx', import.meta.url)), 'utf8');

describe('the proof band lets a curator replace an image', () => {
  it('clears the input so the SAME file can be chosen again', () => {
    expect(page).toContain("void take(e.target.files?.[0]); e.target.value = '';");
    expect(page).not.toContain('onChange={e => void take(e.target.files?.[0])} />');
  });

  it('reports a decode failure instead of swallowing it', () => {
    expect(page).toContain('function useHalf(report: (message: string) => void)');
    expect(page).toContain("report(e instanceof Error ? e.message : 'That image could not be opened.');");
    // Wired to the page's own error banner, not a console.
    expect(page).toContain('useHalf(setError)');
    expect((page.match(/useHalf\(setError\)/g) ?? []).length).toBe(2);
  });

  it('takes a phone photo through the proven converter rather than a new one', () => {
    expect(page).toContain("import { prepareWallUpload } from '@/lib/wallpro-render';");
    expect(page).toContain('await prepareWallUpload(file)');
    // And the picker offers HEIC at all, which `image/*` alone does not on
    // every platform -- the same accept list the customer upload uses.
    expect(page).toContain('accept="image/*,.heic,.heif,.HEIC,.HEIF"');
  });

  it('measures the bitmap of the PREPARED file, not the original', () => {
    // Transcoding can resize, so reading the pre-transcode dimensions would
    // print a size the shipped image does not have.
    expect(page).toContain('createImageBitmap(ready)');
    expect(page).not.toContain('createImageBitmap(file)');
  });

  it('revokes the previous preview, so replacing repeatedly does not leak', () => {
    expect(page).toContain('if (old) URL.revokeObjectURL(old.preview);');
  });

  it('still opens the picker from a real button, never a transparent overlay', () => {
    // The 2026-09-12 iPhone lesson: a file input laid over a label is one
    // hit-test away from doing nothing, and a tap that does nothing reads as
    // a broken app.
    expect(page).toContain('className="sr-only"');
    expect(page).toContain('onClick={() => ref.current?.click()}');
  });
});
