import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const runtime = fs.readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const edge = fs.readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");

function block(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test("ATLAS model-facing guide is six labeled spatial regions with no production furniture", () => {
  const guide = block(runtime, "function authoringGuideSvg(manifest)", "/** The human-readable installer map");
  assert.match(guide, /manifest\.zones\.map/);
  assert.match(guide, /authoringGuideLabelsSvg/);
  assert.doesNotMatch(guide, /guideGeometrySvg|stroke-dasharray|<line\\b|<path\\b|<polygon\\b/i);
});

test("ATLAS center topology order is one authority: rear roof hood front", () => {
  assert.match(runtime, /const CENTER_ORDER = Object\.freeze\(\["rear", "roof", "hood", "front"\]\)/);
  const contract = block(edge, "function atlasFlatMasterContract(", "function buildDesignIQPrompt");
  assert.match(contract, /centre column is fixed top-to-bottom as Rear, Roof, Hood, Front\./);
  assert.doesNotMatch(contract, /ROOF then HOOD then FRONT then REAR/i);
});

test("ATLAS creative contract carries labeled topology without dimensions or trim furniture", () => {
  const contract = block(edge, "function atlasFlatMasterContract(", "function buildDesignIQPrompt");
  assert.match(contract, /hardwired flattened TOP-VIEW artboard/);
  assert.match(contract, /panel identity mismatch/);
  for (const forbidden of ["DASHED BLUE", "pixel size", "title band", "vehicle silhouette", "ROCKER", "FENDER", "QUARTER", "widthInches", "heightInches"]) {
    assert.doesNotMatch(contract, new RegExp(forbidden, "i"));
  }
});

test("ATLAS request exposes exact identity and placement but no dimensions or component topology", () => {
  const request = block(runtime, "function atlasEdgeRequestBody", "async function callAtlasArtboardEdge");
  const panelBlock = block(request, "panels: manifest.zones.map", "guideStoragePath:");
  assert.match(panelBlock, /label:/);
  assert.match(panelBlock, /surfaceId:/);
  assert.match(panelBlock, /placement:/);
  assert.doesNotMatch(panelBlock, /widthInches:|heightInches:|topology:/);
});

test("ATLAS runtime and edge prompt versions are fenced together", () => {
  assert.match(runtime, /ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "atlas-artboard-designiq\.20260830\.v9-labeled-topology"/);
  assert.match(edge, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260830\.v9-labeled-topology"/);
});
