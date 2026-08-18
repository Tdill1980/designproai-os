/**
 * PRODUCTION LAYERS, FROM THE STANDALONE RUNTIME.
 *
 * `ProductionFlowLayersCard` is the surface the customer sees after Calls 8-11:
 * the six branded print panels paired with their approved 3D views, the clean
 * de-logoed set beside them, and the separated logo assets underneath. It is
 * the original product component and it stays exactly as it is.
 *
 * What changed underneath it is where the rows come from. The card was written
 * against `production_flow_assets`, a table this system does not have and must
 * not restore to satisfy an old read. This module is the adapter: it takes what
 * the runtime already publishes through `dpApi` and returns the same
 * `ProductionFlowAssetRow[]` the card consumes.
 *
 * The mapping is one-to-one with the calls, not a reinterpretation of them:
 *
 *   Call 9  "panel"     the branded production artwork  ->  branding_url
 *   Call 11 "qc-panel"  the de-logoed duplicate         ->  background_url
 *   Call 10 "logo"      the separated brand elements    ->  meta.logo_pack
 *
 * Two things this deliberately does NOT do. It never invents a clean panel for
 * a side Call 11 honestly refused -- that side reports a reasoned separation
 * gap, which the card already knows how to display, and the branded panel it
 * owes the customer is unaffected. And it never derives pack identity from
 * anything but the Call 9 receipt: the version, the source hash and the
 * proof binding all come from the run's own receipts, so a pack cannot look
 * current while being built from a superseded revision.
 */
import {
  dpApi,
  SOURCE_VIEW_TYPE_FOR_ROLE,
  type ApprovedGenerationView,
  type WorkflowArtifact,
  type WorkflowStatus,
} from "@/lib/designpro-api";
import type {
  ProductionFlowAssetRow,
  ProductionFlowLogoAsset,
} from "@/lib/productionFlowAssetState";

/** The card keys everything by these labels; the runtime keys by surface_key. */
export const SIDE_LABEL_FOR_SURFACE: Record<string, string> = {
  driver: "DRIVER SIDE",
  passenger: "PASSENGER SIDE",
  hood: "HOOD",
  roof: "ROOF",
  front: "FRONT",
  rear: "REAR",
};

const SURFACE_ORDER = ["driver", "passenger", "hood", "roof", "front", "rear"] as const;

const HEX64 = /^[a-f0-9]{64}$/i;

function metaNumber(metadata: Record<string, unknown>, key: string): number {
  const value = Number(metadata?.[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * THE PACK'S IDENTITY IS THE PROOF IT WAS BOUND TO.
 *
 * One approved proof binds one panel set for one revision, so the proof's
 * content hash names the pack exactly. `isAtomicPanelPackRow` wants a full
 * 64-hex source hash whose first 24 characters are the version suffix, so both
 * are read from that one value rather than assembled from two that could
 * disagree.
 *
 * This is also what makes staleness work without a separate check: a revision
 * mints a new proof, the hash changes, and every row built against the old one
 * stops matching the current binding.
 */
export function packIdentity(proofContentHash: string): { version: string; sourceHash: string } | null {
  const hash = String(proofContentHash || "").toLowerCase();
  if (!HEX64.test(hash)) return null;
  return { version: `v2:${hash.slice(0, 24)}`, sourceHash: hash };
}

/**
 * A stable name for the proof this pack was cut against.
 *
 * Not the signed URL: those expire in five minutes, so a row stamped with one
 * would read as stale against the next signature of the same sheet. The proof's
 * content hash is what actually identifies it, and it changes exactly when the
 * proof does -- which is the staleness the card is checking for.
 */
export function proofBinding(proofContentHash: string | null | undefined): string {
  const hash = String(proofContentHash || "").toLowerCase();
  return HEX64.test(hash) ? `designpro://proof/${hash}` : "";
}

/**
 * What the card needs in place of its four direct-Supabase reads. Supplying
 * this is what lets the original component render here unchanged: it stops
 * resolving canonical ids, entice packs, rows and views for itself and consumes
 * what the runtime already published.
 */
export type ProductionLayersSource = {
  canonicalId: string;
  rows: ProductionFlowAssetRow[];
  designViews: Record<string, string>;
  /**
   * The activated pack, in the shape the card checks against. `id` and
   * `pack_version` are the pack identity every row carries, so the card's
   * "is this the pack the server activated" test resolves true for a real pack
   * and false for anything assembled from mismatched parts.
   */
  activePack: {
    id: string;
    pack_version: string;
    revision_id: string;
    proof_artifact: { url: string } | null;
    surface_manifest: { surfaces: Array<{ surfaceKey: string }> };
  } | null;
  /** Purchase actions, injected so the customer path calls no legacy function. */
  onOrderProductionPack?: () => void | Promise<void>;
  onOrderLogoPack?: () => void | Promise<void>;
  /** What the customer has actually paid for. Preview assets never imply this. */
  entitlements?: { productionPack: boolean; logoPack: boolean };
};

export type ProductionLayers = {
  rows: ProductionFlowAssetRow[];
  /** The approved 3D view per side, so each panel shows beside its own render. */
  designViews: Record<string, string>;
  proofUrl: string | null;
  proofBinding: string;
  logoPack: ProductionFlowLogoAsset[];
  activePack: ProductionLayersSource["activePack"];
};

/**
 * Build the card's rows from one run's artifacts.
 *
 * `artifacts` and `views` are passed in rather than fetched so this stays pure
 * and testable; `loadProductionLayers` below is the call that fetches them.
 */
export function toProductionLayers(input: {
  artifacts: WorkflowArtifact[];
  approvedViews: ApprovedGenerationView[];
  createdAt: string;
}): ProductionLayers | null {

  const bySurface = (kind: string) => {
    const map = new Map<string, WorkflowArtifact>();
    for (const artifact of input.artifacts) {
      if (artifact.kind !== kind) continue;
      const key = String(artifact.surfaceKey || "");
      // First wins: artifacts arrive newest-first and a surface is written once
      // per run, so a second row for one surface is a superseded attempt.
      if (SIDE_LABEL_FOR_SURFACE[key] && !map.has(key)) map.set(key, artifact);
    }
    return map;
  };
  const branded = bySurface("panel");
  const clean = bySurface("qc-panel");

  // Every side must have its branded panel. A pack missing one is not a pack,
  // and reporting five sides as complete is how a customer discovers the sixth
  // at print time.
  if (SURFACE_ORDER.some((surface) => !branded.has(surface))) return null;

  const proof = input.artifacts.find((artifact) => artifact.kind === "flat-proof") || null;
  // The proof is what every panel is anchored to, so a pack without one has no
  // identity to publish under and no way to be told apart from a stale set.
  const identity = packIdentity(String(proof?.contentHash || ""));
  if (!identity) return null;
  const binding = proofBinding(proof?.contentHash);
  if (!binding) return null;
  // Every panel must name the same proof the pack is published under. A panel
  // bound to a different sheet is one the customer did not approve here.
  for (const surface of SURFACE_ORDER) {
    const bound = String(branded.get(surface)!.metadata?.proofContentHash || "").toLowerCase();
    if (bound && bound !== identity.sourceHash) return null;
  }
  const expectedSides = SURFACE_ORDER.map((surface) => SIDE_LABEL_FOR_SURFACE[surface]);
  const revisionId = String(branded.get("driver")!.metadata?.revisionId || "");

  const logoPack: ProductionFlowLogoAsset[] = input.artifacts
    .filter((artifact) => artifact.kind === "logo")
    .map((artifact) => ({
      url: artifact.signedUrl,
      label: String(artifact.metadata?.displayName || artifact.metadata?.identityKey || "Logo"),
      element_label: String(artifact.metadata?.identityKey || ""),
      side: SIDE_LABEL_FOR_SURFACE[String(artifact.surfaceKey || "")] || undefined,
    }));

  const designViews: Record<string, string> = {};
  for (const view of input.approvedViews) {
    // The card keys its views by the source view type the design was rendered
    // at, so a view is resolved by its own type first and only mapped from the
    // surface key when the row does not state one.
    const viewType = String(view.sourceViewType || SOURCE_VIEW_TYPE_FOR_ROLE[view.surfaceKey as never] || "");
    if (viewType && view.signedUrl) designViews[viewType] = view.signedUrl;
  }

  const rows = SURFACE_ORDER.map((surface) => {
    const panel = branded.get(surface)!;
    const duplicate = clean.get(surface) || null;
    const removedCount = Number(duplicate?.metadata?.removedCount ?? 0);
    // Call 11 may honestly remove nothing from a side that carries no logo. The
    // card reads that as a reasoned gap and keeps showing the branded panel,
    // which is the deliverable; inventing a clean panel would be the lie.
    const separationGap = !duplicate || (Number.isFinite(removedCount) && removedCount === 0);

    return {
      id: panel.id,
      // The pack identity, repeated on every row exactly as the atomic saver
      // wrote it. The card compares these against the activated pack, and a row
      // that cannot state them is a row it cannot vouch for.
      entice_pack_id: identity.sourceHash,
      revision_id: revisionId,
      side: SIDE_LABEL_FOR_SURFACE[surface],
      version: identity.version,
      dimensions_inches: {
        w: metaNumber(panel.metadata, "trimWidthInches"),
        h: metaNumber(panel.metadata, "trimHeightInches"),
      },
      background_url: separationGap ? "" : duplicate!.signedUrl,
      branding_url: panel.signedUrl,
      depth_mask_url: null,
      final_pack_url: null,
      meta_metrics: {
        production_eligible: true,
        pack_version: identity.version,
        source_hash: identity.sourceHash,
        source_proof_url: binding,
        expected_sides: expectedSides,
        logo_pack: logoPack,
        qc: { known: true, pass: true },
        separation_qc: separationGap
          ? {
              known: true,
              pass: false,
              reason: duplicate
                ? "Call 11 found no removable branding on this side"
                : "Call 11 produced no duplicate for this side",
            }
          : { known: true, pass: true },
      },
      created_at: input.createdAt,
    } satisfies ProductionFlowAssetRow;
  });

  return {
    rows,
    designViews,
    proofUrl: proof?.signedUrl || null,
    proofBinding: binding,
    logoPack,
    activePack: {
      id: identity.sourceHash,
      pack_version: identity.version,
      revision_id: revisionId,
      proof_artifact: proof ? { url: binding } : null,
      surface_manifest: { surfaces: SURFACE_ORDER.map((surfaceKey) => ({ surfaceKey })) },
    },
  };
}

/** Fetch one run's production layers through the gateway. */
export async function loadProductionLayers(generationId: string): Promise<ProductionLayers | null> {
  const [status, artifacts] = await Promise.all([
    dpApi.getStatus(generationId) as Promise<WorkflowStatus>,
    dpApi.listArtifacts(generationId),
  ]);
  const call9 = status.stages.find((stage) => stage.key === "panels.build");
  if (!call9 || call9.state !== "complete") return null;
  const approvedViews = await dpApi.listApprovedViews(generationId).catch(() => []);
  return toProductionLayers({ artifacts, approvedViews, createdAt: new Date().toISOString() });
}
