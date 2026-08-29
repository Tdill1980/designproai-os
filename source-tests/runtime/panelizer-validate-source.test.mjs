import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const universal = require("../../runtime/genie-universal-resolver.cjs");
const claimant = require("../../runtime/designpro-standalone-claimant.cjs");
const universalSource = readFileSync(new URL("../../runtime/genie-universal-resolver.cjs", import.meta.url), "utf8");
const claimantSource = readFileSync(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");

const surfaceValues = Object.fromEntries(universal.SURFACES.map((surfaceKey, index) => [
  surfaceKey,
  { widthInches: 50 + index, heightInches: 20 + index },
]));

test("standalone Universal GENIE accepts only operator-validated exact six-surface geometry", () => {
  const row = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    requires_validation: false,
    validated_by: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    validated_at: "2026-08-06T00:00:00Z",
    source_urls: ["https://manufacturer.example/spec.pdf"],
    validated_surfaces: {
      contractVersion: "designpro.genie-validated-surfaces.v1",
      surfaces: surfaceValues,
    },
  };
  const exact = universal._test.validatedSurfaces(row);
  assert.deepEqual(
    universal.SURFACES.map((surfaceKey) => {
      const fields = {
        driver: ["side_width", "side_height"],
        passenger: ["passenger_width", "passenger_height"],
        hood: ["hood_width", "hood_length"],
        roof: ["roof_width", "roof_length"],
        front: ["front_width", "front_height"],
        rear: ["rear_width", "rear_height"],
      }[surfaceKey];
      return [surfaceKey, exact[fields[0]], exact[fields[1]]];
    }),
    universal.SURFACES.map((surfaceKey) => [
      surfaceKey,
      surfaceValues[surfaceKey].widthInches,
      surfaceValues[surfaceKey].heightInches,
    ]),
  );
  assert.deepEqual(exact.universalValidation, {
    validatorId: row.validated_by,
    validatedAt: row.validated_at,
    sourceUrls: row.source_urls,
    candidateId: row.id,
  });
});

test("Universal GENIE fails closed for estimates, missing approval, or incomplete surfaces", () => {
  const base = {
    requires_validation: false,
    validated_by: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    validated_at: "2026-08-06T00:00:00Z",
    validated_surfaces: { contractVersion: "designpro.genie-validated-surfaces.v1", surfaces: surfaceValues },
  };
  assert.equal(universal._test.validatedSurfaces({ ...base, requires_validation: true }), null);
  assert.equal(universal._test.validatedSurfaces({ ...base, validated_by: null }), null);
  const incomplete = { ...surfaceValues };
  delete incomplete.rear;
  assert.equal(universal._test.validatedSurfaces({ ...base, validated_surfaces: { ...base.validated_surfaces, surfaces: incomplete } }), null);
  assert.match(universalSource, /This is a candidate for human validation; do not invent missing values/);
});

test("every GENIE surface carries five-inch bleed and the total is the raw sum, not a sum of rounded parts", () => {
  // This used to be asserted through the Call 8 atlas request builder, which
  // authored one flat wrap layout for Call 9 to cut. That builder is retired:
  // each side is rendered from the canonical Design Master in its own right.
  // The property it was protecting is unchanged and still belongs here.
  const SURFACE_TRIMS = [
    ["driver", 163, 56], ["passenger", 163, 56], ["hood", 65, 42],
    ["roof", 58, 70], ["front", 68, 40], ["rear", 66, 44],
  ];
  const expectedSurfaces = SURFACE_TRIMS.map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches,
    surfaceSqFt: claimant._test.round2(widthInches * heightInches / 144),
    bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));
  assert.equal(expectedSurfaces.length, 6);
  assert.ok(expectedSurfaces.every((surface) => Object.values(surface.bleed).every((value) => value === 5)));

  // Rounding the sum once, never summing rounded parts: the customer's total is
  // the manifest's, and the two differ by more than a cent at wrap scale.
  const rawTotal = claimant._test.round2(expectedSurfaces.reduce((sum, s) => sum + s.widthInches * s.heightInches / 144, 0));
  const summedRounded = claimant._test.round2(expectedSurfaces.reduce((sum, s) => sum + s.surfaceSqFt, 0));
  assert.equal(rawTotal, claimant._test.round2(expectedSurfaces.reduce((sum, s) => sum + s.widthInches * s.heightInches, 0) / 144));
  assert.ok(Math.abs(rawTotal - summedRounded) < 0.05);
});

test("standalone panel authority contains no estimated or shared-runtime success path", () => {
  assert.match(claimantSource, /Every vehicle,[\s\S]*?validated Universal GENIE gate/);
  assert.match(claimantSource, /genie_total_square_feet_mismatch/);
  // `call9_surface_reuse` guarded the deleted gridslice arm against six panels
  // sharing one set of bytes. The promotion arm's own collision guard is what
  // says the same thing now: six surfaces, six distinct hashes, or the stage
  // fails. It reads the Call-1 panels rather than gridslice output, so the
  // driver's artwork still cannot end up on every side.
  assert.match(claimantSource, /call9_panel_identity_collision/);
  assert.match(claimantSource, /new Set\(Object\.values\(panelHashes\)\)\.size !== SURFACE_KEYS\.length/);
  assert.doesNotMatch(universalSource + claimantSource, /143\.110\.237\.145|RAILWAY_|restyleproai\.com/i);
});
