#!/usr/bin/env node
/**
 * ANCHOR RESTORATION HARNESS v3 — ONE DRAW. Harness only. Not production.
 *
 * v3 (owner-approved 2026-09-02, "flattened as in zero body lines"): the
 * embodiment sentence becomes the printed-sheet object (RULE 0.32) instead of
 * an unfolded skin; parts 1 and 3 get the same object-schema cleanup, each
 * reverse-provable to the deployed text. Parts 2 and 4 untouched.
 *
 * v2 (owner finding after run 33642303437): the object definition moves to
 * the front of Part 0 and six exact-match object-schema phrases inside the
 * creative assembly are replaced (`scripts/atlas-anchor-contract.mjs`). The
 * reverse proof — undo the swaps, remove the block, get the deployed creative
 * byte for byte — runs before any provider call.
 *
 * Owner decision (2026-09-02): OPTION A. Production topology, production
 * `CENTER_ORDER` (REAR → ROOF → HOOD → FRONT), the known-good Flamingo labeled
 * teaching proof, the GENIE-proportioned neutral guide, the deployed teaching
 * and guide text parts, the deployed model and config, exactly ONE Gemini
 * image request, the REAL deterministic extractor. The ONLY change is the
 * output tail of part 0: the owner's object-first A.T.L.A.S. anchor
 * (`scripts/atlas-anchor-contract.mjs`).
 *
 * The narrow question this draw answers:
 *   Does giving Gemini the correct conceptual definition of the object — while
 *   retaining the known-good A.T.L.A.S. example and GENIE geometry — make it
 *   fill the existing flattened topology correctly again?
 *
 * Order: capture-only parity first (zero provider calls). If it passes, ONE
 * draw. The RAW master is saved before anything else touches it. Then the six
 * deterministic crops and three reports: visual acceptance (owner's eye),
 * edge-to-edge (telemetry, with the flood instrument's smooth-artwork caveat
 * stated), canonical integrity (coordinates, hashes, sourceMasterHash,
 * Driver/Passenger distinct, lineage). No repeatability. No gate. No deploy.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fullBleedMetrics } from "./atlas-fullbleed-metrics.mjs";
import {
  ANCHOR_CONTRACT, EXPECTED_ANCHOR_PROMPT_CHARS_F250, EXPECTED_ANCHOR_PROMPT_SHA256_PREFIX_F250,
  GENERATION_CONFIG, buildAnchorPrompt, buildAnchorRequest, cleanTeachingText, cleanGuideText,
} from "./atlas-anchor-contract.mjs";

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
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, "panels"), { recursive: true });

const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const truthy = (v) => String(v).toLowerCase() === "true";
const HASH_RE = /^[a-f0-9]{64}$/;

// OWNER: exactly one draw. A larger number is refused, not clamped.
const DRAWS = Number(args.draws ?? 1);
if (DRAWS !== 1) throw new Error(`anchor restoration: the owner approved exactly ONE draw; --draws ${args.draws} refused`);

// The deployed request for this exact fixture, measured on the deployed edge
// (runs 33577484230 / 33595250518 / 33597621527). Every part is pinned.
export const DEPLOYED = Object.freeze({
  promptSha256: "dcb73e9eae229cd88af6bcdb4a3874e1050b266fa98a55b79fee65d0b7e610b2",
  promptChars: 4587,
  creativeSha256Prefix: "7e011c6c20b5fa29",
  creativeChars: 2622,
  teachingText: "6f92d8ae60d392a5f144d71ae4bb1d7282053dc38165deb6f8908f9af5f8e259",
  teachingImage: "684534d27f8e7d70771f4931d9d1119ec73d2a28db774abcc4e343eb6e5e3ded",
  guideText: "a93e2c7a16fea22ae78c3e18fdc02b0ec08c7b6e8dd992e7ebf66ec41f480d4d",
  guideImage: "7c10d6ae0a3249eff6a65805d181794ee386dc9f2ff4080294f52870e5b1ccf5",
  modelRequestByteSize: 4762109,
});

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

function legacyZoneMetrics(checks) {
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

async function contactSheet(unmaskedBytes, manifest, panels, outPath) {
  const S = 2048;
  const f = S / manifest.canvas.widthPx;
  const rects = manifest.zones.map((z) => `
    <rect x="${z.x * f}" y="${z.y * f}" width="${z.w * f}" height="${z.h * f}" fill="none" stroke="#00e5ff" stroke-width="3"/>
    <rect x="${z.trim.x * f}" y="${z.trim.y * f}" width="${z.trim.w * f}" height="${z.trim.h * f}" fill="none" stroke="#ffd400" stroke-width="2" stroke-dasharray="10 8"/>
    <text x="${z.x * f + 12}" y="${z.y * f + 34}" font-family="sans-serif" font-size="30" font-weight="700" fill="#00e5ff" stroke="#000" stroke-width="1">${z.surfaceKey.toUpperCase()} · ${z.printWidthIn}×${z.printHeightIn} in · ${z.effectivePpi} px/in native</text>`).join("");
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${rects}</svg>`);
  const master = await sharp(unmaskedBytes, { limitInputPixels: false }).resize(S, S).composite([{ input: overlay }]).png().toBuffer();

  const byKey = new Map(panels.map((p) => [p.surfaceKey, p]));
  const flankH = Math.round(S * byKey.get("driver").pixelHeight / byKey.get("driver").pixelWidth);
  const passH = Math.round(S * byKey.get("passenger").pixelHeight / byKey.get("passenger").pixelWidth);
  const centre = atlas.CENTER_ORDER.map((k) => byKey.get(k));
  const rowH = 300;
  const centreWidths = centre.map((p) => Math.round(rowH * p.pixelWidth / p.pixelHeight));
  const gap = 12;
  const captionH = 40;
  const total = S + captionH * 4 + flankH + passH + rowH + gap * 5;
  const composites = [{ input: master, left: 0, top: 0 }];
  const captions = [];
  let y = S + gap;
  const cap = (text, top) => captions.push(`<text x="12" y="${top + 28}" font-family="monospace" font-size="22" fill="#ffffff">${text}</text>`);
  cap("PRODUCTION TOPOLOGY (unmasked draw) · cyan = zone (bleed box) · yellow dashed = trim", y);
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

  // ── 1. production geometry, production guide, pinned teaching proof ──────
  log("resolving GENIE preview dimensions …");
  const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, VEHICLE, provider);
  const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
  const manifest = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority, VEHICLE.type);
  const geometryResolution = dimensionRow.geometryResolution || null;
  if (!geometryResolution || !HASH_RE.test(String(geometryResolution.genieManifestHash || ""))) {
    throw new Error("pre-flight: the GENIE manifest identity is absent — cutCallOnePanels would refuse; no draw spent");
  }
  manifest.geometryResolution = geometryResolution;
  if (JSON.stringify(manifest.installerMap.centerOrderTopToBottom) !== JSON.stringify([...atlas.CENTER_ORDER])) {
    throw new Error("pre-flight: the manifest centre order is not CENTER_ORDER");
  }
  const guideBytes = await atlas.renderAtlasAuthoringGuide(manifest);
  const teachingProof = examples.loadBundledAtlasTeachingProof();
  const teachingBytes = Buffer.from(teachingProof.flattenedTopView.bytes);
  if (sha(teachingBytes) !== DEPLOYED.teachingImage) throw new Error("the bundled teaching proof is not the pinned owner proof — refusing to run");

  writeFileSync(join(OUT, "topology.json"), JSON.stringify({
    topology: manifest.topology,
    canvas: manifest.canvas,
    centerOrderTopToBottom: manifest.installerMap.centerOrderTopToBottom,
    genieManifestHash: geometryResolution.genieManifestHash,
    geometryState: geometryResolution.state,
    guideSha256: sha(guideBytes),
    zones: manifest.zones.map((z) => ({
      surfaceKey: z.surfaceKey, placement: z.placement, x: z.x, y: z.y, w: z.w, h: z.h, rotationDegrees: z.rotationDegrees,
      trim: z.trim, trimWidthIn: z.trimWidthIn, trimHeightIn: z.trimHeightIn, printWidthIn: z.printWidthIn, printHeightIn: z.printHeightIn,
      effectivePpiNative: z.effectivePpi,
    })),
  }, null, 2));
  log(`topology: ${manifest.topology} — centre ${manifest.installerMap.centerOrderTopToBottom.join(" → ")}, min native ${manifest.quality.minimumEffectivePpi} px/in, guide ${sha(guideBytes).slice(0, 16)}`);
  for (const z of manifest.zones) {
    log(`    ${z.surfaceKey.padEnd(10)} (${z.x}, ${z.y}, ${z.w}, ${z.h}) rot ${String(z.rotationDegrees).padStart(3)}  ${z.printWidthIn}×${z.printHeightIn} in  ${z.effectivePpi} px/in  trim (${z.trim.x}, ${z.trim.y}, ${z.trim.w}, ${z.trim.h})`);
  }

  // ── 2. the deployed prompt, reproduced, then ONLY the tail swapped ───────
  const edgeBody = atlas._test.atlasEdgeRequestBody(V3_INPUT, manifest, {
    teachingProofStoragePath: `atlas-call1-inputs/${sha(teachingBytes)}.png`,
    teachingProofIdentity: teachingProof.identity,
    guideStoragePath: `atlas-call1-inputs/${sha(guideBytes)}.png`,
  });
  const assembled = call1.buildAtlasCall1Prompt(edgeBody);
  if (assembled.references.length) throw new Error("this fixture must carry no customer references");
  const deployedSha = sha(assembled.prompt);
  if (DEFAULT_FIXTURE && (deployedSha !== DEPLOYED.promptSha256 || assembled.prompt.length !== DEPLOYED.promptChars)) {
    throw new Error(`the harness did not reproduce the deployed prompt (sha ${deployedSha.slice(0, 16)}, ${assembled.prompt.length} chars) — refusing to swap anything on a request production does not send`);
  }
  const anchor = buildAnchorPrompt(assembled.prompt, { centerOrder: atlas.CENTER_ORDER });
  const creativeSha = anchor.creativeSha256;
  if (DEFAULT_FIXTURE && (!creativeSha.startsWith(DEPLOYED.creativeSha256Prefix) || anchor.creative.length !== DEPLOYED.creativeChars)) {
    throw new Error("the creative assembly is not the deployed creative assembly");
  }
  if (!anchor.reverseProof) throw new Error("the reverse proof failed — the creative assembly changed by more than the six approved swaps");
  const promptSha = sha(anchor.prompt);
  if (DEFAULT_FIXTURE && (!promptSha.startsWith(EXPECTED_ANCHOR_PROMPT_SHA256_PREFIX_F250) || anchor.prompt.length !== EXPECTED_ANCHOR_PROMPT_CHARS_F250)) {
    throw new Error(`the anchor prompt is not the owner-approved text (sha ${promptSha.slice(0, 16)}, ${anchor.prompt.length} chars)`);
  }

  // v3: parts 1 and 3 get the same object-schema cleanup; each is refused unless the
  // deployed text is the pinned one and the cleaned text reverses to it byte for byte.
  const teaching = cleanTeachingText(call1.TEACHING_REFERENCE_TEXT);
  const guideText = cleanGuideText(call1.TARGET_GUIDE_TEXT);
  const { parts, request, serialize } = buildAnchorRequest({
    prompt: anchor.prompt,
    teachingReferenceText: teaching.text,
    teachingBytes,
    targetGuideText: guideText.text,
    guideBytes,
    model: call1.AUTHORING_MODEL,
    expected: { ...DEPLOYED, teachingText: teaching.sha256, guideText: guideText.sha256, guideImage: DEFAULT_FIXTURE ? DEPLOYED.guideImage : null },
  });

  const parity = {
    contract: ANCHOR_CONTRACT,
    source: "the deployed design-panel-ai-generate edge, runs 33577484230 / 33595250518 / 33597621527, same fixture",
    deployedPrompt: { sha256: deployedSha, chars: assembled.prompt.length, expectedSha256: DEPLOYED.promptSha256, expectedChars: DEPLOYED.promptChars, pinned: DEFAULT_FIXTURE },
    creativeAssembly: {
      deployedChars: anchor.creative.length, deployedSha256: creativeSha,
      swappedChars: anchor.swappedCreative.length, swappedSha256: anchor.swappedCreativeSha256,
      byteIdentical: false, swaps: anchor.swaps, reverseProof: anchor.reverseProof,
      note: "six exact-match object-schema swaps; reversing them and removing the object block reproduces the deployed creative byte for byte",
    },
    order: ["persona (deployed L1)", "object definition (owner)", "swapped creative (deployed L3–L19)", "placement tail"],
    tail: { deployedChars: anchor.deployedTail.length, deployedSha256: sha(anchor.deployedTail), objectBlockChars: anchor.objectBlock.length, placementChars: anchor.placement.length },
    anchorPrompt: { chars: anchor.prompt.length, sha256: promptSha, expectedChars: EXPECTED_ANCHOR_PROMPT_CHARS_F250, expectedSha256Prefix: EXPECTED_ANCHOR_PROMPT_SHA256_PREFIX_F250, pinned: DEFAULT_FIXTURE },
    parts: request.parts,
    textParts: {
      teaching: { deployedSha256: teaching.deployedSha256, chars: teaching.text.length, sha256: teaching.sha256, swaps: teaching.swaps, reverseProof: teaching.reverseProof },
      guide: { deployedSha256: guideText.deployedSha256, chars: guideText.text.length, sha256: guideText.sha256, swaps: guideText.swaps, reverseProof: guideText.reverseProof },
    },
    unchangedParts: {
      teachingImage: request.parts[2].sha256 === DEPLOYED.teachingImage,
      guideImage: DEFAULT_FIXTURE ? request.parts[4].sha256 === DEPLOYED.guideImage : "not pinned off the default fixture",
    },
    request: { partCount: request.partCount, modelInputImageCount: request.modelInputImageCount, modelRequestByteSize: request.modelRequestByteSize, deployedModelRequestByteSize: DEPLOYED.modelRequestByteSize, model: request.model, generationConfig: GENERATION_CONFIG },
  };
  writeFileSync(join(OUT, "parity.json"), JSON.stringify(parity, null, 2));
  writeFileSync(join(OUT, "prompt-deployed.txt"), assembled.prompt);
  writeFileSync(join(OUT, "prompt-anchor.txt"), anchor.prompt);
  writeFileSync(join(OUT, "creative-deployed.txt"), anchor.creative);
  writeFileSync(join(OUT, "creative-swapped.txt"), anchor.swappedCreative);
  writeFileSync(join(OUT, "object-block.txt"), anchor.objectBlock);
  writeFileSync(join(OUT, "tail-deployed.txt"), anchor.deployedTail);
  writeFileSync(join(OUT, "tail-placement.txt"), anchor.placement);
  writeFileSync(join(OUT, "creative-swaps.json"), JSON.stringify(anchor.swaps, null, 2));
  writeFileSync(join(OUT, "teaching-text-v3.txt"), teaching.text);
  writeFileSync(join(OUT, "guide-text-v3.txt"), guideText.text);
  writeFileSync(join(OUT, "text-part-swaps.json"), JSON.stringify({ teaching: teaching.swaps, guide: guideText.swaps }, null, 2));
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({ vehicle: VEHICLE, brief: BRIEF, draws: DRAWS, request }, null, 2));
  log(`deployed prompt reproduced: sha ${deployedSha.slice(0, 16)}, ${assembled.prompt.length} chars`);
  log(`creative assembly: deployed ${anchor.creative.length} chars ${creativeSha.slice(0, 16)} → six object-schema swaps → ${anchor.swappedCreative.length} chars ${anchor.swappedCreativeSha256.slice(0, 16)}; reverse proof ${anchor.reverseProof}`);
  log(`order: persona · object definition (${anchor.objectBlock.length} chars) · swapped creative · placement (${anchor.placement.length} chars); prompt ${anchor.prompt.length} chars, sha ${promptSha.slice(0, 16)}`);
  log(`teaching text: deployed ${teaching.deployedSha256.slice(0, 16)} → ${teaching.text.length} chars ${teaching.sha256.slice(0, 16)}, reverse proof ${teaching.reverseProof}; guide text: deployed ${guideText.deployedSha256.slice(0, 16)} → ${guideText.text.length} chars ${guideText.sha256.slice(0, 16)}, reverse proof ${guideText.reverseProof}`);
  log(`request: ${request.partCount} parts, ${request.modelInputImageCount} images, ${request.modelRequestByteSize} bytes (deployed ${DEPLOYED.modelRequestByteSize}); images unchanged: ${JSON.stringify(parity.unchangedParts)}`);

  if (captureOnly) {
    log("capture-only: request written, no provider call made");
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ contract: ANCHOR_CONTRACT, captureOnly: true, imageRequestsExecuted: 0, outputClassInspections: 0, parity, request }, null, 2));
    return;
  }

  // ── 3. exactly one Gemini call; RAW master saved first ───────────────────
  const key = keyPool[0];
  log("");
  log(`DRAW 1: calling ${call1.AUTHORING_MODEL} (${parts.length} parts, 2 structural images) …`);
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
  writeFileSync(join(OUT, "draw1-anchor-raw.png"), rawBytes);
  writeFileSync(join(OUT, "draw1-design-text.txt"), textOut.slice(0, 4000));
  log(`draw 1: ${(rawBytes.length / 1024).toFixed(0)}KB in ${(elapsedMs / 1000).toFixed(1)}s, raw sha ${sha(rawBytes).slice(0, 16)} — saved before interpretation`);

  // ── 4. normalize on the PRODUCTION manifest; unmasked copy for the eye ───
  const normalized = await atlas.normalizeAtlasMaster(rawBytes, manifest);
  const masterBytes = normalized.bytes;
  const masterHash = sha(masterBytes);
  writeFileSync(join(OUT, "draw1-anchor-master-masked.png"), masterBytes);
  const unmasked = await sharp(rawBytes, { limitInputPixels: false }).rotate()
    .resize(manifest.canvas.widthPx, manifest.canvas.heightPx, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha().png({ compressionLevel: 6 }).toBuffer();
  writeFileSync(join(OUT, "draw1-anchor-unmasked-4096.png"), unmasked);
  log(`normalized: delivered ${normalized.deliveredWidthPx}×${normalized.deliveredHeightPx}, nativelyFourK=${normalized.nativelyFourK}, master sha ${masterHash.slice(0, 16)}`);

  // ── 5. edge-to-edge telemetry (colour-blind flood) on bleed AND trim rects
  const bleedMetrics = await fullBleedMetrics(masterBytes, manifest);
  const trimMetrics = await fullBleedMetrics(masterBytes, { zones: manifest.zones.map((z) => ({ surfaceKey: z.surfaceKey, rect: z.trim })) });
  log(`edge-to-edge (telemetry): bleed rects ${bleedMetrics.fullBleedCompliantCount}/6 · trim rects ${trimMetrics.fullBleedCompliantCount}/6`);
  for (const key of SURFACE_ORDER) {
    const b = bleedMetrics.zones[key]; const t = trimMetrics.zones[key];
    log(`    ${key.padEnd(10)} bleed ${b.fullBleedCompliant ? "OK " : "NO "} nonArt ${(b.nonArtworkRatio * 100).toFixed(1).padStart(5)}% largest ${(b.largestNonArtworkComponentRatio * 100).toFixed(1).padStart(5)}% border ${(b.borderArtworkRatio * 100).toFixed(1).padStart(5)}% contour ${b.contourScore.toFixed(3)}   trim ${t.fullBleedCompliant ? "OK " : "NO "} nonArt ${(t.nonArtworkRatio * 100).toFixed(1).padStart(5)}%`);
  }

  // ── 6. for the record: legacy checks, output class ────────────────────────
  const checks = await qc.deterministicMasterChecks(masterBytes, manifest);
  const legacy = legacyZoneMetrics(checks);
  const verdict = await outputClass.classifyAtlasCandidate({ provider, bytes: rawBytes });
  log(`legacy gate (record): accepted=${checks.accepted} blocking=${checks.blockingFailures.length} cutouts=${(checks.cutoutSurfaces || []).length} passengerMirrorMae=${checks.passengerMirrorMae}`);
  log(`output class (record): ${verdict.disposition}${verdict.evidence ? ` — ${String(verdict.evidence).slice(0, 110)}` : ""}`);

  // ── 7. the REAL extractor cuts the six canonical files ────────────────────
  const panels = [];
  await atlas.cutCallOnePanels(masterBytes, manifest, masterHash, {
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
  const byKey = Object.fromEntries(panelRecords.map((p) => [p.surfaceKey, p]));
  const lineageOk = panelRecords.every((p) => p.sourceMasterHash === masterHash && p.genieManifestHash === geometryResolution.genieManifestHash && p.method === "deterministic_atlas_crop" && p.deterministic === true);
  const driverPassengerDistinct = byKey.driver.contentHash !== byKey.passenger.contentHash;

  // ── 8. contact sheet, results, report ─────────────────────────────────────
  await contactSheet(unmasked, manifest, panels, join(OUT, "contact-sheet.png"));

  const results = {
    contract: ANCHOR_CONTRACT,
    ranAt: new Date().toISOString(),
    imageRequestsExecuted: 1,
    outputClassInspections: 1,
    topology: manifest.topology,
    centerOrderTopToBottom: manifest.installerMap.centerOrderTopToBottom,
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
    genieManifestHash: geometryResolution.genieManifestHash,
    geometryState: geometryResolution.state,
    edgeToEdgeTelemetry: { bleedRects: bleedMetrics, trimRects: trimMetrics, caveat: "colour-blind edge flood; a smooth or dark painted ground can read as non-artwork (Draw 1 of the field harness). Telemetry does not overrule visual evidence." },
    legacyChecksForRecord: { accepted: checks.accepted, blockingFailures: checks.blockingFailures, cutoutSurfaces: checks.cutoutSurfaces || [], passengerMirrorMae: checks.passengerMirrorMae, structuralTemplateLeak: checks.structuralTemplateLeak, zones: legacy },
    outputClassForRecord: { disposition: verdict.disposition, blocking: verdict.blocking, confidence: verdict.confidence, evidence: verdict.evidence, model: verdict.model },
    panels: panelRecords,
    canonicalIntegrity: { sixDistinct: hashes.size === 6, allSourceMasterHashEqualMaster: panelRecords.every((p) => p.sourceMasterHash === masterHash), lineageOk, driverPassengerDistinct },
    ownerJudgementRequired: ["visual A.T.L.A.S. acceptance", "edge-to-edge acceptance where telemetry and the eye disagree", "one cohesive professional wrap"],
    resolutionStatement: "Native effective PPI per surface is recorded above. No 150 PPI, 300 PPI or 1500 DPI claim is made by this harness.",
  };
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));

  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  writeFileSync(join(OUT, "REPORT.md"), [
    "# Anchor restoration v3 — printed-sheet object, zero body lines, Draw 1 (production topology, option A)",
    "",
    "Harness only. ONE Gemini image call. Part 0 = persona · owner object definition (v3: the six printed vinyl sheets; flattened means zero body lines) · deployed creative with six object-schema swaps · placement tail; parts 1 and 3 carry the same object-schema cleanup (reverse-provable); parts 2 and 4, model, config and the extractor are production's. Every number here is telemetry; nothing is a gate.",
    "",
    `Raw master \`draw1-anchor-raw.png\` sha256 \`${sha(rawBytes)}\` (${rawBytes.length} B, delivered ${normalized.deliveredWidthPx}×${normalized.deliveredHeightPx}) — look at this FIRST.`,
    "",
    "## 1. Visual A.T.L.A.S. acceptance — OWNER JUDGEMENT",
    "",
    "Flattened top-view topology · two intentional flank compositions · four intentional centre compositions · one cohesive professional wrap. Decided on the raw master and `contact-sheet.png`, not below.",
    "",
    "## 2. Edge-to-edge acceptance — telemetry, then the eye",
    "",
    "All six regions filled completely · no smaller artwork floating inside a region · no wheel/glass/body-anatomy voids.",
    "",
    "| surface | bleed nonArt | largest field | border art | contour | bleed OK | trim nonArt | trim OK |",
    "|---|---|---|---|---|---|---|---|",
    ...SURFACE_ORDER.map((k) => { const b = bleedMetrics.zones[k]; const t = trimMetrics.zones[k]; return `| ${k} | ${pct(b.nonArtworkRatio)} | ${pct(b.largestNonArtworkComponentRatio)} | ${pct(b.borderArtworkRatio)} | ${b.contourScore.toFixed(3)} | ${b.fullBleedCompliant ? "yes" : "no"} | ${pct(t.nonArtworkRatio)} | ${t.fullBleedCompliant ? "yes" : "no"} |`; }),
    "",
    `Bleed rects ${bleedMetrics.fullBleedCompliantCount}/6 · trim rects ${trimMetrics.fullBleedCompliantCount}/6. ${results.edgeToEdgeTelemetry.caveat}`,
    "",
    "## 3. Canonical integrity",
    "",
    `Master sha256 \`${masterHash}\` · GENIE manifest hash \`${geometryResolution.genieManifestHash}\` (${geometryResolution.state}) · centre ${manifest.installerMap.centerOrderTopToBottom.join(" → ")}`,
    "",
    "| surface | zone (x, y, w, h) rot | trim (x, y, w, h) | print in | file px | native px/in | sha256 | sourceMasterHash = master |",
    "|---|---|---|---|---|---|---|---|",
    ...manifest.zones.map((z) => {
      const p = byKey[z.surfaceKey];
      return `| ${z.surfaceKey} | (${z.x}, ${z.y}, ${z.w}, ${z.h}) ${z.rotationDegrees}° | (${z.trim.x}, ${z.trim.y}, ${z.trim.w}, ${z.trim.h}) | ${z.printWidthIn}×${z.printHeightIn} | ${p.pixelWidth}×${p.pixelHeight} | ${p.effectivePpiNative} | \`${p.contentHash.slice(0, 16)}\` | ${p.sourceMasterHash === masterHash} |`;
    }),
    "",
    `Six distinct: ${hashes.size === 6} · Driver ≠ Passenger: ${driverPassengerDistinct} (passengerMirrorMae ${checks.passengerMirrorMae}) · lineage (method \`deterministic_atlas_crop\`, deterministic, GENIE hash bound): ${lineageOk}`,
    "",
    "## For the record",
    "",
    `Legacy gate: accepted=${checks.accepted}, blocking=${checks.blockingFailures.length}, cutouts=${(checks.cutoutSurfaces || []).length} · output class: \`${verdict.disposition}\` — ${verdict.evidence || ""} · latency ${(elapsedMs / 1000).toFixed(1)}s`,
    "",
    results.resolutionStatement,
    "",
    "STOP. No repeatability run, no production change, no deploy until the owner reviews Draw 1.",
    "",
  ].join("\n"));

  log("");
  log(`draw 1 written; results.json, REPORT.md, contact-sheet.png and panels/ in ${OUT}`);
  log(`canonical integrity: sixDistinct=${hashes.size === 6} lineageOk=${lineageOk} driverPassengerDistinct=${driverPassengerDistinct}`);
}

if (process.argv[1] && process.argv[1].endsWith("atlas-anchor-recovery.mjs")) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
