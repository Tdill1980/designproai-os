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

test("ATLAS model-facing guide is six plain spatial regions with no technical furniture", () => {
  const guide = block(runtime, "function authoringGuideSvg(manifest)", "/** The human-readable installer map");
  assert.match(guide, /manifest\.zones\.map/);
  assert.doesNotMatch(guide, /guideLabelsSvg|guideGeometrySvg|<text\\b|stroke-dasharray|<line\\b|<path\\b|<polygon\\b/i);
});

test("ATLAS center topology order is one authority: rear roof hood front", () => {
  assert.match(runtime, /const CENTER_ORDER = Object\.freeze\(\["rear", "roof", "hood", "front"\]\)/);
  const contract = block(edge, "function atlasFlatMasterContract(", "function buildDesignIQPrompt");
  assert.match(contract, /Centre top-to-bottom = Rear, Roof, Hood, Front\./);
  assert.doesNotMatch(contract, /ROOF then HOOD then FRONT then REAR/i);
});

test("ATLAS creative contract contains no production furniture vocabulary", () => {
  const contract = block(edge, "function atlasFlatMasterContract(", "function buildDesignIQPrompt");
  for (const forbidden of ["DASHED BLUE", "Surface ID", "pixel size", "title band", "vehicle silhouette", "ROCKER", "FENDER", "QUARTER"]) {
    assert.doesNotMatch(contract, new RegExp(forbidden, "i"));
  }
});

test("ATLAS request stops exposing dimensions IDs placement and component topology to Gemini", () => {
  const request = block(runtime, "function atlasEdgeRequestBody", "async function callAtlasArtboardEdge");
  const panelBlock = block(request, "panels: manifest.zones.map", "guideStoragePath:");
  assert.match(panelBlock, /label:/);
  assert.doesNotMatch(panelBlock, /surfaceId:|placement:|widthInches:|heightInches:|topology:/);
});

test("ATLAS runtime and edge prompt versions are fenced together", () => {
  assert.match(runtime, /ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "atlas-artboard-designiq\.20260828\.v8-clean"/);
  assert.match(edge, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260828\.v8-clean"/);
});
