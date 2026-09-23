"use strict";
/**
 * runtime/atlas-panel-refine.cjs — THE PRINT PANELS GET THEIR OWN CANVAS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-23, on her own New Aura run: "still not a high quality design
 * ... the resolution will not work see each panel some look a diff sheen almost
 * like real while others look like print files", against the Practical Magic
 * wrap this system produced last November.
 *
 * ⛔ THE CAUSE IS ONE NUMBER, AND IT IS NOT THE PROMPT. Measured on generation
 * `848be1c6` / revision `a9d6dd85`, from the row:
 *
 *     sheet delivered      5056 x 3392
 *     Zone 1 band          25.8% of the height -> 875 px tall
 *     six panels ACROSS    5056 / 6 -> ~843 px per cell
 *     passenger, 166.8"    843 px  ->  5.0 PIXELS PER INCH
 *     150 PPI would need   25,020 px  ->  30x short
 *
 * Every complaint follows from that one number:
 *
 *   - the mush. Topaz at 5 px/in is not sharpening, it is INVENTING.
 *   - the mismatched sheen. At 843 px the model composes each cell as its own
 *     small picture, so the flanks got a photograph and the roof got an
 *     abstract. They are not one design because they were never one canvas.
 *   - the colours. Five named colours (plum, lavender, black, white, sage)
 *     need room to be placed as a SYSTEM; at thumbnail scale the model averages
 *     them, which is exactly the mauve that came back.
 *   - "logo on back". The rear is the smallest cell on the sheet. There was
 *     nowhere to put it.
 *
 * NO PROMPT CHANGE ADDS A PIXEL. One image call is one image, and six panels
 * share it. More resolution requires more calls. That is arithmetic.
 *
 * WHAT THIS DOES. After the three-zone sheet is accepted — so the DESIGN is
 * already decided and approved by the gates — each Zone 1 panel is re-authored
 * on its OWN full canvas, shown its own cell from that sheet, continuing the
 * same conversation. ~843 px becomes ~4096 px: 5 px/in becomes ~30.
 *
 * IT INVENTS NO DESIGN. The sheet is the design authority and the sheet's own
 * cell is the reference every panel is drawn from, so this is a RESOLUTION
 * pass, not a second creative authority (RULE 0.26). The document, its bands,
 * its dimension callouts and Zones 2 and 3 are untouched.
 *
 * ⛔ IT FAILS SOFT, PER SURFACE, ALWAYS. A refused panel KEEPS its original
 * crop. This file may never cost a customer a design: the worst case it can
 * produce is exactly the sheet they would have had without it. That is the
 * lesson of RULE 0.15's cut-out ruling ("a defect that only exists in the
 * panel must not destroy the design") and of the 2026-09-17 hero cascade,
 * where ONE refused surface threw away four good ones.
 *
 * WHY authorSurface AND NOT A NEW PRODUCER (RULE 0.21, RULE 1). It already
 * authors one surface on one canvas, replays the reasoning chain with its
 * thought signature, contain-fits an aspect the model cannot emit
 * (`containExtend`), measures holes and runs the deterministic cut-out fill.
 * Every one of those behaviours is needed here and none of it is re-typed.
 *
 * THE ASPECT OBJECTION IS ALREADY RETIRED. CLAUDE.md records hero-driver being
 * shelved because `MAX_ASPECT_DRIFT_RATIO=1.12` refused every wide flank. That
 * refusal is GONE: `evaluateAuthored` now contain-fits and edge-extends against
 * `MAX_CONTAIN_DRIFT_RATIO = 2.0`, and a 166.8x59.4 flank is 2.81:1 against an
 * emittable 21:9 — drift 1.20, comfortably inside. Do not re-raise it as a
 * blocker; read the ceiling.
 *
 * OFF BY DEFAULT. `DESIGNPRO_ATLAS_PANEL_REFINE=on` turns it on, so the same
 * brief can be run both ways and the two exported sheets judged side by side.
 * Unset — or any typo — is OFF, which is the state that cannot surprise anyone.
 */

const { authorSurface, SURFACE_LABELS } = require("./atlas-hero-driver.cjs");

const PANEL_REFINE_CONTRACT = "designpro.atlas-panel-refine.v1";

/**
 * The canvas each panel is authored on. 4096 on the long edge against a 166.8"
 * flank is ~25 px/in; the same flank cut from the shared sheet is 5.0. The edge
 * caps its own delivery (`imageSize`), so this is the TARGET the return is
 * contain-fitted into, not a promise about what the model emits.
 */
const REFINE_LONG_EDGE_PX = 4096;

/**
 * Driver is authored alone and first so the rest can be shown it; the others
 * then run together. Three at a time rather than five: each carries two
 * reference images plus a replayed chain, and the edge's own request budget is
 * what a wider fan-out would hit first.
 */
const REFINE_CONCURRENCY = 3;

/** `off` is not the only false value — anything that is not exactly `on` is. */
function panelRefineEnabled(env = process.env) {
  return String(env?.DESIGNPRO_ATLAS_PANEL_REFINE || "").trim().toLowerCase() === "on";
}

/**
 * A panel's own print rectangle, scaled so its LONG edge is the refine canvas.
 *
 * `zonePixelSize` reads `w`/`h` off the zone, so this is the one place the
 * target size is decided. Inches in, pixels out, aspect preserved exactly —
 * a rounded pixel pair whose ratio drifted from the print rectangle would put
 * the drift into `evaluateAuthored`'s budget for nothing.
 */
function refineZone(surfaceKey, widthIn, heightIn) {
  const w = Number(widthIn);
  const h = Number(heightIn);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const scale = REFINE_LONG_EDGE_PX / Math.max(w, h);
  return {
    surfaceKey,
    w: Math.max(8, Math.round(w * scale)),
    h: Math.max(8, Math.round(h * scale)),
    printWidthIn: w,
    printHeightIn: h,
    trimWidthIn: w,
    trimHeightIn: h,
  };
}

/** Pixels across the panel's own inches — the number this whole file exists to move. */
function pixelsPerInch(pixelWidth, widthIn) {
  const px = Number(pixelWidth);
  const inches = Number(widthIn);
  if (!Number.isFinite(px) || !Number.isFinite(inches) || inches <= 0) return null;
  return Number((px / inches).toFixed(2));
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * Re-author every Zone 1 panel at full canvas.
 *
 * @param zone1   the cut Zone 1 panels: `{surfaceKey, bytes, widthIn, heightIn}`.
 * @param callEdge the ONE atlas-author transport (`createAtlasAuthorTransport`).
 * @returns {{contract, applied, surfaces, panels}} — `panels` maps surfaceKey to
 *   the refined bytes, and carries ONLY the surfaces that were refined. A caller
 *   that finds a surface absent keeps what it already had; there is no error
 *   path here that a caller has to remember to handle.
 */
async function refineZoneOnePanels({
  zone1,
  callEdge,
  store,
  creativeContext = "",
  providerRequest = null,
  ownerId = null,
  sheetExchange = null,
  logger = () => {},
} = {}) {
  const cells = (Array.isArray(zone1) ? zone1 : []).filter((p) => p?.surfaceKey && p?.bytes?.length);
  const surfaces = [];
  const panels = new Map();
  if (!cells.length || typeof callEdge !== "function") {
    return { contract: PANEL_REFINE_CONTRACT, applied: false, surfaces, panels };
  }

  // The sheet's own cell for this surface is the reference the panel is drawn
  // from, which is what makes this a resolution pass rather than a redesign.
  const refineOne = async (cell, { neighbours, priorExchanges }) => {
    const zone = refineZone(cell.surfaceKey, cell.widthIn, cell.heightIn);
    const before = pixelsPerInch(cell.pixelWidth ?? cell.rect?.width, cell.widthIn);
    if (!zone) {
      surfaces.push({ surfaceKey: cell.surfaceKey, refined: false, reason: "panel has no print rectangle", pxPerInchBefore: before });
      return null;
    }
    try {
      const authored = await authorSurface({
        surfaceKey: cell.surfaceKey,
        zone,
        first: false,
        neighbours,
        priorExchanges,
        creativeContext,
        store,
        callEdge: (body, opts) => callEdge(body, { ownerId, ...(opts || {}) }),
        providerRequest: providerRequest ? { ...providerRequest, attemptKey: `refine:${cell.surfaceKey}` } : null,
        logger,
      });
      const after = pixelsPerInch(authored.pixelWidth, cell.widthIn);
      panels.set(cell.surfaceKey, authored.bytes);
      surfaces.push({
        surfaceKey: cell.surfaceKey, refined: true,
        pixelWidth: authored.pixelWidth, pixelHeight: authored.pixelHeight,
        pxPerInchBefore: before, pxPerInchAfter: after,
        contentHash: authored.contentHash, attempts: authored.attempts,
        imageRequestCount: authored.imageRequestCount,
        deliveredWidthPx: authored.deliveredWidthPx ?? null,
        containment: authored.containment ?? null,
      });
      logger(`panel refine ${cell.surfaceKey}: ${before ?? "?"} -> ${after ?? "?"} px/in`);
      return authored;
    } catch (cause) {
      // ⛔ FAIL SOFT. The original crop stands. A refused panel is a panel that
      // did not improve, never a design the customer loses.
      surfaces.push({
        surfaceKey: cell.surfaceKey, refined: false,
        reason: String(cause?.reason || cause?.message || cause).slice(0, 200),
        pxPerInchBefore: before,
      });
      logger(`panel refine ${cell.surfaceKey}: kept the original panel (${String(cause?.reason || cause?.message || cause).slice(0, 140)})`);
      return null;
    }
  };

  // DRIVER FIRST, ALONE. It is the flank the whole wrap is read from, and its
  // exchange is what the other five continue, so they are five continuations of
  // one conversation rather than five separate designs.
  const driverCell = cells.find((c) => c.surfaceKey === "driver");
  const chain = sheetExchange ? [sheetExchange] : [];
  let driver = null;
  if (driverCell) {
    driver = await refineOne(driverCell, {
      neighbours: [{ surfaceKey: driverCell.surfaceKey, bytes: driverCell.bytes }],
      priorExchanges: chain,
    });
  }

  const rest = cells.filter((c) => c.surfaceKey !== "driver");
  const driverReference = driver
    ? [{ surfaceKey: "driver", bytes: driver.bytes }]
    : (driverCell ? [{ surfaceKey: "driver", bytes: driverCell.bytes }] : []);
  const restChain = driver?.exchange ? [...chain, driver.exchange] : chain;
  await mapWithConcurrency(rest, REFINE_CONCURRENCY, (cell) => refineOne(cell, {
    // Its OWN cell first, then the refined driver: the panel it must reproduce,
    // then the flank it must belong to.
    neighbours: [{ surfaceKey: cell.surfaceKey, bytes: cell.bytes }, ...driverReference],
    priorExchanges: restChain,
  }));

  surfaces.sort((a, b) => String(a.surfaceKey).localeCompare(String(b.surfaceKey)));
  return {
    contract: PANEL_REFINE_CONTRACT,
    applied: panels.size > 0,
    longEdgePx: REFINE_LONG_EDGE_PX,
    refinedCount: panels.size,
    retainedCount: cells.length - panels.size,
    surfaces,
    panels,
  };
}

module.exports = {
  PANEL_REFINE_CONTRACT,
  REFINE_LONG_EDGE_PX,
  REFINE_CONCURRENCY,
  panelRefineEnabled,
  refineZone,
  pixelsPerInch,
  refineZoneOnePanels,
};
