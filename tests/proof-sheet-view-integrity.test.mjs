/**
 * THE APPROVAL PROOF SHOWS EACH SIDE ONCE, AS ITSELF, WITH A LIVE URL.
 *
 * Three defects the owner reported on 2026-08-31, all in the customer-facing
 * approval sheet, all with different causes:
 *
 *   "3d proof must have correct sides shown ... yet it's showing two hoods."
 *   "show 3d proof button but when clicked it's blank."
 *
 * 1. TWO HOODS. `getViewByType` matches by SUBSTRING, and the close-up slot's
 *    pattern list ended in 'detail'. The only canonical view type containing
 *    "detail" is `hood_detail` -- the view already bound to the Hood slot. So
 *    any generation whose close-up was missing or refused rendered the hood
 *    twice, under two different names, on a sheet a customer signs.
 *
 * 2. MIRRORED PASSENGER. A missing passenger view fell back to the driver
 *    render under a CSS scaleX(-1). RULE 0: "Passenger is its own named Call-1
 *    authority and must never be replaced by mirrored Driver pixels." On a wrap
 *    carrying lettering that flip prints the customer's own phone number and
 *    domain backwards.
 *
 * 3. BLANK SHEET. Gateway artifact urls are signed into the private wrap-files
 *    bucket with `expiresIn: 300`. The grid builds `render_urls` from those at
 *    load, `staleTime` is two minutes, `refetchOnWindowFocus` is false, and
 *    nothing in the client reads `expiresIn` at all. Open a proof more than
 *    five minutes after landing -- which is nearly every real visit, since you
 *    look at the design before you approve it -- and every <img> points at a
 *    dead signature.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

const sheet = readFileSync(new URL("../app/src/components/tools/ProfessionalProofSheet.tsx", import.meta.url), "utf8");
const studio = readFileSync(new URL("../app/src/pages/RevisionStudioIQ.tsx", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");

test("the close-up slot never matches the hood", () => {
  const closeUp = sheet.match(/const closeUpView = getViewByType\(\[[^\]]*\]\)/);
  assert.ok(closeUp, "the close-up slot resolution is gone");
  assert.ok(!/detail/i.test(closeUp[0]),
    `the close-up pattern list still contains a 'detail' substring, which matches hood_detail: ${closeUp[0]}`);
  // And the hood still resolves, so removing the alias did not cost the Hood
  // slot its own view.
  assert.match(sheet, /const hoodView = getViewByType\(\['hood', 'hood_detail'\]\)/);
});

test("a matcher that resolves two slots to one view is what this guards", () => {
  // The bug class, stated as an executable rule rather than a comment: run the
  // real matching semantics over the canonical view vocabulary and assert no
  // two slots claim the same view. This is what a future edit to any pattern
  // list has to keep true, not just the close-up one.
  const VIEW_TYPES = ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];
  const patterns = {};
  for (const [, name, list, exclude] of sheet.matchAll(
    /const (\w+View) = getViewByType\(\[([^\]]*)\](?:, \[([^\]]*)\])?\)/g,
  )) {
    patterns[name] = {
      types: list.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean),
      exclude: (exclude || "").split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean),
    };
  }
  assert.ok(Object.keys(patterns).length >= 6, "the slot resolvers could not be read");

  // The component's own algorithm, transcribed: first pattern that matches any
  // view type, skipping excluded ones.
  const resolve = ({ types, exclude }) => {
    for (const type of types) {
      const hit = VIEW_TYPES.find((vt) => {
        if (exclude.some((ex) => vt.toLowerCase().includes(ex.toLowerCase()))) return false;
        return vt.toLowerCase().includes(type.toLowerCase());
      });
      if (hit) return hit;
    }
    return undefined;
  };

  const claimed = new Map();
  for (const [slot, spec] of Object.entries(patterns)) {
    const view = resolve(spec);
    if (!view) continue;
    assert.ok(!claimed.has(view),
      `${slot} and ${claimed.get(view)} both resolve to "${view}" -- the sheet would show it twice under two names`);
    claimed.set(view, slot);
  }
  // With a complete view set every slot must find its own view.
  assert.equal(claimed.size, 7, `expected all seven views claimed exactly once, got ${claimed.size}`);
});

test("a design tool never mirrors driver into the passenger slot", () => {
  assert.match(sheet, /const mirrorForbidden = resolvedToolKey === 'designpanelpro'/,
    "the mirror ban must be scoped by tool, not removed and not left global");
  assert.match(sheet, /const passengerIsFlipped = !passengerView && !!sideView && !mirrorForbidden/,
    "a DesignProAI sheet must not flip the driver render into the passenger slot");
  assert.match(sheet, /const effectivePassengerView = passengerView \|\| \(mirrorForbidden \? undefined : sideView\)/,
    "a DesignProAI sheet with no passenger view must render the empty placeholder, not the driver");
});

test("the gateway still signs artifact urls short, so re-signing is required", () => {
  // If this ever stops being true the re-sign below is redundant rather than
  // wrong -- but the reasoning in RevisionStudioIQ cites this number, so it is
  // asserted here rather than left as prose.
  assert.match(gateway, /expiresIn: 300/,
    "the gateway no longer signs at 300s; re-check whether the proof re-sign is still needed");
});

test("opening a proof re-signs the views first", () => {
  assert.match(studio, /const openWithFreshViews = useCallback/,
    "there must be one re-sign boundary, not a copy at each call site");
  assert.match(studio, /readRevisionStudioDesign\(id\)/,
    "the re-sign must ask the server for fresh signed urls");

  // Both proof buttons go through it. A future third proof surface that skips
  // this is the same bug again.
  assert.match(studio, /onClick=\{\(\) => \{ void openWithFreshViews\(setShow2DProofSheet\); \}\}/,
    "the 2D Proof button must re-sign before opening");
  assert.match(studio, /void openWithFreshViews\(setShowProofSheet\);/,
    "the 3D Proof button must re-sign before opening");
  assert.ok(!/setShowProofSheet\(true\)/.test(studio),
    "a proof dialog is still opened directly, bypassing the re-sign");
  assert.ok(!/setShow2DProofSheet\(true\)/.test(studio),
    "the 2D proof dialog is still opened directly, bypassing the re-sign");
});

test("the re-sign opens the dialog even when the read fails", () => {
  const fn = studio.slice(
    studio.indexOf("const openWithFreshViews = useCallback"),
    studio.indexOf("Fetch version chain for selected render"),
  );
  // A click that does nothing is worse than a stale sheet: the stale sheet is
  // what the customer already sees, and a swallowed click reads as a dead
  // button.
  assert.ok(fn.indexOf("open(true)") < fn.indexOf("readRevisionStudioDesign"),
    "the dialog must open before the network read, so a slow or failed re-sign cannot swallow the click");
  assert.match(fn, /\.catch\(\(\) => null\)/,
    "a failed re-sign must degrade to the stale sheet, never throw into the click handler");
});
