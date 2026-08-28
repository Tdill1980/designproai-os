/**
 * THE INTAKE DOES NOT INTERROGATE THE CUSTOMER, AND DOES NOT DISCARD THEIR DATA.
 *
 * Owner, 2026-08-28: "Don't ask: Commercial or Restyle? The customer shouldn't
 * need to understand your internal design taxonomy. Infer it." And: "No hard
 * blocks — just add the enter button, it sends to DesignProAI to process
 * appropriately."
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

test("the customer is never asked to choose Commercial or Restyle", () => {
  // What is forbidden is a CONTROL that asks them. `setMode` itself is still
  // legitimate where the system learns the answer on its own -- the LogoPro
  // handoff injects a logo and sets commercial, which is an inference from a
  // real event, not a question.
  assert.equal(/onClick=\{\(\) => setMode\(/.test(intake), false,
    "a mode selector is back on the intake");
  assert.equal(/MODES\.map/.test(home), false,
    "the home page's mode selector is back");
  // And the cards themselves, by their copy.
  for (const copy of ["Artistic &amp; Style Wraps", "Business &amp; Fleet Wraps"]) {
    assert.equal(intake.includes(copy), false, `the "${copy}" card is back`);
  }
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
  // Brand and Logo report `neutral` when absent. Marking a restyle customer
  // deficient for having no company name would be the taxonomy question we just
  // deleted, smuggled back as an icon.
  const brand = chips[0].slice(chips[0].indexOf('"Brand"'), chips[0].indexOf('"Logo"'));
  assert.equal(brand.includes('"warn"'), false, "the Brand chip warns; absent is not wrong");
});
