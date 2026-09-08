import type { WorkflowStatus, WorkflowArtifact } from './designpro-api';
export type PresentedState = 'complete' | 'running' | 'waiting' | 'failed' | 'pending' | 'attention' | 'retrying' | 'cancelled' | 'skipped';
export function presentWorkflowStages(stages?: WorkflowStatus['stages']): Array<{
  key: string; label: string; explanation: string; state: PresentedState; dependsOn: string[] | null;
}>;
export function publicBuildPreviews(artifacts?: WorkflowArtifact[]): Array<{
  id: string; role: string; label: string; order: number; signedUrl: string; surfaceKey: string; contentHash: string;
}>;
export function productionProgressMessage(job: WorkflowStatus | undefined, hasZip: boolean): string;
