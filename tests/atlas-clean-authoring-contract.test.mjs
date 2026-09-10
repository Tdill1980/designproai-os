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
  // Ends at the ONE-FIELD boundary, not at the GENIE one. The old anchor ran
  // past atlasFlatMasterContract and swallowed the whole field-contract region
  // — including its comments — so prose written ABOUT the one-field tail was
  // being convicted as if the legacy six-container contract had said it to the
  // model. The field tail has its own dedicated lock below and is also covered
  // by the whole-prompt guard in tests/atlas-one-field-call1.test.mjs, so
  // nothing loses coverage by asserting here only about the named function.
  const contract = block(edge, "function atlasFlatMasterContract(", "// ── ONE-FIELD OUTPUT CONTRACT");
  assert.doesNotMatch(contract, /normalized \[0,1\] coordinates|TARGET TOPOLOGY block/);
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
  const panelBlock = block(request, "panels: manifest.zones.map", "...(manifest?.topology === FIELD_TOPOLOGY");
  assert.match(panelBlock, /label:/);
  assert.match(panelBlock, /surfaceId:/);
  assert.match(panelBlock, /placement:/);
  assert.match(panelBlock, /normalized: normalizedZoneTopology\(zone, manifest\)/);
  assert.doesNotMatch(panelBlock, /widthInches:|heightInches:|topology:/);
  assert.match(request, /vehicleType:/);
  // Owner ruling 2026-09-07: the branch is a property of the manifest, so BOTH
  // requests are built here and both stay covered. Since 2026-09-10 the field
  // request is the fail-over's; its two keys live only in that branch, and the
  // six-surface request never carries them.
  const fieldBranch = block(request, "manifest?.topology === FIELD_TOPOLOGY ? {", "} : {");
  assert.match(fieldBranch, /fieldContract: ATLAS_FIELD_PROMPT_CONTRACT/);
  assert.match(fieldBranch, /noseEdge:/);
  assert.doesNotMatch(fieldBranch, /teachingProof|guideStoragePath/);
  assert.doesNotMatch(request.replace(fieldBranch, ""), /fieldContract:|noseEdge:/);
  assert.match(request, /teachingProofStoragePath: extras.teachingProofStoragePath/);
  assert.match(request, /guideStoragePath: extras.guideStoragePath/);
  assert.doesNotMatch(request, /cohesionExample|correctiveNote/);
  assert.doesNotMatch(request, /referenceImagesBase64:[^\n]*teachingProof/);
});

test("ATLAS field branch sends the prompt and customer references only", () => {
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  const fieldBranch = handler.slice(handler.indexOf("if (atlasField) {"), handler.indexOf("} else {", handler.indexOf("if (atlasField) {")));
  assert.match(fieldBranch, /for \(const ref of references\) pushImage\(ref\)/);
  assert.doesNotMatch(fieldBranch, /downloadPart\(|TEACHING REFERENCE|TARGET GUIDE|atlasTopologyText/);
  assert.match(handler, /atlas_artboard_field_contract_unknown/);
  const fieldTail = block(edge, "function atlasFieldContract(", "// ── GENIE-DERIVED NORMALIZED [0,1] MATHEMATICAL TOPOLOGY");
  assert.match(fieldTail, /ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image/);
  // v24's thirds were drawn as framed passages; v2/v25's coordinate rows were
  // painted as numerals and its "areas" framing as a poster on a mount (runs
  // 34425798511 / 34430841234). Neither partition may return.
  assert.doesNotMatch(fieldTail, /three equal horizontal thirds|THE UPPER THIRD|THE MIDDLE THIRD|THE LOWER THIRD/);
  assert.doesNotMatch(fieldTail, /supporting register|calmer intensity|secondary motifs/);
  const emitted = fieldTail.slice(fieldTail.indexOf("return ["));
  assert.doesNotMatch(emitted, /written as fractions|measured from the top-left|These areas|those areas|single area|separate pictures/);
  assert.doesNotMatch(emitted, /Forward energy sweeps/);
  // v3 — the positive full-bleed contract: the print itself, running off all
  // four edges, finished everywhere, with the customer's wording as the only
  // lettering. Stated as what the image IS, not as a list of refusals.
  assert.match(emitted, /The image is the printed artwork itself, at full size, seen straight on, and nothing else/);
  assert.match(emitted, /The design runs off all four edges/);
  assert.match(emitted, /There is no margin, border, frame, mount or backdrop around it; the artwork reaches every corner/);
  assert.match(emitted, /Every part of the image, corner to corner, is finished, intentional, commercially valuable artwork/);
  assert.match(emitted, /The focal subject may span as much of the image as the concept calls for/);
  // The lettering sentence is chosen by hasBrandName above the return.
  assert.match(fieldTail, /the only lettering in the image is the company name and the wording the brief calls for/);
  assert.match(fieldTail, /appears whole and legible, and it is the only lettering in the image/);
  for (const forbidden of ["panel", "artboard", "orthographic", "rectangle", "sheet", "template", "silhouette",
    "container", "wheel", "window", "do not", "never a", "A.T.L.A.S.", "region", "zone", "band", "third",
    "upper", "middle", "lower", "driver", "passenger", "hood", "roof", "front", "rear", "•",
    "area", "areas", "fraction", "fractions", "coordinate", "coordinates", "caption", "captions", "label", "labels"]) {
    assert.ok(!new RegExp(`\\b${forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(emitted),
      `the field tail must not hand the image model "${forbidden}"`);
  }
});

test("ATLAS field tail reads no geometry at all: no normalized rect, no fraction, no sweep", () => {
  // RULE 0.33: the model is shown no normalized [0,1] text. v2 derived six
  // coordinate rows from panels[].normalized "so the conditioning and the
  // cutter read the same geometry", and the model painted the rows. The
  // request still carries and validates panels[].normalized as OS data
  // (atlas_artboard_topology_required, atlasNormalizedRect); the tail must
  // never read it.
  const fieldTail = block(edge, "function atlasFieldContract(", "// ── GENIE-DERIVED NORMALIZED [0,1] MATHEMATICAL TOPOLOGY");
  const signature = fieldTail.slice(0, fieldTail.indexOf("{"));
  assert.doesNotMatch(signature, /panels|normalized|noseEdge|AtlasNoseEdge/);
  const body = fieldTail.slice(fieldTail.indexOf("{"));
  assert.doesNotMatch(body, /normalized|toFixed|\.sort\(|Number\(n\./);
  const literals = body.match(/(?<![\w.])\d*\.\d{2,}(?![\w])/g) || [];
  assert.deepEqual(literals, [], `geometry fraction(s) in the field tail: ${literals.join(", ")}`);
  // The sweep helpers are gone with the coordinates: a per-flank direction
  // cannot be stated without positional language, and every positional
  // statement this tail has carried was painted.
  assert.doesNotMatch(edge, /function atlasFieldSweep\(|function atlasSweepPhrase\(/);
  // The nose edges are still validated on the request, outside the prompt.
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  assert.match(handler, /atlasNoseEdgeInput\(body\.noseEdge\)/);
  assert.doesNotMatch(handler.slice(0, handler.indexOf("} as any);")), /atlasNoseEdge,/);
});

test("ATLAS parts run prompt, teaching proof, references, then the guide LAST", () => {
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  const promptPart = handler.indexOf("[{ text: prompt }]");
  const teaching = handler.indexOf("This example shows ONE cohesive vehicle-wrap design", promptPart);
  const customer = handler.indexOf("for (const ref of references) pushImage(ref)", teaching);
  assert.ok(!handler.includes("atlasTopologyText(panels"), "no coordinate table reaches the model");
  assert.ok(promptPart > 0 && promptPart < teaching && teaching < customer);
  assert.match(handler, /ATLAS_TEACHING_PROOF_CONTRACT/);
  assert.doesNotMatch(handler, /INSTALLED DRIVER PROOF/);
  assert.match(handler, /CURRENT TARGET GUIDE/);
  assert.ok(handler.indexOf("CURRENT TARGET GUIDE") > handler.indexOf("for (const ref of references) pushImage(ref)"),
    "the target guide is the LAST image, after the customer references");
  assert.match(handler, /atlas_artboard_input_hash_mismatch/);
});

test("ATLAS runtime and edge prompt versions are fenced together", () => {
  assert.match(runtime, /ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "atlas-artboard-designiq\.20260901\.v23-orthographic-restored"/);
  assert.match(edge, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260901\.v23-orthographic-restored"/);
  assert.match(runtime, /ATLAS_FIELD_PROMPT_CONTRACT = "designpro\.atlas-field-prompt\.v3"/);
  assert.match(edge, /ATLAS_FIELD_PROMPT_CONTRACT = "designpro\.atlas-field-prompt\.v3"/);
});
