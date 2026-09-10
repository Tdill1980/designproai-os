#!/usr/bin/env node
/**
 * TEST 13 — PANEL EXTEND: the professional two-layer A.T.L.A.S. workflow.
 * Harness only. Not production. Owner-directed ("NOW GO", Trish 2026-09-10).
 *
 * Houdini Wraps' sheet has two layers. DESIGN LAYOUT: the wrap drawn on the
 * vehicle's flattened silhouette, placed for the body, never printed. PANEL
 * LAYOUT: rectangles drawn over it, each larger than the body piece beneath,
 * with the artwork continued past every body line to the rectangle's edges.
 * Those rectangles are the print files.
 *
 * Gemini produces the DESIGN LAYOUT on its own every time it is asked for the
 * six-surface sheet (17 of 17 draws). What it does not do is skip to the
 * PANEL LAYOUT. So this test does what the professional does: it takes a
 * pressed design layout the model already drew (a refused raw Call-1
 * candidate) and, in an EDIT turn with that image provided, asks for ONE
 * surface's print rectangle at its real GENIE aspect — the artwork continued
 * to every edge, no body lines — and gates the rectangle with the production
 * code. Owner acceptance: a flattened-topology design of a flattened vehicle,
 * meaning no body lines.
 *
 * One image call per surface. No deploy, no row, no revision. Evidence only.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fullBleedMetrics } from "./atlas-fullbleed-metrics.mjs";

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
const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const truthy = (v) => String(v).toLowerCase() === "true";

const VEHICLE = {
  type: args["vehicle-type"] || "car",
  year: args["vehicle-year"] || "2021",
  make: args["vehicle-make"] || "Porsche",
  model: args["vehicle-model"] || "911 turbo",
};
const DESIGN_LAYOUT = String(args["design-layout"] || "").trim();
if (!/^(atlas-call1|designpro)\/[^\s,]+\.(png|jpg|jpeg|webp)$/.test(DESIGN_LAYOUT)) {
  throw new Error("--design-layout must be a wrap-files path under atlas-call1/ or designpro/");
}
const SURFACES = String(args.surfaces || "driver,hood").split(",").map((s) => s.trim()).filter(Boolean);
const ALL = ["driver", "passenger", "hood", "roof", "front", "rear"];
for (const s of SURFACES) if (!ALL.includes(s)) throw new Error(`unknown surface ${s}`);
if (SURFACES.length > 6) throw new Error("at most six surfaces");
const IMAGE_SIZE = ["1K", "2K", "4K"].includes(args["image-size"]) ? args["image-size"] : "2K";
const CLASSIFY = truthy(args.classify ?? "true");

const LABEL = { driver: "DRIVER SIDE", passenger: "PASSENGER SIDE", hood: "HOOD", roof: "ROOF", front: "FRONT", rear: "REAR" };
// Gemini 3 Pro Image aspect ratios (docs 2026-09-04). The closest one to the
// GENIE print aspect is requested; the returned image is gated as-is.
const RATIOS = [[1, 1], [3, 2], [2, 3], [4, 3], [3, 4], [4, 5], [5, 4], [16, 9], [9, 16], [21, 9], [4, 1], [1, 4], [8, 1], [1, 8]];
function closestRatio(w, h) {
  const target = w / h;
  let best = RATIOS[0]; let err = Infinity;
  for (const [a, b] of RATIOS) { const e = Math.abs(Math.log(a / b) - Math.log(target)); if (e < err) { err = e; best = [a, b]; } }
  return { aspectRatio: `${best[0]}:${best[1]}`, ratioError: Number(err.toFixed(4)) };
}

/**
 * The edit-turn text. Positive, per Gemini's own guidance and RULE 0.28: it
 * says what the rectangle IS (the artwork continued to every edge, as on the
 * roll before installation) and never names a body part to avoid.
 */
function extendPrompt({ vehicle, label, printWidthIn, printHeightIn }) {
  return [
    `The provided image is this wrap design pressed flat onto the ${vehicle}: the design layout.`,
    `From it, produce the ${label} print panel: one flat rectangle of printed vinyl, ${printWidthIn} by ${printHeightIn} inches, carrying exactly the artwork that covers the ${label.toLowerCase()} in the design layout, at the same placement, colours, lettering and wear.`,
    "The rectangle is the artwork alone, the way the vinyl looks on the roll before installation: the stripes, textures, lettering and colours continue without interruption across the whole rectangle and run off all four edges. Wherever the pressed design shows a gap or an outline, the surrounding artwork continues straight through it, so the rectangle is solid printed artwork corner to corner with no outline, no gap and no background.",
    "Keep everything about the design exactly as in the provided image; change nothing else. Straight-on, flat, full bleed.",
  ].join("\n");
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const captureOnly = truthy(args["capture-only"]);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const provider = createProvider({ env: process.env });
  const model = require_("./designiq-prompt.cjs").DESIGNPANEL_AUTHORING_MODEL;

  log("resolving GENIE preview dimensions …");
  const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, VEHICLE, provider);
  const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
  const manifest = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority, VEHICLE.type);
  const zoneOf = (key) => manifest.zones.find((z) => z.surfaceKey === key);

  const { data: blob, error } = await supabase.storage.from("wrap-files").download(DESIGN_LAYOUT);
  if (error || !blob) throw new Error(`design layout download failed: ${error?.message || "missing"}`);
  const designBytes = Buffer.from(await blob.arrayBuffer());
  const designMeta = await sharp(designBytes, { limitInputPixels: false }).metadata();
  writeFileSync(join(OUT, "design-layout-1600.jpg"), await sharp(designBytes, { limitInputPixels: false })
    .resize({ width: 1600, height: 1600, fit: "inside" }).jpeg({ quality: 84 }).toBuffer());
  const designMime = designMeta.format === "png" ? "image/png" : designMeta.format === "webp" ? "image/webp" : "image/jpeg";
  log(`design layout ${DESIGN_LAYOUT}: ${designMeta.width}×${designMeta.height} ${designMeta.format}, sha ${sha(designBytes).slice(0, 16)}`);

  const vehicle = `${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}`;
  const plan = SURFACES.map((key) => {
    const z = zoneOf(key);
    const ratio = closestRatio(z.printWidthIn, z.printHeightIn);
    return { surfaceKey: key, label: LABEL[key], printWidthIn: z.printWidthIn, printHeightIn: z.printHeightIn, ...ratio,
      prompt: extendPrompt({ vehicle, label: LABEL[key], printWidthIn: z.printWidthIn, printHeightIn: z.printHeightIn }) };
  });
  writeFileSync(join(OUT, "requests.json"), JSON.stringify({ vehicle: VEHICLE, designLayout: DESIGN_LAYOUT, model, imageSize: IMAGE_SIZE, plan }, null, 2));
  for (const p of plan) log(`${p.surfaceKey}: ${p.printWidthIn}×${p.printHeightIn} in → aspect ${p.aspectRatio} (log error ${p.ratioError}), ${IMAGE_SIZE}`);
  if (captureOnly) { log("capture-only: no provider call"); writeFileSync(join(OUT, "REPORT.md"), "capture-only\n"); return; }

  const results = [];
  for (const p of plan) {
    const started = Date.now();
    try {
      log(`${p.surfaceKey}: calling ${model} (edit turn, 1 image + 1 text) …`);
      const result = await provider.generateRaw({
        model,
        body: {
          contents: [{ role: "user", parts: [
            { inlineData: { mimeType: designMime, data: designBytes.toString("base64") } },
            { text: p.prompt },
          ] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: p.aspectRatio, imageSize: IMAGE_SIZE } },
        },
        timeoutMs: 300_000,
        label: `panel extend ${p.surfaceKey}`,
      });
      const parts = result.payload?.candidates?.[0]?.content?.parts || [];
      const images = parts.filter((x) => x?.inlineData?.data);
      const image = images[images.length - 1];
      if (!image) throw new Error(`no image (${result.payload?.candidates?.[0]?.finishReason || "unknown"})`);
      const bytes = Buffer.from(image.inlineData.data, "base64");
      const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
      const file = `${p.surfaceKey}-panel-raw.png`;
      writeFileSync(join(OUT, file), await sharp(bytes, { limitInputPixels: false }).png().toBuffer());
      writeFileSync(join(OUT, `${p.surfaceKey}-panel-1600.jpg`), await sharp(bytes, { limitInputPixels: false })
        .resize({ width: 1600, height: 1600, fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 84 }).toBuffer());
      // Gate the rectangle as one zone covering the whole returned image, with
      // the 5-inch bleed inset as its trim; driver/passenger are required by
      // the gate, so the single rectangle is registered under every key.
      const bleedX = Math.round(5 * meta.width / p.printWidthIn);
      const bleedY = Math.round(5 * meta.height / p.printHeightIn);
      const rect = { x: 0, y: 0, w: meta.width, h: meta.height, trim: { x: bleedX, y: bleedY, w: meta.width - 2 * bleedX, h: meta.height - 2 * bleedY },
        printWidthIn: p.printWidthIn, printHeightIn: p.printHeightIn, rotationDegrees: 0, placement: "center-column", guideFill: "#e5e5e5" };
      const gateManifest = { canvas: { widthPx: meta.width, heightPx: meta.height }, zones: ALL.map((k) => ({ ...rect, surfaceKey: k })) };
      let gate = null;
      try {
        const checks = await qc.deterministicMasterChecks(bytes, gateManifest);
        const z = checks.zones.find((x) => x.surfaceKey === p.surfaceKey) || checks.zones[0];
        gate = { accepted: checks.accepted, blockingFailures: [...new Set(checks.blockingFailures)].slice(0, 3), cutoutFindings: [...new Set((checks.cutoutFindings || []).map((f) => f.finding || f))].slice(0, 3),
          nonBlackFraction: Number((z.nonBlackFraction ?? 0).toFixed(4)), edgeHoleRatio: Number((z.edgeHoleRatio ?? 0).toFixed(4)),
          largestCutoutComponentRatio: Number((z.largestCutoutComponentRatio ?? 0).toFixed(4)), lumaStddev: Number((z.lumaStddev ?? 0).toFixed(2)) };
      } catch (err) { gate = { error: String(err?.message || err).slice(0, 300) }; }
      const bleed = await fullBleedMetrics(bytes, { zones: [{ surfaceKey: p.surfaceKey, rect: { x: 0, y: 0, w: meta.width, h: meta.height } }] });
      const trim = await fullBleedMetrics(bytes, { zones: [{ surfaceKey: p.surfaceKey, rect: rect.trim }] });
      const klass = CLASSIFY ? await outputClass.classifyAtlasCandidate({ provider, bytes }) : { disposition: "skipped" };
      const record = { ok: true, surfaceKey: p.surfaceKey, aspectRatio: p.aspectRatio, width: meta.width, height: meta.height, bytes: bytes.length,
        sha256: sha(bytes), elapsedMs: Date.now() - started, gate,
        fullBleed: { whole: bleed.zones[p.surfaceKey], trim: trim.zones[p.surfaceKey] },
        outputClass: { disposition: klass.disposition, blocking: klass.blocking, evidence: klass.evidence } };
      results.push(record);
      const fb = bleed.zones[p.surfaceKey];
      log(`${p.surfaceKey}: ${meta.width}×${meta.height} in ${((Date.now() - started) / 1000).toFixed(1)}s · gate ${gate.accepted ? "PASS" : "REFUSE"} edgeHole ${gate.edgeHoleRatio ?? "?"} · colour-blind nonArtwork ${pct(fb.nonArtworkRatio)} border ${pct(fb.borderArtworkRatio)} · class ${klass.disposition}`);
      for (const f of gate.blockingFailures || []) log(`      blocking: ${String(f).slice(0, 180)}`);
      for (const f of gate.cutoutFindings || []) log(`      cut-out: ${String(f).slice(0, 180)}`);
    } catch (err) {
      log(`${p.surfaceKey}: FAILED — ${err.message}`);
      results.push({ ok: false, surfaceKey: p.surfaceKey, error: String(err.message).slice(0, 400) });
    }
  }
  const report = [
    `# Test 13 — panel extend from the design layout (${vehicle})`,
    "",
    `Design layout \`${DESIGN_LAYOUT}\` (${designMeta.width}×${designMeta.height}). Model \`${model}\`, one edit turn per surface, ${IMAGE_SIZE}.`,
    "",
    "| surface | aspect | returned | gate | edgeHole | largest dark shape | colour-blind non-artwork (whole / trim) | border artwork | output class | time |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...results.map((r) => r.ok
      ? `| ${r.surfaceKey} | ${r.aspectRatio} | ${r.width}×${r.height} | ${r.gate.accepted ? "pass" : `refuse: ${[...(r.gate.blockingFailures || []), ...(r.gate.cutoutFindings || [])].join("; ").slice(0, 200)}`} | ${r.gate.edgeHoleRatio ?? "?"} | ${r.gate.largestCutoutComponentRatio ?? "?"} | ${pct(r.fullBleed.whole.nonArtworkRatio)} / ${pct(r.fullBleed.trim.nonArtworkRatio)} | ${pct(r.fullBleed.whole.borderArtworkRatio)} | ${r.outputClass.disposition} | ${(r.elapsedMs / 1000).toFixed(1)}s |`
      : `| ${r.surfaceKey} | | FAILED | ${r.error} | | | | | | |`),
    "",
    "Owner acceptance: a flattened-topology design of a flattened vehicle, meaning no body lines. The eye decides; the numbers are telemetry.",
    "",
    "## Edit-turn text (driver)",
    "",
    "```text",
    plan[0].prompt,
    "```",
    "",
  ].join("\n");
  writeFileSync(join(OUT, "REPORT.md"), report);
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ vehicle: VEHICLE, designLayout: DESIGN_LAYOUT, model, imageSize: IMAGE_SIZE, plan, results }, null, 2));
  log(`gemini image requests executed: ${results.filter((r) => r.ok).length + results.filter((r) => !r.ok && !/download|resolve/.test(r.error || "")).length}`);
}

main().catch((error) => {
  console.error(`atlas-panel-extend-ab failed: ${error?.stack || error}`);
  process.exit(1);
});
