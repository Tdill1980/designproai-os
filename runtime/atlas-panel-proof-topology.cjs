"use strict";
/**
 * runtime/atlas-panel-proof-topology.cjs — CALL 1 AS THE PANEL PRODUCTION
 * PROOF, ON THE LIVE CUSTOMER ROUTE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-19: "real customer traffic is trapped on the legacy v28
 * artboard while production-panel-proof only runs via test probes ... wire
 * `production-panel-proof` directly into the live customer production route as
 * the active Call 1 engine (no more probe-only execution)."
 *
 * She is right that a component nothing routes to is not shipped. This is the
 * seam that routes it, and it is deliberately the SAME seam hero-driver uses:
 * an authoring function that returns `{bytes, contentHash, model, provenance}`
 * and throws a typed refusal. Nothing downstream changes by a single byte.
 *
 * ═══ WHY THE SHEET BECOMES A 4096² MASTER RATHER THAN REPLACING IT ═══
 *
 * The proof sheet is a 3:2 DOCUMENT. Everything after Call 1 — the master
 * gates, `cutCallOnePanels`, the seven proof authorities, Call 8's geometry,
 * Call 9's promotion, the revision row, both UIs — reads a square six-zone
 * A.T.L.A.S. master addressed by `manifest.zones`. Handing that chain a
 * document would not be "wiring the new system in"; it would be rewriting
 * twelve proven stages to accept a second shape, which is exactly the
 * greenfield move RULE 0 forbids.
 *
 * So the DAG ends by ASSEMBLING: the six Zone-1 panels are placed into the
 * GENIE manifest zones by `assembleFinishedMaster` — the same assembler the
 * hero cascade uses for the same reason — and what leaves this file is an
 * ordinary accepted master. The gates then judge it exactly as they judge any
 * other, which is the point: the new engine earns its acceptance through the
 * existing gates rather than around them.
 *
 * ═══ THE DAG ═══
 *
 *   proof.sheet ──▶ panel.cut ──▶ master.assemble
 *        │              │               │
 *   ONE image call   17 artifacts   the 4096² master
 *   (three zones)    zero AI        (zone 1 placed)
 *
 * and then NOTHING NEW. An assembled master is where this file stops. The
 * orchestration that takes it from there was already engineered and is not
 * touched: `cutCallOnePanels` cuts the six print panels, each release calls
 * `launchAtlasProof` (generation-worker.cjs), that reaches the pinned
 * `persona-photographer-render` in `mode: "atlas-proof"` for all seven views,
 * and the stage chain carries it through `await_panelpro_preflight_qc` ->
 * `enhance.upscale` -> `output.build` -> ZIP -> WrapBox.
 *
 * ⚠️ AN EARLIER DRAFT OF THIS WORK WROTE A SECOND CALL-2 CALLER
 * (`runtime/atlas-proof-3d.cjs`) BESIDE `launchAtlasProof`, and nothing ever
 * required it — the owner spotted it: "we had the graph engineered
 * orchestration for the 3d proofs and the QC - wrapbox checks." She was right.
 * It is deleted. RULE 0.29 says feed the deployed photographer, and the worker
 * already did; RULE 1 says recover before you invent. A duplicate caller that
 * nothing routes to still costs the next reader an hour deciding which one is
 * real. Do not add another one here.
 *
 * ZONE 2 AND ZONE 3 ARE NOT DISCARDED. The clean panels and the cut graphics
 * ride on the provenance as content-addressed siblings, which is what the
 * owner's three-quadrant contract is for: the blank panels go to PanelPro for
 * template QC, and the cut graphics are the Logo Pack.
 *
 * ═══ IT FAILS OVER, LIKE EVERY OTHER ROUTING ═══
 *
 * RULE 0.38: "every Call-1 routing gets a second contract", written after
 * field-first routing left a refused request with nothing because its
 * fail-over was one-directional. A refusal here throws `PanelProofRefusal` and
 * flat-first-atlas falls back to six-surface with the reason recorded. Turning
 * this on can therefore cost latency on a bad run; it cannot cost a design.
 *
 * KILL SWITCH: `DESIGNPRO_ATLAS_PANEL_PROOF=off`. Threaded through the runtime
 * reader, `configure-env.sh`, `validate-env.py` and the deploy-workflow lock —
 * because this file's own history says a flag the runtime reads and the writer
 * does not write is not a switch, and that mistake has been made twice.
 */

const PANEL_PROOF_TOPOLOGY = "panel-proof";
const PANEL_PROOF_TOPOLOGY_CONTRACT = "designpro.atlas-panel-proof-topology.v1";
/** Its OWN Call-1 endpoint. It cannot reach design-panel-ai-generate at all. */
const PROOF_EDGE_FUNCTION = "production-panel-proof";

const { cutProofPanels } = require("./atlas-proof-panels.cjs");
const {
  parsePanelRows, renderContainerTemplate,
} = require("./atlas-proof-container-template.cjs");
const { zonePixelSize } = require("./atlas-hero-driver.cjs");
const { createHash } = require("node:crypto");

const BUCKET = "wrap-files";
/** The A.T.L.A.S. master canvas. Not negotiable here: twelve stages read it. */
const CANVAS_PX = 4096;
/**
 * The edge's own allowlist, mirrored here so a path it would refuse cannot
 * leave this runtime. This is the 2099d17d lesson, applied before it costs a
 * live run: `attach()` admits a Call-1 input ONLY from this shape, and node 1
 * of the hero-first graph spent a whole generation discovering that by being
 * refused.
 */
const CALL1_INPUT_PATH = /^atlas-call1-inputs\/[0-9a-f]{64}\.png$/;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A creative refusal. Typed so flat-first-atlas can tell it from a fault. */
class PanelProofRefusal extends Error {
  constructor(reason, details = {}) {
    super(`panel proof refused: ${reason}`);
    this.code = "flat_atlas_panel_proof_refused";
    this.reason = reason;
    this.details = details;
  }
}

/**
 * `off` is the ONLY value that disables it, and a typo therefore fails to the
 * SAFE side — which for a routing that is not yet proven on a real customer
 * generation means OFF. That is the opposite default from `atlas_field_first`,
 * deliberately: field-first was adopted on 52 measured failures, and this has
 * four probe sheets. Turning it on is a deploy input, not an omission.
 */
function panelProofEnabled(env = process.env) {
  return String(env.DESIGNPRO_ATLAS_PANEL_PROOF || "").trim().toLowerCase() === "on";
}

/** GENIE trim rows in the contract's own wording. Inches, never fractions. */
function panelRowsFromManifest(manifest) {
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : [];
  return zones.map((zone) => {
    const trim = zone?.trimInches || zone?.trim || {};
    const w = Number(trim.widthIn ?? trim.w);
    const h = Number(trim.heightIn ?? trim.h);
    const name = String(zone?.surfaceKey || "").toUpperCase();
    if (!name || !Number.isFinite(w) || !Number.isFinite(h)) return null;
    return `${name}: ${w}" wide x ${h}" high`;
  }).filter(Boolean);
}

/**
 * NODE 1 — the sheet. ONE image call, through the dedicated edge function.
 *
 * The edge is `production-panel-proof`, which is its own Call-1 endpoint and
 * cannot reach `design-panel-ai-generate` at all — so production's other
 * topologies keep calling the one endpoint they always called (RULE 0.26) no
 * matter what this one returns.
 */
async function requestProofSheet({ manifest, input, providerRequest, callProofEdge }) {
  const panelRows = panelRowsFromManifest(manifest);
  if (panelRows.length !== 6) {
    throw new PanelProofRefusal(`manifest yielded ${panelRows.length}/6 panel rows`);
  }
  const vehicle = input?.vehicle || {};
  const sheet = await callProofEdge({
    // The customer's own words. The edge's intake node parses vehicle, contact
    // and brand out of them; a field set here is a field intake never had to
    // find, and the raw text is what production actually carries.
    customerPrompt: input?.brief || input?.prompt || "",
    companyName: input?.companyName || input?.businessName || "",
    tagline: input?.tagline || "",
    phone: input?.phone || "",
    website: input?.website || "",
    services: input?.services || input?.bulletPoints || [],
    promo: input?.promo || input?.promotionalText || "",
    finish: input?.finish || "Gloss",
    vehicleYear: vehicle.year || null,
    vehicleMake: vehicle.make || null,
    vehicleModel: vehicle.model || null,
    panelRows,
    ...providerRequest,
  });
  if (!sheet?.bytes) throw new PanelProofRefusal("the proof edge returned no sheet");
  return { sheet, panelRows };
}

/**
 * THE BLANK CONTAINER, DRAWN HERE AND STAGED WHERE THE EDGE CAN ATTACH IT.
 *
 * The edge draws its own container first and only falls back to a caller-staged
 * one (`containerSource.origin: "caller"`), so this is INSURANCE, not the
 * primary path — and it is worth having: without it a studio render that throws
 * on the edge answers `panel_proof_container_unavailable` and costs the whole
 * Call 1, where with it the same failure costs nothing and says so on the
 * receipt. The bytes are deterministic and content-addressed, so a second
 * generation on the same vehicle re-uploads nothing.
 *
 * It stages a PNG at `atlas-call1-inputs/<sha256>.png` because that is the one
 * shape the edge admits, and the regex above is checked HERE so a path the far
 * side would refuse never leaves.
 */
async function stageProofContainer({ supabase, manifest, companyName, vehicle, logger = () => {} }) {
  const bytes = await renderContainerTemplate({ manifest, companyName, vehicle, bleedInches: 5 });
  const digest = sha256(bytes);
  const storagePath = `atlas-call1-inputs/${digest}.png`;
  if (!CALL1_INPUT_PATH.test(storagePath)) {
    throw new PanelProofRefusal(`container path the edge would refuse: ${storagePath}`);
  }
  const { data } = await supabase.storage.from(BUCKET).download(storagePath);
  if (!data) {
    const { error } = await supabase.storage.from(BUCKET)
      .upload(storagePath, bytes, { contentType: "image/png", upsert: false });
    if (error && !/exists/i.test(String(error.message || error))) {
      throw new PanelProofRefusal(`container staging failed: ${String(error.message || error).slice(0, 200)}`);
    }
  }
  logger(`atlas call 1: container staged ${digest.slice(0, 12)} (${bytes.length} B)`);
  return { containerStoragePath: storagePath, containerContentHash: digest, containerByteSize: bytes.length };
}

/**
 * The transport, as the pass consumes it: stage the container, one POST to the
 * dedicated edge, then a HASH-VERIFIED download of the sheet it stored.
 *
 * The sheet crosses this boundary as an IDENTITY first — the edge answers
 * `{proofStoragePath, proofSha256, proofByteSize}` and never base64 — which is
 * RULE 0.39, and the download is verified against both halves of that identity
 * for the same reason `downloadVerified` is: a swapped object and a caller whose
 * claim does not match what it wrote are two different failures.
 */
function createPanelProofTransport({
  supabase, ownerId = null, fetchImpl = fetch, logger = () => {},
} = {}) {
  if (!supabase) throw new PanelProofRefusal("the panel-proof transport requires Supabase");
  return async (body) => {
    const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
    const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
    if (!supabaseUrl || serviceRoleKey.length < 32) {
      throw new PanelProofRefusal("SUPABASE_URL / service key are required for the proof edge");
    }
    const staged = await stageProofContainer({
      supabase, manifest: parsePanelRows(body.panelRows),
      companyName: body.companyName || "", logger,
      vehicle: [body.vehicleYear, body.vehicleMake, body.vehicleModel]
        .map((v) => String(v || "").trim()).filter(Boolean).join(" "),
    });
    const response = await fetchImpl(`${supabaseUrl}/functions/v1/${PROOF_EDGE_FUNCTION}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": "application/json",
        "x-designpro-owner-id": String(ownerId || ""),
      },
      body: JSON.stringify({ ...body, ...staged }),
    });
    const payload = await response.json().catch(() => ({ error: "unparseable response" }));
    if (!response.ok || payload?.success !== true) {
      throw new PanelProofRefusal(
        `${PROOF_EDGE_FUNCTION} failed (HTTP ${response.status}): ${String(payload?.error || "no body").slice(0, 300)}`,
        { status: response.status });
    }
    const { data, error } = await supabase.storage.from(BUCKET).download(payload.proofStoragePath);
    if (error || !data) {
      throw new PanelProofRefusal(`the proof sheet could not be read: ${payload.proofStoragePath}`);
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.length !== Number(payload.proofByteSize) || sha256(bytes) !== payload.proofSha256) {
      throw new PanelProofRefusal(`${payload.proofStoragePath} does not match the identity the edge returned`);
    }
    return {
      bytes,
      contentHash: payload.proofSha256,
      storagePath: payload.proofStoragePath,
      byteSize: bytes.length,
      model: payload.model || null,
      contract: payload.contract || null,
      promptChars: Number(payload.promptChars || 0),
      sheetShape: payload.sheetShape || null,
      intake: payload.intake || null,
      containerSource: (payload.attachedInputs || []).find((a) => a?.role === "container") || null,
    };
  };
}

/**
 * The whole pass: sheet → cut → assemble.
 *
 * @returns the same shape `authorHeroDriverMaster` returns, because
 *   flat-first-atlas consumes both through one code path and a second shape
 *   there would be a second contract nobody asked for.
 */
async function authorPanelProofMaster({
  manifest, input, store: _store, logger = () => {},
  providerRequest = {}, callProofEdge,
  assembleFinishedMaster, sharp = require("sharp"),
  startedAt = Date.now(),
} = {}) {
  const stageTimings = [];
  const mark = (stage, at) => stageTimings.push({ stage, ms: Date.now() - at });

  // ── node 1: the sheet ──────────────────────────────────────────────────
  const sheetAt = Date.now();
  const { sheet, panelRows } = await requestProofSheet({
    manifest, input, providerRequest, callProofEdge,
  });
  mark("proof.sheet", sheetAt);
  logger(`atlas call 1: panel proof sheet ${String(sheet.contentHash || "").slice(0, 12)} (${sheet.bytes.length} B)`);

  // ── node 2: the cut. Deterministic, zero model calls. ──────────────────
  const cutAt = Date.now();
  const cut = await cutProofPanels({
    proofBytes: sheet.bytes, manifest: parsePanelRows(panelRows), sharp,
  });
  if (cut.refused) throw new PanelProofRefusal(cut.refused, { sheet: cut.sheet });
  mark("panel.cut", cutAt);

  const zone1 = cut.panels.filter((p) => p.zone === "zone1");
  if (zone1.length !== 6) {
    throw new PanelProofRefusal(`the cut yielded ${zone1.length}/6 branded panels`);
  }
  // A CELL THE MODEL LEFT EMPTY IS A BLANK PRINT PANEL. `fit` is the share of
  // the cell that carries paint; an unfilled box sails through every hole
  // predicate in this repo, because every one of them is a darkness test and
  // white is not dark (the efca5e03 lesson, pointed at the cells).
  const empty = zone1.filter((p) => p.fit < 0.5);
  if (empty.length) {
    throw new PanelProofRefusal(
      `unfilled panel cells: ${empty.map((p) => `${p.surfaceKey}=${p.fit}`).join(", ")}`);
  }

  // ── node 3: the master. The six panels into the GENIE zones. ───────────
  //
  // EACH PANEL IS RESIZED TO ITS ZONE'S EXACT PIXEL SIZE FIRST, and the hash is
  // taken of the resized bytes. `assembleFinishedMaster` checks both — the
  // pixels must fit the original extraction exactly and the bytes must match
  // their recorded hash — and it is right to: those two assertions are what stop
  // a panel landing in the wrong rectangle or a buffer being swapped between
  // the cut and the composite. So this satisfies them rather than loosening
  // them, which is the same thing `assembleHeroMaster` does with `zonePixelSize`.
  const assembleAt = Date.now();
  const byKey = new Map(zone1.map((p) => [p.surfaceKey, p]));
  const canvas = await sharp({
    create: { width: CANVAS_PX, height: CANVAS_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).png().toBuffer();
  const placed = [];
  for (const zone of manifest.zones) {
    const panel = byKey.get(zone.surfaceKey);
    if (!panel) throw new PanelProofRefusal(`${zone.surfaceKey}: no cut panel to assemble`);
    const { pixelWidth, pixelHeight } = zonePixelSize(zone);
    const bytes = await sharp(panel.bytes)
      .resize(pixelWidth, pixelHeight, { fit: "fill" }).png().toBuffer();
    placed.push({
      surfaceKey: zone.surfaceKey,
      finish: { applied: true, bytes, contentHash: sha256(bytes) },
    });
  }
  const assembled = await assembleFinishedMaster(canvas, manifest, placed);
  mark("master.assemble", assembleAt);

  // The other two quadrants, carried as receipts rather than thrown away.
  const sibling = (zone) => cut.panels.filter((p) => p.zone === zone).map((p) => ({
    surfaceKey: p.surfaceKey, role: p.role, byteSize: p.byteSize, fit: p.fit, rect: p.rect,
  }));

  return {
    bytes: assembled.bytes,
    contentHash: assembled.contentHash,
    model: sheet.model || "gemini-3-pro-image",
    promptVersion: sheet.promptVersion || sheet.contract || PANEL_PROOF_TOPOLOGY_CONTRACT,
    imageRequestCount: 1,
    surfaces: zone1.map((p) => ({
      surfaceKey: p.surfaceKey, method: "panel-proof-cut", fit: p.fit,
      widthIn: p.widthIn, heightIn: p.heightIn, byteSize: p.byteSize,
      imageRequestCount: 0, attempts: 1,
    })),
    // NO PANELS ARE RETURNED, DELIBERATELY. An earlier draft handed the six cut
    // Zone-1 panels back "so flat-first-atlas can release them without
    // re-cutting the assembled master", and nothing ever read them: the live
    // path cuts its own six with `cutCallOnePanels` from the assembled master
    // and releases each to `launchAtlasProof`, which is the orchestration that
    // has always driven Call 2 and the QC -> Topaz -> ZIP -> WrapBox chain.
    //
    // Returning a second set alongside it is the second-producer shape RULE 0.21
    // forbids by name, and a field nobody reads is worse than absent: the next
    // reader has to work out which of two panel sets production actually buys.
    provenance: {
      contract: PANEL_PROOF_TOPOLOGY_CONTRACT,
      topology: PANEL_PROOF_TOPOLOGY,
      promptVersion: sheet.promptVersion || null,
      proofContract: sheet.contract || null,
      proofSha256: sheet.contentHash || null,
      proofStoragePath: sheet.storagePath || null,
      imageRequestCount: 1,
      masterSha256: assembled.contentHash,
      masterStoragePath: null,
      sheet: cut.sheet,
      // THE THREE QUADRANTS, NAMED. Zone 1 became the master; these two are
      // the clean base and the Logo Pack, and a reader that cannot see them
      // here would assume the sheet carried only panels.
      quadrants: { branded: sibling("zone1"), clean: sibling("zone2"), cutGraphics: sibling("zone3") },
      stageTimings,
      totalMs: Date.now() - startedAt,
    },
    timings: { panelProofMs: Date.now() - startedAt, stages: stageTimings },
  };
}

module.exports = {
  PANEL_PROOF_TOPOLOGY,
  PANEL_PROOF_TOPOLOGY_CONTRACT,
  PROOF_EDGE_FUNCTION,
  CALL1_INPUT_PATH,
  PanelProofRefusal,
  panelProofEnabled,
  panelRowsFromManifest,
  stageProofContainer,
  createPanelProofTransport,
  authorPanelProofMaster,
};
