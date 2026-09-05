"use strict";

/**
 * WHERE EVERY REQUIRED ELEMENT GOES, AND THE PROOF THAT IT FITS.
 *
 * This module is the containment guarantee. It is pure arithmetic over the
 * SAME `manifest.zones` object `cutCallOnePanels` extracts from, it makes no
 * network call and touches no pixels, and it fails closed rather than emitting
 * a placement a later crop could sever.
 *
 * THE DEFECT IT EXISTS TO MAKE IMPOSSIBLE. Arctic Air `63e6629a` (2026-09-04)
 * asked Gemini to compose "three equal horizontal thirds" and then cut six
 * unequal territories out of the result. The customer's own URL was drawn as
 * one contact bar across the lower band and came back as `Www.Arct` on the hood
 * and `ticAir.com` on the rear -- one string, sawn in half by `x=1071`,
 * `x=2198` and `y=3335`, three boundaries the authoring model was never shown.
 * Run A `586abc83` lost `www.GoArcticAC.com` the same way and had its shield
 * clipped to `ARCTI`. Twelve panels, twelve failures, every deterministic gate
 * green -- because every gate measured coverage and opacity, and none measured
 * whether a glyph crossed a cut.
 *
 * SO CONTAINMENT IS NOT REQUESTED, IT IS COMPUTED. Every element is placed
 * inside ONE zone's trim rectangle, inset by a physical safe margin, and
 * `assertContained` re-derives the inclusion from the manifest's own numbers
 * before a plan is returned. A plan that cannot place a REQUIRED element throws
 * `atlas_element_unplaceable` and Call 1 fails; it does not publish a master
 * whose lettering is going to be cut.
 *
 * WHY TRIM AND NOT THE ZONE. The zone rectangle includes the 5" bleed, which is
 * the part the installer wraps around an edge and loses. Artwork may run
 * through it -- it must, or the edge prints white -- but no LETTERING or MARK
 * may live there. `zone.trim` is the box the customer sees flat on the panel,
 * and `SAFE_INSET_INCHES` takes it in further, because a real install has real
 * tolerance and a URL an eighth of an inch from a trim line is a URL that gets
 * cut.
 *
 * WHY SLOTS AND NOT ANCHORS. The first cut of this module anchored each element
 * into the same safe box and relied on the anchors happening not to collide.
 * They collide: a bottom-centre contact line 44" wide and a bottom-right
 * tagline 70" wide overlap on a 167" flank, and nothing in an anchor scheme
 * notices. Each surface now partitions its safe box into DISJOINT SLOTS, so two
 * elements cannot occupy the same pixels by construction rather than by luck --
 * and `assertSlotsDisjoint` proves the partition for every surface rather than
 * asserting it in prose.
 *
 * PHYSICAL UNITS, NOT PIXEL UNITS. An element is specified and judged in INCHES
 * on the vehicle. A 6" cap height is a 6" cap height on a 251" flank and on a
 * 58" hood, and it converts to a different pixel count on each. Sizing in
 * pixels would make the same logo enormous on the rear and invisible on the
 * driver side, which is exactly the class of error the effective-PPI table
 * exposes (this manifest: 22.61 PPI on the flanks, 16.35 on the front).
 */

const { createHash } = require("node:crypto");

const ELEMENT_PLAN_CONTRACT = "designpro.atlas-element-plan.v1";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const ELEMENT_KINDS = Object.freeze(["brandmark", "wordmark", "tagline", "contact", "photo"]);

/**
 * How far inside the trim line lettering and marks must stay, in inches on the
 * vehicle. Trim is already inside the 5" bleed; this is installer tolerance on
 * top of it. Two inches is the smallest margin the measured geometry supports
 * on the tightest surface -- rear trim is 26.06" tall, so 2" a side leaves
 * 22.06", still four times a legible cap height.
 */
const SAFE_INSET_INCHES = 2;

/**
 * Minimum legible height on the vehicle, per kind, in inches. A required
 * element that cannot reach its minimum fails the run: shrinking a URL until it
 * fits is not a fix, it is an unreadable URL, which is the same defect as a
 * cropped one wearing a better metric.
 *
 * Grounded in reading distance rather than taste -- roughly one inch of cap
 * height per ten feet of legibility, so a 2.5" contact line reads at 25 feet
 * (the next lane) and a 6" name reads at 60 feet (across a parking lot, which
 * is the bar the designer persona is held to).
 */
const MIN_HEIGHT_INCHES = Object.freeze({
  brandmark: 6,
  wordmark: 5,
  tagline: 1.5,
  contact: 2.5,
  photo: 8,
});

/**
 * THE SLOTS. Fractions of each surface's safe box, disjoint within a surface,
 * fixed policy -- never derived from the model's opinion, so the same brief on
 * the same vehicle plans the same rectangles every time.
 *
 * Read as vehicle, not as canvas. A flank is what a customer reads from across
 * a parking lot, so it carries the mark, the name, a tagline and the contact
 * line. The rear is what the car behind reads in traffic, so it carries the
 * name and the contact line and nothing that needs studying. Hood and roof
 * carry one element each. The front fascia carries none: there is no reading
 * distance at which a paragraph on a bumper is useful, and it stays pure
 * artwork.
 *
 * Passenger is NOT mirrored driver. It is its own arrangement -- photo leading
 * on the left, brand block right -- which is what the seven-view proof set and
 * `passengerMirrorMae` have always required.
 */
const SURFACE_SLOTS = Object.freeze({
  driver: Object.freeze({
    brandmark: Object.freeze({ x: 0.00, y: 0.08, w: 0.24, h: 0.84 }),
    wordmark: Object.freeze({ x: 0.27, y: 0.10, w: 0.50, h: 0.46 }),
    tagline: Object.freeze({ x: 0.27, y: 0.58, w: 0.50, h: 0.14 }),
    contact: Object.freeze({ x: 0.27, y: 0.75, w: 0.71, h: 0.20 }),
  }),
  passenger: Object.freeze({
    photo: Object.freeze({ x: 0.00, y: 0.06, w: 0.44, h: 0.88 }),
    brandmark: Object.freeze({ x: 0.47, y: 0.08, w: 0.20, h: 0.60 }),
    wordmark: Object.freeze({ x: 0.69, y: 0.12, w: 0.31, h: 0.44 }),
    contact: Object.freeze({ x: 0.47, y: 0.72, w: 0.53, h: 0.22 }),
  }),
  hood: Object.freeze({
    brandmark: Object.freeze({ x: 0.12, y: 0.12, w: 0.76, h: 0.76 }),
  }),
  roof: Object.freeze({
    wordmark: Object.freeze({ x: 0.08, y: 0.30, w: 0.84, h: 0.40 }),
  }),
  front: Object.freeze({}),
  rear: Object.freeze({
    wordmark: Object.freeze({ x: 0.04, y: 0.05, w: 0.92, h: 0.45 }),
    contact: Object.freeze({ x: 0.04, y: 0.56, w: 0.92, h: 0.34 }),
  }),
});

class ElementPlanError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "ElementPlanError";
    this.code = code;
  }
}

const fail = (code, message) => { throw new ElementPlanError(code, message); };

const finite = (value, label) => {
  const n = Number(value);
  if (!Number.isFinite(n)) fail("atlas_element_plan_invalid", `${label} is not a finite number`);
  return n;
};

function zoneByKey(manifest) {
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : [];
  if (zones.length !== SURFACE_KEYS.length) {
    fail("atlas_element_plan_manifest_invalid", `the manifest carries ${zones.length} zones; six are required`);
  }
  const byKey = new Map();
  for (const zone of zones) {
    const key = String(zone?.surfaceKey || "");
    if (!SURFACE_KEYS.includes(key)) fail("atlas_element_plan_manifest_invalid", `unknown surface ${key}`);
    if (byKey.has(key)) fail("atlas_element_plan_manifest_invalid", `surface ${key} appears twice`);
    const trim = zone.trim || {};
    byKey.set(key, {
      surfaceKey: key,
      zone: {
        x: finite(zone.x, `${key}.x`), y: finite(zone.y, `${key}.y`),
        w: finite(zone.w, `${key}.w`), h: finite(zone.h, `${key}.h`),
      },
      trim: {
        x: finite(trim.x, `${key}.trim.x`), y: finite(trim.y, `${key}.trim.y`),
        w: finite(trim.w, `${key}.trim.w`), h: finite(trim.h, `${key}.trim.h`),
      },
      trimWidthIn: finite(zone.trimWidthIn, `${key}.trimWidthIn`),
      trimHeightIn: finite(zone.trimHeightIn, `${key}.trimHeightIn`),
    });
  }
  return byKey;
}

/** Pixels per inch on this surface, taken from its own trim box. */
function surfacePpi(surface) {
  return { x: surface.trim.w / surface.trimWidthIn, y: surface.trim.h / surface.trimHeightIn };
}

/**
 * The box elements may occupy: the trim rectangle taken in by the safe inset on
 * all four edges, in that surface's own pixels.
 */
function safeBox(surface, safeInsetInches) {
  const ppi = surfacePpi(surface);
  const insetX = Math.round(safeInsetInches * ppi.x);
  const insetY = Math.round(safeInsetInches * ppi.y);
  const w = surface.trim.w - insetX * 2;
  const h = surface.trim.h - insetY * 2;
  if (w < 1 || h < 1) {
    fail(
      "atlas_element_safe_box_empty",
      `${surface.surfaceKey} trim is ${surface.trimWidthIn}x${surface.trimHeightIn}in; a ${safeInsetInches}in safe inset leaves nothing`,
    );
  }
  return { x: surface.trim.x + insetX, y: surface.trim.y + insetY, w, h };
}

/** A slot's fractions resolved into this surface's pixels. */
function slotRect(safe, slot) {
  return {
    x: safe.x + Math.round(safe.w * slot.x),
    y: safe.y + Math.round(safe.h * slot.y),
    w: Math.max(1, Math.round(safe.w * slot.w)),
    h: Math.max(1, Math.round(safe.h * slot.h)),
  };
}

const contains = (outer, inner) => inner.x >= outer.x
  && inner.y >= outer.y
  && inner.x + inner.w <= outer.x + outer.w
  && inner.y + inner.h <= outer.y + outer.h;

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Prove the slot table is a partition, per surface, in fractional space. Called
 * by `planAtlasElements` on every run -- it is six small loops, and the
 * alternative is discovering an overlapping policy on a customer's wrap.
 */
function assertSlotsDisjoint(slots = SURFACE_SLOTS) {
  for (const surfaceKey of SURFACE_KEYS) {
    const table = slots[surfaceKey] || {};
    const entries = Object.entries(table);
    for (const [kind, slot] of entries) {
      if (slot.x < 0 || slot.y < 0 || slot.x + slot.w > 1.0000001 || slot.y + slot.h > 1.0000001) {
        fail("atlas_element_slot_invalid", `${surfaceKey}.${kind} is not inside its safe box`);
      }
    }
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const [aKind, a] = entries[i];
        const [bKind, b] = entries[j];
        if (overlaps({ ...a }, { ...b })) {
          fail("atlas_element_slot_overlap", `${surfaceKey}.${aKind} overlaps ${surfaceKey}.${bKind}`);
        }
      }
    }
  }
  return true;
}

/**
 * Fit an element of known aspect inside its slot, centred, as large as the slot
 * allows. The element yields to the surface -- never the reverse. That is the
 * whole difference from what Call 1 was doing, where the composition was drawn
 * first and the surface boundaries arrived afterwards.
 */
function fitInSlot(rect, aspect) {
  let w = rect.w;
  let h = Math.round(w / aspect);
  if (h > rect.h) {
    h = rect.h;
    w = Math.round(h * aspect);
  }
  w = Math.max(1, Math.min(w, rect.w));
  h = Math.max(1, Math.min(h, rect.h));
  return {
    x: rect.x + Math.round((rect.w - w) / 2),
    y: rect.y + Math.round((rect.h - h) / 2),
    w,
    h,
  };
}

/**
 * THE ASSERTION THIS MODULE EXISTS FOR. Re-derived from the manifest, not
 * carried forward from the arithmetic that produced the rectangle, so a bug in
 * the placement maths is caught here rather than at the panel cut.
 */
function assertContained(placement, surface, safe) {
  const rect = placement.rectPx;
  if (rect.w < 1 || rect.h < 1) {
    fail("atlas_element_unplaceable", `${placement.elementId} resolved to a ${rect.w}x${rect.h}px rectangle`);
  }
  if (!contains(safe, rect)) {
    fail(
      "atlas_element_unplaceable",
      `${placement.elementId} at ${rect.x},${rect.y} ${rect.w}x${rect.h} escapes ${surface.surfaceKey}'s safe box`,
    );
  }
  if (!contains(surface.trim, rect)) {
    fail("atlas_element_unplaceable", `${placement.elementId} escapes ${surface.surfaceKey}'s trim rectangle`);
  }
  if (!contains(surface.zone, rect)) {
    fail("atlas_element_unplaceable", `${placement.elementId} escapes ${surface.surfaceKey}'s extraction rectangle`);
  }
}

/**
 * Build the placement plan.
 *
 * `elements` are the RESOLVED element sources -- each already has real bytes or
 * a real string behind it, and a real MEASURED aspect ratio. Resolving them
 * first is the owner's requirement and it is also the only order that works:
 * planning against an aspect nobody measured is how a placement passes here and
 * overflows at composite time.
 */
function planAtlasElements({
  manifest,
  elements,
  safeInsetInches = SAFE_INSET_INCHES,
  slots = SURFACE_SLOTS,
  minHeightInches = MIN_HEIGHT_INCHES,
} = {}) {
  if (!Array.isArray(elements)) fail("atlas_element_plan_invalid", "elements must be an array");
  assertSlotsDisjoint(slots);
  const surfaces = zoneByKey(manifest);
  const placements = [];
  const skipped = [];

  for (const surfaceKey of SURFACE_KEYS) {
    const surface = surfaces.get(surfaceKey);
    const safe = safeBox(surface, safeInsetInches);
    const ppi = surfacePpi(surface);
    const table = slots[surfaceKey] || {};

    for (const [kind, slot] of Object.entries(table)) {
      if (!ELEMENT_KINDS.includes(kind)) fail("atlas_element_plan_invalid", `unknown element kind ${kind}`);
      const element = elements.find((item) => item.kind === kind);
      if (!element) continue;

      const aspect = finite(element.aspect, `${element.id}.aspect`);
      if (aspect <= 0) fail("atlas_element_plan_invalid", `${element.id}.aspect must be positive`);

      const rectPx = fitInSlot(slotRect(safe, slot), aspect);
      const heightIn = rectPx.h / ppi.y;
      const minHeight = Number.isFinite(element.minHeightIn) ? element.minHeightIn : minHeightInches[kind];
      const elementId = `${element.id}@${surfaceKey}`;

      if (heightIn + 1e-9 < minHeight) {
        // A REQUIRED element that cannot be placed legibly fails the run. An
        // optional one is recorded as skipped WITH the number that decided it,
        // so a thin surface is a stated fact rather than a silent omission.
        if (element.required) {
          fail(
            "atlas_element_unplaceable",
            `required ${kind} "${element.id}" fits ${surfaceKey} at ${heightIn.toFixed(2)}in; ${minHeight}in is the legible minimum`,
          );
        }
        skipped.push({
          elementId, surfaceKey, kind,
          reason: "below_minimum_legible_height",
          heightIn: Number(heightIn.toFixed(2)),
          minHeightIn: minHeight,
        });
        continue;
      }

      const placement = {
        elementId,
        elementRef: element.id,
        kind,
        surfaceKey,
        rectPx,
        // The same rectangle in vehicle inches, measured from the trim corner,
        // which is what a human checking a panel against a template measures.
        rectIn: {
          x: Number(((rectPx.x - surface.trim.x) / ppi.x).toFixed(2)),
          y: Number(((rectPx.y - surface.trim.y) / ppi.y).toFixed(2)),
          w: Number((rectPx.w / ppi.x).toFixed(2)),
          h: Number((rectPx.h / ppi.y).toFixed(2)),
        },
        safeInsetInches,
        source: element.source || null,
      };
      assertContained(placement, surface, safe);
      placements.push(placement);
    }
  }

  // Two elements planned onto the same surface may never share pixels. The slot
  // table guarantees it in fractional space; this asserts it in the integer
  // pixels that actually get composited, where rounding lives.
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      if (placements[i].surfaceKey !== placements[j].surfaceKey) continue;
      if (overlaps(placements[i].rectPx, placements[j].rectPx)) {
        fail("atlas_element_slot_overlap", `${placements[i].elementId} overlaps ${placements[j].elementId}`);
      }
    }
  }

  // A required element that no surface wanted is a policy/brief mismatch, and
  // it is louder to say so than to ship a wrap with no phone number on it.
  for (const element of elements) {
    if (!element.required) continue;
    if (!placements.some((p) => p.elementRef === element.id)) {
      fail("atlas_element_unplaceable", `required ${element.kind} "${element.id}" was not placed on any surface`);
    }
  }

  const plan = { contract: ELEMENT_PLAN_CONTRACT, safeInsetInches, placements, skipped };
  plan.planHash = createHash("sha256").update(JSON.stringify({
    contract: plan.contract,
    safeInsetInches,
    placements: placements.map((p) => ({ id: p.elementId, kind: p.kind, surfaceKey: p.surfaceKey, rectPx: p.rectPx })),
  })).digest("hex");
  return plan;
}

/**
 * Independent re-check of a finished plan against the manifest it claims to
 * fit. The composer calls it before writing a pixel and the test suite uses it
 * as the acceptance oracle, so containment is asserted twice by two different
 * code paths rather than trusted once.
 */
function verifyPlanContainment(plan, manifest, { safeInsetInches } = {}) {
  const surfaces = zoneByKey(manifest);
  const inset = Number.isFinite(safeInsetInches) ? safeInsetInches : plan?.safeInsetInches;
  const violations = [];
  const placements = plan?.placements || [];
  for (const placement of placements) {
    const surface = surfaces.get(placement.surfaceKey);
    if (!surface) {
      violations.push({ elementId: placement.elementId, reason: "unknown_surface" });
      continue;
    }
    const safe = safeBox(surface, inset);
    if (!contains(safe, placement.rectPx)) violations.push({ elementId: placement.elementId, reason: "outside_safe_box" });
    else if (!contains(surface.trim, placement.rectPx)) violations.push({ elementId: placement.elementId, reason: "outside_trim" });
    else if (!contains(surface.zone, placement.rectPx)) violations.push({ elementId: placement.elementId, reason: "outside_zone" });
  }
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      if (placements[i].surfaceKey !== placements[j].surfaceKey) continue;
      if (overlaps(placements[i].rectPx, placements[j].rectPx)) {
        violations.push({ elementId: placements[i].elementId, reason: "overlaps", other: placements[j].elementId });
      }
    }
  }
  return { contained: violations.length === 0, violations };
}

module.exports = {
  ELEMENT_PLAN_CONTRACT,
  ELEMENT_KINDS,
  SURFACE_KEYS,
  SAFE_INSET_INCHES,
  MIN_HEIGHT_INCHES,
  SURFACE_SLOTS,
  ElementPlanError,
  planAtlasElements,
  verifyPlanContainment,
  assertSlotsDisjoint,
  _test: { zoneByKey, safeBox, slotRect, fitInSlot, contains, overlaps, surfacePpi },
};
