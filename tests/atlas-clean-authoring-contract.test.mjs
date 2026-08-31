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

test("ATLAS center topology order stays physical and named in model prose", () => {
  assert.match(runtime, /const CENTER_ORDER = Object\.freeze\(\["rear", "roof", "hood", "front"\]\)/);
  const contract = block(edge, "function atlasFlatMasterContract(", "function atlasCreativeDirection");
  assert.match(contract, /centre column is fixed top-to-bottom as Rear, Roof, Hood, Front\./);
  assert.doesNotMatch(contract, /ROOF then HOOD then FRONT then REAR/i);
});

test("ATLAS creative contract carries named design context and pure rectangular pixels", () => {
  const contract = block(edge, "function atlasFlatMasterContract(", "function atlasCreativeDirection");
  assert.match(contract, /neutral spatial mask with six fixed GENIE regions/);
  assert.match(contract, /panel identity mismatch/);
  assert.match(contract, /pure, opaque, unbroken, full-bleed rectangular region of continuous printable artwork/);
  assert.match(contract, /ONE unified vehicle-wrap design arranged flat as six named printable production surfaces/);
  assert.match(contract, /TARGET VEHICLE \(CANONICAL\)/);
  assert.match(contract, /BODY CLASS \(GENIE\)/);
  for (const surface of ["PASSENGER SIDE", "DRIVER SIDE", "REAR", "ROOF", "HOOD", "FRONT"]) {
    assert.match(contract, new RegExp(surface));
  }
  assert.doesNotMatch(contract, /FIELD [A-F]/);
  for (const forbidden of ["DASHED BLUE", "pixel size", "title band", "widthInches", "heightInches", "FRONT FENDER", "CAB DOOR", "REAR QUARTER", "ROCKER"]) {
    assert.doesNotMatch(contract, new RegExp(forbidden, "i"));
  }
  for (const refusedPixelContent of ["vehicle render", "vehicle photograph", "vehicle outline", "physical vehicle anatomy", "wheels", "windows", "doors", "component seams", "transparent voids", "shaped openings"]) {
    assert.match(contract, new RegExp(refusedPixelContent, "i"));
  }
});

test("ATLAS request exposes exact identity and placement but no dimensions or component topology", () => {
  const request = block(runtime, "function atlasEdgeRequestBody", "async function callAtlasArtboardEdge");
  const panelBlock = block(request, "panels: manifest.zones.map", "guideStoragePath:");
  assert.match(panelBlock, /label:/);
  assert.match(panelBlock, /surfaceId:/);
  assert.match(panelBlock, /placement:/);
  assert.doesNotMatch(panelBlock, /widthInches:|heightInches:|topology:/);
  assert.match(request, /vehicleType:/);
  assert.match(request, /cohesionExampleProofStoragePath:/);
  assert.match(request, /cohesionExampleFlatStoragePath:/);
  assert.match(request, /cohesionExampleIdentity:/);
  assert.doesNotMatch(request, /referenceImagesBase64:[^\n]*cohesionExample/);
});

test("ATLAS relationship teaching is installed-first, solid-flat-second, current guide last", () => {
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  const installed = handler.indexOf("RELATIONSHIP-ONLY EXAMPLE 1/2");
  const flat = handler.indexOf("RELATIONSHIP-ONLY EXAMPLE 2/2");
  const customer = handler.indexOf("for (const ref of references) pushImage(ref)", flat);
  const target = handler.indexOf("CURRENT TARGET GUIDE", customer);
  const guide = handler.indexOf("await downloadPart(body.guideStoragePath", target);
  assert.ok(installed > 0 && installed < flat && flat < customer && customer < target && target < guide);
  assert.match(handler, /ATLAS_COHESION_PAIR_CONTRACT/);
  assert.match(handler, /atlas_artboard_input_hash_mismatch/);
});

test("ATLAS runtime and edge prompt versions are fenced together", () => {
  assert.match(runtime, /ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "atlas-artboard-designiq\.20260831\.v14-pure-rectangles"/);
  assert.match(edge, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260831\.v14-pure-rectangles"/);
});
