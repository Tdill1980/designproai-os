#!/usr/bin/env node
/**
 * TEST 8 — is the TEACHING PROOF ITSELF establishing the wrong output gestalt?
 *
 * Seven variables have now been isolated and every one was null: the teaching
 * proof's separation field, the neutral guide's presence, normalized topology
 * text, the proof's centre-column order, the output-contract object clause, the
 * proof's printed technical labels, and the model-facing description of the
 * output object. Pane compliance never left 0/6.
 *
 * The last unisolated VISUAL variable is not a property of the teaching proof.
 * It is the teaching proof.
 *
 *   A  the exact deployed Call-1 request, 5 parts:
 *        [0] creative prompt   [1] teaching instruction   [2] labeled Flamingo
 *        [3] target-guide instruction   [4] neutral target guide image
 *   B  byte-identical except parts [1] and [2] are ABSENT. 3 parts.
 *
 * NOT replaced with another image. No topology added. No new format clause. The
 * neutral guide stays in BOTH arms because production sends it, so guide state
 * matches production on both sides of the comparison.
 *
 * The creative prompt cites no attachment -- verified: it contains no "teaching",
 * "example", "reference", "attached", "supplied" or "provided" wording about an
 * image -- so removing the pair leaves no dangling citation behind. That is what
 * makes this a clean ablation rather than a broken request.
 *
 * THREE DRAWS PER ARM, INTERLEAVED A,B,A,B,A,B, because within-condition
 * variance in this task has repeatedly spanned a whole output class.
 *
 * PRIMARY PASS/FAIL — the owner's criterion and nothing else:
 *   6/6 A.T.L.A.S. PANES FILLED COMPLETELY EDGE TO EDGE WITH CONTINUOUS
 *   PRINTABLE ARTWORK, measured COLOUR-BLIND. `flat_atlas` alone is NOT a pass.
 * Secondary, in order: missing-artwork share, largest missing field, technical
 * furniture, Driver/Passenger cohesion, output class, latency.
 *
 * If arm B is also 0/6, Call-1 prompt/reference experimentation is finished and
 * the question becomes architectural, not conditioning.
 *
 * Harness only. No deploy, no production edit, no change to the teaching proof.
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
 * The two requests, and the guards that make the ablation exactly the ablation:
 * only the teaching pair may leave, the prompt and the guide pair may not move,
 * and arm B may not still be carrying the proof under another index.
 *
 * Exported so a test can convict each of those failures without a provider call.
 */
export function buildTeachingAblationRequests({
  prompt, teachingReferenceText, targetGuideText, teachingBytes, guideBytes, model,
  expectedTeachingSha256 = TEACHING_PROOF_SHA256,
}) {
  const image = (bytes) => ({ inlineData: { mimeType: "image/png", data: Buffer.from(bytes).toString("base64") } });
  const teachingPair = [{ text: teachingReferenceText }, image(teachingBytes)];
  const guidePair = [{ text: targetGuideText }, image(guideBytes)];
  const partsA = [{ text: prompt }, ...teachingPair, ...guidePair];
  const partsB = [{ text: prompt }, ...guidePair];

  const serialize = (parts) => JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: GENERATION_CONFIG });
  const describe = (label, parts) => ({
    label,
    model,
    generationConfig: GENERATION_CONFIG,
    promptChars: prompt.length,
    promptSha256: sha(prompt),
    partCount: parts.length,
    modelInputImageCount: parts.filter((p) => p.inlineData?.data).length,
    modelRequestByteSize: Buffer.byteLength(serialize(parts), "utf8"),
    parts: parts.map(partSummary),
  });
  const requests = {
    A: describe("A-deployed-request", partsA),
    B: describe("B-teaching-proof-absent", partsB),
  };

  if (requests.A.partCount !== 5) throw new Error(`arm A has ${requests.A.partCount} parts, expected the deployed 5`);
  if (requests.B.partCount !== 3) throw new Error(`arm B has ${requests.B.partCount} parts, expected 3`);
  if (requests.A.modelInputImageCount !== 2) throw new Error("arm A must carry the teaching proof AND the target guide");
  if (requests.B.modelInputImageCount !== 1) throw new Error("arm B must carry the target guide and nothing else");

  // The prompt is untouched: same bytes, same position, in both arms.
  if (requests.A.parts[0].sha256 !== requests.B.parts[0].sha256) {
    throw new Error("the creative prompt differs between arms — only the teaching pair may be removed");
  }
  // Exactly the teaching pair leaves, and exactly the guide pair stays.
  if (requests.A.parts[1].kind !== "text" || !requests.A.parts[1].preview.startsWith("LABELED A.T.L.A.S. TEACHING REFERENCE")) {
    throw new Error("part 1 is not the teaching instruction — the ablation would remove the wrong part");
  }
  if (requests.A.parts[2].sha256 !== expectedTeachingSha256) throw new Error("the teaching proof moved");
  const guideTextSha = sha(targetGuideText);
  const guideSha = sha(Buffer.from(guideBytes));
  if (requests.A.parts[3].sha256 !== guideTextSha || requests.A.parts[4].sha256 !== guideSha) {
    throw new Error("arm A's guide pair is not the guide pair");
  }
  if (requests.B.parts[1].sha256 !== guideTextSha || requests.B.parts[2].sha256 !== guideSha) {
    throw new Error("arm B does not carry the production guide pair — guide state must match production in both arms");
  }
  // Nothing teaching-shaped survives anywhere in B, under any index.
  if (requests.B.parts.some((p) => p.kind === "image" && p.sha256 === expectedTeachingSha256)) {
    throw new Error("arm B still carries the teaching proof image");
  }
  if (requests.B.parts.some((p) => p.kind === "text" && p.sha256 === sha(teachingReferenceText))) {
    throw new Error("arm B still carries the teaching instruction");
  }
  // No substitute image was introduced: B's only image is the guide.
  const bImages = requests.B.parts.filter((p) => p.kind === "image");
  if (bImages.length !== 1 || bImages[0].sha256 !== guideSha) {
    throw new Error("arm B carries an image that is not the production guide — the proof must not be replaced");
  }

  return { partsA, partsB, requests, serialize };
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

  const { partsA, partsB, requests, serialize } = buildTeachingAblationRequests({
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
  log(`arm B removes exactly parts [1] teaching instruction and [2] labeled Flamingo — ${requests.B.modelRequestByteSize} bytes, ${requests.B.partCount} parts, ${requests.B.modelInputImageCount} image`);
  log(`  prompt sha ${requests.A.promptSha256.slice(0, 16)}, byte-identical in both arms`);
  log(`  guide pair present in both arms: text ${requests.A.parts[3].sha256.slice(0, 16)}, image ${requests.A.parts[4].sha256.slice(0, 16)}`);
  writeFileSync(join(OUT, "prompt.txt"), assembled.prompt);
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({ vehicle: VEHICLE, brief: BRIEF, draws: DRAWS, requests }, null, 2));

  if (captureOnly) {
    log("capture-only: both requests written, no provider call made");
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ captureOnly: true, imageRequestsExecuted: 0, parity, requests }, null, 2));
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
      const file = `${label}-${arm === "A" ? "deployed" : "proof-absent"}.png`;
      log("");
      log(`${label}: calling ${call1.AUTHORING_MODEL} (${parts.length} parts) …`);
      const { bytes, elapsedMs } = await callGemini(label, parts, file);
      const measured = await measureRawMaster(label, bytes, manifest, provider);
      draws.push({ draw: n, arm, label, file, elapsedMs, ...measured });
    }
  }

  const results = {
    contract: "designpro.call1-teaching-proof-ablation.v1",
    ranAt: new Date().toISOString(),
    imageRequestsExecuted: draws.length,
    outputClassInspections: draws.length,
    drawsPerArm: DRAWS,
    order: draws.map((d) => d.label),
    vehicle: VEHICLE,
    brief: BRIEF,
    model: call1.AUTHORING_MODEL,
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
    "# Test 8 — teaching proof present vs absent, raw pre-repair masters",
    "",
    "A = the exact deployed request (5 parts). B = byte-identical with the teaching",
    "instruction and the labeled Flamingo proof ABSENT (3 parts). Not replaced.",
    "The production neutral guide is present in BOTH arms.",
    `${DRAWS} draws per arm, interleaved.`,
    "",
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

if (process.argv[1] && process.argv[1].endsWith("atlas-teaching-proof-ablation-ab.mjs")) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
