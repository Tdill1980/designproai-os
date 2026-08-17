"use strict";

/**
 * Call 11 — logo location and removal for QC duplicates ONLY.
 *
 * Ported from restylepro-os worker/index.js: strictGeminiBox2d (3750),
 * collapseContainedBrandingElements (3783), locateBrandingElements (4051), and
 * the call-site dilate/clamp/minimum-size/honest-no-op pattern (~4326).
 *
 * WHAT THIS IS FOR. The output is a qc-panel: a non-authoritative duplicate the
 * design team lays on a vehicle template to check sizing. It is never printed,
 * never enters Topaz, output or the ZIP, and never overwrites the Call 9
 * branded panel it was copied from. Its fidelity bar is "dimensionally honest",
 * not "print clean".
 *
 * ONE DELIBERATE DIVERGENCE FROM THE SOURCE PROMPT. RestylePro's
 * BRANDING_LOCATE_PROMPT asks for "company names, logo marks, lettering, phone
 * numbers, websites, taglines, badges" because it was separating every branding
 * element for the Logo Pack. Call 11 removes LOGOS only — A.C.E.-authored
 * company name, contact text and designed lettering may remain, and a phone
 * number on a QC duplicate does not defeat a sizing check. Asking the source
 * prompt here would make Call 11 a general text-removal system, which is
 * prohibited. The detection MACHINERY is ported unchanged; only the target
 * description is narrowed.
 */

/**
 * Parse one element's box, strictly. Never guesses a missing box: guessing bakes
 * a logo into a panel that claims to be de-logoed, and dropping the element
 * leaves it un-removed. Both ship a wrong panel silently, so a bad box throws
 * and the caller re-asks.
 */
function strictGeminiBox2d(element, index) {
  if (!element || typeof element !== "object" || Array.isArray(element)) {
    throw new Error(`logo element ${index + 1} is not an object`);
  }
  const fields = ["box_2d", "box_2d_", "box"]
    .filter((key) => Object.prototype.hasOwnProperty.call(element, key) && element[key] != null)
    .map((key) => ({ key, value: element[key] }));
  if (!fields.length) throw new Error(`logo element ${index + 1} has no box_2d coordinates`);
  const boxes = fields.map(({ key, value }) => {
    if (!Array.isArray(value) || value.length !== 4) {
      throw new Error(`logo element ${index + 1} ${key} must contain exactly four coordinates`);
    }
    if (!value.every((coord) => typeof coord === "number" && Number.isFinite(coord))) {
      throw new Error(`logo element ${index + 1} ${key} coordinates must be finite numbers`);
    }
    const [ymin, xmin, ymax, xmax] = value;
    if (value.some((coord) => coord < 0 || coord > 1000)) {
      throw new Error(`logo element ${index + 1} ${key} coordinates must be within 0..1000`);
    }
    if (!(ymax > ymin && xmax > xmin)) {
      throw new Error(`logo element ${index + 1} ${key} coordinates are not an ordered box`);
    }
    return { key, value: [...value] };
  });
  const canonical = boxes[0].value;
  if (boxes.slice(1).some(({ value }) => value.some((coord, i) => coord !== canonical[i]))) {
    throw new Error(`logo element ${index + 1} has conflicting coordinate fields`);
  }
  return canonical;
}

/** Merge boxes fully inside a larger one so a mark is not erased twice. */
function collapseContainedLogoElements(elements) {
  const area = ({ b }) => (b[2] - b[0]) * (b[3] - b[1]);
  const contains = (outer, inner) =>
    outer.b[0] <= inner.b[0] && outer.b[1] <= inner.b[1] &&
    outer.b[2] >= inner.b[2] && outer.b[3] >= inner.b[3];
  const ordered = elements
    .map((element, index) => ({
      label: String(element.label || "logo"),
      b: [...element.b],
      sourceIndex: index,
      labels: [String(element.label || "logo")],
    }))
    .sort((left, right) => area(right) - area(left) || left.sourceIndex - right.sourceIndex);
  const kept = [];
  for (const element of ordered) {
    const enclosing = kept.find((candidate) => contains(candidate, element));
    if (enclosing) {
      for (const label of element.labels) if (!enclosing.labels.includes(label)) enclosing.labels.push(label);
      continue;
    }
    kept.push(element);
  }
  return kept
    .sort((left, right) => left.sourceIndex - right.sourceIndex)
    .map(({ b, labels }) => ({ label: labels.join(" + "), b }));
}

const LOGO_LOCATE_PROMPT = `This image is a FLAT vehicle-wrap PRINT PANEL. Locate ONLY the LOGO MARKS on it: emblems, icons, badges, crests, symbol marks, and logotype lockups that form a brand mark. Return the tight bounding box of each, plus a 2-4 word label.

Do NOT box any of the following, even though they are branding: plain company-name text set as ordinary lettering, phone numbers, website addresses, street addresses, taglines, or any other body copy. Do NOT box background artwork (patterns, gradients, scenery, stripes).

If the panel carries no logo mark, return an empty elements array. EVERY element you return MUST carry its box_2d array; omit the element entirely rather than returning it without coordinates. Respond ONLY with this JSON (box_2d is [ymin,xmin,ymax,xmax] normalized 0-1000):
{"elements":[{"label":"shield emblem","box_2d":[0,0,0,0]}]}`;

const LOCATE_ATTEMPTS = 3;

/**
 * RE-ASK, NEVER GUESS, NEVER DROP. Ported reasoning: a missing box_2d once
 * turned a whole side into a separation gap live on REAR. Guessing the box or
 * dropping the element both ship a wrong panel silently, so the only safe
 * remedy is to ask again.
 *
 * `geminiJson` is injected so this is testable without a provider.
 */
async function locateLogoElements(locateB64, { geminiJson, attempts = LOCATE_ATTEMPTS, log = () => {} } = {}) {
  if (typeof geminiJson !== "function") throw new Error("locateLogoElements requires a geminiJson implementation");
  let located = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts && !located; attempt++) {
    try {
      const detected = await geminiJson([
        { text: LOGO_LOCATE_PROMPT },
        { inlineData: { mimeType: "image/png", data: locateB64 } },
      ]);
      // The prompt asks for {"elements":[...]}, but the model sometimes answers
      // with a bare array or a differently-named key. Accept all of them rather
      // than reporting "no logos detected" on a valid response.
      const elements = Array.isArray(detected)
        ? detected
        : (detected?.elements ?? detected?.boxes ?? detected?.logos ?? detected?.branding);
      if (!Array.isArray(elements)) throw new Error("logo locate response did not contain an elements array");
      located = elements.map((element, index) => ({
        label: String(element?.label || "logo"),
        b: strictGeminiBox2d(element, index),
      }));
    } catch (error) {
      lastError = error;
      log(`[DESIGNPRO-OS] Call 11 logo locate attempt ${attempt}/${attempts} unusable: ${error?.message || error}`);
    }
  }
  if (!located) throw lastError || new Error("logo locate returned no usable elements");
  return collapseContainedLogoElements(located);
}

// Dilate ~3% of each side for glows, outlines and drop shadows, then clamp to
// the panel. Ported from the RestylePro call site, where DIL is 30 of 1000.
const DILATION_PER_MILLE = 30;
const MIN_BOX_PX = 8;

/**
 * Normalized boxes to clamped pixel rects. A box that survives dilation but is
 * smaller than MIN_BOX_PX is dropped: at that size it is detector noise, and
 * painting it would damage artwork without removing a mark.
 */
function logoBoxesToPixelRects(elements, pixelWidth, pixelHeight, {
  dilationPerMille = DILATION_PER_MILLE, minSizePx = MIN_BOX_PX,
} = {}) {
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(pixelHeight) || pixelWidth <= 0 || pixelHeight <= 0) {
    throw new Error("logo box conversion requires positive panel pixel dimensions");
  }
  return (elements || [])
    .map((element) => {
      const [ymin, xmin, ymax, xmax] = element.b;
      const x0 = Math.max(0, Math.round(((xmin - dilationPerMille) / 1000) * pixelWidth));
      const y0 = Math.max(0, Math.round(((ymin - dilationPerMille) / 1000) * pixelHeight));
      const x1 = Math.min(pixelWidth, Math.round(((xmax + dilationPerMille) / 1000) * pixelWidth));
      const y1 = Math.min(pixelHeight, Math.round(((ymax + dilationPerMille) / 1000) * pixelHeight));
      return { label: element.label, x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    })
    .filter((rect) => rect.w >= minSizePx && rect.h >= minSizePx);
}

/**
 * HONEST NO-OP. A panel with no logo mark has nothing to remove, and that is a
 * valid outcome rather than a failure. The duplicate is still written so the
 * side is present for template QC, and the receipt records removedCount 0 so
 * "no logos found" is never mistaken for "removal succeeded".
 */
function isHonestNoOp(rects) {
  return !Array.isArray(rects) || rects.length === 0;
}

module.exports = {
  LOGO_LOCATE_PROMPT,
  DILATION_PER_MILLE,
  MIN_BOX_PX,
  collapseContainedLogoElements,
  isHonestNoOp,
  locateLogoElements,
  logoBoxesToPixelRects,
  strictGeminiBox2d,
};
