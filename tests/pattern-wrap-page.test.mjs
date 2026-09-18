import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PatternPro on DesignProAI — the WePrintWraps-facing /pattern-wrap page.
 *
 * Owner, 2026-09-15: "make a white and gradient blue version for WPW …
 * PatternPro top left, show an image on right" and then "all these need to be
 * in os.designpro repo". PatternPro was ported here from RestylePro on that
 * day: two edge functions, the pattern tables + their seed + a public render
 * bucket, the current tool files, and one partner page in WallPro's shape.
 *
 * Static, like app-shell-routing: the release gate must not need a browser or
 * a Supabase project to prove the page is wired.
 */
const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const APP = read("app/src/App.tsx");
const PAGE = read("app/src/pages/PatternWrap.tsx");
const CSS = read("app/src/pages/PatternWrap.css");
const BRAND = read("app/src/lib/patternpro-brand.ts");
const HOOK = stripComments(read("app/src/hooks/useWBTYLogic.ts"));
const UI = read("app/src/components/productTools/WBTYToolUI.tsx");
const RENDER_FN = stripComments(read("supabase/functions/generate-pattern-render/index.ts"));
const CONFIG = read("supabase/config.toml");
const MIGRATION = "supabase/migrations/20260915090000_patternpro_wbty_products.sql";

test("the DesignProAI brand carries the same hero and no partner name — owner: 'like this without WPW'", () => {
  const designpro = BRAND.slice(BRAND.indexOf("  designpro: {"), BRAND.indexOf("  weprintwraps: {"));
  assert.ok(designpro.includes("hero: HERO,"));
  assert.ok(!/weprintwraps|wpw/i.test(designpro.replace(/\/\/[^\n]*/g, "")), "no WPW in the DesignProAI brand");
  assert.ok(PAGE.includes("{theme.lede}") && PAGE.includes("theme.chips.map") && PAGE.includes("{theme.eyebrowLine}"));
  assert.ok(!/WePrintWraps/.test(stripComments(PAGE)), "the page holds no partner copy of its own");
});

test("PatternPro is in the OS navigation — owner: 'PatternPro should have gone to os.designpro'", () => {
  const nav = read("app/src/lib/dashboard-nav.ts");
  assert.ok(nav.includes('key: "patternpro",'));
  assert.ok(nav.includes('route: "/printpro/patternpro",'));
  assert.ok(read("app/src/components/dashboard/ToolWordmark.tsx").includes('patternpro:       { base: "Pattern",    suffix: "Pro" },'));
  // And the WPW tenant page beside it (owner: "I should see both on navigation
  // left side, so I can show WPW and also sell").
  assert.ok(nav.includes('key: "patternpro_wpw",'));
  assert.ok(nav.includes('route: "/pattern-wrap",'));
  assert.ok(read("app/src/components/dashboard/ToolWordmark.tsx").includes('patternpro_wpw:   { base: "WPW × Pattern", suffix: "Pro" },'));
});

test("/pattern-wrap and /printpro/patternpro are routed to the ONE PatternWrap page", () => {
  assert.ok(APP.includes('const PatternWrap = lazyWithRetry(() => import("./pages/PatternWrap"));'));
  // BOTH pages on every host (owner, 2026-09-16: "I should have a WPW
  // PatternPro page and a stand alone PatternPro page both on the
  // os.designpro — WPW is a tenant"). No host redirect on /pattern-wrap.
  assert.ok(APP.includes('<Route path="/pattern-wrap" element={<PatternWrap brand="weprintwraps" />} />'));
  assert.ok(!APP.includes("PartnerPatternWrap"), "the tenant page must not redirect off the DesignProAI host");
  assert.ok(APP.includes('<Route path="/printpro/patternpro" element={<PatternWrap />} />'));
});

test("the partner page renders standalone — no DesignProAI chrome on a WePrintWraps page", () => {
  const partnerRoute = APP.slice(APP.indexOf("const isWallProPartnerRoute"), APP.indexOf("const HideOnCustomerProof"));
  assert.ok(partnerRoute.includes('pathname === "/pattern-wrap"'), "isWallProPartnerRoute must cover /pattern-wrap");
});

test("it is the SAME PatternPro tool under a white skin — never a second tool", () => {
  assert.ok(PAGE.includes("import { WBTYToolUI } from '@/components/productTools/WBTYToolUI';"));
  // THE SKIN NOW RIDES THE BRAND (owner, 2026-09-17: "a dark navy with charcoal
  // ui for standard WallPro, and PatternPro"). It was unconditional, which is
  // exactly why the DesignProAI page came out light. The point this test
  // protects is unchanged and is the important half: there is ONE tool, and the
  // partner's light storefront is a skin over it rather than a second copy.
  // Dropping the skin returns the shared tool to the dark it was written in.
  assert.ok(PAGE.includes("theme.surface === 'light' ? 'wpw-white' : ''"));
  // The tool is still shared; its proof now needs the page's tenant brand.
  assert.ok(PAGE.includes("<WBTYToolUI brand={brand} />"));
  assert.ok(PAGE.includes("import './PatternWrap.css';"));
  for (const cls of [".bg-zinc-800", ".bg-zinc-700", ".border-zinc-600", ".text-white", ".text-muted-foreground", "input"]) {
    assert.ok(CSS.includes(`.wpw-white ${cls}`), `skin must cover ${cls}`);
  }
  assert.ok(CSS.includes("linear-gradient(90deg, #2f7ff7, #174a91)"));
  assert.ok(BRAND.includes("export const PATTERN_BLUE_GRADIENT = 'linear-gradient(90deg, #2f7ff7, #174a91)';"));
});

test("themed surface, blue gradient accent, the WPW mark in the lockup, wordmark top-left, a render on the right", () => {
  // The page ground is a TOKEN now, not a literal: light on the partner brand,
  // dark navy on DesignProAI, from the one set in index.css that WallPro reads
  // too. Locked in detail by tests/printpro-surface-theme.test.mjs.
  assert.ok(PAGE.includes('data-wall-theme={theme.surface}'));
  assert.ok(PAGE.includes('className="pattern-wrap min-h-screen wall-ground wall-ink"'));
  assert.ok(PAGE.includes("import { WallProLockup, WallProHeaderRule } from '@/components/wallpro/WallProLockup';"));
  // THE HEADER FOLLOWS THE SURFACE (owner, 2026-09-17: "I need the white ui
  // just add the WPW colored logo in corner"). The partner brand is the light
  // surface, so its bar is white with dark ink; the OS brand keeps the black
  // nav bar. Both literals are pinned so neither can quietly drift.
  assert.ok(PAGE.includes("<WallProLockup theme={theme} tone={light ? 'light' : 'dark'} />"));
  assert.ok(PAGE.includes("const light = theme.surface === 'light';"));
  assert.ok(PAGE.includes("'sticky z-30 border-b border-gray-200 bg-white px-4 py-3 text-gray-900 md:px-8 md:py-4'"));
  assert.ok(PAGE.includes("'sticky z-30 bg-black px-4 py-3 text-white md:px-8 md:py-4'"));
  assert.ok(BRAND.includes("surface: 'light',"), 'the WPW brand is the light surface');
  // The lockup's ink is a tone table, never a hard-coded white -- white ink on
  // a white bar is how the WPW mark would end up beside an invisible name.
  const LOCKUP = read('app/src/components/wallpro/WallProLockup.tsx');
  assert.ok(LOCKUP.includes("tone = 'dark'"), 'the default tone keeps every black header unchanged');
  assert.ok(LOCKUP.includes("light: { lead: 'text-gray-900'"));
  assert.ok(!LOCKUP.includes('className="text-white">{theme.wordmarkLead}'), 'the lead ink follows the tone');
  // Owner, 2026-09-15: "should say pick a pattern and see it on any vehicle".
  assert.ok(PAGE.includes("Pick a pattern."));
  assert.ok(PAGE.includes('See it on <span className="wpw-blue-text">any vehicle</span>.'));
  assert.ok(!PAGE.includes("Designed in <span"));
  assert.ok(PAGE.includes("src={theme.hero.main}"));
  // The small square is the SWATCH the render was made from, not a second render.
  assert.ok(PAGE.includes("src={theme.hero.swatch}"));
  assert.ok(BRAND.includes("render/image/public/wrap-files/pattern-swatches-wpw"));
  assert.ok(BRAND.includes("${SWATCH_BASE}/modern-trippy/chameleon-camo-tan.jpg?width=800&resize=contain&quality=80"));
  // The card carries the pattern name on its bottom edge: never square-crop it.
  assert.ok(!BRAND.includes("resize=cover"));
  assert.ok(!PAGE.includes("aspect-square"));
  assert.ok(BRAND.includes("logo: '/wpw-logo-mark.png'"));
  assert.ok(existsSync(resolve(root, "app/public/wpw-logo-mark.png")));
  assert.ok(BRAND.includes("storage/v1/render/image/public/wrap-files/renders/anonymous/patternpro"));
  assert.ok(BRAND.includes("?width=1400&height=788&resize=contain&quality=78"));
  assert.doesNotMatch(PAGE, /bg-zinc-900|from-purple-600 to-pink-600/);
});

test("the tool files are the current ones: keyed writes, batched views, real yardage, connected product ids", () => {
  // The old "find the latest designpanelpro row for this email and flip it" is gone.
  assert.ok(!HOOK.includes(".eq('mode_type', 'designpanelpro')"));
  assert.ok(HOOK.includes(".eq('id', capturedVizId)"));
  assert.ok(HOOK.includes("i += 3) viewBatches.push(wanted.slice(i, i + 3))"));
  assert.ok(HOOK.includes("const yards = Math.max(1, Math.ceil(Number(data?.yards) || 0));"));
  assert.ok(HOOK.includes("const productId = wbtyProductIdForCategory(selectedProduct?.category);"));
  assert.ok(!HOOK.includes("const getProductId = (category: string) =>"));
  // This app's render-function resolver lives in legacyRenderFunctions, not VehicleTypeSelector.
  assert.ok(HOOK.includes('import { getRenderFunctionForType } from "@/components/tools/legacyRenderFunctions";'));
  assert.ok(UI.includes('data-testid="full-wrap-estimate"'));
  assert.ok(UI.includes("Curated Library ({products.length} Patterns)"));
  assert.ok(UI.includes('import { isWpwCartUrl } from "@/lib/wpw-catalog";'));
  assert.ok(read("app/src/lib/wpw-catalog.ts").includes("export function isWpwCartUrl("));
});

test("the backend is registered: both functions in config.toml, renders in their own PUBLIC bucket", () => {
  assert.ok(CONFIG.includes("[functions.generate-pattern-render]\nverify_jwt = false"));
  assert.ok(CONFIG.includes("[functions.calculate-film-yards]\nverify_jwt = false"));
  assert.ok(existsSync(resolve(root, "supabase/functions/calculate-film-yards/index.ts")));
  // wrap-files is PRIVATE on this project; a public URL into it is a broken image.
  assert.ok(RENDER_FN.includes('const RENDER_BUCKET = "patternpro-files";'));
  assert.ok(!RENDER_FN.includes('"wrap-files"'), "the ported render function must not write to wrap-files");
  assert.ok(RENDER_FN.includes("vehicle_year: vehicleYear || colorData.vehicleYear || null,"));
});

test("the migration creates the tables, the bucket and seeds all 118 patterns across the five collections", () => {
  assert.ok(existsSync(resolve(root, MIGRATION)));
  const sql = read(MIGRATION);
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS public.wbty_products"));
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS public.wbty_carousel"));
  assert.ok(sql.includes("'patternpro-files', 'patternpro-files', true"));
  assert.ok(sql.includes("FOR SELECT TO anon, authenticated USING (is_active = true)"));
  assert.ok(sql.includes("WHERE NOT EXISTS (SELECT 1 FROM public.wbty_products p WHERE p.name = r.name)"));
  // Count the seeded names: every quoted entry inside the five ARRAY[...]
  // literals of the seed CTE (the bucket's mime ARRAY sits above it).
  const seed = sql.slice(sql.indexOf("WITH src(category, folder, names) AS ("));
  const arrays = [...seed.matchAll(/ARRAY\[([\s\S]*?)\]\)/g)].map((m) => m[1]);
  assert.equal(arrays.length, 5, "five collections");
  const names = arrays.flatMap((a) => [...a.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]));
  assert.equal(names.length, 118);
  assert.equal(new Set(names).size, 118, "no duplicate pattern names");
  for (const cat of ["Wicked & Wild", "Camo & Carbon", "Metal & Marble", "Bape Camo", "Modern & Trippy"]) {
    assert.ok(sql.includes(`('${cat}', '`), `${cat} collection present`);
  }
  // The category strings are what resolve the cart link — they must match the app's map.
  const patterns = read("app/src/data/patternpro-patterns.ts");
  for (const cat of ["Wicked & Wild", "Camo & Carbon", "Metal & Marble", "Bape Camo", "Modern & Trippy"]) {
    assert.ok(patterns.includes(`"${cat}":`), `${cat} in WPW_WOOCOMMERCE_IDS`);
  }
});
