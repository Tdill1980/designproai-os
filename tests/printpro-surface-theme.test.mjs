import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * LIGHT FOR THE PARTNER, DARK NAVY + CHARCOAL FOR DESIGNPROAI — BOTH TOOLS.
 *
 * Owner, 2026-09-17: "all need to be on os.designProai.com We need a WPW x
 * WallPro, and a WPW x PatternPro, both light UI. Then a dark navy with
 * charcoal ui for standard WallPro, and PatternPro."
 *
 * ONE TOKEN SET, TWO TOOLS. The colours live in `[data-wall-theme]` in
 * index.css and both pages scope themselves with that attribute, so WallPro
 * and PatternPro resolve the SAME dark. Two independently written darks
 * sitting beside each other in one sidebar is the drift this prevents, and it
 * is the same argument wallpro-brand.ts makes for not forking the component.
 *
 * NAVY AND CHARCOAL ARE DIFFERENT HUES, not one colour at two brightnesses:
 * the ground keeps real navy saturation, the card pulls most of it out. That
 * is what makes a panel read as a surface laid ON the page. The assertions
 * below pin that relationship rather than the exact values, so a designer can
 * retune the palette without fighting a test — but cannot collapse the two
 * into the same colour, which is the failure mode worth catching.
 */
const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");
const css = read("app/src/index.css");

/** Pull an HSL token's three numbers out of a named theme block. */
function token(block, name) {
  const scope = css.slice(css.indexOf(block));
  const body = scope.slice(0, scope.indexOf("}"));
  const m = body.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  assert.ok(m, `${name} missing from ${block}`);
  return { h: +m[1], s: +m[2], l: +m[3] };
}

test("the dark theme is navy ground under charcoal cards", () => {
  const ground = token('[data-wall-theme="dark"]', "wall-ground");
  const card = token('[data-wall-theme="dark"]', "wall-card");

  // Navy: a blue hue carrying real saturation, not a neutral grey.
  assert.ok(ground.h >= 200 && ground.h <= 240, `ground hue ${ground.h} is not blue`);
  assert.ok(ground.s >= 35, `ground saturation ${ground.s}% is too flat to read as navy`);

  // Charcoal: the same family, desaturated.
  assert.ok(card.s <= 22, `card saturation ${card.s}% is not charcoal`);
  assert.ok(ground.s - card.s >= 20, "navy and charcoal must differ in hue intensity, not only brightness");

  // A panel reads as an object only if it separates from its ground.
  assert.ok(card.l > ground.l, "the card must be lighter than the ground it sits on");
});

test("the light theme keeps a white card on a tinted ground", () => {
  const ground = token("[data-wall-theme] {", "wall-ground");
  const card = token("[data-wall-theme] {", "wall-card");
  assert.ok(card.l > ground.l, "the light card must still be lighter than its ground");
  assert.equal(card.l, 100, "the partner storefront's card is white");
});

test("text tokens exist in both themes, so nothing inherits an unthemed colour", () => {
  for (const block of ["[data-wall-theme] {", '[data-wall-theme="dark"]']) {
    const ink = token(block, "wall-ink");
    const soft = token(block, "wall-ink-soft");
    const ground = token(block, "wall-ground");
    // Body copy must sit on the far side of the ground's lightness, or it is
    // the white-on-white / black-on-black failure this whole layer prevents.
    const inkFar = Math.abs(ink.l - ground.l) > 50;
    assert.ok(inkFar, `${block}: ink ${ink.l}% has too little contrast with ground ${ground.l}%`);
    assert.ok(Math.abs(soft.l - ground.l) > 20, `${block}: muted copy is too close to the ground`);
  }
});

test("both brands declare a surface, and the two tools disagree the same way", () => {
  const wall = read("app/src/lib/wallpro-brand.ts");
  const pattern = read("app/src/lib/patternpro-brand.ts");
  // PatternPro: DesignProAI dark, partner light.
  assert.ok(pattern.includes("surface: 'dark',"), "patternpro: the DesignProAI brand is not dark");
  assert.ok(pattern.includes("surface: 'light',"), "patternpro: the partner brand is not light");
  // WallPro: BOTH light since the owner's 2026-09-24 mockup ("It's under
  // os.designproai"). Both brands still declare a surface explicitly.
  assert.equal((wall.match(/surface: 'light',/g) || []).length, 2, "wallpro: both brands are light");
});

test("both pages scope the theme on their own root, never on :root", () => {
  assert.ok(read("app/src/pages/WallPro.tsx").includes("data-wall-theme={theme.surface}"));
  assert.ok(read("app/src/pages/PatternWrap.tsx").includes("data-wall-theme={theme.surface}"));
  // The OS shell around these pages has its own palette and must not move.
  assert.ok(!/^:root\s*\{[^}]*--wall-ground/m.test(css), "the wall tokens must not leak onto :root");
});

test("the PatternPro light skin rides the brand instead of being unconditional", () => {
  // `.wpw-white` repaints the natively dark shared tool. Applied always, it is
  // why the DesignProAI page was light; the dark brand simply drops it.
  const page = read("app/src/pages/PatternWrap.tsx");
  assert.ok(page.includes("theme.surface === 'light' ? 'wpw-white' : ''"));
});
