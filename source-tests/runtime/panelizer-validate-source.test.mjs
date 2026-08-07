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

test("standalone Call 8 request uses exact raw square feet and five-inch bleed on all six surfaces", () => {
  const ownerId = "12345678-1234-4123-8123-123456789abc";
  const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const runId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const tenantKey = `user_${ownerId}`;
  const viewKeys = ["driver", "passenger", "hood", "roof", "front", "rear", "hero3d"];
  const viewLineage = viewKeys.map((viewKey, index) => ({
    viewKey,
    storagePath: `users/${ownerId}/revisions/${revisionId}/inputs/${viewKey}/${String(index + 1).padStart(64, "0")}.png`,
    contentHash: String(index + 1).padStart(64, "0"),
    byteSize: index + 1,
    contentType: "image/png",
  }));
  const expectedSurfaces = universal.SURFACES.map((surfaceKey, index) => {
    const widthInches = 50 + index;
    const heightInches = 20 + index;
    return {
      surfaceKey,
      widthInches,
      heightInches,
      surfaceSqFt: claimant._test.round2(widthInches * heightInches / 144),
      bleed: { top: 5, right: 5, bottom: 5, left: 5 },
      sourceAsset: viewLineage.find((item) => item.viewKey === surfaceKey),
    };
  });
  const totalSqFt = claimant._test.round2(expectedSurfaces.reduce(
    (sum, surface) => sum + surface.widthInches * surface.heightInches / 144,
    0,
  ));
  const result = claimant._test.call8ProofRequest(
    { id: runId, revision_id: revisionId, tenant_key: tenantKey },
    { expectedSurfaces, totalSqFt, vehicle: { type: "car", year: 2024, make: "Porsche", model: "911" } },
    viewLineage,
    { bodyText: {}, logoPlacements: [] },
  );
  assert.equal(result.totalSqFt, totalSqFt);
  assert.equal(result.request.tiles.length, 6);
  assert.ok(result.request.tiles.every((tile) => tile.bleedIn === 5));
  assert.match(result.request.overlaySvg, new RegExp(`GENIE TOTAL: ${totalSqFt.toFixed(2)} SQ FT · 5 IN BLEED EACH EDGE`));
});

test("standalone panel authority contains no estimated or shared-runtime success path", () => {
  assert.match(claimantSource, /Every vehicle,[\s\S]*?validated Universal GENIE gate/);
  assert.match(claimantSource, /genie_total_square_feet_mismatch/);
  assert.match(claimantSource, /call9_surface_reuse/);
  assert.doesNotMatch(universalSource + claimantSource, /143\.110\.237\.145|RAILWAY_|restyleproai\.com/i);
});
