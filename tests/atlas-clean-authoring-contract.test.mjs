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
  const panelBlock = block(request, "panels: manifest.zones.map", "fieldContract:");
  assert.match(panelBlock, /label:/);
  assert.match(panelBlock, /surfaceId:/);
  assert.match(panelBlock, /placement:/);
  assert.match(panelBlock, /normalized: normalizedZoneTopology\(zone, manifest\)/);
  assert.doesNotMatch(panelBlock, /widthInches:|heightInches:|topology:/);
  assert.match(request, /vehicleType:/);
  // ONE-FIELD CONTRACT (owner ruling 2026-09-02): the request names the field
  // contract and the code-owned nose edges; no teaching proof, no guide, no
  // corrective note travels. The panel list stays as OS data the edge
  // validates and never puts in the field prompt.
  assert.match(request, /fieldContract: ATLAS_FIELD_PROMPT_CONTRACT/);
  assert.match(request, /noseEdge: manifest\?\.installerMap\?\.noseEdge \|\| NOSE_EDGE/);
  assert.doesNotMatch(request, /cohesionExample|correctiveNote|teachingProofStoragePath|teachingProofIdentity|guideStoragePath/);
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
  // v25 — ANONYMOUS SPATIAL COORDINATES. The three-equal-thirds instruction is
  // gone: it described a partition the cutter does not use, and the four
  // production surfaces taken from the lower band were being told to be a
  // "supporting register" of "secondary motifs".
  assert.doesNotMatch(fieldTail, /three equal horizontal thirds|THE UPPER THIRD|THE MIDDLE THIRD|THE LOWER THIRD/);
  assert.doesNotMatch(fieldTail, /supporting register|calmer intensity|secondary motifs/);
  assert.match(fieldTail, /These areas of it, written as fractions of the image/);
  assert.match(fieldTail, /must each carry a complete and finished passage/);
  // Cohesion stays the governing object; no area becomes its own mini-design.
  assert.match(fieldTail, /They are not separate pictures/);
  const emitted = fieldTail.slice(fieldTail.indexOf("return ["));
  for (const forbidden of ["panel", "artboard", "orthographic", "rectangle", "sheet", "template", "silhouette",
    "container", "wheel", "window", "do not", "never a", "A.T.L.A.S.", "region", "zone", "band", "third",
    "upper", "middle", "lower", "driver", "passenger", "hood", "roof", "front", "rear", "•"]) {
    assert.ok(!new RegExp(`\\b${forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(emitted),
      `the field tail must not hand the image model "${forbidden}"`);
  }
});

test("ATLAS field geometry is derived from panels[].normalized, never hard-coded", () => {
  const fieldTail = block(edge, "function atlasFieldContract(", "// ── GENIE-DERIVED NORMALIZED [0,1] MATHEMATICAL TOPOLOGY");
  const body = fieldTail.slice(fieldTail.indexOf("{"));
  // Every coordinate comes off the already-validated request geometry.
  assert.match(body, /panel\.normalized/);
  assert.match(body, /Number\(n\.x\)/);
  assert.match(body, /Number\(n\.y\)/);
  assert.match(body, /x0 \+ Number\(n\.width\)/);
  assert.match(body, /y0 \+ Number\(n\.height\)/);
  // Rows are ordered by the coordinates themselves, so row position cannot be
  // reverse-mapped onto a production surface.
  assert.match(body, /\.sort\(\(a, b\) => a\.y0 - b\.y0 \|\| a\.x0 - b\.x0\)/);
  // A geometry literal here would silently decouple the conditioning from the
  // cutter. There must not be one.
  const literals = body.match(/(?<![\w.])\d*\.\d{3,}(?![\w])/g) || [];
  assert.deepEqual(literals, [], `hard-coded geometry fraction(s) in the field tail: ${literals.join(", ")}`);
  // Six regions or the call refuses; it never composes against partial geometry.
  assert.match(body, /atlas_field_geometry_required/);
  assert.match(body, /panels\.length !== 6/);
  // Surface identity is consumed server-side and only ever yields a sweep phrase.
  const sweep = block(edge, "function atlasFieldSweep(", "\n/**");
  assert.match(sweep, /startsWith\("DRIVER"\)/);
  assert.match(sweep, /startsWith\("PASSENGER"\)/);
  assert.match(sweep, /atlasSweepPhrase/);
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
  assert.match(runtime, /ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "atlas-artboard-designiq\.20260904\.v25-field-coordinates"/);
  assert.match(edge, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260904\.v25-field-coordinates"/);
  assert.match(runtime, /ATLAS_FIELD_PROMPT_CONTRACT = "designpro\.atlas-field-prompt\.v2"/);
  assert.match(edge, /ATLAS_FIELD_PROMPT_CONTRACT = "designpro\.atlas-field-prompt\.v2"/);
});
