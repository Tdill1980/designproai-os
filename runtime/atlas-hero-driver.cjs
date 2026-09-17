"use strict";

/**
 * A.T.L.A.S. HERO-DRIVER CASCADE — Call 1 as ONE multi-turn conversation.
 *
 * Owner ruling, Trish 2026-09-11 (supersedes "Call 1 authors the complete
 * six-surface topology in one image request"):
 *
 *   "It must create the hero driver side and then flip the driver for
 *    passenger side then show each to each side generated in parallel so for
 *    instance rear would see driver, passenger, front and hood then roof would
 *    see all." / "Passing the thought_signature from the hero driver-side
 *    generation into the passenger/rear/hood requests locks the design
 *    continuity across all panels." / "we need speed a 7 minute orchestration
 *    is not good" / "Keep Gemini Image Pro 3. DO NOT USE VERTEX or IMAGEN."
 *
 * Why the shape of the ask changed and not the prompt: measured on production
 * (designproai-os-prod, 21 days to 2026-09-11) 36 of the 52 failures after the
 * slot infra was fixed were the ONE-IMAGE Call 1 drawing the vehicle into the
 * six-surface sheet and a gate correctly refusing it, across five prompt
 * versions. One rectangle of printed artwork is the ask this model answers
 * cleanly; six related rectangles of one vehicle on one canvas is the ask it
 * keeps failing.
 *
 * THE CASCADE (hybrid wiring, chosen for latency):
 *   stage 1  driver             — the hero, from scratch, through the real
 *                                  persona brain (edge mode atlas-author, first:true)
 *   stage 2  passenger          — flop(driver), pure code, no model call. The
 *                                  runtime's existing composePassengerFromDriver
 *                                  then re-drops the brand bands forward-reading.
 *   stage 3  hood, front, rear  — IN PARALLEL, each a continuation of the same
 *                                  conversation (driver exchange + signature
 *                                  replayed), shown driver + passenger.
 *   stage 4  roof               — sees all five; replays driver, hood, front,
 *                                  rear (trimmed to the request budget).
 *
 * Every surface is bounded: at most two image requests, the second WITHOUT the
 * replayed chain (which is also the fallback for a provider that rejects a
 * replayed signature from a linearised parallel branch). A refused surface
 * refuses the whole hero-driver pass (HeroDriverRefusal); the caller falls
 * over to the six-surface contract, so the customer still gets a design.
 *
 * WHAT THIS MODULE NEVER DOES: call Gemini directly (every image request goes
 * through the deployed design-panel-ai-generate edge, RULE 0.26), publish a
 * master, touch a gate threshold, or heal a pixel. It returns ONE assembled
 * 4096² sheet in the GENIE manifest zones; the caller runs the SAME whole-
 * master gates on it that judge a six-surface master.
 */

const sharp = require("sharp");
const { createHash } = require("node:crypto");
const { assembleFinishedMaster } = require("./atlas-finished-master.cjs");
const { holeRatio, trimHistory, MAX_HISTORY_EXCHANGES } = require("./atlas-panel-authoring.cjs");
const { fillMasterCutouts } = require("./atlas-cutout-fill.cjs");

const HERO_DRIVER_TOPOLOGY = "hero-driver";
const HERO_DRIVER_CONTRACT = "designpro.atlas-hero-driver.v1";
// Must equal the edge's ATLAS_AUTHOR_PROMPT_VERSION; callAtlasAuthorEdge refuses a mismatch.
const HERO_DRIVER_PROMPT_VERSION = "atlas-author-hero-first.20260917.v5-front-view-flatten";
const CANVAS_PX = 4096;

/** Execution order. Surfaces inside one stage run in parallel; stages run in sequence. */
const AUTHOR_CASCADE = Object.freeze([
  Object.freeze(["driver"]),
  Object.freeze(["passenger"]),
  Object.freeze(["hood", "front", "rear"]),
  Object.freeze(["roof"]),
]);
/** Finished sheets each AI surface is SHOWN (downscaled references). */
const AUTHOR_NEIGHBOURS = Object.freeze({
  driver: Object.freeze([]),
  passenger: Object.freeze(["driver"]),
  hood: Object.freeze(["driver", "passenger"]),
  front: Object.freeze(["driver", "passenger"]),
  rear: Object.freeze(["driver", "passenger"]),
  // ROOF SHOWS THE TWO FLANKS ONLY. Live 194e8f17: roof was the last surface
  // standing and failed `flat_atlas_author_edge_call_failed` three times into
  // attempts_exhausted -- the same edge-worker exhaustion front hit, for the
  // same reason. Five neighbour images plus a replayed chain is the heaviest
  // request the cascade builds, and the flanks already carry the design's
  // colourway, motifs and lettering; hood/front/rear are themselves
  // continuations of those flanks. CLAUDE.md names this exact change as a
  // standing next lever ("roof beside hood/front/rear, showing driver +
  // passenger only").
  roof: Object.freeze(["driver", "passenger"]),
});
/** Model exchanges each AI surface REPLAYS (passenger has none: it is code). */
const AUTHOR_HISTORY = Object.freeze({
  driver: Object.freeze([]),
  hood: Object.freeze(["driver"]),
  front: Object.freeze(["driver"]),
  rear: Object.freeze(["driver"]),
  roof: Object.freeze(["driver", "hood", "front", "rear"]),
});
const SURFACE_LABELS = Object.freeze({
  driver: "DRIVER SIDE", passenger: "PASSENGER SIDE", hood: "HOOD", roof: "ROOF", front: "FRONT", rear: "REAR",
});
const AUTHOR_ATTEMPTS = 2;
// SURFACES WHOSE ZONE ASPECT CAN EXCEED WHAT A SINGLE REQUEST CAN EMIT. Driver
// was measured 0/3 real vehicles (RULE 0.39). The front bumper/fascia strip is
// the same shape of problem, measured live on the F250 canary: front's zone is
// 1262x399px (3.16:1), over the 21:9 (2.33:1) ceiling by a drift of 1.354 --
// `front: aspect_drift:1.342`/`1.354` refused Call 1 identically on two
// separate real generations (35211386508, 35212228736), forcing a fail-over
// that spends a full second authoring pass. Hood, rear and roof measure well
// under the ceiling on every catalog vehicle inspected so far and are left
// single-step; add a surface here only on the SAME evidentiary bar (a real,
// measured aspect_drift refusal), never speculatively (RULE 0.32's discipline
// against untested creative-conditioning changes applies here too).
const HERO_VIEW_SURFACES = Object.freeze(new Set(["driver", "front"]));
const MAX_ASPECT_DRIFT_RATIO = 1.12;
// An authored sheet must arrive whole. Finishing compares against a crop; there
// is no crop here, so the bar is absolute: no more than 0.2% of the rectangle
// unresolved (transparent or flat black).
const MAX_AUTHORED_HOLE_RATIO = 0.002;
const REFERENCE_LONG_EDGE_PX = 1280;
const REFERENCE_JPEG_QUALITY = 82;
/** The flatten's source is the subject, not a thumbnail: full size, high quality. */
const HERO_VIEW_JPEG_QUALITY = 92;
/** The edge's own input allowlist, mirrored so the runtime cannot stage a path it will refuse. */
const CALL1_INPUT_PATH = /^atlas-call1-inputs\/[0-9a-f]{64}\.(?:png|jpg)$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

class HeroDriverRefusal extends Error {
  constructor(surfaceKey, reason, details = {}) {
    super(`hero-driver ${surfaceKey} refused: ${reason}`);
    this.code = "flat_atlas_hero_driver_refused";
    this.retryable = false;
    this.surfaceKey = surfaceKey;
    this.reason = reason;
    this.details = details;
  }
}

/** The pixel size of a surface's authored sheet: the zone as it is cut (rotation applied). */
function zonePixelSize(zone) {
  const rotation = Math.abs(Number(zone?.extraction?.outputRotationDegrees || 0)) % 180;
  const w = Number(zone?.extraction?.w || zone?.w);
  const h = Number(zone?.extraction?.h || zone?.h);
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w < 1 || h < 1) {
    throw Object.assign(new Error(`${zone?.surfaceKey || "surface"}: zone geometry invalid`), { code: "flat_atlas_hero_zone_invalid" });
  }
  return rotation === 90 ? { pixelWidth: h, pixelHeight: w } : { pixelWidth: w, pixelHeight: h };
}

/**
 * THE VEHICLE RENDER, STAGED AS A CALL-1 INPUT.
 *
 * The edge attaches an input ONLY from the content-addressed prefix
 * (`^atlas-call1-inputs/<sha256>\.(png|jpg)$`, `attach()` in
 * design-panel-ai-generate) -- every other path is refused as
 * `atlas_author_input_path_invalid`, which is what it exists for: the flatten
 * must not be able to name an arbitrary object to read.
 *
 * Node 1 returned the edge's own PANEL path instead, so node 3's first live
 * request died HTTP 500 on that validator (generation 2099d17d, 2026-09-17).
 * Node 1's render IS a Call-1 input for node 3, so it is staged like one.
 *
 * Unlike `stageReference` this does NOT downscale. A neighbour is shown for
 * continuity at 1280px; the hero view is the flatten's actual SUBJECT, and
 * shrinking it would throw away the detail node 3 exists to reproduce.
 */
async function stageHeroView(store, bytes) {
  const staged = await sharp(bytes, { limitInputPixels: false })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: HERO_VIEW_JPEG_QUALITY, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const contentHash = sha256(staged);
  const storagePath = `atlas-call1-inputs/${contentHash}.jpg`;
  await store.putImmutableBytes({ storagePath, bytes: staged, contentType: "image/jpeg" });
  return { storagePath, contentHash, byteSize: staged.length };
}

async function stageReference(store, bytes) {
  const small = await sharp(bytes, { limitInputPixels: false })
    .resize({ width: REFERENCE_LONG_EDGE_PX, height: REFERENCE_LONG_EDGE_PX, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: REFERENCE_JPEG_QUALITY, chromaSubsampling: "4:4:4" })
    .toBuffer();
  const contentHash = sha256(small);
  const storagePath = `atlas-call1-inputs/${contentHash}.jpg`;
  await store.putImmutableBytes({ storagePath, bytes: small, contentType: "image/jpeg" });
  return { storagePath, contentHash };
}

/**
 * THE DRIVER EXCHANGE IS ALWAYS REPLAYED. The shared trim keeps the NEWEST
 * exchanges, which is right for finishing (the sheet drawn immediately before
 * is the strongest constraint) and wrong for this cascade: the owner's ruling
 * is that the HERO's thought signature is what locks continuity, so the roof
 * must still carry the driver exchange after hood, front and rear. The driver
 * exchange is therefore pinned first and the rest are trimmed to fit beside
 * it, inside the same history budget (`MAX_HISTORY_EXCHANGES` in total).
 */
function trimAuthoringHistory(exchanges) {
  const head = exchanges.find((exchange) => exchange?.surfaceKey === "driver");
  const rest = exchanges.filter((exchange) => exchange !== head);
  const kept = trimHistory(rest);
  if (!head) return kept;
  return [head, ...kept.slice(-(MAX_HISTORY_EXCHANGES - 1))];
}

/** Accept or refuse one returned sheet: right shape, whole, then resized to the exact zone. */
async function evaluateAuthored(surfaceKey, bytes, pixelWidth, pixelHeight) {
  if (!bytes || !bytes.length) return { accepted: false, reason: "empty_return" };
  let meta;
  try { meta = await sharp(bytes, { limitInputPixels: false }).metadata(); }
  catch (cause) { return { accepted: false, reason: `undecodable:${String(cause?.message || cause).slice(0, 80)}` }; }
  const width = Number(meta.width || 0), height = Number(meta.height || 0);
  if (width < 8 || height < 8) return { accepted: false, reason: "degenerate_size" };
  const want = pixelWidth / pixelHeight, got = width / height;
  const drift = want > got ? want / got : got / want;
  if (!Number.isFinite(drift) || drift > MAX_ASPECT_DRIFT_RATIO) return { accepted: false, reason: `aspect_drift:${drift.toFixed(3)}` };
  let normalized;
  try {
    normalized = await sharp(bytes, { limitInputPixels: false })
      .resize(pixelWidth, pixelHeight, { fit: "fill" })
      .flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb").png().toBuffer();
  } catch (cause) { return { accepted: false, reason: `resize_failed:${String(cause?.message || cause).slice(0, 80)}` }; }
  let holes;
  try { holes = await holeRatio(normalized); }
  catch (cause) { return { accepted: false, reason: `measure_failed:${String(cause?.message || cause).slice(0, 80)}` }; }
  let repaired = null;
  const holesBefore = holes;
  if (holes > MAX_AUTHORED_HOLE_RATIO) {
    // RULE 0.15 -- "DO NOT RE-ROLL FOR A CUT-OUT. FILL IT." The six-surface
    // path has run the deterministic ~100 ms `fillMasterCutouts` before its
    // verdict since 2026-08-24; the hero flatten never did, so it refused a
    // sheet the rest of the system would have repaired. Live cost, generation
    // 828f31f7 (2026-09-17): node 1 completed, node 3 refused at
    // `unresolved_area:0.00292` -- a 0.3% defect against a 0.2% ceiling -- and
    // the whole run fell over to six-surface, which then died on a 35.8%
    // passenger cut-out. The fill is the SAME implementation, reading
    // atlas-master-qc's own exported thresholds, so "hole" means here exactly
    // what it means at the master gate.
    //
    // The sheet is one surface, so the fill is pointed at it with a
    // single-zone manifest covering the whole rectangle.
    let repair;
    try {
      repair = await fillMasterCutouts(
        normalized,
        { zones: [{ surfaceKey, x: 0, y: 0, w: pixelWidth, h: pixelHeight }] },
        [surfaceKey],
      );
    } catch (cause) { return { accepted: false, reason: `repair_failed:${String(cause?.message || cause).slice(0, 80)}` }; }
    const convictedPixels = (repair.filled || []).reduce((sum, entry) => sum + Number(entry.pixels || 0), 0);
    if (repair.changed) {
      try {
        // Back to the shape the rest of the cascade takes: the composite can
        // carry the extract's alpha, and every consumer here expects flat sRGB.
        normalized = await sharp(repair.bytes, { limitInputPixels: false })
          .flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb").png().toBuffer();
        holes = await holeRatio(normalized);
      } catch (cause) { return { accepted: false, reason: `repair_failed:${String(cause?.message || cause).slice(0, 80)}` }; }
      repaired = {
        contract: repair.contract,
        pixels: convictedPixels,
        components: (repair.filled || []).reduce((sum, entry) => sum + Number(entry.components || 0), 0),
        unresolvedPixels: (repair.filled || []).reduce((sum, entry) => sum + Number(entry.unresolvedPixels || 0), 0),
        holeRatioBefore: Number(holesBefore.toFixed(5)),
      };
    }
    if (holes > MAX_AUTHORED_HOLE_RATIO && convictedPixels > 0) {
      // A real opening the deterministic repair could not close. Refusing is
      // correct -- this is the six-surface path's own post-repair
      // re-validation, surface-scoped.
      return { accepted: false, reason: `unresolved_area:${holes.toFixed(5)}:repaired:${convictedPixels}` };
    }
    if (holes > MAX_AUTHORED_HOLE_RATIO) {
      // NOTHING WAS CONVICTED, so by the gate's own definition there is no
      // opening here: not one near-black component reaches
      // MIN_CUTOUT_COMPONENT_RATIO (0.25% of the rectangle). What remains is
      // near-black ink SCATTERED across the artwork -- anti-aliased lettering
      // interiors, shadow detail, a dark stripe -- and RULE 0.15 records what
      // it costs to convict that: the first real master through the master
      // gate read 7.3% flat black across 3,761 components averaging 0.002% of
      // the zone, and the aggregate had to be replaced by the concentrated
      // measure precisely because "ink scattered as specks is design; ink
      // concentrated in shapes is a hole."
      //
      // `MAX_AUTHORED_HOLE_RATIO` is an AGGREGATE over a sheet flattened to no
      // alpha, so 0.2% of dark artwork trips it. No threshold moves here: the
      // ceiling is unchanged and still refuses every convicted opening above.
      // What changes is that an unconvicted residue is judged as what the
      // system already calls it everywhere else -- artwork.
      repaired = { ...(repaired || {}), scatteredResidue: Number(holes.toFixed(5)), convicted: 0 };
    }
  }
  return { accepted: true, bytes: normalized, holeRatio: holes, repaired, deliveredWidthPx: width, deliveredHeightPx: height };
}

/**
 * Author ONE surface through the edge. Returns the accepted sheet plus the
 * exact exchange (user turn + signed model turn) for later replay, or throws
 * HeroDriverRefusal after the bounded attempts.
 */
/**
 * HERO-FIRST STAGE 1 — a surface's VEHICLE-SHEET VIEW, at an achievable aspect.
 *
 * Asks `atlas-author` for the SAME flat-sheet contract a single-call ask would
 * use (`atlasHeroSurfaceContract`/`atlasHeroScene`, still "never an on-vehicle
 * photograph" -- this is not a photograph of the vehicle, whatever the stage
 * name says), but the request forces `aspectRatio: "16:9"` regardless of the
 * zone's true ratio. The returned sheet is not a panel and is never cut as
 * one: it is stage 2's design reference, and the edge's receipt says so
 * (`heroStage: "vehicle-view"`).
 *
 * This is what removes the aspect refusal rather than relaxing it. Driver was
 * measured 0/3 on real vehicles: its flank is ~3.6:1 and 21:9 is this model's
 * widest emittable ratio, so `evaluateAuthored` refused every driver tile on
 * drift before judging any artwork. Front measured the same failure live
 * (`front: aspect_drift:1.342`/`1.354`, two real generations): its zone is
 * 3.16:1. Both are in `HERO_VIEW_SURFACES`. A 16:9 sheet is an ask the model
 * answers; stage 2 then extends that same composition into the true aspect.
 */
/**
 * HERO-FIRST is ON by default within the hero cascade, and off by one word.
 *
 * The single-call driver it replaces is measured 0/3 on real vehicles: it asks
 * for a flat strip at the flank's own ratio, which this model cannot emit, so
 * the aspect gate refuses it before any artwork is judged. Defaulting ON is
 * therefore not optimism -- the path it replaces cannot pass. The switch exists
 * because a live surprise must be one deploy input away, exactly like
 * `DESIGNPRO_ATLAS_FIELD_FIRST`.
 */
function heroFirstEnabled() {
  return String(process.env.DESIGNPRO_ATLAS_HERO_FIRST || "").trim().toLowerCase() !== "off";
}

async function authorHeroVehicleView({
  surfaceKey = "driver", zone, heroRequest, creativeContext, callEdge, providerRequest, store, logger = () => {},
}) {
  if (!store || typeof store.putImmutableBytes !== "function") {
    throw new HeroDriverRefusal(surfaceKey, "hero_view_store_missing");
  }
  const { pixelWidth, pixelHeight } = zonePixelSize(zone);
  const candidate = await callEdge({
    mode: "atlas-author",
    surfaceKey,
    surfaceLabel: SURFACE_LABELS[surfaceKey] || surfaceKey.toUpperCase(),
    first: true,
    targetWidthPx: pixelWidth,
    targetHeightPx: pixelHeight,
    widthInches: Number(zone.printWidthIn || zone.trimWidthIn),
    heightInches: Number(zone.printHeightIn || zone.trimHeightIn),
    neighbours: [],
    priorTurns: [],
    creativeContext,
    ...(heroRequest || {}),
    ...(providerRequest ? { providerRequest: { ...providerRequest, attemptKey: `author:${surfaceKey}-view:1` } } : {}),
  }, { attempt: 1 });
  if (String(candidate?.heroStage || "") !== "vehicle-view") {
    throw new HeroDriverRefusal(surfaceKey, `hero_view_stage_mismatch:${String(candidate?.heroStage || "none").slice(0, 40)}`);
  }
  if (!candidate?.bytes?.length) throw new HeroDriverRefusal(surfaceKey, "hero_view_empty");
  // Stage into the prefix the edge will actually attach from. The panel path the
  // edge returns is NOT one of them.
  const staged = await stageHeroView(store, candidate.bytes);
  if (!CALL1_INPUT_PATH.test(staged.storagePath)) {
    throw new HeroDriverRefusal(surfaceKey, `hero_view_path_invalid:${staged.storagePath.slice(0, 80)}`);
  }
  logger(`hero-first ${surfaceKey}: vehicle view ${staged.contentHash.slice(0, 12)} staged (${candidate.aspectRatio || "?"})`);
  return Object.freeze({
    storagePath: staged.storagePath,
    contentHash: staged.contentHash,
    byteSize: staged.byteSize,
    bytes: candidate.bytes,
    imageRequestCount: Number(candidate?.imageRequestCount || 0),
    providerCacheHit: candidate?.providerCacheHit === true,
    exchange: candidate?.userTurn?.role === "user" && candidate?.modelTurn?.role === "model"
      ? { surfaceKey, imageBytes: Number(candidate?.historyImageBytes || 0), turns: [candidate.userTurn, candidate.modelTurn] }
      : null,
  });
}

async function authorSurface({
  surfaceKey, zone, first, neighbours, priorExchanges, heroRequest, creativeContext,
  store, callEdge, providerRequest, logger = () => {}, heroView = null,
}) {
  const { pixelWidth, pixelHeight } = zonePixelSize(zone);
  const staged = await Promise.all(neighbours.map(async (n) => ({
    surfaceKey: n.surfaceKey, surfaceLabel: SURFACE_LABELS[n.surfaceKey] || n.surfaceKey,
    ...(await stageReference(store, n.bytes)),
  })));
  // THE FLATTEN CONTINUES THE VIEW'S CONVERSATION (owner, 2026-09-17).
  // Node 1's exchange is replayed with its thought signature on the part it
  // arrived on, exactly as the cascade continuations replay the driver's, so the
  // model flattens artwork it can still reason about rather than an image handed
  // to a stranger. Prepended, never substituted: the driver has no other history
  // and every later surface keeps its own chain untouched.
  const heroExchange = heroView?.exchange ? [heroView.exchange] : [];
  const chain = trimAuthoringHistory([...heroExchange, ...(Array.isArray(priorExchanges) ? priorExchanges : [])]);
  let lastReason = "not_attempted";
  // The vehicle view's request was SPENT, so it is counted here. Leaving it out
  // under-reports every receipt and every bound that counts image requests --
  // including the canary's "at most two candidates on one contract".
  let imageRequestCount = Number(heroView?.imageRequestCount || 0);
  let providerCacheHits = heroView?.providerCacheHit === true ? 1 : 0;
  for (let attempt = 1; attempt <= AUTHOR_ATTEMPTS; attempt += 1) {
    // Attempt 2 drops the replayed chain: both the designed smaller request
    // and the fallback for a provider that rejects a replayed signature.
    const sentExchanges = attempt === 1 ? chain : [];
    const sendChain = sentExchanges.flatMap((exchange) => exchange.turns);
    let candidate;
    try {
      candidate = await callEdge({
        mode: "atlas-author",
        surfaceKey,
        surfaceLabel: SURFACE_LABELS[surfaceKey],
        first,
        targetWidthPx: pixelWidth,
        targetHeightPx: pixelHeight,
        widthInches: Number(zone.printWidthIn || zone.trimWidthIn),
        heightInches: Number(zone.printHeightIn || zone.trimHeightIn),
        neighbours: staged,
        priorTurns: sendChain,
        creativeContext,
        ...(first ? heroRequest : {}),
        // STAGE 2. With an approved vehicle view the driver request becomes a
        // FLATTEN of it rather than a draw-from-scratch, and the edge switches
        // to the tiered renderFlatTile wording. Attempt 2 raises the tier: the
        // same instruction compressed, so a refusal on length still returns
        // artwork instead of nothing.
        ...(first && heroView ? {
          heroViewStoragePath: heroView.storagePath,
          heroViewContentHash: heroView.contentHash,
          heroFlattenTier: attempt - 1,
        } : {}),
        ...(providerRequest ? { providerRequest: { ...providerRequest, attemptKey: `author:${surfaceKey}:${attempt}` } } : {}),
      }, { attempt });
      imageRequestCount += Number(candidate?.imageRequestCount || 0);
      if (candidate?.providerCacheHit === true) providerCacheHits += 1;
    } catch (cause) {
      const code = String(cause?.code || "");
      // Contract / identity / deployment failures are not this surface's to absorb.
      if (code.startsWith("flat_atlas_") && cause?.providerOutcome !== "not_sent") throw cause;
      lastReason = `${code || "edge_failed"}:${String(cause?.message || cause).slice(0, 140)}`;
      logger(`hero-driver ${surfaceKey}: attempt ${attempt} failed (${lastReason})${sendChain.length ? "; retrying without the reasoning chain" : ""}`);
      continue;
    }
    const verdict = await evaluateAuthored(surfaceKey, candidate?.bytes, pixelWidth, pixelHeight);
    if (verdict.accepted) {
      const exchange = candidate?.userTurn?.role === "user" && candidate?.userTurn?.parts?.length
        && candidate?.modelTurn?.role === "model" && candidate?.modelTurn?.parts?.length
        ? { surfaceKey, imageBytes: Number(candidate?.historyImageBytes || candidate?.panelByteSize || 0), turns: [candidate.userTurn, candidate.modelTurn] }
        : null;
      logger(`hero-driver ${surfaceKey}: accepted on attempt ${attempt} (${verdict.deliveredWidthPx}x${verdict.deliveredHeightPx} -> ${pixelWidth}x${pixelHeight}, holes ${(verdict.holeRatio * 100).toFixed(3)}%)`);
      return Object.freeze({
        surfaceKey, bytes: verdict.bytes, contentHash: sha256(verdict.bytes), pixelWidth, pixelHeight,
        method: first ? (heroView ? "hero_first_flattened" : "hero_driver_authored") : "hero_driver_continuation", deterministic: false,
        attempts: attempt, imageRequestCount, providerCacheHits,
        priorTurnsApplied: sendChain.length,
        signaturesReplayed: Number(candidate?.priorSignaturesReplayed || 0),
        thoughtSignatureCount: Number(candidate?.thoughtSignatureCount || 0),
        neighbourSurfaces: staged.map((n) => n.surfaceKey),
        deliveredWidthPx: verdict.deliveredWidthPx, deliveredHeightPx: verdict.deliveredHeightPx,
        holeRatio: verdict.holeRatio, cutoutRepair: verdict.repaired || null,
        exchange, providerRequestKey: candidate?.providerRequestKey || null,
        rawStoragePath: candidate?.panelStoragePath || null, rawSha256: candidate?.panelSha256 || null,
      });
    }
    lastReason = verdict.reason;
    logger(`hero-driver ${surfaceKey}: attempt ${attempt} refused (${verdict.reason})`);
  }
  throw new HeroDriverRefusal(surfaceKey, lastReason, { attempts: AUTHOR_ATTEMPTS, imageRequestCount });
}

/** PASSENGER = flop(driver). Pure code. The caller's brand-band mirror re-drops lettering forward. */
async function composePassengerPlaceholder(driver, passengerZone) {
  const { pixelWidth, pixelHeight } = zonePixelSize(passengerZone);
  const bytes = await sharp(driver.bytes, { limitInputPixels: false }).flop()
    .resize(pixelWidth, pixelHeight, { fit: "fill" }).png().toBuffer();
  return Object.freeze({
    surfaceKey: "passenger", bytes, contentHash: sha256(bytes), pixelWidth, pixelHeight,
    method: "hero_driver_passenger_flop", deterministic: true, attempts: 0, imageRequestCount: 0,
    providerCacheHits: 0, priorTurnsApplied: 0, signaturesReplayed: 0, thoughtSignatureCount: 0,
    neighbourSurfaces: ["driver"], exchange: null, mirrorOf: driver.contentHash,
  });
}

/**
 * Compose a REFUSED surface deterministically from artwork already authored for
 * this same design, so one refused panel cannot discard the whole run.
 *
 * WHY THIS EXISTS. Measured 2026-09-17 across six consecutive live runs:
 * `master.assemble` was `pending` on every one of them and has never completed.
 * Each run authored driver, passenger, hood and rear cleanly, produced the
 * separated elements (typeset.produce, contact.produce, element.lockup all
 * completed) -- and then threw ALL of it away because ONE surface, usually
 * front (a bumper fascia), was refused. The run failed over to six-surface,
 * which bakes lettering into pixels, which is why every delivered sheet still
 * looks pre-DAG and why the passenger flank still needs a slab re-drop.
 * `master.composite` has therefore never run, so the clean base + composited
 * lockup this architecture exists to produce has never reached a customer.
 *
 * This is NOT a second design authority (RULE 0.26) and not a repair heuristic
 * (RULE 0.32): no model is called and no artwork is invented. It is the same
 * deterministic move `composePassengerPlaceholder` already makes for passenger
 * -- this design's own authored pixels, cover-fitted into the refused zone so
 * the rectangle is continuous, full-bleed and undistorted. `fit: "cover"`,
 * never `"fill"`: cover crops, fill would stretch the artwork.
 *
 * Driver is never composed this way -- it is the design's origin, and a run
 * with no authored driver has nothing to continue from.
 */
async function composeSurfaceFromNeighbour(surfaceKey, donor, zone, reason) {
  const { pixelWidth, pixelHeight } = zonePixelSize(zone);
  const bytes = await sharp(donor.bytes, { limitInputPixels: false })
    .resize(pixelWidth, pixelHeight, { fit: "cover", position: "centre" })
    .flatten({ background: "#ffffff" }).removeAlpha().toColourspace("srgb").png().toBuffer();
  return Object.freeze({
    surfaceKey, bytes, contentHash: sha256(bytes), pixelWidth, pixelHeight,
    method: "hero_driver_neighbour_continuation", deterministic: true, attempts: 0,
    imageRequestCount: 0, providerCacheHits: 0, priorTurnsApplied: 0, signaturesReplayed: 0,
    thoughtSignatureCount: 0, neighbourSurfaces: [donor.surfaceKey], exchange: null,
    continuationOf: donor.contentHash, refusalReason: String(reason || "").slice(0, 300),
  });
}

/**
 * Run the cascade and return ONE assembled 4096² sheet in the manifest zones.
 *
 * @returns {{ bytes, contentHash, surfaces, imageRequestCount, model, promptVersion, provenance, timings }}
 * @throws HeroDriverRefusal when any surface is refused after its bounded attempts.
 */
async function authorHeroDriverMaster({
  manifest, input, store, callEdge, providerRequest = null, creativeContext = "", logger = () => {},
  onSurfaceAuthored = null,
}) {
  if (!manifest?.zones || !store?.putImmutableBytes || typeof callEdge !== "function") {
    throw Object.assign(new Error("hero-driver authoring requires the manifest, store and edge transport"), { code: "flat_atlas_hero_runtime_missing" });
  }
  const zoneOf = (key) => {
    const zone = manifest.zones.find((z) => z.surfaceKey === key);
    if (!zone) throw Object.assign(new Error(`${key} zone missing`), { code: "flat_atlas_hero_zone_invalid" });
    return zone;
  };
  const heroRequest = heroRequestBody(input);
  const authored = new Map();
  const exchanges = new Map();
  const stageTimings = [];
  const startedAt = Date.now();
  for (const stage of AUTHOR_CASCADE) {
    const stageStartedAt = Date.now();
    const results = await Promise.all(stage.map(async (surfaceKey) => {
      if (surfaceKey === "passenger") {
        return composePassengerPlaceholder(authored.get("driver"), zoneOf("passenger"));
      }
      const neighbours = (AUTHOR_NEIGHBOURS[surfaceKey] || []).map((key) => authored.get(key)).filter(Boolean);
      const priorExchanges = (AUTHOR_HISTORY[surfaceKey] || []).map((key) => exchanges.get(key)).filter(Boolean);
      // HERO-FIRST: an eligible surface is TWO calls -- the vehicle-sheet
      // view, then its flatten. Driver is always eligible; front joins it on
      // the SAME measured aspect-drift evidence (HERO_VIEW_SURFACES, above).
      // Everything else in the cascade is unchanged, because what the
      // continuations are shown and replay is the finished FLANK either way.
      // `DESIGNPRO_ATLAS_HERO_FIRST=off` runs every surface single-call.
      let heroView = null;
      if (HERO_VIEW_SURFACES.has(surfaceKey) && heroFirstEnabled()) {
        heroView = await authorHeroVehicleView({
          surfaceKey, zone: zoneOf(surfaceKey), heroRequest, creativeContext, callEdge, providerRequest, store, logger,
        });
      }
      // Driver is ALWAYS the design's from-scratch origin on the edge, split
      // or not (`first` there also gates the full persona assembly). A surface
      // that only sometimes runs the view+flatten pair -- front -- is `first`
      // ONLY on the pass that actually has a view to flatten; with hero-first
      // off (or outside HERO_VIEW_SURFACES) it stays the plain continuation it
      // always was.
      // A FLATTEN SENDS ONLY ITS OWN VIEW (live 9c6008ec: HTTP 546, the edge
      // worker exhausted, eight attempts on surface.front). Front's flatten
      // was carrying its undownscaled view render PLUS driver + passenger as
      // neighbours PLUS driver's flank replayed -- and `trimAuthoringHistory`
      // PINS the driver exchange outside the byte budget, so the heaviest
      // image was the one guaranteed not to be trimmed. Driver's flatten never
      // hit it because its neighbour list is empty and its only history IS its
      // own view.
      //
      // Nothing is lost: a view is authored `first` (no neighbours, no
      // history), so front's composition never saw driver in the first place,
      // and the flatten only re-aspects the view it was handed. This makes
      // every flatten weigh exactly what driver's proven flatten weighs.
      return authorSurface({
        surfaceKey, zone: zoneOf(surfaceKey), first: surfaceKey === "driver" || Boolean(heroView),
        neighbours: heroView ? [] : neighbours,
        priorExchanges: heroView ? [] : priorExchanges,
        heroRequest, creativeContext, store, callEdge, providerRequest, logger, heroView,
      }).catch(async (cause) => {
        // One refused panel must not discard the run -- see
        // composeSurfaceFromNeighbour. Driver still fails: it is the origin.
        if (!(cause instanceof HeroDriverRefusal) || surfaceKey === "driver") throw cause;
        const donor = neighbours[0] || authored.get("driver");
        if (!donor) throw cause;
        logger(`hero-driver ${surfaceKey} refused (${cause.reason}); continuing deterministically from ${donor.surfaceKey}`);
        return composeSurfaceFromNeighbour(surfaceKey, donor, zoneOf(surfaceKey), cause.reason);
      });
    }));
    for (const result of results) {
      authored.set(result.surfaceKey, result);
      if (result.exchange) exchanges.set(result.surfaceKey, result.exchange);
      if (typeof onSurfaceAuthored === "function") {
        try { await onSurfaceAuthored(result); } catch (cause) { logger(`hero-driver onSurfaceAuthored(${result.surfaceKey}) failed: ${String(cause?.message || cause).slice(0, 160)}`); }
      }
    }
    stageTimings.push({ surfaces: [...stage], durationMs: Date.now() - stageStartedAt });
  }
  return assembleHeroMaster({ manifest, authored, stageTimings, startedAt, execution: "in-process" });
}

/**
 * ONE assembly for both executions of the cascade -- the in-process
 * Promise.all above and the durable node graph (atlas-call1-graph.cjs) -- so
 * the sheet, the receipts and the provenance are byte-for-byte the same shape
 * whichever ran the surfaces. `authored` maps surfaceKey -> the frozen surface
 * result (with bytes); `execution` names which orchestration produced it.
 */
async function assembleHeroMaster({ manifest, authored, stageTimings = [], startedAt = Date.now(), execution = "in-process", graph = null }) {
  const canvas = await sharp({ create: { width: CANVAS_PX, height: CANVAS_PX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const assembled = await assembleFinishedMaster(canvas, manifest, manifest.zones.map((zone) => {
    const surface = authored.get(zone.surfaceKey);
    if (!surface?.bytes) throw Object.assign(new Error(`${zone.surfaceKey}: no authored sheet to assemble`), { code: "flat_atlas_hero_surface_missing" });
    return { surfaceKey: zone.surfaceKey, finish: { applied: true, bytes: surface.bytes, contentHash: surface.contentHash } };
  }));
  const surfaces = [...authored.values()].map(({ bytes: _bytes, exchange: _exchange, ...receipt }) => receipt);
  const imageRequestCount = surfaces.reduce((sum, s) => sum + Number(s.imageRequestCount || 0), 0);
  return {
    bytes: assembled.bytes,
    contentHash: assembled.contentHash,
    surfaces,
    imageRequestCount,
    model: "gemini-3-pro-image",
    promptVersion: HERO_DRIVER_PROMPT_VERSION,
    provenance: {
      contract: HERO_DRIVER_CONTRACT, topology: HERO_DRIVER_TOPOLOGY, promptVersion: HERO_DRIVER_PROMPT_VERSION,
      execution, ...(graph ? { graph } : {}),
      imageRequestCount, masterSha256: assembled.contentHash, masterStoragePath: null,
      cascade: AUTHOR_CASCADE.map((stage) => [...stage]),
      surfaces: surfaces.map((s) => ({ surfaceKey: s.surfaceKey, method: s.method, contentHash: s.contentHash,
        attempts: s.attempts, imageRequestCount: s.imageRequestCount, signaturesReplayed: s.signaturesReplayed,
        thoughtSignatureCount: s.thoughtSignatureCount, rawStoragePath: s.rawStoragePath || null, rawSha256: s.rawSha256 || null,
        ...(s.leaseOwner ? { leaseOwner: s.leaseOwner } : {}) })),
      stageTimings, totalMs: Date.now() - startedAt,
    },
    timings: { heroCascadeMs: Date.now() - startedAt, stages: stageTimings },
  };
}

/** The creative fields the hero (driver) request hands the persona brain, verbatim from the frozen input. */
function heroRequestBody(input) {
  const vehicle = input?.vehicle || {};
  const pick = (value) => (value == null ? undefined : String(value));
  return {
    authoringMode: String(input?.mode || "commercial") === "restyle" ? "restyle" : "commercial",
    prompt: pick(input?.brief || input?.prompt || ""),
    enrichedBrief: pick(input?.enrichedBrief),
    finish: pick(input?.finish || "Gloss"),
    substrate: pick(input?.substrate),
    companyName: pick(input?.companyName || input?.businessName),
    mascot: pick(input?.mascot),
    bulletPoints: Array.isArray(input?.bulletPoints) ? input.bulletPoints.map(String) : undefined,
    industryType: pick(input?.industryType || input?.industry),
    phone: pick(input?.phone),
    website: pick(input?.website),
    textLayerPrompt: pick(input?.textLayerPrompt),
    brandColors: pick(input?.brandColors || (Array.isArray(input?.colors) ? input.colors.join(", ") : undefined)),
    fontStyle: pick(input?.fontStyle),
    qrEnabled: input?.qrEnabled === true,
    vehicleYear: pick(vehicle.year), vehicleMake: pick(vehicle.make), vehicleModel: pick(vehicle.model), vehicleType: pick(vehicle.type),
    styleDescriptors: pick(input?.styleDescriptors),
    visionboard_intent: pick(input?.visionboard_intent),
    // ARCHITECTURE_DAG.md §4.1 -- Layer 0. When the element graph is on, the
    // name, logo and contact bar are separate deterministic artifacts, so every
    // authored surface is asked for BACKGROUND ARTWORK ONLY. Off, this is
    // undefined and the request is byte-identical to before.
    cleanBase: cleanBaseEnabled() ? true : undefined,
  };
}

/**
 * The clean base is the element graph's other half: authoring surfaces without
 * lettering only makes sense when something else is going to set it. One flag
 * decides both, so they can never be half-on -- a clean base with no element
 * nodes would ship a wrap with no company name on it at all.
 */
function cleanBaseEnabled(env = process.env) {
  return String(env.DESIGNPRO_ATLAS_ELEMENT_GRAPH || "").trim().toLowerCase() === "on";
}

function heroDriverEnabled(env = process.env) {
  return String(env.DESIGNPRO_ATLAS_TOPOLOGY || "").trim().toLowerCase() === HERO_DRIVER_TOPOLOGY;
}

module.exports = {
  cleanBaseEnabled,
  HERO_DRIVER_TOPOLOGY,
  HERO_DRIVER_CONTRACT,
  HERO_DRIVER_PROMPT_VERSION,
  AUTHOR_CASCADE,
  AUTHOR_NEIGHBOURS,
  AUTHOR_HISTORY,
  AUTHOR_ATTEMPTS,
  HERO_VIEW_SURFACES,
  MAX_AUTHORED_HOLE_RATIO,
  SURFACE_LABELS,
  CANVAS_PX,
  HeroDriverRefusal,
  authorHeroDriverMaster,
  // The node graph (atlas-call1-graph.cjs) runs the SAME primitives, one per
  // node: nothing creative lives outside these three and the assembler.
  authorSurface,
  authorHeroVehicleView,
  stageHeroView,
  CALL1_INPUT_PATH,
  heroFirstEnabled,
  composePassengerPlaceholder,
  composeSurfaceFromNeighbour,
  assembleHeroMaster,
  zonePixelSize,
  heroDriverEnabled,
  heroRequestBody,
  _test: { authorSurface, authorHeroVehicleView, heroFirstEnabled, evaluateAuthored, composePassengerPlaceholder, zonePixelSize, trimAuthoringHistory },
};
