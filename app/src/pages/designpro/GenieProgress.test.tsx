import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/designpro-api", () => ({
  dpApi: {},
  PRODUCTION_SURFACES: ["driver", "passenger", "hood", "roof", "front", "rear"],
  RENDER_ROLES: [
    "driver",
    "passenger",
    "hood",
    "roof",
    "front",
    "rear",
    "closeup",
  ],
  SOURCE_VIEW_TYPE_FOR_ROLE: {},
  SURFACE_LABEL: {},
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {} } }));
import {
  GenieBuildRail,
  GeniePanelOutputProgress,
  readGenieProgress,
  selectGenerationPanelOutput,
} from "./GenieProgress";
import type { PanelOutputRun } from "@/lib/panelpro-file-output-api";
import type {
  ApprovedGenerationView,
  GenerationProgress,
  WorkflowArtifact,
  WorkflowStatus,
} from "@/lib/designpro-api";

const progress: GenerationProgress = {
  contract: "designpro.public-generation-progress.v1",
  generationId: "existing-generation",
  currentRevisionId: "current-atlas",
  revisionSequence: 2,
  generationState: "leased",
  artifactIds: [],
  workflowRevisionIds: [],
  facts: {
    masterSaved: true,
    productionRunLinked: false,
    panelCount: 0,
    productionProofReady: false,
    packageReady: false,
  },
  updatedAt: "2026-09-08T10:00:00Z",
  stages: [
    {
      key: "generation.artwork",
      label: "ATLAS artwork",
      explanation: "Your artwork has been saved.",
      state: "complete",
      dependsOn: [],
    },
    {
      key: "generation.proofs",
      label: "Vehicle proofs",
      explanation: "Creating the vehicle views from your saved artwork.",
      state: "running",
      dependsOn: ["generation.artwork"],
    },
  ],
};
const noWorkflow = Object.assign(new Error("No workflow yet"), { status: 404 });
const child: PanelOutputRun = {
  id: "physical-current",
  sourceApp: "DesignPro",
  sourceJobId: "existing-generation",
  generationId: "existing-generation",
  atlasRevisionId: "current-atlas",
  revisionId: "manufacturing-id",
  status: "waiting",
  stages: [
    { key: "template.lookup", state: "completed", dependsOn: [] },
    {
      key: "panelprofileoutput.plan",
      state: "waiting",
      dependsOn: ["template.lookup", "source.verify"],
    },
  ],
  previews: [],
  pieces: [],
  blockers: [],
};

describe("GENIE generation and production reporting", () => {
  it("reports a saved proof set whose preparation handoff needs attention", () => {
    const stalled: GenerationProgress = { ...progress, generationState: "outputs_ready", facts: { ...progress.facts, handoffNeedsAttention: true }, stages: [
      ...progress.stages.map((stage) => ({ ...stage, state: "complete" as const })),
      { key: "generation.handoff", label: "Production preparation", explanation: "Your artwork and vehicle proofs are saved. Production preparation needs attention.", state: "attention", dependsOn: ["generation.proofs"] },
    ] };
    const html = renderToStaticMarkup(<GenieBuildRail progress={stalled} availableViewCount={7} />);
    expect(html).toContain("Production preparation needs attention");
    expect(html).toContain("Needs attention");
    expect(html).not.toContain("QC approved");
  });
  it("narrates before a manufacturing job exists without claiming master presence is seven proofs or finished production", () => {
    const html = renderToStaticMarkup(
      <GenieBuildRail progress={progress} availableViewCount={2} />,
    );
    expect(html).toContain("ATLAS artwork");
    expect(html).toContain("Vehicle proofs");
    expect(html).toContain("2 of 7 vehicle angles available");
    expect(html).toContain("In progress");
    expect(html).not.toContain("QC approved");
    expect(html).not.toContain('role="progressbar"');
  });
  it("a completed request cannot make six visible angles look like seven current proofs", () => {
    const completed = {
      ...progress,
      stages: progress.stages.map((row) => ({
        ...row,
        state: "complete" as const,
      })),
    };
    const html = renderToStaticMarkup(
      <GenieBuildRail progress={completed} availableViewCount={6} />,
    );
    expect(html).toContain("6 of 7 vehicle angles available");
    expect(html).toContain("Some vehicle angles are still unavailable");
    expect(html).toContain("Needs attention");
  });
  it("starts generation, production and child readers together and treats pre-handoff workflow 404s as expected", async () => {
    const starts: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = readGenieProgress(
      "existing-generation",
      {
        getStatus: async () => {
          starts.push("status");
          await gate;
          throw noWorkflow;
        },
        getGenerationProgress: async () => {
          starts.push("progress");
          await gate;
          return progress;
        },
        listApprovedViews: async () => {
          starts.push("views");
          await gate;
          return [];
        },
        listArtifacts: async () => {
          starts.push("artifacts");
          await gate;
          throw noWorkflow;
        },
      },
      {
        list: async () => {
          starts.push("panelOutput");
          await gate;
          return [];
        },
      },
    );
    expect(starts).toHaveLength(5);
    release();
    const patch = await result;
    expect(patch.progress).toBe(progress);
    expect(patch).not.toHaveProperty("job");
    expect(patch).not.toHaveProperty("artifacts");
    expect(patch.loadError).toBe(false);
  });
  it("a failed reader never clears the last successfully received views, artifacts or progress", async () => {
    const previous = {
      views: [{ id: "saved-view" }] as ApprovedGenerationView[],
      artifacts: [{ id: "saved-panel" }] as WorkflowArtifact[],
      progress,
      loadError: false,
    };
    const patch = await readGenieProgress("existing-generation", {
      getStatus: async () =>
        ({ generationId: "existing-generation", stages: [] }) as WorkflowStatus,
      getGenerationProgress: async () => {
        throw new Error("temporary unavailable");
      },
      listApprovedViews: async () => {
        throw new Error("temporary unavailable");
      },
      listArtifacts: async () => {
        throw new Error("temporary unavailable");
      },
    });
    const next = { ...previous, ...patch };
    expect(next.views).toBe(previous.views);
    expect(next.artifacts).toBe(previous.artifacts);
    expect(next.progress).toBe(previous.progress);
    expect(next.loadError).toBe(true);
    expect(next.job?.generationId).toBe("existing-generation");
  });
  it("selects a child only by this generation and exact current ATLAS revision", () => {
    const old = {
      ...child,
      id: "old-child",
      atlasRevisionId: "old-atlas",
      status: "completed",
      createdAt: "2026-09-08T12:00:00Z",
    };
    expect(
      selectGenerationPanelOutput(
        [old, child],
        "existing-generation",
        "current-atlas",
      ),
    ).toBe(child);
    expect(
      selectGenerationPanelOutput(
        [old],
        "existing-generation",
        "current-atlas",
      ),
    ).toBeNull();
    expect(
      selectGenerationPanelOutput(
        [{ ...child, atlasRevisionId: null }],
        "existing-generation",
        "current-atlas",
      ),
    ).toBeNull();
    expect(
      selectGenerationPanelOutput([child], "other-generation", "current-atlas"),
    ).toBeNull();
  });
  it("shows the real branded template before its overlay and keeps raw templates and internal files out of GENIE", () => {
    const preview = {
      id: "overlay",
      role: "template-overlay",
      signedUrl: "https://files.test/overlay.png",
      contentHash: "a".repeat(64),
      profileHash: "b".repeat(64),
      approvedDisplay: true,
      geometryValidated: true,
      provenance: "generated-branded",
    };
    const html = renderToStaticMarkup(
      <StaticRouter location="/designpro/jobs/existing-generation/genie">
        <GeniePanelOutputProgress
          run={{
            ...child,
            previews: [
              preview,
              {
                ...preview,
                id: "template",
                role: "branded-template",
                signedUrl: "https://files.test/branded.png",
              },
              {
                ...preview,
                id: "raw",
                approvedDisplay: false,
                signedUrl: "https://files.test/private-original.png",
              },
            ],
            files: [
              {
                id: "internal",
                signedUrl: "https://files.test/internal.tiff",
                contentHash: "c".repeat(64),
              },
            ],
          }}
        />
      </StaticRouter>,
    );
    expect(html.indexOf('src="https://files.test/branded.png"')).toBeLessThan(
      html.indexOf('src="https://files.test/overlay.png"'),
    );
    expect(html).not.toContain("private-original.png");
    expect(html).not.toContain("internal.tiff");
    expect(html).toContain("1 of 2 reported steps complete");
    expect(html).toContain("Cut areas stay filled with background artwork");
  });
  it("an optional child service outage does not erase previews or mark the main pipeline refresh failed", async () => {
    const previous = { panelOutputRuns: [child] };
    const patch = await readGenieProgress(
      "existing-generation",
      {
        getStatus: async () => {
          throw noWorkflow;
        },
        getGenerationProgress: async () => progress,
        listApprovedViews: async () => [],
        listArtifacts: async () => [],
      },
      {
        list: async () => {
          throw Object.assign(new Error("unavailable"), { status: 503 });
        },
      },
    );
    expect({ ...previous, ...patch }.panelOutputRuns).toBe(
      previous.panelOutputRuns,
    );
    expect(patch.loadError).toBe(false);
    expect(patch.panelOutputError).toBe(true);
  });
});
