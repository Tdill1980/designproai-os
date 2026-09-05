"use strict";

/**
 * REPAIR A SEVERED ELEMENT BY MOVING GEMINI'S OWN PIXELS. NO SECOND PRODUCER.
 *
 * Owner ruling, 2026-09-05: *"Preserve the existing v24 Call-1 prompt, creative
 * output, A.T.L.A.S. master, region arrangement and Gemini-designed branding
 * BYTE FOR BYTE. Do not replace the creative wordmark with DejaVu, fixed slots
 * or a generic deterministic layout."*
 *
 * That rules out the obvious repair -- asking an image model to re-author the
 * failing surface -- twice over. It would REDRAW the branding rather than
 * preserve it, and it would give the system a second design producer, which is
 * the exact thing RULE 0.30 and `tests/atlas-sole-design-authority.test.mjs`
 * exist to prevent.
 *
 * So this moves the element instead. `runtime/atlas-panel-qc.cjs` reports which
 * elements the cut severed and where they are on the master. Their pixels are
 * still there, intact, because the master was never the problem -- the CUT was.
 * The repair is three deterministic steps:
 *
 *   1. LIFT the element's exact pixels out of the accepted master.
 *   2. HEAL the rectangle it came from with `diffuseInto`, the same
 *      boundary-averaging the cut-out fill already uses. It grows the
 *      surrounding design inward from every side and invents nothing.
 *   3. PLACE it, scaled to fit and never enlarged, wholly inside ONE surface's
 *      trim box with an installer tolerance inset.
 *
 * No model is asked for anything. No glyph is typeset. The lettering, the
 * mascot badge, the keylines and the gradients are the bytes Gemini authored.
 *
 * WHICH SURFACE IT LANDS ON IS NOT A DESIGN OPINION. It goes to the surface
 * that ALREADY HOLDS MOST OF IT -- "minimise the move" -- because any other
 * rule is code inventing wrap layout, which is the half of the reverted work
 * the owner rejected by name. On Arctic Air that is the hood, which is where
 * the fragment `[ARCTIC AIR badge] Www.Arct` already reads as one intended
 * lockup. The repair completes what the composition was already doing.
 *
 * ELEMENTS THAT BELONG TOGETHER MOVE TOGETHER. The badge and the banner are
 * separately located and sit 8 px apart on one contact bar. Moving them
 * independently would re-space or re-order them, which IS a redesign. Adjacent
 * severed elements resolving to the same surface are merged into one rectangle
 * and moved as a unit, so their relative geometry survives exactly.
 *
 * IT FAILS CLOSED. `repairMasterPanels` returns the repaired bytes; the caller
 * re-runs panel QC over them and refuses the run if a repaired surface still
 * carries a severed element. A repair that cannot be verified is not a repair.
 */

const sharp = require("sharp");
const { createHash } = require("node:crypto");
const { diffuseInto } = require("./atlas-cutout-fill.cjs");

const PANEL_REPAIR_CONTRACT = "designpro.atlas-panel-repair.v1";

/**
 * Installer tolerance, in VEHICLE INCHES, held clear inside the trim box on
 * every side. The trim is where the printed sheet is cut; nobody lands a cut
 * dead on a line, so an element flush to trim is an element that loses a
 * millimetre of its keyline on a real vehicle.
 */
const INSTALLER_INSET_IN = 2;

/**
 * Below this a moved element is not worth landing: it would print too small to
 * read on the vehicle, and shrinking a website to fit is not a repair. The run
 * reports the surface as unrepairable rather than placing an illegible mark.
 */
const MIN_ELEMENT_HEIGHT_IN = 3;

/**
 * Two severed elements this close on the master are one lockup. 3% of the
 * master's width: the Arctic Air badge and banner sit 8 px apart on a 4096
 * sheet, and no two independent marks in the measured runs come near it.
 */
const GROUP_GAP_RATIO = 0.03;

class PanelRepairError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.name = "PanelRepairError";
    this.code = code;
    if (detail) this.detail = detail;
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const rectArea = (rect) => Math.max(0, rect.w) * Math.max(0, rect.h);

function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, x1 - x), h: Math.max(0, y1 - y) };
}

const unionRect = (a, b) => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** Gap between two rectangles, 0 when they touch or overlap. */
function gapBetween(a, b) {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.max(dx, dy);
}

const containerRect = (zone) => ({ x: zone.x, y: zone.y, w: zone.width, h: zone.height });

function trimRect(zone) {
  const trim = zone?.trim;
  if (trim && Number.isFinite(trim.x) && Number.isFinite(trim.width)) {
    return { x: trim.x, y: trim.y, w: trim.width, h: trim.height };
  }
  return containerRect(zone);
}

/**
 * The trim box with the installer tolerance held clear, in PIXELS. The
 * conversion is the surface's own trim inches against its own trim pixels, so
 * a 2" inset is 2" on the vehicle whatever a surface's density happens to be.
 */
function placeableRect(zone) {
  const trim = trimRect(zone);
  const trimWidthIn = Number(zone?.printWidthIn ?? zone?.trimWidthIn);
  const trimHeightIn = Number(zone?.printHeightIn ?? zone?.trimHeightIn);
  if (!Number.isFinite(trimWidthIn) || !Number.isFinite(trimHeightIn) || trimWidthIn <= 0 || trimHeightIn <= 0) {
    return trim;
  }
  const insetX = Math.round((INSTALLER_INSET_IN / trimWidthIn) * trim.w);
  const insetY = Math.round((INSTALLER_INSET_IN / trimHeightIn) * trim.h);
  return {
    x: trim.x + insetX,
    y: trim.y + insetY,
    w: Math.max(1, trim.w - 2 * insetX),
    h: Math.max(1, trim.h - 2 * insetY),
  };
}

/** Vehicle inches per master pixel, on this surface's vertical axis. */
function inchesPerPixelY(zone) {
  const trim = trimRect(zone);
  const trimHeightIn = Number(zone?.printHeightIn ?? zone?.trimHeightIn);
  if (!Number.isFinite(trimHeightIn) || trimHeightIn <= 0 || trim.h <= 0) return null;
  return trimHeightIn / trim.h;
}

/**
 * Merge severed elements that read as one lockup. Repeated until nothing more
 * merges, because a three-part bar merges pairwise.
 */
function groupSeveredElements(items, masterWidth) {
  const gap = Math.round(masterWidth * GROUP_GAP_RATIO);
  let groups = items.map((item) => ({ labels: [item.label], rect: { ...item.rect } }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        if (gapBetween(groups[i].rect, groups[j].rect) > gap) continue;
        groups[i] = {
          labels: [...groups[i].labels, ...groups[j].labels],
          rect: unionRect(groups[i].rect, groups[j].rect),
        };
        groups = groups.filter((_, index) => index !== j);
        merged = true;
        break outer;
      }
    }
  }
  return groups;
}

/**
 * Where each severed group goes, and at what size. Pure geometry -- callable
 * without an image, which is what makes the placement provable in a test.
 */
function planPanelRepair({ containment = [], manifest, masterWidth }) {
  const zones = (manifest?.zones || []).filter((zone) => zone && zone.surfaceKey);
  if (!zones.length) throw new PanelRepairError("atlas_panel_repair_manifest_zones_missing", "panel repair requires the manifest zones");

  const severed = containment.filter((item) => item.status === "severed" && item.rect);
  const groups = groupSeveredElements(severed, masterWidth);

  return groups.map((group) => {
    // MINIMISE THE MOVE. The home surface is the one already holding most of
    // the element -- never a layout preference, which is code inventing design.
    const ranked = zones
      .map((zone) => ({ zone, overlap: rectArea(intersect(group.rect, containerRect(zone))) }))
      .filter((entry) => entry.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap);

    const base = { labels: group.labels, sourceRect: group.rect, acrossSurfaces: ranked.map((entry) => entry.zone.surfaceKey) };
    if (!ranked.length) {
      return { ...base, placeable: false, reason: "the element lies outside every surface container" };
    }

    // Try surfaces in order of how much of the element they already hold, so a
    // surface that cannot print it legibly falls through to the next rather
    // than failing the whole repair.
    for (const { zone } of ranked) {
      const box = placeableRect(zone);
      const scale = Math.min(1, box.w / group.rect.w, box.h / group.rect.h);
      const w = Math.max(1, Math.round(group.rect.w * scale));
      const h = Math.max(1, Math.round(group.rect.h * scale));
      const inPerPx = inchesPerPixelY(zone);
      const heightIn = inPerPx ? Number((h * inPerPx).toFixed(2)) : null;
      if (heightIn !== null && heightIn < MIN_ELEMENT_HEIGHT_IN) continue;

      // Keep the element where the composition already put it, as closely as
      // the box allows: the same relative position inside the home surface,
      // clamped in. Centring everything would re-lay-out the design.
      const relX = (group.rect.x - zone.x) / Math.max(1, zone.width - group.rect.w || 1);
      const relY = (group.rect.y - zone.y) / Math.max(1, zone.height - group.rect.h || 1);
      const x = Math.round(box.x + Math.min(1, Math.max(0, relX)) * (box.w - w));
      const y = Math.round(box.y + Math.min(1, Math.max(0, relY)) * (box.h - h));

      return {
        ...base,
        placeable: true,
        surfaceKey: zone.surfaceKey,
        targetRect: { x, y, w, h },
        scale: Number(scale.toFixed(4)),
        heightIn,
        installerInsetIn: INSTALLER_INSET_IN,
      };
    }
    return {
      ...base,
      placeable: false,
      reason: `no surface can print this element at ${MIN_ELEMENT_HEIGHT_IN}" or taller`,
    };
  });
}

/**
 * Lift, heal, place. Returns the repaired master bytes; it does NOT decide
 * whether the repair worked -- the caller re-runs panel QC over the result and
 * refuses the run if a surface is still severed.
 *
 * The original master is never mutated: sharp decodes into a fresh buffer and
 * the repaired sheet is a new one, exactly as the cut-out fill does.
 */
async function repairMasterPanels({ masterBytes, manifest, containment = [] } = {}) {
  if (!Buffer.isBuffer(masterBytes)) {
    throw new PanelRepairError("atlas_panel_repair_master_missing", "panel repair requires the accepted master bytes");
  }
  const { data, info } = await sharp(masterBytes).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const plan = planPanelRepair({ containment, manifest, masterWidth: width });
  const placeable = plan.filter((entry) => entry.placeable);
  if (!placeable.length) {
    return {
      contract: PANEL_REPAIR_CONTRACT,
      changed: false,
      bytes: masterBytes,
      contentHash: sha256(masterBytes),
      repairs: plan,
    };
  }

  // 1. LIFT. Every element's pixels come out of the ORIGINAL sheet, before any
  //    healing runs, so one repair can never sample another's healed ground.
  const lifted = [];
  for (const entry of placeable) {
    const rect = entry.sourceRect;
    lifted.push({
      entry,
      bytes: await sharp(masterBytes)
        .extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
        .png()
        .toBuffer(),
    });
  }

  // 2. HEAL. One mask over every vacated rectangle, one diffusion pass. The
  //    part of a source rectangle the element is about to be placed back over
  //    is healed too -- it is overwritten in step 3, and excluding it would
  //    make the fill's boundary depend on placement order.
  const mask = new Uint8Array(width * height);
  let vacatedPixels = 0;
  for (const entry of placeable) {
    const rect = entry.sourceRect;
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      if (y < 0 || y >= height) continue;
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        if (x < 0 || x >= width) continue;
        const index = y * width + x;
        if (!mask[index]) vacatedPixels += 1;
        mask[index] = 1;
      }
    }
  }
  // `diffuseInto` returns the count of pixels it could NOT close -- a region
  // with no settled neighbour anywhere. That is a structural impossibility, not
  // a soft outcome, so it raises rather than shipping a hole where a wordmark
  // used to be.
  const unresolved = diffuseInto(data, width, height, channels, mask);
  if (unresolved > 0) {
    throw new PanelRepairError(
      "atlas_panel_repair_heal_incomplete",
      `${unresolved} px of the vacated region could not be closed from surrounding artwork`,
    );
  }

  const healedBytes = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();

  // 3. PLACE. Scaled to fit, never enlarged, wholly inside the home surface's
  //    trim box with the installer tolerance already held clear.
  const composites = [];
  for (const { entry, bytes } of lifted) {
    const target = entry.targetRect;
    composites.push({
      input: await sharp(bytes)
        .resize({ width: target.w, height: target.h, fit: "fill", kernel: "lanczos3" })
        .png()
        .toBuffer(),
      left: target.x,
      top: target.y,
    });
  }
  const repaired = await sharp(healedBytes).composite(composites).png().toBuffer();

  return {
    contract: PANEL_REPAIR_CONTRACT,
    changed: true,
    bytes: repaired,
    contentHash: sha256(repaired),
    vacatedPixels,
    repairs: plan,
  };
}

module.exports = {
  PANEL_REPAIR_CONTRACT,
  INSTALLER_INSET_IN,
  MIN_ELEMENT_HEIGHT_IN,
  GROUP_GAP_RATIO,
  PanelRepairError,
  planPanelRepair,
  repairMasterPanels,
  _test: { groupSeveredElements, placeableRect, intersect, unionRect, gapBetween, trimRect, containerRect },
};
