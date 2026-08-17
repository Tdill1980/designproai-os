/**
 * GENIE Production Worker
 *
 * Receives panel jobs from Supabase edge functions, produces
 * print-ready TIFF (1500 DPI @ 10% scale) and EPS files.
 *
 * Pipeline per durable DesignPro panel:
 *   1. Download the source-bound deterministic panel from Supabase Storage
 *   2. Verify its immutable byte fingerprint and GENIE aspect
 *   3. Sharp-only deterministic resize and 5" mirror bleed
 *   4. Encode TIFF, PNG, preview and identity-preserving raster EPS
 *   6. Upload TIFF + EPS back to Supabase Storage
 *   7. POST webhook to update panelizer_jobs status
 */

const express = require("express");
// Wrap sharp so EVERY pipeline disables the input-pixel cap. Full-size print
// panels (e.g. a 224" side at 150 PPI ≈ 33,600×8,400 ≈ 282M px) exceed sharp's
// default 268M limit and throw "Input image exceeds pixel limit". Static props
// (sharp.versions, sharp.cache, …) are preserved via Object.assign.
const _sharp = require("sharp");
const sharp = (input, opts) => _sharp(input, { limitInputPixels: false, ...(opts || {}) });
Object.assign(sharp, _sharp);
const { createClient } = require("@supabase/supabase-js");
const Replicate = require("replicate");
const archiver = require("archiver");
const { liftCropPlan, ASPECT_TOLERANCE: LIFT_ASPECT_TOLERANCE } = require("./lift-crop-geometry.cjs");
const { planSidefieldExtract, fillHolesByMirror } = require("./sidefield-extract.cjs");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { createHash, randomUUID } = require("crypto");

// ── Config ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const SUPABASE_URL = process.env.SUPABASE_URL || "https://kfapjdyythzyvnpdeghu.supabase.co";
// Edge functions authorize server stages with the canonical service-role secret.
// Keep the legacy variable only as a compatibility fallback; it must never
// override SUPABASE_SERVICE_ROLE_KEY with a stale or non-service credential.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const VECTORIZER_API_ID = process.env.VECTORIZER_API_ID;
const VECTORIZER_API_SECRET = process.env.VECTORIZER_API_SECRET;
const WORKER_SECRET = String(process.env.WORKER_SECRET || "").trim();
if (!WORKER_SECRET) {
  throw new Error("WORKER_SECRET is required; refusing to start with an unauthenticated worker");
}

// Topaz cloud upscale API (best on photographic texture). Endpoint/model are
// env-overridable so they can be tuned to the account's plan without a redeploy.
const TOPAZ_API_KEY = process.env.TOPAZ_API_KEY;
const TOPAZ_ENHANCE_URL = process.env.TOPAZ_API_URL || "https://api.topazlabs.com/image/v1/enhance";
const TOPAZ_STATUS_BASE = process.env.TOPAZ_STATUS_URL || "https://api.topazlabs.com/image/v1/status";
const TOPAZ_MODEL = process.env.TOPAZ_MODEL || "High Fidelity V2"; // best on photographic (flag/fabric); higher MP cap than Standard V2

// Gemini image key POOL — used by the /clean-artboard endpoint to generate the
// text-free clean background at 4K. The edge function (generate-2d-proof) is capped
// at 2K by the 256MB runtime; this worker has the memory to decode a 4K response.
// The 5-slot pool matches the edge functions' Supabase pool — the extract ROTATES
// across these on 429 so a single exhausted key never fails the extract silently
// ("AI extract must work every time"). Locked model, no model fallback.
const GEMINI_KEYS = [
  process.env.GOOGLE_AI_API_KEY,
  process.env.GOOGLE_AI_API_KEY_2,
  process.env.GOOGLE_AI_API_KEY_3,
  process.env.GOOGLE_AI_API_KEY_4,
  process.env.GOOGLE_AI_API_KEY_5,
].filter(Boolean);
const HAS_GEMINI = GEMINI_KEYS.length > 0;
const GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";

// Replicate is OFF BY DEFAULT — the shop's decision is in-app upscale only (Topaz →
// local Sharp lanczos), never an external Replicate call. It re-enables ONLY when
// DISABLE_REPLICATE is set to an explicit false-ish value (false/0/no/off). This makes
// the flag robust to typos/absence: a mistyped "trur", "True", or a missing var all
// keep Replicate OFF — the intended state — so nobody has to type it perfectly. Topaz
// must be keyed for crisp results; if Topaz is momentarily down the fallback is LOCAL
// Sharp, still in-app. Set DISABLE_REPLICATE=false only to deliberately re-enable it.
const _disableReplicateRaw = String(process.env.DISABLE_REPLICATE ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase();
const DISABLE_REPLICATE = !["false", "0", "no", "off"].includes(_disableReplicateRaw);

// Print specs
const PRINT_DPI = 1500;       // Embedded in TIFF metadata
const OUTPUT_SCALE = 0.10;    // 10% of actual size (RIP scales to 1000%)
const PPI = PRINT_DPI * OUTPUT_SCALE; // 150 px/inch
const BLEED_INCHES = 5;       // 5" bleed on all edges (true mirror-extend, every panel)
// Process start time, surfaced on /health so a redeploy is visible as a reset uptime.
const WORKER_STARTED_AT = new Date().toISOString();
// Every durable claimant must have a stable, unique identity. Self-hosted
// replicas set DESIGNPRO_WORKER_ID explicitly; HOSTNAME/pid are fallbacks.
const DESIGNPRO_WORKER_ID = String(
  process.env.DESIGNPRO_WORKER_ID ||
    process.env.HOSTNAME ||
    process.pid,
).trim();
// The legacy production_panels poller reads then updates without an atomic
// database claim. Scaled OS replicas must disable it and run only the durable
// lease/fencing claimants.
const DESIGNPRO_PANEL_POLLER_ENABLED = !["0", "false", "no", "off"].includes(
  String(process.env.DESIGNPRO_PANEL_POLLER_ENABLED ?? "true")
    .trim()
    .toLowerCase(),
);
const DESIGNPRO_PRODUCTION_CONCURRENCY = (() => {
  const configured = Number(process.env.DESIGNPRO_PRODUCTION_CONCURRENCY || 3);
  return Number.isSafeInteger(configured) && configured >= 1 && configured <= 3
    ? configured
    : 3;
})();
const BLEED_PX = Math.round(BLEED_INCHES * PPI); // 750 px

// ── BODY-COLOR FLOOR (core print rule) ───────────────────────────────────────
// Every print panel must show the approved BODY COLOR — never blank/white — and
// fill 100% of the output canvas. Before resize/bleed we flatten any transparency
// onto the artwork's OWN dominant painted color, so a gap can never print as white
// paper. The mirror-bleed then continues that color out to the canvas edge.
// Deterministic, no AI. (Opaque inputs pass through untouched.)
//   Approved proof -> body color floor -> bounding box -> mirror bleed -> print.
// ── FIT (no stretch) + MIRROR-BLEED FILL (core print rule) ──────────────────
// Carley's rule: the design must keep its EXACT proportions (never stretched or
// enlarged), and the rest of the print rectangle + bleed is filled by extending
// the artwork outward. So we:
//   1. fit the design INTO the trim preserving aspect (no fit:"fill" stretch),
//   2. mirror-extend the short axis to fill the trim (front/rear or top/bottom),
//   3. mirror-extend the bleed on all four sides.
// Wrapped back on the vehicle, the visible design is identical to the proof;
// the only new pixels are the continuation bleed. Deterministic, no AI.
async function fitAndBleed(buf, tw, th, bleedPx) {
  const fitted = await sharp(buf)
    .resize(tw, th, { fit: "inside", kernel: "lanczos3", withoutEnlargement: false })
    .toBuffer();
  const m = await sharp(fitted).metadata();
  const padL = Math.max(0, Math.floor((tw - m.width) / 2));
  const padR = Math.max(0, tw - m.width - padL);
  const padT = Math.max(0, Math.floor((th - m.height) / 2));
  const padB = Math.max(0, th - m.height - padT);
  let trim = fitted;
  if (padL || padR || padT || padB) {
    trim = await sharp(fitted)
      .extend({ left: padL, right: padR, top: padT, bottom: padB, extendWith: "mirror" })
      .toBuffer();
  }
  return await sharp(trim)
    .extend({ top: bleedPx, bottom: bleedPx, left: bleedPx, right: bleedPx, extendWith: "mirror" })
    .png()
    .toBuffer();
}

async function floorBodyColor(buf) {
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.hasAlpha) return buf;
    const { dominant } = await sharp(buf).stats();
    const bg = dominant && typeof dominant.r === "number" ? dominant : { r: 0, g: 0, b: 0 };
    console.log(`[WORKER] body-color floor rgb(${bg.r},${bg.g},${bg.b})`);
    return await sharp(buf).flatten({ background: bg }).png().toBuffer();
  } catch (e) {
    console.warn(`[WORKER] floorBodyColor skipped: ${e.message}`);
    return buf;
  }
}

const BUCKET = "wrap-files";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const replicate = REPLICATE_API_TOKEN ? new Replicate({ auth: REPLICATE_API_TOKEN }) : null;

const app = express();
app.use(express.json({ limit: "1mb" }));

// ── PRODUCTION-PACK COMPLETION + ZIP ASSEMBLY ────────────────────────────────
// activate-print-worker kicks /process-panel per side FIRE-AND-FORGET (pg_net),
// so this worker's HTTP responses are never read — completion has to be recorded
// server-side or nothing downstream ever knows the pack is done. After each
// panel finishes we stamp panelizer_jobs.concept_json.print_worker.panels[key],
// and once EVERY activated side has its print-res file in storage we assemble
// ONE production-pack ZIP next to the files and stamp its URL. This worker only
// exposes the verified artifact for Admin QC; approval and delivery happen in
// separate server-side stages. Files are staged on disk and STORED, not
// recompressed (TIFF/PNG already are), so memory stays flat regardless of size.

async function stampPrintWorker(jobId, mutate) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const { data: row, error } = await supabase
      .from("panelizer_jobs").select("concept_json, updated_at").eq("id", jobId).maybeSingle();
    if (error) { if (attempt === 8) throw new Error(`stamp read: ${error.message}`); continue; }
    if (!row) { if (attempt === 8) throw new Error(`stamp read: job ${jobId} not found`); continue; }
    const concept = row.concept_json || {};
    const pw = { ...(concept.print_worker || {}) };
    // A source-bound worker may finish after a newer rebuild became active.
    // Returning false rejects that stale completion without touching the current
    // run's stamps.
    if (mutate(pw) === false) return null;
    const { data: updated, error: upErr } = await supabase
      .from("panelizer_jobs")
      .update({ concept_json: { ...concept, print_worker: pw } })
      .eq("id", jobId)
      // Compare-and-set on the scalar updated_at, NOT on the jsonb column. The
      // BEFORE UPDATE trigger `panelizer_jobs_updated_at` bumps updated_at on
      // every write, so it is a correct optimistic fence: another panel finishing
      // (or a source switch) between our read and write changes updated_at, our
      // filter misses, and the retry merges against the new current state. The old
      // `.eq("concept_json", concept)` could NEVER match — supabase-js serializes
      // an object filter to the literal "[object Object]", which PostgREST rejects
      // as "invalid input syntax for type json", so the update silently affected 0
      // rows and every stamp was dropped (no QC card, no ZIP, no delivery).
      .eq("updated_at", row.updated_at)
      .select("id")
      .maybeSingle();
    if (!upErr && updated?.id) return pw;
    if (upErr && attempt === 8) throw new Error(`stamp write: ${upErr.message}`);
  }
  throw new Error("stamp write conflicted repeatedly");
}

// A finished PRINT file is dpi-suffixed (driver_side_226x70_1500dpi_CMYK.tiff /
// _1500dpi.png) — the bare {panelKey}.png preview does NOT count as done.
const PRINT_FILE_RE = /_\d+dpi(_CMYK)?\.(tiff?|png)$/i;

const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DISPATCH_LEASE_SECONDS = 900;
const DISPATCH_HEARTBEAT_MS = 30_000;

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

function hashArtifactEvidence(artifacts) {
  const canonical = [...artifacts]
    .map(({ kind, path: artifactPath, bytes, sha256 }) => ({
      kind,
      path: artifactPath,
      bytes,
      sha256,
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256Buffer(Buffer.from(JSON.stringify(canonical)));
}

async function failDispatchBestEffort(dispatch, error) {
  if (!dispatch?.id || !dispatch?.token) return;
  const message = String(error?.message || error || "dispatch failed").slice(0, 2000);
  try {
    const { data, error: rpcError } = await supabase.rpc(
      "fail_production_panel_dispatch",
      {
        p_dispatch_id: dispatch.id,
        p_lease_token: dispatch.token,
        p_error: message,
        p_retry_delay_seconds: 30,
      },
    );
    if (rpcError) throw rpcError;
    if (data !== true) {
      console.warn(`[WORKER] dispatch ${dispatch.id} failure was not recorded (lease no longer current)`);
    }
  } catch (failError) {
    console.warn(`[WORKER] dispatch ${dispatch.id} failure RPC failed: ${failError.message}`);
  }
}

function startDispatchHeartbeat(dispatch) {
  let stopped = false;
  let renewalPromise = null;
  let leaseError = null;

  const renew = async () => {
    if (stopped) return;
    if (leaseError) throw leaseError;
    if (renewalPromise) return renewalPromise;
    renewalPromise = (async () => {
      const { data, error } = await supabase.rpc(
        "heartbeat_production_panel_dispatch",
        {
          p_dispatch_id: dispatch.id,
          p_lease_token: dispatch.token,
          p_lease_seconds: DISPATCH_LEASE_SECONDS,
        },
      );
      if (error) throw error;
      if (data !== true) {
        leaseError = new Error(`dispatch ${dispatch.id} lease is no longer current`);
        throw leaseError;
      }
    })().finally(() => {
      renewalPromise = null;
    });
    return renewalPromise;
  };

  const timer = setInterval(() => {
    renew().catch((error) => {
      console.error(`[WORKER] dispatch heartbeat failed: ${error.message}`);
    });
  }, DISPATCH_HEARTBEAT_MS);
  timer.unref?.();

  return {
    renew,
    assertCurrent() {
      if (leaseError) throw leaseError;
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

const PANELJUDGE_RESOURCE_KEY = "tool:paneljudge:slot:1";
const PANELJUDGE_LEASE_SECONDS = 900;
const PANELJUDGE_HEARTBEAT_MS = 30_000;

function panelJudgeLeaseError(message, cause = null) {
  const error = new Error(message);
  error.code = "PANELJUDGE_LEASE_LOST";
  if (cause) error.cause = cause;
  return error;
}

async function claimPanelJudgeResourceLease(side) {
  const owner = [
    "designpro-paneljudge",
    process.env.DESIGNPRO_WORKER_ID ||
      process.pid,
    randomUUID(),
  ].join(":");
  const { data, error } = await supabase.rpc(
    "claim_workflow_resource_lease",
    {
      p_resource_key: PANELJUDGE_RESOURCE_KEY,
      p_owner: owner,
      p_lease_seconds: PANELJUDGE_LEASE_SECONDS,
      p_context: {
        route: "/panel-qccheck",
        side,
      },
    },
  );
  if (error) {
    throw panelJudgeLeaseError(
      `paneljudge resource lease claim failed: ${error.message}`,
      error,
    );
  }
  if (!data?.acquired) {
    return {
      acquired: false,
      leaseExpiresAt: data?.leaseExpiresAt || null,
    };
  }
  if (!data.leaseToken) {
    throw panelJudgeLeaseError(
      "paneljudge resource lease claim returned no fencing token",
    );
  }
  return {
    acquired: true,
    resourceKey: PANELJUDGE_RESOURCE_KEY,
    owner,
    token: data.leaseToken,
  };
}

function startPanelJudgeResourceHeartbeat(lease) {
  let stopped = false;
  let renewalPromise = null;
  let leaseError = null;

  const renew = async () => {
    if (leaseError) throw leaseError;
    if (stopped) {
      throw panelJudgeLeaseError("paneljudge resource lease heartbeat is stopped");
    }
    if (renewalPromise) return renewalPromise;
    renewalPromise = (async () => {
      const { data, error } = await supabase.rpc(
        "heartbeat_workflow_resource_lease",
        {
          p_resource_key: lease.resourceKey,
          p_lease_token: lease.token,
          p_lease_seconds: PANELJUDGE_LEASE_SECONDS,
        },
      );
      if (error || data !== true) {
        leaseError = panelJudgeLeaseError(
          error
            ? `paneljudge resource lease heartbeat failed: ${error.message}`
            : "paneljudge resource lease is no longer current",
          error,
        );
        throw leaseError;
      }
    })().finally(() => {
      renewalPromise = null;
    });
    return renewalPromise;
  };

  const timer = setInterval(() => {
    renew().catch((error) => {
      console.error(`[WORKER] paneljudge heartbeat failed: ${error.message}`);
    });
  }, PANELJUDGE_HEARTBEAT_MS);
  timer.unref?.();

  return {
    renew,
    assertCurrent() {
      if (leaseError) throw leaseError;
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (renewalPromise) {
        try {
          await renewalPromise;
        } catch {
          // The request already fails closed on a lost lease.
        }
      }
    },
  };
}

async function releasePanelJudgeResourceLease(lease) {
  if (!lease?.resourceKey || !lease?.token) return;
  try {
    const { data, error } = await supabase.rpc(
      "release_workflow_resource_lease",
      {
        p_resource_key: lease.resourceKey,
        p_lease_token: lease.token,
      },
    );
    if (error) throw error;
    if (data !== true) {
      console.warn("[WORKER] paneljudge resource lease was no longer current at release");
    }
  } catch (error) {
    console.warn(`[WORKER] paneljudge resource lease release failed: ${error.message}`);
  }
}

// A durable DesignPro job is not approved merely because every panel handler
// returned. A verified ZIP advances the exact source/version/run only to the
// human Admin QC gate; approval/delivery remain separate server-side actions.
// Query by panelizer job, then compare the immutable identity inside result so
// an older in-flight run can never advance a newer paid job.
async function closeMatchingDesignProJob({
  jobId, sourceHash, packVersion, runKey, zipStamp,
}) {
  if (!jobId || !sourceHash || !packVersion || !runKey) {
    return { skipped: "legacy run has no durable source identity" };
  }

  const identityMatches = (result) => {
    const value = result && typeof result === "object" ? result : {};
    return (
      String(value.sourceHash || "").toLowerCase() === String(sourceHash).toLowerCase() &&
      String(value.packVersion || "").toLowerCase() === String(packVersion).toLowerCase() &&
      String(value.runKey || "").toLowerCase() === String(runKey).toLowerCase()
    );
  };

  // Usually run-production-flow has moved activating_worker → worker_queued
  // long before a print ZIP can finish. The short retry closes the tiny race for
  // an already-rendered pack without ever writing through an activating state
  // that the orchestrator could subsequently overwrite.
  for (let attempt = 1; attempt <= 20; attempt++) {
    const { data: jobs, error } = await supabase
      .from("designpro_production_jobs")
      .select("id,state,result")
      .eq("panelizer_job_id", jobId)
      .in("state", ["activating_worker", "worker_queued", "awaiting_admin_qc"])
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(`durable production job read: ${error.message}`);

    const matching = (jobs || []).filter((job) => identityMatches(job.result));
    if (!matching.length) {
      return { skipped: "no durable job for this source run" };
    }
    const alreadyClosed = matching.filter((job) => job.state === "awaiting_admin_qc");
    if (alreadyClosed.length) {
      return { closed: alreadyClosed.map((job) => job.id), idempotent: true };
    }

    const queued = matching.filter((job) => job.state === "worker_queued");
    if (queued.length) {
      const closed = [];
      const now = new Date().toISOString();
      for (const job of queued) {
        const result = job.result && typeof job.result === "object" ? job.result : {};
        const { data: updated, error: updateError } = await supabase
          .from("designpro_production_jobs")
          .update({
            state: "awaiting_admin_qc",
            stage: "admin_qc",
            blocked: ["admin_qc"],
            result: {
              ...result,
              sourceHash,
              packVersion,
              runKey,
              zip: zipStamp,
              qc: {
                ...(result.qc && typeof result.qc === "object" ? result.qc : {}),
                status: "required",
              },
            },
            last_error: null,
            completed_at: null,
            updated_at: now,
          })
          .eq("id", job.id)
          .eq("state", "worker_queued")
          .eq("result->>sourceHash", sourceHash)
          .eq("result->>packVersion", packVersion)
          .eq("result->>runKey", runKey)
          .select("id")
          .maybeSingle();
        if (updateError) throw new Error(`durable production job close: ${updateError.message}`);
        if (updated?.id) closed.push(updated.id);
      }
      if (closed.length) return { closed };
    }

    // Exact matches still in activating_worker are the only reason to wait.
    if (attempt < 20) await waitMs(500);
  }
  return { skipped: "no matching worker_queued durable job" };
}

const _packagingLocks = new Set();
async function packageOrderPack({
  jobId, userId, orderNumber, runKey = null, sourceHash = null, packVersion = null, force = false,
}) {
  const safeRunKey = runKey ? String(runKey).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64) : null;
  const hasPackageIdentity = !!(sourceHash || packVersion || safeRunKey);
  if (hasPackageIdentity && (!jobId || !sourceHash || !packVersion || !safeRunKey)) {
    throw new Error("source-bound packaging requires jobId, sourceHash, packVersion, and runKey");
  }
  const dir = safeRunKey
    ? `production-packs/${userId}/${orderNumber}/runs/${safeRunKey}`
    : `production-packs/${userId}/${orderNumber}`;
  if (_packagingLocks.has(dir)) return { skipped: "already packaging" };
  _packagingLocks.add(dir);
  let packageDispatch = null;
  let packageHeartbeat = null;
  let packageCompleted = false;
  try {
    let jobConcept = null;
    if (jobId) {
      const { data: jobRow } = await supabase
        .from("panelizer_jobs").select("concept_json").eq("id", jobId).maybeSingle();
      jobConcept = (jobRow && jobRow.concept_json) || null;
    }
    const currentPw = jobConcept?.print_worker || {};
    if (safeRunKey && (
      String(currentPw.run_key || "") !== safeRunKey ||
      String(currentPw.source_hash || "") !== String(sourceHash || "") ||
      String(currentPw.pack_version || "") !== String(packVersion || "")
    )) {
      return { skipped: "stale source run" };
    }

    let expectedPanelKeys = [];
    let fileSources = [];
    let durableJob = null;
    let durableStaticAssets = null;
    if (hasPackageIdentity) {
      const { data: durableJobs, error: durableReadError } = await supabase
        .from("designpro_production_jobs")
        .select("id,state,result")
        .eq("panelizer_job_id", jobId)
        .in("state", ["activating_worker", "worker_queued", "awaiting_admin_qc"])
        .order("updated_at", { ascending: false })
        .limit(20);
      if (durableReadError) {
        throw new Error(`durable package manifest: ${durableReadError.message}`);
      }
      durableJob = (durableJobs || []).find((candidate) => {
        const result =
          candidate?.result && typeof candidate.result === "object"
            ? candidate.result
            : {};
        return (
          String(result.sourceHash || "").toLowerCase() ===
            String(sourceHash).toLowerCase() &&
          String(result.packVersion || "").toLowerCase() ===
            String(packVersion).toLowerCase() &&
          String(result.runKey || "").toLowerCase() === safeRunKey
        );
      });
      const durableExpected = Array.isArray(durableJob?.result?.expectedPanels)
        ? durableJob.result.expectedPanels.map(String)
        : [];
      if (
        !durableJob ||
        durableExpected.length === 0 ||
        new Set(durableExpected).size !== durableExpected.length
      ) {
        throw new Error("durable package manifest is missing or invalid");
      }
      expectedPanelKeys = durableExpected;
      durableStaticAssets = Array.isArray(durableJob.result?.staticAssets)
        ? durableJob.result.staticAssets
        : null;
      if (!durableStaticAssets) {
        throw new Error("durable Logo Pack manifest is missing");
      }

      // The ledger is the only source of panel artifacts for a durable pack.
      // concept_json and directory listings are compatibility views and must
      // never select bytes for packaging.
      const { data: panelDispatches, error: panelDispatchError } = await supabase
        .from("production_panel_dispatches")
        .select("panel_key,status,output,output_hash")
        .eq("production_job_id", durableJob.id)
        .eq("source_hash", String(sourceHash).toLowerCase())
        .eq("pack_version", String(packVersion).toLowerCase())
        .eq("run_key", safeRunKey)
        .in("panel_key", expectedPanelKeys);
      if (panelDispatchError) {
        throw new Error(`panel dispatch readiness: ${panelDispatchError.message}`);
      }
      const rowsByKey = new Map(
        (panelDispatches || []).map((dispatch) => [
          String(dispatch.panel_key),
          dispatch,
        ]),
      );
      const waitingDispatches = expectedPanelKeys.filter((panelKey) => {
        const dispatch = rowsByKey.get(panelKey);
        const output =
          dispatch?.output && typeof dispatch.output === "object"
            ? dispatch.output
            : {};
        return (
          dispatch?.status !== "completed" ||
          !String(dispatch?.output_hash || "") ||
          String(output.sourceHash || "").toLowerCase() !==
            String(sourceHash).toLowerCase() ||
          String(output.packVersion || "").toLowerCase() !==
            String(packVersion).toLowerCase() ||
          String(output.runKey || "").toLowerCase() !== safeRunKey ||
          String(output.panelKey || "") !== panelKey
        );
      });
      if (waitingDispatches.length) {
        return { skipped: `waiting on verified dispatches: ${waitingDispatches.join(", ")}` };
      }

      const attemptPrefix = `${dir}/attempts/`;
      const requiredKinds = new Set(["tiff", "png", "preview", "eps"]);
      // Logo dispatches (gap a) produce a hi-res alpha PNG plus a byte-exact
      // source copy — TIFF/EPS are panel print encodings, not cut-asset ones.
      const logoRequiredKinds = new Set(["png", "preview"]);
      const archiveNames = new Set();
      for (const panelKey of expectedPanelKeys) {
        const isLogoKey = /^logo_\d+$/.test(panelKey);
        const output = rowsByKey.get(panelKey).output;
        const artifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
        const kinds = new Set(artifacts.map((artifact) => String(artifact?.kind || "")));
        const missingKinds = [...(isLogoKey ? logoRequiredKinds : requiredKinds)]
          .filter((kind) => !kinds.has(kind));
        if (missingKinds.length) {
          throw new Error(
            `completed dispatch ${panelKey} is missing artifacts: ${missingKinds.join(", ")}`,
          );
        }
        for (const artifact of artifacts) {
          const storagePath = String(artifact?.path || "");
          const artifactHash = String(artifact?.sha256 || "").toLowerCase();
          const bytes = Number(artifact?.bytes || 0);
          if (
            !storagePath.startsWith(attemptPrefix) ||
            storagePath.includes("..") ||
            !/^[0-9a-f]{64}$/.test(artifactHash) ||
            !(bytes > 0)
          ) {
            throw new Error(`completed dispatch ${panelKey} has invalid artifact evidence`);
          }
          // The as-is cut already ships in Logo-Pack/ from the frozen static
          // assets; only the hi-res variant joins the archive, under its own
          // folder so it can never shadow a panel file.
          if (isLogoKey && String(artifact?.kind) !== "png") continue;
          const baseName = path.basename(storagePath);
          const archiveName = isLogoKey ? `Logo-Pack-HiRes/${baseName}` : baseName;
          if (!baseName || archiveNames.has(archiveName)) {
            throw new Error(`completed dispatch ${panelKey} has a duplicate archive name`);
          }
          archiveNames.add(archiveName);
          fileSources.push({
            panelKey,
            kind: String(artifact.kind),
            storagePath,
            archiveName,
            sha256: artifactHash,
            bytes,
          });
        }
      }

      const workerIdentity = [
        "designpro-package",
        process.env.DESIGNPRO_WORKER_ID || process.pid,
      ].join(":");
      const { data: claim, error: claimError } = await supabase.rpc(
        "claim_production_package_dispatch",
        {
          p_panelizer_job_id: jobId,
          p_source_hash: sourceHash,
          p_pack_version: packVersion,
          p_run_key: safeRunKey,
          p_worker: workerIdentity,
          p_lease_seconds: DISPATCH_LEASE_SECONDS,
        },
      );
      if (claimError) throw new Error(`package dispatch claim: ${claimError.message}`);
      if (!claim?.claimed) {
        if (claim?.status === "completed") {
          const { data: completedRow, error: completedReadError } = await supabase
            .from("production_panel_dispatches")
            .select("output,output_hash")
            .eq("id", claim.dispatchId)
            .eq("status", "completed")
            .maybeSingle();
          if (completedReadError || !completedRow?.output_hash) {
            throw new Error(
              completedReadError?.message ||
                "completed package dispatch has no durable output",
            );
          }
          const completedOutput =
            completedRow.output && typeof completedRow.output === "object"
              ? completedRow.output
              : {};
          const existingZip =
            completedOutput.zip && typeof completedOutput.zip === "object"
              ? completedOutput.zip
              : completedOutput;
          const durableOutputHash = String(
            completedRow.output_hash || "",
          ).toLowerCase();
          const existingZipHash = String(
            existingZip.sha256 || "",
          ).toLowerCase();
          if (
            String(completedOutput.sourceHash || "").toLowerCase() !==
              String(sourceHash).toLowerCase() ||
            String(completedOutput.packVersion || "").toLowerCase() !==
              String(packVersion).toLowerCase() ||
            String(completedOutput.runKey || "").toLowerCase() !== safeRunKey ||
            String(completedOutput.panelKey || "") !== "__package__" ||
            !String(existingZip.path || "") ||
            !String(existingZip.url || "") ||
            !/^[a-f0-9]{64}$/.test(durableOutputHash) ||
            !/^[a-f0-9]{64}$/.test(existingZipHash) ||
            existingZipHash !== durableOutputHash
          ) {
            throw new Error("completed package dispatch output is invalid");
          }
          const projected = await stampPrintWorker(jobId, (pw) => {
            if (
              String(pw.run_key || "") !== safeRunKey ||
              String(pw.source_hash || "") !== String(sourceHash || "") ||
              String(pw.pack_version || "") !== String(packVersion || "")
            ) return false;
            pw.zip = existingZip;
            return true;
          });
          if (!projected) {
            throw new Error("completed package dispatch no longer matches the active projection");
          }
          const durable = await closeMatchingDesignProJob({
            jobId,
            sourceHash,
            packVersion,
            runKey: safeRunKey,
            zipStamp: existingZip,
          });
          return {
            success: true,
            idempotent: true,
            skipped: "package dispatch already completed",
            zip: existingZip,
            durable,
            dispatchId: claim.dispatchId || null,
          };
        }
        return {
          skipped: "package dispatch already processing",
          idempotent: true,
          dispatchId: claim?.dispatchId || null,
        };
      }
      if (!claim.dispatchId || !claim.dispatchToken) {
        throw new Error("package dispatch claim returned no fencing token");
      }
      packageDispatch = { id: claim.dispatchId, token: claim.dispatchToken };
      packageHeartbeat = startDispatchHeartbeat(packageDispatch);
    } else {
      // Legacy callers retain the old root-directory behavior. Durable
      // DesignPro packs never enter this branch.
      const { data: listing, error: listErr } = await supabase.storage
        .from(BUCKET)
        .list(dir, { limit: 500 });
      if (listErr) throw new Error(`list ${dir}: ${listErr.message}`);
      let files = (listing || []).filter((file) =>
        file.id &&
        file.name &&
        !file.name.startsWith(".") &&
        !file.name.toLowerCase().endsWith(".zip"));
      const stamps = jobConcept?.print_worker?.panels || null;
      if (stamps && Object.keys(stamps).length) {
        const allowed = new Set();
        for (const stamp of Object.values(stamps)) {
          for (const artifactPath of [
            stamp.tiffPath,
            stamp.pngPath,
            stamp.epsPath,
            stamp.previewPath,
          ]) {
            if (artifactPath) allowed.add(path.basename(String(artifactPath)));
          }
        }
        const scoped = files.filter((file) => allowed.has(file.name));
        if (scoped.length) files = scoped;
      }
      if (!files.length) return { skipped: "no files to package" };
      if (!force) {
        expectedPanelKeys = Array.isArray(currentPw.activated)
          ? [...new Set(currentPw.activated.map(String))]
          : [];
        if (!expectedPanelKeys.length) return { skipped: "no activation manifest" };
        const waiting = expectedPanelKeys.filter((panelKey) =>
          !files.some((file) =>
            file.name.startsWith(`${panelKey}_`) &&
            PRINT_FILE_RE.test(file.name)));
        if (waiting.length) return { skipped: `waiting on sides: ${waiting.join(", ")}` };
      }
      fileSources = files.map((file) => ({
        storagePath: `${dir}/${file.name}`,
        archiveName: file.name,
        sha256: null,
        bytes: null,
      }));
    }

    const staticAssetManifest = hasPackageIdentity
      ? durableStaticAssets
      : currentPw.static_assets;
    const staticAssets = Array.isArray(staticAssetManifest)
      ? staticAssetManifest.filter((asset) =>
          asset &&
          ["wrap-files", "extracted-elements"].includes(String(asset.bucket || BUCKET)) &&
          typeof asset.path === "string" &&
          asset.path.length > 0 &&
          !asset.path.includes("..") &&
          /^[a-f0-9]{64}$/.test(String(asset.sha256 || "").toLowerCase()) &&
          Number.isSafeInteger(Number(asset.bytes)) &&
          Number(asset.bytes) > 0 &&
          (!safeRunKey || (
            String(asset.source_hash || "") === String(sourceHash || "") &&
            String(asset.pack_version || "") === String(packVersion || "") &&
            String(asset.run_key || "") === safeRunKey
          )))
      : [];

    console.log(`[WORKER] ═══ PACKAGING ${orderNumber}: ${fileSources.length} files → production-pack ZIP ═══`);
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "pack-"));
    try {
      const staged = [];
      for (const [index, source] of fileSources.entries()) {
        const { data, error } = await supabase.storage
          .from(BUCKET)
          .download(source.storagePath);
        if (error) throw new Error(`download ${source.storagePath}: ${error.message}`);
        const bytes = Buffer.from(await data.arrayBuffer());
        if (source.sha256 && sha256Buffer(bytes) !== source.sha256) {
          throw new Error(`artifact hash mismatch: ${source.storagePath}`);
        }
        if (source.bytes && bytes.length !== source.bytes) {
          throw new Error(`artifact size mismatch: ${source.storagePath}`);
        }
        const localPath = path.join(tmp, `panel-${index}`);
        await fsp.writeFile(localPath, bytes);
        staged.push({
          name: source.archiveName,
          path: localPath,
          source_path: source.storagePath,
          sha256: sha256Buffer(bytes),
          bytes: bytes.length,
        });
      }
      for (const [index, asset] of staticAssets.entries()) {
        const assetBucket = String(asset.bucket || BUCKET);
        const { data, error } = await supabase.storage
          .from(assetBucket)
          .download(asset.path);
        if (error) throw new Error(`download logo asset ${asset.path}: ${error.message}`);
        const extension = path.extname(asset.path).toLowerCase() || ".png";
        const sideSlug = String(asset.side || "panel").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const labelSlug = String(asset.label || `logo-${index + 1}`).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 48);
        const archiveName = `Logo-Pack/${sideSlug}-${labelSlug}-${index + 1}${extension}`;
        const localPath = path.join(tmp, `logo-${index + 1}${extension}`);
        const bytes = Buffer.from(await data.arrayBuffer());
        if (
          sha256Buffer(bytes) !== String(asset.sha256).toLowerCase() ||
          bytes.length !== Number(asset.bytes)
        ) {
          throw new Error(`frozen logo asset mismatch: ${asset.path}`);
        }
        await fsp.writeFile(localPath, bytes);
        staged.push({
          name: archiveName,
          path: localPath,
          source_path: `${assetBucket}/${asset.path}`,
          sha256: sha256Buffer(bytes),
          bytes: bytes.length,
        });
      }
      const orderSlug = String(orderNumber).replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
      const zipName = `production-pack-${orderSlug}${safeRunKey ? `-${safeRunKey}` : ""}.zip`;
      const zipPath = path.join(tmp, zipName);
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(zipPath);
        const zip = archiver("zip", { store: true });
        out.on("close", resolve);
        zip.on("error", reject);
        zip.pipe(out);
        for (const s of staged) zip.file(s.path, { name: s.name });
        zip.finalize();
      });
      const { size } = await fsp.stat(zipPath);
      const zipSha256 = await sha256File(zipPath);
      const packageAttemptKey = packageDispatch
        ? sha256Buffer(
            Buffer.from(`${packageDispatch.id}:${packageDispatch.token}`),
          )
        : null;
      const storagePath = packageDispatch
        ? `${dir}/package-attempts/${packageAttemptKey}/${zipName}`
        : `${dir}/${zipName}`;
      // openAsBlob streams from disk lazily and carries a size, so fetch sends
      // Content-Length instead of loading the whole ZIP into memory.
      const blob = await fs.openAsBlob(zipPath, { type: "application/zip" });
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/zip",
          ...(packageDispatch ? {} : { "x-upsert": "true" }),
        },
        body: blob,
      });
      if (!up.ok) throw new Error(`zip upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
      const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      const zipStamp = {
        path: storagePath, url: publicUrl, size, file_count: staged.length,
        files: staged.map((s) => s.name), built_at: new Date().toISOString(),
        artifacts: staged.map((item) => ({
          name: item.name,
          source_path: item.source_path,
          bytes: item.bytes,
          sha256: item.sha256,
        })),
        sha256: zipSha256,
        source_hash: sourceHash || null, pack_version: packVersion || null, run_key: safeRunKey,
      };

      if (packageDispatch) {
        await packageHeartbeat.renew();
        packageHeartbeat.assertCurrent();
        const packageOutput = {
          sourceHash,
          packVersion,
          runKey: safeRunKey,
          panelKey: "__package__",
          path: storagePath,
          url: publicUrl,
          zip: zipStamp,
        };
        const { data: completed, error: completionError } = await supabase.rpc(
          "complete_production_panel_dispatch",
          {
            p_dispatch_id: packageDispatch.id,
            p_lease_token: packageDispatch.token,
            p_output: packageOutput,
            p_output_hash: zipSha256,
          },
        );
        if (completionError) {
          throw new Error(`package dispatch completion: ${completionError.message}`);
        }
        if (completed !== true) {
          throw new Error("package dispatch completion rejected stale fencing token");
        }
        packageCompleted = true;
        packageHeartbeat.stop();
      }

      let zipStampedCurrentRun = !safeRunKey;
      if (jobId) {
        const projected = await stampPrintWorker(jobId, (pw) => {
          if (safeRunKey && (
            String(pw.run_key || "") !== safeRunKey ||
            String(pw.source_hash || "") !== String(sourceHash || "") ||
            String(pw.pack_version || "") !== String(packVersion || "")
          )) return false;
          pw.zip = zipStamp;
          zipStampedCurrentRun = true;
          return true;
        });
        if (hasPackageIdentity && !projected) {
          throw new Error("completed ZIP no longer matches the active projection");
        }
      }
      if (safeRunKey && !zipStampedCurrentRun) {
        throw new Error("completed ZIP could not be projected onto the current run");
      }

      const durable = await closeMatchingDesignProJob({
        jobId,
        sourceHash,
        packVersion,
        runKey: safeRunKey,
        zipStamp,
      });
      if (durable?.skipped) {
        console.warn(`[WORKER] durable production completion: ${durable.skipped}`);
      }
      console.log(`[WORKER] ✓ PRODUCTION PACK: ${storagePath} (${(size / 1024 / 1024).toFixed(1)} MB, ${staged.length} files)`);
      return { success: true, zip: zipStamp, durable };
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  } catch (error) {
    if (packageDispatch && !packageCompleted) {
      await failDispatchBestEffort(packageDispatch, error);
    }
    throw error;
  } finally {
    packageHeartbeat?.stop();
    _packagingLocks.delete(dir);
  }
}

// ── Health check ────────────────────────────────────────────
app.get("/health", (req, res) => {
  // Self-report EXACTLY which required WORKER env vars are missing, by name, so a
  // misconfig (set on the wrong worker service/env, or as a Supabase secret instead
  // of on this worker) is obvious here instead of a silent Replicate/soft fallback.
  // Calls 8+ need only local Sharp plus the core Supabase/worker credentials.
  // Call 7 still performs the final allowed logo-location/clean-artwork AI work,
  // so full DesignProAI OS readiness also requires one Gemini key.
  const missing = [];
  if (!SUPABASE_SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!HAS_GEMINI) missing.push("GOOGLE_AI_API_KEY(_2..5)");
  res.json({
    status: "ok",
    service: "genie-production-worker",
    build: "designpro-deterministic-output-v1",
    // The `build` string above is hand-edited and therefore lies between edits —
    // it read "2026-07-03" for weeks of deploys. These come from the worker host's
    // injected build metadata, so "is my fix live?" is answerable by curling
    // /health and comparing the sha to git, instead of guessing from timing.
    commit: process.env.GIT_SHA || null,
    commitMessage: null,
    deployedBranch: process.env.DESIGNPRO_DEPLOY_BRANCH || null,
    workerId: DESIGNPRO_WORKER_ID,
    startedAt: WORKER_STARTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    ready: missing.length === 0,
    missing,
    bleedInches: BLEED_INCHES,
    sharp: sharp.versions,
    replicate: !!replicate,
    replicateDisabled: DISABLE_REPLICATE,
    // DIAGNOSTIC (not a secret — just a boolean flag): the RAW value the worker's
    // process actually sees. null = the variable NAME is absent/misspelled on this
    // service (tolerant parsing can't help a wrong name); a string that still yields
    // replicateDisabled:false means the value is an unexpected spelling.
    replicateFlagRaw: process.env.DISABLE_REPLICATE ?? null,
    vectorizer: !!(VECTORIZER_API_ID && VECTORIZER_API_SECRET),
    topaz: !!TOPAZ_API_KEY,
    gemini: HAS_GEMINI,
    geminiKeys: GEMINI_KEYS.length,
    designProOutput: {
      ready: missing.length === 0,
      engine: "sharp",
      aiAllowedAfterCall7: false,
      deterministicRasterEps: true,
      legacyPanelPollerEnabled: DESIGNPRO_PANEL_POLLER_ENABLED,
      productionClaimConcurrency: DESIGNPRO_PRODUCTION_CONCURRENCY,
    },
  });
});

// ── Per-side clean artboard @ 4K (high-native-detail SLICE SOURCES) ───────────
// Runs the SAME "de-vehicle → keep the exact design → fill to the edges" clean-edit
// pass as generate-2d-proof, but PER SIDE and at imageSize:"4K" — which the 256MB
// edge runtime can't decode (the 546 OOM guard that pins the edge version to 2K).
//
// WHY PER-SIDE: today ONE side-derived 2K artboard is cropped for every panel, so a
// 72" hood gets only a FRACTION of that image (~1,300px ≈ 18 PPI) and inherits the
// side's geometry. Generating each side from ITS OWN 4K view render gives the hood a
// FULL 4096px (≈ 57 PPI) and the correct per-side design. The 224" driver/passenger
// side is still ~18 PPI (a 4K image IS the whole side — Gemini caps at 4K); those
// big sides need TILING to exceed that, tracked as a follow-up.
//
// It does NOT touch the 2K approval proof or the deterministic slicer — it only gives
// the slicer a true-4K per-side SOURCE. Zero AI is added to the slicing step (the
// artboard was already an AI clean-edit; this just runs it bigger, once per side).
//
// Body: { sides: [{ side, viewUrl, widthInches, heightInches }], uid, jobId? }
//   (back-compat: a single { sideViewUrl, sideW, sideH, uid } is accepted too)
// Returns: { success, sides: { <side>: { url, path, pixelWidth, pixelHeight, aspect } | { error } } }
const CLEAN_ASPECTS = [["21:9", 21 / 9], ["16:9", 16 / 9], ["3:2", 1.5], ["4:3", 4 / 3], ["1:1", 1], ["3:4", 0.75], ["9:16", 9 / 16]];
// CORE PRINT RULE prompts: the painted BODY COLOR is part of the wrap design —
// keep it as the dominant flat background. The old wording ("remove ALL vehicle
// parts: body…", "fill to all four edges, no empty space") told Gemini to DELETE
// the paint and treat plain areas as empty, so sparse designs (black car + a few
// neon graphics) came back as a wall-to-wall pattern tile — the AI-slop panels.
// keepBranding flips ONLY the lettering rule: logos/text kept exactly in place
// (the "with graphics" companion field) instead of removed.
const cleanTiers = (keepBranding) => {
  const brandLine = keepBranding
    ? `KEEP every logo, company name, and all lettering of the WRAP DESIGN exactly as shown — same content, spelling, size, position, and colors; never redraw or reflow type. Manufacturer emblems (the Ford oval, Chevy bowtie, model badges) are part of the VEHICLE, not the wrap — never include them.`
    : `Also remove every logo, company name, phone number, website, and all lettering.`;
  return [
    `Take the attached image and EDIT it — do NOT redraw, restyle, or reinvent anything. Remove only the vehicle's STRUCTURE: windows and glass, wheels, tires, wheel arches, bumpers, grille, mirrors, lights, door handles, panel seams, manufacturer badges and emblems (Ford/Chevy/model lettering), the ground, and the studio background. The painted BODY COLOR is part of the wrap design — keep it as the flat background covering the same share of the canvas it covers on the vehicle. KEEP every graphic EXACTLY as shown — identical colors, shapes, gradients, and flow, at the SAME size and position. NEVER tile, repeat, duplicate, enlarge, or add graphics, and NEVER fill plain body-color areas with extra pattern — large solid areas are correct. If it is or contains a flag, preserve that EXACT flag — its specific colors, ripple, flames, distressing, and star field — NEVER replace it with a standard, clean, or canonical stock flag. ${brandLine} Extend the body color and the existing artwork naturally out to all four edges so the result is ONE continuous flat rectangle — the same wrap design flattened, nothing new invented.`,
    `Edit the attached image: remove the vehicle structure (glass, wheels, bumpers, mirrors, lights, seams, manufacturer badges/emblems, ground, background) ${keepBranding ? "but keep all text/logos exactly in place" : "and all text/logos"}. Keep the painted body color as the flat background and every graphic EXACTLY as-is at its original size and position — do not tile, repeat, or add pattern; plain body-color areas stay plain. Extend the body color and artwork naturally edge to edge.`,
    `Remove the vehicle structure ${keepBranding ? "(keep all lettering in place)" : "and all lettering"} from the attached image; keep the exact body color and graphics at their original scale and position, extending them naturally to every edge — add nothing new.`,
  ];
};

function pickCleanAspect(widthInches, heightInches) {
  const r = (Number(widthInches) > 0 && Number(heightInches) > 0) ? Number(widthInches) / Number(heightInches) : 0;
  if (r <= 0) return "16:9";
  let best = Infinity, chosen = "16:9";
  for (const [l, rr] of CLEAN_ASPECTS) { const e = Math.abs(rr - r); if (e < best) { best = e; chosen = l; } }
  return chosen;
}

// ── FIELD QC GATE ────────────────────────────────────────────────────────────
// Judge a minted field against its source 3D view before it can reach the
// slicer. Hard issues (wrong design, tiled/repeated motifs) mean the field must
// NEVER ship — that's the "rear/front/hood are wrong panel designs" class.
// Soft issues (vehicle remnants, floor ghosting, lettering rule missed) ship
// FLAGGED for review — artwork is right, cosmetic cleanup needed. The judge is
// the same image model in TEXT mode (no new model), fed ~1024px copies so the
// check stays cheap. Fail-OPEN on judge errors: a broken judge can never block
// production, it just loses the flag.
const QC_HARD_ISSUES = ["wrong_design", "tiled_or_repeated"];
async function qcCleanField({ srcB64, fieldBytes, side, keepBranding }) {
  const prompt = `You are print-production QC for vehicle wraps. IMAGE 1 is a 3D render of the ${side} of a wrapped vehicle (the approved design). IMAGE 2 should be that wrap flattened into ONE continuous flat field: vehicle structure removed (no glass, wheels, bumpers, lights, floor, room, or reflections), the painted body color kept as the flat background, every graphic at its original scale and position, ${keepBranding ? "all logos and lettering KEPT exactly in place" : "all logos and lettering removed"}, and nothing invented, tiled, or repeated.
Return ONLY JSON: {"pass":true|false,"issues":[...],"note":"one short sentence"}.
Allowed issue codes: "vehicle_remnants" (car parts/shadows/reflections visible), "floor_or_background" (studio floor/walls visible), "wrong_design" (colors/motifs/layout do not match IMAGE 1), "tiled_or_repeated" (a motif appears more times than in IMAGE 1), ${keepBranding ? '"text_missing" (lettering from IMAGE 1 was removed)' : '"text_present" (lettering was not removed)'}.
Only list REAL problems. pass=true means IMAGE 2 is a faithful flat version with no listed issues.`;
  try {
    const fieldSmall = await sharp(fieldBytes).resize(1024, 1024, { fit: "inside" }).png().toBuffer();
    const srcSmall = await sharp(Buffer.from(srcB64, "base64")).resize(1024, 1024, { fit: "inside" }).png().toBuffer();
    for (let k = 0; k < GEMINI_KEYS.length; k++) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_KEYS[k]}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [
                { text: prompt },
                { inlineData: { mimeType: "image/png", data: srcSmall.toString("base64") } },
                { inlineData: { mimeType: "image/png", data: fieldSmall.toString("base64") } },
              ] }],
              generationConfig: { responseModalities: ["TEXT"], temperature: 0 },
            }),
            signal: AbortSignal.timeout(60000),
          }
        );
        if (resp.status === 429 || resp.status >= 500) continue; // rotate key
        if (!resp.ok) break;
        const r = await resp.json();
        const txt = (r.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
        const m = txt.match(/\{[\s\S]*\}/);
        if (!m) break;
        const v = JSON.parse(m[0]);
        const issues = Array.isArray(v.issues) ? v.issues.map(String) : [];
        return { pass: v.pass === true && issues.length === 0, issues, note: String(v.note || "") };
      } catch (e) { console.warn(`[WORKER] field QC key ${k + 1} error for ${side}: ${e.message}`); }
    }
  } catch (e) { console.warn(`[WORKER] field QC errored for ${side}: ${e.message}`); }
  return { pass: true, issues: ["qc_unavailable"], note: "QC judge unavailable — passed open" };
}

// Generate ONE side's 4K clean field, gated by QC. Returns
// { url, path, pixelWidth, pixelHeight, aspect, qc } or throws.
// keepBranding=true mints the WITH-GRAPHICS companion (lettering kept in place).
async function generateCleanField({ side, viewUrl, widthInches, heightInches }, uid, jobId, keepBranding = false) {
  const sr = await fetch(viewUrl, { signal: AbortSignal.timeout(60000) });
  if (!sr.ok) throw new Error(`fetch ${side} view ${sr.status}`);
  const srcMime = sr.headers.get("content-type")?.split(";")[0] || "image/png";
  const srcB64 = Buffer.from(await sr.arrayBuffer()).toString("base64");
  const aspect = pickCleanAspect(widthInches, heightInches);
  const TIERS = cleanTiers(keepBranding);

  // One generation pass: rotate across the key POOL on 429/5xx (quota); the
  // tier shortens with the attempt number. Returns b64 or null (sets reason).
  let lastReason = "no image";
  const genOnce = async (attempt) => {
    const tier = Math.min(attempt - 1, TIERS.length - 1);
    const parts = [
      { text: `PANEL REFERENCE (${side}) — flatten THIS exact wrap side (body color + graphics at their original scale and position) into ONE continuous flat field:` },
      { text: TIERS[tier] },
      { inlineData: { mimeType: srcMime, data: srcB64 } },
    ];
    for (let k = 0; k < GEMINI_KEYS.length; k++) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_KEYS[k]}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspect, imageSize: "4K" } },
            }),
            signal: AbortSignal.timeout(120000),
          }
        );
        if (resp.status === 429 || resp.status >= 500) { lastReason = `key ${k + 1}/${GEMINI_KEYS.length} → ${resp.status}`; continue; } // rotate to next key
        if (!resp.ok) { lastReason = `Gemini ${resp.status}`; return null; } // non-quota error → shorter tier next attempt
        const cr = await resp.json();
        const cParts = cr.candidates?.[0]?.content?.parts;
        if (cParts) for (const p of cParts) { if (p.inlineData) return p.inlineData.data; }
        lastReason = `no image (${cr.candidates?.[0]?.finishReason || "?"})`;
        return null;
      } catch (e) { lastReason = `key ${k + 1} error: ${e.message}`; } // network/timeout → try next key
    }
    return null;
  };

  // GENERATE → QC → RETRY loop (max 3 generations). A QC pass returns
  // immediately. Soft-fail candidates are kept as the best fallback (flagged
  // for review); a run that produced ONLY hard-fail candidates throws — the
  // wrong design must never reach the slicer.
  let best = null; // { bytes, qc, soft }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const outB64 = await genOnce(attempt);
    if (!outB64) { if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
    const bytes = Buffer.from(outB64, "base64"); // the worker has the memory the edge lacks
    const qc = await qcCleanField({ srcB64, fieldBytes: bytes, side, keepBranding });
    if (qc.pass || qc.issues.includes("qc_unavailable")) { best = { bytes, qc: { ...qc, attempts: attempt } }; break; }
    const hard = qc.issues.some((i) => QC_HARD_ISSUES.includes(i));
    console.warn(`[WORKER] field QC ${side} attempt ${attempt}/3: ${qc.issues.join(",")} ${hard ? "(hard — retry)" : "(soft — usable with review)"}`);
    if (!hard && !best) best = { bytes, qc: { ...qc, attempts: attempt }, soft: true };
    lastReason = `QC: ${qc.issues.join(",")}`;
    if (attempt < 3) await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  if (!best) throw new Error(`clean extract failed for ${side}: ${lastReason}`);

  const { bytes, qc } = best;
  let pixelWidth = null, pixelHeight = null;
  try { const m = await sharp(bytes).metadata(); pixelWidth = m.width || null; pixelHeight = m.height || null; } catch { /* best-effort */ }
  const path = `renders/${uid}/2d-proofs/${jobId ? jobId + "_" : ""}${String(side).toLowerCase()}-${keepBranding ? "branded" : "clean"}-4k.png`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);
  const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  console.log(`[WORKER] clean-field ${side} 4K → ${pixelWidth}x${pixelHeight} (${aspect}) QC:${qc.pass ? "pass" : qc.issues.join(",")} ${path}`);
  return { url, path, pixelWidth, pixelHeight, aspect, qc };
}

app.post("/clean-artboard", authMiddleware, async (req, res) => {
  try {
    if (!HAS_GEMINI) return res.status(500).json({ success: false, error: "No GOOGLE_AI_API_KEY(_2..5) configured on the worker" });
    const { uid, jobId } = req.body || {};
    // Per-side array is the primary form; a single sideViewUrl stays back-compatible.
    let panels = Array.isArray(req.body?.sides) ? req.body.sides : [];
    if (!panels.length && req.body?.sideViewUrl) {
      panels = [{ side: "driver", viewUrl: req.body.sideViewUrl, widthInches: req.body.sideW, heightInches: req.body.sideH }];
    }
    if (!uid || !panels.length) return res.status(400).json({ success: false, error: "Missing required params (uid, sides[])" });

    // Sequential per side — keeps the Gemini key pool from being hit by 6 concurrent
    // 4K image calls (429). A per-side failure is isolated, never sinks the batch.
    const sides = {};
    for (const p of panels) {
      const label = p.side || "panel";
      if (!p.viewUrl) { sides[label] = { error: "missing viewUrl" }; continue; }
      try { sides[label] = await generateCleanField(p, uid, jobId, req.body?.keepBranding === true); }
      catch (e) { console.warn(`[WORKER] clean-field ${label} failed: ${e.message}`); sides[label] = { error: e.message }; }
    }
    const anyOk = Object.values(sides).some((s) => s && s.url);
    return res.status(anyOk ? 200 : 502).json({ success: anyOk, sides });
  } catch (e) {
    console.error("[WORKER] clean-artboard failed:", e.message);
    return res.status(500).json({ success: false, error: `clean-artboard failed: ${e.message}` });
  }
});

// ── PANEL QC JUDGE ───────────────────────────────────────────
// The per-panel qccheck verdict (roadmap #4's judge), relocated from the
// panel-pro-extract edge function: the 256MB edge isolate saturates under the
// day's extract traffic and 546s even SOLO judge calls (live 07-28), while
// this worker has real memory and the same key pool. Reached via the
// panel-artboard-generator step:"paneljudge" proxy. Body:
// { panelUrl, refUrl, sourceProofUrl?, side? } → { success, pass, checks, reason }.
app.post("/panel-qccheck", authMiddleware, async (req, res) => {
  let resourceLease = null;
  let resourceHeartbeat = null;
  try {
    if (!HAS_GEMINI) return res.status(500).json({ success: false, error: "No GOOGLE_AI_API_KEY(_2..5) configured on the worker" });
    const { panelUrl, refUrl, sourceProofUrl } = req.body || {};
    const side = String(req.body?.side || "panel");
    if (!panelUrl || !refUrl) return res.status(400).json({ success: false, error: "panelUrl and refUrl required" });

    const leaseClaim = await claimPanelJudgeResourceLease(side);
    if (!leaseClaim.acquired) {
      res.set("Retry-After", "30");
      return res.status(503).json({
        success: false,
        error: "panel-qccheck is busy; retry after the active judge releases its lease",
        code: "PANELJUDGE_BUSY",
        retryable: true,
        retryAfterSeconds: 30,
      });
    }
    resourceLease = leaseClaim;
    resourceHeartbeat = startPanelJudgeResourceHeartbeat(resourceLease);

    // Pre-downscaled fetches via the storage image transform; raw fallback is
    // fine here — the worker has the memory the edge lacks.
    const fetchSmall = async (u) => {
      let fu = u;
      if (u.includes("/storage/v1/object/")) {
        fu = u.replace("/storage/v1/object/", "/storage/v1/render/image/") + `?width=1600&resize=contain&quality=80`;
      }
      let rr = await fetch(fu, { signal: AbortSignal.timeout(20000) });
      if (!rr.ok && fu !== u) rr = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (!rr.ok) return null;
      return { b64: Buffer.from(await rr.arrayBuffer()).toString("base64"), mime: rr.headers.get("content-type")?.split(";")[0] || "image/png" };
    };
    const [panelImg, refImg, proofImg] = await Promise.all([
      fetchSmall(panelUrl),
      fetchSmall(refUrl),
      sourceProofUrl && sourceProofUrl !== refUrl ? fetchSmall(sourceProofUrl) : Promise.resolve(null),
    ]);
    if (!panelImg || !refImg) return res.status(400).json({ success: false, error: "qccheck fetch failed" });

    const qcPrompt = `Image 1 is a produced ${side} print PANEL (full-bleed flat wrap artwork). Image 2 is its cropped surface from the customer-approved 2D PROOF.${proofImg ? " Image 3 is that same full customer-approved 2D PROOF, provided only to clarify proof-wide text such as the design name/header and text visible elsewhere on the same approved sheet." : ""} The approved proof images are the ONLY source of truth for design and text. Never correct them from an earlier vehicle render, artboard, common spelling, or outside knowledge. Judge the panel strictly:
1. design_match — the panel's artwork (colors, motifs, layout) is clearly the same design as the approved proof's ${side} area, not a different or reinvented design.
2. text_ok — every confidently readable company name / tagline / phone number on the panel is spelled exactly as in the approved proof${proofImg ? " (use Image 3 only to clarify Image 2, because both are the same approved artifact)" : ""} (true also when the approved proof surface legitimately carries no text). A changed digit, omitted letter, substituted word, or added text fails. If text is too small or blurry to read CONFIDENTLY in the proof images, do not invent what it says and do not fail solely on an uncertain OCR guess.
3. full_bleed — artwork fills the entire rectangle: no blank margins, no vehicle-shaped silhouette or wheel-arch cutouts. A white/light field is a FAILURE only when the reference does NOT show it there — when the approved design itself uses white/light body color in that region it is valid printable artwork, never blank space. Mirrored artwork at the rectangle's outer edges is the print BLEED — expected, never a failure.
4. no_vehicle_or_sheet — the panel is FLAT ARTWORK ONLY. Fail this check if ANY vehicle element is visible: wheels, tires, wheel arches, windows or window openings, windshield, mirrors, door seams or handles, cab/bed silhouette, bumpers, grilles, manufacturer badges or emblems (Ford/Chevy/etc.), or a recognizable photo of a vehicle — and fail it for proof-sheet content (titles, dimension lines, labels, multiple vehicle views). When unsure whether something is a vehicle element, FAIL this check — a wrong panel must never ship.
5. layout_match — every focal logo, wordmark, text block, and distinctive graphic appears the same number of times and at approximately the same relative size, order, arrangement, and location on the ${side} surface as Image 2. Fail if anything is enlarged, shrunk, recentered, restacked, duplicated, omitted, moved to a different region, or borrowed from another surface. A small front/rear branding strip must remain a small strip; turning it into a large centered lockup is always a failure.
Respond ONLY with JSON: {"design_match":bool,"text_ok":bool,"full_bleed":bool,"no_vehicle_or_sheet":bool,"layout_match":bool,"reason":"<short>"}`;

    const parts = [
      { text: qcPrompt },
      { inlineData: { mimeType: panelImg.mime, data: panelImg.b64 } },
      { inlineData: { mimeType: refImg.mime, data: refImg.b64 } },
      ...(proofImg ? [{ inlineData: { mimeType: proofImg.mime, data: proofImg.b64 } }] : []),
    ];
    for (let k = 0; k < GEMINI_KEYS.length; k++) {
      try {
        // Prove this request still owns the global judge slot immediately
        // before and after every external judge invocation. A lost lease never
        // returns a verdict as authoritative.
        await resourceHeartbeat.renew();
        resourceHeartbeat.assertCurrent();
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEYS[k]}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts }],
              generationConfig: { temperature: 0, maxOutputTokens: 300, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
            }),
            signal: AbortSignal.timeout(30000),
          },
        );
        await resourceHeartbeat.renew();
        resourceHeartbeat.assertCurrent();
        if (resp.status === 429 || resp.status >= 500) { await new Promise((r) => setTimeout(r, 600 * (k + 1))); continue; }
        if (!resp.ok) return res.status(502).json({ success: false, error: `qccheck gemini ${resp.status}` });
        const j = await resp.json();
        const txt = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "{}";
        let checks = {};
        try { checks = JSON.parse(txt.replace(/```json|```/g, "").trim()); } catch { checks = {}; }
        const pass = checks.design_match === true && checks.text_ok === true &&
                     checks.full_bleed === true && checks.no_vehicle_or_sheet === true &&
                     checks.layout_match === true;
        console.log(`[WORKER] panel-qccheck ${side}: ${pass ? "pass" : "FAIL"} ${checks.reason || ""}`);
        return res.json({ success: true, mode: "qccheck", pass, checks, reason: checks.reason || "" });
      } catch (e) {
        if (e?.code === "PANELJUDGE_LEASE_LOST") throw e;
        console.warn(`[WORKER] panel-qccheck key ${k + 1} error: ${e.message}`);
      }
    }
    return res.status(502).json({ success: false, error: "qccheck exhausted the key pool" });
  } catch (e) {
    const leaseFailure = e?.code === "PANELJUDGE_LEASE_LOST";
    if (leaseFailure) res.set("Retry-After", "30");
    return res.status(leaseFailure ? 503 : 500).json({
      success: false,
      error: `panel-qccheck failed: ${e.message}`,
      ...(leaseFailure
        ? {
            code: "PANELJUDGE_LEASE_LOST",
            retryable: true,
            retryAfterSeconds: 30,
          }
        : {}),
    });
  } finally {
    if (resourceHeartbeat) await resourceHeartbeat.stop();
    if (resourceLease) await releasePanelJudgeResourceLease(resourceLease);
  }
});

// ── PANEL CONCURRENCY GATE ───────────────────────────────────
// activate-print-worker kicks every side (branded + clean = up to 12 requests)
// in one burst. Unthrottled, each request holds multi-hundred-MB Sharp buffers
// concurrently and the instance dies (RP-101051, 2026-07-27: 7×502 "Application
// failed to respond" + 4×"fetch failed" — 1 of 12 panels produced). This gate
// admits PANEL_CONCURRENCY panels at a time and queues the rest in-process.
// Queued requests whose pg_net connection times out (150s) still complete:
// Node keeps running the handler after the socket drops, and completion is
// stamped server-side in Step 8 — the response was never read anyway.
const PANEL_CONCURRENCY = Math.max(1, parseInt(process.env.PANEL_CONCURRENCY || "2", 10));
let _panelActive = 0;
const _panelWaiters = [];
function acquirePanelSlot() {
  if (_panelActive < PANEL_CONCURRENCY) { _panelActive++; return Promise.resolve(); }
  return new Promise((resolve) => _panelWaiters.push(resolve));
}
function releasePanelSlot() {
  const next = _panelWaiters.shift();
  if (next) next();
  else _panelActive = Math.max(0, _panelActive - 1);
}

// ── Process panel job ───────────────────────────────────────
app.post("/process-panel", authMiddleware, async (req, res) => {
  const {
    jobId,
    userId,
    orderNumber,     // e.g. "RP-100734" — used for storage path
    panelKey,
    panelLabel,
    widthInches,
    heightInches,
    inputPath,       // Supabase storage path to Gemini-extracted panel
    outputTiff,      // true = produce TIFF
    outputEps,       // true = produce EPS (durable DesignPro uses local encoding)
    sourceHash,      // immutable atomic-pack identity
    packVersion,     // source-hashed production_flow_assets.version
    runKey,          // storage/stamp scope for this exact source pack
    dispatchId,      // production_panel_dispatches.id
    dispatchToken,   // source-bound fencing token
    inputFingerprintKey,
    inputSha256,     // frozen verify_atomic_pack input hash
    inputBytes,      // frozen verify_atomic_pack input byte count
  } = req.body;

  if (!jobId || !userId || !panelKey || !widthInches || !heightInches || !inputPath) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const hasRunIdentity = !!(sourceHash || packVersion || runKey);
  if (hasRunIdentity && (!sourceHash || !packVersion || !runKey)) {
    return res.status(400).json({ error: "sourceHash, packVersion, and runKey must be supplied together" });
  }
  if (hasRunIdentity && (!dispatchId || !dispatchToken)) {
    return res.status(400).json({
      error: "source-bound panels require dispatchId and dispatchToken",
    });
  }
  if (
    hasRunIdentity &&
    (
      !String(inputFingerprintKey || "") ||
      !/^[a-f0-9]{64}$/.test(String(inputSha256 || "").toLowerCase()) ||
      !Number.isSafeInteger(Number(inputBytes)) ||
      Number(inputBytes) <= 0
    )
  ) {
    return res.status(400).json({
      error: "source-bound panels require a frozen input fingerprint",
    });
  }
  if (!hasRunIdentity && (dispatchId || dispatchToken)) {
    return res.status(400).json({
      error: "dispatchId and dispatchToken require sourceHash, packVersion, and runKey",
    });
  }
  // A source-bound request is the paid DesignPro production path. Once Call 7
  // has frozen the production source, this worker may encode and deterministically
  // resample those bytes only. Fail closed if an older activator asks for any
  // generative/reconstructive path instead of silently accepting it.
  if (hasRunIdentity && req.body.native !== true) {
    return res.status(400).json({
      error: "Source-bound DesignPro panels require deterministic native mode",
    });
  }
  if (
    hasRunIdentity &&
    (
      req.body.useTopaz === true ||
      ["clarity", "esrgan", "real-esrgan", "topaz"].includes(
        String(req.body.upscaler || "").toLowerCase(),
      ) ||
      req.body.reconstruct === true
    )
  ) {
    return res.status(400).json({
      error: "AI reconstruction is forbidden after the frozen DesignPro proof",
    });
  }
  if (hasRunIdentity && outputEps !== true) {
    return res.status(400).json({
      error: "Source-bound DesignPro panels require deterministic EPS output",
    });
  }
  if (hasRunIdentity) {
    const sourceBleedInches = Number(req.body.sourceBleedInches);
    const trimWidthInches = Number(req.body.trimWidthInches);
    const trimHeightInches = Number(req.body.trimHeightInches);
    const addedBleedInches = req.body.addBleed === false ? 0 : BLEED_INCHES;
    if (
      ![0, BLEED_INCHES].includes(sourceBleedInches) ||
      !(trimWidthInches > 0 && trimHeightInches > 0) ||
      Math.abs(Number(widthInches) - (trimWidthInches + sourceBleedInches * 2)) > 0.001 ||
      Math.abs(Number(heightInches) - (trimHeightInches + sourceBleedInches * 2)) > 0.001 ||
      sourceBleedInches + addedBleedInches !== BLEED_INCHES
    ) {
      return res.status(400).json({
        error: "Source-bound DesignPro panels require exactly five inches of bleed on every edge",
      });
    }
  }
  const safeRunKey = runKey
    ? String(runKey).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64)
    : null;
  if (runKey && (!safeRunKey || safeRunKey !== String(runKey).toLowerCase())) {
    return res.status(400).json({ error: "Invalid runKey" });
  }

  // Reject an already-stale request before spending worker time. A request can
  // still become stale while processing; the output is isolated by runKey and
  // the completion stamp is checked again after processing.
  if (hasRunIdentity) {
    const { data: currentJob } = await supabase
      .from("panelizer_jobs").select("concept_json").eq("id", jobId).maybeSingle();
    const currentPw = currentJob?.concept_json?.print_worker || {};
    if (
      String(currentPw.source_hash || "") !== String(sourceHash) ||
      String(currentPw.pack_version || "") !== String(packVersion) ||
      String(currentPw.run_key || "") !== safeRunKey
    ) {
      await failDispatchBestEffort(
        { id: dispatchId, token: dispatchToken },
        new Error("Stale source run"),
      );
      return res.status(409).json({ error: "Stale source run", runKey: safeRunKey });
    }
  }

  // Every fenced attempt gets its own immutable folder. Hashing the fencing
  // token keeps the credential out of the public path while ensuring that a
  // lease-lost attempt can never overwrite a newer attempt's artifacts.
  const orderFolder = orderNumber || jobId;
  const dispatchAttemptKey = hasRunIdentity
    ? sha256Buffer(Buffer.from(`${dispatchId}:${dispatchToken}`))
    : null;
  const storageFolder = safeRunKey
    ? `${orderFolder}/runs/${safeRunKey}/attempts/${dispatchAttemptKey}`
    : orderFolder;

  let panelDispatch = null;
  let panelHeartbeat = null;
  let panelDispatchCompleted = false;
  if (hasRunIdentity) {
    const { data: begun, error: beginError } = await supabase.rpc(
      "begin_production_panel_dispatch",
      {
        p_dispatch_id: dispatchId,
        p_lease_token: dispatchToken,
        p_lease_seconds: DISPATCH_LEASE_SECONDS,
      },
    );
    if (beginError) {
      return res.status(503).json({
        error: `Could not begin panel dispatch: ${beginError.message}`,
        panelKey,
      });
    }
    if (begun !== true) {
      return res.status(409).json({
        error: "Stale, expired, or duplicate panel dispatch",
        panelKey,
        dispatchId,
      });
    }
    panelDispatch = { id: dispatchId, token: dispatchToken };
    panelHeartbeat = startDispatchHeartbeat(panelDispatch);
  }

  console.log(`[WORKER] ═══ ${panelKey} (${widthInches}" × ${heightInches}") ═══ (${_panelActive}/${PANEL_CONCURRENCY} slots busy, ${_panelWaiters.length} queued)`);
  await acquirePanelSlot();
  const startMs = Date.now();

  try {
    // ── Step 1: Download panel from Supabase Storage ──
    console.log(`[WORKER] Downloading: ${inputPath}`);
    const { data: fileData, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(inputPath);
    if (dlError) throw new Error(`Download failed: ${dlError.message}`);

    let imageBuffer = Buffer.from(await fileData.arrayBuffer());
    if (hasRunIdentity) {
      const actualInputSha256 = sha256Buffer(imageBuffer);
      if (
        actualInputSha256 !== String(inputSha256).toLowerCase() ||
        imageBuffer.length !== Number(inputBytes)
      ) {
        throw new Error(
          `Frozen input mismatch for ${String(inputFingerprintKey)}`,
        );
      }
    }

    // ── BODY-COLOR FLOOR (legacy path only) — flatten any transparency onto the
    // design's own dominant painted color BEFORE anything else, so a transparent
    // or void region can never survive to print as a black/blank hole (the
    // RP-100975 "gaping black hole under the blue" defect). Opaque panels pass
    // through untouched. This was previously defined but never invoked.
    if (!hasRunIdentity) imageBuffer = await floorBodyColor(imageBuffer);

    const inputMeta = await sharp(imageBuffer).metadata();
    if (!inputMeta.width || !inputMeta.height) {
      throw new Error("Frozen panel has no readable pixel dimensions");
    }
    if (hasRunIdentity && inputMeta.hasAlpha) {
      const stats = await sharp(imageBuffer).stats();
      const alpha = stats.channels[3];
      if (alpha && alpha.min < 255) {
        throw new Error("Frozen DesignPro panel contains transparent pixels");
      }
    }
    if (hasRunIdentity) {
      const expectedHeight = inputMeta.width * Number(heightInches) / Number(widthInches);
      if (Math.abs(inputMeta.height - expectedHeight) > 1.01) {
        throw new Error(
          `Frozen panel aspect does not match GENIE geometry: ${inputMeta.width}x${inputMeta.height} vs ${widthInches}x${heightInches}`,
        );
      }
    }
    console.log(`[WORKER] Input: ${inputMeta.width}×${inputMeta.height}px (${(imageBuffer.length / 1024).toFixed(0)} KB)`);

    // ── Step 2: Calculate target dimensions ──
    const targetW = Math.round(widthInches * PPI);           // panel at 10% scale
    const targetH = Math.round(heightInches * PPI);
    const targetWBleed = targetW + BLEED_PX * 2;             // + 5" bleed each side
    const targetHBleed = targetH + BLEED_PX * 2;
    console.log(`[WORKER] Target: ${targetW}×${targetH}px (panel) → ${targetWBleed}×${targetHBleed}px (with bleed)`);

    // ── Step 3: ESRGAN upscale if needed ──
    // Only upscale if input is smaller than target. SKIPPED entirely in native
    // mode — native keeps the design's own pixels (no resample = crispy).
    if (req.body.native !== true && (inputMeta.width < targetWBleed || inputMeta.height < targetHBleed)) {
      const scaleNeeded = Math.max(targetWBleed / inputMeta.width, targetHBleed / inputMeta.height);
      console.log(`[WORKER] Upscale needed: ${scaleNeeded.toFixed(1)}x`);

      if (replicate && scaleNeeded > 1.5) {
        imageBuffer = await upscaleFor(req.body, imageBuffer, scaleNeeded);
      } else {
        // Sharp bicubic for small upscales or no Replicate
        console.log(`[WORKER] Using Sharp lanczos3 upscale`);
        imageBuffer = await sharp(imageBuffer)
          .resize(Math.max(targetWBleed, inputMeta.width), null, {
            kernel: "lanczos3",
            withoutEnlargement: false,
          })
          .png()
          .toBuffer();
      }
      const upMeta = await sharp(imageBuffer).metadata();
      console.log(`[WORKER] After upscale: ${upMeta.width}×${upMeta.height}px`);
    }

    // ── Step 4: build the print buffer ──
    // EXACT mode: just upscale the design to print pixels, preserving its exact
    // pixels + aspect — NO fit, NO mirror, NO bleed. (The mirror bleed is what
    // some designs read as "distorted"; exact mode is a pure hi-res copy.)
    // Default mode: fit at true proportions + mirror-extend the bleed.
    let withBleed;
    let topazDiag = null;
    // Captured for the completion stamp so per-side print resolution is QUERYABLE
    // (roadmap #6). Without this, whether a side reached print PPI or stayed
    // pixelated lived only in worker stdout — invisible to the dashboard/DB.
    let printMode = null, finalPPI = null, sourcePPI = null;
    if (req.body.native === true) {
      // ── SMART NATIVE MODE — the recipe the shop validated, made robust ──
      // A native crop is crispy because nothing is resampled: low-res-but-native
      // beats high-res-but-upscaled, so when the source has enough resolution we
      // keep its own pixels untouched (no AI, no fit, no stretch). ONLY when the
      // source is genuinely too small for print do we RECONSTRUCT it with Clarity
      // (which rebuilds real detail, not a blur) up toward a print PPI floor —
      // never a plain interpolating upscale. Then the 5" bleed is a SOFT ring.
      const TARGET_PPI = req.body.targetPpi ? Number(req.body.targetPpi) : 150; // wrap large-format standard
      let src = imageBuffer;
      let nm = await sharp(src).metadata();
      let nativePPI = (nm.width || 1) / widthInches;
      let mode = "native";
      // ── Reach the print-PPI floor when native falls short ──
      // DEFAULT = in-app SHARP lanczos3 (deterministic, no external API, no credits;
      // added below). Topaz/Clarity are OPTIONAL detail enhancers (photographic
      // texture) and are now OPT-IN only — Topaz runs solely when the caller sets
      // useTopaz:true, Clarity only when upscaler:"clarity". So by default we use
      // Sharp and never emit a credit error or pay for an enhancer.
      const topazKey = req.body.topazApiKey || TOPAZ_API_KEY;
      // sourceBelowFloor = the SOURCE was below the print floor BEFORE upscale (why
      // an enhancer was attempted). The authoritative print result is results.below_floor
      // (final PPI < 150), stamped later — QC gates on THAT, not this.
      topazDiag = {
        keyPresent: !!topazKey,
        sourceBelowFloor: nativePPI < TARGET_PPI,
        attempted: false,
        error: null,
        skipped: hasRunIdentity ? "forbidden_after_call7" : null,
        resultW: null,
      };
      if (!hasRunIdentity && nativePPI < TARGET_PPI && req.body.useTopaz === true && topazKey && req.body.reconstruct !== false) {
        try {
          topazDiag.attempted = true;
          const outW = Math.round(widthInches * TARGET_PPI);
          const outH = Math.round(((nm.height || 1) / (nm.width || 1)) * outW);
          const up = await topazUpscale(src, outW, outH, topazKey, req.body.topazModel);
          const um = up && await sharp(up).metadata();
          topazDiag.resultW = um ? um.width : null;
          if (um && um.width > (nm.width || 1)) { src = up; nm = um; nativePPI = (nm.width || 1) / widthInches; mode = "native+topaz"; }
        } catch (e) {
          const msg = String(e && e.message || e);
          // Topaz out of credits (402) or a reservation race (425) means the
          // OPTIONAL enhancer is unavailable — NOT a panel failure. The Sharp
          // lanczos3 path still reaches the print floor, so record a clean
          // "skipped" (no scary error) and let QC gate on results.below_floor.
          if (/\b(402|425)\b|insufficient credits|reserve credits/i.test(msg)) {
            topazDiag.skipped = "enhancer_unavailable_no_credits";
            topazDiag.error = null;
          } else {
            topazDiag.error = msg.slice(0, 300);
          }
          console.warn(`[WORKER] Topaz enhancer skipped (${topazDiag.skipped || "error"}): ${msg.slice(0, 120)}`);
        }
      }
      // Clarity: OPT-IN only (upscaler:"clarity") and only if it would actually add
      // pixels (its 64 MP cap can't beat a big native source like the 17K flag).
      const clarityCapW = Math.floor(Math.sqrt(64_000_000 * ((nm.width || 1) / (nm.height || 1))));
      if (!hasRunIdentity && mode === "native" && nativePPI < TARGET_PPI && req.body.upscaler === "clarity" && clarityCapW > (nm.width || 1) * 1.1 && replicate && req.body.reconstruct !== false) {
        try {
          const need = Math.min(16, Math.max(2, Math.ceil(TARGET_PPI / nativePPI)));
          const rebuilt = await clarityUpscale(src, {
            scaleFactor: need,
            creativity: req.body.creativity == null ? 1 : Number(req.body.creativity),
          });
          const rm = await sharp(rebuilt).metadata();
          if (rm.width > nm.width) { src = rebuilt; nm = rm; nativePPI = (nm.width || 1) / widthInches; mode = "native+reconstruct"; }
        } catch (e) { console.warn(`[WORKER] clarity enhancer skipped: ${e.message}`); }
      }
      // ── DEFAULT UPSCALE — in-app SHARP lanczos3 to the print floor ──
      // Deterministic, no external API, no credits. If the source (or an enhancer)
      // is still below the 150-PPI wrap floor, resize up to it with lanczos3. This
      // is the shop's own upscaler and it always reaches print resolution.
      if (nativePPI < TARGET_PPI) {
        try {
          const outW = Math.round(widthInches * TARGET_PPI);
          const up = await sharp(src).resize(outW, null, { kernel: "lanczos3", withoutEnlargement: false }).png().toBuffer();
          const um = await sharp(up).metadata();
          if (um.width > (nm.width || 1)) {
            src = up; nm = um; nativePPI = (um.width || 1) / widthInches;
            mode = mode === "native" ? "native+sharp" : `${mode}+sharp`;
          }
        } catch (e) { console.warn(`[WORKER] Sharp lanczos3 upscale skipped: ${e.message}`); }
      }
      const bleedNative = req.body.addBleed === false ? 0 : Math.max(0, Math.round(BLEED_INCHES * nativePPI));
      // Bleed = TRUE MIRROR-EXTEND — the wrap-industry / RIP standard (Onyx,
      // Caldera, Flexi): the artwork is reflected outward past the cut line so
      // the installer has real material to wrap with zero white edge. The design
      // inside the trim is untouched; only the wrap-around margin is the mirror.
      withBleed = bleedNative > 0
        ? await sharp(src)
            .extend({ top: bleedNative, bottom: bleedNative, left: bleedNative, right: bleedNative, extendWith: "mirror" })
            .png().toBuffer()
        : await sharp(src).png().toBuffer();
      const fm = await sharp(withBleed).metadata();
      printMode = mode;
      finalPPI = Math.round(nativePPI);
      sourcePPI = Math.round((await sharp(imageBuffer).metadata()).width / widthInches);
      console.log(`[WORKER] ${mode} ${nm.width}×${nm.height} @ ${nativePPI.toFixed(0)} PPI + ${bleedNative}px bleed → ${fm.width}×${fm.height}px`);
    } else if (req.body.exact === true) {
      const targetLong = Math.round(Math.max(widthInches, heightInches) * PPI);
      const m = await sharp(imageBuffer).metadata();
      const srcLong = Math.max(m.width, m.height);
      const sc = srcLong < targetLong ? targetLong / srcLong : 1;
      // Clarity (generative) ALWAYS runs when requested: it downscales a soft
      // giant and REBUILDS crisp detail, so it sharpens even a source that's
      // already ≥ target (the soft 17K flag). Plain ESRGAN only runs when a real
      // enlargement is needed (>1.5x) — it can't add detail that isn't there.
      if (replicate && req.body.upscaler === "clarity") {
        imageBuffer = await clarityUpscale(imageBuffer, {
          scaleFactor: Math.min(16, Math.max(2, Math.ceil(sc))),
          creativity: req.body.creativity == null ? 1 : Number(req.body.creativity),
        });
      } else if (srcLong < targetLong && replicate && sc > 1.5) {
        imageBuffer = await upscaleFor(req.body, imageBuffer, sc);
      }
      const m2 = await sharp(imageBuffer).metadata();
      const longIsWidth = m2.width >= m2.height;
      withBleed = await sharp(imageBuffer)
        .resize(longIsWidth ? targetLong : null, longIsWidth ? null : targetLong,
          { kernel: "lanczos3", fit: "inside", withoutEnlargement: false })
        .png()
        .toBuffer();
      // Optional CLEAN bleed: extend the edge pixels straight out (extendWith
      // "copy" = smooth continuation, NOT a mirror reflection) so there's wrap
      // material for the installer without the kaleidoscope look.
      if (req.body.addBleed === true) {
        withBleed = await sharp(withBleed)
          .extend({ top: BLEED_PX, bottom: BLEED_PX, left: BLEED_PX, right: BLEED_PX, extendWith: "copy" })
          .png()
          .toBuffer();
      }
      const fm = await sharp(withBleed).metadata();
      console.log(`[WORKER] EXACT${req.body.addBleed ? " + edge bleed" : " (no bleed)"}: ${fm.width}×${fm.height}px`);
    } else {
      // Keep the design's exact scale/position; fill the rest of the rectangle and
      // bleed by extending the artwork outward (NOT by stretching the design).
      withBleed = await fitAndBleed(imageBuffer, targetW, targetH, BLEED_PX);
      console.log(`[WORKER] Panel with bleed: ${targetWBleed}×${targetHBleed}px`);
    }

    // ── Step 5: Encode TIFF @ 1500 DPI ──
    const results = {};
    const artifactEvidence = [];
    // Per-side print-resolution record (queryable via the completion stamp).
    // print_ppi < 150 with topaz.attempted+error/no-lift == a pixelated side —
    // the signal that this side needs a TILED high-res source, not a bigger upscale.
    results.print_mode = printMode;         // native | native+topaz | native+reconstruct
    results.source_ppi = sourcePPI;         // PPI of the 4K slice BEFORE upscale
    results.print_ppi = finalPPI;           // PPI actually achieved for print
    results.below_floor = finalPPI != null ? finalPPI < 150 : null;
    results.topaz = topazDiag;              // {keyPresent, belowFloor, attempted, error, resultW}
    const outputMeta = hasRunIdentity ? await sharp(withBleed).metadata() : null;
    results.processing = hasRunIdentity
      ? {
          deterministic: true,
          engine: "sharp",
          aiUsed: false,
          reconstructionUsed: false,
          sourceSha256: String(inputSha256).toLowerCase(),
          sourceBytes: Number(inputBytes),
          bleedInches: Number(req.body.sourceBleedInches) +
            (req.body.addBleed === false ? 0 : BLEED_INCHES),
          trimWidthInches: Number(req.body.trimWidthInches),
          trimHeightInches: Number(req.body.trimHeightInches),
          sourcePixelWidth: inputMeta.width,
          sourcePixelHeight: inputMeta.height,
          outputPixelWidth: outputMeta?.width || null,
          outputPixelHeight: outputMeta?.height || null,
        }
      : null;

    if (outputTiff !== false) {
      // Use JPEG-in-TIFF for photographic wraps (massive size reduction)
      // LZW TIFF of 25K×9K = 200MB+, JPEG-in-TIFF = 15-30MB
      const tiffBuffer = await sharp(withBleed)
        .withMetadata({
          density: PRINT_DPI,  // 1500 DPI embedded in TIFF
        })
        .tiff({
          compression: "jpeg",
          quality: 95,          // Near-lossless for print production
        })
        .toBuffer();
      console.log(`[WORKER] TIFF encoded: ${(tiffBuffer.length / 1024 / 1024).toFixed(1)} MB`);

      // TIFF naming: {panelKey}_{W}x{H}_1500dpi_CMYK.tiff (matches QC page expectations)
      const w = Math.round(widthInches);
      const h = Math.round(heightInches);
      const tiffPath = `production-packs/${userId}/${storageFolder}/${panelKey}_${w}x${h}_${PRINT_DPI}dpi_CMYK.tiff`;
      // Use direct REST API for large files (Supabase JS client has 50MB limit)
      const uploadResp = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${tiffPath}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "image/tiff",
            ...(hasRunIdentity ? {} : { "x-upsert": "true" }),
          },
          body: tiffBuffer,
        }
      );
      if (!uploadResp.ok) {
        const errText = await uploadResp.text();
        throw new Error(`TIFF upload failed (${uploadResp.status}): ${errText.slice(0, 200)}`);
      }

      results.tiffPath = tiffPath;
      results.tiffSize = tiffBuffer.length;
      artifactEvidence.push({
        kind: "tiff",
        path: tiffPath,
        bytes: tiffBuffer.length,
        sha256: sha256Buffer(tiffBuffer),
      });
      console.log(`[WORKER] ✓ TIFF: ${tiffPath} (${(tiffBuffer.length / 1024 / 1024).toFixed(1)} MB, ${PRINT_DPI} DPI)`);
    }

    // ── Step 6: EPS ──
    // Durable DesignPro emits a local raster EPS containing the exact frozen
    // artwork encoded by Sharp. Vectorizer.AI is legacy-only because tracing can
    // reinterpret shapes, text and edges after Call 7. The native admin build
    // ("Build Print Files", native:true) has the exact pixels too, so it takes
    // the SAME deterministic raster EPS — no AI, no tracing — instead of being
    // left with no EPS at all (the shop expects TIFF + PNG + EPS per side).
    const deterministicEps = hasRunIdentity || req.body.native === true;
    if (outputEps && (deterministicEps || (VECTORIZER_API_ID && VECTORIZER_API_SECRET))) {
      try {
        const epsBuffer = deterministicEps
          ? await encodeDeterministicRasterEps(
              withBleed,
              Number(widthInches) + (req.body.addBleed === false ? 0 : BLEED_INCHES * 2),
              Number(heightInches) + (req.body.addBleed === false ? 0 : BLEED_INCHES * 2),
            )
          : await vectorizeToEps(withBleed, widthInches, heightInches);
        if (epsBuffer) {
          const epsPath = `production-packs/${userId}/${storageFolder}/${panelKey}.eps`;
          const { error: epsUpErr } = await supabase.storage
            .from(BUCKET)
            .upload(epsPath, epsBuffer, {
              contentType: "application/postscript",
              upsert: !hasRunIdentity,
            });
          if (epsUpErr) console.warn(`[WORKER] EPS upload failed: ${epsUpErr.message}`);
          else {
            results.epsPath = epsPath;
            results.epsSize = epsBuffer.length;
            artifactEvidence.push({
              kind: "eps",
              path: epsPath,
              bytes: epsBuffer.length,
              sha256: sha256Buffer(epsBuffer),
            });
            console.log(`[WORKER] ✓ EPS: ${epsPath} (${(epsBuffer.length / 1024).toFixed(0)} KB)`);
          }
        }
      } catch (epsErr) {
        if (hasRunIdentity) throw new Error(`Deterministic EPS generation failed: ${epsErr.message}`);
        console.warn(`[WORKER] EPS generation failed: ${epsErr.message}`);
      }
    }

    // ── Step 6b: Full-resolution print PNG (same pixels as the TIFF) ──
    // Carley needs a PNG alongside the TIFF. This is the FULL print-size PNG
    // (not the small preview). Uploaded via REST (the JS client caps at 50MB).
    {
      const w = Math.round(widthInches);
      const h = Math.round(heightInches);
      const pngBuffer = await sharp(withBleed)
        .withMetadata({ density: PRINT_DPI })
        .png({ compressionLevel: 9 })
        .toBuffer();
      const pngPath = `production-packs/${userId}/${storageFolder}/${panelKey}_${w}x${h}_${PRINT_DPI}dpi.png`;
      const pngResp = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${pngPath}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            "Content-Type": "image/png",
            ...(hasRunIdentity ? {} : { "x-upsert": "true" }),
          },
          body: pngBuffer,
        }
      );
      if (!pngResp.ok) {
        const t = await pngResp.text();
        const message = `full PNG upload failed (${pngResp.status}): ${t.slice(0, 200)}`;
        if (hasRunIdentity) throw new Error(message);
        console.warn(`[WORKER] ${message}`);
      } else {
        results.pngPath = pngPath;
        results.pngSize = pngBuffer.length;
        artifactEvidence.push({
          kind: "png",
          path: pngPath,
          bytes: pngBuffer.length,
          sha256: sha256Buffer(pngBuffer),
        });
        console.log(`[WORKER] ✓ PNG: ${pngPath} (${(pngBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
      }
    }

    // ── Step 7: Also save a small PNG for web preview + QC display ──
    const previewPath = `production-packs/${userId}/${storageFolder}/${panelKey}.png`;
    const previewBuffer = await sharp(withBleed)
      .resize(2048, null, { withoutEnlargement: true })
      .png({ quality: 85 })
      .toBuffer();
    const { error: previewUploadError } = await supabase.storage
      .from(BUCKET)
      .upload(previewPath, previewBuffer, {
        contentType: "image/png",
        upsert: !hasRunIdentity,
      });
    if (previewUploadError) {
      if (hasRunIdentity) {
        throw new Error(`Preview upload failed: ${previewUploadError.message}`);
      }
      console.warn(`[WORKER] Preview upload failed: ${previewUploadError.message}`);
    } else {
      artifactEvidence.push({
        kind: "preview",
        path: previewPath,
        bytes: previewBuffer.length,
        sha256: sha256Buffer(previewBuffer),
      });
    }
    results.previewPath = previewPath;

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`[WORKER] ═══ ${panelKey} COMPLETE in ${elapsed}s ═══`);
    if (
      hasRunIdentity &&
      (
        !results.tiffPath ||
        !results.pngPath ||
        !results.previewPath ||
        (outputEps === true && !results.epsPath)
      )
    ) {
      throw new Error(
        "Production dispatch is missing a required TIFF, PNG, preview, or EPS artifact",
      );
    }
    const outputHash = hashArtifactEvidence(artifactEvidence);
    const panelOutput = {
      sourceHash: sourceHash || null,
      packVersion: packVersion || null,
      runKey: safeRunKey,
      panelKey,
      input: hasRunIdentity
        ? {
            fingerprintKey: String(inputFingerprintKey),
            path: String(inputPath),
            sha256: String(inputSha256).toLowerCase(),
            bytes: Number(inputBytes),
          }
        : null,
      artifacts: artifactEvidence,
      result: {
        ...results,
        widthInches,
        heightInches,
      },
    };

    // ── Step 8: fence completion, then project compatibility state ──
    // The durable dispatch row is the authority. concept_json is updated only
    // after the fencing token commits, so a lease-lost attempt can never project
    // itself as the current completion. Packaging reads the dispatch outputs.
    if (jobId) {
      if (panelDispatch) {
        await panelHeartbeat.renew();
        panelHeartbeat.assertCurrent();
        const { data: completed, error: completionError } = await supabase.rpc(
          "complete_production_panel_dispatch",
          {
            p_dispatch_id: panelDispatch.id,
            p_lease_token: panelDispatch.token,
            p_output: panelOutput,
            p_output_hash: outputHash,
          },
        );
        if (completionError) {
          throw new Error(`panel dispatch completion: ${completionError.message}`);
        }
        if (completed !== true) {
          throw new Error("panel dispatch completion rejected stale fencing token");
        }
        panelDispatchCompleted = true;
        panelHeartbeat.stop();
      }

      let stampedCurrentRun = !hasRunIdentity;
      try {
        await stampPrintWorker(jobId, (pw) => {
          if (hasRunIdentity && (
            String(pw.source_hash || "") !== String(sourceHash) ||
            String(pw.pack_version || "") !== String(packVersion) ||
            String(pw.run_key || "") !== safeRunKey
          )) return false;
          const completedAt = new Date().toISOString();
          pw.panels = {
            ...(pw.panels || {}),
            [panelKey]: {
              ...results,
              width_in: widthInches,
              height_in: heightInches,
              source_hash: sourceHash || null,
              pack_version: packVersion || null,
              run_key: safeRunKey,
              artifacts: artifactEvidence,
              output_hash: outputHash,
              completed_at: completedAt,
            },
          };
          pw.dispatches = {
            ...(pw.dispatches || {}),
            [panelKey]: {
              ...((pw.dispatches || {})[panelKey] || {}),
              source_hash: sourceHash || null,
              pack_version: packVersion || null,
              run_key: safeRunKey,
              panel_key: panelKey,
              status: "completed",
              output_hash: outputHash,
              completed_at: completedAt,
            },
          };
          stampedCurrentRun = true;
          return true;
        });
      } catch (e) {
        console.warn(`[WORKER] completion stamp failed: ${e.message}`);
      }
      if (hasRunIdentity && !stampedCurrentRun) {
        console.warn(`[WORKER] ${panelKey} dispatch completed but its compatibility projection is stale`);
      }

      res.json({
        success: true,
        panelKey,
        targetDimensions: `${targetWBleed}×${targetHBleed}px`,
        printSpec: `${widthInches}" × ${heightInches}" @ ${PRINT_DPI} DPI (10% scale)`,
        elapsed: `${elapsed}s`,
        topazDiag,
        sourceHash: sourceHash || null,
        packVersion: packVersion || null,
        runKey: safeRunKey,
        outputHash,
        artifacts: artifactEvidence,
        ...results,
      });

      if (panelDispatchCompleted || stampedCurrentRun) {
        try {
          const pk = await packageOrderPack({
            jobId, userId, orderNumber: orderFolder,
            runKey: safeRunKey, sourceHash: sourceHash || null, packVersion: packVersion || null,
          });
          if (pk && pk.skipped) console.log(`[WORKER] pack assembly: ${pk.skipped}`);
        } catch (e) { console.warn(`[WORKER] pack assembly failed (retry via /package-pack): ${e.message}`); }
      } else {
        console.warn(`[WORKER] ${panelKey} legacy completion was not projected; package skipped`);
      }
    }

  } catch (err) {
    console.error(`[WORKER] ERROR: ${err.message}`);
    if (panelDispatch && !panelDispatchCompleted) {
      await failDispatchBestEffort(panelDispatch, err);
    }
    if (!res.headersSent) res.status(500).json({ error: err.message, panelKey });
  } finally {
    panelHeartbeat?.stop();
    releasePanelSlot();
  }
});

// ── Passenger mirror with READABLE text (deterministic pixels) ───────────────
// The edge-runtime separation steps (panel-pro-separate / step:"separate") OOM
// on real print panels, so panel-pro-passenger kept falling back to a whole
// flip — backwards lettering. This worker has the memory: Gemini is used ONLY
// as a coordinate engine (text/logo bounding boxes, temp 0, JSON); the pixels
// are pure sharp — flip the panel, then paste the driver's own UNFLIPPED text
// regions back at the mirrored X. No repaint, no invented content.
// Body: { driverUrl | inputPath, jobId?, userId?, orderNumber? }
// → { success, url, path, mode: "mirror-text" | "mirror-whole", boxes }
async function detectTextBoxes(buf) {
  if (!HAS_GEMINI) return [];
  const small = await sharp(buf).resize(1600, null, { fit: "inside" }).png().toBuffer();
  const prompt = `This is a FLAT vehicle-wrap print panel. List every readable TEXT element (company name, tagline, phone, URL) and every standalone LOGO mark. Repeating background pattern motifs are NOT elements. Respond ONLY with JSON: {"elements":[{"box_2d":[ymin,xmin,ymax,xmax]}]} normalized 0-1000.`;
  for (const key of GEMINI_KEYS) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: small.toString("base64") } }] }],
            generationConfig: { responseModalities: ["TEXT"], temperature: 0, topP: 1, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!resp.ok) continue;
      const r = await resp.json();
      const text = (r.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      const els = Array.isArray(parsed?.elements) ? parsed.elements : [];
      return els.map((e) => e.box_2d || e.box).filter((b) => Array.isArray(b) && b.length === 4);
    } catch (e) {
      console.warn(`[WORKER] passenger-mirror box detect retry: ${e.message}`);
    }
  }
  return [];
}

// ── /enhance-pack — POST-QC Gigapixel (Topaz) enhance pass (owner 2026-08-11) ──
// Topaz is non-deterministic, so it is FORBIDDEN inside the fenced pack (the
// /process-panel forbidden_after_call7 gate stays). The owner's decision: run
// Gigapixel AFTER human QC approval, outside the identity fence. This endpoint
// refuses jobs without a QC stamp, takes each approved side's fenced 1500dpi
// PNG, asks Topaz (High Fidelity V2 by default) for the highest resolution it
// will process (topazUpscale clamps to 32000px/dim and auto-adapts to the
// model's MP cap on 413), and stamps concept_json.print_worker.enhanced. The
// fenced deterministic files are never touched — enhanced output lands in its
// own enhanced/ folder as an additive upgrade.
app.post("/enhance-pack", authMiddleware, async (req, res) => {
  const { jobId, userId, orderNumber } = req.body || {};
  if (!jobId || !userId || !orderNumber) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!TOPAZ_API_KEY) {
    console.warn("[WORKER] /enhance-pack skipped: TOPAZ_API_KEY is not set in this environment");
    return res.json({ success: true, skipped: "no_topaz_key" });
  }
  const { data: jobRow, error: jobError } = await supabase
    .from("panelizer_jobs").select("concept_json").eq("id", jobId).maybeSingle();
  if (jobError || !jobRow) {
    return res.status(404).json({ error: jobError?.message || "Job not found" });
  }
  const concept = jobRow.concept_json || {};
  if (!concept.qc_stamp || !concept.qc_stamp.stamped_at) {
    // Post-QC only — the human approval is the licence for a non-deterministic pass.
    return res.status(409).json({ error: "QC stamp required before Gigapixel enhance", skipped: "qc_stamp_required" });
  }
  const panels = (concept.print_worker && concept.print_worker.panels) || {};
  const sides = Object.entries(panels).filter(([key, panel]) =>
    !/^logo_\d+$/.test(key) &&
    Array.isArray(panel?.artifacts) &&
    panel.artifacts.some((a) => a?.kind === "png"));
  if (!sides.length) {
    return res.json({ success: true, skipped: "no_print_panels_stamped" });
  }
  // Long-running (Topaz polls minutes per side): acknowledge now, enhance in
  // the background, stamp evidence per side as each lands.
  res.status(202).json({ success: true, queued: sides.map(([key]) => key) });
  setImmediate(async () => {
    for (const [panelKey, panel] of sides) {
      try {
        const pngArtifact = panel.artifacts.find((a) => a?.kind === "png");
        const { data: fileData, error: dlError } = await supabase.storage
          .from(BUCKET).download(pngArtifact.path);
        if (dlError) throw new Error(`download ${pngArtifact.path}: ${dlError.message}`);
        const buf = Buffer.from(await fileData.arrayBuffer());
        const meta = await sharp(buf).metadata();
        if (!meta.width || !meta.height) throw new Error("unreadable panel pixels");
        // Ask for the ceiling; topazUpscale clamps per-dim and MP-adapts.
        const k = 32000 / Math.max(meta.width, meta.height);
        const scale = Math.max(1, Math.min(4, k));
        const up = await topazUpscale(
          buf,
          Math.round(meta.width * scale),
          Math.round(meta.height * scale),
          TOPAZ_API_KEY,
          req.body.topazModel,
        );
        if (!up) throw new Error("Topaz returned no image");
        const um = await sharp(up).metadata();
        const outPath = `production-packs/${userId}/${orderNumber}/enhanced/${panelKey}_gigapixel_${um.width}x${um.height}.png`;
        const { error: upError } = await supabase.storage
          .from(BUCKET).upload(outPath, up, { contentType: "image/png", upsert: true });
        if (upError) throw new Error(`enhanced upload: ${upError.message}`);
        await stampPrintWorker(jobId, (pw) => {
          pw.enhanced = {
            ...(pw.enhanced || {}),
            [panelKey]: {
              path: outPath,
              width: um.width,
              height: um.height,
              model: req.body.topazModel || TOPAZ_MODEL,
              source_path: pngArtifact.path,
              source_sha256: pngArtifact.sha256 || null,
              bytes: up.length,
              sha256: sha256Buffer(up),
              completed_at: new Date().toISOString(),
            },
          };
        });
        console.log(`[WORKER] ✓ enhance-pack ${panelKey}: ${um.width}×${um.height} (${(up.length / 1024 / 1024).toFixed(1)} MB)`);
      } catch (error) {
        const message = String(error?.message || error).slice(0, 300);
        console.error(`[WORKER] enhance-pack ${panelKey} failed: ${message}`);
        try {
          await stampPrintWorker(jobId, (pw) => {
            pw.enhanced = {
              ...(pw.enhanced || {}),
              [panelKey]: { error: message, failed_at: new Date().toISOString() },
            };
          });
        } catch { /* evidence stamp is best-effort on failure */ }
      }
    }
  });
});

// ── /process-logo — fenced deterministic hi-res variant of a Logo Pack cut ──
// Gap (a) of the paid chain: logos flow through the SAME dispatch ledger as
// panels ("the fence must move for logos"). The cut asset is a frozen
// transparent RGBA lift of real pixels; this endpoint applies exactly ONE
// deterministic Sharp lanczos3 resample (no AI — the post-freeze rule) with
// alpha preserved end to end, then completes the dispatch with content-hashed
// artifact evidence. The as-is cut still ships in Logo-Pack/; packaging adds
// this hi-res PNG under Logo-Pack-HiRes/.
const LOGO_SCALE = 4;
const LOGO_MAX_EDGE_PX = 16384;
const LOGO_INPUT_BUCKETS = new Set(["wrap-files", "extracted-elements"]);
app.post("/process-logo", authMiddleware, async (req, res) => {
  const {
    jobId,
    userId,
    orderNumber,
    panelKey,
    label,
    side,
    sourceHash,
    packVersion,
    runKey,
    dispatchId,
    dispatchToken,
    inputBucket,
    inputPath,
    inputFingerprintKey,
    inputSha256,
    inputBytes,
  } = req.body;

  if (!jobId || !userId || !panelKey || !inputPath) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  if (!/^logo_\d+$/.test(String(panelKey))) {
    return res.status(400).json({ error: "process-logo requires a logo_<n> panelKey" });
  }
  if (!sourceHash || !packVersion || !runKey || !dispatchId || !dispatchToken) {
    return res.status(400).json({
      error: "Logo dispatches are durable-only: sourceHash, packVersion, runKey, dispatchId and dispatchToken are required",
    });
  }
  if (
    req.body.native !== true ||
    req.body.useTopaz === true ||
    req.body.reconstruct === true ||
    ["clarity", "esrgan", "real-esrgan", "topaz"].includes(
      String(req.body.upscaler || "").toLowerCase(),
    )
  ) {
    return res.status(400).json({
      error: "AI reconstruction is forbidden after the frozen DesignPro proof",
    });
  }
  const bucket = String(inputBucket || BUCKET);
  if (!LOGO_INPUT_BUCKETS.has(bucket) || String(inputPath).includes("..")) {
    return res.status(400).json({ error: "Logo input is not in an approved storage bucket" });
  }
  if (
    !String(inputFingerprintKey || "").startsWith("logo:") ||
    !/^[a-f0-9]{64}$/.test(String(inputSha256 || "").toLowerCase()) ||
    !Number.isSafeInteger(Number(inputBytes)) ||
    Number(inputBytes) <= 0
  ) {
    return res.status(400).json({ error: "Logo dispatches require a frozen input fingerprint" });
  }
  const safeRunKey = String(runKey).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
  if (!safeRunKey || safeRunKey !== String(runKey).toLowerCase()) {
    return res.status(400).json({ error: "Invalid runKey" });
  }

  // Same immutable per-attempt folder scheme as /process-panel: hashing the
  // fencing token keeps the credential out of the public path and a lease-lost
  // attempt can never overwrite a newer attempt's artifacts.
  const dispatchAttemptKey = sha256Buffer(Buffer.from(`${dispatchId}:${dispatchToken}`));
  const storageFolder = `${orderNumber || jobId}/runs/${safeRunKey}/attempts/${dispatchAttemptKey}`;

  const { data: begun, error: beginError } = await supabase.rpc(
    "begin_production_panel_dispatch",
    {
      p_dispatch_id: dispatchId,
      p_lease_token: dispatchToken,
      p_lease_seconds: DISPATCH_LEASE_SECONDS,
    },
  );
  if (beginError) {
    return res.status(503).json({
      error: `Could not begin logo dispatch: ${beginError.message}`,
      panelKey,
    });
  }
  if (begun !== true) {
    return res.status(409).json({
      error: "Stale, expired, or duplicate logo dispatch",
      panelKey,
      dispatchId,
    });
  }
  const dispatch = { id: dispatchId, token: dispatchToken };
  const heartbeat = startDispatchHeartbeat(dispatch);
  let completedDispatch = false;
  try {
    const { data: fileData, error: dlError } = await supabase.storage
      .from(bucket)
      .download(inputPath);
    if (dlError) throw new Error(`Download failed: ${dlError.message}`);
    const inputBuffer = Buffer.from(await fileData.arrayBuffer());
    if (
      sha256Buffer(inputBuffer) !== String(inputSha256).toLowerCase() ||
      inputBuffer.length !== Number(inputBytes)
    ) {
      throw new Error(`Frozen input mismatch for ${String(inputFingerprintKey)}`);
    }
    const meta = await sharp(inputBuffer).metadata();
    if (!meta.width || !meta.height) {
      throw new Error("Frozen logo has no readable pixel dimensions");
    }
    // Exactly one deterministic resample. The cap keeps a large cut from
    // exploding the canvas; at or beyond the ceiling the source ships at its
    // native size (scale 1).
    const scale = Math.max(
      1,
      Math.min(LOGO_SCALE, LOGO_MAX_EDGE_PX / Math.max(meta.width, meta.height)),
    );
    const outW = Math.round(meta.width * scale);
    const outH = Math.round(meta.height * scale);
    const hiResBuffer = await sharp(inputBuffer)
      .ensureAlpha()
      .resize(outW, outH, { kernel: "lanczos3", fit: "fill" })
      .png()
      .toBuffer();
    const hiResMeta = await sharp(hiResBuffer).metadata();
    if (hiResMeta.hasAlpha !== true) {
      throw new Error("Hi-res logo lost its alpha channel");
    }
    const artifactEvidence = [];
    const hiResPath = `production-packs/${userId}/${storageFolder}/${panelKey}_${outW}x${outH}_hires.png`;
    const { error: hiResUpError } = await supabase.storage
      .from(BUCKET)
      .upload(hiResPath, hiResBuffer, { contentType: "image/png", upsert: false });
    if (hiResUpError) throw new Error(`hi-res logo upload: ${hiResUpError.message}`);
    artifactEvidence.push({
      kind: "png",
      path: hiResPath,
      bytes: hiResBuffer.length,
      sha256: sha256Buffer(hiResBuffer),
    });
    // Byte-exact source copy as the preview artifact, so the dispatch output
    // is self-contained evidence of what was resampled.
    const previewPath = `production-packs/${userId}/${storageFolder}/${panelKey}.png`;
    const { error: previewUpError } = await supabase.storage
      .from(BUCKET)
      .upload(previewPath, inputBuffer, { contentType: "image/png", upsert: false });
    if (previewUpError) throw new Error(`logo preview upload: ${previewUpError.message}`);
    artifactEvidence.push({
      kind: "preview",
      path: previewPath,
      bytes: inputBuffer.length,
      sha256: sha256Buffer(inputBuffer),
    });
    const outputHash = hashArtifactEvidence(artifactEvidence);
    const logoOutput = {
      sourceHash,
      packVersion,
      runKey: safeRunKey,
      panelKey,
      input: {
        fingerprintKey: String(inputFingerprintKey),
        bucket,
        path: String(inputPath),
        sha256: String(inputSha256).toLowerCase(),
        bytes: Number(inputBytes),
      },
      artifacts: artifactEvidence,
      result: {
        widthPx: outW,
        heightPx: outH,
        scale,
        label: label || null,
        side: side || null,
        alphaPreserved: true,
      },
    };
    await heartbeat.renew();
    heartbeat.assertCurrent();
    const { data: done, error: completionError } = await supabase.rpc(
      "complete_production_panel_dispatch",
      {
        p_dispatch_id: dispatch.id,
        p_lease_token: dispatch.token,
        p_output: logoOutput,
        p_output_hash: outputHash,
      },
    );
    if (completionError) {
      throw new Error(`logo dispatch completion: ${completionError.message}`);
    }
    if (done !== true) {
      throw new Error("logo dispatch completion rejected stale fencing token");
    }
    completedDispatch = true;
    heartbeat.stop();
    console.log(`[WORKER] ✓ ${panelKey} hi-res logo ${outW}×${outH} (${(hiResBuffer.length / 1024).toFixed(0)} KB)`);
    return res.json({ success: true, panelKey, output: logoOutput, outputHash });
  } catch (error) {
    heartbeat.stop();
    if (!completedDispatch) await failDispatchBestEffort(dispatch, error);
    console.error(`[WORKER] /process-logo ${panelKey} failed:`, error?.message || error);
    return res.status(500).json({ error: String(error?.message || error), panelKey });
  }
});

app.post("/passenger-mirror", authMiddleware, async (req, res) => {
  try {
    const { driverUrl, inputPath, jobId, userId, orderNumber } = req.body || {};
    let buf;
    if (inputPath) {
      const { data, error } = await supabase.storage.from(BUCKET).download(inputPath);
      if (error) throw new Error(`download ${inputPath}: ${error.message}`);
      buf = Buffer.from(await data.arrayBuffer());
    } else if (driverUrl) {
      const r = await fetch(driverUrl, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`fetch driver ${r.status}`);
      buf = Buffer.from(await r.arrayBuffer());
    } else {
      return res.status(400).json({ error: "driverUrl or inputPath required" });
    }
    const meta = await sharp(buf).metadata();
    const W = meta.width, H = meta.height;
    const boxes = await detectTextBoxes(buf);
    let out = await sharp(buf).flop().png().toBuffer();
    let pasted = 0;
    if (boxes.length) {
      const comps = [];
      for (const b of boxes) {
        const x = Math.max(0, Math.round((b[1] / 1000) * W));
        const y = Math.max(0, Math.round((b[0] / 1000) * H));
        const w = Math.min(W - x, Math.round(((b[3] - b[1]) / 1000) * W));
        const h = Math.min(H - y, Math.round(((b[2] - b[0]) / 1000) * H));
        if (w < 8 || h < 8) continue;
        const region = await sharp(buf).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
        comps.push({ input: region, left: W - x - w, top: y });
        pasted++;
      }
      if (comps.length) out = await sharp(out).composite(comps).png().toBuffer();
    }
    const folder = orderNumber || jobId || "job";
    const outPath = `panel-artboard/${folder}/panels/passenger-side-readable.png`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${outPath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "image/png", "x-upsert": "true" },
      body: out,
    });
    if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
    const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(outPath);
    const mode = pasted ? "mirror-text" : "mirror-whole";
    console.log(`[WORKER] passenger-mirror ${mode}: ${pasted} text region(s) kept readable → ${outPath}`);
    res.json({ success: true, url: publicUrl, path: outPath, mode, boxes: boxes.length });
  } catch (err) {
    console.error(`[WORKER] /passenger-mirror error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Package (or re-package) an order's production-pack ZIP on demand ─────────
// Zips the CURRENT source-bound run (force by default) — the manual retry /
// self-heal entry used when auto-assembly didn't run (e.g. the worker restarted
// mid-job). With jobId, identity is always resolved from
// concept_json.print_worker; request-supplied identity may only confirm it.
// Body: { jobId?, userId?, orderNumber?, sourceHash?, packVersion?, runKey?, force? }
// jobId alone resolves everything.
app.post("/package-pack", authMiddleware, async (req, res) => {
  try {
    let {
      jobId, userId, orderNumber, sourceHash, packVersion, runKey, force,
    } = req.body || {};
    const suppliedIdentity = !!(sourceHash || packVersion || runKey);
    if (suppliedIdentity && (!sourceHash || !packVersion || !runKey)) {
      return res.status(400).json({
        error: "sourceHash, packVersion, and runKey must be supplied together",
      });
    }
    if (jobId) {
      const { data: job, error: jobError } = await supabase
        .from("panelizer_jobs")
        .select("user_id, order_number, concept_json")
        .eq("id", jobId)
        .maybeSingle();
      if (jobError) throw new Error(`resolve panelizer job: ${jobError.message}`);
      if (!job) return res.status(404).json({ error: "Panelizer job not found" });
      if (userId && String(userId) !== String(job.user_id)) {
        return res.status(409).json({ error: "userId does not match panelizer job" });
      }
      const canonicalOrder = job.order_number || jobId;
      if (orderNumber && String(orderNumber) !== String(canonicalOrder)) {
        return res.status(409).json({ error: "orderNumber does not match panelizer job" });
      }
      userId = job.user_id;
      orderNumber = canonicalOrder;
      const currentPw = job?.concept_json?.print_worker || {};
      if (currentPw.run_key) {
        if (suppliedIdentity && (
          String(sourceHash || "") !== String(currentPw.source_hash || "") ||
          String(packVersion || "") !== String(currentPw.pack_version || "") ||
          String(runKey || "").toLowerCase() !== String(currentPw.run_key || "").toLowerCase()
        )) {
          return res.status(409).json({ error: "Stale source run" });
        }
        sourceHash = currentPw.source_hash;
        packVersion = currentPw.pack_version;
        runKey = currentPw.run_key;
      }
    }
    if (!userId || !orderNumber) {
      return res.status(400).json({ error: "userId and orderNumber (or a resolvable jobId) required" });
    }
    const result = await packageOrderPack({
      jobId,
      userId,
      orderNumber,
      sourceHash: sourceHash || null,
      packVersion: packVersion || null,
      runKey: runKey || null,
      force: force !== false,
    });
    res.json(result);
  } catch (err) {
    console.error(`[WORKER] /package-pack error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── Batch: process all panels for a job ─────────────────────
app.post("/process-job", authMiddleware, async (req, res) => {
  const { jobId, userId, orderNumber, designId, panels, outputTiff, outputEps } = req.body;

  if (!jobId || !userId || !panels?.length) {
    return res.status(400).json({ error: "Missing jobId, userId, or panels" });
  }

  // Storage folder: production-packs/{userId}/{orderNumber}/
  const storageFolder = orderNumber || jobId;

  console.log(`[WORKER] ═══ BATCH JOB ${jobId}: ${panels.length} panels ═══`);

  // Process panels sequentially (memory safety — one at a time)
  const results = [];
  for (const panel of panels) {
    try {
      const panelResult = await processPanel({
        jobId, userId, storageFolder, designId,
        panelKey: panel.panelKey,
        panelLabel: panel.label,
        widthInches: panel.widthInches,
        heightInches: panel.heightInches,
        inputPath: panel.inputPath,
        outputTiff, outputEps,
      });
      results.push({ panelKey: panel.panelKey, success: true, ...panelResult });
    } catch (err) {
      console.error(`[WORKER] Panel ${panel.panelKey} failed: ${err.message}`);
      results.push({ panelKey: panel.panelKey, success: false, error: err.message });
    }
  }

  // Update panelizer_jobs with results
  try {
    await supabase
      .from("panelizer_jobs")
      .update({
        stage_progress: {
          worker_results: results,
          worker_completed_at: new Date().toISOString(),
        },
      })
      .eq("id", jobId);
  } catch {}

  res.json({ success: true, jobId, results });
});

// ── Flat-first LAYER COMPOSITE (print-res, keeps layers editable) ──────────
// Why this lives here and NOT in a Supabase edge function: print-res panels are
// huge (a 190"×52" side at 150 PPI ≈ 28,500×7,860 px) — far past the 256MB edge
// worker limit (the 546 OOM). Sharp/libvips streams these with low memory.
//
// Input is a LAYER MANIFEST, not a baked image: a clean background + N transparent
// overlay layers (logo / text / graphic elements), each positioned. We output
// BOTH (a) every layer as its own print-res asset (so the design stays editable)
// AND (b) the flattened print TIFF + bleed for the shop. boxes are panel-relative
// fractions [x, y, w, h] in 0..1 (top-left origin); omit for full-panel.
//
// Body: { jobId, userId, orderNumber, panelKey, widthInches, heightInches,
//         backgroundUrl, layers:[{url,kind,role,box?,opacity?}], outputTiff? }
async function fetchBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${r.status} for ${String(url).slice(0, 80)}`);
  return Buffer.from(await r.arrayBuffer());
}

async function uploadBuffer(path, buf, contentType) {
  const resp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": contentType, "x-upsert": "true" },
    body: buf,
  });
  if (!resp.ok) throw new Error(`upload ${resp.status}: ${(await resp.text()).slice(0, 160)}`);
  return path;
}

// Topaz cloud upscale — best on photographic texture (flames, fabric). Handles
// both a synchronous image response and an async job (poll → download). Returns
// the upscaled buffer, or null if no key. Endpoint/param names are env-overridable.
async function topazUpscale(buf, targetW, targetH, apiKey, model) {
  const key = apiKey || TOPAZ_API_KEY;
  if (!key) return null;
  const mdl = model || TOPAZ_MODEL;
  // Two hard limits: output_width/height ≤ 32000px, AND a per-model megapixel
  // cap (Standard V2 = 96 MP; higher-fidelity models allow more). Clamp the
  // per-dim first; the MP cap is discovered from a 413 and we retry clamped to it.
  const MAXPX = 32000;
  let outW = Math.round(targetW), outH = Math.round(targetH);
  const clampDim = () => { if (outW > MAXPX || outH > MAXPX) { const k = MAXPX / Math.max(outW, outH); outW = Math.round(outW * k); outH = Math.round(outH * k); } };
  clampDim();
  const base = TOPAZ_ENHANCE_URL.replace(/\/enhance\/?.*$/, ""); // https://api.topazlabs.com/image/v1
  let pid = null;
  for (let attempt = 0; attempt < 3 && !pid; attempt++) {
    const form = new FormData();
    form.append("image", new Blob([buf], { type: "image/png" }), "panel.png");
    form.append("model", mdl);
    form.append("output_width", String(outW));
    form.append("output_height", String(outH));
    form.append("output_format", "png");
    const resp = await fetch(TOPAZ_ENHANCE_URL, { method: "POST", headers: { "X-API-Key": key }, body: form });
    if (resp.ok) {
      const j = await resp.json().catch(() => ({}));
      pid = j.process_id || resp.headers.get("X-Process-ID");
      if (!pid) throw new Error("Topaz: no process_id in enhance response");
      break;
    }
    const errText = await resp.text().catch(() => "");
    // Auto-adapt to the model's MP cap: parse "maximum allowed of X MP" and retry.
    const m = resp.status === 413 && errText.match(/maximum allowed of ([\d.]+)\s*MP/i);
    if (m && attempt < 2) {
      const capMP = parseFloat(m[1]) * 1e6;
      const k = Math.sqrt((capMP * 0.985) / (outW * outH));
      outW = Math.round(outW * k); outH = Math.round(outH * k); clampDim();
      console.log(`[WORKER] Topaz ${mdl} MP cap → retry at ${outW}×${outH}`);
      continue;
    }
    throw new Error(`Topaz enhance ${resp.status}: ${errText.slice(0, 200)}`);
  }
  if (!pid) throw new Error("Topaz: no process_id after retries");
  // Poll status → then GET the separate download endpoint for the presigned URL.
  for (let i = 0; i < 160; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await fetch(`${base}/status/${pid}`, { headers: { "X-API-Key": key } });
    const sj = await s.json().catch(() => ({}));
    const st = String(sj.status || "").toLowerCase();
    if (st === "completed") {
      const d = await fetch(`${base}/download/${pid}`, { headers: { "X-API-Key": key } });
      if (!d.ok) throw new Error(`Topaz download ${d.status}`);
      const dj = await d.json().catch(() => ({}));
      const url = dj.download_url;
      if (!url) throw new Error("Topaz: no download_url");
      const dr = await fetch(url);
      if (!dr.ok) throw new Error(`Topaz fetch ${dr.status}`);
      return Buffer.from(await dr.arrayBuffer());
    }
    if (st === "failed" || st === "cancelled") throw new Error(`Topaz job ${st}`);
  }
  throw new Error("Topaz job timed out");
}

// Upscale a source buffer to the exact print target, best engine first:
// Topaz (texture) → Replicate ESRGAN → Sharp lanczos. Always returns EXACTLY
// targetW×targetH. Skips AI entirely when the source is already large enough.
async function upscaleToTarget(buf, targetW, targetH, topazKey) {
  const exact = (b) => sharp(b).resize(targetW, targetH, { fit: "cover", kernel: "lanczos3" }).png().toBuffer();
  const meta = await sharp(buf).metadata();
  if (meta.width >= targetW * 0.95 && meta.height >= targetH * 0.95) return exact(buf);

  if (topazKey || TOPAZ_API_KEY) {
    try {
      const up = await topazUpscale(buf, targetW, targetH, topazKey);
      if (up) { console.log(`[WORKER] upscaled via Topaz`); return await exact(up); }
    } catch (e) { console.warn(`[WORKER] Topaz upscale failed → fallback: ${e.message}`); }
  }
  const scaleNeeded = Math.max(targetW / meta.width, targetH / meta.height);
  if (replicate && scaleNeeded > 1.5) {
    try {
      const up = await esrganUpscale(buf, scaleNeeded);
      console.log(`[WORKER] upscaled via Replicate ESRGAN`);
      return await exact(up);
    } catch (e) { console.warn(`[WORKER] ESRGAN upscale failed → fallback: ${e.message}`); }
  }
  console.log(`[WORKER] upscaled via Sharp lanczos (no AI engine available)`);
  return exact(buf);
}

// ── COMPOSE THE 2D PROOF SHEET ───────────────────────────────────────────────
// The LAYOUT is computed by generate-2d-proof and arrives fully resolved: the
// canvas size, each tile's rect, and ONE SVG carrying every drawn element
// (header, footer, labels, bleed lines, dimension rules, coverage, GENIE band).
// This endpoint does only the pixel work.
//
// It exists because that pixel work could not fit the edge function's
// per-request CPU budget: proof.build failed TWELVE attempts across two packs
// on 2026-08-04, every one "CPU Time exceeded", each kill landing right after
// the compose log — and three real optimisations upstream were not sufficient.
// The sheet was deflated by a PURE-JS PNG encoder inside the isolate. Sharp is
// native libvips: measured at 0.48s average for these six tiles (worst case,
// pure-noise sources at 12.1MB producing a 3.56MB PNG).
//
// Tiles arrive as URLs, never bytes — express.json is capped at 1mb above and
// six 1K PNGs are ~12MB. Same contract every other endpoint here already uses.
app.post("/compose-proof-sheet", authMiddleware, async (req, res) => {
  const { canvas, tiles = [], overlaySvg } = req.body || {};
  const W = Math.round(Number(canvas?.w) || 0);
  const H = Math.round(Number(canvas?.h) || 0);
  if (!(W > 0 && H > 0)) {
    return res.status(400).json({ success: false, error: "canvas.w and canvas.h are required" });
  }
  if (!Array.isArray(tiles) || !tiles.length) {
    return res.status(400).json({ success: false, error: "tiles[] is required" });
  }
  const startMs = Date.now();
  console.log(`[WORKER] ═══ compose-proof-sheet ${W}x${H}, ${tiles.length} tile(s) ═══`);
  try {
    const layers = [];
    const surfaceMasters = [];
    const seenKeys = new Set();
    const CALL7_MASTER_PPI = 10;
    for (const t of tiles) {
      const x = Math.round(Number(t.x) || 0);
      const y = Math.round(Number(t.y) || 0);
      const w = Math.round(Number(t.w) || 0);
      const h = Math.round(Number(t.h) || 0);
      const key = String(t.key || "").trim();
      const trimWidthIn = Number(t.trimWidthIn || 0);
      const trimHeightIn = Number(t.trimHeightIn || 0);
      const bleedIn = Number(t.bleedIn || 0);
      const masterPath = String(t.masterPath || "").trim();
      if (
        !(w > 0 && h > 0) ||
        !t.url ||
        !key ||
        seenKeys.has(key) ||
        !(trimWidthIn > 0 && trimHeightIn > 0) ||
        bleedIn !== 5 ||
        !/^proof-tiles\/[A-Za-z0-9._/-]+\/masters\/[A-Za-z0-9._-]+\.png$/.test(masterPath)
      ) {
        return res.status(400).json({
          success: false,
          error: `tile "${key || "?"}" needs a unique key, URL, rect, GENIE trim, exact 5-inch bleed, and safe masterPath`,
        });
      }
      seenKeys.add(key);

      const source = await fetchBuffer(t.url);
      const sourceMeta = await sharp(source).metadata();
      const sourceWidth = Number(sourceMeta.width || 0);
      const sourceHeight = Number(sourceMeta.height || 0);
      if (!(sourceWidth > 0 && sourceHeight > 0)) {
        throw new Error(`tile "${key}" has no readable pixel dimensions`);
      }
      if (sourceMeta.hasAlpha) {
        const sourceStats = await sharp(source).stats();
        const alpha = sourceStats.channels[3];
        if (alpha && alpha.min < 255) {
          throw new Error(`tile "${key}" contains transparent pixels; Call 7 must fail closed`);
        }
      }

      // Call 7 is the final pixel-authoring boundary. Normalize the generated
      // artwork to GENIE trim without stretching, rotation, or truncation:
      // preserve the entire model response with contain, then mirror-fill only
      // the aspect slack. The result is visible in the approval proof. Call 8
      // later promotes these exact frozen bytes and cannot reinterpret them.
      const trimPixelWidth = Math.max(1, Math.round(trimWidthIn * CALL7_MASTER_PPI));
      const trimPixelHeight = Math.max(1, Math.round(trimHeightIn * CALL7_MASTER_PPI));
      let trim = await sharp(source)
        .resize(trimPixelWidth, trimPixelHeight, {
          fit: "inside",
          kernel: "lanczos3",
        })
        .png()
        .toBuffer();
      const containedMeta = await sharp(trim).metadata();
      const containedWidth = Number(containedMeta.width || 0);
      const containedHeight = Number(containedMeta.height || 0);
      const horizontalSlack = trimPixelWidth - containedWidth;
      const verticalSlack = trimPixelHeight - containedHeight;
      const left = Math.floor(horizontalSlack / 2);
      const right = horizontalSlack - left;
      const top = Math.floor(verticalSlack / 2);
      const bottom = verticalSlack - top;
      if (left || right || top || bottom) {
        trim = await sharp(trim).extend({
          left,
          right,
          top,
          bottom,
          extendWith: "mirror",
        }).png().toBuffer();
      }
      const bleedPixels = Math.round(bleedIn * CALL7_MASTER_PPI);
      const master = await sharp(trim).extend({
        left: bleedPixels,
        right: bleedPixels,
        top: bleedPixels,
        bottom: bleedPixels,
        extendWith: "mirror",
      }).png().toBuffer();
      const masterMeta = await sharp(master).metadata();
      const pixelWidth = Number(masterMeta.width || 0);
      const pixelHeight = Number(masterMeta.height || 0);
      const expectedPixelWidth = trimPixelWidth + bleedPixels * 2;
      const expectedPixelHeight = trimPixelHeight + bleedPixels * 2;
      if (pixelWidth !== expectedPixelWidth || pixelHeight !== expectedPixelHeight) {
        throw new Error(`tile "${key}" Call 7 print geometry changed during normalization`);
      }
      const displayRatioError = Math.abs((w / h) - (pixelWidth / pixelHeight));
      if (displayRatioError > 0.01) {
        throw new Error(`tile "${key}" proof region would distort its GENIE print aspect`);
      }

      await uploadBuffer(masterPath, master, "image/png");
      const sourceSha256 = createHash("sha256").update(source).digest("hex");
      const masterSha256 = createHash("sha256").update(master).digest("hex");
      // The proof display is a size-only preview of the frozen master. Its
      // exact buffer hash binds the visible region to that master without
      // making Call 8 crop a low-resolution presentation sheet.
      const previewContent = await sharp(master).resize(w, h, {
        fit: "inside",
        kernel: "lanczos3",
      }).png().toBuffer();
      const previewMeta = await sharp(previewContent).metadata();
      // Synthetic canvases are Sharp create inputs, not pixel buffers. The
      // large-print wrapper adds constructor options for buffers; Sharp 0.34
      // rejects those options when they accompany a create input.
      const resized = await _sharp({
        create: {
          width: w,
          height: h,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        },
      }).composite([{
        input: previewContent,
        left: Math.floor((w - Number(previewMeta.width || 0)) / 2),
        top: Math.floor((h - Number(previewMeta.height || 0)) / 2),
      }]).png().toBuffer();

      // THE VEHICLE ELEVATION — display only.
      //
      // Call 8's contract is a proof drawn ON the vehicle. The tile is a
      // full-bleed rectangle because it is also the Call 7 print master, and a
      // master with a truck body baked into it cannot be cropped into a
      // printable panel -- that is why c6f8b0c1 removed the silhouette and why
      // the proof stopped looking like the owner's 2026-07-24 reference. This
      // clips the SHEET copy to the vehicle outline while `master` above, the
      // bytes every panel is extracted from and hashed against, stays the
      // unmasked rectangle. Same pixels, shown through the vehicle's shape:
      // the proof and the panels cannot disagree about the design.
      let sheetTile = resized;
      if (t.clipPath) {
        const mask = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
          `<defs>${t.clipPath}</defs>` +
          `<rect width="${w}" height="${h}" fill="#ffffff" clip-path="url(#clip-${key})"/>` +
          `</svg>`,
        );
        sheetTile = await sharp(resized)
          .composite([{ input: mask, blend: "dest-in" }])
          .png()
          .toBuffer();
      }
      layers.push({ input: sheetTile, left: x, top: y });
      surfaceMasters.push({
        key,
        masterPath,
        sha256: masterSha256,
        bytes: master.length,
        pixelWidth,
        pixelHeight,
        trimWidthIn,
        trimHeightIn,
        bleedIn,
        printWidthIn: trimWidthIn + bleedIn * 2,
        printHeightIn: trimHeightIn + bleedIn * 2,
        sourceCrop: {
          contract: "call7-proof-region-transform.v1",
          sourceSha256,
          sourceWidth,
          sourceHeight,
          cropBox: [0, 0, 1000, 1000],
          fit: "contain-mirror-fill-at-call7",
          stretch: false,
          rotationDegrees: 0,
          truncated: false,
          containedPixelBox: [top, left, top + containedHeight, left + containedWidth],
        },
      });
    }
    if (overlaySvg && String(overlaySvg).trim()) {
      layers.push({ input: Buffer.from(String(overlaySvg)), left: 0, top: 0 });
    }
    const png = await _sharp({
      create: { width: W, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
    })
      .composite(layers)
      .png({ compressionLevel: 6 })
      .toBuffer();
    // Hash the regions as they actually appear in the final proof, after the
    // trim/bleed overlay is composited. This is the proof-region identity that
    // Call 8 binds to the full-resolution sourceMasterSha256 pointer.
    for (const master of surfaceMasters) {
      const tile = tiles.find((candidate) => String(candidate.key) === master.key);
      if (!tile) throw new Error(`missing final proof region for ${master.key}`);
      const region = await sharp(png).extract({
        left: Math.round(Number(tile.x)),
        top: Math.round(Number(tile.y)),
        width: Math.round(Number(tile.w)),
        height: Math.round(Number(tile.h)),
      }).png().toBuffer();
      master.regionSha256 = createHash("sha256").update(region).digest("hex");
      master.regionBytes = region.length;
    }
    console.log(
      `[WORKER] ✓ compose-proof-sheet ${(png.length / 1e6).toFixed(2)}MB in ${((Date.now() - startMs) / 1000).toFixed(2)}s`,
    );
    // Bytes are returned rather than uploaded here so the edge function keeps
    // its canonical proof path, artifact fence and idempotent-reuse check
    // exactly as they are. Only the pixels moved.
    return res.json({
      success: true,
      pngBase64: png.toString("base64"),
      width: W,
      height: H,
      bytes: png.length,
      surfaceMasters,
      ms: Date.now() - startMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[WORKER] compose-proof-sheet failed: ${message}`);
    return res.status(500).json({ success: false, error: message, retryable: true });
  }
});

app.post("/composite-layers", authMiddleware, async (req, res) => {
  const {
    jobId, userId, orderNumber, panelKey,
    widthInches, heightInches, backgroundUrl, layers = [], outputTiff,
  } = req.body || {};
  if (!userId || !panelKey || !widthInches || !heightInches || !backgroundUrl) {
    return res.status(400).json({ error: "userId, panelKey, widthInches, heightInches, backgroundUrl required" });
  }
  const folder = orderNumber || jobId || `layers-${Date.now()}`;
  const targetW = Math.round(widthInches * PPI);
  const targetH = Math.round(heightInches * PPI);
  const startMs = Date.now();
  console.log(`[WORKER] ═══ composite-layers ${panelKey} ${targetW}×${targetH}px, ${layers.length} layer(s) ═══`);

  try {
    // Background upscaled to the exact print panel size — Topaz (texture) →
    // Replicate → Sharp. A 2K source → ~28K print panel is a real AI upscale;
    // Sharp alone would be soft. bleed is added after compositing.
    const bgBuf = await fetchBuffer(backgroundUrl);
    // topazApiKey may be passed by the caller (which holds it in Supabase secrets)
    // so Topaz works without setting it in the worker env.
    let base = await upscaleToTarget(bgBuf, targetW, targetH, req.body.topazApiKey);

    // Each overlay: resized to its box, kept as its OWN print-res asset, and
    // queued for the flattened composite.
    const composites = [];
    const layerManifest = [{ role: "background", kind: "background", url: `production-packs/${userId}/${folder}/${panelKey}__layer0_background.png`, box: [0, 0, 1, 1] }];
    await uploadBuffer(layerManifest[0].url, base, "image/png");

    for (let i = 0; i < layers.length; i++) {
      const ly = layers[i] || {};
      if (!ly.url) continue;
      const box = Array.isArray(ly.box) && ly.box.length === 4 ? ly.box : [0, 0, 1, 1];
      const lw = Math.max(1, Math.round(box[2] * targetW));
      const lh = Math.max(1, Math.round(box[3] * targetH));
      const left = Math.round(box[0] * targetW);
      const top = Math.round(box[1] * targetH);
      const lbuf = await fetchBuffer(ly.url);
      const resized = await sharp(lbuf).resize(lw, lh, { fit: "inside" }).ensureAlpha().png().toBuffer();
      composites.push({ input: resized, left, top });
      const layerPath = `production-packs/${userId}/${folder}/${panelKey}__layer${i + 1}_${(ly.role || ly.kind || "layer").replace(/\W+/g, "-")}.png`;
      await uploadBuffer(layerPath, resized, "image/png");
      layerManifest.push({ role: ly.role || "overlay", kind: ly.kind || "overlay", url: layerPath, box, opacity: ly.opacity ?? 1 });
    }

    // Flatten = background + overlays composited at print res.
    const flat = await sharp(base).composite(composites).png().toBuffer();

    // Mirror-extend the print bleed past all four edges.
    const withBleed = await sharp(flat)
      .extend({ top: BLEED_PX, bottom: BLEED_PX, left: BLEED_PX, right: BLEED_PX, extendWith: "mirror" })
      .png().toBuffer();

    const results = { panelKey, layers: layerManifest };

    // Flattened print TIFF (1500 DPI, JPEG-in-TIFF to keep file size sane).
    if (outputTiff !== false) {
      const tiff = await sharp(withBleed).withMetadata({ density: PRINT_DPI }).tiff({ compression: "jpeg", quality: 95 }).toBuffer();
      const w = Math.round(widthInches), h = Math.round(heightInches);
      results.tiffPath = await uploadBuffer(`production-packs/${userId}/${folder}/${panelKey}_${w}x${h}_${PRINT_DPI}dpi_CMYK.tiff`, tiff, "image/tiff");
      results.tiffSize = tiff.length;
    }

    // Flattened web preview for QC display.
    const preview = await sharp(withBleed).resize(2048, null, { withoutEnlargement: true }).png({ quality: 85 }).toBuffer();
    results.previewPath = await uploadBuffer(`production-packs/${userId}/${folder}/${panelKey}_flat.png`, preview, "image/png");

    // Persist the layer manifest onto the job so the UI can re-edit layers.
    if (jobId) {
      try {
        const { data: job } = await supabase.from("panelizer_jobs").select("concept_json").eq("id", jobId).maybeSingle();
        const cj = job?.concept_json || {};
        const lm = { ...(cj.layer_manifests || {}), [panelKey]: layerManifest };
        await supabase.from("panelizer_jobs").update({ concept_json: { ...cj, layer_manifests: lm } }).eq("id", jobId);
      } catch (e) { console.warn(`[WORKER] manifest persist skipped: ${e.message}`); }
    }

    console.log(`[WORKER] ═══ composite-layers ${panelKey} done in ${((Date.now() - startMs) / 1000).toFixed(1)}s ═══`);
    res.json({ success: true, ...results });
  } catch (err) {
    console.error(`[WORKER] composite-layers ERROR: ${err.message}`);
    res.status(500).json({ error: err.message, panelKey });
  }
});

// ── Clarity Pro Upscale via Replicate ───────────────────────
// Identity-preserving creative upscaler (philz1337x/clarity-pro-upscaler).
// Unlike Real-ESRGAN — which just interpolates and SOFTENS low-res sources —
// Clarity Pro reconstructs real, photorealistic detail while keeping the exact
// design identity. This is the path for low-res uploads (e.g. the 1100px galaxy
// hood/front art) that ESRGAN can't make genuinely sharp.
//
//   scale_factor ∈ {2,4,8,16}; output is capped at 64 MP (~8K) by the model.
//   creativity ∈ [-10,10]: negative = strict to source, positive = add detail.
// On any failure it falls back to esrganUpscale so a panel never dies here.
async function clarityUpscale(inputBuffer, { scaleFactor = 8, creativity = 1 } = {}) {
  // In-app only: Clarity is a Replicate model. When Replicate is disabled/absent,
  // route to the local path (esrganUpscale now resolves to Sharp lanczos) so the
  // upscale never leaves the app.
  if (DISABLE_REPLICATE || !replicate) return esrganUpscale(inputBuffer, scaleFactor);
  let buf = inputBuffer;
  let meta = await sharp(buf).metadata();
  const MAX_MP = 64_000_000; // model OUTPUT cap (~8K)
  // A soft giant (e.g. the 17,112px flag ≈ 82 MP) exceeds Clarity's input and
  // gains nothing from being passed through. Downscale so a generative REBUILD
  // lands under the cap — the rebuild reconstructs crisp edges the soft original
  // never had (smooth + sharpen), which is the whole point of a creative upscaler.
  const INPUT_CAP = 16_000_000; // leaves headroom for a 2x rebuild under 64 MP
  if ((meta.width || 1) * (meta.height || 1) > INPUT_CAP) {
    const dsc = Math.sqrt(INPUT_CAP / ((meta.width || 1) * (meta.height || 1)));
    buf = await sharp(buf)
      .resize(Math.max(1, Math.round((meta.width || 1) * dsc)), null, { kernel: "lanczos3" })
      .png()
      .toBuffer();
    meta = await sharp(buf).metadata();
    console.log(`[WORKER] Clarity input downscaled to ${meta.width}×${meta.height} (soft giant → rebuild)`);
  }
  const px = (meta.width || 1) * (meta.height || 1);
  // Largest legal scale that (a) doesn't overshoot what we asked for and
  // (b) stays under the 64 MP output cap; fall back to the biggest that fits.
  const legal = [16, 8, 4, 2];
  let sf =
    legal.find((s) => s <= scaleFactor && px * s * s <= MAX_MP) ||
    legal.find((s) => px * s * s <= MAX_MP) ||
    2;
  const cr = Math.max(-10, Math.min(10, creativity));
  console.log(
    `[WORKER] Clarity Pro: ${meta.width}×${meta.height} → ${sf}x (creativity ${cr})`,
  );

  // Clarity takes the source as a URL. Inline base64 data URIs fail for large
  // print panels (Replicate rejects multi-MB inline images), which silently
  // dropped us back to the soft fallback. Upload the (downscaled) source to a
  // temp public path and hand Clarity the URL instead.
  let imageUrl;
  const tmpPath = `production-packs/_tmp/clarity-src-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`;
  try {
    await uploadBuffer(tmpPath, buf, "image/png");
    imageUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${tmpPath}`;
  } catch (e) {
    console.warn(`[WORKER] Clarity temp upload failed: ${e.message} — ESRGAN fallback`);
    return esrganUpscale(inputBuffer, scaleFactor);
  }
  try {
    // Community models need an explicit version hash for run(); resolve the
    // latest version at call time so we never pin a stale one.
    let ref = "philz1337x/clarity-pro-upscaler";
    try {
      const model = await replicate.models.get("philz1337x", "clarity-pro-upscaler");
      if (model && model.latest_version && model.latest_version.id) {
        ref = `philz1337x/clarity-pro-upscaler:${model.latest_version.id}`;
      }
    } catch (_) { /* fall back to name-only ref */ }
    const output = await replicate.run(ref, {
      input: {
        image: imageUrl,
        scale_factor: sf,
        creativity: cr,
        output_format: "png",
      },
    });
    // Output is a single file URI (may arrive as a bare string or 1-item array).
    const url = Array.isArray(output) ? output[0] : output;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Clarity download failed: ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const m2 = await sharp(buffer).metadata();
    console.log(`[WORKER] Clarity Pro result: ${m2.width}×${m2.height}px`);
    return buffer;
  } catch (err) {
    console.warn(
      `[WORKER] Clarity Pro failed: ${err.message} — falling back to ESRGAN`,
    );
    return esrganUpscale(inputBuffer, scaleFactor);
  }
}

// upscaleFor — pick the requested upscaler for a scale factor. `req.body.upscaler`
// selects "clarity" (creative, identity-preserving) vs the default ESRGAN.
async function upscaleFor(reqBody, buffer, scaleNeeded) {
  if (reqBody && reqBody.upscaler === "clarity") {
    return clarityUpscale(buffer, {
      scaleFactor: Math.min(16, Math.max(2, Math.ceil(scaleNeeded))),
      creativity: reqBody.creativity == null ? 1 : Number(reqBody.creativity),
    });
  }
  return esrganUpscale(buffer, scaleNeeded);
}

// ── ESRGAN Upscale via Replicate ────────────────────────────
async function esrganUpscale(inputBuffer, scaleNeeded) {
  // IN-APP ONLY: when Replicate is disabled (or absent), never leave the app —
  // reach the target with LOCAL Sharp lanczos. Topaz (the golden reconstruction
  // engine) runs BEFORE this in the chain; this is the pure-local last resort, so
  // "the upscale step is done in app" holds even if Topaz is momentarily down.
  if (DISABLE_REPLICATE || !replicate) {
    try {
      const meta = await sharp(inputBuffer).metadata();
      const targetW = Math.max(1, Math.round((meta.width || 1) * scaleNeeded));
      console.log(`[WORKER] ${DISABLE_REPLICATE ? "Replicate disabled" : "Replicate absent"} → local Sharp lanczos ${scaleNeeded.toFixed(1)}x`);
      return await sharp(inputBuffer).resize(targetW, null, { kernel: "lanczos3", withoutEnlargement: false }).png().toBuffer();
    } catch (e) {
      console.warn(`[WORKER] local upscale failed: ${e.message} — returning source`);
      return inputBuffer;
    }
  }

  // Determine number of 2x passes needed
  const passes = Math.ceil(Math.log2(scaleNeeded));
  console.log(`[WORKER] ESRGAN: ${passes} pass(es) for ${scaleNeeded.toFixed(1)}x upscale`);

  let buffer = inputBuffer;
  for (let pass = 1; pass <= Math.min(passes, 3); pass++) {
    console.log(`[WORKER] ESRGAN pass ${pass}/${passes}...`);

    // Convert buffer to data URI for Replicate
    const base64 = buffer.toString("base64");
    const dataUri = `data:image/png;base64,${base64}`;

    try {
      const output = await replicate.run(
        "nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",
        {
          input: {
            image: dataUri,
            scale: 2,
            face_enhance: false,
          },
        }
      );

      // Output is a URL — download it
      const resp = await fetch(output);
      if (!resp.ok) throw new Error(`Replicate download failed: ${resp.status}`);
      buffer = Buffer.from(await resp.arrayBuffer());

      const meta = await sharp(buffer).metadata();
      console.log(`[WORKER] ESRGAN pass ${pass} result: ${meta.width}×${meta.height}px`);
    } catch (err) {
      console.warn(`[WORKER] ESRGAN pass ${pass} failed: ${err.message} — using current buffer`);
      break;
    }
  }

  return buffer;
}

function ascii85Encode(buffer) {
  const parts = ["<~"];
  const chunkChars = [];
  const flush = () => {
    if (!chunkChars.length) return;
    parts.push(chunkChars.join(""), "\n");
    chunkChars.length = 0;
  };
  for (let offset = 0; offset < buffer.length; offset += 4) {
    const remaining = Math.min(4, buffer.length - offset);
    let value = 0;
    for (let i = 0; i < 4; i++) {
      value = value * 256 + (i < remaining ? buffer[offset + i] : 0);
    }
    if (remaining === 4 && value === 0) {
      chunkChars.push("z");
    } else {
      const encoded = new Array(5);
      for (let i = 4; i >= 0; i--) {
        encoded[i] = String.fromCharCode((value % 85) + 33);
        value = Math.floor(value / 85);
      }
      chunkChars.push(encoded.slice(0, remaining + 1).join(""));
    }
    // Keep DSC/PostScript source lines below the conservative 255-byte limit.
    if (chunkChars.length >= 16) flush();
  }
  flush();
  parts.push("~>");
  return parts.join("");
}

// Deterministic EPS encoding for the paid DesignPro path. This is deliberately
// a raster EPS: it embeds Sharp's JPEG encoding of the already-approved pixels
// and never traces, redraws or reconstructs them. The bounding box includes the
// source's complete physical extent (trim plus any already-baked five-inch bleed).
async function encodeDeterministicRasterEps(imageBuffer, widthInches, heightInches) {
  const meta = await sharp(imageBuffer).metadata();
  if (!meta.width || !meta.height) throw new Error("EPS source has no pixel geometry");
  const jpeg = await sharp(imageBuffer)
    .toColourspace("srgb")
    .jpeg({ quality: 100, chromaSubsampling: "4:4:4", mozjpeg: false })
    .toBuffer();
  if (!jpeg.length) throw new Error("Sharp returned an empty EPS payload");

  const pageWidth = Number(widthInches) * OUTPUT_SCALE * 72;
  const pageHeight = Number(heightInches) * OUTPUT_SCALE * 72;
  if (!(pageWidth > 0 && pageHeight > 0)) throw new Error("EPS physical geometry is invalid");
  const encoded = ascii85Encode(jpeg);
  const sourceHash = sha256Buffer(imageBuffer);
  const eps = [
    "%!PS-Adobe-3.0 EPSF-3.0",
    `%%BoundingBox: 0 0 ${Math.ceil(pageWidth)} ${Math.ceil(pageHeight)}`,
    `%%HiResBoundingBox: 0 0 ${pageWidth.toFixed(4)} ${pageHeight.toFixed(4)}`,
    "%%Creator: DesignProAI deterministic Sharp raster EPS",
    `%%DesignProSourceSHA256: ${sourceHash}`,
    "%%LanguageLevel: 3",
    "%%Pages: 1",
    "%%EndComments",
    "gsave",
    `${pageWidth.toFixed(6)} ${pageHeight.toFixed(6)} scale`,
    `${meta.width} ${meta.height} 8`,
    `[${meta.width} 0 0 -${meta.height} 0 ${meta.height}]`,
    "{ currentfile /ASCII85Decode filter /DCTDecode filter } false 3 colorimage",
    encoded,
    "grestore",
    "showpage",
    "%%EOF",
    "",
  ].join("\n");
  const result = Buffer.from(eps, "ascii");
  if (!result.length) throw new Error("Deterministic EPS encoding is unavailable");
  return result;
}

// ── Vectorizer.AI → EPS (legacy non-source-bound jobs only) ──
async function vectorizeToEps(imageBuffer, widthInches, heightInches) {
  const formData = new FormData();
  formData.append("image", new Blob([imageBuffer], { type: "image/png" }), "panel.png");
  formData.append("output.file_format", "eps");
  formData.append("mode", "production");
  formData.append("output.shape_stacking", "stacked");
  formData.append("output.draw_style", "fill_shapes");
  formData.append("output.gap_filler.enabled", "true");
  formData.append("output.gap_filler.non_scaling_stroke", "true");
  formData.append("output.gap_filler.stroke_width", "2.0");
  formData.append("output.curves.allowed.quadratic_bezier", "true");
  formData.append("output.curves.allowed.cubic_bezier", "true");
  formData.append("output.curves.allowed.circular_arc", "true");
  formData.append("output.curves.allowed.elliptical_arc", "true");
  formData.append("output.curves.line_fit_tolerance", "0.1");

  const authHeader = "Basic " + Buffer.from(`${VECTORIZER_API_ID}:${VECTORIZER_API_SECRET}`).toString("base64");

  console.log(`[WORKER] Vectorizer.AI: sending for EPS conversion...`);
  const resp = await fetch("https://api.vectorizer.ai/api/v1/vectorize", {
    method: "POST",
    headers: { Authorization: authHeader },
    body: formData,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Vectorizer.AI ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const epsBuffer = Buffer.from(await resp.arrayBuffer());

  // Rewrite BoundingBox to production dimensions (inches at 10% scale)
  const w = widthInches * OUTPUT_SCALE;
  const h = heightInches * OUTPUT_SCALE;
  let epsText = epsBuffer.toString("utf-8");
  epsText = epsText.replace(
    /%%BoundingBox:.*$/m,
    `%%BoundingBox: 0 0 ${Math.round(w * 72)} ${Math.round(h * 72)}`
  );

  console.log(`[WORKER] ✓ EPS: ${(epsBuffer.length / 1024).toFixed(0)} KB`);
  return Buffer.from(epsText, "utf-8");
}

// ── Shared panel processing (used by both single and batch) ──
async function processPanel(opts) {
  const { jobId, userId, storageFolder, designId, panelKey, widthInches, heightInches, inputPath, outputTiff, outputEps } = opts;
  const folder = storageFolder || jobId;

  // Download
  const { data: fileData, error: dlError } = await supabase.storage.from(BUCKET).download(inputPath);
  if (dlError) throw new Error(`Download failed: ${dlError.message}`);
  let imageBuffer = Buffer.from(await fileData.arrayBuffer());

  const targetW = Math.round(widthInches * PPI);
  const targetH = Math.round(heightInches * PPI);
  const targetWBleed = targetW + BLEED_PX * 2;
  const targetHBleed = targetH + BLEED_PX * 2;

  // Upscale if needed
  const inputMeta = await sharp(imageBuffer).metadata();
  if (inputMeta.width < targetWBleed || inputMeta.height < targetHBleed) {
    const scaleNeeded = Math.max(targetWBleed / inputMeta.width, targetHBleed / inputMeta.height);
    if (replicate && scaleNeeded > 1.5) {
      imageBuffer = await esrganUpscale(imageBuffer, scaleNeeded);
    } else {
      imageBuffer = await sharp(imageBuffer)
        .resize(Math.max(targetWBleed, inputMeta.width), null, { kernel: "lanczos3", withoutEnlargement: false })
        .png().toBuffer();
    }
  }

  // FIT design at true proportions (no stretch) + mirror-bleed fill
  const withBleed = await fitAndBleed(imageBuffer, targetW, targetH, BLEED_PX);

  const results = {};

  // TIFF
  if (outputTiff !== false) {
    const tiffBuffer = await sharp(withBleed)
      .withMetadata({ density: PRINT_DPI })
      .tiff({ compression: "jpeg", quality: 95 })
      .toBuffer();
    const w = Math.round(widthInches);
    const h = Math.round(heightInches);
    const tiffName = designId
      ? `${designId}_${panelKey}_${w}x${h}_${PRINT_DPI}dpi_CMYK.tiff`
      : `${panelKey}_${w}x${h}_${PRINT_DPI}dpi_CMYK.tiff`;
    const tiffPath = `production-packs/${userId}/${folder}/${tiffName}`;
    const upResp = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${tiffPath}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "image/tiff", "x-upsert": "true" },
      body: tiffBuffer,
    });
    if (!upResp.ok) throw new Error(`TIFF upload failed: ${upResp.status}`);
    results.tiffPath = tiffPath;
    results.tiffSize = tiffBuffer.length;
    console.log(`[WORKER] ✓ TIFF: ${panelKey} (${(tiffBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
  }

  // EPS
  if (outputEps && VECTORIZER_API_ID && VECTORIZER_API_SECRET) {
    const epsBuffer = await vectorizeToEps(withBleed, widthInches, heightInches);
    if (epsBuffer) {
      const epsName = designId ? `${designId}_${panelKey}.eps` : `${panelKey}.eps`;
      const epsPath = `production-packs/${userId}/${folder}/${epsName}`;
      await supabase.storage.from(BUCKET).upload(epsPath, epsBuffer, { contentType: "application/postscript", upsert: true });
      results.epsPath = epsPath;
      results.epsSize = epsBuffer.length;
    }
  }

  // PNG preview for QC page display
  const previewBuffer = await sharp(withBleed).resize(2048, null, { withoutEnlargement: true }).png({ quality: 85 }).toBuffer();
  const pngName = designId ? `${designId}_${panelKey}.png` : `${panelKey}.png`;
  const previewPath = `production-packs/${userId}/${folder}/${pngName}`;
  await supabase.storage.from(BUCKET).upload(previewPath, previewBuffer, { contentType: "image/png", upsert: true });
  results.previewPath = previewPath;

  return results;
}

// ── GRAPHICS PACK — deterministic overlay lift (branded − clean) ────────────
// docs/SCOPE_DETERMINISTIC_OVERLAY_LIFT.md. DesignPro-only product surface; this
// endpoint just takes a branded panel and lifts its branding into editable
// true-alpha layers over a genuinely clean background. The chain:
//   1. LOCATE  — Gemini as a temp-0 coordinate engine (JSON boxes, no image out)
//   2. ERASE   — ONE image-AI edit: remove only what's inside the boxes
//   3. COMPOSE — the clean panel is CONSTRUCTED: branded pixels everywhere,
//                Gemini's fill used ONLY inside the boxes → outside-box
//                alignment is exact BY CONSTRUCTION, not just gated
//   4. SUBTRACT— per-pixel diff inside each box = the overlay's alpha; every
//                overlay pixel comes from the branded panel, nothing invented
//   5. ROUND-TRIP ASSERT — composite(clean + overlays) must rebuild the branded
//                panel (mean diff < threshold) or nothing persists
// Honest-fail doctrine: any gate failure returns success:false with the reason —
// the caller persists nothing and flags the side.

// Extract a JSON value from a model response.
//
// The old implementation was `text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)`,
// which assumes the payload is a single object. When Gemini answered with a bare
// ARRAY — `[{"label":...},{"label":...}]`, dropping the documented {"elements":[...]}
// wrapper — that slice produced `{"label":...},{"label":...}` and JSON.parse died on
// the comma with "Expected double-quoted property name in JSON at position N". That is
// the `logos.extract` / lift-overlays failure seen on 2026-07-29 (position 42) and
// 2026-07-30 (position 57). Retrying could never help: temperature is 0, so every key
// in the pool returns the identical malformed slice.
//
// This scanner finds the first COMPLETE JSON value — object or array — respecting
// string literals and escapes, so braces inside strings cannot end it early.
function extractJsonValue(raw) {
  let text = String(raw || "").trim();
  // Strip ```json fences if the model added them despite responseMimeType.
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  // Clean JSON is the common case now that responseMimeType is set.
  try {
    return JSON.parse(text);
  } catch {
    // fall through to scanning
  }
  // Only on the failure path, so a well-formed document is never rewritten.
  text = dropStrayQuotedSeparator(text);
  const start = text.search(/[{[]/);
  if (start === -1) throw new Error(`no JSON value in response — got: ${snippet(text)}`);
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false, candidate = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { if (inStr) esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) { candidate = text.slice(start, i + 1); break; }
    }
  }
  if (candidate === null) {
    throw new Error(`unterminated JSON value in response — got: ${snippet(text)}`);
  }
  try {
    return JSON.parse(candidate);
  } catch (strictErr) {
    // The value is balanced but not strict JSON. "Expected double-quoted
    // property name" means the parser wanted an object KEY and found something
    // else — i.e. a trailing comma, an unquoted key, or single quotes. That is
    // the live 2026-07-30 logos.extract failure (position 57, reproduced
    // identically on retry because temperature is 0). Repair the three
    // malformations LLMs actually emit, in order, then re-parse.
    const repaired = repairLooseJson(candidate);
    try {
      return JSON.parse(repaired);
    } catch (repairErr) {
      // Never guess at the shape again — put the payload in the error so it
      // reaches workflow_stage_runs.error_message and is readable with a query.
      throw new Error(
        `${strictErr.message} (repair also failed: ${repairErr.message}) — payload: ${snippet(candidate)}`,
      );
    }
  }
}

// Bounded, quote-safe excerpt for error messages.
function snippet(text, max = 400) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…[${s.length} chars]` : s;
}

// Repair the loose-JSON forms LLMs emit. Each pass skips string literals, so
// commas, colons and quotes inside values are never touched.
function repairLooseJson(src) {
  let out = "";
  let inStr = false, quote = '"', esc = false;
  const stack = [];      // open containers, '{' or '['
  let valueStart = -1;   // index in `out` just after the most recent ':'
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === "\\") { out += ch; esc = true; continue; }
      if (ch === quote) {
        // Close the string, normalising a single-quoted string to double.
        out += '"';
        inStr = false;
        continue;
      }
      // A raw double quote inside a single-quoted string must be escaped once
      // we re-emit it as double-quoted.
      out += ch === '"' ? '\\"' : ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true; quote = ch; out += '"';
      continue;
    }
    if (ch === "{" || ch === "[") { stack.push(ch); out += ch; continue; }
    if (ch === "}") { if (stack[stack.length - 1] === "{") stack.pop(); out += ch; continue; }
    if (ch === "]") {
      if (stack[stack.length - 1] === "[") { stack.pop(); out += ch; continue; }
      // A ']' with no matching '[' means the model dropped the OPENING bracket
      // of an array value. Live 2026-07-30 payload:
      //   {"label":"Punisher skull logo","box_2d":288,412, 835, 610]}
      // Re-open the array at the start of this value (just after its ':') so it
      // becomes "box_2d":[288,412, 835, 610]. Without this the trailing numbers
      // read as object keys — the "Expected double-quoted property name" error.
      if (valueStart >= 0) {
        out = `${out.slice(0, valueStart)}[${out.slice(valueStart)}]`;
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === ":") {
      out += ch;
      // Remember where this value begins. Deliberately NOT reset on ',' — in a
      // well-formed document every ']' matches a '[', so this only ever fires
      // for the dropped-bracket case above.
      valueStart = out.length;
      continue;
    }
    if (ch === "," ) {
      // Drop a trailing comma before a closing brace/bracket.
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      // Gemini occasionally elides an array value as a doubled delimiter,
      // e.g. [483, 27,, 558, 55]. Collapse only repeated ARRAY commas:
      // no coordinate is invented, and strict box validation below still
      // requires exactly four finite ordered values. Never repair this form
      // inside an object because it could conceal a missing key/value pair.
      if (stack[stack.length - 1] === "[" && src[j] === ",") continue;
      if (src[j] === "}" || src[j] === "]") continue;
      out += ch;
      continue;
    }
    out += ch;
  }
  // Quote bare object keys: {label: …} / , label: … -> {"label": …}
  return out.replace(
    /([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g,
    '$1"$2"$3',
  );
}

/**
 * Drop a spurious quoted separator between a key's ':' and its real value.
 *
 * Live 2026-07-31 payload (logos.extract, Quick Clean House Cleaners):
 *   {"label":"partial logo","box_2d":":"[272, 912, 635, 933]"}
 * while every other element in the SAME response read correctly as
 *   {"label":"main logo","box_2d":"[221, 521, 654, 905]"}
 *
 * This has to run before the brace-balance scan, not after it. The stray pair
 * flips quote parity for the whole rest of the document, so the scanner counts
 * every following brace as string content, never returns to depth 0, and
 * reports "unterminated JSON value in response" — the repair pass downstream
 * never gets the chance to run.
 *
 * It matters more than one bad sample because geminiJson runs at temperature 0:
 * every key in the pool re-requests the same prompt and gets the same malformed
 * text, so key rotation cannot recover it. The stage failed non-retryably on
 * attempt 1 of 5 and took the pack's whole logo extraction with it.
 *
 * Safe on well-formed input, and only reached after a strict parse has already
 * failed: in valid JSON a string value is always followed by ',' '}' or ']',
 * never by '[', so the lookahead cannot match a legitimate document.
 */
function dropStrayQuotedSeparator(text) {
  return String(text || "")
    .replace(/:\s*"[:\s]*"\s*(?=\[)/g, ':"')
    // A SINGLE stray quote-colon before the array, which the rule above cannot
    // match because it requires a CLOSING quote before the bracket:
    //
    //   {"label":"company name","box_2d":":[355, 265, 507, 850]}
    //                                    ^^ this, not ":"
    //
    // The opening quote swallows everything up to the next quote, so the parser
    // reports `Expected ',' or '}' after property value` far downstream of the
    // real damage. Live on ROOF, pack 9c737af3, 2026-08-10: the first element
    // was clean and every element after it carried this, so the locate pass was
    // refused and ROOF shipped as a separation gap with no clean panel — while
    // the other five sides separated at round-trip diffs of 2.6 to 3.3.
    //
    // Restricted to a bracket that opens on a number so a legitimate string
    // value that genuinely begins with ":[" is never rewritten. Like every rule
    // here this runs only after strict parsing has already failed.
    .replace(/:\s*"\s*:\s*(?=\[\s*-?\d)/g, ":");
}

// Accept the documented coordinate key plus Gemini's observed one-character
// box_2d_ typo, but never guess at coordinates. Every supplied alias must be a
// finite, ordered [ymin,xmin,ymax,xmax] box in the documented 0..1000 space.
// Multiple aliases may coexist only if they identify the exact same box.
function strictGeminiBox2d(element, index) {
  if (!element || typeof element !== "object" || Array.isArray(element)) {
    throw new Error(`branding element ${index + 1} is not an object`);
  }
  const fields = ["box_2d", "box_2d_", "box"]
    .filter((key) => Object.prototype.hasOwnProperty.call(element, key) && element[key] != null)
    .map((key) => ({ key, value: element[key] }));
  if (!fields.length) {
    throw new Error(`branding element ${index + 1} has no box_2d coordinates`);
  }
  const boxes = fields.map(({ key, value }) => {
    if (!Array.isArray(value) || value.length !== 4) {
      throw new Error(`branding element ${index + 1} ${key} must contain exactly four coordinates`);
    }
    if (!value.every((coord) => typeof coord === "number" && Number.isFinite(coord))) {
      throw new Error(`branding element ${index + 1} ${key} coordinates must be finite numbers`);
    }
    const [ymin, xmin, ymax, xmax] = value;
    if (value.some((coord) => coord < 0 || coord > 1000)) {
      throw new Error(`branding element ${index + 1} ${key} coordinates must be within 0..1000`);
    }
    if (!(ymax > ymin && xmax > xmin)) {
      throw new Error(`branding element ${index + 1} ${key} coordinates are not an ordered box`);
    }
    return { key, value: [...value] };
  });
  const canonical = boxes[0].value;
  if (boxes.slice(1).some(({ value }) => value.some((coord, i) => coord !== canonical[i]))) {
    throw new Error(`branding element ${index + 1} has conflicting coordinate fields`);
  }
  return canonical;
}

function collapseContainedBrandingElements(elements) {
  const area = ({ b }) => (b[2] - b[0]) * (b[3] - b[1]);
  const contains = (outer, inner) =>
    outer.b[0] <= inner.b[0] &&
    outer.b[1] <= inner.b[1] &&
    outer.b[2] >= inner.b[2] &&
    outer.b[3] >= inner.b[3];
  const ordered = elements
    .map((element, index) => ({
      label: String(element.label || "branding"),
      b: [...element.b],
      sourceIndex: index,
      labels: [String(element.label || "branding")],
    }))
    .sort((left, right) =>
      area(right) - area(left) || left.sourceIndex - right.sourceIndex,
    );
  const kept = [];
  for (const element of ordered) {
    const enclosing = kept.find((candidate) => contains(candidate, element));
    if (enclosing) {
      for (const label of element.labels) {
        if (!enclosing.labels.includes(label)) enclosing.labels.push(label);
      }
      continue;
    }
    kept.push(element);
  }
  return kept
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
    .map(({ b, labels }) => ({ label: labels.join(" + "), b }));
}

// An erase sample is acceptable only when it both preserves the surrounding
// artwork and actually removes enough of the requested element to yield a
// plotter-safe hard cut. Keep these thresholds identical to the emitted cut
// receipt below so a ring-safe no-op consumes the existing retry instead of
// publishing an overlay with a null cut_url.
function hardCutQualityFromDiff(diff) {
  const CUT_D_LO = 24;
  const CUT_D_HI = 48;
  const CUT_MIN_CLEAR = 0.15;
  const CUT_MAX_PARTIAL = 0.25;
  const CUT_MIN_SOLID = 0.02;
  let clear = 0;
  let solid = 0;
  for (let p = 0; p < diff.length; p++) {
    const d = diff[p];
    const a = d <= CUT_D_LO
      ? 0
      : d >= CUT_D_HI
        ? 255
        : Math.round((255 * (d - CUT_D_LO)) / (CUT_D_HI - CUT_D_LO));
    if (a < 16) clear++;
    else if (a > 239) solid++;
  }
  const total = diff.length;
  const transparentPct = total ? clear / total : 0;
  const opaquePct = total ? solid / total : 0;
  const partialPct = total ? 1 - transparentPct - opaquePct : 1;
  return {
    transparentPct,
    partialPct,
    opaquePct,
    isCut: total > 0 &&
      transparentPct >= CUT_MIN_CLEAR &&
      partialPct <= CUT_MAX_PARTIAL &&
      opaquePct >= CUT_MIN_SOLID,
  };
}

// Gemini JSON call (TEXT only, temperature 0) with key-pool rotation.
async function geminiJson(parts) {
  let lastErr = "no response";
  for (let k = 0; k < GEMINI_KEYS.length; k++) {
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_KEYS[k]}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ["TEXT"], temperature: 0, topP: 1, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(90000),
        }
      );
      if (resp.status === 429 || resp.status >= 500) { lastErr = `key ${k + 1} → ${resp.status}`; continue; }
      if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
      const r = await resp.json();
      const text = r.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      return extractJsonValue(text);
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(`geminiJson: ${lastErr}`);
}

// Gemini image-edit call with key-pool rotation. Returns image bytes or null.
//
// timeoutMs sizes ONE attempt; deadline (epoch ms, 0 = none) bounds the whole
// key-pool loop. Without the deadline a run of 429s walks every key at the full
// per-attempt timeout, so one call can cost keys x timeoutMs — survivable when
// the caller makes a single call, but not when it makes one per element.
async function geminiImageEdit(parts, aspect, timeoutMs = 120000, deadline = 0) {
  let lastErr = "no image";
  for (let k = 0; k < GEMINI_KEYS.length; k++) {
    if (deadline && Date.now() >= deadline) return { bytes: null, reason: `deadline reached (${lastErr})` };
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${GEMINI_KEYS[k]}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspect, imageSize: "2K" } },
          }),
          signal: AbortSignal.timeout(timeoutMs),
        }
      );
      if (resp.status === 429 || resp.status >= 500) { lastErr = `key ${k + 1} → ${resp.status}`; continue; }
      if (!resp.ok) { lastErr = `Gemini ${resp.status}`; return { bytes: null, reason: lastErr }; }
      const r = await resp.json();
      const cParts = r.candidates?.[0]?.content?.parts;
      if (cParts) for (const p of cParts) { if (p.inlineData) return { bytes: Buffer.from(p.inlineData.data, "base64"), reason: null }; }
      lastErr = `no image (${r.candidates?.[0]?.finishReason || "?"})`;
      return { bytes: null, reason: lastErr };
    } catch (e) { lastErr = e.message; }
  }
  return { bytes: null, reason: lastErr };
}

// ── /extract-sidefield — THE ARTBOARD AS AN EXTRACTION ───────────────────────
//
// The one method that has ever produced a deterministic non-passenger panel is
// `artboard-slice`, a geometric crop of the artboard: 125 panels. Every AI
// redraw producer combined has produced zero. But a crop is only as good as
// what it crops, and the artboard is GENERATED — so the slicer faithfully cuts
// a reinvented design, which is why its own judge refused it for a missing
// text block and a resized logo.
//
// This produces the same artboard by EXTRACTION instead. One model call, and it
// may only return COORDINATES — code does everything that touches a pixel, so
// the design cannot drift because nothing is ever asked to draw it.
//
// It works because the driver-side view is not a hero 3/4 shot: its camera spec
// is "PERFECTLY STRAIGHT side-on elevation... exactly 90 degrees perpendicular
// ... Zero tilt, zero rotation... like a blueprint elevation drawing". The wrap
// is already orthographic in image space, so no perspective rectification is
// needed.
//
// ADDITIVE. This does not replace the generated artboard; it stands beside it
// so the two can be judged against each other before anything is switched.
app.post("/extract-sidefield", authMiddleware, async (req, res) => {
  const { userId, jobId, sideUrl, side } = req.body || {};
  if (!userId || !sideUrl) {
    return res.status(400).json({ success: false, error: "userId, sideUrl required" });
  }
  if (!HAS_GEMINI) return res.status(500).json({ success: false, error: "No GOOGLE_AI_API_KEY(_2..5) configured" });
  const folder = jobId || `sidefield-${Date.now()}`;
  const sideSlug = String(side || "driver-side").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  try {
    let src = await fetchBuffer(sideUrl);
    let img = sharp(src, { limitInputPixels: false });
    let meta = await img.metadata();
    // Bounded working size: the raw RGBA of a 5504x3072 hero is ~68MB, and the
    // crop below holds a second copy.
    if (Math.max(meta.width, meta.height) > 4096) {
      src = await img.resize(4096, 4096, { fit: "inside" }).png().toBuffer();
      img = sharp(src, { limitInputPixels: false });
      meta = await img.metadata();
    }
    const W = meta.width, H = meta.height;

    // LOCATE — coordinates only. The response is JSON; no image is returned by
    // the model at any point in this endpoint.
    const det = await geminiJson([
      {
        text:
          `This is a straight-on side elevation photograph of a wrapped vehicle in a studio. ` +
          `Return ONLY JSON, boxes as [ymin,xmin,ymax,xmax] normalized 0-1000:\n` +
          `{"body":[0,0,0,0],"holes":[[0,0,0,0]]}\n` +
          `"body" = the tight bounding box of the vehicle's PAINTED BODY that carries the wrap ` +
          `artwork — bumper to bumper, roofline down to the bottom of the rocker. Exclude the ` +
          `studio floor, walls, background and any shadow or reflection.\n` +
          `"holes" = boxes INSIDE that body which are NOT wrap: glass and windows, wheels and ` +
          `tyres, and open grille. Do not box graphics, lettering, logos or paint — those ARE the wrap.`,
      },
      { inlineData: { mimeType: "image/png", data: src.toString("base64") } },
    ]);

    const plan = planSidefieldExtract({
      bodyBox: det?.body || det?.vehicle || null,
      holeBoxes: Array.isArray(det?.holes) ? det.holes : [],
      W,
      H,
    });
    // Honest refusal: a locate that returned the whole frame or a sliver means
    // we do not know where the vehicle is. Cropping anyway ships the studio.
    if (!plan) {
      return res.json({ success: false, error: "locate pass did not return a usable vehicle body box", stage: "locate" });
    }

    const cropRaw = await sharp(src, { limitInputPixels: false })
      .extract({ left: plan.crop.x, top: plan.crop.y, width: plan.crop.w, height: plan.crop.h })
      .ensureAlpha()
      .raw()
      .toBuffer();

    // Glass and wheels are not wrap, but the print file is a solid rectangle —
    // the installer trims. Filled by mirroring real pixels across the hole
    // edge: the same operation the 5" bleed already uses, turned inward.
    fillHolesByMirror(cropRaw, plan.crop.w, plan.crop.h, plan.holes);

    const png = await sharp(cropRaw, {
      raw: { width: plan.crop.w, height: plan.crop.h, channels: 4 },
    }).png().toBuffer();
    const path = `graphics-pack/${userId}/${folder}/${sideSlug}_sidefield_extract.png`;
    await uploadBuffer(path, png, "image/png");

    console.log(
      `[WORKER] ✓ extract-sidefield ${sideSlug}: ${plan.crop.w}x${plan.crop.h} from ${W}x${H}, ${plan.holes.length} hole(s) mirrored`,
    );
    return res.json({
      success: true,
      url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`,
      crop: plan.crop,
      holes: plan.holes.length,
      source: { width: W, height: H },
      // HONEST LINEAGE. Every pixel is a real pixel of the approved render —
      // nothing generative ran. The LOCATE step is AI, but it returned only
      // coordinates and never touched a pixel, so it is reported separately
      // rather than folded into a "deterministic" claim.
      pixelsFromApprovedRender: true,
      locateWasAI: true,
    });
  } catch (e) {
    console.error(`[WORKER] extract-sidefield failed:`, e.message);
    return res.status(500).json({ success: false, error: `extract-sidefield failed: ${e.message}` });
  }
});

// ── BRANDING LOCATE — the ONE vision pass ────────────────────────────────────
// Shared by /lift-overlays and /call7-sanity-check. The sanity gate reuses this
// exact locate instead of growing a second, different detector; everything the
// gate decides from these boxes is deterministic pixel math.
//
// Input is a base64 PNG (callers downscale to ≤1280 — boxes are normalized
// 0-1000, so detail buys the locate nothing and a 3000px body times out).
// Returns [{ label, b: [ymin,xmin,ymax,xmax] }] in 0..1000 space, already
// collapsed so a contained sub-box merges into its enclosing element.
const BRANDING_LOCATE_PROMPT = `This image is a FLAT vehicle-wrap PRINT PANEL. Locate EVERY branding element on it: company names, logo marks, lettering, phone numbers, websites, taglines, badges. Return the tight bounding box of each, plus a 2-4 word label. Background artwork (patterns, gradients, scenery, flames, stripes) is NOT branding — never box it. EVERY element you return MUST carry its box_2d array; omit the element entirely rather than returning it without coordinates. Respond ONLY with this JSON (box_2d is [ymin,xmin,ymax,xmax] normalized 0-1000):\n{"elements":[{"label":"company name","box_2d":[0,0,0,0]}]}`;

// RE-ASK, NEVER GUESS, NEVER DROP.
//
// This was one shot. When the model returned an element with no box_2d, or
// named the array something unexpected, strictGeminiBox2d threw and the
// whole side became a separation gap — live on REAR, pack 2982283c,
// 2026-08-11: "branding element 1 has no box_2d coordinates", which left
// REAR with a branded panel and no clean one, marked the row production-
// ineligible, and greyed out Order Production Pack for a pack whose other
// five sides had separated at round-trip diffs of 2.9 to 3.3.
//
// Guessing the missing box would bake a logo into the "clean" panel, and
// dropping the element would leave that branding un-lifted — both ship a
// wrong panel silently. The only safe remedy is to ask again. Three
// attempts, then fail honestly with the real reason.
async function locateBrandingElements(locateB64) {
  let locatedElements = null;
  let lastLocateError = null;
  for (let attempt = 1; attempt <= 3 && !locatedElements; attempt++) {
    try {
      const det = await geminiJson([
        { text: BRANDING_LOCATE_PROMPT },
        { inlineData: { mimeType: "image/png", data: locateB64 } },
      ]);
      // The prompt asks for {"elements":[...]}, but the model sometimes answers with
      // a bare array or a differently-named key. Accept all of them rather than
      // silently reporting "no branding elements detected" on a valid response.
      const detElements = Array.isArray(det)
        ? det
        : (det?.elements ?? det?.boxes ?? det?.branding);
      if (!Array.isArray(detElements)) {
        throw new Error("branding locate response did not contain an elements array");
      }
      locatedElements = detElements
        .map((e, index) => ({
          label: String(e?.label || "branding"),
          // The second key is Gemini's exact live Bosch-response typo. Selection
          // is explicit here; strictGeminiBox2d also detects conflicting aliases.
          b: strictGeminiBox2d(e, index),
        }));
    } catch (locateError) {
      lastLocateError = locateError;
      console.warn(
        `[WORKER] branding locate attempt ${attempt}/3 unusable: ${locateError?.message || locateError}`,
      );
    }
  }
  if (!locatedElements) {
    throw lastLocateError || new Error("branding locate returned no usable elements");
  }
  return collapseContainedBrandingElements(locatedElements);
}

// ── CALL 7 SANITY GATE ───────────────────────────────────────────────────────
// Refuses a generated Call 7 surface candidate that carries either defect the
// model has authored live (designs 5714755c, 06e082d5):
//
//   * MIRRORED TWIN — a mirrored duplicate of a located branding element
//     elsewhere on the panel (mirrored 24/7 badge inside the DRIVER SIDE trim).
//   * EDGE TRUNCATION — located branding touching the surface edge (contact
//     bar truncated at the ROOF edge). The tile IS the trim rect: compose
//     contains it inside GENIE trim and mirror-extends the bleed, so a box at
//     the tile edge sits ON the dashed trim line — and on the aspect-slack
//     axis it would additionally be mirror-DUPLICATED into the visible panel.
//
// The vision half is the existing branding locate above — no second detector.
// Every verdict below it is deterministic pixel math (Sharp crop/flip + a
// normalized pixel difference over candidate offsets), never a model opinion,
// so this gate cannot become the next source of flakiness.
//
// Fail-open contract: a gate that cannot run (locate down, fetch failed)
// returns pass:true, known:false with the reason — a broken gate must never
// block Call 7. A real negative verdict is known:true, pass:false and the
// caller regenerates the candidate.
const SANITY_EDGE_TOL = 10;        // 0..1000 units — "touches or crosses the trim edge"
const SANITY_MIRROR_MAX_DIFF = 24; // mean |diff| per channel at the refined best offset
const SANITY_MIN_STDDEV = 18;      // element must carry texture for a meaningful match
const SANITY_SELF_IOU = 0.25;      // a symmetric element matches itself — exclude its own box
const SANITY_MIN_ELEMENT_PX = 12;  // smaller crops match noise, skip them

function boxIou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

// Sampled mean/stddev of a grayscale region (stride 2 — statistics, not sums).
function grayStats(gray, W, box) {
  let sum = 0, sumSq = 0, n = 0;
  for (let y = box.y; y < box.y + box.h; y += 2) {
    for (let x = box.x; x < box.x + box.w; x += 2) {
      const v = gray[y * W + x];
      sum += v; sumSq += v * v; n++;
    }
  }
  if (!n) return { mean: 0, std: 0 };
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) };
}

// Deterministic mirrored-twin search: horizontally flip the element's own
// pixels and template-match them across the panel. Coarse pass (stride-3
// template samples, stride-2 offsets) finds the best candidate offset away
// from the element itself; a dense refinement around it produces the final
// normalized mean-absolute difference. Returns the best match or null.
function findMirroredTwin(gray, W, H, box) {
  const { w, h } = box;
  // Flipped template copied out once.
  const tmpl = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      tmpl[y * w + x] = gray[(box.y + y) * W + (box.x + (w - 1 - x))];
    }
  }
  const denseDiffAt = (ox, oy, step) => {
    let sum = 0, n = 0;
    for (let y = 0; y < h; y += step) {
      const rowT = y * w, rowG = (oy + y) * W + ox;
      for (let x = 0; x < w; x += step) {
        sum += Math.abs(tmpl[rowT + x] - gray[rowG + x]);
        n++;
      }
    }
    return n ? sum / n : 255;
  };
  let best = null;
  for (let oy = 0; oy + h <= H; oy += 2) {
    for (let ox = 0; ox + w <= W; ox += 2) {
      if (boxIou(box, { x: ox, y: oy, w, h }) > SANITY_SELF_IOU) continue;
      const d = denseDiffAt(ox, oy, 3);
      if (!best || d < best.diff) best = { x: ox, y: oy, diff: d };
    }
  }
  if (!best) return null;
  // Dense refinement in a ±2px neighbourhood of the coarse winner.
  let refined = { ...best, diff: Infinity };
  for (let oy = Math.max(0, best.y - 2); oy <= Math.min(H - h, best.y + 2); oy++) {
    for (let ox = Math.max(0, best.x - 2); ox <= Math.min(W - w, best.x + 2); ox++) {
      if (boxIou(box, { x: ox, y: oy, w, h }) > SANITY_SELF_IOU) continue;
      const d = denseDiffAt(ox, oy, 1);
      if (d < refined.diff) refined = { x: ox, y: oy, diff: d };
    }
  }
  return Number.isFinite(refined.diff) ? refined : null;
}

app.post("/call7-sanity-check", authMiddleware, async (req, res) => {
  const { imageUrl, side } = req.body || {};
  const label = String(side || req.body?.label || "surface");
  if (!imageUrl) return res.status(400).json({ success: false, error: "imageUrl required" });
  const startedAt = Date.now();
  try {
    if (!HAS_GEMINI) throw new Error("No GOOGLE_AI_API_KEY(_2..5) configured on the worker");
    let img = await fetchBuffer(imageUrl);
    let meta = await sharp(img, { limitInputPixels: false }).metadata();
    if (Math.max(meta.width, meta.height) > 2048) {
      img = await sharp(img, { limitInputPixels: false }).resize(2048, 2048, { fit: "inside" }).png().toBuffer();
      meta = await sharp(img).metadata();
    }
    const locateB64 = Math.max(meta.width, meta.height) > 1280
      ? (await sharp(img).resize(1280, 1280, { fit: "inside" }).png().toBuffer()).toString("base64")
      : img.toString("base64");
    const elements = await locateBrandingElements(locateB64);
    if (!elements.length) {
      return res.json({
        success: true, pass: true, known: true, reasons: [], elements: 0,
        ms: Date.now() - startedAt,
      });
    }

    const reasons = [];

    // [1] EDGE TRUNCATION — pure box arithmetic in the locate's own 0..1000
    // space, so it is resolution-independent by construction. A whole-frame box
    // is a locate artifact, not a branding element; skip it rather than refusing
    // every candidate forever.
    for (const e of elements) {
      const [ymin, xmin, ymax, xmax] = e.b;
      const area = ((ymax - ymin) / 1000) * ((xmax - xmin) / 1000);
      if (area >= 0.8) continue;
      const edges = [];
      if (xmin <= SANITY_EDGE_TOL) edges.push("left");
      if (ymin <= SANITY_EDGE_TOL) edges.push("top");
      if (xmax >= 1000 - SANITY_EDGE_TOL) edges.push("right");
      if (ymax >= 1000 - SANITY_EDGE_TOL) edges.push("bottom");
      if (edges.length) {
        reasons.push({
          code: "edge_truncated",
          label: e.label,
          detail: `"${e.label}" touches the ${edges.join("+")} trim edge (box [${e.b.join(",")}] in 0..1000, tol ${SANITY_EDGE_TOL})`,
        });
      }
    }

    // [2] MIRRORED TWIN — deterministic template match at a bounded working
    // size. 768px long edge keeps the search a few hundred ms while a real
    // authored twin (a whole redrawn badge) still spans dozens of pixels.
    const { data: gray, info } = await sharp(img)
      .resize(768, 768, { fit: "inside" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const GW = info.width, GH = info.height;
    for (const e of elements) {
      const [ymin, xmin, ymax, xmax] = e.b;
      const bx = {
        x: Math.max(0, Math.round((xmin / 1000) * GW)),
        y: Math.max(0, Math.round((ymin / 1000) * GH)),
      };
      bx.w = Math.min(GW, Math.round((xmax / 1000) * GW)) - bx.x;
      bx.h = Math.min(GH, Math.round((ymax / 1000) * GH)) - bx.y;
      if (bx.w < SANITY_MIN_ELEMENT_PX || bx.h < SANITY_MIN_ELEMENT_PX) continue;
      if ((bx.w / GW) * (bx.h / GH) >= 0.8) continue;
      const stats = grayStats(gray, GW, bx);
      if (stats.std < SANITY_MIN_STDDEV) continue;
      const twin = findMirroredTwin(gray, GW, GH, bx);
      if (twin && twin.diff <= SANITY_MIRROR_MAX_DIFF) {
        reasons.push({
          code: "mirrored_twin",
          label: e.label,
          detail: `mirrored duplicate of "${e.label}" at ${twin.x},${twin.y} of ${GW}x${GH} (normalized diff ${twin.diff.toFixed(1)} <= ${SANITY_MIRROR_MAX_DIFF}, element stddev ${stats.std.toFixed(1)})`,
        });
      }
    }

    const pass = reasons.length === 0;
    console.log(
      `[WORKER] ${pass ? "✓" : "✗"} call7-sanity ${label}: ${elements.length} element(s), ` +
      `${pass ? "clean" : reasons.map((r) => `${r.code}:"${r.label}"`).join(", ")} in ${Date.now() - startedAt}ms`,
    );
    return res.json({
      success: true, pass, known: true, reasons, elements: elements.length,
      ms: Date.now() - startedAt,
    });
  } catch (e) {
    // Fail OPEN, legibly: an unavailable gate must never block Call 7. The
    // caller records known:false so "not checked" can never masquerade as
    // "checked and passed".
    console.warn(`[WORKER] call7-sanity ${label} unavailable (passing open): ${e.message}`);
    return res.json({
      success: true, pass: true, known: false,
      reasons: [{ code: "sanity_unavailable", label, detail: e.message }],
      ms: Date.now() - startedAt,
    });
  }
});

app.post("/lift-overlays", authMiddleware, async (req, res) => {
  const { userId, jobId, side, brandedUrl } = req.body || {};
  if (!userId || !side || !brandedUrl) {
    return res.status(400).json({ success: false, error: "userId, side, brandedUrl required" });
  }
  if (!HAS_GEMINI) return res.status(500).json({ success: false, error: "No GOOGLE_AI_API_KEY(_2..5) configured" });
  // Anchor every phase budget below to when the REQUEST started, not to when
  // that phase happens to begin, so a slow locate pass spends the same envelope
  // instead of pushing the total past what the callers agreed to wait for.
  const liftStartedAt = Date.now();
  const folder = jobId || `lift-${Date.now()}`;
  const sideSlug = String(side).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  try {
    // Branded panel at a bounded working size (raw RGBA of a 4K panel is ~70MB;
    // 3000px long edge keeps three copies + overlays well inside worker memory).
    let branded = await fetchBuffer(brandedUrl);
    let bImg = sharp(branded, { limitInputPixels: false });
    let meta = await bImg.metadata();
    if (Math.max(meta.width, meta.height) > 3000) {
      branded = await bImg.resize(3000, 3000, { fit: "inside" }).png().toBuffer();
      bImg = sharp(branded); meta = await bImg.metadata();
    }
    const W = meta.width, H = meta.height;
    const b64 = branded.toString("base64");

    // [1] LOCATE — every branding element, boxes normalized 0-1000.
    //
    // The locate pass is fed a DOWNSCALED copy. It returns boxes in a 0-1000
    // normalized space, so detail buys it nothing — but a 3000px PNG as base64
    // is a multi-megabyte request body, and on 2026-08-01 that call died with
    // "geminiJson: The operation was aborted due to timeout" at the 90s bound
    // and took a pack with six finished panels down with it. The erase passes
    // below still work on the FULL-resolution panel; only the box-finder reads
    // the small copy.
    const locateB64 = Math.max(W, H) > 1280
      ? (await sharp(branded, { limitInputPixels: false })
          .resize(1280, 1280, { fit: "inside" })
          .png()
          .toBuffer()).toString("base64")
      : b64;
    // Dilate ~3% each side for glows/shadows; clamp to the panel.
    const DIL = 30; // of 1000
    // The re-ask/never-guess locate loop lives in locateBrandingElements —
    // shared with /call7-sanity-check so both consume the SAME vision pass.
    const boxes = (await locateBrandingElements(locateB64))
      .map((e) => {
        const [ymin, xmin, ymax, xmax] = e.b;
        const x0 = Math.max(0, Math.round(((xmin - DIL) / 1000) * W));
        const y0 = Math.max(0, Math.round(((ymin - DIL) / 1000) * H));
        const x1 = Math.min(W, Math.round(((xmax + DIL) / 1000) * W));
        const y1 = Math.min(H, Math.round(((ymax + DIL) / 1000) * H));
        return { label: e.label, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      })
      .filter((e) => e.w >= 8 && e.h >= 8);
    if (!boxes.length) {
      // Honest no-op: a design with no branding has nothing to lift.
      return res.json({ success: true, overlays: [], cleanUrl: null, reason: "no branding elements detected" });
    }

    // [2] ERASE — PER BOX, ON A PADDED CROP, PASTED BACK INSIDE THE BOX ONLY.
    //
    // THE WHOLE-PANEL ERASE COULD NOT PASS ITS OWN GATE. Live on 2026-08-01 it
    // failed five of the last six entice packs at outside-box diffs of 27.7,
    // 39.0, 39.2, 76.2 and 76.5 against a limit of 26. 76 is not a near miss,
    // and raising the limit is not available: the overlay alpha in [4] IS
    // |branded - clean|, so a misaligned clean panel turns every lifted overlay
    // into garbage. The gate was right; the pass it was gating was wrong.
    //
    // Two structural causes, both removed here rather than tuned:
    //
    //   1. GEOMETRY — the dominant one. `geminiImageEdit` can only emit one of
    //      seven fixed aspects (CLEAN_ASPECTS), and the result was resized
    //      `fit:"fill"` onto the panel's own grid. A driver side is ~3.24:1 and
    //      the nearest offered aspect is 21:9 (2.33:1), so the erase output was
    //      stretched ~39% horizontally BEFORE it was ever compared. Every pixel
    //      moves; the measured diff is large no matter how faithful the model
    //      was. That is why the number was ~76 on wide sides and ~28 on squarer
    //      ones — it was reading the stretch, not a repaint.
    //   2. SCALE — asking for a full 3000px panel back means the model has to
    //      redraw the whole design to return anything at all.
    //
    // The fix is the owner's: crop to the element, erase, paste back. Each pass
    // now sees a small region whose surrounding artwork IS the answer to
    // "continue the background", and the crop is grown to exactly the aspect the
    // model will emit, so the rescale is a pure scale with zero stretch.
    //
    // The gate keeps its meaning and its threshold — it moves to the RING (the
    // crop's padding, minus every located box), which measures "did this pass
    // redraw the surrounding design" at the only place a redraw can still do
    // harm: immediately around the pixels being lifted. Outside the crop the
    // panel is untouched BY CONSTRUCTION now, not by measurement.
    const brandedRaw = await sharp(branded).ensureAlpha().raw().toBuffer();
    const cleanRaw = Buffer.from(brandedRaw);
    // Every box, not just the current one: a neighbouring element may sit in
    // this crop's ring, and the model erasing it too must not read as a repaint.
    const inBox = (x, y) => boxes.some((bx) => x >= bx.x && x < bx.x + bx.w && y >= bx.y && y < bx.y + bx.h);
    const RING_MAX = 26; // mean |diff| per channel — unchanged from OUTSIDE_MAX
    const ringDiffs = [];

    // ── WALL-CLOCK BUDGET ────────────────────────────────────────────────────
    // Per-box erasing trades one Gemini call for N, and the first live run
    // after it shipped (2026-08-01 03:11, run e88b865e) traded the alignment
    // failure for `panel-artboard-generator returned HTTP 504`: the erase gate
    // stopped failing and the stage timed out instead. Correct fix, wrong
    // budget — so the phase is now bounded rather than open-ended.
    //
    //   * 45s per crop, not the 120s sized for a full 3000px panel. A crop is
    //     roughly a tenth the pixels and returns in seconds.
    //   * A hard deadline across the whole phase, passed into the key-pool loop
    //     so a run of 429s cannot walk five keys at full timeout per box.
    //   * Two crops in flight. These are small extracts, not full-panel
    //     generations, so this does not breach the one-big-image-at-a-time rule
    //     that the memory split exists to enforce.
    //
    // Exhausting the budget is an honest, RETRYABLE failure naming the budget —
    // never a silent partial lift, which would ship a panel with branding still
    // baked into it.
    const ERASE_CALL_MS = 45_000;
    // The 100s this phase used to allow itself was sized on 2026-08-01, when the
    // erase was ONE call per box. It has been per-CHUNK since, and splitting
    // elongated elements to a supported aspect raised the count again — so the
    // budget has been shrinking in real terms every time the pass got more
    // correct. Both callers already wait far longer than 100s for this one
    // request: the workflow's callFn(..., 300_000) and panel-artboard-
    // generator's AbortSignal.timeout(300_000). The inner cap was simply never
    // revisited, and it threw away two thirds of an envelope it already had.
    //
    // Live, pack 9c737af3 on 2026-08-10 18:40: the ring gate PASSED at 2.3
    // (the same design had been failing it at 66.9 and 31.6 against a limit of
    // 26), and the stage died anyway on `erase pass failed for "mirrored logo":
    // The operation was aborted due to timeout`. Quality was fixed; the budget
    // became the binding constraint, which is exactly the trade the 2026-08-01
    // note warned about in the other direction.
    //
    // RESERVE keeps the compose, subtract, per-overlay uploads and the response
    // inside the same 300s the callers allow, so widening the erase phase can
    // never turn a quality failure into the HTTP 504 that closed that earlier
    // round. The floor keeps a late-starting phase from getting a dead budget.
    const LIFT_REQUEST_BUDGET_MS = 300_000;
    const POST_ERASE_RESERVE_MS = 75_000;
    const eraseDeadline = Math.max(
      Date.now() + 20_000,
      liftStartedAt + LIFT_REQUEST_BUDGET_MS - POST_ERASE_RESERVE_MS,
    );
    // Chunks, not boxes. An elongated element (a contact bar) cannot reach a
    // supported aspect without its crop swallowing the panel, so the geometry
    // module splits it; chunks tile the box exactly, so nothing stays branded.
    const eraseUnits = boxes.flatMap((bx) => liftCropPlan(bx, W, H));
    const eraseChunk = async ({ bx, cx0, cy0, cw, ch, aspect: cropAspect, aspectStretch = 0 }) => {
      // The crop is grown to the exact aspect `geminiImageEdit` emits so the
      // fit:"fill" rescale below is a pure scale. When the panel edge stops that
      // growth the planner splits instead — but if even the bounded split cannot
      // reach it, the rescale would move every pixel and the ring gate would
      // read our own stretch as "the model repainted the design". Refuse here,
      // naming the geometry, rather than shipping a stretch and blaming Gemini.
      if (aspectStretch > LIFT_ASPECT_TOLERANCE) {
        return {
          bx,
          error: `erase crop for "${bx.label}" could not reach a supported aspect: `
            + `${cw}x${ch} is ${(aspectStretch * 100).toFixed(1)}% off ${cropAspect}`,
          ringDiff: null,
        };
      }
      const cropB64 = (
        await sharp(branded, { limitInputPixels: false })
          .extract({ left: cx0, top: cy0, width: cw, height: ch })
          .png()
          .toBuffer()
      ).toString("base64");

      let lastRing = null, lastReason = null;
      // One retry, budget permitting: the pass is cheap and small, and a single
      // bad sample should not cost the pack when the next one usually lands.
      for (let attempt = 1; attempt <= 2; attempt++) {
        const budgetLeft = eraseDeadline - Date.now();
        if (budgetLeft <= 2_000) {
          lastReason = lastReason
            || `erase budget exhausted before "${bx.label}" could be lifted`;
          break;
        }
        const edit = await geminiImageEdit([
          { text: `EDIT this crop of a flat vehicle-wrap print panel. Remove the ${bx.label} and fill the area it occupied with a seamless continuation of the background design that surrounds it. Everything else must stay pixel-identical: same colors, same pattern, same positions, same framing, edge to edge. Output the full crop at the same framing.` },
          { inlineData: { mimeType: "image/png", data: cropB64 } },
        ], cropAspect, Math.min(ERASE_CALL_MS, budgetLeft), eraseDeadline);
        if (!edit.bytes) { lastReason = `erase pass failed for "${bx.label}": ${edit.reason}`; continue; }
        const cropClean = await sharp(edit.bytes, { limitInputPixels: false })
          .resize(cw, ch, { fit: "fill" }).ensureAlpha().raw().toBuffer();

        // [2b] RING GATE — the crop's padding, excluding every located box.
        let sum = 0, n = 0;
        for (let y = 0; y < ch; y += 3) {
          for (let x = 0; x < cw; x += 3) {
            if (inBox(cx0 + x, cy0 + y)) continue;
            const ci = (y * cw + x) * 4;
            const pi = ((cy0 + y) * W + (cx0 + x)) * 4;
            sum += Math.abs(brandedRaw[pi] - cropClean[ci])
              + Math.abs(brandedRaw[pi + 1] - cropClean[ci + 1])
              + Math.abs(brandedRaw[pi + 2] - cropClean[ci + 2]);
            n++;
          }
        }
        const ringDiff = n ? sum / (n * 3) : 0;
        lastRing = ringDiff;
        if (ringDiff > RING_MAX) {
          lastReason = `erase pass repainted the design around "${bx.label}" (ring diff ${ringDiff.toFixed(1)} > ${RING_MAX})`;
          continue;
        }

        // A clean ring does not prove that the requested logo was removed.
        // Measure the target rectangle with the same hard-cut thresholds used
        // for the immutable artifact. A near-no-op consumes the existing retry.
        const targetDiff = new Uint8Array(bx.w * bx.h);
        for (let y = 0; y < bx.h; y++) {
          for (let x = 0; x < bx.w; x++) {
            const ci = ((bx.y - cy0 + y) * cw + (bx.x - cx0 + x)) * 4;
            const pi = ((bx.y + y) * W + (bx.x + x)) * 4;
            targetDiff[y * bx.w + x] = Math.max(
              Math.abs(brandedRaw[pi] - cropClean[ci]),
              Math.abs(brandedRaw[pi + 1] - cropClean[ci + 1]),
              Math.abs(brandedRaw[pi + 2] - cropClean[ci + 2]),
            );
          }
        }
        const cutQuality = hardCutQualityFromDiff(targetDiff);
        if (!cutQuality.isCut) {
          lastReason =
            `erase pass did not remove enough of "${bx.label}" for a hard cut ` +
            `(opaque ${(cutQuality.opaquePct * 100).toFixed(1)}% < 2%)`;
          continue;
        }

        return { bx, cropClean, cx0, cy0, cw, ch, ringDiff, cutQuality };
      }
      return { bx, error: lastReason || `erase pass failed for "${bx.label}"`, ringDiff: lastRing };
    };

    // Three in flight. Splitting elongated elements raises the unit count — a
    // typical commercial design runs ~8-12 chunks — so the concurrency has to
    // keep pace with the 100s budget or every such design fails on time rather
    // than on quality. These are small crops, so this still holds nothing like
    // a full-panel generation in memory. The pasting below stays strictly
    // ordered, so a run is reproducible even though the erases are not.
    const ERASE_CONCURRENCY = 3;
    const eraseResults = [];
    for (let i = 0; i < eraseUnits.length; i += ERASE_CONCURRENCY) {
      eraseResults.push(
        ...(await Promise.all(eraseUnits.slice(i, i + ERASE_CONCURRENCY).map(eraseChunk))),
      );
    }
    const failedBox = eraseResults.find((r) => r.error);
    if (failedBox) {
      // Fail closed: a box we could not erase leaves branding in the clean panel
      // AND an empty overlay for that element, which is exactly what the strict
      // lift receipt exists to prevent.
      return res.json({ success: false, error: failedBox.error, stage: "alignment-gate", qc: { ringDiff: failedBox.ringDiff } });
    }

    // [3] PASTE — each erase fill lands ONLY inside its own box, so alignment
    // everywhere else on the panel is exact by construction.
    for (const r of eraseResults) {
      const { bx, cropClean, cx0, cy0, cw } = r;
      for (let y = bx.y; y < bx.y + bx.h; y++) {
        const ci0 = ((y - cy0) * cw + (bx.x - cx0)) * 4;
        const pi0 = (y * W + bx.x) * 4;
        cropClean.copy(cleanRaw, pi0, ci0, ci0 + bx.w * 4);
      }
      ringDiffs.push({ label: bx.label, ringDiff: Math.round(r.ringDiff * 10) / 10 });
    }
    // Zero by construction now: nothing outside a box was ever written.
    const outsideDiff = 0;
    const ringDiffMax = ringDiffs.reduce((m, r) => Math.max(m, r.ringDiff), 0);

    // [4] SUBTRACT — inside each box: alpha from the per-pixel difference
    // (soft matte handles anti-aliased edges); overlay RGB = branded pixels.
    const overlays = [];
    for (let oi = 0; oi < boxes.length; oi++) {
      const bx = boxes[oi];
      const ov = Buffer.alloc(bx.w * bx.h * 4);
      // Keep the raw per-pixel difference so the CUT asset below can be keyed
      // from the same signal without recomputing it.
      const diff = new Uint8Array(bx.w * bx.h);
      for (let y = 0; y < bx.h; y++) {
        for (let x = 0; x < bx.w; x++) {
          const src = ((bx.y + y) * W + (bx.x + x)) * 4;
          const dst = (y * bx.w + x) * 4;
          const d = Math.max(
            Math.abs(brandedRaw[src] - cleanRaw[src]),
            Math.abs(brandedRaw[src + 1] - cleanRaw[src + 1]),
            Math.abs(brandedRaw[src + 2] - cleanRaw[src + 2]),
          );
          diff[y * bx.w + x] = Math.min(255, d);
          ov[dst] = brandedRaw[src];
          ov[dst + 1] = brandedRaw[src + 1];
          ov[dst + 2] = brandedRaw[src + 2];
          ov[dst + 3] = Math.min(255, d * 4); // steep soft matte: full opacity by diff 64
        }
      }
      // TWO OUTPUTS FROM ONE LIFT — they want opposite alpha, so they cannot be
      // the same buffer:
      //
      //   1. THE OVERLAY (`ov`, soft matte above) exists to REBUILD the panel.
      //      The round-trip assert below requires clean + overlays to reproduce
      //      the branded panel within ROUNDTRIP_MAX, and only a soft matte can
      //      reconstruct anti-aliased edges. It is always emitted.
      //
      //   2. THE CUT ASSET (`cut`, below) exists to PLOT. A plotter needs hard
      //      edges: fully in or fully out, partial alpha confined to
      //      anti-aliasing. Keyed by thresholding the same difference signal.
      //
      // Measured on the live Urus driver-side logo, the soft matte scored 5.2%
      // fully transparent / 60.2% partial with corners at alpha 36-144 still
      // carrying the wrap's purple — a translucent SQUARE that plots as a
      // ghosted rectangle. That measurement is why the cut asset is keyed
      // separately rather than reusing the overlay.
      //
      // WHY THE GATE NO LONGER DROPS THE OVERLAY: it used to `continue` here,
      // which threw away a perfectly valid panel-separation overlay because it
      // made a poor CUT file. Those are different products — starving
      // overlayManifest can block the pack entirely, which is a far worse
      // outcome than shipping no cut file for one logo. A failed cut is now an
      // honest gap on the cut asset ALONE; the overlay always ships.
      const CUT_D_LO = 24;  // at/below: background the erase pass merely nudged
      const CUT_D_HI = 48;  // at/above: unambiguously the element itself
      const cut = Buffer.alloc(bx.w * bx.h * 4);
      for (let p = 0; p < bx.w * bx.h; p++) {
        const d = diff[p];
        const a = d <= CUT_D_LO
          ? 0
          : d >= CUT_D_HI
            ? 255
            : Math.round((255 * (d - CUT_D_LO)) / (CUT_D_HI - CUT_D_LO));
        cut[p * 4] = ov[p * 4];
        cut[p * 4 + 1] = ov[p * 4 + 1];
        cut[p * 4 + 2] = ov[p * 4 + 2];
        cut[p * 4 + 3] = a;
      }
      let aClear = 0, aSolid = 0;
      for (let p = 3; p < cut.length; p += 4) {
        const a = cut[p];
        if (a < 16) aClear++;
        else if (a > 239) aSolid++;
      }
      const aTotal = cut.length / 4;
      const clearPct = aClear / aTotal;
      const solidPct = aSolid / aTotal;
      const partialPct = 1 - clearPct - solidPct;
      const CUT_MIN_CLEAR = 0.15;   // must actually cut something away
      const CUT_MAX_PARTIAL = 0.25; // soft pixels are edges only, not a ramp
      const CUT_MIN_SOLID = 0.02;   // ...and something must survive the cut
      const isCut = clearPct >= CUT_MIN_CLEAR
        && partialPct <= CUT_MAX_PARTIAL
        && solidPct >= CUT_MIN_SOLID;

      const safeLabel = bx.label.replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 32);
      const ovPng = await sharp(ov, { raw: { width: bx.w, height: bx.h, channels: 4 } }).png().toBuffer();
      // CONTENT-ADDRESSED — the artifact's own sha256 is part of its key.
      //
      // These objects become a frozen pack's pinned evidence: verify_atomic_pack
      // re-hashes them against the recorded sha256 at every later gate. A path
      // derived only from the pack id let a re-run overwrite them in place
      // (uploadBuffer is x-upsert) — measured on pack cb56ce60: logo:0 recorded
      // 278,860 bytes / 666d6621…, actually served 205,948 bytes / 0dcb8c5c….
      // The guard was right; the storage key was the defect. With the hash in
      // the key a re-run that produces identical bytes lands on the same object
      // (harmless), and different bytes land on a NEW object — an earlier
      // pack's evidence can never be mutated again.
      const ovSha16 = createHash("sha256").update(ovPng).digest("hex").slice(0, 16);
      const ovPath = `graphics-pack/${userId}/${folder}/${sideSlug}_overlay${oi + 1}_${safeLabel}_${ovSha16}.png`;
      await uploadBuffer(ovPath, ovPng, "image/png");

      let cutUrl = null;
      if (isCut) {
        const cutPng = await sharp(cut, { raw: { width: bx.w, height: bx.h, channels: 4 } }).png().toBuffer();
        const cutSha16 = createHash("sha256").update(cutPng).digest("hex").slice(0, 16);
        const cutPath = `graphics-pack/${userId}/${folder}/${sideSlug}_cut${oi + 1}_${safeLabel}_${cutSha16}.png`;
        await uploadBuffer(cutPath, cutPng, "image/png");
        cutUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${cutPath}`;
        console.log(
          `[WORKER] lift-overlays ${side}: cut "${bx.label}" ` +
          `(transparent ${(clearPct * 100).toFixed(1)}%, partial ${(partialPct * 100).toFixed(1)}%, opaque ${(solidPct * 100).toFixed(1)}%)`,
        );
      } else {
        console.log(
          `[WORKER] lift-overlays ${side}: no cut file for "${bx.label}" — not cut to shape ` +
          `(transparent ${(clearPct * 100).toFixed(1)}% / min ${CUT_MIN_CLEAR * 100}%, ` +
          `partial ${(partialPct * 100).toFixed(1)}% / max ${CUT_MAX_PARTIAL * 100}%, ` +
          `opaque ${(solidPct * 100).toFixed(1)}% / min ${CUT_MIN_SOLID * 100}%). Overlay still emitted.`,
        );
      }

      overlays.push({
        url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${ovPath}`,
        // Plotter-ready hard-keyed contour, or null for an honest gap. The Logo
        // Pack must consume THIS, never `url` (which is the soft rebuild matte).
        cut_url: cutUrl,
        cut_quality: {
          transparentPct: Math.round(clearPct * 1000) / 10,
          partialPct: Math.round(partialPct * 1000) / 10,
          opaquePct: Math.round(solidPct * 1000) / 10,
          isCut,
        },
        element_label: bx.label,
        element_type: "branding",
        side,
        // composite-layers box format: [x, y, w, h] normalized 0..1
        box: [bx.x / W, bx.y / H, bx.w / W, bx.h / H],
      });
    }

    // [5] ROUND-TRIP ASSERT — clean + overlays must rebuild the branded panel.
    let rtSum = 0, rtN = 0;
    for (const bx of boxes) {
      for (let y = bx.y; y < bx.y + bx.h; y += 3) {
        for (let x = bx.x; x < bx.x + bx.w; x += 3) {
          const i = (y * W + x) * 4;
          const d = Math.max(
            Math.abs(brandedRaw[i] - cleanRaw[i]),
            Math.abs(brandedRaw[i + 1] - cleanRaw[i + 1]),
            Math.abs(brandedRaw[i + 2] - cleanRaw[i + 2]),
          );
          const a = Math.min(255, d * 4) / 255;
          // over-composite: overlay(branded px, alpha a) over clean → error vs branded
          for (let c = 0; c < 3; c++) {
            const rebuilt = brandedRaw[i + c] * a + cleanRaw[i + c] * (1 - a);
            rtSum += Math.abs(rebuilt - brandedRaw[i + c]);
          }
          rtN++;
        }
      }
    }
    const roundTripDiff = rtN ? rtSum / (rtN * 3) : 0;
    const ROUNDTRIP_MAX = 6; // mean |diff| per channel across lifted regions
    if (roundTripDiff > ROUNDTRIP_MAX) {
      return res.json({ success: false, error: `round-trip failed (diff ${roundTripDiff.toFixed(1)} > ${ROUNDTRIP_MAX}) — overlays would not rebuild the approved panel`, stage: "round-trip", qc: { outsideDiff, roundTripDiff } });
    }

    const cleanPng = await sharp(cleanRaw, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
    // Content-addressed like the overlays above: the clean panel is pinned pack
    // evidence too, and `_clean.png` at a pack-derived folder was equally
    // overwritable in place by a later run.
    const cleanSha16 = createHash("sha256").update(cleanPng).digest("hex").slice(0, 16);
    const cleanPath = `graphics-pack/${userId}/${folder}/${sideSlug}_clean_${cleanSha16}.png`;
    await uploadBuffer(cleanPath, cleanPng, "image/png");

    console.log(`[WORKER] ✓ lift-overlays ${side}: ${overlays.length} layer(s), ringDiff max ${ringDiffMax.toFixed(1)}, roundTrip ${roundTripDiff.toFixed(1)}`);
    return res.json({
      success: true,
      cleanUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${cleanPath}`,
      overlays,
      qc: {
        // Retained and honest: outside every lifted box the clean panel is the
        // branded panel byte for byte, so this is 0 by construction rather than
        // a measurement that happened to pass.
        outsideDiff,
        ringDiffMax: Math.round(ringDiffMax * 10) / 10,
        ringDiffs,
        roundTripDiff: Math.round(roundTripDiff * 10) / 10,
        pass: true,
      },
    });
  } catch (e) {
    console.error(`[WORKER] lift-overlays ${side} failed:`, e.message);
    return res.status(500).json({ success: false, error: `lift-overlays failed: ${e.message}` });
  }
});

// ── Auth middleware ──────────────────────────────────────────
function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${WORKER_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ── Durable DesignPro Production Pack workflow claimant ─────
// This module claims bounded workflow_stage_runs with leases and fencing. The
// existing HTTP handlers above remain the protected rendering/tool adapters.
try {
  const { registerDesignProWorkflow } = require("./designpro-workflow.cjs");
  registerDesignProWorkflow({
    app,
    supabase,
    supabaseUrl: SUPABASE_URL,
    serviceKey: SUPABASE_SERVICE_KEY,
    workerSecret: WORKER_SECRET,
    siteUrl: process.env.PUBLIC_SITE_URL || "https://www.restyleproai.com",
  });
} catch (err) {
  console.error("[DESIGNPRO-WORKFLOW] claimant failed to register:", err.message);
  // A healthy HTTP process without its durable claimant is a false-positive
  // deployment: jobs would remain queued forever while health checks pass.
  throw err;
}

// ── Durable DesignPro revision / Entice Pack claimant ───────
// The paid Production Pack claimant above promotes an already verified pack.
// This claimant owns the revision-triggered proof, panel, and logo build that
// creates that immutable pack. Both use the shared workflow-stage kernel.
try {
  const {
    registerDesignProEnticeWorkflow,
  } = require("./designpro-entice-workflow.cjs");
  registerDesignProEnticeWorkflow({
    app,
    supabase,
    supabaseUrl: SUPABASE_URL,
    serviceKey: SUPABASE_SERVICE_KEY,
    workerSecret: WORKER_SECRET,
    siteUrl: process.env.PUBLIC_SITE_URL || "https://www.restyleproai.com",
  });
} catch (err) {
  console.error(
    "[DESIGNPRO-ENTICE] claimant failed to register:",
    err.message,
  );
  throw err;
}

// ── Start ───────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[WORKER] GENIE Production Worker listening on port ${PORT}`);
  console.log(`[WORKER] Print spec: ${PRINT_DPI} DPI @ ${OUTPUT_SCALE * 100}% scale (${PPI} PPI)`);
  console.log(`[WORKER] Bleed: ${BLEED_INCHES}" (${BLEED_PX}px)`);
  console.log(`[WORKER] Replicate: ${replicate ? "connected" : "not configured"}`);
  console.log(`[WORKER] Vectorizer.AI: ${VECTORIZER_API_ID ? "connected" : "not configured"}`);
});

// ── Deterministic flat→panel queue poller (UniversalPanelizer) ──────────
// Runs in-process alongside the GENIE HTTP worker above. Polls
// production_panels for status='queued', Sharp-crops each panel zone from the
// flat master, and routes it to ProductionFlow QC (qc_pending). Additive — a
// failure here never takes down the HTTP server / health check.
if (DESIGNPRO_PANEL_POLLER_ENABLED) {
  try {
    const { startPolling } = require("./panelWorker.cjs");
    startPolling();
  } catch (err) {
    console.error("[WORKER] panel queue poller failed to start:", err.message);
  }
} else {
  console.log(
    "[WORKER] legacy production_panels poller disabled; durable DesignPro claimants remain active",
  );
}