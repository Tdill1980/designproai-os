/**
 * THE CUSTOMER STILL CHOOSES COMMERCIAL OR RESTYLE. IT JUST STOPS DELETING
 * WHAT THEY TYPED.
 *
 * ⛔ THE MODE CONTROL WAS DELETED ON 2026-08-28 AND PUT BACK THE SAME DAY.
 * Owner: "Why did you take out the question. I never said to remove commercial
 * / or restyle. I said use the correct designpanelai generate. There is a
 * specific ATLAS version." Two different instructions; only the second was
 * given, and a session acted on the first.
 *
 * The mode is not an internal label. `design-panel-ai-generate` branches on it
 * — COMMERCIAL_DEPTH, COMMERCIAL_TRANSLATION and buildLogoArchitecture against
 * the restyle style presets are different creative assemblies, and the
 * atlasFlatMaster branch keeps both — so deleting the control took half of
 * A.C.E. out of the customer's reach.
 *
 * What stays fixed is the defect that rode on it, and it is the one that cost
 * money:
 *
 * 1. NO MODE-GATED FIELDS. Nine values used to be sent as
 *    `mode === "commercial" ? x : undefined` — companyName, phone, mascot,
 *    bulletPoints, industryType, brandColors, fontStyle, qrEnabled, qrUrl. A
 *    customer who typed a phone number while the ReStyle card happened to be
 *    highlighted had it dropped on the way to the wrap, silently. The choice
 *    selects the creative assembly; it may not erase their input.
 *
 * 2. NO HARD BLOCKS. `canGenerate` may not encode a judgement about whether the
 *    customer's input is good enough. Only in-flight guards survive. ("No hard
 *    blocks — just add the enter button, it sends to DesignProAI to process
 *    appropriately.")
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

test("the customer can choose Commercial or Restyle, on both intakes", () => {
  assert.match(intake, /onClick=\{\(\) => setMode\("restyle"\)\}/,
    "the ReStyle card lost its control");
  assert.match(intake, /onClick=\{\(\) => setMode\("commercial"\)\}/,
    "the Commercial card lost its control");
  for (const copy of ["Artistic &amp; Style Wraps", "Business &amp; Fleet Wraps"]) {
    assert.ok(intake.includes(copy), `the "${copy}" card is missing`);
  }
  assert.match(home, /MODES\.map/, "the home page's mode selector is missing");
  assert.match(home, /const \[mode, setMode\] = useState\("Commercial"\)/,
    "the home page stopped letting the customer choose");
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
  // And the same on the home handoff: the three identity fields travel
  // whatever the mode button says.
  for (const field of ["companyName", "phone", "website"]) {
    assert.equal(
      new RegExp(`${field}: mode === ["']Commercial["']`).test(home),
      false,
      `${field} is gated on the mode again on the home intake`,
    );
  }
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
