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
  assert.match(assembly, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260827\.v5"/);
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
