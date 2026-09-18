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
  assert.ok(nav.includes('route: "/wallwrap-design",'), "the tenant entry must open the WPW designer");
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

/**
 * A WEPRINTWRAPS DASHBOARD LINKS TO WEPRINTWRAPS PAGES.
 *
 * Owner, 2026-09-17: the WPW WallPro page "must route to this ShopFlow
 * Dashboard in os.designpro and appear in the wpw wallpro tab", then "Those
 * links must go to WPW PatternPro and WPW WallPro both white ui pages."
 *
 * ShopFlow is the WePrintWraps account home. Its product rail pointed at
 * `/wallpro` -- the DESIGNPROAI-branded landing -- so a WePrintWraps customer
 * clicking WallPro inside their own dashboard left the brand mid-session. The
 * PatternPro tab was worse: `/patternpro` has no route at all, so it was a
 * dead click that fell through to the catch-all.
 *
 * Both partner routes resolve to the WHITE UI by construction, which is the
 * half worth pinning: /wallwrap-design uses the light WallPro brand, and
 * /pattern-wrap renders PatternWrap for a brand whose `surface` is 'light'.
 * A link that went to the right product in the wrong skin would satisfy a
 * naive route assertion and still break the demo.
 */
test("ShopFlow's product rail opens the WHITE partner pages, not the house ones", () => {
  // THE DESTINATIONS MOVED OUT OF THE PAGE, SO THIS TEST FOLLOWS THEM.
  //
  // This assertion used to read the literal `{ href: "/wallwrap-design",
  // label: "WallPro"` out of ShopFlow.tsx. #502 lifted the three apps into
  // lib/shopflow-apps.ts so the desktop rail and the new phone strip could not
  // drift apart -- and that literal stopped existing, which turned main red and
  // blocked every PR in the repo until it was found.
  //
  // The lesson is in HOW it is repaired: the guarantees below are unchanged and
  // the negatives are now WIDER (they cover both files, so a bad href cannot
  // hide in whichever one this test does not read). A source-literal assertion
  // has to name the file the data actually lives in, or a refactor that changes
  // nothing about behaviour fails the gate.
  const shopflow = read("app/src/pages/ShopFlow.tsx");
  const apps = read("app/src/lib/shopflow-apps.ts");
  const both = shopflow + "\n" + apps;
  // THE APP, NOT THE LANDING (owner, 2026-09-18: the dashboard "no longer shows
  // WPW WallPro App page, it's now showing a landing page"). The first fix
  // re-pointed this rail at /wall-wrap in the same change that turned
  // /wall-wrap INTO the landing -- right brand, wrong destination. A customer
  // inside their own account dashboard is already signed in and already sold;
  // a marketing page is a step backwards from where they are standing.
  assert.ok(/key:\s*"wallpro"[\s\S]{0,200}?href:\s*"\/wallwrap-design"/.test(apps),
    "the WallPro app must open the WePrintWraps TOOL, not its landing page");
  assert.ok(/key:\s*"patternpro"[\s\S]{0,200}?href:\s*"\/pattern-wrap"/.test(apps),
    "the PatternPro app must open the WePrintWraps page");
  // ...and the rail actually draws them, rather than the list sitting unread.
  assert.ok(shopflow.includes('shopflowApp("wallpro")'),
    "the ShopFlow rail must build its WallPro row from the shared app list");
  assert.ok(shopflow.includes('shopflowApp("patternpro")'),
    "the ShopFlow rail must build its PatternPro row from the shared app list");
  // The landing, the dead route and the house route must not come back in
  // EITHER file -- including the free-designs CTA, which had the same defect.
  assert.ok(!/href[=:]\s*"\/wall-wrap"/.test(both),
    "no ShopFlow link may open the WallPro landing; this dashboard opens apps");
  assert.ok(!/href[=:]\s*"\/wallpro"/.test(both),
    "ShopFlow must not send a WePrintWraps customer to the DesignProAI landing");
  assert.ok(!/href[=:]\s*"\/patternpro"/.test(both),
    "/patternpro has no route; the PatternPro tab must not point at it");

  // Both targets are real routes, and the WallPro one resolves to the TOOL.
  const app = read("app/src/App.tsx");
  assert.ok(app.includes('<Route path="/wallwrap-design" element={<WallPro brand="weprintwraps" />} />'),
    "/wallwrap-design must render the WallPro tool for the partner brand");
  assert.ok(app.includes('<Route path="/pattern-wrap"'), "/pattern-wrap must be routed");

  // And both are the LIGHT skin.
  assert.ok(read("app/src/lib/patternpro-brand.ts").includes("surface: 'light'"),
    "the WePrintWraps PatternPro brand must stay on the light surface");
  assert.ok(read("app/src/lib/wallpro-brand.ts").includes("surface: 'light'"),
    "the WePrintWraps WallPro brand must stay on the light surface");
});

test("the partner landing offers the way back to ShopFlow", () => {
  // The rail above sends the customer here, so the return trip must exist or
  // they are stranded on a marketing page. Partner brand only -- /shopflow is
  // a WePrintWraps surface and would be a stray door on the DesignProAI page.
  const landing = read("app/src/pages/WallProLanding.tsx");
  assert.ok(landing.includes(`brand === 'weprintwraps' && <Link className="wl-shopflow" to="/shopflow">`),
    "the partner header must link back to ShopFlow");
  assert.ok(landing.includes(`<Link className="wl-nav-shopflow" to="/shopflow">`),
    "the mobile nav must carry it too, since the header link hides at 800px");
});

/**
 * THE OWNER'S OWN ROOM IS NOT A SHOWCASE SLIDE (owner, 2026-09-17: "remove my
 * photo from the hero just show the others"). The `residential` slot is her
 * home spa -- the measured scale reference, not a portfolio piece. It is
 * excluded from the rotation and NOT deleted, so every other consumer still
 * reads it.
 */
test("the hero rotation excludes the owner's own room photo", () => {
  const landing = read("app/src/pages/WallProLanding.tsx");
  assert.ok(landing.includes("EXAMPLE_KEYS.filter(key => key !== 'residential')"),
    "the residential slot must stay out of the hero/examples rotation");
  // Excluded from the ROTATION, not removed from the media model.
  assert.ok(read("app/src/lib/wallpro-landing-content.ts").includes("key: 'residential'"),
    "the slot itself must survive so the admin row and other consumers keep working");
  // Opening on a slot that is no longer in the list would render nothing.
  assert.ok(landing.includes("useState(() => slides[0]?.slot ?? '')"),
    "the page must open on a slide that exists");
});

/**
 * THE PARTNER MARK SITS BESIDE THE WORDMARK (owner, 2026-09-17: "the logo is
 * distorted major and too big must be to the left not stacked").
 *
 * Both defects were one CSS line: `.wl-brand` is a column flex container, and
 * a column flex container stretches its children across the cross axis -- so a
 * logo with a fixed height and `width:auto` was stretched to the block's full
 * width, losing its aspect ratio. The row direction fixes the stacking and
 * `object-fit:contain` makes the distortion unreachable.
 */
test("the landing lockup is a row, and the mark cannot be stretched", () => {
  const css = read("app/src/pages/wallpro-landing.css");
  assert.ok(/\.wl-brand\s*\{[^}]*flex-direction:\s*row/.test(css),
    "the brand block must be a row, or the mark stacks above the wordmark again");
  assert.ok(/\.wl-partner-mark\s*\{[^}]*object-fit:\s*contain/.test(css),
    "the mark must keep its aspect ratio under any parent");
  assert.ok(/\.wl-partner-mark\s*\{[^}]*align-self:\s*center/.test(css),
    "the mark must stay off the stretch axis");
  // The wrapper the row depends on, and the two colour rules the wrapper
  // shifted down a level -- without these "Wall" is painted the accent blue.
  assert.ok(read("app/src/pages/WallProLanding.tsx").includes('<span className="wl-brand-text">'),
    "the wordmark needs its own column beside the mark");
  assert.ok(css.includes(".wl-brand > .wl-brand-text > span { color: inherit; }"),
    "the wordmark lead must not inherit the accent colour");
});

/**
 * NO SPA ON THE LANDING (owner, 2026-09-17: "it must be the other images the
 * fitness, etc not my photo").
 *
 * Excluding the residential slot from the hero was not enough: the workflow's
 * "Generate & refine" tile preferred that same slot, the Upload and Mark steps
 * used the spa's BEFORE frame, and both video posters were the spa's AFTER --
 * so the owner's own room came back four times below the fold. The landing's
 * defaults are the gym pair, which is a real before AND after of one room
 * already normalised to one canvas.
 *
 * The files stay on disk: the case study is ABOUT that room and the FAQ corner
 * figure measures its handle positions as fractions of that exact photograph.
 */
test("the landing's own media never defaults to the owner's room", () => {
  // Scoped to the slots the landing actually RENDERS. The residential slot
  // still names the spa and that is correct: it is excluded from the rotation
  // (asserted above), nothing else reads it any more, and it stays as an admin
  // row so the category can be re-pointed at a real residential room later.
  const rendered = read("app/src/lib/wallpro-landing-content.ts")
    .split("\n")
    .filter(line => /key: '(before|process|install)'/.test(line));
  assert.equal(rendered.length, 3, "the three rendered media slots must still exist");
  assert.ok(!rendered.some(line => line.includes("proof-spa")),
    "the workflow photo and both video posters must not default to the owner's room");
  // The workflow result tile followed the selected example, not the spa slot.
  assert.ok(read("app/src/pages/WallProLanding.tsx").includes("const result = active;"),
    "the Generate & refine tile must follow the selected example");
});
