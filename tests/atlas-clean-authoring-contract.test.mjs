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
  assert.match(block(edge, "const panelLines = [", "return `OUTPUT FORMAT"), /REAR, then ROOF, then HOOD, then FRONT — the centre column, top to bottom/);
  assert.doesNotMatch(contract, /ROOF then HOOD then FRONT then REAR/i);
});

test("ATLAS creative contract carries named design context and pure rectangular pixels", () => {
  const contract = block(edge, "function atlasFlatMasterContract(", "// ── GENIE-DERIVED NORMALIZED [0,1] MATHEMATICAL TOPOLOGY");
  assert.match(contract, /The A\.T\.L\.A\.S\. TARGET TOPOLOGY block in this request places each panel with normalized \[0,1\] coordinates/);
  assert.match(contract, /panel identity mismatch/);
  assert.match(contract, /opaque, unbroken and full-bleed to all four edges/);
  assert.match(contract, /ONE CONNECTED WRAP UNWRAPPED FLAT/);
  assert.match(contract, /Set no panel names, surface IDs, legends or captions anywhere in the artwork/);
  assert.match(contract, /the space between panels is sheet separation/);
  assert.match(contract, /ARTBOARD for this exact \$\{vehicle/);
  assert.match(contract, /\(\$\{bodyClass\}\)/);
  for (const surface of ["PASSENGER SIDE", "DRIVER SIDE", "REAR", "ROOF", "HOOD", "FRONT"]) {
    assert.match(contract, new RegExp(surface));
  }
  assert.doesNotMatch(contract, /FIELD [A-F]/);
  for (const forbidden of ["DASHED BLUE", "pixel size", "title band", "widthInches", "heightInches", "FRONT FENDER", "CAB DOOR", "REAR QUARTER", "ROCKER"]) {
    assert.doesNotMatch(contract, new RegExp(forbidden, "i"));
  }
  // ⚠️ INVERTED 2026-08-31 — the third lock on the same defect.
  //
  // This required the contract to NAME ten pieces of vehicle anatomy as
  // refusals. CLAUDE.md's own Gemini guidance is that a negative makes the
  // model over-index on the forbidden concept, and Desert Ridge (c3a8ff40)
  // proved it: the prompt carried all ten refusals verbatim and both flanks
  // came back as a van side elevation with window and wheel-arch shapes, while
  // the centre four — which no anatomy sentence addressed — were clean.
  //
  // The contract now states what the output IS, in terms containing no vehicle:
  // flat printed graphic art, a printed poster, a roll of vinyl laid flat, the
  // artwork before anything is cut. The anatomy nouns are forbidden here rather
  // than required, and the positive framing is asserted in their place.
  for (const anatomyNoun of [
    "vehicle render", "vehicle photograph", "vehicle outline", "silhouette",
    "physical vehicle anatomy", "wheels", "windows", "doors", "component seams",
    "cut lines", "transparent voids", "shaped openings", "mockup lighting",
    "PICKUP COVERAGE", "bedliner", "bed sides",
  ]) {
    assert.doesNotMatch(contract, new RegExp(anatomyNoun, "i"),
      `the contract must not hand the image model "${anatomyNoun}"`);
  }
  assert.match(contract, /flat printed graphic art, the same kind of image as a printed poster/);
  assert.match(contract, /a printed poster or a roll of printed vinyl laid flat/);
  assert.match(contract, /the artwork by itself, before anything is cut or applied/);
  assert.match(contract, /produced downstream by the seven proof projections and are absent here/);
});

test("ATLAS request exposes exact identity, placement and normalized topology but no inch dimensions", () => {
  const request = block(runtime, "function atlasEdgeRequestBody", "async function callAtlasArtboardEdge");
  const panelBlock = block(request, "panels: manifest.zones.map", "teachingProofStoragePath:");
  assert.match(panelBlock, /label:/);
  assert.match(panelBlock, /surfaceId:/);
  assert.match(panelBlock, /placement:/);
  assert.match(panelBlock, /normalized: normalizedZoneTopology\(zone, manifest\)/);
  assert.doesNotMatch(panelBlock, /widthInches:|heightInches:|topology:/);
  assert.match(request, /vehicleType:/);
  assert.match(request, /teachingProofStoragePath:/);
  assert.doesNotMatch(request, /cohesionExample|guideStoragePath|correctiveNote/);
  assert.match(request, /teachingProofIdentity:/);
  assert.doesNotMatch(request, /referenceImagesBase64:[^\n]*teachingProof/);
});

test("ATLAS parts run prompt, topology, teaching proof, references — and no guide", () => {
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  const promptPart = handler.indexOf("[{ text: prompt }]");
  const topology = handler.indexOf("atlasTopologyText(panels", promptPart);
  const teaching = handler.indexOf("This image is the visual definition of A.T.L.A.S.", topology);
  const customer = handler.indexOf("for (const ref of references) pushImage(ref)", teaching);
  assert.ok(promptPart > 0 && promptPart < topology && topology < teaching && teaching < customer);
  assert.match(handler, /ATLAS_TEACHING_PROOF_CONTRACT/);
  assert.doesNotMatch(handler, /CURRENT TARGET GUIDE|guideStoragePath|guideImageBase64|INSTALLED DRIVER PROOF/);
  assert.match(handler, /atlas_artboard_input_hash_mismatch/);
});

test("ATLAS runtime and edge prompt versions are fenced together", () => {
  assert.match(runtime, /ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "atlas-artboard-designiq\.20260901\.v17-labeled-teaching-topology"/);
  assert.match(edge, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260901\.v17-labeled-teaching-topology"/);
});
