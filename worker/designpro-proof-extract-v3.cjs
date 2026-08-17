"use strict";

/**
 * DesignPro Call 7 -> Call 8 production adapter.
 *
 * Call 7 is the last pixel-authoring boundary. It freezes, for every manifest
 * side, the visible proof region, a GENIE-sized branded master with 5-inch
 * bleed, and the clean/logo assets separated from that same master. Call 8 is
 * deliberately a byte registrar: it re-fingerprints and promotes each frozen
 * branded master without cropping, resizing, mirroring, healing, judging, or
 * invoking any model. Durable human PanelPro QC remains a later workflow gate.
 */
const DRIVER_SIDE = "DRIVER SIDE";
const PASSENGER_SIDE = "PASSENGER SIDE";
const SURFACE_CONTRACT = "call7-proof-region-v1";
const TRANSFORM_CONTRACT = "call7-proof-region-transform.v1";
const TRANSFORM_MODE = "contain-mirror-fill-at-call7";
const CALL8_QC_CONTRACT = "call8-deterministic-source-integrity.v1";
const FULL_SOURCE_BOX = Object.freeze([0, 0, 1000, 1000]);
const BLEED_IN = 5;
const STRONG_SOURCE_VALIDATORS = new Set([
  "object-version",
  "x-goog-generation",
  "x-amz-version-id",
  "x-ms-version-id",
  "etag",
]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

/**
 * The Call 7 separation failures that mean "this side's lift produced nothing
 * usable" — the anti-smear ring gate refusing a design whose branding blends
 * into the artwork, a round-trip that would not rebuild the panel, a malformed
 * or incomplete overlay set. Each costs only the clean/blank panel and this
 * side's Logo Pack, so each is admissible as an explicit, reasoned gap.
 *
 * `call7_clean_asset_substituted` is deliberately NOT here. A lift that hands
 * back the branded master wearing a clean label has not failed honestly — it
 * is the one substitution the whole Call 7 contract exists to catch, and it
 * still fails the stage closed. Nor is `call7_surface_artifact_changed`: bytes
 * moving under a frozen checkpoint is a lineage break, not a separation gap.
 */
const SCOPABLE_SEPARATION_FAILURES = new Set([
  "panel_artboard_generator_failed",
  "call7_separation_unverified",
  "call7_separation_incomplete",
  "call7_overlay_artifact_missing",
  "call7_overlay_index_invalid",
  "call7_overlay_index_duplicate",
  "call7_overlay_region_invalid",
  "call7_surface_artifact_invalid",
]);

/**
 * The honest, human-readable record of a refused Call 7 separation.
 *
 * It is the only place the gap is explained, so it has to carry the actual
 * measurement the gate refused on — the erase pass's ring diff, the round-trip
 * diff — not just "separation failed". `callFn` reports the upstream envelope's
 * `qc` block in the failure details, and the upstream message already names the
 * threshold, so both are folded in here.
 */
function separationGapReason(side, error) {
  const details = plainObject(error?.details);
  const qc = plainObject(details.upstreamQc);
  const measurements = Object.entries(qc)
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([key, value]) => `${key} ${Number(value)}`)
    .sort()
    .join(", ");
  const cause =
    String(error?.message || "").trim() || `${side} Call 7 separation failed`;
  const code = String(error?.code || "call7_separation_unverified");
  return [
    `Call 7 separation gap on ${side} (${code}): ${cause}`,
    measurements ? `[qc ${measurements}]` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function sameNumber(left, right, tolerance = 0.01) {
  return (
    Number.isFinite(Number(left)) &&
    Number.isFinite(Number(right)) &&
    Math.abs(Number(left) - Number(right)) <= tolerance
  );
}

function finiteTuple(value, length) {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => Number.isFinite(Number(item)))
  );
}

function safeSide(value) {
  return String(value || "").trim().toUpperCase();
}

function sideSlug(value) {
  return safeSide(value).toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function safeAssetUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function durableSourceEvidence(key, url, value) {
  const evidence = plainObject(value);
  const sha256 = String(evidence.sha256 || "").toLowerCase();
  const bytes = Number(evidence.bytes || 0);
  const contentLength = Number(evidence.contentLength || 0);
  const validatorKind = String(evidence.validatorKind || "")
    .trim()
    .toLowerCase();
  const validator = String(evidence.validator || "").trim();
  const canonicalUrl = safeAssetUrl(url);
  if (
    !key ||
    !canonicalUrl ||
    !/^[0-9a-f]{64}$/.test(sha256) ||
    !Number.isSafeInteger(bytes) ||
    bytes <= 0 ||
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    bytes !== contentLength ||
    !STRONG_SOURCE_VALIDATORS.has(validatorKind) ||
    !validator ||
    (validatorKind === "etag" && /^W\//i.test(validator))
  ) {
    return null;
  }
  return {
    url: canonicalUrl,
    sha256,
    bytes,
    contentLength,
    validatorKind,
    validator,
  };
}

function createDesignProProofExtractV3(deps) {
  const {
    StageFailure,
    adapterVersion,
    toolContracts,
    panelBuildPool,
    loadContext,
    stageOutput,
    parseObject,
    fingerprintFrozenSources,
    assertFrozenFingerprints,
    stampedDimensions,
    assertProofDimensions,
    callFn,
    mapBounded,
    fingerprintMap,
    sha256,
  } = deps;

  const fail = (
    code,
    message,
    details = {},
    retryable = false,
    retryDelaySeconds = 0,
  ) => {
    throw new StageFailure(
      code,
      message,
      retryable,
      retryDelaySeconds,
      details,
    );
  };

  function expectedManifestSides(manifest) {
    const submitted = Array.isArray(manifest?.expectedSides)
      ? manifest.expectedSides
      : [];
    const sides = submitted.map(safeSide);
    if (
      !sides.length ||
      sides.some((side) => !side) ||
      new Set(sides).size !== sides.length
    ) {
      fail(
        "surface_manifest_invalid",
        "The frozen manifest has no exact, unique production-side set",
      );
    }
    return sides.sort((left, right) => left.localeCompare(right));
  }

  function canonicalArtifact(value, label) {
    const artifact = plainObject(value);
    const url = safeAssetUrl(artifact.url);
    const artifactSha256 = String(artifact.sha256 || "").toLowerCase();
    const bytes = Number(artifact.bytes || 0);
    if (
      !url ||
      !/^[0-9a-f]{64}$/.test(artifactSha256) ||
      !Number.isSafeInteger(bytes) ||
      bytes <= 0
    ) {
      fail(
        "call7_surface_artifact_invalid",
        `${label} is not a frozen byte-addressed Call 7 artifact`,
        { label },
      );
    }
    return { url, sha256: artifactSha256, bytes };
  }

  function artifactFromFingerprint(urlValue, evidenceValue, label) {
    const url = safeAssetUrl(urlValue);
    const evidence = plainObject(evidenceValue);
    return canonicalArtifact(
      {
        url,
        sha256: evidence.sha256,
        bytes: evidence.bytes,
      },
      label,
    );
  }

  function assertObservedArtifact(declared, observedValue, label) {
    const observed = artifactFromFingerprint(
      declared.url,
      observedValue,
      `${label} observed bytes`,
    );
    if (
      observed.sha256 !== declared.sha256 ||
      observed.bytes !== declared.bytes
    ) {
      fail(
        "call7_surface_artifact_changed",
        `${label} changed after the Call 7 checkpoint`,
        {
          label,
          expectedSha256: declared.sha256,
          observedSha256: observed.sha256,
          expectedBytes: declared.bytes,
          observedBytes: observed.bytes,
        },
      );
    }
    return observed;
  }

  function normalizedBox(value, label) {
    if (!finiteTuple(value, 4)) {
      fail(
        "call7_surface_region_invalid",
        `${label} has no four-coordinate normalized box`,
        { label, box: value || null },
      );
    }
    const box = value.map(Number);
    if (
      box.some((item) => item < 0 || item > 1000) ||
      box[2] <= box[0] ||
      box[3] <= box[1]
    ) {
      fail(
        "call7_surface_region_invalid",
        `${label} has an invalid normalized [ymin,xmin,ymax,xmax] box`,
        { label, box },
      );
    }
    return box;
  }

  function liftedOverlayBox(value, label) {
    if (!finiteTuple(value, 4)) {
      fail(
        "call7_overlay_region_invalid",
        `${label} has no lift-overlays [x,y,w,h] box`,
      );
    }
    const [x, y, width, height] = value.map(Number);
    if (
      x < 0 ||
      y < 0 ||
      width <= 0 ||
      height <= 0 ||
      x > 1 ||
      y > 1 ||
      width > 1 ||
      height > 1 ||
      x + width > 1.000001 ||
      y + height > 1.000001
    ) {
      fail(
        "call7_overlay_region_invalid",
        `${label} is outside its frozen branded master`,
        { box: value },
      );
    }
    const round = (number) => Math.round(number * 1_000_000) / 1_000_000;
    // Preserve panel-artboard-generator's production placement contract:
    // [x,y,width,height], normalized 0..1. Proof regions use a different
    // [ymin,xmin,ymax,xmax] 0..1000 contract and must never be conflated.
    return [round(x), round(y), round(width), round(height)];
  }

  function canonicalTransformReceipt(value, brandedSha256, side) {
    const raw = plainObject(value);
    const receipt = {
      contract: String(raw.contract || ""),
      sourceSha256: String(raw.sourceSha256 || "").toLowerCase(),
      outputSha256: String(raw.outputSha256 || "").toLowerCase(),
      scaleMode: String(raw.scaleMode || ""),
      cropBox: finiteTuple(raw.cropBox, 4)
        ? raw.cropBox.map(Number)
        : null,
      stretched: raw.stretched,
      rotationDeg: Number(raw.rotationDeg),
      truncated: raw.truncated,
    };
    if (
      receipt.contract !== TRANSFORM_CONTRACT ||
      !/^[0-9a-f]{64}$/.test(receipt.sourceSha256) ||
      receipt.outputSha256 !== brandedSha256 ||
      receipt.scaleMode !== TRANSFORM_MODE ||
      JSON.stringify(receipt.cropBox) !== JSON.stringify(FULL_SOURCE_BOX) ||
      receipt.stretched !== false ||
      receipt.rotationDeg !== 0 ||
      receipt.truncated !== false
    ) {
      fail(
        "call7_surface_transform_invalid",
        `${side} lacks the required no-stretch, no-rotation, no-truncation Call 7 receipt`,
        { side, receipt },
      );
    }
    return receipt;
  }

  function canonicalTileBoxes(value, expectedSides) {
    const submitted = plainObject(value);
    const bySide = new Map();
    for (const [rawSide, rawBox] of Object.entries(submitted)) {
      const side = safeSide(rawSide);
      if (!expectedSides.includes(side) || bySide.has(side)) {
        fail(
          "call7_proof_region_set_invalid",
          "Call 7 returned an unexpected or duplicate proof region",
          { side: side || null },
        );
      }
      bySide.set(side, normalizedBox(rawBox, `${side} proof region`));
    }
    if (
      bySide.size !== expectedSides.length ||
      expectedSides.some((side) => !bySide.has(side))
    ) {
      fail(
        "proof_required_surface_missing",
        "Call 7 omitted one or more required flat-proof regions",
        {
          expectedSides,
          observedSides: [...bySide.keys()].sort(),
        },
      );
    }
    const boxes = Object.fromEntries(
      expectedSides.map((side) => [side, bySide.get(side)]),
    );
    if (new Set(Object.values(boxes).map(JSON.stringify)).size !== expectedSides.length) {
      fail(
        "call7_proof_region_duplicate",
        "Two Call 7 surfaces point at the same proof region",
      );
    }
    return boxes;
  }

  function canonicalSurfaceMasters(
    value,
    expectedSides,
    manifest,
    tileBoxes,
  ) {
    const submitted = Array.isArray(value) ? value : [];
    const bySide = new Map();
    for (const rawValue of submitted) {
      const raw = plainObject(rawValue);
      const side = safeSide(raw.side);
      if (!expectedSides.includes(side) || bySide.has(side)) {
        fail(
          "call7_surface_master_set_invalid",
          "Call 7 returned an unexpected or duplicate surface master",
          { side: side || null },
        );
      }
      const dimensions = plainObject(manifest?.dimensions)[side];
      const trim = plainObject(raw.trim);
      const print = plainObject(raw.print);
      if (
        !dimensions ||
        Number(raw.bleedIn) !== BLEED_IN ||
        !sameNumber(trim.widthIn, dimensions.w) ||
        !sameNumber(trim.heightIn, dimensions.h) ||
        !sameNumber(print.widthIn, Number(dimensions.w) + BLEED_IN * 2) ||
        !sameNumber(print.heightIn, Number(dimensions.h) + BLEED_IN * 2)
      ) {
        fail(
          "call7_surface_geometry_invalid",
          `${side} is not the GENIE trim plus exactly 5 inches of bleed`,
          {
            side,
            expected: dimensions || null,
            trim,
            print,
            bleedIn: raw.bleedIn,
          },
        );
      }
      const brandedMaster = canonicalArtifact(
        raw.brandedMaster,
        `${side} branded master`,
      );
      const rawRegion = plainObject(raw.proofRegion);
      const proofRegion = {
        box: normalizedBox(rawRegion.box, `${side} proof region`),
        sha256: String(rawRegion.sha256 || "").toLowerCase(),
        sourceMasterSha256: String(
          rawRegion.sourceMasterSha256 || "",
        ).toLowerCase(),
      };
      if (
        !/^[0-9a-f]{64}$/.test(proofRegion.sha256) ||
        proofRegion.sourceMasterSha256 !== brandedMaster.sha256 ||
        JSON.stringify(proofRegion.box) !== JSON.stringify(tileBoxes[side])
      ) {
        fail(
          "call7_surface_lineage_invalid",
          `${side} is not bound to its own visible proof region and branded master`,
          { side, proofRegion, tileBox: tileBoxes[side] || null },
        );
      }
      const transformReceipt = canonicalTransformReceipt(
        raw.transformReceipt,
        brandedMaster.sha256,
        side,
      );
      bySide.set(side, {
        side,
        brandedMaster,
        proofRegion,
        trim: {
          widthIn: Number(trim.widthIn),
          heightIn: Number(trim.heightIn),
        },
        print: {
          widthIn: Number(print.widthIn),
          heightIn: Number(print.heightIn),
        },
        bleedIn: BLEED_IN,
        transformReceipt,
      });
    }
    if (
      bySide.size !== expectedSides.length ||
      expectedSides.some((side) => !bySide.has(side))
    ) {
      fail(
        "call7_surface_master_set_incomplete",
        "Call 7 did not freeze the exact manifest surface-master set",
        {
          expectedSides,
          observedSides: [...bySide.keys()].sort(),
        },
      );
    }
    const masters = expectedSides.map((side) => bySide.get(side));
    if (
      new Set(masters.map((master) => master.brandedMaster.url)).size !==
      masters.length
    ) {
      fail(
        "call7_surface_master_duplicate",
        "Every Call 7 surface must own a distinct branded-master object",
      );
    }
    return masters;
  }

  function canonicalSurfaceAssets(
    value,
    expectedSides,
    manifest,
    surfaceMasters,
    brandingExpected,
  ) {
    const submitted = Array.isArray(value) ? value : [];
    const masterBySide = new Map(
      surfaceMasters.map((master) => [master.side, master]),
    );
    const bySide = new Map();
    for (const rawValue of submitted) {
      const raw = plainObject(rawValue);
      const side = safeSide(raw.side);
      const master = masterBySide.get(side);
      if (
        String(raw.contract || "") !== SURFACE_CONTRACT ||
        !master ||
        bySide.has(side)
      ) {
        fail(
          "call7_surface_asset_set_invalid",
          "Call 7 returned an unexpected, duplicate, or uncontracted surface asset",
          { side: side || null, contract: raw.contract || null },
        );
      }
      const branded = canonicalArtifact(raw.branded, `${side} branded asset`);
      // The lift that produces the clean panel and the Logo Pack READS the
      // branded master; it does not produce it. A separation the anti-smear
      // gate refused is admitted here as an explicit, reasoned gap so the
      // required branded master still ships — but the gap has to be honest, so
      // `clean` is ABSENT. It is never the branded master wearing a clean
      // label, which is what `call7_clean_asset_substituted` below exists to
      // stop. `known` is still mandatory: an UNVERIFIED separation is rejected,
      // only a deliberate, explained one is admitted.
      const rawQc = plainObject(raw.separationQc);
      const separationPass = rawQc.pass === true;
      const separationReason = String(rawQc.reason || "").trim();
      if (rawQc.known !== true || (!separationPass && !separationReason)) {
        fail(
          "call7_separation_unverified",
          `${side} has no known Call 7 separation receipt`,
          { side, separationQc: rawQc },
        );
      }
      const clean = separationPass
        ? canonicalArtifact(raw.clean, `${side} clean asset`)
        : null;
      if (!separationPass && raw.clean) {
        fail(
          "call7_clean_asset_substituted",
          `${side} recorded a separation gap but still carried a clean asset`,
          { side },
        );
      }
      if (
        JSON.stringify(branded) !== JSON.stringify(master.brandedMaster)
      ) {
        fail(
          "call7_clean_asset_substituted",
          `${side} branded artwork is not paired with its own frozen master`,
          { side },
        );
      }
      const rawRegion = plainObject(raw.proofRegion);
      const proofRegion = {
        box: normalizedBox(rawRegion.box, `${side} asset proof region`),
        sha256: String(rawRegion.sha256 || "").toLowerCase(),
        sourceMasterSha256: String(
          rawRegion.sourceMasterSha256 || "",
        ).toLowerCase(),
      };
      const trim = plainObject(raw.trim);
      const print = plainObject(raw.print);
      const dimensions = plainObject(manifest?.dimensions)[side];
      const transformReceipt = canonicalTransformReceipt(
        raw.transformReceipt,
        branded.sha256,
        side,
      );
      if (
        JSON.stringify(proofRegion) !== JSON.stringify(master.proofRegion) ||
        Number(raw.bleedIn) !== BLEED_IN ||
        !sameNumber(trim.widthIn, dimensions?.w) ||
        !sameNumber(trim.heightIn, dimensions?.h) ||
        !sameNumber(print.widthIn, Number(dimensions?.w) + 10) ||
        !sameNumber(print.heightIn, Number(dimensions?.h) + 10) ||
        JSON.stringify(transformReceipt) !==
          JSON.stringify(master.transformReceipt)
      ) {
        fail(
          "call7_surface_asset_lineage_invalid",
          `${side} production assets do not preserve their surface-master lineage`,
          { side },
        );
      }
      const rawOverlays = Array.isArray(raw.overlays) ? raw.overlays : [];
      const overlays = rawOverlays
        .map((overlayValue, fallbackIndex) => {
          const overlay = plainObject(overlayValue);
          const index = Number(overlay.index);
          if (!Number.isSafeInteger(index) || index < 0) {
            fail(
              "call7_overlay_index_invalid",
              `${side} overlay ${fallbackIndex + 1} has no stable index`,
            );
          }
          const sourceRegionSha256 = String(
            overlay.sourceRegionSha256 || "",
          ).toLowerCase();
          const sourceMasterSha256 = String(
            overlay.sourceMasterSha256 || "",
          ).toLowerCase();
          if (
            sourceRegionSha256 !== proofRegion.sha256 ||
            sourceMasterSha256 !== branded.sha256
          ) {
            fail(
              "call7_overlay_lineage_invalid",
              `${side} overlay ${index} is not bound to both its display region and actual master input`,
              { side, index },
            );
          }
          const label = String(overlay.label || "").trim();
          if (!label) {
            fail(
              "call7_overlay_label_missing",
              `${side} overlay ${index} has no production label`,
            );
          }
          const rebuild = canonicalArtifact(
            overlay.rebuild,
            `${side} overlay ${index} rebuild`,
          );
          const cut = canonicalArtifact(
            overlay.cut,
            `${side} overlay ${index} cut`,
          );
          if (rebuild.url === cut.url) {
            fail(
              "call7_overlay_cut_substituted",
              `${side} overlay ${index} does not have separate soft-rebuild and hard-cut objects`,
            );
          }
          return {
            index,
            label,
            box: liftedOverlayBox(
              overlay.box,
              `${side} overlay ${index}`,
            ),
            sourceRegionSha256,
            sourceMasterSha256,
            rebuild,
            cut,
          };
        })
        .sort((left, right) => left.index - right.index);
      if (
        new Set(overlays.map((overlay) => overlay.index)).size !==
        overlays.length
      ) {
        fail(
          "call7_overlay_index_duplicate",
          `${side} contains duplicate frozen overlay indexes`,
        );
      }
      if (!separationPass && overlays.length > 0) {
        fail(
          "call7_separation_unverified",
          `${side} recorded a separation gap but still carried lifted overlays`,
          { side, overlayCount: overlays.length },
        );
      }
      if (
        overlays.length > 0 &&
        (branded.url === clean.url || branded.sha256 === clean.sha256)
      ) {
        fail(
          "call7_clean_asset_substituted",
          `${side} has lifted branding but no distinct frozen clean artwork`,
          { side },
        );
      }
      bySide.set(side, {
        contract: SURFACE_CONTRACT,
        side,
        branded,
        clean,
        proofRegion,
        trim: {
          widthIn: Number(trim.widthIn),
          heightIn: Number(trim.heightIn),
        },
        print: {
          widthIn: Number(print.widthIn),
          heightIn: Number(print.heightIn),
        },
        bleedIn: BLEED_IN,
        transformReceipt,
        overlays,
        separationQc: {
          known: true,
          pass: separationPass,
          reason: separationReason || "Call 7 separation passed",
        },
      });
    }
    if (
      bySide.size !== expectedSides.length ||
      expectedSides.some((side) => !bySide.has(side))
    ) {
      fail(
        "call7_surface_asset_set_incomplete",
        "Call 7 did not freeze the exact manifest production-asset set",
        {
          expectedSides,
          observedSides: [...bySide.keys()].sort(),
        },
      );
    }
    const surfaces = expectedSides.map((side) => bySide.get(side));
    // An empty Logo Pack on a branded design is only a contradiction when every
    // separation actually RAN and reported no branding. Where a side carries a
    // reasoned gap, the missing cut assets are already explained by that gap,
    // and the branded masters — the deliverable — still ship.
    const separationGapSides = surfaces
      .filter((surface) => surface.separationQc.pass !== true)
      .map((surface) => surface.side);
    if (
      brandingExpected &&
      separationGapSides.length === 0 &&
      surfaces.every((surface) => surface.overlays.length === 0)
    ) {
      fail(
        "call7_branding_assets_missing",
        "The branded design produced no verified hard-cut Call 7 asset on any surface",
        { expectedSides },
      );
    }
    return surfaces;
  }

  function tileBoxesHash(tileBoxes) {
    return sha256({ contract: SURFACE_CONTRACT, boxes: tileBoxes });
  }

  function surfaceMastersHash(surfaceMasters) {
    return sha256({
      contract: SURFACE_CONTRACT,
      surfaces: surfaceMasters,
    });
  }

  function surfaceAssetsHash(surfaceAssets) {
    return sha256({
      contract: SURFACE_CONTRACT,
      surfaces: surfaceAssets,
    });
  }

  function snapshotBrandingExpected(value) {
    const snapshot = plainObject(value);
    const surfaceOptions = plainObject(snapshot.surfaceOptions);
    if (surfaceOptions.brandingExpected === true) return true;
    if (surfaceOptions.brandingExpected === false) return false;

    // Legacy revision snapshots store `proof_body_text` in bodyText, but fall
    // back to the general design/change prompt when no production lettering
    // exists. A style prompt such as "distressed wrap" is not branding and
    // must not force a logo-pack failure on an intentionally unbranded design.
    const bodyText = String(snapshot.bodyText || "").trim();
    const changePrompt = String(plainObject(snapshot.change).prompt || "").trim();
    return Boolean(bodyText && bodyText !== changePrompt);
  }

  function proofHashMaterial(value) {
    const proof = plainObject(value);
    return {
      contract: "designpro.call7-frozen-production-checkpoint.v1",
      adapterVersion: proof.adapterVersion,
      manifestHash: proof.manifestHash,
      canonicalInputHash: proof.canonicalInputHash,
      proofContract: proof.proofContract,
      proofIdempotencyContract: proof.idempotencyContract,
      proofSourceEvidenceContract: proof.sourceEvidenceContract,
      sourceEvidenceHash: proof.sourceEvidenceHash,
      proofIdempotencyKeyHash: proof.idempotencyKeyHash,
      proofIdempotencyMaterialHash: proof.idempotencyMaterialHash,
      call7InvocationCount: proof.call7InvocationCount,
      brandingExpected: proof.brandingExpected === true,
      proof: {
        url: proof.url,
        sha256: proof.sha256,
        bytes: proof.bytes,
      },
      tileBoxes: proof.tileBoxes,
      tileBoxesHash: proof.tileBoxesHash,
      surfaceMasters: proof.surfaceMasters,
      surfaceMastersHash: proof.surfaceMastersHash,
      surfaceAssetsContract: proof.surfaceAssetsContract,
      surfaceAssets: proof.surfaceAssets,
      surfaceAssetsHash: proof.surfaceAssetsHash,
    };
  }

  function buildLogEntry(
    buildLog,
    side,
    status,
    startedAt,
    reason = "",
  ) {
    buildLog.push({
      side,
      candidate: 0,
      method: SURFACE_CONTRACT,
      status,
      reason,
      durationMs: Date.now() - startedAt,
    });
  }

  async function buildProof(db, stage, runId) {
    const startedAt = Date.now();
    const { pack, revision } = await loadContext(db, runId);
    const frozen = await stageOutput(db, runId, "revision.freeze");
    const manifest = await stageOutput(db, runId, "manifest.resolve");
    const snapshot = parseObject(frozen.snapshot);
    const vehicle = parseObject(snapshot.vehicle);
    const expectedSides = expectedManifestSides(manifest);
    const surfacesByKey = new Map(
      (Array.isArray(manifest.surfaces) ? manifest.surfaces : [])
        .filter((surface) => surface?.key)
        .map((surface) => [safeSide(surface.key), surface]),
    );
    const missingSourceSides = expectedSides.filter((side) => {
      const sourceViewKey = String(
        surfacesByKey.get(side)?.sourceViewKey || "",
      );
      return !sourceViewKey || !frozen.renderUrls?.[sourceViewKey];
    });
    if (missingSourceSides.length) {
      fail(
        "proof_source_view_missing",
        `The frozen 3D view set is incomplete: ${missingSourceSides.join(", ")}`,
        { missingSides: missingSourceSides },
      );
    }
    const designAnchorViewKey = String(
      surfacesByKey.get(DRIVER_SIDE)?.sourceViewKey || "",
    );
    if (!designAnchorViewKey || !frozen.renderUrls?.[designAnchorViewKey]) {
      fail(
        "proof_design_anchor_missing",
        "Call 7 requires the frozen DRIVER SIDE view as the shared design anchor",
      );
    }
    const requiredViewKeys = [
      ...new Set(
        expectedSides.map((side) =>
          String(surfacesByKey.get(side)?.sourceViewKey || ""),
        ),
      ),
    ]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));
    const proofViewUrls = Object.fromEntries(
      requiredViewKeys.map((key) => [key, frozen.renderUrls[key]]),
    );
    const expectedProofSourceFingerprints = Object.fromEntries(
      requiredViewKeys.map((key) => [
        key,
        frozen.sourceFingerprints?.[key],
      ]),
    );
    const observedFrozenSources = await fingerprintFrozenSources(
      proofViewUrls,
      expectedProofSourceFingerprints,
    );
    assertFrozenFingerprints(
      expectedProofSourceFingerprints,
      observedFrozenSources,
      "revision_material_changed",
      "A frozen approved render changed before Call 7 proof generation",
    );
    const sourceEvidenceViews = {};
    const unavailableEvidence = [];
    for (const key of requiredViewKeys) {
      const evidence = durableSourceEvidence(
        key,
        proofViewUrls[key],
        observedFrozenSources[key],
      );
      if (!evidence) unavailableEvidence.push(key);
      else sourceEvidenceViews[key] = evidence;
    }
    if (unavailableEvidence.length) {
      fail(
        "proof_source_evidence_unavailable",
        "Durable Call 7 requires strong source validators and exact content lengths",
        { unavailableViewKeys: unavailableEvidence },
        true,
        30,
      );
    }
    const sourceEvidence = {
      contract: toolContracts.proofSourceEvidence,
      requiredViewKeys,
      views: sourceEvidenceViews,
    };
    const sourceEvidenceHash = sha256(sourceEvidence);
    const logicalProofKey = sha256({
      workflowType: "designpro.entice_pack",
      adapterVersion,
      revisionId: revision.id,
      manifestHash: manifest.manifestHash,
      canonicalInputHash: frozen.canonicalInputHash,
      proofContract: toolContracts.proof,
      proofIdempotencyContract: toolContracts.proofIdempotency,
      proofSourceEvidenceContract: toolContracts.proofSourceEvidence,
      sourceEvidenceHash,
      expectedSurfaceSides: expectedSides,
      designAnchorViewKey,
    });
    const common = {
      allViewUrls: proofViewUrls,
      expectedSurfaceSides: expectedSides,
      designAnchorViewKey,
      vehicleYear: String(vehicle.year || ""),
      vehicleMake: String(vehicle.make || ""),
      vehicleModel: String(vehicle.model || ""),
      vehicleType: manifest.vehicle?.type || "standard",
      bodyText: String(snapshot.bodyText || ""),
      designName:
        String(snapshot.change?.prompt || "") || "DesignPro Revision",
      finish: String(snapshot.finish || "gloss"),
      dimensions: stampedDimensions(manifest.dimensions || {}),
      dimensionsFrozen: true,
      manifestHash: manifest.manifestHash,
      designiqGenerationId: frozen.visualizationId,
      userId: pack.user_id,
      workflowRunId: runId,
      enticePackId: pack.id,
      artifactAttemptId: stage.lease_token,
      idempotencyKey: logicalProofKey,
      sourceEvidence,
      deferArtboards: true,
      persistCanonical: false,
    };

    // One and only one Call 7 proof-generation request. The response must
    // already contain every frozen surface master; there is no later authoring
    // request to repair an incomplete proof.
    const proofResponse = await callFn(
      "generate-2d-proof",
      common,
      540_000,
    );
    const expectedIdempotencyKeyHash = sha256(logicalProofKey);
    const observedArtifactAttemptId = String(
      proofResponse?.artifactAttemptId || "",
    );
    const observedIdempotencyContract = String(
      proofResponse?.idempotencyContract || "",
    );
    const observedIdempotencyKeyHash = String(
      proofResponse?.idempotencyKeyHash || "",
    ).toLowerCase();
    const observedIdempotencyMaterialHash = String(
      proofResponse?.idempotencyMaterialHash || "",
    ).toLowerCase();
    const observedSourceEvidenceContract = String(
      proofResponse?.sourceEvidenceContract || "",
    );
    const observedSourceEvidenceHash = String(
      proofResponse?.sourceEvidenceHash || "",
    ).toLowerCase();
    if (
      observedIdempotencyContract !== toolContracts.proofIdempotency ||
      observedArtifactAttemptId !== stage.lease_token ||
      observedIdempotencyKeyHash !== expectedIdempotencyKeyHash ||
      !/^[0-9a-f]{64}$/.test(observedIdempotencyMaterialHash)
    ) {
      fail(
        "proof_idempotency_handshake_invalid",
        "Call 7 did not attest to the requested immutable proof identity",
        {
          expectedContract: toolContracts.proofIdempotency,
          observedContract: observedIdempotencyContract || null,
          expectedArtifactAttemptId: stage.lease_token,
          observedArtifactAttemptId: observedArtifactAttemptId || null,
          expectedKeyHash: expectedIdempotencyKeyHash,
          observedKeyHash: observedIdempotencyKeyHash || null,
          observedMaterialHash: observedIdempotencyMaterialHash || null,
        },
        true,
        30,
      );
    }
    if (
      observedSourceEvidenceContract !== toolContracts.proofSourceEvidence ||
      observedSourceEvidenceHash !== sourceEvidenceHash
    ) {
      fail(
        "proof_source_evidence_handshake_invalid",
        "Call 7 did not attest to the exact frozen 3D source evidence",
        {
          expectedContract: toolContracts.proofSourceEvidence,
          observedContract: observedSourceEvidenceContract || null,
          expectedHash: sourceEvidenceHash,
          observedHash: observedSourceEvidenceHash || null,
        },
        true,
        30,
      );
    }
    const proofUrl = safeAssetUrl(
      proofResponse?.proofUrl || proofResponse?.url,
    );
    if (!proofUrl) {
      fail(
        "proof_missing",
        "Call 7 returned no canonical flat 2D proof",
        {},
        true,
        30,
      );
    }
    assertProofDimensions(manifest, proofResponse?.dimensionsResolved);

    const tileBoxes = canonicalTileBoxes(
      proofResponse?.proofTileBoxes,
      expectedSides,
    );
    const surfaceMasters = canonicalSurfaceMasters(
      proofResponse?.surfaceMasters,
      expectedSides,
      manifest,
      tileBoxes,
    );
    const initialMaterial = {
      proof: proofUrl,
      ...Object.fromEntries(
        surfaceMasters.map((master) => [
          `master:${master.side}`,
          master.brandedMaster.url,
        ]),
      ),
    };
    const initialFingerprints = await fingerprintMap(initialMaterial);
    const proofArtifact = artifactFromFingerprint(
      proofUrl,
      initialFingerprints.proof,
      "Call 7 flat proof",
    );
    for (const master of surfaceMasters) {
      assertObservedArtifact(
        master.brandedMaster,
        initialFingerprints[`master:${master.side}`],
        `${master.side} branded master`,
      );
    }

    // Logo separation is part of Call 7's last authoring checkpoint. No later
    // stage may invoke this tool or create a substitute clean/cut/rebuild file.
    const brandingExpected = snapshotBrandingExpected(snapshot);
    const separated = await mapBounded(
      surfaceMasters,
      Math.max(1, Math.min(Number(panelBuildPool) || 1, 3)),
      async (master) => {
        // Call 7's lift CONSUMES the branded master; it does not produce it.
        // The master is already frozen and byte-verified above, and it is the
        // required deliverable. What the lift produces — the clean/blank panel
        // and this side's Logo Pack — is a value-add, so a lift the anti-smear
        // gate refuses (branding that blends into the artwork, an unusable
        // overlay set) must cost only those assets. It is scoped to this
        // side's separation and recorded as an explicit, reasoned gap.
        //
        // Retryable failures still raise: a timeout, a 5xx, or a lost lease is
        // an infrastructure stumble, and re-running the whole stage is the
        // correct recovery for it, not a permanently gapped Logo Pack.
        try {
          const lifted = await callFn(
            "panel-artboard-generator",
            {
              step: "liftoverlays",
              generationId: pack.id,
              jobId: `${pack.id}-${stage.lease_token}-call7-${sideSlug(master.side)}`,
              userId: pack.user_id,
              side: master.side,
              brandedUrl: master.brandedMaster.url,
              persist: false,
            },
            300_000,
          );
          const rawOverlays = Array.isArray(lifted?.overlays)
            ? lifted.overlays
            : [];
          const reportedLifted = Number(lifted?.lifted);
          if (
            Number.isSafeInteger(reportedLifted) &&
            reportedLifted !== rawOverlays.length
          ) {
            fail(
              "call7_separation_incomplete",
              `${master.side} reported an incomplete Call 7 overlay set`,
              {
                side: master.side,
                reportedLifted,
                overlayCount: rawOverlays.length,
              },
            );
          }
          const cleanUrl =
            safeAssetUrl(lifted?.cleanUrl) ||
            (rawOverlays.length === 0 ? master.brandedMaster.url : "");
          const roundTripRaw = lifted?.qc?.roundTripDiff;
          const roundTripDiff =
            rawOverlays.length === 0 ? 0 : Number(roundTripRaw);
          const separationPass =
            rawOverlays.length === 0 || lifted?.qc?.pass === true;
          if (
            !cleanUrl ||
            !separationPass ||
            (rawOverlays.length > 0 &&
              (roundTripRaw === null || roundTripRaw === undefined)) ||
            !Number.isFinite(roundTripDiff) ||
            (rawOverlays.length > 0 && lifted?.qc?.pass !== true)
          ) {
            fail(
              "call7_separation_unverified",
              `${master.side} did not return a complete, known-passing Call 7 separation`,
              {
                side: master.side,
                brandingExpected,
                cleanUrlPresent: Boolean(cleanUrl),
                overlayCount: rawOverlays.length,
                qc: lifted?.qc || null,
                reason: lifted?.reason || lifted?.error || null,
              },
            );
          }
          const overlayDrafts = rawOverlays
            .map((rawValue, fallbackIndex) => {
              const raw = plainObject(rawValue);
              const declaredIndex = Number(raw.index);
              const index = Number.isSafeInteger(declaredIndex)
                ? declaredIndex
                : fallbackIndex;
              if (index < 0) {
                fail(
                  "call7_overlay_index_invalid",
                  `${master.side} returned an invalid overlay index`,
                  { side: master.side, index },
                );
              }
              const label = String(
                raw.element_label || raw.label || raw.element_type || "",
              ).trim();
              const rebuildUrl = safeAssetUrl(raw.url);
              const cutUrl = safeAssetUrl(raw.cut_url);
              if (!label || !rebuildUrl || !cutUrl || rebuildUrl === cutUrl) {
                fail(
                  "call7_overlay_artifact_missing",
                  `${master.side} overlay ${index} lacks separate rebuild and hard-cut outputs`,
                  {
                    side: master.side,
                    index,
                    label: label || null,
                    rebuildUrlPresent: Boolean(rebuildUrl),
                    cutUrlPresent: Boolean(cutUrl),
                  },
                );
              }
              return {
                index,
                label,
                box: liftedOverlayBox(
                  raw.box,
                  `${master.side} overlay ${index}`,
                ),
                rebuildUrl,
                cutUrl,
              };
            })
            .sort((left, right) => left.index - right.index);
          if (
            new Set(overlayDrafts.map((overlay) => overlay.index)).size !==
            overlayDrafts.length
          ) {
            fail(
              "call7_overlay_index_duplicate",
              `${master.side} returned duplicate overlay indexes`,
            );
          }
          const artifactUrls = { clean: cleanUrl };
          for (const overlay of overlayDrafts) {
            artifactUrls[`overlay:${overlay.index}:rebuild`] = overlay.rebuildUrl;
            artifactUrls[`overlay:${overlay.index}:cut`] = overlay.cutUrl;
          }
          const observed = await fingerprintMap(artifactUrls);
          const clean = artifactFromFingerprint(
            cleanUrl,
            observed.clean,
            `${master.side} clean asset`,
          );
          if (
            overlayDrafts.length > 0 &&
            (clean.url === master.brandedMaster.url ||
              clean.sha256 === master.brandedMaster.sha256)
          ) {
            fail(
              "call7_clean_asset_substituted",
              `${master.side} separation reused the branded master as its clean asset`,
              { side: master.side },
            );
          }
          const overlays = overlayDrafts.map((overlay) => ({
            index: overlay.index,
            label: overlay.label,
            box: overlay.box,
            // The display-region pointer proves what was approved; the master
            // pointer truthfully records which bytes liftoverlays actually read.
            sourceRegionSha256: master.proofRegion.sha256,
            sourceMasterSha256: master.brandedMaster.sha256,
            rebuild: artifactFromFingerprint(
              overlay.rebuildUrl,
              observed[`overlay:${overlay.index}:rebuild`],
              `${master.side} overlay ${overlay.index} rebuild`,
            ),
            cut: artifactFromFingerprint(
              overlay.cutUrl,
              observed[`overlay:${overlay.index}:cut`],
              `${master.side} overlay ${overlay.index} cut`,
            ),
          }));
          const surfaceAsset = {
            contract: SURFACE_CONTRACT,
            side: master.side,
            branded: master.brandedMaster,
            clean,
            proofRegion: master.proofRegion,
            trim: master.trim,
            print: master.print,
            bleedIn: BLEED_IN,
            transformReceipt: master.transformReceipt,
            overlays,
            separationQc: {
              known: true,
              pass: true,
              reason:
                String(lifted?.qc?.reason || "").trim() ||
                String(lifted?.reason || "").trim() ||
                (overlays.length
                  ? `Call 7 round-trip passed (diff ${roundTripDiff})`
                  : "Call 7 detected no branding on this surface"),
            },
          };
          return { surfaceAsset, observed };
        } catch (error) {
          if (
            !(error instanceof StageFailure) ||
            error.retryable === true ||
            !SCOPABLE_SEPARATION_FAILURES.has(String(error.code || ""))
          ) {
            throw error;
          }
          return {
            surfaceAsset: {
              contract: SURFACE_CONTRACT,
              side: master.side,
              branded: master.brandedMaster,
              clean: null,
              proofRegion: master.proofRegion,
              trim: master.trim,
              print: master.print,
              bleedIn: BLEED_IN,
              transformReceipt: master.transformReceipt,
              overlays: [],
              separationQc: {
                known: true,
                pass: false,
                reason: separationGapReason(master.side, error),
              },
            },
            observed: {},
          };
        }
      },
    );
    // PASSENGER SIDE is not separately authored downstream: it is a
    // deterministic mirror of the DRIVER panel with the DRIVER's lifted logos
    // re-dropped UN-FLIPPED so the lettering reads forward. With the driver
    // separation gapped there is nothing to re-drop, and the passenger panel
    // would ship mirrored — backwards — lettering. So a driver gap is a
    // passenger gap, whatever the passenger's own lift happened to return; its
    // own lifted overlays came off a master whose lettering is unreliable and
    // are worse than absent.
    const driverGap = separated.find(
      (entry) =>
        entry.surfaceAsset.side === DRIVER_SIDE &&
        entry.surfaceAsset.separationQc.pass !== true,
    );
    if (driverGap) {
      for (const entry of separated) {
        if (
          entry.surfaceAsset.side !== PASSENGER_SIDE ||
          entry.surfaceAsset.separationQc.pass !== true
        ) {
          continue;
        }
        entry.surfaceAsset = {
          ...entry.surfaceAsset,
          clean: null,
          overlays: [],
          separationQc: {
            known: true,
            pass: false,
            reason:
              `${PASSENGER_SIDE} mirrors ${DRIVER_SIDE} and re-drops its lifted ` +
              `logos un-flipped, so without them this panel ships backwards ` +
              `lettering. ${driverGap.surfaceAsset.separationQc.reason}`,
          },
        };
        entry.observed = {};
      }
    }
    const surfaceAssets = canonicalSurfaceAssets(
      separated.map((entry) => entry.surfaceAsset),
      expectedSides,
      manifest,
      surfaceMasters,
      brandingExpected,
    );
    const fingerprints = { ...initialFingerprints };
    for (const entry of separated) {
      const side = entry.surfaceAsset.side;
      // A gapped side has no clean panel, so it contributes no clean evidence.
      if (entry.observed.clean) {
        fingerprints[`clean:${side}`] = entry.observed.clean;
      }
      for (const overlay of entry.surfaceAsset.overlays) {
        fingerprints[`overlay:${side}:${overlay.index}:rebuild`] =
          entry.observed[`overlay:${overlay.index}:rebuild`];
        fingerprints[`overlay:${side}:${overlay.index}:cut`] =
          entry.observed[`overlay:${overlay.index}:cut`];
      }
    }
    const canonicalTileBoxesHash = tileBoxesHash(tileBoxes);
    const canonicalSurfaceMastersHash = surfaceMastersHash(surfaceMasters);
    const canonicalSurfaceAssetsHash = surfaceAssetsHash(surfaceAssets);
    const output = {
      url: proofArtifact.url,
      sha256: proofArtifact.sha256,
      bytes: proofArtifact.bytes,
      cleanProofUrl: null,
      cleanArtboardUrl: null,
      brandedArtboardUrl: null,
      dimensionsResolved: proofResponse?.dimensionsResolved || null,
      tileBoxes,
      tileBoxesHash: canonicalTileBoxesHash,
      surfaceMasters,
      surfaceMastersHash: canonicalSurfaceMastersHash,
      surfaceAssetsContract: SURFACE_CONTRACT,
      surfaceAssets,
      surfaceAssetsHash: canonicalSurfaceAssetsHash,
      // Call 7 sanity-gate verdicts for the shipped candidates (mirrored-twin
      // and edge-truncation checks inside generate-2d-proof). Additive and
      // deliberately OUTSIDE proofHashMaterial: null on idempotent reuse, and
      // it must not perturb the frozen checkpoint identity. Call 8 folds it
      // into each panel's qc so it reaches meta_metrics.qc in the vault.
      call7Sanity: plainObject(proofResponse?.call7Sanity),
      brandingExpected,
      fingerprints,
      adapterVersion,
      manifestHash: manifest.manifestHash,
      canonicalInputHash: frozen.canonicalInputHash,
      proofContract: toolContracts.proof,
      artifactAttemptId: observedArtifactAttemptId,
      idempotencyKey: logicalProofKey,
      idempotencyContract: observedIdempotencyContract,
      idempotencyKeyHash: observedIdempotencyKeyHash,
      idempotencyMaterialHash: observedIdempotencyMaterialHash,
      sourceEvidenceContract: observedSourceEvidenceContract,
      sourceEvidenceHash: observedSourceEvidenceHash,
      call7InvocationCount: 1,
      // Preserved only for the existing database envelope during cutover.
      call8InvocationCount: 1,
      call7PixelAuthoringComplete: true,
      postCall7PixelAuthoringAllowed: false,
      timing: { totalMs: Date.now() - startedAt },
    };
    output.proofHash = sha256(proofHashMaterial(output));
    return {
      output,
      verification: {
        verified: true,
        kind: "call7_frozen_production_checkpoint",
        adapterVersion,
        artifactAttemptId: observedArtifactAttemptId,
        idempotencyKey: logicalProofKey,
        idempotencyContract: observedIdempotencyContract,
        idempotencyKeyHash: observedIdempotencyKeyHash,
        idempotencyMaterialHash: observedIdempotencyMaterialHash,
        idempotencyHandshakeVerified: true,
        sourceEvidenceContract: observedSourceEvidenceContract,
        sourceEvidenceHash: observedSourceEvidenceHash,
        sourceEvidenceHandshakeVerified: true,
        normalCall7Only: true,
        call7InvocationCount: 1,
        exactSurfaceSet: true,
        dimensionsMatchManifest: true,
        mastersBytesVerified: true,
        surfaceSeparationKnownPassing: surfaceAssets.every(
          (surface) => surface.separationQc.pass === true,
        ),
        separationGapSides: surfaceAssets
          .filter((surface) => surface.separationQc.pass !== true)
          .map((surface) => surface.side),
        surfaceAssetsHash: canonicalSurfaceAssetsHash,
        postCall7PixelAuthoringAllowed: false,
      },
      outputHash: output.proofHash,
    };
  }

  async function buildPanels(db, stage, runId) {
    const buildStarted = Date.now();
    const { pack } = await loadContext(db, runId);
    const frozen = await stageOutput(db, runId, "revision.freeze");
    const manifest = await stageOutput(db, runId, "manifest.resolve");
    const proof = await stageOutput(db, runId, "proof.build");
    const expectedSides = expectedManifestSides(manifest);
    if (
      proof.adapterVersion !== adapterVersion ||
      proof.manifestHash !== manifest.manifestHash ||
      proof.canonicalInputHash !== frozen.canonicalInputHash ||
      Number(proof.call7InvocationCount) !== 1
    ) {
      fail(
        "proof_checkpoint_identity_invalid",
        "Call 8 requires a fresh, single-invocation Call 7 checkpoint for this exact revision and manifest",
        {
          expectedAdapterVersion: adapterVersion,
          observedAdapterVersion: proof.adapterVersion || null,
          expectedManifestHash: manifest.manifestHash,
          observedManifestHash: proof.manifestHash || null,
          call7InvocationCount: proof.call7InvocationCount ?? null,
        },
      );
    }
    const tileBoxes = canonicalTileBoxes(proof.tileBoxes, expectedSides);
    const surfaceMasters = canonicalSurfaceMasters(
      proof.surfaceMasters,
      expectedSides,
      manifest,
      tileBoxes,
    );
    const brandingExpected = snapshotBrandingExpected(frozen.snapshot);
    if (String(proof.surfaceAssetsContract || "") !== SURFACE_CONTRACT) {
      fail(
        "call7_surface_contract_invalid",
        `Call 8 accepts only ${SURFACE_CONTRACT}`,
      );
    }
    const surfaceAssets = canonicalSurfaceAssets(
      proof.surfaceAssets,
      expectedSides,
      manifest,
      surfaceMasters,
      brandingExpected,
    );
    const expectedTileBoxesHash = tileBoxesHash(tileBoxes);
    const expectedSurfaceMastersHash = surfaceMastersHash(surfaceMasters);
    const expectedSurfaceAssetsHash = surfaceAssetsHash(surfaceAssets);
    if (
      String(proof.tileBoxesHash || "").toLowerCase() !==
        expectedTileBoxesHash ||
      String(proof.surfaceMastersHash || "").toLowerCase() !==
        expectedSurfaceMastersHash ||
      String(proof.surfaceAssetsHash || "").toLowerCase() !==
        expectedSurfaceAssetsHash
    ) {
      fail(
        "call7_checkpoint_hash_invalid",
        "Call 8 rejected a Call 7 region, master, or surface-asset registry whose canonical hash changed",
        {
          expectedTileBoxesHash,
          observedTileBoxesHash: proof.tileBoxesHash || null,
          expectedSurfaceMastersHash,
          observedSurfaceMastersHash: proof.surfaceMastersHash || null,
          expectedSurfaceAssetsHash,
          observedSurfaceAssetsHash: proof.surfaceAssetsHash || null,
        },
      );
    }
    const expectedProofHash = sha256(
      proofHashMaterial({
        ...proof,
        tileBoxes,
        surfaceMasters,
        surfaceAssets,
      }),
    );
    if (String(proof.proofHash || "").toLowerCase() !== expectedProofHash) {
      fail(
        "call7_proof_hash_invalid",
        "Call 8 rejected a Call 7 checkpoint whose proof-bound production registry changed",
        {
          expectedProofHash,
          observedProofHash: proof.proofHash || null,
        },
      );
    }

    // This is the complete Call 8 material operation: byte fingerprints only.
    // There is no cropper, image model, resize, mirror, or fallback invocation.
    const observed = await fingerprintMap({
      proof: proof.url,
      ...Object.fromEntries(
        surfaceMasters.map((master) => [
          `master:${master.side}`,
          master.brandedMaster.url,
        ]),
      ),
    });
    assertObservedArtifact(
      canonicalArtifact(proof, "Call 7 flat proof"),
      observed.proof,
      "Call 7 flat proof",
    );
    for (const master of surfaceMasters) {
      assertObservedArtifact(
        master.brandedMaster,
        observed[`master:${master.side}`],
        `${master.side} branded master`,
      );
    }

    const buildLog = [];
    const panels = await mapBounded(
      surfaceMasters,
      Math.max(1, Number(panelBuildPool) || 1),
      async (master) => {
        const startedAt = Date.now();
        const masterEvidence = artifactFromFingerprint(
          master.brandedMaster.url,
          observed[`master:${master.side}`],
          `${master.side} branded master`,
        );
        // Call 8 QC records only facts already established above from the
        // frozen bytes, canonical hashes, and validated GENIE geometry. It is
        // not PanelPro approval; durable human PanelPro QC remains downstream.
        //
        // `call7Sanity` is the sanity-gate verdict recorded for THIS side's
        // shipped candidate at authoring time (mirrored-twin + edge-truncation
        // checks). Carried inside qc so save-production-panels lands it in
        // meta_metrics.qc, next to the reason string — a refusal never reaches
        // here (Call 7 refuses with call7_sanity_refused), so what shows up is
        // pass/known provenance, legible per row exactly like separation_qc.
        const sideSanity = plainObject(
          plainObject(proof.call7Sanity).sides,
        )[master.side];
        const qc = {
          contract: CALL8_QC_CONTRACT,
          kind: "deterministic-source-integrity",
          known: true,
          pass: true,
          aiUsed: false,
          sourceIntegrityVerified: true,
          awaitingDurablePanelProHumanQc: true,
          ...(sideSanity && typeof sideSanity === "object"
            ? {
                call7Sanity: {
                  known: sideSanity.known === true,
                  pass: sideSanity.pass !== false,
                  candidates: Number(sideSanity.candidates) || null,
                  reason: String(sideSanity.reason || ""),
                },
              }
            : {}),
          reason:
            "Frozen Call 7 bytes, hashes, and geometry verified; awaiting durable PanelPro human QC" +
            (sideSanity && typeof sideSanity === "object"
              ? `. Call 7 sanity gate: ${
                sideSanity.known === true
                  ? (sideSanity.pass !== false ? "pass" : "REFUSED")
                  : "unavailable (passed open)"
              }${Number(sideSanity.candidates) > 1 ? ` after ${Number(sideSanity.candidates)} candidates` : ""}`
              : ""),
        };
        buildLogEntry(buildLog, master.side, "pass", startedAt);
        return {
          side: master.side,
          brandedUrl: masterEvidence.url,
          brandedSha256: masterEvidence.sha256,
          brandedBytes: masterEvidence.bytes,
          extractionBaseUrl: masterEvidence.url,
          extractionBaseSha256: masterEvidence.sha256,
          extractionBaseBytes: masterEvidence.bytes,
          sourceReferenceUrl: masterEvidence.url,
          sourceReferenceSha256: masterEvidence.sha256,
          sourceReferenceBytes: masterEvidence.bytes,
          sourceReferenceKind: "call7-branded-master",
          sourceProofHash: proof.proofHash,
          sourceProofSha256: String(proof.sha256 || "").toLowerCase(),
          sourceProofBytes: Number(proof.bytes || 0),
          sourceRegionBox: master.proofRegion.box,
          sourceRegionSha256: master.proofRegion.sha256,
          sourceMasterSha256: master.brandedMaster.sha256,
          sourceMasterBytes: master.brandedMaster.bytes,
          sourceRawSha256: master.transformReceipt.sourceSha256,
          proofRegion: master.proofRegion,
          transformReceipt: master.transformReceipt,
          widthIn: master.trim.widthIn,
          heightIn: master.trim.heightIn,
          printWidthIn: master.print.widthIn,
          printHeightIn: master.print.heightIn,
          bleedIn: BLEED_IN,
          method: SURFACE_CONTRACT,
          rung: 0,
          deterministic: true,
          baseDeterministic: true,
          derivationDeterministic: true,
          overlayLiftApplied: false,
          mirrorTransformApplied: false,
          finishDeterministic: true,
          promotedWithoutTransform: true,
          call8PixelOperations: 0,
          productionEligible: true,
          qc,
          fingerprints: { branded: observed[`master:${master.side}`] },
          builtMs: Date.now() - startedAt,
        };
      },
    );
    const panelHash = sha256({
      contract: SURFACE_CONTRACT,
      adapterVersion,
      manifestHash: manifest.manifestHash,
      proofHash: proof.proofHash,
      surfaceMastersHash: expectedSurfaceMastersHash,
      surfaceAssetsHash: expectedSurfaceAssetsHash,
      panels: panels.map((panel) => ({
        side: panel.side,
        branded: {
          url: panel.brandedUrl,
          sha256: panel.brandedSha256,
          bytes: panel.brandedBytes,
        },
        sourceRegionBox: panel.sourceRegionBox,
        sourceRegionSha256: panel.sourceRegionSha256,
        sourceMasterSha256: panel.sourceMasterSha256,
        transformReceipt: panel.transformReceipt,
        trim: { widthIn: panel.widthIn, heightIn: panel.heightIn },
        print: {
          widthIn: panel.printWidthIn,
          heightIn: panel.printHeightIn,
        },
        bleedIn: panel.bleedIn,
        method: panel.method,
        overlayLiftApplied: panel.overlayLiftApplied,
        mirrorTransformApplied: panel.mirrorTransformApplied,
        promotedWithoutTransform: panel.promotedWithoutTransform,
        call8PixelOperations: panel.call8PixelOperations,
        qc: {
          contract: panel.qc.contract,
          kind: panel.qc.kind,
          known: panel.qc.known,
          pass: panel.qc.pass,
          aiUsed: panel.qc.aiUsed,
          sourceIntegrityVerified: panel.qc.sourceIntegrityVerified,
          awaitingDurablePanelProHumanQc:
            panel.qc.awaitingDurablePanelProHumanQc,
        },
      })),
      builderVersion: deps.masterSheetVersion,
      toolContracts: {
        proof: toolContracts.proof,
        proofIdempotency: toolContracts.proofIdempotency,
        proofSourceEvidence: toolContracts.proofSourceEvidence,
        proofExtract: SURFACE_CONTRACT,
        passengerMirror: "disabled-after-call7-v1",
        call8SourceIntegrityQc: CALL8_QC_CONTRACT,
      },
    });
    return {
      output: {
        panels,
        gapSides: [],
        panelHash,
        adapterVersion,
        builderVersion: deps.masterSheetVersion,
        surfaceAssetsContract: SURFACE_CONTRACT,
        surfaceAssetsHash: expectedSurfaceAssetsHash,
        buildLog,
        buildMs: Date.now() - buildStarted,
      },
      verification: {
        verified: true,
        kind: "call8_frozen_master_promotion",
        adapterVersion,
        contract: SURFACE_CONTRACT,
        exactSurfaces: panels.length === expectedSides.length,
        gapSides: [],
        surfaceCount: panels.length,
        allSourceIntegrityChecksKnownPassing: panels.every(
          (panel) =>
            panel.qc?.known === true &&
            panel.qc?.pass === true &&
            panel.qc?.aiUsed === false &&
            panel.qc?.sourceIntegrityVerified === true,
        ),
        awaitingDurablePanelProHumanQc: true,
        call8PixelOperations: 0,
        call8JudgeCalls: 0,
        call8ModelCalls: 0,
        call8PixelModelCalls: 0,
        call8CropperCalls: 0,
        call8MirrorCalls: 0,
        passengerOrigin: expectedSides.includes(PASSENGER_SIDE)
          ? "own-call7-branded-master"
          : "not-required",
        passengerDerivedFromDriver: false,
        perSideSourcesDistinct:
          new Set(panels.map((panel) => panel.brandedUrl)).size ===
          panels.length,
        allPanelBytesEqualCall7Masters: panels.every((panel) => {
          const master = surfaceMasters.find(
            (item) => item.side === panel.side,
          );
          return (
            master &&
            panel.brandedUrl === master.brandedMaster.url &&
            panel.brandedSha256 === master.brandedMaster.sha256 &&
            panel.brandedBytes === master.brandedMaster.bytes
          );
        }),
        deterministicPostProofLineage: panels.every(
          (panel) =>
            panel.method === SURFACE_CONTRACT &&
            panel.deterministic === true &&
            panel.baseDeterministic === true &&
            panel.derivationDeterministic === true &&
            panel.finishDeterministic === true &&
            panel.overlayLiftApplied === false &&
            panel.mirrorTransformApplied === false &&
            panel.promotedWithoutTransform === true &&
            panel.call8PixelOperations === 0 &&
            panel.sourceProofHash === proof.proofHash,
        ),
      },
      outputHash: panelHash,
    };
  }

  return { buildProof, buildPanels };
}

module.exports = { createDesignProProofExtractV3 };
