import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const page = readFileSync(fileURLToPath(new URL('../../pages/WallPro.tsx', import.meta.url)), 'utf8');
const magic = readFileSync(fileURLToPath(new URL('../../components/wallpro/WallProMagic.tsx', import.meta.url)), 'utf8');

describe('the WallPro opening experience', () => {
  it('shows the transformation only before the customer starts', () => {
    expect(page).toMatch(/\{!photo && !artwork && \(/);
    expect(page).toContain('See the transformation');
    expect(page).toContain('<WallProHeroProof proofs={bandProofs} variant="shallow" />');
  });

  it('shows the product magic before the working form', () => {
    const hero = page.indexOf('<WallProHeroProof proofs={bandProofs} variant="shallow" />');
    const magic = page.indexOf('<WallProMagic />');
    const upload = page.indexOf('<section id="upload-wall"');
    expect(hero).toBeGreaterThan(-1);
    expect(magic).toBeGreaterThan(hero);
    expect(upload).toBeGreaterThan(magic);
  });

  it('starts on the same page rather than inventing another upload route', () => {
    expect(magic).toContain('href="#upload-wall"');
    expect(page).toContain('<section id="upload-wall"');
  });

  it('keeps one shared component for the light WPW and dark DesignPro surfaces', () => {
    expect(page).toContain("data-wall-theme={theme.surface}");
    expect(page).toContain("theme.showPrintOffer");
    expect(page).toContain("<WallProPurchaseCard");
  });

  it('moves the old top print shortcut into the purchase area', () => {
    expect(page).not.toContain('Already have artwork?</strong> Skip the design and order printed film');
    expect(page).toContain('showPrintOffer={theme.showPrintOffer}');
  });

  it('clears the showcase once the customer has a wall or artwork on screen', () => {
    expect(page).toMatch(/!photo && !artwork/);
  });
});
