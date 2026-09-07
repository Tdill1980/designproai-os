#!/usr/bin/env node
/**
 * TEST 12 — ARRANGEMENT A/B: the vehicle UNROLL against STACKED BANDS.
 *
 * The contract (`atlas-arrangement-contract.mjs`) says what the two arms are
 * and proves they differ only in arrangement. This file spends the draws and
 * measures them:
 *
 *   A  deployed creative assembly + deployed six-surface tail + guide text +
 *      the production UNROLL guide. Test 8's arm B, drawn fresh.
 *   B  the same, with the five arrangement phrases swapped and the guide drawn
 *      as STACKED BANDS. Same six surfaces, same inches, nothing rotated.
 *
 * `draws` independent draws per arm, INTERLEAVED A,B,A,B,… (Test 1 measured
 * within-condition variance spanning a whole output class; a drift in the
 * service must land on both arms). Every raw master is written before it is
 * measured. Each arm is measured against ITS OWN manifest — the production
 * gate's deterministic checks, the colour-blind full-bleed metrics, the
 * production output-class question, and the REAL `cutCallOnePanels`, so the
 * six files each draw yields are the files production would yield.
 *
 * PASS is per zone and colour-blind: no large single dark shape
 * (largestCutoutComponentRatio ≤ the gate's bound), border not a hole
 * (edgeHoleRatio ≤ 0.35), and full-bleed compliant. A draw passes when all
 * six zones pass. Output class is reported beside it, never instead of it.
 *
 * Harness only: no generation, revision, view or artifact row; nothing on the
 * droplet or the project changes.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARRANGEMENT_CONTRACT,
  ARRANGEMENT_TOPOLOGY,
  buildArrangementPrompt,
  buildArrangementRequests,
  buildBandsManifest,
} from "./atlas-arrangement-contract.mjs";
import { fullBleedMetrics } from "./atlas-fullbleed-metrics.mjs";

const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
const { createClient } = require_("@supabase/supabase-js");
const sharp = require_("sharp");
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
mkdirSync(join(OUT, "panels"), { recursive: true });

const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const truthy = (v) => String(v).toLowerCase() === "true";
const pct = (v) => `${(Number(v) * 100).toFixed(1)}%`;
const HASH_RE = /^[0-9a-f]{64}$/;
const DRAWS = Math.max(1, Number(args.draws) || 3);

// The deployed prompt on the default fixture, measured off the edge (run
// 33577484230) and reproduced by every harness since. Arm A must reproduce it
// or no draw is spent on a request production does not send.
const EXPECTED_DEPLOYED_PROMPT_SHA256 = "dcb73e9eae229cd88af6bcdb4a3874e1050b266fa98a55b79fee65d0b7e610b2";
const EXPECTED_DEPLOYED_PROMPT_CHARS = 4587;
const TEACHING_PROOF_SHA256 = "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded";

const DEFAULT_BRIEF = "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with "
  + "sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif "
  + "company name, high contrast and legible at highway distance.";
const BRIEF = args.brief || DEFAULT_BRIEF;
const VEHICLE = {
  type: args["vehicle-type"] || "truck",
  year: args["vehicle-year"] || "2022",
  make: args["vehicle-make"] || "Ford",
  model: args["vehicle-model"] || "F250 Crew Cab",
};
const DEFAULT_FIXTURE = BRIEF === DEFAULT_BRIEF && VEHICLE.type === "truck" && VEHICLE.year === "2022"
  && VEHICLE.make === "Ford" && VEHICLE.model === "F250 Crew Cab";
const V3_INPUT = {
  contractVersion: "designpro.calls-1-7-input.v3",
  pipelineMode: "flat-first-atlas-v1",
  vehicle: VEHICLE,
  brief: BRIEF,
  designName: args["design-name"] || "Arrangement A/B",
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

function templateSignature(metrics) {
  const surfaces = SURFACE_ORDER.filter((k) => {
    const m = metrics[k];
    return m && m.edgeHoleRatio > qc._test.MAX_ZONE_EDGE_HOLE_RATIO
      && m.largestCutoutComponentRatio > qc._test.MAX_ZONE_CUTOUT_COMPONENT_RATIO;
  });
  return { surfaces, count: surfaces.length };
}

/** The per-zone verdict this test is about: no anatomy-sized dark shape, no hole border, full-bleed. */
function zonePass(metric, bleed) {
  return Boolean(metric && bleed
    && metric.largestCutoutComponentRatio <= qc._test.MAX_ZONE_CUTOUT_COMPONENT_RATIO
    && metric.edgeHoleRatio <= qc._test.MAX_ZONE_EDGE_HOLE_RATIO
    && bleed.fullBleedCompliant);
}

async function measureRawMaster(label, rawBytes, manifest, provider) {
  const normalized = await atlas.normalizeAtlasMaster(rawBytes, manifest);
  const masterBytes = normalized.bytes;
  const masterHash = sha(masterBytes);
  const checks = await qc.deterministicMasterChecks(masterBytes, manifest);
  const metrics = zoneMetrics(checks);
  const template = templateSignature(metrics);
  const bleed = await fullBleedMetrics(masterBytes, manifest, { sharp });
  const verdict = await outputClass.classifyAtlasCandidate({ provider, bytes: rawBytes });

  const passes = {};
  for (const key of SURFACE_ORDER) passes[key] = zonePass(metrics[key], bleed.zones[key]);
  const passCount = SURFACE_ORDER.filter((k) => passes[k]).length;

  log(`${label}: class=${verdict.disposition}${verdict.confidence != null ? ` (${verdict.confidence})` : ""} `
    + `zonesPassing=${passCount}/6 templateSignature=${template.count} accepted=${checks.accepted} delivered=${normalized.deliveredWidthPx}×${normalized.deliveredHeightPx}`);
  if (verdict.evidence) log(`    inspector: ${String(verdict.evidence).slice(0, 120)}`);
  for (const key of SURFACE_ORDER) {
    const m = metrics[key];
    const b = bleed.zones[key];
    if (m) log(`    ${key.padEnd(10)} ${passes[key] ? "PASS" : "fail"}  edgeHole ${m.edgeHoleRatio.toFixed(3)}  largestShape ${pct(m.largestCutoutComponentRatio).padStart(6)}  flatBlack ${pct(m.flatBlackRatio).padStart(6)}  nonArt ${pct(b?.nonArtworkRatio ?? 0).padStart(6)}  border ${pct(b?.borderArtworkRatio ?? 0).padStart(6)}`);
  }

  // The REAL extractor, from THIS arm's manifest.
  const panels = [];
  mkdirSync(join(OUT, "panels", label), { recursive: true });
  await atlas.cutCallOnePanels(masterBytes, manifest, masterHash, {
    onPanel: async (panel) => {
      writeFileSync(join(OUT, "panels", label, `panel-${panel.surfaceKey}.png`), panel.bytes);
      panels.push({
        surfaceKey: panel.surfaceKey, contentHash: panel.contentHash, byteSize: panel.byteSize,
        pixelWidth: panel.pixelWidth, pixelHeight: panel.pixelHeight,
        printWidthIn: panel.printWidthIn, printHeightIn: panel.printHeightIn, effectivePpiNative: panel.effectivePpi,
        method: panel.method, deterministic: panel.deterministic,
      });
    },
  });
  if (panels.length !== 6 || new Set(panels.map((p) => p.contentHash)).size !== 6) {
    throw new Error(`${label}: expected six distinct panel files, got ${panels.length}`);
  }

  return {
    rawSha256: sha(rawBytes),
    rawByteSize: rawBytes.length,
    masterSha256: masterHash,
    deliveredWidthPx: normalized.deliveredWidthPx,
    deliveredHeightPx: normalized.deliveredHeightPx,
    nativelyFourK: normalized.nativelyFourK,
    outputClass: {
      disposition: verdict.disposition, blocking: verdict.blocking, confidence: verdict.confidence,
      evidence: verdict.evidence, code: verdict.code, model: verdict.model,
    },
    accepted: checks.accepted,
    blockingFailures: checks.blockingFailures,
    cutoutFindings: checks.cutoutFindings,
    structuralTemplateLeak: checks.structuralTemplateLeak,
    passengerMirrorMae: checks.passengerMirrorMae,
    templateSignature: template,
    surfaces: metrics,
    fullBleed: bleed.zones,
    zonePass: passes,
    zonesPassing: passCount,
    drawPass: passCount === 6,
    panels,
  };
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
  // No provider is constructed in capture-only mode: the run must complete
  // with no credential in its environment at all.
  const provider = captureOnly ? null : createProvider({ env: process.env });

  const call1Path = args.call1 || "./atlas-call1-build/atlas-call1-prompt.mjs";
  const call1 = await import(new URL(call1Path, `file://${process.cwd()}/`).href);

  // ── 1. fixture via production code ────────────────────────────────────────
  log("resolving GENIE preview dimensions …");
  const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, VEHICLE, provider);
  const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
  const legacyManifest = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority, VEHICLE.type);
  const geometryResolution = dimensionRow.geometryResolution || null;
  if (!geometryResolution || !HASH_RE.test(String(geometryResolution.genieManifestHash || ""))) {
    throw new Error("pre-flight: the GENIE manifest identity is absent — cutCallOnePanels would refuse; no draw spent");
  }
  legacyManifest.geometryResolution = geometryResolution;

  // ── 2. the bands manifest, from the same inches ───────────────────────────
  const bandsManifest = buildBandsManifest(legacyManifest, { atlas });
  bandsManifest.geometryResolution = geometryResolution;
  const zoneRecord = (z) => ({
    surfaceKey: z.surfaceKey, placement: z.placement, x: z.x, y: z.y, w: z.w, h: z.h, rotationDegrees: z.rotationDegrees,
    trim: z.trim, trimWidthIn: z.trimWidthIn, trimHeightIn: z.trimHeightIn, printWidthIn: z.printWidthIn, printHeightIn: z.printHeightIn,
    effectivePpiNative: z.effectivePpi,
  });
  writeFileSync(join(OUT, "arrangement.json"), JSON.stringify({
    contract: ARRANGEMENT_CONTRACT,
    genieManifestHash: geometryResolution.genieManifestHash,
    geometryState: geometryResolution.state,
    A: { topology: legacyManifest.topology, installerMap: legacyManifest.installerMap, minimumEffectivePpi: legacyManifest.quality.minimumEffectivePpi, zones: legacyManifest.zones.map(zoneRecord) },
    B: { topology: bandsManifest.topology, arrangement: bandsManifest.arrangement, installerMap: bandsManifest.installerMap, minimumEffectivePpi: bandsManifest.quality.minimumEffectivePpi, zones: bandsManifest.zones.map(zoneRecord) },
  }, null, 2));
  log(`A ${legacyManifest.topology}: min native ${legacyManifest.quality.minimumEffectivePpi} px/in · B ${ARRANGEMENT_TOPOLOGY}: min native ${bandsManifest.quality.minimumEffectivePpi} px/in`);
  for (const z of bandsManifest.zones) {
    log(`    B ${z.surfaceKey.padEnd(10)} ${z.placement.padEnd(12)} (${z.x}, ${z.y}, ${z.w}, ${z.h})  ${z.printWidthIn}×${z.printHeightIn} in  ${z.effectivePpi} px/in`);
  }

  // ── 3. the two guides — the only image either arm receives ────────────────
  const guideA = await atlas.renderAtlasAuthoringGuide(legacyManifest);
  const guideB = await atlas.renderAtlasAuthoringGuide(bandsManifest);
  writeFileSync(join(OUT, "guide-A-unroll.png"), guideA);
  writeFileSync(join(OUT, "guide-B-bands.png"), guideB);

  // ── 4. prompts: deployed assembly reproduced, then the five swaps ─────────
  const teachingProof = examples.loadBundledAtlasTeachingProof();
  const teachingBytes = Buffer.from(teachingProof.flattenedTopView.bytes);
  if (sha(teachingBytes) !== TEACHING_PROOF_SHA256) throw new Error("the bundled teaching proof is not the pinned owner proof");
  const edgeBody = atlas._test.atlasEdgeRequestBody(V3_INPUT, legacyManifest, {
    teachingProofStoragePath: `atlas-call1-inputs/${sha(teachingBytes)}.png`,
    teachingProofIdentity: teachingProof.identity,
    guideStoragePath: `atlas-call1-inputs/${sha(guideA)}.png`,
  });
  const assembled = call1.buildAtlasCall1Prompt(edgeBody);
  if (assembled.references.length) throw new Error("this fixture must carry no customer references");
  const deployedSha = sha(assembled.prompt);
  if (DEFAULT_FIXTURE && (deployedSha !== EXPECTED_DEPLOYED_PROMPT_SHA256 || assembled.prompt.length !== EXPECTED_DEPLOYED_PROMPT_CHARS)) {
    throw new Error(`the harness did not reproduce the deployed prompt (sha ${deployedSha.slice(0, 16)}, ${assembled.prompt.length} chars) — refusing to swap anything on a request production does not send`);
  }
  const arrangement = buildArrangementPrompt(assembled.prompt);
  writeFileSync(join(OUT, "prompt-A-deployed.txt"), assembled.prompt);
  writeFileSync(join(OUT, "prompt-B-bands.txt"), arrangement.prompt);
  writeFileSync(join(OUT, "tail-A-deployed.txt"), arrangement.deployedTail);
  writeFileSync(join(OUT, "tail-B-bands.txt"), arrangement.arrangementTail);
  writeFileSync(join(OUT, "swaps.json"), JSON.stringify(arrangement.swaps, null, 2));

  const { partsA, partsB, requests, serialize } = buildArrangementRequests({
    deployedPrompt: assembled.prompt,
    arrangement,
    targetGuideText: call1.TARGET_GUIDE_TEXT,
    guideBytesA: guideA,
    guideBytesB: guideB,
    model: call1.AUTHORING_MODEL,
    teachingProofSha256: TEACHING_PROOF_SHA256,
  });
  const parity = {
    source: "the deployed design-panel-ai-generate edge, run 33577484230, same fixture; arm A = Test 8 arm B (run 33597621527)",
    deployedPrompt: { sha256: deployedSha, chars: assembled.prompt.length, expectedSha256: EXPECTED_DEPLOYED_PROMPT_SHA256, expectedChars: EXPECTED_DEPLOYED_PROMPT_CHARS, pinned: DEFAULT_FIXTURE },
    creativeAssembly: { chars: arrangement.creative.length, sha256: arrangement.creativeSha256, identicalInBothArms: true },
    tail: { deployedChars: arrangement.deployedTail.length, deployedSha256: arrangement.deployedTailSha256, bandsChars: arrangement.arrangementTail.length, bandsSha256: arrangement.arrangementTailSha256, swaps: arrangement.swaps.length, reverseProof: arrangement.reverseProof },
    guides: { A: { sha256: sha(guideA), bytes: guideA.length }, B: { sha256: sha(guideB), bytes: guideB.length } },
    model: { edge: "gemini-3-pro-image", harness: call1.AUTHORING_MODEL },
  };
  writeFileSync(join(OUT, "parity.json"), JSON.stringify(parity, null, 2));
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({ vehicle: VEHICLE, brief: BRIEF, draws: DRAWS, requests }, null, 2));
  log(`arm A: ${requests.A.partCount} parts, ${requests.A.modelInputImageCount} image, ${requests.A.modelRequestByteSize} bytes, prompt ${requests.A.promptChars} chars ${requests.A.promptSha256.slice(0, 16)}`);
  log(`arm B: ${requests.B.partCount} parts, ${requests.B.modelInputImageCount} image, ${requests.B.modelRequestByteSize} bytes, prompt ${requests.B.promptChars} chars ${requests.B.promptSha256.slice(0, 16)}`);

  if (captureOnly) {
    log("capture-only: both requests written, no provider call made, no credential in the environment");
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ contract: ARRANGEMENT_CONTRACT, captureOnly: true, imageRequestsExecuted: 0, outputClassInspections: 0, parity, requests }, null, 2));
    return;
  }

  // ── 5. the draws, interleaved ─────────────────────────────────────────────
  const key = keyPool[0];
  const callGemini = async (label, parts, file) => {
    const started = Date.now();
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${call1.AUTHORING_MODEL}:generateContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: serialize(parts), signal: AbortSignal.timeout(300_000) },
    );
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${(await response.text().catch(() => "")).slice(0, 400)}`);
    const payload = await response.json();
    const candidateParts = payload?.candidates?.[0]?.content?.parts || [];
    const image = candidateParts.find((p) => p?.inlineData?.data);
    const text = candidateParts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("\n");
    if (!image) throw new Error(`${label} returned no image (${payload?.candidates?.[0]?.finishReason || "unknown"})`);
    const bytes = Buffer.from(image.inlineData.data, "base64");
    const elapsedMs = Date.now() - started;
    writeFileSync(join(OUT, file), bytes);
    if (text) writeFileSync(join(OUT, `${label}-design-text.txt`), text.slice(0, 4000));
    log(`${label}: ${(bytes.length / 1024).toFixed(0)}KB in ${(elapsedMs / 1000).toFixed(1)}s → ${file} (raw, written first)`);
    return { bytes, elapsedMs };
  };

  const arms = [["A", partsA, legacyManifest, "unroll"], ["B", partsB, bandsManifest, "bands"]];
  const draws = [];
  for (let n = 1; n <= DRAWS; n += 1) {
    for (const [arm, parts, manifest, name] of arms) {
      const label = `${arm}${n}`;
      log("");
      log(`${label}: calling ${call1.AUTHORING_MODEL} (${parts.length} parts, ${name}) …`);
      const { bytes, elapsedMs } = await callGemini(label, parts, `${label}-${name}-raw.png`);
      const measured = await measureRawMaster(label, bytes, manifest, provider);
      draws.push({ draw: n, arm, label, arrangement: name, elapsedMs, ...measured });
    }
  }

  // ── 6. results ────────────────────────────────────────────────────────────
  const byArm = (arm) => draws.filter((d) => d.arm === arm);
  const summary = {};
  for (const arm of ["A", "B"]) {
    const set = byArm(arm);
    summary[arm] = {
      draws: set.length,
      drawsPassing: set.filter((d) => d.drawPass).length,
      zonesPassing: set.reduce((t, d) => t + d.zonesPassing, 0),
      zonesTotal: set.length * 6,
      templateSignatureSurfaces: set.reduce((t, d) => t + d.templateSignature.count, 0),
      outputClass: Object.fromEntries(set.map((d) => [d.label, d.outputClass.disposition])),
      worstLargestShape: Math.max(...set.flatMap((d) => SURFACE_ORDER.map((k) => d.surfaces[k]?.largestCutoutComponentRatio ?? 0))),
      worstEdgeHole: Math.max(...set.flatMap((d) => SURFACE_ORDER.map((k) => d.surfaces[k]?.edgeHoleRatio ?? 0))),
    };
  }
  const results = {
    contract: ARRANGEMENT_CONTRACT,
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
    summary,
    draws,
  };
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));

  const table = (title, f) => [
    "", `## ${title}`, "",
    `| draw | arm | ${SURFACE_ORDER.join(" | ")} |`,
    `|---|---|${SURFACE_ORDER.map(() => "---").join("|")}|`,
    ...draws.map((d) => `| ${d.label} | ${d.arm} | ${SURFACE_ORDER.map((k) => f(d, k)).join(" | ")} |`),
  ];
  writeFileSync(join(OUT, "COMPARISON.md"), [
    "# Test 12 — arrangement: vehicle UNROLL (A) vs STACKED BANDS (B), raw pre-repair masters",
    "",
    "A = deployed creative assembly + deployed six-surface tail + guide text + the production unroll guide (3 parts, 1 image; Test 8's arm B).",
    "B = the same with the five arrangement phrases swapped and the guide drawn as stacked bands: driver across the top, passenger beneath it, rear/roof/hood/front in a row along the bottom. Same six surfaces, same inches, nothing rotated.",
    `${DRAWS} draws per arm, interleaved. Each arm measured and cut against its own manifest.`,
    "",
    "## Summary",
    "",
    "| arm | draws passing (6/6 zones) | zones passing | template-signature surfaces | worst largest shape | worst edgeHole |",
    "|---|---|---|---|---|---|",
    ...["A", "B"].map((arm) => `| ${arm} | ${summary[arm].drawsPassing}/${summary[arm].draws} | ${summary[arm].zonesPassing}/${summary[arm].zonesTotal} | ${summary[arm].templateSignatureSurfaces} | ${pct(summary[arm].worstLargestShape)} | ${summary[arm].worstEdgeHole.toFixed(3)} |`),
    "",
    "A zone PASSES when its largest single dark shape is within the gate's cut-out bound, its border is not a hole (edgeHole ≤ 0.35) and it is full-bleed compliant colour-blind. A draw passes at 6/6.",
    "",
    "## Per draw",
    "",
    "| draw | arm | zones passing | production gate class | confidence | template signature | accepted | latency |",
    "|---|---|---|---|---|---|---|---|",
    ...draws.map((d) => `| ${d.label} | ${d.arm} | ${d.zonesPassing}/6 | ${d.outputClass.disposition} | ${d.outputClass.confidence ?? "-"} | ${d.templateSignature.count} | ${d.accepted} | ${(d.elapsedMs / 1000).toFixed(1)}s |`),
    ...table("zone verdict", (d, k) => (d.zonePass[k] ? "PASS" : "fail")),
    ...table("largest single dark component, share of zone", (d, k) => (d.surfaces[k] ? pct(d.surfaces[k].largestCutoutComponentRatio) : "-")),
    ...table("edgeHoleRatio (blocking threshold 0.35)", (d, k) => (d.surfaces[k] ? d.surfaces[k].edgeHoleRatio.toFixed(3) : "-")),
    ...table("flatBlackRatio", (d, k) => (d.surfaces[k] ? pct(d.surfaces[k].flatBlackRatio) : "-")),
    ...table("non-artwork share (colour-blind full-bleed)", (d, k) => (d.fullBleed[k] ? pct(d.fullBleed[k].nonArtworkRatio) : "-")),
    "",
    "## Driver/Passenger cohesion",
    "",
    "| draw | arm | passengerMirrorMae |",
    "|---|---|---|",
    ...draws.map((d) => `| ${d.label} | ${d.arm} | ${d.passengerMirrorMae} |`),
    "",
    "Design quality, label/text contamination and cohesion are the owner's judgement, on the images and the six cut files under panels/<draw>/. No number here decides them.",
    "",
  ].join("\n"));

  log("");
  log(`${draws.length} draws written; results.json, COMPARISON.md, guides and panels in ${OUT}`);
  log(`A: ${summary.A.drawsPassing}/${summary.A.draws} draws pass, ${summary.A.zonesPassing}/${summary.A.zonesTotal} zones · B: ${summary.B.drawsPassing}/${summary.B.draws} draws pass, ${summary.B.zonesPassing}/${summary.B.zonesTotal} zones`);
}

if (process.argv[1] && process.argv[1].endsWith("atlas-arrangement-ab.mjs")) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
