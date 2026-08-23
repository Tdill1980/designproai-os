import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import gridSliceModule from "../../runtime/server-grid-slice.cjs";
import flatSurfaceModule from "../../runtime/gemini-flat-surface.cjs";

const claimant = readFileSync(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../../runtime/index.js", import.meta.url), "utf8");
const surface = readFileSync(new URL("../../runtime/gemini-flat-surface.cjs", import.meta.url), "utf8");
const grid = readFileSync(new URL("../../runtime/server-grid-slice.cjs", import.meta.url), "utf8");
const { gridSliceAll, gridSlicePanel } = gridSliceModule;
const { authorFlatSurfaceFields, SURFACE_KEYS, VIEW_KEYS } = flatSurfaceModule;

function fieldSvg(surfaceKey, color) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200">
    <rect width="800" height="1200" fill="${color}"/>
    <text x="400" y="600" font-size="80" text-anchor="middle" fill="white">${surfaceKey}</text>
  </svg>`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("standard Call 8 consumes seven DesignPanel views and composes the dimensioned proof on the server", () => {
  assert.match(claimant, /call8ProofRequest\(rebound, manifest, frozenViews\.viewReceipts/);
  assert.match(claimant, /callTool\(baseUrl, secret, "\/compose-proof-sheet"/);
  assert.match(runtime, /authorFlatSurfaceFields/);
  assert.match(surface, /ownReference/);
  assert.match(surface, /Do not import, recall, mirror, or continue artwork from the driver side/);
  assert.match(runtime, /renderProofSheet/);
  assert.match(claimant, /proofKind: "flattened-2d-proof"/);
});

test("Call 9 is the server-native gridslice: GENIE trim, five-inch mirror bleed, no AI", () => {
  for (const marker of [
    "GRID_SLICE_CONTRACT",
    "gridSliceAll(fieldSources, manifest.expectedSurfaces",
    "bleedInches: 5",
    "step: \"gridslice\"",
    "deterministic: true",
  ]) assert.ok(claimant.includes(marker), marker);
  assert.match(grid, /resize\(crop\.resizedWidth, crop\.resizedHeight/);
  assert.match(grid, /\.extract\(\{ left: crop\.left, top: crop\.top/);
  assert.match(grid, /extendWith: "mirror"/);
  assert.match(grid, /const ppi = Math\.min\(MAX_PPI, maxCanvas \/ Math\.max\(printWidthIn, printHeightIn\)\)/);
  for (const forbidden of ["generativelanguage", "generateContent", "Gemini", "Railway", "railway"]) {
    assert.doesNotMatch(grid, new RegExp(forbidden), `${forbidden} must not exist in deterministic gridslice`);
  }
});

test("each own-surface field and gridslice is immutable hash-bound across Calls 8 and 9", () => {
  assert.match(claimant, /call9_surface_field_changed/);
  assert.match(claimant, /slice\.sourceFieldHash !== sourceFieldHashes\[key\]/);
  assert.match(claimant, /String\(call8Slice\.contentHash \|\| ""\)\.toLowerCase\(\) !== slice\.contentHash/);
  assert.match(claimant, /sourceFieldHash: slice\.sourceFieldHash/);
  assert.match(claimant, /new Set\(Object\.values\(panelHashes\)\)\.size !== produced\.length/);
});

// Owner decision 2026-08-23: the A.T.L.A.S. split path is wired to the ONE
// existing file-output pipeline. Both pipelines reach the same idempotent
// handoff, so the customer page can never again be a seven-image dead end for
// one of them.
test("both pipelines enter the standard handoff, and neither forks a second producer", () => {
  const hook = readFileSync(new URL("../../app/src/hooks/useDesignPanelProLogic.ts", import.meta.url), "utf8");
  assert.match(hook, /await handoffGeneration\(request\.requestId\)/);
  assert.doesNotMatch(
    hook,
    /if \(acceptedPipelineMode !== FLAT_FIRST_ATLAS_PIPELINE_MODE\) \{[\s\S]*?handoffGeneration/,
    "A.T.L.A.S. must not be excluded from the production handoff again",
  );
  assert.equal((hook.match(/handoffGeneration\(/g) || []).length, 1, "one handoff call site, not one per pipeline");
});

test("executable gridslice produces deterministic GENIE trim plus exact five-inch mirror bleed", async () => {
  const source = fieldSvg("driver", "#b91c1c");
  const surface = { surfaceKey: "driver", widthInches: 10, heightInches: 20 };
  const first = await gridSlicePanel(source, surface, { bleedInches: 5, maxCanvas: 1500 });
  const second = await gridSlicePanel(source, surface, { bleedInches: 5, maxCanvas: 1500 });

  assert.equal(first.contentHash, second.contentHash);
  assert.deepEqual(first.bytes, second.bytes);
  assert.equal(first.effectivePpi, 50);
  assert.equal(first.pixelWidth, 1000);
  assert.equal(first.pixelHeight, 1500);
  assert.equal(first.printWidthIn, 20);
  assert.equal(first.printHeightIn, 30);
  assert.equal(first.bleedIn, 5);
});

test("executable gridslice uses six exact own-surface fields and never reuses a panel", async () => {
  const surfaces = [
    { surfaceKey: "driver", widthInches: 10, heightInches: 20 },
    { surfaceKey: "passenger", widthInches: 20, heightInches: 20 },
    { surfaceKey: "hood", widthInches: 5, heightInches: 15 },
    { surfaceKey: "roof", widthInches: 10, heightInches: 15 },
    { surfaceKey: "front", widthInches: 15, heightInches: 15 },
    { surfaceKey: "rear", widthInches: 20, heightInches: 40 },
  ];
  const colors = ["#b91c1c", "#1d4ed8", "#15803d", "#7e22ce", "#c2410c", "#0f766e"];
  const fields = new Map(surfaces.map((surface, index) => [
    surface.surfaceKey,
    fieldSvg(surface.surfaceKey, colors[index]),
  ]));

  const panels = await gridSliceAll(fields, surfaces, { bleedInches: 5, maxCanvas: 1500 });

  assert.deepEqual(panels.map((panel) => panel.surfaceKey), surfaces.map((surface) => surface.surfaceKey));
  assert.equal(new Set(panels.map((panel) => panel.contentHash)).size, 6);
  for (const panel of panels) {
    assert.equal(panel.sourceFieldHash, sha256(fields.get(panel.surfaceKey)));
    assert.equal(panel.bleedIn, 5);
    assert.equal(panel.deterministic, true);
    assert.equal(panel.step, "gridslice");
  }
});

test("server Call 8 runs the proven own-side GENERATE → QC → RETRY gate before persistence", async () => {
  const sourceViews = VIEW_KEYS.map((viewKey, index) => {
    const bytes = fieldSvg(viewKey, `hsl(${index * 47} 70% 40%)`);
    return {
      viewKey,
      storagePath: `users/test/revisions/test/inputs/${viewKey}.svg`,
      contentHash: sha256(bytes),
      byteSize: bytes.length,
      contentType: "image/svg+xml",
      bytes,
    };
  });
  const surfaces = SURFACE_KEYS.map((surfaceKey, index) => ({
    surfaceKey,
    widthInches: 20 + index,
    heightInches: 10 + index,
  }));
  const generatedBySide = new Map();
  const referenceHashes = new Map();
  const stored = new Map();
  const fields = await authorFlatSurfaceFields({
    revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceViews,
    surfaces,
    textLock: { bodyText: {}, logoPlacements: [] },
    sleep: async () => {},
    generateSurface: async ({ surface: ownSurface, ownReference }) => {
      const calls = (generatedBySide.get(ownSurface.surfaceKey) || 0) + 1;
      generatedBySide.set(ownSurface.surfaceKey, calls);
      referenceHashes.set(ownSurface.surfaceKey, sha256(Buffer.from(ownReference.data, "base64")));
      return fieldSvg(`${ownSurface.surfaceKey}-${calls}`, `hsl(${(SURFACE_KEYS.indexOf(ownSurface.surfaceKey) * 47 + calls) % 360} 70% 40%)`);
    },
    judgeSurface: async ({ surfaceKey }) => surfaceKey === "driver" && generatedBySide.get(surfaceKey) === 1
      ? { pass: false, issues: ["wrong_design"], note: "wrong own-side layout" }
      : { pass: true, issues: [], note: "matches own approved side" },
    loadExisting: async (ownSurface) => stored.get(ownSurface.surfaceKey) || null,
    persist: async (ownSurface, bytes) => stored.set(ownSurface.surfaceKey, Buffer.from(bytes)),
  });

  assert.equal(generatedBySide.get("driver"), 2);
  for (const surfaceKey of SURFACE_KEYS.filter((key) => key !== "driver")) assert.equal(generatedBySide.get(surfaceKey), 1);
  assert.equal(fields.find((field) => field.surfaceKey === "driver").qc.attempts, 2);
  assert.equal(new Set(fields.map((field) => field.contentHash)).size, 6);
  for (const field of fields) {
    assert.equal(field.qc.accepted, true);
    assert.equal(referenceHashes.get(field.surfaceKey), sourceViews.find((view) => view.viewKey === field.surfaceKey).contentHash);
    assert.equal(sha256(stored.get(field.surfaceKey)), field.contentHash);
  }
});

test("server Call 8 refuses three own-side fields that fail hard QC", async () => {
  const sourceViews = VIEW_KEYS.map((viewKey, index) => {
    const bytes = fieldSvg(viewKey, `hsl(${index * 47} 70% 40%)`);
    return { viewKey, storagePath: `${viewKey}.svg`, contentHash: sha256(bytes), byteSize: bytes.length, contentType: "image/svg+xml", bytes };
  });
  await assert.rejects(() => authorFlatSurfaceFields({
    revisionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceViews,
    surfaces: SURFACE_KEYS.map((surfaceKey) => ({ surfaceKey, widthInches: 20, heightInches: 10 })),
    textLock: { bodyText: {}, logoPlacements: [] },
    sleep: async () => {},
    generateSurface: async () => fieldSvg("wrong", "#111827"),
    judgeSurface: async () => ({ pass: false, issues: ["wrong_design"], note: "does not match" }),
    loadExisting: async () => null,
    persist: async () => assert.fail("hard-QC field must never persist"),
  }), /failed closed after 3 attempts: QC: wrong_design/);
});
