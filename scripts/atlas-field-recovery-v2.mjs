#!/usr/bin/env node
/**
 * FIELD RECOVERY HARNESS v2 — `field-thirds-v2`. ONE DRAW. Harness only. Not
 * production.
 *
 * Owner ruling (2026-09-02), verbatim in spirit:
 *
 *   Gemini authors ONE uninterrupted full-bleed professional vehicle-wrap
 *   composition. The model must NOT receive six model-facing production
 *   containers, the neutral six-pane guide, a six-pane teaching sheet, six
 *   named production objects, panel-layout framing, artboard/template framing,
 *   or wheel/window/body-piece negatives. GENIE/runtime owns Driver, Passenger,
 *   Hood, Roof, Front and Rear as code-only canonical territories. Passenger
 *   remains its own territory and may never be mirrored Driver bytes.
 *
 * PASS requires BOTH, judged by the owner on Draw 1:
 *   CREATIVE PARITY  — it looks like the professional wraps DesignPanelAI made
 *                      before the migration, not generic wallpaper.
 *   PRODUCTION PARITY — the OS deterministically yields six usable continuous
 *                      canonical production files from the one authority.
 *
 * Before any provider call this script writes PLAN.md — the owner's eight
 * items: exact model-facing parts; exact creative prompt; source canvas;
 * code-only six-territory map; how Driver and Passenger stay distinct; how
 * hierarchy survives serialization; the exact extraction path; expected native
 * PPI of all six files. `--capture-only true` stops there with zero calls.
 *
 * Exactly ONE image call. `--draws` above 1 is refused. No production code
 * change, no deploy, no blocking gate: every number here is telemetry.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fullBleedMetrics } from "./atlas-fullbleed-metrics.mjs";
import { buildFieldTerritoriesV2, FIELD_TOPOLOGY_V2, FIELD_CONTRACT_V2 as TERRITORY_CONTRACT } from "./atlas-field-territories-v2.mjs";
import { buildFieldPromptV2, buildFieldRequestV2, FIELD_TAIL_MAX_CHARS, GENERATION_CONFIG, FIELD_CONTRACT_V2 as PROMPT_CONTRACT } from "./atlas-field-contract-v2.mjs";
import { measureContinuity } from "./atlas-field-continuity.mjs";
import { inspectFileBranding, INSPECTION_MODEL } from "./atlas-field-inspection.mjs";

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
const pct = (v) => `${(v * 100).toFixed(1)}%`;

const DRAWS = Number(args.draws ?? 1);
if (DRAWS !== 1) throw new Error(`field recovery v2: the owner approved exactly ONE draw; --draws ${args.draws} refused`);

// The deployed request for this exact fixture, measured on runs 33595250518 /
// 33597621527 / 33603368628. The harness must reproduce it BEFORE it swaps anything.
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
const COMPANY_NAME = args.company || "Precision Climate Solutions";
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

async function contactSheet(unmaskedBytes, fieldManifest, panels, outPath) {
  const S = 2048;
  const f = S / fieldManifest.canvas.widthPx;
  const rects = fieldManifest.zones.map((z) => `
    <rect x="${z.x * f}" y="${z.y * f}" width="${z.w * f}" height="${z.h * f}" fill="none" stroke="#00e5ff" stroke-width="3"/>
    <rect x="${z.trim.x * f}" y="${z.trim.y * f}" width="${z.trim.w * f}" height="${z.trim.h * f}" fill="none" stroke="#ffd400" stroke-width="2" stroke-dasharray="10 8"/>
    <text x="${z.x * f + 12}" y="${z.y * f + 34}" font-family="sans-serif" font-size="30" font-weight="700" fill="#00e5ff" stroke="#000" stroke-width="1">${z.surfaceKey.toUpperCase()} · ${z.printWidthIn}×${z.printHeightIn} in · ${z.effectivePpi} px/in native</text>`).join("");
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${rects}</svg>`);
  const field = await sharp(unmaskedBytes, { limitInputPixels: false }).resize(S, S).composite([{ input: overlay }]).png().toBuffer();
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
  cap(`FIELD ${fieldManifest.topology} · cyan = territory (bleed box) · yellow dashed = trim · overlay is for humans, the model never saw it`, y);
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

function planMarkdown({ fieldManifest, legacyManifest, field, request, geometryResolution, model }) {
  const z = (k) => fieldManifest.zones.find((q) => q.surfaceKey === k);
  const layout = fieldManifest.fieldLayout;
  return [
    "# Field recovery v2 (`field-thirds-v2`) — the plan, written BEFORE any provider call",
    "",
    "Harness only. No production code change, no deploy, no blocking gate. This file is produced by the harness itself from the exact request it would send, so every string and number below is the one the model receives.",
    "",
    "## 1. Exact model-facing parts",
    "",
    `| index | kind | size | sha256 |`,
    `|---|---|---|---|`,
    ...request.parts.map((p) => `| ${p.index} | ${p.kind} | ${p.kind === "text" ? `${p.chars} chars` : `${p.bytes} bytes`} | \`${p.sha256.slice(0, 16)}\` |`),
    "",
    `${request.partCount} part(s), ${request.modelInputImageCount} image(s) (${request.customerReferenceCount} verified customer reference(s)), ${request.modelRequestByteSize} request bytes. Model \`${model}\`, \`${JSON.stringify(GENERATION_CONFIG)}\`, no temperature field. **No guide image, no teaching sheet, no labels, no topology text, no surface list.**`,
    "",
    "## 2. Exact creative prompt",
    "",
    `Deployed prompt reproduced first: sha \`${sha(field.creative + field.deployedTail).slice(0, 16)}\`, ${(field.creative + field.deployedTail).length} chars. Creative assembly ${field.creative.length} → ${field.creativeField.length} chars via ${field.swaps.length} exact-match swaps, reverse proof ${field.reverseProof}. Tail ${field.fieldTail.length} chars (ceiling ${FIELD_TAIL_MAX_CHARS}). Full prompt ${field.prompt.length} chars, sha \`${field.promptSha256.slice(0, 16)}\`. The complete text is \`prompt-field-v2.txt\`; the swaps are \`swaps.json\`.`,
    "",
    "```text",
    field.prompt,
    "```",
    "",
    "## 3. Source canvas",
    "",
    `${fieldManifest.canvas.widthPx}×${fieldManifest.canvas.heightPx} px, aspect 1:1, requested as \`imageSize: "4K"\`. Unchanged from every measured draw so far (20+ draws delivered exactly 4096×4096); it is the one canvas \`normalizeAtlasMaster\` accepts without resampling. A portrait 4:5 canvas would waste less of the field (a third of it is 2.4:1, close to the flank's 2.47:1) — recorded as a later single variable, not pulled here.`,
    "",
    "## 4. Code-only six-territory map (the model never sees this)",
    "",
    `Contract \`${TERRITORY_CONTRACT}\`, topology \`${fieldManifest.topology}\`, GENIE manifest \`${geometryResolution.genieManifestHash}\` (${geometryResolution.state}). Thirds: ${layout.thirds.map((t) => `third ${t.third} y ${t.y}–${t.y + t.h} (${t.h}px) = ${t.surfaces.join("/")}`).join(" · ")}. Rear sits under the ${layout.thirds[2].rearUnder}. Centre scale ${layout.thirds[2].scaleCenterPxPerIn} px/in.`,
    "",
    "| surface | placement | territory (x, y, w, h) | trim (x, y, w, h) | trim in | print in (+5″ bleed) | native px/in |",
    "|---|---|---|---|---|---|---|",
    ...SURFACE_ORDER.map((k) => { const s = z(k); return `| ${k} | ${s.placement} | (${s.x}, ${s.y}, ${s.w}, ${s.h}) | (${s.trim.x}, ${s.trim.y}, ${s.trim.w}, ${s.trim.h}) | ${s.trimWidthIn}×${s.trimHeightIn} | ${s.printWidthIn}×${s.printHeightIn} | ${s.effectivePpi} |`; }),
    "",
    `Extracted ${pct(layout.extractedRatio)} of the canvas; painted-not-extracted ${pct(layout.paintedNotExtractedRatio)} (discarded by the zone mask — a resolution cost, not a defect). Inches, square feet and bleed are lifted from the production \`buildAtlasManifest\` zones (legacy topology \`${legacyManifest.topology}\`), never re-derived.`,
    "",
    "## 5. How Driver and Passenger remain distinct",
    "",
    "- Two different territories on the field: Driver is the whole upper third, Passenger the whole middle third. Each file is a `sharp.extract` of its own pixels; nothing is flipped, copied or mirrored anywhere in the path.",
    "- The composition brief asks for two hero passages composed afresh, with opposite forward sweep (Driver left→right, Passenger right→left, from the code-owned nose edges), lettering left-to-right in both.",
    "- Recorded, not gated: `passengerMirrorMae` from the production checks (v1 measured 0.091 — distinct bytes) and the two files' distinct sha256.",
    "",
    "## 6. How commercial hierarchy and hero imagery survive deterministic serialization",
    "",
    "- **Flanks, by construction.** The Driver territory IS the upper third and the Passenger territory IS the middle third, and the brief puts a complete hero passage with the company name whole inside each third, clear of its top and bottom edges. A name inside the third is inside the file; the trim inset (5″) is inside the territory, so it also survives the print trim.",
    "- **Centre four, by continuation.** Hood, roof, front and rear are crops of the lower third — the supporting register of the SAME ground, palette and motion. They are usable continuous artwork, not intentionally composed statements. This is the honest weak point carried over from v1 and the first thing to judge on Draw 1.",
    "- **Brand mark on the centre surfaces is NOT guaranteed here.** The brief allows the mark once in the lower third; whether it lands inside one territory is a Draw-1 measurement. Placing marks where the OS wants them without showing the model the territories is the deterministic logo-placement step the proven RestylePro path owned (lifted logo asset placed per surface by code, RULE 0.25 Call 10). That is a separate, later owner decision; it is not simulated in this harness.",
    `- **Recorded per file (record only):** one \`${INSPECTION_MODEL}\` question per file at temperature 0 — is the company name complete / partial / absent, is a brand mark complete / partial / absent, is anything sliced by the file edge — bound to each file's own sha256. Six inspections. The owner's eye on \`contact-sheet.png\` decides; the record never overrules it.`,
    "",
    "## 7. Exact deterministic extraction path (production code, unchanged)",
    "",
    "1. `runtime/flat-first-atlas.cjs` → `normalizeAtlasMaster(rawBytes, fieldManifest)`: refuses a non-square return (±8%), resizes the delivered image to 4096×4096 (`fit: fill`, lanczos3), then masks everything outside the six territories to transparent (`activeZoneMaskSvg`, `dest-in`). Delivered size is recorded (`nativelyFourK`).",
    "2. `cutCallOnePanels(masterBytes, fieldManifest, masterHash)`: for each surface in `PANEL_EXTRACTION_ORDER` (driver, passenger, hood, front, rear, roof), `sharp.extract({left: x, top: y, width: w, height: h})` on the territory, `rotate(0)`, flatten to white, sRGB, PNG. Each file carries its own sha256, `sourceMasterHash` = the master hash, `method: deterministic_atlas_crop`, `deterministic: true`, the GENIE manifest hash, trim/print inches and `effectivePpi`.",
    "3. No AI, no fill, no mirror, no crop chosen by content. The harness then measures colour-blind full-bleed on bleed and trim rects, continuity across territory borders, the legacy near-black gate and the output class — all record only.",
    "",
    "## 8. Expected native PPI of all six files",
    "",
    "| surface | file px | print in | native px/in |",
    "|---|---|---|---|",
    ...SURFACE_ORDER.map((k) => { const s = z(k); return `| ${k} | ${s.w}×${s.h} | ${s.printWidthIn}×${s.printHeightIn} | ${s.effectivePpi} |`; }),
    "",
    `Minimum ${fieldManifest.quality.minimumEffectivePpi} px/in (v1 field-bands: flanks 22.34, centre 8.81; production six-region: driver ${legacyManifest.zones.find((q) => q.surfaceKey === "driver").effectivePpi}). No 150 PPI, 300 PPI or 1500 DPI claim is made by this harness; production-resolution transformation is a separate layer and a separate owner decision.`,
    "",
    "## STOP",
    "",
    "Capture-only makes zero provider calls. The one draw runs only after the owner approves this plan; no second draw until the owner reviews Draw 1.",
    "",
  ].join("\n");
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

  // ── 2. code-only territories ──────────────────────────────────────────────
  const fieldManifest = buildFieldTerritoriesV2(legacyManifest);
  fieldManifest.geometryResolution = geometryResolution;
  for (const z of fieldManifest.zones) {
    const l = legacyManifest.zones.find((q) => q.surfaceKey === z.surfaceKey);
    if (z.trimWidthIn !== l.trimWidthIn || z.trimHeightIn !== l.trimHeightIn || z.printWidthIn !== l.printWidthIn || z.printHeightIn !== l.printHeightIn) {
      throw new Error(`territory inches drifted from the legacy zone: ${z.surfaceKey}`);
    }
  }
  writeFileSync(join(OUT, "territories.json"), JSON.stringify({
    topology: fieldManifest.topology,
    contract: TERRITORY_CONTRACT,
    canvas: fieldManifest.canvas,
    genieManifestHash: geometryResolution.genieManifestHash,
    geometryState: geometryResolution.state,
    installerMap: fieldManifest.installerMap,
    fieldLayout: fieldManifest.fieldLayout,
    zones: fieldManifest.zones.map((z) => ({
      surfaceKey: z.surfaceKey, placement: z.placement, x: z.x, y: z.y, w: z.w, h: z.h,
      rotationDegrees: z.rotationDegrees, trim: z.trim, trimWidthIn: z.trimWidthIn, trimHeightIn: z.trimHeightIn,
      printWidthIn: z.printWidthIn, printHeightIn: z.printHeightIn, effectivePpiNative: z.effectivePpi, noseEdge: z.noseEdge,
    })),
    legacyZones: legacyManifest.zones.map((z) => ({ surfaceKey: z.surfaceKey, x: z.x, y: z.y, w: z.w, h: z.h, rotationDegrees: z.rotationDegrees, effectivePpiNative: z.effectivePpi })),
  }, null, 2));
  log(`territories: ${fieldManifest.topology} — extracted ${pct(fieldManifest.fieldLayout.extractedRatio)} of canvas, min native ${fieldManifest.quality.minimumEffectivePpi} px/in (legacy ${legacyManifest.quality.minimumEffectivePpi})`);
  for (const z of fieldManifest.zones) {
    log(`    ${z.surfaceKey.padEnd(10)} ${z.placement.padEnd(14)} (${z.x}, ${z.y}, ${z.w}, ${z.h})  ${z.printWidthIn}×${z.printHeightIn} in  ${z.effectivePpi} px/in  trim (${z.trim.x}, ${z.trim.y}, ${z.trim.w}, ${z.trim.h})`);
  }

  // ── 3. prompt: deployed assembly → v2 field prompt, byte identity proven ──
  const edgeBody = atlas._test.atlasEdgeRequestBody(V3_INPUT, legacyManifest, {});
  const assembled = call1.buildAtlasCall1Prompt(edgeBody);
  if (assembled.references.length) throw new Error("this fixture must carry no customer references");
  const deployedSha = sha(assembled.prompt);
  if (DEFAULT_FIXTURE && (deployedSha !== EXPECTED_DEPLOYED_PROMPT_SHA256 || assembled.prompt.length !== EXPECTED_DEPLOYED_PROMPT_CHARS)) {
    throw new Error(`the harness did not reproduce the deployed prompt (sha ${deployedSha.slice(0, 16)}, ${assembled.prompt.length} chars) — refusing to swap anything on a request production does not send`);
  }
  const field = buildFieldPromptV2(assembled.prompt, { noseEdge: fieldManifest.installerMap.noseEdge });
  const { parts, request, serialize } = buildFieldRequestV2({ prompt: field.prompt, referenceParts: [], model: call1.AUTHORING_MODEL });

  const parity = {
    source: "the deployed design-panel-ai-generate edge, runs 33595250518 / 33597621527 / 33603368628, same fixture",
    deployedPrompt: { sha256: deployedSha, chars: assembled.prompt.length, expectedSha256: EXPECTED_DEPLOYED_PROMPT_SHA256, expectedChars: EXPECTED_DEPLOYED_PROMPT_CHARS, pinned: DEFAULT_FIXTURE },
    creativeAssembly: { deployedChars: field.creative.length, deployedSha256: field.creativeSha256, fieldChars: field.creativeField.length, fieldSha256: field.creativeFieldSha256, swaps: field.swaps, reverseProof: field.reverseProof },
    tail: { deployedChars: field.deployedTail.length, deployedSha256: sha(field.deployedTail), fieldChars: field.fieldTail.length, fieldSha256: sha(field.fieldTail), ceiling: FIELD_TAIL_MAX_CHARS },
    request: { contract: PROMPT_CONTRACT, partCount: request.partCount, modelInputImageCount: request.modelInputImageCount, structuralImages: 0, modelRequestByteSize: request.modelRequestByteSize, model: request.model, generationConfig: GENERATION_CONFIG },
  };
  writeFileSync(join(OUT, "parity.json"), JSON.stringify(parity, null, 2));
  writeFileSync(join(OUT, "prompt-deployed.txt"), assembled.prompt);
  writeFileSync(join(OUT, "prompt-field-v2.txt"), field.prompt);
  writeFileSync(join(OUT, "creative-deployed.txt"), field.creative);
  writeFileSync(join(OUT, "creative-field-v2.txt"), field.creativeField);
  writeFileSync(join(OUT, "tail-deployed.txt"), field.deployedTail);
  writeFileSync(join(OUT, "tail-field-v2.txt"), field.fieldTail);
  writeFileSync(join(OUT, "swaps.json"), JSON.stringify(field.swaps, null, 2));
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({ vehicle: VEHICLE, brief: BRIEF, draws: DRAWS, request }, null, 2));
  writeFileSync(join(OUT, "PLAN.md"), planMarkdown({ fieldManifest, legacyManifest, field, request, geometryResolution, model: call1.AUTHORING_MODEL }));
  log(`deployed prompt reproduced: sha ${deployedSha.slice(0, 16)}, ${assembled.prompt.length} chars`);
  log(`creative assembly ${field.creative.length} chars → ${field.creativeField.length} chars, ${field.swaps.length} swaps, reverse proof ${field.reverseProof}`);
  log(`field tail ${field.fieldTail.length} chars (ceiling ${FIELD_TAIL_MAX_CHARS}); prompt ${field.prompt.length} chars sha ${field.promptSha256.slice(0, 16)}; request ${request.partCount} part(s), ${request.modelInputImageCount} image(s), ${request.modelRequestByteSize} bytes`);

  if (captureOnly) {
    log("capture-only: PLAN.md and the request written, no provider call made");
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ captureOnly: true, imageRequestsExecuted: 0, flashInspections: 0, parity, request, territories: fieldManifest.fieldLayout }, null, 2));
    return;
  }

  // ── 4. exactly one Gemini call ────────────────────────────────────────────
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
  writeFileSync(join(OUT, "draw1-field-v2-raw.png"), rawBytes);
  writeFileSync(join(OUT, "draw1-design-text.txt"), textOut.slice(0, 4000));
  log(`draw 1: ${(rawBytes.length / 1024).toFixed(0)}KB in ${(elapsedMs / 1000).toFixed(1)}s — raw master written FIRST`);

  // ── 5. normalize (square check, mask) + unmasked field ────────────────────
  const normalized = await atlas.normalizeAtlasMaster(rawBytes, fieldManifest);
  const masterBytes = normalized.bytes;
  const masterHash = sha(masterBytes);
  writeFileSync(join(OUT, "draw1-field-v2-master-masked.png"), masterBytes);
  const unmasked = await sharp(rawBytes, { limitInputPixels: false }).rotate()
    .resize(fieldManifest.canvas.widthPx, fieldManifest.canvas.heightPx, { fit: "fill", kernel: "lanczos3" })
    .removeAlpha().png({ compressionLevel: 6 }).toBuffer();
  writeFileSync(join(OUT, "draw1-field-v2-unmasked-4096.png"), unmasked);
  log(`normalized: delivered ${normalized.deliveredWidthPx}×${normalized.deliveredHeightPx}, nativelyFourK=${normalized.nativelyFourK}, master sha ${masterHash.slice(0, 16)}`);

  // ── 6. colour-blind full-bleed: bleed rects, trim rects, whole field ──────
  const bleedMetrics = await fullBleedMetrics(masterBytes, fieldManifest);
  const trimMetrics = await fullBleedMetrics(masterBytes, { zones: fieldManifest.zones.map((z) => ({ surfaceKey: z.surfaceKey, rect: z.trim })) });
  const wholeField = await fullBleedMetrics(unmasked, { zones: [{ surfaceKey: "field", x: 0, y: 0, w: fieldManifest.canvas.widthPx, h: fieldManifest.canvas.heightPx }] });
  const wf = wholeField.zones.field;
  log(`full-bleed (telemetry; a smooth painted ground can read as non-artwork): bleed rects ${bleedMetrics.fullBleedCompliantCount}/6 · trim rects ${trimMetrics.fullBleedCompliantCount}/6 · whole field nonArtwork ${pct(wf.nonArtworkRatio)}, border ${pct(wf.borderArtworkRatio)}`);
  for (const key of SURFACE_ORDER) {
    const b = bleedMetrics.zones[key]; const t = trimMetrics.zones[key];
    log(`    ${key.padEnd(10)} bleed ${b.fullBleedCompliant ? "OK " : "NO "} nonArt ${pct(b.nonArtworkRatio).padStart(6)} border ${pct(b.borderArtworkRatio).padStart(6)}   trim ${t.fullBleedCompliant ? "OK " : "NO "} nonArt ${pct(t.nonArtworkRatio).padStart(6)} border ${pct(t.borderArtworkRatio).padStart(6)}`);
  }

  // ── 7. for the record: legacy checks, output class ────────────────────────
  const checks = await qc.deterministicMasterChecks(masterBytes, fieldManifest);
  const legacy = legacyZoneMetrics(checks);
  const verdict = await outputClass.classifyAtlasCandidate({ provider, bytes: rawBytes });
  log(`legacy gate (record): accepted=${checks.accepted} blocking=${checks.blockingFailures.length} passengerMirrorMae=${checks.passengerMirrorMae}`);
  log(`output class (record): ${verdict.disposition}${verdict.evidence ? ` — ${String(verdict.evidence).slice(0, 110)}` : ""}`);

  // ── 8. continuity across territory boundaries ─────────────────────────────
  const raw = await sharp(unmasked, { limitInputPixels: false }).raw().toBuffer({ resolveWithObject: true });
  const continuity = measureContinuity({ data: raw.data, width: raw.info.width, height: raw.info.height, channels: raw.info.channels }, fieldManifest.fieldLayout.boundaries);
  log(`continuity: anyDivider=${continuity.anyDividerDetected} deepest ${continuity.deepestDividerPx}px, worst boundaryMae ${continuity.worstBoundaryMae}`);
  for (const b of continuity.boundaries) {
    if (b.measurable) log(`    ${b.between.join("→").padEnd(20)} ${b.axis}=${b.at}  mae ${b.boundaryMae}  divider ${b.dividerDetected ? `YES depth ${b.dividerDepthPx}px` : `no (${(b.dividerCoverage * 100).toFixed(0)}%)`}`);
  }

  // ── 9. the OS cuts the six canonical files with the REAL extractor ────────
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

  // ── 10. per-file branding inspection (record only) ────────────────────────
  const inspections = {};
  for (const p of panels) {
    inspections[p.surfaceKey] = await inspectFileBranding({ provider, sharp, bytes: p.bytes, companyName: COMPANY_NAME });
    const r = inspections[p.surfaceKey];
    log(`    inspect ${p.surfaceKey.padEnd(10)} ${r.disposition === "inspected" ? `name ${r.companyName} · mark ${r.brandMark} · cutAtEdge ${r.cutAtEdge} — ${r.evidence}` : `unavailable (${r.reason})`}`);
  }
  writeFileSync(join(OUT, "inspections.json"), JSON.stringify(inspections, null, 2));

  // ── 11. contact sheet, receipts, report ───────────────────────────────────
  await contactSheet(unmasked, fieldManifest, panels, join(OUT, "contact-sheet.png"));
  const receipts = [];
  if (wf.borderArtworkRatio < 0.98 || wf.edgeReachableFieldRatio > 0.02) receipts.push(`whole-field border artwork ${pct(wf.borderArtworkRatio)}, edge-reachable field ${pct(wf.edgeReachableFieldRatio)} (an object on a surround, OR a smooth painted ground — the owner's eye decides)`);
  for (const b of continuity.boundaries) {
    if (b.measurable && b.dividerDetected) receipts.push(`a divider ${b.dividerDepthPx}px deep at ${b.between.join("/")} — the thirds may have been drawn as containers`);
  }
  if (verdict.disposition === "vehicle_depiction") receipts.push("explicit vehicle_depiction verdict");

  const results = {
    contract: "designpro.atlas-field-recovery.v2",
    ranAt: new Date().toISOString(),
    imageRequestsExecuted: 1,
    flashInspections: 1 + panels.length,
    topology: FIELD_TOPOLOGY_V2,
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
    inspections,
    receipts,
    ownerJudgementRequired: ["CREATIVE PARITY — a professional DesignPanelAI-register wrap, not wallpaper", "PRODUCTION PARITY — six usable continuous canonical files", "company name whole inside Driver and inside Passenger", "centre four usable"],
    resolutionStatement: "Native effective PPI per file is recorded above. No 150 PPI, 300 PPI or 1500 DPI claim is made by this harness; production-resolution transformation is a separate layer and a separate owner decision.",
  };
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));

  const insp = (k) => { const r = inspections[k]; return r?.disposition === "inspected" ? `${r.companyName} / ${r.brandMark} / ${r.cutAtEdge ? "cut" : "clean"}` : "unavailable"; };
  writeFileSync(join(OUT, "REPORT.md"), [
    "# Field recovery v2 — Draw 1 (`field-thirds-v2`)",
    "",
    "Harness only. ONE Gemini image call. Every metric below is telemetry; nothing here is a production gate. Look at `draw1-field-v2-raw.png` FIRST.",
    "",
    `Raw master sha256 \`${sha(rawBytes)}\` (${rawBytes.length} B, delivered ${normalized.deliveredWidthPx}×${normalized.deliveredHeightPx}) · canonical master \`${masterHash}\` · GENIE manifest \`${geometryResolution.genieManifestHash}\` (${geometryResolution.state})`,
    "",
    "## CREATIVE PARITY — OWNER JUDGEMENT",
    "",
    "Does the raw master look like the professional wraps DesignPanelAI created before the migration — intentional company-name placement, hero imagery, commercial hierarchy — and not generic wallpaper?",
    "",
    "## PRODUCTION PARITY — six deterministic files from the one authority",
    "",
    "| surface | territory (x, y, w, h) | trim (x, y, w, h) | print in | file px | native px/in | sha256 | source = master | name / mark / edge (record) |",
    "|---|---|---|---|---|---|---|---|---|",
    ...SURFACE_ORDER.map((k) => {
      const zz = fieldManifest.zones.find((q) => q.surfaceKey === k);
      const p = panelRecords.find((q) => q.surfaceKey === k);
      return `| ${k} | (${zz.x}, ${zz.y}, ${zz.w}, ${zz.h}) | (${zz.trim.x}, ${zz.trim.y}, ${zz.trim.w}, ${zz.trim.h}) | ${zz.printWidthIn}×${zz.printHeightIn} | ${p.pixelWidth}×${p.pixelHeight} | ${p.effectivePpiNative} | \`${p.contentHash.slice(0, 16)}\` | ${p.sourceMasterHash === masterHash} | ${insp(k)} |`;
    }),
    "",
    `Six distinct files: ${hashes.size === 6} · Driver ≠ Passenger bytes: ${panelRecords[0].contentHash !== panelRecords[1].contentHash} (passengerMirrorMae ${checks.passengerMirrorMae}) · method \`${panelRecords[0].method}\`, deterministic ${panelRecords.every((p) => p.deterministic)} · extracted ${pct(fieldManifest.fieldLayout.extractedRatio)} of canvas`,
    "",
    "## Edge-to-edge (colour-blind, telemetry)",
    "",
    `Whole field: nonArtwork ${pct(wf.nonArtworkRatio)}, border artwork ${pct(wf.borderArtworkRatio)}, edge-reachable field ${pct(wf.edgeReachableFieldRatio)}. A smooth painted ground reads as non-artwork to this instrument (v1 finding); the owner's eye decides.`,
    "",
    "| surface | bleed nonArt | bleed border | bleed OK | trim nonArt | trim border | trim OK |",
    "|---|---|---|---|---|---|---|",
    ...SURFACE_ORDER.map((k) => { const b = bleedMetrics.zones[k]; const t = trimMetrics.zones[k]; return `| ${k} | ${pct(b.nonArtworkRatio)} | ${pct(b.borderArtworkRatio)} | ${b.fullBleedCompliant ? "yes" : "no"} | ${pct(t.nonArtworkRatio)} | ${pct(t.borderArtworkRatio)} | ${t.fullBleedCompliant ? "yes" : "no"} |`; }),
    "",
    "## Continuity across territory borders",
    "",
    "| boundary | axis | at | boundaryMae | divider |",
    "|---|---|---|---|---|",
    ...continuity.boundaries.filter((b) => b.measurable).map((b) => `| ${b.between.join(" → ")} | ${b.axis} | ${b.at} | ${b.boundaryMae} | ${b.dividerDetected ? `YES, ${b.dividerDepthPx}px` : `no (${pct(b.dividerCoverage)})`} |`),
    "",
    "## Production resolution",
    "",
    results.resolutionStatement,
    "",
    "## For the record (last)",
    "",
    `Legacy gate: accepted=${checks.accepted}, blocking=${checks.blockingFailures.length} · output class: \`${verdict.disposition}\` — ${verdict.evidence || ""} · latency ${(elapsedMs / 1000).toFixed(1)}s · image calls 1 · flash inspections ${1 + panels.length}`,
    "",
    `Receipts: ${receipts.length ? receipts.map((m) => `\n- ${m}`).join("") : "none"}`,
    "",
    "STOP. No second draw until the owner reviews Draw 1.",
    "",
  ].join("\n"));

  log("");
  log(`draw 1 written; results.json, REPORT.md, PLAN.md, contact-sheet.png and panels/ in ${OUT}`);
}

if (process.argv[1] && process.argv[1].endsWith("atlas-field-recovery-v2.mjs")) {
  main().catch((error) => {
    console.error(`\nFAILED: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
