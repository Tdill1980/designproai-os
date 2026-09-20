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
// REFUSAL mode. A Call 1 that is refused twice on every topology leaves NO
// revision row, so neither --run nor --generation can reach anything: the only
// durable evidence is designpro_atlas_refusals plus the raw candidate bytes it
// points at. CLAUDE.md's own ruling on the refusal ledger is "judge the gates
// from those pixels before touching a threshold", and until now there was no
// way to get them off the private bucket.
const refusalRequestId = flag("--refusals");
// DIGEST mode. Which topology should Call 1 be routed through is a measured
// question, and the refusal ledger is the only place the answer lives: one row
// per refused candidate, with its topology, attempt and gate verdict. Without
// this, "six-surface draws the vehicle" and "field draws the vehicle" are both
// anecdotes from whichever run someone last looked at. No images, no bucket
// read -- counts and verdict strings only.
const refusalDigestDays = flag("--refusal-digest");
/**
 * PROOF-SHEET mode: one stored panel-proof sheet, exported AND re-cut.
 *
 * Live 5772fcd5 (2026-09-19): the panel-proof engine returned a sheet in 40 s,
 * the cutter refused it, and the fail-over carried the run away with no ledger
 * row -- so the sheet sat in a private bucket, named in no table, while the
 * question it answers ("did the model fill the container's cells, or arrange the
 * panels itself?") decides whether that routing can ever go back on.
 *
 * `atlas-proof-panels.cjs` is deterministic, so re-cutting the STORED bytes
 * reproduces the exact verdict the live run reached. It prints every cell's
 * `fit` -- the share of the cell carrying paint -- which is the measurement that
 * separates "one empty box" from "the positional premise does not hold". That
 * premise is recorded as FALSIFIED on live sheet d5314267, and every panel this
 * cutter emits carries `positionalPremiseVerified: false` for that reason.
 *
 * Read-only: one download, one geometric cut, no row written and no model call.
 */
const proofSheetPath = flag("--proof-sheet");
const outDir = flag("--out") || "/out";
const selectors = [runId, generationId, refusalRequestId, refusalDigestDays, proofSheetPath].filter(Boolean);
if (selectors.length === 0) {
  console.error("--run <uuid>, --generation <uuid>, --refusals <requestId>, --refusal-digest <days> or --proof-sheet <storagePath> is required");
  process.exit(2);
}
if (selectors.length > 1) {
  console.error("pass exactly one of --run, --generation, --refusals, --refusal-digest, --proof-sheet");
  process.exit(2);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

if (proofSheetPath) {
  // THE PANEL ROWS ARE REQUIRED, because the cells are laid out FROM them: the
  // container is drawn per vehicle, so cutting one vehicle's sheet on another's
  // geometry measures nothing. They are passed exactly as the contract states
  // them, which is how the live run passed them too.
  const rowsArg = flag("--panel-rows");
  if (!rowsArg) {
    console.error('--proof-sheet needs --panel-rows \'DRIVER: 141" wide x 78" high|PASSENGER: ...\' (6 rows, | separated)');
    process.exit(2);
  }
  const panelRows = rowsArg.split("|").map((r) => r.trim()).filter(Boolean);
  // THESE PATHS ARE THE IMAGE'S, NOT THE REPO'S. `ops/Dockerfile.runtime` does
  // `COPY runtime/ ./` with WORKDIR /app, and the workflow mounts this script at
  // /app/export.mjs -- so the cutter sits BESIDE it and `sharp` resolves from
  // /app/node_modules, exactly as the bare `@supabase/supabase-js` import above
  // already does. A repo-relative `../runtime/...` resolves to /runtime and
  // would fail only at run time, on the droplet, after the download.
  const { cutProofPanels, QUADRANTS } = await import("./atlas-proof-panels.cjs");
  const { parsePanelRows } = await import("./atlas-proof-container-template.cjs");
  const sharp = (await import("sharp")).default;

  const { data, error: dlErr } = await supabase.storage.from("wrap-files").download(proofSheetPath);
  if (dlErr || !data) {
    console.error(`MISSING ${proofSheetPath}: ${dlErr?.message || "empty object"}`);
    process.exit(3);
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(`${outDir}/panel-proof-sheet.jpg`, bytes);
  const meta = await sharp(bytes).metadata();
  console.error(`sheet ${sha.slice(0, 12)} ${bytes.length}B ${meta.width}x${meta.height} aspect ${(meta.width / meta.height).toFixed(4)}`);

  const cut = await cutProofPanels({ proofBytes: bytes, manifest: parsePanelRows(panelRows), sharp });
  if (cut.refused) {
    // A REFUSAL IS THE ANSWER, NOT AN ERROR. It is what the live run did, and
    // the exit code stays 0 so the evidence is still collected and read.
    console.error(`the cutter REFUSES this sheet: ${cut.refused}`);
  } else {
    for (const panel of cut.panels) {
      writeFileSync(`${outDir}/${panel.zone}-${panel.surfaceKey}.png`, panel.bytes);
    }
  }
  const fits = (cut.panels || []).map((p) => `${p.zone}:${p.surfaceKey}=${p.fit}`);
  console.error(`FITS ${fits.join(" ")}`);
  writeFileSync(`${outDir}/manifest.json`, JSON.stringify({
    mode: "proof-sheet", storagePath: proofSheetPath, sha256: sha, byteSize: bytes.length,
    returned: { width: meta.width, height: meta.height },
    panelRows, quadrants: QUADRANTS, refused: cut.refused || null, sheet: cut.sheet || null,
    panels: (cut.panels || []).map(({ bytes: _b, ...receipt }) => receipt),
  }, null, 2));
  await writePreviews([{ file: "panel-proof-sheet.jpg" }]);
  process.exit(0);
}

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

if (refusalDigestDays) {
  const days = Number(refusalDigestDays);
  if (!Number.isFinite(days) || days <= 0 || days > 365) {
    console.error(`--refusal-digest wants a day count between 1 and 365, got ${refusalDigestDays}`);
    process.exit(2);
  }
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data: rows, error: digestError } = await supabase
    .from("designpro_atlas_refusals")
    .select("request_id,topology,attempt,code,reason,created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: true });
  if (digestError) { console.error(`refusal digest query failed: ${digestError.message}`); process.exit(3); }

  // Per request, in order: which topologies were tried and how each candidate
  // was refused. A request that appears here with fewer refusals than its
  // budget is one whose LATER candidate was accepted.
  const byRequest = new Map();
  for (const row of rows || []) {
    if (!byRequest.has(row.request_id)) byRequest.set(row.request_id, []);
    byRequest.get(row.request_id).push(row);
  }
  const byTopologyCode = {};
  for (const row of rows || []) {
    const key = `${row.topology}/${row.code}`;
    byTopologyCode[key] = (byTopologyCode[key] || 0) + 1;
  }
  mkdirSync(outDir, { recursive: true });
  const digest = {
    sinceUtc: since, days, refusedCandidates: (rows || []).length,
    requestsWithAtLeastOneRefusal: byRequest.size,
    byTopologyAndCode: byTopologyCode,
    requests: [...byRequest.entries()].map(([requestId, list]) => ({
      requestId, refusals: list.length,
      sequence: list.map((row) => `${row.topology}#${row.attempt}:${row.code}`),
      firstRefusedAt: list[0].created_at, lastRefusedAt: list[list.length - 1].created_at,
    })),
  };
  writeFileSync(`${outDir}/manifest.json`, JSON.stringify(digest, null, 2));
  console.error(`refusal digest since ${since}: ${digest.refusedCandidates} refused candidates across ${byRequest.size} requests`);
  for (const [key, count] of Object.entries(byTopologyCode).sort((a, b) => b[1] - a[1])) {
    console.error(`  ${key}: ${count}`);
  }
  for (const request of digest.requests) {
    console.error(`  ${request.requestId} ${request.firstRefusedAt} ${request.sequence.join(" -> ")}`);
  }
  process.exit(0);
}

if (refusalRequestId) {
  const { data: refusals, error: refusalError } = await supabase
    .from("designpro_atlas_refusals")
    .select("id,request_id,generation_id,topology,attempt,code,reason,storage_path,sha256,byte_size,content_type,model,created_at")
    .eq("request_id", refusalRequestId)
    .order("created_at", { ascending: true });
  if (refusalError) { console.error(`refusal query failed: ${refusalError.message}`); process.exit(3); }
  if (!refusals?.length) { console.error(`no refused candidates recorded for request ${refusalRequestId}`); process.exit(4); }

  mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const [index, row] of refusals.entries()) {
    // The verdict is the point, so it goes to the log verbatim -- a caller that
    // can only read the log still learns which gate refused and why.
    console.error(`REFUSED #${index + 1} ${row.topology} attempt ${row.attempt} ${row.code}: ${row.reason}`);
    await fetchVerified(row.storage_path, row.sha256,
      `refused-${String(index + 1).padStart(2, "0")}__${row.topology}-attempt${row.attempt}.png`, {
        role: "refused-call1-candidate",
        topology: row.topology, attempt: row.attempt, code: row.code, reason: row.reason,
        model: row.model, recordedBytes: row.byte_size, refusedAt: row.created_at,
      }, files);
  }
  await writePreviews(files);
  writeFileSync(`${outDir}/manifest.json`, JSON.stringify({
    requestId: refusalRequestId,
    generationId: refusals[0]?.generation_id ?? null,
    refusedCandidates: refusals.length,
    verdicts: refusals.map((row) => ({
      topology: row.topology, attempt: row.attempt, code: row.code,
      reason: row.reason, model: row.model, refusedAt: row.created_at,
    })),
    files,
  }, null, 2));

  // Every refused sheet on the log, small. Which gate refused is a string; WHY
  // it refused is only ever visible in the pixels.
  const { default: sharp } = await import("sharp");
  for (const entry of files.filter((f) => f.hashMatches)) {
    const thumb = await sharp(readFileSync(`${outDir}/${entry.file}`))
      .resize({ width: 640, height: 640, fit: "inside" })
      .jpeg({ quality: 55, chromaSubsampling: "4:2:0" })
      .toBuffer();
    console.error(`ATLAS_REFUSED_PREVIEW_JPEG_BASE64_BEGIN ${entry.file} ${thumb.length}`);
    console.error(thumb.toString("base64"));
    console.error("ATLAS_REFUSED_PREVIEW_JPEG_BASE64_END");
  }
  console.error(`exported ${files.filter((f) => f.file).length} refused candidates`);
  process.exit(0);
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
    .select("id,owner_id,generation_id,engine_receipt")
    .eq("generation_id", generationId);
  if (requestError) console.error(`generation request query failed: ${requestError.message}`);
  const requestIds = (requestRows || []).map((row) => row.id);
  const proof = atlas.metadata?.panelProofAuthoring;
  if (proof?.proofStoragePath) await fetchVerified(proof.proofStoragePath, proof.proofSha256,
    "call1-production-proof.png", {role:"customer-three-zone-proof"}, files);
  if (proof?.sourceArtwork?.storagePath) await fetchVerified(proof.sourceArtwork.storagePath,
    proof.sourceArtwork.contentHash, "call1-internal-staging.png", {role:"internal-staging-not-customer-proof"}, files);
  // Inspect only already-paid final images from this generation. Never export
  // native requests, model thought parts or signatures; never promote a view.
  const { readDurableImageProviderExchange } = await import("../supabase/functions/_shared/gemini-provider-cache.mjs");
  for (const row of requestRows || []) {
    for (const shot of ["side","passenger-side","hood_detail","roof","front","rear","close-up"]) {
      for (let attempt=1;attempt<=3;attempt++) {
        const identity={ownerId:row.owner_id,requestId:row.id,generationId,mode:"atlas-proof",attemptKey:`proof:${shot}:${attempt}`};
        const key=createHash("sha256").update(JSON.stringify({contractVersion:"designpro.gemini-provider-cache.v1",...identity})).digest("hex");
        const prefix=`designpro-provider-private/v1/${row.owner_id}/${generationId}/${key}`;
        const bucket=supabase.storage.from("wrap-files");
        const receipt=await bucket.download(`${prefix}/response.json`);
        if(receipt.error)continue;
        let exchange;
        try {
          exchange=await readDurableImageProviderExchange({bucket,ownerId:row.owner_id,generationId,requestId:row.id,providerRequestKey:key,
            authorize:async()=>{
              const current=await supabase.from("designpro_generation_requests").select("owner_id,generation_id").eq("id",row.id).single();
              if(current.error||current.data?.owner_id!==row.owner_id||current.data?.generation_id!==generationId)throw new Error("export_request_identity_mismatch");
            }});
        } catch(cause) { console.error(`CACHE ${shot} #${attempt}: ${String(cause.code||"unreadable")}`);continue; }
        const candidates=exchange.payload?.candidates;
        const images=candidates?.length===1 ? (candidates[0].content?.parts||[]).filter(p=>p.thought!==true&&p.inlineData?.data):[];
        if(images.length!==1)throw new Error(`export_final_image_ambiguous:${shot}`);
        const {data,mimeType}=images[0].inlineData;
        const ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[mimeType];
        if(!ext)throw new Error("export_final_image_type_invalid");
        const bytes=Buffer.from(data,"base64");
        if(bytes.toString("base64")!==data)throw new Error("export_final_image_encoding_invalid");
        const file=`cached-proof__${shot}__${attempt}.${ext}`;
        writeFileSync(`${outDir}/${file}`,bytes);
        files.push({file,role:"cached-final-image-NOT-accepted-proof",sourceViewType:shot,requestId:row.id,
          providerRequestKey:key,contentHash:createHash("sha256").update(bytes).digest("hex"),byteSize:bytes.length,downloaded:true});
      }
    }
  }
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
  const { data: attemptRows, error: attemptError } = requestIds.length
    ? await supabase
      .from("designpro_generation_attempts")
      .select("request_id,source_view_type,attempt,model,outcome,http_status,detail,duration_ms,content_hash,created_at")
      .in("request_id", requestIds)
      .order("source_view_type")
      .order("attempt")
    : { data: [], error: null };
  if (attemptError) {
    console.error(`generation attempt query failed: ${attemptError.message}`);
  }
  const proofDiagnostics = {
    refusedViews: (requestRows || []).flatMap((row) => Array.isArray(row.engine_receipt?.refusedViews)
      ? row.engine_receipt.refusedViews : []),
    attempts: attemptRows || [],
  };
  for (const refused of proofDiagnostics.refusedViews) {
    console.error(`REFUSED ${String(refused?.sourceViewType || "unknown")}: ${String(refused?.reason || "unknown")}`);
  }
  for (const attempt of proofDiagnostics.attempts.filter((item) => item.outcome !== "accepted")) {
    console.error(`ATTEMPT ${attempt.source_view_type} #${attempt.attempt} ${attempt.outcome}: ${String(attempt.detail || "no detail")}`);
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
    proofDiagnostics,
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
  // THE PRINT FILES THE CUSTOMER ACTUALLY BUYS WERE NOT EXPORTABLE.
  //
  // `panel` is the Call-1 cut at design density. What the Production Pack ships
  // is `upscaled-panel` (Call 12, Topaz, panel inches x 150) and `output` (six
  // sides x three formats). Canary 8c525565 completed enhance.upscale and then
  // died at output.build, so six 150-PPI panel masters existed on the run with
  // no way to look at one.
  .in("artifact_kind", ["panel", "flat-proof", "upscaled-panel", "output"]);
if (error) { console.error(`artifact query failed: ${error.message}`); process.exit(3); }

// The six panels, plus the customer-facing Call 8 sheet. The six
// canonical-production-surface rows are the panels' own sources and are
// downloaded too, so a claim that panel bytes ARE the surface bytes can be
// checked against the files rather than taken on trust.
const wanted = rows.filter((r) =>
  r.artifact_kind === "panel" ||
  r.artifact_kind === "upscaled-panel" ||
  r.artifact_kind === "output" ||
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
    : row.artifact_kind === "panel" ? "panel"
    : row.artifact_kind === "upscaled-panel" ? "print-panel"
    : row.artifact_kind === "output" ? "output" : "surface";
  // An output's own extension matters -- a TIFF written as .png is unopenable.
  const extension = String(row.storage_path || "").match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "png";
  const name = `${role}__${row.surface_key || "sheet"}${role === "output" ? `.${extension}` : ".png"}`;
  writeFileSync(`${outDir}/${name}`, bytes);
  manifest.push({
    file: name, kind: row.artifact_kind, role: row.metadata?.role, surfaceKey: row.surface_key,
    effectivePpi: row.metadata?.effectivePpi ?? row.metadata?.ppi ?? null,
    enhancedBy: row.metadata?.enhancedBy ?? row.metadata?.upscaler ?? null,
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
