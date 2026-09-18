/**
 * ShopFlow's apps: the right destinations, on every width.
 *
 * This list has been wrong three times, twice in opposite directions, and no
 * test covered any of it:
 *   - WallPro pointed at `/wallpro` — the DesignProAI landing — so a
 *     WePrintWraps customer left the brand mid-session;
 *   - the correction overshot to `/wall-wrap` in the same change that turned
 *     `/wall-wrap` INTO a landing page: right brand, wrong destination;
 *   - PatternPro once pointed at `/patternpro`, which has NO route at all and
 *     fell through to the catch-all as a dead click.
 *
 * And the whole rail is `hidden ... lg:flex`, so on a phone none of it
 * rendered — the links were correct while the owner, demoing on a phone,
 * could not find WallPro anywhere on the page.
 *
 * So these cases assert three separate things a route-and-brand eyeball check
 * cannot: the destination is the TOOL and not the landing, the route actually
 * EXISTS in the router, and one definition feeds both widths.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SHOPFLOW_APPS, shopflowApp } from '../shopflow-apps';

const appSource = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
const shopFlowSource = readFileSync(new URL('../../pages/ShopFlow.tsx', import.meta.url), 'utf8');

describe('SHOPFLOW_APPS destinations', () => {
  it('opens the WePrintWraps WallPro TOOL, never either landing page', () => {
    expect(shopflowApp('wallpro').href).toBe('/wallwrap-design');
    expect(shopflowApp('wallpro').href).not.toBe('/wall-wrap');
    expect(shopflowApp('wallpro').href).not.toBe('/wallpro');
  });

  it('opens the real PatternPro tool', () => {
    expect(shopflowApp('patternpro').href).toBe('/pattern-wrap');
    expect(shopflowApp('patternpro').href).not.toBe('/patternpro');
  });

  it('serves WallPro under the partner brand, not the DesignProAI skin', () => {
    // /wallwrap-design must render WallPro with brand="weprintwraps"; the
    // DesignProAI route is /printpro/wallpro and is a different, dark surface.
    expect(appSource).toMatch(/path="\/wallwrap-design"[^>]*element=\{<WallPro brand="weprintwraps"/);
  });

  it('every internal destination is a real route — a dead link is worse than no link', () => {
    for (const app of SHOPFLOW_APPS) {
      if (app.external) continue;
      expect(appSource, `${app.label} -> ${app.href}`).toContain(`path="${app.href}"`);
    }
  });

  it('sends the one external app off-site safely', () => {
    const commercial = shopflowApp('commercialpro');
    expect(commercial.external).toBe(true);
    expect(commercial.href.startsWith('https://')).toBe(true);
  });
});

describe('SHOPFLOW_APPS shape', () => {
  it('leads with the two apps this dashboard exists to open', () => {
    expect(SHOPFLOW_APPS.map(a => a.key)).toEqual(['wallpro', 'patternpro', 'commercialpro']);
  });

  it('gives every app a label, a blurb and a thumbnail', () => {
    for (const app of SHOPFLOW_APPS) {
      expect(app.label.length).toBeGreaterThan(0);
      expect(app.blurb.length).toBeGreaterThan(0);
      expect(app.thumb).toMatch(/^\/assets\/.+\.(webp|jpg|png)$/);
    }
  });

  it('has no duplicate keys or destinations', () => {
    expect(new Set(SHOPFLOW_APPS.map(a => a.key)).size).toBe(SHOPFLOW_APPS.length);
    expect(new Set(SHOPFLOW_APPS.map(a => a.href)).size).toBe(SHOPFLOW_APPS.length);
  });
});

describe('ShopFlow renders the apps at every width', () => {
  it('draws the phone strip as the exact complement of the desktop rail', () => {
    // The rail is lg:flex and the strip is lg:hidden, so one of the two is on
    // screen at any width and never both. This is the assertion that would
    // have caught "the link is right but nothing is on screen".
    expect(shopFlowSource).toMatch(/hidden[^"]*lg:flex/);
    expect(shopFlowSource).toContain('function ShopflowAppStrip');
    expect(shopFlowSource).toMatch(/className="lg:hidden/);
    expect(shopFlowSource).toContain('<ShopflowAppStrip />');
  });

  it('builds the desktop rail rows from the same list, never a second copy', () => {
    for (const key of ['wallpro', 'patternpro', 'commercialpro']) {
      expect(shopFlowSource).toContain(`shopflowApp("${key}")`);
    }
    // No hand-written href beside the shared list — that is how it drifted.
    expect(shopFlowSource).not.toContain('href: "/wallwrap-design"');
    expect(shopFlowSource).not.toContain('href: "/pattern-wrap"');
  });
});
