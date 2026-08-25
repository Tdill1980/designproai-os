"use strict";

/**
 * Fail-closed acceptance for the one A.T.L.A.S. flattened design call.
 *
 * Proof QC cannot rescue a bad authority: if a blank, cut-out, incoherent or
 * misspelled sheet is persisted first, seven faithful projections are still
 * seven bad proofs. This gate therefore inspects the normalized master before
 * it receives an immutable row. It combines deterministic pixel checks with a
 * schema-bound multimodal review through the existing server provider.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const MASTER_QC_CONTRACT = "designpro.atlas-master-semantic-qc.v1";
const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.92;
const MIN_ZONE_OPAQUE_RATIO = 0.995;
const MIN_ZONE_EDGE_OPAQUE_RATIO = 0.99;
const MIN_ZONE_LUMA_STDDEV = 6;
const MAX_PASSENGER_MIRROR_MAE = 0.26;
// The trim fraction this check drops before averaging. The authoring prompt
// requires passenger to be the mirror-compatible TWIN of driver -- same
// motif, scene, hierarchy, scale -- while "every word/logo/URL/number
// remains forward-reading on both zones" (flat-first-atlas.cjs TOPOLOGY
// LOCK). That second clause makes a literal full-zone pixel mirror
// impossible for any design that carries legible branding: flipping driver's
// forward text produces backward text, which can never match passenger's
// independently forward text at the same pixels, however well the two flanks
// actually match as a design. Live evidence 2026-08-24 (generation
// dda491ae-ed63-4aa7-96af-c377d4f71383): a real branded master was refused
// at passengerMirrorMae=0.28346, barely over the old untrimmed 0.26 bound,
// with no other check flagging it -- the motif matched, only the localized
// text/logo band did not, exactly as the prompt instructs. Dropping the
// worst-matching quarter of pixels before averaging absorbs one text/logo
// band's worth of legitimate divergence while a passenger zone that is not
// actually the driver's twin still differs across nearly the whole zone and
// still fails on the trimmed mean.
const PASSENGER_MIRROR_TRIM_FRACTION = 0.25;
// A punched-out wheel arch or window is a flat, near-black blob sitting inside
// otherwise bright artwork -- opaque, so opaqueRatio never saw it. Live evidence
// 2026-08-23 (Becky's Bakery): the master came back as a van silhouette with
// black wheel circles and black glass, every deterministic check reported pass,
// and those holes would have printed as holes. A wrap panel is a solid
// rectangle; the installer cuts the wheel opening, the artwork never does.
//
// What keeps a genuinely dark design legal is the SHARE of the zone that is
// bright, not how bright the bright parts are: a mostly-black wrap still has
// vivid accents, so a mean taken over its non-black pixels reads high and would
// convict it. A cutout is a minority of flat black sitting inside a zone that is
// mostly artwork. Measured on synthetic zones: punched wheels/glass = 22% flat
// black with 78% bright, a black wrap = 90% flat black with 10% bright.
//
// TWO CONVICTIONS, ONE GUARD. The bright-majority guard below protects the black
// wrap in both. What differs is what counts as evidence of a hole:
//
//   largestCutoutComponentRatio -- ONE contiguous blob over 2% of the zone.
//     Catches a single arch or window that the 5% aggregate is too coarse to
//     see, and it is the only path that sees a TRANSPARENT punch, which is not
//     near-black at all. Being per-component, it also cannot be reached by dark
//     detail scattered across a zone the way an aggregate can.
//   concentratedFlatBlackRatio -- 5% of the zone in flat black overall, counting
//     ONLY components that are individually at least 0.25% of the zone. Still
//     convicts the many-small-openings case, where no single blob clears 2% but
//     the panel is visibly perforated -- a punched opening is orders of
//     magnitude larger than the floor.
//
//     The floor exists because the raw aggregate convicted real artwork. First
//     live master through this gate (2026-08-24): driver read 7.3% flat black
//     across THREE THOUSAND SEVEN HUNDRED SIXTY-ONE components -- average
//     component 0.002% of the zone. That is anti-aliased lettering interiors,
//     outlines and shadow detail, not holes; a die-cut wheel is ONE shape. The
//     synthetic fixtures were clean flat colours and could never produce that
//     texture, which is why the false-positive class was invisible until a real
//     Gemini master arrived. Ink scattered as specks is design; ink concentrated
//     in shapes is a hole.
//
// Neither subsumes the other, so both stand.
const MAX_ZONE_FLAT_BLACK_RATIO = 0.05;
const FLAT_BLACK_CHANNEL_MAX = 24;
const CUTOUT_BRIGHT_MAJORITY = 0.55;
const MAX_ZONE_CUTOUT_COMPONENT_RATIO = 0.02;
const MIN_CUTOUT_COMPONENT_RATIO = 0.0025;
const CUTOUT_ALPHA_MAX = 128;
const MAX_REQUEST_BYTES = 18 * 1024 * 1024;
const MAX_TRANSPORT_BYTES = 3 * 1024 * 1024;
const MAX_TRANSPORT_DIMENSION = 1800;
const RESPONSE_FIELDS = Object.freeze([
  "contract",
  "masterSha256",
  "guideSha256",
  "outputFormatContract",
  "topologyContract",
  "zoneCoverageContract",
  "fullBleedNoCutoutsContract",
  "coherentDesignContract",
  "briefFidelityContract",
  "brandTextContract",
  "passengerMirrorContract",
  "artifactFreeContract",
  "confidence",
  "reasons",
]);
const STATUS = Object.freeze(["pass", "fail", "uncertain", "not_applicable"]);

class AtlasMasterQcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.retryable = false;
    this.name = "AtlasMasterQcError";
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function cleanText(value, max = 300) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function requireImage(bytes, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new AtlasMasterQcError("atlas_master_qc_image_missing", `${label} bytes are required`);
  }
  return bytes;
}

function requireManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.zones)
    || manifest.zones.length !== 6) {
    throw new AtlasMasterQcError("atlas_master_qc_manifest_invalid", "The exact six-zone Atlas manifest is required");
  }
  return manifest;
}

function validatedZone(zone, width, height) {
  const x = Number(zone?.x);
  const y = Number(zone?.y);
  const w = Number(zone?.w);
  const h = Number(zone?.h);
  if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w < 1 || h < 1
    || x + w > width || y + h > height) {
    throw new AtlasMasterQcError("atlas_master_qc_zone_invalid", `${zone?.surfaceKey || "unknown"} zone is out of bounds`);
  }
  return { left: x, top: y, width: w, height: h };
}

async function zonePixelMetrics(masterBytes, manifest) {
  const metadata = await sharp(masterBytes, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) throw new AtlasMasterQcError("atlas_master_qc_image_invalid", "Atlas master dimensions are unavailable");

  const metrics = [];
  for (const zone of manifest.zones) {
    const box = validatedZone(zone, width, height);
    const { data, info } = await sharp(masterBytes, { failOn: "error", limitInputPixels: 100_000_000 })
      .extract(box)
      .ensureAlpha()
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    let opaque = 0;
    let edgeOpaque = 0;
    let edgePixels = 0;
    let luminanceTotal = 0;
    let luminanceSquared = 0;
    const pixelCount = info.width * info.height;
    const edgeDepth = Math.max(1, Math.min(4, Math.floor(Math.min(info.width, info.height) / 20)));
    for (let py = 0; py < info.height; py += 1) {
      for (let px = 0; px < info.width; px += 1) {
        const offset = (py * info.width + px) * info.channels;
        const red = data[offset];
        const green = data[offset + 1] ?? red;
        const blue = data[offset + 2] ?? red;
        const alpha = data[offset + info.channels - 1];
        const isOpaque = alpha >= 250;
        if (isOpaque) opaque += 1;
        const atEdge = px < edgeDepth || py < edgeDepth
          || px >= info.width - edgeDepth || py >= info.height - edgeDepth;
        if (atEdge) {
          edgePixels += 1;
          if (isOpaque) edgeOpaque += 1;
        }
        if (isOpaque) {
          const luma = 0.299 * red + 0.587 * green + 0.114 * blue;
          luminanceTotal += luma;
          luminanceSquared += luma * luma;
        }
      }
    }
    const average = opaque ? luminanceTotal / opaque : 0;
    const variance = opaque ? Math.max(0, luminanceSquared / opaque - average * average) : 0;
    // Second pass for the cutout signature: a near-black pixel whose four
    // neighbours are also near-black is blob INTERIOR, not a dark line, an
    // outline or a shadow edge. Counting interiors is what separates a punched
    // wheel arch from dark artwork detail.
    let flatBlack = 0;
    let brightTotal = 0;
    let brightCount = 0;
    // A hole is either flat black or nothing at all, so both count as blob
    // material. Transparency is the case the near-black test cannot see.
    const holeAt = (px, py) => {
      if (px < 0 || py < 0 || px >= info.width || py >= info.height) return true;
      const offset = (py * info.width + px) * info.channels;
      const red = data[offset];
      const green = data[offset + 1] ?? red;
      const blue = data[offset + 2] ?? red;
      if (data[offset + info.channels - 1] < CUTOUT_ALPHA_MAX) return true;
      return Math.max(red, green, blue) <= FLAT_BLACK_CHANNEL_MAX;
    };
    // `interior` is the blob mask the component pass labels: marking only
    // interiors is what stops a dark outline or a shadow edge from chaining
    // scattered detail into one apparently large "opening".
    const interior = new Uint8Array(pixelCount);
    for (let py = 0; py < info.height; py += 1) {
      for (let px = 0; px < info.width; px += 1) {
        if (holeAt(px, py)) {
          if (holeAt(px - 1, py) && holeAt(px + 1, py)
            && holeAt(px, py - 1) && holeAt(px, py + 1)) {
            flatBlack += 1;
            interior[py * info.width + px] = 1;
          }
          continue;
        }
        const offset = (py * info.width + px) * info.channels;
        const red = data[offset];
        const green = data[offset + 1] ?? red;
        const blue = data[offset + 2] ?? red;
        brightTotal += 0.299 * red + 0.587 * green + 0.114 * blue;
        brightCount += 1;
      }
    }

    // Iterative 4-connected labelling over the interior mask. An explicit stack
    // keeps a zone-sized blob from recursing deeper than the call stack allows.
    const seen = new Uint8Array(pixelCount);
    const stack = new Int32Array(pixelCount);
    const componentFloor = pixelCount * MIN_CUTOUT_COMPONENT_RATIO;
    let largestComponent = 0;
    let componentCount = 0;
    let concentratedFlatBlack = 0;
    for (let start = 0; start < pixelCount; start += 1) {
      if (!interior[start] || seen[start]) continue;
      componentCount += 1;
      let top = 0;
      stack[top] = start;
      top += 1;
      seen[start] = 1;
      let size = 0;
      while (top > 0) {
        top -= 1;
        const index = stack[top];
        size += 1;
        const x = index % info.width;
        const y = (index - x) / info.width;
        // Inlined on purpose: this is the inner loop of a per-pixel labelling
        // pass over six full-resolution zones on every Atlas authoring attempt.
        let neighbour = 0;
        if (x > 0) { neighbour = index - 1; if (interior[neighbour] && !seen[neighbour]) { seen[neighbour] = 1; stack[top] = neighbour; top += 1; } }
        if (x + 1 < info.width) { neighbour = index + 1; if (interior[neighbour] && !seen[neighbour]) { seen[neighbour] = 1; stack[top] = neighbour; top += 1; } }
        if (y > 0) { neighbour = index - info.width; if (interior[neighbour] && !seen[neighbour]) { seen[neighbour] = 1; stack[top] = neighbour; top += 1; } }
        if (y + 1 < info.height) { neighbour = index + info.width; if (interior[neighbour] && !seen[neighbour]) { seen[neighbour] = 1; stack[top] = neighbour; top += 1; } }
      }
      if (size > largestComponent) largestComponent = size;
      if (size >= componentFloor) concentratedFlatBlack += size;
    }
    metrics.push({
      surfaceKey: String(zone.surfaceKey),
      opaqueRatio: opaque / pixelCount,
      edgeOpaqueRatio: edgePixels ? edgeOpaque / edgePixels : 0,
      lumaStddev: Math.sqrt(variance),
      flatBlackRatio: flatBlack / pixelCount,
      concentratedFlatBlackRatio: concentratedFlatBlack / pixelCount,
      largestCutoutComponentRatio: pixelCount ? largestComponent / pixelCount : 0,
      cutoutComponentCount: componentCount,
      nonBlackFraction: brightCount / pixelCount,
      nonBlackMeanLuma: brightCount ? brightTotal / brightCount : 0,
    });
  }
  return metrics;
}

async function nativeZoneSignature(masterBytes, zone, { mirror = false } = {}) {
  const rotation = Number(zone?.extraction?.outputRotationDegrees || 0);
  let pipeline = sharp(masterBytes, { failOn: "error", limitInputPixels: 100_000_000 })
    .extract({ left: Number(zone.x), top: Number(zone.y), width: Number(zone.w), height: Number(zone.h) })
    .rotate(rotation)
    .flatten({ background: "#ffffff" });
  if (mirror) pipeline = pipeline.flop();
  const { data } = await pipeline
    .toColourspace("srgb")
    .resize(160, 64, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function passengerMirrorMae(masterBytes, manifest) {
  const driver = manifest.zones.find((zone) => zone.surfaceKey === "driver");
  const passenger = manifest.zones.find((zone) => zone.surfaceKey === "passenger");
  if (!driver || !passenger) {
    throw new AtlasMasterQcError("atlas_master_qc_side_zones_missing", "Driver and Passenger zones are required");
  }
  const [mirroredDriver, passengerPixels] = await Promise.all([
    nativeZoneSignature(masterBytes, driver, { mirror: true }),
    nativeZoneSignature(masterBytes, passenger),
  ]);
  if (!mirroredDriver.length || mirroredDriver.length !== passengerPixels.length) {
    throw new AtlasMasterQcError("atlas_master_qc_side_comparison_invalid", "Passenger mirror comparison could not be computed");
  }
  const diffs = new Array(mirroredDriver.length);
  for (let index = 0; index < mirroredDriver.length; index += 1) {
    diffs[index] = Math.abs(mirroredDriver[index] - passengerPixels[index]);
  }
  diffs.sort((a, b) => a - b);
  const keep = Math.max(1, Math.ceil(diffs.length * (1 - PASSENGER_MIRROR_TRIM_FRACTION)));
  let difference = 0;
  for (let index = 0; index < keep; index += 1) difference += diffs[index];
  return difference / (keep * 255);
}

/**
 * A cut-out is a PRINT defect, not a broken design.
 *
 * The 3D proof masks the master to the real painted body, so a hole punched
 * where the wheel arch sits lands exactly in the region the mask discards --
 * the proof is unaffected, which is why gorgeous seven-view sets came out of
 * ungated cut-out masters all through August. The hole only becomes real at the
 * panel cut, where it prints as a hole in the vinyl.
 *
 * So the findings are classified rather than pooled. A blank, flat or
 * mirror-broken master is unusable as a DESIGN and stays fatal. A cut-out is
 * carried as a flag on the affected surfaces, so the design and its seven
 * proofs survive and PanelPro's human QC catches the panel before it prints.
 * `accepted` still means "clean on every count" -- the strict path is unchanged
 * and callers that want it keep it.
 */
async function deterministicMasterChecks(masterBytes, manifest) {
  const zones = await zonePixelMetrics(masterBytes, manifest);
  const passengerMae = await passengerMirrorMae(masterBytes, manifest);
  const failures = [];
  const blockingFailures = [];
  const cutoutFindings = [];
  const blocking = (finding) => { failures.push(finding); blockingFailures.push(finding); };
  const cutout = (surfaceKey, finding) => {
    failures.push(finding);
    cutoutFindings.push({ surfaceKey, finding });
  };
  for (const zone of zones) {
    if (zone.opaqueRatio < MIN_ZONE_OPAQUE_RATIO) {
      blocking(`${zone.surfaceKey} opaqueRatio=${zone.opaqueRatio.toFixed(5)}`);
    }
    if (zone.edgeOpaqueRatio < MIN_ZONE_EDGE_OPAQUE_RATIO) {
      blocking(`${zone.surfaceKey} edgeOpaqueRatio=${zone.edgeOpaqueRatio.toFixed(5)}`);
    }
    if (zone.lumaStddev < MIN_ZONE_LUMA_STDDEV) {
      blocking(`${zone.surfaceKey} lumaStddev=${zone.lumaStddev.toFixed(2)}`);
    }
    // Wheel arches, glass and bed openings drawn as holes. Printed, these are
    // holes in the wrap; the installer is the one who cuts an opening, and they
    // cut it out of a solid panel. Both readings of "hole" convict, and the
    // bright-majority guard on each is what keeps a black wrap legal.
    if (zone.nonBlackFraction >= CUTOUT_BRIGHT_MAJORITY) {
      if (zone.largestCutoutComponentRatio > MAX_ZONE_CUTOUT_COMPONENT_RATIO) {
        cutout(zone.surfaceKey,
          `${zone.surfaceKey} largestCutoutComponentRatio=${zone.largestCutoutComponentRatio.toFixed(5)} `
          + `(flatBlackRatio=${zone.flatBlackRatio.toFixed(5)}) `
          + `inside a zone that is ${(zone.nonBlackFraction * 100).toFixed(1)}% artwork `
          + `-- one wheel/glass/bed shape cut out of the panel`,
        );
      } else if (zone.concentratedFlatBlackRatio > MAX_ZONE_FLAT_BLACK_RATIO) {
        // Only components at least 0.25% of the zone count here. The raw
        // aggregate convicted a real master's lettering and shadow detail --
        // 7.3% spread across 3,761 specks -- as "wheel/glass/bed shapes".
        cutout(zone.surfaceKey,
          `${zone.surfaceKey} concentratedFlatBlackRatio=${zone.concentratedFlatBlackRatio.toFixed(5)} `
          + `(flatBlackRatio=${zone.flatBlackRatio.toFixed(5)} across ${zone.cutoutComponentCount} shapes) `
          + `inside a zone that is ${(zone.nonBlackFraction * 100).toFixed(1)}% artwork `
          + `(wheel/glass/bed shapes cut out of the panel)`,
        );
      }
    }
  }
  if (passengerMae > MAX_PASSENGER_MIRROR_MAE) {
    blocking(`passengerMirrorMae=${passengerMae.toFixed(5)}`);
  }
  return {
    accepted: failures.length === 0,
    zones,
    passengerMirrorMae: passengerMae,
    failures,
    blockingFailures,
    cutoutFindings,
  };
}

async function boundedTransport(bytes, label) {
  const widths = [MAX_TRANSPORT_DIMENSION, 1600, 1400, 1200, 1024];
  const qualities = [88, 82, 76, 70, 64];
  for (const width of widths) {
    for (const quality of qualities) {
      const candidate = await sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
        .jpeg({ quality, chromaSubsampling: "4:4:4", mozjpeg: true })
        .toBuffer();
      if (candidate.length <= MAX_TRANSPORT_BYTES) return candidate;
    }
  }
  throw new AtlasMasterQcError("atlas_master_qc_transport_too_large", `${label} cannot fit the inspection budget`);
}

function expectedBrandStrings(input = {}) {
  return [input.companyName || input.businessName, input.phone, input.website]
    .map((value) => cleanText(value, 300)).filter(Boolean);
}

function masterQcPrompt({ input, manifest, masterHash, guideHash, deterministic }) {
  const brandStrings = expectedBrandStrings(input);
  const vehicle = [input?.vehicle?.year, input?.vehicle?.make, input?.vehicle?.model, input?.vehicle?.type]
    .map((value) => cleanText(value, 100)).filter(Boolean).join(" ") || "selected vehicle";
  const topology = manifest.installerMap || {};
  return `A.T.L.A.S. FLATTENED-MASTER ACCEPTANCE — ${MASTER_QC_CONTRACT}

You are a strict vehicle-wrap design quality inspector, not a designer. IMAGE 1 is the candidate flattened master. IMAGE 2 is the deterministic neutral guide. Reject instead of guessing.

Candidate sha256: ${masterHash}
Guide sha256: ${guideHash}
Vehicle: ${vehicle}
Customer brief: ${cleanText(input.brief, 3000)}
Required brand strings: ${brandStrings.length ? JSON.stringify(brandStrings) : "none"}
Topology: passenger=${topology.passenger}; driver=${topology.driver}; center=${Array.isArray(topology.centerOrderTopToBottom) ? topology.centerOrderTopToBottom.join(" -> ") : "rear -> roof -> hood -> front"}.
Deterministic pixel evidence: ${JSON.stringify(deterministic)}

ACCEPTANCE CONTRACT:
1. IMAGE 1 is one flat 2D unwrapped artwork sheet in exactly the guide's six zones, not a vehicle photo, mockup, proof, second template, labelled diagram or Hero view.
2. Every zone is one solid rectangle of continuous artwork, filled edge to edge and corner to corner. The artwork runs unbroken straight through the places a windshield, side window, wheel arch, pickup-bed opening, light or trim will later sit -- the installer cuts those openings out of a finished panel, so the master carries artwork there. A zone containing a vehicle silhouette, a wheel circle, a glass shape or any hole punched through the design is a failure even when the hole is filled with flat colour.
3. The sheet is one premium DesignPanelAI wrap: layered depth, intentional flow, strong hierarchy, readable-at-a-glance composition and gallery-grade custom quality. Six unrelated designs, generic AI filler, duplicated panels or incoherent motifs fail.
4. The brief, palette, supplied identity and requested photographic/illustrated treatment are visibly honored. Do not excuse a generic design merely because it is colorful.
5. Every supplied business/contact string that is visibly rendered must be exact and forward-reading. Malformed or invented words, URLs or numbers fail. If no brand strings are required, brandTextContract is not_applicable.
6. Passenger is the opposite-facing, mirror-compatible twin of Driver in motif, scale, hierarchy and flow, while every readable string on both sides remains forward-reading. Grossly different side compositions fail.
7. No guide gray, guide labels, outlines, dimensions, legends, browser UI, watermarks, melted artwork or other AI artifacts may survive.
8. Return only schema-bound JSON. Echo the two sha256 identities exactly.
`;
}

function responseSchema({ masterHash, guideHash, brandRequired }) {
  const status = { type: "STRING", enum: [...STATUS] };
  return {
    type: "OBJECT",
    propertyOrdering: [...RESPONSE_FIELDS],
    properties: {
      contract: { type: "STRING", enum: [MASTER_QC_CONTRACT] },
      masterSha256: { type: "STRING", enum: [masterHash] },
      guideSha256: { type: "STRING", enum: [guideHash] },
      outputFormatContract: status,
      topologyContract: status,
      zoneCoverageContract: status,
      fullBleedNoCutoutsContract: status,
      coherentDesignContract: status,
      briefFidelityContract: status,
      brandTextContract: { type: "STRING", enum: [brandRequired ? "pass" : "not_applicable", "fail", "uncertain"] },
      passengerMirrorContract: status,
      artifactFreeContract: status,
      confidence: { type: "NUMBER", minimum: 0, maximum: 1 },
      reasons: { type: "ARRAY", maxItems: 10, items: { type: "STRING" } },
    },
    required: [...RESPONSE_FIELDS],
  };
}

function responseText(payload) {
  const candidate = payload?.candidates?.[0];
  const finishReason = String(candidate?.finishReason || "");
  if (finishReason && finishReason !== "STOP") {
    throw new AtlasMasterQcError("atlas_master_qc_analyzer_incomplete", `Inspector stopped with ${cleanText(finishReason, 80)}`);
  }
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const texts = parts.filter((part) => typeof part?.text === "string" && !part.inlineData).map((part) => part.text);
  if (texts.length !== 1 || parts.some((part) => part?.inlineData || part?.functionCall || part?.functionResponse)) {
    throw new AtlasMasterQcError("atlas_master_qc_response_malformed", "Inspector did not return one JSON text part");
  }
  return texts[0].trim();
}

function parseMasterQcResponse(payload, expected) {
  let review;
  try { review = JSON.parse(responseText(payload)); }
  catch (cause) {
    if (cause instanceof AtlasMasterQcError) throw cause;
    throw new AtlasMasterQcError("atlas_master_qc_response_malformed", "Inspector response was not JSON");
  }
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    throw new AtlasMasterQcError("atlas_master_qc_response_malformed", "Inspector JSON was not an object");
  }
  const keys = Object.keys(review).sort();
  const expectedKeys = [...RESPONSE_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new AtlasMasterQcError("atlas_master_qc_response_malformed", "Inspector fields did not match the locked schema");
  }
  if (review.contract !== MASTER_QC_CONTRACT || review.masterSha256 !== expected.masterHash
    || review.guideSha256 !== expected.guideHash) {
    throw new AtlasMasterQcError("atlas_master_qc_identity_mismatch", "Inspector did not bind to this master and guide");
  }
  return review;
}

// A hole is scoped to the printed panel, so fullBleedNoCutoutsContract is
// deliberately absent from this list -- see cutoutContractFailed below. Every
// other contract describes whether this is a usable DESIGN, and those stay
// fatal: there is nothing worth showing a customer in an incoherent sheet.
function rejectionFor(review, brandRequired, confidenceThreshold) {
  const requiredPass = [
    "outputFormatContract", "topologyContract", "zoneCoverageContract",
    "coherentDesignContract", "briefFidelityContract",
    "passengerMirrorContract", "artifactFreeContract",
  ];
  const failed = requiredPass.filter((field) => review[field] !== "pass");
  const brandExpected = brandRequired ? "pass" : "not_applicable";
  if (review.brandTextContract !== brandExpected) failed.push("brandTextContract");
  if (!Number.isFinite(review.confidence) || review.confidence < confidenceThreshold) failed.push("confidence");
  if (!failed.length) return null;
  // The caller needs to know WHICH contracts failed, not only that something
  // did -- a coverage failure caused by holes is a repairable panel defect,
  // while the same failure caused by anything else is a broken design. The
  // string is unchanged, so every existing message and test still reads the
  // same; `failed` is additive.
  return {
    failed,
    reason: `${failed.join(", ")}: ${(Array.isArray(review.reasons) ? review.reasons : []).map((item) => cleanText(item, 240)).filter(Boolean).join("; ")}`.slice(0, 800),
  };
}

/**
 * THE ONE CASE WHERE A SEMANTIC COVERAGE FAILURE IS NOT FATAL.
 *
 * RULE 0.15 is explicit that a cut-out must never destroy the design: the 3D
 * proof masks the master to the painted body, so a hole where the wheel arch
 * sits lands in the region the mask discards, and the hole only becomes real at
 * the panel cut -- where `atlas-cutout-fill.cjs` closes it deterministically.
 * `fullBleedNoCutoutsContract` is therefore deliberately absent from
 * `requiredPass`.
 *
 * But the reviewer records the same holes a second time under
 * `zoneCoverageContract`, which IS fatal, and that conviction returned before
 * the cut-out classification below could ever run. So the repair stage was
 * unreachable by construction:
 *
 *     detect cut-out -> classify repairable -> reviewer sees the same cut-out
 *       -> master killed -> fill never runs
 *
 * Live evidence 2026-08-25, canary ff1566c3: three attempts refused on
 * zoneCoverageContract alone, every finding a wheel/glass shape, artifactFree
 * passing, nothing else failing -- a design the architecture says should have
 * survived and been repaired.
 *
 * The escape is deliberately narrow. It requires ALL of:
 *   - zoneCoverageContract is the ONLY failed contract, so brand text,
 *     topology, coherence, brief fidelity, passenger mirror, artifact-free and
 *     confidence all passed;
 *   - the deterministic layer independently measured and classified cut-outs,
 *     so this is not the model's word alone;
 *   - the reviewer's own hole contract also failed, so it agrees the coverage
 *     problem is holes rather than, say, a transparent region.
 *
 * That last clause is what keeps a genuinely unpainted zone fatal. A reviewer
 * reporting transparency but no holes leaves `fullBleedNoCutoutsContract`
 * passing, and this returns false. No threshold moves, nothing is reclassified
 * as a cut-out that was not already one, and every other contract stays fatal.
 */
function coverageFailedOnClassifiedCutoutsOnly(rejection, review, deterministic) {
  return Array.isArray(rejection?.failed)
    && rejection.failed.length === 1
    && rejection.failed[0] === "zoneCoverageContract"
    && Array.isArray(deterministic?.cutoutFindings)
    && deterministic.cutoutFindings.length > 0
    && cutoutContractFailed(review);
}

// The reviewer's own read on holes. Deterministic pixel measurement is the
// authority, but the model sometimes sees an opening the metrics do not, and
// either way the consequence is the same: flag the panel, keep the design.
function cutoutContractFailed(review) {
  return review?.fullBleedNoCutoutsContract !== "pass";
}

function createAtlasMasterValidator({ provider, model = DEFAULT_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD, maxRequestBytes = MAX_REQUEST_BYTES } = {}) {
  if (!provider || typeof provider.generateRaw !== "function") {
    throw new AtlasMasterQcError("atlas_master_qc_provider_invalid", "Master QC requires provider.generateRaw");
  }
  return async function validateAtlasMaster({ masterBytes, guideBytes, manifest, input } = {}) {
    try {
      const master = requireImage(masterBytes, "master");
      const guide = requireImage(guideBytes, "guide");
      const exactManifest = requireManifest(manifest);
      const masterHash = sha256(master);
      const guideHash = sha256(guide);
      const deterministic = await deterministicMasterChecks(master, exactManifest);
      // Only a broken DESIGN short-circuits the review. A cut-out master still
      // has to earn its design review -- coherence, brief fidelity, lettering --
      // because it is going to be shown to the customer as seven proofs, and
      // because the exhausted-re-roll path needs a complete QC record to
      // persist rather than an empty one.
      if (deterministic.blockingFailures.length) {
        return {
          accepted: false,
          code: "atlas_master_qc_deterministic_failed",
          reason: deterministic.blockingFailures.join("; ").slice(0, 800),
          deterministic,
        };
      }
      const [masterTransport, guideTransport] = await Promise.all([
        boundedTransport(master, "master"), boundedTransport(guide, "guide"),
      ]);
      const brandRequired = expectedBrandStrings(input).length > 0;
      const prompt = masterQcPrompt({ input, manifest: exactManifest, masterHash, guideHash, deterministic });
      const body = {
        contents: [{ role: "user", parts: [
          { text: `${prompt}\nIMAGE 1 — CANDIDATE FLATTENED MASTER:` },
          { inlineData: { mimeType: "image/jpeg", data: masterTransport.toString("base64") } },
          { text: "IMAGE 2 — DETERMINISTIC NEUTRAL GUIDE:" },
          { inlineData: { mimeType: "image/jpeg", data: guideTransport.toString("base64") } },
        ] }],
        generationConfig: {
          temperature: 0,
          // Gemini 2.5 Flash otherwise spends this small structured-response
          // budget on hidden reasoning and can return MAX_TOKENS before it
          // emits the schema-bound JSON. QC must grade pixels, not burn the
          // entire response allowance thinking about how to format its receipt.
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: responseSchema({ masterHash, guideHash, brandRequired }),
        },
      };
      const requestByteSize = Buffer.byteLength(JSON.stringify(body));
      if (requestByteSize > Math.min(MAX_REQUEST_BYTES, Number(maxRequestBytes) || MAX_REQUEST_BYTES)) {
        throw new AtlasMasterQcError("atlas_master_qc_request_too_large", `Master QC request is ${requestByteSize} bytes`);
      }
      const result = await provider.generateRaw({
        model, body, timeoutMs, label: "A.T.L.A.S. flattened-master semantic QC",
      });
      const review = parseMasterQcResponse(result?.payload, { masterHash, guideHash });
      const rejection = rejectionFor(review, brandRequired, confidenceThreshold);
      // Every semantic failure is fatal EXCEPT a coverage failure that is
      // nothing but the classified cut-outs restated. That one falls through to
      // the cut-out path below, where the design survives and the panel is
      // repaired -- which is what RULE 0.15 already specified and what this
      // return was silently preventing.
      if (rejection && !coverageFailedOnClassifiedCutoutsOnly(rejection, review, deterministic)) {
        return {
          accepted: false, code: "atlas_master_qc_semantic_failed",
          reason: rejection.reason, review, deterministic,
        };
      }
      const cutoutSurfaces = [...new Set(
        deterministic.cutoutFindings.map((item) => String(item.surfaceKey)),
      )].sort();
      const semanticCutout = cutoutContractFailed(review);
      const findings = deterministic.cutoutFindings.map((item) => String(item.finding));
      if (semanticCutout) findings.push("fullBleedNoCutoutsContract did not pass the design review");
      const metadata = {
        contract: MASTER_QC_CONTRACT,
        model: result?.model || model,
        keyFingerprint: result?.keyFingerprint || null,
        confidence: review.confidence,
        masterHash,
        guideHash,
        requestByteSize,
      };
      // The design is sound either way. `accepted` still means spotless, so the
      // authoring loop keeps re-rolling for a clean sheet -- but a cut-out
      // result now carries its full QC record, so the exhausted case can keep
      // the design and flag the panels instead of destroying the run.
      // `!rejection` is belt-and-braces: the only rejection that reaches here
      // requires classified cut-outs, so `cutoutSurfaces` is already non-empty
      // and this branch is unreachable with one. Stating it means a future edit
      // to the escape condition cannot turn a refused master into an accepted
      // one without failing this read.
      if (!rejection && !cutoutSurfaces.length && !semanticCutout) {
        return { accepted: true, review, deterministic, metadata };
      }
      return {
        accepted: false,
        code: "atlas_master_qc_cutouts_present",
        reason: findings.join("; ").slice(0, 800),
        cutout: { surfaces: cutoutSurfaces, findings, semantic: semanticCutout },
        review,
        deterministic,
        metadata,
      };
    } catch (cause) {
      return {
        accepted: false,
        code: cause instanceof AtlasMasterQcError ? cause.code : "atlas_master_qc_analyzer_failed",
        reason: cleanText(cause?.message || cause, 800),
      };
    }
  };
}

module.exports = {
  AtlasMasterQcError,
  MASTER_QC_CONTRACT,
  MAX_PASSENGER_MIRROR_MAE,
  PASSENGER_MIRROR_TRIM_FRACTION,
  createAtlasMasterValidator,
  deterministicMasterChecks,
  masterQcPrompt,
  parseMasterQcResponse,
  // Exported so the deterministic cut-out fill closes EXACTLY what this gate
  // convicts. Two definitions of "hole" would let the fill miss a shape the
  // detector flagged, or erase artwork it never objected to.
  CUTOUT_ALPHA_MAX,
  FLAT_BLACK_CHANNEL_MAX,
  MIN_CUTOUT_COMPONENT_RATIO,
  _test: {
    DEFAULT_CONFIDENCE_THRESHOLD,
    MIN_ZONE_EDGE_OPAQUE_RATIO,
    MIN_ZONE_LUMA_STDDEV,
    MIN_ZONE_OPAQUE_RATIO,
    MAX_ZONE_CUTOUT_COMPONENT_RATIO,
    MAX_ZONE_FLAT_BLACK_RATIO,
    MIN_CUTOUT_COMPONENT_RATIO,
    CUTOUT_BRIGHT_MAJORITY,
    RESPONSE_FIELDS,
    STATUS,
    boundedTransport,
    expectedBrandStrings,
    passengerMirrorMae,
    rejectionFor,
    responseSchema,
    sha256,
    zonePixelMetrics,
  },
};
