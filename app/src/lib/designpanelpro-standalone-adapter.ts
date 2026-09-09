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

function generationReadStatus(error: unknown): number {
  return Number((error as { status?: unknown } | null)?.status) || 0;
}

function transientGenerationReadFailure(error: unknown): boolean {
  const status = generationReadStatus(error);
  if (status) return status === 408 || status === 429 || (status >= 500 && status <= 599);
  return error instanceof Error && (
    error.name === "TimeoutError"
    || (error.name === "TypeError" && /fetch|network|load failed/i.test(error.message))
  );
}

/** Missing pixels are not a proof-review verdict. Only recorded failed slots
 * can be described as failed; transport errors never create that evidence. */
export function incompleteGenerationMessage({
  state, error, availableViews, missingViews,
}: {
  state: GenerationRequestState | null;
  error: unknown;
  availableViews: number;
  missingViews: Array<{ sourceViewType: string; label: string }>;
}): string {
  const status = generationReadStatus(error);
  if (status === 401) return "Sign in again to refresh this saved design. No new generation was started.";
  if (status === 403) return "You do not have access to refresh this design.";
  const failed = new Set((state?.failedShots || []).map((shot) => shot.sourceViewType));
  const refused = missingViews.filter((view) => failed.has(view.sourceViewType));
  const remaining = missingViews.filter((view) => !failed.has(view.sourceViewType));
  const messages = [`${availableViews} of 7 views available.`];
  if (refused.length) messages.push(`${refused.map((view) => view.label).join(" and ")} could not be completed; the saved status reports ${refused.length === 1 ? "this view" : "these views"} as failed.`);
  if (remaining.length) {
    const names = remaining.map((view) => view.label).join(" and ");
    const running = state && ["queued", "leased", "retryable"].includes(state.state);
    messages.push(running ? `Still waiting for ${names}.` : `${names} ${remaining.length === 1 ? "is" : "are"} not yet available.`);
  }
  if (transientGenerationReadFailure(error) || (error as Error | null)?.message === "generation_timeout") {
    messages.push("The latest status could not be refreshed. Reopen this saved design to check for further views.");
  }
  messages.push("Your saved design is preserved.");
  return messages.join(" ");
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
  finish?: string;
  substrate?: string;
  mascot?: string;
  bulletPoints?: string[];
  brandColors?: string;
  fontStyle?: string;
  qrEnabled?: boolean;
  qrUrl?: string;
  visionBoardImages?: AssetIdentity[];
  visionboardIntent?: "exact_reference" | "style_inspiration" | "artboard_projection";
  styleDescriptors?: string;
  textLayerPrompt?: string;
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
    finish: input.finish,
    substrate: input.substrate,
    mascot: input.mascot,
    bulletPoints: input.bulletPoints,
    brandColors: input.brandColors,
    fontStyle: input.fontStyle,
    qrEnabled: input.qrEnabled,
    qrUrl: input.qrUrl,
    visionBoardImages: input.visionBoardImages,
    visionboardIntent: input.visionboardIntent,
    styleDescriptors: input.styleDescriptors,
    textLayerPrompt: input.textLayerPrompt,
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
    /** Read connection state only; never changes the persisted generation. */
    onConnectionState?: (state: "connected" | "reconnecting") => void;
  } = {},
): Promise<GenerationRequestState> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const deadline = Date.now() + timeoutMs;
  let observedViewCount = 0;
  let lastViewRefreshAt = 0;
  let nextViewRetryAt = 0;
  let readFailures = 0;

  // Bound even an unresolved GET by the existing watcher deadline. A timeout
  // stops observation only: it cannot cancel or restart server generation.
  async function beforeDeadline<T>(read: () => Promise<T>): Promise<T> {
    if (options.signal?.aborted) throw new Error("generation_watch_aborted");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("generation_timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const boundary = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("generation_timeout")), remaining);
      onAbort = () => reject(new Error("generation_watch_aborted"));
      options.signal?.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return await Promise.race([read(), boundary]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort) options.signal?.removeEventListener("abort", onAbort);
    }
  }

  async function pause(milliseconds: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await beforeDeadline(() => new Promise<void>((resolve) => {
        timer = setTimeout(resolve, milliseconds);
      }));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  for (;;) {
    let state: GenerationRequestState;
    try {
      state = await beforeDeadline(() => dpApi.getGenerationRequest(requestId));
    } catch (error) {
      if (options.signal?.aborted) throw new Error("generation_watch_aborted");
      if (!transientGenerationReadFailure(error)) throw error;
      readFailures += 1;
      options.onConnectionState?.("reconnecting");
      await pause(Math.min(2000 * (2 ** Math.min(readFailures - 1, 3)), 10_000));
      continue;
    }
    readFailures = 0;
    options.onConnectionState?.("connected");
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
        const views = await beforeDeadline(() => dpApi.listGenerationViews(requestId));
        await beforeDeadline(async () => { await options.onViews!(views); });
        observedViewCount = Math.max(observedViewCount, viewCount);
        lastViewRefreshAt = Date.now();
        nextViewRetryAt = 0;
      } catch (error) {
        if (options.signal?.aborted) throw new Error("generation_watch_aborted");
        if (generationReadStatus(error) === 401 || generationReadStatus(error) === 403
          || (error as Error | null)?.message === "generation_timeout") throw error;
        // Progressive display is best-effort; generation itself is server-owned.
        nextViewRetryAt = Date.now() + 10_000;
      }
    }

    if (state.state === "outputs_ready") return state;
    const terminalFailure = terminalGenerationFailureCode(state);
    if (terminalFailure) throw new Error(terminalFailure);
    await pause(2000);
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
