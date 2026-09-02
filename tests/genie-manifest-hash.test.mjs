// GENIE MANIFEST HASH — contract v2 (owner ruling 2026-09-02, commit 2 of 2).
//
// v1 hashed `null` for every surface (an array indexed by surface name), so
// the manifest identity never varied with the inches. v2 hashes the six
// resolved surfaces. These fixtures are the contract:
//   identical canonical geometry → identical hash
//   a meaningful geometry change → a different hash
//   state / source row / derivation change → a different hash
//   the v1 material collides where v2 does not (the defect, convicted)
// Historical rows are not rewritten: docs/GENIE-MANIFEST-HASH-CUTOVER.md.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const genie = require("../runtime/genie-universal-resolver.cjs");
const { stampGeometryResolution, canonicalManifestSurfaces } = genie._test;

const F250 = Object.freeze({
  side_width: "153", side_height: "56", passenger_width: "153", passenger_height: "56",
  hood_width: "71.5", hood_length: "56", roof_width: "74.3", roof_length: "54.8",
  front_width: "129", front_height: "34", rear_width: "76", rear_height: "54",
});
const MEASURED = Object.freeze({ state: "measured", geometrySourceRowId: "row-1", productionEligible: true, operatorValidated: true });
const stamp = (row, resolution = MEASURED) => stampGeometryResolution({ ...row }, { ...resolution }).geometryResolution;

/** The v1 material, reproduced exactly, to prove the collision it had. */
function v1Hash(row, resolution) {
  const surfaces = {};
  for (const key of genie.SURFACES) surfaces[key] = genie.expectedSurfacesFromRow(row)?.[key] || null;
  const material = JSON.stringify({ contract: "designpro.genie-manifest.v1", state: resolution.state, sourceRowId: resolution.geometrySourceRowId || null, derivationContract: resolution.derivationContract || null, surfaces });
  return createHash("sha256").update(material, "utf8").digest("hex");
}

test("the contract and hash contract are explicit and travel on every resolution", () => {
  assert.equal(genie.GENIE_MANIFEST_CONTRACT, "designpro.genie-manifest.v2");
  assert.equal(genie.GENIE_MANIFEST_HASH_CONTRACT, "designpro.genie-manifest-hash.v2");
  const r = stamp(F250);
  assert.equal(r.contract, "designpro.genie-manifest.v2");
  assert.equal(r.hashContract, "designpro.genie-manifest-hash.v2");
  assert.match(r.genieManifestHash, /^[0-9a-f]{64}$/);
  assert.equal(r.genieManifestId, r.genieManifestHash.slice(0, 32));
  assert.ok(genie.GENIE_PREP_CONTRACT.endsWith(genie.GENIE_MANIFEST_CONTRACT), "a manifest contract bump retires every GENIE prep row");
});

test("identical canonical geometry → identical hash (different row ids, string vs number, whitespace)", () => {
  const a = stamp({ ...F250, id: "row-a", model: "F250 Crew Cab" });
  const b = stamp({ ...F250, id: "row-b", model: "  F250  Crew Cab ", side_width: 153, side_height: 56.0 });
  assert.equal(a.genieManifestHash, b.genieManifestHash);
  assert.deepEqual(canonicalManifestSurfaces({ ...F250 }), canonicalManifestSurfaces({ ...F250, side_width: 153 }));
});

test("a meaningful geometry change → a different hash, on every surface", () => {
  const base = stamp(F250).genieManifestHash;
  const changes = [
    { side_width: "154" }, { side_height: "57" }, { passenger_width: "150" }, { hood_width: "72" }, { hood_length: "55" },
    { roof_width: "75" }, { roof_length: "54" }, { front_width: "130" }, { front_height: "35" }, { rear_width: "77" }, { rear_height: "55" },
  ];
  const seen = new Set([base]);
  for (const change of changes) {
    const h = stamp({ ...F250, ...change }).genieManifestHash;
    assert.notEqual(h, base, `changing ${JSON.stringify(change)} must change the hash`);
    assert.ok(!seen.has(h), `distinct geometries must not collide (${JSON.stringify(change)})`);
    seen.add(h);
  }
});

test("state, source row and derivation contract still change the hash", () => {
  const base = stamp(F250).genieManifestHash;
  assert.notEqual(stamp(F250, { ...MEASURED, state: "derived" }).genieManifestHash, base);
  assert.notEqual(stamp(F250, { ...MEASURED, geometrySourceRowId: "row-2" }).genieManifestHash, base);
  assert.notEqual(stamp(F250, { ...MEASURED, derivationContract: "designpro.genie-front-derived.v1" }).genieManifestHash, base);
});

test("the v1 material collided on different geometry; v2 does not (the defect, convicted)", () => {
  const changed = { ...F250, side_width: "251", front_width: "80" };
  assert.equal(v1Hash({ ...F250 }, MEASURED), v1Hash(changed, MEASURED), "v1: two different trucks, one hash");
  assert.notEqual(stamp(F250).genieManifestHash, stamp(changed).genieManifestHash, "v2: different trucks, different hashes");
  // and the v2 surfaces are real inches, not nulls
  const surfaces = canonicalManifestSurfaces({ ...F250 });
  for (const key of genie.SURFACES) {
    assert.ok(surfaces[key] && surfaces[key].widthInches > 0 && surfaces[key].heightInches > 0, `${key} is hashed as inches`);
    assert.deepEqual(surfaces[key].bleed, { top: 5, right: 5, bottom: 5, left: 5 });
  }
});

test("a row missing a surface fails closed before any hash is minted (the resolver refuses incomplete geometry)", () => {
  const partial = { ...F250, rear_width: "", rear_height: "" };
  assert.throws(() => canonicalManifestSurfaces(partial), /GENIE dimensions missing for rear/);
  assert.throws(() => stamp(partial), /GENIE dimensions missing for rear/);
});
