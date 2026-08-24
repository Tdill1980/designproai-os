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
  if (!convictedComponents) return { mask: null, pixels: 0, components: 0 };

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
  return { mask, pixels: filledPixels, components: convictedComponents };
}

/**
 * Grow the bordering artwork inward until the masked region is closed.
 *
 * Each pass writes only the masked pixels that currently touch settled artwork,
 * averaging the settled neighbours it touches. Reading from the previous pass's
 * buffer keeps the result independent of scan order, which is what makes it
 * reproducible rather than merely deterministic-looking.
 */
function diffuseInto(data, width, height, channels, mask) {
  const pending = Uint8Array.from(mask);
  let remaining = 0;
  for (let index = 0; index < pending.length; index += 1) if (pending[index]) remaining += 1;

  for (let pass = 0; pass < MAX_FILL_PASSES && remaining > 0; pass += 1) {
    const source = Uint8Array.from(data);
    const settledThisPass = [];
    for (let index = 0; index < pending.length; index += 1) {
      if (!pending[index]) continue;
      const x = index % width;
      const y = (index - x) / width;
      let count = 0;
      const totals = new Array(channels).fill(0);
      const sample = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const neighbour = ny * width + nx;
        if (pending[neighbour]) return; // still a hole this pass
        const offset = neighbour * channels;
        for (let c = 0; c < channels; c += 1) totals[c] += source[offset + c];
        count += 1;
      };
      sample(x - 1, y); sample(x + 1, y); sample(x, y - 1); sample(x, y + 1);
      sample(x - 1, y - 1); sample(x + 1, y - 1); sample(x - 1, y + 1); sample(x + 1, y + 1);
      if (!count) continue;
      const offset = index * channels;
      for (let c = 0; c < channels; c += 1) data[offset + c] = Math.round(totals[c] / count);
      if (channels > 3) data[offset + channels - 1] = 255; // closed artwork is opaque
      settledThisPass.push(index);
    }
    if (!settledThisPass.length) break; // nothing borders artwork; cannot close
    for (const index of settledThisPass) { pending[index] = 0; remaining -= 1; }
  }
  return remaining;
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

module.exports = {
  AtlasCutoutFillError,
  FILL_CONTRACT,
  MAX_FILL_PASSES,
  fillMasterCutouts,
  _test: { convictedHoleMask, diffuseInto },
};
