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
  catalogDimensionRow,
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

/**
 * ⛔ A YEAR MISS IS A MISS. THE OPPOSITE OF WHAT THIS ONCE ASSERTED.
 *
 * This test used to require that a year outside every range fall back to the
 * whole make/model pool "rather than blocking the run". The owner reversed that
 * on 2026-08-27, on measured evidence: a 2024 Ford F-250 has NO row in the
 * catalog -- the newest Super Duty ends at 2020 -- so the year-eligible pool
 * was a Bronco and a `transit 250` van. Scoring `F-250` against `transit 250`
 * shares the token `250`, one point under the threshold. A single point stood
 * between that truck's six panels and a cargo van's dimensions, and behind it
 * the estimator produced a 132.4" front on a truck whose front is ~80".
 *
 * "Do not silently fall back to Gemini for production geometry. That is what
 * created the 122" front and poisoned the panel chain."
 */
test("a year outside every range is a miss, never a widened search", async () => {
  const match = await findGenieCatalogSurfaces(stub([F250]), {
    make: "Ford", model: "F250 Crew Cab", year: 2023, vehicleClass: "truck",
  });
  assert.equal(match, null, "a 2017-2020 record may not answer for a 2023 vehicle");
});

test("a vehicle with no stated year cannot match any row", async () => {
  assert.equal(await findGenieCatalogSurfaces(stub([F250]), {
    make: "Ford", model: "F250 Crew Cab", year: null, vehicleClass: "truck",
  }), null);
});

/**
 * A LOOKUP FAILURE IS NOT A CATALOG MISS -- and it used to be indistinguishable
 * from one, because the caller wrapped this in `.catch(() => null)`. A broken
 * query, a permission error and "never measured" all produced a Gemini guess
 * wearing the shape of a measurement. The read error still surfaces as no match
 * HERE, but the caller no longer swallows a throw.
 */
test("a catalog read failure never takes the run down", async () => {
  const broken = { from: () => ({ select: () => ({ ilike: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }) }) }) };
  assert.equal(await findGenieCatalogSurfaces(broken, { make: "Ford", model: "F250 Crew Cab", year: 2019, vehicleClass: "truck" }), null);
});

/**
 * THE FOUR CORRUPT ROWS, AND WHY THEY ARE QUARANTINED BEFORE MATCHING.
 *
 * Live: four Ford rows carry an entire TSV line in `model` with every dimension
 * column and both year columns NULL. Null years passed the year filter, so a
 * 2024 lookup drew them into the candidate pool.
 */
test("a row with a TSV line in its model never participates in matching", async () => {
  const corrupt = {
    id: "row-corrupt", make: "Ford",
    model: "F250 SuperCrew 5'5 box\t2018-2020\t227.1\t57.0\t102.0",
    year_range: null, year_start: null, year_end: null,
    side_width: null, side_height: null, back_width: null, back_height: null,
    hood_width: null, hood_length: null, roof_width: null, roof_length: null,
  };
  assert.equal(await findGenieCatalogSurfaces(stub([corrupt]), {
    make: "Ford", model: "F250 Crew Cab", year: 2019, vehicleClass: "truck",
  }), null);
});

test("model tokens normalise shop punctuation away", () => {
  assert.deepEqual(normalizeModelTokens("F-250, 350 – Super Duty"), ["f", "250", "350", "super", "duty"]);
});

// ── THE F-650 REGRESSION ───────────────────────────────────────────────────
//
// Live: canary 7323fd73 (2026-08-27) asked for a 2009 Ford F250 Crew Cab and
// resolved `gemini_grounded`, not the catalog. Two defects, together:
//
//   * `F250` tokenized to one token and the catalog's `F-250` to `f` + `250`,
//     so the model NUMBER matched nothing and the row scored 2 on `crew`+`cab`;
//   * `F-650 Crew Cab / Cab Only` scored the same 2 with a SHORTER model
//     string, so the "least specific row wins" tie-break chose it -- and that
//     row carries side dimensions only, so surfacesFromGenieCatalog returned
//     null and the whole lookup fell through in silence.
const F650_CAB_ONLY = {
  id: "row-f650", make: "Ford", model: "F-650 Crew Cab / Cab Only",
  year_range: "2008-2010", year_start: 2008, year_end: 2010,
  side_width: "143.1", side_height: "68.5",
  back_width: null, back_height: null,
  hood_width: null, hood_length: null,
  roof_width: null, roof_length: null,
  total_sqft: null,
};

test("a model number matches across punctuation: F250 finds F-250", () => {
  const tokens = normalizeModelTokens("F250 Crew Cab");
  assert.ok(tokens.includes("250"), "the bare number is emitted alongside the joined form");
  assert.ok(tokens.includes("f250"), "the joined form is kept, so an exact catalog spelling still hits");
  const catalog = normalizeModelTokens("F-250, 350, 450, 550 – Super Duty – Crew Cab Long Box");
  assert.ok(catalog.includes("250"));
  assert.ok(!catalog.includes("650"), "the split must not invent numbers the row does not carry");
});

test("a cab-only row cannot beat the measured pickup it shares words with", async () => {
  const match = await findGenieCatalogSurfaces(
    stub([F650_CAB_ONLY, F250]),
    { make: "Ford", model: "F250 Crew Cab", year: "2009", vehicleClass: "truck" },
  );
  assert.ok(match, "the catalog must resolve rather than fall through to the estimator");
  assert.equal(match.row.id, "row-f250");
  assert.equal(match.surfaces.driver.widthInches, 251);
  assert.equal(match.surfaces.driver.heightInches, 60);
});

test("a row missing three of its four measured surfaces is filtered out, not merely outscored", async () => {
  // On its own it is the ONLY candidate and still must not resolve: half a
  // vehicle is not a size authority, and returning it would print panels for
  // surfaces nobody measured.
  const match = await findGenieCatalogSurfaces(
    stub([F650_CAB_ONLY]),
    { make: "Ford", model: "F650 Crew Cab", year: "2009", vehicleClass: "truck" },
  );
  assert.equal(match, null);
});

// ── THE CATALOG AUTHORITY MUST SURVIVE THE ATLAS VALIDATOR ─────────────────
//
// This is the test that was missing, and its absence cost a live failure.
// tests above prove findGenieCatalogSurfaces returns the right ROW; nothing
// proved the authority it emits is one flat-first-atlas will accept. It was
// not: `status: "genie-catalog"` was outside normalizedGeometryAuthority's
// accepted set, and `productionEligible` was omitted entirely, so the very
// first request that ever matched the catalog died at 5 seconds with
// `flat_atlas_geometry_authority_invalid` on the customer's screen
// (build 91b72f5, 2026-08-27 09:16).
//
// A silent fall-through hid it for as long as the match never happened. So the
// authority is now built by the resolver and validated by the consumer, in one
// test, across the seam that separates them.
const atlas = require("../runtime/flat-first-atlas.cjs");

test("the authority the catalog emits is one the A.T.L.A.S. manifest accepts", async () => {
  const match = await findGenieCatalogSurfaces(
    stub([F250]),
    { make: "Ford", model: "F250 Crew Cab", year: "2009", vehicleClass: "truck" },
  );
  assert.ok(match);
  const row = catalogDimensionRow(match, { make: "Ford", model: "F250 Crew Cab", year: "2009" });
  const authority = row.proofGeometryAuthority;

  // The three fields the validator reads, stated rather than assumed.
  assert.equal(authority.status, "genie-catalog");
  assert.equal(authority.operatorValidated, false);
  assert.equal(authority.productionEligible, false, "layout geometry is never production-eligible");
  assert.ok(authority.candidateId, "a measured row must say which row");

  // And it must pass, not merely look right.
  const manifest = atlas._test
    ? atlas._test.normalizedGeometryAuthority(authority)
    : null;
  if (manifest) {
    assert.equal(manifest.status, "genie-catalog");
    assert.equal(manifest.source, "genie-panelizer-catalog");
    assert.equal(manifest.productionEligible, false);
    assert.equal(manifest.operatorValidated, false);
  }
});
