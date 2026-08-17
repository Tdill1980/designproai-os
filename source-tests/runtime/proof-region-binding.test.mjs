import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The registry digest, exercised rather than read.
 *
 * `surfaceMastersHash` is the single value that makes the six frozen sides one
 * indivisible set. Every check Call 9 performs on the set reduces to it, so it
 * is worth proving it actually moves when the things it is supposed to protect
 * move — and, just as importantly, that it does NOT move when only the order
 * changes, because the render is free to emit surfaces in any order.
 */
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { _test } = require(resolve(workspace, "runtime/designpro-standalone-claimant.cjs"));
const { surfaceMastersHash, SURFACE_REGISTRAR_CONTRACT } = _test;

assert.equal(SURFACE_REGISTRAR_CONTRACT, "designpro.proof-region-surface.v1");

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];
const digest = (side) => `${side.charCodeAt(0).toString(16).repeat(2)}`.padEnd(64, "0");

const registry = (mutate = () => {}) => {
  const panels = SURFACES.map((side, index) => ({
    key: side,
    storagePath: `designpro/user_x/run_y/surfaces/${side}-${digest(side).slice(0, 24)}.png`,
    contentHash: digest(side),
    trimWidthInches: 100 + index, trimHeightInches: 50 + index, bleedInches: 5,
    brandedMaster: {
      side, storagePath: `designpro/user_x/run_y/surfaces/${side}-${digest(side).slice(0, 24)}.png`,
      contentHash: digest(side), byteSize: 1000 + index,
    },
    proofRegion: { box: [index * 100, 10, index * 100 + 90, 200], sourceContentHash: digest(side) },
    transformReceipt: {
      contract: "designpro.proof-region-transform.v1", mode: "contain-fit-no-fill",
      sourcePreserving: true, sourceContentHash: digest(side),
    },
  }));
  mutate(panels);
  return panels;
};

const baseline = surfaceMastersHash(registry());
assert.match(baseline, /^[0-9a-f]{64}$/, "the registry digest must be a sha256");

// Order is not identity: the renderer may emit surfaces in any order, and a
// digest that changed with it would fail every run for no reason.
assert.equal(
  surfaceMastersHash(registry((panels) => panels.reverse())),
  baseline,
  "the registry digest must be independent of the order surfaces were emitted in",
);

// Everything the digest exists to protect must move it.
const mutations = {
  "a swapped branded master": (panels) => { panels[0].brandedMaster.contentHash = digest("rear"); },
  "a redirected master path": (panels) => { panels[1].brandedMaster.storagePath = panels[0].brandedMaster.storagePath; },
  "a changed trim width": (panels) => { panels[2].trimWidthInches = 999; },
  "a changed trim height": (panels) => { panels[3].trimHeightInches = 999; },
  "a dropped bleed": (panels) => { panels[4].bleedInches = 0; },
  "a moved proof region": (panels) => { panels[5].proofRegion.box = [0, 0, 1000, 1000]; },
  "a substituted transform contract": (panels) => { panels[0].transformReceipt.contract = "something.else.v1"; },
  "a mirror-fill transform mode": (panels) => { panels[0].transformReceipt.mode = "contain-mirror-fill"; },
  "a renamed side": (panels) => { panels[0].key = "hood"; },
};
for (const [what, mutate] of Object.entries(mutations)) {
  assert.notEqual(surfaceMastersHash(registry(mutate)), baseline,
    `the registry digest must change on ${what}`);
}

// A missing side is a different set, not a smaller one.
assert.notEqual(surfaceMastersHash(registry((panels) => panels.splice(2, 1))), baseline,
  "the registry digest must change when a side is dropped");

// The digest is over the SET, so two sides sharing one master is detectable
// even though each side's own hash still verifies against its own bytes.
assert.notEqual(
  surfaceMastersHash(registry((panels) => {
    panels[1].brandedMaster.contentHash = panels[0].brandedMaster.contentHash;
    panels[1].proofRegion.sourceContentHash = panels[0].brandedMaster.contentHash;
    panels[1].transformReceipt.sourceContentHash = panels[0].brandedMaster.contentHash;
  })),
  baseline,
  "the registry digest must change when passenger is handed driver's master",
);

console.log("proof-region binding passed: registry digest is order-independent and moves on every substitution");
