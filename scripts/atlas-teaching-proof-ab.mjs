#!/usr/bin/env node
/**
 * TEST 1 — does the teaching proof's BLACK FIELD teach the black anatomy?
 *
 * The measured trace pointed at visual conditioning, not prose: no flank-only
 * clause exists in the Call-1 prompt, the normalized topology never reaches
 * Gemini, and the strongest flank-asymmetric signal in the whole request is the
 * labeled teaching proof itself — 29.5% near-black overall, with its two outer
 * separation bands at 69.6% and 67.3%, beside the two flanks that come back
 * with 21% of each zone painted opaque black. Roof, which has no band beside
 * it, comes back clean.
 *
 * So this changes ONE variable and measures the raw pre-repair master:
 *
 *   P  ANCHOR    the DEPLOYED design-panel-ai-generate edge, production proof.
 *                Its returned modelRequestByteSize / modelInputImageCount are
 *                what the harness arms must reproduce, or the run aborts
 *                before spending an image call on an unvalidated request.
 *   A  CONTROL   the harness, production teaching proof.
 *   B  VARIANT   the harness, neutral-field teaching proof. Identical to A in
 *                every byte except the teaching image.
 *
 * P AND A ARE THE SAME CONDITION, DRAWN TWICE, ON PURPOSE. Call 1 sends no
 * temperature, so Gemini samples at its own default and one image per arm
 * cannot separate a real effect from sampling noise. P↔A is the within-
 * condition baseline that says how far these metrics move when NOTHING
 * changed; B is only interesting if it moves further than that.
 *
 * It changes nothing. No deploy, no env write, no prompt change, no topology
 * change, and the production teaching proof and its edge-function hash pin are
 * untouched — the variant exists only inside this run. It creates no
 * generation, revision, view or artifact row; arm P writes the one master
 * object the deployed edge always writes.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildNeutralFieldVariant, SOURCE_SHA256 } from "./atlas-teaching-proof-variant.mjs";

const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
const { createClient } = require_("@supabase/supabase-js");
const atlas = require_("./flat-first-atlas.cjs");
const genie = require_("./genie-universal-resolver.cjs");
const examples = require_("./flat-atlas-topology-examples.cjs");
const qc = require_("./atlas-master-qc.cjs");
const { createProvider } = require_("./generation-provider.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const CANARY_OWNER_ID = "b940320d-cb5a-4b60-b280-32d12ef4d6a6"; // canary-operator@designproai.com
const OUT = args.out || "./ab-evidence";
mkdirSync(OUT, { recursive: true });

const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const truthy = (v) => String(v).toLowerCase() === "true";

// The SAME fixed fixture both arms run. Overridable so the experiment can be
// repeated on another payload, never so this one silently drifts.
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
 * The RAW PRE-REPAIR measurement the owner asked for: normalize exactly as
 * production does (resize + gutter mask — it cannot create in-zone black), run
 * the real deterministic gate, and stop. `fillMasterCutouts` never runs here,
 * so nothing closes a hole before it is counted.
 */
async function measureRawMaster(label, bytes, manifest) {
  const normalized = await atlas.normalizeAtlasMaster(bytes, manifest);
  const normalizedBytes = normalized?.bytes || normalized;
  const checks = await qc.deterministicMasterChecks(normalizedBytes, manifest);
  const metrics = zoneMetrics(checks);
  log(`${label}: accepted=${checks.accepted} blocking=${checks.blockingFailures.length} cutoutFindings=${checks.cutoutFindings.length}`);
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
    normalizedSha256: sha(normalizedBytes),
    accepted: checks.accepted,
    blockingFailures: checks.blockingFailures,
    cutoutFindings: checks.cutoutFindings,
    structuralTemplateLeak: checks.structuralTemplateLeak,
    passengerMirrorMae: checks.passengerMirrorMae,
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

  // ── THE FIXTURE, BUILT BY THE REAL RUNTIME ──────────────────────────────
  log("resolving GENIE preview dimensions …");
  const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, VEHICLE, provider);
  const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
  const manifest = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority);
  const guideBytes = await atlas.renderAtlasAuthoringGuide(manifest);

  const teachingProof = examples.loadBundledAtlasTeachingProof();
  const productionProofBytes = Buffer.from(teachingProof.flattenedTopView.bytes);
  if (sha(productionProofBytes) !== SOURCE_SHA256) {
    throw new Error("the bundled teaching proof is not the pinned owner proof — refusing to run");
  }

  const variant = await buildNeutralFieldVariant(productionProofBytes);
  writeFileSync(join(OUT, "teaching-proof-A-production.png"), productionProofBytes);
  writeFileSync(join(OUT, "teaching-proof-B-neutral-field.png"), variant.bytes);
  log(`variant: ${variant.report.recolouredPixels} background pixels recoloured `
    + `(${(variant.report.recolouredShareOfCanvas * 100).toFixed(1)}% of canvas), `
    + `${variant.report.darkPixelsPreservedInsidePanels} dark pixels preserved inside panels, `
    + `0 pixels changed inside any panel rectangle`);

  const stage = async (bytes, contentType) => {
    const path = `atlas-call1-inputs/${sha(bytes)}.${contentType === "image/jpeg" ? "jpg" : "png"}`;
    const { error } = await supabase.storage.from("wrap-files").upload(path, bytes, { contentType, upsert: true });
    if (error) throw new Error(`staging ${path} failed: ${error.message}`);
    return path;
  };
  const edgeBody = atlas._test.atlasEdgeRequestBody(V3_INPUT, manifest, {
    teachingProofStoragePath: await stage(productionProofBytes, teachingProof.flattenedTopView.contentType),
    teachingProofIdentity: teachingProof.identity,
    guideStoragePath: await stage(guideBytes, "image/png"),
  });

  // ── THE HARNESS REQUEST — the deployed assembly, executed ───────────────
  // `buildAtlasCall1Prompt` is the `const vehicleYear …` → `buildDesignIQPrompt`
  // region of handleAtlasArtboard, extracted verbatim by anchor. The two text
  // parts and the model are extracted from the same file. Nothing here is a
  // re-description of the edge function.
  const assembled = call1.buildAtlasCall1Prompt(edgeBody);
  const buildParts = (teachingBytes) => {
    const parts = [{ text: assembled.prompt }];
    parts.push({ text: call1.TEACHING_REFERENCE_TEXT });
    parts.push({ inlineData: { mimeType: "image/png", data: Buffer.from(teachingBytes).toString("base64") } });
    for (const ref of assembled.references) {
      if (typeof ref === "string" && ref.length) parts.push({ inlineData: { mimeType: "image/png", data: ref } });
    }
    parts.push({ text: call1.TARGET_GUIDE_TEXT });
    parts.push({ inlineData: { mimeType: "image/png", data: Buffer.from(guideBytes).toString("base64") } });
    return parts;
  };
  const generationConfig = {
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig: { aspectRatio: "1:1", imageSize: "4K" },
  };
  const serialize = (parts) => JSON.stringify({ contents: [{ role: "user", parts }], generationConfig });
  const describe = (label, parts) => {
    const body = serialize(parts);
    return {
      label,
      model: call1.AUTHORING_MODEL,
      generationConfig,
      promptChars: assembled.prompt.length,
      partCount: parts.length,
      modelInputImageCount: parts.filter((p) => p.inlineData?.data).length,
      modelRequestByteSize: Buffer.byteLength(body, "utf8"),
      parts: parts.map(partSummary),
    };
  };

  const partsA = buildParts(productionProofBytes);
  const partsB = buildParts(variant.bytes);
  const requests = { A: describe("A-control-production-proof", partsA), B: describe("B-variant-neutral-field", partsB) };

  // The one-variable proof, at the request level: every part identical except
  // the teaching image. Asserted, not asserted-in-prose.
  if (requests.A.partCount !== requests.B.partCount) throw new Error("arm A and arm B have different part counts");
  requests.A.parts.forEach((partA, i) => {
    const partB = requests.B.parts[i];
    if (partA.kind !== partB.kind) throw new Error(`part ${i} changed kind between arms`);
    if (partA.sha256 === partB.sha256) return;
    if (i !== 2) throw new Error(`part ${i} differs between arms — only the teaching image (part 2) may differ`);
  });
  if (requests.A.parts[2].sha256 === requests.B.parts[2].sha256) throw new Error("the teaching image is identical in both arms — nothing is being tested");
  log(`request parity: ${requests.A.partCount} parts, only part 2 (the teaching image) differs`);
  log(`A ${requests.A.modelRequestByteSize} bytes / ${requests.A.promptChars}-char prompt / ${requests.A.modelInputImageCount} images`);
  log(`B ${requests.B.modelRequestByteSize} bytes / ${requests.B.promptChars}-char prompt / ${requests.B.modelInputImageCount} images`);
  if (requests.A.modelRequestByteSize > call1.MODEL_REQUEST_MAX_BYTES || requests.B.modelRequestByteSize > call1.MODEL_REQUEST_MAX_BYTES) {
    throw new Error("a harness request exceeds the edge function's own request ceiling");
  }
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({ vehicle: VEHICLE, brief: BRIEF, edgeBodyShape: { ...edgeBody, panels: edgeBody.panels.length }, requests, variant: variant.report }, null, 2));

  if (captureOnly) {
    log("capture-only: both requests written, no provider call made");
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ captureOnly: true, imageRequestsExecuted: 0, requests }, null, 2));
    return;
  }

  // ── P: THE DEPLOYED EDGE, AS THE PARITY ANCHOR ──────────────────────────
  log("P: calling the deployed design-panel-ai-generate edge (production teaching proof) …");
  const startedP = Date.now();
  const edgeResult = await atlas._test.callAtlasArtboardEdge(edgeBody, { logger: log, ownerId: CANARY_OWNER_ID, supabase });
  log(`P: ${(edgeResult.bytes.length / 1024).toFixed(0)}KB in ${((Date.now() - startedP) / 1000).toFixed(1)}s, ${edgeResult.provenance.promptVersion}`);
  writeFileSync(join(OUT, "P-edge-production-proof.png"), edgeResult.bytes);

  // THE GATE. If the harness request is not the production request, every
  // number after this is about a request production does not send — so it
  // stops here, before spending the two experimental calls.
  const parity = {
    modelRequestByteSize: { edge: edgeResult.provenance.modelRequestByteSize, harness: requests.A.modelRequestByteSize },
    modelInputImageCount: { edge: edgeResult.provenance.modelInputImageCount, harness: requests.A.modelInputImageCount },
    model: { edge: edgeResult.provenance.model, harness: call1.AUTHORING_MODEL },
  };
  writeFileSync(join(OUT, "parity.json"), JSON.stringify(parity, null, 2));
  const mismatches = Object.entries(parity).filter(([, v]) => v.edge !== v.harness);
  if (mismatches.length) {
    throw new Error(
      "harness/edge request parity failed — refusing to spend the experimental calls on a request production does not send:\n"
      + mismatches.map(([k, v]) => `  ${k}: edge=${v.edge} harness=${v.harness}`).join("\n"),
    );
  }
  log(`parity: harness request is byte-size identical to the deployed edge's (${requests.A.modelRequestByteSize} bytes, ${requests.A.modelInputImageCount} images, ${call1.AUTHORING_MODEL})`);

  const key = keyPool[0];
  const callGemini = async (label, parts, file) => {
    log(`${label}: calling ${call1.AUTHORING_MODEL} …`);
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
    writeFileSync(join(OUT, file), bytes);
    log(`${label}: ${(bytes.length / 1024).toFixed(0)}KB in ${((Date.now() - started) / 1000).toFixed(1)}s → ${file}`);
    return bytes;
  };

  const bytesA = await callGemini("A (production proof)", partsA, "A-control-production-proof.png");
  const bytesB = await callGemini("B (neutral-field proof)", partsB, "B-variant-neutral-field.png");

  log("");
  log("RAW PRE-REPAIR MEASUREMENTS (normalize only; no cut-out fill ran)");
  const measurements = {
    P: await measureRawMaster("P edge   ", edgeResult.bytes, manifest),
    A: await measureRawMaster("A control", bytesA, manifest),
    B: await measureRawMaster("B variant", bytesB, manifest),
  };

  const results = {
    contract: "designpro.teaching-proof-field-ab.v1",
    ranAt: new Date().toISOString(),
    imageRequestsExecuted: 3,
    vehicle: VEHICLE,
    brief: BRIEF,
    promptVersion: edgeResult.provenance.promptVersion,
    edgeSourceCommit: edgeResult.provenance.sourceCommit,
    model: call1.AUTHORING_MODEL,
    parity,
    variant: variant.report,
    requests,
    measurements,
  };
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));

  const row = (label, m) => `| ${label} | `
    + SURFACE_ORDER.map((k) => `${m.surfaces[k] ? m.surfaces[k].edgeHoleRatio.toFixed(3) : "-"}`).join(" | ")
    + " |";
  const shapeRow = (label, m) => `| ${label} | `
    + SURFACE_ORDER.map((k) => `${m.surfaces[k] ? (m.surfaces[k].largestCutoutComponentRatio * 100).toFixed(1) + "%" : "-"}`).join(" | ")
    + " |";
  writeFileSync(join(OUT, "COMPARISON.md"), [
    "# Teaching-proof field A/B — raw pre-repair masters",
    "",
    "P and A are the SAME condition drawn twice. Read B against the P↔A gap, not against zero.",
    "",
    "## edgeHoleRatio (blocking threshold 0.35)",
    "",
    `| arm | ${SURFACE_ORDER.join(" | ")} |`,
    `|---|${SURFACE_ORDER.map(() => "---").join("|")}|`,
    row("P edge (production proof)", measurements.P),
    row("A harness (production proof)", measurements.A),
    row("B harness (neutral field)", measurements.B),
    "",
    "## largest single dark component, share of zone",
    "",
    `| arm | ${SURFACE_ORDER.join(" | ")} |`,
    `|---|${SURFACE_ORDER.map(() => "---").join("|")}|`,
    shapeRow("P edge (production proof)", measurements.P),
    shapeRow("A harness (production proof)", measurements.A),
    shapeRow("B harness (neutral field)", measurements.B),
    "",
    "Design quality and Driver/Passenger cohesion are judged by the owner, on the",
    "images. No number in this file is a verdict on either.",
    "",
  ].join("\n"));

  log("");
  log(`wrote ${join(OUT, "results.json")} and COMPARISON.md`);
}

main().catch((error) => {
  console.error(`\nFAILED: ${error?.message || error}`);
  process.exitCode = 1;
});
