/**
 * ONE SIDEBAR PER SCREEN, AND THE RIGHT ONE.
 *
 * Owner, 2026-09-22: "on os.DesignPro the navigation is showing shopflow
 * navigation instead of DesignPro." That was read as a banner mounted at the
 * top of the OS sidebar, the banner was removed, and she reported it again:
 * "I did hard refresh and I went private browsing yet still showing the blue
 * shopflow side bar."
 *
 * The banner really was gone — absent from all 184 chunks the live site
 * serves. What she was looking at is ShopFlow's OWN rail, a 268px
 * `from-[#0b1830] via-[#101b32] to-[#174a91]` aside inside the page. The first
 * diagnosis had explicitly ruled that out ("on /shopflow she would see no
 * sidebar at all") without opening the page, and a fix shipped on it.
 *
 * So this file tests the SEAM rather than any one component's strings:
 *
 *   - /shopflow is an app route on the OS host, so AppShell wraps it
 *   - it is NOT one on a partner host, where DesignProAI's dark staff rail
 *     must never appear on somebody else's domain
 *   - ShopFlow's own rail stands down exactly when the shell is around it
 *   - and both sides read ONE predicate, never two copies of it
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { shopflowWearsOsShell } from '../../hooks/useIsAppRoute';

const source = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('/shopflow wears the DesignProAI shell on the OS host', () => {
  it('is an app route on os.designproai.com', () => {
    expect(shopflowWearsOsShell('/shopflow', 'os.designproai.com')).toBe(true);
  });

  it('covers deeper paths under it, not just the exact one', () => {
    expect(shopflowWearsOsShell('/shopflow/orders', 'os.designproai.com')).toBe(true);
  });

  it('is NOT an app route on a WallPro partner host', () => {
    // AppSidebar is DesignProAI's own chrome — dark, carrying Admin Dashboard,
    // WallPro Batch Generate, QC and the plan tier. Half of it is staff
    // navigation a WePrintWraps customer must never see, and all of it is the
    // wrong brand on somebody else's domain.
    expect(shopflowWearsOsShell('/shopflow', 'wallpro.weprintwraps.com')).toBe(false);
  });

  it('leaves every other path to the prefix list', () => {
    expect(shopflowWearsOsShell('/dashboard', 'os.designproai.com')).toBe(false);
    expect(shopflowWearsOsShell('/shopflowery', 'os.designproai.com')).toBe(false);
  });
});

describe('the two sides of the seam read one predicate', () => {
  const hook = source('../../hooks/useIsAppRoute.ts');
  const shell = source('../../components/layout/AppShell.tsx');
  const page = source('../../pages/ShopFlow.tsx');

  it('ShopFlow suppresses its own rail when the shell is around it', () => {
    expect(page).toContain('const insideOsShell = useInsideAppShell();');
    expect(page).toContain('{!atTheDoor && !insideOsShell && <ShopflowSidebar');
  });

  it('AppShell no longer re-derives the iframe check for itself', () => {
    // Two copies of "am I inside the shell" drift the first time either moves,
    // and this page's app list has already been wrong three times for exactly
    // that reason.
    expect(shell).toContain('isEmbeddedInIframe');
    expect(shell).not.toContain('window.self !== window.top');
    expect(hook).toContain('export const isEmbeddedInIframe');
    expect(hook).toContain('export const useInsideAppShell');
  });

  it('keeps ShopFlow\'s rail where it is the ONLY navigation', () => {
    // On a partner host and inside an iframe AppShell renders nothing, so the
    // blue rail is not a second sidebar — it is the only one. `useInsideAppShell`
    // is false in both cases, which is what the suppression keys on.
    expect(hook).toContain('useIsAppRoute() && !isEmbeddedInIframe()');
  });

  it('still has a rail to suppress — the aside is real and still blue', () => {
    // If somebody deletes the rail outright this file should fail rather than
    // quietly pass: the partner host still needs it.
    expect(page).toContain('from-[#0b1830] via-[#101b32] to-[#174a91]');
  });
});
