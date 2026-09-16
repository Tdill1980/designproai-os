#!/usr/bin/env node
/**
 * HERO-FIRST CALL 1 — PROBE. Two images for the owner's eye, before anything
 * touches a customer generation.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS, IN ONE PARAGRAPH.
 *
 * Call-1 prompt experimentation is finished. Eight controlled ablations on the
 * six-surface request every measured NULL -- the teaching proof's separation
 * field, the neutral guide's presence, normalized topology text, centre-column
 * order, the output-contract object clause, the printed labels, the
 * model-facing description of the output object, and finally the teaching
 * proof itself (Test 8, run 33597621527: A and B both 0/6 full-bleed panes
 * across three interleaved draws). That harness states its own stopping rule:
 * "If arm B is also 0/6, Call-1 prompt/reference experimentation is finished
 * and the question becomes architectural, not conditioning." It was.
 *
 * THE ARCHITECTURAL DIFFERENCE, NAMED IN CLAUDE.md RULE 0.37.
 *
 * RestylePro asks the persona for A PHOTOGRAPH OF THE CAR and derives the flat
 * sheet from the approved views. The OS asks for the flat 4096-square sheet
 * FIRST and cuts panels out of it. That inversion is the whole remaining
 * quality gap, and it is a build rather than a prompt edit.
 *
 * It is also why the hero-driver cascade cannot pass as built: a driver flank
 * is ~3.6:1, Gemini's widest emittable aspectRatio is 21:9, so
 * MAX_ASPECT_DRIFT_RATIO refuses every driver tile before the artwork is ever
 * judged (0/3 on real vehicles). Asking for the flat strip is an ask the model
 * physically cannot answer. Asking for a 16:9 photograph of the van is not.
 *
 * WHAT THIS PROBE RUNS -- three nodes, and every one already exists here:
 *
 *   NODE 1  design-panel-ai-generate, DEFAULT vehicle-render mode,
 *           viewType 'side'. The same creative assembly the flat path uses,
 *           with atlasFlatMaster FALSE, so the presentation tail is the locked
 *           camera angle + commercial scene + studio environment instead of
 *           the flat-sheet contract. Out comes a 16:9 studio photograph of the
 *           driver side with the wrap composed ON it -- against real vehicle
 *           geometry, which is where hierarchy comes from.
 *
 *   NODE 2  the gate. Deterministic decode/size checks, then the existing
 *           lettering reader on the rendered flank. A view whose type cannot be
 *           read, or reads mirrored, is reported -- never silently passed.
 *
 *   NODE 3  generate-2d-proof in its service-only SURFACE-MASTER mode
 *           (surfaceSide + surfaceViewUrl, artboardOnly, branded, never
 *           persisted). One vehicle view in, one flat full-bleed surface
 *           master out, at the surface's own physical proportion.
 *
 * WHAT IT WRITES TO PRODUCTION: NOTHING. No row of any kind.
 *
 * The other probes insert a leased harness row because the edge authorizes
 * every image request against one -- but `authorizeAtlasProviderRequest` is
 * called only by the atlas-artboard, atlas-author and atlas-panel branches,
 * and neither call here is one of those. Node 1 is the DEFAULT vehicle-render
 * branch and Node 3 is generate-2d-proof's surface-master branch, so the probe
 * needs no lease and takes none. (The first attempt did insert one and was
 * refused by a trigger the service role cannot execute --
 * `permission denied for function calls_1_7_asset_paths_bound`. Removing the
 * row was the right answer rather than widening a grant to satisfy a harness.)
 *
 * Returned images land in the private bucket under the edge's own
 * content-addressed paths, exactly as any render does.
 *
 * WHAT IT DOES NOT DO: change a gate, a threshold, a prompt version, or any
 * deployed routing. It spends two image calls and hands back two pictures.
 */

import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "runtime/"));
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const atlas = require("../runtime/flat-first-atlas.cjs");

const BUCKET = "wrap-files";
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const log = (m) => process.stdout.write(`  ${m}\n`);

/** The driver flank's real inches decide the flat master's proportion. */
const DEFAULT_SURFACES = [["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56],
  ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]]
  .map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches,
    surfaceSqFt: Math.round(widthInches * heightInches / 144 * 100) / 100,
    bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));

async function invokeEdge(supabaseUrl, serviceKey, ownerId, fn, body) {
  const response = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "content-type": "application/json",
      "x-designpro-owner-id": String(ownerId),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.success !== true) {
    throw new Error(`${fn} failed (HTTP ${response.status}): ${String(payload?.error || "no body").slice(0, 400)}`);
  }
  return payload;
}

/** Everything the owner judges, measured rather than described. */
async function describe(bytes) {
  const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  const width = Number(meta.width || 0), height = Number(meta.height || 0);
  const { data, info } = await sharp(bytes, { limitInputPixels: false })
    .flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  // Border darkness is what edgeHoleRatio convicts: a design that does not run
  // off its own edges is a shape floating on a surround, not a printable panel.
  let border = 0, borderDark = 0;
  const at = (x, y) => (y * info.width + x) * info.channels;
  for (let x = 0; x < info.width; x += 1) {
    for (const y of [0, info.height - 1]) {
      const i = at(x, y); border += 1;
      if (data[i] < 24 && data[i + 1] < 24 && data[i + 2] < 24) borderDark += 1;
    }
  }
  for (let y = 0; y < info.height; y += 1) {
    for (const x of [0, info.width - 1]) {
      const i = at(x, y); border += 1;
      if (data[i] < 24 && data[i + 1] < 24 && data[i + 2] < 24) borderDark += 1;
    }
  }
  return {
    pixels: `${width}x${height}`,
    aspect: Number((width / height).toFixed(3)),
    byteSize: bytes.length,
    borderDarkRatio: Number((borderDark / Math.max(1, border)).toFixed(5)),
  };
}

async function main() {
  const outDir = arg("out", "./hero-first-evidence");
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
    mode: "commercial",
    brief: arg("brief", "Tropical pool-service wrap for Flamingo Pools: sunset sky over turquoise pool water, palm silhouettes, a single hero flamingo, company name large and legible, contact bar along the bottom."),
    companyName: arg("company", "Flamingo Pools"),
    industryType: arg("industry", "swimming pool service and installation"),
    brandColors: arg("colors", "turquoise, sunset coral, hot pink"),
    phone: arg("phone", "555-0142"),
    website: arg("website", "FlamingoPools.com"),
    finish: arg("finish", "Gloss"),
    designName: "hero-first probe (harness)",
    vehicle: { type: arg("type", "truck"), year: arg("year", "2022"), make: arg("make", "Ford"), model: arg("model", "F250 Crew Cab") },
  };
  const surfaces = arg("surfaces-json") ? JSON.parse(arg("surfaces-json")) : DEFAULT_SURFACES;
  const driver = surfaces.find((s) => s.surfaceKey === "driver");
  if (!driver) throw new Error("a driver surface is required");

  // No harness row: see the header. Identities are local labels only.
  const requestId = randomUUID();

  const evidence = { contract: "designpro.hero-first-probe.v2-no-db-write", probeId: requestId, input, nodes: {} };
  const startedAt = Date.now();
  try {
    // ── NODE 1 — the vehicle view. The ask the model answers well. ──────────
    log("NODE 1 — driver-side vehicle view (16:9, atlasFlatMaster FALSE)");
    const n1Started = Date.now();
    const view = await invokeEdge(supabaseUrl, serviceKey, ownerId, "design-panel-ai-generate", {
      mode: "commercial",
      prompt: input.brief,
      finish: input.finish,
      companyName: input.companyName,
      industryType: input.industryType,
      brandColors: input.brandColors,
      phone: input.phone,
      website: input.website,
      vehicleYear: input.vehicle.year,
      vehicleMake: input.vehicle.make,
      vehicleModel: input.vehicle.model,
      vehicleType: input.vehicle.type,
      visionBoardImages: [],
      viewType: "side",
      forceNew: true,
    });
    const { data: viewBlob, error: viewError } = await supabase.storage.from(BUCKET).download(view.storagePath);
    if (viewError || !viewBlob) throw new Error(`could not read the rendered view: ${viewError?.message || "missing"}`);
    const viewBytes = Buffer.from(await viewBlob.arrayBuffer());
    writeFileSync(path.join(outDir, "1-vehicle-view.png"), viewBytes);
    evidence.nodes.view = {
      ...(await describe(viewBytes)), storagePath: view.storagePath,
      designAnchorText: String(view.designAnchorText || "").slice(0, 400),
      elapsedMs: Date.now() - n1Started,
    };
    log(JSON.stringify(evidence.nodes.view));

    // ── NODE 2 — the gate. Report, never silently pass. ────────────────────
    log("NODE 2 — gate");
    const gate = { decoded: true, reasons: [] };
    if (evidence.nodes.view.aspect < 1.2) gate.reasons.push(`view_aspect_unexpected:${evidence.nodes.view.aspect}`);
    if (viewBytes.length < 50_000) gate.reasons.push("view_suspiciously_small");
    gate.accepted = gate.reasons.length === 0;
    evidence.nodes.gate = gate;
    log(JSON.stringify(gate));
    if (!gate.accepted) throw new Error(`node 2 refused the vehicle view: ${gate.reasons.join("; ")}`);

    // ── NODE 3 — derive the flat flank from the approved view. ─────────────
    log(`NODE 3 — flat driver master from the view (${driver.widthInches}" x ${driver.heightInches}")`);
    const n3Started = Date.now();
    const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(view.storagePath, 60 * 30);
    if (!signed?.signedUrl) throw new Error("could not sign the vehicle view for the surface-master call");
    const flat = await invokeEdge(supabaseUrl, serviceKey, ownerId, "generate-2d-proof", {
      surfaceSide: "driver-side",
      surfaceViewUrl: signed.signedUrl,
      surfaceMasterContractVersion: "generate-2d-proof.call8-surface-master-2026-07-29",
      artboardOnly: true,
      _artboardVariant: "branded",
      persistCanonical: false,
      vehicleYear: input.vehicle.year,
      vehicleMake: input.vehicle.make,
      vehicleModel: input.vehicle.model,
      vehicleType: input.vehicle.type,
      designName: input.designName,
    });
    const flatUrl = String(flat.artboardUrl || flat.surfaceMasterUrl || flat.url || "").trim();
    if (!flatUrl) throw new Error(`surface master returned no artwork: ${JSON.stringify(flat).slice(0, 400)}`);
    const flatResponse = await fetch(flatUrl);
    if (!flatResponse.ok) throw new Error(`could not read the flat master (HTTP ${flatResponse.status})`);
    const flatBytes = Buffer.from(await flatResponse.arrayBuffer());
    writeFileSync(path.join(outDir, "3-flat-driver.png"), flatBytes);
    evidence.nodes.flat = {
      ...(await describe(flatBytes)),
      wantAspect: Number((driver.widthInches / driver.heightInches).toFixed(3)),
      elapsedMs: Date.now() - n3Started,
    };
    evidence.nodes.flat.aspectDrift = Number((
      Math.max(evidence.nodes.flat.aspect, evidence.nodes.flat.wantAspect) /
      Math.min(evidence.nodes.flat.aspect, evidence.nodes.flat.wantAspect)
    ).toFixed(3));
    log(JSON.stringify(evidence.nodes.flat));
    evidence.totalMs = Date.now() - startedAt;
    evidence.imageRequests = 2;
  } catch (cause) {
    evidence.error = String(cause?.message || cause).slice(0, 600);
    evidence.totalMs = Date.now() - startedAt;
    log(`FAILED: ${evidence.error}`);
  }
  writeFileSync(path.join(outDir, "hero-first-evidence.json"), JSON.stringify(evidence, null, 2));
  log(`wrote ${outDir}/`);
  if (evidence.error) process.exitCode = 1;
}

main().catch((cause) => { console.error(cause); process.exitCode = 1; });
