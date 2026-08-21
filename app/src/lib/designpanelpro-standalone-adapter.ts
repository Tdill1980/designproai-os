/**
 * THE TRANSPORT SEAM BETWEEN THE DESIGNPRO UI AND THE STANDALONE RUNTIME.
 *
 * DesignPanelProPremium is the product the customer knows, and it is kept
 * exactly as it is: every control, every field, every piece of state. What
 * changes underneath it is who does the work. In RestylePro the browser
 * orchestrated the pipeline -- it invoked the render functions, it invoked the
 * 2D proof, it decided when panels were built. In the standalone runtime the
 * server owns all of that, and the browser submits a brief and then reports
 * what the server produced.
 *
 * So this file translates transport and nothing else. It does not reshape the
 * UI's data, it does not add product behaviour, and it never invents an input.
 *
 * Which artifact is which is a separate concern and lives in
 * designpro-artifact-selectors.ts, kept free of this file's transport imports
 * so it is testable without a browser. Re-exported here for one import site.
 */

import {
  dpApi,
  SOURCE_VIEW_TYPE_FOR_ROLE,
  type AssetIdentity,
  type GenerationBrief,
  type GenerationPipelineMode,
  type GenerationRequestState,
  type GenerationVehicle,
  type GenerationView,
  type RenderRole,
} from "@/lib/designpro-api";

export { CUSTOMER_PROOF_ROLE, selectCustomerProof } from "@/lib/designpro-artifact-selectors";

/**
 * Fail-closed conditions require an operator or input change. They must stop
 * the browser watcher even if an older worker incorrectly stored the request
 * as retryable; polling cannot make these conditions resolve by themselves.
 */
export const NON_RETRYABLE_GENERATION_CODES = new Set([
  "genie_dimension_validation_required",
]);

export function terminalGenerationFailureCode(state: GenerationRequestState): string | null {
  if (state.state === "outputs_ready") return null;
  if (state.state === "failed" || state.state === "cancelled") {
    return state.failureCode || `generation_${state.state}`;
  }
  return state.failureCode && NON_RETRYABLE_GENERATION_CODES.has(state.failureCode)
    ? state.failureCode
    : null;
}

export type StandaloneGenerationInput = {
  vehicle: GenerationVehicle;
  brief: string;
  designName: string;
  mode?: "restyle" | "commercial";
  businessName?: string;
  industry?: string;
  colors?: string[];
  style?: string;
  companyName?: string;
  phone?: string;
  website?: string;
  logoAsset?: AssetIdentity;
  generationId?: string;
  pipelineMode?: GenerationPipelineMode;
};

/**
 * Submit the customer's brief. Order and WrapBox recipient are deliberately
 * absent: a design is created before anyone knows where it ships, and the v2
 * contract refuses them rather than ignoring them.
 */
export async function startStandaloneGeneration(
  input: StandaloneGenerationInput,
): Promise<GenerationRequestState> {
  const brief: GenerationBrief = {
    brief: input.brief,
    mode: input.mode,
    businessName: input.businessName,
    industry: input.industry,
    colors: input.colors,
    style: input.style,
    companyName: input.companyName,
    phone: input.phone,
    website: input.website,
    logoAsset: input.logoAsset,
  };

  return dpApi.createGenerationRequest({
    generationId: input.generationId,
    designName: input.designName,
    vehicle: input.vehicle,
    brief,
    pipelineMode: input.pipelineMode,
  });
}

/**
 * Wait for the seven views. Polls rather than streams because the runtime owns
 * the work and the browser is an observer; a browser that goes to sleep here
 * costs nothing, which was not true when the tab drove the pipeline.
 */
export async function waitForGeneration(
  requestId: string,
  options: {
    timeoutMs?: number;
    signal?: AbortSignal;
    onState?: (state: GenerationRequestState) => void;
    /**
     * Optional progressive observer. The status route exposes immutable view
     * identities as each slot lands; only when that count grows do we ask the
     * signed-view route for display URLs. This is read-only polling and cannot
     * start or repeat a Gemini call.
     */
    onViews?: (views: GenerationView[]) => void | Promise<void>;
  } = {},
): Promise<GenerationRequestState> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const started = Date.now();
  let observedViewCount = 0;
  let lastViewRefreshAt = 0;
  let nextViewRetryAt = 0;

  for (;;) {
    if (options.signal?.aborted) throw new Error("generation_watch_aborted");
    const state = await dpApi.getGenerationRequest(requestId);
    options.onState?.(state);

    const viewCount = state.views?.length ?? state.shotsComplete ?? 0;
    const now = Date.now();
    const viewCountGrew = viewCount > observedViewCount;
    const signedUrlsNeedRefresh = viewCount > 0 && now - lastViewRefreshAt >= 4 * 60_000;
    const signingAttemptAllowed = now >= nextViewRetryAt;
    if (options.onViews && signingAttemptAllowed && (signedUrlsNeedRefresh || viewCountGrew)) {
      // A signed-view read cannot start generation. Retry a transient signing
      // failure after ten seconds and refresh successful URLs before their
      // five-minute lifetime expires, even if the next proof is still pending.
      try {
        await options.onViews(await dpApi.listGenerationViews(requestId));
        observedViewCount = Math.max(observedViewCount, viewCount);
        lastViewRefreshAt = Date.now();
        nextViewRetryAt = 0;
      } catch {
        // Progressive display is best-effort; generation itself is server-owned.
        nextViewRetryAt = Date.now() + 10_000;
      }
    }

    if (state.state === "outputs_ready") return state;
    const terminalFailure = terminalGenerationFailureCode(state);
    if (terminalFailure) throw new Error(terminalFailure);
    if (Date.now() - started > timeoutMs) throw new Error("generation_timeout");

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export async function listDesignPanelViews(requestId: string): Promise<GenerationView[]> {
  return dpApi.listGenerationViews(requestId);
}

export async function listFlatAtlasRevisions(requestId: string) {
  return dpApi.listFlatAtlasRevisions(requestId);
}

export async function regenerateDesignPanelView(input: {
  requestId: string;
  role: RenderRole;
  instruction?: string | null;
}) {
  return dpApi.regenerateView(
    input.requestId,
    SOURCE_VIEW_TYPE_FOR_ROLE[input.role],
    input.instruction ?? null,
  );
}

export async function handoffGeneration(requestId: string) {
  return dpApi.handoffGeneration(requestId);
}
