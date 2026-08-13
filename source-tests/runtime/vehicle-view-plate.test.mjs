// Phase 4 gate: the vehicle plate carries geometry and light, never artwork.
//
// A plate is the only thing in the 3D proof that is not a production surface,
// so it is the only place a wrong picture could come from. It is therefore
// pinned by digest, declared rather than fitted, and checked for the one
// mistake that already reached a customer: painting a flank surface onto a view
// facing the other way.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const {
  validateViewPlates, viewPlateHash, VIEW_PLATE_CONTRACT, MAX_MESH_COLS,
} = require("../../runtime/vehicle-view-plate.cjs");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

const FRAME = { widthPx: 1600, heightPx: 900 };

/** A rectangular mesh, optionally bowed to stand in for body curvature. */
function mesh(box, { rows = 1, cols = 1, bow = 0 } = {}) {
  const points = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const u = col / cols;
      const v = row / rows;
      points.push({
        u, v,
        x: box.x + u * box.w,
        y: box.y + v * box.h + bow * Math.sin(u * Math.PI),
      });
    }
  }
  return { rows, cols, points };
}

const image = (name) => ({ assetId: name, contentHash: sha256(name) });

function view(viewKey, handedness, surfaces, box = { x: 100, y: 100, w: 1200, h: 600 }) {
  return {
    viewKey, handedness, label: viewKey,
    base: image(`${viewKey}-base`),
    shading: image(`${viewKey}-shade`),
    specular: image(`${viewKey}-spec`),
    panels: surfaces.map((surfaceKey) => ({
      surfaceKey,
      mask: image(`${viewKey}-${surfaceKey}-mask`),
      mesh: mesh(box),
    })),
  };
}

function plateSet() {
  return {
    contract: VIEW_PLATE_CONTRACT,
    plateSetId: uuid("a"), vehicleId: uuid("b"),
    dimensionManifestId: uuid("c"), manifestHash: sha256("manifest"),
    widthPx: FRAME.widthPx, heightPx: FRAME.heightPx,
    views: [
      view("driver", "left", ["driver"]),
      view("passenger", "right", ["passenger"]),
      view("hood", "none", ["hood"]),
      view("roof", "none", ["roof"]),
      view("front", "none", ["front"]),
      view("rear", "none", ["rear"]),
    ],
  };
}

const rejects = (mutate, code) => {
  const draft = clone(plateSet());
  mutate(draft);
  assert.throws(() => validateViewPlates(draft), (error) => error.code === code,
    `expected ${code}`);
};

test("GATE: a plate set declares geometry and light, and carries no artwork", () => {
  const plates = validateViewPlates(plateSet());
  const serialised = JSON.stringify(plates);
  // Every image a plate names is a base, a shading band, a specular band or a
  // mask. There is no field through which artwork could enter.
  for (const view of plates.views) {
    const named = [view.base.assetId, view.shading.assetId, view.specular.assetId,
      ...view.panels.map((panel) => panel.mask.assetId)];
    for (const assetId of named) {
      assert.match(assetId, /-(base|shade|spec|mask)$/, `${assetId} is not a geometry or light plate`);
    }
  }
  assert.equal(/artwork|layer|textId|logoIdentityKey|assetKind/.test(serialised), false);

  // And nothing in the module generates.
  const source = readFileSync(new URL("../../runtime/vehicle-view-plate.cjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  for (const term of ["generativelanguage", "gemini", "generateContent", "apiKey", "prompt"]) {
    assert.equal(source.toLowerCase().includes(term.toLowerCase()), false, `the plate contract must not reference ${term}`);
  }
});

test("GATE: a flank surface cannot be painted onto a view facing the other way", () => {
  // This is the defect that started the architecture change. The passenger
  // composition was derived by mirroring the driver composition while its text
  // was separately re-rendered and mutated, and every structural check passed.
  rejects((p) => { p.views[1].handedness = "left"; }, "plate_view_handedness_conflict");
  rejects((p) => { p.views[0].handedness = "right"; }, "plate_view_handedness_conflict");
  rejects((p) => { p.views[0].handedness = "none"; }, "plate_view_handedness_conflict");
  // No camera sees both flanks, and a view claiming to is the exact confusion
  // that let one composition stand in for two.
  rejects((p) => { p.views[0].panels.push(clone(p.views[1].panels[0])); }, "plate_view_both_flanks");
});

test("every one of the six surfaces must be shown to the customer somewhere", () => {
  rejects((p) => { p.views = p.views.slice(0, 5); }, "plate_surface_never_shown");
  // Showing a surface on more than one view is fine — a hero and a flank may
  // both carry the driver side.
  const draft = clone(plateSet());
  draft.views.push(view("hero", "left", ["driver", "hood"], { x: 200, y: 150, w: 1000, h: 500 }));
  const plates = validateViewPlates(draft);
  assert.equal(plates.views.length, 7);
  assert.deepEqual(plates.views[6].panels.map((panel) => panel.surfaceKey), ["driver", "hood"]);
});

test("a mesh must be complete, in range, and free of folded or collapsed cells", () => {
  rejects((p) => { p.views[0].panels[0].mesh.points.pop(); }, "plate_mesh_incomplete");
  rejects((p) => { p.views[0].panels[0].mesh.points[0].u = 1.4; }, "plate_mesh_uv_out_of_range");
  rejects((p) => { p.views[0].panels[0].mesh.points[0].v = -0.01; }, "plate_mesh_uv_out_of_range");
  rejects((p) => { p.views[0].panels[0].mesh.points[3].x = FRAME.widthPx + 1; }, "plate_mesh_point_outside_frame");
  rejects((p) => { p.views[0].panels[0].mesh.points[3].y = -2; }, "plate_mesh_point_outside_frame");
  // A collapsed cell has no area, so a destination pixel inside it has no
  // single source.
  rejects((p) => {
    const points = p.views[0].panels[0].mesh.points;
    points[1].x = points[0].x;
    points[3].x = points[2].x;
  }, "plate_mesh_cell_degenerate");
  // A cell wound against its neighbours samples the artwork backwards inside
  // its own footprint: locally mirrored lettering, on a proof, in one panel.
  rejects((p) => {
    const draft = mesh({ x: 100, y: 100, w: 1200, h: 600 }, { rows: 1, cols: 2 });
    draft.points[2].x = 400;
    draft.points[5].x = 400;
    p.views[0].panels[0].mesh = draft;
  }, "plate_mesh_cell_folded");
  rejects((p) => { p.views[0].panels[0].mesh.cols = MAX_MESH_COLS + 1; }, "plate_integer_invalid");
});

test("a curved mesh with many cells is accepted, and keeps its points verbatim", () => {
  const draft = clone(plateSet());
  draft.views[0].panels[0].mesh = mesh({ x: 120, y: 140, w: 1300, h: 560 }, { rows: 6, cols: 12, bow: 40 });
  const plates = validateViewPlates(draft);
  const stored = plates.views[0].panels[0].mesh;
  assert.equal(stored.points.length, 7 * 13);
  assert.equal(stored.points[0].u, 0);
  assert.equal(stored.points[stored.points.length - 1].u, 1);
  // Curvature is carried, not flattened away.
  assert.notEqual(stored.points[6].y, stored.points[0].y);
});

test("every plate image is pinned by digest, and identity covers every point", () => {
  rejects((p) => { p.views[0].base.contentHash = "not-a-digest"; }, "plate_hash_invalid");
  rejects((p) => { delete p.views[0].panels[0].mask.assetId; }, "plate_asset_id_missing");
  rejects((p) => { p.contract = "designpro.vehicle-view-plates.v2"; }, "plate_contract_invalid");
  rejects((p) => { p.views[1].viewKey = "driver"; }, "plate_view_duplicated");

  const first = validateViewPlates(plateSet());
  const second = validateViewPlates(plateSet());
  assert.equal(first.plateSetHash, second.plateSetHash);
  assert.equal(first.plateSetHash, viewPlateHash({ ...first, plateSetHash: undefined }));

  // Moving one mesh point by a pixel is a different plate set.
  const moved = clone(plateSet());
  moved.views[3].panels[0].mesh.points[2].x += 1;
  assert.notEqual(validateViewPlates(moved).plateSetHash, first.plateSetHash);

  // As is swapping a mask for a different file.
  const remasked = clone(plateSet());
  remasked.views[2].panels[0].mask.contentHash = sha256("a different mask");
  assert.notEqual(validateViewPlates(remasked).plateSetHash, first.plateSetHash);
});

test("the specular band is optional, and everything else is not", () => {
  const draft = clone(plateSet());
  draft.views[0].specular = null;
  assert.equal(validateViewPlates(draft).views[0].specular, null);
  rejects((p) => { delete p.views[0].shading; }, "plate_object_invalid");
  rejects((p) => { delete p.views[0].base; }, "plate_object_invalid");
  rejects((p) => { p.views[0].panels = []; }, "plate_array_invalid");
  rejects((p) => { p.views[0].panels[0].surfaceKey = "tailgate"; }, "plate_panel_surface_unknown");
});
