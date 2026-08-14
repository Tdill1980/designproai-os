export interface ProductionFlowLogoAsset {
  url?: string;
  label?: string;
  element_label?: string;
  side?: string;
}

export interface ProductionFlowAssetMeta {
  production_eligible?: boolean;
  source_hash?: string;
  source_proof_url?: string;
  pack_version?: string;
  expected_sides?: string[];
  logo_pack?: ProductionFlowLogoAsset[];
  branding_overlays?: ProductionFlowLogoAsset[];
  qc?: { known?: boolean; pass?: boolean; reason?: string };
  separation_qc?: { known?: boolean; pass?: boolean; reason?: string };
}

export interface ProductionFlowAssetRow {
  id: string;
  job_id?: string;
  side: string;
  version: string;
  dimensions_inches?: Record<string, number> | null;
  background_url?: string | null;
  branding_url?: string | null;
  depth_mask_url?: string | null;
  final_pack_url?: string | null;
  meta_metrics?: ProductionFlowAssetMeta | null;
  created_at: string;
}

export interface ProductionPanelPackState<T extends ProductionFlowAssetRow> {
  packRows: T[];
  version: string | null;
  expectedSides: string[];
  hasCompleteAtomicPack: boolean;
  /**
   * The PRINT panels are verified and orderable. Driven by each side's own QC
   * only. Logo separation deliberately does NOT gate this — see logoPackEligible.
   */
  productionEligible: boolean;
  /**
   * Every side's logos/lettering separated cleanly, so the Logo Pack add-on is
   * available. False when any side recorded an honest separation gap.
   */
  logoPackEligible: boolean;
  staleRowCount: number;
}

const ATOMIC_PACK_VERSION = /^v2:[a-f0-9]{24}$/i;
const FULL_SOURCE_HASH = /^[a-f0-9]{64}$/i;
const STANDARD_SIDES = ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"];
const TRAILER_SIDES = ["DRIVER SIDE", "PASSENGER SIDE", "FRONT", "REAR"];

const normalizeSide = (side: unknown) => String(side || "").trim().toUpperCase();
const sameSideSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((side) => b.includes(side));
const isSupportedSideSet = (sides: string[]) =>
  sameSideSet(sides, STANDARD_SIDES) || sameSideSet(sides, TRAILER_SIDES);

const isLegacyProducerUrl = (url: string | null | undefined) =>
  /\/production-flow\//.test(url || "");

/**
 * A side whose logo separation was deliberately refused has no clean panel —
 * background_url is '' and separation_qc records known:true, pass:false and a
 * non-empty reason. The three server fences were each taught this on
 * 2026-08-10 (verify_designpro_entice_pack's cleanUrl and vault comparisons,
 * stage_designpro_entice_pack_assets' background_url requirement); this
 * predicate is the same allowance at the display layer.
 */
export function hasReasonedSeparationGap(row: ProductionFlowAssetRow): boolean {
  const separation = row.meta_metrics?.separation_qc;
  return (
    separation?.known === true &&
    separation?.pass === false &&
    String(separation?.reason || "").trim().length > 0
  );
}

/**
 * A row is current only when it carries the immutable pack identity written by
 * save-production-panels. A panel-artboard URL by itself is not enough: the old
 * v1 producer used that path too and produced the RP-101054 front/rear failures.
 */
export function isAtomicPanelPackRow(row: ProductionFlowAssetRow): boolean {
  const version = String(row.version || "");
  const meta = row.meta_metrics || {};
  const hashPrefix = version.startsWith("v2:") ? version.slice(3) : "";
  const sourceHash = String(meta.source_hash || "");
  const dimensions = row.dimensions_inches || {};
  const widthIn = Number(dimensions.w ?? dimensions.width);
  const heightIn = Number(dimensions.h ?? dimensions.height);
  return (
    ATOMIC_PACK_VERSION.test(version) &&
    meta.pack_version === version &&
    FULL_SOURCE_HASH.test(sourceHash) &&
    sourceHash.slice(0, 24).toLowerCase() === hashPrefix.toLowerCase() &&
    typeof meta.source_proof_url === "string" &&
    meta.source_proof_url.length > 0 &&
    Array.isArray(meta.expected_sides) &&
    meta.expected_sides.length > 0 &&
    widthIn > 0 &&
    heightIn > 0 &&
    // The FOURTH place this exact defect lived, and the one that kept the UI
    // dark after the server was fixed. Requiring a clean layer on every side
    // meant one reasoned gap (ROOF, pack 9c737af3, 2026-08-10 — measured live:
    // six rows, every other predicate true, background_present false on ROOF
    // alone) disqualified that row, which made the pack "incomplete", which
    // rendered "No complete panel set exists" over six built panels. The
    // branded panel stays mandatory on every side — a gap can never drop the
    // deliverable the customer is owed.
    (!!row.background_url || hasReasonedSeparationGap(row)) &&
    !!row.branding_url &&
    !isLegacyProducerUrl(row.background_url) &&
    !isLegacyProducerUrl(row.branding_url)
  );
}

/**
 * Select one complete source-hashed pack. Never choose the newest row per side:
 * that can silently mix sides from different revisions, source hashes or pack
 * versions. Input rows are expected newest-first, matching the Supabase query.
 */
export function getProductionPanelPackState<T extends ProductionFlowAssetRow>(
  rows: T[],
  currentProofUrl?: string | null,
): ProductionPanelPackState<T> {
  const atomicRows = rows.filter(isAtomicPanelPackRow);
  const versions = Array.from(new Set(atomicRows.map((row) => row.version)));

  for (const version of versions) {
    const versionRows = atomicRows.filter((row) => row.version === version);
    const firstMeta = versionRows[0]?.meta_metrics || {};
    const expectedSides = Array.from(
      new Set((firstMeta.expected_sides || []).map(normalizeSide).filter(Boolean)),
    );
    const sourceHash = String(firstMeta.source_hash || "");
    const sourceProofUrl = String(firstMeta.source_proof_url || "");
    if (
      !expectedSides.length ||
      !isSupportedSideSet(expectedSides) ||
      !sourceHash ||
      !sourceProofUrl ||
      (currentProofUrl && sourceProofUrl !== currentProofUrl)
    ) continue;

    const rowsBySide = new Map<string, T>();
    let identityConsistent = true;
    for (const row of versionRows) {
      const meta = row.meta_metrics || {};
      const rowExpected = Array.from(
        new Set((meta.expected_sides || []).map(normalizeSide).filter(Boolean)),
      );
      if (
        meta.pack_version !== version ||
        meta.source_hash !== sourceHash ||
        meta.source_proof_url !== sourceProofUrl ||
        rowExpected.join("|") !== expectedSides.join("|")
      ) {
        identityConsistent = false;
        break;
      }
      const side = normalizeSide(row.side);
      if (!expectedSides.includes(side) || rowsBySide.has(side)) {
        identityConsistent = false;
        break;
      }
      rowsBySide.set(side, row);
    }
    if (
      !identityConsistent ||
      rowsBySide.size !== expectedSides.length ||
      !expectedSides.every((side) => rowsBySide.has(side))
    ) continue;

    const packRows = expectedSides.map((side) => rowsBySide.get(side)!);
    // PRINT eligibility is the panel's own QC. Logo separation used to be ANDed
    // in here, which meant one side's logo lift failing marked six verified
    // print panels "production blocked" and disabled the order button — a
    // value-add gating the deliverable. The Logo Pack has its own flag below.
    // `separation_qc.known` is still required: an UNKNOWN separation outcome is
    // not the same as a recorded, explained gap.
    const productionEligible = packRows.every((row) => {
      const meta = row.meta_metrics || {};
      return (
        meta.production_eligible === true &&
        meta.qc?.known === true &&
        meta.qc?.pass === true &&
        meta.separation_qc?.known === true
      );
    });
    const logoPackEligible = packRows.every(
      (row) => row.meta_metrics?.separation_qc?.pass === true,
    );
    return {
      packRows,
      version,
      expectedSides,
      hasCompleteAtomicPack: true,
      productionEligible,
      logoPackEligible,
      staleRowCount: Math.max(0, rows.length - packRows.length),
    };
  }

  return {
    packRows: [],
    version: null,
    expectedSides: [],
    hasCompleteAtomicPack: false,
    productionEligible: false,
    logoPackEligible: false,
    staleRowCount: rows.length,
  };
}

export function shouldAutoRebuildProductionPack(
  state: Pick<ProductionPanelPackState<ProductionFlowAssetRow>, "hasCompleteAtomicPack">,
  generationId: string | null | undefined,
  attemptedGenerationId: string | null,
): boolean {
  return (
    !!generationId &&
    !state.hasCompleteAtomicPack &&
    attemptedGenerationId !== generationId
  );
}
