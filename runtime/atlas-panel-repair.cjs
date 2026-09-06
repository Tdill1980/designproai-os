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
 * WHICH SURFACE IT LANDS ON IS THE OWNER'S SURFACE-CONTENT CONTRACT, NOT A
 * HEURISTIC. An earlier cut of this file sent the element to "whichever surface
 * already holds most of it". The owner rejected that by name (2026-09-05): on
 * Arctic Air it put the website on the hood and left the rear bare -- another
 * arbitrary layout decision. The contract that replaces it, verbatim:
 *
 *   - driver and passenger stay byte-identical when already valid;
 *   - explicit customer placement instructions always win;
 *   - default REAR: website / contact information;
 *   - default HOOD: complete logo / mascot, or uninterrupted artwork;
 *   - default ROOF and FRONT: continuous artwork unless requested otherwise;
 *   - never split a logo, wordmark, URL, phone, mascot or focal image;
 *   - if a required element cannot fit ENTIRELY within its assigned panel-safe
 *     area, REFUSE the master -- never silently relocate it elsewhere.
 *
 * So there is no fallback surface and no second choice. An element goes to its
 * assigned surface or the run fails with the reason, and a kind the contract
 * does not assign (a photograph, a focal illustration) with no explicit
 * instruction is refused too, because guessing is what this replaces.
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

const SURFACE_CONTENT_CONTRACT = "designpro.atlas-surface-content.v1";

/**
 * THE OWNER'S DEFAULTS, BY ELEMENT KIND. Contact information goes to the rear;
 * the brand mark goes to the hood. Anything else has NO default: roof and
 * front carry continuous artwork, and a photograph or focal subject that the
 * cut severed is refused unless the customer said where it goes. Guessing a
 * home for it is the heuristic this contract replaces.
 */
const DEFAULT_HOME_BY_KIND = Object.freeze({
  contact: "rear",
  website: "rear",
  url: "rear",
  phone: "rear",
  email: "rear",
  address: "rear",
  logo: "hood",
  mascot: "hood",
  wordmark: "hood",
  badge: "hood",
  emblem: "hood",
});

/** Kinds that read as contact information. A lockup holding one is a contact lockup. */
const CONTACT_KINDS = new Set(["contact", "website", "url", "phone", "email", "address"]);

/** Kinds that read as the brand mark. */
const MARK_KINDS = new Set(["logo", "mascot", "wordmark", "badge", "emblem"]);

/** The flanks are never a relocation target: when valid they stay byte-identical. */
const PROTECTED_SURFACES = new Set(["driver", "passenger"]);

/**
 * The lifted rectangle is grown by this share of the element's OWN shorter
 * side (floor 12 px), so a mascot's hair tuft, a keyline glow or an icicle drip
 * comes with its element instead of being left behind as an orphan. Relative
 * to the element, not the sheet: a first cut used the ported detector's 3% of
 * the whole master, which on a 319 px lockup was 123 px per side -- the lift
 * reached into the band above it and the heal washed out from there. 15% is
 * what it took to carry Arctic Air's plate glow (about 40 px on a 319 px
 * lockup); 8% left a light strip above the fill.
 */
const LIFT_DILATION_RATIO = 0.15;
const LIFT_DILATION_MIN_PX = 12;

/**
 * How far outside a vacated rectangle the "artwork only" sampling guard
 * extends. The heal must grow from the design around the element, never from
 * the unpainted sheet outside a zone -- on Arctic Air the hood's vacated band
 * sat one pixel above the black outside its container and healed dark.
 */
const HEAL_GUARD_PX = 96;

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
  let groups = items.map((item) => ({ labels: [item.label], kinds: [normalizeKind(item.kind)], rect: { ...item.rect } }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        if (gapBetween(groups[i].rect, groups[j].rect) > gap) continue;
        groups[i] = {
          labels: [...groups[i].labels, ...groups[j].labels],
          kinds: [...groups[i].kinds, ...groups[j].kinds],
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

/** A locator label like "contact-banner" or "LOGO" to one contract kind. */
function normalizeKind(kind) {
  const value = String(kind || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!value) return "unknown";
  if (/(website|url|web|www|domain)/.test(value)) return "website";
  if (/(phone|tel|number)/.test(value)) return "phone";
  if (/email/.test(value)) return "email";
  if (/address/.test(value)) return "address";
  if (/contact/.test(value)) return "contact";
  if (/(mascot|character)/.test(value)) return "mascot";
  if (/(wordmark|logotype|lettering|name)/.test(value)) return "wordmark";
  if (/(logo|badge|emblem|crest|shield|mark)/.test(value)) return "logo";
  if (/(tagline|slogan)/.test(value)) return "tagline";
  if (/(photo|picture|image)/.test(value)) return "photograph";
  if (/focal|subject|illustration/.test(value)) return "focal";
  return value;
}

/**
 * The kind of a whole group. A lockup that carries contact information IS
 * contact information -- the badge beside `Www.ArcticAir.com` rides with it to
 * the rear -- and otherwise a lockup that carries the mark is the mark.
 */
function groupKind(kinds) {
  if (kinds.some((kind) => CONTACT_KINDS.has(kind))) return "contact";
  if (kinds.some((kind) => MARK_KINDS.has(kind))) return "logo";
  return kinds.find((kind) => kind && kind !== "unknown") || "unknown";
}

/**
 * Where a group is ASSIGNED. Explicit customer placement first, by kind or by
 * any of the group's labels; then the owner's default by kind; otherwise
 * nowhere, which is a refusal, not a search.
 */
function assignedSurface(group, placements) {
  const explicit = placements && typeof placements === "object" ? placements : {};
  const kind = groupKind(group.kinds);
  for (const key of [kind, ...group.kinds, ...group.labels]) {
    const target = explicit[String(key).toLowerCase()];
    if (target) return { surfaceKey: String(target).toLowerCase(), basis: "customer", kind };
  }
  if (DEFAULT_HOME_BY_KIND[kind]) return { surfaceKey: DEFAULT_HOME_BY_KIND[kind], basis: "default", kind };
  return { surfaceKey: null, basis: "unassigned", kind };
}

/**
 * Where each severed group goes, and at what size. Pure geometry -- callable
 * without an image, which is what makes the placement provable in a test.
 *
 * `placements` is the customer's explicit instruction, `{ kind|label: surface }`.
 * It always wins. With none, the owner's defaults apply. A group that resolves
 * to no surface, or does not FIT its surface, is `placeable: false` with the
 * reason -- and the caller refuses the master. There is no second choice.
 */
function planPanelRepair({ containment = [], manifest, masterWidth, masterHeight = masterWidth, placements = null }) {
  const zones = (manifest?.zones || []).filter((zone) => zone && zone.surfaceKey);
  if (!zones.length) throw new PanelRepairError("atlas_panel_repair_manifest_zones_missing", "panel repair requires the manifest zones");

  const severed = containment
    .filter((item) => item.status === "severed" && item.rect)
    .map((item) => {
      const dilate = Math.max(LIFT_DILATION_MIN_PX, Math.round(Math.min(item.rect.w, item.rect.h) * LIFT_DILATION_RATIO));
      const x = Math.max(0, item.rect.x - dilate);
      const y = Math.max(0, item.rect.y - dilate);
      return {
        ...item,
        rect: {
          x,
          y,
          w: Math.min(masterWidth - x, item.rect.w + 2 * dilate),
          h: Math.min(masterHeight - y, item.rect.h + 2 * dilate),
        },
      };
    });
  const groups = groupSeveredElements(severed, masterWidth);

  return groups.map((group) => {
    const across = zones
      .map((zone) => ({ zone, overlap: rectArea(intersect(group.rect, containerRect(zone))) }))
      .filter((entry) => entry.overlap > 0)
      .sort((left, right) => right.overlap - left.overlap)
      .map((entry) => entry.zone.surfaceKey);
    const assignment = assignedSurface(group, placements);
    const base = {
      contract: SURFACE_CONTENT_CONTRACT,
      labels: group.labels,
      kind: assignment.kind,
      sourceRect: group.rect,
      acrossSurfaces: across,
      assignedSurface: assignment.surfaceKey,
      assignmentBasis: assignment.basis,
    };

    if (!assignment.surfaceKey) {
      return {
        ...base,
        placeable: false,
        code: "atlas_panel_element_unassigned",
        reason: `no surface is assigned for a severed "${assignment.kind}" element and the customer gave no placement — refusing rather than guessing`,
      };
    }
    if (PROTECTED_SURFACES.has(assignment.surfaceKey) && assignment.basis !== "customer") {
      return {
        ...base,
        placeable: false,
        code: "atlas_panel_element_flank_protected",
        reason: `${assignment.surfaceKey} is never a relocation target by default`,
      };
    }
    const zone = zones.find((candidate) => candidate.surfaceKey === assignment.surfaceKey);
    if (!zone) {
      return {
        ...base,
        placeable: false,
        code: "atlas_panel_element_surface_unknown",
        reason: `assigned surface "${assignment.surfaceKey}" is not in this manifest`,
      };
    }

    const box = placeableRect(zone);
    const scale = Math.min(1, box.w / group.rect.w, box.h / group.rect.h);
    const w = Math.max(1, Math.round(group.rect.w * scale));
    const h = Math.max(1, Math.round(group.rect.h * scale));
    const inPerPx = inchesPerPixelY(zone);
    const heightIn = inPerPx ? Number((h * inPerPx).toFixed(2)) : null;
    if (heightIn !== null && heightIn < MIN_ELEMENT_HEIGHT_IN) {
      // DOES NOT FIT. Refuse; never shrink below legibility, never try another
      // surface.
      return {
        ...base,
        placeable: false,
        code: "atlas_panel_element_does_not_fit",
        reason: `the element would print ${heightIn}" tall inside ${zone.surfaceKey}'s panel-safe area; ${MIN_ELEMENT_HEIGHT_IN}" is the minimum`,
        heightIn,
      };
    }

    // Centred in the panel-safe area. The element is moving to a DIFFERENT
    // surface under a stated contract, so there is no "where the composition
    // already put it" to preserve; centring is the one placement that adds no
    // opinion of its own.
    const x = Math.round(box.x + (box.w - w) / 2);
    const y = Math.round(box.y + (box.h - h) / 2);

    return {
      ...base,
      placeable: true,
      surfaceKey: zone.surfaceKey,
      targetRect: { x, y, w, h },
      scale: Number(scale.toFixed(4)),
      heightIn,
      installerInsetIn: INSTALLER_INSET_IN,
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
async function repairMasterPanels({ masterBytes, manifest, containment = [], placements = null } = {}) {
  if (!Buffer.isBuffer(masterBytes)) {
    throw new PanelRepairError("atlas_panel_repair_master_missing", "panel repair requires the accepted master bytes");
  }
  const { data, info } = await sharp(masterBytes).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // The master's own density travels with the repaired sheet. Without it the
  // panel cutter embeds a different pHYs chunk, and a byte-identical driver
  // panel comes out with a different hash -- which is what the fidelity proof
  // caught on the first measured run.
  const { density } = await sharp(masterBytes).metadata();

  const plan = planPanelRepair({ containment, manifest, masterWidth: width, masterHeight: height, placements });
  const refused = plan.filter((entry) => !entry.placeable);
  if (refused.length) {
    // REFUSE, DO NOT RELOCATE. The owner's contract: an element that cannot
    // fit entirely within its assigned panel-safe area fails the master.
    throw new PanelRepairError(
      "atlas_panel_element_unplaceable",
      refused.map((entry) => `[${entry.labels.join(" + ")}] ${entry.reason}`).join("; "),
      { repairs: plan },
    );
  }
  const placeable = plan;
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
  //
  //    ARTWORK ONLY. The diffusion grows inward from every settled neighbour,
  //    and on a sheet masked to its zones the neighbour just outside a container
  //    is unpainted black. Arctic Air's hood band healed dark from exactly that.
  //    So every non-zone pixel within HEAL_GUARD_PX of a vacated rectangle is
  //    marked pending too -- never sampled -- and restored from the original
  //    afterwards, so nothing outside a zone changes by a single byte.
  const zones = (manifest?.zones || []).filter((zone) => zone && zone.surfaceKey);
  const insideZone = (x, y) => zones.some((zone) => x >= zone.x && y >= zone.y && x < zone.x + zone.width && y < zone.y + zone.height);
  const mask = new Uint8Array(width * height);
  const guarded = [];
  let vacatedPixels = 0;
  for (const entry of placeable) {
    const rect = entry.sourceRect;
    // Vacated (healed) only INSIDE a zone. Outside one there is no artwork to
    // vacate -- those pixels are pending-and-restored like the guard ring, so
    // the sheet outside its zones is never painted by a single byte.
    for (let y = rect.y - HEAL_GUARD_PX; y < rect.y + rect.h + HEAL_GUARD_PX; y += 1) {
      if (y < 0 || y >= height) continue;
      for (let x = rect.x - HEAL_GUARD_PX; x < rect.x + rect.w + HEAL_GUARD_PX; x += 1) {
        if (x < 0 || x >= width) continue;
        const index = y * width + x;
        if (mask[index]) continue;
        const inRect = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
        if (!insideZone(x, y)) {
          mask[index] = 1;
          guarded.push(index);
        } else if (inRect) {
          mask[index] = 1;
          vacatedPixels += 1;
        }
      }
    }
  }
  const original = Buffer.from(data);

  // 2a. CONTINUE THE BAND. Boundary averaging is the wrong tool for a long,
  //     thin vacated rectangle: its frontier walks in from the two short ends
  //     at 45 degrees and straight down from whatever is brightest above, and
  //     the result is vertical streaking with dark wedges in the corners --
  //     measured on Arctic Air's hood. The band the lockup sat on is the
  //     design's own repeating gear-and-snowflake ground, so each vacated row
  //     is filled from ITS OWN row: the settled pixels to its left, mirrored,
  //     and the settled pixels to its right, mirrored, crossfaded through the
  //     middle. This is the reflection RULE 0.15 already uses for the 5" bleed,
  //     applied across a rectangle with straight edges. A pixel with no in-zone
  //     source on either side stays pending for the diffusion below.
  const settledInZone = (x, y) => x >= 0 && y >= 0 && x < width && y < height && !mask[y * width + x] && insideZone(x, y);
  let continued = 0;
  for (const entry of placeable) {
    const rect = entry.sourceRect;
    for (let y = Math.max(0, rect.y); y < Math.min(height, rect.y + rect.h); y += 1) {
      const rowStart = y * width;
      // The vacated run on this row, clipped to what was actually masked.
      let x0 = Math.max(0, rect.x);
      let x1 = Math.min(width, rect.x + rect.w);
      while (x0 < x1 && !(mask[rowStart + x0] && insideZone(x0, y))) x0 += 1;
      while (x1 > x0 && !(mask[rowStart + x1 - 1] && insideZone(x1 - 1, y))) x1 -= 1;
      if (x0 >= x1) continue;
      const span = x1 - x0;
      // The settled, in-zone runs immediately beside the vacated run on this
      // row. The reflection FOLDS inside them (mirror-repeat), so a run wider
      // than its neighbour still has a source on every pixel -- a straight
      // mirror ran out of artwork on the rear's left and fell back to the
      // streaky diffusion.
      let leftLen = 0;
      while (settledInZone(x0 - 1 - leftLen, y)) leftLen += 1;
      let rightLen = 0;
      while (settledInZone(x1 + rightLen, y)) rightLen += 1;
      if (!leftLen && !rightLen) continue;
      const fold = (d, len) => { const k = d % (2 * len); return k < len ? k : 2 * len - 1 - k; };
      for (let x = x0; x < x1; x += 1) {
        const index = rowStart + x;
        if (!mask[index] || !insideZone(x, y)) continue;
        const left = leftLen ? x0 - 1 - fold(x - x0, leftLen) : null;
        const right = rightLen ? x1 + fold(x1 - 1 - x, rightLen) : null;
        // Weight by distance so each side dominates its own half.
        const t = (x - x0 + 0.5) / span;
        const wl = left === null ? 0 : (right === null ? 1 : 1 - t);
        const wr = right === null ? 0 : (left === null ? 1 : t);
        for (let c = 0; c < channels; c += 1) {
          const l = left === null ? 0 : original[(rowStart + left) * channels + c];
          const r = right === null ? 0 : original[(rowStart + right) * channels + c];
          data[index * channels + c] = Math.round(wl * l + wr * r);
        }
        if (channels > 3) data[index * channels + channels - 1] = 255;
        mask[index] = 0;
        continued += 1;
      }
    }
  }

  // 2b. DIFFUSE whatever the continuation could not source. `diffuseInto`
  //     returns the count of pixels it could NOT close -- a region with no
  //     settled neighbour anywhere. That is a structural impossibility, not a
  //     soft outcome, so it raises rather than shipping a hole where a wordmark
  //     used to be.
  const unresolved = diffuseInto(data, width, height, channels, mask);
  for (const index of guarded) {
    for (let c = 0; c < channels; c += 1) data[index * channels + c] = original[index * channels + c];
  }
  if (unresolved > 0) {
    throw new PanelRepairError(
      "atlas_panel_repair_heal_incomplete",
      `${unresolved} px of the vacated region could not be closed from surrounding artwork`,
    );
  }

  const healedBytes = await sharp(data, { raw: { width, height, channels } })
    .withMetadata(density ? { density } : {})
    .png()
    .toBuffer();

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
  const repaired = await sharp(healedBytes)
    .composite(composites)
    .withMetadata(density ? { density } : {})
    .png()
    .toBuffer();

  return {
    contract: PANEL_REPAIR_CONTRACT,
    changed: true,
    bytes: repaired,
    contentHash: sha256(repaired),
    vacatedPixels,
    continuedPixels: continued,
    repairs: plan,
  };
}

module.exports = {
  PANEL_REPAIR_CONTRACT,
  SURFACE_CONTENT_CONTRACT,
  DEFAULT_HOME_BY_KIND,
  INSTALLER_INSET_IN,
  MIN_ELEMENT_HEIGHT_IN,
  GROUP_GAP_RATIO,
  LIFT_DILATION_RATIO,
  LIFT_DILATION_MIN_PX,
  HEAL_GUARD_PX,
  PanelRepairError,
  planPanelRepair,
  repairMasterPanels,
  _test: { groupSeveredElements, placeableRect, intersect, unionRect, gapBetween, trimRect, containerRect, normalizeKind, groupKind, assignedSurface },
};
