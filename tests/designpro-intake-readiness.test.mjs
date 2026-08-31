/**
 * THE INTAKE PRESERVES THE ORIGINAL MODE CONTROLS AND NEVER DISCARDS DATA.
 *
 * Owner, 2026-08-31: restore the original Commercial/ReStyle buttons. The
 * explicit choice is immutable request input and must reach A.T.L.A.S.
 *
 * Two things this locks, and the second is the one that actually cost money.
 *
 * 1. NO HARD BLOCKS. `canGenerate` may not encode a judgement about whether the
 *    customer's input is good enough. Only in-flight guards survive.
 *
 * 2. NO MODE-GATED FIELDS. Nine values used to be sent as
 *    `mode === "commercial" ? x : undefined` — companyName, phone, mascot,
 *    bulletPoints, industryType, brandColors, fontStyle, qrEnabled, qrUrl. A
 *    customer who typed a phone number while the ReStyle card happened to be
 *    highlighted had it dropped on the way to the wrap, silently. That is also
 *    circular: mode is INFERRED from those same values downstream, so gating
 *    them on it meant the inference could never see them.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const intake = readFileSync(
  new URL("../app/src/components/designpanelpro/AiPanelGenerator.tsx", import.meta.url),
  "utf8",
);
const home = readFileSync(
  new URL("../app/src/pages/DesignProAIHome.tsx", import.meta.url),
  "utf8",
);
const premium = readFileSync(
  new URL("../app/src/pages/DesignPanelProPremium.tsx", import.meta.url),
  "utf8",
);

test("the original Commercial and ReStyle controls are present and accessible", () => {
  for (const [mode, copy] of [
    ["restyle", "Artistic &amp; Style Wraps"],
    ["commercial", "Business &amp; Fleet Wraps"],
  ]) {
    assert.ok(intake.includes(copy), `the original "${copy}" card is missing`);
    assert.match(intake, new RegExp(`onClick=\\{\\(\\) => setMode\\("${mode}"\\)\\}`));
  }
  assert.match(intake, /aria-label="Design type"/);
  assert.match(intake, /aria-pressed=\{mode === "restyle"\}/);
  assert.match(intake, /aria-pressed=\{mode === "commercial"\}/);
});

test("no field the customer filled in is discarded by a mode check", () => {
  for (const field of [
    "companyName", "phone", "mascot", "bulletPoints",
    "industryType", "brandColors", "fontStyle", "qrEnabled", "qrUrl",
  ]) {
    assert.equal(
      new RegExp(`${field}:\\s*mode === ["']commercial["']`).test(intake),
      false,
      `${field} is gated on the mode again — a customer's own input may not be dropped`,
    );
  }
  // And the same on the home handoff.
  assert.equal(/mode === ["']Commercial["'] \? \(/.test(home), false,
    "the home page gates its identity fields on the mode again");
});

test("nothing about the customer's input disables Generate", () => {
  const match = intake.match(/const canGenerate =([\s\S]*?);/);
  assert.ok(match, "canGenerate is gone entirely — the button needs a submit guard");
  const condition = match[1];
  // In-flight guards are fine: they stop a double submit, they do not judge.
  for (const forbidden of ["prompt.trim()", "companyName", "textLayerImages", "filmManufacturer", "filmColorName", "mode ==="]) {
    assert.equal(condition.includes(forbidden), false,
      `canGenerate blocks on ${forbidden} — the owner's rule is no hard blocks`);
  }
});

test("the readiness strip is informational, and Dimensions is the only chip that can warn", () => {
  assert.match(intake, /GenerateReadiness/);
  const chips = intake.match(/const readinessChips[\s\S]*?\n  \];/);
  assert.ok(chips, "the readiness chips are gone");
  for (const label of ["Vehicle", "Brief", "Brand", "Logo", "Dimensions"]) {
    assert.ok(chips[0].includes(`"${label}"`), `the ${label} chip is missing`);
  }
  // Brand and Logo report `neutral` when absent; the explicit mode choice does
  // not turn optional creative inputs into a submission block.
  const brand = chips[0].slice(chips[0].indexOf('"Brand"'), chips[0].indexOf('"Logo"'));
  assert.equal(brand.includes('"warn"'), false, "the Brand chip warns; absent is not wrong");
});

test("a failure preserves the exact prompt and returns the customer to it", () => {
  assert.match(intake, /DESIGN_INTAKE_DRAFT_KEY/);
  assert.match(intake, /sessionStorage\.setItem\(DESIGN_INTAKE_DRAFT_KEY/);
  assert.match(intake, /initialPrompt \|\| intakeDraftRef\.current\?\.prompt \|\| ""/);
  assert.match(premium, /\(embedded \|\| !leftColOpen\) && "hidden"/,
    "the intake should hide, not unmount, while the canvas is open");
  assert.match(premium, /clearGenerationError\(\);[\s\S]*?invalidateDesignPrep\(\);[\s\S]*?setLeftColOpen\(true\);/);
});
