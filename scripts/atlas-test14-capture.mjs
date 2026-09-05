#!/usr/bin/env node
/**
 * TEST 14 — CAPTURE-ONLY PREFLIGHT.  (owner ruling, Trish 2026-09-04)
 *
 * Test 14 answers exactly one question:
 *
 *   Does giving DesignPanelAI the already-existing anonymous GENIE spatial
 *   geometry improve composition placement, without reintroducing
 *   model-facing production objects?
 *
 * This script MAKES NO PROVIDER CALL, opens NO database connection and needs
 * NO credential. It lifts the prompt assembly out of the deployed edge function
 * with esbuild (never re-described), replays it against a stored request, and
 * prints the complete literal evidence so the exact model-facing text can be
 * approved BEFORE anything is spent.
 *
 * Default fixture is the Arctic Air run whose panels failed review:
 *   GEN 63e6629a-1e56-42e3-a129-456f97f0aea4 (DID-63E6629A), 2022 Toyota Prius.
 * Its geometry is the run's own persisted manifest.zones, not recomputed.
 *
 *   node scripts/atlas-test14-capture.mjs [--json]
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAtlasCall1Prompt } from "./build-atlas-call1-prompt.mjs";
import { resolveEsbuild } from "./build-control-prompt.mjs";
import { assertFieldPromptClean, FORBIDDEN_IN_FIELD_PROMPT } from "./atlas-field-contract-v2.mjs";

const require = createRequire(import.meta.url);
const atlas = require("../runtime/flat-first-atlas.cjs");
const sha = (v) => createHash("sha256").update(v, "utf8").digest("hex");
// Read straight out of the runtime source; the constant is not exported and
// restating it here would let the evidence drift from what actually ships.
const EDGE_PROMPT_VERSION = /ATLAS_ARTBOARD_EDGE_PROMPT_VERSION = "([^"]+)"/
  .exec(readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8"))[1];
const rule = (t) => `\n${"═".repeat(78)}\n${t}\n${"═".repeat(78)}`;

// ── ZERO-SIDE-EFFECT FENCE ─────────────────────────────────────────────────
// A capture-only run that quietly reached the network would be worthless as
// evidence, so the ways out are removed rather than merely avoided.
let networkAttempts = 0;
globalThis.fetch = (...args) => {
  networkAttempts += 1;
  throw new Error(`atlas_test14_capture_is_offline: blocked fetch -> ${String(args[0]).slice(0, 120)}`);
};

// ── THE FIXTURE: the persisted Arctic Air request, verbatim ────────────────
const FIXTURE = {
  generationId: "63e6629a-1e56-42e3-a129-456f97f0aea4",
  did: "DID-63E6629A",
  revisionId: "37bb5e8d-48c8-4f62-beb9-a58bc82e417a",
  masterPromptHash: "1433f9e038fdea00971b7f3845e5e6e84c25768e38ddf48005718a6a52aa3df0",
  input: {
    mode: "commercial",
    brief: "Commercial hvac company wrap for ac company create a custom logo , and  yeti mascot \nUse blue white black and make it cohesive add a photo of a clean cut arctic air tech installing a ac on a home on a sunny day",
    finish: "Gloss",
    vehicle: { make: "Toyota", type: "car", year: "2022", model: "Prius" },
    website: "Www.ArcticAir.com",
    designName: "Arctic Air",
    companyName: "Arctic Air",
    pipelineMode: "flat-first-atlas-v1",
    contractVersion: "designpro.calls-1-7-input.v3",
  },
  // manifest.zones as persisted for that revision (manifest 1532c871…).
  // Only the fields atlasEdgeRequestBody reads.
  canvas: { widthPx: 4096, heightPx: 4096 },
  noseEdge: { driver: "left", passenger: "right" },
  zones: [
    { surfaceKey: "driver", placement: "third-1", x: 0, y: 72, w: 4096, h: 1221, rotationDegrees: 0 },
    { surfaceKey: "passenger", placement: "third-2", x: 0, y: 1437, w: 4096, h: 1221, rotationDegrees: 0 },
    { surfaceKey: "hood", placement: "third-3-row-1", x: 1071, y: 2730, w: 1127, h: 828, rotationDegrees: 0 },
    { surfaceKey: "roof", placement: "third-3-row-1", x: 0, y: 2730, w: 1071, h: 1207, rotationDegrees: 0 },
    { surfaceKey: "front", placement: "third-3-row-1", x: 2198, y: 2730, w: 1898, h: 605, rotationDegrees: 0 },
    { surfaceKey: "rear", placement: "third-3-row-2", x: 2198, y: 3335, w: 1127, h: 590, rotationDegrees: 0 },
  ],
};

// The exact v24 tail this run actually sent, recorded so old and new can be
// diffed literally rather than from memory.
const V24_TAIL = [
  "OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.",
  "Paint the entire square, edge to edge on all four sides, as one uninterrupted field of printed vinyl artwork for this exact 2022 Toyota Prius (car) — ground colour, texture and motion running continuously across the whole image, straight-on and flat.",
  "",
  "Compose it in three equal horizontal thirds that read as one picture:",
  "• THE UPPER THIRD — the primary hero passage: a complete, wide statement of the design, the company name whole and legible inside it, clear of the third's top and bottom edges. Forward energy sweeps left to right.",
  "• THE MIDDLE THIRD — a second hero passage telling the brand story in full, composed afresh as its own arrangement, the company name whole and legible inside it too. Forward energy sweeps right to left.",
  "• THE LOWER THIRD — the supporting register: the same ground, palette and motion at a calmer intensity, secondary motifs, finished artwork everywhere. The brand mark may appear here once, compact and whole; every other letter lives in the upper two thirds.",
  "",
  "Lettering reads left to right throughout. Each focal element sits inside one third; the ground and its motion flow through all three continuously, so the transitions are invisible. Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.",
].join("\n");

const TAIL_MARK = "\n\nOUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.";

async function main() {
  const json = process.argv.includes("--json");
  const manifest = { canvas: FIXTURE.canvas, installerMap: { noseEdge: FIXTURE.noseEdge }, zones: FIXTURE.zones };
  const body = atlas._test.atlasEdgeRequestBody(FIXTURE.input, manifest, {});

  const outDir = mkdtempSync(join(tmpdir(), "atlas-test14-"));
  const mod = await import(`file://${buildAtlasCall1Prompt({ outDir, esbuild: resolveEsbuild() })}`);
  const { prompt, references } = mod.buildAtlasCall1Prompt(body);
  const tail = prompt.slice(prompt.indexOf(TAIL_MARK)).replace(/^\n\n/, "");

  // ── 1. what the request carries, and that it did not change ──────────────
  //
  // The BODY must be byte-identical to what production sent: Test 14 changes
  // model-facing conditioning only, never the wire. Proof is that the body
  // still reproduces the persisted masterPromptHash under the version string
  // that run used.
  //
  // Under v25 the hash deliberately MOVES. masterPromptHash is
  // sha256(promptVersion + body), so bumping the version is what stops a v24
  // master being reused to answer a v25 request. A moved fence here is the
  // feature, not a discrepancy.
  const requestJson = JSON.stringify(body);
  const V24_VERSION = "atlas-artboard-designiq.20260902.v24-one-field";
  const bodyUnchanged = sha(`${V24_VERSION}\n${requestJson}`) === FIXTURE.masterPromptHash;
  const recomputedPromptHash = sha(`${EDGE_PROMPT_VERSION}\n${requestJson}`);

  // ── 2. every coordinate traced back to panels[].normalized ───────────────
  const rows = tail.split("\n").filter((l) => /^ {2}[\d.]+ [\d.]+ [\d.]+ [\d.]+/.test(l));
  const trace = rows.map((line) => {
    const [x0, y0, x1, y1] = line.trim().split(/\s+/).slice(0, 4);
    const src = body.panels.find((p) =>
      Number(p.normalized.x).toFixed(4) === x0 && Number(p.normalized.y).toFixed(4) === y0
      && (Number(p.normalized.x) + Number(p.normalized.width)).toFixed(4) === x1
      && (Number(p.normalized.y) + Number(p.normalized.height)).toFixed(4) === y1);
    const zone = src && FIXTURE.zones.find((z) => (SURFACE_OF[src.label] || "") === z.surfaceKey);
    return { emitted: [x0, y0, x1, y1].join(" "), sourced: Boolean(src), serverSideOnly: src?.label ?? null, zone };
  });
  const allSourced = trace.every((t) => t.sourced) && trace.length === 6
    && new Set(trace.map((t) => t.serverSideOnly)).size === 6;

  // ── 3. round-trip: does the emitted text describe the real cut rectangles? ─
  const C = FIXTURE.canvas.widthPx;
  const roundTrip = trace.map((t) => {
    const [x0, y0, x1, y1] = t.emitted.split(" ").map(Number);
    const px = [x0 * C, y0 * C, x1 * C, y1 * C].map((v) => Math.round(v));
    const z = t.zone;
    const actual = z ? [z.x, z.y, z.x + z.w, z.y + z.h] : null;
    return { px, actual, err: actual ? Math.max(...px.map((v, i) => Math.abs(v - actual[i]))) : null };
  });
  const worstErr = Math.max(...roundTrip.map((r) => r.err ?? Infinity));

  // ── 4. no hard-coded geometry literal in the emitting source ─────────────
  const edgeSrc = mod.__ATLAS_FIELD_CONTRACT_SOURCE__ ?? atlasFieldContractSource();
  const literals = edgeSrc.match(/(?<![\w.])\d*\.\d{3,}(?![\w])/g) || [];

  // ── 5. forbidden-vocabulary audit over the WHOLE model-facing prompt ─────
  let clean = true; let cleanError = "";
  try { assertFieldPromptClean(prompt, "the Test-14 model-facing prompt"); }
  catch (err) { clean = false; cleanError = String(err.message); }
  const OWNER_BANNED = ["driver", "passenger", "hood", "roof", "front", "rear", "region", "panel",
    "zone", "third", "band", "template", "artboard", "upper", "middle", "lower", "•"];
  const tailHits = OWNER_BANNED.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(tail));

  const evidence = {
    fixture: { generationId: FIXTURE.generationId, did: FIXTURE.did, revisionId: FIXTURE.revisionId },
    model: "gemini-3-pro-image",
    promptVersion: EDGE_PROMPT_VERSION,
    partCount: 1 + references.length,
    imageCount: references.length,
    assembledPromptHash: sha(prompt),
    assembledPromptChars: prompt.length,
    v24TailHash: sha(V24_TAIL),
    v25TailHash: sha(tail),
    requestBodyBytes: Buffer.byteLength(requestJson, "utf8"),
    requestBodyUnchangedVsProduction: bodyUnchanged,
    masterPromptHashV24: sha(`${V24_VERSION}\n${requestJson}`),
    masterPromptHashV25: recomputedPromptHash,
    emittedCoordinates: trace.map((t) => t.emitted),
    everyCoordinateFromPanelsNormalized: allSourced,
    worstRoundTripErrorPx: worstErr,
    hardCodedGeometryLiterals: literals,
    forbiddenVocabularyClean: clean && tailHits.length === 0,
    networkAttempts,
  };

  if (json) { console.log(JSON.stringify(evidence, null, 2)); return; }

  console.log(rule("TEST 14 — CAPTURE-ONLY PREFLIGHT.  NO PROVIDER CALL. NO DATABASE. NO DEPLOY."));
  console.log(`fixture        ${FIXTURE.did}  (${FIXTURE.generationId})`);
  console.log(`revision       ${FIXTURE.revisionId}`);
  console.log(`vehicle        ${FIXTURE.input.vehicle.year} ${FIXTURE.input.vehicle.make} ${FIXTURE.input.vehicle.model} (${FIXTURE.input.vehicle.type})`);
  console.log(`prompt version ${evidence.promptVersion}`);
  console.log(`model          ${evidence.model}`);

  console.log(rule("1. EXACT OLD TAIL  (v24, what this run actually sent)"));
  console.log(V24_TAIL);
  console.log(`\nsha256 ${evidence.v24TailHash}   ${V24_TAIL.length} chars`);

  console.log(rule("2. EXACT NEW TAIL  (v25, proposed)"));
  console.log(tail);
  console.log(`\nsha256 ${evidence.v25TailHash}   ${tail.length} chars`);

  console.log(rule("3. COMPLETE ASSEMBLED MODEL-FACING PROMPT"));
  console.log(prompt);

  console.log(rule("4. REQUEST FACTS"));
  console.log(`assembledPromptHash          ${evidence.assembledPromptHash}`);
  console.log(`assembled prompt chars       ${evidence.assembledPromptChars}`);
  console.log(`model                        ${evidence.model}`);
  console.log(`part count                   ${evidence.partCount}   (1 text part + ${evidence.imageCount} images)`);
  console.log(`image count                  ${evidence.imageCount}   ${evidence.imageCount === 0 ? "PASS — zero model-input images" : "FAIL"}`);
  console.log(`request body bytes           ${evidence.requestBodyBytes}`);
  console.log(`request body vs production   ${evidence.requestBodyUnchangedVsProduction ? "IDENTICAL — the wire did not change" : "CHANGED"}`);
  console.log(`  masterPromptHash under v24   ${evidence.masterPromptHashV24}`);
  console.log(`  persisted on GEN 63e6629a    ${FIXTURE.masterPromptHash}  ${evidence.requestBodyUnchangedVsProduction ? "MATCH" : "MISMATCH"}`);
  console.log(`  masterPromptHash under v25   ${evidence.masterPromptHashV25}  (fence moves on purpose — no v24 reuse)`);
  console.log(`network attempts             ${networkAttempts}   ${networkAttempts === 0 ? "PASS — offline" : "FAIL"}`);

  console.log(rule("5. EXACT NORMALIZED COORDINATES EMITTED, TRACED TO panels[].normalized"));
  console.log("  emitted (l t r b)                    from panels[].normalized   -> px            persisted zone      err");
  trace.forEach((t, i) => {
    const r = roundTrip[i];
    console.log(`  ${t.emitted.padEnd(36)} ${(t.sourced ? "yes" : "NO").padEnd(26)} ${r.px.join(",").padEnd(15)} ${(r.actual || []).join(",").padEnd(19)} ${r.err} px`);
  });
  console.log(`\nevery coordinate sourced from panels[].normalized : ${allSourced ? "PASS (6/6, one-to-one)" : "FAIL"}`);
  console.log(`worst round-trip error across all 24 edges        : ${worstErr} px of ${C}`);
  console.log(`hard-coded geometry fractions in emitting source  : ${literals.length ? `FAIL -> ${literals.join(", ")}` : "PASS (none)"}`);
  console.log("NOTE: surface names above are SERVER-SIDE trace only. They are not in the prompt.");

  console.log(rule("6. FORBIDDEN-VOCABULARY AUDIT (whole model-facing prompt)"));
  console.log(`field-contract v2 guard (${FORBIDDEN_IN_FIELD_PROMPT.length} terms) : ${clean ? "PASS" : `FAIL — ${cleanError}`}`);
  console.log(`owner ban list on the tail (${OWNER_BANNED.length} terms)   : ${tailHits.length ? `FAIL -> ${tailHits.join(", ")}` : "PASS"}`);
  console.log(`zero model-input images                      : ${evidence.imageCount === 0 ? "PASS" : "FAIL"}`);

  console.log(rule("VERDICT"));
  const gates = [
    ["zero model-input images", evidence.imageCount === 0],
    ["zero network activity", networkAttempts === 0],
    ["request body unchanged (wire untouched)", bodyUnchanged],
    ["reuse fence moved off v24", recomputedPromptHash !== FIXTURE.masterPromptHash],
    ["all six coordinates from panels[].normalized", allSourced],
    ["coordinates round-trip to the cutter exactly", worstErr === 0],
    ["no hard-coded geometry literal", literals.length === 0],
    ["forbidden vocabulary clean", clean && tailHits.length === 0],
  ];
  for (const [name, ok] of gates) console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`);
  const allOk = gates.every(([, ok]) => ok);
  console.log(`\n${allOk ? "CAPTURE-ONLY PREFLIGHT PASSED. No draw performed. Awaiting owner approval." : "CAPTURE-ONLY PREFLIGHT FAILED."}`);
  if (!allOk) process.exitCode = 1;
}

// Surface identity is server-side trace only; it never enters the prompt.
const SURFACE_OF = {
  "Driver Side": "driver", "Passenger Side": "passenger", "Hood": "hood",
  "Roof": "roof", "Front": "front", "Rear": "rear",
};

function atlasFieldContractSource() {
  const src = readFileSync(new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url), "utf8");
  const start = src.indexOf("function atlasFieldContract(");
  return src.slice(start, src.indexOf("\n// ── GENIE-DERIVED NORMALIZED", start));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
