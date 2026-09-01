// THE CANONICAL CALL 1 RUNS THROUGH THE REAL EDGE FUNCTION — owner directive
// (Trish 2026-08-27, PASTE_TO_CLAUDE.md). These locks hold the two halves of
// that contract:
//
//   1. supabase/functions/design-panel-ai-generate/index.ts is the SOLE Call-1
//      network endpoint: its atlas-artboard mode EXECUTES the real Persona-2
//      buildDesignerPrompt, swaps only the presentation tail (exact-match,
//      throw-on-drift), and makes exactly ONE Gemini image request.
//   2. runtime/flat-first-atlas.cjs assembles no creative prompt text and makes
//      no direct Gemini request for Call 1: it POSTs the payload, verifies the
//      returned master hash, and records the edge provenance chain.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const edgeSource = readFileSync(
  join(ROOT, "supabase", "functions", "design-panel-ai-generate", "index.ts"),
  "utf8",
);
const runtimeSource = readFileSync(join(ROOT, "runtime", "flat-first-atlas.cjs"), "utf8");
const assembly = edgeSource; // the real assembly lives IN the edge function now
const handler = edgeSource.slice(edgeSource.indexOf("async function handleAtlasArtboard"));
const MARK = "OUTPUT FORMAT \u2014 ONE FLAT A.T.L.A.S. ARTBOARD";

test("Call 1 executes DPAG's own commercial/restyle creative assembly", () => {
  // Owner directive 2026-08-27: no separate creative module, no string
  // replacement — the handler calls this file's own buildDesignIQPrompt with
  // atlasFlatMaster:true, so LOGO_REQUIREMENT, buildLogoArchitecture,
  // COMMERCIAL_DEPTH, COMMERCIAL_TRANSLATION, PROFESSIONAL_JUDGMENT and the
  // VisionBoard branches all fire inside the one call.
  assert.match(handler, /buildDesignIQPrompt\(\{/);
  assert.match(handler, /atlasFlatMaster: true/);
  assert.match(handler, /atlasPanels: panels/);
  assert.ok(!edgeSource.includes("atlas-artboard-prompt.ts"), "the reconstructed module is deleted");
  assert.ok(!handler.includes("buildDesignerPrompt"), "the Persona-2 string-replacement path is deleted from Call 1");
  assert.ok(!edgeSource.includes("atlasSwap"), "no string surgery on the creative prompt");
  // The flat contract is a branch inside the authority, not a post-hoc edit.
  assert.match(edgeSource, /function atlasFlatMasterContract\(/);
  assert.match(edgeSource, /const commercialPresentation = atlasFlatMaster/);
  assert.match(edgeSource, /const restylePresentation = atlasFlatMaster/);
});

test("the flat call keeps every creative block and drops only presentation", () => {
  const commercial = edgeSource.slice(edgeSource.indexOf("if (mode === 'commercial')"), edgeSource.indexOf("// ── RESTYLE MODE"));
  for (const block of ["COMMERCIAL_DEPTH", "COMMERCIAL_TRANSLATION", "PROFESSIONAL_JUDGMENT", "buildLogoArchitecture", "LOGO_REQUIREMENT", "styleDescriptors", "PHOTO_REALISM_LOCK"]) {
    assert.ok(commercial.includes(block), `${block} must stay in the commercial assembly`);
  }
  // Camera + studio are the only things the flat branch omits.
  assert.match(commercial, /atlasFlatMaster\n\s*\? atlasScene/);
});

test("exactly one Gemini image request lives in the atlas-artboard handler", () => {
  const calls = handler.match(/generativelanguage\.googleapis\.com/g) || [];
  assert.equal(calls.length, 1, "the handler must contain exactly one Gemini endpoint");
  assert.match(handler, /imageRequestCount: 1/);
  // No RETRY loop around the image call: one attempt per request, the caller's
  // QC decides whether to issue another edge request. (A byte-decode `for` is
  // not a retry — the assertion names the retry shape rather than any loop.)
  const afterCall = handler.slice(handler.indexOf("generativelanguage"), handler.indexOf("masterSha256"));
  assert.ok(!/for \([^)]*attempt/i.test(afterCall), "no attempt loop around the image call");
  assert.ok(!/while \(/.test(afterCall), "no retry while-loop around the image call");
  assert.equal((handler.match(/await fetch\(geminiUrl/g) || []).length, 1, "exactly one fetch of the Gemini endpoint");
  // And a hard deadline, so the platform's bodiless 504 can never be the
  // caller's only signal.
  assert.match(handler, /AbortSignal\.timeout\(/);
});

test("the response carries the full owner proof contract", () => {
  assert.match(handler, /functionName: "design-panel-ai-generate"/);
  assert.match(assembly, /ATLAS_ARTBOARD_SOURCE_COMMIT = "113d137dbe8813ca3bf70c8d7265ad081ebd4524"/);
  assert.match(assembly, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260901\.v21-guide-last-labeled-reference"/);
  for (const field of ["requestId", "promptVersion", "model", "masterSha256", "masterUrl"]) {
    assert.ok(handler.includes(field), `response field ${field}`);
  }
});

test("the runtime assembles no creative text and never calls Gemini for Call 1", () => {
  assert.ok(!runtimeSource.includes("designpanel-authoring"), "the transpiled vendor bridge is deleted from the product path");
  assert.ok(!runtimeSource.includes("buildDesignIQPrompt"), "no in-runtime creative builder");
  assert.ok(!runtimeSource.includes("buildAtlasArtboardDesignIQDirection"), "the reconstructed branch stays deleted");
  assert.ok(!runtimeSource.includes("photographic scene"), "the SIDE-TWIN scene framing stays deleted");
  const loop = runtimeSource.slice(
    runtimeSource.indexOf("for (let attempt = 1; attempt <= maxAuthoringAttempts"),
    runtimeSource.indexOf("const masterStoragePath"),
  );
  assert.match(loop, /callEdge\(/);
  // …whose default IS the real edge POST; injectable only so a unit test can
  // drive the authoring loop without a live function.
  assert.match(runtimeSource, /callEdge = callAtlasArtboardEdge/);
  assert.ok(!loop.includes("provider.generateImage"), "Call 1 makes no direct provider image call");
  assert.ok(!runtimeSource.includes("generativelanguage.googleapis.com"), "no raw Gemini endpoint in the runtime");
});

test("the runtime enforces the one-image-call contract and records provenance", () => {
  assert.match(runtimeSource, /imageRequestCount\) !== 1/);
  assert.match(runtimeSource, /flat_atlas_edge_master_hash_mismatch/);
  assert.match(runtimeSource, /atlasEdgeProvenance: edgeProvenance/);
  assert.match(runtimeSource, /x-designpro-owner-id/);
  assert.match(runtimeSource, /functions\/v1\/design-panel-ai-generate/);
});

test("the runtime records the prompt version the edge function actually stamps", () => {
  // Nothing compares these at run time — the runtime folds its copy into the
  // reuse hash and writes it onto every revision — so a drift is silent, and
  // it drifted: the runtime still said `atlas-artboard-persona.20260827.v1`
  // after Call 1 moved off the Persona-2 string-replacement path onto
  // buildDesignIQPrompt's atlasFlatMaster branch, which the function stamps
  // `atlas-artboard-designiq.20260827.v2`. Read both, compare them here.
  const edge = edgeSource.match(/ATLAS_ARTBOARD_PROMPT_VERSION = "([^"]+)"/);
  const runtimeVersion = runtimeSource.match(/ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "([^"]+)"/);
  assert.ok(edge, "the edge function must declare ATLAS_ARTBOARD_PROMPT_VERSION");
  assert.ok(runtimeVersion, "the runtime must pin the edge prompt version");
  assert.equal(runtimeVersion[1], edge[1]);
});

test("the labeled teaching proof reaches Call 1, and the neutral target guide is LAST", () => {
  assert.ok(!handler.includes("body.structuralReferenceStoragePath"));
  assert.ok(!handler.includes("body.structuralPairedProofStoragePath"));
  assert.ok(!handler.includes("body.structuralReferenceBase64"));
  assert.ok(!handler.includes("loadArtboardExamples(svc)"));
  const liveAuthoring = runtimeSource.slice(
    runtimeSource.indexOf("async function generateOrReuseFlatAtlas"),
    runtimeSource.indexOf("async function updateAtlasRevision"),
  );
  assert.ok(!liveAuthoring.includes("topologyExampleParts("));
  assert.ok(!liveAuthoring.includes("structuralReferenceStoragePath"));
  assert.ok(!liveAuthoring.includes("structuralPairedProofStoragePath"));
  assert.match(liveAuthoring, /loadBundledAtlasTeachingProof/);
  assert.match(liveAuthoring, /teachingProofStoragePath/);
  // The blank neutral target-guide image is no longer a Call-1 model input
  // (owner boundary contract 2026-09-01). The labelled installer map is still
  // persisted, but nothing stages an authoring mask for the edge request.
  assert.ok(liveAuthoring.includes("renderAtlasAuthoringGuide("), "the neutral authoring mask is rendered for Call 1 again");
  assert.ok(liveAuthoring.includes("guideStoragePath: targetGuideStoragePath"), "the target guide rides the edge request again");
  assert.match(liveAuthoring, /renderAtlasAuthoringGuide\(manifest\)/);

  // Exact multimodal order: PROMPT → TEACHING PROOF → REFERENCES. The
  // normalized coordinate table is OS data and no longer reaches the model
  // (owner ruling 2026-09-01); layout travels in the prompt's panel list.
  const promptPart = handler.indexOf("[{ text: prompt }]");
  const teaching = handler.indexOf("This example shows ONE cohesive vehicle-wrap design");
  const refs = handler.indexOf("for (const ref of references) pushImage(ref)");
  assert.ok(!handler.includes("atlasTopologyText(panels"), "no coordinate table reaches the model");
  assert.ok(promptPart > 0 && promptPart < teaching && teaching < refs,
    "parts must run prompt, then the teaching proof, then customer references");
  // THE NEUTRAL TARGET GUIDE IS BACK, AND IT IS LAST.
  //
  // 083d2a70 (edge v14) is the last run that reached print panels 6/6, and it
  // sent this mask as the FINAL image. `7ee1f868` deleted it for a normalized
  // [0,1] coordinate table and three releases since came back as vehicle
  // depictions. The guide conditions layout only: it is unlabelled and
  // unstroked, and `normalizeAtlasMaster` masks the sheet to those same zones.
  const teachingIdx = handler.indexOf("This example shows ONE cohesive vehicle-wrap design");
  const refsIdx = handler.indexOf("for (const ref of references) pushImage(ref)");
  const guideIdx = handler.indexOf("CURRENT TARGET GUIDE");
  const guideDownload = handler.indexOf("downloadPart(body.guideStoragePath");
  assert.ok(teachingIdx > 0 && teachingIdx < refsIdx && refsIdx < guideIdx && guideIdx < guideDownload,
    "order: teaching proof, customer references, then the target guide LAST");
  assert.ok(!handler.includes("atlasTopologyText(panels"), "no coordinate table reaches the model");
  assert.ok(!handler.includes("correctiveNote"), "no correctiveNote in the primary-generation contract");
  assert.doesNotMatch(handler, /cohesionExampleProofStoragePath|INSTALLED DRIVER PROOF/);
  // The wrapper is POSITIVE instruction now (owner, 2026-09-01): it names the
  // six surface identities the labels teach, and asks for an original design
  // instead of listing forbidden anatomy nouns.
  assert.match(handler, /six flat A\.T\.L\.A\.S\. surfaces: DRIVER SIDE, PASSENGER SIDE, HOOD, ROOF, FRONT and REAR/);
  assert.match(handler, /The printed labels identify the surface roles and sit in the separation space between artwork regions/);
  assert.match(handler, /Create an original design for the current customer; do not copy the example's branding or artwork/);
  
});

test("the teaching proof is release-pinned and Call 1 sends no explicit temperature", () => {
  assert.match(assembly, /ATLAS_TEACHING_PROOF_HASH = "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded"/);
  assert.match(assembly, /ATLAS_TEACHING_PROOF_BYTES = 3430273/);
  assert.match(assembly, /ATLAS_TEACHING_PROOF_CONTRACT = "designpro\.atlas-labeled-teaching-proof\.v3"/);
  // NO EXPLICIT TEMPERATURE. DID-2D918868 -- the last near-working master --
  // sent no temperature field, so Gemini used its own default. Parity recovery
  // does not introduce even a plausible config difference.
  assert.doesNotMatch(assembly, /ATLAS_ARTBOARD_TEMPERATURE = 1\.0/);
  assert.doesNotMatch(handler, /temperature:/);
  // The six-region topology is still MANDATORY as OS data on the request; it
  // is validated exactly as before, it just no longer reaches the model.
  assert.match(handler, /atlas_artboard_topology_required/);
  assert.match(edgeSource, /atlas_artboard_topology_invalid/);
  assert.match(edgeSource, /toFixed\(4\)/);
});

test("the flat contract teaches one named vehicle atlas without leaking dimensions", () => {
  // The neutral-mask experiment hid so much context that Gemini received six
  // anonymous canvases rather than one flattened vehicle. Restore semantic
  // identity while keeping all inch/pixel/cut geometry server authoritative.
  const flatFunction = edgeSource.slice(
    edgeSource.indexOf("function atlasFlatMasterContract("),
    edgeSource.indexOf("function atlasCreativeDirection("),
  );
  const contract = flatFunction.slice(flatFunction.indexOf(MARK));

  assert.doesNotMatch(contract, /normalized \[0,1\] coordinates|TARGET TOPOLOGY block/);
  assert.match(contract, /ONE CONNECTED WRAP UNWRAPPED FLAT/);
  assert.match(contract, /ARTBOARD for this exact \$\{vehicle/);
  assert.match(contract, /\(\$\{bodyClass\}\)/);
  assert.match(flatFunction, /REAR, then ROOF, then HOOD, then FRONT — the centre column, top to bottom/);
  assert.match(contract, /\$\{panelLines\}/);
  assert.match(contract, /\$\{panelLines\}/);
  assert.match(contract, /Fill every panel corner to corner/);
  assert.match(contract, /opaque, unbroken and full-bleed to all four edges/);
  assert.match(contract, /Set no panel names, surface IDs, legends or captions anywhere in the artwork/);
  assert.match(contract, /the space between panels is sheet separation/);
  assert.match(contract, /a person walking around the finished truck sees one design, not two/);
  assert.match(contract, /flat printed graphic art, the same kind of image as a printed poster/);

  // ⚠️ INVERTED 2026-08-31. This used to REQUIRE the lock to name "vehicle
  // render", "vehicle photograph", "vehicle outline", "physical vehicle
  // anatomy", "wheels", "windows", "doors", "component seams", "transparent
  // voids" and "shaped openings" -- ten anatomy nouns handed to an image model
  // as a refusal list. CLAUDE.md's own Gemini guidance says a negative makes
  // the model over-index on the forbidden thing, and this file has been around
  // that loop twice already.
  //
  // Live proof it was not working: Desert Ridge (c3a8ff40, 2026-08-31) returned
  // both flanks as a van side elevation with window and wheel-arch shapes, on a
  // prompt carrying every one of those ten refusals verbatim. The lock asked
  // for the words and got the pixels.
  //
  // The contract now says what the output IS, in terms with no vehicle in them
  // -- a printed poster, a roll of vinyl laid flat, the artwork before anything
  // is cut. This test therefore forbids the noun list it used to demand.
  for (const anatomyNoun of [
    "vehicle render", "vehicle photograph", "vehicle outline", "silhouette",
    "physical vehicle anatomy", "wheels", "windows", "doors", "component seams",
    "cut lines", "transparent voids", "shaped openings", "mockup lighting",
  ]) {
    assert.ok(!contract.includes(anatomyNoun),
      `the pixel lock must not name "${anatomyNoun}" to the image model -- a refusal list of anatomy is what taught it to draw the anatomy`);
  }
  assert.match(contract, /flat printed graphic art, the same kind of image as a printed poster/);
  assert.match(contract, /a printed poster or a roll of printed vinyl laid flat/);
  assert.match(contract, /the artwork by itself, before anything is cut or applied/);
  assert.match(contract, /produced downstream by the seven proof projections and are absent here/);
  assert.match(contract, /Output ONE flat 2D artboard sheet, drawn straight-on and flat for printing/);

  for (const leaked of ["pixel size", "DASHED", "title band", "footer", "widthInches", "heightInches"]) {
    assert.ok(!contract.toLowerCase().includes(leaked.toLowerCase()),
      `the contract must not speak "${leaked}" to the image model`);
  }
  // ⚠️ INVERTED 2026-08-31 (owner directive). This REQUIRED the contract to
  // address the model with six assigned containers -- "Passenger Side (internal
  // ID PS)", "Driver Side (internal ID DS)", and four more -- six "maps to" and
  // seven "internal ID" in one block. That is the container-constraint model,
  // and it turns one wrap into six separate creative problems. Live cost: on
  // e509d258 the driver flank came back as a full red-rock photographic wrap and
  // the passenger flank as a dark navy body with an orange accent -- two
  // unrelated designs on one truck.
  //
  // Owner: "Remove the AI-facing CONTAINER constraint model. Do NOT remove the
  // underlying A.T.L.A.S. topology or six deterministic surface coordinates.
  // The six regions belong to the OS, not to the creative reasoning task."
  //
  // Surface identity, coordinates, rotations and the deterministic cut are
  // unchanged on manifest.zones -- asserted below and in the panel-cut locks.
  // What the MODEL now gets is the proven RestylePro artboard framing: plain
  // placement bullets plus "the SAME cohesive design flowing across every panel
  // as ONE CONNECTED WRAP UNWRAPPED FLAT". So the internal IDs are forbidden in
  // the model-facing contract rather than required.
  for (const containerAddress of ["internal ID", "maps to", "mapped surface", "server-mapped"]) {
    assert.ok(!contract.includes(containerAddress),
      `the model-facing contract must not address regions as containers ("${containerAddress}")`);
  }
  assert.match(contract, /ONE CONNECTED WRAP UNWRAPPED FLAT/);
  assert.match(contract, /the two sides of the SAME vehicle carrying the SAME design/);
  for (const label of ["PASSENGER SIDE", "DRIVER SIDE", "REAR", "ROOF", "HOOD", "FRONT"]) {
    assert.ok(flatFunction.includes(label), `the model still needs the placement of ${label}`);
  }
  assert.doesNotMatch(contract, /FIELD [A-F]/, "anonymous field aliases must stay retired");

  // Physical identity is model context; physical dimensions remain runtime data.
  assert.match(runtimeSource, /const CENTER_ORDER = Object\.freeze\(\["rear", "roof", "hood", "front"\]\)/);
});

// ────────────────────────────────────────────────────────────────────────────
// TRUE TOPOLOGY INSIDE THE SIX-CONTAINER CONTRACT. (Trish 2026-08-28)
//
// The bundled Houdini PANEL LAYOUT names eleven-plus panels — rear bumper,
// hatch, rocker, fender, quarter, front bumper. A.T.L.A.S. cuts six. The
// owner's decision on that gap was explicit about the boundary:
//
//   "True topology inside the existing six-container contract. Do NOT change
//    the six production cuts... Within DRIVER and PASSENGER only, add the
//    appropriate vehicle topology/subregions needed for DesignPanelAI to
//    understand the real vehicle structure... not new canonical surfaces, not
//    new seams, not new panel records, not new ZIP entries, and not new
//    production outputs... Do not draw fake vehicle silhouettes over the
//    artwork and do not let topology guidance become printable content."
//
// So these assert BOTH halves: the guidance reaches the model, and it reaches
// nothing that cuts, counts, packages or prints.

test("the six canonical surfaces are unchanged", () => {
  assert.match(runtimeSource, /const SURFACE_KEYS = Object\.freeze\(\["driver", "passenger", "hood", "roof", "front", "rear"\]\)/);
  // Only the two flanks carry topology. A centre surface with invented regions
  // would be the eleven-panel architecture by another name.
  assert.match(runtimeSource, /surfaceKey === "driver" \|\| surfaceKey === "passenger" \? flank : null/);
});

test("component enumeration stays server-side while body class reaches Call 1", () => {
  // Detailed fender/door/quarter inventories stay out of Gemini. Only GENIE's
  // canonical class and the pickup exterior/interior coverage distinction are
  // model context.
  assert.match(runtimeSource, /const FLANK_TOPOLOGY_BY_BODY = Object\.freeze\(/);
  for (const body of ["pickup", "van", "suv", "car", "box"]) {
    assert.ok(runtimeSource.includes(`${body}: Object.freeze(`), `${body} needs its own structure`);
  }
  const contract = edgeSource.slice(
    edgeSource.indexOf("function atlasFlatMasterContract("),
    edgeSource.indexOf("function atlasCreativeDirection("),
  );
  for (const region of ["FRONT FENDER", "CAB DOOR", "REAR QUARTER", "BED SIDE", "ROCKER"]) {
    assert.ok(!contract.includes(region), `the contract must not name ${region} to the image model`);
  }
  assert.ok(!contract.includes("structure front to rear:"),
    "the region enumeration must not be rendered into the prompt");
  // ⚠️ INVERTED 2026-08-31, SAME DEFECT, SECOND HALF. This used to REQUIRE a
  // PICKUP COVERAGE paragraph in the Call-1 contract. That paragraph named
  // "exterior cab", "exterior bed sides", "tailgate exterior", "open bed
  // floor", "inner bed walls" and "bare factory bedliner" -- six pieces of
  // physical vehicle anatomy -- and attached them BY NAME to Driver Side and
  // Passenger Side. Those are precisely the two surfaces that come back as a
  // vehicle side elevation while the centre four stay clean: the flank
  // regression CLAUDE.md measured across eleven runs from v4 onward, and what
  // Desert Ridge (c3a8ff40) produced on a pickup.
  //
  // It also argued with itself -- describing a bed exclusion and then telling
  // the model not to draw one -- and it was never Call 1's job in the first
  // place. RULE 0.28 §5 and RULE 0.0 both place that exclusion downstream, and
  // it IS carried downstream, in the A.T.L.A.S. proof producer, sliced from the
  // pinned WRAP_COVERAGE_RULES (tests/atlas-proof-truck-bed.test.mjs).
  //
  // So the anatomy is now forbidden here rather than required.
  for (const bedAnatomy of [
    "PICKUP COVERAGE", "exterior cab", "bed sides", "tailgate exterior",
    "open bed floor", "inner bed walls", "bedliner", "bed-shaped",
  ]) {
    assert.ok(!contract.includes(bedAnatomy),
      `the contract must not name ${bedAnatomy} to the image model; the bed exclusion is downstream proof mapping, not Call 1`);
  }
  assert.ok(!contract.includes("pickupCoverage"),
    "the pickup coverage branch must be gone from the contract, not merely unreachable");
});

test("identity and placement cross the wire while dimensions and component topology stay server-side", () => {
  const body = runtimeSource.slice(
    runtimeSource.indexOf("function atlasEdgeRequestBody("),
    runtimeSource.indexOf("async function callAtlasArtboardEdge("),
  );
  for (const field of ["widthInches:", "heightInches:", "topology:"]) {
    assert.ok(!body.includes(field),
      `${field} must not be sent to Call 1; GENIE keeps it and the cut uses it`);
  }
  assert.match(body, /label: SURFACE_LABELS\[zone\.surfaceKey\]/);
  assert.match(body, /surfaceId: SURFACE_IDS\[zone\.surfaceKey\]/);
  assert.match(body, /placement: zone\.placement/);
  assert.match(body, /vehicleType: String\(vehicle\.type \|\| vehicle\.vehicleClass/);
});

test("body style is decided in code, never by a second AI call", () => {
  assert.match(runtimeSource, /function flankBodyStyle\(vehicleType\)/);
  const chooser = runtimeSource.slice(
    runtimeSource.indexOf("function flankBodyStyle(vehicleType)"),
    runtimeSource.indexOf("function flankTopology(vehicleType)"),
  );
  for (const call of ["generateContent", "callEdge", "await "]) {
    assert.equal(chooser.includes(call), false, `body style must not ${call}`);
  }
});

test("topology never becomes geometry drawn inside a container", () => {
  // The regions exist as manifest metadata and as gutter caption text. Nothing
  // adds a rect, line or path inside a zone — RULE 0.28 §4, and the owner's
  // "do not draw fake vehicle silhouettes over the artwork".
  const topology = runtimeSource.slice(
    runtimeSource.indexOf("const FLANK_TOPOLOGY_CONTRACT"),
    runtimeSource.indexOf("function captionGutter(zone, zones)"),
  );
  assert.ok(topology.length > 0);
  for (const drawing of ["<rect", "<line", "<path", "<polygon"]) {
    assert.equal(topology.includes(drawing), false, `topology must not emit ${drawing}`);
  }
  // It is carried on the caption, which lives in the gutter the master masks away.
  assert.match(runtimeSource, /const structure = flankTopologyCaption\(zone\.flankTopology\)/);
});

test("nothing downstream learns a seventh surface", () => {
  // The cut, the counts and the packaging all still speak of six, and the
  // topology is absent from every one of them.
  for (const consumer of [
    "runtime/designpro-standalone-claimant.cjs",
    "app/src/lib/panelpro-studio-source.ts",
    "app/src/lib/designpro-production-layers.ts",
  ]) {
    const source = readFileSync(new URL(`../${consumer}`, import.meta.url), "utf8");
    assert.equal(source.includes("flankTopology"), false, `${consumer} must not read flank topology`);
    assert.equal(source.includes("FLANK_TOPOLOGY"), false, `${consumer} must not read flank topology`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// THREE FLAT-SURFACE TESTS DELETED WITH THE PASS THEY COVERED (2026-08-29):
//
//   "a failed surface generation carries Gemini's own reason"
//   "an injected generator may still return raw bytes"
//   "verifiedReference still carries bytes for the judge"
//
// All three were real fixes to `authorFlatSurfaceFields` -- the Gemini pass
// that flattened each 3D PROOF PHOTOGRAPH into a Call-8 "surface field". The
// reason-propagation fix is what finally made the HTTP 400 below visible, and
// the 400 is why `proof.build` had no proof to show for any run. Good work on
// a stage that should not have existed: those fields were the source of the
// customer's print files, so the pipeline was flattening photographs into
// production artwork the whole time it was being repaired.
//
// Call 8 is deterministic assembly of the six Call-1 panels now (no image
// request at all), so there is no generation to carry a reason for, no injected
// generator, and no reference for a judge to re-encode. The module is reduced
// to the shared surface/view vocabulary.
//
// ────────────────────────────────────────────────────────────────────────────
// AN inlineData PART CARRIES EXACTLY TWO FIELDS. (2026-08-29)
//
// This half SURVIVES, because the modules it sweeps still make image calls.
// `verifiedReference` used to return { mimeType, data, bytes } and spreading
// that whole object into an inlineData part sent the third field to Gemini,
// which rejects it outright:
//
//   HTTP 400 Invalid JSON payload received. Unknown name "bytes"
//   at 'contents[0].parts[2].inline_data': Cannot find field.
//
// The sweep is over every remaining file that builds a part, not just the one
// that had the bug: this is invisible until it 400s, and an object carrying an
// extra field is the normal case.

test("no inlineData part is handed a reference object wholesale", () => {
  for (const [name, source] of [
    ["gemini-flat-wrap.cjs", readFileSync(new URL("../runtime/gemini-flat-wrap.cjs", import.meta.url), "utf8")],
    ["designpanel-server-provider.cjs", readFileSync(new URL("../runtime/designpanel-server-provider.cjs", import.meta.url), "utf8")],
  ]) {
    for (const [, part] of source.matchAll(/\{\s*inlineData:\s*([^}]+?)\s*\}/g)) {
      const value = part.trim();
      const literal = value.startsWith("{");
      // A bare identifier is only safe when the thing it names is built with
      // exactly mimeType and data. Those are asserted by name below.
      const vetted = ["reference", "reference.inline", "atlasAuthority.inlineData"].includes(value);
      assert.ok(literal || vetted, `${name}: inlineData: ${value} is unvetted`);
    }
  }
  // And the builders the vetted identifiers come from emit only those two.
  const wrap = readFileSync(new URL("../runtime/gemini-flat-wrap.cjs", import.meta.url), "utf8");
  assert.match(wrap, /return \{ mimeType: "image\/jpeg", data: bytes\.toString\("base64"\) \};/);
  const provider = readFileSync(new URL("../runtime/designpanel-server-provider.cjs", import.meta.url), "utf8");
  assert.match(provider, /reference: \{ mimeType: "image\/png", data: bounded\.toString\("base64"\) \}/);
});

test("the flat-surface module authors nothing and carries no prompt", () => {
  const flatSurface = readFileSync(new URL("../runtime/gemini-flat-surface.cjs", import.meta.url), "utf8");
  for (const gone of [/inlineData/, /generateContent/, /generativelanguage/, /function authorFlatSurfaceFields/,
                      /function generateOneSurface/, /function judgeSurface/, /function flatPrompt/]) {
    assert.doesNotMatch(flatSurface, gone, "the Call-8 flattener must stay deleted");
  }
  // What it keeps is the vocabulary every stage still speaks.
  assert.match(flatSurface, /const SURFACE_KEYS = Object\.freeze\(\["driver", "passenger", "hood", "roof", "front", "rear"\]\)/);
  assert.match(flatSurface, /const VIEW_KEYS = Object\.freeze\(\[\.\.\.SURFACE_KEYS, "closeup"\]\)/);
  assert.match(flatSurface, /function normalizeTextLock/);
  assert.match(flatSurface, /function selectedImageModel/);
});
