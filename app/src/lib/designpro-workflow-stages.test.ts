// THE HEADER MUST NEVER CLAIM A STAGE THE ARTIFACTS DO NOT SUPPORT.
//
// The owner's whole complaint was operating the pipeline by hand because the
// screens disagreed with each other about one design. So the rule this locks is
// narrow and absolute: a stage is complete only when its evidence exists, and a
// stage the owner cannot usefully open is locked WITH A REASON rather than
// rendered as a dead word.
import { describe, expect, it } from "vitest";
import {
  computeWorkflowStages,
  nextWorkflowStage,
  stageHref,
  WORKFLOW_STAGE_ORDER,
} from "./designpro-workflow-stages";
import type { WorkflowStatus } from "./designpro-api";

const GENERATION = "8555be2f-71fe-4a30-8680-653d086a213e";

function status(overrides: Partial<WorkflowStatus> = {}): WorkflowStatus {
  return {
    generationId: GENERATION,
    revisionId: "rev-1",
    designId: "DID-8555BE2F",
    orderNumber: "RP-101093",
    designName: "Precision Climate",
    brief: null,
    finish: null,
    createdAt: null,
    updatedAt: null,
    vehicle: null,
    revision: 1,
    state: "running",
    currentStage: "panels.build",
    stages: [],
    ...overrides,
  } as WorkflowStatus;
}

const full = {
  status: status(),
  hasAcceptedMaster: true,
  callOnePanelCount: 6,
  qcPassed: true,
  hasWrapboxPack: true,
  current: "wrapbox" as const,
};

describe("workflow stage model", () => {
  it("is exactly the owner's five stages, in her order", () => {
    expect(WORKFLOW_STAGE_ORDER).toEqual(["design", "revise", "panels", "qc", "wrapbox"]);
    expect(computeWorkflowStages(full).map((stage) => stage.label))
      .toEqual(["DESIGN", "REVISE", "PANELS", "QC", "WRAPBOX"]);
  });

  it("every href carries the job identity, so nothing is ever pasted by hand", () => {
    for (const stage of WORKFLOW_STAGE_ORDER) {
      expect(stageHref(stage, GENERATION)).toContain(GENERATION);
    }
    // RevisionStudio keeps its long-standing `?id=` convention — every other
    // caller in the app already uses it, and changing the route to gain a path
    // segment would break them for nothing.
    expect(stageHref("revise", GENERATION)).toBe(`/revision-studio?id=${GENERATION}`);
    expect(stageHref("panels", GENERATION)).toBe(`/designpro/jobs/${GENERATION}/panelpro/surfaces`);
    expect(stageHref("wrapbox", GENERATION)).toBe(`/designpro/wrapbox?job=${GENERATION}`);
  });

  it("a fresh job with no master locks everything past DESIGN, and says why", () => {
    const stages = computeWorkflowStages({
      ...full,
      hasAcceptedMaster: false,
      callOnePanelCount: 0,
      qcPassed: false,
      hasWrapboxPack: false,
      current: "design",
    });
    const byKey = Object.fromEntries(stages.map((stage) => [stage.key, stage]));
    expect(byKey.design.state).toBe("current");
    expect(byKey.revise.state).toBe("locked");
    expect(byKey.revise.lockedReason).toMatch(/Call 1 to accept/);
    expect(byKey.revise.href).toBeNull();
    // The owner's exact words for an empty panel set.
    expect(byKey.panels.lockedReason).toMatch(/PRODUCTION PANELS NOT CREATED/);
  });

  it("a short panel set reports the count rather than claiming the stage", () => {
    const stages = computeWorkflowStages({
      ...full, callOnePanelCount: 4, qcPassed: false, hasWrapboxPack: false, current: "design",
    });
    const panels = stages.find((stage) => stage.key === "panels")!;
    expect(panels.state).toBe("locked");
    expect(panels.lockedReason).toBe("Only 4 of 6 deterministic panels exist yet.");
  });

  it("WrapBox stays locked until QC has actually passed", () => {
    const stages = computeWorkflowStages({
      ...full, qcPassed: false, hasWrapboxPack: false, current: "panels",
    });
    const wrapbox = stages.find((stage) => stage.key === "wrapbox")!;
    expect(wrapbox.state).toBe("locked");
    expect(wrapbox.lockedReason).toMatch(/Run full QC/);
  });

  it("REVISE completes on the server's own freeze, not on a guess", () => {
    const unfrozen = computeWorkflowStages({ ...full, current: "panels" });
    expect(unfrozen.find((stage) => stage.key === "revise")!.state).toBe("available");

    const frozen = computeWorkflowStages({
      ...full,
      status: status({ stages: [{ key: "revision.freeze", label: "Freeze", state: "complete" }] }),
      current: "panels",
    });
    expect(frozen.find((stage) => stage.key === "revise")!.state).toBe("complete");
  });

  it("the current stage is highlighted rather than shown as finished", () => {
    // Standing on a completed screen must not read as "you are done here".
    const stages = computeWorkflowStages({ ...full, current: "panels" });
    expect(stages.find((stage) => stage.key === "panels")!.state).toBe("current");
    expect(stages.find((stage) => stage.key === "design")!.state).toBe("complete");
  });

  it("names the next reachable stage for the obvious next-step button", () => {
    const stages = computeWorkflowStages({ ...full, current: "panels" });
    expect(nextWorkflowStage(stages)?.key).toBe("qc");

    const blocked = computeWorkflowStages({
      ...full, qcPassed: false, hasWrapboxPack: false, current: "qc",
    });
    // QC has not passed, so there is nowhere legitimate to go next.
    expect(nextWorkflowStage(blocked)).toBeNull();
  });
});
