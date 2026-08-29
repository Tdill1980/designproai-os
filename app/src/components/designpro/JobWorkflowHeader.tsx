/**
 * ONE LINE PER SCREEN.
 *
 * `WorkflowBreadcrumb` is pure presentation and `useDesignProJob` is the single
 * read; this joins them so each of the five existing pages mounts the header
 * with one element and no new state of its own. That matters more than it
 * looks: RevisionStudioIQ is 7,500 lines and AdminGeminiCompareStudio 4,400,
 * and the way a cross-cutting header rots is by growing a slightly different
 * copy of its data-loading inside each host.
 *
 * It renders NOTHING without a job id — these screens are also reachable
 * without one (RevisionStudio's library, the WrapBox list), and a header for a
 * job that was never named would be inventing an identity rather than carrying
 * one.
 */
import { WorkflowBreadcrumb } from "@/components/designpro/WorkflowBreadcrumb";
import { useDesignProJob } from "@/hooks/useDesignProJob";
import type { WorkflowStageKey } from "@/lib/designpro-workflow-stages";

export type JobWorkflowHeaderProps = {
  generationId: string | null | undefined;
  current: WorkflowStageKey;
  /**
   * Whether the deterministic panel QC has passed for the panels on screen.
   * The host owns this because only PanelPro actually runs the report; every
   * other screen passes the last recorded verdict, or false.
   */
  qcPassed?: boolean;
  className?: string;
};

export function JobWorkflowHeader({
  generationId,
  current,
  qcPassed = false,
  className,
}: JobWorkflowHeaderProps) {
  const job = useDesignProJob(generationId);
  if (!job.generationId) return null;
  return (
    <WorkflowBreadcrumb
      status={job.status}
      current={current}
      hasAcceptedMaster={job.hasAcceptedMaster}
      callOnePanelCount={job.callOnePanelCount}
      qcPassed={qcPassed}
      hasWrapboxPack={Boolean(job.wrapboxPack)}
      designId={job.designId}
      className={className}
    />
  );
}

export default JobWorkflowHeader;
