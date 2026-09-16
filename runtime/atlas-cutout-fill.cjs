"use strict";

/**
 * Close a punched wheel arch, window or bed opening by continuing the artwork
 * that borders it. Deterministic pixel work: no AI, no new design authority.
 *
 * WHY THIS EXISTS. The 3D proof masks the master to the real painted body, so a
 * hole where the wheel arch sits lands in the region the mask discards -- the
 * proof is correct either way. The hole only becomes real at the panel cut,
 * where it prints as a hole in the vinyl. So the master is kept exactly as
 * authored and stays the proof authority, and the PANELS are cut from a filled
 * duplicate instead. That split is what lets the proofs start immediately
 * instead of waiting on re-rolls for panel-quality artwork.
 *
 * WHY A DUPLICATE. The authored master is never mutated -- same rule as the
 * Call 11 de-logo set: duplicate, modify the duplicate, preserve the original
 * byte for byte. The proofs and the master keep agreeing; only the panel source
 * differs, and only inside a region the proof masks away.
 *
 * WHY DIFFUSION AND NOT MIRRORING. Mirroring is well defined across a straight
 * outer edge, which is why the 5" bleed uses it. It is not well defined across
 * an interior hole -- there is no single axis to reflect over. Repeatedly
 * averaging each boundary pixel from the artwork it already touches grows the
 * surrounding design inward from every side at once, closes any shape, and is
 * exactly reproducible.
 *
 * WHAT IT WILL NOT DO. It does not invent. A large hole through busy artwork
 * closes as a soft continuation of its own border, not as new design, and that
 * is the honest outcome: the master said nothing there, so nothing is asserted.
 * `masterCutoutSurfaces` still records that the sheet arrived holed, and
 * PanelPro's human QC still sees those sides flagged on the template.
 */

const sharp = require("sharp");
const {
  CUTOUT_ALPHA_MAX,
  FLAT_BLACK_CHANNEL_MAX,
  MIN_CUTOUT_COMPONENT_RATIO,
  VOID_BLOCK,
  detectVoidBlobs,
  nearBlackAt,
} = require("./atlas-master-qc.cjs");

const FILL_CONTRACT = "designpro.atlas-cutout-fill.v1";
// A wheel arch closes in roughly its own radius. The cap only stops a
// pathological mask (a zone that is mostly hole) from spinning; the loop
// already exits as soon as nothing is left to fill.
const MAX_FILL_PASSES = 512;

class AtlasCutoutFillError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AtlasCutoutFillError";
    this.code = code;
  }
}

/**
 * The convicted hole mask for one zone raster.
 *
 * Built on the gate's own criteria: a hole pixel is near-black or transparent,
 * a hole INTERIOR is one whose four neighbours are also holes, and only
 * components at least MIN_CUTOUT_COMPONENT_RATIO of the zone count -- the floor
 * that stops anti-aliased lettering and shadow texture reading as an opening.
 *
 * The convicted interiors then flood back out over every touching hole pixel,
 * so the returned mask covers the whole shape including its one-pixel rim.
 * Filling interiors alone would leave a dark outline exactly where the opening
 * was.
 */
function convictedHoleMask({ data, width, height, channels }) {
  const pixelCount = width * height;
  const holeAt = (px, py) => {
    if (px < 0 || py < 0 || px >= width || py >= height) return true;
    const offset = (py * width + px) * channels;
    const red = data[offset];
    const green = data[offset + 1] ?? red;
    const blue = data[offset + 2] ?? red;
    if (channels > 3 && data[offset + channels - 1] < CUTOUT_ALPHA_MAX) return true;
    return Math.max(red, green, blue) <= FLAT_BLACK_CHANNEL_MAX;
  };

  const hole = new Uint8Array(pixelCount);
  const interior = new Uint8Array(pixelCount);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      if (!holeAt(px, py)) continue;
      const index = py * width + px;
      hole[index] = 1;
      if (holeAt(px - 1, py) && holeAt(px + 1, py) && holeAt(px, py - 1) && holeAt(px, py + 1)) {
        interior[index] = 1;
      }
    }
  }

  // Label interior components; keep the ones big enough to be an opening.
  const seen = new Uint8Array(pixelCount);
  const stack = new Int32Array(pixelCount);
  const floor = Math.max(1, Math.floor(pixelCount * MIN_CUTOUT_COMPONENT_RATIO));
  const convictedSeeds = [];
  let convictedComponents = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    if (!interior[index] || seen[index]) continue;
    let top = 0;
    stack[top] = index; top += 1; seen[index] = 1;
    const members = [];
    while (top > 0) {
      top -= 1;
      const current = stack[top];
      members.push(current);
      const x = current % width;
      const y = (current - x) / width;
      const push = (neighbour) => {
        if (interior[neighbour] && !seen[neighbour]) { seen[neighbour] = 1; stack[top] = neighbour; top += 1; }
      };
      if (x > 0) push(current - 1);
      if (x + 1 < width) push(current + 1);
      if (y > 0) push(current - width);
      if (y + 1 < height) push(current + width);
    }
    if (members.length >= floor) {
      convictedComponents += 1;
      convictedSeeds.push(members);
    }
  }
  // THE NEAR-BLACK VOID BLOBS THE GATE CONVICTS BY SHAPE. Every pixel of a
  // convicted blob's cells is masked, and within one cell of its border any
  // near-black pixel is masked too, so the shape's soft rim closes with it
  // while a dark outline running away across the panel is left alone.
  const voids = detectVoidBlobs({ data, width, height, channels });
  const voidMask = new Uint8Array(pixelCount);
  let voidComponents = 0;
  for (const blob of voids.blobs) {
    if (!blob.convicted) continue;
    voidComponents += 1;
    const core = new Uint8Array(voids.cols * voids.rows);
    for (const cell of blob.cells) core[cell] = 1;
    for (const cell of blob.cells) {
      const cx = cell % voids.cols;
      const cy = (cell - cx) / voids.cols;
      for (let ny = cy - 1; ny <= cy + 1; ny += 1) {
        for (let nx = cx - 1; nx <= cx + 1; nx += 1) {
          if (nx < 0 || ny < 0 || nx >= voids.cols || ny >= voids.rows) continue;
          const isCore = core[ny * voids.cols + nx] === 1;
          for (let py = ny * VOID_BLOCK; py < Math.min(height, (ny + 1) * VOID_BLOCK); py += 1) {
            for (let px = nx * VOID_BLOCK; px < Math.min(width, (nx + 1) * VOID_BLOCK); px += 1) {
              if (isCore || nearBlackAt(data, width, height, channels, px, py)) voidMask[py * width + px] = 1;
            }
          }
        }
      }
    }
  }
  if (!convictedComponents && !voidComponents) return { mask: null, pixels: 0, components: 0 };

  // Flood each convicted interior outward across touching hole pixels so the
  // shape's rim is filled too.
  const mask = new Uint8Array(pixelCount);
  let filledPixels = 0;
  let top = 0;
  for (const members of convictedSeeds) {
    for (const member of members) {
      if (mask[member]) continue;
      mask[member] = 1; filledPixels += 1;
      stack[top] = member; top += 1;
    }
  }
  while (top > 0) {
    top -= 1;
    const current = stack[top];
    const x = current % width;
    const y = (current - x) / width;
    const push = (neighbour) => {
      if (hole[neighbour] && !mask[neighbour]) {
        mask[neighbour] = 1; filledPixels += 1; stack[top] = neighbour; top += 1;
      }
    };
    if (x > 0) push(current - 1);
    if (x + 1 < width) push(current + 1);
    if (y > 0) push(current - width);
    if (y + 1 < height) push(current + width);
  }
  // A pure-black shape is seen by both readings; count it once.
  let newVoidComponents = 0;
  for (const blob of voids.blobs) {
    if (!blob.convicted) continue;
    let overlaps = false;
    for (const cell of blob.cells) {
      const cx = cell % voids.cols;
      const cy = (cell - cx) / voids.cols;
      const px = Math.min(width - 1, cx * VOID_BLOCK);
      const py = Math.min(height - 1, cy * VOID_BLOCK);
      if (mask[py * width + px]) { overlaps = true; break; }
    }
    if (!overlaps) newVoidComponents += 1;
  }
  for (let index = 0; index < pixelCount; index += 1) {
    if (voidMask[index] && !mask[index]) { mask[index] = 1; filledPixels += 1; }
  }
  return { mask, pixels: filledPixels, components: convictedComponents + newVoidComponents };
}

/**
 * Grow the bordering artwork inward until the masked region is closed.
 *
 * Each pass writes only the masked pixels that currently touch settled artwork,
 * averaging the settled neighbours it touches. Reading from the previous pass's
 * buffer keeps the result independent of scan order, which is what makes it
 * reproducible rather than merely deterministic-looking.
 */
const NEIGHBOUR_DX = Object.freeze([-1, 1, 0, 0, -1, 1, -1, 1]);
const NEIGHBOUR_DY = Object.freeze([0, 0, -1, 1, -1, -1, 1, 1]);

function diffuseInto(data, width, height, channels, mask) {
  const pending = Uint8Array.from(mask);
  // THE FRONTIER, NOT THE WHOLE ZONE. (2026-08-31)
  //
  // This walked every pixel of the zone on every pass and copied the entire
  // zone buffer on every pass, so the cost was passes x zone area twice over.
  // A hole closes in roughly its own radius, so a wheel arch ~300px across
  // needs ~150 passes -- and on the driver flank of a 4096px master that is
  // gigabytes of copying. Measured on generation 7a1062f4: 174,678ms, against
  // the ~100ms this step is documented to cost, and 75% of the whole of
  // Call 1. The customer watched "A.C.E. is designing your wrap" for three
  // minutes for it.
  //
  // Only masked pixels are ever written and only settled pixels are ever read,
  // so the work was always proportional to the hole; iterating the frontier
  // just stops paying for the rest of the zone. Indices stay in ascending
  // order, which is the order the full scan visited them in.
  let remaining = 0;
  for (let index = 0; index < pending.length; index += 1) if (pending[index]) remaining += 1;

  // The frontier is the masked pixels that TOUCH settled artwork. A masked
  // pixel with no settled neighbour samples nothing, writes nothing and stays
  // pending, so visiting it is pure cost -- and visiting it every pass is what
  // made the fill quadratic in the hole as well as in the zone. Seeding from
  // the border and re-seeding from each pass's own settled pixels keeps the
  // total work proportional to the hole's area instead of its area times its
  // radius. The written pixels are the same ones either way.
  const queued = new Uint8Array(pending.length);
  let frontier = [];
  for (let index = 0; index < pending.length; index += 1) {
    if (!pending[index]) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (let n = 0; n < 8; n += 1) {
      const nx = x + NEIGHBOUR_DX[n];
      const ny = y + NEIGHBOUR_DY[n];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (pending[ny * width + nx]) continue;
      frontier.push(index);
      queued[index] = 1;
      break;
    }
  }

  const totals = new Array(channels).fill(0);
  for (let pass = 0; pass < MAX_FILL_PASSES && frontier.length; pass += 1) {
    const settledThisPass = [];
    const stillPending = [];
    for (let i = 0; i < frontier.length; i += 1) {
      const index = frontier[i];
      const x = index % width;
      const y = (index - x) / width;
      let count = 0;
      for (let c = 0; c < channels; c += 1) totals[c] = 0;
      for (let n = 0; n < 8; n += 1) {
        const nx = x + NEIGHBOUR_DX[n];
        const ny = y + NEIGHBOUR_DY[n];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        // Still a hole this pass. A pixel settled EARLIER in this same pass is
        // also still flagged -- `pending` clears only after the pass -- so a
        // read can never observe a write from its own pass. That is why the
        // previous-pass copy this loop used to take is unnecessary rather than
        // merely wasteful: the result is identical without it.
        if (pending[neighbour]) continue;
        const offset = neighbour * channels;
        for (let c = 0; c < channels; c += 1) totals[c] += data[offset + c];
        count += 1;
      }
      if (!count) { stillPending.push(index); continue; }
      const offset = index * channels;
      for (let c = 0; c < channels; c += 1) data[offset + c] = Math.round(totals[c] / count);
      if (channels > 3) data[offset + channels - 1] = 255; // closed artwork is opaque
      settledThisPass.push(index);
    }
    if (!settledThisPass.length) break; // nothing borders artwork; cannot close
    for (let i = 0; i < settledThisPass.length; i += 1) pending[settledThisPass[i]] = 0;
    remaining -= settledThisPass.length;

    // Next pass's frontier: what this pass just settled has exposed. Carrying
    // `stillPending` forward too keeps a pixel that could not close this pass
    // (its only neighbours were also holes) in the running.
    const next = stillPending;
    for (let i = 0; i < settledThisPass.length; i += 1) {
      const index = settledThisPass[i];
      queued[index] = 0;
      const x = index % width;
      const y = (index - x) / width;
      for (let n = 0; n < 8; n += 1) {
        const nx = x + NEIGHBOUR_DX[n];
        const ny = y + NEIGHBOUR_DY[n];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (!pending[neighbour] || queued[neighbour]) continue;
        queued[neighbour] = 1;
        next.push(neighbour);
      }
    }
    // Ascending order, which is the order the original full scan visited
    // pending pixels in. Writes within a pass never read each other, so this
    // cannot change the result -- it keeps the equivalence obvious.
    next.sort((left, right) => left - right);
    frontier = next;
  }
  return remaining;
}


/**
 * EXEMPLAR INPAINT: CONTINUE THE ARTWORK, DO NOT AVERAGE IT.
 * (owner, 2026-09-08 and every day since: "It's a simple inpaint fill I have
 * needed since the 8th")
 *
 * `diffuseInto` below averages each frontier pixel from the settled artwork it
 * touches. Across a small edge nick that is right. Across a WHEEL ARCH it is
 * the defect: averaging dark neighbours inward over a 300px disc produces a
 * smooth dark blob, which CLOSES the hole without CONTINUING the design.
 *
 * Measured on generation 5d727ea9 -- the September 1 A.T.L.A.S. the owner has
 * been asking to return to -- `cutoutFillApplied` reported 303,861 px closed on
 * the driver flank with `unresolvedPixels: 0`, and the gate passed it, because
 * the filled disc measures about rgb(25,19,23) against a near-black threshold
 * of 24. It moved the defect one value on one channel out of the only predicate
 * watching it, while 7.55% of that flank was still one uniform non-artwork
 * field. Visually: still a black wheel well. That is the whole reason this
 * function exists.
 *
 * WHAT IT DOES INSTEAD. Onion-peel, boundary inward, exactly the frontier order
 * `diffuseInto` already established -- but each frontier pixel is COPIED from
 * the best-matching patch of real artwork elsewhere in the same zone rather
 * than averaged from its rim. Candidate sources are, in this fixed order:
 *
 *   1. the offsets already chosen by settled neighbours (coherence). This is
 *      what continues a circuit trace, a stripe or a nebula band straight
 *      across the opening instead of smearing it -- a line entering the hole
 *      keeps its direction because its neighbours keep handing their offset
 *      forward.
 *   2. deterministic ring samples at increasing radii, so a region whose
 *      neighbours have nothing to propagate still reaches genuine artwork.
 *
 * Each candidate is scored by sum-of-squared-difference over the patch
 * positions where BOTH the target and the source are settled, with an early
 * exit once a candidate is already worse than the best. Ties break on the
 * smaller offset, then the lower index, so the result is reproducible rather
 * than merely deterministic-looking -- the same requirement `diffuseInto`
 * documents, and the same reason a resumed revision can rebuild this byte for
 * byte and `flat_atlas_surface_source_mismatch` still means something.
 *
 * STILL NOT INVENTION. Every pixel written is a pixel of this zone's own
 * artwork, copied. Nothing new is designed, no model is called, and a hole with
 * no artwork to draw from still fails to close and is still reported through
 * `unresolvedPixels`. `masterCutoutSurfaces` still records that the sheet
 * arrived holed and PanelPro's human QC still sees those sides flagged.
 */
const PATCH_RADIUS = 3;                       // 7x7 comparison window
const RING_RADII = Object.freeze([6, 12, 24, 48, 96]);
const RING_ANGLES = 12;                       // every 30 degrees
const VOTE_PASSES = 2;                        // seam removal, see inpaintInto
const SEARCH_RADIUS = 256;                    // random-search start, halving
const SEARCH_SAMPLES = 2;                     // samples per radius step

// The ring offsets are computed once, in a fixed order, so every zone and every
// rebuild scores the same candidates in the same sequence.
const RING_OFFSETS = (() => {
  const offsets = [];
  for (const radius of RING_RADII) {
    for (let step = 0; step < RING_ANGLES; step += 1) {
      const angle = (2 * Math.PI * step) / RING_ANGLES;
      offsets.push([Math.round(radius * Math.cos(angle)), Math.round(radius * Math.sin(angle))]);
    }
  }
  return Object.freeze(offsets.map(Object.freeze));
})();

function inpaintInto(data, width, height, channels, mask, options = {}) {
  // When the hole already carries an estimate (upsampled from a coarser level)
  // every patch position is worth comparing, including the ones inside the
  // hole. That is what stops the first ring of pixels committing to an offset
  // on almost no evidence and then propagating it across the whole opening.
  const estimated = options.estimated === true;
  const pixelCount = width * height;
  const pending = Uint8Array.from(mask);
  let remaining = 0;
  for (let index = 0; index < pending.length; index += 1) if (pending[index]) remaining += 1;
  if (!remaining) return 0;

  // The source offset each settled hole pixel was copied from, for propagation.
  // Zero means "not copied" (original artwork, or not yet settled).
  const offsetX = new Int32Array(pixelCount);
  const offsetY = new Int32Array(pixelCount);
  const copied = new Uint8Array(pixelCount);

  const queued = new Uint8Array(pixelCount);
  let frontier = [];
  for (let index = 0; index < pending.length; index += 1) {
    if (!pending[index]) continue;
    const x = index % width;
    const y = (index - x) / width;
    for (let n = 0; n < 8; n += 1) {
      const nx = x + NEIGHBOUR_DX[n];
      const ny = y + NEIGHBOUR_DY[n];
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (pending[ny * width + nx]) continue;
      frontier.push(index);
      queued[index] = 1;
      break;
    }
  }

  // Score one candidate source against the target's settled neighbourhood.
  // Returns -1 when the candidate is unusable (off-canvas, itself a hole, or
  // with no overlapping settled evidence to judge it on).
  const scoreCandidate = (tx, ty, sx, sy, best) => {
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) return -1;
    if (pending[sy * width + sx]) return -1;
    let total = 0;
    let compared = 0;
    for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy += 1) {
      const tny = ty + dy;
      const sny = sy + dy;
      if (tny < 0 || sny < 0 || tny >= height || sny >= height) continue;
      for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx += 1) {
        const tnx = tx + dx;
        const snx = sx + dx;
        if (tnx < 0 || snx < 0 || tnx >= width || snx >= width) continue;
        const tIndex = tny * width + tnx;
        const sIndex = sny * width + snx;
        if (pending[sIndex]) continue;            // never score against unsettled source
        if (pending[tIndex] && !estimated) continue; // no estimate: only settled evidence
        const tOffset = tIndex * channels;
        const sOffset = sIndex * channels;
        for (let c = 0; c < 3 && c < channels; c += 1) {
          const delta = data[tOffset + c] - data[sOffset + c];
          total += delta * delta;
        }
        compared += 1;
        if (best >= 0 && total > best) return total; // early exit, still comparable
      }
    }
    if (!compared) return -1;
    return total / compared; // per-pixel, so patches with different overlap compare fairly
  };

  const totals = new Array(channels).fill(0);

  for (let pass = 0; pass < MAX_FILL_PASSES && frontier.length; pass += 1) {
    const settledThisPass = [];
    const stillPending = [];

    for (let i = 0; i < frontier.length; i += 1) {
      const index = frontier[i];
      const x = index % width;
      const y = (index - x) / width;

      let bestScore = -1;
      let bestX = -1;
      let bestY = -1;
      let bestDistance = Infinity;

      const consider = (candidateX, candidateY) => {
        const score = scoreCandidate(x, y, candidateX, candidateY, bestScore);
        if (score < 0) return;
        const dx = candidateX - x;
        const dy = candidateY - y;
        const distance = dx * dx + dy * dy;
        if (bestScore < 0 || score < bestScore
          || (score === bestScore && distance < bestDistance)) {
          bestScore = score; bestX = candidateX; bestY = candidateY; bestDistance = distance;
        }
      };

      // 1. COHERENCE. Reuse the offsets our settled neighbours were copied
      //    from, which is what carries a line across the opening.
      for (let n = 0; n < 8; n += 1) {
        const nx = x + NEIGHBOUR_DX[n];
        const ny = y + NEIGHBOUR_DY[n];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (pending[neighbour] || !copied[neighbour]) continue;
        consider(x + offsetX[neighbour], y + offsetY[neighbour]);
      }

      // 2. RINGS. Fixed samples at increasing radii so a pixel with nothing to
      //    inherit still reaches real artwork.
      for (let r = 0; r < RING_OFFSETS.length; r += 1) {
        consider(x + RING_OFFSETS[r][0], y + RING_OFFSETS[r][1]);
      }

      // 3. RANDOM SEARCH, HALVING. Propagation and a fixed ring between them
      //    offer only a few dozen distinct offsets, so large regions all snap
      //    to the SAME source and the boundary between two such regions is a
      //    hard-edged block -- visible on a real driver flank and worse for a
      //    print panel than the smear it replaced. Refining the current best
      //    over a window that halves each step lets every pixel settle
      //    independently instead of quantising onto the ring, which is what
      //    turns coherent blocks back into continuous artwork. The generator is
      //    seeded from the pixel index, so the sequence is identical on every
      //    rebuild -- reproducible, not merely deterministic-looking.
      let seed = (index * 2654435761) >>> 0;
      const nextRandom = () => {
        seed = (seed ^ (seed << 13)) >>> 0;
        seed = (seed ^ (seed >>> 17)) >>> 0;
        seed = (seed ^ (seed << 5)) >>> 0;
        return seed / 4294967296;
      };
      let radius = SEARCH_RADIUS;
      while (radius >= 1) {
        const baseX = bestX >= 0 ? bestX : x;
        const baseY = bestY >= 0 ? bestY : y;
        for (let attempt = 0; attempt < SEARCH_SAMPLES; attempt += 1) {
          consider(
            baseX + Math.round((nextRandom() * 2 - 1) * radius),
            baseY + Math.round((nextRandom() * 2 - 1) * radius),
          );
        }
        radius = Math.floor(radius / 2);
      }

      const offset = index * channels;
      if (bestScore >= 0) {
        const source = (bestY * width + bestX) * channels;
        for (let c = 0; c < channels; c += 1) data[offset + c] = data[source + c];
        if (channels > 3) data[offset + channels - 1] = 255;
        offsetX[index] = bestX - x;
        offsetY[index] = bestY - y;
        copied[index] = 1;
        settledThisPass.push(index);
        continue;
      }

      // NO EXEMPLAR REACHED THIS PIXEL. Fall back to the rim average -- the
      // pre-existing behaviour -- rather than leaving a hole. A pixel whose
      // neighbours are all holes settles nothing and stays pending, exactly as
      // before, so `unresolvedPixels` keeps its meaning.
      let count = 0;
      for (let c = 0; c < channels; c += 1) totals[c] = 0;
      for (let n = 0; n < 8; n += 1) {
        const nx = x + NEIGHBOUR_DX[n];
        const ny = y + NEIGHBOUR_DY[n];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (pending[neighbour]) continue;
        const neighbourOffset = neighbour * channels;
        for (let c = 0; c < channels; c += 1) totals[c] += data[neighbourOffset + c];
        count += 1;
      }
      if (!count) { stillPending.push(index); continue; }
      for (let c = 0; c < channels; c += 1) data[offset + c] = Math.round(totals[c] / count);
      if (channels > 3) data[offset + channels - 1] = 255;
      settledThisPass.push(index);
    }

    if (!settledThisPass.length) break; // nothing borders artwork; cannot close
    for (let i = 0; i < settledThisPass.length; i += 1) pending[settledThisPass[i]] = 0;
    remaining -= settledThisPass.length;

    const next = stillPending;
    for (let i = 0; i < settledThisPass.length; i += 1) {
      const index = settledThisPass[i];
      queued[index] = 0;
      const x = index % width;
      const y = (index - x) / width;
      for (let n = 0; n < 8; n += 1) {
        const nx = x + NEIGHBOUR_DX[n];
        const ny = y + NEIGHBOUR_DY[n];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbour = ny * width + nx;
        if (!pending[neighbour] || queued[neighbour]) continue;
        queued[neighbour] = 1;
        next.push(neighbour);
      }
    }
    next.sort((left, right) => left - right);
    frontier = next;
  }

  // VOTE, DO NOT STAMP. (the block seams)
  //
  // Copying one pixel per target keeps texture but lays down hard-edged blocks
  // wherever the chosen offset jumps between neighbours -- a run of pixels
  // agrees, the next run disagrees, and the boundary between them is a visible
  // rectangle. Measured on a real driver flank with a wheel arch punched into
  // it: the ribbons continued correctly and the seams were obvious.
  //
  // So the offsets are treated as a field to be RECONSTRUCTED from rather than
  // a set of stamps. Every filled pixel is re-derived as the mean of what each
  // overlapping patch says it should be: for each settled neighbour q within
  // PATCH_RADIUS, q's own source patch predicts a value for p, and those
  // predictions are averaged. Neighbours that agree reinforce; a lone
  // disagreeing offset is outvoted by its neighbourhood, which is exactly the
  // seam. This is the reconstruction half of the standard algorithm and it
  // costs one more pass over the hole, not another search.
  //
  // Reading `source` (a snapshot taken before the vote) rather than `data`
  // keeps a vote from observing another vote, so the result stays independent
  // of scan order -- the same reproducibility requirement the rest of this
  // module holds to.
  if (VOTE_PASSES > 0) {
    for (let round = 0; round < VOTE_PASSES; round += 1) {
      const source = Uint8Array.prototype.slice.call(data);
      for (let index = 0; index < pixelCount; index += 1) {
        if (!mask[index] || !copied[index]) continue;
        const x = index % width;
        const y = (index - x) / width;
        let count = 0;
        for (let c = 0; c < channels; c += 1) totals[c] = 0;
        for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy += 1) {
          const qy = y + dy;
          if (qy < 0 || qy >= height) continue;
          for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx += 1) {
            const qx = x + dx;
            if (qx < 0 || qx >= width) continue;
            const q = qy * width + qx;
            if (!copied[q]) continue;
            // What q's chosen patch predicts for THIS pixel.
            const px = x + offsetX[q];
            const py = y + offsetY[q];
            if (px < 0 || py < 0 || px >= width || py >= height) continue;
            const predicted = py * width + px;
            if (mask[predicted]) continue; // never vote with unsettled artwork
            const offset = predicted * channels;
            for (let c = 0; c < channels; c += 1) totals[c] += source[offset + c];
            count += 1;
          }
        }
        if (!count) continue;
        const offset = index * channels;
        for (let c = 0; c < channels; c += 1) data[offset + c] = Math.round(totals[c] / count);
        if (channels > 3) data[offset + channels - 1] = 255;
      }
    }
  }

  return remaining;
}


/**
 * MULTI-SCALE: SOLVE THE HOLE SMALL, THEN ADD THE DETAIL.
 *
 * `inpaintInto` on its own is single-scale, and on a real wheel arch that is
 * the whole problem. Measured on generation 5d727ea9's driver flank -- 304,896
 * px, 8.08% of the panel -- it tripled the texture (stdev 11.9 to 34.5) and
 * still read as blocky corruption, because the first ring of hole pixels has
 * almost no evidence to choose an offset from, commits anyway, and coherence
 * then propagates that choice across three hundred thousand pixels.
 *
 * The fix is not a better search at full resolution. It is to make the hole
 * SMALL. At 1/16 scale that wheel arch is about 38 px across and what has to be
 * decided is the nebula gradient, which patch matching gets right easily. That
 * result is then upsampled into the next level as an ESTIMATE, and the finer
 * level refines it with real evidence in every patch position rather than an
 * empty hole. Each level only has to add its own octave of detail.
 *
 *   coarsest  -- solve the gradient, hole is tens of pixels
 *   each finer level
 *              -- upsample the level below into the hole as the estimate
 *              -- re-run the exemplar pass, now scoring against that estimate
 *              -- vote
 *   full res  -- the last refinement; the settled artwork outside the hole is
 *                never touched at any level
 *
 * Downsampling is masked: a coarse pixel averages only its KNOWN children, so
 * the black of the hole is never mixed into the artwork that has to teach the
 * fill. A coarse pixel is a hole only when every one of its children is.
 */
const MIN_LEVEL_EDGE = 64;   // stop coarsening here; below this there is no structure left
const MAX_LEVELS = 6;

function downsampleMasked(data, width, height, channels, mask) {
  const w = Math.max(1, width >> 1);
  const h = Math.max(1, height >> 1);
  const out = new Uint8Array(w * h * channels);
  const outMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let known = 0;
      const sums = new Array(channels).fill(0);
      let anyPixel = 0;
      const fallback = new Array(channels).fill(0);
      for (let dy = 0; dy < 2; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const sy = y * 2 + dy;
          const sx = x * 2 + dx;
          if (sy >= height || sx >= width) continue;
          const index = sy * width + sx;
          const offset = index * channels;
          if (!anyPixel) { for (let c = 0; c < channels; c += 1) fallback[c] = data[offset + c]; anyPixel = 1; }
          if (mask[index]) continue;
          for (let c = 0; c < channels; c += 1) sums[c] += data[offset + c];
          known += 1;
        }
      }
      const target = (y * w + x) * channels;
      if (known) {
        for (let c = 0; c < channels; c += 1) out[target + c] = Math.round(sums[c] / known);
      } else {
        outMask[y * w + x] = 1;
        for (let c = 0; c < channels; c += 1) out[target + c] = fallback[c];
      }
    }
  }
  return { data: out, width: w, height: h, mask: outMask };
}

// Bilinear, and ONLY into the hole. Artwork the model actually drew is never
// written by an upsample -- the estimate exists to guide the refinement, not to
// replace anything the master already says.
function upsampleEstimate(coarse, coarseWidth, coarseHeight, data, width, height, channels, mask) {
  for (let y = 0; y < height; y += 1) {
    const fy = Math.min(coarseHeight - 1, Math.max(0, (y - 0.5) / 2));
    const y0 = Math.floor(fy);
    const y1 = Math.min(coarseHeight - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      const fx = Math.min(coarseWidth - 1, Math.max(0, (x - 0.5) / 2));
      const x0 = Math.floor(fx);
      const x1 = Math.min(coarseWidth - 1, x0 + 1);
      const wx = fx - x0;
      const offset = index * channels;
      for (let c = 0; c < channels; c += 1) {
        const a = coarse[(y0 * coarseWidth + x0) * channels + c];
        const b = coarse[(y0 * coarseWidth + x1) * channels + c];
        const d = coarse[(y1 * coarseWidth + x0) * channels + c];
        const e = coarse[(y1 * coarseWidth + x1) * channels + c];
        const top = a + (b - a) * wx;
        const bottom = d + (e - d) * wx;
        data[offset + c] = Math.round(top + (bottom - top) * wy);
      }
      if (channels > 3) data[offset + channels - 1] = 255;
    }
  }
}

function inpaintPyramid(data, width, height, channels, mask) {
  // Build the pyramid down from full resolution.
  const levels = [{ data, width, height, mask }];
  while (levels.length < MAX_LEVELS) {
    const top = levels[levels.length - 1];
    if (Math.min(top.width, top.height) <= MIN_LEVEL_EDGE) break;
    levels.push(downsampleMasked(top.data, top.width, top.height, channels, top.mask));
  }

  // Coarsest first. It has no estimate, which is fine: the hole is small there.
  const coarsest = levels[levels.length - 1];
  inpaintInto(coarsest.data, coarsest.width, coarsest.height, channels, coarsest.mask);

  // Then refine downward, each level seeded by the one below it.
  let unresolved = 0;
  for (let level = levels.length - 2; level >= 0; level -= 1) {
    const current = levels[level];
    const coarser = levels[level + 1];
    upsampleEstimate(coarser.data, coarser.width, coarser.height,
      current.data, current.width, current.height, channels, current.mask);
    unresolved = inpaintInto(current.data, current.width, current.height, channels,
      current.mask, { estimated: true });
  }
  return unresolved;
}


/**
 * CLONE ONE CLEAN REGION OVER THE HOLE, AND FEATHER IT. (owner, "There must be
 * a better way THINK!")
 *
 * THE MISTAKE THE TWO ATTEMPTS ABOVE SHARE. `diffuseInto` decides each hole
 * pixel from its rim; `inpaintInto` decides each hole pixel from its own best
 * patch. Both make THREE HUNDRED THOUSAND INDEPENDENT DECISIONS about one
 * wheel arch, and every disagreement between two neighbouring decisions is a
 * seam. That is the blob and that is the blockiness -- two faces of the same
 * error, and no amount of better searching removes it, because the error is
 * the granularity, not the search.
 *
 * AND THERE IS NO GROUND TRUTH TO RECOVER. Nothing was ever drawn behind the
 * wheel arch, so "reconstruct it" is not the job. The job is what a wrap
 * designer actually does with a damaged area: CLONE a clean part of the same
 * artwork over it and blend the edges. One source region means no internal
 * seams can exist, because there are no independent decisions left to
 * disagree -- the cloned pixels already agreed with each other in the original.
 *
 * How the source is chosen, deterministically: the hole's bounding box is
 * translated over a fixed grid of candidate offsets; a candidate is legal only
 * if its whole region is inside the panel and contains no hole pixels itself;
 * and it is scored on the RIM -- the known artwork in a band just outside the
 * hole, against the pixels the candidate would place beside it. A source whose
 * surroundings match the hole's surroundings continues the design; one that
 * does not, does not win. Ties break on the smaller translation, so the fill
 * prefers nearby artwork, then on the offset's order in the fixed grid.
 *
 * Then two corrections, both cheap and both necessary:
 *
 *   COLOUR    the clone is shifted by the difference between the two rims'
 *             means, so a region lifted from a brighter part of the nebula
 *             lands at the luminance its new neighbours expect.
 *   FEATHER   within FEATHER_PX of the hole boundary the clone is blended into
 *             the diffusion result, which by construction matches the rim
 *             exactly. So the boundary is seamless (diffusion's one strength)
 *             and the interior has real texture (the clone's). Neither method
 *             is used where it is weak.
 *
 * Still no invention and still no second producer of design: every pixel
 * written is this panel's own artwork, translated, and no model is called. A
 * hole with no legal clean region of its own size falls back to the diffusion
 * and is reported unchanged.
 */
const FEATHER_PX = 48;
const CLONE_RIM_PX = 12;
const CLONE_STEP_DIVISOR = 8;   // candidate grid step = holeSize / this
const BRIGHT_CHANNEL_MIN = 200; // a lettering-bright pixel
const BRIGHT_EXCESS_PENALTY = 90000; // charged per unit of excess bright fraction
const BRIGHT_EXCESS_REJECT = 0.02;   // above this a candidate is refused outright

function cloneOverHole(data, width, height, channels, mask, smooth) {
  // Bounding box of the convicted hole.
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const x = index % width;
    const y = (index - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (maxX < 0) return false;
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;

  // The rim: known artwork just outside the hole. This is the only evidence
  // about what belongs here, so it is what candidates are judged on.
  const rim = [];
  for (let y = Math.max(0, minY - CLONE_RIM_PX); y <= Math.min(height - 1, maxY + CLONE_RIM_PX); y += 1) {
    for (let x = Math.max(0, minX - CLONE_RIM_PX); x <= Math.min(width - 1, maxX + CLONE_RIM_PX); x += 1) {
      const index = y * width + x;
      if (mask[index]) continue;
      // within CLONE_RIM_PX of the box, not deep in the surrounding artwork
      const nearBox = x >= minX - CLONE_RIM_PX && x <= maxX + CLONE_RIM_PX
        && y >= minY - CLONE_RIM_PX && y <= maxY + CLONE_RIM_PX;
      if (!nearBox) continue;
      rim.push(index);
    }
  }
  if (!rim.length) return false;

  // How bright the neighbourhood actually is, as the baseline every candidate
  // is charged against.
  let rimBright = 0;
  for (let i = 0; i < rim.length; i += 1) {
    const offset = rim[i] * channels;
    const peak = Math.max(data[offset], data[offset + 1] ?? 0, data[offset + 2] ?? 0);
    if (peak >= BRIGHT_CHANNEL_MIN) rimBright += 1;
  }
  const rimBrightFraction = rim.length ? rimBright / rim.length : 0;

  const stepX = Math.max(8, Math.round(boxWidth / CLONE_STEP_DIVISOR));
  const stepY = Math.max(8, Math.round(boxHeight / CLONE_STEP_DIVISOR));

  let bestScore = -1;
  let bestDX = 0;
  let bestDY = 0;
  let bestDistance = Infinity;

  for (let dy = -height; dy <= height; dy += stepY) {
    for (let dx = -width; dx <= width; dx += stepX) {
      if (dx === 0 && dy === 0) continue;
      if (minX + dx < 0 || minY + dy < 0 || maxX + dx >= width || maxY + dy >= height) continue;
      // The source region must itself be clean artwork.
      let clean = true;
      for (let y = minY; y <= maxY && clean; y += 4) {
        for (let x = minX; x <= maxX; x += 4) {
          if (mask[(y + dy) * width + (x + dx)]) { clean = false; break; }
        }
      }
      if (!clean) continue;

      let total = 0;
      let compared = 0;
      for (let i = 0; i < rim.length; i += 3) { // every third rim pixel is plenty
        const index = rim[i];
        const x = index % width;
        const y = (index - x) / width;
        const sx = x + dx;
        const sy = y + dy;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        const source = sy * width + sx;
        if (mask[source]) continue;
        const a = index * channels;
        const b = source * channels;
        for (let c = 0; c < 3 && c < channels; c += 1) {
          const delta = data[a + c] - data[b + c];
          total += delta * delta;
        }
        compared += 1;
      }
      if (!compared) continue;

      // DO NOT CLONE SOMETHING THE NEIGHBOURHOOD DOES NOT HAVE.
      //
      // Scoring the rim alone picks a source whose EDGES match, and on the
      // September 1 911 that chose a region containing the "911 CYBERSPACE
      // EDITION" wordmark -- continuous artwork at the boundary, the company
      // lettering printed a second time inside the wheel arch. A duplicated
      // wordmark on a print panel is worse than a hole, because a hole is
      // obviously wrong and a second wordmark looks deliberate.
      //
      // Lettering on these sheets is a concentration of very bright pixels
      // that the surrounding field does not carry, so the source's bright
      // fraction is compared against the rim's and the difference is charged
      // against the candidate. It is a statistic of the artwork, not a text
      // detector, and it needs no model: any region carrying a mark its
      // neighbourhood lacks -- a logo, a badge, a headline -- is penalised the
      // same way, which is the property actually wanted.
      let sourceBright = 0;
      let sourceCount = 0;
      for (let y = minY; y <= maxY; y += 4) {
        for (let x = minX; x <= maxX; x += 4) {
          const offset = ((y + dy) * width + (x + dx)) * channels;
          const peak = Math.max(data[offset], data[offset + 1] ?? 0, data[offset + 2] ?? 0);
          if (peak >= BRIGHT_CHANNEL_MIN) sourceBright += 1;
          sourceCount += 1;
        }
      }
      const sourceBrightFraction = sourceCount ? sourceBright / sourceCount : 0;
      const brightExcess = Math.max(0, sourceBrightFraction - rimBrightFraction);
      // A HARD REJECT, NOT A PENALTY. Charging the excess was enough for a
      // wheel arch and demonstrably not enough for a text box: over a region
      // that size the best rim match IS another part of the same lockup, so a
      // soft cost gets outbid by a good edge fit and the wordmark is cloned
      // back in. Measured erasing "911 TURBO / CYBERSPACE EDITION" from the
      // September 1 driver flank -- the erase returned the wordmark, in a
      // different place. Any candidate carrying materially more bright content
      // than its neighbourhood is now refused outright, whatever its edges do.
      if (brightExcess > BRIGHT_EXCESS_REJECT) continue;
      const score = (total / compared) + brightExcess * BRIGHT_EXCESS_PENALTY;
      const distance = dx * dx + dy * dy;
      if (bestScore < 0 || score < bestScore || (score === bestScore && distance < bestDistance)) {
        bestScore = score; bestDX = dx; bestDY = dy; bestDistance = distance;
      }
    }
  }
  if (bestScore < 0) return false;

  // COLOUR: shift the clone by the difference between the two rims' means.
  const shift = new Array(channels).fill(0);
  {
    const here = new Array(channels).fill(0);
    const there = new Array(channels).fill(0);
    let count = 0;
    for (let i = 0; i < rim.length; i += 1) {
      const index = rim[i];
      const x = index % width;
      const y = (index - x) / width;
      const sx = x + bestDX;
      const sy = y + bestDY;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const source = sy * width + sx;
      if (mask[source]) continue;
      const a = index * channels;
      const b = source * channels;
      for (let c = 0; c < channels; c += 1) { here[c] += data[a + c]; there[c] += data[b + c]; }
      count += 1;
    }
    if (count) for (let c = 0; c < channels; c += 1) shift[c] = (here[c] - there[c]) / count;
  }

  // FEATHER: distance from the hole boundary, in hole pixels only. A simple
  // two-pass chamfer is enough and is exactly reproducible.
  const distance = new Int32Array(mask.length).fill(0x3fffffff);
  for (let index = 0; index < mask.length; index += 1) if (!mask[index]) distance[index] = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      let best = distance[index];
      if (x > 0) best = Math.min(best, distance[index - 1] + 1);
      if (y > 0) best = Math.min(best, distance[index - width] + 1);
      distance[index] = best;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (!mask[index]) continue;
      let best = distance[index];
      if (x + 1 < width) best = Math.min(best, distance[index + 1] + 1);
      if (y + 1 < height) best = Math.min(best, distance[index + width] + 1);
      distance[index] = best;
    }
  }

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const x = index % width;
    const y = (index - x) / width;
    const sx = x + bestDX;
    const sy = y + bestDY;
    const target = index * channels;
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
    const source = (sy * width + sx) * channels;
    const alpha = Math.min(1, distance[index] / FEATHER_PX);
    for (let c = 0; c < 3 && c < channels; c += 1) {
      const cloned = Math.max(0, Math.min(255, data[source + c] + shift[c]));
      const blended = smooth[target + c] + (cloned - smooth[target + c]) * alpha;
      data[target + c] = Math.round(blended);
    }
    if (channels > 3) data[target + channels - 1] = 255;
  }
  return true;
}

/**
 * A CUT-OUT'S OWN OUTLINE IS PART OF THE CUT-OUT. (owner: "wheel well
 * persists ... see bodyline")
 *
 * `convictedHoleMask` convicts the near-BLACK interior of an opening. The model
 * does not draw a bare black ellipse: it draws a wheel arch, with a bright
 * glowing rim around it. That rim is not near-black, so it is not masked, so it
 * is not filled -- and the fill lands inside a contour that survives, leaving
 * the arch perfectly visible as a curved seam through the artwork. On the
 * September 1 911 that arc is still legible after a fill that closed 304,896 px
 * and reported `unresolvedPixels: 0`.
 *
 * That curve is a BODY LINE, which RULE 0.28 forbids by name: "no door seams,
 * panel gaps, rocker or hood contours, wheel arches ... the artwork paints
 * straight THROUGH every place one would sit." A line drawn on the master
 * prints as a line on the wrap.
 *
 * So the mask grows outward before anything is filled, far enough to swallow
 * the drawn rim. The radius scales with the opening -- a wheel arch is drawn
 * with a heavier outline than a door handle -- and is clamped at both ends, so
 * a small genuine edge nick cannot eat the artwork around it and a large one
 * cannot leave its own contour behind.
 */
const CONTOUR_MIN_PX = 6;
const CONTOUR_MAX_PX = 56;
const CONTOUR_RADIUS_DIVISOR = 18;   // of the opening's equivalent radius

function dilateMask(mask, width, height, radius) {
  if (radius <= 0) return mask;
  const distance = new Int32Array(mask.length).fill(0x3fffffff);
  for (let index = 0; index < mask.length; index += 1) if (mask[index]) distance[index] = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      let best = distance[index];
      if (x > 0) best = Math.min(best, distance[index - 1] + 1);
      if (y > 0) best = Math.min(best, distance[index - width] + 1);
      distance[index] = best;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      let best = distance[index];
      if (x + 1 < width) best = Math.min(best, distance[index + 1] + 1);
      if (y + 1 < height) best = Math.min(best, distance[index + width] + 1);
      distance[index] = best;
    }
  }
  const grown = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) grown[index] = distance[index] <= radius ? 1 : 0;
  return grown;
}

/**
 * The shipped fill: swallow the drawn contour, diffuse for the boundary, clone
 * for the body.
 */
function fillHole(data, width, height, channels, rawMask) {
  let area = 0;
  for (let index = 0; index < rawMask.length; index += 1) if (rawMask[index]) area += 1;
  const equivalentRadius = Math.sqrt(area / Math.PI);
  const radius = Math.max(CONTOUR_MIN_PX,
    Math.min(CONTOUR_MAX_PX, Math.round(equivalentRadius / CONTOUR_RADIUS_DIVISOR)));
  const mask = dilateMask(rawMask, width, height, radius);

  const smooth = Uint8Array.prototype.slice.call(data);
  const unresolved = diffuseInto(smooth, width, height, channels, mask);
  // Start from the diffusion, then clone over it where a clean region exists.
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const offset = index * channels;
    for (let c = 0; c < channels; c += 1) data[offset + c] = smooth[offset + c];
  }
  cloneOverHole(data, width, height, channels, mask, smooth);
  return unresolved;
}

/**
 * Return a duplicate of the master whose convicted cut-outs are closed.
 *
 * The input bytes are never mutated. Only the named surfaces are touched, and
 * within them only the pixels the gate convicted, so a zone the detector was
 * happy with comes back identical.
 */
async function fillMasterCutouts(masterBytes, manifest, surfaceKeys = []) {
  if (!Buffer.isBuffer(masterBytes) || !masterBytes.length) {
    throw new AtlasCutoutFillError("atlas_cutout_fill_master_invalid", "The master bytes are required");
  }
  const wanted = new Set((surfaceKeys || []).map(String));
  const zones = (manifest?.zones || []).filter((zone) => wanted.has(String(zone.surfaceKey)));
  if (!zones.length) {
    return { bytes: masterBytes, contract: FILL_CONTRACT, filled: [], changed: false };
  }

  const composites = [];
  const filled = [];
  for (const zone of zones) {
    const left = Number(zone.x);
    const top = Number(zone.y);
    const width = Number(zone.w);
    const height = Number(zone.h);
    const { data, info } = await sharp(masterBytes, { limitInputPixels: false })
      .extract({ left, top, width, height })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { mask, pixels, components } = convictedHoleMask({
      data, width: info.width, height: info.height, channels: info.channels,
    });
    if (!mask) continue;

    // NOT YET THE PRODUCTION FILL. `inpaintInto` continues structure where
    // `diffuseInto` smears it, and on the real September 1 driver flank
    // (generation 5d727ea9, 304,896 px of convicted wheel arch) it lifts the
    // filled region's standard deviation from 11.9 to 34.5 -- the difference
    // between a flat field and actual texture. But single-scale patch matching
    // over a 300k-pixel hole in high-frequency artwork commits to bad offsets
    // early and propagates them, and the result reads as blocky corruption
    // rather than artwork. On a print panel that is worse than the blob.
    //
    // The known remedy is multi-scale: inpaint a pyramid from the coarsest
    // level, where the hole is tens of pixels across and the structure is the
    // smooth gradient, then upsample and refine. Until that is built and judged
    // on these same pixels, the shipped fill stays the diffusion -- honest
    // about being a blob rather than dishonest about being artwork.
    const unresolved = diffuseInto(data, info.width, info.height, info.channels, mask);
    composites.push({
      input: await sharp(data, {
        raw: { width: info.width, height: info.height, channels: info.channels },
      }).png().toBuffer(),
      left,
      top,
    });
    filled.push({
      surfaceKey: String(zone.surfaceKey),
      pixels,
      components,
      zoneFraction: Number((pixels / (info.width * info.height)).toFixed(6)),
      // Non-zero would mean a zone with nothing to grow from -- recorded rather
      // than hidden, because that panel is still not printable.
      unresolvedPixels: unresolved,
    });
  }

  if (!composites.length) {
    return { bytes: masterBytes, contract: FILL_CONTRACT, filled: [], changed: false };
  }
  const bytes = await sharp(masterBytes, { limitInputPixels: false })
    .composite(composites)
    .png()
    .toBuffer();
  return { bytes, contract: FILL_CONTRACT, filled, changed: true };
}

/**
 * OPERATOR ERASE: THE SAME FILL, POINTED AT A REGION A HUMAN CHOSE.
 * (owner, for Carley on the vector template: "sometimes the panel text needs
 * moving a bit ... she may need to pop off text if that occurs")
 *
 * `cloneOverHole` does not care WHY a region is masked. A wheel arch the model
 * punched and a text block a designer selected are the same problem: a region
 * of the panel that must come to carry this panel's own surrounding artwork.
 * So the print-defect fill and the studio eraser are one implementation, and
 * the eraser inherits everything the fill already proves -- one cloned source
 * so no internal seams, a rim-matched colour shift, a feathered boundary, the
 * bright-excess penalty that stops a wordmark being cloned in, and the contour
 * dilation that stops a ghost of the erased element's own edge surviving.
 *
 * Regions arrive NORMALISED, so the studio can describe a selection without
 * knowing the panel's pixel size -- a 150 PPI production panel and the preview
 * the designer clicked on describe the same rectangle.
 *
 * THIS IS A CORRECTION, NOT A REDESIGN, and the guard says so: a request that
 * masks more than MAX_ERASE_FRACTION of the panel is refused. Popping a text
 * block off a flank is a correction. Erasing a third of the artwork is a new
 * design, and RULE 0.22's distinction -- forbid generation, never forbid
 * correction -- is what this keeps on the right side of.
 *
 * The caller stores the result through the EXISTING correction lineage
 * (`record_designpro_corrected_panel`), so the branded Call-1 panel is never
 * touched, both artifacts survive for audit, and the reason the designer gave
 * is required. No new artifact kind, no change to the frozen seam.
 */
const ERASE_CONTRACT = "designpro.atlas-operator-erase.v1";
const MAX_ERASE_FRACTION = 0.25;
const LIFT_ALPHA_FLOOR = 10;    // below this the fill agreed: nothing was there
const LIFT_ALPHA_CEILING = 90;  // at or above this the element was opaque

async function erasePanelRegions(panelBytes, regions) {
  if (!Buffer.isBuffer(panelBytes) || !panelBytes.length) {
    throw new AtlasCutoutFillError("atlas_erase_panel_invalid", "The panel bytes are required");
  }
  const list = Array.isArray(regions) ? regions : [];
  if (!list.length) {
    throw new AtlasCutoutFillError("atlas_erase_regions_required", "At least one region is required");
  }
  const { data, info } = await sharp(panelBytes, { limitInputPixels: false })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const mask = new Uint8Array(info.width * info.height);
  let masked = 0;
  const applied = [];
  for (const region of list) {
    const x = Number(region?.x);
    const y = Number(region?.y);
    const w = Number(region?.w);
    const h = Number(region?.h);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0
      || x < 0 || y < 0 || x + w > 1.0000001 || y + h > 1.0000001) {
      throw new AtlasCutoutFillError("atlas_erase_region_invalid",
        "Every region must be normalised to [0,1] and lie inside the panel");
    }
    const left = Math.max(0, Math.round(x * info.width));
    const top = Math.max(0, Math.round(y * info.height));
    const right = Math.min(info.width - 1, Math.round((x + w) * info.width) - 1);
    const bottom = Math.min(info.height - 1, Math.round((y + h) * info.height) - 1);
    for (let py = top; py <= bottom; py += 1) {
      for (let px = left; px <= right; px += 1) {
        const index = py * info.width + px;
        if (!mask[index]) { mask[index] = 1; masked += 1; }
      }
    }
    applied.push({ left, top, width: right - left + 1, height: bottom - top + 1 });
  }
  if (!masked) {
    throw new AtlasCutoutFillError("atlas_erase_regions_empty", "The regions cover no pixels");
  }
  const fraction = masked / (info.width * info.height);
  if (fraction > MAX_ERASE_FRACTION) {
    throw new AtlasCutoutFillError("atlas_erase_region_too_large",
      `A correction may cover at most ${Math.round(MAX_ERASE_FRACTION * 100)}% of the panel; this covers ${(fraction * 100).toFixed(1)}%`);
  }

  // The branded pixels, before anything is filled. This is the half that
  // carries the lettering, and it is kept so the type can be lifted rather
  // than destroyed.
  const branded = Uint8Array.prototype.slice.call(data);

  const unresolvedPixels = fillHole(data, info.width, info.height, info.channels, mask);
  const bytes = await sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  }).png().toBuffer();

  // LIFT THE TYPE, DO NOT DESTROY IT. (owner: "must have the ability to magic
  // layer off text but keep fonts")
  //
  // Popping text off a panel is only half an operation. The other half is that
  // the lettering has to SURVIVE, as its own object, with its real letterforms
  // -- so it can go back a few inches over, or onto the vector template, or
  // into the Logo Pack. Re-rendering it would mean guessing the typeface,
  // weight, tracking, bevel and glow the designer actually drew, and guessing
  // wrong is worse than not offering it.
  //
  // So it is not re-rendered: it is SUBTRACTED. RestylePro's own roadmap states
  // the method -- "derive the clean variant FROM the branded one so overlays
  // become pixel subtraction (branded - clean)" -- and both halves already
  // exist here by the time this runs. Where the fill changed a pixel, that
  // pixel was the element; where it left one alone, that was background. The
  // slice therefore keeps the ORIGINAL branded colour and takes its alpha from
  // how far the fill moved that pixel, so every anti-aliased edge, every glow
  // and every bevel of the real type is carried at real opacity. No model, no
  // font matching, no vectorisation: the designer gets back exactly the pixels
  // that were on the panel.
  const slice = Buffer.alloc(info.width * info.height * 4);
  let liftedPixels = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const target = index * 4;
    if (!mask[index]) continue;
    const offset = index * info.channels;
    let distance = 0;
    for (let c = 0; c < 3 && c < info.channels; c += 1) {
      distance = Math.max(distance, Math.abs(branded[offset + c] - data[offset + c]));
    }
    // Below the floor the fill agreed with the panel, so there was nothing
    // there to lift; above the ceiling the element is fully opaque. Between
    // them the alpha ramps, which is what preserves an anti-aliased edge.
    if (distance <= LIFT_ALPHA_FLOOR) continue;
    const alpha = distance >= LIFT_ALPHA_CEILING
      ? 255
      : Math.round(((distance - LIFT_ALPHA_FLOOR) / (LIFT_ALPHA_CEILING - LIFT_ALPHA_FLOOR)) * 255);
    slice[target] = branded[offset];
    slice[target + 1] = branded[offset + 1] ?? branded[offset];
    slice[target + 2] = branded[offset + 2] ?? branded[offset];
    slice[target + 3] = alpha;
    liftedPixels += 1;
  }
  const liftedBytes = liftedPixels
    ? await sharp(slice, { raw: { width: info.width, height: info.height, channels: 4 } })
      .png().toBuffer()
    : null;

  return {
    bytes,
    liftedBytes,
    liftedPixels,
    contract: ERASE_CONTRACT,
    widthPx: info.width,
    heightPx: info.height,
    regions: applied,
    maskedPixels: masked,
    panelFraction: Number(fraction.toFixed(6)),
    unresolvedPixels,
  };
}

module.exports = {
  AtlasCutoutFillError,
  ERASE_CONTRACT,
  FILL_CONTRACT,
  LIFT_ALPHA_CEILING,
  LIFT_ALPHA_FLOOR,
  MAX_ERASE_FRACTION,
  MAX_FILL_PASSES,
  erasePanelRegions,
  fillMasterCutouts,
  _test: { convictedHoleMask, diffuseInto, inpaintInto, inpaintPyramid, downsampleMasked, upsampleEstimate, cloneOverHole, fillHole, PATCH_RADIUS, RING_OFFSETS, VOTE_PASSES, MIN_LEVEL_EDGE, MAX_LEVELS, FEATHER_PX, BRIGHT_CHANNEL_MIN, BRIGHT_EXCESS_REJECT,
    dilateMask, CONTOUR_MIN_PX, CONTOUR_MAX_PX },
};
