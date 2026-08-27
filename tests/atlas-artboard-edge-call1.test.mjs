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
import { loadPersonaDesigner } from "./helpers/load-persona-designer.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const edgeSource = readFileSync(
  join(ROOT, "supabase", "functions", "design-panel-ai-generate", "index.ts"),
  "utf8",
);
const runtimeSource = readFileSync(join(ROOT, "runtime", "flat-first-atlas.cjs"), "utf8");
const assembly = readFileSync(join(ROOT, "supabase", "functions", "_shared", "atlas-artboard-prompt.ts"), "utf8");
const handler = edgeSource.slice(edgeSource.indexOf("async function handleAtlasArtboard"));

test("the edge function executes the real Persona-2 designer brain", () => {
  assert.match(assembly, /import \{ buildDesignerPrompt \} from "\.\/persona-designer-prompt\.ts"/);
  assert.match(assembly, /buildDesignerPrompt\(\{/);
  assert.match(edgeSource, /buildAtlasArtboardPrompt,\n\} from "\.\.\/_shared\/atlas-artboard-prompt\.ts"/);
  // Executed, never re-typed: neither file may contain the persona's own
  // identity sentence as a literal.
  assert.ok(!assembly.includes("elite vehicle wrap graphic designer"));
  assert.ok(!handler.includes("elite vehicle wrap graphic designer"));
});

test("presentation swaps are exact-match and throw on persona drift", () => {
  assert.match(assembly, /function atlasSwap\(/);
  assert.match(assembly, /atlas_artboard_persona_drift/);
  // The studio scene and the side camera leave the flat call; the flat-master
  // output contract replaces the on-vehicle photograph lines.
  assert.match(assembly, /atlasSwap\(prompt, `\\n\\n\$\{STUDIO_ENVIRONMENT\}`, ""\)/);
  assert.match(assembly, /atlasSwap\(prompt, `\\n\$\{getCameraAngle\("side"\)\}`, ""\)/);
  assert.match(assembly, /ONE SOLID RECTANGLE of continuous wrap artwork/);
  assert.match(assembly, /mirror twin/);
  assert.match(assembly, /LAYOUT ONLY/);
  // The DESIGN ANCHOR request is a 3D-proof/camera instruction and is removed
  // for the flat call — it is also what made the model answer in text and draw
  // nothing (measured twice on the deployed function, 2026-08-27).
  assert.match(assembly, /This anchor ensures consistency across all camera angles\.",\n\s*"",/);
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
  assert.match(assembly, /ATLAS_ARTBOARD_PROMPT_VERSION = "atlas-artboard-persona\.20260827\.v1"/);
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
  assert.match(loop, /callAtlasArtboardEdge\(/);
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

test("the real persona builder still carries the creative core the swaps preserve", async () => {
  const { buildDesignerPrompt } = await loadPersonaDesigner();
  const prompt = buildDesignerPrompt({
    enrichedBrief: "Bold commercial HVAC wrap with airflow ribbons.",
    mode: "commercial",
    vehicleYear: "2022",
    vehicleMake: "Ford",
    vehicleModel: "F250 Crew Cab",
    companyName: "Precision Climate Solutions",
    phone: "(520) 555-0192",
    industryType: "HVAC",
    hasVisionBoardImages: false,
  });
  assert.match(prompt, /elite vehicle wrap graphic designer/);
  assert.match(prompt, /Precision Climate Solutions/);
  assert.match(prompt, /\(520\) 555-0192/);
  assert.match(prompt, /thematically relevant/);
  // The swap targets the handler depends on must exist verbatim in the real
  // builder's output — this is the drift alarm's other half.
  assert.ok(prompt.includes("Render it ON the vehicle in a studio — photorealistic, not a flat panel."));
  assert.ok(prompt.includes("16:9 landscape, 4K. REAL PRINTED VINYL on the vehicle. Canon EOS R5 at 35mm f/8. INDISTINGUISHABLE from a real photograph."));
  assert.ok(prompt.includes("Wrap covers painted body panels only. Windows, lights, wheels, trim stay factory."));
});
