#!/usr/bin/env node
/**
 * READ-ONLY. Measure an ACCEPTED master that already exists.
 *
 * No provider call, no image generation, no write of any kind: it downloads the
 * stored canonical master for one generation, rebuilds nothing (the manifest is
 * read off the revision row), and reports what is actually in the accepted
 * bytes.
 *
 * WHY IT EXISTS. The deterministic gate measures the master BEFORE repair.
 * `cutoutFillApplied` then records what the fill claims it closed, and
 * `unresolvedPixels: 0` means every pixel got a value — not that the values are
 * artwork. `fillMasterCutouts` closes a hole by repeatedly averaging its
 * boundary pixels inward, which is built for a wheel arch biting the edge of a
 * panel. Nothing in the receipts says whether it can reconstruct a 300,000-pixel
 * interior disc, and the accepted bytes are the only place that answer lives.
 *
 * So this measures the ACCEPTED master — the sheet a human sees and the panels
 * are cut from — with the colour-blind full-bleed instrument AND the production
 * gate's own near-black cut-out predicate, and reports the largest dark
 * component per surface. A disc that survives here is a repair failure, and it
 * reaches the customer.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fullBleedMetrics } from "./atlas-fullbleed-metrics.mjs";

const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
const { createClient } = require_("@supabase/supabase-js");
const qc = require_("./atlas-master-qc.cjs");
const sharp = require_("sharp");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const OUT = args.out || "./ab-evidence";
mkdirSync(OUT, { recursive: true });
const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);

const SURFACE_ORDER = ["driver", "passenger", "front", "hood", "rear", "roof"];

/**
 * Largest connected near-black component inside a zone, using the gate's OWN
 * thresholds, on whatever bytes it is handed. Run on the accepted master this
 * answers one question: did the disc survive the repair.
 */
async function darkComponents(masterBytes, zone) {
  const { data, info } = await sharp(masterBytes, { limitInputPixels: false })
    .extract({ left: Math.round(zone.x), top: Math.round(zone.y), width: Math.round(zone.w), height: Math.round(zone.h) })
    .resize(Math.min(1024, Math.round(zone.w)), Math.min(1024, Math.round(zone.h)), { fit: "fill", kernel: "nearest" })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width; const H = info.height; const C = info.channels; const N = W * H;
  const isDark = (i) => data[i + 3] <= qc.CUTOUT_ALPHA_MAX
    || (data[i] <= qc.FLAT_BLACK_CHANNEL_MAX && data[i + 1] <= qc.FLAT_BLACK_CHANNEL_MAX && data[i + 2] <= qc.FLAT_BLACK_CHANNEL_MAX);

  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  let dark = 0; let largest = 0; let components = 0;
  for (let p = 0; p < N; p += 1) {
    if (seen[p] || !isDark(p * C)) { if (!seen[p]) seen[p] = 1; continue; }
    let size = 0; let top = 0;
    stack[top++] = p; seen[p] = 1;
    while (top > 0) {
      const q = stack[--top];
      size += 1;
      const qx = q % W; const qy = (q / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = qx + dx; const ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const r = ny * W + nx;
        if (seen[r] || !isDark(r * C)) continue;
        seen[r] = 1; stack[top++] = r;
      }
    }
    dark += size;
    if (size > largest) largest = size;
    if (size >= N * qc.MIN_CUTOUT_COMPONENT_RATIO) components += 1;
  }
  const round = (v) => Number(v.toFixed(5));
  return {
    sampledAt: `${W}x${H}`,
    darkRatio: round(dark / N),
    largestDarkComponentRatio: round(largest / N),
    largestDarkComponentPx: largest,
    concentratedComponentCount: components,
    // Scaled back to the zone's real pixels so the number is comparable to the
    // fill receipt, which counts full-resolution pixels.
    largestDarkComponentFullResPx: Math.round(largest * ((zone.w * zone.h) / N)),
  };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const generation = String(args.generation || "").trim();
  if (!generation) throw new Error("--generation <id or 8-char prefix> is required");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const { data: rows, error } = await supabase
    .from("designpro_flat_atlas_revisions")
    .select("generation_id, revision_sequence, master_storage_path, master_content_hash, master_byte_size, manifest, metadata, prompt_version, created_at")
    .like("generation_id", `${generation}%`)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`revision lookup failed: ${error.message}`);
  if (!rows?.length) throw new Error(`no revision for generation ${generation}`);
  const row = rows[0];
  log(`generation ${row.generation_id} rev ${row.revision_sequence}, ${row.prompt_version}`);
  log(`accepted master ${row.master_content_hash.slice(0, 16)} (${row.master_byte_size} bytes)`);
  log(`pre-repair       ${String(row.metadata?.preRepairMasterHash || "none").slice(0, 16)}`);

  const { data: blob, error: dlErr } = await supabase.storage.from("wrap-files").download(row.master_storage_path);
  if (dlErr || !blob) throw new Error(`master download failed: ${dlErr?.message || "missing"}`);
  const masterBytes = Buffer.from(await blob.arrayBuffer());
  const actual = sha(masterBytes);
  if (actual !== row.master_content_hash) throw new Error(`downloaded bytes hash ${actual}, row says ${row.master_content_hash}`);
  log(`downloaded and hash-verified against the revision row`);

  const manifest = row.manifest;
  const fullBleed = await fullBleedMetrics(masterBytes, manifest);
  const fillReceipt = row.metadata?.cutoutFillApplied || [];
  const fillByKey = new Map((Array.isArray(fillReceipt) ? fillReceipt : []).map((f) => [f.surfaceKey, f]));
  const preRepair = new Map(((row.metadata?.masterQcDeterministic?.zones) || []).map((z) => [z.surfaceKey, z]));

  const surfaces = {};
  log("");
  log("ACCEPTED MASTER — what is actually in the bytes a human sees");
  for (const zone of manifest.zones) {
    const dark = await darkComponents(masterBytes, zone);
    const f = fullBleed.zones[zone.surfaceKey];
    const claim = fillByKey.get(zone.surfaceKey);
    const before = preRepair.get(zone.surfaceKey);
    surfaces[zone.surfaceKey] = { ...dark, fullBleed: f, fillReceipt: claim || null, preRepair: before || null };
    log(`  ${zone.surfaceKey.padEnd(10)} largestDark ${(dark.largestDarkComponentRatio * 100).toFixed(2).padStart(5)}% `
      + `(${dark.largestDarkComponentFullResPx.toLocaleString()} px)  darkTotal ${(dark.darkRatio * 100).toFixed(2).padStart(5)}%  `
      + `nonArtwork ${f ? (f.nonArtworkRatio * 100).toFixed(1).padStart(5) : "  -  "}%  bleed ${f && f.fullBleedCompliant ? "OK" : "NO"}`
      + (claim ? `   [fill claimed ${claim.pixels.toLocaleString()} px in ${claim.components} component(s), unresolved ${claim.unresolvedPixels}]` : ""));
  }

  const verdicts = manifest.zones.map((zone) => {
    const s = surfaces[zone.surfaceKey];
    const claim = fillByKey.get(zone.surfaceKey);
    if (!claim) return null;
    // The fill said it closed this surface. Did it?
    const survivedPx = s.largestDarkComponentFullResPx;
    const survived = survivedPx > claim.pixels * 0.25;
    return { surfaceKey: zone.surfaceKey, claimedPx: claim.pixels, survivingLargestDarkPx: survivedPx, repairEffective: !survived };
  }).filter(Boolean);

  log("");
  for (const v of verdicts) {
    log(`  ${v.surfaceKey}: fill claimed ${v.claimedPx.toLocaleString()} px; largest dark component still present ${v.survivingLargestDarkPx.toLocaleString()} px `
      + `-> repair ${v.repairEffective ? "EFFECTIVE" : "DID NOT REMOVE THE DARK REGION"}`);
  }

  writeFileSync(join(OUT, "measure-master.json"), JSON.stringify({
    contract: "designpro.atlas-accepted-master-measurement.v1",
    generationId: row.generation_id,
    revisionSequence: row.revision_sequence,
    promptVersion: row.prompt_version,
    acceptedMasterHash: row.master_content_hash,
    preRepairMasterHash: row.metadata?.preRepairMasterHash || null,
    masterStoragePath: row.master_storage_path,
    fullBleed,
    surfaces,
    repairVerdicts: verdicts,
  }, null, 2));
  // A downscaled copy so the sheet can be looked at beside the numbers.
  writeFileSync(join(OUT, "accepted-master.jpg"),
    await sharp(masterBytes, { limitInputPixels: false }).resize(1400, 1400, { fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 84 }).toBuffer());
  log("");
  log(`wrote measure-master.json and accepted-master.jpg to ${OUT}`);
}

main().catch((error) => {
  console.error(`\nFAILED: ${error?.message || error}`);
  process.exitCode = 1;
});
