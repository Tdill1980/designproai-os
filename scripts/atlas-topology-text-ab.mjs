#!/usr/bin/env node
/**
 * TEST 3 — does the compact normalized [0,1] topology text turn the contoured
 * silhouettes into full rectangular artwork?
 *
 * Test 2 removed the blank target guide and the flank black-hole defect went
 * with it — complete separation, 3 draws to 3. But the panels that came back
 * were still die-cut body silhouettes sitting in a large uniform field; only the
 * field's COLOUR changed, from near-black to rgb(92,92,92), and `holeAt` cleared
 * it because `holeAt` is near-black-or-transparent. Removing the guide fixed the
 * black, not the shape.
 *
 * The topology is the one input that could say "these are rectangles, here":
 * it is computed, validated and recorded as
 * `topologyContract: designpro.atlas-normalized-topology.v1`, and it never
 * becomes a model input in any form.
 *
 *   A  guide absent — Test 2's arm B, now the control. 3 parts.
 *   B  guide absent PLUS the compact normalized [0,1] topology text. 4 parts.
 *
 * PRIMARY ENDPOINT: full-bleed rectangular compliance, measured COLOUR-BLIND by
 * `atlas-fullbleed-metrics.mjs` — does each canonical zone carry artwork across
 * the entire rectangle, with no large uniform non-artwork field and no contoured
 * silhouette. `edgeHoleRatio` and flat-black share are still reported, for
 * continuity with tests 1 and 2, and they are NOT the endpoint.
 *
 * Three draws per arm, interleaved A,B,A,B,A,B, for the reason test 2 states:
 * within-condition variance here spans a whole output class, so a service that
 * drifts mid-run must drift across both arms rather than into one of them.
 *
 * This file deliberately stands alone rather than sharing a runner with test 2.
 * An experiment record should show exactly what was sent, without a reader
 * having to reconstruct it through a parameterised harness.
 *
 * It changes nothing: no deploy, no env write, no prompt change, no topology
 * change, no generation/revision/view/artifact row. The teaching proof and its
 * edge hash pin are untouched, and the creative prompt is the deployed one,
 * byte for byte, in both arms.
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
const EXPECTED_GUIDE_ABSENT_BYTES = 4579105;
const EXPECTED_PROMPT_CHARS = 4587;

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
// The owner's drafted order, and the labels the deployed panel list already uses.
const TOPOLOGY_ROWS = [
  ["PASSENGER", "Passenger Side"],
  ["DRIVER", "Driver Side"],
  ["REAR", "Rear"],
  ["ROOF", "Roof"],
  ["HOOD", "Hood"],
  ["FRONT", "Front"],
];

/**
 * The owner's compact block, filled from the SAME `panels[].normalized` values
 * the edge already computes, validates and records. Nothing is invented here and
 * no vehicle-anatomy prose is added: it is the coordinates and one sentence
 * saying what they are.
 */
export function topologyText(panels) {
  const byLabel = new Map(panels.map((p) => [String(p.label || "").trim().toUpperCase(), p]));
  const pad = Math.max(...TOPOLOGY_ROWS.map(([name]) => name.length)) + 1;
  const rows = TOPOLOGY_ROWS.map(([name, label]) => {
    const panel = byLabel.get(label.toUpperCase());
    const n = panel?.normalized;
    if (!n) throw new Error(`topology text: no normalized rect for ${label}`);
    const f = (v) => Number(v).toFixed(4);
    return `${(`${name}:`).padEnd(pad + 1)}${f(n.x)}, ${f(n.y)}, ${f(n.x + n.width)}, ${f(n.y + n.height)}`;
  });
  return [
    "TARGET A.T.L.A.S. TOPOLOGY — normalized canvas coordinates [0,1]",
    "",
    ...rows,
    "",
    "These coordinates define the flat artwork layout for this generation.",
  ].join("\n");
}

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
 * The two requests, and the guards that keep the topology text the ONLY change.
 * Exported so a test can convict a shared part drifting, an image count moving,
 * or the teaching proof being swapped.
 */
export function buildTopologyRequests({
  prompt, teachingReferenceText, teachingBytes, topology, model,
  expectedTeachingSha256 = TEACHING_PROOF_SHA256,
}) {
  const sharedHead = [
    { text: prompt },
    { text: teachingReferenceText },
    { inlineData: { mimeType: "image/png", data: Buffer.from(teachingBytes).toString("base64") } },
  ];
  const partsA = [...sharedHead];
  const partsB = [...sharedHead, { text: topology }];

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
  const requests = { A: describe("A-guide-absent", partsA), B: describe("B-guide-absent-plus-topology", partsB) };

  if (requests.A.partCount !== 3) throw new Error(`arm A has ${requests.A.partCount} parts, expected 3`);
  if (requests.B.partCount !== 4) throw new Error(`arm B has ${requests.B.partCount} parts, expected 4`);
  for (let i = 0; i < 3; i += 1) {
    if (requests.A.parts[i].sha256 !== requests.B.parts[i].sha256) {
      throw new Error(`part ${i} differs between arms — only the topology text may be added`);
    }
  }
  if (requests.A.modelInputImageCount !== 1 || requests.B.modelInputImageCount !== 1) {
    throw new Error("both arms must carry exactly the teaching proof and no other image");
  }
  if (requests.B.parts[3].kind !== "text" || !requests.B.parts[3].preview.startsWith("TARGET A.T.L.A.S. TOPOLOGY")) {
    throw new Error("part 3 of arm B is not the normalized topology text");
  }
  if (requests.A.parts[2].sha256 !== expectedTeachingSha256 || requests.B.parts[2].sha256 !== expectedTeachingSha256) {
    throw new Error("the teaching proof moved");
  }
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

  const topology = topologyText(edgeBody.panels);
  const { partsA, partsB, requests, serialize } = buildTopologyRequests({
    prompt: assembled.prompt,
    teachingReferenceText: call1.TEACHING_REFERENCE_TEXT,
    teachingBytes,
    topology,
    model: call1.AUTHORING_MODEL,
  });

  const parity = {
    source: "arm B of run 33579220719 (guide absent), same fixture",
    modelRequestByteSize: { measured: EXPECTED_GUIDE_ABSENT_BYTES, harnessArmA: requests.A.modelRequestByteSize },
    promptChars: { measured: EXPECTED_PROMPT_CHARS, harnessArmA: requests.A.promptChars },
  };
  writeFileSync(join(OUT, "parity.json"), JSON.stringify(parity, null, 2));
  const mismatches = Object.entries(parity).filter(([k, v]) => k !== "source" && v.measured !== v.harnessArmA);
  if (mismatches.length) {
    throw new Error(
      "arm A is not test 2's guide-absent request — refusing to spend six draws on a different control:\n"
      + mismatches.map(([k, v]) => `  ${k}: measured=${v.measured} harness=${v.harnessArmA}`).join("\n"),
    );
  }

  log(`arm A reproduces test 2's guide-absent control: ${requests.A.modelRequestByteSize} bytes, ${requests.A.partCount} parts, 1 image`);
  log(`arm B adds ${requests.B.parts[3].chars} chars of normalized topology — ${requests.B.modelRequestByteSize} bytes, ${requests.B.partCount} parts, 1 image`);
  log("");
  for (const line of topology.split("\n")) log(`  | ${line}`);
  log("");
  writeFileSync(join(OUT, "topology-text.txt"), topology);
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({ vehicle: VEHICLE, brief: BRIEF, draws: DRAWS, topology, requests }, null, 2));

  if (captureOnly) {
    log("capture-only: both requests written, no provider call made");
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ captureOnly: true, imageRequestsExecuted: 0, parity, topology, requests }, null, 2));
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
      const file = `${label}-${arm === "A" ? "guide-absent" : "topology-text"}.png`;
      log("");
      log(`${label}: calling ${call1.AUTHORING_MODEL} (${parts.length} parts) …`);
      const { bytes, elapsedMs } = await callGemini(label, parts, file);
      const measured = await measureRawMaster(label, bytes, manifest, provider);
      draws.push({ draw: n, arm, label, file, elapsedMs, ...measured });
    }
  }

  const results = {
    contract: "designpro.call1-topology-text.v1",
    ranAt: new Date().toISOString(),
    imageRequestsExecuted: draws.length,
    outputClassInspections: draws.length,
    drawsPerArm: DRAWS,
    order: draws.map((d) => d.label),
    vehicle: VEHICLE,
    brief: BRIEF,
    model: call1.AUTHORING_MODEL,
    topology,
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
    "# Test 3 — normalized [0,1] topology text, raw pre-repair masters",
    "",
    "A = guide absent (test 2's arm B, the control). B = guide absent + the compact",
    `normalized topology text. ${DRAWS} draws per arm, interleaved.`,
    "",
    "## PRIMARY ENDPOINT — full-bleed rectangular compliance, colour-blind",
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

if (process.argv[1] && process.argv[1].endsWith("atlas-topology-text-ab.mjs")) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
