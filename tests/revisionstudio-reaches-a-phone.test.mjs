/**
 * THE SURFACES A PHONE ACTUALLY GETS — 60% OF THIS PRODUCT'S TRAFFIC.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-23: *"It better be mobile friendly 60% of our users will be
 * using on a mobile phone"*, and, on the Design Library: a grid of broken-image
 * icons where her designs should be.
 *
 * Three defects, each measured in the source rather than inferred from a
 * screenshot, and each a DIFFERENT failure mode:
 *
 * 1. A SIGNED LINK IS A FIVE-MINUTE LEASE. `thumbnailUrl` is signed
 *    `expiresIn: 300` by the gateway and the row's own type says so. The
 *    library fetched once and never again, so a grid left open past five
 *    minutes had every link dead underneath it and the browser painted its
 *    broken-image icon over perfectly good designs. The remedy is renewal
 *    BEFORE expiry, plus an honest tile when one breaks anyway -- it must not
 *    borrow the "produced no image" copy, which reports a live design as a
 *    failed one.
 *
 * 2. SEVEN COLUMNS IS A DESKTOP NUMBER. `grid-cols-7` with no breakpoint left
 *    each proof ~45px wide on a 375px phone.
 *
 * 3. A CONTROL THAT ONLY EXISTS ON HOVER DOES NOT EXIST ON A PHONE.
 *    `opacity-0 group-hover:opacity-100` is permanently invisible on touch, and
 *    one of the two sites is the ONLY way to remove an uploaded reference
 *    image. Visible by default, hover-fade restored only under
 *    `@media (hover: hover)`, so the desktop is unchanged.
 *
 * ⛔ WHAT THIS FILE DELIBERATELY DOES NOT ASSERT. `ProductionWorkflow`'s
 * `min-w-[520px]` table was reported as a fourth mobile defect in the same
 * pass. It is not one: the table is already inside `overflow-x-auto`, which is
 * the correct pattern for a wide table on a narrow screen. Asserting against it
 * would have locked in a fix for a defect that was never there -- the shape
 * CLAUDE.md records nine times as "a lock encoding the thing it was written to
 * prevent". It is named here so the next session does not re-report it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const LIBRARY = "app/src/components/revisioniq/DesignLibrary.tsx";
const STUDIO = "app/src/pages/RevisionStudioIQ.tsx";
const WORKFLOW = "app/src/pages/designpro/ProductionWorkflow.tsx";

/** Comments explain the defects by name; only executable JSX/TS counts. */
const code = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("the library renews its signed thumbnails before the five-minute lease ends", () => {
  const src = code(read(LIBRARY));
  // The TTL is the gateway's, not a number picked here: 300s, and the renewal
  // must be STRICTLY earlier or it races the expiry it exists to beat.
  const ttl = /THUMBNAIL_TTL_MS\s*=\s*([\d_]+)/.exec(src);
  const renew = /THUMBNAIL_RENEW_MS\s*=\s*THUMBNAIL_TTL_MS\s*-\s*([\d_]+)/.exec(src);
  assert.ok(ttl, "the lease length must be named, not scattered as a literal");
  assert.equal(Number(ttl[1].replace(/_/g, "")), 300_000,
    "the gateway signs expiresIn: 300 — this must track it");
  assert.ok(renew, "the renewal must be derived from the TTL, so the two cannot drift");
  assert.ok(Number(renew[1].replace(/_/g, "")) > 0,
    "renewing AT the expiry is renewing after it, for any non-zero round trip");
  // Something must actually re-run the fetch on that timer.
  assert.match(src, /setTimeout\(\s*renew\s*,\s*THUMBNAIL_RENEW_MS\s*\)/,
    "a constant nothing arms is not a renewal");
  assert.match(src, /setReloadKey\(\(key\) => key \+ 1\)/,
    "renewal must re-run the library fetch, which is what re-signs the links");
});

test("a phone in a pocket re-signs on return, and a hidden tab renews nothing", () => {
  const src = code(read(LIBRARY));
  assert.match(src, /visibilitychange/,
    "the common case is a phone away for longer than the lease");
  assert.match(src, /visibilityState === "hidden"/,
    "a background tab must stop renewing — that is a signing request per tile "
    + "for a grid nobody is reading");
});

test("a broken tile reports a preview failure, never that the design produced nothing", () => {
  const src = code(read(LIBRARY));
  assert.match(src, /onError=/, "without this the browser paints its own broken-image icon");
  assert.match(src, /Preview unavailable/,
    "an image error does not prove expiry or missing artwork");

  // THE ORDER OF THE REASONS IS THE WHOLE POINT. A design WITH a thumbnailUrl
  // that failed to load must reach the preview-error copy BEFORE the failure copy,
  // or the UI reports a live design as a dead one.
  const expired = src.indexOf("Preview unavailable");
  const producedNone = src.indexOf("This design produced no image");
  assert.ok(expired > -1 && producedNone > -1);
  assert.ok(expired < producedNone,
    "a failed preview must not be reported as a failed design");

  assert.match(src, /Refreshing preview/, "pending renewal has its own truthful loading state");

  // And the tile must be chosen on BOTH facts, or a broken link keeps
  // rendering the dead <img> forever.
  assert.match(src, /entry\.thumbnailUrl && !expired\.has\(entry\.generationId\)/,
    "the tile decides on the link AND on whether it loaded");
  // A successful fetch carries fresh links, so yesterday's failures must clear.
  assert.match(src, /setEntries\(rows\); setExpired\(new Set\(\)\)/,
    "new links must clear the old failures, or a tile stays broken forever");
});

test("the seven proof views reflow instead of shrinking to stamps", () => {
  const src = code(read(STUDIO));
  assert.doesNotMatch(src, /"grid grid-cols-7 /,
    "seven across with no breakpoint is ~45px per proof on a 375px phone");
  assert.match(src, /grid-cols-3 sm:grid-cols-4 lg:grid-cols-7/,
    "same seven views at every width; only how many share a row changes");
});

test("no control is reachable only by hovering", () => {
  const src = code(read(STUDIO));
  // The bare pattern is the defect. Under @media (hover:hover) it is correct,
  // so the assertion is on the UNGUARDED form only.
  const bare = src.match(/(?<!\]:)opacity-0 group-hover:opacity-100/g) || [];
  assert.equal(bare.length, 0,
    `${bare.length} control(s) hidden behind hover alone — invisible on touch, `
    + "and one of them is the only way to remove a reference image");
  assert.match(src, /\[@media\(hover:hover\)\]:opacity-0/,
    "the desktop fade is kept, scoped to pointers that can actually hover");
});

test("the wide output table is left alone — overflow-x-auto is already correct", () => {
  const src = read(WORKFLOW);
  // Recorded as a NON-defect so it is not 'fixed' into a regression later.
  const i = src.indexOf('min-w-[520px]');
  assert.ok(i > -1, "the table still states its minimum width");
  assert.ok(src.lastIndexOf("overflow-x-auto", i) > -1,
    "a wide table inside a horizontal scroller is the right pattern, not a defect");
});
