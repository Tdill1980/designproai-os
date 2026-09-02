#!/usr/bin/env node
/**
 * TEST 2 — is the blank target guide what makes Call 1 unstable between
 * "flat A.T.L.A.S." and "vehicle / body template"?
 *
 * Test 1 refuted the teaching proof's black field and exposed something larger:
 * two draws of the IDENTICAL deployed request came back in different output
 * CLASSES — a photoreal vehicle depiction and six flat rectangles — and both
 * failed the deterministic gate on different surfaces. So the primary endpoint
 * here is output-class STABILITY, not a black-pixel percentage.
 *
 *   A  the exact deployed Call-1 request, 5 parts:
 *        [0] creative prompt   [1] teaching instruction   [2] labeled Flamingo
 *        [3] target-guide instruction   [4] neutral target guide image
 *   B  byte-identical except parts [3] and [4] are ABSENT. Not replaced, not
 *      recoloured, not moved. 3 parts.
 *
 * THREE INDEPENDENT DRAWS PER ARM, INTERLEAVED A,B,A,B,A,B. Interleaved because
 * Test 1 measured within-condition variance spanning a whole output class: run
 * AAABBB and any drift in the model service during the run lands entirely on one
 * arm and reads as the effect.
 *
 * NO SEVENTH CALL FOR A PARITY ANCHOR. The deployed edge already answered that
 * question on this exact fixture in run 33577484230 — modelRequestByteSize
 * 4,762,109, promptChars 4,587, 2 images, gemini-3-pro-image — so those numbers
 * are pinned below and arm A must reproduce them or the run aborts. A pin costs
 * nothing; a redundant image call costs a draw.
 *
 * Output class is read by the PRODUCTION gate (`classifyAtlasCandidate`,
 * gemini-2.5-flash, temperature 0) — the same instrument that decides whether a
 * candidate may become canonical. It is binary by design (flat_atlas |
 * vehicle_depiction) and cannot name the die-cut "body template" class Test 1's
 * variant produced, so the deterministic template signature is reported beside
 * it and the four-class reading stays a human judgement on the images. No new
 * semantic gate is introduced here.
 *
 * It changes nothing: no deploy, no env write, no prompt change, no topology
 * change, no generation/revision/view/artifact row, and the teaching proof and
 * its edge hash pin are untouched.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

// Measured off the DEPLOYED edge for this exact fixture, run 33577484230.
const EXPECTED_EDGE_REQUEST_BYTES = 4762109;
const EXPECTED_PROMPT_CHARS = 4587;
const EXPECTED_IMAGE_COUNT = 2;
const TEACHING_PROOF_SHA256 = "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded";

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
        concentratedFlatBlackRatio: Number(z.concentratedFlatBlackRatio.toFixed(5)),
        flatBlackRatio: Number(z.flatBlackRatio.toFixed(5)),
        cutoutComponentCount: z.cutoutComponentCount,
        opaqueRatio: Number(z.opaqueRatio.toFixed(5)),
        edgeOpaqueRatio: Number(z.edgeOpaqueRatio.toFixed(5)),
        lumaStddev: Number(z.lumaStddev.toFixed(2)),
      }
      : null;
  }
  return out;
}

/**
 * SIX-SURFACE PRESENCE, deterministically. A surface is present when its zone
 * carries opaque artwork with real variation -- the same two measures the gate
 * uses to convict a blank or flat zone, at the gate's own thresholds.
 */
function surfacePresence(metrics) {
  const present = {};
  for (const key of SURFACE_ORDER) {
    const m = metrics[key];
    present[key] = Boolean(m
      && m.opaqueRatio >= qc._test.MIN_ZONE_OPAQUE_RATIO
      && m.lumaStddev >= qc._test.MIN_ZONE_LUMA_STDDEV);
  }
  return { ...present, count: SURFACE_ORDER.filter((k) => present[k]).length };
}

/**
 * The die-cut BODY TEMPLATE signature, deterministically -- the class the
 * production gate's binary question cannot name. A template punches openings
 * out of contoured panels, so many surfaces carry BOTH a broken border and one
 * large contiguous dark shape. A flat sheet carries neither; a legitimate dark
 * wrap carries the shape without the broken border.
 */
function templateSignature(metrics) {
  const surfaces = SURFACE_ORDER.filter((k) => {
    const m = metrics[k];
    return m && m.edgeHoleRatio > qc._test.MAX_ZONE_EDGE_HOLE_RATIO
      && m.largestCutoutComponentRatio > qc._test.MAX_ZONE_CUTOUT_COMPONENT_RATIO;
  });
  return { surfaces, count: surfaces.length };
}

async function measureRawMaster(label, bytes, manifest, provider) {
  const normalized = await atlas.normalizeAtlasMaster(bytes, manifest);
  const normalizedBytes = normalized?.bytes || normalized;
  const checks = await qc.deterministicMasterChecks(normalizedBytes, manifest);
  const metrics = zoneMetrics(checks);
  const presence = surfacePresence(metrics);
  const template = templateSignature(metrics);
  // The production gate's own question, on the raw candidate.
  const verdict = await outputClass.classifyAtlasCandidate({ provider, bytes });

  log(`${label}: class=${verdict.disposition}${verdict.confidence != null ? ` (${verdict.confidence})` : ""} `
    + `accepted=${checks.accepted} surfaces=${presence.count}/6 templateSignature=${template.count}`);
  if (verdict.evidence) log(`    inspector: ${String(verdict.evidence).slice(0, 120)}`);
  for (const key of SURFACE_ORDER) {
    const m = metrics[key];
    if (m) log(`    ${key.padEnd(10)} edgeHole ${m.edgeHoleRatio.toFixed(3)}  largestShape ${(m.largestCutoutComponentRatio * 100).toFixed(1)}%  flatBlack ${(m.flatBlackRatio * 100).toFixed(1)}%  components ${m.cutoutComponentCount}`);
  }
  return {
    rawSha256: sha(bytes),
    rawByteSize: bytes.length,
    deliveredWidthPx: normalized?.deliveredWidthPx ?? null,
    deliveredHeightPx: normalized?.deliveredHeightPx ?? null,
    nativelyFourK: normalized?.nativelyFourK ?? null,
    outputClass: {
      disposition: verdict.disposition,
      blocking: verdict.blocking,
      confidence: verdict.confidence,
      evidence: verdict.evidence,
      code: verdict.code,
      model: verdict.model,
    },
    accepted: checks.accepted,
    blockingFailures: checks.blockingFailures,
    cutoutFindings: checks.cutoutFindings,
    structuralTemplateLeak: checks.structuralTemplateLeak,
    passengerMirrorMae: checks.passengerMirrorMae,
    surfacePresence: presence,
    templateSignature: template,
    surfaces: metrics,
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
 * The two requests, and the guards that make the ablation exactly the ablation.
 *
 * Exported so a test can convict the ways this could quietly stop being an
 * ablation: a shared part drifting between arms, the wrong pair removed, the
 * teaching proof moving, or arm B still carrying a guide.
 */
export function buildAblationRequests({
  prompt, teachingReferenceText, targetGuideText, teachingBytes, guideBytes, model,
  expectedTeachingSha256 = TEACHING_PROOF_SHA256,
}) {
  const sharedHead = [
    { text: prompt },
    { text: teachingReferenceText },
    { inlineData: { mimeType: "image/png", data: Buffer.from(teachingBytes).toString("base64") } },
  ];
  const guideTail = [
    { text: targetGuideText },
    { inlineData: { mimeType: "image/png", data: Buffer.from(guideBytes).toString("base64") } },
  ];
  const partsA = [...sharedHead, ...guideTail];
  const partsB = [...sharedHead];

  const serialize = (parts) => JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: GENERATION_CONFIG });
  const describe = (label, parts) => ({
    label,
    model,
    generationConfig: GENERATION_CONFIG,
    promptChars: prompt.length,
    partCount: parts.length,
    modelInputImageCount: parts.filter((p) => p.inlineData?.data).length,
    modelRequestByteSize: Buffer.byteLength(serialize(parts), "utf8"),
    parts: parts.map(partSummary),
  });
  const requests = { A: describe("A-deployed-request", partsA), B: describe("B-guide-absent", partsB) };

  if (requests.A.partCount !== 5) throw new Error(`arm A has ${requests.A.partCount} parts, expected the deployed 5`);
  if (requests.B.partCount !== 3) throw new Error(`arm B has ${requests.B.partCount} parts, expected 3`);
  for (let i = 0; i < 3; i += 1) {
    if (requests.A.parts[i].sha256 !== requests.B.parts[i].sha256) {
      throw new Error(`part ${i} differs between arms — only the guide pair may be removed`);
    }
  }
  if (requests.A.parts[3].kind !== "text" || !requests.A.parts[3].preview.startsWith("CURRENT TARGET GUIDE")) {
    throw new Error("part 3 is not the target-guide instruction — the ablation would remove the wrong part");
  }
  const guideSha = sha(Buffer.from(guideBytes));
  if (requests.A.parts[4].kind !== "image" || requests.A.parts[4].sha256 !== guideSha) {
    throw new Error("part 4 is not the neutral target guide image");
  }
  if (requests.B.parts.some((p) => p.kind === "image" && p.sha256 === guideSha)) {
    throw new Error("arm B still carries the target guide");
  }
  if (requests.A.parts[2].sha256 !== expectedTeachingSha256) throw new Error("the teaching proof moved");
  if (requests.B.parts[2].sha256 !== expectedTeachingSha256) throw new Error("the teaching proof moved in arm B");
  if (requests.A.promptChars !== requests.B.promptChars) throw new Error("the prompt differs between arms");

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

  const { partsA, partsB, requests, serialize } = buildAblationRequests({
    prompt: assembled.prompt,
    teachingReferenceText: call1.TEACHING_REFERENCE_TEXT,
    targetGuideText: call1.TARGET_GUIDE_TEXT,
    teachingBytes,
    guideBytes,
    model: call1.AUTHORING_MODEL,
  });

  // ── PARITY WITH THE DEPLOYED EDGE, PINNED FROM RUN 33577484230 ──────────
  const parity = {
    source: "deployed design-panel-ai-generate, run 33577484230, same fixture",
    modelRequestByteSize: { edge: EXPECTED_EDGE_REQUEST_BYTES, harnessArmA: requests.A.modelRequestByteSize },
    promptChars: { edge: EXPECTED_PROMPT_CHARS, harnessArmA: requests.A.promptChars },
    modelInputImageCount: { edge: EXPECTED_IMAGE_COUNT, harnessArmA: requests.A.modelInputImageCount },
    model: { edge: "gemini-3-pro-image", harnessArmA: call1.AUTHORING_MODEL },
  };
  writeFileSync(join(OUT, "parity.json"), JSON.stringify(parity, null, 2));
  const mismatches = Object.entries(parity).filter(([k, v]) => k !== "source" && v.edge !== v.harnessArmA);
  if (mismatches.length) {
    throw new Error(
      "arm A is not the deployed request — refusing to spend six draws on a request production does not send:\n"
      + mismatches.map(([k, v]) => `  ${k}: edge=${v.edge} harness=${v.harnessArmA}`).join("\n"),
    );
  }
  log(`arm A reproduces the deployed request: ${requests.A.modelRequestByteSize} bytes, ${requests.A.promptChars}-char prompt, ${requests.A.modelInputImageCount} images, ${call1.AUTHORING_MODEL}`);
  log(`arm B removes exactly parts [3] target-guide instruction and [4] neutral target guide — ${requests.B.modelRequestByteSize} bytes, ${requests.B.modelInputImageCount} image`);
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

  // INTERLEAVED. See the header: a service that drifts mid-run must drift
  // across both arms, not into one of them.
  const draws = [];
  for (let n = 1; n <= DRAWS; n += 1) {
    for (const [arm, parts] of [["A", partsA], ["B", partsB]]) {
      const label = `${arm}${n}`;
      const file = `${label}-${arm === "A" ? "deployed-request" : "guide-absent"}.png`;
      log("");
      log(`${label}: calling ${call1.AUTHORING_MODEL} (${parts.length} parts) …`);
      const { bytes, elapsedMs } = await callGemini(label, parts, file);
      const measured = await measureRawMaster(label, bytes, manifest, provider);
      draws.push({ draw: n, arm, label, file, elapsedMs, ...measured });
    }
  }

  const results = {
    contract: "designpro.call1-guide-ablation.v1",
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

  const cell = (d, f) => f(d);
  const table = (title, f) => [
    "", `## ${title}`, "",
    `| draw | arm | ${SURFACE_ORDER.join(" | ")} |`,
    `|---|---|${SURFACE_ORDER.map(() => "---").join("|")}|`,
    ...draws.map((d) => `| ${d.label} | ${d.arm} | ${SURFACE_ORDER.map((k) => f(d.surfaces[k])).join(" | ")} |`),
  ];
  writeFileSync(join(OUT, "COMPARISON.md"), [
    "# Test 2 — neutral target guide ablation, raw pre-repair masters",
    "",
    "A = the exact deployed Call-1 request (5 parts). B = byte-identical with the",
    "target-guide instruction and the neutral target guide image absent (3 parts).",
    `${DRAWS} draws per arm, interleaved.`,
    "",
    "## Primary endpoint — output class",
    "",
    "| draw | arm | production gate | confidence | template signature | surfaces | accepted | latency |",
    "|---|---|---|---|---|---|---|---|",
    ...draws.map((d) => `| ${d.label} | ${d.arm} | ${d.outputClass.disposition} | ${d.outputClass.confidence ?? "-"} `
      + `| ${d.templateSignature.count} surfaces | ${d.surfacePresence.count}/6 | ${d.accepted} | ${(d.elapsedMs / 1000).toFixed(1)}s |`),
    "",
    "The production gate's question is BINARY (flat_atlas | vehicle_depiction) and",
    "cannot name a die-cut body template. Read it beside the template signature —",
    "surfaces carrying both a broken border and one large contiguous dark shape —",
    "and beside the images. The four-class reading is a human judgement.",
    ...table("edgeHoleRatio (blocking threshold 0.35)", (m) => (m ? m.edgeHoleRatio.toFixed(3) : "-")),
    ...table("largest single dark component, share of zone", (m) => (m ? `${(m.largestCutoutComponentRatio * 100).toFixed(1)}%` : "-")),
    ...table("flatBlackRatio", (m) => (m ? `${(m.flatBlackRatio * 100).toFixed(1)}%` : "-")),
    "",
    "## Driver/Passenger cohesion",
    "",
    "| draw | arm | passengerMirrorMae |",
    "|---|---|---|",
    ...draws.map((d) => `| ${d.label} | ${d.arm} | ${d.passengerMirrorMae} |`),
    "",
    "Design quality, label/text contamination and cohesion are the owner's",
    "judgement, on the images. No number here decides them.",
    "",
  ].join("\n"));

  log("");
  log(`${draws.length} draws written; results.json and COMPARISON.md in ${OUT}`);
}

// Guarded so a test can import the ablation guards without running the A/B.
if (process.argv[1] && process.argv[1].endsWith("atlas-guide-ablation-ab.mjs")) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
