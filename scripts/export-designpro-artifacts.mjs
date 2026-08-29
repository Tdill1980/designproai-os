// Read-only artifact export. Downloads a run's Call 8 proof and Call 9 panels
// from the PRIVATE wrap-files bucket using the service key the runtime already
// holds, verifies every byte against the content_hash recorded in
// designpro_artifacts, and writes them out for inspection.
//
// It reads. It never writes to Storage, never writes to the database, and never
// touches bucket visibility -- looking at the artwork must not re-expose it.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/**
 * A browsable copy of every exported file, beside the originals.
 *
 * The originals are what the chain wrote and are the point of the export, but
 * they are 4K masters and 8 MB proofs -- a thirty-file set is hundreds of
 * megabytes, and nothing that wants to LOOK at the graph can hold that. The
 * previews are long-edge 1400px JPEGs in `previews/`, small enough to open or
 * assemble into a contact sheet, and they are explicitly derived: the manifest
 * keeps the original's hash, never the preview's, so a preview can never be
 * mistaken for the artifact or offered as evidence of one.
 */
async function writePreviews(files) {
  const { default: sharp } = await import("sharp");
  mkdirSync(`${outDir}/previews`, { recursive: true });
  for (const entry of files) {
    if (!entry.file) continue;
    const name = `${entry.file.replace(/\.[a-z0-9]+$/i, "")}.jpg`;
    try {
      const preview = await sharp(readFileSync(`${outDir}/${entry.file}`))
        .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 72, chromaSubsampling: "4:2:0" })
        .toBuffer();
      writeFileSync(`${outDir}/previews/${name}`, preview);
      entry.preview = `previews/${name}`;
      entry.previewBytes = preview.length;
    } catch (error) {
      entry.preview = null;
      entry.previewError = String(error?.message || error);
      console.error(`preview failed for ${entry.file}: ${entry.previewError}`);
    }
  }
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

  // THE SEVEN 3D PROOFS, BESIDE THE PANELS THAT CONDITIONED THEM.
  //
  // RULE 0.21 pairs a surface's proof with its print panel, and RULE 0.29 makes
  // the panel the proof's artwork authority -- so the pairing is the thing worth
  // looking at, and until now the export could show only one half of it. Each
  // view carries the panel hash it was rendered from, which is what turns "these
  // look like the same design" into a checkable claim.
  // Resolved in two steps rather than an embedded join: PostgREST resolves an
  // embed from the FK graph, and a rename there would turn this into a silent
  // empty set rather than an error anyone notices.
  const { data: requestRows, error: requestError } = await supabase
    .from("designpro_generation_requests")
    .select("id")
    .eq("generation_id", generationId);
  if (requestError) console.error(`generation request query failed: ${requestError.message}`);
  const requestIds = (requestRows || []).map((row) => row.id);
  const { data: viewRows, error: viewError } = requestIds.length
    ? await supabase
      .from("designpro_generation_views")
      .select("consumer_role,source_view_type,storage_path,content_hash,byte_size,content_type,metadata")
      .in("request_id", requestIds)
      .is("superseded_at", null)
    : { data: [], error: null };
  if (viewError) {
    console.error(`generation view query failed: ${viewError.message}`);
  }
  for (const view of (viewRows || []).sort((a, b) => String(a.consumer_role).localeCompare(String(b.consumer_role)))) {
    const extension = view.content_type === "image/png" ? "png"
      : view.content_type === "image/webp" ? "webp" : "jpg";
    const provider = view.metadata?.provider || {};
    await fetchVerified(view.storage_path, view.content_hash,
      `proof3d__${view.consumer_role}.${extension}`, {
        role: "canonical-3d-proof",
        consumerRole: view.consumer_role,
        sourceViewType: view.source_view_type,
        // The pairing, stated per file so the manifest answers it directly.
        surfaceKey: provider.atlasZoneSurfaceKey ?? null,
        sourcePanelHash: provider.sourcePanelHash ?? null,
        atlasMasterContentHash: provider.atlasMasterContentHash ?? null,
        proofProducer: provider.proofProducer ?? null,
        proofSourceCommit: provider.proofSourceCommit ?? null,
        atlasConditioningVerified: provider.atlasConditioningVerified ?? null,
      }, files);
  }

  await writePreviews(files);

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

  // A base64 thumbnail of the master, on the workflow's own log. The full
  // export is a 30 MB workflow artifact, which needs a browser and a GitHub
  // session to open -- so an automated caller that can read the log still
  // cannot see the sheet, which is the one thing a cut-out or wrong-vehicle
  // diagnosis turns on. 640px is enough to tell continuous livery from a
  // punched vehicle silhouette, and small enough to sit in a log.
  const master = files.find((f) => f.file === "atlas-master.png");
  if (master?.hashMatches) {
    const { default: sharp } = await import("sharp");
    const thumb = await sharp(readFileSync(`${outDir}/atlas-master.png`))
      .resize({ width: 640, height: 640, fit: "inside" })
      .jpeg({ quality: 55, chromaSubsampling: "4:2:0" })
      .toBuffer();
    writeFileSync(`${outDir}/atlas-master-preview.jpg`, thumb);
    console.error(`ATLAS_MASTER_PREVIEW_JPEG_BASE64_BEGIN ${thumb.length}`);
    console.error(thumb.toString("base64"));
    console.error("ATLAS_MASTER_PREVIEW_JPEG_BASE64_END");
  }
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
await writePreviews(manifest);
writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
console.error(`exported ${manifest.filter((m) => m.file).length} files`);
