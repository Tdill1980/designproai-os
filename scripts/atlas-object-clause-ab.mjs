#!/usr/bin/env node
/**
 * TEST 5 — the contradictory object definition.
 *
 * The deployed flat-master output contract asks for TWO different objects in the
 * same 1,965 characters. It states the print-media framing —
 *
 *   "the same kind of image as a printed poster or a roll of printed vinyl laid
 *    flat on a table. It is the artwork by itself, before anything is cut or
 *    applied."
 *
 * — and, first and more concretely, it also asks for a flattened vehicle:
 *
 *   "the complete flattened panel layout of the vehicle"
 *
 * Read plainly that is a request for the vehicle's panels, flattened: a body
 * template, which is the artifact Gemini keeps returning. An output that flips
 * between the two readings on byte-identical requests — flat_atlas 3/3 in one
 * run, vehicle_depiction 3/3 an hour later — is what a genuinely ambiguous
 * instruction produces.
 *
 *   A  the exact deployed request, 5 parts
 *   B  byte-identical except ONE clause of the output contract is reframed from
 *      vehicle anatomy to print media
 *
 * No negative is added, no wheel-well language, no threshold, no creative block,
 * no teaching-proof change, no topology change, no surface-name change, no
 * model/config change. Per RULE 0.26 the clause lives in the swapped
 * presentation tail, not in the DesignPanelAI creative persona.
 *
 * SIX DRAWS PER ARM, INTERLEAVED. Three cannot resolve output class: test 3's
 * arm A and test 4's arm A are the same request byte for byte and returned
 * flat_atlas 3/3 and vehicle_depiction 3/3 an hour apart.
 *
 * PRIMARY ENDPOINT (RULE 0.32): six continuous rectangular artwork regions, edge
 * to edge, with no missing-artwork fields and no vehicle-anatomy contours,
 * measured COLOUR-BLIND. `edgeHoleRatio` and flat-black share are reported for
 * continuity with tests 1-4 and are NOT the endpoint — a missing-artwork field
 * is one whatever colour it is.
 *
 * Harness only. No deploy, no production edit, no generation/revision/view/
 * artifact row.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fullBleedMetrics } from "./atlas-fullbleed-metrics.mjs";

const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
const { createClient } = require_("@supabase/supabase-js");
const atlas = require_("./flat-first-atlas.cjs");
const genie = require_("./genie-universal-resolver.cjs");
const examples = require_("./flat-atlas-topology-examples.cjs");
const qc = require_("./atlas-master-qc.cjs");
const outputClass = require_("./atlas-output-class.cjs");
const { createProvider } = require_("./generation-provider.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const OUT = args.out || "./ab-evidence";
mkdirSync(OUT, { recursive: true });

const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const truthy = (v) => String(v).toLowerCase() === "true";
const DRAWS = Math.max(1, Number(args.draws) || 3);

const TEACHING_PROOF_SHA256 = "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded";
// Measured off the DEPLOYED edge for this exact fixture, run 33577484230, and
// off arm B of run 33579220719. Arm A must reproduce the guide-absent figure or
// the run aborts before spending a draw.
const EXPECTED_DEPLOYED_BYTES = 4762109;
const EXPECTED_PROMPT_CHARS = 4587;
const EXPECTED_IMAGE_COUNT = 2;

const BRIEF = args.brief
  || "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with "
  + "sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif "
  + "company name, high contrast and legible at highway distance.";
const VEHICLE = {
  type: args["vehicle-type"] || "truck",
  year: args["vehicle-year"] || "2022",
  make: args["vehicle-make"] || "Ford",
  model: args["vehicle-model"] || "F250 Crew Cab",
};
const V3_INPUT = {
  contractVersion: "designpro.calls-1-7-input.v3",
  pipelineMode: "flat-first-atlas-v1",
  vehicle: VEHICLE,
  brief: BRIEF,
  designName: args["design-name"] || "Teaching-proof field A/B",
  mode: "commercial",
  industry: args.industry || "HVAC and climate control",
  colors: (args.colors || "deep blue,sunrise orange").split(",").map((c) => c.trim()),
  style: args.style || "modern commercial",
};

const SURFACE_ORDER = ["driver", "passenger", "front", "hood", "rear", "roof"];

// ── THE ONE CLAUSE ────────────────────────────────────────────────────────
// The owner's exact wording, both sides. Nothing here is paraphrased: the search
// text must appear in the deployed prompt exactly once or the run refuses.
export const ANATOMY_CLAUSE = "the complete flattened panel layout of the vehicle";
export const MEDIA_CLAUSE = "the complete layout of the continuous rectangular printed wrap sheets, unwrapped flat before installation and trimming";

function zoneMetrics(checks) {
  const byKey = new Map((checks.zones || []).map((z) => [z.surfaceKey, z]));
  const out = {};
  for (const key of SURFACE_ORDER) {
    const z = byKey.get(key);
    out[key] = z
      ? {
        edgeHoleRatio: Number(z.edgeHoleRatio.toFixed(5)),
        largestCutoutComponentRatio: Number(z.largestCutoutComponentRatio.toFixed(5)),
        flatBlackRatio: Number(z.flatBlackRatio.toFixed(5)),
        cutoutComponentCount: z.cutoutComponentCount,
        opaqueRatio: Number(z.opaqueRatio.toFixed(5)),
        lumaStddev: Number(z.lumaStddev.toFixed(2)),
      }
      : null;
  }
  return out;
}

async function measureRawMaster(label, bytes, manifest, provider) {
  const normalized = await atlas.normalizeAtlasMaster(bytes, manifest);
  const normalizedBytes = normalized?.bytes || normalized;
  const checks = await qc.deterministicMasterChecks(normalizedBytes, manifest);
  const legacy = zoneMetrics(checks);
  // THE PRIMARY ENDPOINT, on the normalized master so the zone rectangles line
  // up with the manifest exactly as the panel cut will see them.
  const fullBleed = await fullBleedMetrics(normalizedBytes, manifest);
  const verdict = await outputClass.classifyAtlasCandidate({ provider, bytes });

  log(`${label}: fullBleed ${fullBleed.fullBleedCompliantCount}/6  worstNonArtwork ${(fullBleed.worstNonArtworkRatio * 100).toFixed(1)}%  `
    + `worstContour ${fullBleed.worstContourScore.toFixed(3)}  class=${verdict.disposition}  legacyAccepted=${checks.accepted}`);
  if (verdict.evidence) log(`    inspector: ${String(verdict.evidence).slice(0, 120)}`);
  for (const key of SURFACE_ORDER) {
    const f = fullBleed.zones[key];
    const l = legacy[key];
    if (!f) continue;
    log(`    ${key.padEnd(10)} bleed ${f.fullBleedCompliant ? "OK " : "NO "} `
      + `nonArtwork ${(f.nonArtworkRatio * 100).toFixed(1).padStart(5)}%  largestField ${(f.largestNonArtworkComponentRatio * 100).toFixed(1).padStart(5)}%  `
      + `borderArtwork ${(f.borderArtworkRatio * 100).toFixed(1).padStart(5)}%  contour ${f.contourScore.toFixed(3)}  `
      + `[legacy edgeHole ${l ? l.edgeHoleRatio.toFixed(3) : "-"}]`);
  }
  return {
    rawSha256: sha(bytes),
    rawByteSize: bytes.length,
    deliveredWidthPx: normalized?.deliveredWidthPx ?? null,
    deliveredHeightPx: normalized?.deliveredHeightPx ?? null,
    nativelyFourK: normalized?.nativelyFourK ?? null,
    fullBleed,
    outputClass: {
      disposition: verdict.disposition,
      blocking: verdict.blocking,
      confidence: verdict.confidence,
      evidence: verdict.evidence,
      code: verdict.code,
      model: verdict.model,
    },
    legacyAccepted: checks.accepted,
    legacyBlockingFailures: checks.blockingFailures,
    passengerMirrorMae: checks.passengerMirrorMae,
    legacySurfaces: legacy,
  };
}

function partSummary(part, index) {
  if (part.text != null) {
    return { index, kind: "text", chars: part.text.length, sha256: sha(part.text), preview: part.text.slice(0, 90).replace(/\s+/g, " ") };
  }
  const bytes = Buffer.from(part.inlineData?.data || "", "base64");
  return { index, kind: "image", mimeType: part.inlineData?.mimeType, bytes: bytes.length, sha256: sha(bytes) };
}

export const GENERATION_CONFIG = {
  responseModalities: ["TEXT", "IMAGE"],
  imageConfig: { aspectRatio: "1:1", imageSize: "4K" },
};

/**
 * The two requests, and the guards that keep the one clause the ONLY change.
 * Exported so a test can convict a second edit sneaking into the prompt, the
 * clause not being found, a missing guide, or the teaching proof moving.
 */
export function buildObjectClauseRequests({
  prompt, teachingReferenceText, targetGuideText, teachingBytes, guideBytes, model,
  expectedTeachingSha256 = TEACHING_PROOF_SHA256,
}) {
  const occurrences = prompt.split(ANATOMY_CLAUSE).length - 1;
  if (occurrences !== 1) {
    throw new Error(`the anatomy clause appears ${occurrences} times in the deployed prompt, expected exactly 1`);
  }
  const reframed = prompt.replace(ANATOMY_CLAUSE, MEDIA_CLAUSE);
  // Byte-level proof that ONE substring moved and nothing else did.
  if (reframed.replace(MEDIA_CLAUSE, ANATOMY_CLAUSE) !== prompt) {
    throw new Error("reframing the clause changed something else in the prompt");
  }
  if (reframed.length - prompt.length !== MEDIA_CLAUSE.length - ANATOMY_CLAUSE.length) {
    throw new Error("the prompt length delta is not the clause length delta");
  }

  const image = (bytes) => ({ inlineData: { mimeType: "image/png", data: Buffer.from(bytes).toString("base64") } });
  const tail = [
    { text: teachingReferenceText },
    image(teachingBytes),
    { text: targetGuideText },
    image(guideBytes),
  ];
  const partsA = [{ text: prompt }, ...tail];
  const partsB = [{ text: reframed }, ...tail];

  const serialize = (parts) => JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: GENERATION_CONFIG });
  const describe = (label, parts, text) => ({
    label,
    model,
    generationConfig: GENERATION_CONFIG,
    promptChars: text.length,
    partCount: parts.length,
    modelInputImageCount: parts.filter((p) => p.inlineData?.data).length,
    modelRequestByteSize: Buffer.byteLength(serialize(parts), "utf8"),
    parts: parts.map(partSummary),
  });
  const requests = {
    A: describe("A-deployed-request", partsA, prompt),
    B: describe("B-print-media-clause", partsB, reframed),
  };

  if (requests.A.partCount !== 5 || requests.B.partCount !== 5) {
    throw new Error(`both arms must be the deployed 5 parts, got ${requests.A.partCount} and ${requests.B.partCount}`);
  }
  if (requests.A.modelInputImageCount !== 2 || requests.B.modelInputImageCount !== 2) {
    throw new Error("both arms must carry the teaching proof AND the target guide");
  }
  for (let i = 1; i < 5; i += 1) {
    if (requests.A.parts[i].sha256 !== requests.B.parts[i].sha256) {
      throw new Error(`part ${i} differs between arms — only the prompt clause may change`);
    }
  }
  if (requests.A.parts[0].sha256 === requests.B.parts[0].sha256) throw new Error("the prompt is identical — nothing is being tested");
  if (requests.A.parts[2].sha256 !== expectedTeachingSha256) throw new Error("the teaching proof moved");
  if (!requests.A.parts[3].preview.startsWith("CURRENT TARGET GUIDE")) throw new Error("part 3 is not the target-guide instruction");

  return { partsA, partsB, requests, serialize, reframed };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const keyPool = String(process.env.GOOGLE_AI_API_KEY_POOL || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "")
    .split(",").map((k) => k.trim()).filter(Boolean);
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const captureOnly = truthy(args["capture-only"]);
  if (!captureOnly && !keyPool.length) throw new Error("no Google AI key configured");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const provider = createProvider({ env: process.env });

  const call1Path = args.call1 || "./atlas-call1-build/atlas-call1-prompt.mjs";
  const call1 = await import(new URL(call1Path, `file://${process.cwd()}/`).href);

  log("resolving GENIE preview dimensions …");
  const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, VEHICLE, provider);
  const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
  const manifest = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority);
  const guideBytes = await atlas.renderAtlasAuthoringGuide(manifest);

  const teachingProof = examples.loadBundledAtlasTeachingProof();
  const teachingBytes = Buffer.from(teachingProof.flattenedTopView.bytes);
  if (sha(teachingBytes) !== TEACHING_PROOF_SHA256) {
    throw new Error("the bundled teaching proof is not the pinned owner proof — refusing to run");
  }

  const edgeBody = atlas._test.atlasEdgeRequestBody(V3_INPUT, manifest, {
    teachingProofStoragePath: `atlas-call1-inputs/${sha(teachingBytes)}.png`,
    teachingProofIdentity: teachingProof.identity,
    guideStoragePath: `atlas-call1-inputs/${sha(guideBytes)}.png`,
  });
  const assembled = call1.buildAtlasCall1Prompt(edgeBody);
  if (assembled.references.length) throw new Error("this fixture must carry no customer references");

  const { partsA, partsB, requests, serialize, reframed } = buildObjectClauseRequests({
    prompt: assembled.prompt,
    teachingReferenceText: call1.TEACHING_REFERENCE_TEXT,
    targetGuideText: call1.TARGET_GUIDE_TEXT,
    teachingBytes,
    guideBytes,
    model: call1.AUTHORING_MODEL,
  });

  const parity = {
    source: "the deployed design-panel-ai-generate edge, run 33577484230, same fixture",
    modelRequestByteSize: { measured: EXPECTED_DEPLOYED_BYTES, harnessArmA: requests.A.modelRequestByteSize },
    promptChars: { measured: EXPECTED_PROMPT_CHARS, harnessArmA: requests.A.promptChars },
    modelInputImageCount: { measured: EXPECTED_IMAGE_COUNT, harnessArmA: requests.A.modelInputImageCount },
  };
  writeFileSync(join(OUT, "parity.json"), JSON.stringify(parity, null, 2));
  const mismatches = Object.entries(parity).filter(([k, v]) => k !== "source" && v.measured !== v.harnessArmA);
  if (mismatches.length) {
    throw new Error(
      "arm A is not the deployed request — refusing to spend twelve draws on a request production does not send:\n"
      + mismatches.map(([k, v]) => `  ${k}: measured=${v.measured} harness=${v.harnessArmA}`).join("\n"),
    );
  }

  log(`arm A reproduces the DEPLOYED request: ${requests.A.modelRequestByteSize} bytes, ${requests.A.partCount} parts, ${requests.A.modelInputImageCount} images, prompt ${requests.A.promptChars} chars`);
  log(`arm B reframes one clause: ${requests.B.modelRequestByteSize} bytes, ${requests.B.partCount} parts, ${requests.B.modelInputImageCount} images, prompt ${requests.B.promptChars} chars`);
  log("");
  log(`  A: "...on one sheet -- ${ANATOMY_CLAUSE}."`);
  log(`  B: "...on one sheet -- ${MEDIA_CLAUSE}."`);
  log("");
  writeFileSync(join(OUT, "clause.txt"), `A: ${ANATOMY_CLAUSE}\nB: ${MEDIA_CLAUSE}\n`);
  writeFileSync(join(OUT, "prompt-A.txt"), assembled.prompt);
  writeFileSync(join(OUT, "prompt-B.txt"), reframed);
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({ vehicle: VEHICLE, brief: BRIEF, draws: DRAWS, clause: { A: ANATOMY_CLAUSE, B: MEDIA_CLAUSE }, requests }, null, 2));

  if (captureOnly) {
    log("capture-only: both requests written, no provider call made");
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ captureOnly: true, imageRequestsExecuted: 0, parity, clause: { A: ANATOMY_CLAUSE, B: MEDIA_CLAUSE }, requests }, null, 2));
    return;
  }

  const key = keyPool[0];
  const callGemini = async (label, parts, file) => {
    const started = Date.now();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${call1.AUTHORING_MODEL}:generateContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: serialize(parts), signal: AbortSignal.timeout(300_000) },
    );
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${(await response.text().catch(() => "")).slice(0, 400)}`);
    const payload = await response.json();
    const image = (payload?.candidates?.[0]?.content?.parts || []).find((p) => p?.inlineData?.data);
    if (!image) throw new Error(`${label} returned no image (${payload?.candidates?.[0]?.finishReason || "unknown"})`);
    const bytes = Buffer.from(image.inlineData.data, "base64");
    const elapsedMs = Date.now() - started;
    writeFileSync(join(OUT, file), bytes);
    log(`${label}: ${(bytes.length / 1024).toFixed(0)}KB in ${(elapsedMs / 1000).toFixed(1)}s → ${file}`);
    return { bytes, elapsedMs };
  };

  const draws = [];
  for (let n = 1; n <= DRAWS; n += 1) {
    for (const [arm, parts] of [["A", partsA], ["B", partsB]]) {
      const label = `${arm}${n}`;
      const file = `${label}-${arm === "A" ? "deployed" : "print-media"}.png`;
      log("");
      log(`${label}: calling ${call1.AUTHORING_MODEL} (${parts.length} parts) …`);
      const { bytes, elapsedMs } = await callGemini(label, parts, file);
      const measured = await measureRawMaster(label, bytes, manifest, provider);
      draws.push({ draw: n, arm, label, file, elapsedMs, ...measured });
    }
  }

  const results = {
    contract: "designpro.call1-object-clause.v1",
    ranAt: new Date().toISOString(),
    imageRequestsExecuted: draws.length,
    outputClassInspections: draws.length,
    drawsPerArm: DRAWS,
    order: draws.map((d) => d.label),
    vehicle: VEHICLE,
    brief: BRIEF,
    model: call1.AUTHORING_MODEL,
    clause: { A: ANATOMY_CLAUSE, B: MEDIA_CLAUSE },
    parity,
    requests,
    draws,
  };
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));

  const zoneTable = (title, f) => [
    "", `## ${title}`, "",
    `| draw | arm | ${SURFACE_ORDER.join(" | ")} |`,
    `|---|---|${SURFACE_ORDER.map(() => "---").join("|")}|`,
    ...draws.map((d) => `| ${d.label} | ${d.arm} | ${SURFACE_ORDER.map((k) => f(d.fullBleed.zones[k], d.legacySurfaces[k])).join(" | ")} |`),
  ];
  writeFileSync(join(OUT, "COMPARISON.md"), [
    "# Test 5 — the contradictory object definition, raw pre-repair masters",
    "",
    "A = the exact deployed request. B = byte-identical except one clause of the",
    "output contract is reframed from vehicle anatomy to print media.",
    `${DRAWS} draws per arm, interleaved.`,
    "",
    `A: \`...on one sheet -- ${ANATOMY_CLAUSE}.\``,
    "",
    `B: \`...on one sheet -- ${MEDIA_CLAUSE}.\``,
    "",
    "## PRIMARY ENDPOINT (RULE 0.32) — six continuous rectangular artwork regions,",
    "## edge to edge, no missing-artwork fields, no anatomy contours. Colour-blind.",
    "",
    "| draw | arm | compliant zones | worst non-artwork | worst contour | output class | legacy accepted | latency |",
    "|---|---|---|---|---|---|---|---|",
    ...draws.map((d) => `| ${d.label} | ${d.arm} | **${d.fullBleed.fullBleedCompliantCount}/6** `
      + `| ${(d.fullBleed.worstNonArtworkRatio * 100).toFixed(1)}% | ${d.fullBleed.worstContourScore.toFixed(3)} `
      + `| ${d.outputClass.disposition} | ${d.legacyAccepted} | ${(d.elapsedMs / 1000).toFixed(1)}s |`),
    "",
    "`holeAt` is near-black-or-transparent and therefore colour-conditional; the",
    "compliance column above is not. The legacy column is kept for continuity with",
    "tests 1 and 2 and is NOT the endpoint.",
    ...zoneTable("largest non-artwork connected region (colour-blind), share of zone", (f) => (f ? `${(f.largestNonArtworkComponentRatio * 100).toFixed(1)}%` : "-")),
    ...zoneTable("contour / silhouette score (0 = fills its bounding box)", (f) => (f ? f.contourScore.toFixed(3) : "-")),
    ...zoneTable("border artwork ratio (1.000 = artwork runs off all four sides)", (f) => (f ? f.borderArtworkRatio.toFixed(3) : "-")),
    ...zoneTable("legacy edgeHoleRatio — NOT the endpoint", (_f, l) => (l ? l.edgeHoleRatio.toFixed(3) : "-")),
    "",
    "## Driver/Passenger cohesion",
    "",
    "| draw | arm | passengerMirrorMae |",
    "|---|---|---|",
    ...draws.map((d) => `| ${d.label} | ${d.arm} | ${d.passengerMirrorMae} |`),
    "",
    "Creative quality and Driver/Passenger cohesion are the owner's judgement, on",
    "the images. No number here decides them.",
    "",
  ].join("\n"));

  log("");
  log(`${draws.length} draws written; results.json and COMPARISON.md in ${OUT}`);
}

if (process.argv[1] && process.argv[1].endsWith("atlas-object-clause-ab.mjs")) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
