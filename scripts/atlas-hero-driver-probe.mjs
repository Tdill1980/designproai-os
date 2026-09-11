#!/usr/bin/env node
/**
 * A.T.L.A.S. HERO-DRIVER CASCADE PROBE — six images for the owner's eye,
 * before a single customer generation runs on RULE 0.35.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A CONTROLLED RUN, NOT A PRODUCT RUN. It exercises the exact production
 * modules (`runtime/atlas-hero-driver.cjs` through the deployed edge's
 * `atlas-author` mode) against the deployed image's dependencies, and it
 * measures the four things the ruling depends on:
 *
 *   1. Does the DRIVER sheet come back as printed artwork at the flank's
 *      proportion?                                  → driver.png, aspect, holes
 *   2. Do the continuations REPLAY the driver's thought signature, and does
 *      the provider accept it?                       → priorSignaturesReplayed per surface
 *   3. Does the assembled sheet pass the SAME whole-master gates production
 *      applies to a six-surface master?              → deterministicMasterChecks verdict
 *   4. How long does each stage take?                → stage timings, total
 *
 * WHAT IT WRITES TO PRODUCTION: one HARNESS row in designpro_generation_requests
 * (state leased → cancelled, error.code designiq_ab_harness_lease, the same
 * shape the A/B harness rows carry), because the edge's provider cache
 * authorizes every image request against a leased request. No revision, no
 * generation, no view, no artifact row. Staged inputs and returned sheets land
 * in the private bucket under content-addressed / request-addressed paths,
 * exactly as production stages them.
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "runtime/"));
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const atlas = require("../runtime/flat-first-atlas.cjs");
const hero = require("../runtime/atlas-hero-driver.cjs");
const { deterministicMasterChecks } = require("../runtime/atlas-master-qc.cjs");

const BUCKET = "wrap-files";
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// The Draw-1 fixture geometry (F250 Crew Cab) unless the caller supplies
// --surfaces-json; the probe measures the cascade, not GENIE.
const DEFAULT_SURFACES = [["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56],
  ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]]
  .map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches,
    surfaceSqFt: Math.round(widthInches * heightInches / 144 * 100) / 100,
    bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));

async function main() {
  const outDir = arg("out", "./hero-driver-evidence");
  mkdirSync(outDir, { recursive: true });
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!supabaseUrl || serviceKey.length < 32) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  const ownerId = arg("owner");
  if (!/^[0-9a-f-]{36}$/i.test(String(ownerId || ""))) throw new Error("--owner <uuid> is required (the harness row's owner)");
  const supabase = createClient(supabaseUrl, serviceKey);

  const input = {
    contractVersion: atlas.INPUT_CONTRACT,
    pipelineMode: atlas.PIPELINE_MODE,
    mode: arg("mode", "commercial") === "restyle" ? "restyle" : "commercial",
    brief: arg("brief", "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif company name, high contrast and legible at highway distance."),
    companyName: arg("company", "Precision Climate Solutions"),
    industryType: arg("industry", "HVAC and climate control"),
    brandColors: arg("colors", "deep blue, sunrise orange"),
    finish: arg("finish", "Gloss"),
    designName: "hero-driver probe (harness)",
    vehicle: { type: arg("type", "truck"), year: arg("year", "2022"), make: arg("make", "Ford"), model: arg("model", "F250 Crew Cab") },
  };
  const surfaces = arg("surfaces-json") ? JSON.parse(arg("surfaces-json")) : DEFAULT_SURFACES;
  const manifest = atlas.buildAtlasManifest(surfaces, undefined, input.vehicle.type);

  // ── the harness lease the edge authorizes against ─────────────────────────
  const requestId = randomUUID();
  const generationId = randomUUID();
  const claimToken = randomUUID();
  const inputHash = sha256(JSON.stringify(input));
  const { error: leaseError } = await supabase.from("designpro_generation_requests").insert({
    id: requestId, generation_id: generationId, owner_id: ownerId, tenant_key: `user_${ownerId}`,
    idempotency_key: `hero-driver-probe:${generationId}:${inputHash}`,
    state: "leased", request_input: input, input_hash: inputHash,
    engine_contract: { contractVersion: "designpro.calls-1-7-engine.v2", harness: "hero-driver-probe" },
    engine_contract_hash: sha256("hero-driver-probe"),
    attempt: 1, available_at: new Date().toISOString(),
    lease_owner: "hero-driver-probe", lease_token: claimToken,
    lease_expires_at: new Date(Date.now() + 45 * 60_000).toISOString(),
    error: { code: "designiq_ab_harness_lease", note: "hero-driver probe (RULE 0.35); harness-only row, never a customer generation" },
  });
  if (leaseError) throw new Error(`harness lease insert failed: ${leaseError.message}`);
  const release = async () => {
    await supabase.from("designpro_generation_requests")
      .update({ state: "cancelled", lease_owner: null, lease_token: null, lease_expires_at: null })
      .eq("id", requestId);
  };

  const store = {
    putImmutableBytes: async ({ storagePath, bytes, contentType }) => {
      const { error } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, { contentType, upsert: false });
      if (error && !/exists/i.test(String(error.message))) throw error;
    },
  };
  const surfaceRows = [];
  const startedAt = Date.now();
  let evidence;
  try {
    const result = await hero.authorHeroDriverMaster({
      manifest, input, store,
      providerRequest: { requestId, generationId, claimToken },
      creativeContext: [input.companyName, input.industryType, input.brandColors].filter(Boolean).join(" · "),
      logger: (m) => console.log(`  ${m}`),
      callEdge: async (body) => {
        const payload = await atlas.callAtlasAuthorEdge(body, { ownerId });
        const { data, error } = await supabase.storage.from(BUCKET).download(payload.panelStoragePath);
        if (error || !data) throw new Error(`could not read returned sheet: ${error?.message || "missing"}`);
        const bytes = Buffer.from(await data.arrayBuffer());
        if (sha256(bytes) !== payload.panelSha256) throw new Error("returned sheet hash mismatch");
        return { ...payload, bytes, panelByteSize: Number(payload.panelBytes || 0) };
      },
      onSurfaceAuthored: async (surface) => {
        writeFileSync(path.join(outDir, `${surface.surfaceKey}.png`), surface.bytes);
        surfaceRows.push({
          surfaceKey: surface.surfaceKey, method: surface.method, attempts: surface.attempts,
          imageRequestCount: surface.imageRequestCount, pixels: `${surface.pixelWidth}x${surface.pixelHeight}`,
          delivered: surface.deliveredWidthPx ? `${surface.deliveredWidthPx}x${surface.deliveredHeightPx}` : null,
          holeRatio: surface.holeRatio ?? null, priorTurnsApplied: surface.priorTurnsApplied,
          signaturesReplayed: surface.signaturesReplayed, thoughtSignatureCount: surface.thoughtSignatureCount,
          neighboursShown: surface.neighbourSurfaces, elapsedSoFarMs: Date.now() - startedAt,
        });
        console.log(JSON.stringify(surfaceRows[surfaceRows.length - 1]));
      },
    });
    writeFileSync(path.join(outDir, "assembled-master.png"), result.bytes);
    const gates = await deterministicMasterChecks(result.bytes, manifest);
    evidence = {
      contract: "designpro.atlas-hero-driver-probe.v1", ranAt: new Date().toISOString(),
      promptVersion: hero.HERO_DRIVER_PROMPT_VERSION, harnessRequestId: requestId,
      vehicle: input.vehicle, surfaces: surfaceRows, stageTimings: result.provenance.stageTimings,
      totalMs: Date.now() - startedAt, assembledSha256: result.contentHash,
      gates: { accepted: gates.accepted === true, blockingFailures: gates.blockingFailures || [], cutoutFindings: (gates.cutoutFindings || []).map((c) => c.finding) },
      verdict: {
        driverAccepted: surfaceRows.some((r) => r.surfaceKey === "driver"),
        signaturesReplayedOnEveryContinuation: surfaceRows.filter((r) => r.method === "hero_driver_continuation").every((r) => r.signaturesReplayed > 0),
        assembledSheetPassesMasterGates: gates.accepted === true && !(gates.blockingFailures || []).length && !(gates.cutoutFindings || []).length,
        imageRequests: result.imageRequestCount, totalSeconds: Math.round((Date.now() - startedAt) / 1000),
      },
    };
  } catch (cause) {
    evidence = {
      contract: "designpro.atlas-hero-driver-probe.v1", ranAt: new Date().toISOString(),
      promptVersion: hero.HERO_DRIVER_PROMPT_VERSION, harnessRequestId: requestId,
      vehicle: input.vehicle, surfaces: surfaceRows, totalMs: Date.now() - startedAt,
      refused: { code: cause?.code || null, surfaceKey: cause?.surfaceKey || null, reason: cause?.reason || String(cause?.message || cause).slice(0, 400) },
      verdict: { driverAccepted: surfaceRows.some((r) => r.surfaceKey === "driver"), assembledSheetPassesMasterGates: false },
    };
  } finally {
    await release();
  }
  writeFileSync(path.join(outDir, "hero-driver-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("\n=== VERDICT ===");
  console.log(JSON.stringify(evidence.verdict, null, 2));
  if (evidence.refused) process.exit(2);
}

main().catch((err) => {
  console.error(`PROBE FAILED: ${err?.stack || err}`);
  process.exit(1);
});
