import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PATTERNPRO'S 3D PROOF MUST CARRY ALL 7 ANGLES, THE SAME AS DESIGNPRO.
 *
 * Owner, 2026-09-18: "does patternpro provide the full 7 angles proof that
 * designproai does? If not wire it to patternpro and make sure it on
 * os.designproai pattern pro for WPW version and standard".
 *
 * PatternPro already rendered all 7 angles (ADDITIONAL_VIEW_TYPES: driver
 * side hero + passenger-side, hood_detail, front, rear, close-up, roof) and
 * already opened a 3D Proof dialog for them. But every one of the three
 * dialogs that build that view list (MobileProofSheet, the desktop
 * ProfessionalProofSheet, and StudioProofLayout) read the close-up view off
 * `additionalViews.closeup` -- a key that is never written; the view actually
 * lands under `additionalViews['close-up']` (the hyphenated key every other
 * PatternPro/DesignPro view-list build site already uses for it, e.g.
 * DesignProToolUI.tsx's own ProfessionalProofSheet wiring and
 * config/proofAngles.ts). So the Close-Up angle rendered every single time
 * and never showed on either PatternPro surface -- WPW tenant (/pattern-wrap)
 * and standalone (/printpro/patternpro) both render this one shared
 * WBTYToolUI, so one fix covers both.
 *
 * The 2D Proof (TwoDProofSheet) is UNCHANGED here on purpose: DesignPro's own
 * TwoDProofSheet wiring (DesignProToolUI.tsx) also carries only side /
 * passenger-side / front / rear / roof -- no hood_detail, no close-up -- so
 * PatternPro's identical 5-view 2D Proof is not a gap, it is parity.
 */
const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

const UI = read("app/src/components/productTools/WBTYToolUI.tsx");
const DESIGNPRO_UI = read("app/src/components/productTools/DesignProToolUI.tsx");

test("PatternPro never reads the unwritten 'closeup' key", () => {
  assert.ok(!UI.includes("additionalViews?.closeup"), "the stale key must be gone");
  assert.ok(!UI.includes("additionalViews.closeup"), "the stale key must be gone");
});

test("the three PatternPro proof dialogs source close-up from the real hyphenated key", () => {
  const matches = [...UI.matchAll(/\(additionalViews as any\)\?\.\['close-up'\]/g)];
  assert.equal(matches.length, 3, "MobileProofSheet, ProfessionalProofSheet, and StudioProofLayout each wire close-up");
});

test("PatternPro's 3D Proof (desktop) still carries all seven angles", () => {
  const start = UI.indexOf("<ProfessionalProofSheet");
  assert.ok(start > -1, "ProfessionalProofSheet is still wired into PatternPro");
  const block = UI.slice(start, start + 1600);
  for (const type of ["'side'", "'passenger-side'", "'hood_detail'", "'front'", "'rear'", "'close-up'", "'roof'"]) {
    assert.ok(block.includes(`type: ${type}`), `desktop 3D proof is missing ${type}`);
  }
});

test("PatternPro's 3D Proof (mobile) still carries all seven angles", () => {
  const start = UI.indexOf("<MobileProofSheet");
  assert.ok(start > -1, "MobileProofSheet is still wired into PatternPro");
  const block = UI.slice(start, start + 1600);
  for (const type of ["'side'", "'passenger-side'", "'hood_detail'", "'front'", "'rear'", "'close-up'", "'roof'"]) {
    assert.ok(block.includes(`type: ${type}`), `mobile 3D proof is missing ${type}`);
  }
});

test("PatternPro renders the same seven-angle set DesignPro does", () => {
  assert.ok(
    UI.includes("['passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof']"),
    "PatternPro's ADDITIONAL_VIEW_TYPES must stay the same six-view batch DesignPro renders",
  );
});

test("DesignPro's own 3D proof is the reference this lock matches PatternPro to", () => {
  assert.ok(DESIGNPRO_UI.includes("type: 'hood_detail'"));
  assert.ok(DESIGNPRO_UI.includes("type: 'close-up'"));
});

test("one shared PatternWrap component serves both /pattern-wrap (WPW) and /printpro/patternpro (standalone), so this fix reaches both", () => {
  const APP = read("app/src/App.tsx");
  assert.ok(APP.includes('path="/pattern-wrap"'));
  assert.ok(APP.includes('path="/printpro/patternpro"'));
  const PAGE = read("app/src/pages/PatternWrap.tsx");
  assert.ok(PAGE.includes("WBTYToolUI"), "PatternWrap renders the one WBTYToolUI this fix lives in");
});
