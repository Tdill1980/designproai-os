/**
 * Platform-neutral DesignPro flat-master producer.
 *
 * This module owns only the protected per-surface producer ladder and its
 * bounded scheduling. Supabase, HTTP, persistence, hashing, and product
 * adapters remain outside and are supplied as callbacks.
 */

export const DESIGNPRO_FLAT_MASTER_PRODUCER_VERSION = 2;
export const DEFAULT_PROOF_CANDIDATES = 3;
export const DEFAULT_PANEL_POOL = 3;
export const DEFAULT_SIDE_FIELD_POOL = 3;

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * Run the sanctioned all-surface ladder.
 *
 * Each callback is intentionally expressed in platform-neutral values. The
 * browser adapter and durable server worker therefore use the same rung
 * ordering, retry count, honest-gap rule, canonical ordering, and concurrency
 * limits without moving any rendering or QC algorithm into this module.
 */
export async function runDesignProFlatMasterProducer(options) {
  const expectedSides = Array.isArray(options.expectedSides)
    ? [...options.expectedSides]
    : [];
  const dimensionsBySide = options.dimensionsBySide || {};
  const bleedIn =
    Number(options.bleedIn) > 0 ? Number(options.bleedIn) : 5;
  const proofCandidates = positiveInteger(
    options.proofCandidates,
    DEFAULT_PROOF_CANDIDATES,
  );
  const panelPool = positiveInteger(
    options.panelPool,
    DEFAULT_PANEL_POOL,
  );
  const sideFieldPool = positiveInteger(
    options.sideFieldPool,
    DEFAULT_SIDE_FIELD_POOL,
  );
  const now =
    typeof options.now === "function" ? options.now : Date.now;
  const warn =
    typeof options.onWarning === "function"
      ? options.onWarning
      : () => {};
  const missingReason =
    typeof options.missingReason === "string" &&
    options.missingReason
      ? options.missingReason
      : "required side missing; pack not persisted";
  const hasApprovedView =
    typeof options.hasApprovedView === "function"
      ? options.hasApprovedView
      : () => false;
  // Additive master-first adapter. Existing browser callers omit this option
  // and retain the sanctioned legacy ladder unchanged.
  const surfaceMastersBySide =
    options.surfaceMastersBySide &&
    typeof options.surfaceMastersBySide === "object"
      ? options.surfaceMastersBySide
      : null;

  // Production panels are proof-authoritative by default. Legacy generative
  // rungs remain available only to explicitly non-production callers.
  const allowGenerativeFallbacks =
    options.allowGenerativeFallbacks === true;

  // Start long-running sidefield work immediately, but keep it bounded. Three
  // is the proven safe width for the shared image workers; a wider burst can
  // put concurrent 4K jobs in one isolate and cause 546/OOM retry cascades.
  const fieldPrefetch = new Map();
  const fieldQueue = [];
  for (const side of expectedSides) {
    if (surfaceMastersBySide) continue;
    const dimensions = dimensionsBySide[side];
    if (
      !allowGenerativeFallbacks ||
      !dimensions?.w ||
      !dimensions?.h ||
      !hasApprovedView(side)
    ) {
      continue;
    }
    let settle;
    const pending = new Promise((resolve) => {
      settle = resolve;
    });
    fieldPrefetch.set(side, pending);
    fieldQueue.push({ side, dimensions, settle });
  }
  const fieldRunners = Array.from(
    {
      length: Math.min(sideFieldPool, fieldQueue.length),
    },
    async () => {
      while (fieldQueue.length) {
        const next = fieldQueue.shift();
        if (!next) return;
        try {
          const url = await options.flattenSideField({
            side: next.side,
            dimensions: next.dimensions,
          });
          next.settle({ url, error: null });
        } catch (error) {
          next.settle({ url: null, error });
        }
      }
    },
  );
  const fieldPrefetchDone = Promise.all(fieldRunners);

  const buildLog = [];
  const logAttempt = (
    side,
    rung,
    method,
    outcome,
    started,
    reason,
  ) => {
    buildLog.push({
      side,
      rung,
      method,
      outcome,
      ms: now() - started,
      ...(reason ? { reason } : {}),
    });
  };

  const buildTile = async (side) => {
    const dimensions = dimensionsBySide[side];
    if (!dimensions?.w || !dimensions?.h) return null;

    const started = now();
    if (surfaceMastersBySide) {
      const master = surfaceMastersBySide[side];
      if (!master?.url || !master?.sha256 || !master?.bytes) {
        logAttempt(
          side,
          0,
          "surface-master-cut",
          "gap",
          started,
          "frozen surface master missing",
        );
        return null;
      }
      const finished = await options.deterministicFinish({
        side,
        sourceUrl: master.url,
        dimensions,
        variant: "surface-master",
      });
      if (!finished?.url) {
        logAttempt(
          side,
          0,
          "surface-master-cut",
          "error",
          started,
          "deterministic finish (gridslice) failed",
        );
        return null;
      }
      const qc = await options.judgePanel({
        side,
        panelUrl: finished.url,
        referenceUrl: master.url,
      });
      if (!qc?.known || !qc?.pass) {
        logAttempt(
          side,
          0,
          "surface-master-cut",
          qc?.known ? "qc-fail" : "error",
          started,
          qc?.reason || "unknown QC verdict",
        );
        return null;
      }
      logAttempt(side, 0, "surface-master-cut", "pass", started);
      return {
        side,
        url: finished.url,
        widthIn: dimensions.w,
        heightIn: dimensions.h,
        bleedIn,
        dpi: finished.dpi,
        pixelWidth: finished.pixelWidth,
        pixelHeight: finished.pixelHeight,
        method: "surface-master-cut",
        rung: 0,
        deterministic: true,
        productionEligible: true,
        sourceMasterKey: side,
        sourceMasterUrl: master.url,
        sourceMasterSha256: master.sha256,
        sourceMasterBytes: master.bytes,
        surfaceMasterSetHash: options.surfaceMasterSetHash || null,
        qc,
        builtMs: now() - started,
      };
    }
    let rungStarted = now();
    let referencePending = null;
    const getProofReference = () => {
      if (!referencePending) {
        referencePending = Promise.resolve(
          options.getProofReference({ side }),
        );
      }
      return referencePending;
    };

    // RUNG 0 — use the deterministic named crop from the frozen 2D proof.
    // No image model may repaint production pixels on this path.
    rungStarted = now();
    const directReference = await getProofReference();
    if (directReference?.proofTile && directReference.referenceUrl) {
      const finished = await options.deterministicFinish({
        side,
        sourceUrl: directReference.referenceUrl,
        dimensions,
        variant: "sheet-proof-tile",
      });
      if (finished) {
        const qc = await options.judgePanel({
          side,
          panelUrl: finished.url,
          referenceUrl: directReference.referenceUrl,
        });
        if (qc.known && qc.pass) {
          logAttempt(side, 0, "proof-tile-cut", "pass", rungStarted);
          return {
            side,
            url: finished.url,
            widthIn: dimensions.w,
            heightIn: dimensions.h,
            bleedIn,
            dpi: finished.dpi,
            pixelWidth: finished.pixelWidth,
            pixelHeight: finished.pixelHeight,
            method: "proof-tile-cut",
            rung: 0,
            deterministic: true,
            productionEligible: true,
            qc,
            builtMs: now() - started,
          };
        }
        logAttempt(
          side,
          0,
          "proof-tile-cut",
          qc.known ? "qc-fail" : "error",
          rungStarted,
          qc.reason,
        );
      } else {
        logAttempt(
          side,
          0,
          "proof-tile-cut",
          "error",
          rungStarted,
          "deterministic finish failed",
        );
      }
    } else {
      logAttempt(
        side,
        0,
        "proof-tile-cut",
        "error",
        rungStarted,
        "named 2D-proof tile unavailable",
      );
    }

    if (!allowGenerativeFallbacks) {
      warn(
        `[masterSheet] ${side}: deterministic proof tile failed — honest gap`,
      );
      return null;
    }

    const approvedViewExists = Boolean(hasApprovedView(side));
    const prefetched = fieldPrefetch.has(side)
      ? await fieldPrefetch.get(side)
      : { url: null, error: null };
    if (prefetched.error) throw prefetched.error;
    const fieldUrl =
      prefetched.url ||
      (approvedViewExists && !fieldPrefetch.has(side)
        ? await options.flattenSideField({ side, dimensions })
        : null);

    // RUNG 0 — one controlled sidefield flatten followed by deterministic
    // GENIE sizing/bleed and a fail-closed judge.
    if (fieldUrl) {
      const finished = await options.deterministicFinish({
        side,
        sourceUrl: fieldUrl,
        dimensions,
        variant: "sheet-sidefield",
      });
      if (finished) {
        const { referenceUrl } = await getProofReference();
        const qc = await options.judgePanel({
          side,
          panelUrl: finished.url,
          referenceUrl,
        });
        if (qc.known && qc.pass) {
          logAttempt(
            side,
            0,
            "sidefield-cut",
            "pass",
            rungStarted,
          );
          return {
            side,
            url: finished.url,
            widthIn: dimensions.w,
            heightIn: dimensions.h,
            bleedIn,
            dpi: finished.dpi,
            pixelWidth: finished.pixelWidth,
            pixelHeight: finished.pixelHeight,
            method: "sidefield-cut",
            rung: 0,
            deterministic: false,
            productionEligible: qc.known && qc.pass,
            qc,
            builtMs: now() - started,
          };
        }
        logAttempt(
          side,
          0,
          "sidefield-cut",
          qc.known ? "qc-fail" : "error",
          rungStarted,
          qc.reason,
        );
        warn(
          `[masterSheet] ${side}: sidefield cut failed QC (${qc.reason}) — falling to proof extract`,
        );
      } else {
        logAttempt(
          side,
          0,
          "sidefield-cut",
          "error",
          rungStarted,
          "deterministic finish (gridslice) failed",
        );
      }
    } else {
      logAttempt(
        side,
        0,
        "sidefield-cut",
        approvedViewExists ? "error" : "skip",
        rungStarted,
        approvedViewExists
          ? "sidefield flatten returned nothing"
          : "no approved view for this side",
      );
    }

    // RUNG 1 — proof-authoritative extraction candidates, each followed by
    // the same deterministic finish and fail-closed judge.
    const { referenceUrl, proofTile } = await getProofReference();
    for (
      let candidate = 1;
      candidate <= proofCandidates;
      candidate += 1
    ) {
      rungStarted = now();
      const extractedUrl = await options.extractSideFromProof({
        side,
        dimensions,
        referenceUrl,
        proofTile,
        candidate,
      });
      if (!extractedUrl) {
        logAttempt(
          side,
          1,
          "proof-extract",
          "error",
          rungStarted,
          `candidate ${candidate}/${proofCandidates}: proof extract returned nothing`,
        );
        continue;
      }
      const finished = await options.deterministicFinish({
        side,
        sourceUrl: extractedUrl,
        dimensions,
        variant: `sheet-proof-c${candidate}`,
      });
      if (!finished) {
        logAttempt(
          side,
          1,
          "proof-extract",
          "error",
          rungStarted,
          `candidate ${candidate}/${proofCandidates}: deterministic finish (gridslice) failed`,
        );
        continue;
      }
      const qc = await options.judgePanel({
        side,
        panelUrl: finished.url,
        referenceUrl,
      });
      if (qc.known && qc.pass) {
        logAttempt(
          side,
          1,
          "proof-extract",
          "pass",
          rungStarted,
          `candidate ${candidate}/${proofCandidates}`,
        );
        return {
          side,
          url: finished.url,
          widthIn: dimensions.w,
          heightIn: dimensions.h,
          bleedIn,
          dpi: finished.dpi,
          pixelWidth: finished.pixelWidth,
          pixelHeight: finished.pixelHeight,
          method: "proof-extract",
          rung: 1,
          deterministic: false,
          productionEligible: qc.known && qc.pass,
          qc,
          builtMs: now() - started,
        };
      }
      logAttempt(
        side,
        1,
        "proof-extract",
        qc.known ? "qc-fail" : "error",
        rungStarted,
        `candidate ${candidate}/${proofCandidates}: ${qc.reason}`,
      );
      warn(
        `[masterSheet] ${side}: proof candidate ${candidate}/${proofCandidates} failed QC (${qc.reason})`,
      );
    }

    // RUNG 2 — honest gap. Never borrow another surface and never ship an
    // unknown or failed verdict.
    warn(
      `[masterSheet] ${side}: all proof candidates failed QC — honest gap`,
    );
    logAttempt(side, 2, "honest-gap", "gap", started);
    warn(
      `[masterSheet] ${side}: no producer passed QC — honest gap`,
    );
    return null;
  };

  const queue = [...expectedSides];
  const built = [];
  const runners = Array.from(
    { length: Math.min(panelPool, queue.length) },
    async () => {
      while (queue.length) {
        const side = queue.shift();
        if (!side) return;
        built.push(await buildTile(side));
      }
    },
  );
  const settled = await Promise.allSettled(runners);
  await fieldPrefetchDone;
  const rejected = settled.find(
    (result) => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;

  // Canonical manifest order is independent of completion order. Passenger
  // remains a first-class surface because the engine never synthesizes,
  // mirrors, or aliases one side from another.
  const panels = expectedSides
    .map((side) => built.find((panel) => panel?.side === side))
    .filter(Boolean);
  const missing = expectedSides.filter(
    (side) => !panels.some((panel) => panel.side === side),
  );
  for (const side of missing) {
    buildLog.push({
      side,
      rung: 2,
      method: "atomic-pack",
      outcome: "gap",
      ms: 0,
      reason: missingReason,
    });
  }

  return { panels, buildLog, missing };
}
