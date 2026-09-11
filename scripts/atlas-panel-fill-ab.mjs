#!/usr/bin/env node
/**
 * TEST 16 — MASKED GENERATIVE FILL OF A CUT-OUT ON A REAL FLAT PANEL. Harness only.
 *
 * Owner directive (Trish, 2026-09-11): do not reverse the 2026-08-29 ruling;
 * flat-panel-first A.T.L.A.S. stays; "treat the wheel-well gaps as an
 * automated post-process step: a secondary generative fill/inpaint mask over
 * the cutouts using the flank's latent style, extending the graphic bleed so
 * installer panels never have missing territory. Fix the fill step on the
 * flat master."
 *
 * What exists today: (a) `fillMasterCutouts`, deterministic boundary
 * averaging — on 5d727ea9 it closed 303,861 px of the driver disc into
 * near-black (RULE 0.32: "turning a missing-artwork field into nearly-black
 * pixels is not repair"); (b) the per-surface finishing edit (`atlas-panel`,
 * v5) — a whole-sheet regeneration with no mask, so the model may redraw
 * anything and did refuse twice on two surfaces on 2026-09-09.
 *
 * This test is the owner's step, measured on the owner's own example: the
 * accepted 911 Cyberspace master `2165a36c…` (generation 5d727ea9), whose
 * Driver and Passenger panels carry a black wheel disc each.
 *
 *   1. MASK — built by the gate's own predicate (`convictedHoleMask`, the
 *      exact criteria the cut-out finding uses), dilated a few pixels so the
 *      fill covers the rim too. Written out as a PNG so a human can see what
 *      was asked for.
 *   2. FILL — ONE edit turn to the authoring model: subject panel + mask +
 *      the master as visual-DNA reference, and an instruction to paint the
 *      white region only as a continuation of the surrounding artwork. No
 *      aspect ratio (an edit follows its input), 4K, as the finishing handler
 *      sends it.
 *   3. COMPOSITE IN CODE — the model's pixels are taken ONLY inside the
 *      (feathered) mask; everything outside is the original panel byte for
 *      byte. So "change nothing else" is enforced by the compositor, not
 *      trusted to the model, and drift outside the mask is measured, not
 *      hoped against.
 *   4. GATE — the composite is re-run through `deterministicMasterChecks`
 *      and the colour-blind full-bleed metric, beside the deterministic fill
 *      of the same panel for comparison.
 *
 * `--draws` is per surface (1–2). Two surfaces × two draws = four image calls.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fullBleedMetrics } from "./atlas-fullbleed-metrics.mjs";

const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
const { createClient } = require_("@supabase/supabase-js");
const sharp = require_("sharp");
const qc = require_("./atlas-master-qc.cjs");
const { fillMasterCutouts, _test: fillTest } = require_("./atlas-cutout-fill.cjs");
const { createProvider } = require_("./generation-provider.cjs");
const { normalizeAtlasMaster } = require_("./flat-first-atlas.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const OUT = args.out || "./ab-evidence";
mkdirSync(OUT, { recursive: true });
const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const truthy = (v) => String(v).toLowerCase() === "true";
const pct = (v) => `${(v * 100).toFixed(2)}%`;

const GENERATION = String(args.generation || "").trim();
if (!/^[0-9a-f-]{8,36}$/.test(GENERATION)) throw new Error("--generation <id or 8-char prefix> is required");
const SURFACES = String(args.surfaces || "driver,passenger").split(",").map((s) => s.trim()).filter(Boolean);
const DRAWS = Math.min(2, Math.max(1, Number(args.draws || 1)));
const DILATE_PX = Math.max(0, Number(args.dilate || 24));
const FEATHER_PX = Math.max(1, Number(args.feather || 10));
const MODEL = String(args.model || "gemini-3-pro-image").trim();
// The stored panels of an accepted revision are cut from the ACCEPTED master,
// which on a six-surface run is the deterministically filled sheet: the disc
// is already rgb(25,19,23), one value outside the near-black predicate, so the
// gate mask finds nothing (run 34571865270: 0 image calls). The raw Call-1
// candidate the edge stored (`atlas-call1/<requestId>.png`) is the sheet the
// fill step would actually receive in production, so the subject is rebuilt
// from it exactly as production does: normalize, then `zone.extraction` crop
// and rotation. Its hash is checked against the revision's `preRepairMasterHash`.
const RAW_MASTER = String(args["raw-master"] || "").trim();
const REFERENCE_EDGE = 1024;
const ALL = ["driver", "passenger", "hood", "roof", "front", "rear"];

// No vehicle noun anywhere. Structured like the finishing handler's prompt
// (attachment order declared), with the one new input: the mask.
export function fillPrompt() {
  return [
    "<task>",
    "Generate an image: the subject sheet with its marked area completed.",
    "</task>",
    "",
    "<inputs>",
    '  <sheet role="subject">The flat printed sheet to complete and return, at exactly the shape it arrived in.</sheet>',
    '  <mask role="fill-region">The same size as the subject. WHITE marks the only area to paint. BLACK is finished artwork that stays exactly as it is.</mask>',
    '  <reference role="visual-dna">The complete design this sheet belongs to, all of its sheets laid out together. The authority for palette, motif family, line weight and texture. Read it for consistency; do not redraw it and do not copy its layout.</reference>',
    "</inputs>",
    "",
    "<instructions>",
    "Return the subject sheet with the white area of the mask painted as a continuation of the artwork around it: the same ground, the same palette, the same motifs and motion flowing straight through that area, so no seam, edge, ring or boundary remains and the sheet reads as one continuous printed graphic, corner to corner, running off all four edges.",
    "Everything outside the white area stays pixel for pixel as it arrived.",
    "Add nothing else: no new subjects, no borders, no margins, no captions, no labels, no annotation.",
    "</instructions>",
  ].join("\n");
}

async function preview(bytes, file, width = 1600) {
  writeFileSync(join(OUT, file), await sharp(bytes, { limitInputPixels: false })
    .resize({ width, height: width, fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 84 }).toBuffer());
  return file;
}

/** Binary mask (0/255, 1 channel) of the gate-convicted holes, dilated. */
async function buildMask(panelBytes) {
  const { data, info } = await sharp(panelBytes, { limitInputPixels: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const found = fillTest.convictedHoleMask({ data, width: info.width, height: info.height, channels: info.channels });
  if (!found.mask) return { mask: null, pixels: 0, components: 0, width: info.width, height: info.height };
  const raw = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < raw.length; i += 1) raw[i] = found.mask[i] ? 255 : 0;
  let mask = sharp(raw, { raw: { width: info.width, height: info.height, channels: 1 } }).png();
  if (DILATE_PX > 0) {
    // Dilate: blur then threshold anything touched.
    const blurred = await sharp(await mask.toBuffer()).blur(DILATE_PX / 2).threshold(1).png().toBuffer();
    mask = sharp(blurred);
  }
  const bytes = await mask.png().toBuffer();
  return { mask: bytes, pixels: found.pixels, components: found.components, width: info.width, height: info.height };
}

/** Panel with the mask tinted red, for the human. */
async function maskOverlay(panelBytes, maskBytes) {
  const { width, height } = await sharp(panelBytes, { limitInputPixels: false }).metadata();
  const red = await sharp({ create: { width, height, channels: 4, background: { r: 255, g: 40, b: 40, alpha: 0.55 } } })
    .joinChannel(await sharp(maskBytes).extractChannel(0).raw().toBuffer(), { raw: { width, height, channels: 1 } })
    .png().toBuffer();
  // joinChannel appended the mask as a 5th channel; rebuild as RGBA with mask-scaled alpha instead.
  const maskRaw = await sharp(maskBytes).extractChannel(0).raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 40; rgba[i * 4 + 2] = 40; rgba[i * 4 + 3] = maskRaw[i] ? 140 : 0; }
  void red;
  return sharp(panelBytes, { limitInputPixels: false }).composite([{ input: rgba, raw: { width, height, channels: 4 } }]).png().toBuffer();
}

/** Take the model's pixels only inside the feathered mask; the original everywhere else. */
async function compositeInsideMask(subjectBytes, aiBytes, maskBytes) {
  const { width, height } = await sharp(subjectBytes, { limitInputPixels: false }).metadata();
  const aiFit = await sharp(aiBytes, { limitInputPixels: false }).resize(width, height, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const feathered = await sharp(maskBytes).blur(FEATHER_PX).extractChannel(0).raw().toBuffer();
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    rgba[i * 4] = aiFit[i * 3]; rgba[i * 4 + 1] = aiFit[i * 3 + 1]; rgba[i * 4 + 2] = aiFit[i * 3 + 2]; rgba[i * 4 + 3] = feathered[i];
  }
  return sharp(subjectBytes, { limitInputPixels: false }).composite([{ input: rgba, raw: { width, height, channels: 4 } }]).png().toBuffer();
}

/** Mean absolute RGB difference between the model's full output and the subject, outside the mask (drift), and inside (change). */
async function driftMetrics(subjectBytes, aiBytes, maskBytes) {
  const S = 768;
  const { width, height } = await sharp(subjectBytes, { limitInputPixels: false }).metadata();
  const h = Math.max(1, Math.round(S * height / width));
  const a = await sharp(subjectBytes, { limitInputPixels: false }).resize(S, h, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const b = await sharp(aiBytes, { limitInputPixels: false }).resize(S, h, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const m = await sharp(maskBytes).resize(S, h, { fit: "fill" }).extractChannel(0).raw().toBuffer();
  let outSum = 0, outN = 0, inSum = 0, inN = 0;
  for (let i = 0; i < S * h; i += 1) {
    const d = (Math.abs(a[i * 3] - b[i * 3]) + Math.abs(a[i * 3 + 1] - b[i * 3 + 1]) + Math.abs(a[i * 3 + 2] - b[i * 3 + 2])) / 3;
    if (m[i] > 127) { inSum += d; inN += 1; } else { outSum += d; outN += 1; }
  }
  return { outsideMaskMeanAbsDiff: Number((outSum / Math.max(1, outN)).toFixed(2)), insideMaskMeanAbsDiff: Number((inSum / Math.max(1, inN)).toFixed(2)) };
}

async function gatePanel(bytes, surfaceKey, printWidthIn, printHeightIn) {
  const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  const bleedX = Math.round(5 * meta.width / printWidthIn);
  const bleedY = Math.round(5 * meta.height / printHeightIn);
  const rect = { x: 0, y: 0, w: meta.width, h: meta.height, trim: { x: bleedX, y: bleedY, w: meta.width - 2 * bleedX, h: meta.height - 2 * bleedY },
    printWidthIn, printHeightIn, rotationDegrees: 0, placement: "center-column", guideFill: "#e5e5e5" };
  const manifest = { canvas: { widthPx: meta.width, heightPx: meta.height }, zones: ALL.map((k) => ({ ...rect, surfaceKey: k })) };
  const checks = await qc.deterministicMasterChecks(bytes, manifest);
  const z = checks.zones.find((x) => x.surfaceKey === surfaceKey) || checks.zones[0];
  const bleed = await fullBleedMetrics(bytes, { zones: [{ surfaceKey, rect: { x: 0, y: 0, w: meta.width, h: meta.height } }] });
  return {
    accepted: checks.accepted, blockingFailures: [...new Set(checks.blockingFailures)].slice(0, 3),
    cutoutFindings: [...new Set((checks.cutoutFindings || []).map((f) => f.finding || f))].slice(0, 3),
    largestCutoutComponentRatio: Number((z.largestCutoutComponentRatio ?? 0).toFixed(5)), edgeHoleRatio: Number((z.edgeHoleRatio ?? 0).toFixed(4)),
    fullBleed: bleed.zones[surfaceKey],
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
  const provider = createProvider({ env: process.env });

  // ── the revision and its panels ──────────────────────────────────────────
  // `generation_id` is a uuid column, so a LIKE prefix is a type error in
  // PostgREST (`uuid ~~ unknown`). Same resolution as atlas-measure-master.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(GENERATION);
  let query = supabase.from("designpro_flat_atlas_revisions")
    .select("generation_id,master_storage_path,master_content_hash,manifest,metadata,created_at")
    .order("created_at", { ascending: false });
  query = isUuid ? query.eq("generation_id", GENERATION).limit(1) : query.limit(200);
  const { data: found, error } = await query;
  if (error) throw new Error(`revision lookup failed for ${GENERATION}: ${error.message}`);
  const rows = isUuid ? found : (found || []).filter((r) => String(r.generation_id).startsWith(GENERATION.toLowerCase()));
  if (!rows?.length) throw new Error(`revision not found for ${GENERATION}`);
  const row = rows[0];
  const panels = (row.metadata?.callOnePanels || []).filter((p) => SURFACES.includes(p.surfaceKey));
  if (panels.length !== SURFACES.length) throw new Error(`panels ${SURFACES.join(",")} not all present on ${row.generation_id}`);
  const download = async (path) => {
    const { data, error: dErr } = await supabase.storage.from("wrap-files").download(path);
    if (dErr || !data) throw new Error(`download ${path}: ${dErr?.message || "missing"}`);
    return Buffer.from(await data.arrayBuffer());
  };
  const masterBytes = await download(row.master_storage_path);
  const masterRef = await sharp(masterBytes, { limitInputPixels: false }).resize({ width: REFERENCE_EDGE, height: REFERENCE_EDGE, fit: "inside" }).jpeg({ quality: 88 }).toBuffer();
  const produced = [await preview(masterBytes, "master-1600.jpg")];
  log(`generation ${row.generation_id} master ${row.master_content_hash.slice(0, 12)} · ${panels.length} panel(s) · model ${MODEL} · dilate ${DILATE_PX}px feather ${FEATHER_PX}px`);
  writeFileSync(join(OUT, "prompt-fill.txt"), fillPrompt()); produced.push("prompt-fill.txt");

  // ── the raw, pre-fill sheet, when asked for ──────────────────────────────
  let rawNormalized = null;
  let rawProvenance = null;
  if (RAW_MASTER) {
    const rawBytes = await download(RAW_MASTER);
    const rawHash = sha(rawBytes);
    rawNormalized = await normalizeAtlasMaster(rawBytes, row.manifest);
    const normalizedHash = sha(rawNormalized);
    const preRepair = String(row.metadata?.preRepairMasterHash || "");
    rawProvenance = { storagePath: RAW_MASTER, rawHash, normalizedHash, preRepairMasterHash: preRepair || null, matchesPreRepair: Boolean(preRepair) && normalizedHash === preRepair };
    log(`raw master ${RAW_MASTER}: raw ${rawHash.slice(0, 12)} → normalized ${normalizedHash.slice(0, 12)} · preRepairMasterHash ${preRepair.slice(0, 12) || "none"} · ${rawProvenance.matchesPreRepair ? "MATCH" : "no match (proceeding on the normalized raw sheet)"}`);
    produced.push(await preview(rawNormalized, "master-raw-normalized-1600.jpg"));
  }
  const rawPanel = async (key) => {
    const zone = (row.manifest?.zones || []).find((z) => z.surfaceKey === key);
    if (!zone?.extraction) throw new Error(`${key}: manifest zone has no extraction rect`);
    const { x, y, w, h, outputRotationDegrees = 0 } = zone.extraction;
    return sharp(rawNormalized, { limitInputPixels: false })
      .extract({ left: Number(x), top: Number(y), width: Number(w), height: Number(h) })
      .rotate(Number(outputRotationDegrees))
      .png({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true })
      .toBuffer();
  };

  const results = [];
  let imageRequestsExecuted = 0;
  for (const panel of panels) {
    const key = panel.surfaceKey;
    const stored = await download(panel.storagePath);
    if (sha(stored) !== String(panel.contentHash)) throw new Error(`${key}: panel bytes do not match the revision's hash`);
    const printWidthIn = Number(panel.printWidthIn), printHeightIn = Number(panel.printHeightIn);
    let subject = stored;
    if (rawNormalized) {
      subject = await rawPanel(key);
      const [a, b] = await Promise.all([sharp(subject).metadata(), sharp(stored).metadata()]);
      if (a.width !== b.width || a.height !== b.height) throw new Error(`${key}: raw cut ${a.width}x${a.height} does not match the stored panel ${b.width}x${b.height}`);
      produced.push(await preview(stored, `${key}-0-stored-accepted-1600.jpg`));
    }
    produced.push(await preview(subject, `${key}-0-original-1600.jpg`));
    const record = { surfaceKey: key, storagePath: panel.storagePath, contentHash: panel.contentHash, subject: rawNormalized ? "raw-call1-candidate" : "stored-accepted-panel", subjectHash: sha(subject), printWidthIn, printHeightIn, draws: [] };
    results.push(record);
    record.before = await gatePanel(subject, key, printWidthIn, printHeightIn);
    log(`${key}: original gate ${record.before.accepted ? "PASS" : "REFUSE"} · cut-outs ${record.before.cutoutFindings.length} · largest ${record.before.largestCutoutComponentRatio}`);

    const m = await buildMask(subject);
    record.mask = { pixels: m.pixels, components: m.components, share: Number((m.pixels / (m.width * m.height)).toFixed(5)) };
    if (!m.mask) { log(`${key}: no convicted hole; nothing to fill`); continue; }
    writeFileSync(join(OUT, `${key}-1-mask.png`), m.mask); produced.push(`${key}-1-mask.png`);
    produced.push(await preview(await maskOverlay(subject, m.mask), `${key}-1-mask-overlay-1600.jpg`));
    log(`${key}: mask ${m.components} component(s), ${pct(record.mask.share)} of the panel`);

    // Deterministic fill, for the comparison column.
    const meta = await sharp(subject, { limitInputPixels: false }).metadata();
    const det = await fillMasterCutouts(subject, { zones: [{ surfaceKey: key, x: 0, y: 0, w: meta.width, h: meta.height }] }, [key]);
    if (det.changed) {
      produced.push(await preview(det.bytes, `${key}-2-deterministic-fill-1600.jpg`));
      record.deterministic = await gatePanel(det.bytes, key, printWidthIn, printHeightIn);
      log(`${key}: deterministic fill gate ${record.deterministic.accepted ? "PASS" : "REFUSE"} · cut-outs ${record.deterministic.cutoutFindings.length}`);
    }

    if (captureOnly) continue;
    const parts = [
      { inlineData: { mimeType: "image/png", data: subject.toString("base64") } },
      { inlineData: { mimeType: "image/png", data: m.mask.toString("base64") } },
      { inlineData: { mimeType: "image/jpeg", data: masterRef.toString("base64") } },
      { text: fillPrompt() },
    ];
    for (let draw = 1; draw <= DRAWS; draw += 1) {
      const started = Date.now();
      const label = `${key}-fill-${draw}`;
      try {
        log(`${label}: calling ${MODEL} (subject + mask + master reference) …`);
        imageRequestsExecuted += 1;
        const result = await provider.generateRaw({
          model: MODEL,
          body: { contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { imageSize: "4K" } } },
          timeoutMs: 300_000, label,
        });
        const cparts = result.payload?.candidates?.[0]?.content?.parts || [];
        const image = cparts.filter((p) => p?.inlineData?.data).pop();
        if (!image) throw new Error(`no image (${result.payload?.candidates?.[0]?.finishReason || result.payload?.promptFeedback?.blockReason || "unknown"})`);
        const ai = Buffer.from(image.inlineData.data, "base64");
        const aiMeta = await sharp(ai, { limitInputPixels: false }).metadata();
        produced.push(await preview(ai, `${key}-3-ai-raw-${draw}-1600.jpg`));
        const composite = await compositeInsideMask(subject, ai, m.mask);
        writeFileSync(join(OUT, `${key}-4-composite-${draw}.png`), composite); produced.push(`${key}-4-composite-${draw}.png`);
        produced.push(await preview(composite, `${key}-4-composite-${draw}-1600.jpg`));
        const drift = await driftMetrics(subject, ai, m.mask);
        const after = await gatePanel(composite, key, printWidthIn, printHeightIn);
        record.draws.push({ draw, ok: true, elapsedMs: Date.now() - started, aiWidth: aiMeta.width, aiHeight: aiMeta.height, aiSha256: sha(ai), compositeSha256: sha(composite), drift, after });
        log(`${label}: ${aiMeta.width}×${aiMeta.height} in ${((Date.now() - started) / 1000).toFixed(1)}s · composite gate ${after.accepted ? "PASS" : "REFUSE"} · cut-outs ${after.cutoutFindings.length} · largest ${after.largestCutoutComponentRatio} · drift outside mask ${drift.outsideMaskMeanAbsDiff} inside ${drift.insideMaskMeanAbsDiff}`);
      } catch (err) {
        record.draws.push({ draw, ok: false, error: String(err.message).slice(0, 400) });
        log(`${label}: FAILED — ${err.message}`);
      }
    }
  }

  log(`gemini image requests executed: ${imageRequestsExecuted}`);
  const rows2 = [];
  for (const r of results) {
    rows2.push(`| ${r.surfaceKey} | original | ${r.before.accepted ? "pass" : "REFUSE"} · ${r.before.cutoutFindings.length} cut-out · largest ${r.before.largestCutoutComponentRatio} | ${pct(r.before.fullBleed?.nonArtworkRatio ?? 0)} | | |`);
    if (r.deterministic) rows2.push(`| ${r.surfaceKey} | deterministic fill | ${r.deterministic.accepted ? "pass" : "REFUSE"} · ${r.deterministic.cutoutFindings.length} cut-out · largest ${r.deterministic.largestCutoutComponentRatio} | ${pct(r.deterministic.fullBleed?.nonArtworkRatio ?? 0)} | | |`);
    for (const d of r.draws) {
      rows2.push(d.ok
        ? `| ${r.surfaceKey} | masked AI fill ${d.draw} | ${d.after.accepted ? "pass" : "REFUSE"} · ${d.after.cutoutFindings.length} cut-out · largest ${d.after.largestCutoutComponentRatio} | ${pct(d.after.fullBleed?.nonArtworkRatio ?? 0)} | out ${d.drift.outsideMaskMeanAbsDiff} / in ${d.drift.insideMaskMeanAbsDiff} | ${(d.elapsedMs / 1000).toFixed(1)}s |`
        : `| ${r.surfaceKey} | masked AI fill ${d.draw} | FAILED ${d.error} | | | |`);
    }
  }
  const report = [
    `# Test 16 — masked generative fill on the flat panel (generation ${row.generation_id.slice(0, 8)}, master ${row.master_content_hash.slice(0, 12)})`,
    "",
    `Model \`${MODEL}\`, edit turn (subject + gate mask + master reference), 4K, no aspect (an edit follows its input). Mask dilated ${DILATE_PX}px, feathered ${FEATHER_PX}px at composite. The model's pixels are taken ONLY inside the mask; drift is the model's raw output measured against the original outside the mask (mean abs RGB, 0-255).`,
    "",
    "| surface | candidate | deterministic gate | colour-blind non-artwork | model drift outside / change inside mask | time |",
    "|---|---|---|---|---|---|",
    ...rows2,
    "",
    "Files per surface: `-0-original`, `-1-mask`, `-1-mask-overlay`, `-2-deterministic-fill`, `-3-ai-raw-N` (the model's whole output), `-4-composite-N` (what the pipeline would keep).",
    "",
  ].join("\n");
  writeFileSync(join(OUT, "REPORT.md"), report);
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ generation: row.generation_id, master: row.master_content_hash, rawMaster: rawProvenance, model: MODEL, dilatePx: DILATE_PX, featherPx: FEATHER_PX, imageRequestsExecuted, results }, null, 2));
  produced.push("REPORT.md", "results.json");
  return finish(supabase, produced);
}

async function finish(supabase, produced) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `designiq-ab/${stamp}-panel-fill`;
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

if (process.argv[1] && process.argv[1].endsWith("atlas-panel-fill-ab.mjs")) {
  main().catch((error) => {
    console.error(`atlas-panel-fill-ab failed: ${error?.stack || error}`);
    process.exit(1);
  });
}
