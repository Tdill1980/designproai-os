// Read-only artifact export. Downloads a run's Call 8 proof and Call 9 panels
// from the PRIVATE wrap-files bucket using the service key the runtime already
// holds, verifies every byte against the content_hash recorded in
// designpro_artifacts, and writes them out for inspection.
//
// It reads. It never writes to Storage, never writes to the database, and never
// touches bucket visibility -- looking at the artwork must not re-expose it.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] || null);
};
const runId = flag("--run");
// A.T.L.A.S. mode. Calls 1-7 can fail at the proof QC while the master, its
// deterministic guide and the six Call 1 panels all exist -- there is no run
// and no designpro_artifacts row yet, so --run cannot reach them. That is
// exactly the state a Calls 1-7 failure has to be diagnosed from, and it was
// diagnosed from hashes and QC verdicts because the artwork was unreachable.
const generationId = flag("--generation");
const outDir = flag("--out") || "/out";
if (!runId && !generationId) {
  console.error("--run <uuid> or --generation <uuid> is required");
  process.exit(2);
}
if (runId && generationId) {
  console.error("pass --run or --generation, never both");
  process.exit(2);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Download one private object and prove the bytes are the ones the row
// recorded. Same guarantee the run export gives: what is looked at is what
// the chain wrote, not a lookalike.
async function fetchVerified(storagePath, recordedHash, fileName, extra, sink) {
  const { data, error: dlError } = await supabase.storage.from("wrap-files").download(storagePath);
  if (dlError || !data) {
    sink.push({ file: null, storagePath, downloaded: false, reason: dlError?.message || "empty object" });
    console.error(`MISSING ${storagePath}: ${dlError?.message || "empty"}`);
    return;
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const observed = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(`${outDir}/${fileName}`, bytes);
  sink.push({
    file: fileName, storagePath, recordedHash, observedHash: observed,
    hashMatches: observed === String(recordedHash || "").toLowerCase(),
    observedBytes: bytes.length, ...extra,
  });
  console.error(`ok ${fileName} ${bytes.length}B hashMatch=${observed === String(recordedHash || "").toLowerCase()}`);
}

if (generationId) {
  const { data: atlasRows, error: atlasError } = await supabase
    .from("designpro_flat_atlas_revisions")
    .select("id,revision_sequence,guide_storage_path,guide_content_hash,master_storage_path,"
      + "master_content_hash,master_byte_size,projection_storage_path,projection_content_hash,"
      + "width_px,height_px,prompt_version,model,metadata,manifest,created_at")
    .eq("generation_id", generationId)
    .order("revision_sequence", { ascending: false })
    .limit(1);
  if (atlasError) { console.error(`atlas query failed: ${atlasError.message}`); process.exit(3); }
  const atlas = (atlasRows || [])[0];
  if (!atlas) { console.error(`no A.T.L.A.S. revision for generation ${generationId}`); process.exit(4); }

  mkdirSync(outDir, { recursive: true });
  const files = [];
  await fetchVerified(atlas.guide_storage_path, atlas.guide_content_hash,
    "atlas-guide.png", { role: "deterministic-installer-map-guide" }, files);
  await fetchVerified(atlas.master_storage_path, atlas.master_content_hash,
    "atlas-master.png", { role: "canonical-flattened-master" }, files);
  if (atlas.projection_storage_path) {
    await fetchVerified(atlas.projection_storage_path, atlas.projection_content_hash,
      "atlas-projection.jpg", { role: "proof-conditioning-projection" }, files);
  }
  for (const panel of atlas.metadata?.callOnePanels || []) {
    await fetchVerified(panel.storagePath, panel.contentHash,
      `call1-panel__${panel.surfaceKey}.png`, {
        role: "call1-surface-panel", surfaceKey: panel.surfaceKey,
        trimWidthIn: panel.trimWidthIn ?? null, trimHeightIn: panel.trimHeightIn ?? null,
        bleedInches: panel.bleedInches ?? null, effectivePpi: panel.effectivePpi ?? null,
        sourceMasterHash: panel.sourceMasterHash ?? null,
      }, files);
  }

  writeFileSync(`${outDir}/manifest.json`, JSON.stringify({
    generationId,
    revisionId: atlas.id,
    revisionSequence: atlas.revision_sequence,
    promptVersion: atlas.prompt_version,
    model: atlas.model,
    masterPixels: { width: atlas.width_px, height: atlas.height_px },
    masterQcPassed: atlas.metadata?.masterQcPassed ?? null,
    masterQcReview: atlas.metadata?.masterQcReview ?? null,
    masterCutoutSurfaces: atlas.metadata?.masterCutoutSurfaces ?? [],
    cutoutFillApplied: atlas.metadata?.cutoutFillApplied ?? null,
    panelSourceHash: atlas.metadata?.panelSourceHash ?? null,
    canonicalMasterHash: atlas.metadata?.canonicalMasterHash ?? null,
    geometryAuthority: atlas.manifest?.geometryAuthority ?? null,
    files,
  }, null, 2));
  console.error(`exported ${files.filter((f) => f.file).length} A.T.L.A.S. files`);
  process.exit(0);
}

const { data: rows, error } = await supabase
  .from("designpro_artifacts")
  .select("artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata")
  .eq("run_id", runId)
  .in("artifact_kind", ["panel", "flat-proof"]);
if (error) { console.error(`artifact query failed: ${error.message}`); process.exit(3); }

// The six panels, plus the customer-facing Call 8 sheet. The six
// canonical-production-surface rows are the panels' own sources and are
// downloaded too, so a claim that panel bytes ARE the surface bytes can be
// checked against the files rather than taken on trust.
const wanted = rows.filter((r) =>
  r.artifact_kind === "panel" ||
  r.metadata?.role === "customer-2d-production-proof" ||
  r.metadata?.role === "canonical-production-surface");

mkdirSync(outDir, { recursive: true });
const manifest = [];
for (const row of wanted.sort((a, b) => `${a.artifact_kind}/${a.surface_key}`.localeCompare(`${b.artifact_kind}/${b.surface_key}`))) {
  const { data, error: dlError } = await supabase.storage.from("wrap-files").download(row.storage_path);
  if (dlError || !data) {
    manifest.push({ ...row, downloaded: false, reason: dlError?.message || "empty object" });
    console.error(`MISSING ${row.storage_path}: ${dlError?.message || "empty"}`);
    continue;
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const observed = createHash("sha256").update(bytes).digest("hex");
  const role = row.metadata?.role === "customer-2d-production-proof" ? "proof"
    : row.artifact_kind === "panel" ? "panel" : "surface";
  const name = `${role}__${row.surface_key || "sheet"}.png`;
  writeFileSync(`${outDir}/${name}`, bytes);
  manifest.push({
    file: name, kind: row.artifact_kind, role: row.metadata?.role, surfaceKey: row.surface_key,
    storagePath: row.storage_path, recordedHash: row.content_hash, observedHash: observed,
    hashMatches: observed === String(row.content_hash).toLowerCase(),
    recordedBytes: row.byte_size, observedBytes: bytes.length,
    trimWidthInches: row.metadata?.trimWidthInches ?? null,
    trimHeightInches: row.metadata?.trimHeightInches ?? null,
    pixelWidth: row.metadata?.pixelWidth ?? null, pixelHeight: row.metadata?.pixelHeight ?? null,
    sourceSurfaceHash: row.metadata?.sourceSurfaceHash ?? null,
  });
  console.error(`ok ${name} ${bytes.length}B hashMatch=${observed === String(row.content_hash).toLowerCase()}`);
}
writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
console.error(`exported ${manifest.filter((m) => m.file).length} files`);
