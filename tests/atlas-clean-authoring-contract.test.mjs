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

test("ATLAS model-facing guide is six neutral masks with no visual instruction furniture", () => {
  const guide = block(runtime, "function authoringGuideSvg(manifest)", "/** The human-readable installer map");
  assert.match(guide, /manifest\.zones\.map/);
  assert.doesNotMatch(guide, /authoringGuideLabelsSvg|guideGeometrySvg|stroke=|stroke-dasharray|<text\\b|<line\\b|<path\\b|<polygon\\b/i);
});

test("ATLAS center topology order stays physical in runtime and neutral in model prose", () => {
  assert.match(runtime, /const CENTER_ORDER = Object\.freeze\(\["rear", "roof", "hood", "front"\]\)/);
  const contract = block(edge, "function atlasFlatMasterContract(", "function atlasNeutralCreativeDirection");
  assert.match(contract, /centre column is fixed top-to-bottom as Fields C, D, E, F\./);
  assert.doesNotMatch(contract, /ROOF then HOOD then FRONT then REAR/i);
});

test("ATLAS creative contract carries neutral field topology without anatomy triggers or trim furniture", () => {
  const contract = block(edge, "function atlasFlatMasterContract(", "function atlasNeutralCreativeDirection");
  assert.match(contract, /neutral spatial mask with six fixed GENIE regions/);
  assert.match(contract, /panel identity mismatch/);
  assert.match(contract, /unbroken rectangular field of continuous printed artwork/);
  for (const field of ["FIELD A", "FIELD B", "FIELD C", "FIELD D", "FIELD E", "FIELD F"]) {
    assert.match(contract, new RegExp(field));
  }
  for (const forbidden of ["DASHED BLUE", "pixel size", "title band", "widthInches", "heightInches", "doors", "windows", "wheel arches", "vehicle silhouettes"]) {
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
  assert.match(runtime, /ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "atlas-artboard-designiq\.20260830\.v12-neutral-fields"/);
  assert.match(edge, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260830\.v12-neutral-fields"/);
});
