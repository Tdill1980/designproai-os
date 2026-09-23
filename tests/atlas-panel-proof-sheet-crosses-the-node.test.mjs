/**
 * EVERY FACT THE SHEET CARRIES MUST SURVIVE THE NODE BOUNDARY.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-23: "I need these design edge functions, it's my design
 * engine." Two of the five design-engine fixes read as NOT LANDED on her own
 * live run — and the edge, the transport and the assembler were all correct.
 *
 * `proof.sheet` and `proof.assemble` are two node rows, claimable by two
 * different worker processes, so the ONLY thing the assembler sees of the sheet
 * is what the sheet node projects into its output. That projection was a
 * hand-written inline object, and a field left off it becomes `null` on every
 * graph-executed run — which, with `CALL1_GRAPH=on`, is every customer run.
 *
 * ⛔ MEASURED ON GENERATION `848be1c6`, AND THE SPLIT IS EXACT:
 *
 *   projected   -> intake.briefSource "raw", promptChars 4887   (real values)
 *   NOT projected -> mode null, designAnchor null, quality examples 0
 *
 * `mode` is WHICH DESIGNER PERSONA RAN. `designAnchor` is the designer's own
 * description of the design it drew, which Call 2's photographer is handed so
 * all seven views photograph ONE design. Losing them does not break a pixel —
 * it makes the design engine unable to say what it did, which is worse, because
 * every later session reads the receipt and concludes the fix never shipped.
 *
 * So this file does not assert those four field names. It RECONCILES: every
 * `sheet.<field>` the assembler reads must be projected. Add a field to the
 * transport and consume it in the assembler, and this fails until it crosses.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const graph = require("../runtime/atlas-call1-graph.cjs");

const topologySrc = fs.readFileSync(
  new URL("../runtime/atlas-panel-proof-topology.cjs", import.meta.url), "utf8");
const graphSrc = fs.readFileSync(
  new URL("../runtime/atlas-call1-graph.cjs", import.meta.url), "utf8");

/** Comments quote field names too; strip them or the scan reads prose as code. */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * Every `sheet.<field>` the ASSEMBLER reads, from its own source.
 *
 * Scoped to `assemblePanelProofMaster`, because `requestProofSheet` runs INSIDE
 * the sheet node and reads the live object, boundary or no boundary.
 */
function assemblerSheetFields() {
  const body = stripComments(topologySrc);
  const start = body.indexOf("async function assemblePanelProofMaster(");
  assert.ok(start > 0, "the assembler must still be a named function");
  const end = body.indexOf("async function authorPanelProofMaster(", start);
  assert.ok(end > start, "the composition door must still follow the assembler");
  return new Set([...body.slice(start, end).matchAll(/\bsheet\.([a-zA-Z][a-zA-Z0-9_]*)/g)]
    .map((m) => m[1]));
}

test("every sheet field the assembler reads is projected across the node boundary", () => {
  const read = assemblerSheetFields();
  // The BYTES are deliberately not carried (RULE 0.39): the assemble node
  // re-reads them from storage and hash-verifies them. So are the decoded
  // pixel dimensions, which belong to the cut, not to the edge's answer.
  const carriedOtherwise = new Set(["bytes", "width", "height"]);
  // `contract` crosses under its wire name and is re-mapped by the assemble
  // node, which is the one rename and it is explicit at both ends.
  const wireName = { contract: "proofContract" };

  const projected = graph.sheetOutputFields({});
  const missing = [...read]
    .filter((field) => !carriedOtherwise.has(field))
    .filter((field) => !Object.prototype.hasOwnProperty.call(projected, wireName[field] || field));

  assert.deepEqual(missing, [],
    `the assembler reads these sheet fields and the sheet node does not project them, so they are null on every graph run: ${missing.join(", ")}`);
});

test("the assemble node re-maps the one renamed field and adds nothing of its own", () => {
  const body = stripComments(graphSrc);
  const block = body.slice(body.indexOf("panelProof.assemblePanelProofMaster("),
    body.indexOf("const stored = await store.putImmutableBytes("));
  assert.match(block, /sheet: \{ \.\.\.sheetOutput\.sheet, bytes, contract: sheetOutput\.sheet\.proofContract \}/,
    "the whole projection must be spread, so a newly projected field needs no second edit here");
});

test("the projection is a FUNCTION, so it can be reconciled at all", () => {
  assert.equal(typeof graph.sheetOutputFields, "function");
  // The inline literal this replaced could not be compared to anything, which
  // is exactly how five fields went missing without a single test going red.
  const body = stripComments(graphSrc);
  assert.match(body, /sheet: sheetOutputFields\(sheet\),/,
    "the sheet node must project through the named function, never re-inline the list");
});

test("the persona and the design anchor survive — the two the live run lost", () => {
  // Named explicitly as well as reconciled, because these two are what the
  // owner asked for by name and a reconcile alone would pass if BOTH the
  // assembler's read and the projection were deleted together.
  const projected = graph.sheetOutputFields({ mode: "restyle", designAnchor: "  plum, sage, black  " });
  assert.equal(projected.mode, "restyle");
  assert.equal(projected.designAnchor, "  plum, sage, black  ",
    "the anchor crosses verbatim; the transport already trimmed it");
  const body = stripComments(topologySrc);
  assert.match(body, /mode: sheet\.mode \|\| null,/);
  assert.match(body, /designAnchor: sheet\.designAnchor \|\| null,/);
});

test("an absent fact stays absent, and a present one is never invented", () => {
  const empty = graph.sheetOutputFields({});
  assert.equal(empty.mode, null, "no persona reported is null, never a guessed default");
  assert.equal(empty.designAnchor, null);
  assert.deepEqual(empty.artboardQualityExampleIdentities, []);
  assert.equal(empty.artboardQualityExamplesApplied, 0);
  // `promptVersion` falls back to the CONTRACT the edge does emit, on both
  // paths, rather than writing null beside a value the sheet plainly carries.
  assert.equal(graph.sheetOutputFields({ contract: "designpro.atlas-panel-proof.v1" }).promptVersion,
    "designpro.atlas-panel-proof.v1");
  assert.equal(empty.promptVersion, null, "with no contract either, absence stays absence");
});
