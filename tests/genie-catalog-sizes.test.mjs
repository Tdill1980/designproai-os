// A.T.L.A.S. TAKES ITS SIZES FROM THE MEASURED GENIE CATALOG.
//
// Owner, 2026-08-27: "None of them are the right size. It should be using GENIE
// Panelizer database to get sizes for ATLAS."
//
// The catalog (`vehicle_dimensions`, 1781 measured rows) was empty on this
// project until 2026-08-27, so every run fell through to
// provisionalDimensionsFromCandidate -- a grounded bounding box scaled by
// hardcoded per-class constants. Measured cost on the owner's own truck: GENIE
// states the F-250 Super Duty Crew Cab side at 251x60; the estimator produced
// 153x56, ninety-eight inches short.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  findGenieCatalogSurfaces,
  surfacesFromGenieCatalog,
  normalizeModelTokens,
} = require("../runtime/genie-universal-resolver.cjs");

// The real row, verbatim from the migrated catalog.
const F250 = {
  id: "row-f250",
  make: "Ford",
  model: "F-250, 350, 450, 550 – Super Duty – Crew Cab Long Box",
  year_range: "2008-2010", year_start: 2008, year_end: 2010,
  side_width: "251", side_height: "60",
  back_width: "76", back_height: "56",
  hood_width: "68", hood_length: "39",
  roof_width: "55", roof_length: "72",
  total_sqft: "327.1",
};
// A row whose side is transposed, which the catalog genuinely contains.
const TRANSPOSED = { ...F250, id: "row-t", model: "Acura CSX 4 Door Sedan", side_width: "49", side_height: "172" };

const stub = (rows) => ({
  from: () => ({
    select: () => ({
      ilike: () => ({ limit: async () => ({ data: rows, error: null }) }),
    }),
  }),
});

test("the six surfaces come from the measured catalog row", () => {
  const mapped = surfacesFromGenieCatalog(F250, "truck");
  assert.deepEqual(mapped.surfaces.driver, { widthInches: 251, heightInches: 60 });
  assert.deepEqual(mapped.surfaces.rear, { widthInches: 76, heightInches: 56 });
  assert.deepEqual(mapped.surfaces.hood, { widthInches: 68, heightInches: 39 });
  assert.deepEqual(mapped.surfaces.roof, { widthInches: 72, heightInches: 55 });
  // Passenger is the driver flank mirrored — identical geometry by construction.
  assert.deepEqual(mapped.surfaces.passenger, mapped.surfaces.driver);
  assert.deepEqual(mapped.mirroredSurfaces, ["passenger"]);
  // FRONT is the one surface GENIE does not measure, and it says so.
  assert.deepEqual(mapped.derivedSurfaces, ["front"]);
  assert.equal(mapped.totalSqft, 327.1);
});

test("a transposed side is read long-edge first, not portrait", () => {
  const mapped = surfacesFromGenieCatalog(TRANSPOSED, "car");
  assert.deepEqual(mapped.surfaces.driver, { widthInches: 172, heightInches: 49 });
});

test("shop model strings match what a customer actually types", async () => {
  const match = await findGenieCatalogSurfaces(stub([F250]), {
    make: "Ford", model: "F250 Crew Cab", year: 2009, vehicleClass: "truck",
  });
  assert.ok(match, "the catalog must match F250 Crew Cab to the Super Duty Crew Cab row");
  assert.equal(match.surfaces.driver.widthInches, 251);
  // …and never the 153in the class-constant estimator produced.
  assert.notEqual(match.surfaces.driver.widthInches, 153);
});

test("one coincidental token is not a match", async () => {
  const van = { ...F250, id: "row-van", model: "Transit Connect Cargo Van" };
  const match = await findGenieCatalogSurfaces(stub([van]), {
    make: "Ford", model: "Econoline Van", year: 2009, vehicleClass: "van",
  });
  assert.equal(match, null, "sharing only the word 'van' must not resolve a size");
});

test("a year outside every range still resolves rather than blocking the run", async () => {
  const match = await findGenieCatalogSurfaces(stub([F250]), {
    make: "Ford", model: "F250 Crew Cab", year: 2023, vehicleClass: "truck",
  });
  assert.ok(match, "no in-year row must fall back to the make/model pool, not to nothing");
});

test("a catalog read failure never takes the run down", async () => {
  const broken = { from: () => ({ select: () => ({ ilike: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }) }) }) };
  assert.equal(await findGenieCatalogSurfaces(broken, { make: "Ford", model: "F250 Crew Cab", year: 2023, vehicleClass: "truck" }), null);
});

test("model tokens normalise shop punctuation away", () => {
  assert.deepEqual(normalizeModelTokens("F-250, 350 – Super Duty"), ["f", "250", "350", "super", "duty"]);
});
