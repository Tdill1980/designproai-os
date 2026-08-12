#!/usr/bin/env node
/**
 * One complete production run on the droplet, from seven existing renders to
 * output files on disk.
 *
 * This is the thing that has been missing all along: not a test that the
 * pipeline is wired, but a run that produces files you can open. It takes seven
 * renders that already exist, binds them as an immutable revision source, starts
 * the production workflow, waits for the server-owned workers to carry it
 * through Calls 8 to 12, and writes whatever came out into --out.
 *
 * It generates nothing. Every image it uses was rendered previously, so a run
 * costs no provider calls and can be repeated while diagnosing.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DESIGNPRO_CANARY_TENANT=user_<uuid> \
 *   node scripts/production-canary.mjs --views views.json --out ./canary-output
 *
 * views.json maps the seven source slots to public image URLs:
 *   { "side": "https://...", "passenger-side": "...", "hood_detail": "...",
 *     "front": "...", "rear": "...", "close-up": "...", "roof": "..." }
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const require = createRequire(import.meta.url);
const { createClient } = require("../runtime/node_modules/@supabase/supabase-js");

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

// The source slots the generation engine emits, mapped to the consumer roles
// Calls 8+ read. close-up stays explicit rather than being silently relabelled.
const SOURCE_TO_ROLE = Object.freeze({
  side: "driver", "passenger-side": "passenger", hood_detail: "hood",
  roof: "roof", front: "front", rear: "rear", "close-up": "hero3d",
});
const EXTENSION = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" });
const BUCKET = "wrap-files";
const POLL_INTERVAL_MS = 10_000;
const MAX_POLLS = 180; // 30 minutes: Topaz upscaling of 18 print files is not fast.

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const TENANT = String(process.env.DESIGNPRO_CANARY_TENANT || "").trim();
const OUT = arg("out", "./canary-output");
const ORDER_NUMBER = arg("order", `CANARY-${Date.now().toString(36).toUpperCase()}`);

if (!SUPABASE_URL || !SERVICE_KEY || !TENANT) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DESIGNPRO_CANARY_TENANT are required");
  process.exit(2);
}
const userId = TENANT.replace(/^user_/, "");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const step = (message) => process.stdout.write(`  ${message}\n`);

async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(`${name} failed: ${error.message}`);
  return data;
}

/**
 * Fetches one render and stores it at the exact path the revision contract
 * expects. The path is content-addressed and derived, never chosen, so the same
 * image uploaded twice lands in the same place and the second upload is a no-op.
 */
async function ingestView(revisionId, sourceKey, url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${sourceKey}: source render fetch failed (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error(`${sourceKey}: source render is empty`);

  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const extension = EXTENSION[contentType];
  if (!extension) throw new Error(`${sourceKey}: ${contentType || "unknown"} is not a supported render type`);

  const role = SOURCE_TO_ROLE[sourceKey];
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `users/${userId}/revisions/${revisionId}/inputs/${role}/${contentHash}.${extension}`;

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, { contentType, upsert: false });
  if (error && !/exists|duplicate|conflict/i.test(error.message)) {
    throw new Error(`${sourceKey}: upload failed: ${error.message}`);
  }
  step(`${sourceKey.padEnd(15)} -> ${role.padEnd(9)} ${(bytes.length / 1024).toFixed(0).padStart(5)} KB  ${contentHash.slice(0, 12)}`);
  return { role, asset: { bucket: BUCKET, storagePath, contentHash, byteSize: bytes.length, contentType } };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const views = JSON.parse(readFileSync(arg("views"), "utf8"));
  const missing = Object.keys(SOURCE_TO_ROLE).filter((key) => !views[key]);
  if (missing.length) throw new Error(`views file is missing: ${missing.join(", ")}`);

  const revisionId = randomUUID();
  const generationId = randomUUID();
  const visualizationId = randomUUID();
  process.stdout.write(`\nProduction canary — revision ${revisionId}\norder ${ORDER_NUMBER}\n\n`);

  // ---- Bind seven existing renders as an immutable revision source ---------
  step("ingesting seven renders");
  const renderAssets = {};
  for (const [sourceKey, url] of Object.entries(SOURCE_TO_ROLE).map(([k]) => [k, views[k]])) {
    const { role, asset } = await ingestView(revisionId, sourceKey, url);
    renderAssets[role] = asset;
  }
  const distinct = new Set(Object.values(renderAssets).map((a) => a.contentHash));
  if (distinct.size !== 7) throw new Error(`seven renders must be distinct; got ${distinct.size} unique hashes`);
  step(`seven distinct renders bound`);

  const snapshot = {
    contractVersion: "designpro.revision-snapshot.v1",
    vehicle: { type: "van", year: arg("year", "2022"), make: arg("make", "Ford"), model: arg("model", "Transit") },
    surfaceOptions: { coverage: "full", addHood: true, addRoof: true },
    finish: "gloss",
    bodyText: "",
    orderNumber: ORDER_NUMBER,
    // No logos: the attestation mode has to agree with the empty inventory, or
    // the contract rejects it rather than guessing what was intended.
    expectedLogoInventory: [],
    logoInventoryAttestation: { attested: true, mode: "none" },
    delivery: { orderNumber: ORDER_NUMBER, method: "wrapbox" },
    revisionId, generationId, visualizationId, renderAssets,
    designId: generationId,
  };

  step("saving the revision source");
  const saved = await rpc("save_designpro_revision_source", {
    p_revision_id: revisionId, p_generation_id: generationId, p_visualization_id: visualizationId,
    p_expected_updated_at: new Date().toISOString(), p_snapshot: snapshot,
    p_snapshot_hash: null, p_idempotency_key: `canary-${revisionId}`,
  });
  step(`snapshot hash ${String(saved?.snapshotHash || "").slice(0, 16)}`);

  step("starting the entice workflow");
  const entice = await rpc("create_designpro_entice_workflow", {
    p_revision_id: revisionId, p_idempotency_key: `canary-entice-${revisionId}`,
    p_input: { trigger: "canary", revisionSnapshotHash: saved?.snapshotHash },
  });

  step("starting the production workflow");
  const production = await rpc("create_designpro_production_workflow", {
    p_entice_run_id: entice?.workflowRunId, p_idempotency_key: `canary-production-${revisionId}`,
    p_input: { orderRequestId: null },
  });
  const runId = production?.workflowRunId;
  process.stdout.write(`\n  entice run     ${entice?.workflowRunId}\n  production run ${runId}\n\n`);

  // ---- Watch the server-owned workers carry it through Calls 8 to 12 -------
  let seen = new Set();
  let final = null;
  for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
    const { data: stages } = await supabase.from("designpro_workflow_stages")
      .select("stage,state,updated_at,detail").eq("run_id", runId).order("updated_at");
    for (const row of stages || []) {
      const key = `${row.stage}:${row.state}`;
      if (seen.has(key)) continue;
      seen.add(key);
      step(`${new Date().toISOString().slice(11, 19)}  ${row.stage.padEnd(24)} ${row.state}`);
      if (row.state === "failed") final = { failed: row };
    }
    const { data: run } = await supabase.from("designpro_workflow_runs").select("state,detail").eq("id", runId).maybeSingle();
    if (run?.state && ["outputs_ready", "delivered", "complete", "failed"].includes(run.state)) { final = { run }; break; }
    if (final?.failed) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  // ---- Whatever it produced, put it on disk --------------------------------
  const { data: artifacts } = await supabase.from("designpro_artifacts")
    .select("kind,storage_path,byte_size,content_hash").eq("run_id", runId);
  step(`\n  ${(artifacts || []).length} artifact row(s)`);
  const written = [];
  for (const artifact of artifacts || []) {
    const { data, error } = await supabase.storage.from(BUCKET).download(artifact.storage_path);
    if (error || !data) { step(`  could not download ${artifact.kind}: ${error?.message}`); continue; }
    const bytes = Buffer.from(await data.arrayBuffer());
    const name = `${artifact.kind}-${artifact.storage_path.split("/").pop()}`;
    writeFileSync(`${OUT}/${name}`, bytes);
    written.push({ kind: artifact.kind, file: name, byteSize: bytes.length, contentHash: artifact.content_hash });
    step(`  wrote ${name} (${(bytes.length / 1024).toFixed(0)} KB)`);
  }

  writeFileSync(`${OUT}/canary-evidence.json`, JSON.stringify({
    contract: "designpro.production-canary-evidence.v1",
    ranAt: new Date().toISOString(), revisionId, generationId, visualizationId,
    orderNumber: ORDER_NUMBER, enticeRunId: entice?.workflowRunId, productionRunId: runId,
    renderAssets, stagesObserved: [...seen], finalState: final, outputs: written,
  }, null, 2));

  process.stdout.write(`\n${written.length} output file(s) in ${OUT}\n`);
  if (!written.length) {
    process.stdout.write("\nNo output files were produced. canary-evidence.json records every stage\nthat was observed and where it stopped.\n");
    process.exit(1);
  }
}

main().catch((error) => { console.error(`\ncanary failed: ${error.message}`); process.exit(1); });
