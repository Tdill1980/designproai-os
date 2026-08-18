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

const runId = process.argv[process.argv.indexOf("--run") + 1];
const outDir = process.argv[process.argv.indexOf("--out") + 1] || "/out";
if (!runId) { console.error("--run <uuid> is required"); process.exit(2); }

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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
