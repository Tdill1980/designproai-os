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
 * ZONE 2 AND ZONE 3 ARE STORED, NOT MEASURED AND DROPPED.
 *
 * Owner, 2026-09-19: "Production panel proof is source it has the 3 zones / For
 * panels, panels with seperated and logos and text." All three quadrants are
 * the deliverable, and only Zone 1 was reaching anything.
 *
 * This comment used to claim they "ride on the provenance as content-addressed
 * siblings" and that was FALSE: `sibling()` recorded `surfaceKey, role,
 * byteSize, fit, rect` and no storage path and no content hash, so the pixels
 * were cut, measured and garbage-collected when this function returned. A
 * receipt that names a byte count for bytes nobody can fetch is the
 * claiming-what-was-never-established shape this repo has now recorded five
 * times, and this instance was in a comment asserting the opposite.
 *
 * Each panel of both quadrants is now written through `store.putImmutableBytes`
 * — the seam `store` was already passed here for and ignored, so this is no new
 * door — and crosses the boundary as `{storagePath, contentHash, byteSize}`
 * (RULE 0.39). Content-addressed, so a re-run re-uploads nothing.
 *
 * WHY IT MATTERS MORE THAN A RECEIPT: both quadrants have a downstream consumer
 * already, and each one currently reconstructs what this sheet authored:
 *
 *   Zone 2 → `panels.delogo` (Call 11), which today duplicates a BRANDED panel,
 *            AI-locates the logo boxes and paints white rectangles over them.
 *   Zone 3 → `logos.extract` (Call 10), which keys marks out of finished art.
 *
 * An authored clean base beats a stripped one — RestylePro's own words, after
 * it shipped the smear: "Never re-introduce a strip/heal to make a clean logo
 * removal — it smears. The clean base is AUTHORED, not stripped." Wiring those
 * two stages onto these bytes is the next step and is NOT done here; storing
 * them is what makes it possible at all.
 *
 * All three zones are mandatory. Missing geometry, blank graphics, or failed
 * artifact persistence refuses the node before it can publish a ready master.
 * Zone 3 remains a raster preview; it is not a vector cut file or QC approval.
 *
 * A failed panel-proof node is recorded and terminal. The caller does not
 * substitute another authoring topology or bypass the durable graph.
 *
 * KILL SWITCH: `DESIGNPRO_ATLAS_PANEL_PROOF=off`. Threaded through the runtime
 * reader, `configure-env.sh`, `validate-env.py` and the deploy-workflow lock —
 * because this file's own history says a flag the runtime reads and the writer
 * does not write is not a switch, and that mistake has been made twice.
 */

const PANEL_PROOF_TOPOLOGY = "panel-proof";
const PANEL_PROOF_TOPOLOGY_CONTRACT = "designpro.atlas-panel-proof-topology.v2";
/** Its OWN Call-1 endpoint. It cannot reach design-panel-ai-generate at all. */
const PROOF_EDGE_FUNCTION = "production-panel-proof";

const { compositeProductionPanels } = require("./atlas-master-composite.cjs");
const { planProductionPanelLockup } = require("./atlas-element-lockup.cjs");
const typeset = require("./atlas-typeset-layer.cjs");
const { verifyLogoIdentity } = require("./atlas-logo-prepare.cjs");
const { PROOF_REGIONS } = require("./atlas-panel-proof-contract.cjs");
const { cutProofPanels, scaleCell } = require("./atlas-proof-panels.cjs");
const {
  parsePanelRows, renderContainerTemplate, containerLayout,
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

/**
 * Where the clean panels and the cut graphics live.
 *
 * Content-addressed and deliberately NOT under `atlas-call1-inputs/`: these are
 * OUTPUTS of Call 1, and that prefix is the edge's input allowlist. Putting a
 * product artifact in the doorway the flatten reads from is how a later change
 * ends up attaching a customer's own clean panel as a teaching input.
 */
const QUADRANT_PREFIX = "atlas-panel-proof/quadrants";

/**
 * How far a cut crop's aspect may sit from the zone it is resized into.
 *
 * `fit: "fill"` cannot refuse anything, so this is the guard that stops a crop
 * from the wrong region being reshaped into a valid-looking print panel. A
 * legitimate crop drifts by rounding only (the cut is integer-rounded off a
 * scaled sheet); a crop of the wrong region on a real sheet drifts by tens of
 * percent. 1.05 sits far above the former and far below the latter.
 *
 * It is the same shape of guard as `MAX_ASPECT_DRIFT_RATIO` in the hero
 * cascade, which exists for the same reason: a resize that silently reshapes is
 * a defect no downstream measurement can see.
 */
const MAX_PANEL_ASPECT_DRIFT = 1.05;

/**
 * No vehicle panel is this long. The largest surface this catalog carries is a
 * 251" flank, so 400 leaves room for anything real while convicting a pixel
 * rectangle read as inches — the defect `panelRowsFromManifest` shipped, where
 * the driver arrived as 979" x 2674".
 */
const MAX_PLAUSIBLE_PANEL_INCHES = 400;

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
/**
 * THE SIX PANEL ROWS, IN REAL INCHES, FROM THE FIELDS THAT ACTUALLY EXIST.
 *
 * ⚠️ THIS EMITTED PIXELS LABELLED AS INCHES, TRANSPOSED, ON EVERY REAL RUN.
 *
 * It read `zone.trimInches || zone.trim`. **`trimInches` does not exist on a
 * GENIE zone** -- the real fields are `trimWidthIn`/`trimHeightIn` and
 * `printWidthIn`/`printHeightIn` -- so every call fell through to `zone.trim`,
 * which is the PIXEL rectangle of the surface on the 4096 master. Measured on
 * the ordinary six-surface manifest:
 *
 *     emitted   DRIVER: 979" wide x 2674" high     <- pixels, and portrait
 *     real      DRIVER: 163" wide x  66" high      <- print inches, landscape
 *
 * The flank is a tall rotated column on the master, so the numbers were not
 * merely in the wrong unit: they were the wrong way round. Three consequences,
 * all of which were live:
 *
 *   1. the prompt told the model the driver panel was 81 FEET TALL and portrait,
 *      so the sheet it drew was answering a different question;
 *   2. the container template draws its cells from these same rows, so the
 *      driver cell came out at 1.160:1 against a true 2.470:1 -- and, being
 *      clamped to the band height, could not have been right at any scale;
 *   3. `fit: "fill"` in the assembler then stretched that cell into the true
 *      zone, so EVERY driver and passenger panel this route produced was
 *      horizontally stretched by a factor of about 2.1.
 *
 * The probe never saw it because the probe PASSES its own `panels` input by
 * hand, already correct. Production derives them here. A fixture laxer than the
 * real thing, for the sixth time in this repo.
 *
 * ═══ WHY PRINT INCHES AND NOT TRIM ═══
 *
 * The rectangle the model fills, the cutter cuts and `assembleFinishedMaster`
 * places is the FULL zone -- trim plus the 5" bleed on all four sides -- and
 * measured on every surface `printWidthIn/printHeightIn` reproduces that zone's
 * aspect exactly (driver 2.470 = 2.470, hood 1.235 = 1.235, and so on). Stating
 * trim instead would leave the cell ~5% off its zone AND describe a rectangle
 * with no bleed in it, which is the artwork the installer wraps around the edge.
 * Trim stays in the copy as a callout; the GEOMETRY is the print rectangle.
 *
 * IT REFUSES RATHER THAN FALLS BACK. A fallback is what produced the defect: a
 * missing field silently became a pixel rectangle that every consumer believed.
 */
function panelRowsFromManifest(manifest) {
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : [];
  return zones.map((zone) => {
    const name = String(zone?.surfaceKey || "").toUpperCase();
    // The print rectangle, or trim plus its own bleed when a manifest states
    // only trim. Never `zone.trim`, which is pixels.
    const bleed = zone?.bleedIn || {};
    const trimW = Number(zone?.trimWidthIn);
    const trimH = Number(zone?.trimHeightIn);
    const w = Number.isFinite(Number(zone?.printWidthIn)) ? Number(zone.printWidthIn)
      : (Number.isFinite(trimW) ? trimW + Number(bleed.left || 0) + Number(bleed.right || 0) : NaN);
    const h = Number.isFinite(Number(zone?.printHeightIn)) ? Number(zone.printHeightIn)
      : (Number.isFinite(trimH) ? trimH + Number(bleed.top || 0) + Number(bleed.bottom || 0) : NaN);
    if (!name || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
      throw new PanelProofRefusal(
        `${name || "a surface"} has no usable print dimensions `
        + `(printWidthIn/printHeightIn or trimWidthIn/trimHeightIn + bleedIn)`);
    }
    // A PLAUSIBILITY FLOOR, because this is the exact defect class that shipped:
    // no vehicle panel is a thousand inches. A pixel rectangle read as inches
    // trips this immediately instead of reaching the prompt.
    if (w > MAX_PLAUSIBLE_PANEL_INCHES || h > MAX_PLAUSIBLE_PANEL_INCHES) {
      throw new PanelProofRefusal(
        `${name}: ${w}" x ${h}" is not a vehicle panel — these look like pixels, not inches`);
    }
    return `${name}: ${round1(w)}" wide x ${round1(h)}" high`;
  });
}

/** One decimal, and no trailing ".0" — the owner's own spec-sheet form. */
function round1(value) {
  return String(Math.round(Number(value) * 10) / 10);
}

/**
 * NODE 1 — the sheet. ONE image call, through the dedicated edge function.
 *
 * The edge is `production-panel-proof`, which is its own Call-1 endpoint and
 * cannot reach `design-panel-ai-generate` at all — so production's other
 * topologies keep calling the one endpoint they always called (RULE 0.26) no
 * matter what this one returns.
 */
/**
 * THE CUSTOMER'S OWN ASSETS, STAGED AS REFERENCES RATHER THAN INLINED.
 *
 * Their absence was this route's worst defect: `requestProofSheet` forwarded
 * text and vehicle fields only, so a customer who uploaded a logo or a
 * reference photo received a design that never saw either, while the
 * six-surface and field contracts carried both. RULE 0.24 calls those CREATIVE
 * authority -- artwork authority under `exact_reference` -- and nothing
 * downstream can detect that they were dropped.
 *
 * THEY ARE NOT SENT AS BASE64, DELIBERATELY. The obvious fix is to copy
 * `edgeExtras.referenceImagesBase64`, and this edge's own header records why
 * that is the wrong door: it "already died twice on a bodiless 504 from a
 * 2.2 MB base64 request". A customer logo is conditioned to 1600px and a
 * VisionBoard set can be several images, so inlining them walks straight back
 * into a failure mode this function has already suffered.
 *
 * So each asset is written to `atlas-call1-inputs/<sha256>.png` -- the one shape
 * `attach()` admits -- and crosses as `{storagePath, contentHash, byteSize}`
 * (RULE 0.39). The edge then re-reads and hash-verifies each one itself, so the
 * runtime cannot name bytes the far side did not check. `CALL1_INPUT_PATH` is
 * asserted here too, so a path the edge would refuse never leaves (the 2099d17d
 * lesson, applied before it costs a run).
 *
 * VERIFICATION IS NOT REPEATED HERE. `verifiedCustomerLogoPart` and
 * `verifiedCustomerReferenceParts` already refused a URL, re-downloaded the
 * bytes and re-checked length and sha256 against the request identity; these
 * parts arrive from that. Re-implementing those checks would be the second
 * ownership path RULE 1 exists to prevent.
 */
async function stageCustomerAssets({ store, customerImageParts = [], logger = () => {} }) {
  const inline = (Array.isArray(customerImageParts) ? customerImageParts : [])
    .filter((part) => typeof part?.inlineData?.data === "string" && part.inlineData.data.length);
  if (!inline.length) return [];
  if (typeof store?.putImmutableBytes !== "function") {
    // Honest and non-fatal: the sheet is still worth drawing from the brief, and
    // the receipt records that the assets could not be staged rather than
    // implying the model saw them.
    logger("atlas call 1: customer assets could not be staged (no store); the proof will not see them");
    return [];
  }
  const staged = [];
  for (const part of inline) {
    const bytes = Buffer.from(part.inlineData.data, "base64");
    if (!bytes.length) continue;
    // PNG in, PNG out: these parts are already conditioned PNG (the logo is
    // resized and re-encoded by `verifiedCustomerLogoPart`), so the filename
    // hash is the hash of exactly what is written.
    const digest = sha256(bytes);
    const storagePath = `atlas-call1-inputs/${digest}.png`;
    if (!CALL1_INPUT_PATH.test(storagePath)) {
      throw new PanelProofRefusal(`customer asset path the edge would refuse: ${storagePath}`);
    }
    staged.push(await store.putImmutableBytes({ storagePath, bytes, contentType: "image/png" }));
  }
  logger(`atlas call 1: staged ${staged.length} customer asset(s) for the proof`);
  return staged;
}

async function requestProofSheet({ manifest, input, providerRequest, callProofEdge, store, customerImageParts, logger }) {
  const panelRows = panelRowsFromManifest(manifest);
  if (panelRows.length !== 6) {
    throw new PanelProofRefusal(`manifest yielded ${panelRows.length}/6 panel rows`);
  }
  const vehicle = input?.vehicle || {};
  const customerAssets = await stageCustomerAssets({ store, customerImageParts, logger });
  const sheet = await callProofEdge({
    // Verified VisionBoard references, by identity. Protected Zone-3 originals
    // are retained by the compositor, outside this image-generation request.
    customerAssets,
    separatedArtwork: true,
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
    brandColors: String(input?.brandColors || "").trim()
      || (Array.isArray(input?.colors) ? input.colors.map(String).filter(Boolean).join(", ") : String(input?.colors || "").trim()),
    style: String(input?.style || "").trim(),
    fontStyle: String(input?.fontStyle || "").trim(),
    industryType: String(input?.industryType || input?.industry || "").trim(),
    styleDescriptors: String(input?.styleDescriptors || "").trim(),
    visionboard_intent: ["exact_reference", "artboard_projection"].includes(String(input?.visionboardIntent || "").trim())
      ? "exact_reference" : "style_inspiration",
    vehicleYear: vehicle.year || null,
    vehicleMake: vehicle.make || null,
    vehicleModel: vehicle.model || null,
    vehicleType: vehicle.type || vehicle.vehicleClass || null,
    panelRows,
    // THE OPERATION IDENTITY, STABLE ACROSS A RECOVERY.
    //
    // The edge now runs its image request through the durable provider module,
    // which keys the claim on {ownerId, requestId, generationId, mode,
    // attemptKey}. This contract has ONE bounded candidate, so the key is
    // constant -- which is the point: a re-claimed worker sending the same
    // identity reads its own earlier request instead of buying the sheet twice.
    // Before this, the edge minted a fresh uuid per invocation and `cacheOnly`
    // could not mean anything.
    attemptKey: "panel-proof:1",
    ...providerRequest,
  });
  if (!sheet?.bytes) throw new PanelProofRefusal("the proof edge returned no sheet");
  return { sheet, panelRows, customerAssets };
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
  // THE OWNER ARRIVES PER CALL, NOT ONLY AT CONSTRUCTION — the same shape
  // `createAtlasAuthorTransport` already uses, and for the same reason. Both
  // runtime processes build ONE transport at start-up and then serve panel-proof
  // nodes of ANY customer's run, so a construction-time owner would send an
  // EMPTY `x-designpro-owner-id` for every graph-claimed node. The edge fails
  // that closed with 403 (`production_panel_proof_internal_only`) rather than
  // proceeding, which is correct — but it would have made every durable
  // panel-proof run fail, and the owner id is also the provider cache's own
  // isolation key, so getting it from the claimed run is the whole point.
  return async (body, { ownerId: callOwnerId = ownerId } = {}) => {
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
        "x-designpro-owner-id": String(callOwnerId || ""),
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
 * THE SECOND HALF: cut → gate → place → assemble → store the siblings.
 *
 * Split out from `authorPanelProofMaster` so the durable graph and the
 * in-process pass execute THE SAME CODE rather than two implementations of it.
 * That is the whole point of the split and the reason it is not a copy: a
 * second producer of the panels is exactly what RULE 0.21 forbids by name, and
 * the drift it produces is what RULE 0.29 spent a session measuring.
 *
 * It takes the sheet as `{ bytes, contentHash, storagePath, byteSize, ... }`.
 * The graph's node reads those bytes back from the sheet's stored IDENTITY and
 * hash-verifies them before calling this (RULE 0.39 across the node boundary);
 * the in-process caller already holds them. Either way this function is handed
 * the same object and cannot tell which path it is on — deliberately, because a
 * function that behaves differently per caller is two functions.
 *
 * `stageTimings` is passed IN so a graph run can carry the sheet node's own
 * timing into the same list the in-process run produces, and the receipt keeps
 * one shape on both paths.
 */
async function assemblePanelProofMaster({
  sheet, panelRows, customerAssets = [], input = {}, downloadAsset, manifest, store, logger = () => {},
  assembleFinishedMaster, sharp = require("sharp"),
  startedAt = Date.now(), stageTimings = [],
} = {}) {
  const mark = (stage, at) => stageTimings.push({ stage, ms: Date.now() - at });
  if (!sheet?.bytes) throw new PanelProofRefusal("the assemble stage was handed no sheet bytes");

  /**
   * EVERY REFUSAL PAST THIS POINT NAMES THE SHEET IT JUDGED.
   *
   * Live 5772fcd5: the sheet came back, this pass refused it, and the ledger row
   * the caller writes had nothing to point at -- so the verdict existed and the
   * artifact behind it could not be opened. A refusal whose evidence cannot be
   * retrieved is the state the refusal ledger was built to end: judge the gates
   * from the pixels, which requires knowing which pixels.
   *
   * The sheet is already persisted by the edge and hash-verified by the
   * transport, so this carries its IDENTITY (RULE 0.39) and never its bytes.
   */
  const refuse = (reason, extra = {}) => new PanelProofRefusal(reason, {
    ...extra,
    sheet: {
      storagePath: sheet.storagePath || null,
      contentHash: sheet.contentHash || null,
      byteSize: sheet.byteSize || sheet.bytes?.length || null,
      contentType: sheet.sheetShape?.mime || null,
      model: sheet.model || null,
      ...(extra.sheet || {}),
    },
  });

  // ── node 2: the cut. Deterministic, zero model calls. ──────────────────
  const cutAt = Date.now();
  const proofManifest = parsePanelRows(panelRows);
  const cut = await cutProofPanels({
    proofBytes: sheet.bytes, manifest: proofManifest,
    // Zone 2 is the generated artwork authority. Zone 1 is composed below,
    // and Zone 3 comes from originals; neither consumes a provisional AI crop.
    zones: ["zone2"], sharp,
  });
  if (cut.refused) throw refuse(cut.refused, { cutSheet: cut.sheet });
  mark("panel.cut", cutAt);

  let zone1 = [];
  const zone2 = cut.panels.filter((p) => p.zone === "zone2");
  let zone3 = [];
  if (zone2.length !== 6) {
    throw refuse("the mandatory three-zone proof is incomplete", {
      zones: { branded: zone1.length, backgrounds: zone2.length, graphics: zone3.length },
    });
  }
  if (typeof store?.putImmutableBytes !== "function") {
    throw refuse("the mandatory three-zone proof has no artifact store");
  }
  const persist = async (object) => {
    try { return await store.putImmutableBytes(object); }
    catch (cause) { throw refuse("mandatory proof artifact could not be stored", {cause:String(cause?.message || cause)}); }
  };
  const unverified = zone2.filter((p) => !p.positionalPremiseVerified || !p.identity);
  if (unverified.length) {
    throw refuse(`unverified panel identities: ${unverified.map((p) => `${p.zone}:${p.surfaceKey}`).join(", ")}`);
  }
  // Paint density remains a receipt metric, not evidence of surface identity.

  // Zone 3 comes from original files and outlined typography, NEVER sheet crops.
  const assets = [];
  if (input.logoAsset) {
    const identity = verifyLogoIdentity(input.logoAsset);
    if (typeof downloadAsset !== "function") throw refuse("original logo reader missing");
    const bytes = await downloadAsset(identity);
    if (bytes.length !== identity.byteSize || sha256(bytes) !== identity.contentHash) {
      throw refuse("original logo identity mismatch");
    }
    const meta = await sharp(bytes, {density:300,limitInputPixels:40000000}).metadata();
    assets.push({...identity,bytes,role:"logo",width:meta.width,height:meta.height,
      contentType:input.logoAsset.contentType,vector:input.logoAsset.contentType === "image/svg+xml"});
  }
  const brand = {...(sheet.intake || {}), ...Object.fromEntries(Object.entries(input).filter(([,v]) => v != null && v !== "" && (!Array.isArray(v) || v.length)))};
  const services = Array.isArray(brand.services) ? brand.services : [];
  const textJobs = [
    {role:"typography",name:brand.companyName || brand.businessName || "",lines:[brand.tagline || ""]},
    {role:"contact",name:"",lines:[brand.phone,brand.website,...services,brand.promo].filter(Boolean)},
  ];
  for (const job of textJobs) {
    if (!job.name && !job.lines.some(Boolean)) continue;
    const rendered = await typeset.renderLockup({...job,width:1600});
    const bytes = Buffer.from(rendered.svg);
    const stored = await persist({storagePath:typeset.elementStoragePath(sha256(bytes),"svg"),
      bytes,contentType:"image/svg+xml"});
    assets.push({...stored,bytes,byteSize:bytes.length,contentHash:sha256(bytes),role:job.role,
      width:rendered.width,height:rendered.height,contentType:"image/svg+xml",vector:true});
  }
  if (!assets.length) throw refuse("Zone 3 requires original assets or customer text");
  let productionLayout;
  try { productionLayout = planProductionPanelLockup({panels:zone2,elements:assets}); }
  catch (cause) { throw refuse("production panel overlay layout invalid", {cause:String(cause?.message || cause),code:cause?.code}); }
  const placements = productionLayout.placements;
  const composed = await compositeProductionPanels({backgrounds:zone2,assets,placements});
  const compositionChecks = composed.panels.map(({surfaceKey,contentHash,backgroundContentHash,applied}) =>
    ({surfaceKey,contentHash,backgroundContentHash,applied}));
  logger(`atlas call 1: flat compositor checks passed ${JSON.stringify(compositionChecks)}`);
  const displayLayout = containerLayout(proofManifest);
  const displayCells = new Map(displayLayout.zone1.map(cell => [cell.surfaceKey,
    scaleCell(cell,displayLayout,cut.sheet)]));
  zone1 = composed.panels.map(p => ({...p,displayRect:displayCells.get(p.surfaceKey)}));
  zone3 = assets.map(({bytes,...ref}) => ({...ref,surfaceKey:ref.role,assetRole:ref.role,role:"cut-graphic",persisted:true,productionApproved:false}));

  // Replace the model's provisional Zone 1 and Zone 3 in the displayed proof.
  // The customer sees the SAME composed panels the master consumes.
  const proofLayers = [];
  const zone1Top = Math.round(cut.sheet.height*PROOF_REGIONS.zone1.y);
  const zone1Bottom = Math.round(cut.sheet.height*PROOF_REGIONS.zone2.y);
  const blankTemplate = await renderContainerTemplate({manifest:proofManifest});
  // Only document chrome is scaled to the sheet here. Artwork retains its
  // aspect through contain below, and source Zone 2 bytes remain unchanged.
  const cleanZone1Band = await sharp(blankTemplate)
    .resize(cut.sheet.width,cut.sheet.height,{fit:"fill"})
    .extract({left:0,top:zone1Top,width:cut.sheet.width,height:zone1Bottom-zone1Top})
    .png().toBuffer();
  proofLayers.push({input:cleanZone1Band,left:0,top:zone1Top});
  for (const p of zone1) {
    const r = p.displayRect;
    proofLayers.push({input:await sharp(p.bytes).resize(r.width,r.height,{fit:"contain",background:"white"})
      .png().toBuffer(),left:r.left,top:r.top});
  }
  const band = PROOF_REGIONS.zone3;
  const bandTop = Math.round(cut.sheet.height*band.y), bandHeight = Math.floor(cut.sheet.height*band.h);
  proofLayers.push({input:await sharp({create:{width:cut.sheet.width,height:bandHeight,channels:3,background:"white"}})
    .png().toBuffer(),left:0,top:bandTop});
  const headingHeight = Math.max(24,Math.round(bandHeight*0.16));
  proofLayers.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cut.sheet.width}" height="${headingHeight}"><rect width="100%" height="100%" fill="#e96900"/><text x="16" y="${headingHeight*0.7}" font-size="${headingHeight*0.6}" font-family="sans-serif" fill="white">ZONE 3 — ORIGINAL GRAPHICS + OUTLINED TEXT</text></svg>`),left:0,top:bandTop});
  const slotWidth = Math.floor(cut.sheet.width/assets.length);
  for (let i=0;i<assets.length;i++) {
    proofLayers.push({input:await sharp(assets[i].bytes,{density:300,limitInputPixels:40000000})
      .resize(slotWidth-20,bandHeight-headingHeight-20,{fit:"contain",background:"white"}).png().toBuffer(),
      left:i*slotWidth+10,top:bandTop+headingHeight+10});
  }
  const proofBytes = await sharp(sheet.bytes).composite(proofLayers).png().toBuffer();
  const storedComposedProof = await persist({storagePath:`atlas-panel-proof/${sha256(proofBytes)}.png`,
    bytes:proofBytes,contentType:"image/png"});
  // CUSTOMER CALL 1 IS THE GEMINI THREE-ZONE SHEET. Do not replace its identity
  // with the deterministic production composition. The composition remains a
  // production artifact for PanelPro/QC, while the exact sheet the customer saw
  // is also the exact multimodal authority Call 2 photographs.
  const composedProof = {
    storagePath: storedComposedProof.storagePath,
    contentHash: storedComposedProof.contentHash,
    byteSize: proofBytes.length,
    contentType: "image/png",
  };

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
    if (!panel) throw refuse(`${zone.surfaceKey}: no cut panel to assemble`);
    const { pixelWidth, pixelHeight } = zonePixelSize(zone);

    // Detected bounds and surface identity are checked before this step.
    // Reject incompatible proportions. Preserve all source artwork with a
    // proportional resize, then copy only the boundary pixels into the bounded
    // remainder. This adapter padding is not production bleed.
    const cropAspect = panel.rect.width / panel.rect.height;
    const zoneAspect = pixelWidth / pixelHeight;
    const drift = Math.max(cropAspect / zoneAspect, zoneAspect / cropAspect);
    if (!Number.isFinite(drift) || drift > MAX_PANEL_ASPECT_DRIFT) {
      throw refuse(
        `${zone.surfaceKey}: the cut crop is ${cropAspect.toFixed(3)}:1 and its zone is `
        + `${zoneAspect.toFixed(3)}:1 (drift ${drift.toFixed(3)}, limit ${MAX_PANEL_ASPECT_DRIFT}) `
        + `— resizing it would distort the artwork rather than place it`,
        { aspect: { surfaceKey: zone.surfaceKey, cropAspect: Number(cropAspect.toFixed(4)),
          zoneAspect: Number(zoneAspect.toFixed(4)), drift: Number(drift.toFixed(4)) } });
    }

    const resized = await sharp(panel.bytes)
      .resize(pixelWidth, pixelHeight, { fit: "inside" })
      .png().toBuffer({ resolveWithObject: true });
    const padX = pixelWidth - resized.info.width;
    const padY = pixelHeight - resized.info.height;
    if (padX < 0 || padY < 0
      || padX > Math.ceil(pixelWidth * (1 - 1 / MAX_PANEL_ASPECT_DRIFT)) + 1
      || padY > Math.ceil(pixelHeight * (1 - 1 / MAX_PANEL_ASPECT_DRIFT)) + 1) {
      throw refuse(`${zone.surfaceKey}: edge extension exceeds the aspect budget`);
    }
    const left = Math.floor(padX / 2);
    const top = Math.floor(padY / 2);
    const bytes = await sharp(resized.data).extend({
      left, right: padX - left, top, bottom: padY - top, extendWith: "copy",
    }).png().toBuffer();
    placed.push({
      surfaceKey: zone.surfaceKey,
      finish: { applied: true, bytes, contentHash: sha256(bytes) },
    });
  }
  const assembled = await assembleFinishedMaster(canvas, manifest, placed);
  mark("master.assemble", assembleAt);

  // ── the other two quadrants: STORED, then described. ───────────────────
  //
  // See the header. These bytes are the clean base and the Logo Pack; they were
  // being cut, measured and dropped while a comment here claimed otherwise.
  // One content-addressed write each, through the store seam the caller already
  // hands this function.
  const quadrantAt = Date.now();
  const sibling = async (zone) => {
    const panels = cut.panels.filter((p) => p.zone === zone);
    const out = [];
    for (const p of panels) {
      const described = {
        surfaceKey: p.surfaceKey, role: p.role, byteSize: p.byteSize, fit: p.fit, rect: p.rect,
        identity: p.identity, positionalPremiseVerified: p.positionalPremiseVerified,
        widthIn: p.widthIn ?? null, heightIn: p.heightIn ?? null,
      };
      try {
        const stored = await persist({
          storagePath: `${QUADRANT_PREFIX}/${sha256(p.bytes)}.png`,
          bytes: p.bytes, contentType: "image/png",
        });
        out.push({ ...described, persisted: true, ...stored });
      } catch (cause) {
        throw refuse(`${zone}:${p.surfaceKey}: mandatory proof artifact could not be stored`, {
          cause: String(cause?.message || cause).slice(0, 200),
        });
      }
    }
    return out;
  };
  const cleanQuadrant = await sibling("zone2");
  const cutGraphicsQuadrant = zone3;
  // NOT A `mark()`. `stageTimings` is the DAG's node list and its order is
  // locked as such; this is persistence of node 2's output, not a fourth node,
  // so it is timed on `timings` where a reader will not read it as one. The
  // order lock caught me putting it there.
  const quadrantMs = Date.now() - quadrantAt;
  const storedCount = [...cleanQuadrant, ...cutGraphicsQuadrant].filter((p) => p.persisted).length;
  logger(`atlas call 1: quadrants stored ${storedCount}/${cleanQuadrant.length + cutGraphicsQuadrant.length}`
    + ` (clean ${cleanQuadrant.filter((p) => p.persisted).length}, cut graphics `
    + `${cutGraphicsQuadrant.filter((p) => p.persisted).length})`);

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
      proofByteSize: sheet.byteSize || sheet.bytes.length,
      proofContentType: sheet.sheetShape?.mime || "image/png",
      productionComposedProof: composedProof,
      threeZoneLayout: { required: true, branded: zone1.length,
        backgrounds: zone2.length, graphics: zone3.length,
        graphicsFormat: zone3.every(a => a.vector) ? "vector-originals" : "mixed-originals", productionApproved: false },
      composition: {contract:composed.contract,layoutContract:productionLayout.contract,placements,panels:compositionChecks,sourceAssetsPreserved:true},
      imageRequestCount: 1,
      masterSha256: assembled.contentHash,
      masterStoragePath: null,
      // THE CUSTOMER'S OWN ASSETS, BY IDENTITY, ON THE RECEIPT.
      //
      // They were staged, hash-verified and sent, and then recorded NOWHERE --
      // so "did the customer's logo reach Call 1" was unanswerable from the run,
      // which is the state that let this route ship forwarding neither the logo
      // nor the VisionBoard reference while every receipt read green. An empty
      // array is a real answer (the customer uploaded nothing); absence of the
      // field is not.
      customerAssets: (Array.isArray(customerAssets) ? customerAssets : []).map((asset) => ({
        storagePath: asset?.storagePath || null,
        contentHash: asset?.contentHash || null,
        byteSize: Number(asset?.byteSize || 0) || null,
      })),
      sheet: cut.sheet,
      // THE THREE QUADRANTS, NAMED. Zone 1 became the master; these two are
      // the clean base and the Logo Pack, and a reader that cannot see them
      // here would assume the sheet carried only panels.
      // Zone 1 became the master, so it is described from the placement above
      // rather than stored twice; the other two carry their own identities.
      quadrants: {
        branded: zone1.map((p) => ({
          surfaceKey: p.surfaceKey, role: p.role, byteSize: p.byteSize, fit: p.fit, rect: p.displayRect, backgroundRect: p.rect,
          identity: p.identity, positionalPremiseVerified: p.positionalPremiseVerified,
        })),
        clean: cleanQuadrant,
        cutGraphics: cutGraphicsQuadrant,
      },
      stageTimings,
      totalMs: Date.now() - startedAt,
    },
    timings: { panelProofMs: Date.now() - startedAt, quadrantStoreMs: quadrantMs, stages: stageTimings },
  };
}

/**
 * The whole pass, in one process: sheet → cut → assemble.
 *
 * This is now a two-line composition of the two halves above, and it stays
 * because it is the door the in-process path and every existing caller already
 * use. The durable graph claims the same two halves as two node rows; both
 * routes run the SAME functions, so there is exactly one producer of these
 * panels however Call 1 was dispatched.
 *
 * @returns the same shape `authorHeroDriverMaster` returns, because
 *   flat-first-atlas consumes both through one code path and a second shape
 *   there would be a second contract nobody asked for.
 */
async function authorPanelProofMaster({
  manifest, input, store, logger = () => {}, customerImageParts = [],
  providerRequest = {}, callProofEdge, downloadAsset,
  assembleFinishedMaster, sharp = require("sharp"),
  startedAt = Date.now(),
} = {}) {
  const stageTimings = [];
  const sheetAt = Date.now();
  const { sheet, panelRows, customerAssets } = await requestProofSheet({
    manifest, input, providerRequest, callProofEdge, store, customerImageParts, logger,
  });
  stageTimings.push({ stage: "proof.sheet", ms: Date.now() - sheetAt });
  logger(`atlas call 1: panel proof sheet ${String(sheet.contentHash || "").slice(0, 12)} (${sheet.bytes.length} B)`);
  return assemblePanelProofMaster({
    sheet, panelRows, customerAssets, input, downloadAsset, manifest, store, logger,
    assembleFinishedMaster, sharp, startedAt, stageTimings,
  });
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
  requestProofSheet,
  assemblePanelProofMaster,
  authorPanelProofMaster,
};
