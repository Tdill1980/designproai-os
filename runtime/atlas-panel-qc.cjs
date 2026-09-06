"use strict";

/**
 * PER-SURFACE PANEL QC — does a required element survive the cut?
 *
 * A.T.L.A.S. Call 1 is the creative authority and is NOT touched by this file.
 * It produced the Porsche and Flamingo work, and it produced Arctic Air's
 * cohesive ice-and-yeti sheet: one mascot lockup on the driver band, the
 * installer photograph and a second lockup on the passenger band, and one
 * contact lockup across the bottom band. Nothing here changes its prompt, its
 * conditioning or its master.
 *
 * THE DEFECT IS THE CUT, NOT THE DESIGN. Arctic Air `63e6629a` composed in the
 * three equal horizontal thirds v24 asks for, and the model obeyed. The cutter
 * then took SIX unequal territories, and the bottom third alone is crossed by
 * three boundaries the model was never shown -- x=1071, x=2198 and y=3335. The
 * single contact lockup
 *
 *     [ARCTIC AIR badge]  Www.ArcticAir.com
 *
 * spans master x 1080..3050, so all three run through it. It came back as a
 * badge sliver on ROOF, `Www.Arct` on HOOD, a banner sliver on FRONT and
 * `ticAir.com` on REAR. Driver and passenger survived because, and only
 * because, they map 1:1 onto a third.
 *
 * WHY NOTHING CAUGHT IT. Every existing gate measures the SHEET -- coverage,
 * opacity, holes, flat-black blobs, edge holes, template leakage, output class.
 * All of them passed, correctly: the sheet is beautiful. None of them asks
 * whether a WORDMARK straddles a cut line.
 *
 * WHY THIS IS NOT A PIXEL HEURISTIC. Measuring "sharp ink at the panel edge"
 * cannot work, and was tried first: a wrap panel is full-bleed by contract
 * (RULE 0.15, RULE 0.28 §3), so artwork MUST run off all four edges. Ice
 * shards bleeding off the front panel's top edge and `ticAir.com` severed on
 * the rear panel's left edge are the same measurement to every gradient,
 * contrast or flat-run statistic tried against the six real panels -- the
 * separation moved with an arbitrary median and convicted whichever panel the
 * baseline happened to suit.
 *
 * SO ASK THE QUESTION THAT IS ACTUALLY BEING ASKED. Locate the required
 * elements ONCE on the master, then test containment against the manifest's own
 * zone geometry with integer arithmetic. An element inside one zone's trim is
 * safe; an element crossing a container boundary is severed, and the finding
 * names the element, the boundary and every surface it landed on. Localization
 * reuses the Call 11 detector already ported from RestylePro
 * (`runtime/logo-removal.cjs`) -- re-ask, never guess, never drop -- so this
 * adds no new machinery and no new authority. RULE 1: recover before you invent.
 *
 * IT MEASURES, IT DOES NOT REDESIGN. Nothing here writes a pixel. It reports
 * which surfaces need repair and exactly which element to reinstate, so a
 * repair can be aimed at those and the ones that already pass are left alone.
 */

const sharp = require("sharp");
const { strictGeminiBox2d, collapseContainedLogoElements } = require("./logo-removal.cjs");

const PANEL_QC_CONTRACT = "designpro.atlas-panel-qc.v1";

/**
 * Locate every element whose severing a customer would call a defect: the
 * lockup, the wordmark, the contact string, the mascot, the photograph. This is
 * deliberately WIDER than Call 11's LOGO_LOCATE_PROMPT, which narrows to logo
 * marks because it is choosing what to erase. Here nothing is erased -- a box
 * only ever decides which surface gets inspected -- so the cost of an extra box
 * is one extra containment test, while the cost of a missing one is a severed
 * phone number reaching print.
 */
const ELEMENT_LOCATE_PROMPT = `This image is a FLAT vehicle-wrap PRINT SHEET, laid out unwrapped. Locate every REQUIRED BRAND ELEMENT on it — the pieces that would be a defect if any part of them were cut off.

Box each of these when present: logo marks, emblems, badges, crests and mascot characters; company-name wordmarks and logotype lockups; taglines; phone numbers; website addresses; street addresses; and any embedded photograph or illustrated focal subject that reads as a placed picture rather than as background.

Box a lockup that reads as ONE unit (a badge sitting against its wordmark, a contact bar) as ONE element, not as its parts.

Give each element a kind from exactly this list: logo, mascot, wordmark, tagline, website, phone, email, address, photograph, focal.

Do NOT box background artwork: gradients, ice, scenery, stripes, swooshes, repeated pattern motifs, textures.

If the sheet carries no such element, return an empty elements array. EVERY element you return MUST carry its box_2d array; omit the element entirely rather than returning it without coordinates. Respond ONLY with this JSON (box_2d is [ymin,xmin,ymax,xmax] normalized 0-1000):
{"elements":[{"label":"yeti shield lockup","kind":"logo","box_2d":[0,0,0,0]}]}`;

const LOCATE_ATTEMPTS = 3;

/**
 * An element may overhang a trim edge by this fraction of its own size without
 * being reported. Box localization is approximate -- the ported detector's own
 * call site dilates by 3% for glows and outlines -- and a box two pixels proud
 * of a trim line is detector slop, not a severed letter. A real severance takes
 * a visible bite: the rear panel lost roughly a third of `Www.ArcticAir.com`.
 */
const BOX_SLOP_RATIO = 0.04;

/** ...but never less than this many master pixels, for a small badge. */
const BOX_SLOP_MIN_PX = 6;

/**
 * Aspect drift a panel may carry before it is convicted. Integer rounding on a
 * 4096 canvas moves a small surface by a fraction of a percent; a wrong cut or a
 * rotated panel moves it by tens of percent.
 */
const ORIENTATION_DRIFT_MAX = 0.02;

/** The localization model. Not an image model -- this asks a question, it authors nothing. */
const PANEL_QC_MODEL = "gemini-2.5-flash";
const PANEL_QC_TIMEOUT_MS = 45_000;

/**
 * Transport size. The output-class gate sends 1280px because it asks one
 * whole-image question; localization has to see a badge that is 258 px wide on
 * a 4096 sheet, so it gets more. Boxes come back NORMALIZED, so the downscale
 * never moves a coordinate -- it only decides what the model can still resolve.
 */
const MAX_TRANSPORT_DIMENSION = 2048;
const MAX_TRANSPORT_BYTES = 4_000_000;

class PanelQcError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.name = "PanelQcError";
    this.code = code;
    if (detail) this.detail = detail;
  }
}

/** Normalized 0..1000 [ymin,xmin,ymax,xmax] to an integer master-pixel rect. */
function boxToMasterRect(box, masterWidth, masterHeight) {
  const [ymin, xmin, ymax, xmax] = box;
  const x = Math.round((xmin / 1000) * masterWidth);
  const y = Math.round((ymin / 1000) * masterHeight);
  const x1 = Math.round((xmax / 1000) * masterWidth);
  const y1 = Math.round((ymax / 1000) * masterHeight);
  return { x, y, w: Math.max(1, x1 - x), h: Math.max(1, y1 - y) };
}

function rectsOverlap(a, b, slop = 0) {
  return (
    a.x + a.w - slop > b.x &&
    b.x + b.w > a.x + slop &&
    a.y + a.h - slop > b.y &&
    b.y + b.h > a.y + slop
  );
}

/** Which edges of `outer` does `inner` cross, allowing `slop` px of overhang? */
function crossedEdges(inner, outer, slop) {
  const crossed = [];
  if (inner.x < outer.x - slop) crossed.push("left");
  if (inner.y < outer.y - slop) crossed.push("top");
  if (inner.x + inner.w > outer.x + outer.w + slop) crossed.push("right");
  if (inner.y + inner.h > outer.y + outer.h + slop) crossed.push("bottom");
  return crossed;
}

/** The zone's printable rectangle, inside the 5" bleed. Falls back to the container. */
function trimRect(zone) {
  const trim = zone?.trim;
  if (trim && Number.isFinite(trim.x) && Number.isFinite(trim.y) && Number.isFinite(trim.width) && Number.isFinite(trim.height)) {
    return { x: trim.x, y: trim.y, w: trim.width, h: trim.height };
  }
  return containerRect(zone);
}

/** The zone's full container rectangle -- what `cutCallOnePanels` actually extracts. */
function containerRect(zone) {
  return { x: zone.x, y: zone.y, w: zone.width, h: zone.height };
}

/**
 * The master as a bounded JPEG. A 4096 PNG master is ~32 MB; sending it whole
 * is a transport failure waiting to happen and buys nothing, because the answer
 * is four normalized numbers per element.
 */
async function boundedTransport(bytes) {
  const image = sharp(bytes, { limitInputPixels: 268_402_689 });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) {
    throw new PanelQcError("atlas_panel_qc_master_undecodable", "the accepted master bytes are not a decodable image");
  }
  const out = await image
    .resize({ width: MAX_TRANSPORT_DIMENSION, height: MAX_TRANSPORT_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  if (out.length > MAX_TRANSPORT_BYTES) {
    throw new PanelQcError("atlas_panel_qc_transport_too_large", `panel QC transport is ${out.length} bytes`);
  }
  return out;
}

/**
 * Build the injected `geminiJson` from the runtime's own provider, the same
 * transport the output-class gate uses (`provider.generateRaw`). Kept separate
 * from the containment math so a test can inject boxes and prove the geometry
 * without a provider, and so this file has no opinion about key pools.
 */
function providerLocator(provider, { model = PANEL_QC_MODEL, timeoutMs = PANEL_QC_TIMEOUT_MS, signal } = {}) {
  if (!provider || typeof provider.generateRaw !== "function") {
    throw new PanelQcError("atlas_panel_qc_transport_missing", "panel QC requires provider.generateRaw");
  }
  if (!/^gemini-[a-z0-9.-]+$/.test(String(model)) || /image/.test(String(model))) {
    throw new PanelQcError("atlas_panel_qc_model_invalid", `${model} is not an inspection model`);
  }
  return async (parts) => {
    const result = await provider.generateRaw({
      model,
      body: {
        contents: [{ parts }],
        generationConfig: { temperature: 0, responseMimeType: "application/json" },
      },
      signal,
      timeoutMs,
      label: "A.T.L.A.S. panel QC element locate",
    });
    const text = (result?.payload?.candidates?.[0]?.content?.parts || [])
      .filter((part) => typeof part?.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
    return JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  };
}

/**
 * RE-ASK, NEVER GUESS, NEVER DROP -- the same contract the Call 11 detector
 * carries, for the same reason. A dropped box is a severed element reported as
 * clean, which is the exact failure this module exists to end.
 *
 * `geminiJson` is injected, so the containment half is testable without a
 * provider and the localization half is the already-proven ported code.
 */
async function locateMasterElements(masterB64, { geminiJson, attempts = LOCATE_ATTEMPTS, log = () => {} } = {}) {
  if (typeof geminiJson !== "function") {
    throw new PanelQcError("atlas_panel_qc_locator_missing", "locateMasterElements requires a geminiJson implementation");
  }
  let located = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts && !located; attempt += 1) {
    try {
      const detected = await geminiJson([
        { text: ELEMENT_LOCATE_PROMPT },
        { inlineData: { mimeType: "image/png", data: masterB64 } },
      ]);
      const elements = Array.isArray(detected)
        ? detected
        : (detected?.elements ?? detected?.boxes ?? detected?.logos ?? detected?.branding);
      if (!Array.isArray(elements)) throw new Error("element locate response did not contain an elements array");
      located = elements.map((element, index) => ({
        label: String(element?.label || "element"),
        kind: String(element?.kind || ""),
        b: strictGeminiBox2d(element, index),
      }));
    } catch (error) {
      lastError = error;
      log(`[DESIGNPRO-OS] A.T.L.A.S. element locate attempt ${attempt}/${attempts} unusable: ${error?.message || error}`);
    }
  }
  if (!located) {
    throw new PanelQcError(
      "atlas_panel_qc_locate_unavailable",
      `A.T.L.A.S. element locate returned nothing usable after ${attempts} attempts: ${lastError?.message || lastError}`,
    );
  }
  // The ported collapse keeps labels and boxes; carry each element's kind back
  // onto the merged result by label so the surface-content contract can read it.
  const kinds = new Map(located.map((element) => [element.label, element.kind]));
  return collapseContainedLogoElements(located).map((element) => ({
    ...element,
    kind: element.label.split(" + ").map((label) => kinds.get(label)).filter(Boolean).join(" + "),
  }));
}

/**
 * THE MEASUREMENT. Pure integer geometry over the manifest's own zones -- no
 * thresholds to tune and no baseline to pick, which is what makes it trustable
 * where a pixel statistic was not.
 *
 * For each located element, three outcomes and only three:
 *
 *   contained   the box sits inside one zone's TRIM. It prints whole.
 *   in_bleed    the box sits inside one zone's CONTAINER but reaches past its
 *               trim. The panel carries it, and the installer's trim cut takes
 *               a bite out of it.
 *   severed     the box crosses a container boundary, so the cut has already
 *               split it across two or more panels -- or it lands where no zone
 *               covers the sheet at all, in which case it never reaches print.
 */
function planElementContainment(elements, manifest, masterWidth, masterHeight) {
  const zones = (manifest?.zones || []).filter((zone) => zone && zone.surfaceKey);
  if (!zones.length) {
    throw new PanelQcError("atlas_panel_qc_manifest_zones_missing", "panel QC requires the manifest zones");
  }
  return elements.map((element) => {
    const rect = boxToMasterRect(element.b, masterWidth, masterHeight);
    const slop = Math.max(BOX_SLOP_MIN_PX, Math.round(Math.min(rect.w, rect.h) * BOX_SLOP_RATIO));
    const touched = zones.filter((zone) => rectsOverlap(rect, containerRect(zone), slop));

    if (touched.length === 0) {
      return {
        label: element.label,
        kind: element.kind || null,
        box: element.b,
        rect,
        status: "severed",
        surfaces: [],
        crossings: [],
        detail: "the element sits outside every surface container, so no panel carries it",
      };
    }
    if (touched.length > 1) {
      return {
        label: element.label,
        kind: element.kind || null,
        box: element.b,
        rect,
        status: "severed",
        surfaces: touched.map((zone) => zone.surfaceKey),
        crossings: touched.map((zone) => ({
          surfaceKey: zone.surfaceKey,
          edges: crossedEdges(rect, containerRect(zone), slop),
        })),
        detail: `the element is cut across ${touched.length} surfaces (${touched.map((z) => z.surfaceKey).join(", ")})`,
      };
    }

    const zone = touched[0];
    const overTrim = crossedEdges(rect, trimRect(zone), slop);
    const overContainer = crossedEdges(rect, containerRect(zone), slop);
    if (overContainer.length) {
      return {
        label: element.label,
        kind: element.kind || null,
        box: element.b,
        rect,
        status: "severed",
        surfaces: [zone.surfaceKey],
        crossings: [{ surfaceKey: zone.surfaceKey, edges: overContainer }],
        detail: `the element runs off the ${overContainer.join(" and ")} edge of ${zone.surfaceKey}`,
      };
    }
    if (overTrim.length) {
      return {
        label: element.label,
        kind: element.kind || null,
        box: element.b,
        rect,
        status: "in_bleed",
        surfaces: [zone.surfaceKey],
        crossings: [{ surfaceKey: zone.surfaceKey, edges: overTrim }],
        detail: `the element reaches into ${zone.surfaceKey}'s ${overTrim.join(" and ")} bleed, so the installer's trim cut takes part of it`,
      };
    }
    return {
      label: element.label,
      kind: element.kind || null,
      box: element.b,
      rect,
      status: "contained",
      surfaces: [zone.surfaceKey],
      crossings: [],
      detail: `the element prints whole on ${zone.surfaceKey}`,
    };
  });
}

/**
 * Deterministic, provider-free, and TWO separate questions.
 *
 * 1. The panel's pixel aspect must match the aspect of the CONTAINER it was cut
 *    from. That is what `cutCallOnePanels` extracts, so a mismatch means the cut
 *    itself went wrong -- a flank delivered portrait is a flank that will not
 *    fit the vehicle.
 * 2. The container's aspect must match the physical sheet: the surface's trim
 *    inches plus the 5" bleed on all four sides. RULE 0.28: the printable area
 *    is the trim; the panel is trim + bleed. Comparing a container to bare TRIM
 *    inches convicts every correct panel, which is what a first cut of this
 *    check did to all six Arctic Air surfaces.
 */
function inspectOrientation({ widthPx, heightPx, zone, surfaceKey }) {
  const findings = [];
  const orientation = widthPx === heightPx ? "square" : widthPx > heightPx ? "landscape" : "portrait";
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) return { orientation, findings };
  const pixelAspect = widthPx / heightPx;

  if (Number.isFinite(zone?.width) && Number.isFinite(zone?.height) && zone.height > 0) {
    const containerAspect = zone.width / zone.height;
    if (Math.abs(pixelAspect - containerAspect) / containerAspect > ORIENTATION_DRIFT_MAX) {
      findings.push({
        code: "atlas_panel_orientation_mismatch",
        surfaceKey,
        pixelAspect: Number(pixelAspect.toFixed(4)),
        expectedAspect: Number(containerAspect.toFixed(4)),
        against: "zone container",
        detail: `the panel is ${pixelAspect.toFixed(2)}:1 and ${surfaceKey}'s container is ${containerAspect.toFixed(2)}:1`,
      });
    }
  }

  const bleed = Number(zone?.bleedInches ?? 0);
  const trimWidth = Number(zone?.printWidthIn ?? zone?.trimWidthIn);
  const trimHeight = Number(zone?.printHeightIn ?? zone?.trimHeightIn);
  if (Number.isFinite(trimWidth) && Number.isFinite(trimHeight) && trimWidth > 0 && trimHeight > 0) {
    const sheetAspect = (trimWidth + 2 * bleed) / (trimHeight + 2 * bleed);
    if (Math.abs(pixelAspect - sheetAspect) / sheetAspect > ORIENTATION_DRIFT_MAX) {
      findings.push({
        code: "atlas_panel_print_aspect_mismatch",
        surfaceKey,
        pixelAspect: Number(pixelAspect.toFixed(4)),
        expectedAspect: Number(sheetAspect.toFixed(4)),
        against: "trim inches + bleed",
        detail: `the panel is ${pixelAspect.toFixed(2)}:1 and ${surfaceKey} prints ${trimWidth}" x ${trimHeight}" plus ${bleed}" bleed (${sheetAspect.toFixed(2)}:1)`,
      });
    }
  }
  return { orientation, findings };
}

/**
 * Inspect the accepted master and its six extracted panels.
 *
 * `locateElements` is injected (default: the ported detector above) so a caller
 * can supply measured boxes and the containment half stays provable without a
 * provider call.
 *
 * Returns findings, never a repair. WHICH surfaces fail is the whole output,
 * because a repair that touches a passing panel is a redesign nobody asked for.
 */
async function inspectAtlasPanels({ masterBytes, panels = [], manifest, containment: knownContainment, locateElements, geminiJson, provider, log = () => {} } = {}) {
  if (!Buffer.isBuffer(masterBytes)) {
    throw new PanelQcError("atlas_panel_qc_master_missing", "panel QC requires the accepted master bytes");
  }
  const masterMeta = await sharp(masterBytes).metadata();
  const masterWidth = masterMeta.width;
  const masterHeight = masterMeta.height;

  const locate = typeof locateElements === "function"
    ? locateElements
    : async (bytes) => locateMasterElements(
        (await boundedTransport(bytes)).toString("base64"),
        { geminiJson: typeof geminiJson === "function" ? geminiJson : providerLocator(provider), log },
      );

  // A caller that has ALREADY resolved containment on these exact bytes passes
  // it back rather than paying for a second localization. The repair path does
  // this: it locates once, repairs, re-locates to verify, then cuts -- and the
  // per-panel report over the cut panels reuses the verified result instead of
  // asking a third time.
  if (Array.isArray(knownContainment)) {
    return buildSurfaceReport({ containment: knownContainment, panels, manifest, masterWidth, masterHeight, locateUnavailable: null });
  }

  let elements = null;
  let locateUnavailable = null;
  try {
    elements = await locate(masterBytes, { masterWidth, masterHeight });
  } catch (error) {
    // TRANSPORT FAILURE FAILS OPEN, WITH A DURABLE RECEIPT -- the same shape
    // RULE 0.30 fixed for the output-class gate. An outage must not brick a
    // generation, and "we could not look" must never read as "we looked and it
    // was fine": `elementsLocated` is null and `ok` is false-by-unknown.
    locateUnavailable = String(error?.message || error);
    log(`[DESIGNPRO-OS] A.T.L.A.S. panel QC element locate unavailable: ${locateUnavailable}`);
  }

  const containment = elements ? planElementContainment(elements, manifest, masterWidth, masterHeight) : null;
  return buildSurfaceReport({ containment, panels, manifest, masterWidth, masterHeight, locateUnavailable });
}

/**
 * Turn resolved containment into the per-surface report. Split out so the
 * repair path can reuse a containment it already paid for, and so this half --
 * which is pure geometry over recorded findings -- is testable on its own.
 */
async function buildSurfaceReport({ containment, panels, manifest, masterWidth, masterHeight, locateUnavailable }) {
  const items = Array.isArray(containment) ? containment : [];
  const zonesByKey = new Map((manifest?.zones || []).map((zone) => [zone.surfaceKey, zone]));

  const surfaces = [];
  for (const panel of panels) {
    const key = String(panel.surfaceKey || "");
    const zone = zonesByKey.get(key);
    const meta = Buffer.isBuffer(panel.bytes)
      ? await sharp(panel.bytes).metadata()
      : { width: panel.pixelWidth ?? zone?.width, height: panel.pixelHeight ?? zone?.height };
    const { orientation, findings } = inspectOrientation({
      widthPx: meta.width,
      heightPx: meta.height,
      zone,
      surfaceKey: key,
    });

    const severed = items.filter((item) => item.status === "severed" && item.surfaces.includes(key));
    const clipped = items.filter((item) => item.status === "in_bleed" && item.surfaces.includes(key));
    const intact = items.filter((item) => item.status === "contained" && item.surfaces.includes(key));

    for (const item of severed) {
      findings.push({
        code: "atlas_panel_element_severed",
        surfaceKey: key,
        element: item.label,
        edges: item.crossings.find((crossing) => crossing.surfaceKey === key)?.edges || [],
        acrossSurfaces: item.surfaces,
        detail: item.detail,
      });
    }
    for (const item of clipped) {
      findings.push({
        code: "atlas_panel_element_in_bleed",
        surfaceKey: key,
        element: item.label,
        edges: item.crossings.find((crossing) => crossing.surfaceKey === key)?.edges || [],
        detail: item.detail,
      });
    }

    surfaces.push({
      contract: PANEL_QC_CONTRACT,
      surfaceKey: key,
      widthPx: meta.width,
      heightPx: meta.height,
      orientation,
      elementsIntact: intact.map((item) => item.label),
      elementsSevered: severed.map((item) => item.label),
      elementsInBleed: clipped.map((item) => item.label),
      findings,
      ok: locateUnavailable ? false : findings.length === 0,
    });
  }

  return {
    contract: PANEL_QC_CONTRACT,
    masterWidthPx: masterWidth,
    masterHeightPx: masterHeight,
    elementsLocated: containment,
    locateUnavailable: locateUnavailable || null,
    surfaces,
    failing: surfaces.filter((surface) => !surface.ok).map((surface) => surface.surfaceKey),
    passing: surfaces.filter((surface) => surface.ok).map((surface) => surface.surfaceKey),
    severedElements: items.filter((item) => item.status === "severed"),
  };
}

module.exports = {
  PANEL_QC_CONTRACT,
  PANEL_QC_MODEL,
  ELEMENT_LOCATE_PROMPT,
  BOX_SLOP_RATIO,
  BOX_SLOP_MIN_PX,
  ORIENTATION_DRIFT_MAX,
  PanelQcError,
  boxToMasterRect,
  crossedEdges,
  buildSurfaceReport,
  inspectAtlasPanels,
  locateMasterElements,
  planElementContainment,
  providerLocator,
  _test: { rectsOverlap, trimRect, containerRect, inspectOrientation, boundedTransport },
};
