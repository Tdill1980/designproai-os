#!/usr/bin/env node
/**
 * READ-ONLY. Fetch refused Call-1 raw candidates by storage path, preview
 * them, and re-run the deterministic gate on each with the production
 * manifest for the vehicle — so a failed request's "raw candidates" line can
 * be SEEN and its refusal reproduced, instead of inferred.
 *
 * Owner question (Trish, 2026-09-10, on generation b53702b4): the same
 * distressed Martini 911 brief was accepted on 2026-09-01 in one attempt and
 * refused three times today. The request row records only the LAST refusal.
 * This script downloads every candidate the row names, writes a 1600-px
 * preview of each, rebuilds the six-surface manifest (and the field
 * territories) from GENIE exactly as the worker did, and reports what
 * deterministicMasterChecks says about each candidate on each manifest.
 *
 * No provider call, no write outside the evidence directory, no row touched.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const require_ = (await import("node:module")).createRequire(join(process.cwd(), "runtime/"));
const { createClient } = require_("@supabase/supabase-js");
const sharp = require_("sharp");
const atlas = require_("./flat-first-atlas.cjs");
const genie = require_("./genie-universal-resolver.cjs");
const qc = require_("./atlas-master-qc.cjs");
const { buildFieldTerritories } = require_("./atlas-field-territories.cjs");
const { createProvider } = require_("./generation-provider.cjs");

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
);
const OUT = args.out || "./ab-evidence";
mkdirSync(OUT, { recursive: true });
const sha = (v) => createHash("sha256").update(v).digest("hex");
const log = (m) => process.stdout.write(`  ${m}\n`);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

const VEHICLE = {
  type: args["vehicle-type"] || "truck",
  year: args["vehicle-year"] || "2022",
  make: args["vehicle-make"] || "Ford",
  model: args["vehicle-model"] || "F250 Crew Cab",
};
const paths = String(args.candidates || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!paths.length) throw new Error("--candidates <comma-separated wrap-files storage paths> is required");
for (const p of paths) {
  if (!/^atlas-call1\/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/.test(p) && !/^designpro\/[^\s,]+\.(png|jpg|jpeg|webp)$/.test(p)) {
    throw new Error(`refusing a path outside atlas-call1/ or designpro/: ${p}`);
  }
}

function zoneSummary(checks) {
  return (checks.zones || []).map((z) => ({
    surfaceKey: z.surfaceKey,
    nonBlackFraction: Number((z.nonBlackFraction ?? 0).toFixed(4)),
    edgeHoleRatio: Number((z.edgeHoleRatio ?? 0).toFixed(4)),
    largestCutoutComponentRatio: Number((z.largestCutoutComponentRatio ?? 0).toFixed(4)),
    concentratedFlatBlackRatio: Number((z.concentratedFlatBlackRatio ?? 0).toFixed(4)),
    flatBlackRatio: Number((z.flatBlackRatio ?? 0).toFixed(4)),
    lumaStddev: Number((z.lumaStddev ?? 0).toFixed(2)),
  }));
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const provider = createProvider({ env: process.env });

  log("resolving GENIE preview dimensions …");
  const dimensionRow = await genie.resolveFlatAtlasPreviewDimensions(supabase, VEHICLE, provider);
  const surfaces = genie.expectedSurfacesFromRow(dimensionRow);
  const sixSurface = atlas.buildAtlasManifest(surfaces, dimensionRow.proofGeometryAuthority, VEHICLE.type);
  if (dimensionRow.geometryResolution) sixSurface.geometryResolution = dimensionRow.geometryResolution;
  const field = buildFieldTerritories(sixSurface);
  if (dimensionRow.geometryResolution) field.geometryResolution = dimensionRow.geometryResolution;

  const results = [];
  for (const path of paths) {
    const label = path.split("/").pop().replace(/\.[a-z]+$/, "").slice(0, 8);
    const { data: blob, error } = await supabase.storage.from("wrap-files").download(path);
    if (error || !blob) { log(`${label}: download failed — ${error?.message || "missing"}`); results.push({ path, ok: false, error: String(error?.message || "missing") }); continue; }
    const bytes = Buffer.from(await blob.arrayBuffer());
    const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
    writeFileSync(join(OUT, `${label}-raw-1600.jpg`), await sharp(bytes, { limitInputPixels: false })
      .resize({ width: 1600, height: 1600, fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 84 }).toBuffer());
    const record = { path, ok: true, sha256: sha(bytes), bytes: bytes.length, format: meta.format, width: meta.width, height: meta.height, gates: {} };
    for (const [name, manifest] of [["six-surface", sixSurface], ["field", field]]) {
      try {
        const normalized = await atlas.normalizeAtlasMaster(bytes, manifest);
        const checks = await qc.deterministicMasterChecks(normalized.bytes, manifest);
        record.gates[name] = {
          accepted: checks.accepted,
          blockingFailures: checks.blockingFailures,
          cutoutFindings: (checks.cutoutFindings || []).map((f) => f.finding || f),
          zones: zoneSummary(checks),
        };
        log(`${label} on ${name}: ${checks.accepted ? "PASS" : `REFUSE — blocking ${checks.blockingFailures.length}, cut-outs ${checks.cutoutFindings.length}`}`);
        for (const f of checks.blockingFailures) log(`      blocking: ${String(f).slice(0, 200)}`);
        for (const f of checks.cutoutFindings) log(`      cut-out: ${String(f.finding || f).slice(0, 200)}`);
      } catch (err) {
        record.gates[name] = { error: String(err?.message || err).slice(0, 300) };
        log(`${label} on ${name}: gate threw — ${String(err?.message || err).slice(0, 200)}`);
      }
    }
    results.push(record);
  }
  const report = [
    `# Raw Call-1 candidates, re-gated (${VEHICLE.year} ${VEHICLE.make} ${VEHICLE.model}, ${VEHICLE.type})`,
    "",
    "| candidate | size | six-surface gate | field gate |",
    "|---|---|---|---|",
    ...results.map((r) => r.ok
      ? `| \`${r.path}\` | ${r.width}×${r.height} ${r.format} | ${r.gates["six-surface"].accepted ? "pass" : `refuse: ${[...r.gates["six-surface"].blockingFailures, ...r.gates["six-surface"].cutoutFindings].join("; ").slice(0, 300)}`} | ${r.gates.field.accepted ? "pass" : `refuse: ${[...r.gates.field.blockingFailures, ...r.gates.field.cutoutFindings].join("; ").slice(0, 300)}`} |`
      : `| \`${r.path}\` | download failed | ${r.error} | |`),
    "",
    "Read-only: no provider call, no row written. Previews are `<id>-raw-1600.jpg`.",
    "",
  ].join("\n");
  writeFileSync(join(OUT, "REPORT.md"), report);
  writeFileSync(join(OUT, "raw-candidates.json"), JSON.stringify({ vehicle: VEHICLE, results }, null, 2));
  log(`wrote REPORT.md, raw-candidates.json and ${results.filter((r) => r.ok).length} preview(s)`);
}

main().catch((error) => {
  console.error(`atlas-fetch-raw-candidates failed: ${error?.stack || error}`);
  process.exit(1);
});
