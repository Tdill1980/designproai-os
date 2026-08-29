/**
 * THE PERSISTENT WORKFLOW HEADER: DESIGN → REVISE → PANELS → QC → WRAPBOX.
 *
 * Owner directive (Trish 2026-08-29): "Put a persistent workflow
 * header/breadcrumb on these existing pages. Completed stages get a check.
 * Current stage is highlighted. Clicking a completed stage takes me back to
 * that existing screen for this same job."
 *
 * It is one component mounted on the five EXISTING screens — it does not
 * replace or wrap any of them, and it renders no job content of its own. Its
 * whole job is to carry the identity, so the owner never types or pastes a
 * Generation ID to move between surfaces.
 *
 * ONE SOURCE, NOT FIVE. Every stage's state comes from
 * `computeWorkflowStages`, reading the server's own `WorkflowStatus.stages`
 * plus the two artifact facts (accepted master, six Call-1 panels). No screen
 * computes its own answer. Three independently-derived answers about one design
 * is precisely the failure RULE 0.27 records, and the fix there was one lineage
 * published many times rather than many reconstructions.
 *
 * A LOCKED STAGE SAYS WHY. An unreachable stage is not a dead grey word: it
 * carries the reason in its tooltip and, on the current screen, as text. The
 * owner's complaint that sent this work here was having to leave the UI to find
 * out where a job actually stood.
 */
import { Link } from "react-router-dom";
import { Check, ChevronRight, Lock } from "lucide-react";
import {
  computeWorkflowStages,
  type WorkflowStageKey,
  type WorkflowStageView,
} from "@/lib/designpro-workflow-stages";
import type { WorkflowStatus } from "@/lib/designpro-api";
import { cn } from "@/lib/utils";

export type WorkflowBreadcrumbProps = {
  status: WorkflowStatus | null | undefined;
  current: WorkflowStageKey;
  hasAcceptedMaster: boolean;
  callOnePanelCount: number;
  qcPassed: boolean;
  hasWrapboxPack: boolean;
  /** Shown beside the rail so the job is identifiable without opening anything. */
  designId?: string | null;
  className?: string;
};

function stageClasses(state: WorkflowStageView["state"]): string {
  switch (state) {
    case "current":
      return "bg-gradient-to-r from-blue-500 to-fuchsia-500 text-white shadow-sm";
    case "complete":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100";
    case "available":
      return "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50";
    default:
      return "bg-gray-50 text-gray-400 ring-1 ring-gray-100 cursor-not-allowed";
  }
}

function StageChip({ stage }: { stage: WorkflowStageView }) {
  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors",
        stageClasses(stage.state),
      )}
    >
      {stage.state === "complete" && <Check className="h-3.5 w-3.5" aria-hidden />}
      {stage.state === "locked" && <Lock className="h-3 w-3" aria-hidden />}
      {stage.label}
    </span>
  );

  // A stage with no href is not a link. Rendering it as one and swallowing the
  // click is how a UI teaches people that clicking does nothing.
  if (!stage.href || stage.state === "current") {
    return (
      <span
        title={stage.lockedReason || undefined}
        aria-current={stage.state === "current" ? "step" : undefined}
        aria-disabled={stage.state === "locked" || undefined}
      >
        {content}
      </span>
    );
  }
  return (
    <Link to={stage.href} title={`Open ${stage.label} for this job`}>
      {content}
    </Link>
  );
}

export function WorkflowBreadcrumb({
  status,
  current,
  hasAcceptedMaster,
  callOnePanelCount,
  qcPassed,
  hasWrapboxPack,
  designId,
  className,
}: WorkflowBreadcrumbProps) {
  const stages = computeWorkflowStages({
    status,
    hasAcceptedMaster,
    callOnePanelCount,
    qcPassed,
    hasWrapboxPack,
    current,
  });
  const currentStage = stages.find((stage) => stage.key === current);
  const blocked = stages.find((stage) => stage.state === "locked" && stage.lockedReason);

  return (
    <nav
      aria-label="DesignProAI workflow"
      className={cn(
        "sticky top-0 z-30 w-full border-b border-gray-200 bg-white/95 backdrop-blur",
        className,
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5">
        {stages.map((stage, index) => (
          <span key={stage.key} className="inline-flex items-center gap-2">
            {index > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-300" aria-hidden />}
            <StageChip stage={stage} />
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3 text-xs text-gray-500">
          {designId && <span className="font-mono font-semibold text-gray-700">{designId}</span>}
          {status?.orderNumber && <span className="font-mono">{status.orderNumber}</span>}
        </span>
      </div>
      {/* The reason the next step is not available yet, on the screen the owner
          is standing on, rather than in a tooltip they have to hunt for. */}
      {currentStage?.state === "current" && blocked?.lockedReason && (
        <p className="mx-auto max-w-7xl px-4 pb-2 text-xs text-gray-500">
          <span className="font-semibold text-gray-700">{blocked.label}:</span> {blocked.lockedReason}
        </p>
      )}
    </nav>
  );
}

export default WorkflowBreadcrumb;
