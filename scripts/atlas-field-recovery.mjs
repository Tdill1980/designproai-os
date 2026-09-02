#!/usr/bin/env node
/**
 * FIELD RECOVERY HARNESS — Phase 1, ONE DRAW. Harness only. Not production.
 *
 * Owner ruling (2026-09-02): APPROVE PHASE 1 HARNESS ONLY — ONE DRAW.
 *
 *   ONE DesignPanelAI creative call → ONE canonical A.T.L.A.S. creative master
 *   → GENIE/OS deterministic Driver, Passenger, Hood, Roof, Front and Rear
 *   territories → six hash-bound canonical files.
 *
 * Gemini authors one uninterrupted full-bleed composition. It receives the
 * DesignPanelAI creative assembly (byte-identical except one presentation
 * sentence) plus the field contract -- and NO images: no six-region guide, no
 * teaching sheet, no labels. The OS owns the six territories
 * (`scripts/atlas-field-territories.mjs`, `field-bands-v1`) and the REAL
 * production extractor `cutCallOnePanels` cuts the six canonical files.
 *
 * What this run proves or refutes, in the owner's order:
 *   1 CREATIVE PARITY (owner's eye, on the contact sheet)
 *   2 CANONICAL SERIALIZATION (master + six files + coordinates + trim rects +
 *     hashes + GENIE manifest hash + continuity)
 *   3 PANE/FILE INTEGRITY (colour-blind full-bleed on bleed AND trim rects)
 *   4 DESIGN INTENT (owner's eye)
 *   5 PRODUCTION RESOLUTION -- native effective PPI recorded ONLY. No 150 /
 *     300 / 1500 claim of any kind.
 *   6 NO NEW BLOCKING GATE -- every metric here is telemetry.
 *
 * Exactly ONE image call. `--draws` above 1 is refused. Capture-only first.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fullBleedMetrics } from "./atlas-fullbleed-metrics.mjs";
import { buildFieldTerritories, FIELD_TOPOLOGY } from "./atlas-field-territories.mjs";
import { buildFieldPrompt, buildFieldRequest, FIELD_TAIL_MAX_CHARS, GENERATION_CONFIG } from "./atlas-field-contract.mjs";
import { measureContinuity } from "./atlas-field-continuity.mjs";

const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
const { createClient } = require_("@supabase/supabase-js");
const sharp = require_("sharp");
const atlas = require_("./flat-first-atlas.cjs");
const genie = require_("./genie-universal-resolver.cjs");
const qc = require_("./atlas-master-qc.cjs");
const outputClass = require_("./atlas-output-class.cjs");
const { createProvider } = require_("./generation-provider.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const OUT = args.out || "./ab-evidence";
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "panels"), { recursive: true });

const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const truthy = (v) => String(v).toLowerCase() === "true";
const HASH_RE = /^[a-f0-9]{64}$/;

// OWNER: exactly one draw. A larger number is refused, not clamped.
const DRAWS = Number(args.draws ?? 1);
if (DRAWS !== 1) throw new Error(`field recovery: the owner approved exactly ONE draw; --draws ${args.draws} refused`);

// The deployed request for this exact fixture, measured on runs 33595250518 /
// 33597621527. The harness must reproduce it BEFORE it swaps anything.
const EXPECTED_DEPLOYED_PROMPT_SHA256 = "dcb73e9eae229cd88af6bcdb4a3874e1050b266fa98a55b79fee65d0b7e610b2";
const EXPECTED_DEPLOYED_PROMPT_CHARS = 4587;

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
  designName: args["design-name"] || "Teaching-proof field A/B",
  mode: "commercial",
  industry: args.industry || "HVAC and climate control",
  colors: (args.colors || "deep blue,sunrise orange").split(",").map((c) => c.trim()),
  style: args.style || "modern commercial",
};
const SURFACE_ORDER = ["driver", "passenger", "hood", "roof", "front", "rear"];

async function legacyZoneMetrics(checks) {
  const byKey = new Map((checks.zones || []).map((z) => [z.surfaceKey, z]));
  const out = {};
  for (const key of SURFACE_ORDER) {
    const z = byKey.get(key);
    out[key] = z ? {
      edgeHoleRatio: Number(z.edgeHoleRatio.toFixed(5)),
      largestCutoutComponentRatio: Number(z.largestCutoutComponentRatio.toFixed(5)),
      flatBlackRatio: Number(z.flatBlackRatio.toFixed(5)),
      opaqueRatio: Number(z.opaqueRatio.toFixed(5)),
      lumaStddev: Number(z.lumaStddev.toFixed(2)),
    } : null;
  }
  return out;
}

async function contactSheet(unmaskedBytes, fieldManifest, panels, outPath) {
  const S = 2048;
  const f = S / fieldManifest.canvas.widthPx;
  const rects = fieldManifest.zones.map((z) => `
    <rect x="${z.x * f}" y="${z.y * f}" width="${z.w * f}" height="${z.h * f}" fill="none" stroke="#00e5ff" stroke-width="3"/>
    <rect x="${z.trim.x * f}" y="${z.trim.y * f}" width="${z.trim.w * f}" height="${z.trim.h * f}" fill="none" stroke="#ffd400" stroke-width="2" stroke-dasharray="10 8"/>
    <text x="${z.x * f + 12}" y="${z.y * f + 34}" font-family="sans-serif" font-size="30" font-weight="700" fill="#00e5ff" stroke="#000" stroke-width="1">${z.surfaceKey.toUpperCase()} · ${z.printWidthIn}×${z.printHeightIn} in · ${z.effectivePpi} px/in native</text>`).join("");
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${rects}</svg>`);
  const field = await sharp(unmaskedBytes, { limitInputPixels: false }).resize(S, S).composite([{ input: overlay }]).png().toBuffer();

  // Panels: two flank rows at full width, then the four centre panels in one row.
  const byKey = new Map(panels.map((p) => [p.surfaceKey, p]));
  const flankH = Math.round(S * byKey.get("driver").pixelHeight / byKey.get("driver").pixelWidth);
  const passH = Math.round(S * byKey.get("passenger").pixelHeight / byKey.get("passenger").pixelWidth);
  const centre = ["roof", "hood", "front", "rear"].map((k) => byKey.get(k));
  const rowH = 300;
  const centreWidths = centre.map((p) => Math.round(rowH * p.pixelWidth / p.pixelHeight));
  const gap = 12;
  const captionH = 40;
  const total = S + captionH * 4 + flankH + passH + rowH + gap * 5;
  const composites = [{ input: field, left: 0, top: 0 }];
  const captions = [];
  let y = S + gap;
  const cap = (text, top) => captions.push(`<text x="12" y="${top + 28}" font-family="monospace" font-size="22" fill="#ffffff">${text}</text>`);
  cap(`FIELD ${fieldManifest.topology} · cyan = territory (bleed box) · yellow dashed = trim`, y);
  y += captionH;
  for (const [p, h] of [[byKey.get("driver"), flankH], [byKey.get("passenger"), passH]]) {
    cap(`${p.surfaceKey.toUpperCase()} ${p.pixelWidth}×${p.pixelHeight}px · ${p.printWidthIn}×${p.printHeightIn}in print · ${p.contentHash.slice(0, 16)}`, y);
    y += captionH;
    composites.push({ input: await sharp(p.bytes).resize(S, h).png().toBuffer(), left: 0, top: y });
    y += h + gap;
  }
  cap(centre.map((p) => `${p.surfaceKey.toUpperCase()} ${p.contentHash.slice(0, 12)}`).join("   ·   "), y);
  y += captionH;
  let x = 0;
  for (let i = 0; i < centre.length; i += 1) {
    const w = Math.min(centreWidths[i], S - x);
    if (w < 8) break;
    composites.push({ input: await sharp(centre[i].bytes).resize(w, rowH).png().toBuffer(), left: x, top: y });
    x += w + gap;
  }
  const captionSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${total}">${captions.join("")}</svg>`);
  await sharp({ create: { width: S, height: total, channels: 3, background: "#101010" } })
    .composite([...composites, { input: captionSvg, left: 0, top: 0 }])
    .png({ compressionLevel: 6 })
    .toFile(outPath);
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

  // ── 1. fixture via production code, and the GENIE identity pre-flight ──────
  log("resolving GENIE preview dimensions …");
  const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, VEHICLE, provider);
  const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
  const legacyManifest = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority, VEHICLE.type);
  const geometryResolution = dimensionRow.geometryResolution || null;
  if (!geometryResolution || !HASH_RE.test(String(geometryResolution.genieManifestHash || ""))) {
    throw new Error("pre-flight: the GENIE manifest identity is absent — cutCallOnePanels would refuse; no draw spent");
  }
  legacyManifest.geometryResolution = geometryResolution;

  // ── 2. territories ────────────────────────────────────────────────────────
  const fieldManifest = buildFieldTerritories(legacyManifest);
  fieldManifest.geometryResolution = geometryResolution;
  for (const z of fieldManifest.zones) {
    const l = legacyManifest.zones.find((q) => q.surfaceKey === z.surfaceKey);
    if (z.trimWidthIn !== l.trimWidthIn || z.trimHeightIn !== l.trimHeightIn || z.printWidthIn !== l.printWidthIn || z.printHeightIn !== l.printHeightIn) {
      throw new Error(`territory inches drifted from the legacy zone: ${z.surfaceKey}`);
    }
  }
  writeFileSync(join(OUT, "territories.json"), JSON.stringify({
    topology: fieldManifest.topology,
    canvas: fieldManifest.canvas,
    genieManifestHash: geometryResolution.genieManifestHash,
    geometryState: geometryResolution.state,
    fieldLayout: fieldManifest.fieldLayout,
    zones: fieldManifest.zones.map((z) => ({
      surfaceKey: z.surfaceKey, placement: z.placement, x: z.x, y: z.y, w: z.w, h: z.h,
      rotationDegrees: z.rotationDegrees, trim: z.trim, trimWidthIn: z.trimWidthIn, trimHeightIn: z.trimHeightIn,
      printWidthIn: z.printWidthIn, printHeightIn: z.printHeightIn, effectivePpiNative: z.effectivePpi, noseEdge: z.noseEdge,
    })),
    legacyZones: legacyManifest.zones.map((z) => ({ surfaceKey: z.surfaceKey, x: z.x, y: z.y, w: z.w, h: z.h, rotationDegrees: z.rotationDegrees, effectivePpiNative: z.effectivePpi })),
  }, null, 2));
  log(`territories: ${fieldManifest.topology} — extracted ${(fieldManifest.fieldLayout.extractedRatio * 100).toFixed(1)}% of canvas, min native ${fieldManifest.quality.minimumEffectivePpi} px/in (legacy ${legacyManifest.quality.minimumEffectivePpi})`);
  for (const z of fieldManifest.zones) {
    log(`    ${z.surfaceKey.padEnd(10)} (${z.x}, ${z.y}, ${z.w}, ${z.h})  ${z.printWidthIn}×${z.printHeightIn} in  ${z.effectivePpi} px/in  trim (${z.trim.x}, ${z.trim.y}, ${z.trim.w}, ${z.trim.h})`);
  }

  // ── 3. prompt: deployed assembly → field prompt, byte identity proven ─────
  // The LEGACY manifest feeds the edge-body builder: `atlasFlatMasterContract`
  // validates left/right/centre placements and would throw on field ones. The
  // creative assembly does not depend on geometry.
  const edgeBody = atlas._test.atlasEdgeRequestBody(V3_INPUT, legacyManifest, {});
  const assembled = call1.buildAtlasCall1Prompt(edgeBody);
  if (assembled.references.length) throw new Error("this fixture must carry no customer references");
  const deployedSha = sha(assembled.prompt);
  if (DEFAULT_FIXTURE && (deployedSha !== EXPECTED_DEPLOYED_PROMPT_SHA256 || assembled.prompt.length !== EXPECTED_DEPLOYED_PROMPT_CHARS)) {
    throw new Error(`the harness did not reproduce the deployed prompt (sha ${deployedSha.slice(0, 16)}, ${assembled.prompt.length} chars) — refusing to swap anything on a request production does not send`);
  }
  const field = buildFieldPrompt(assembled.prompt, { noseEdge: fieldManifest.installerMap.noseEdge });
  const { parts, request, serialize } = buildFieldRequest({ prompt: field.prompt, referenceParts: [], model: call1.AUTHORING_MODEL });

  const parity = {
    source: "the deployed design-panel-ai-generate edge, runs 33595250518 / 33597621527, same fixture",
    deployedPrompt: { sha256: deployedSha, chars: assembled.prompt.length, expectedSha256: EXPECTED_DEPLOYED_PROMPT_SHA256, expectedChars: EXPECTED_DEPLOYED_PROMPT_CHARS, pinned: DEFAULT_FIXTURE },
    creativeAssembly: {
      deployedChars: field.creative.length,
      deployedSha256: sha(field.creative),
      fieldChars: field.creativeField.length,
      fieldSha256: sha(field.creativeField),
      byteIdenticalExceptSceneClause: true,
      sceneSwap: field.sceneSwap,
    },
    tail: { deployedChars: field.deployedTail.length, deployedSha256: sha(field.deployedTail), fieldChars: field.fieldTail.length, fieldSha256: sha(field.fieldTail), ceiling: FIELD_TAIL_MAX_CHARS },
    request: { partCount: request.partCount, modelInputImageCount: request.modelInputImageCount, structuralImages: 0, modelRequestByteSize: request.modelRequestByteSize, model: request.model, generationConfig: GENERATION_CONFIG },
  };
  writeFileSync(join(OUT, "parity.json"), JSON.stringify(parity, null, 2));
  writeFileSync(join(OUT, "prompt-deployed.txt"), assembled.prompt);
  writeFileSync(join(OUT, "prompt-field.txt"), field.prompt);
  writeFileSync(join(OUT, "creative-deployed.txt"), field.creative);
  writeFileSync(join(OUT, "tail-deployed.txt"), field.deployedTail);
  writeFileSync(join(OUT, "tail-field.txt"), field.fieldTail);
  writeFileSync(join(OUT, "scene-swap.json"), JSON.stringify(field.sceneSwap, null, 2));
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({ vehicle: VEHICLE, brief: BRIEF, draws: DRAWS, request }, null, 2));
  log(`deployed prompt reproduced: sha ${deployedSha.slice(0, 16)}, ${assembled.prompt.length} chars`);
  log(`creative assembly ${field.creative.length} chars → ${field.creativeField.length} chars, one scene clause swapped, reversible`);
  log(`field tail ${field.fieldTail.length} chars (ceiling ${FIELD_TAIL_MAX_CHARS}); request ${request.partCount} part(s), ${request.modelInputImageCount} image(s), ${request.modelRequestByteSize} bytes`);

  if (captureOnly) {
    log("capture-only: request written, no provider call made");
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ captureOnly: true, imageRequestsExecuted: 0, outputClassInspections: 0, parity, request, territories: fieldManifest.fieldLayout }, null, 2));
    return;
  }

  // ── 5. exactly one Gemini call ────────────────────────────────────────────
  const key = keyPool[0];
  log("");
  log(`DRAW 1: calling ${call1.AUTHORING_MODEL} (${parts.length} part, 0 structural images) …`);
  const started = Date.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${call1.AUTHORING_MODEL}:generateContent?key=${key}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: serialize(parts), signal: AbortSignal.timeout(300_000) },
  );
  if (!response.ok) throw new Error(`draw 1 HTTP ${response.status}: ${(await response.text().catch(() => "")).slice(0, 400)}`);
  const payload = await response.json();
  const candidateParts = payload?.candidates?.[0]?.content?.parts || [];
  const image = candidateParts.find((p) => p?.inlineData?.data);
  const textOut = candidateParts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("\n");
  if (!image) throw new Error(`draw 1 returned no image (${payload?.candidates?.[0]?.finishReason || "unknown"})`);
  const rawBytes = Buffer.from(image.inlineData.data, "base64");
  const elapsedMs = Date.now() - started;
  writeFileSync(join(OUT, "draw1-field-raw.png"), rawBytes);
  writeFileSync(join(OUT, "draw1-design-text.txt"), textOut.slice(0, 4000));
  log(`draw 1: ${(rawBytes.length / 1024).toFixed(0)}KB in ${(elapsedMs / 1000).toFixed(1)}s`);

  // ── 6. normalize (square check, mask) + unmasked field ────────────────────
  const normalized = await atlas.normalizeAtlasMaster(rawBytes, fieldManifest);
  const masterBytes = normalized.bytes;
  const masterHash = sha(masterBytes);
  writeFileSync(join(OUT, "draw1-field-master-masked.png"), masterBytes);
  const unmasked = await sharp(rawBytes, { limitInputPixels: false }).rotate()
    .resize(fieldManifest.canvas.widthPx, fieldManifest.canvas.heightPx, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha().png({ compressionLevel: 6 }).toBuffer();
  writeFileSync(join(OUT, "draw1-field-unmasked-4096.png"), unmasked);
  log(`normalized: delivered ${normalized.deliveredWidthPx}×${normalized.deliveredHeightPx}, nativelyFourK=${normalized.nativelyFourK}, master sha ${masterHash.slice(0, 16)}`);

  // ── 7. colour-blind full-bleed: bleed rects, trim rects, whole field ──────
  const bleedMetrics = await fullBleedMetrics(masterBytes, fieldManifest);
  const trimMetrics = await fullBleedMetrics(masterBytes, { zones: fieldManifest.zones.map((z) => ({ surfaceKey: z.surfaceKey, rect: z.trim })) });
  const wholeField = await fullBleedMetrics(unmasked, { zones: [{ surfaceKey: "field", x: 0, y: 0, w: fieldManifest.canvas.widthPx, h: fieldManifest.canvas.heightPx }] });
  log(`full-bleed (telemetry): bleed rects ${bleedMetrics.fullBleedCompliantCount}/6 · trim rects ${trimMetrics.fullBleedCompliantCount}/6 · whole field ${wholeField.fullBleedCompliantCount}/1 (nonArtwork ${(wholeField.zones.field.nonArtworkRatio * 100).toFixed(1)}%, border ${(wholeField.zones.field.borderArtworkRatio * 100).toFixed(1)}%)`);
  for (const key of SURFACE_ORDER) {
    const b = bleedMetrics.zones[key]; const t = trimMetrics.zones[key];
    log(`    ${key.padEnd(10)} bleed ${b.fullBleedCompliant ? "OK " : "NO "} nonArt ${(b.nonArtworkRatio * 100).toFixed(1).padStart(5)}% border ${(b.borderArtworkRatio * 100).toFixed(1).padStart(5)}%   trim ${t.fullBleedCompliant ? "OK " : "NO "} nonArt ${(t.nonArtworkRatio * 100).toFixed(1).padStart(5)}% border ${(t.borderArtworkRatio * 100).toFixed(1).padStart(5)}%`);
  }

  // ── 8. for the record: legacy checks, output class ────────────────────────
  const checks = await qc.deterministicMasterChecks(masterBytes, fieldManifest);
  const legacy = await legacyZoneMetrics(checks);
  const verdict = await outputClass.classifyAtlasCandidate({ provider, bytes: rawBytes });
  log(`legacy gate (record): accepted=${checks.accepted} blocking=${checks.blockingFailures.length} passengerMirrorMae=${checks.passengerMirrorMae}`);
  log(`output class (record, last): ${verdict.disposition}${verdict.evidence ? ` — ${String(verdict.evidence).slice(0, 110)}` : ""}`);

  // ── 9. continuity across territory boundaries ─────────────────────────────
  const raw = await sharp(unmasked, { limitInputPixels: false }).raw().toBuffer({ resolveWithObject: true });
  const continuity = measureContinuity({ data: raw.data, width: raw.info.width, height: raw.info.height, channels: raw.info.channels }, fieldManifest.fieldLayout.boundaries);
  log(`continuity: anyDivider=${continuity.anyDividerDetected} deepest ${continuity.deepestDividerPx}px, worst boundaryMae ${continuity.worstBoundaryMae}`);
  for (const b of continuity.boundaries) {
    if (b.measurable) log(`    ${b.between.join("→").padEnd(20)} ${b.axis}=${b.at}  mae ${b.boundaryMae}  divider ${b.dividerDetected ? `YES depth ${b.dividerDepthPx}px` : `no (${(b.dividerCoverage * 100).toFixed(0)}%)`}`);
  }

  // ── 10. cut the six canonical files with the REAL extractor ───────────────
  const panels = [];
  await atlas.cutCallOnePanels(masterBytes, fieldManifest, masterHash, {
    onPanel: async (panel) => {
      writeFileSync(join(OUT, "panels", `panel-${panel.surfaceKey}.png`), panel.bytes);
      panels.push(panel);
      log(`    cut ${panel.surfaceKey.padEnd(10)} ${panel.pixelWidth}×${panel.pixelHeight}px  ${panel.printWidthIn}×${panel.printHeightIn}in print  ${panel.effectivePpi} px/in native  ${panel.contentHash.slice(0, 16)}`);
    },
  });
  const hashes = new Set(panels.map((p) => p.contentHash));
  if (panels.length !== 6 || hashes.size !== 6) throw new Error(`expected six distinct canonical files, got ${panels.length} / ${hashes.size} distinct`);
  const panelRecords = panels.map((p) => ({
    surfaceKey: p.surfaceKey, contentHash: p.contentHash, byteSize: p.byteSize, pixelWidth: p.pixelWidth, pixelHeight: p.pixelHeight,
    trimWidthIn: p.trimWidthIn, trimHeightIn: p.trimHeightIn, printWidthIn: p.printWidthIn, printHeightIn: p.printHeightIn,
    bleedInches: p.bleedInches, effectivePpiNative: p.effectivePpi, sourceMasterHash: p.sourceMasterHash, surfaceSourceHash: p.surfaceSourceHash,
    method: p.method, deterministic: p.deterministic, genieManifestHash: p.genieManifestHash, geometryAuthorityState: p.geometryAuthorityState,
  }));
  writeFileSync(join(OUT, "panels.json"), JSON.stringify(panelRecords, null, 2));

  // ── 11. contact sheet + stop-condition receipt + report ───────────────────
  await contactSheet(unmasked, fieldManifest, panels, join(OUT, "contact-sheet.png"));

  const wf = wholeField.zones.field;
  const mechanicallyWrong = [];
  if (wf.borderArtworkRatio < 0.98 || wf.edgeReachableFieldRatio > 0.02) mechanicallyWrong.push(`the model drew an object on a surround: whole-field border artwork ${(wf.borderArtworkRatio * 100).toFixed(1)}%, edge-reachable field ${(wf.edgeReachableFieldRatio * 100).toFixed(1)}%`);
  for (const b of continuity.boundaries) {
    if (b.measurable && b.dividerDetected) {
      const inset = Math.min(...fieldManifest.zones.filter((z) => b.between.includes(z.surfaceKey)).map((z) => (b.axis === "y" ? z.trim.y - z.y : z.trim.x - z.x)));
      if (b.dividerDepthPx > inset) mechanicallyWrong.push(`a divider deeper than the bleed inset (${b.dividerDepthPx}px > ${inset}px) at ${b.between.join("/")} — territories were drawn as containers`);
    }
  }
  if (verdict.disposition === "vehicle_depiction") mechanicallyWrong.push("explicit vehicle_depiction verdict");
  const conceptProvenMechanically = mechanicallyWrong.length === 0
    && wholeField.fullBleedCompliantCount === 1
    && bleedMetrics.fullBleedCompliantCount === 6
    && trimMetrics.fullBleedCompliantCount === 6
    && !continuity.anyDividerDetected;

  const results = {
    contract: "designpro.atlas-field-recovery.v1",
    ranAt: new Date().toISOString(),
    imageRequestsExecuted: 1,
    outputClassInspections: 1,
    topology: FIELD_TOPOLOGY,
    vehicle: VEHICLE,
    brief: BRIEF,
    model: call1.AUTHORING_MODEL,
    parity,
    request,
    draw: {
      elapsedMs, rawSha256: sha(rawBytes), rawByteSize: rawBytes.length,
      deliveredWidthPx: normalized.deliveredWidthPx, deliveredHeightPx: normalized.deliveredHeightPx, nativelyFourK: normalized.nativelyFourK,
      masterSha256: masterHash, designText: textOut.slice(0, 2000),
    },
    territories: fieldManifest.fieldLayout,
    genieManifestHash: geometryResolution.genieManifestHash,
    fullBleedTelemetry: { bleedRects: bleedMetrics, trimRects: trimMetrics, wholeField },
    legacyChecksForRecord: { accepted: checks.accepted, blockingFailures: checks.blockingFailures, passengerMirrorMae: checks.passengerMirrorMae, structuralTemplateLeak: checks.structuralTemplateLeak, zones: legacy },
    outputClassForRecord: { disposition: verdict.disposition, blocking: verdict.blocking, confidence: verdict.confidence, evidence: verdict.evidence, model: verdict.model },
    continuity,
    panels: panelRecords,
    stopConditions: { mechanicallyWrong, conceptProvenMechanically, ownerJudgementRequired: ["creative parity", "design intent", "company name complete inside each flank band", "lettering left-to-right on both flanks"] },
    resolutionStatement: "Native effective PPI per surface is recorded above. No 150 PPI, 300 PPI or 1500 DPI claim is made by this harness; production-resolution transformation is a separate layer and a separate owner decision.",
  };
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));

  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  writeFileSync(join(OUT, "REPORT.md"), [
    "# Field recovery — Draw 1 (`field-bands-v1`)",
    "",
    "Harness only. ONE Gemini image call. Every metric below is telemetry; nothing here is a production gate.",
    "",
    "## 1. Creative parity — OWNER JUDGEMENT on `contact-sheet.png`",
    "",
    "Does this still look like a professionally composed DesignProAI vehicle-wrap design? Geometry that passes while the design collapses into horizontal-band wallpaper is FAIL.",
    "",
    "## 2. Canonical serialization",
    "",
    `Master sha256 \`${masterHash}\` · GENIE manifest hash \`${geometryResolution.genieManifestHash}\` (${geometryResolution.state}) · delivered ${normalized.deliveredWidthPx}×${normalized.deliveredHeightPx}`,
    "",
    "| surface | territory (x, y, w, h) | trim (x, y, w, h) | print in | file px | native px/in | sha256 |",
    "|---|---|---|---|---|---|---|",
    ...fieldManifest.zones.map((z) => {
      const p = panelRecords.find((q) => q.surfaceKey === z.surfaceKey);
      return `| ${z.surfaceKey} | (${z.x}, ${z.y}, ${z.w}, ${z.h}) | (${z.trim.x}, ${z.trim.y}, ${z.trim.w}, ${z.trim.h}) | ${z.printWidthIn}×${z.printHeightIn} | ${p.pixelWidth}×${p.pixelHeight} | ${p.effectivePpiNative} | \`${p.contentHash.slice(0, 16)}\` |`;
    }),
    "",
    `All six \`sourceMasterHash\` = master: ${panelRecords.every((p) => p.sourceMasterHash === masterHash)} · method \`${panelRecords[0].method}\` · extracted ${pct(fieldManifest.fieldLayout.extractedRatio)} of canvas, painted-not-extracted ${pct(fieldManifest.fieldLayout.paintedNotExtractedRatio)}`,
    "",
    "## 3. Pane/file integrity — colour-blind full-bleed (telemetry)",
    "",
    `Whole field: nonArtwork ${pct(wf.nonArtworkRatio)}, border artwork ${pct(wf.borderArtworkRatio)}, edge-reachable field ${pct(wf.edgeReachableFieldRatio)} → ${wholeField.fullBleedCompliantCount}/1`,
    "",
    "| surface | bleed rect nonArt | bleed border | bleed OK | trim rect nonArt | trim border | trim OK |",
    "|---|---|---|---|---|---|---|",
    ...SURFACE_ORDER.map((k) => { const b = bleedMetrics.zones[k]; const t = trimMetrics.zones[k]; return `| ${k} | ${pct(b.nonArtworkRatio)} | ${pct(b.borderArtworkRatio)} | ${b.fullBleedCompliant ? "yes" : "no"} | ${pct(t.nonArtworkRatio)} | ${pct(t.borderArtworkRatio)} | ${t.fullBleedCompliant ? "yes" : "no"} |`; }),
    "",
    `Bleed rects ${bleedMetrics.fullBleedCompliantCount}/6 · trim rects ${trimMetrics.fullBleedCompliantCount}/6`,
    "",
    "## Continuity across territory boundaries",
    "",
    "| boundary | axis | at | boundaryMae | divider |",
    "|---|---|---|---|---|",
    ...continuity.boundaries.filter((b) => b.measurable).map((b) => `| ${b.between.join(" → ")} | ${b.axis} | ${b.at} | ${b.boundaryMae} | ${b.dividerDetected ? `YES, ${b.dividerDepthPx}px` : `no (${pct(b.dividerCoverage)})`} |`),
    "",
    "## 4. Design intent — OWNER JUDGEMENT",
    "",
    "Driver and Passenger each an intentionally useful composition of the same design? Hood / roof / front / rear more than technically valid crops?",
    "",
    "## 5. Production resolution",
    "",
    results.resolutionStatement,
    "",
    "## 6. No new blocking gate",
    "",
    "Every number above is telemetry.",
    "",
    "## For the record (last)",
    "",
    `Legacy gate: accepted=${checks.accepted}, blocking=${checks.blockingFailures.length}, passengerMirrorMae=${checks.passengerMirrorMae} · output class: \`${verdict.disposition}\` — ${verdict.evidence || ""} · latency ${(elapsedMs / 1000).toFixed(1)}s`,
    "",
    `Mechanical stop conditions tripped: ${mechanicallyWrong.length ? mechanicallyWrong.map((m) => `\n- ${m}`).join("") : "none"}`,
    `Concept proven mechanically (owner judgement still required): ${conceptProvenMechanically}`,
    "",
  ].join("\n"));

  log("");
  log(`draw 1 written; results.json, REPORT.md, contact-sheet.png and panels/ in ${OUT}`);
  log(`mechanical stop conditions: ${mechanicallyWrong.length ? mechanicallyWrong.join(" | ") : "none"} · concept proven mechanically: ${conceptProvenMechanically}`);
}

if (process.argv[1] && process.argv[1].endsWith("atlas-field-recovery.mjs")) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
