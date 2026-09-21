import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(new URL("../runtime/package.json", import.meta.url));
const graph = require("../runtime/atlas-call1-graph.cjs");
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const graphSrc = src("../runtime/atlas-call1-graph.cjs");
const edgeSrc = src("../supabase/functions/design-panel-ai-generate/index.ts");
const runtimeSrc = src("../runtime/flat-first-atlas.cjs");
const workerSrc = src("../runtime/index.js");

test("a customer who uploads no logo still gets a mark drawn for them", () => {
  // Owner, 2026-09-21: "if they didn't [upload] it auto created a logo."
  // `logoNodeFor` answered `return null` here, and the only generator in the
  // system lived behind the Call-1 bypass that was removed.
  const named = graph.compileElementGraph({ input: { companyName: "Botanical Gardens Landscape Design" } });
  const node = named.find((n) => n.key === "logo.generate");
  assert.ok(node, "a named business with no uploaded logo earns a generated mark");
  assert.deepEqual(node.dependsOn, [], "it draws from the brief, never the artwork, so it is a root");
  assert.equal(node.input.companyName, "Botanical Gardens Landscape Design");
});

test("the customer's own logo always wins and is never regenerated", () => {
  const uploaded = graph.compileElementGraph({ input: {
    companyName: "Botanical Gardens Landscape Design",
    logoAsset: { storagePath: `atlas-call1-inputs/${"b".repeat(64)}.png`, contentHash: "b".repeat(64), byteSize: 2048 },
  } });
  assert.ok(uploaded.some((n) => n.key === "logo.prepare"));
  assert.ok(!uploaded.some((n) => n.key === "logo.generate"),
    "a supplied mark is prepared, never replaced by a drawn one");
});

test("no business name means no mark, which is an answer and not a gap", () => {
  for (const input of [{}, { brief: "teal water, no branding" }, { phone: "555-0142" }]) {
    assert.ok(!graph.compileElementGraph({ input }).some((n) => n.key === "logo.generate"));
  }
});

test("the mark is the RECOVERED producer, not a second logo authority", () => {
  // RULE 1: recover before you invent. `authorProofLogo`, the
  // `designpro-text-layer-prompt` builder and `chromaKeyToAlpha` are the same
  // three pieces `designpro-text-layer-generate` and `production-panel-proof`
  // already share. This mode is a DOOR to them.
  assert.match(edgeSrc, /import \{ authorProofLogo, proofLogoRequested \} from "\.\.\/_shared\/atlas-proof-elements\.mjs"/);
  assert.match(edgeSrc, /buildPrompt as buildTextLayerPrompt, chromaKeyToAlpha \} from "\.\.\/_shared\/designpro-text-layer-art\.ts"/);
  const handler = edgeSrc.slice(edgeSrc.indexOf("async function handleAtlasLogo"),
    edgeSrc.indexOf("async function handleAtlasArtboard"));
  assert.match(handler, /authorProofLogo\(\{/);
  assert.match(handler, /buildPrompt: buildTextLayerPrompt/);
  // Keyed to REAL transparency, or an opaque magenta block composites onto the
  // wrap and prints.
  assert.match(handler, /normalize:.*chromaKeyToAlpha\(bytes, true\)/);
  // It returns an IDENTITY, never bytes (RULE 0.39).
  assert.ok(!/base64|inlineData/.test(handler.slice(handler.indexOf("JSON.stringify({"))));
  assert.match(handler, /storagePath: generated\.storagePath, contentHash: generated\.contentHash/);
});

test("the mode is internal-only, like every other Atlas mode", () => {
  // A browser JWT may not reach Call-1 machinery (RULE 0.26).
  const dispatch = edgeSrc.slice(edgeSrc.indexOf('body?.mode === "atlas-logo"'),
    edgeSrc.indexOf("handleAtlasLogo(body, internalCaller.userId!)"));
  assert.match(dispatch, /internalCaller\.internal/);
  assert.match(dispatch, /atlas_logo_internal_only/);
});

test("a missing transport costs the mark, never the design", () => {
  // RULE 0.15's blast radius, and the 2026-09-09 finishing rule. The
  // panel-proof node fails closed because the proof IS the design; a mark is an
  // enhancement on top of one.
  // Anchored on the node itself and the NEXT node's predicate: "ARCHITECTURE_DAG
  // §4.2" appears three times in this file, and slicing to the first one
  // silently produced an EMPTY string that passed a negative assertion.
  const start = graphSrc.indexOf("if (node.node_key === LOGO_GENERATE_NODE)");
  const end = graphSrc.indexOf("if (node.node_key === TYPESET_NODE", start);
  assert.ok(start > 0 && end > start, "the generated-logo node must be locatable");
  const node = graphSrc.slice(start, end);
  const guard = node.slice(node.indexOf('typeof callLogoEdge !== "function"'));
  assert.ok(!/throw /.test(guard.slice(0, guard.indexOf("const generated"))),
    "a worker without the transport completes with no mark rather than failing the run");
  assert.match(guard, /transportUnavailable: true/, "recorded, never silent");
  // And the lockup treats a null element as a decision, not an incomplete dep.
  assert.match(graphSrc, /if \(output\.element === null\) return null;/);
});

test("the transport takes its owner PER CALL, like the author transport", () => {
  // Both runtime processes serve every customer's runs, so a
  // construction-time-only owner sends an EMPTY x-designpro-owner-id on every
  // graph-claimed node -- the seam the panel-proof transport already had to
  // move, recorded in CLAUDE.md.
  const transport = runtimeSrc.slice(runtimeSrc.indexOf("function createAtlasLogoTransport"),
    runtimeSrc.indexOf("function createAtlasAuthorTransport"));
  assert.match(transport, /\{ ownerId = defaultOwnerId \} = \{\}/);
  assert.match(runtimeSrc, /"x-designpro-owner-id": String\(ownerId \|\| ""\)/);
  // And the worker actually hands it over, or the node is inert in production —
  // the exact class of defect CLAUDE.md records twice for routing flags.
  assert.match(workerSrc, /callLogoEdge: createAtlasLogoTransport\(\)/);
});

test("the three-zone proof is shown as separation context, never as artwork to draw", () => {
  // Owner, twice, 2026-09-21: "provide this example on call one everytime …
  // so the model understands a 3 zone proof."
  // Anchored on the BLOCK, not on a phrase inside the prompt text — the first
  // draft sliced from the prompt string and so began after the hash check it
  // meant to assert. Both offsets are checked, for the reason the note on the
  // logo-transport test gives.
  const start = edgeSrc.indexOf("THE THREE-ZONE PRODUCTION PROOF, AS SEPARATION CONTEXT");
  const end = edgeSrc.indexOf("THE GOLD-STANDARD ARTBOARDS", start);
  assert.ok(start > 0 && end > start, "the separation context block must be locatable");
  const block = edgeSrc.slice(start, end);

  // ONE ASSET, ONE HASH, THREE READERS. Pinned to the same object
  // `PANEL_PROOF_FORMAT_EXAMPLE` already names — never to a screenshot of it,
  // which carries an "EXAMPLE" badge over Zone 2 and a UI widget in the corner.
  const runtimePin = require("../runtime/atlas-panel-proof-contract.cjs").PANEL_PROOF_FORMAT_EXAMPLE;
  assert.match(edgeSrc, new RegExp(`sha256: "${runtimePin.sha256}"`));
  assert.match(edgeSrc, new RegExp(`path: "${runtimePin.path.replace(/[/.]/g, "\\$&")}"`));
  // And it is VERIFIED, not trusted: a silently different teaching input
  // teaches something nobody chose.
  assert.match(block, /await sha256Hex\(zoneBytes\) === ATLAS_THREE_ZONE_EXAMPLE\.sha256/);

  // THE NEGATIVE IS THE WHOLE POINT. This sheet is covered in the exact marks
  // `map_drawn` convicts, and four live runs painted layout numbers onto the
  // flanks from a weaker cue than an attached picture of them.
  for (const forbidden of [/no zone bands/, /no captions/, /no dimension arrows/,
    /no measurements/, /no decimal numbers/, /no dashed frames/, /no registration marks/]) {
    assert.match(block, forbidden);
  }
  assert.match(block, /NOT ARTWORK TO PRODUCE/);
  // Contiguous fragments only: the prompt is a concatenation, and a phrase
  // asserted across a source line break can never match.
  assert.match(block, /production system and never by you/);

  // FAIL SOFT. `production-panel-proof` throws `panel_proof_input_missing`
  // because there the document IS the deliverable; here a missing teaching
  // input must never cost a customer their design.
  assert.match(block, /catch \(_error\)/);
  assert.ok(!/throw /.test(block), "a missing or altered example never blocks authoring");

  // Reported, so "did this run see it" is a query — the effect has to be
  // judged from the refusal ledger, not from a comment.
  assert.match(edgeSrc, /threeZoneContextApplied,/);
});
