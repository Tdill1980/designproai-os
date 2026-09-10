"use strict";

/**
 * Optional A.T.L.A.S. per-surface finishing.
 *
 * Call 1 first authors the complete six-surface source. Its existing master
 * gates must pass before this optional phase can run. Each edit sees the
 * original source and the completed earlier sheets in the declared order;
 * Passenger remains forward-reading and is never a flipped bitmap.
 *
 * This module does not publish a canonical panel or accept a master. Its
 * local checks establish only a candidate's dimensions and non-regressing
 * hole measurements. The caller assembles the finished rectangles back into
 * their exact original zones, runs the existing whole-master gates, and only
 * then publishes one canonical master plus deterministic crops of that master.
 *
 * Exact user/model exchanges preserve opaque thought signatures on their
 * original parts. The runtime stores those exchanges privately so a worker
 * restart can resume the same completed edits. Known failed or refused edits
 * retain the original crop. An unknown provider outcome first recovers the
 * SAME request through bounded cache-only reads (`invokeAtlasAuthoring`); if
 * nothing was banked, that surface also retains the original crop and the
 * cascade continues. Nothing here ever authorizes a replacement image call
 * against an unresolved one, and nothing here fails the generation over an
 * optional edit (see `finishingFailureDisposition`).
 */

const sharp = require("sharp");
const { createHash } = require("node:crypto");

const {
  CUTOUT_ALPHA_MAX,
  FLAT_BLACK_CHANNEL_MAX,
  MIN_CUTOUT_COMPONENT_RATIO,
} = require("./atlas-master-qc.cjs");

const PANEL_AUTHORING_CONTRACT = "designpro.atlas-panel-authoring.v1";
const PANEL_AUTHORING_PROMPT_VERSION = "atlas-panel-finish.20260908.v5-exact-exchanges";

/**
 * The owner's cascade. Driver leads because Driver is the shot the customer
 * sees first (RULE 0.23), and every later surface is shown the surfaces that
 * most constrain it: the two flanks carry the design's identity, so the centre
 * four are composed against them rather than against each other.
 */
const PANEL_CASCADE_ORDER = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);

/**
 * Which already-finished sheets each surface is shown: ALL of them.
 *
 * Owner ruling 2026-09-08 — *"make sure each side is getting Atlas example as
 * well as the other sides"* — so the cascade is cumulative rather than a
 * hand-picked subset, and Rear, last in line, is composed against all five of
 * its siblings plus the A.T.L.A.S.
 *
 * This is affordable only because references travel downscaled (see below).
 * An earlier draft capped this at three, reasoning about full-resolution PNGs
 * against a ~20MB request; shrinking the references removed the constraint
 * that the cap existed to respect.
 */
const PANEL_NEIGHBOURS = Object.freeze({
  driver: Object.freeze([]),
  passenger: Object.freeze(["driver"]),
  hood: Object.freeze(["driver", "passenger"]),
  roof: Object.freeze(["driver", "passenger", "hood"]),
  front: Object.freeze(["driver", "passenger", "hood", "roof"]),
  rear: Object.freeze(["driver", "passenger", "hood", "roof", "front"]),
});

/**
 * REFERENCES TRAVEL DOWNSCALED. The subject sheet does not.
 *
 * The A.T.L.A.S. master and every finished sibling are attached to each pass
 * for palette, motif family and continuity — "visual DNA", in the provider's
 * own words. None of their pixels are copied, so none of them need to be
 * lossless: six 4K PNGs would exhaust the ~20MB model-request budget long
 * before the 14-asset reference ceiling mattered, and that budget, not the
 * count, is what actually binds. At 1280px on the long edge and JPEG q82 a
 * reference is a couple of hundred kilobytes and still carries every colour
 * and shape relationship the pass needs.
 *
 * The SUBJECT sheet stays full-resolution PNG. It is the only image whose
 * pixels are being redrawn, and degrading it would degrade the panel.
 */
const REFERENCE_LONG_EDGE_PX = 1280;
const REFERENCE_JPEG_QUALITY = 82;

/**
 * HOW MUCH CONVERSATION TO CARRY.
 *
 * A replayed model turn is not free. A thought signature is only meaningful on
 * the part it arrived on, and on an image response that part IS the image — so
 * honouring the contract means each retained turn re-sends a full sheet
 * (~1-5MB) edge-side. Six of them would exceed the ~20MB model-request budget
 * somewhere around the roof.
 *
 * So the chain is trimmed from the OLDEST end, in whole user/model exchanges,
 * until it fits. Trimming whole exchanges matters: a model turn without the
 * user turn that prompted it is a reply to nothing, and a user turn whose
 * answer has been dropped invites the model to answer it twice.
 *
 * The most recent exchanges are the ones worth keeping — the sheet drawn
 * immediately before this one is the strongest constraint on the next — and
 * every earlier sheet is still present as a downscaled reference regardless,
 * so trimming costs reasoning continuity, never visual continuity.
 */
const HISTORY_IMAGE_BUDGET_BYTES = 7 * 1024 * 1024;
const HISTORY_IMAGE_BUDGET_ASSETS = 7; // leaves room for subject, master and five siblings
const MAX_HISTORY_EXCHANGES = 3;

const SURFACE_LABELS = Object.freeze({
  driver: "DRIVER SIDE",
  passenger: "PASSENGER SIDE",
  hood: "HOOD",
  roof: "ROOF",
  front: "FRONT",
  rear: "REAR",
});

/** At most two attempts per surface; an unresolved or refused provider
 * outcome ends the surface on its crop and never spends the second. */
const PANEL_FINISH_ATTEMPTS = 2;

/**
 * How far the returned proportion may drift from the crop's before the return
 * is refused. An edit that ignored its input's shape comes back at a menu
 * ratio — 1:1 or 16:9 — which against a 4.2:1 flank is a miss by a factor of
 * four, so this is deliberately loose: it convicts a different shape, not a
 * few pixels of rounding.
 */
const MAX_ASPECT_DRIFT_RATIO = 1.12;

/**
 * A finished sheet may not come back with MORE unresolved area than it went in
 * with. The whole point of the pass is to close holes; one that opens them is
 * a regression and is discarded in favour of the crop.
 */
const MIN_HOLE_IMPROVEMENT = 1.0;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Trim the conversation to what the next request can afford, dropping whole
 * exchanges from the oldest end. See HISTORY_IMAGE_BUDGET_BYTES.
 *
 * An exchange whose own image alone exceeds the budget is dropped rather than
 * kept as a lone survivor: retaining it would guarantee the very
 * request-too-large failure the trim exists to prevent.
 */
function trimHistory(exchanges) {
  const kept = [];
  let bytes = 0;
  let images = 0;
  // Walk backwards so the newest exchanges — the strongest constraint on the
  // sheet about to be drawn — are the ones that survive.
  for (let i = exchanges.length - 1; i >= 0; i -= 1) {
    const exchange = exchanges[i];
    const cost = Number(exchange?.imageBytes || 0);
    const imageCount = (exchange?.turns || []).flatMap((turn) => turn.parts || []).filter((part) => part.imageRef).length;
    if (kept.length >= MAX_HISTORY_EXCHANGES) break;
    if (!Number.isFinite(cost) || cost < 0 || bytes + cost > HISTORY_IMAGE_BUDGET_BYTES
      || images + imageCount > HISTORY_IMAGE_BUDGET_ASSETS) break;
    bytes += cost;
    images += imageCount;
    kept.unshift(exchange);
  }
  return kept;
}

/**
 * The share of a sheet that is a missing-artwork field.
 *
 * Deliberately the SAME predicate the master gate and the deterministic fill
 * share (`CUTOUT_ALPHA_MAX` / `FLAT_BLACK_CHANNEL_MAX`, exported from
 * atlas-master-qc). CLAUDE.md's standing warning applies here too: two
 * definitions of "hole" would let this accept a sheet the gate convicts.
 *
 * This is an aggregate, not the gate's component analysis — it exists to
 * compare one sheet against itself before and after, which a single number
 * does correctly and cheaply.
 */
async function holeRatio(bytes) {
  const { data, info } = await sharp(bytes, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const total = info.width * info.height;
  if (total <= 0) return 1;
  let holes = 0;
  for (let i = 0; i < data.length; i += channels) {
    const alpha = channels > 3 ? data[i + 3] : 255;
    if (alpha <= CUTOUT_ALPHA_MAX) { holes += 1; continue; }
    if (data[i] <= FLAT_BLACK_CHANNEL_MAX
      && data[i + 1] <= FLAT_BLACK_CHANNEL_MAX
      && data[i + 2] <= FLAT_BLACK_CHANNEL_MAX) {
      holes += 1;
    }
  }
  return holes / total;
}

/**
 * Finish ONE surface.
 *
 * Returns `{ bytes, contentHash, applied: true, ... }` when the model returned
 * a sheet that measured at least as whole as the crop, and
 * `{ bytes: panel.bytes, applied: false, reason }` after bounded candidate
 * refusal. Typed transport, identity and recovery failures propagate so a
 * restart resumes the same request. The caller must still validate the
 * assembled master before publication.
 *
 * @param {object} panel        the deterministic crop, as `cutCallOnePanels` built it
 * @param {object[]} neighbours already-finished panels, in cascade order
 */
async function finishPanel(panel, {
  neighbours = [],
  // The whole accepted A.T.L.A.S. sheet. Every surface is shown it, so each
  // one is composed knowing what the complete design looks like rather than
  // only its own crop (owner ruling 2026-09-08).
  atlasReferenceBytes = null,
  // The conversation so far, as `{ surfaceKey, imageBytes, turns }` exchanges.
  // Each exchange is the user turn that asked for a sheet plus the model turn
  // that answered — replayed faithfully, every signature still on the part it
  // arrived on, the image carried by reference. `finishPanel` returns the
  // trimmed chain as `nextExchanges` for the following surface.
  priorExchanges = [],
  creativeContext = "",
  store,
  callEdge,
  logger = () => {},
} = {}) {
  let attempts = 0;
  let imageRequestCount = 0;
  let providerCacheHits = 0;
  const unchanged = (reason, extra = {}) => Object.freeze({
    contract: PANEL_AUTHORING_CONTRACT,
    surfaceKey: panel.surfaceKey,
    applied: false,
    attempts,
    imageRequestCount,
    providerCacheHits,
    reason,
    bytes: panel.bytes,
    contentHash: panel.contentHash,
    ...extra,
  });

  if (typeof callEdge !== "function" || !store?.putImmutableBytes) {
    return unchanged("transport_unavailable");
  }

  let beforeHoles;
  try {
    beforeHoles = await holeRatio(panel.bytes);
  } catch (cause) {
    return unchanged(`measure_failed:${String(cause?.message || cause).slice(0, 120)}`);
  }

  // The crop and every neighbour are staged by content hash, which is what
  // lets the edge prove the bytes it downloaded are the artifact the caller
  // named rather than trusting a path.
  const stage = async (bytes) => {
    const hash = sha256(bytes);
    const storagePath = `atlas-call1-inputs/${hash}.png`;
    await store.putImmutableBytes({ storagePath, bytes, contentType: "image/png" });
    return { storagePath, contentHash: hash };
  };
  /** A reference, downscaled — see REFERENCE_LONG_EDGE_PX. */
  const stageReference = async (bytes) => {
    const small = await sharp(bytes, { limitInputPixels: false })
      .resize({
        width: REFERENCE_LONG_EDGE_PX,
        height: REFERENCE_LONG_EDGE_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: REFERENCE_JPEG_QUALITY, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const hash = sha256(small);
    const storagePath = `atlas-call1-inputs/${hash}.jpg`;
    await store.putImmutableBytes({ storagePath, bytes: small, contentType: "image/jpeg" });
    return { storagePath, contentHash: hash };
  };

  let staged;
  try {
    staged = {
      // Full resolution: this is the only image whose pixels are redrawn.
      source: await stage(panel.bytes),
      atlas: atlasReferenceBytes?.length ? await stageReference(atlasReferenceBytes) : null,
      neighbours: await Promise.all(neighbours.map(async (neighbour) => ({
        surfaceKey: neighbour.surfaceKey,
        surfaceLabel: SURFACE_LABELS[neighbour.surfaceKey] || neighbour.surfaceKey,
        ...(await stageReference(neighbour.bytes)),
      }))),
    };
  } catch (cause) {
    return unchanged(`staging_failed:${String(cause?.message || cause).slice(0, 120)}`);
  }

  let lastReason = "not_attempted";
  // The existing bounded candidate fallback starts a fresh image-reference
  // request after a measured candidate refusal. Its context is explicit; it
  // never attaches an old model signature to newly invented history. Typed
  // provider/transport failures leave this loop instead of spending that
  // second candidate or silently removing the signed conversation.
  const chain = trimHistory(Array.isArray(priorExchanges) ? priorExchanges : []);
  for (let attempt = 1; attempt <= PANEL_FINISH_ATTEMPTS; attempt += 1) {
    const sentExchanges = attempt === 1 ? chain : [];
    const sendChain = sentExchanges.flatMap((exchange) => exchange.turns);
    // Decide AFTER trimming and for EACH attempt. Otherwise dropping history
    // also drops the siblings that were excluded in favour of that history.
    const inConversation = new Set(sentExchanges.map((exchange) => exchange.surfaceKey));
    const sentNeighbours = staged.neighbours.filter((neighbour) => !inConversation.has(neighbour.surfaceKey));
    let candidate;
    try {
      attempts = attempt;
      candidate = await callEdge({
        mode: "atlas-panel",
        surfaceKey: panel.surfaceKey,
        surfaceLabel: SURFACE_LABELS[panel.surfaceKey] || panel.surfaceKey,
        sourcePanelStoragePath: staged.source.storagePath,
        sourcePanelHash: staged.source.contentHash,
        atlasReferenceStoragePath: staged.atlas?.storagePath || null,
        atlasReferenceHash: staged.atlas?.contentHash || null,
        neighbours: sentNeighbours,
        priorTurns: sendChain,
        creativeContext,
      }, { attempt });
      imageRequestCount += Number(candidate?.imageRequestCount || 0);
      if (candidate?.providerCacheHit === true) providerCacheHits += 1;
    } catch (cause) {
      const disposition = finishingFailureDisposition(cause);
      if (disposition.action === "throw") throw cause;
      if (disposition.action === "retain") {
        // The crop is correct by cut. A provider outcome that is unknown or
        // refused is never permission to spend a second image request against
        // it, and never a reason to lose the design (RULE 0.15: a defect that
        // only exists in an optional edit must not destroy the run).
        logger(`atlas-panel ${panel.surfaceKey}: ${disposition.reason} on attempt ${attempt}; `
          + "the deterministic crop is retained and no further image request is made");
        return unchanged(disposition.reason, {
          providerOutcome: String(cause?.providerOutcome || "unknown"),
          providerFailureRecorded: cause?.providerFailureRecorded === true,
        });
      }
      lastReason = disposition.reason;
      if (attempt === 1 && sendChain.length > 0) {
        logger(`atlas-panel ${panel.surfaceKey}: retrying without the reasoning chain (${lastReason})`);
      }
      continue;
    }

    const verdict = await evaluateCandidate(panel, candidate, beforeHoles);
    if (verdict.accepted) {
      logger(`atlas-panel ${panel.surfaceKey}: finished on attempt ${attempt} `
        + `(holes ${(beforeHoles * 100).toFixed(2)}% -> ${(verdict.afterHoles * 100).toFixed(2)}%)`);
      return Object.freeze({
        contract: PANEL_AUTHORING_CONTRACT,
        promptVersion: PANEL_AUTHORING_PROMPT_VERSION,
        surfaceKey: panel.surfaceKey,
        applied: true,
        attempts: attempt,
        imageRequestCount,
        providerCacheHits,
        bytes: verdict.bytes,
        contentHash: sha256(verdict.bytes),
        preFinishHash: panel.contentHash,
        holeRatioBefore: beforeHoles,
        holeRatioAfter: verdict.afterHoles,
        neighbourSurfaces: sentNeighbours.map((n) => n.surfaceKey),
        atlasReferenceApplied: Boolean(staged.atlas),
        // THE CHAIN THE NEXT SURFACE SHOULD BE HANDED.
        //
        // Keep the ORIGINAL user/model exchange, or keep neither. A summary of
        // the user turn is not faithful context for the signed model reply.
        // A mixed deployment with an older edge can still return a panel, but
        // does not acquire invented history. Retries restart the chain.
        nextExchanges: trimHistory([
          ...sentExchanges,
          ...(candidate?.userTurn?.role === "user" && candidate?.userTurn?.parts?.length
            && candidate?.modelTurn?.role === "model" && candidate?.modelTurn?.parts?.length ? [{
            surfaceKey: panel.surfaceKey,
            imageBytes: Number(candidate?.historyImageBytes || candidate?.panelByteSize || 0),
            turns: [candidate.userTurn, candidate.modelTurn],
          }] : []),
        ]),
        thoughtSignatureCount: Number(candidate?.thoughtSignatureCount || 0),
        priorTurnsApplied: sendChain.length,
      });
    }
    lastReason = verdict.reason;
    logger(`atlas-panel ${panel.surfaceKey}: attempt ${attempt} refused (${verdict.reason})`);
  }
  return unchanged(lastReason);
}

/**
 * What ONE failed finishing exchange means for its surface.
 *
 * Measured 2026-09-09 (New Aura, roof): a single `provider_outcome_unknown` on
 * an OPTIONAL edit was rethrown here and failed the whole generation as
 * terminal, with the accepted master already in hand and three finished sheets
 * checkpointed. The finishing pass exists to improve a panel that is already
 * valid; it must never be the reason a customer has no design at all.
 *
 * | failure                                              | action | why |
 * |---|---|---|
 * | `provider_outcome_unknown` (after `invokeAtlasAuthoring`'s bounded cache-only recovery) | RETAIN the crop, stop | the image may have been produced and paid for; a second attempt is a second image request against it |
 * | any other `provider_*` (429, 4xx/5xx, cache conflict)           | RETAIN the crop, stop | the provider answered and refused; retrying spends without new evidence |
 * | `flat_atlas_panel_edge_call_failed` with `providerOutcome: not_sent` | RETRY within the budget | the edge refused before any image was requested (input download, request size); attempt 2 is the designed smaller request without the chain |
 * | any other `flat_atlas_*`, or `operator_required` without a code    | THROW | contract, identity, deployment or storage failures are not this surface's to absorb; the worker resumes or an operator looks |
 * | anything else                                                       | RETRY within the budget | unchanged behaviour |
 *
 * "Retain" is exactly what a measured candidate refusal already does; the
 * result carries the provider outcome so `masterFinishing.surfaces` and the
 * private checkpoint both say the sheet is the cut, not a finished edit.
 */
function finishingFailureDisposition(cause) {
  const code = String(cause?.code || "");
  if (code === "provider_outcome_unknown") return { action: "retain", reason: "provider_outcome_unknown" };
  if (code.startsWith("provider_")) return { action: "retain", reason: `provider_refused:${code}` };
  if (code === "flat_atlas_panel_edge_call_failed" && cause?.providerOutcome === "not_sent") {
    return { action: "retry", reason: `edge_refused_before_send:${String(cause?.message || cause).slice(0, 140)}` };
  }
  if (code.startsWith("flat_atlas_") || cause?.providerRetryDisposition === "operator_required") {
    return { action: "throw" };
  }
  return { action: "retry", reason: `edge_failed:${String(cause?.message || cause).slice(0, 140)}` };
}

/**
 * Accept or refuse one returned sheet.
 *
 * A refusal here is cheap and silent — the crop is already correct-by-cut, so
 * the bar for REPLACING it is "measurably at least as whole, and the right
 * shape". Anything else keeps what we had.
 */
async function evaluateCandidate(panel, candidate, beforeHoles) {
  const bytes = candidate?.bytes;
  if (!bytes || !bytes.length) return { accepted: false, reason: "empty_return" };

  let meta;
  try {
    meta = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch (cause) {
    return { accepted: false, reason: `undecodable:${String(cause?.message || cause).slice(0, 80)}` };
  }
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (width < 8 || height < 8) return { accepted: false, reason: "degenerate_size" };

  // PROPORTION. The edge asks for no aspect ratio so the edit follows its
  // input; this is where that assumption is CHECKED rather than trusted. A
  // return at a menu ratio against a 4.2:1 flank fails here and the crop wins.
  const wantAspect = panel.pixelWidth / panel.pixelHeight;
  const gotAspect = width / height;
  const drift = wantAspect > gotAspect ? wantAspect / gotAspect : gotAspect / wantAspect;
  if (!Number.isFinite(drift) || drift > MAX_ASPECT_DRIFT_RATIO) {
    return { accepted: false, reason: `aspect_drift:${drift.toFixed(3)}` };
  }

  // Resize to the EXACT zone rectangle. Every downstream dimension, PPI and
  // square-footage field is computed from the zone, so the finished sheet has
  // to occupy the same pixels the crop did. The drift check above is what
  // keeps this a resample rather than a distortion.
  let normalized;
  try {
    normalized = await sharp(bytes, { limitInputPixels: false })
      .resize(panel.pixelWidth, panel.pixelHeight, { fit: "fill" })
      .flatten({ background: "#ffffff" })
      .removeAlpha()
      .toColourspace("srgb")
      .png()
      .toBuffer();
  } catch (cause) {
    return { accepted: false, reason: `resize_failed:${String(cause?.message || cause).slice(0, 80)}` };
  }

  let afterHoles;
  try {
    afterHoles = await holeRatio(normalized);
  } catch (cause) {
    return { accepted: false, reason: `measure_failed:${String(cause?.message || cause).slice(0, 80)}` };
  }
  // Strictly no worse. A pass that opens holes is a regression, however
  // pretty the rest of it looks.
  if (afterHoles > beforeHoles * MIN_HOLE_IMPROVEMENT + 1e-9) {
    return { accepted: false, reason: `holes_increased:${afterHoles.toFixed(5)}>${beforeHoles.toFixed(5)}` };
  }
  return { accepted: true, bytes: normalized, afterHoles };
}

module.exports = {
  PANEL_AUTHORING_CONTRACT,
  PANEL_AUTHORING_PROMPT_VERSION,
  PANEL_CASCADE_ORDER,
  PANEL_NEIGHBOURS,
  PANEL_FINISH_ATTEMPTS,
  MAX_ASPECT_DRIFT_RATIO,
  MAX_HISTORY_EXCHANGES,
  HISTORY_IMAGE_BUDGET_BYTES,
  SURFACE_LABELS,
  finishPanel,
  finishingFailureDisposition,
  _test: { holeRatio, evaluateCandidate, trimHistory },
};
