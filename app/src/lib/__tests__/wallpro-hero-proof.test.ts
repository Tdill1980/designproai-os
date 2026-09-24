import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// These structural checks complement real-browser sizing tests. A DOM-only
// renderer cannot detect a collapsed grid track or a stretched comparison.
describe('the hero proof band', () => {
  const band = source('../../components/wallpro/WallProHeroProof.tsx');
  const page = source('../../pages/WallPro.tsx');

  it('keeps the original band and fill variants and adds a shallow tool hero', () => {
    expect(band).toContain("export type HeroProofVariant = 'band' | 'fill' | 'shallow';");
    expect(band).toContain("const shallow = variant === 'shallow';");
  });

  it('the shallow variant shows the whole 3:2 frame, both halves together', () => {
    expect(band).toContain("aspect-[3/2] w-full max-w-4xl");
    expect(band).not.toContain("SHALLOW_FOCUS");
    expect(band).toContain("(fill || shallow) ? 'object-cover' : 'object-contain'");
  });

  it('the tool page mounts the gym compare as the shallow variant', () => {
    expect(page).toContain('<WallProHeroProof proofs={bandProofs} variant="shallow" />');
  });

  it('the normal standalone band still has a definite capped width', () => {
    expect(band).toContain("'mx-auto mt-4 w-full max-w-6xl px-4'");
  });

  it('the fill variant still owns the whole landing-image box', () => {
    expect(band).toContain("fill ? 'absolute inset-0'");
  });
});

// The optional marking frame remains separate from the drag interaction.
// Replacing the approved photographs must not remove this existing feature.
describe('the marking stage', () => {
  const band = source('../../components/wallpro/WallProHeroProof.tsx');
  const brand = source('../wallpro-brand.ts');

  it('is reached by a real button, never by a click on the drag surface', () => {
    expect(band).toContain('<button');
    expect(band).toContain('setMarking(v => !v)');
    expect(band).toContain('aria-pressed={marking}');
  });

  it('hides the compare handle and its range while the marking frame is up', () => {
    expect(band).toContain('{!marking && <div className="pointer-events-none absolute inset-y-0 w-0.5');
    expect(band).toContain('{!marking && <input');
  });

  it('labels the stage as itself, not as Before or After', () => {
    expect(band).toContain('Marking the wall');
    expect(band).toMatch(/marking\s*\n?\s*\?\s*<span[^>]*>Marking the wall/);
  });

  it('shows the marking frame\'s own caption, not the pair\'s', () => {
    expect(band).toContain('{mark && marking ? mark.caption : current.caption}');
  });

  it('stops the carousel and drops the frame when the example changes', () => {
    expect(band).toContain('useEffect(() => { setMarking(false); }, [index]);');
    expect(band).toContain('held || marking || reducedMotion');
  });

  it('is optional — a pair with no marking frame still renders two stages', () => {
    expect(brand).toContain('marking?: { src: string; alt: string; caption: string };');
    expect(band).toContain('const mark = current?.marking;');
    expect(band).toContain('{mark && marking && (');
  });

  it('prefetches the third frame, so the click does not appear to do nothing', () => {
    expect(band).toContain('p.marking?.src');
  });
});

/**
 * On 2026-09-23 the owner supplied the original 1536×1024 gym before image
 * and the matching BUILT TO MOVE after image. These replace the older
 * 1400×803 retouched pair. The old wordmark pixel coordinates describe THAT
 * retired bitmap, not these approved photographs; applying them here would
 * reject an approved image or encourage repainting it merely to satisfy a
 * stale test. Exact file digests now prevent the retracted artwork or a
 * low-resolution substitute from silently returning. Photographed equipment
 * labels are preserved as supplied; these tests do not claim the frame has
 * no manufacturer marks.
 */
describe('the owner-approved high-resolution gym pair', () => {
  const brand = source('../wallpro-brand.ts');

  it('leads the band with the existing stable asset paths', () => {
    expect(brand).toContain("before: '/wallpro/proof-gym-before.jpg',");
    expect(brand).toContain("after: '/wallpro/proof-gym-after.jpg',");
    expect(brand).not.toMatch(/REPLACEMENT[_-]?REQUIRED/i);
  });

  it('retains the optional gym marking demonstration', () => {
    expect(brand).toContain("src: '/wallpro/proof-gym-mask.jpg',");
  });

  it.each([
    ['before', 'df146b1887d0efb69e39c3ef784115c6430dbe4080bc85dbf12031c578df8cf2'],
    ['after', 'eeaeb2c42be347a82c32b23052f3a8147d548bd561868c13c31daa98b6a5c287'],
  ])('ships the approved %s pixels at matching full resolution', async (side, digest) => {
    const sharp = (await import('sharp')).default;
    const file = fileURLToPath(new URL(`../../../public/wallpro/proof-gym-${side}.jpg`, import.meta.url));
    const bytes = readFileSync(file);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(digest);
    const info = await sharp(bytes).metadata();
    expect(info.width).toBe(1536);
    expect(info.height).toBe(1024);
    expect(info.format).toBe('jpeg');
    expect(info.channels).toBe(3);
  });
});
