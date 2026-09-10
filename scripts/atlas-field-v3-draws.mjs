#!/usr/bin/env node
/**
 * FIELD CONTRACT v3 — N DRAWS OF THE EDGE'S OWN ASSEMBLY, WITHOUT A DEPLOY.
 * Harness only. Not production.
 *
 * Owner instruction (Trish, 2026-09-10): rewrite the one-field tail as
 * `designpro.atlas-field-prompt.v3` (no coordinate rows, no "areas", no
 * single-area sentence, positive full-bleed wording) and draw it four times on
 * the stored New Aura brief BEFORE any deploy.
 *
 * The product's fail-over sends the field request to the DEPLOYED edge, which
 * only answers the contract it was deployed with. So this harness does what
 * the field-recovery draws (tests 9 and 11) did: it EXECUTES the checkout's
 * edge assembly — `atlas-call1-build/atlas-call1-prompt.mjs`, lifted verbatim
 * from design-panel-ai-generate/index.ts by build-atlas-call1-prompt.mjs —
 * on the exact request body the runtime's `atlasEdgeRequestBody` emits for a
 * `field-thirds-v2` manifest, and sends the resulting ONE text part to Gemini
 * itself, with the edge's own model and generationConfig. Nothing in
 * production is touched: no deploy, no env write, no lease row, no request
 * row, no revision. The only writes are the evidence objects under
 * `wrap-files/designiq-ab/`.
 *
 * Each draw is then normalised, gated, classified and cut EXACTLY as the
 * fail-over does (normalizeAtlasMaster → deterministicMasterChecks →
 * classifyAtlasCandidate → cutCallOnePanels on the same field territories),
 * and measured on the things the owner rejected the v2 draws for: painted
 * numerals, a margin or mount inside a panel, a vehicle. Every number is
 * telemetry; the owner's eye on the raw masters and the cut Driver/Passenger
 * panels decides.
 *
 * `--draws` is bounded at 4 (the owner approved four).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertFieldPromptClean } from "./atlas-field-contract-v2.mjs";

const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
const { createClient } = require_("@supabase/supabase-js");
const sharp = require_("sharp");
const atlas = require_("./flat-first-atlas.cjs");
const genie = require_("./genie-universal-resolver.cjs");
const qc = require_("./atlas-master-qc.cjs");
const outputClass = require_("./atlas-output-class.cjs");
const { buildFieldTerritories, FIELD_TOPOLOGY } = require_("./atlas-field-territories.cjs");
const { createProvider } = require_("./generation-provider.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const OUT = args.out || "./ab-evidence";
mkdirSync(OUT, { recursive: true });

const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const truthy = (v) => String(v).toLowerCase() === "true";
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const HASH_RE = /^[a-f0-9]{64}$/;

const MAX_DRAWS = 4;
const DRAWS = Number(args.draws ?? 1);
if (!Number.isInteger(DRAWS) || DRAWS < 1 || DRAWS > MAX_DRAWS) {
  throw new Error(`field v3 draws: --draws must be 1..${MAX_DRAWS} (owner approved four); got ${args.draws}`);
}
// design-panel-ai-generate/index.ts handleAtlasArtboard — the exact
// generationConfig the edge sends for Call 1. No temperature field (owner
// ruling 2026-09-01).
const GENERATION_CONFIG = {
  responseModalities: ["TEXT", "IMAGE"],
  imageConfig: { aspectRatio: "1:1", imageSize: "4K" },
};

// A flag that is ABSENT keeps the harness default; a flag passed EMPTY omits
// the field, so a real customer request can be drawn with exactly the fields
// it carried (New Aura: companyName and finish, no industry, no colors, no
// style).
const field = (key, fallback) => (Object.prototype.hasOwnProperty.call(args, key)
  ? (String(args[key] ?? "").trim() || undefined) : fallback);
const BRIEF = args.brief || "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with "
  + "sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif "
  + "company name, high contrast and legible at highway distance.";
const VEHICLE = {
  type: args["vehicle-type"] || "truck",
  year: args["vehicle-year"] || "2022",
  make: args["vehicle-make"] || "Ford",
  model: args["vehicle-model"] || "F250 Crew Cab",
};
const COMPANY_NAME = field("company", undefined);
const INDUSTRY = field("industry", "HVAC and climate control");
const COLORS = field("colors", "deep blue,sunrise orange");
const STYLE = field("style", "modern commercial");
const V3_INPUT = {
  contractVersion: "designpro.calls-1-7-input.v3",
  pipelineMode: "flat-first-atlas-v1",
  vehicle: VEHICLE,
  brief: BRIEF,
  designName: field("design-name", undefined) || "Field v3 draws",
  mode: "commercial",
  ...(COMPANY_NAME ? { companyName: COMPANY_NAME } : {}),
  ...(INDUSTRY ? { industry: INDUSTRY } : {}),
  ...(COLORS ? { colors: COLORS.split(",").map((c) => c.trim()).filter(Boolean) } : {}),
  ...(STYLE ? { style: STYLE } : {}),
  finish: field("finish", undefined) || "Gloss",
};
const SURFACE_ORDER = ["driver", "passenger", "hood", "roof", "front", "rear"];

/**
 * Canvas-level telemetry for the two v2 defects the gates could not see.
 *   nearWhiteShare / neutralGreyShare — pale gutters and grey mounts
 *   borderRing — the outer 2% ring of the RAW canvas: luma std-dev and the
 *     share of ring pixels within ±6 of the ring median. A uniform ring of
 *     any colour is a mount/margin around the whole print, not artwork
 *     running off the edge. Recorded here so a later gate can be built on
 *     measured fixtures (handoff §3 item 9), never invented from prose.
 */
async function canvasTelemetry(rawBytes) {
  const S = 512;
  const { data, info } = await sharp(rawBytes, { limitInputPixels: false })
    .resize(S, S, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  let white = 0; let grey = 0;
  const ring = Math.max(2, Math.round(S * 0.02));
  const ringLuma = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const max = Math.max(r, g, b); const min = Math.min(r, g, b);
      if (min >= 245) white += 1;
      else if (max - min <= 10 && min >= 96 && max <= 200) grey += 1;
      if (x < ring || y < ring || x >= info.width - ring || y >= info.height - ring) {
        ringLuma.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
      }
    }
  }
  const mean = ringLuma.reduce((t, v) => t + v, 0) / ringLuma.length;
  const std = Math.sqrt(ringLuma.reduce((t, v) => t + (v - mean) ** 2, 0) / ringLuma.length);
  const sorted = [...ringLuma].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const nearMedian = ringLuma.filter((v) => Math.abs(v - median) <= 6).length / ringLuma.length;
  return {
    nearWhiteShare: Number((white / n).toFixed(4)),
    neutralGreyShare: Number((grey / n).toFixed(4)),
    borderRing: { widthPx: ring, lumaStd: Number(std.toFixed(2)), median, nearMedianShare: Number(nearMedian.toFixed(4)) },
  };
}

async function centreDistinctness(panels) {
  const thumbs = {};
  for (const p of panels) {
    thumbs[p.surfaceKey] = await sharp(p.bytes, { limitInputPixels: false }).resize(128, 128, { fit: "fill" }).greyscale().raw().toBuffer();
  }
  const centre = ["hood", "roof", "front", "rear"];
  const pairs = {};
  let minPair = 1;
  for (let i = 0; i < centre.length; i += 1) for (let j = i + 1; j < centre.length; j += 1) {
    const a = thumbs[centre[i]]; const b = thumbs[centre[j]];
    let sum = 0;
    for (let k = 0; k < a.length; k += 1) sum += Math.abs(a[k] - b[k]);
    const mad = sum / (a.length * 255);
    pairs[`${centre[i]}-${centre[j]}`] = Number(mad.toFixed(4));
    minPair = Math.min(minPair, mad);
  }
  return { pairs, minPair: Number(minPair.toFixed(4)) };
}

function reportMarkdown({ prompt, draws, fieldManifest, model, contract }) {
  const rows = draws.map((d) => (d.ok
    ? `| ${d.label} | ${d.deterministic.accepted ? "pass" : `REFUSE (${d.deterministic.blockingFailures.length} blocking)`} | ${d.outputClass.disposition}${d.outputClass.evidence ? ` — ${d.outputClass.evidence}` : ""} | ${d.centreDistinctness.minPair} | ${pct(d.telemetry.nearWhiteShare)} | ${pct(d.telemetry.neutralGreyShare)} | ${d.telemetry.borderRing.lumaStd} / ${pct(d.telemetry.borderRing.nearMedianShare)} | \`${d.contentHash.slice(0, 12)}\` | ${(d.elapsedMs / 1000).toFixed(1)}s |`
    : `| ${d.label} | FAILED | ${d.error} | | | | | | |`));
  return [
    `# Field contract v3 — ${draws.length} draw(s) of the checkout's edge assembly (${contract})`,
    "",
    `Model \`${model}\`, generationConfig \`${JSON.stringify(GENERATION_CONFIG)}\`, one text part, ${0} image parts. Prompt ${prompt.length} chars, sha \`${sha(prompt).slice(0, 16)}\`. Territories \`${fieldManifest.topology}\`.`,
    "",
    "Every column is telemetry. The owner's eye on the raw masters and the cut Driver/Passenger panels decides.",
    "",
    "| draw | deterministic gates | output class | centre min-MAD | near-white | neutral grey | border ring std / near-median | raw sha | time |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "- **near-white / neutral grey**: share of the raw canvas; v2 framed panes measured 1.2–14.1% near-white and up to 4.5% grey.",
    "- **border ring**: luma std-dev over the outer 2% of the raw canvas and the share within ±6 of its median. A uniform ring is a mount or margin around the print; artwork running off the edge is not uniform.",
    "- **centre min-MAD**: smallest pairwise difference among the four centre crops at 128² greyscale; the a503b91b band-reuse rejection read near 0, real passages read above 0.1.",
    "",
    "## The exact prompt",
    "",
    "```text",
    prompt,
    "```",
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

  // ── 1. GENIE geometry via production code ─────────────────────────────────
  log("resolving GENIE preview dimensions …");
  const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, VEHICLE, provider);
  const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
  const legacyManifest = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority, VEHICLE.type);
  const geometryResolution = dimensionRow.geometryResolution || null;
  if (!geometryResolution || !HASH_RE.test(String(geometryResolution.genieManifestHash || ""))) {
    throw new Error("pre-flight: the GENIE manifest identity is absent — cutCallOnePanels would refuse; no draw spent");
  }
  legacyManifest.geometryResolution = geometryResolution;
  const fieldManifest = buildFieldTerritories(legacyManifest);
  fieldManifest.geometryResolution = geometryResolution;
  if (fieldManifest.topology !== FIELD_TOPOLOGY) throw new Error("field territories did not produce the field topology");
  writeFileSync(join(OUT, "territories.json"), JSON.stringify({
    topology: fieldManifest.topology, canvas: fieldManifest.canvas, genieManifestHash: geometryResolution.genieManifestHash,
    geometryState: geometryResolution.state, installerMap: fieldManifest.installerMap, fieldLayout: fieldManifest.fieldLayout,
    zones: fieldManifest.zones.map((z) => ({ surfaceKey: z.surfaceKey, placement: z.placement, x: z.x, y: z.y, w: z.w, h: z.h,
      trim: z.trim, printWidthIn: z.printWidthIn, printHeightIn: z.printHeightIn, effectivePpiNative: z.effectivePpi })),
  }, null, 2));
  for (const z of fieldManifest.zones) {
    log(`    ${z.surfaceKey.padEnd(10)} ${z.placement.padEnd(14)} (${z.x}, ${z.y}, ${z.w}, ${z.h})  ${z.printWidthIn}×${z.printHeightIn} in  ${z.effectivePpi} px/in`);
  }

  // ── 2. THE REQUEST THE FAIL-OVER SENDS, ASSEMBLED BY THE CHECKOUT'S EDGE ──
  const body = atlas._test.atlasEdgeRequestBody(V3_INPUT, fieldManifest, { referenceImagesBase64: [] });
  if (body.fieldContract !== atlas.ATLAS_FIELD_PROMPT_CONTRACT || body.teachingProofStoragePath || body.guideStoragePath) {
    throw new Error("the field request must carry the field contract and no structural images");
  }
  // The slice throws atlas_artboard_field_contract_unknown when the checkout's
  // edge does not know the runtime's contract — the same refusal the deployed
  // edge would make. A skew is measured here, never drawn through.
  const assembled = call1.buildAtlasCall1Prompt(body);
  if (assembled.references.length) throw new Error("this fixture carries no customer references");
  const prompt = assembled.prompt;
  assertFieldPromptClean(prompt, "the v3 field prompt");
  const parts = [{ text: prompt }];
  const modelRequest = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: GENERATION_CONFIG });
  const request = {
    contract: body.fieldContract, model: call1.AUTHORING_MODEL, generationConfig: GENERATION_CONFIG,
    promptChars: prompt.length, promptSha256: sha(prompt), partCount: parts.length, modelInputImageCount: 0,
    modelRequestByteSize: Buffer.byteLength(modelRequest, "utf8"), draws: DRAWS,
    input: V3_INPUT, noseEdge: body.noseEdge,
  };
  writeFileSync(join(OUT, "prompt-field-v3.txt"), prompt);
  writeFileSync(join(OUT, "requests.json"), JSON.stringify(request, null, 2));
  log(`field contract ${body.fieldContract}: prompt ${prompt.length} chars sha ${sha(prompt).slice(0, 16)}, ${parts.length} part, 0 images, ${request.modelRequestByteSize} bytes, ${DRAWS} draw(s) planned`);

  if (captureOnly) {
    log("capture-only: the request is written, no provider call made");
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ captureOnly: true, imageRequestsExecuted: 0, request }, null, 2));
    writeFileSync(join(OUT, "REPORT.md"), reportMarkdown({ prompt, draws: [], fieldManifest, model: call1.AUTHORING_MODEL, contract: body.fieldContract }));
    return finish(supabase, ["prompt-field-v3.txt", "requests.json", "territories.json", "REPORT.md", "results.json"]);
  }

  // ── 3. N independent draws, each gated and cut exactly as the fail-over ───
  const produced = ["prompt-field-v3.txt", "requests.json", "territories.json"];
  const draws = [];
  let imageRequestsExecuted = 0;
  for (let draw = 1; draw <= DRAWS; draw += 1) {
    const label = `F${draw}`;
    const started = Date.now();
    try {
      log(`${label}: calling ${call1.AUTHORING_MODEL} …`);
      imageRequestsExecuted += 1;
      const result = await provider.generateRaw({
        model: call1.AUTHORING_MODEL,
        body: { contents: [{ role: "user", parts }], generationConfig: GENERATION_CONFIG },
        timeoutMs: 300_000,
        label: `field v3 ${label}`,
      });
      const candidateParts = result.payload?.candidates?.[0]?.content?.parts || [];
      const images = candidateParts.filter((p) => p?.inlineData?.data);
      const image = images[images.length - 1];
      if (!image) throw new Error(`no image (${result.payload?.candidates?.[0]?.finishReason || result.payload?.promptFeedback?.blockReason || "unknown"})`);
      const rawBytes = Buffer.from(image.inlineData.data, "base64");
      const rawFile = `${label}-raw-master.png`;
      writeFileSync(join(OUT, rawFile), rawBytes);
      produced.push(rawFile);
      const preview = `${label}-raw-master-1600.jpg`;
      writeFileSync(join(OUT, preview), await sharp(rawBytes, { limitInputPixels: false })
        .resize({ width: 1600, height: 1600, fit: "inside" }).jpeg({ quality: 84 }).toBuffer());
      produced.push(preview);
      const textOut = candidateParts.filter((p) => typeof p?.text === "string").map((p) => p.text).join("\n");
      writeFileSync(join(OUT, `${label}-design-text.txt`), textOut.slice(0, 4000));
      produced.push(`${label}-design-text.txt`);
      log(`${label}: ${(rawBytes.length / 1024).toFixed(0)}KB in ${((Date.now() - started) / 1000).toFixed(1)}s — raw master written FIRST`);

      const normalized = await atlas.normalizeAtlasMaster(rawBytes, fieldManifest);
      const masterHash = sha(normalized.bytes);
      const checks = await qc.deterministicMasterChecks(normalized.bytes, fieldManifest);
      const klass = await outputClass.classifyAtlasCandidate({ provider, bytes: normalized.bytes });
      const panels = await atlas.cutCallOnePanels(normalized.bytes, fieldManifest, masterHash);
      const panelRecords = [];
      for (const p of panels) {
        const file = `${label}-panel-${p.surfaceKey}.png`;
        writeFileSync(join(OUT, file), p.bytes);
        produced.push(file);
        if (p.surfaceKey === "driver" || p.surfaceKey === "passenger") {
          const pv = `${label}-panel-${p.surfaceKey}-1600.jpg`;
          writeFileSync(join(OUT, pv), await sharp(p.bytes, { limitInputPixels: false })
            .resize({ width: 1600, fit: "inside" }).jpeg({ quality: 84 }).toBuffer());
          produced.push(pv);
        }
        panelRecords.push({ surfaceKey: p.surfaceKey, contentHash: p.contentHash, pixelWidth: p.pixelWidth, pixelHeight: p.pixelHeight, effectivePpi: p.effectivePpi });
      }
      const telemetry = await canvasTelemetry(rawBytes);
      const record = {
        ok: true, label, draw, file: rawFile, preview, bytes: rawBytes.length, elapsedMs: Date.now() - started,
        contentHash: sha(rawBytes), normalizedHash: masterHash, model: result.model, keyFingerprint: result.keyFingerprint,
        delivered: { width: normalized.deliveredWidthPx, height: normalized.deliveredHeightPx, nativelyFourK: normalized.nativelyFourK },
        deterministic: {
          accepted: checks.accepted, blockingFailures: checks.blockingFailures, cutoutFindings: checks.cutoutFindings.map((f) => f.finding || f),
          passengerMirrorMae: checks.passengerMirrorMae,
          zones: (checks.zones || []).map((z) => ({ surfaceKey: z.surfaceKey, edgeHoleRatio: Number((z.edgeHoleRatio ?? 0).toFixed(4)),
            concentratedFlatBlackRatio: Number((z.concentratedFlatBlackRatio ?? 0).toFixed(4)), lumaStddev: Number((z.lumaStddev ?? 0).toFixed(2)) })),
        },
        outputClass: { disposition: klass.disposition, blocking: klass.blocking, confidence: klass.confidence, evidence: klass.evidence, code: klass.code, reason: klass.reason },
        centreDistinctness: await centreDistinctness(panels),
        telemetry,
        panels: panelRecords,
      };
      draws.push(record);
      log(`${label}: ${checks.accepted ? "gates PASS" : "gates REFUSE"} · class ${klass.disposition} · centre min-MAD ${record.centreDistinctness.minPair} · white ${pct(telemetry.nearWhiteShare)} · grey ${pct(telemetry.neutralGreyShare)} · ring std ${telemetry.borderRing.lumaStd}`);
    } catch (error) {
      log(`${label}: FAILED — ${error.message}`);
      draws.push({ ok: false, label, draw, error: String(error.message).slice(0, 500) });
    }
  }
  log(`gemini image requests executed: ${imageRequestsExecuted}`);
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ request, imageRequestsExecuted, draws }, null, 2));
  writeFileSync(join(OUT, "REPORT.md"), reportMarkdown({ prompt, draws, fieldManifest, model: call1.AUTHORING_MODEL, contract: body.fieldContract }));
  produced.push("results.json", "REPORT.md");
  return finish(supabase, produced);
}

/** Hand the evidence back as signed URLs beside the workflow artifact. */
async function finish(supabase, produced) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `designiq-ab/${stamp}-field-v3`;
  const urls = {};
  for (const file of produced) {
    try {
      const path = `${prefix}/${file}`;
      const body = readFileSync(join(OUT, file));
      // wrap-files refuses text/plain (capture run 34441413803: "mime type
      // text/plain is not supported"), so text evidence travels as octets.
      const contentType = file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") ? "image/jpeg" : file.endsWith(".json") ? "application/json" : "application/octet-stream";
      const { error } = await supabase.storage.from("wrap-files").upload(path, body, { contentType, upsert: true });
      if (error) { log(`upload ${file}: ${error.message}`); continue; }
      const { data } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60 * 24 * 7);
      if (data?.signedUrl) urls[file] = data.signedUrl;
    } catch (error) { log(`upload ${file}: ${error.message}`); }
  }
  writeFileSync(join(OUT, "signed-urls.json"), JSON.stringify({ prefix, urls }, null, 2));
  console.log("---AB-STORAGE-PREFIX---");
  console.log(prefix);
  console.log("---AB-SIGNED-URLS---");
  console.log(JSON.stringify(urls));
}

main().catch((error) => {
  console.error(`atlas-field-v3-draws failed: ${error?.stack || error}`);
  process.exit(1);
});
