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
  options: { timeoutMs?: number; signal?: AbortSignal; onState?: (state: GenerationRequestState) => void } = {},
): Promise<GenerationRequestState> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const started = Date.now();

  for (;;) {
    if (options.signal?.aborted) throw new Error("generation_watch_aborted");
    const state = await dpApi.getGenerationRequest(requestId);
    options.onState?.(state);

    if (state.state === "outputs_ready") return state;
    if (state.state === "failed" || state.state === "cancelled") {
      throw new Error(state.failureCode || `generation_${state.state}`);
    }
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
