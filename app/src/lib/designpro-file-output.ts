import { supabase } from "@/integrations/supabase/client";

export const ENTICE_WORKFLOW_TYPE = "designpro.entice_pack" as const;
export const PRODUCTION_WORKFLOW_TYPE =
  "designpro.production_pack" as const;

export type EnticeRevisionTrigger =
  | "initial_generation"
  | "revision_saved"
  | "precise_edit"
  | "missing_views_completed"
  | "view_regenerated"
  | "view_deleted"
  | "finish_fixed"
  | "passenger_mirrored"
  // The design is unchanged; the operator is asking the server to build a proof
  // for it. RevisionStudio's "Build 2D Production Proof" button has always sent
  // this, but it was in neither this union nor run-production-flow's
  // allowedTriggers set — so it type-errored here and save_revision would have
  // refused it as `invalid_trigger`. Only the start path, which never validated
  // the trigger, let it through at all.
  | "proof_requested";

export interface SubmitEnticeRevisionInput {
  visualizationId: string;
  expectedUpdatedAt: string;
  generationId?: string;
  trigger: EnticeRevisionTrigger;
  change?: {
    type: "generate" | "edit" | "revision";
    prompt?: string | null;
    viewKeys?: string[];
  };
  idempotencyKey?: string;
}

export interface SaveEnticeRevisionInput {
  visualizationId: string;
  /** Optimistic CAS token from the exact row state being edited. */
  expectedUpdatedAt: string;
  /** Complete frozen view map for this immutable revision. */
  renderUrls: Record<string, string>;
  /** Shallow JSON merge applied to admin_notes in the same transaction. */
  adminNotesPatch?: Record<string, unknown>;
  generationId?: string;
  trigger: EnticeRevisionTrigger;
  change?: {
    type: "generate" | "edit" | "revision";
    prompt?: string | null;
    viewKeys?: string[];
  };
  /** Explicit column updates supported by the atomic RPC. */
  vehicleType?: string | null;
  finishType?: string | null;
  idempotencyKey?: string;
}

export interface EnticePackAccepted {
  success: true;
  accepted: true;
  workflowType: typeof ENTICE_WORKFLOW_TYPE;
  revisionId: string;
  designId: string;
  visualizationId: string;
  versionNumber: number;
  enticePackId: string;
  dimensionManifestId: string;
  workflowRun: { id: string; [key: string]: unknown };
  idempotent: boolean;
  submissionHash: string;
}

export interface SavedEnticeRevision extends EnticePackAccepted {
  saved: true;
  /** Authoritative CAS token minted by the atomic save/enqueue transaction. */
  updatedAt: string;
}

export interface SubmitProductionPackInput {
  jobId: string;
  generationId?: string;
  enticePackId?: string;
  orderRequestId?: string;
  idempotencyKey?: string;
}

export interface ProductionPackAccepted {
  success: true;
  accepted: true;
  productionJob: { id: string; [key: string]: unknown };
  workflowRun: { id: string; [key: string]: unknown };
  idempotent: boolean;
  submissionHash: string;
  revisionId: string;
  enticePackId: string;
  dimensionManifestId: string;
  sourceContractHash: string;
}

function functionError(
  data: Record<string, unknown> | null | undefined,
  fallback?: string,
) {
  const message =
    typeof data?.error === "string" && data.error.trim()
      ? data.error
      : fallback || "DesignPro workflow request failed";
  const error = new Error(message) as Error & { code?: string };
  if (data && typeof data === "object") {
    Object.assign(error, data);
  }
  if (typeof data?.code === "string") error.code = data.code;
  return error;
}

/**
 * Resolve the REAL server error for a failed edge call.
 *
 * `supabase.functions.invoke` returns `data: null` on any non-2xx and an error
 * whose message is the fixed string "Edge Function returned a non-2xx status
 * code" — the actual body is only reachable through `error.context`. So a call
 * site that throws `functionError(data, error?.message)` reports nothing: the
 * response body it reads is null, and the fallback is that constant.
 *
 * Live-observed 2026-07-31: a DesignPro pack failed with `honest_panel_gap` /
 * "No proof-fed extraction passed QC for: FRONT", and a resubmit 409'd with
 * "Explicit retryFailed=true is required for a failed workflow". The operator
 * saw "Edge Function returned a non-2xx status code" for both, while the real
 * reasons sat in `workforce_runs` and `designpro_entice_packs`. Every path here
 * must go through this resolver — a build that cannot say why it failed costs
 * more than the failure.
 */
async function functionResponseError(
  data: Record<string, unknown> | null | undefined,
  error: unknown,
) {
  let responseData = data;
  const context = (error as { context?: Response } | null)?.context;
  if (context && typeof context.clone === "function") {
    try {
      const parsed = await context.clone().json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        responseData = parsed as Record<string, unknown>;
      }
    } catch {
      // Preserve the SDK message when the response is not JSON.
    }
  }
  const fallback =
    error instanceof Error ? error.message : "DesignPro workflow request failed";
  return functionError(responseData, fallback);
}

export async function submitEnticeRevision(
  input: SubmitEnticeRevisionInput,
): Promise<EnticePackAccepted> {
  const { data, error } = await supabase.functions.invoke(
    "designpro-file-output-api",
    {
      body: {
        action: "start",
        workflowType: ENTICE_WORKFLOW_TYPE,
        ...input,
      },
    },
  );
  if (error || !data?.success || !data?.accepted) {
    throw await functionResponseError(data, error);
  }
  return data as EnticePackAccepted;
}

/**
 * Atomically save one complete immutable revision and enqueue its Entice Pack.
 * The browser never writes the final pixels and then makes a second enqueue
 * request; both transitions share one authenticated server transaction.
 */
export async function saveEnticeRevision(
  input: SaveEnticeRevisionInput,
): Promise<SavedEnticeRevision> {
  const { data, error } = await supabase.functions.invoke(
    "designpro-file-output-api",
    {
      body: {
        action: "save_revision",
        workflowType: ENTICE_WORKFLOW_TYPE,
        ...input,
      },
    },
  );
  if (
    error ||
    !data?.success ||
    !data?.accepted ||
    !data?.saved ||
    !data?.updatedAt
  ) {
    throw await functionResponseError(data, error);
  }
  return data as SavedEnticeRevision;
}

export async function submitProductionPack(
  input: SubmitProductionPackInput,
): Promise<ProductionPackAccepted> {
  const { data, error } = await supabase.functions.invoke(
    "designpro-file-output-api",
    {
      body: {
        action: "start",
        workflowType: PRODUCTION_WORKFLOW_TYPE,
        ...input,
      },
    },
  );
  if (error || !data?.success || !data?.accepted) {
    throw await functionResponseError(data, error);
  }
  return data as ProductionPackAccepted;
}

export async function getProductionPackStatus(
  productionJobId: string,
) {
  const { data, error } = await supabase.functions.invoke(
    "designpro-file-output-api",
    {
      body: {
        action: "status",
        workflowType: PRODUCTION_WORKFLOW_TYPE,
        productionJobId,
      },
    },
  );
  if (error || !data?.success) {
    throw await functionResponseError(data, error);
  }
  return data;
}

export async function resumeProductionPack(
  productionJobId: string,
  retryFailed = false,
) {
  const { data, error } = await supabase.functions.invoke(
    "designpro-file-output-api",
    {
      body: {
        action: "resume",
        workflowType: PRODUCTION_WORKFLOW_TYPE,
        productionJobId,
        retryFailed,
      },
    },
  );
  if (error || !data?.success) {
    throw await functionResponseError(data, error);
  }
  return data;
}

export type EnticeStatusLocator =
  | string
  | {
      workflowRunId?: string;
      visualizationId?: string;
      enticePackId?: string;
    };

export interface EnticeRevisionStatus {
  success: true;
  workflowType?: typeof ENTICE_WORKFLOW_TYPE;
  /** Verified proof.build output for the currently observed rebuilding run. */
  previewProofUrl?: string | null;
  workflowRun?: {
    id?: string;
    workflow_status?: string;
    [key: string]: unknown;
  } | null;
  activeEnticePack?: {
    proof_artifact?: { url?: string | null; [key: string]: unknown } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export async function getEnticeRevisionStatus(
  locator: EnticeStatusLocator,
): Promise<EnticeRevisionStatus> {
  const identity =
    typeof locator === "string"
      ? { workflowRunId: locator }
      : locator;
  const { data, error } = await supabase.functions.invoke(
    "designpro-file-output-api",
    {
      body: {
        action: "status",
        workflowType: ENTICE_WORKFLOW_TYPE,
        ...identity,
      },
    },
  );
  if (error || !data?.success) {
    throw await functionResponseError(data, error);
  }
  return data as EnticeRevisionStatus;
}

export async function resumeEnticeRevision(
  workflowRunId: string,
  retryFailed = false,
) {
  const { data, error } = await supabase.functions.invoke(
    "designpro-file-output-api",
    {
      body: {
        action: "resume",
        workflowType: ENTICE_WORKFLOW_TYPE,
        workflowRunId,
        retryFailed,
      },
    },
  );
  if (error || !data?.success) {
    throw await functionResponseError(data, error);
  }
  return data;
}
