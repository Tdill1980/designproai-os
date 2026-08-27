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
  assert.match(assembly, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-designiq\.20260827\.v2"/);
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
