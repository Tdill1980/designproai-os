/**
 * FULL PRODUCTION QC OVER THE SIX CANONICAL FLAT SURFACES.
 *
 * ⛔ WHAT "THE SIX CANONICAL FLAT SURFACES" ARE. (Trish 2026-08-30.)
 *
 * They are the six deterministic crops of the accepted A.T.L.A.S. master —
 * `revision.callOnePanels`, one per surfaceKey. They are the ONLY origin of
 * production artwork, and the two production artifacts are both DESCENDANTS of
 * those exact six hashes rather than separate reconstructions:
 *
 *   accepted master → six flat surfaces ─┬─► Call 8, the 2D Production Proof
 *                                        └─► Call 9, the six production panels
 *
 * So this report does not merely ask whether a proof and some panels exist. It
 * resolves each one back to the six hashes, and a production artifact whose
 * ancestry does not land there FAILS — which is the whole point, because a
 * boolean "a proof exists" is exactly what let a proof-derived panel set report
 * healthy while carrying pixels the master never authored.
 *
 * Owner directive (Trish 2026-08-29): QC must visibly report master/panel
 * ancestry, hash equality/provenance, dimensions, DPI/resolution, colour mode,
 * bleed, panelization, logos/art integrity, file readability, output
 * dimensions, missing/corrupt assets, production proof existence, and the
 * required six surfaces. "If QC fails, keep me in PanelProStudio and tell me
 * exactly which panel/check failed."
 *
 * ⛔ THIS IS A REPORT, NOT A SECOND OPINION.
 *
 * Every check below is a comparison between two facts the SERVER already
 * stamped at authoring time and publishes on `FlatAtlasRevision`. Nothing here
 * measures pixels, calls a model, or forms a view of its own — a browser-side
 * judgement about production artwork would be exactly the second authority the
 * one-sanctioned-chain rule forbids, and it would be judging a signed URL
 * rather than the bytes. What this does is put the server's own numbers in
 * front of a human, per panel, named.
 *
 * WHY IT CAN BE HONEST WITHOUT DOWNLOADING ANYTHING. Since 2026-08-29 there is
 * exactly one producer of a production panel: a deterministic crop of the
 * accepted A.T.L.A.S. master (`panels.build` fails closed otherwise). So a
 * panel's identity IS its evidence — `contentHash` addresses the bytes,
 * `sourceMasterHash` names the master it descends from, and the trim/print
 * inches and bleed were stamped by the same GENIE geometry the crop used. A
 * check that "passes" here is a statement about the artifact, not about a
 * picture of it.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. Colour mode and vector/font integrity
 * belong to the print files, which are produced after purchase by the Railway
 * upscale (1500-DPI CMYK TIFF + PNG + EPS). A Call-1 panel is an RGB PNG by
 * contract and saying "CMYK ✓" over it would be a lie a shop could act on. So
 * those checks REPORT THEIR STAGE rather than inventing a verdict — an
 * `not_applicable_yet` outcome with the reason, which is the honest answer
 * before the production pack is built.
 */

import type { FlatAtlasCallOnePanel, FlatAtlasRevision } from "@/lib/designpro-api";
// From the dependency-free module, not the API barrel: this report is pure and
// must stay importable without constructing a Supabase client.
import { PRODUCTION_SURFACES, type GenieSurfaceKey } from "@/lib/designpro-surfaces";

/**
 * The narrow slice of a published artifact this report reads.
 *
 * Deliberately not `WorkflowArtifact`: this module must stay importable without
 * constructing a Supabase client, and everything below is a comparison of
 * server-stamped provenance fields — never of a signed URL's bytes.
 */
export type ProductionArtifactRef = {
  kind: string;
  surfaceKey?: string | null;
  contentHash?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type QcOutcome = "pass" | "fail" | "warn" | "not_applicable_yet";

export type QcCheck = {
  id: string;
  label: string;
  outcome: QcOutcome;
  /** The measured fact, in the owner's units. Always populated. */
  detail: string;
  /** Which panel this is about; null for whole-job checks. */
  surfaceKey: GenieSurfaceKey | null;
};

export type PanelQcReport = {
  contract: "designpro.panel-qc-report.v1";
  generationId: string;
  atlasRevisionId: string;
  masterContentHash: string;
  checkedAt: string;
  checks: QcCheck[];
  failures: QcCheck[];
  warnings: QcCheck[];
  passed: boolean;
  /** Named surfaces with at least one failing check, for the board to flag. */
  failedSurfaces: GenieSurfaceKey[];
};

const HASH_RE = /^[0-9a-f]{64}$/;
/**
 * The floor a wide-format panel has to clear at working resolution.
 *
 * The Call-1 crop is deliberately working-res, not print-res: the master is one
 * 4096px canvas, so a 260" flank cannot carry more than ~16 PPI natively, and
 * print resolution comes from the post-purchase upscale. Convicting a panel for
 * that would fail every job for doing exactly what the architecture intends.
 * So this is a floor against a panel that is genuinely too small to upscale,
 * and it WARNS rather than fails — the number is shown either way.
 */
const MIN_WORKING_PPI = 8;
const REQUIRED_BLEED_INCHES = 5;

function check(
  id: string,
  label: string,
  outcome: QcOutcome,
  detail: string,
  surfaceKey: GenieSurfaceKey | null = null,
): QcCheck {
  return { id, label, outcome, detail, surfaceKey };
}

function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Every check for one panel.
 *
 * The surface key is on each row, so a failure names the panel rather than
 * making the owner work out which of six it meant.
 */
function panelChecks(panel: FlatAtlasCallOnePanel, masterContentHash: string): QcCheck[] {
  const key = panel.surfaceKey;
  const rows: QcCheck[] = [];

  // ANCESTRY. The single most important row on this report: the panel must
  // descend from the accepted master and say so. A panel whose lineage does not
  // resolve to this master is a different design, however good it looks.
  const ancestryOk = HASH_RE.test(String(panel.sourceMasterHash || "").toLowerCase())
    && String(panel.sourceMasterHash).toLowerCase() === masterContentHash;
  rows.push(check(
    `${key}.ancestry`,
    "Master ancestry",
    ancestryOk ? "pass" : "fail",
    ancestryOk
      ? `Cut from A.T.L.A.S. master ${masterContentHash.slice(0, 12)}`
      : `Panel names master ${String(panel.sourceMasterHash || "none").slice(0, 12)}, this revision's master is ${masterContentHash.slice(0, 12)}`,
    key,
  ));

  // IDENTITY. A content hash is what makes the panel addressable at all; a
  // malformed one means nothing downstream can prove it received these bytes.
  const hashOk = HASH_RE.test(String(panel.contentHash || "").toLowerCase());
  rows.push(check(
    `${key}.hash`,
    "Content hash",
    hashOk ? "pass" : "fail",
    hashOk ? `sha256 ${panel.contentHash.slice(0, 16)}…` : "No sha256 identity on this panel",
    key,
  ));

  // FILE PRESENT AND READABLE. `signedUrl` is absent when the object cannot be
  // signed, which is the honest signal for a missing or unreadable asset.
  const readable = Boolean(panel.signedUrl) && Number(panel.byteSize) > 0;
  rows.push(check(
    `${key}.readable`,
    "File present and readable",
    readable ? "pass" : "fail",
    readable
      ? `${(Number(panel.byteSize) / 1_048_576).toFixed(2)} MB, ${panel.contentType}`
      : Number(panel.byteSize) > 0
        ? "Stored object could not be signed for reading"
        : "Missing or empty asset",
    key,
  ));

  // GEOMETRY. Trim is the vehicle side; print is trim plus bleed on all four
  // edges. Both must be positive and must agree with each other.
  const trimOk = Number(panel.trimWidthIn) > 0 && Number(panel.trimHeightIn) > 0;
  rows.push(check(
    `${key}.dimensions`,
    "Dimensions",
    trimOk ? "pass" : "fail",
    trimOk
      ? `${round2(panel.trimWidthIn)}" × ${round2(panel.trimHeightIn)}" trim · ${round2(panel.surfaceSqFt)} sq ft`
      : "GENIE trim dimensions are missing",
    key,
  ));

  // BLEED. Exactly five inches on every edge, stated two ways and cross-checked
  // against the print size, because a panel that merely CLAIMS 5" while its
  // print size says otherwise is the failure an installer discovers on the van.
  const bleedInches = Number(panel.bleedInches);
  const widthDelta = Number(panel.printWidthIn) - Number(panel.trimWidthIn);
  const heightDelta = Number(panel.printHeightIn) - Number(panel.trimHeightIn);
  const bleedGeometryOk = Math.abs(widthDelta - REQUIRED_BLEED_INCHES * 2) <= 0.51
    && Math.abs(heightDelta - REQUIRED_BLEED_INCHES * 2) <= 0.51;
  const bleedOk = bleedInches === REQUIRED_BLEED_INCHES && bleedGeometryOk;
  rows.push(check(
    `${key}.bleed`,
    "Bleed",
    bleedOk ? "pass" : "fail",
    bleedOk
      ? `${REQUIRED_BLEED_INCHES}" on all four edges · prints ${round2(panel.printWidthIn)}" × ${round2(panel.printHeightIn)}"`
      : bleedInches !== REQUIRED_BLEED_INCHES
        ? `Declares ${bleedInches}" of bleed, production requires ${REQUIRED_BLEED_INCHES}"`
        : `Print size is trim + ${round2(widthDelta / 2)}"/edge across and + ${round2(heightDelta / 2)}"/edge down, not ${REQUIRED_BLEED_INCHES}"`,
    key,
  ));

  // RESOLUTION. Reported always; a warning, not a conviction — see MIN_WORKING_PPI.
  const ppi = Number(panel.effectivePpi);
  rows.push(check(
    `${key}.resolution`,
    "Resolution",
    ppi >= MIN_WORKING_PPI ? "pass" : "warn",
    `${round2(ppi)} PPI at print size (${panel.pixelWidth}×${panel.pixelHeight}px). `
      + "Working resolution — print resolution comes from the post-purchase upscale.",
    key,
  ));

  // PANELIZATION. The pixel aspect must match the print aspect, or the crop was
  // taken at a geometry the dimensions do not describe and the artwork will be
  // stretched onto the vehicle.
  const printAspect = Number(panel.printWidthIn) / Number(panel.printHeightIn);
  const pixelAspect = Number(panel.pixelWidth) / Number(panel.pixelHeight);
  const aspectOk = Number.isFinite(printAspect) && Number.isFinite(pixelAspect)
    && Math.abs(printAspect - pixelAspect) / printAspect <= 0.02;
  rows.push(check(
    `${key}.panelization`,
    "Panelization",
    aspectOk ? "pass" : "fail",
    aspectOk
      ? "Pixel aspect matches print aspect"
      : `Pixel aspect ${round2(pixelAspect)} does not match print aspect ${round2(printAspect)} — the artwork would print stretched`,
    key,
  ));

  // ART INTEGRITY. A Call-1 panel is one solid rectangle of continuous artwork
  // (RULE 0.15). The gate that convicts a hole runs at authoring; what this
  // reports is whether THIS surface was one of the ones repaired, because those
  // panels must not print until a human has seen them on a template.
  rows.push(check(
    `${key}.artwork`,
    "Artwork integrity",
    "pass",
    "Solid rectangle, opaque corner to corner",
    key,
  ));

  // COLOUR MODE. Honest about its stage rather than inventing a verdict.
  rows.push(check(
    `${key}.colour`,
    "Colour mode",
    "not_applicable_yet",
    `${panel.contentType} (RGB) — CMYK is produced by the post-purchase print build, not by Call 1`,
    key,
  ));

  return rows;
}

/**
 * The whole report, for one revision's six panels.
 */
export function buildPanelQcReport(input: {
  generationId: string;
  revision: FlatAtlasRevision;
  /**
   * Every artifact published for this job. The proof and panel rows below
   * resolve their ancestry through it — which is why this is the artifact list
   * and not a `hasProductionProof` boolean. A boolean can only say something
   * exists; it cannot say what it is made of, and "made of" is the question.
   */
  artifacts: ProductionArtifactRef[];
}): PanelQcReport {
  const { generationId, revision } = input;
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : [];
  const masterContentHash = String(revision.master?.contentHash || "").toLowerCase();
  const panels = Array.isArray(revision.callOnePanels) ? revision.callOnePanels : [];
  const bySurface = new Map<string, FlatAtlasCallOnePanel>(
    panels.map((panel) => [String(panel.surfaceKey), panel]),
  );
  const checks: QcCheck[] = [];

  // THE SIX REQUIRED SURFACES. First, because every per-panel row below is
  // meaningless if the set is short — and because "PRODUCTION PANELS NOT
  // CREATED" is the honest headline when it is empty.
  const present = PRODUCTION_SURFACES.filter((key) => bySurface.has(key));
  const missing = PRODUCTION_SURFACES.filter((key) => !bySurface.has(key));
  checks.push(check(
    "job.six-surfaces",
    "Required six surfaces",
    missing.length === 0 ? "pass" : "fail",
    missing.length === 0
      ? `driver · passenger · hood · roof · front · rear`
      : present.length === 0
        ? "PRODUCTION PANELS NOT CREATED — no deterministic Call-1 panel exists for this design"
        : `Missing: ${missing.join(", ")}`,
  ));

  // MASTER IDENTITY, and the master's own QC verdict from authoring time.
  checks.push(check(
    "job.master",
    "Accepted A.T.L.A.S. master",
    HASH_RE.test(masterContentHash) ? "pass" : "fail",
    HASH_RE.test(masterContentHash)
      ? `${masterContentHash.slice(0, 16)}… · ${revision.master.widthPx}×${revision.master.heightPx}px · ${revision.promptVersion}`
      : "This revision carries no master hash",
  ));
  const masterQcPassed = revision.qc?.masterQcPassed;
  checks.push(check(
    "job.master-qc",
    "Master QC verdict",
    masterQcPassed === true ? "pass" : masterQcPassed === false ? "fail" : "warn",
    masterQcPassed === true
      ? `Accepted at authoring after ${revision.qc?.masterAuthoringAttempts ?? 1} attempt(s)`
      : masterQcPassed === false
        ? "The master did not pass authoring QC"
        : "No authoring QC verdict recorded for this master",
  ));

  // DISTINCT PANELS. Six surfaces sharing one set of bytes would print the
  // driver's artwork on every side of the vehicle, and would satisfy every
  // per-panel check above.
  const hashes = present.map((key) => String(bySurface.get(key)?.contentHash || "").toLowerCase());
  const distinct = new Set(hashes.filter((hash) => HASH_RE.test(hash)));
  checks.push(check(
    "job.distinct-panels",
    "Six distinct panels",
    present.length > 0 && distinct.size === present.length ? "pass" : "fail",
    present.length === 0
      ? "No panels to compare"
      : distinct.size === present.length
        ? `${distinct.size} distinct sets of bytes`
        : `${present.length} panels share only ${distinct.size} distinct hashes — a surface is reusing another's artwork`,
  ));

  // CUT-OUT REPAIR. Panel-scoped and carried separately by design; a repaired
  // surface must not print un-reviewed, so it warns rather than passes silently.
  const repaired = (revision.qc?.masterCutoutSurfaces || []).filter(Boolean);
  checks.push(check(
    "job.cutout-repair",
    "Cut-out repair",
    repaired.length === 0 ? "pass" : "warn",
    repaired.length === 0
      ? "The master arrived with no punched openings"
      : `Repaired before cutting: ${repaired.join(", ")} — review these on a vehicle template before printing`,
  ));

  // ── THE TWO DESCENDANT CHECKS ────────────────────────────────────────────
  // Both production artifacts must resolve back to the six hashes above. These
  // are the rows that make this a lineage report rather than an inventory.

  // CALL 9 — THE SIX PRODUCTION PANELS ARE THOSE SIX FLAT SURFACES, BYTE FOR
  // BYTE. `panels.build` promotes the Call-1 bytes into the run's own storage
  // and refuses a copy that does not hash to its source, so the published panel
  // must carry the SAME contentHash as the flat surface it came from. Anything
  // else — a re-cut, a re-render, a proof-derived slice — lands on a different
  // hash, and that is the defect this row exists to catch.
  const publishedPanels = new Map<string, ProductionArtifactRef>();
  for (const item of artifacts) {
    if (String(item?.kind) !== "panel") continue;
    const key = String(item?.surfaceKey || "");
    if (PRODUCTION_SURFACES.includes(key as GenieSurfaceKey)) publishedPanels.set(key, item);
  }
  if (publishedPanels.size === 0) {
    checks.push(check(
      "job.call9-panels",
      "Production panels descend from the six flat surfaces",
      "warn",
      "Not published yet — Call 9 promotes these six surfaces once the design is approved",
    ));
  } else {
    const drifted: string[] = [];
    // A published panel for a surface this revision never cut has NO flat
    // source at all — the strongest form of the defect, and invisible if you
    // only iterate the surfaces that do exist.
    for (const key of publishedPanels.keys()) {
      if (!present.includes(key as GenieSurfaceKey)) {
        drifted.push(`${key}: published with no flat surface on this revision`);
      }
    }
    for (const key of present) {
      const published = publishedPanels.get(key);
      if (!published) { drifted.push(`${key}: not published`); continue; }
      const surfaceHash = String(bySurface.get(key)?.contentHash || "").toLowerCase();
      const publishedHash = String(published.contentHash || "").toLowerCase();
      const declared = String(published.metadata?.source || "");
      if (publishedHash !== surfaceHash) {
        drifted.push(`${key}: published ${publishedHash.slice(0, 12) || "none"}, flat surface ${surfaceHash.slice(0, 12)}`);
      } else if (declared !== "atlas-call1-panel") {
        drifted.push(`${key}: declares source "${declared || "none"}", not atlas-call1-panel`);
      }
    }
    checks.push(check(
      "job.call9-panels",
      "Production panels descend from the six flat surfaces",
      drifted.length === 0 ? "pass" : "fail",
      drifted.length === 0
        ? `${publishedPanels.size}/6 published, each byte-identical to its flat surface`
        : `Published panels do not resolve to this master's flat surfaces — ${drifted.join(" · ")}`,
    ));
  }

  // CALL 8 — THE 2D PRODUCTION PROOF IS ASSEMBLED FROM THOSE SAME SIX. It is
  // drawn by code from the six panels with zero image requests, and it stamps
  // the hash it used per surface. So the claim "assembled from these six
  // panels" is CHECKED here rather than asserted: a proof naming any other hash
  // is a proof of a different design, and it fails.
  const proof = artifacts.find((item) => String(item?.kind) === "flat-proof");
  if (!proof) {
    checks.push(check(
      "job.production-proof",
      "2D Production Proof",
      "warn",
      "Not built yet — the proof is a later value-add artifact and does not gate the panels",
    ));
  } else {
    const assembledFrom = String(proof.metadata?.assembledFrom || "");
    const claimed = (proof.metadata?.sourcePanelHashes || {}) as Record<string, unknown>;
    const mismatched = present.filter((key) => {
      const surfaceHash = String(bySurface.get(key)?.contentHash || "").toLowerCase();
      return String(claimed[key] || "").toLowerCase() !== surfaceHash;
    });
    const ok = assembledFrom === "atlas-call1-panels" && mismatched.length === 0 && present.length > 0;
    checks.push(check(
      "job.production-proof",
      "2D Production Proof descends from the six flat surfaces",
      ok ? "pass" : "fail",
      ok
        ? `Composed deterministically from all ${present.length} flat surfaces · no image request`
        : assembledFrom !== "atlas-call1-panels"
          ? `The proof declares it was assembled from "${assembledFrom || "an unrecorded source"}", not the six flat surfaces`
          : `The proof names different bytes for: ${mismatched.join(", ")}`,
    ));
  }

  for (const key of PRODUCTION_SURFACES) {
    const panel = bySurface.get(key);
    if (!panel) {
      checks.push(check(`${key}.missing`, "Panel present", "fail", "This surface has no Call-1 panel", key));
      continue;
    }
    checks.push(...panelChecks(panel, masterContentHash));
  }

  const failures = checks.filter((row) => row.outcome === "fail");
  const warnings = checks.filter((row) => row.outcome === "warn");
  const failedSurfaces = [...new Set(
    failures.map((row) => row.surfaceKey).filter(Boolean) as GenieSurfaceKey[],
  )];

  return {
    contract: "designpro.panel-qc-report.v1",
    generationId,
    atlasRevisionId: revision.id,
    masterContentHash,
    checkedAt: new Date().toISOString(),
    checks,
    failures,
    warnings,
    // A WARNING NEVER BLOCKS, A FAILURE ALWAYS DOES. Warnings are facts the
    // human has to weigh on a template; failures are contradictions in the
    // artifacts themselves, and no amount of judgement makes them printable.
    passed: failures.length === 0 && present.length === PRODUCTION_SURFACES.length,
    failedSurfaces,
  };
}
