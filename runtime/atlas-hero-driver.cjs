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

const HERO_DRIVER_TOPOLOGY = "hero-driver";
const HERO_DRIVER_CONTRACT = "designpro.atlas-hero-driver.v1";
// Must equal the edge's ATLAS_AUTHOR_PROMPT_VERSION; callAtlasAuthorEdge refuses a mismatch.
const HERO_DRIVER_PROMPT_VERSION = "atlas-author-hero-driver.20260911.v1";
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
  roof: Object.freeze(["driver", "passenger", "hood", "front", "rear"]),
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
const MAX_ASPECT_DRIFT_RATIO = 1.12;
// An authored sheet must arrive whole. Finishing compares against a crop; there
// is no crop here, so the bar is absolute: no more than 0.2% of the rectangle
// unresolved (transparent or flat black).
const MAX_AUTHORED_HOLE_RATIO = 0.002;
const REFERENCE_LONG_EDGE_PX = 1280;
const REFERENCE_JPEG_QUALITY = 82;

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
  if (holes > MAX_AUTHORED_HOLE_RATIO) return { accepted: false, reason: `unresolved_area:${holes.toFixed(5)}` };
  return { accepted: true, bytes: normalized, holeRatio: holes, deliveredWidthPx: width, deliveredHeightPx: height };
}

/**
 * Author ONE surface through the edge. Returns the accepted sheet plus the
 * exact exchange (user turn + signed model turn) for later replay, or throws
 * HeroDriverRefusal after the bounded attempts.
 */
async function authorSurface({
  surfaceKey, zone, first, neighbours, priorExchanges, heroRequest, creativeContext,
  store, callEdge, providerRequest, logger = () => {},
}) {
  const { pixelWidth, pixelHeight } = zonePixelSize(zone);
  const staged = await Promise.all(neighbours.map(async (n) => ({
    surfaceKey: n.surfaceKey, surfaceLabel: SURFACE_LABELS[n.surfaceKey] || n.surfaceKey,
    ...(await stageReference(store, n.bytes)),
  })));
  const chain = trimAuthoringHistory(Array.isArray(priorExchanges) ? priorExchanges : []);
  let lastReason = "not_attempted";
  let imageRequestCount = 0;
  let providerCacheHits = 0;
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
        method: first ? "hero_driver_authored" : "hero_driver_continuation", deterministic: false,
        attempts: attempt, imageRequestCount, providerCacheHits,
        priorTurnsApplied: sendChain.length,
        signaturesReplayed: Number(candidate?.priorSignaturesReplayed || 0),
        thoughtSignatureCount: Number(candidate?.thoughtSignatureCount || 0),
        neighbourSurfaces: staged.map((n) => n.surfaceKey),
        deliveredWidthPx: verdict.deliveredWidthPx, deliveredHeightPx: verdict.deliveredHeightPx,
        holeRatio: verdict.holeRatio, exchange, providerRequestKey: candidate?.providerRequestKey || null,
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
      return authorSurface({
        surfaceKey, zone: zoneOf(surfaceKey), first: surfaceKey === "driver", neighbours, priorExchanges,
        heroRequest, creativeContext, store, callEdge, providerRequest, logger,
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
  };
}

function heroDriverEnabled(env = process.env) {
  return String(env.DESIGNPRO_ATLAS_TOPOLOGY || "").trim().toLowerCase() === HERO_DRIVER_TOPOLOGY;
}

module.exports = {
  HERO_DRIVER_TOPOLOGY,
  HERO_DRIVER_CONTRACT,
  HERO_DRIVER_PROMPT_VERSION,
  AUTHOR_CASCADE,
  AUTHOR_NEIGHBOURS,
  AUTHOR_HISTORY,
  AUTHOR_ATTEMPTS,
  MAX_AUTHORED_HOLE_RATIO,
  SURFACE_LABELS,
  CANVAS_PX,
  HeroDriverRefusal,
  authorHeroDriverMaster,
  // The node graph (atlas-call1-graph.cjs) runs the SAME primitives, one per
  // node: nothing creative lives outside these three and the assembler.
  authorSurface,
  composePassengerPlaceholder,
  assembleHeroMaster,
  zonePixelSize,
  heroDriverEnabled,
  heroRequestBody,
  _test: { authorSurface, evaluateAuthored, composePassengerPlaceholder, zonePixelSize, trimAuthoringHistory },
};
