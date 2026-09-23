/**
 * A BRANDED PANEL MAY NOT BE EMPTIER THAN ITS OWN CLEAN TWIN.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Live 848be1c6 / revision a9d6dd85 (2026-09-23, New Aura Day Spa on a Prius).
 * The HOOD came back drawn as a hood silhouette floating on the document's own
 * white page, and it reached PanelPro as a promoted production panel. Owner:
 * "see hood also fail cut to share of hood that's wrong."
 *
 * Every number below is that revision's own `panelProofAuthoring.quadrants`,
 * copied out of the row, not invented. The defect and the five innocent
 * surfaces are therefore separated by the gate on real evidence rather than on
 * a fixture built to make it pass.
 *
 * WHAT WAS ALREADY WATCHING AND COULD NOT STOP IT — the reason this file
 * exists rather than a threshold being nudged somewhere else:
 *
 *   masterOutputClass  convicted it, `vehicle_depiction`, confidence 1.0,
 *                      evidence naming the hood in those words — and is
 *                      ADVISORY on this topology by the owner's 2026-09-21
 *                      ruling, so it refused nothing.
 *   edgeHoleRatio      0.000. A darkness test against a 248,248,248 surround.
 *   detectDieCut       convicts ENCLOSED page colour; this surround walks to
 *                      the cell border, which that file defines as margin.
 *   fit                0.8088 against 0.9841–1.0000, measured and consumed by
 *                      nothing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const {
  dieCutFindings, bandFitFindings, DIE_CUT_CONTRACT,
  MAX_BAND_FIT_DROP, SURFACE_FIT_DEFICIT_NOTICE, MIN_CORNER_PAGE_FRACTION,
} = require("../runtime/atlas-panel-proof-topology.cjs");

const CELL_W = 240;
const CELL_H = 160;

/** A cell filled corner to corner — the CORE PRINT RULE's only legal panel. */
async function filledCell() {
  return sharp({ create: { width: CELL_W, height: CELL_H, channels: 3, background: { r: 120, g: 40, b: 90 } } })
    .png().toBuffer();
}

/**
 * A cell whose artwork is a centred island on the page — the hood of 848be1c6.
 * The corners are page by construction, which is the whole signal.
 */
async function dieCutCell() {
  const inset = 26;
  return sharp({ create: { width: CELL_W, height: CELL_H, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([{
      input: await sharp({ create: { width: CELL_W - inset * 2, height: CELL_H - inset * 2, channels: 3,
        background: { r: 120, g: 40, b: 90 } } }).png().toBuffer(),
      left: inset, top: inset,
    }]).png().toBuffer();
}

/**
 * A correct full-bleed panel carrying a WHITE BANNER behind lettering. Page
 * colour by `inkFraction`, present only in the branded band, corners inked.
 * This is the innocent design the band comparison alone would have refused.
 */
async function bannerCell() {
  return sharp({ create: { width: CELL_W, height: CELL_H, channels: 3, background: { r: 120, g: 40, b: 90 } } })
    .composite([{
      input: await sharp({ create: { width: 150, height: 44, channels: 3,
        background: { r: 255, g: 255, b: 255 } } }).png().toBuffer(),
      left: 45, top: 58,
    }]).png().toBuffer();
}

/** revision a9d6dd85, metadata.panelProofAuthoring.quadrants[].fit */
const LIVE_848BE1C6 = {
  branded: [
    ["driver", 1], ["passenger", 1], ["roof", 1],
    ["hood", 0.8088], ["front", 0.9841], ["rear", 0.9844],
  ],
  clean: [
    ["driver", 1], ["passenger", 1], ["roof", 1],
    ["hood", 1], ["front", 0.9946], ["rear", 0.98],
  ],
};
const panels = (rows) => rows.map(([surfaceKey, fit]) => ({ surfaceKey, fit }));
const live = () => bandFitFindings(panels(LIVE_848BE1C6.branded), panels(LIVE_848BE1C6.clean));

test("848be1c6's hood is the only band-fit candidate", () => {
  const out = live();
  assert.equal(out.contract, DIE_CUT_CONTRACT);
  assert.deepEqual(out.candidates.map((c) => c.surfaceKey), ["hood"]);
  const hood = out.candidates[0];
  assert.equal(hood.brandedFit, 0.8088);
  assert.equal(hood.cleanFit, 1);
  assert.equal(hood.bandDrop, 0.1912);
  // The finding has to say what a person can act on: which surface, and that
  // the panel was drawn cut to shape rather than filled.
  assert.match(hood.finding, /^hood:/);
  assert.match(hood.finding, /cut to shape/);
});

test("the threshold clears the defect and the noise by a real margin", () => {
  const out = live();
  const bySurface = new Map(out.surfaces.map((s) => [s.surfaceKey, s]));
  // The guilty surface sits 3x above the threshold ...
  assert.ok(bySurface.get("hood").bandDrop > MAX_BAND_FIT_DROP * 3,
    `hood bandDrop ${bySurface.get("hood").bandDrop} should clear ${MAX_BAND_FIT_DROP} by 3x`);
  // ... and the worst innocent one 5x below it. A threshold that only just
  // separated the one run it was written from would be a fixture, not a gate.
  const innocent = out.surfaces.filter((s) => s.surfaceKey !== "hood").map((s) => s.bandDrop);
  assert.ok(Math.max(...innocent) < MAX_BAND_FIT_DROP / 5,
    `worst innocent bandDrop ${Math.max(...innocent)} should sit well under ${MAX_BAND_FIT_DROP}`);
});

test("a design that is light in BOTH bands is never convicted", () => {
  // RULE 0.32 refused `measurePlainSurround` as a gate because this repo's own
  // full-bleed fixtures — a flat ground with graphics inset from the edge —
  // score at the extreme and are correct. A fit FLOOR would convict this sheet.
  // The comparison does not, because type adds ink and both bands are equally
  // light: the difference, not the level, is what is judged.
  const pale = [["driver", 0.34], ["passenger", 0.34], ["roof", 0.31],
    ["hood", 0.29], ["front", 0.33], ["rear", 0.32]];
  const out = bandFitFindings(panels(pale), panels(pale));
  assert.deepEqual(out.candidates, []);
  assert.deepEqual(out.notices, []);
});

test("lettering may ADD ink without limit — only a drop convicts", () => {
  // Zone 1 is Zone 2 plus type, so branded is normally >= clean. A big positive
  // difference is a heavily lettered panel, which is the product working.
  const branded = [["driver", 0.99], ["passenger", 0.99], ["roof", 0.6],
    ["hood", 0.95], ["front", 0.9], ["rear", 0.93]];
  const clean = [["driver", 0.55], ["passenger", 0.55], ["roof", 0.6],
    ["hood", 0.5], ["front", 0.45], ["rear", 0.5]];
  assert.deepEqual(bandFitFindings(panels(branded), panels(clean)).candidates, []);
});

test("a surface short in both bands is NOTICED, never refused", () => {
  // The die-cut this comparison cannot see: present in Zone 1 AND Zone 2, so
  // the band difference is zero. Recorded because no fixture yet proves a
  // cross-surface deficit will not convict a legitimately lighter panel —
  // `atlas-proof-zone-gate.cjs` is the precedent for measuring without
  // refusing. Promoting it needs a discriminator, not a threshold.
  const both = [["driver", 0.98], ["passenger", 0.98], ["roof", 0.97],
    ["hood", 0.6], ["front", 0.96], ["rear", 0.97]];
  const out = bandFitFindings(panels(both), panels(both));
  assert.deepEqual(out.candidates, []);
  assert.deepEqual(out.notices.map((n) => n.surfaceKey), ["hood"]);
  assert.ok(out.notices[0].brandedDeficit > SURFACE_FIT_DEFICIT_NOTICE);
});

test("an unmeasured cell is left to the checks that own it", () => {
  // A missing twin or an unreadable fit is a positional-premise failure, and
  // that check already refuses above. Guessing here would convict a surface
  // for a fault in a different instrument.
  const out = bandFitFindings(
    [{ surfaceKey: "hood", fit: 0.4 }, { surfaceKey: "driver", fit: null }],
    [{ surfaceKey: "driver", fit: 1 }],
  );
  assert.deepEqual(out.candidates, []);
  assert.deepEqual(out.surfaces, []);
});

test("the gate is wired to REFUSE with the sheet identity, and only on the sheet path", () => {
  const src = readFileSync(new URL("../runtime/atlas-panel-proof-topology.cjs", import.meta.url), "utf8");
  // `refuse()` is what attaches `details.sheet.contentHash`, and a refusal
  // carrying a real sha256 is what flat-first-atlas classifies as CREATIVE —
  // the difference between re-rolling the bounded second candidate and killing
  // the run. A bare `throw new Error` here would leave the customer with
  // nothing, which is the outcome the owner ruled out on 2026-09-21.
  assert.match(src, /if \(dieCut\.convicted\.length\) \{\s*\n\s*throw refuse\(/,
    "a conviction must go through refuse(), which names the sheet it judged");
  // Derived revisions composite Zone 1 by code and carry a hardcoded clean
  // `fit: 1`, so the comparison is meaningless there and would convict every
  // legacy revision.
  assert.match(src, /if \(zone1\.length === 6\) \{\s*\n\s*dieCut = await dieCutFindings\(zone1, zone2, \{ sharp \}\);/,
    "the gate must run only when six Zone 1 cells came off the sheet");
  // The measurements survive onto the receipt on a CLEAN sheet — a convicted
  // one never reaches a receipt, so without this there is no record to judge
  // the thresholds from later.
  assert.match(src, /dieCut \},/, "threeZoneLayout must carry the die-cut measurements");
});


/* ── the corner discriminator, on real pixels ──────────────────────────── */

test("a die-cut candidate whose corners are page IS convicted", async () => {
  const branded = [{ surfaceKey: "hood", fit: 0.8088, bytes: await dieCutCell() },
    { surfaceKey: "driver", fit: 1, bytes: await filledCell() }];
  const clean = [{ surfaceKey: "hood", fit: 1 }, { surfaceKey: "driver", fit: 1 }];
  const out = await dieCutFindings(branded, clean, { sharp });
  assert.deepEqual(out.convicted.map((c) => c.surfaceKey), ["hood"]);
  assert.ok(out.convicted[0].cornerPageFraction >= MIN_CORNER_PAGE_FRACTION);
  assert.deepEqual(out.cleared, []);
});

test("a WHITE BANNER behind lettering is cleared, not refused", async () => {
  // The innocent case the band comparison alone cannot tell from a die-cut:
  // page colour present only in the branded band, big enough to clear
  // MAX_BAND_FIT_DROP. Its corners are artwork, so it is not a trimmed outline.
  const bytes = await bannerCell();
  const branded = [{ surfaceKey: "hood", fit: 0.83, bytes }];
  const clean = [{ surfaceKey: "hood", fit: 1 }];
  const out = await dieCutFindings(branded, clean, { sharp });
  // It IS a candidate on ink alone — the band drop is 0.17, worse than the
  // live hood's — and the corners are what clear it.
  assert.deepEqual(out.candidates.map((c) => c.surfaceKey), ["hood"]);
  assert.deepEqual(out.convicted, []);
  assert.deepEqual(out.cleared.map((c) => c.surfaceKey), ["hood"]);
  assert.ok(out.cleared[0].cornerPageFraction < MIN_CORNER_PAGE_FRACTION);
  assert.match(out.cleared[0].clearedBecause, /corners carry artwork/);
});

test("the two cases sit either side of an EMPTY gap, not against a tuned edge", async () => {
  const dieCut = await dieCutFindings(
    [{ surfaceKey: "hood", fit: 0.8, bytes: await dieCutCell() }], [{ surfaceKey: "hood", fit: 1 }], { sharp });
  const banner = await dieCutFindings(
    [{ surfaceKey: "hood", fit: 0.83, bytes: await bannerCell() }], [{ surfaceKey: "hood", fit: 1 }], { sharp });
  assert.equal(dieCut.convicted[0].cornerPageFraction, 1);
  assert.equal(banner.cleared[0].cornerPageFraction, 0);
  // A threshold in the middle of 0 and 1 is not a number anyone tuned.
  assert.ok(MIN_CORNER_PAGE_FRACTION > 0 && MIN_CORNER_PAGE_FRACTION < 1);
});

test("an unmeasurable corner CLEARS the candidate", async () => {
  // Refusing a sheet because a measurement failed would convict it for a fault
  // in a different instrument — the same reasoning as `fitOf` above.
  const out = await dieCutFindings(
    [{ surfaceKey: "hood", fit: 0.5 }], [{ surfaceKey: "hood", fit: 1 }], { sharp });
  assert.deepEqual(out.convicted, []);
  assert.equal(out.cleared[0].cornerPageFraction, null);
  assert.match(out.cleared[0].clearedBecause, /could not be measured/);
});
