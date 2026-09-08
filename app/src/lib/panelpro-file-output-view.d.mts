import type {
  PanelOutputPreview,
  PanelOutputStage,
} from "./panelpro-file-output-api";
export function panelOutputStageCopy(key: string): [string, string];
export function panelOutputBlockerCopy(code: string): string;
export function panelOutputStageState(state: string): string;
export function panelOutputProgress(stages: readonly PanelOutputStage[]): {
  complete: number;
  total: number;
  percent: number | null;
};
export function panelOutputPreviews(
  previews: readonly PanelOutputPreview[],
): Array<PanelOutputPreview & { label: string }>;
export function panelOutputSafeReviewUrl(
  url?: string,
  generationId?: string,
): string | null;
export function panelOutputRevisionHref(continuation: unknown, generationId?: string, panelOutputRunId?: string, atlasRevisionId?: string | null): string | null;
