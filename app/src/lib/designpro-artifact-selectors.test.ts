/**
 * THE SILENT SUBSTITUTION.
 *
 * Call 8 emits SEVEN artifacts of kind "flat-proof": one per canonical
 * production surface, plus the single 2D Production Proof the customer approves.
 * Only metadata.role separates them, and every one of them is a real, correct
 * image of the right design -- so handing back the wrong one produces no error,
 * no empty frame and nothing visibly out of place.
 *
 * That made it worth testing twice: once on the selector, and once on
 * toProductionLayers, which derives the whole pack's identity from whichever
 * proof it is given. These tests use the runtime's real artifact shape (six
 * surfaces carrying a surfaceKey, one proof carrying none) rather than a
 * convenient two-item list, because the order those arrive in is exactly what
 * used to decide the answer.
 */

import { describe, expect, it, vi } from "vitest";

// designpro-production-layers imports the gateway client, which constructs a
// Supabase client against browser globals at module load. The mapping under
// test never calls it; stubbing the module is what keeps these tests runnable
// without a DOM.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { CUSTOMER_PROOF_ROLE, selectCustomerProof } from "./designpro-artifact-selectors";
import { packIdentity, toProductionLayers } from "./designpro-production-layers";
import type { ApprovedGenerationView, WorkflowArtifact } from "./designpro-api";

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"] as const;

const PROOF_HASH = "c".repeat(64);
const SURFACE_HASH = "d".repeat(64);

function artifact(partial: Partial<WorkflowArtifact> & { kind: string }): WorkflowArtifact {
  return {
    id: `${partial.kind}:${partial.surfaceKey ?? "sheet"}`,
    kind: partial.kind,
    surfaceKey: "",
    storagePath: "designpro/x.png",
    contentHash: "a".repeat(64),
    byteSize: 1,
    metadata: {},
    signedUrl: `https://signed.example/${partial.kind}/${partial.surfaceKey ?? "sheet"}`,
    expiresIn: 300,
    ...partial,
  } as WorkflowArtifact;
}

/** The customer's Call 8 proof: no surfaceKey, and the only role that matters. */
const customerProof = artifact({
  kind: "flat-proof",
  contentHash: PROOF_HASH,
  metadata: { role: CUSTOMER_PROOF_ROLE },
});

/** The six canonical production surfaces, same kind, different role. */
const canonicalSurfaces = SURFACES.map((surfaceKey) =>
  artifact({
    kind: "flat-proof",
    surfaceKey,
    contentHash: SURFACE_HASH,
    metadata: { role: "canonical-production-surface" },
  }),
);

const brandedPanels = SURFACES.map((surfaceKey) =>
  artifact({
    kind: "panel",
    surfaceKey,
    metadata: {
      proofContentHash: PROOF_HASH,
      revisionId: "rev-1",
      trimWidthInches: 227.7,
      trimHeightInches: 76.4,
    },
  }),
);

const qcPanels = SURFACES.map((surfaceKey) =>
  artifact({ kind: "qc-panel", surfaceKey, metadata: { removedCount: 2 } }),
);

function view(surfaceKey: string, sourceViewType: string): ApprovedGenerationView {
  return {
    id: `view:${surfaceKey}`,
    generationId: "g",
    surfaceKey,
    sourceViewType,
    storagePath: "designpro/v.png",
    contentHash: "b".repeat(64),
    byteSize: 1,
    contentType: "image/png",
    signedUrl: `https://signed.example/view/${surfaceKey}`,
    expiresIn: 300,
  };
}

describe("selectCustomerProof", () => {
  it("picks the proof by role even when six surfaces share its kind", () => {
    expect(selectCustomerProof([...canonicalSurfaces, customerProof])).toBe(customerProof);
    // And the answer does not move when the order does.
    expect(selectCustomerProof([customerProof, ...canonicalSurfaces])).toBe(customerProof);
  });

  it("returns null rather than a surface when Call 8 has emitted no proof", () => {
    expect(selectCustomerProof(canonicalSurfaces)).toBeNull();
    expect(selectCustomerProof([])).toBeNull();
    expect(selectCustomerProof(undefined)).toBeNull();
  });

  it("refuses to choose when a run claims two customer proofs", () => {
    // A contradiction in Call 8's own output. Picking either one buries it.
    expect(() => selectCustomerProof([customerProof, artifact({
      kind: "flat-proof",
      contentHash: "e".repeat(64),
      metadata: { role: CUSTOMER_PROOF_ROLE },
    })])).toThrow(/customer_2d_production_proof_cardinality:2/);
  });

  it("does not accept a role that merely resembles the customer proof", () => {
    expect(selectCustomerProof([artifact({
      kind: "flat-proof",
      metadata: { role: "customer-2d-production-proof-draft" },
    })])).toBeNull();
  });
});

describe("toProductionLayers", () => {
  const complete = [...brandedPanels, ...qcPanels, ...canonicalSurfaces, customerProof];
  const build = (artifacts: WorkflowArtifact[], approvedViews: ApprovedGenerationView[] = []) =>
    toProductionLayers({ artifacts, approvedViews, createdAt: "2026-08-19T18:00:00Z" });

  it("anchors the pack to the customer proof, whatever order the artifacts arrive in", () => {
    // The regression this replaces: the first kind-matching artifact won, so a
    // canonical surface's hash could name the pack and its image could be shown
    // to the customer as their approval proof.
    const identity = packIdentity(PROOF_HASH)!;
    for (const order of [complete, [...complete].reverse()]) {
      const layers = build(order)!;
      expect(layers).not.toBeNull();
      expect(layers.proofUrl).toBe(customerProof.signedUrl);
      expect(layers.proofBinding).toBe(`designpro://proof/${PROOF_HASH}`);
      expect(layers.activePack?.pack_version).toBe(identity.version);
      expect(layers.rows.every((row) => row.meta_metrics.source_hash === PROOF_HASH)).toBe(true);
    }
  });

  it("publishes no pack when only the canonical surfaces exist", () => {
    // Six real surfaces and six real panels, and still no proof the customer
    // approved. Nothing to publish under, so nothing is published.
    expect(build([...brandedPanels, ...qcPanels, ...canonicalSurfaces])).toBeNull();
  });

  it("publishes no pack when a side's panel is missing", () => {
    // Reporting five sides as complete is how a customer meets the sixth at
    // print time.
    const missingRear = complete.filter((a) => !(a.kind === "panel" && a.surfaceKey === "rear"));
    expect(build(missingRear)).toBeNull();
  });

  it("never substitutes one side's panel for another", () => {
    const layers = build(complete)!;
    expect(layers.rows.map((row) => row.side)).toEqual([
      "DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR",
    ]);
    for (const surface of SURFACES) {
      const row = layers.rows.find((r) => r.branding_url.endsWith(`/panel/${surface}`));
      expect(row, `no row carried the ${surface} panel`).toBeTruthy();
    }
  });

  it("keeps the branded panel and its de-logoed duplicate in separate slots", () => {
    // Call 11's qc-panel is a QC instrument. Merging the two is how a de-logoed
    // duplicate reaches print.
    const driver = build(complete)!.rows[0];
    expect(driver.branding_url).toBe("https://signed.example/panel/driver");
    expect(driver.background_url).toBe("https://signed.example/qc-panel/driver");
  });

  it("reports an honest separation gap instead of inventing a clean panel", () => {
    // Call 11 may legitimately find nothing to remove on a side. The branded
    // panel it owes the customer is unaffected.
    const noHoodRemoval = complete.map((a) =>
      a.kind === "qc-panel" && a.surfaceKey === "hood"
        ? artifact({ ...a, metadata: { removedCount: 0 } })
        : a,
    );
    const hood = build(noHoodRemoval)!.rows.find((row) => row.side === "HOOD")!;
    expect(hood.background_url).toBe("");
    expect(hood.branding_url).toBe("https://signed.example/panel/hood");
    expect(hood.meta_metrics.separation_qc).toMatchObject({ known: true, pass: false });
  });

  it("pairs each side with its own approved view", () => {
    const layers = build(complete, [view("driver", "side"), view("passenger", "passenger-side")])!;
    expect(layers.designViews.side).toBe("https://signed.example/view/driver");
    expect(layers.designViews["passenger-side"]).toBe("https://signed.example/view/passenger");
    expect(layers.designViews.roof).toBeUndefined();
  });
});
