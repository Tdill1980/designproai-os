#!/usr/bin/env node
/**
 * TEST 14 — THREE ARMS ON THE ONE-FIELD CALL 1. Harness only. Not production.
 *
 * Owner questions (Trish, 2026-09-10):
 *   "So you're saying we should make Lambos the primary example?"
 *   "Examine the prompt engineering language — I don't think the right
 *    flattened topology was ever used in describing."
 *
 * Both are answered by measurement, on the same brief, the same gates and the
 * same cut, in one run. Every arm keeps the DesignPanelAI creative assembly
 * byte for byte (proven below) and varies exactly one thing:
 *
 *   A — the v3 field tail, no image. The baseline: 0 body lines in 14 draws.
 *   B — the v3 field tail, plus the Houdini Wraps Huracán DESIGN LAYOUT
 *       (`runtime/atlas-examples/houdini-flattened-top-view.jpg`) as the ONLY
 *       image, introduced by one short reference sentence. The "Lambo as
 *       primary example" question. The pair was wired into the runtime once
 *       and never sent to Call 1 in any measured draw, so this is its first
 *       measurement, not a re-run.
 *   C — a v4 "pressed skin" tail, no image. The owner's own description of
 *       A.T.L.A.S.: the wrap designed across the whole vehicle, then pressed
 *       flat into one continuous print, the print being all that remains. It
 *       carries the vehicle as design context and never as the object drawn.
 *       No negatives, no anatomy nouns, no coordinates, no panel words.
 *
 * Draws are interleaved A,B,C,A,B,C,… so provider drift over the run lands on
 * every arm equally (tests 2–8 measured within-condition variance larger than
 * a single pair). `--draws` is per arm, bounded at 4: at most 12 image calls.
 *
 * Each draw is normalised, gated, classified and cut EXACTLY as the fail-over
 * does on the field territories. The numbers are telemetry; the owner's eye on
 * the raw masters and the cut Driver/Passenger panels decides.
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

const MAX_DRAWS_PER_ARM = 4;
const DRAWS = Number(args.draws ?? 1);
if (!Number.isInteger(DRAWS) || DRAWS < 1 || DRAWS > MAX_DRAWS_PER_ARM) {
  throw new Error(`field arms: --draws is per arm and must be 1..${MAX_DRAWS_PER_ARM}; got ${args.draws}`);
}
const ARM_KEYS = ["A", "B", "C"];
const ARMS = String(args.arms || "A,B,C").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
for (const arm of ARMS) if (!ARM_KEYS.includes(arm)) throw new Error(`unknown arm ${arm}; arms are ${ARM_KEYS.join(",")}`);

// design-panel-ai-generate/index.ts handleAtlasArtboard — the exact
// generationConfig the edge sends for Call 1. No temperature field.
const GENERATION_CONFIG = {
  responseModalities: ["TEXT", "IMAGE"],
  imageConfig: { aspectRatio: "1:1", imageSize: "4K" },
};

const V3_TAIL_HEAD = "OUTPUT — ONE CONTINUOUS FULL-BLEED COMPOSITION on one square 4K image.";
const V3_CLOSING = "Gallery-grade custom artwork with real depth, movement and a wow factor, drawn flat for printing.";
export const V4_CONTRACT = "designpro.atlas-field-prompt.v4-pressed-skin (harness)";
export const HOUDINI_LAYOUT = "runtime/atlas-examples/houdini-flattened-top-view.jpg";
// Arm B's one reference sentence. It names what the image IS in print terms
// and asks for an original design; it carries no panel, label or anatomy word.
export const HOUDINI_REFERENCE_TEXT = "REFERENCE IMAGE — one complete wrap design pressed flat into printed vinyl. Learn only how a whole wrap reads when it is pressed flat; create an original design for the customer described above.";

/**
 * The v4 tail, built FROM the v3 tail so the vehicle context and the lettering
 * rule are lifted, never retyped. Everything else is the owner's concept: the
 * wrap designed across the whole vehicle, pressed flat, the print being all
 * that remains. Positive statements only.
 */
export function pressedSkinTail(v3Tail) {
  const vehicle = /for this exact (.+?) \((.+?)\) — ground colour/.exec(v3Tail);
  if (!vehicle) throw new Error("v4: could not read the vehicle context out of the v3 tail");
  const [, vehicleName, bodyClass] = vehicle;
  const lettering = v3Tail.split("\n").find((line) => line.startsWith("Lettering reads left to right"));
  if (!lettering) throw new Error("v4: could not lift the lettering rule out of the v3 tail");
  return [
    "OUTPUT — THE WRAP'S PRINTED SKIN, PRESSED FLAT, on one square 4K image.",
    `This wrap was designed across the whole ${vehicleName} (${bodyClass}) as one continuous piece of artwork. The image shows that artwork pressed perfectly flat into a single continuous print, seen straight on. Pressing it flat leaves only the print: one uninterrupted field of colour, texture, imagery and motion filling the entire square, edge to edge on all four sides.`,
    "",
    "The print is the artwork alone, at full size. The design runs off all four edges: the outermost pixels on every side are artwork in mid-motion, and the print continues beyond the image in every direction. There is no margin, border, frame, mount or backdrop around it; the artwork reaches every corner.",
    "",
    "Every part of the print, corner to corner, is finished, intentional, commercially valuable artwork — real subject matter, real depth, real movement, worth what the customer paid — with no empty backdrop, filler or quiet leftover anywhere. The focal subject may span as much of the print as the concept calls for, and the ground, palette, texture, lighting and motion run continuously through the whole print.",
    "",
    lettering,
    "",
    V3_CLOSING,
  ].join("\n");
}

/** Split the assembled v3 prompt into [creative assembly, v3 tail]. */
export function splitV3Prompt(prompt) {
  const at = prompt.indexOf(V3_TAIL_HEAD);
  if (at < 0) throw new Error("the assembled prompt does not carry the v3 field tail");
  return { creative: prompt.slice(0, at), tail: prompt.slice(at) };
}

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
  designName: field("design-name", undefined) || "Field arms A/B/C",
  mode: "commercial",
  ...(COMPANY_NAME ? { companyName: COMPANY_NAME } : {}),
  ...(INDUSTRY ? { industry: INDUSTRY } : {}),
  ...(COLORS ? { colors: COLORS.split(",").map((c) => c.trim()).filter(Boolean) } : {}),
  ...(STYLE ? { style: STYLE } : {}),
  finish: field("finish", undefined) || "Gloss",
};

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
  let minPair = 1;
  for (let i = 0; i < centre.length; i += 1) for (let j = i + 1; j < centre.length; j += 1) {
    const a = thumbs[centre[i]]; const b = thumbs[centre[j]];
    let sum = 0;
    for (let k = 0; k < a.length; k += 1) sum += Math.abs(a[k] - b[k]);
    minPair = Math.min(minPair, sum / (a.length * 255));
  }
  return { minPair: Number(minPair.toFixed(4)) };
}

function reportMarkdown({ arms, draws, fieldManifest, model }) {
  const rows = draws.map((d) => (d.ok
    ? `| ${d.label} | ${d.arm} | ${d.deterministic.accepted ? "pass" : `REFUSE (${d.deterministic.blockingFailures.length} blocking)`}${d.deterministic.cutoutFindings.length ? ` · ${d.deterministic.cutoutFindings.length} cut-out` : ""} | ${d.outputClass.disposition}${d.outputClass.evidence ? ` — ${d.outputClass.evidence}` : ""} | ${d.centreDistinctness.minPair} | ${pct(d.telemetry.nearWhiteShare)} | ${pct(d.telemetry.neutralGreyShare)} | ${d.telemetry.borderRing.lumaStd} / ${pct(d.telemetry.borderRing.nearMedianShare)} | \`${d.contentHash.slice(0, 12)}\` | ${(d.elapsedMs / 1000).toFixed(1)}s |`
    : `| ${d.label} | ${d.arm} | FAILED | ${d.error} | | | | | | |`));
  return [
    `# Test 14 — three arms on the one-field Call 1 (${draws.length} draws)`,
    "",
    `Model \`${model}\`, generationConfig \`${JSON.stringify(GENERATION_CONFIG)}\`. Territories \`${fieldManifest.topology}\`.`,
    "",
    "| arm | what varies | parts | images | prompt chars | prompt sha |",
    "|---|---|---|---|---|---|",
    ...ARMS.map((k) => `| ${k} | ${arms[k].what} | ${arms[k].partCount} | ${arms[k].modelInputImageCount} | ${arms[k].promptChars} | \`${arms[k].promptSha256.slice(0, 16)}\` |`),
    "",
    "The creative assembly is byte-identical across all three arms (asserted before any call). Every column below is telemetry; the owner's eye on the raw masters and the cut Driver/Passenger panels decides.",
    "",
    "| draw | arm | deterministic gates | output class | centre min-MAD | near-white | neutral grey | border ring std / near-median | raw sha | time |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "## Arm B reference sentence",
    "",
    "```text",
    HOUDINI_REFERENCE_TEXT,
    "```",
    "",
    "## Arm C tail (v4 pressed skin)",
    "",
    "```text",
    arms.C ? arms.C.tail : "(arm C not run)",
    "```",
    "",
    "## Arm A / B tail (v3)",
    "",
    "```text",
    arms.A ? arms.A.tail : arms.B ? arms.B.tail : "(not run)",
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
    zones: fieldManifest.zones.map((z) => ({ surfaceKey: z.surfaceKey, placement: z.placement, x: z.x, y: z.y, w: z.w, h: z.h, trim: z.trim })),
  }, null, 2));

  // ── 2. The v3 request, assembled by the checkout's edge slice ─────────────
  const body = atlas._test.atlasEdgeRequestBody(V3_INPUT, fieldManifest, { referenceImagesBase64: [] });
  if (body.fieldContract !== atlas.ATLAS_FIELD_PROMPT_CONTRACT || body.teachingProofStoragePath || body.guideStoragePath) {
    throw new Error("the field request must carry the field contract and no structural images");
  }
  const assembled = call1.buildAtlasCall1Prompt(body);
  if (assembled.references.length) throw new Error("this fixture carries no customer references");
  const promptV3 = assembled.prompt;
  assertFieldPromptClean(promptV3, "the v3 field prompt");
  const { creative, tail: tailV3 } = splitV3Prompt(promptV3);
  const tailV4 = pressedSkinTail(tailV3);
  const promptV4 = creative + tailV4;
  assertFieldPromptClean(promptV4, "the v4 pressed-skin prompt");
  assertFieldPromptClean(HOUDINI_REFERENCE_TEXT, "the arm B reference sentence");
  if (!promptV4.startsWith(creative) || !promptV3.startsWith(creative)) throw new Error("the creative assembly did not survive");

  const houdiniBytes = readFileSync(HOUDINI_LAYOUT);
  const houdiniMeta = await sharp(houdiniBytes).metadata();
  const houdiniPart = { inlineData: { mimeType: "image/jpeg", data: houdiniBytes.toString("base64") } };

  const armParts = {
    A: [{ text: promptV3 }],
    B: [{ text: promptV3 }, { text: HOUDINI_REFERENCE_TEXT }, houdiniPart],
    C: [{ text: promptV4 }],
  };
  const armWhat = {
    A: "v3 field tail, no image (baseline)",
    B: `v3 field tail + Houdini Huracán design layout as the only image (${houdiniMeta.width}×${houdiniMeta.height} jpg, sha ${sha(houdiniBytes).slice(0, 12)})`,
    C: "v4 pressed-skin tail, no image",
  };
  const arms = {};
  for (const k of ARMS) {
    const parts = armParts[k];
    const prompt = parts[0].text;
    const modelRequest = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: GENERATION_CONFIG });
    arms[k] = {
      what: armWhat[k], contract: k === "C" ? V4_CONTRACT : body.fieldContract,
      partCount: parts.length, modelInputImageCount: parts.filter((p) => p.inlineData?.data).length,
      promptChars: prompt.length, promptSha256: sha(prompt), creativeSha256: sha(creative),
      tail: k === "C" ? tailV4 : tailV3, modelRequestByteSize: Buffer.byteLength(modelRequest, "utf8"),
    };
    writeFileSync(join(OUT, `prompt-arm-${k}.txt`), prompt + (k === "B" ? `\n\n[+ text part] ${HOUDINI_REFERENCE_TEXT}\n[+ image part] ${HOUDINI_LAYOUT}` : ""));
    log(`arm ${k}: ${armWhat[k]} — ${parts.length} part(s), ${arms[k].modelInputImageCount} image(s), prompt ${prompt.length} chars sha ${arms[k].promptSha256.slice(0, 16)}`);
  }
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({ model: call1.AUTHORING_MODEL, generationConfig: GENERATION_CONFIG, drawsPerArm: DRAWS, arms, input: V3_INPUT }, null, 2));
  const produced = ["requests.json", "territories.json", ...ARMS.map((k) => `prompt-arm-${k}.txt`)];

  if (captureOnly) {
    log("capture-only: requests written, no provider call made");
    writeFileSync(join(OUT, "results.json"), JSON.stringify({ captureOnly: true, imageRequestsExecuted: 0, arms }, null, 2));
    writeFileSync(join(OUT, "REPORT.md"), reportMarkdown({ arms, draws: [], fieldManifest, model: call1.AUTHORING_MODEL }));
    return finish(supabase, [...produced, "results.json", "REPORT.md"]);
  }

  // ── 3. Interleaved draws, each gated and cut exactly as the fail-over ─────
  const draws = [];
  let imageRequestsExecuted = 0;
  for (let draw = 1; draw <= DRAWS; draw += 1) {
    for (const arm of ARMS) {
      const label = `${arm}${draw}`;
      const parts = armParts[arm];
      const started = Date.now();
      try {
        log(`${label}: calling ${call1.AUTHORING_MODEL} …`);
        imageRequestsExecuted += 1;
        const result = await provider.generateRaw({
          model: call1.AUTHORING_MODEL,
          body: { contents: [{ role: "user", parts }], generationConfig: GENERATION_CONFIG },
          timeoutMs: 300_000,
          label: `field arms ${label}`,
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
          panelRecords.push({ surfaceKey: p.surfaceKey, contentHash: p.contentHash, pixelWidth: p.pixelWidth, pixelHeight: p.pixelHeight });
        }
        const telemetry = await canvasTelemetry(rawBytes);
        const record = {
          ok: true, label, arm, draw, file: rawFile, preview, bytes: rawBytes.length, elapsedMs: Date.now() - started,
          contentHash: sha(rawBytes), normalizedHash: masterHash, model: result.model, keyFingerprint: result.keyFingerprint,
          delivered: { width: normalized.deliveredWidthPx, height: normalized.deliveredHeightPx, nativelyFourK: normalized.nativelyFourK },
          deterministic: {
            accepted: checks.accepted, blockingFailures: checks.blockingFailures, cutoutFindings: checks.cutoutFindings.map((f) => f.finding || f),
            zones: (checks.zones || []).map((z) => ({ surfaceKey: z.surfaceKey, edgeHoleRatio: Number((z.edgeHoleRatio ?? 0).toFixed(4)),
              concentratedFlatBlackRatio: Number((z.concentratedFlatBlackRatio ?? 0).toFixed(4)), lumaStddev: Number((z.lumaStddev ?? 0).toFixed(2)) })),
          },
          outputClass: { disposition: klass.disposition, blocking: klass.blocking, confidence: klass.confidence, evidence: klass.evidence, code: klass.code, reason: klass.reason },
          centreDistinctness: await centreDistinctness(panels),
          telemetry,
          panels: panelRecords,
        };
        draws.push(record);
        log(`${label}: ${checks.accepted ? "gates PASS" : "gates REFUSE"} (${checks.cutoutFindings.length} cut-out) · class ${klass.disposition} · white ${pct(telemetry.nearWhiteShare)} · grey ${pct(telemetry.neutralGreyShare)} · ring std ${telemetry.borderRing.lumaStd}`);
      } catch (error) {
        log(`${label}: FAILED — ${error.message}`);
        draws.push({ ok: false, label, arm, draw, error: String(error.message).slice(0, 500) });
      }
    }
  }
  log(`gemini image requests executed: ${imageRequestsExecuted}`);
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ arms, drawsPerArm: DRAWS, imageRequestsExecuted, draws }, null, 2));
  writeFileSync(join(OUT, "REPORT.md"), reportMarkdown({ arms, draws, fieldManifest, model: call1.AUTHORING_MODEL }));
  produced.push("results.json", "REPORT.md");
  return finish(supabase, produced);
}

async function finish(supabase, produced) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `designiq-ab/${stamp}-field-arms`;
  const urls = {};
  for (const file of produced) {
    try {
      const isText = /\.(txt|md|log)$/.test(file);
      const path = `${prefix}/${file}${isText ? ".json" : ""}`;
      const raw = readFileSync(join(OUT, file));
      const body = isText ? Buffer.from(JSON.stringify({ file, text: raw.toString("utf8") })) : raw;
      const contentType = file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") ? "image/jpeg" : "application/json";
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

if (process.argv[1] && process.argv[1].endsWith("atlas-field-arms-ab.mjs")) {
  main().catch((error) => {
    console.error(`atlas-field-arms-ab failed: ${error?.stack || error}`);
    process.exit(1);
  });
}
