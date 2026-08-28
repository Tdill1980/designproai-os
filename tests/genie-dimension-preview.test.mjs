/**
 * THE PREVIEW IS A CHEAP READ, AND IT MUST STAY ONE.
 *
 * The intake resolves GENIE while the customer is still typing, so the readiness
 * strip can say `Dimensions ✓` or `⚠` before they press Generate.
 *
 * `resolveFlatAtlasPreviewDimensions` cannot serve that: on a catalog miss it
 * makes a Gemini grounding request AND inserts a candidate row. Debounced
 * keystrokes would turn a form field into a cost and abuse surface.
 * `previewGenieDimensionsFromCatalog` is the same resolution ORDER minus that
 * step — and this test is what keeps the step out.
 *
 * It also locks the near-miss offer, which exists because of a real gap: the
 * catalog is keyed on configuration strings ("F-250, 350, 450, 550 – Super Duty
 * – Crew Cab Long Box") and the request carries no config field, so a match
 * depends on the customer having typed "Crew Cab" into free-text Model.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const genie = require("../runtime/genie-universal-resolver.cjs");

const SUPER_DUTY = {
  id: "row-super-duty", make: "Ford",
  model: "F250, F350, F450 Super Cab 8ft Box",
  year_range: "2017-2020", year_start: 2017, year_end: 2020,
  side_width: "248.3", side_height: "57.6",
  back_width: "79.7", back_height: "55.7",
  hood_width: "71.5", hood_length: "57.8",
  roof_width: "54.8", roof_length: "63.7",
};

function stubCatalog(rows) {
  const query = {
    select() { return query; }, eq() { return query; }, ilike() { return query; },
    order() { return query; },
    limit() { return Promise.resolve({ data: rows, error: null }); },
    then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
  };
  const empty = { ...query, limit: () => Promise.resolve({ data: [], error: null }) };
  return { from: (table) => (table === "vehicle_dimensions" ? query : empty) };
}

test("a covered year resolves from the catalog, with a manifest identity", async () => {
  const preview = await genie.previewGenieDimensionsFromCatalog(
    stubCatalog([SUPER_DUTY]),
    { type: "truck", year: 2019, make: "Ford", model: "F250 Crew Cab" },
  );
  assert.equal(preview.resolution.state, "derived");
  assert.equal(preview.resolution.productionEligible, true);
  assert.equal(preview.resolution.geometrySourceRowId, "row-super-duty");
  assert.match(preview.resolution.genieManifestHash, /^[0-9a-f]{64}$/);
  assert.equal(preview.surfaces.length, 6);
});

test("an uncovered year answers unresolved AND offers what the catalog does hold", async () => {
  // The owner's own truck. GENIE's newest Super Duty ends at 2020, so a 2024
  // has no authoritative row -- and the honest answer is not a dead end, it is
  // "here is the record we have, is this your configuration?".
  const preview = await genie.previewGenieDimensionsFromCatalog(
    stubCatalog([SUPER_DUTY]),
    { type: "truck", year: 2024, make: "Ford", model: "F-250" },
  );
  assert.equal(preview.resolution.state, "unresolved");
  assert.equal(preview.resolution.productionEligible, false);
  assert.equal(preview.candidates.length, 1);
  assert.equal(preview.candidates[0].model, SUPER_DUTY.model);
  assert.equal(preview.candidates[0].yearRange, "2017-2020");
});

test("the preview never grounds and never writes", () => {
  const source = genie.previewGenieDimensionsFromCatalog.toString();
  assert.equal(/groundedCandidate/.test(source), false,
    "the preview reaches the Gemini grounding path — it is called from a form field");
  assert.equal(/insertOrReadGroundedCandidate|\.insert\(/.test(source), false,
    "the preview writes a row — a debounced keystroke may not create records");
});

test("the gateway proxies the preview instead of implementing a second matcher", async () => {
  const { readFileSync } = await import("node:fs");
  const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
  assert.match(gateway, /\/api\/genie\/dimensions\/preview/);
  assert.match(gateway, /internal\/genie\/dimensions\/preview/);
  // Two definitions of "does this row match this vehicle" would drift the week
  // they were written, so the browser-facing process must not own one.
  assert.equal(/normalizeModelTokens|scoreCatalogRow/.test(gateway), false,
    "the gateway grew its own catalog matcher");
});
