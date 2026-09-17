import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE WPW TENANT PAGE IS IN THE NAVIGATION, FOR BOTH TOOLS.
 *
 * Owner, 2026-09-17: "where is the wpw x wallpro page in os.designproai
 * navigation? Only WPW x PatternPro show."
 *
 * The white-label WallPro page has existed at /wall-wrap since the brand table
 * was written, and /wallwrap-design points at it too. What was missing was its
 * NAME in the registry, so the only way to reach it was to type the URL --
 * while PatternPro's identical tenant page sat one row away in the same
 * sidebar. The tool with the live partner customer was the one the owner could
 * not open to demo.
 *
 * The ruling is the one already recorded on the PatternPro twin: "I should see
 * both on navigation left side, so I can show WPW and also sell." Both tools
 * therefore carry BOTH entries -- the DesignProAI page and the tenant page --
 * and this test fails if either tool loses half of that pair.
 *
 * Route ownership, for anyone tempted to add host detection here: the brand is
 * chosen by the ROUTE, not the hostname. /wall-wrap and /wallwrap-design pass
 * brand="weprintwraps"; /printpro/wallpro takes the DesignProAI default. That
 * is what lets one host serve both, which is the whole point of the entry.
 */
const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

test("both WallPro pages are named in the navigation registry", () => {
  const nav = read("app/src/lib/dashboard-nav.ts");
  // The DesignProAI page.
  assert.ok(nav.includes('key: "wallpro",'), "the DesignProAI WallPro entry is gone");
  assert.ok(nav.includes('route: "/printpro/wallpro",'));
  // The WePrintWraps tenant page beside it.
  assert.ok(nav.includes('key: "wallpro_wpw",'), "the WPW tenant WallPro entry is gone");
  assert.ok(nav.includes('route: "/wall-wrap",'), "the tenant entry no longer points at /wall-wrap");
  assert.ok(nav.includes('label: "WPW × WallPro",'));
});

test("the tenant entry has a wordmark, so it cannot render as a raw key", () => {
  // A key with no wordmark entry renders lowercase and unspaced -- the defect
  // the wordmark table's own comment records for three earlier keys.
  const wordmarks = read("app/src/components/dashboard/ToolWordmark.tsx");
  assert.ok(wordmarks.includes('wallpro_wpw:      { base: "WPW × Wall", suffix: "Pro" },'));
});

test("/wall-wrap still renders the WePrintWraps brand of the ONE WallPro page", () => {
  const app = read("app/src/App.tsx");
  assert.ok(app.includes('<Route path="/wall-wrap" element={<WallPro brand="weprintwraps" />} />'));
  assert.ok(app.includes('<Route path="/printpro/wallpro" element={<WallPro />} />'));
});

test("PatternPro keeps the same pair, so the two tools stay symmetrical", () => {
  const nav = read("app/src/lib/dashboard-nav.ts");
  assert.ok(nav.includes('key: "patternpro",'));
  assert.ok(nav.includes('key: "patternpro_wpw",'));
});
