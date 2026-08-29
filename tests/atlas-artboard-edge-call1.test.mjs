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
  assert.match(assembly, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260828\.v7"/);
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

test("both halves of the Houdini paired lesson reach Call 1", () => {
  // RULE 0.15: "THE PAIRED EXAMPLE ... IS RESTORED. DO NOT REMOVE IT AGAIN."
  // topologyExampleParts emits the lesson as TWO images — the flattened
  // top-view PANEL LAYOUT sheet and its corresponding finished 3D proof — and
  // the move onto the edge function staged only `.find(...)`, the first inline
  // image, so the finished proof silently stopped being attached. Nothing
  // failed; the lesson just went half-taught.
  assert.match(runtimeSource, /const structuralImages = topologyParts\.filter\(/);
  assert.ok(
    !/const structuralImage = topologyParts\.find\(/.test(runtimeSource),
    "taking the first inline image drops the finished-proof half of the pair",
  );
  assert.match(runtimeSource, /structuralPairedProofStoragePath: await stageEdgeInput\(pairedProofBytes/);
  // …and the function downloads and attaches both.
  assert.match(handler, /downloadPart\(body\.structuralReferenceStoragePath/);
  assert.match(handler, /downloadPart\(body\.structuralPairedProofStoragePath/);

  // The framing text lives in the edge function (prompt text belongs there),
  // but the runtime still carries the canonical wording, so lock them equal
  // rather than leaving two copies free to drift.
  for (const line of [
    "PAIRED TOPOLOGY EXAMPLE — FLATTENED TOP-VIEW OUTPUT FORMAT.",
    "PAIRED TOPOLOGY EXAMPLE — CORRESPONDING FINISHED 3D PROOF.",
    "CALL 1 TARGET: create the customer's NEW flattened top-view design",
  ]) {
    assert.ok(runtimeSource.includes(line), `the runtime lesson must still say: ${line}`);
    assert.ok(handler.includes(line), `the Call-1 request must carry: ${line}`);
  }
});

test("the flat contract states labeled containers, GENIE dims + 5in bleed, filled to the edges, no body lines", () => {
  // Owner directive 2026-08-27, verbatim: "ATLAS FLATTENED TOPO VIEW CONTAINER
  // MUST HAVE LABELED CONTAINERS AND GENIE DIMS WITH 5" BLEED — ATLAS FILLS
  // FLATTENED TOP DESIGN WITHOUT BODYLINES FILLED TO RECTANGLE CONTAINER EDGES."
  //
  // This narrows RULE 0.15 on ONE point, by the owner's own decision: the
  // master no longer carries the vehicle's panel geometry. It never carried
  // holes — that was already forbidden — and now it carries no seams, contours
  // or arches either. A line drawn on the master prints as a line on the wrap.
  const contract = edgeSource.slice(
    edgeSource.indexOf("function atlasFlatMasterContract("),
    edgeSource.indexOf("function buildDesignIQPrompt("),
  );
  assert.match(contract, /labeled rectangles are fixed containers at true GENIE panel dimensions with a 5" bleed/);
  assert.match(contract, /FILL EVERY CONTAINER EDGE TO EDGE/);
  assert.match(contract, /running off all four sides of its rectangle/);
  assert.match(contract, /No blank margin, no white gap, no letterboxing/);
  assert.match(contract, /NO BODY LINES/);
  for (const forbidden of ["door seams", "panel gaps", "rocker", "wheel arches", "windows", "bumpers", "vehicle silhouette"]) {
    assert.ok(contract.includes(forbidden), `the contract must name ${forbidden} as forbidden geometry`);
  }
  // THE UNWRAPPED REGIONS ARE MASKED BY CODE, NOT DRAWN BY THE MODEL.
  // Owner 2026-08-27: "masked truck bed must not have any wrap design." A
  // pickup's bed opening carries no vinyl — but asking the model to leave a
  // hole for it reintroduces exactly the cut-out class RULE 0.15 convicts, with
  // soft edges and invented placement. It fills the whole rectangle; geometry
  // owns the mask, deterministically, afterwards.
  assert.match(contract, /Paint the FULL rectangle even where the finished vehicle is not wrapped/);
  assert.match(contract, /pickup bed opening/);
  assert.match(contract, /masked out of the panel by code after you finish/);
  assert.match(contract, /Do not leave a gap, a hole, a dark shape or a soft edge for one/);

  // The mirror twin and the one-cohesive-wrap rules survive the rewrite.
  assert.match(contract, /PASSENGER SIDE is DRIVER SIDE's mirror twin/);
  assert.match(contract, /ONE cohesive wrap/);
  // …and the reference-class firewall is still on the reference.
  assert.match(contract, /teaches LAYOUT ONLY/);
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

test("the flank's structure is named to the authoring model", () => {
  assert.match(runtimeSource, /const FLANK_TOPOLOGY_BY_BODY = Object\.freeze\(/);
  for (const body of ["pickup", "van", "suv", "car", "box"]) {
    assert.ok(runtimeSource.includes(`${body}: Object.freeze(`), `${body} needs its own structure`);
  }
  // And the edge function renders it into the panel line it already builds.
  assert.match(edgeSource, /structure front to rear:/);
  assert.match(edgeSource, /running the full length along the bottom edge/);
});

test("the guidance says, in its own words, that it is not a seam", () => {
  // The file writes its dashes as \u2014 escapes, so match the source bytes.
  assert.match(edgeSource, /paint straight THROUGH every one .{0,8} they are where the vehicle's shapes fall, not seams to draw/);
  // The NO BODY LINES contract is untouched — this sits beside it, not instead.
  assert.match(edgeSource, /NO BODY LINES\. Do not draw door seams/);
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
// A FAILURE HAS TO SAY WHY. (2026-08-29)
//
// generateOneSurface caught Gemini's actual message into `lastError` and then
// returned a bare null, so every failure reached the stage receipt as the same
// sentence: "generation attempt N returned no image". Live cost on run
// 8e9fab59's proof.build — five stage attempts, three generation attempts each,
// and the only thing recorded was that there was no image.
//
// The reasons it hid all have different remedies: a NO_IMAGE finishReason wants
// a shorter prompt, an HTTP 400 wants a different aspect or imageSize, a
// blockReason wants the brief looked at, and a decode failure wants none of
// those. A receipt that cannot distinguish them cannot be acted on.
const flatSurface = readFileSync(
  new URL("../runtime/gemini-flat-surface.cjs", import.meta.url), "utf8",
);

test("a failed surface generation carries Gemini's own reason", () => {
  assert.match(flatSurface, /return \{ bytes: null, reason: lastError \}/);
  assert.match(flatSurface, /returned no image\$\{why \? `: \$\{why\}` : ""\}/);
  // The extractor already names the finishReason; this is what stops it being
  // swallowed on the way out.
  assert.match(flatSurface, /finishReason \|\| payload\?\.promptFeedback\?\.blockReason/);
});

test("an injected generator may still return raw bytes", () => {
  // The test seam predates the shape change, so both are accepted rather than
  // rewriting every double.
  assert.match(flatSurface, /Buffer\.isBuffer\(produced\) \? produced : produced\?\.bytes \|\| null/);
});

// ────────────────────────────────────────────────────────────────────────────
// AN inlineData PART CARRIES EXACTLY TWO FIELDS. (2026-08-29)
//
// verifiedReference returns { mimeType, data, bytes } — `bytes` so the QC judge
// can re-encode the same reference without decoding base64 again. Spreading
// that whole object into an inlineData part sent the third field to Gemini,
// which rejects it outright:
//
//   HTTP 400 Invalid JSON payload received. Unknown name "bytes"
//   at 'contents[0].parts[2].inline_data': Cannot find field.
//
// So the call could never succeed, on any surface, on any attempt — which is
// why proof.build had no 2D Production Proof to show for any run. It took the
// reason-propagation fix above to see it at all; before that every one of the
// fifteen attempts reported "returned no image".
//
// The whole file is swept, not just the one call site: this is invisible until
// it 400s, and the object that carries an extra field is the normal case.

test("no inlineData part is handed a reference object wholesale", () => {
  for (const [name, source] of [
    ["gemini-flat-surface.cjs", flatSurface],
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
  // The flat-surface part now names its two fields rather than spreading.
  assert.match(flatSurface, /inlineData: \{ mimeType: ownReference\.mimeType, data: ownReference\.data \}/);
  // And the builders the vetted identifiers come from emit only those two.
  const wrap = readFileSync(new URL("../runtime/gemini-flat-wrap.cjs", import.meta.url), "utf8");
  assert.match(wrap, /return \{ mimeType: "image\/jpeg", data: bytes\.toString\("base64"\) \};/);
  const provider = readFileSync(new URL("../runtime/designpanel-server-provider.cjs", import.meta.url), "utf8");
  assert.match(provider, /reference: \{ mimeType: "image\/png", data: bounded\.toString\("base64"\) \}/);
});

test("verifiedReference still carries bytes for the judge", () => {
  // The extra field is not the bug — sending it was. The judge re-encodes from
  // ownReference.bytes, so removing it would break QC instead.
  assert.match(flatSurface, /return \{ mimeType: item\.contentType, data: item\.bytes\.toString\("base64"\), bytes: item\.bytes \};/);
  assert.match(flatSurface, /sharp\(ownReference\.bytes/);
});
