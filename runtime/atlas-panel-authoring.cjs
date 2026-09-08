"use strict";

/**
 * A.T.L.A.S. PER-SURFACE PANEL AUTHORING (owner ruling, Trish 2026-09-08)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Owner, in her own words: *"Why can't it be designed like my last version of
 * designproai before migration — one continuous design, in parallel, with the
 * other sides being fed the sides: driver, then flipped passenger, then driver
 * and passenger sent to design hood, then driver, passenger, hood, sent to
 * design rear, etc. All shown atlas. So it happens continuously. In parallel."*
 *
 * WHAT THIS IS
 * ------------
 * Call 1 still authors ONE cohesive master and it remains the sole creative
 * authority (RULE 0.30) and the sole lineage identity (`sourceMasterHash`).
 * The runtime still cuts six rectangles out of it deterministically.
 *
 * What is new is what happens to each rectangle AFTER the cut. Each surface is
 * handed back to the model on its own, at its own proportion, shown the
 * neighbours that are already finished, and returned as ONE WHOLE SHEET.
 *
 * WHY THE CUT ALONE WAS NOT ENOUGH — both defects are geometric, not creative:
 *
 *   1. A HOLE IN THE MASTER IS A HOLE IN THE PANEL. The model paints one
 *      picture across a shared canvas; whatever it leaves unresolved where a
 *      wheel opening sits becomes a missing-artwork field in a production
 *      panel (RULE 0.32). Measured 2026-09-08: generation `1ea7adfc` refused
 *      two candidates for exactly this and the run died with nothing.
 *   2. A WORD THAT STRADDLES A BOUNDARY IS SEVERED BY THE CUT. Geometry has no
 *      opinion about lettering, so a headline crossing a territory edge is
 *      simply sliced.
 *
 * A finishing pass over ONE rectangle has neither problem to inherit: there is
 * no shared canvas to hallucinate a layout into, and the sheet's own edges are
 * the only edges there are.
 *
 * PASSENGER IS AUTHORED, NEVER MIRRORED
 * -------------------------------------
 * The owner's sketch says "then flipped passenger". Passenger is instead
 * FINISHED IN ITS OWN PASS, shown the finished Driver as its neighbour — which
 * delivers the same intent (Passenger derives its continuity from Driver)
 * without the one thing a flip cannot survive: **a horizontal flip mirrors
 * every letterform**, so a phone number and a company name would print
 * backwards down the passenger flank. That is a fact about mirroring, not a
 * preference. It is also what RULE 0 already requires — *"Passenger is its own
 * named Call-1 authority and must never be replaced by mirrored Driver
 * pixels"* — so the cascade and the standing rule agree.
 *
 * ORDER, AND WHAT "IN PARALLEL" MEANS HERE
 * ----------------------------------------
 * The cascade is necessarily sequential — a neighbour cannot be shown to a
 * sheet before it exists. What runs in parallel is everything downstream:
 * each finished panel is published and its 3D proof released the instant it
 * lands, exactly as `cutCallOnePanels` already streams (RULE 0.23, RULE 0.28
 * §6). Nothing waits for the set.
 *
 * IT CANNOT LOSE A RUN
 * --------------------
 * Every failure path returns the deterministic crop unchanged. A refused
 * finish, a transport error, a wrong-proportion return, a panel that comes
 * back worse than it went in — all of them fall back to exactly the bytes
 * today's pipeline would have shipped. This path can raise the floor and can
 * never lower it, which is the only reason it is safe to put in front of a
 * customer before it has a long measurement history.
 */

const sharp = require("sharp");
const { createHash } = require("node:crypto");

const {
  CUTOUT_ALPHA_MAX,
  FLAT_BLACK_CHANNEL_MAX,
  MIN_CUTOUT_COMPONENT_RATIO,
} = require("./atlas-master-qc.cjs");

const PANEL_AUTHORING_CONTRACT = "designpro.atlas-panel-authoring.v1";
const PANEL_AUTHORING_PROMPT_VERSION = "atlas-panel-finish.20260908.v3-multi-turn";

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

const SURFACE_LABELS = Object.freeze({
  driver: "DRIVER SIDE",
  passenger: "PASSENGER SIDE",
  hood: "HOOD",
  roof: "ROOF",
  front: "FRONT",
  rear: "REAR",
});

/** One finishing attempt per surface. See `finishPanel`. */
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
 * `{ bytes: panel.bytes, applied: false, reason }` in every other case. The
 * caller can use the result unconditionally — that is the point.
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
  // The conversation so far, as `{ role, parts }` turns carrying text and
  // Gemini's encrypted thought signatures — never images. `finishPanel`
  // appends this pass's own model turn to it on success, so the caller can
  // hand a growing chain to the next surface. See THOUGHT SIGNATURES below.
  priorTurns = [],
  creativeContext = "",
  store,
  callEdge,
  logger = () => {},
} = {}) {
  const unchanged = (reason) => Object.freeze({
    contract: PANEL_AUTHORING_CONTRACT,
    surfaceKey: panel.surfaceKey,
    applied: false,
    reason,
    bytes: panel.bytes,
    contentHash: panel.contentHash,
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
  // THOUGHT SIGNATURES ARE ADDITIVE, AND THE FIRST THING DROPPED.
  //
  // Passing the chain back is the documented practice for multi-turn image
  // editing, and it is the right default here. But it is also the newest and
  // least-exercised thing in this request: signature acceptance rules are the
  // provider's, not ours, and a malformed history would fail EVERY surface
  // identically rather than one of them. So the second attempt deliberately
  // drops the history and asks again with nothing but the images. A run
  // therefore degrades to the previous, measured behaviour instead of failing.
  let chain = Array.isArray(priorTurns) ? priorTurns : [];
  for (let attempt = 1; attempt <= PANEL_FINISH_ATTEMPTS; attempt += 1) {
    const sendChain = attempt === 1 ? chain : [];
    let candidate;
    try {
      candidate = await callEdge({
        mode: "atlas-panel",
        surfaceKey: panel.surfaceKey,
        surfaceLabel: SURFACE_LABELS[panel.surfaceKey] || panel.surfaceKey,
        sourcePanelStoragePath: staged.source.storagePath,
        sourcePanelHash: staged.source.contentHash,
        atlasReferenceStoragePath: staged.atlas?.storagePath || null,
        atlasReferenceHash: staged.atlas?.contentHash || null,
        neighbours: staged.neighbours,
        priorTurns: sendChain,
        creativeContext,
      });
    } catch (cause) {
      lastReason = `edge_failed:${String(cause?.message || cause).slice(0, 140)}`;
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
        bytes: verdict.bytes,
        contentHash: sha256(verdict.bytes),
        preFinishHash: panel.contentHash,
        holeRatioBefore: beforeHoles,
        holeRatioAfter: verdict.afterHoles,
        neighbourSurfaces: staged.neighbours.map((n) => n.surfaceKey),
        atlasReferenceApplied: Boolean(staged.atlas),
        // THE CHAIN THE NEXT SURFACE SHOULD BE HANDED.
        //
        // The user turn is a one-line note rather than a replay of the whole
        // instruction: the point of the history is the model's own reasoning,
        // carried by the signature on its turn, not a second copy of prompts
        // it has already answered. If this attempt fell back to no history,
        // the chain restarts from here rather than pretending continuity that
        // the provider never acknowledged.
        nextTurns: [
          ...sendChain,
          { role: "user", parts: [{ text: `Finish the ${SURFACE_LABELS[panel.surfaceKey] || panel.surfaceKey} sheet of this set.` }] },
          ...(candidate?.modelTurn?.parts?.length ? [candidate.modelTurn] : []),
        ],
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
  SURFACE_LABELS,
  finishPanel,
  _test: { holeRatio, evaluateCandidate },
};
