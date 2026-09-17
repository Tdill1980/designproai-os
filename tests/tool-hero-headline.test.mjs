import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * VEHICLEPRO AND CUTPRO GET THE SAME ABOVE-THE-SCROLL HERO WALLPRO SHIPPED
 * (Trish 2026-09-17: "what about the wallpro redesign I gave you").
 *
 * WallPro's own hero (`WallPro.tsx`) pairs a headline + subcopy with the
 * curator-managed proof band and clears once a design already exists on
 * screen, so a visitor with their own work in progress is never shown
 * marketing copy above it. This locks that VehiclePro and CutPro carry the
 * same shape: a headline, and the SAME `useToolProofBand` hook WallPro's
 * admin page also drives (no invented case-study/FAQ links to pages that
 * do not exist for these two tools).
 */
const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const VEHICLEPRO = read("app/src/pages/DesignPanelProPremium.tsx");
const CUTPRO = read("app/src/pages/GraphicsProV1.tsx");

test("VehiclePro carries an on-demand headline hero, gated on no existing design", () => {
  assert.match(VEHICLEPRO, /On-demand vehicle wrap/);
  assert.match(VEHICLEPRO, /!embedded && !pushedRender/);
});

test("CutPro carries an on-demand headline hero", () => {
  assert.match(CUTPRO, /On-demand cut graphics/);
});

test("neither hero invents a case-study or FAQ link that does not exist for that tool", () => {
  for (const src of [VEHICLEPRO, CUTPRO]) {
    assert.doesNotMatch(src, /to=["']\/wall-wrap/);
    assert.doesNotMatch(src, /href=["']\/wall-wrap/);
  }
});

test("both heroes read the curator-managed proof band through useToolProofBand, never a duplicate producer", () => {
  assert.match(VEHICLEPRO, /useToolProofBand\('vehiclepro'\)/);
  assert.match(CUTPRO, /useToolProofBand\('cutpro'\)/);
});
