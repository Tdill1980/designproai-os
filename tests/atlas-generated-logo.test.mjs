import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(new URL("../runtime/package.json", import.meta.url));
const graph = require("../runtime/atlas-call1-graph.cjs");
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const graphSrc = src("../runtime/atlas-call1-graph.cjs");
const edgeSrc = src("../supabase/functions/design-panel-ai-generate/index.ts");
const runtimeSrc = src("../runtime/flat-first-atlas.cjs");
const workerSrc = src("../runtime/index.js");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

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

test("the three-zone example is DRAWN IN CODE, not a stored screenshot", async () => {
  // Owner, 2026-09-21: "Recreate in code. But call one is not atlas and it
  // should say example."
  const example = require("../runtime/atlas-three-zone-example.cjs");
  const a = await example.renderThreeZoneExample();
  const b = await example.renderThreeZoneExample();
  assert.equal(sha(a), sha(b), "deterministic, or the staged object is re-uploaded every run");
  assert.ok(a.length > 50_000, "a real rendered sheet");

  // IT IS THE REAL TEMPLATE, so the example cannot drift from the document the
  // production system actually produces — the defect that retired the previous
  // stored sheet (it showed ONE version where the contract asks for THREE).
  const exampleSrc = src("../runtime/atlas-three-zone-example.cjs");
  assert.match(exampleSrc, /require\("\.\/atlas-proof-container-template\.cjs"\)/);
  assert.match(exampleSrc, /renderContainerTemplate\(/);

  // AND IT IS NOT CALLED A.T.L.A.S. — owner: "call one is not atlas". The
  // document is a 2D production proof; A.T.L.A.S. is the flat six-surface
  // master, a different object.
  const container = src("../runtime/atlas-proof-container-template.cjs");
  assert.match(container, /2D PRODUCTION PROOF/);
  assert.ok(!/A\.T\.L\.A\.S\./.test(container), "the sheet must not name itself ATLAS");

  // IT SAYS EXAMPLE — in the CHROME. Header badge, all three zone bars, footer.
  assert.match(exampleSrc, /EXAMPLE<\/text>/);
  assert.match(exampleSrc, /EXAMPLE — NOT A REAL JOB/);
  assert.match(exampleSrc, /EXAMPLE DOCUMENT — FORMAT REFERENCE ONLY/);
  // …and NEVER across a cell. That distinction is the whole safety argument:
  // `installer-one-panel-per-side.png` carried its own watermark and live sheet
  // 35402317471 answered it.
  const stamp = exampleSrc.slice(exampleSrc.indexOf("function exampleStampSvg"),
    exampleSrc.indexOf("The finished sheet."));
  assert.ok(!/layout\.zone1|layout\.zone2|cell\./.test(stamp),
    "the stamp never addresses a panel cell");

  // EACH SURFACE CARRIES A DIFFERENT AMOUNT, which is the sheet's real lesson
  // and what the reference itself does: the roof is background alone, the front
  // one line, the hood the mark, and only the flanks the full lockup and the
  // service bar. An earlier pass gave all six equal complexity -- it degraded
  // the two flanks that were already right and taught a customer's roof to be
  // as busy as their door.
  // EVERY SURFACE IS BRANDED IN ZONE 1. Owner, 2026-09-21: "Zone 1 is full
  // design on panels, zone 2 is only backgrounds -- design elements, logos and
  // text removed."
  //
  // An earlier pass gave the roof `none` and the hood a bare mark, reasoning
  // from a real wrap that a small surface carries less. True of a wrap, false
  // of a TEACHING sheet: with four of six panels bare in BOTH zones, Zone 1 and
  // Zone 2 rendered nearly identical and the sheet taught no separation at all.
  for (const [surfaceKey, treatment] of Object.entries(example.SURFACE_TREATMENT)) {
    assert.notEqual(treatment.lockup, "none", `${surfaceKey} must carry branding in Zone 1`);
  }
  // The FORM still varies -- a horizontal lockup does not fit a 22" bumper --
  // so this is not one-size-fits-all either.
  assert.ok(new Set(Object.values(example.SURFACE_TREATMENT).map((t) => t.lockup)).size >= 2);
  assert.equal(example.SURFACE_TREATMENT.driver.lockup, "full");
  assert.equal(example.SURFACE_TREATMENT.passenger.lockup, "full");
  assert.ok(!example.SURFACE_TREATMENT.front.services, "only a flank carries the service bar");

  // AND PROVEN ON PIXELS, not on the treatment table: Zone 1 must differ from
  // Zone 2 for EVERY surface, which is the one thing this document exists to
  // show. A table can say "branded" while the renderer draws nothing.
  for (const key of ["driver", "passenger", "roof", "hood", "front", "rear"]) {
    const zone2 = example._test.groundSvg(400, 200, { seed: 1 });
    const zone1 = example._test.brandedPanelSvg(400, 200, key);
    assert.notEqual(zone1, zone2, `${key}: Zone 1 and Zone 2 must not render the same`);
    assert.ok(zone1.length > 200, `${key}: Zone 1 must carry something liftable`);
  }
  // And the SHARED ground stays shared: motif added there reaches all six, so a
  // small-panel fix lands on the flanks too. That is how the last one regressed.
  // Comments stripped first: the block carries a cautionary note naming the
  // motif that regressed, and asserting over prose would convict the warning
  // rather than the code.
  const ground = exampleSrc.slice(exampleSrc.indexOf("function groundSvg"),
    exampleSrc.indexOf("const SURFACE_TREATMENT"))
    .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.ok(!/surfaceKey|SURFACE_TREATMENT/.test(ground),
    "the ground stays surface-agnostic; differentiation belongs per surface");
  assert.match(exampleSrc, /brandedPanelSvg\(cell\.w, cell\.h, cell\.surfaceKey\)/,
    "each Zone 1 panel is drawn for the surface it is");

  // A GENERIC BUSINESS, so a structural reference carries no real brand
  // (RULE 0.24) and no other customer's client rides every generation.
  assert.equal(example.EXAMPLE_BRAND.name, "NORTHPOINT");
  assert.ok(!/bright\s*smiles/i.test(exampleSrc));
});

test("the example reaches Call 1 on the same allowlist as every other input", () => {
  const start = edgeSrc.indexOf("THE THREE-ZONE PRODUCTION PROOF, AS SEPARATION CONTEXT");
  const end = edgeSrc.indexOf("THE GOLD-STANDARD ARTBOARDS", start);
  assert.ok(start > 0 && end > start, "the separation context block must be locatable");
  const block = edgeSrc.slice(start, end);

  // `downloadPart` enforces `atlas-call1-inputs/<sha256>.png` and hash-verifies
  // the bytes, so a path the edge would refuse cannot leave the runtime — the
  // 2099d17d lesson, applied before it costs a live run.
  assert.match(block, /downloadPart\(body\.threeZoneExampleStoragePath, "image\/png"\)/);
  assert.ok(!/atlas-examples/.test(block), "no stored-PNG path survives");

  // Staged by the runtime, and actually SENT — a field the edge reads and the
  // body never sets is the inert-seam defect this repo records twice.
  assert.match(runtimeSrc, /renderThreeZoneExample\(\)/);
  assert.match(runtimeSrc, /threeZoneInputPath = `atlas-call1-inputs\/\$\{sha256\(threeZoneBytes\)\}\.png`/);
  assert.match(runtimeSrc, /threeZoneExampleStoragePath: extras\.threeZoneExampleStoragePath/);

  // THE NEGATIVE IS THE WHOLE POINT. The sheet carries the exact marks
  // `map_drawn` convicts, and four live runs painted layout numbers onto the
  // flanks from a weaker cue than an attached picture of them.
  for (const forbidden of [/no zone bands/, /no captions/, /no dimension arrows/,
    /no measurements/, /no decimal numbers/, /no dashed frames/, /no registration marks/,
    /never the word EXAMPLE/]) {
    assert.match(block, forbidden);
  }
  assert.match(block, /NOT ARTWORK TO PRODUCE/);
  assert.match(block, /production system and never by you/);

  // FAIL SOFT, unlike `production-panel-proof`'s hard `panel_proof_input_
  // missing`: there the document IS the deliverable; here a missing teaching
  // input must never cost a customer a design.
  assert.match(block, /catch \(_error\)/);
  assert.ok(!/throw /.test(block));
  assert.match(edgeSrc, /threeZoneContextApplied,/);
});
