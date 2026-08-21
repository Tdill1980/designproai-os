import { strict as assert } from "node:assert";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const universal = require(join(root, "runtime", "genie-universal-resolver.cjs"));
const claimantSource = readFileSync(join(root, "runtime", "designpro-standalone-claimant.cjs"), "utf8");
const workerSource = readFileSync(join(root, "runtime", "generation-worker.cjs"), "utf8");
const { deriveSurfaces, derivedSurfaces } = universal._test;

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
const PORSCHE = { overall_length_in: 178.6, overall_width_in: 74.9, overall_height_in: 51.3, wheelbase_in: 96.5 };

test("a grounded vehicle derives all six surfaces without a human", () => {
  const derived = deriveSurfaces({}, PORSCHE);
  assert.ok(derived, "grounded overall dimensions alone must be enough to derive");
  for (const key of SURFACES) {
    assert.ok(derived.surfaces[key].widthInches > 0 && derived.surfaces[key].heightInches > 0, `${key} must be derived`);
  }
});

/**
 * The original names this case in its own comment: a Ram 2500 mega cab grounded
 * to ~260" on a ~247" truck. A side panel runs the length of the body, so it
 * can never exceed it -- and an oversized panel is the one error that survives
 * all the way to a print file.
 */
test("a side panel can never exceed the vehicle it wraps", () => {
  const truck = { overall_length_in: 247, overall_width_in: 82, overall_height_in: 81, wheelbase_in: 160 };
  const derived = deriveSurfaces({ sideWidth: 260, sideHeight: 56 }, truck);
  assert.ok(derived.surfaces.driver.widthInches <= truck.overall_length_in,
    "the clamp must bring an overshooting side width back inside overall length");
  assert.equal(derived.derivation.clampedToOverallLength, true, "a clamped derivation must say so");
});

test("out-of-range geometry parks rather than deriving a plausible wrong panel", () => {
  assert.equal(deriveSurfaces({ sideWidth: 40, sideHeight: 20 },
    { overall_length_in: 60, overall_width_in: 40, overall_height_in: 30, wheelbase_in: 40 }), null);
  assert.equal(deriveSurfaces({ sideWidth: 200, sideHeight: 56 },
    { overall_length_in: 247, overall_width_in: 82, overall_height_in: 81, wheelbase_in: 900 }), null,
    "an impossible wheelbase must reject the whole derivation");
});

test("a transposed side pair is corrected, not accepted", () => {
  // Both values must be inside their own ranges for the swap to be reachable:
  // a wildly transposed pair (56 x 163) is REJECTED by the range guard first,
  // which is the source's behaviour too. The swap catches the near case, where
  // both numbers are plausible and only their order is wrong.
  const derived = deriveSurfaces({ sideWidth: 100, sideHeight: 110 },
    { overall_length_in: 180, overall_width_in: 80, overall_height_in: 70, wheelbase_in: 120 });
  assert.equal(derived.surfaces.driver.widthInches, 110);
  assert.equal(derived.surfaces.driver.heightInches, 100);
});

test("a wildly transposed pair is rejected outright rather than silently swapped", () => {
  assert.equal(deriveSurfaces({ sideWidth: 56, sideHeight: 163 },
    { overall_length_in: 180, overall_width_in: 80, overall_height_in: 70, wheelbase_in: 120 }), null,
    "163\" is outside the side-height range; rescuing it by swapping would launder a bad read");
});

test("derived surfaces never claim a human validated them", () => {
  const row = { id: "r1", make: "Porsche", model: "911 Turbo", source_urls: ["https://example.test/spec"], panels: deriveSurfaces({}, PORSCHE) };
  const read = derivedSurfaces(row);
  assert.equal(read.universalValidation.provenance, "grounded-derived");
  assert.equal(read.universalValidation.validatorId, null, "a derivation has no validator");
  assert.equal(read.universalValidation.validatedAt, null, "a derivation has no validation date");
  // The one number with no restylepro precedent is named rather than hidden.
  assert.deepEqual(row.panels.derivation.withoutPrecedent, ["front"]);
});

test("a derived record does not satisfy the operator-validated reader", () => {
  const row = { requires_validation: true, validated_by: null, validated_at: null, panels: deriveSurfaces({}, PORSCHE) };
  assert.equal(universal._test.validatedSurfaces(row), null,
    "deriving surfaces must never make a row read as operator-validated");
});

/**
 * The split this whole change exists for: a design is drawn, not printed.
 * Blocking Calls 1-7 on a human measurement stopped work that no measurement
 * changes, while the production path must still refuse a formula.
 */
test("design may author on derived geometry; production may not print it", () => {
  assert.match(workerSource, /resolveOrQueueUniversalDimensions\([\s\S]{0,160}allowDerived: true/,
    "Calls 1-7 must accept grounded-derived surfaces");
  assert.ok(!/resolveOrQueueUniversalDimensions\(sb, vehicle, stage, run\.id, \{[^}]*allowDerived: true/.test(claimantSource),
    "manifest.resolve must never opt into derived geometry");
  assert.match(claimantSource, /provenance === "grounded-derived"[\s\S]{0,200}genie_dimension_validation_required/,
    "the production boundary must fail closed on a derived record");
});

test("a design-time resolve has no run to park", () => {
  const source = readFileSync(join(root, "runtime", "genie-universal-resolver.cjs"), "utf8");
  assert.match(source, /if \(!stage \|\| !runId\) return;/,
    "requesting validation for a null stage threw on stage.id, which crashes a caller expecting an answer");
});
