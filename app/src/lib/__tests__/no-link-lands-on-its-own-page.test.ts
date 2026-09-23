/**
 * A LINK THAT NAVIGATES TO THE PAGE IT IS ON IS A BROKEN CONTROL.
 *
 * Found 2026-09-23, while the owner was asking "Are print ready files located
 * in WallPro admin page?" — `/wallpanelprostudio` rendered a **Production
 * jobs** button pointing at `/admin/wallpro-production`, and `App.tsx` routes
 * that to `<Navigate to="/wallpanelprostudio" replace />`. So the button
 * navigated to the page it was already on. Nothing happened, every time, and
 * nothing in the app could tell you why.
 *
 * It is a two-file defect, which is why no single file review catches it: the
 * link is correct where it is written, the redirect is correct where it is
 * written, and only the PAIR is wrong. A retired page is normally retired by
 * pointing its route at whatever replaced it — and the moment that replacement
 * still links to the old path, the link eats itself.
 *
 * This repo already has the lesson in words: "an instruction to find a third
 * control is not an action", and "Name the buttons that are really there."
 * This is the routing version of it, and it is checked rather than remembered.
 *
 * WHAT THIS DOES: reads every `<Route path={X} element={<Navigate to={Y} />}>`
 * out of App.tsx, resolves which component renders at Y, and asserts that
 * component's own source contains no link to X.
 *
 * It is deliberately FORGIVING about what it cannot resolve — a redirect whose
 * target route or component file it cannot find is skipped, not failed. A lock
 * that guesses would be worse than no lock; the pairs it CAN resolve are real.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const abs = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const APP = readFileSync(abs('../../App.tsx'), 'utf8');

/** `<Route path="/old" element={<Navigate to="/new" replace />} />` */
const REDIRECT = /<Route\s+path="([^"]+)"\s+element=\{<Navigate\s+to="([^"]+)"/g;
/** `<Route path="/new" element={<Thing />}>` — first component name wins. */
const routeComponent = (path: string): string | null => {
  const re = new RegExp(`<Route\\s+path="${path.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"\\s+element=\\{([^}]*)\\}`);
  const m = APP.match(re);
  if (!m) return null;
  const names = m[1].match(/<([A-Z][A-Za-z0-9_]*)/g) ?? [];
  // Skip wrappers like RequireAdmin/RequireAuth: the LAST one is the page.
  const last = names[names.length - 1];
  return last ? last.slice(1) : null;
};

const sourceFor = (component: string): string | null => {
  for (const dir of ['../../pages/', '../../components/', '../../pages/designpro/', '../../pages/admin/']) {
    const p = abs(`${dir}${component}.tsx`);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return null;
};

describe('no page links to a path that redirects back to that same page', () => {
  const pairs = [...APP.matchAll(REDIRECT)].map(m => ({ from: m[1], to: m[2] }));

  it('finds the redirects to check, so this suite is not vacuously green', () => {
    // A regex that silently matches nothing is a lock that proves nothing.
    expect(pairs.length).toBeGreaterThan(3);
  });

  it('no redirect target links back to its own redirect source', () => {
    const dead: string[] = [];
    for (const { from, to } of pairs) {
      if (from === to) continue;
      const component = routeComponent(to);
      if (!component) continue;                 // unresolvable: skip, never guess
      const source = sourceFor(component);
      if (!source) continue;
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
      if (code.includes(`to="${from}"`)) {
        dead.push(`${component} (rendered at ${to}) links to ${from}, which redirects straight back to ${to}`);
      }
    }
    expect(dead, `these controls navigate to the page they are already on:\n  ${dead.join('\n  ')}`).toEqual([]);
  });

  it('pins the one that was actually shipped, by name', () => {
    // Belt and braces for the case that prompted this: the generic walk above
    // depends on App.tsx keeping a shape it can parse, and this does not.
    const board = readFileSync(abs('../../pages/WallPanelProStudio.tsx'), 'utf8');
    const code = board.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(code).not.toContain('to="/admin/wallpro-production"');
    expect(APP).toContain('<Route path="/admin/wallpro-production" element={<Navigate to="/wallpanelprostudio" replace />} />');
  });
});
