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

test("each brand has ONE landing and ONE tool, from the same two components", () => {
  // WHAT THIS GUARDS IS UNCHANGED: there is no second WallPro and no second
  // landing page -- both brands are the SAME component wearing a `brand` prop.
  // What moved (2026-09-17) is which page answers /wall-wrap. #462 built the
  // landing for DesignProAI only, so the partner URL still served the TOOL and
  // was the one WallPro surface with no landing -- the one shown to the
  // partner. /wall-wrap is now their landing, mirroring /wallpro, and their
  // tool keeps /wallwrap-design, a route that has existed since the tenant
  // shipped. No tool route moved and no component was copied.
  const app = read("app/src/App.tsx");
  // The landings.
  assert.ok(app.includes('<Route path="/wallpro" element={<WallProLanding />} />'),
    "the DesignProAI landing is gone");
  assert.ok(app.includes('<Route path="/wall-wrap" element={<WallProLanding brand="weprintwraps" />} />'),
    "the partner landing is gone");
  // The tools.
  assert.ok(app.includes('<Route path="/printpro/wallpro" element={<WallPro />} />'),
    "the DesignProAI tool is gone");
  assert.ok(app.includes('<Route path="/wallwrap-design" element={<WallPro brand="weprintwraps" />} />'),
    "the partner tool is gone");
  // ONE of each component, never a per-brand copy.
  assert.equal(app.match(/import\("\.\/pages\/WallProLanding"\)/g)?.length, 1);
  assert.equal(app.match(/import\("\.\/pages\/WallPro"\)/g)?.length, 1);
});

test("PatternPro keeps the same pair, so the two tools stay symmetrical", () => {
  const nav = read("app/src/lib/dashboard-nav.ts");
  assert.ok(nav.includes('key: "patternpro",'));
  assert.ok(nav.includes('key: "patternpro_wpw",'));
});
