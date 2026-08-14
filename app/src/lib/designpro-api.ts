/**
 * The DesignProAI shell's client for the standalone gateway.
 *
 * The proven control panel in `web/` authenticates with the gateway's own
 * `dp_session` cookie, minted by `POST /api/auth/login`. This shell already
 * holds a supabase-js session — that is what `RequireAuth` and `SessionGuard`
 * guard — so it presents that session's access token as a bearer instead of
 * asking the operator to sign in a second time. The gateway validates a bearer
 * against Supabase exactly as it validates the cookie, so this grants nothing
 * the cookie would not.
 *
 * The token is read fresh on every call rather than captured once: supabase-js
 * rotates it, and a captured token would start returning 401 mid-session.
 */
import { supabase } from "@/integrations/supabase/client";

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
    this.name = "ApiError";
  }
}

/**
 * Same origin by default. Caddy serves this SPA and proxies `/api` to the
 * gateway on one host, which is also what keeps the gateway's same-origin
 * check satisfied for every write.
 */
const API_BASE =
  (import.meta.env.VITE_DP_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "/api";

async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, String(payload.error || `designpro_api_${response.status}`));
  }
  return payload as T;
}

/* ── Identity and workflow contracts ─────────────────────────────── */

export type RenderRole = "driver" | "passenger" | "hood" | "roof" | "front" | "rear" | "hero3d";
export type GenieSurfaceKey = "driver" | "passenger" | "hood" | "roof" | "front" | "rear";

/** The six printed surfaces, in the order the production layers are cut. */
export const PRODUCTION_SURFACES: GenieSurfaceKey[] = [
  "driver",
  "passenger",
  "hood",
  "roof",
  "front",
  "rear",
];

/** The seven immutable source views. hero3d is generated, never mirrored. */
export const RENDER_ROLES: RenderRole[] = [...PRODUCTION_SURFACES, "hero3d"];

/**
 * The frozen view contract names a slot by its camera (`sourceViewType`); the
 * production contract names it by what consumes it (`consumerRole`). They are
 * not interchangeable: the regenerate route is keyed by the camera, while every
 * display surface is keyed by the role, so the translation lives here once.
 *
 * The legacy `close-up` camera is deliberately absent — it is retained by the
 * server only so historical rows still validate, and it never maps to hero3d.
 */
export const SOURCE_VIEW_TYPE_FOR_ROLE: Record<RenderRole, string> = {
  driver: "side",
  passenger: "passenger-side",
  hood: "hood_detail",
  roof: "roof",
  front: "front",
  rear: "rear",
  hero3d: "hero-3d",
};

export const ROLE_FOR_SOURCE_VIEW_TYPE: Record<string, RenderRole> = Object.fromEntries(
  Object.entries(SOURCE_VIEW_TYPE_FOR_ROLE).map(([role, type]) => [type, role as RenderRole]),
);

export const SURFACE_LABEL: Record<string, string> = {
  driver: "Driver side",
  passenger: "Passenger side",
  hood: "Hood",
  roof: "Roof",
  front: "Front",
  rear: "Rear",
  hero3d: "3D hero view",
};

export type WorkflowStatus = {
  generationId: string;
  designId: string;
  orderNumber: string;
  revision: number;
  state:
    | "queued"
    | "running"
    | "waiting_for_preflight"
    | "waiting_for_final_qc"
    | "complete"
    | "failed";
  currentStage: string;
  stages: Array<{
    key: string;
    label: string;
    state: "pending" | "running" | "complete" | "failed";
    artifactPath?: string;
  }>;
  failure?: { stage: string; message: string; retryable: boolean };
};

export type WorkflowArtifact = {
  id: string;
  runId?: string;
  source?: "production" | "entice";
  kind: string;
  surfaceKey: string;
  storagePath: string;
  contentHash: string;
  byteSize: number | null;
  metadata: Record<string, unknown>;
  signedUrl: string;
  expiresIn: 300;
};

export type AssetIdentity = {
  storagePath: string;
  contentHash: string;
  byteSize: number;
  contentType: string;
};

export type FrozenDeliveryRecipient = {
  contractVersion: "designpro.wrapbox-recipient.v1";
  customerId: string;
  customerEmail: string;
  recipientIdentityHash: string;
  orderNumber: string;
  designName: string;
};

export type PreflightQc = {
  dimensionsVerified: boolean;
  sourceRegionsVerified: boolean;
  fiveInchBleed: boolean;
  panelHashesVerified: boolean;
  logoInventoryVerified: boolean;
  textLockVerified: boolean;
};

export type FinalQc = {
  outputHashesVerified: boolean;
  printDimensionsVerified: boolean;
  colorModeVerified: boolean;
};

export type GenieCandidate = {
  id: string;
  vehicleClass: string | null;
  make: string;
  model: string;
  year: number | null;
  subType: string | null;
  source: string;
  sourceUrls: string[];
  confidence: number | null;
  requestedRuns: Array<{ runId: string; generationId?: string }>;
};

export type GenieValidatedSurfaces = Record<
  GenieSurfaceKey,
  { widthInches: number; heightInches: number }
>;

export type WrapboxPack = {
  id: string;
  runId: string;
  revisionId: string;
  enticePackId: string;
  designId: string;
  orderNumber: string;
  designName: string;
  zip: { contentHash: string; byteSize: number; signedUrl?: string; expiresIn?: 300 };
  manifest: { contentHash: string; byteSize: number; signedUrl?: string; expiresIn?: 300 };
  logoInventory: Array<Record<string, unknown>>;
  readyAt: string;
};

export type RevisionSubmission = {
  revisionId: string;
  generationId: string;
  visualizationId: string;
  expectedUpdatedAt: string;
  renderAssets: Record<RenderRole, AssetIdentity>;
  view: string;
  instruction: string;
  attachmentIds?: string[];
  idempotencyKey: string;
  revisionSnapshot: Record<string, unknown>;
};

/* ── Calls 1-7 generation ────────────────────────────────────────── */

export type GenerationBrief = {
  brief: string;
  businessName?: string;
  industry?: string;
  colors?: string[];
  style?: string;
};

export type GenerationVehicle = {
  year: string;
  make: string;
  model: string;
  type:
    | "car"
    | "truck"
    | "suv"
    | "van"
    | "motorcycle"
    | "boat"
    | "bus"
    | "rv"
    | "trailer"
    | "aircraft"
    | "heavy_equipment";
};

export type GenerationRequestState = {
  requestId: string;
  generationId: string;
  state: "queued" | "leased" | "retryable" | "outputs_ready" | "failed" | "cancelled";
  inputHash: string;
  engineContractHash: string;
  idempotent?: boolean;
  attempt?: number;
  outputSetHash?: string | null;
  /** Identity only — this route never returns a storage path or a signed URL. */
  views?: Array<{
    sourceViewType: string;
    consumerRole: string;
    contentHash: string;
    byteSize: number;
    contentType: string;
    createdAt?: string;
  }>;
  failureCode?: string | null;
  handoffReady?: boolean;
  handoffBlocker?: string | null;
  /** Staging and per-shot state, derived from real slot state on the server. */
  phase?: "designer" | "photographer" | "complete" | "failed";
  shotsComplete?: number;
  shotsTotal?: number;
  failedShots?: Array<{ sourceViewType: string; consumerRole: string; reason: string | null }>;
  regeneratingShots?: string[];
  designAnchor?: string | null;
  designName?: string | null;
};

/**
 * A generated view with a five-minute signed URL. Signing lives on its own
 * route because the status route above is an identity contract and must never
 * sign an object. A view whose object could not be signed comes back without
 * `signedUrl` and renders as pending rather than failing the whole read.
 */
export type GenerationView = {
  sourceViewType: string;
  consumerRole: string;
  contentHash: string;
  contentType: string;
  byteSize: number;
  signedUrl?: string;
  expiresIn?: 300;
};

/**
 * One of the caller's generations, as the design library sees it.
 *
 * Identity only — no storage path, no signed URL. The views for a generation
 * are fetched separately through listGenerationViews, which is the surface
 * allowed to mint short-lived signed URLs.
 */
export type GenerationSummary = {
  requestId: string;
  generationId: string;
  state: string;
  createdAt: string | null;
  completedAt: string | null;
  vehicle: { year?: string; make?: string; model?: string; type?: string } | null;
  designName: string | null;
  orderNumber: string | null;
  brief: string | null;
  businessName: string | null;
  finish: string | null;
  viewTypes: string[];
};

export type RegenerateResult = {
  requestId: string;
  sourceViewType: string;
  consumerRole: string;
  supersededViews: number;
  state: string;
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadRevisionAsset(
  revisionId: string,
  kind: RenderRole | "logo" | "attachment",
  file: File,
): Promise<AssetIdentity> {
  if (file.size < 1 || file.size > 25 * 1024 * 1024) {
    throw new Error("Each source asset must be between 1 byte and 25 MiB.");
  }
  const contentHash = await sha256File(file);
  const intent = await request<{ signedUrl: string; asset: AssetIdentity }>(
    "/assets/upload-intents",
    {
      method: "POST",
      body: JSON.stringify({
        revisionId,
        kind,
        contentHash,
        contentType: file.type,
        byteSize: file.size,
        fileName: file.name,
      }),
    },
  );
  const form = new FormData();
  form.append("cacheControl", "31536000");
  form.append("", file);
  const uploaded = await fetch(intent.signedUrl, {
    method: "PUT",
    headers: { "x-upsert": "false" },
    body: form,
  });
  if (!uploaded.ok && ![400, 409].includes(uploaded.status)) {
    throw new Error(`Storage upload failed (${uploaded.status}).`);
  }
  const verified = await request<{ asset: AssetIdentity & { verified: true } }>("/assets/verify", {
    method: "POST",
    body: JSON.stringify({ asset: intent.asset }),
  });
  return verified.asset;
}

/**
 * The idempotency key is not free-form: the gateway recomputes
 * `calls17:<generationId>:<recipientIdentityHash>:<sha256(orderNumber)>` and
 * refuses anything else, so it is derived here rather than invented. prompt,
 * model, seed and camera angle are server-owned and rejected if sent — the
 * operator supplies the brief and the vehicle, the frozen view contract in the
 * runtime supplies the angles.
 */
export async function createGenerationRequest(options: {
  delivery: FrozenDeliveryRecipient;
  vehicle: GenerationVehicle;
  brief: GenerationBrief;
  generationId?: string;
}): Promise<GenerationRequestState> {
  const generationId = (options.generationId || crypto.randomUUID()).toLowerCase();
  const { orderNumber, recipientIdentityHash, designName } = options.delivery;
  const idempotencyKey = `calls17:${generationId}:${recipientIdentityHash}:${await sha256Hex(orderNumber)}`;

  const input: Record<string, unknown> = {
    contractVersion: "designpro.calls-1-7-input.v1",
    orderNumber,
    vehicle: options.vehicle,
    // Exactly the three keys the delivery contract allows; anything else is a
    // hard 400 at the gateway and again in the database.
    delivery: {
      contractVersion: "designpro.wrapbox-recipient.v1",
      orderNumber,
      recipientIdentityHash,
    },
    brief: options.brief.brief,
    designName,
  };
  if (options.brief.businessName) input.businessName = options.brief.businessName;
  if (options.brief.industry) input.industry = options.brief.industry;
  if (options.brief.colors?.length) input.colors = options.brief.colors;
  if (options.brief.style) input.style = options.brief.style;

  return request<GenerationRequestState>("/generation/requests", {
    method: "POST",
    body: JSON.stringify({ generationId, idempotencyKey, input }),
  });
}

export const dpApi = {
  /* Calls 1-7 */
  createGenerationRequest,
  getGenerationRequest: (requestId: string) =>
    request<GenerationRequestState>(`/generation/requests/${encodeURIComponent(requestId)}`),
  listGenerationRequests: () =>
    request<GenerationSummary[]>("/generation/requests"),
  listGenerationViews: (requestId: string) =>
    request<GenerationView[]>(`/generation/requests/${encodeURIComponent(requestId)}/views`),
  /**
   * "Generate this angle again." The old view is superseded, never mutated, so
   * anything Calls 8+ already hashed stays trustworthy.
   */
  regenerateView: (requestId: string, sourceViewType: string, instruction?: string | null) =>
    request<RegenerateResult>(
      `/generation/requests/${encodeURIComponent(requestId)}/views/${encodeURIComponent(sourceViewType)}/regenerate`,
      { method: "POST", body: JSON.stringify({ instruction: instruction ?? null }) },
    ),
  handoffGeneration: (requestId: string) =>
    request<{
      revisionId: string;
      generationId: string;
      runId: string | null;
      alreadyHandedOff: boolean;
    }>(`/generation/requests/${encodeURIComponent(requestId)}/handoff`, { method: "POST" }),

  /* Session — the shell owns sign-in via supabase-js; this only confirms the
     gateway accepted the same session. */
  session: () => request<{ user: { id: string; email: string | null } }>("/auth/session"),

  /* WrapBox recipient + delivery */
  registerDeliveryRecipient: (input: {
    customerEmail: string;
    customerReference: string;
    verificationReference: string;
    orderNumber: string;
    designName: string;
  }) =>
    request<{ delivery: FrozenDeliveryRecipient; emailVerifiedAt: string; idempotent: boolean }>(
      "/wrapbox/recipients/register",
      { method: "POST", body: JSON.stringify(input) },
    ),
  listWrapbox: () => request<WrapboxPack[]>("/wrapbox"),
  getWrapboxPack: (packId: string) =>
    request<WrapboxPack>(`/wrapbox/${encodeURIComponent(packId)}`),

  /* GENIE exact geometry */
  listGenieCandidates: () => request<GenieCandidate[]>("/genie/candidates"),
  validateGenieCandidate: (
    candidateId: string,
    surfaces: GenieValidatedSurfaces,
    evidence: { sourceReviewed: true; sourceUrlsReviewed: true; operatorAttestation: true },
    notes: string,
  ) =>
    request<{ validated: true; resumedRuns: number }>(
      `/genie/candidates/${encodeURIComponent(candidateId)}/validate`,
      { method: "POST", body: JSON.stringify({ surfaces, evidence, notes }) },
    ),

  /* Calls 8-12 production workflow */
  listJobs: () => request<WorkflowStatus[]>("/jobs"),
  getStatus: (generationId: string) =>
    request<WorkflowStatus>(`/jobs/${encodeURIComponent(generationId)}`),
  listArtifacts: (generationId: string) =>
    request<WorkflowArtifact[]>(`/jobs/${encodeURIComponent(generationId)}/artifacts`),
  submitRevision: (submission: RevisionSubmission) =>
    request<{ runId: string; accepted: true }>("/revisions", {
      method: "POST",
      body: JSON.stringify(submission),
    }),
  requestResume: (generationId: string) =>
    request<{ accepted: true }>(`/jobs/${encodeURIComponent(generationId)}/resume`, {
      method: "POST",
    }),
  approvePreflight: (generationId: string, qc: PreflightQc, notes: string) =>
    request<{ accepted: true }>(`/jobs/${encodeURIComponent(generationId)}/approvals/preflight`, {
      method: "POST",
      body: JSON.stringify({ qc, notes }),
    }),
  approveFinalQc: (generationId: string, qc: FinalQc, notes: string) =>
    request<{ accepted: true }>(`/jobs/${encodeURIComponent(generationId)}/approvals/final`, {
      method: "POST",
      body: JSON.stringify({ qc, notes }),
    }),
};
