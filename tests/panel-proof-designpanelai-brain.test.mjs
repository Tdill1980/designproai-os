/**
 * PANEL-PROOF RUNS THE REAL DESIGNPANELAI BRAIN.
 * ══════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-21: "Only our Gemini image pro 3 model decides
 * what goes where — it comes from user prompt and then Gemini uses our suite of
 * custom edge functions design panel ai generate persona base graphic designer
 * so it uses google knowledge and elevates every design … I need it wired using
 * my edge functions using a flat panel first 3zone."
 *
 * WHAT THIS LOCKS, AND WHY EACH ASSERTION EXISTS:
 *
 *   `production-panel-proof` is a SECOND Call-1 brain. Its own header says so
 *   ("WHY A SEPARATE FUNCTION AND NOT A BRANCH IN design-panel-ai-generate …
 *   THIS IS A PROBE SURFACE, NOT A PRODUCT PATH"), and it imports the assembly
 *   from `_shared/designiq-assembly.ts` — a copy measurably thinner than this
 *   file's own on every input the designer reads:
 *
 *     visionboard_intent   6 / 15      brandColors        4 / 9
 *     visionBoardImages    4 / 12      styleDescriptors   6 / 11
 *
 *   So the customer's uploaded style reference was handled by a third as much
 *   code, and the sheet came back generic. The mode locked here executes the
 *   deployed brain instead. If a later refactor points it back at a copy, or
 *   lets a session brief individual surfaces, these assertions fail.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const edgeSource = readFileSync(
  join(root, "supabase/functions/design-panel-ai-generate/index.ts"),
  "utf8",
);

// Bounded at the handler, for the reason atlas-artboard-edge-call1 records:
// an unbounded slice convicts a neighbouring handler for a rule that is only
// about this one. handlePanelProof is last in the file today; the bound still
// names an end so that stops being load-bearing the moment something follows.
const handler = (() => {
  const from = edgeSource.indexOf("async function handlePanelProof");
  assert.ok(from > -1, "handlePanelProof must exist in the Call-1 edge function");
  const next = edgeSource.indexOf("\nasync function ", from + 1);
  return next === -1 ? edgeSource.slice(from) : edgeSource.slice(from, next);
})();

test("the mode is dispatched from the sole Call-1 endpoint, internal callers only", () => {
  assert.match(edgeSource, /if \(body\?\.mode === "panel-proof"\)/);
  assert.match(edgeSource, /panel_proof_internal_only/);
  assert.match(edgeSource, /return await handlePanelProof\(body, internalCaller\.userId!\)/);
});

test("the creative half is THIS FILE's buildDesignIQPrompt, not a copy", () => {
  // The real brain, invoked with the flat-master contract, then cut at its own
  // output tail by the shared module's throw-on-drift helper.
  assert.match(handler, /panelProofCreativeHead\(buildDesignIQPrompt\(\{/);
  assert.match(handler, /atlasFlatMaster: true/);
  // The head is never assembled from the runtime twin or the shared assembly.
  assert.ok(
    !/designiq-assembly/.test(handler),
    "the handler must not reach for the shared assembly copy",
  );
  // Every input the designer reads has to actually be forwarded. A head that
  // compiles without these is the generic-sheet defect returning silently.
  for (const field of [
    "visionBoardImages", "visionboard_intent", "styleDescriptors",
    "brandColors", "industryType", "companyName", "phone", "website",
    "finish", "mascot", "bulletPoints", "fontStyle",
  ]) {
    assert.ok(handler.includes(field), `the brief field ${field} must reach the designer`);
  }
});

test("exactly one Gemini image request, with a deadline", () => {
  assert.equal(
    (handler.match(/generativelanguage\.googleapis\.com/g) || []).length, 1,
    "the handler must contain exactly one Gemini endpoint",
  );
  assert.equal(
    (handler.match(/await fetch\(geminiUrl/g) || []).length, 1,
    "exactly one fetch of the Gemini endpoint",
  );
  assert.match(handler, /imageRequestCount = 1/);
  assert.match(handler, /AbortSignal\.timeout\(/);
  const afterCall = handler.slice(handler.indexOf("generativelanguage"), handler.indexOf("sheetSha256"));
  assert.ok(!/for \([^)]*attempt/i.test(afterCall), "no attempt loop around the image call");
  assert.ok(!/while \(/.test(afterCall), "no retry while-loop around the image call");
});

test("GEMINI decides placement — no surface is briefed for its content", () => {
  // Template injection is the move A.C.E.'s architecture rule forbids by name,
  // and it is how the GENIE pre-pass deleted a customer's explicit request.
  // A per-surface content instruction in this handler is that defect.
  const forbidden = [
    /hood\s+(?:carries|takes|gets|is just)/i,
    /roof\s+(?:carries|takes|gets|is just|is pure)/i,
    /front\s+(?:carries|takes|gets|is just)/i,
    /rear\s+(?:carries|takes|gets|is just)/i,
    /SURFACE_TREATMENT/,
  ];
  for (const pattern of forbidden) {
    assert.ok(
      !pattern.test(handler),
      `the handler must not brief a surface for what it carries: ${pattern}`,
    );
  }
});

test("surfaces reach the model as NAMED REAL INCHES, never normalized coordinates", () => {
  // Four consecutive live field runs painted bare four-decimal rows into the
  // artwork; 8c525565 put `0.9114 0.3` through Topaz onto a customer's 150-PPI
  // driver panel. Inches per named surface are a designer's working unit.
  assert.match(handler, /wide x \$\{fmtIn\(p\.heightInches!\)\}" high/);
  assert.ok(!/normalized/i.test(handler), "no normalized [0,1] topology in this request");
  assert.ok(!/toFixed\(4\)/.test(handler), "no four-decimal coordinate rows");
  // A missing dimension is refused, never printed. `Number(null)` is 0, and a
  // UI prints 0" as fact — the defect `measuredNumber` exists to end.
  assert.match(handler, /panel_proof_panel_inches_required/);
});

test("the pinned example is a real designed sheet, verified by hash", () => {
  assert.match(handler, /PANEL_PROOF_FORMAT_EXAMPLE\.sha256/);
  assert.match(handler, /PANEL_PROOF_FORMAT_EXAMPLE\.byteSize/);
  assert.match(handler, /panel_proof_input_hash_mismatch/);
  // STRUCTURAL class (RULE 0.24): it teaches the document, never the artwork.
  assert.match(handler, /Copy none of its artwork, palette, photography, wording, logo, brand or industry/);
});

test("the receipt proves the real brain ran", () => {
  // A collapsed head is the defect returning. Reporting its length puts that on
  // the receipt instead of leaving it visible only in the pixels.
  assert.match(handler, /creativeHeadChars: creativeHead\.length/);
  assert.match(handler, /promptVersion: ATLAS_PANEL_PROOF_CONTRACT/);
  for (const field of ["sheetSha256", "sheetStoragePath", "panelRows", "coverageSqFt"]) {
    assert.ok(handler.includes(field), `response field ${field}`);
  }
});
