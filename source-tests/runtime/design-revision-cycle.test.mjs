// Phase 5 gate: one full revision -> regenerated proofs -> approval/freeze cycle.
//
// This is the part that makes the previous four phases binding. A customer
// approves a particular design; production must be unable to print anything
// else, including a later revision of the same design, and including the same
// design re-rendered at a different resolution.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const {
  DESIGN_MASTER_CONTRACT, DESIGN_SPACE_CONTRACT, SURFACE_KEYS, GLOBAL_SPACE, validateDesignMaster,
} = require("../../runtime/design-master.cjs");
const { VIEW_PLATE_CONTRACT } = require("../../runtime/vehicle-view-plate.cjs");
const {
  REVISION_REQUEST_CONTRACT, APPROVAL_CONTRACT, REVISION_OPERATIONS,
  deriveRevision, freezeApproval, assertProductionEligible, validateRevisionBundle,
} = require("../../runtime/design-master-revision.cjs");
const {
  runOriginCycle, runRevisionCycle, approveCycle, approvedProductionSurfaces, CYCLE_CONTRACT,
} = require("../../runtime/design-revision-cycle.cjs");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const FONT = readFileSync("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");

const BLEED = 5;
const PPI = 4;
const TRIM = { driver: [20, 12], passenger: [20, 12], hood: [10, 12], roof: [10, 12], front: [14, 8], rear: [12, 10] };
const MARK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0b3d91"/><rect width="20" height="8" fill="#fff"/></svg>');
const MARK_V2 = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#0b3d91"/></svg>');
const FRAME = { widthPx: 480, heightPx: 300 };
const MANIFEST_ID = uuid("d");
const MANIFEST_HASH = sha256(Buffer.from("manifest"));
const PNG = { compressionLevel: 6, adaptiveFiltering: false, force: true };

// ------------------------------------------------------------------ fixtures

function checkField(width, height) {
  const bytes = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      const dark = ((x / 6 | 0) + (y / 6 | 0)) % 2 === 0;
      bytes[index] = dark ? 200 : 30 + ((x * 3) % 60);
      bytes[index + 1] = dark ? 30 : 90;
      bytes[index + 2] = dark ? 40 : 190;
    }
  }
  return bytes;
}

const FIELD = await sharp(checkField(240, 120), { raw: { width: 240, height: 120, channels: 3 } }).png(PNG).toBuffer();
const ASSET_BYTES = { field: FIELD, mark: MARK };

function originMaster() {
  let x = 0;
  return validateDesignMaster({
    contract: DESIGN_MASTER_CONTRACT,
    masterId: uuid("a"), revisionId: uuid("b"), vehicleId: uuid("c"),
    dimensionManifestId: MANIFEST_ID, manifestHash: MANIFEST_HASH,
    designId: "DID-PHASE5",
    revisionSequence: 0,
    designSpace: {
      contract: DESIGN_SPACE_CONTRACT, designSpaceId: uuid("f"), unitsPerInch: 1,
      surfaces: SURFACE_KEYS.map((surfaceKey, index) => {
        const surface = {
          surfaceKey, originIn: [x, 0], widthIn: TRIM[surfaceKey][0], heightIn: TRIM[surfaceKey][1],
          mirror: surfaceKey === "passenger",
          mapping: { kind: "planar-developable", mappingId: uuid(String(index + 1)), mappingHash: sha256(Buffer.from(surfaceKey)) },
          seams: [],
        };
        x += TRIM[surfaceKey][0] + BLEED * 2 + 2;
        return surface;
      }),
    },
    assets: [
      { assetId: "field", kind: "raster", contentHash: sha256(FIELD), storagePath: "a/field.png", intrinsic: { widthPx: 240, heightPx: 120 }, minPxPerInch: 1 },
      { assetId: "mark", kind: "vector", contentHash: sha256(MARK), storagePath: "a/mark.svg" },
    ],
    palette: [{ token: "brand-blue", srgb: "#0b3d91" }, { token: "paper-white", srgb: "#f4f6f8" }],
    fonts: [{ fontId: "sans", family: "DejaVu Sans", version: "2.37", contentHash: sha256(FONT), license: "bitstream-vera", storagePath: "a/s.ttf" }],
    layers: [
      { layerId: "field", type: "raster", space: GLOBAL_SPACE, assetId: "field", extent: { widthIn: 182, heightIn: 22 },
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 10, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "domain-type", type: "text", space: "passenger", textId: "domain", extent: { widthIn: 18, heightIn: 3 },
        transform: { x: 1, y: 1, scale: 1, rotate: 0 }, zOrder: 60, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "mark", type: "logo", space: "passenger", logoIdentityKey: "precision-mark", extent: { widthIn: 6, heightIn: 6 },
        transform: { x: 2, y: 5, scale: 1, rotate: 0 }, zOrder: 70, opacity: 1, blend: "normal", mask: { type: "none" } },
    ],
    textObjects: [{ textId: "domain", string: "PrecisionClimateAZ.com", fontId: "sans", sizeIn: 1.2, colorToken: "paper-white", neverMirror: true, spellingAuthority: "revision-snapshot" }],
    logoObjects: [{ identityKey: "precision-mark", assetId: "mark", contentHash: sha256(MARK), surfaceKey: "passenger", neverMirror: true, neverRasterizeIntoBase: true }],
    masterHash: undefined,
  });
}

const MANIFEST = {
  totalSqFt: Math.round((SURFACE_KEYS.reduce((sum, key) => sum + TRIM[key][0] * TRIM[key][1], 0) / 144) * 100) / 100,
  expectedSurfaces: SURFACE_KEYS.map((key) => ({
    surfaceKey: key, widthInches: TRIM[key][0], heightInches: TRIM[key][1],
    surfaceSqFt: Math.round((TRIM[key][0] * TRIM[key][1] / 144) * 100) / 100,
  })),
};

const band = (bytes) => sharp(bytes, { raw: { width: FRAME.widthPx, height: FRAME.heightPx, channels: 1 } }).png(PNG).toBuffer();

function gradientBand(low, high) {
  const bytes = Buffer.alloc(FRAME.widthPx * FRAME.heightPx);
  for (let y = 0; y < FRAME.heightPx; y += 1) {
    for (let x = 0; x < FRAME.widthPx; x += 1) {
      bytes[y * FRAME.widthPx + x] = Math.round(low + ((high - low) * x) / (FRAME.widthPx - 1));
    }
  }
  return bytes;
}

async function plateAssets() {
  const body = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="300" height="160" fill="#4a5160"/></svg>`);
  const base = await sharp({ create: { width: FRAME.widthPx, height: FRAME.heightPx, channels: 3, background: "#20242b" } })
    .composite([{ input: body, left: 90, top: 60 }]).png(PNG).toBuffer();
  const maskBytes = Buffer.alloc(FRAME.widthPx * FRAME.heightPx, 0);
  for (let y = 80; y < 210; y += 1) maskBytes.fill(255, y * FRAME.widthPx + 110, y * FRAME.widthPx + 370);
  const assets = new Map([
    ["base", base],
    ["shading", await band(gradientBand(140, 255))],
    ["specular", await band(gradientBand(0, 70))],
    ["mask", await band(maskBytes)],
  ]);
  return assets;
}

function meshFor({ bow = 12 } = {}) {
  const box = { x: 105, y: 75, w: 270, h: 140 };
  const rows = 2, cols = 4, points = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const u = col / cols, v = row / rows;
      points.push({ u, v, x: box.x + u * box.w, y: box.y + v * box.h + bow * (2 * v - 1) * Math.sin(u * Math.PI) });
    }
  }
  return { rows, cols, points };
}

function plateSet(assets, options) {
  const image = (id) => ({ assetId: id, contentHash: sha256(assets.get(id)) });
  return {
    contract: VIEW_PLATE_CONTRACT,
    plateSetId: uuid("e"), vehicleId: uuid("c"),
    dimensionManifestId: MANIFEST_ID, manifestHash: MANIFEST_HASH,
    widthPx: FRAME.widthPx, heightPx: FRAME.heightPx,
    views: SURFACE_KEYS.map((surfaceKey) => ({
      viewKey: surfaceKey, label: surfaceKey.toUpperCase(),
      handedness: surfaceKey === "driver" ? "left" : surfaceKey === "passenger" ? "right" : "none",
      base: image("base"), shading: image("shading"), specular: image("specular"),
      panels: [{ surfaceKey, mask: image("mask"), mesh: meshFor(options) }],
    })),
  };
}

const PLATE_ASSETS = await plateAssets();

function inputs(over = {}) {
  const assets = over.assets || ASSET_BYTES;
  return {
    manifest: MANIFEST,
    plates: over.plates || plateSet(PLATE_ASSETS),
    loadAsset: async (ref) => {
      const assetId = typeof ref === "string" ? ref : ref.assetId;
      return assets[assetId] || PLATE_ASSETS.get(assetId);
    },
    loadFont: async () => FONT,
    proofFonts: { regular: FONT },
    pxPerInch: over.pxPerInch || PPI,
    bleedInches: BLEED,
    vehicle: { year: 2022, make: "Ford", model: "F250 Crew Cab" },
    designName: "Precision Climate Solutions",
    finish: "gloss",
    orderNumber: "PHASE5-1",
    ...(over.only || {}),
  };
}

const request = (operations, over = {}) => ({
  contract: REVISION_REQUEST_CONTRACT,
  requestId: uuid("7"), revisionId: uuid("8"),
  reason: "customer revision",
  operations,
  ...over,
});

// ------------------------------------------------------------------- the gate

test("GATE: one full cycle — revision, regenerated proofs, approval, frozen production", async () => {
  // 1. An approved design already exists.
  const origin = await runOriginCycle({ master: originMaster(), ...inputs() });
  assert.equal(origin.contract, CYCLE_CONTRACT);
  const originApproval = approveCycle({
    cycle: origin, approvedBy: uuid("9"), approvalRef: "signed-origin", approvedAt: "2026-08-13T10:00:00.000Z",
  });

  // 2. The customer asks for a change.
  const revised = await runRevisionCycle({
    base: origin.master,
    request: request([
      { op: "set-text", textId: "domain", string: "PrecisionClimateAZ.com/hvac" },
      { op: "set-palette", token: "brand-blue", srgb: "#0b5d3a" },
    ]),
    ...inputs(),
  });

  // 3. The revision is a new immutable master that supersedes the old one, and
  //    the old one is untouched — it is still the design production may print.
  assert.notEqual(revised.master.masterHash, origin.master.masterHash);
  assert.equal(revised.master.supersedesRevisionId, origin.master.revisionId);
  assert.equal(revised.master.revisionSequence, 1);
  assert.equal(origin.master.masterHash, originMaster().masterHash, "the base master was mutated");

  // 4. Every derived artefact was regenerated from the new master.
  assert.notEqual(revised.render.renderHash, origin.render.renderHash);
  assert.notEqual(revised.proof2d.contentHash, origin.proof2d.contentHash);
  assert.notEqual(revised.proof3d.proofHash, origin.proof3d.proofHash);
  assert.equal(revised.render.masterHash, revised.master.masterHash);
  assert.equal(revised.proof2d.renderHash, revised.render.renderHash);
  assert.equal(revised.proof3d.renderHash, revised.render.renderHash);
  // Both proofs carry the new string, and the same one.
  assert.deepEqual(revised.proof2d.textIdentities, [{ textId: "domain", string: "PrecisionClimateAZ.com/hvac" }]);
  assert.deepEqual(revised.proof3d.textIdentities, revised.proof2d.textIdentities);

  // 5. Until it is approved, production still runs on the approved origin, and
  //    refuses the revision the customer has not yet accepted.
  const stillOrigin = approvedProductionSurfaces({ approval: originApproval, cycle: origin });
  assert.equal(stillOrigin.revisionId, origin.master.revisionId);
  assert.throws(() => approvedProductionSurfaces({ approval: originApproval, cycle: revised }),
    (error) => error.code === "production_revision_mismatch");

  // 6. Approval freezes this exact identity.
  const approval = approveCycle({
    cycle: revised, approvedBy: uuid("9"), approvalRef: "signed-2026-08-13", approvedAt: "2026-08-13T12:00:00.000Z",
  });
  assert.equal(approval.contract, APPROVAL_CONTRACT);
  assert.equal(approval.bundleIdentity, revised.identity.bundleIdentity);
  assert.equal(approval.masterHash, revised.master.masterHash);
  assert.equal(approval.renderHash, revised.render.renderHash);
  assert.equal(approval.proof2dHash, revised.proof2d.contentHash);
  assert.equal(approval.proof3dHash, revised.proof3d.proofHash);

  // 7. Production consumes the approved frozen revision.
  const production = approvedProductionSurfaces({ approval, cycle: revised });
  assert.equal(production.bundleIdentity, approval.bundleIdentity);
  assert.equal(production.revisionId, revised.master.revisionId);
  assert.equal(production.surfaces.length, 6);
  assert.deepEqual(production.surfaces.map((s) => s.surfaceKey), SURFACE_KEYS);
  assert.equal(production.approvalRef, "signed-2026-08-13");
});

test("GATE: production cannot consume anything but the frozen revision", async () => {
  const origin = await runOriginCycle({ master: originMaster(), ...inputs() });
  const approval = approveCycle({
    cycle: origin, approvedBy: uuid("9"), approvalRef: "signed", approvedAt: "2026-08-13T12:00:00.000Z",
  });

  // No approval at all.
  assert.throws(() => approvedProductionSurfaces({ approval: null, cycle: origin }),
    (error) => error.code === "production_not_approved");

  // The same design re-rendered at a different resolution is a different
  // artefact set, and was not the one the customer looked at.
  const rerendered = await runOriginCycle({ master: originMaster(), ...inputs({ pxPerInch: 6 }) });
  assert.equal(rerendered.master.masterHash, origin.master.masterHash, "same master");
  assert.notEqual(rerendered.identity.bundleIdentity, origin.identity.bundleIdentity);
  assert.throws(() => approvedProductionSurfaces({ approval, cycle: rerendered }),
    (error) => error.code === "production_identity_drift");

  // Re-cut plates change the 3D proof, so they change what was approved too.
  const replated = await runOriginCycle({ master: originMaster(), ...inputs({ plates: plateSet(PLATE_ASSETS, { bow: 30 }) }) });
  assert.throws(() => approvedProductionSurfaces({ approval, cycle: replated }),
    (error) => error.code === "production_identity_drift");

  // An approval edited after the fact no longer hashes to its own contents,
  // and that is checked before any field on it is believed — including the
  // bundleIdentity the drift comparison would otherwise read.
  for (const edited of [
    { ...approval, proof2dHash: sha256(Buffer.from("other")) },
    { ...approval, approvalRef: "someone else's signature" },
    { ...approval, bundleIdentity: origin.identity.bundleIdentity, masterHash: sha256(Buffer.from("x")) },
  ]) {
    assert.throws(() => approvedProductionSurfaces({ approval: edited, cycle: origin }),
      (error) => error.code === "production_approval_tampered");
  }
});

// -------------------------------------------------------------- revisions

test("a revision derives a new master and never edits the one it supersedes", () => {
  const base = originMaster();
  const before = JSON.stringify(base);
  const next = deriveRevision({ base, request: request([{ op: "set-text", textId: "domain", string: "NewClimateAZ.com" }]) });

  assert.equal(JSON.stringify(base), before, "deriveRevision mutated its base");
  assert.equal(base.textObjects[0].string, "PrecisionClimateAZ.com");
  assert.equal(next.textObjects[0].string, "NewClimateAZ.com");
  assert.equal(next.revisionId, uuid("8"));
  assert.equal(next.supersedesRevisionId, base.revisionId);
  assert.equal(next.revisionSequence, 1);

  // Deterministic: the same base and the same request produce the same design.
  const again = deriveRevision({ base, request: request([{ op: "set-text", textId: "domain", string: "NewClimateAZ.com" }]) });
  assert.equal(again.masterHash, next.masterHash);

  // Lineage accumulates rather than resetting.
  const third = deriveRevision({ base: next, request: request([{ op: "set-palette", token: "paper-white", srgb: "#ffffff" }], { revisionId: uuid("a") }) });
  assert.equal(third.revisionSequence, 2);
  assert.equal(third.supersedesRevisionId, next.revisionId);
});

test("a revision cannot leave the contract the original had to satisfy", async () => {
  const base = originMaster();
  // A string too long for its declared extent is refused before any proof
  // exists, rather than discovered when a panel prints with the URL cropped.
  // The check lives in the renderer, so the cycle is where it fires — the
  // derivation itself only re-validates the Phase 1 contract.
  const overlong = request([{ op: "set-text", textId: "domain", string: "PrecisionClimateAndRefrigerationOfGreaterPhoenixArizona.com" }]);
  assert.doesNotThrow(() => deriveRevision({ base, request: overlong }));
  await assert.rejects(runRevisionCycle({ base, request: overlong, ...inputs() }),
    (error) => error.code === "render_text_overflows_extent");

  // Replacing the file behind a logo carries the logo object's identity with
  // it, so the two cannot drift apart.
  const relogoed = deriveRevision({
    base,
    request: request([{ op: "replace-asset", assetId: "mark", contentHash: sha256(MARK_V2), storagePath: "a/mark-v2.svg" }]),
  });
  assert.equal(relogoed.assets.find((a) => a.assetId === "mark").contentHash, sha256(MARK_V2));
  assert.equal(relogoed.logoObjects[0].contentHash, sha256(MARK_V2));

  for (const [operations, code] of [
    [[{ op: "set-text", textId: "nope", string: "x" }], "revision_text_unknown"],
    [[{ op: "set-text", textId: "domain", string: "  " }], "revision_text_empty"],
    [[{ op: "set-palette", token: "nope", srgb: "#000000" }], "revision_palette_unknown"],
    [[{ op: "set-palette", token: "brand-blue", srgb: "blue" }], "revision_palette_invalid"],
    [[{ op: "set-layer-transform", layerId: "nope", transform: { x: 1 } }], "revision_layer_unknown"],
    [[{ op: "set-layer-transform", layerId: "field", transform: { mirror: true } }], "revision_transform_key_unknown"],
    [[{ op: "set-layer-opacity", layerId: "field", opacity: 2 }], "revision_opacity_invalid"],
    [[{ op: "set-layer-visible", layerId: "field", visible: false }], "revision_visible_surface_required"],
    [[{ op: "replace-asset", assetId: "field", contentHash: "nope" }], "revision_hash_invalid"],
    [[{ op: "retexture", layerId: "field" }], "revision_operation_unknown"],
  ]) {
    assert.throws(() => deriveRevision({ base, request: request(operations) }),
      (error) => error.code === code, `expected ${code}`);
  }

  assert.throws(() => deriveRevision({ base, request: request([]) }), (error) => error.code === "revision_request_empty");
  assert.throws(() => deriveRevision({ base, request: request([{ op: "set-text", textId: "domain", string: "PrecisionClimateAZ.com" }]) }),
    (error) => error.code === "revision_changed_nothing");
  assert.throws(() => deriveRevision({ base, request: request([{ op: "set-palette", token: "brand-blue", srgb: "#123456" }], { revisionId: base.revisionId }) }),
    (error) => error.code === "revision_id_reused");
});

test("hiding a layer names the surface it is hidden on, and the renderer honours it", async () => {
  const base = originMaster();
  const hidden = deriveRevision({
    base,
    request: request([{ op: "set-layer-visible", layerId: "mark", surfaceKey: "passenger", visible: false }]),
  });
  assert.equal(hidden.layers.find((l) => l.layerId === "mark").surfaceOverrides.passenger.visible, false);

  const shown = await runOriginCycle({ master: base, ...inputs() });
  const without = await runRevisionCycle({ base, request: request([{ op: "set-layer-visible", layerId: "mark", surfaceKey: "passenger", visible: false }]), ...inputs() });
  const passengerOf = (cycle) => cycle.render.surfaces.find((s) => s.surfaceKey === "passenger").contentHash;
  assert.notEqual(passengerOf(without), passengerOf(shown), "the hidden logo still rendered");
  assert.equal(without.proof2d.logoIdentities.length, 0);
});

// ----------------------------------------------------------------- bundles

test("a bundle assembled from mismatched parts is refused before anyone approves it", async () => {
  const origin = await runOriginCycle({ master: originMaster(), ...inputs() });
  const other = await runRevisionCycle({
    base: origin.master, request: request([{ op: "set-palette", token: "brand-blue", srgb: "#7a1f1f" }]), ...inputs(),
  });
  const parts = { master: origin.master, render: origin.render, proof2d: origin.proof2d, proof3d: origin.proof3d };

  assert.throws(() => validateRevisionBundle({ ...parts, render: other.render }),
    (error) => error.code === "revision_bundle_render_drift");
  assert.throws(() => validateRevisionBundle({ ...parts, proof2d: other.proof2d }),
    (error) => error.code === "revision_bundle_proof_drift");
  assert.throws(() => validateRevisionBundle({ ...parts, proof3d: other.proof3d }),
    (error) => error.code === "revision_bundle_proof_drift");
  assert.throws(() => validateRevisionBundle({ ...parts, proof3d: undefined }),
    (error) => error.code === "revision_bundle_proof3d_invalid");

  // The failure that retired Call 8, caught at the bundle: two proofs of one
  // design that disagree on a canonical string.
  const forged = { ...origin.proof3d, textIdentities: [{ textId: "domain", string: "PrecisionsClimateAz.com" }] };
  assert.throws(() => validateRevisionBundle({ ...parts, proof3d: forged }),
    (error) => error.code === "revision_bundle_text_disagreement");

  // And a cycle whose reported identity has drifted from its artefacts cannot
  // be approved on the strength of its own summary.
  const drifted = { ...origin, identity: { ...origin.identity, bundleIdentity: sha256(Buffer.from("elsewhere")) } };
  assert.throws(() => approveCycle({ cycle: drifted, approvedBy: uuid("9"), approvalRef: "x", approvedAt: "2026-08-13T12:00:00.000Z" }),
    (error) => error.code === "approval_cycle_drift");
});

test("an approval records who accepted what, and when", async () => {
  const origin = await runOriginCycle({ master: originMaster(), ...inputs() });
  for (const [over, code] of [
    [{ approvedBy: "not-a-uuid" }, "revision_uuid_invalid"],
    [{ approvalRef: "  " }, "approval_reference_required"],
    [{ approvedAt: "sometime" }, "approval_timestamp_invalid"],
  ]) {
    assert.throws(() => approveCycle({
      cycle: origin, approvedBy: uuid("9"), approvalRef: "signed", approvedAt: "2026-08-13T12:00:00.000Z", ...over,
    }), (error) => error.code === code, `expected ${code}`);
  }

  // Approving the same bundle twice yields the same frozen record, so a retried
  // approval cannot create a second identity for one accepted design.
  const args = { cycle: origin, approvedBy: uuid("9"), approvalRef: "signed", approvedAt: "2026-08-13T12:00:00.000Z" };
  assert.equal(approveCycle(args).approvalHash, approveCycle(args).approvalHash);

  // The frozen record stands on its own: it can be checked against the bundle
  // without the cycle that produced it.
  const approval = approveCycle(args);
  const identity = assertProductionEligible({
    approval,
    bundle: { master: origin.master, render: origin.render, proof2d: origin.proof2d, proof3d: origin.proof3d },
  });
  assert.equal(identity.bundleIdentity, approval.bundleIdentity);
});

test("the revision operation set is closed, and nothing on this path generates", () => {
  assert.deepEqual([...REVISION_OPERATIONS].sort(), [
    "replace-asset", "set-layer-opacity", "set-layer-transform", "set-layer-visible", "set-palette", "set-text",
  ]);
  // Surface geometry, seams, mirroring and spelling authority are not
  // addressable by a revision: they are what manufacturing correctness rests on.
  const source = readFileSync(new URL("../../runtime/design-master-revision.cjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const forbidden of ["designSpace.surfaces =", "mirror =", "seams =", "spellingAuthority =", "manifestHash =", "gemini", "generateContent", "prompt"]) {
    assert.equal(source.includes(forbidden), false, `a revision must not reach ${forbidden}`);
  }
  for (const module of ["design-master-revision", "design-revision-cycle"]) {
    const text = readFileSync(new URL(`../../runtime/${module}.cjs`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const forbidden of ["generativelanguage", "gemini", "generateContent", "apiKey", "prompt"]) {
      assert.equal(text.toLowerCase().includes(forbidden.toLowerCase()), false, `${module} must not reference ${forbidden}`);
    }
  }
});
