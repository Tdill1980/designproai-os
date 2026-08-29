import { describe, expect, it, vi } from "vitest";

// The board's module graph reaches the browser Supabase client, which builds a
// localStorage-backed auth store at import time. Same stub the other unit tests
// on this graph use; nothing here touches Supabase.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

// The board's canvas editor pulls Konva, whose node build wants the native
// `canvas` package. The counters do not touch it.
vi.mock("@/components/studioboard/StudioBoardEditor", () => ({
  default: () => null,
  StudioBoardEditTarget: {},
}));

import { studioJobFrom } from "@/lib/panelpro-studio-source";
import type {
  ApprovedGenerationView,
  FlatAtlasRevision,
  WorkflowArtifact,
  WorkflowStatus,
} from "@/lib/designpro-api";
import { atlasProgressCounts } from "./AdminGeminiCompareStudio";

/**
 * THE BOARD CONTRADICTED THE PIPELINE ON A LIVE JOB.
 *
 * 04cc0b29-0a9a-4229-b3e0-6e7428c70be4, master a4dfe5244c00cd55: PanelPro read
 * "Print panels 0/6" while RevisionStudio showed all six, and "3D proofs 8/7 -
 * All seven views saved" in GREEN on a run whose own status line says
 * failed - calls_1_7_failed and which never rendered roof or close-up.
 *
 * These fixtures are that job. They go through studioJobFrom -- the real
 * projection the board loads -- so the alias expansion, the side-key/surface-key
 * translation and the artifact filtering are the production ones, not a
 * restatement of them in a test.
 */

const CAMERAS_RENDERED = ["side", "passenger-side", "hood_detail", "front", "rear"];
const SURFACE_FOR_CAMERA: Record<string, string> = {
  side: "driver",
  "passenger-side": "passenger",
  hood_detail: "hood",
  front: "front",
  rear: "rear",
  roof: "roof",
  "close-up": "driver",
};

function view(sourceViewType: string, signedUrl = `https://signed/${sourceViewType}.png`): ApprovedGenerationView {
  return {
    id: `view-${sourceViewType}`,
    generationId: "04cc0b29-0a9a-4229-b3e0-6e7428c70be4",
    surfaceKey: SURFACE_FOR_CAMERA[sourceViewType] || "driver",
    sourceViewType,
    storagePath: `runs/04cc0b29/${sourceViewType}.png`,
    contentHash: `hash-${sourceViewType}`,
    byteSize: 1024,
    contentType: "image/png",
    signedUrl,
    expiresIn: 300,
    atlasBinding: null,
  } as ApprovedGenerationView;
}

function panelArtifact(surfaceKey: string): WorkflowArtifact {
  return {
    id: `panel-${surfaceKey}`,
    kind: "panel",
    surfaceKey,
    storagePath: `runs/04cc0b29/panels/${surfaceKey}.png`,
    contentHash: `panel-hash-${surfaceKey}`,
    contentType: "image/png",
    byteSize: 2048,
    signedUrl: `https://signed/panel-${surfaceKey}.png`,
    metadata: {},
  } as unknown as WorkflowArtifact;
}

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"];

function revision(surfaces: readonly string[] = SURFACES): FlatAtlasRevision {
  return {
    id: "revision-1",
    generationId: "04cc0b29-0a9a-4229-b3e0-6e7428c70be4",
    revisionSequence: 1,
    parentRevisionId: null,
    master: {
      contentHash: "a4dfe5244c00cd55",
      contentType: "image/png",
      byteSize: 4096,
      widthPx: 4096,
      heightPx: 4096,
      effectivePpi: 18,
    },
    guide: {
      contentHash: "guide-hash",
      contentType: "image/png",
      byteSize: 2048,
      widthPx: 4096,
      heightPx: 4096,
    },
    manifest: { contentHash: "manifest-hash", contentType: "application/json", byteSize: 512 },
    projection: { contentHash: "projection-hash", contentType: "image/jpeg", byteSize: 1024 },
    model: "gemini-3-pro-image",
    promptVersion: "atlas-artboard-designiq.20260828.v6",
    affectedSurfaces: [],
    panelMap: [],
    callOnePanels: surfaces.map((surfaceKey) => ({ surfaceKey, sourceMasterHash: "a4dfe5244c00cd55" })),
    instruction: null,
    productionEligible: true,
    exampleUsed: false,
    exampleGuideHash: null,
    exampleMasterHash: null,
    createdAt: "2026-08-26T09:40:25Z",
  } as unknown as FlatAtlasRevision;
}

function status(overrides: Partial<WorkflowStatus> = {}): WorkflowStatus {
  return {
    generationId: "04cc0b29-0a9a-4229-b3e0-6e7428c70be4",
    revisionId: "revision-1",
    designId: "DID-04CC0B29",
    orderNumber: "",
    revision: 1,
    state: "failed",
    currentStage: "calls_1_7_failed",
    stages: [],
    vehicle: { year: "2023", make: "Ford", model: "Transit 250", type: "van" },
    ...overrides,
  } as unknown as WorkflowStatus;
}

function countsFor(input: {
  cameras?: readonly string[];
  cutSurfaces?: readonly string[];
  promotedSurfaces?: readonly string[];
  job?: Partial<WorkflowStatus>;
}) {
  const views = (input.cameras ?? CAMERAS_RENDERED).map((camera) => view(camera));
  const artifacts = (input.promotedSurfaces ?? []).map((surface) => panelArtifact(surface));
  const job = studioJobFrom({
    job: status(input.job),
    views,
    artifacts,
    atlasRevisions: [revision(input.cutSurfaces ?? SURFACES)],
  });
  return {
    job,
    counts: atlasProgressCounts({
      callOnePanels: job.atlas_versions[0]?.callOnePanels,
      promotedPanels: job.concept_json?.qc_side_panels,
      views: job.raw_views,
      state: job.state,
      currentStage: job.current_stage,
      stages: job.stages,
    }),
  };
}

describe("3D proof counting", () => {
  it("counts the aliased camera and role as ONE camera", () => {
    const { job, counts } = countsFor({ cameras: ["side"] });

    // The projection publishes the same view under both names, on purpose.
    expect(job.all_view_urls.side).toBe(job.all_view_urls.driver);
    expect(Object.keys(job.all_view_urls).sort()).toEqual(["driver", "side"]);

    // Two keys, one camera.
    expect(counts.proofCameras).toEqual(["side"]);
    expect(counts.proofLabel).toBe("3D proofs 1/7");
  });

  it("displays 5/7 for the five cameras this job actually rendered", () => {
    const { job, counts } = countsFor({});

    // The defect, reproduced through the real projection: 5 views, 8 keys.
    expect(Object.keys(job.all_view_urls)).toHaveLength(8);

    expect(counts.proofLabel).toBe("3D proofs 5/7");
    expect(counts.proofDone).toBe(false);
    expect(counts.proofDetail).not.toBe("All seven views saved");
  });

  it("never displays completion for a failed job, even with seven cameras", () => {
    const seven = ["side", "passenger-side", "hood_detail", "roof", "front", "rear", "close-up"];

    const failed = countsFor({ cameras: seven }).counts;
    expect(failed.proofLabel).toBe("3D proofs 7/7");
    expect(failed.viewGenerationFailed).toBe(true);
    expect(failed.proofDone).toBe(false);
    expect(failed.proofDetail).not.toBe("All seven views saved");

    const stageFailed = countsFor({
      cameras: seven,
      job: {
        state: "running",
        currentStage: "panels.build",
        stages: [{ key: "calls_1_7", label: "Design", state: "failed" }],
      },
    }).counts;
    expect(stageFailed.proofDone).toBe(false);
    expect(stageFailed.proofDetail).not.toBe("All seven views saved");

    const succeeded = countsFor({
      cameras: seven,
      job: { state: "running", currentStage: "panels.build", stages: [] },
    }).counts;
    expect(succeeded.proofLabel).toBe("3D proofs 7/7");
    expect(succeeded.proofDone).toBe(true);
    expect(succeeded.proofDetail).toBe("All seven views saved");
  });

  it("flags an unknown camera by name instead of absorbing it", () => {
    const { counts } = countsFor({
      cameras: [...CAMERAS_RENDERED, "roof", "wheel-detail"],
      job: { state: "running", currentStage: "panels.build" },
    });
    expect(counts.unknownCameras).toEqual(["wheel-detail"]);
    expect(counts.proofDetail).toContain("wheel-detail");
    expect(counts.proofDone).toBe(false);
  });

  it("shows an eighth camera as 8/7 rather than clamping it to seven", () => {
    const { counts } = countsFor({
      cameras: [
        "side", "passenger-side", "hood_detail", "roof", "front", "rear", "close-up", "hero-3d",
      ],
      job: { state: "running", currentStage: "panels.build" },
    });
    expect(counts.proofLabel).toBe("3D proofs 8/7");
    expect(counts.proofDone).toBe(false);
    expect(counts.proofDetail).toContain("More cameras than the seven-view contract");
  });

  it("ignores a view with no signed url", () => {
    const { counts } = countsFor({ cameras: [] });
    expect(counts.proofLabel).toBe("3D proofs 0/7");
  });
});

describe("print panel counting", () => {
  it("counts six Call 1 panels as 6/6 cut when Call 9 has promoted none", () => {
    const { job, counts } = countsFor({ promotedSurfaces: [] });

    // The board's own promoted set really is empty -- the run never reached Call 9.
    expect(Object.keys(job.concept_json.qc_side_panels)).toHaveLength(0);

    expect(counts.panelLabel).toBe("Print panels 6/6");
    expect(counts.panelDone).toBe(true);
    expect(counts.promotedSurfaces).toEqual([]);
    expect(counts.panelDetail).toContain("0/6 promoted by Call 9");
  });

  it("counts six promoted artifacts as 6/6 promoted, driver and passenger included", () => {
    const { job, counts } = countsFor({ promotedSurfaces: SURFACES });

    // The promoted record is keyed by SIDE (driver_side), not by surface (driver).
    expect(Object.keys(job.concept_json.qc_side_panels).sort())
      .toEqual(["driver_side", "front", "hood", "passenger_side", "rear", "roof"]);

    expect(counts.promotedSurfaces).toEqual(SURFACES);
    expect(counts.panelDetail).toContain("6/6 promoted by Call 9");
  });

  it("reports a partial promotion honestly", () => {
    const { counts } = countsFor({ promotedSurfaces: ["driver", "hood"] });
    expect(counts.panelDetail).toContain("2/6 promoted by Call 9");
  });

  // Owner, 2026-08-29: "if six deterministic Call-1 panel artifacts do not
  // exist, the UI must say PRODUCTION PANELS NOT CREATED." The detail line used
  // to read "Cut deterministically from the accepted master" beside 0/6 -- a
  // description of what the pipeline would do, printed under the number saying
  // it had not. With `panels.build` failing closed there is no other producer,
  // so zero cut panels means exactly one thing.
  it("says PRODUCTION PANELS NOT CREATED when the revision carries no Call 1 panels", () => {
    const { counts } = countsFor({ cutSurfaces: [] });
    expect(counts.panelLabel).toBe("Print panels 0/6");
    expect(counts.panelDone).toBe(false);
    expect(counts.panelDetail).toContain("PRODUCTION PANELS NOT CREATED");
    expect(counts.panelDetail).not.toContain("Cut deterministically");
  });
});
