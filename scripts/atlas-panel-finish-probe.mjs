#!/usr/bin/env node
/**
 * A.T.L.A.S. PER-SURFACE FINISHING PROBE — does the pass actually close a hole?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Controlled experiment, one variable, no production path touched.
 *
 * WHY THIS EXISTS. Per-surface panel finishing was built, tested, merged and
 * deployed today, and it has never drawn a pixel. It cannot: the blocking
 * cutout gate refuses a holed master at flat-first-atlas.cjs:2813, and panels
 * are not cut until :3125 — so on exactly the failure it was built for, the
 * pass is never reached. Canary 34258505325 refused five candidates for five,
 * with the driver flank at largestCutoutComponentRatio 0.14413.
 *
 * Moving the gate would be "healing", which the 2026-09-06 six-surface
 * restoration forbids and RULE 0.32 names directly ("do NOT add another repair
 * heuristic"). So the question is not whether to move it — it is whether the
 * finishing pass works at all, which is a measurement, and RULE 0.32 asks for
 * exactly that: *"until the conditioning root cause is identified by controlled
 * experiment."*
 *
 * WHAT IT DOES. Takes a REFUSED raw candidate that is already in storage —
 * bytes Gemini actually returned, holes and all — crops one surface from it
 * with the same code production uses, and runs that crop through the deployed
 * `atlas-panel` finishing mode. Then it measures.
 *
 * FOUR QUESTIONS, ALL OF THEM CURRENTLY UNANSWERED:
 *
 *   1. Does the pass CLOSE the hole, or redraw it?  holeRatio before → after
 *   2. Does the return keep the input's PROPORTION? The edge deliberately asks
 *      for no aspect ratio, on the assumption an edit follows its input. A
 *      driver flank is ~4.2:1 and the model's aspect menu stops at 21:9, so if
 *      that assumption is wrong every flank is unusable. Never verified against
 *      the real API.
 *   3. Are THOUGHT SIGNATURES accepted? `priorTurnsApplied` non-zero on the
 *      second surface is the only proof; the shape has been wrong once already.
 *   4. Does the LETTERING survive? Reported as artifacts for human eyes — no
 *      automated check substitutes for looking.
 *
 * WHAT IT DOES NOT DO: no write to any production table, no revision, no
 * generation row, no gate change, no threshold change. It reads one existing
 * object and makes at most two model calls.
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

// Dependencies live in runtime/node_modules (symlinked to the image's /app
// /node_modules), not beside this script — the same resolution the existing
// harness scripts use, e.g. scripts/atlas-measure-master.mjs:29.
const require = createRequire(path.join(process.cwd(), "runtime/"));
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const {
  buildAtlasManifest,
  normalizeAtlasMaster,
} = require("../runtime/flat-first-atlas.cjs");
// The SAME resolver + surface projection the worker uses at
// generation-worker.cjs:944/968, so the probe crops the rectangles production
// would have cut rather than a geometry of its own.
const {
  resolveFlatAtlasPreviewDimensions,
  expectedSurfacesFromRow,
} = require("../runtime/genie-universal-resolver.cjs");
const {
  finishPanel,
  PANEL_CASCADE_ORDER,
  PANEL_NEIGHBOURS,
  SURFACE_LABELS,
  PANEL_AUTHORING_PROMPT_VERSION,
  _test: { holeRatio },
} = require("../runtime/atlas-panel-authoring.cjs");

const BUCKET = "wrap-files";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

async function main() {
  const outDir = arg("out", "./panel-finish-evidence");
  const candidatePath = arg("candidate");
  const surfaces = String(arg("surfaces", "driver,passenger")).split(",").map((s) => s.trim()).filter(Boolean);
  if (!candidatePath) throw new Error("--candidate <atlas-call1/<uuid>.png> is required");
  mkdirSync(outDir, { recursive: true });

  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!supabaseUrl || serviceKey.length < 32) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── the refused candidate, exactly as Gemini returned it ──────────────────
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(candidatePath);
  if (error || !blob) throw new Error(`could not read ${candidatePath}: ${error?.message || "missing"}`);
  const rawBytes = Buffer.from(await blob.arrayBuffer());

  // ── the same geometry production would have used ──────────────────────────
  const input = {
    vehicle: {
      type: arg("type", "van"),
      year: arg("year", "2022"),
      make: arg("make", "Ford"),
      model: arg("model", "Transit"),
    },
  };
  // buildAtlasManifest is positional — (surfaces, geometryAuthority, vehicleType)
  // — and takes RESOLVED GENIE surfaces, not a request. Mirrors the worker.
  const dimensionRow = await resolveFlatAtlasPreviewDimensions(supabase, input.vehicle, null);
  const manifest = buildAtlasManifest(
    expectedSurfacesFromRow(dimensionRow),
    dimensionRow.proofGeometryAuthority,
    dimensionRow.resolvedVehicleClass || input.vehicle.type,
  );
  const normalized = await normalizeAtlasMaster(rawBytes, manifest);
  const masterBytes = normalized.bytes;

  // ── crop each surface with the SAME rect/rotation cutCallOnePanels uses ───
  const cropOf = async (surfaceKey) => {
    const zone = manifest.zones.find((z) => z.surfaceKey === surfaceKey);
    if (!zone?.extraction) throw new Error(`no zone for ${surfaceKey}`);
    const bytes = await sharp(masterBytes, { limitInputPixels: false })
      .extract({
        left: Number(zone.extraction.x),
        top: Number(zone.extraction.y),
        width: Number(zone.extraction.w),
        height: Number(zone.extraction.h),
      })
      .rotate(Number(zone.extraction.outputRotationDegrees || 0))
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .toColourspace("srgb")
      .png()
      .toBuffer();
    const meta = await sharp(bytes).metadata();
    return {
      surfaceKey,
      bytes,
      contentHash: sha256(bytes),
      pixelWidth: Number(meta.width),
      pixelHeight: Number(meta.height),
    };
  };

  // ── the deployed atlas-panel transport, verbatim in shape ─────────────────
  const callEdge = async (body) => {
    const res = await fetch(`${supabaseUrl}/functions/v1/design-panel-ai-generate`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    let payload = null;
    try { payload = await res.json(); } catch { payload = null; }
    if (!res.ok || payload?.success !== true) {
      throw new Error(`atlas-panel HTTP ${res.status}: ${String(payload?.error || "no body").slice(0, 300)}`);
    }
    const { data, error: dlErr } = await supabase.storage.from(BUCKET).download(payload.panelStoragePath);
    if (dlErr || !data) throw new Error(`could not read returned panel: ${dlErr?.message || "missing"}`);
    const bytes = Buffer.from(await data.arrayBuffer());
    if (sha256(bytes) !== payload.panelSha256) throw new Error("returned panel hash mismatch");
    lastPayload = payload;
    return {
      bytes,
      modelTurn: payload.modelTurn || null,
      thoughtSignatureCount: payload.thoughtSignatureCount || 0,
      panelByteSize: Number(payload.panelBytes || 0),
    };
  };

  // A tiny store shim: staging inputs is a real write to the inputs prefix,
  // which is content-addressed and immutable, so it is safe and idempotent.
  const store = {
    putImmutableBytes: async ({ storagePath, bytes, contentType }) => {
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(storagePath, bytes, { contentType, upsert: false });
      // A content-addressed path that already exists holds identical bytes.
      if (upErr && !/exists/i.test(String(upErr.message))) throw upErr;
    },
  };

  let lastPayload = null;
  const results = [];
  const finished = [];
  let chain = [];

  for (const surfaceKey of PANEL_CASCADE_ORDER) {
    if (!surfaces.includes(surfaceKey)) continue;
    const crop = await cropOf(surfaceKey);
    const before = await holeRatio(crop.bytes);
    writeFileSync(path.join(outDir, `${surfaceKey}-before.png`), crop.bytes);

    const wanted = PANEL_NEIGHBOURS[surfaceKey] || [];
    const byKey = new Map(finished.map((f) => [f.surfaceKey, f]));
    const inConversation = new Set(chain.map((e) => e.surfaceKey));
    const neighbours = wanted
      .filter((k) => !inConversation.has(k))
      .map((k) => byKey.get(k))
      .filter(Boolean);

    const startedAt = Date.now();
    let outcome;
    try {
      outcome = await finishPanel(crop, {
        neighbours,
        atlasReferenceBytes: masterBytes,
        priorExchanges: chain,
        creativeContext: "",
        store,
        callEdge,
        logger: (m) => console.log(`  ${m}`),
      });
    } catch (cause) {
      outcome = { applied: false, reason: `threw:${String(cause?.message || cause).slice(0, 200)}` };
    }
    const elapsedMs = Date.now() - startedAt;

    if (outcome.applied) {
      writeFileSync(path.join(outDir, `${surfaceKey}-after.png`), outcome.bytes);
      finished.push({ surfaceKey, bytes: outcome.bytes });
      if (Array.isArray(outcome.nextExchanges)) chain = outcome.nextExchanges;
    }

    const afterMeta = outcome.applied ? await sharp(outcome.bytes).metadata() : null;
    const row = {
      surfaceKey,
      applied: outcome.applied === true,
      reason: outcome.reason || null,
      elapsedMs,
      cropPixels: `${crop.pixelWidth}x${crop.pixelHeight}`,
      cropAspect: Number((crop.pixelWidth / crop.pixelHeight).toFixed(3)),
      // Q1 — does it close the hole?
      holeRatioBefore: Number(before.toFixed(5)),
      holeRatioAfter: outcome.applied ? Number(outcome.holeRatioAfter.toFixed(5)) : null,
      // Q2 — did the return keep the input's proportion?
      returnedPixels: afterMeta ? `${afterMeta.width}x${afterMeta.height}` : null,
      // Q3 — were the thought signatures accepted?
      priorTurnsApplied: outcome.priorTurnsApplied ?? null,
      thoughtSignatureCount: outcome.thoughtSignatureCount ?? null,
      atlasReferenceApplied: outcome.atlasReferenceApplied ?? null,
      neighboursShown: neighbours.map((n) => n.surfaceKey),
      edgePromptVersion: lastPayload?.promptVersion || null,
      modelInputImageCount: lastPayload?.modelInputImageCount ?? null,
    };
    results.push(row);
    console.log(JSON.stringify(row));
  }

  const evidence = {
    contract: "designpro.atlas-panel-finish-probe.v1",
    ranAt: new Date().toISOString(),
    runtimePromptVersion: PANEL_AUTHORING_PROMPT_VERSION,
    candidate: { storagePath: candidatePath, sha256: sha256(rawBytes), byteSize: rawBytes.length },
    vehicle: input.vehicle,
    surfaces: results,
    // The four questions, answered plainly rather than left to a reader.
    verdict: {
      closesHoles: results.filter((r) => r.applied).every((r) => r.holeRatioAfter < r.holeRatioBefore)
        && results.some((r) => r.applied),
      keepsProportion: results.filter((r) => r.applied).every((r) => r.returnedPixels === r.cropPixels),
      thoughtSignaturesAccepted: results.some((r) => (r.priorTurnsApplied || 0) > 0),
      appliedCount: results.filter((r) => r.applied).length,
      attemptedCount: results.length,
    },
  };
  writeFileSync(path.join(outDir, "panel-finish-evidence.json"), JSON.stringify(evidence, null, 2));
  console.log("\n=== VERDICT ===");
  console.log(JSON.stringify(evidence.verdict, null, 2));
}

main().catch((err) => {
  console.error(`PROBE FAILED: ${err?.stack || err}`);
  process.exit(1);
});
