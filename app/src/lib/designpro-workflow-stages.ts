/**
 * ONE JOB, ONE IDENTITY, FIVE EXISTING SURFACES.
 *
 * Owner directive (Trish 2026-08-29): "I should never have to copy/paste a
 * Generation ID. The job identity must persist automatically through the
 * entire workflow: Design Generation → RevisionStudioIQ → PanelProStudio →
 * QC → WrapBox."
 *
 * Every screen in that path already exists and is already correct. What was
 * missing was the thread between them: `DesignPanelProPremium` navigated to
 * `/revision-studio` with NO id at all, RevisionStudio had no approve-and-
 * continue, PanelPro had no way to reach QC as a report, and WrapBox is keyed
 * by pack rather than by job. So the owner supplied the identity by hand at
 * four boundaries.
 *
 * This module is the thread, and it is deliberately PURE: no React, no fetch,
 * no routing side effects. It answers two questions from one server object —
 * where does this job stand, and where does each stage live — so both the
 * breadcrumb and the stage buttons read the same answer instead of each
 * deriving their own. Three independently-computed answers about one design is
 * exactly the failure RULE 0.27 records ("Print panels 0/6" beside a populated
 * Production Pack column, "3D proofs 8/7" on a failed run).
 *
 * WHAT IT IS NOT. It is not a new workflow engine. The server's stage list
 * (`designpro_workflow_stages`, projected onto `WorkflowStatus.stages`) remains
 * the only authority on what has actually happened; this maps those stages onto
 * the five words the owner uses. A stage is complete here only when the server
 * says its evidence exists.
 */

import type { WorkflowStatus } from "@/lib/designpro-api";

export type WorkflowStageKey = "design" | "revise" | "panels" | "qc" | "wrapbox";

export type WorkflowStageState = "locked" | "available" | "current" | "complete";

export type WorkflowStageView = {
  key: WorkflowStageKey;
  label: string;
  state: WorkflowStageState;
  /** Where clicking this stage goes for THIS job. Null while it is locked. */
  href: string | null;
  /** Why it is locked, in the owner's words rather than a stage key. */
  lockedReason: string | null;
};

export const WORKFLOW_STAGE_ORDER: WorkflowStageKey[] = [
  "design",
  "revise",
  "panels",
  "qc",
  "wrapbox",
];

const STAGE_LABELS: Record<WorkflowStageKey, string> = {
  design: "DESIGN",
  revise: "REVISE",
  panels: "PANELS",
  qc: "QC",
  wrapbox: "WRAPBOX",
};

/**
 * Where each stage lives, for one job.
 *
 * These are the EXISTING routes, unchanged. `revise` is the one that carries
 * its id as a query rather than a path segment, because `/revision-studio` is
 * the product editor's own long-standing route and `?id=` is the convention
 * every other caller in the app already uses (`DesignProToolUI`,
 * `ServerRevisionStudio`, `ProductionFlow`). Changing that route would break
 * every one of them to gain nothing.
 */
export function stageHref(stage: WorkflowStageKey, generationId: string): string {
  const id = encodeURIComponent(String(generationId || "").trim());
  switch (stage) {
    case "design":
      return `/designpro/jobs/${id}`;
    case "revise":
      return `/revision-studio?id=${id}`;
    case "panels":
      return `/designpro/jobs/${id}/panelpro/surfaces`;
    case "qc":
      return `/designpro/jobs/${id}/panelpro/surfaces#qc`;
    case "wrapbox":
      return `/designpro/wrapbox?job=${id}`;
    default:
      return `/designpro/jobs/${id}`;
  }
}

function serverStage(status: WorkflowStatus | null | undefined, key: string) {
  return (status?.stages || []).find((stage) => stage.key === key) || null;
}

function stageComplete(status: WorkflowStatus | null | undefined, key: string): boolean {
  return serverStage(status, key)?.state === "complete";
}

/**
 * THE EVIDENCE EACH STAGE STANDS ON.
 *
 * Deliberately not a counter and not a cursor — a stage is complete when the
 * artifact that proves it exists, so a job can be re-opened at any point and
 * the header tells the truth without remembering anything.
 *
 * `design` is complete once Call 1 has an accepted master. That is the only
 * evidence that matters and it is available BEFORE any proof renders (RULE
 * 0.21: the accepted master fans out immediately), so the owner can move on
 * while the seven proofs are still rendering rather than waiting on them.
 *
 * `panels` is complete when the six deterministic Call-1 panels exist. Since
 * 2026-08-29 there is no other producer — `panels.build` fails closed with
 * `production_panels_not_created` — so their existence is unambiguous.
 */
export function computeWorkflowStages(input: {
  status: WorkflowStatus | null | undefined;
  /** True once Call 1 has an accepted, QC-passed master for this generation. */
  hasAcceptedMaster: boolean;
  /** How many of the six canonical Call-1 panels exist. */
  callOnePanelCount: number;
  /** True once the deterministic panel QC report passed on the current panels. */
  qcPassed: boolean;
  /** True once a WrapBox pack exists for this job. */
  hasWrapboxPack: boolean;
  current: WorkflowStageKey;
}): WorkflowStageView[] {
  const { status, hasAcceptedMaster, callOnePanelCount, qcPassed, hasWrapboxPack, current } = input;
  const generationId = String(status?.generationId || "").trim();

  const designDone = hasAcceptedMaster;
  // A revision is "done" for breadcrumb purposes once the design has been
  // frozen for manufacturing. `revision.freeze` is the server's own word for
  // it, so the header cannot disagree with the pipeline.
  const reviseDone = designDone && stageComplete(status, "revision.freeze");
  const panelsDone = callOnePanelCount >= 6;
  const qcDone = panelsDone && qcPassed;
  const wrapboxDone = hasWrapboxPack;

  const done: Record<WorkflowStageKey, boolean> = {
    design: designDone,
    revise: reviseDone,
    panels: panelsDone,
    qc: qcDone,
    wrapbox: wrapboxDone,
  };

  // REACHABILITY IS NOT COMPLETION, AND A LOCK MUST SAY WHY.
  //
  // A stage is reachable when the thing it operates on exists. Revise needs a
  // design; panels need the six cut panels; QC needs panels to check; WrapBox
  // needs QC to have passed. Anything else is a dead click into an empty screen,
  // which is what sent the owner back to SQL.
  const reachable: Record<WorkflowStageKey, { ok: boolean; reason: string | null }> = {
    design: { ok: Boolean(generationId), reason: generationId ? null : "No design yet." },
    revise: {
      ok: designDone,
      reason: designDone ? null : "Waiting for Call 1 to accept the A.T.L.A.S. master.",
    },
    panels: {
      ok: panelsDone,
      reason: panelsDone
        ? null
        : callOnePanelCount > 0
          ? `Only ${callOnePanelCount} of 6 deterministic panels exist yet.`
          : "PRODUCTION PANELS NOT CREATED — no deterministic Call-1 panel exists for this design.",
    },
    qc: {
      ok: panelsDone,
      reason: panelsDone ? null : "There are no production panels to check.",
    },
    wrapbox: {
      ok: qcDone,
      reason: qcDone ? null : "Run full QC on the six panels first.",
    },
  };

  return WORKFLOW_STAGE_ORDER.map((key) => {
    const isCurrent = key === current;
    const canOpen = reachable[key].ok;
    // CURRENT WINS OVER COMPLETE. The owner is standing on this screen; showing
    // it as a finished step they might click away from reads as "you are done
    // here" on the page they are working in.
    const state: WorkflowStageState = isCurrent
      ? "current"
      : done[key]
        ? "complete"
        : canOpen
          ? "available"
          : "locked";
    return {
      key,
      label: STAGE_LABELS[key],
      state,
      href: canOpen && generationId ? stageHref(key, generationId) : null,
      lockedReason: canOpen ? null : reachable[key].reason,
    };
  });
}

/**
 * The stage the owner should be sent to next, given where the job stands.
 *
 * Used by the "obvious next-step button" on each screen so the label and the
 * destination are one decision rather than five hard-coded ones.
 */
export function nextWorkflowStage(stages: WorkflowStageView[]): WorkflowStageView | null {
  const current = stages.findIndex((stage) => stage.state === "current");
  for (let index = current + 1; index < stages.length; index += 1) {
    if (stages[index].href) return stages[index];
  }
  return null;
}
