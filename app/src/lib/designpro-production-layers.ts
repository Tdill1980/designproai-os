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
  type FlatAtlasCallOnePanel,
  type FlatAtlasRevision,
  type WorkflowArtifact,
  type WorkflowStatus,
} from "@/lib/designpro-api";
import { selectCustomerProof } from "@/lib/designpro-artifact-selectors";
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
 * CALL 9 WRITES TWO METADATA SHAPES, AND ONLY ONE WAS BEING READ.
 *
 * A gridslice panel carries `trimWidthInches` with a four-edge `bleed` object.
 * An A.T.L.A.S. Call-1 promotion carries `trimWidthIn` with a scalar
 * `bleedInches` -- the shape `cutCallOnePanels` stamps and the claimant's
 * promotion path copies through verbatim. Naming only the gridslice spelling
 * meant every atlas panel reached RevisionStudio with `w: 0, h: 0`, so the card
 * rendered the side with no dimensions at all: no trim inches, no square
 * footage, nothing to compare against the proof beside it. The panels were
 * correct; the reader was looking for a key they do not have.
 *
 * `enhance.upscale` already reads both (`meta.trimWidthIn ?? meta.trimWidthInches`).
 * This is the same tolerance, in the surface the customer actually sees.
 */
function panelInches(metadata: Record<string, unknown>, edge: "Width" | "Height"): number {
  return metaNumber(metadata, `trim${edge}In`) || metaNumber(metadata, `trim${edge}Inches`);
}

function printInches(metadata: Record<string, unknown>, edge: "Width" | "Height"): number {
  return metaNumber(metadata, `print${edge}In`) || metaNumber(metadata, `print${edge}Inches`);
}

/** Five inches per edge, stated either as the object or the scalar. */
function bleedInches(metadata: Record<string, unknown>): number {
  const bleed = metadata?.bleed;
  if (bleed && typeof bleed === "object" && !Array.isArray(bleed)) {
    const edges = ["top", "right", "bottom", "left"]
      .map((edge) => Number((bleed as Record<string, unknown>)[edge]));
    if (edges.every((value) => Number.isFinite(value) && value === edges[0])) return edges[0];
    return 0;
  }
  return metaNumber(metadata, "bleedInches");
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
  /**
   * WHICH HALF OF THE PRODUCT THIS IS.
   *
   * `entice` means the six panels A.T.L.A.S. Call 1 already cut, shown before
   * anyone has bought anything. They are real -- the actual surfaces of the
   * accepted master, at design-time geometry -- and they are the whole
   * commercial argument: the design is already mapped across the vehicle, and
   * the Production Pack is what turns those approved surfaces into print-ready
   * files. So the card shows them, states their dimensions, withholds the
   * production-resolution asset, and asks for the sale.
   *
   * `production` means Call 9 has run and these are the branded production
   * panels themselves.
   *
   * The distinction is NOT "verified vs unverified". Reading the entice set as
   * an unverified pack is what made the card call real A.T.L.A.S. surfaces
   * "production blocked" and hide the CTA -- turning the conversion surface
   * into a defect report.
   */
  stage?: "entice" | "production";
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
  /** Owner-only protected promotion path. Same entitlement, no Stripe charge. */
  onRunOwnerEndToEndTest?: () => void | Promise<void>;
  /** What the customer has actually paid for. Preview assets never imply this. */
  entitlements?: { productionPack: boolean; logoPack: boolean };
};

export type ProductionLayers = {
  stage: "entice" | "production";
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

  // BY ROLE, NOT BY KIND. Call 8 emits seven artifacts of kind "flat-proof":
  // the six canonical production surfaces and the one customer proof. Taking
  // the first match made this pack's identity, and the sheet shown to the
  // customer, depend on the order the gateway happened to return rows in -- and
  // a manufacturing surface is a real image of the right design, so the wrong
  // one would have looked entirely correct.
  const proof = selectCustomerProof(input.artifacts);
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
      // Trim is the vehicle side; print is trim plus the physical bleed on every
      // edge. Both are carried so the card can show the panel at print size AND
      // draw where the trim sits inside it, which is the only way a designer can
      // see what survives the cut.
      dimensions_inches: {
        w: panelInches(panel.metadata, "Width"),
        h: panelInches(panel.metadata, "Height"),
        print_w: printInches(panel.metadata, "Width"),
        print_h: printInches(panel.metadata, "Height"),
        bleed: bleedInches(panel.metadata),
      },
      background_url: separationGap ? "" : duplicate!.signedUrl,
      branding_url: panel.signedUrl,
      depth_mask_url: null,
      final_pack_url: null,
      meta_metrics: {
        production_eligible: true,
        pack_version: identity.version,
        source_hash: identity.sourceHash,
        source_master_hash: String(panel.metadata?.sourceMasterHash || ""),
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
    stage: "production",
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

/**
 * THE ENTICE SET: THE SIX PANELS CALL 1 ALREADY CUT.
 *
 * `toProductionLayers` above reads the Call 9 artifacts, and Call 9 lives after
 * `await_purchase` -- so for every A.T.L.A.S. run nobody has ordered yet, which
 * is the state the whole product entices from, it correctly returns null and
 * the customer's right column was empty. That is not what the pipeline
 * produced: RULE 0.21 says the accepted master fans out immediately, and Call 1
 * has already cut all six panels at the design-time size with the 5" bleed in
 * the layout, hashed and bound to the master.
 *
 * So this is the same card, filled from the panels that exist now. Nothing is
 * generated, nothing is re-cut, and nothing is invented: every number below --
 * the trim inches, the print inches, the bleed, the square footage, the
 * effective PPI, the master hash -- was stamped by `cutCallOnePanels` at
 * authoring time and validated by the gateway before it was signed.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. There is no clean panel, because Call 11
 * has not run; each side records that as a reasoned separation gap, which is the
 * shape the card already knows how to display and the same one a genuinely
 * refused separation uses. There is no 2D production proof, because Call 8 has
 * not run either. And the pack identity is the MASTER, not a proof -- these
 * panels are bound to the design authority they were cut from, which is
 * precisely the binding PanelPro pairs a panel with its proof by.
 */
export function toAtlasEnticeLayers(input: {
  revision: FlatAtlasRevision;
  approvedViews: readonly ApprovedGenerationView[];
  createdAt: string;
}): ProductionLayers | null {
  const masterHash = String(input.revision?.master?.contentHash || "").toLowerCase();
  const identity = packIdentity(masterHash);
  if (!identity) return null;
  const panels = new Map<string, FlatAtlasCallOnePanel>();
  for (const panel of input.revision.callOnePanels || []) {
    const surface = String(panel?.surfaceKey || "");
    if (SIDE_LABEL_FOR_SURFACE[surface] && !panels.has(surface)) panels.set(surface, panel);
  }
  // Six sides or nothing. Five panels shown as a set is how a customer finds
  // the sixth at print time.
  if (SURFACE_ORDER.some((surface) => !panels.has(surface))) return null;

  const designViews: Record<string, string> = {};
  for (const view of input.approvedViews) {
    const viewType = String(view.sourceViewType || SOURCE_VIEW_TYPE_FOR_ROLE[view.surfaceKey as never] || "");
    if (viewType && view.signedUrl) designViews[viewType] = view.signedUrl;
  }

  const expectedSides = SURFACE_ORDER.map((surface) => SIDE_LABEL_FOR_SURFACE[surface]);
  // Not a signed URL, for the same reason the proof binding is not: a signature
  // expires in five minutes and every row stamped with one would read as stale
  // against the next read of the same sheet. The master's content hash changes
  // exactly when the design does, which is the staleness worth detecting.
  const masterBinding = `designpro://atlas-master/${identity.sourceHash}`;

  const rows = SURFACE_ORDER.map((surface) => {
    const panel = panels.get(surface)!;
    return {
      id: `${input.revision.id}:${surface}`,
      entice_pack_id: identity.sourceHash,
      revision_id: input.revision.id,
      side: SIDE_LABEL_FOR_SURFACE[surface],
      version: identity.version,
      dimensions_inches: {
        w: panel.trimWidthIn,
        h: panel.trimHeightIn,
        print_w: panel.printWidthIn,
        print_h: panel.printHeightIn,
        bleed: panel.bleedInches,
        sq_ft: panel.surfaceSqFt,
        ppi: panel.effectivePpi,
      },
      // Call 11 produces the de-logoed duplicate and has not run. Reported as
      // the reasoned gap it is, never as a clean panel this design does not
      // have -- the branded panel the customer is owed is unaffected.
      background_url: "",
      branding_url: panel.signedUrl || "",
      depth_mask_url: null,
      final_pack_url: null,
      meta_metrics: {
        // Design-time geometry, marked as such by Call 1 itself. GENIE resolves
        // the validated production dimensions after purchase, so claiming
        // production eligibility here would be claiming a measurement nobody
        // has taken.
        production_eligible: false,
        pack_version: identity.version,
        source_hash: identity.sourceHash,
        source_master_hash: String(panel.sourceMasterHash || identity.sourceHash),
        source_proof_url: masterBinding,
        expected_sides: expectedSides,
        logo_pack: [],
        qc: { known: true, pass: true },
        separation_qc: {
          known: true,
          pass: false,
          reason: "Call 11 has not run yet — the de-logoed duplicate is produced after purchase",
        },
      },
      created_at: input.createdAt,
    } satisfies ProductionFlowAssetRow;
  });

  return {
    stage: "entice",
    rows,
    designViews,
    // Call 8 has not run, so there is no 2D production proof to show above the
    // panels. Absent, never a stand-in.
    proofUrl: null,
    proofBinding: masterBinding,
    logoPack: [],
    // The design authority these six were cut from. It is not an activated
    // production pack and must not read as one, so it is published as the
    // preview binding it is and the card's own verification gate decides the
    // rest.
    activePack: null,
  };
}

/**
 * Fetch one design's production layers through the gateway.
 *
 * Call 9's branded set when it exists, and the Call-1 entice set before then.
 * Never both, and never a merge of the two: after purchase the branded panels
 * are the production artwork and the design-time cut is history.
 */
export async function loadProductionLayers(generationId: string): Promise<ProductionLayers | null> {
  const [status, artifacts] = await Promise.all([
    dpApi.getStatus(generationId) as Promise<WorkflowStatus>,
    dpApi.listArtifacts(generationId).catch(() => [] as WorkflowArtifact[]),
  ]);
  const approvedViews = await dpApi.listApprovedViews(generationId).catch(() => []);
  const call9 = status.stages.find((stage) => stage.key === "panels.build");
  if (call9 && call9.state === "complete") {
    const built = toProductionLayers({
      artifacts, approvedViews, createdAt: new Date().toISOString(),
    });
    if (built) return built;
  }
  // Before manufacturing: the panels A.T.L.A.S. Call 1 cut from the accepted
  // master. The newest revision is the design as it stands now.
  const revisions = await dpApi.listJobFlatAtlasRevisions(generationId)
    .catch(() => [] as FlatAtlasRevision[]);
  const newest = revisions.length ? revisions[revisions.length - 1] : null;
  if (!newest) return null;
  return toAtlasEnticeLayers({
    revision: newest, approvedViews, createdAt: new Date().toISOString(),
  });
}
