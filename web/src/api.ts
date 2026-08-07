export type WorkflowStatus = {
  generationId: string;
  designId: string;
  orderNumber: string;
  revision: number;
  state: "queued" | "running" | "waiting_for_preflight" | "waiting_for_final_qc" | "complete" | "failed";
  currentStage: string;
  stages: Array<{ key: string; label: string; state: "pending" | "running" | "complete" | "failed"; artifactPath?: string }>;
  failure?: { stage: string; message: string; retryable: boolean };
};

export type WorkflowArtifact = {
  id: string;
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

export type RenderRole = "driver" | "passenger" | "hood" | "roof" | "front" | "rear" | "hero3d";

export type FrozenDeliveryRecipient = {
  contractVersion: "designpro.wrapbox-recipient.v1";
  customerId: string;
  customerEmail: string;
  recipientIdentityHash: string;
  orderNumber: string;
  designName: string;
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
  revisionSnapshot: {
    contractVersion: "designpro.revision-snapshot.v1";
    vehicle: { year: string; make: string; model: string; type: string };
    surfaceOptions: Record<string, unknown>;
    finish: string;
    bodyText: string;
    orderNumber: string;
    logoInventoryAttestation: { mode: "none" | "listed"; attested: true };
    expectedLogoInventory: Array<{ placementKey: string; identityKey: string; displayName: string; surfaceKey: GenieSurfaceKey; storagePath: string; contentHash: string; byteSize: number; contentType: string }>;
    delivery: FrozenDeliveryRecipient;
  };
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

export type GenieSurfaceKey = "driver" | "passenger" | "hood" | "roof" | "front" | "rear";

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

export type GenieValidatedSurfaces = Record<GenieSurfaceKey, { widthInches: number; heightInches: number }>;

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

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

const API_BASE = (import.meta.env.VITE_DP_API_BASE_URL as string | undefined)?.replace(/\/$/, "") || "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, String(payload.error || `designpro_api_${response.status}`));
  return payload as T;
}

async function sha256(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function putSignedFile(signedUrl: string, file: File): Promise<Response> {
  const form = new FormData();
  form.append("cacheControl", "31536000");
  form.append("", file);
  return fetch(signedUrl, { method: "PUT", headers: { "x-upsert": "false" }, body: form });
}

export async function uploadRevisionAsset(revisionId: string, kind: RenderRole | "logo" | "attachment", file: File): Promise<AssetIdentity> {
  if (file.size < 1 || file.size > 25 * 1024 * 1024) throw new Error("Each source asset must be between 1 byte and 25 MiB.");
  const contentHash = await sha256(file);
  const intent = await request<{ signedUrl: string; asset: AssetIdentity }>("/assets/upload-intents", {
    method: "POST",
    body: JSON.stringify({ revisionId, kind, contentHash, contentType: file.type, byteSize: file.size, fileName: file.name }),
  });
  const uploaded = await putSignedFile(intent.signedUrl, file);
  if (!uploaded.ok && ![400, 409].includes(uploaded.status)) throw new Error(`Storage upload failed (${uploaded.status}).`);
  const verified = await request<{ asset: AssetIdentity & { verified: true } }>("/assets/verify", {
    method: "POST",
    body: JSON.stringify({ asset: intent.asset }),
  });
  return verified.asset;
}

export const dpApi = {
  signup: (email: string, password: string) => request<{ ok: true; confirmationRequired: boolean }>("/auth/signup", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) => request<{ ok: true; user: { id: string; email: string } }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  session: () => request<{ user: { id: string; email: string | null } }>("/auth/session"),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  listGenieCandidates: () => request<GenieCandidate[]>("/genie/candidates"),
  validateGenieCandidate: (candidateId: string, surfaces: GenieValidatedSurfaces, evidence: { sourceReviewed: true; sourceUrlsReviewed: true; operatorAttestation: true }, notes: string) => request<{ validated: true; resumedRuns: number }>(`/genie/candidates/${encodeURIComponent(candidateId)}/validate`, { method: "POST", body: JSON.stringify({ surfaces, evidence, notes }) }),
  registerDeliveryRecipient: (input: { customerEmail: string; customerReference: string; verificationReference: string; orderNumber: string; designName: string }) => request<{ delivery: FrozenDeliveryRecipient; emailVerifiedAt: string; idempotent: boolean }>("/wrapbox/recipients/register", { method: "POST", body: JSON.stringify(input) }),
  listWrapbox: () => request<WrapboxPack[]>("/wrapbox"),
  getWrapboxPack: (packId: string) => request<WrapboxPack>(`/wrapbox/${encodeURIComponent(packId)}`),
  listJobs: () => request<WorkflowStatus[]>("/jobs"),
  getStatus: (generationId: string) => request<WorkflowStatus>(`/jobs/${encodeURIComponent(generationId)}`),
  listArtifacts: (generationId: string) => request<WorkflowArtifact[]>(`/jobs/${encodeURIComponent(generationId)}/artifacts`),
  submitRevision: (submission: RevisionSubmission) => request<{ runId: string; accepted: true }>("/revisions", { method: "POST", body: JSON.stringify(submission) }),
  requestResume: (generationId: string) => request<{ accepted: true }>(`/jobs/${encodeURIComponent(generationId)}/resume`, { method: "POST" }),
  approvePreflight: (generationId: string, qc: PreflightQc, notes: string) => request<{ accepted: true }>(`/jobs/${encodeURIComponent(generationId)}/approvals/preflight`, { method: "POST", body: JSON.stringify({ qc, notes }) }),
  approveFinalQc: (generationId: string, qc: FinalQc, notes: string) => request<{ accepted: true }>(`/jobs/${encodeURIComponent(generationId)}/approvals/final`, { method: "POST", body: JSON.stringify({ qc, notes }) }),
};
