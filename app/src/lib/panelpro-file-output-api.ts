import { supabase } from "@/integrations/supabase/client";

export const PANEL_OUTPUT_SOURCE_APPS = [
  "DesignPro",
  "RecreatePro",
  "GraphicsPro",
  "WallPro",
] as const;
export type PanelOutputSourceApp = (typeof PANEL_OUTPUT_SOURCE_APPS)[number];
export type PanelOutputIdentity = {
  sourceApp: PanelOutputSourceApp;
  sourceJobId: string;
  generationId?: string;
  designId?: string;
  orderId?: string;
  revisionId?: string;
  /** Exact registered source placement; never guessed from generation alone. */
  sourceId?: string;
  inputHash?: string;
};
export type PanelOutputPreparedIdentity = PanelOutputIdentity & {
  sourceId: string;
  inputHash: string;
};

/** A new staff review binds existing identities; it never supplies missing vehicle facts. */
export function withTemplateVehicleReview(
  handoff: Record<string, unknown>, review: { confirmed: boolean; reviewId: string },
): Record<string, unknown> {
  const { templateVehicleReview: _importedReview, ...source } = handoff;
  if (!review.confirmed) return source;
  const template = source.template as { geometryHash?: unknown } | undefined;
  if (source.sourceApp !== "DesignPro" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(review.reviewId)
      || typeof source.revisionId !== "string" || !source.revisionId
      || !/^[a-f0-9]{64}$/i.test(String(template?.geometryHash || ""))
      || !/^[a-f0-9]{64}$/i.test(String(source.dimensionManifestHash || ""))) {
    throw new Error("This vehicle review needs the saved source revision, geometry hash, GENIE dimensions and an inspection reference.");
  }
  return { ...source, templateVehicleReview: {
    reviewId: review.reviewId, revisionId: source.revisionId, geometryHash: template!.geometryHash,
    dimensionManifestHash: source.dimensionManifestHash, missingVariantsReviewed: true,
  } };
}
export type TemplateRegion = { x: number; y: number; width: number; height: number };
export type TemplateGeometryPiece = {
  pieceId: string; widthInches: number; heightInches: number;
  outlineInches: number[][]; cutAreas: Array<{ areaId: string; pointsInches: number[][] }>;
};
export type TemplateCandidate = {
  contractVersion: "designpro.panelpro-template-service.v1";
  candidateId: string; sourceId: string; ownerId: string; templateId: string; version: string;
  vehicle: Record<string, unknown>;
  status: "queued" | "running" | "waiting_review" | "approved" | "blocked" | "failed";
  customerVisible: false; canReview: boolean; fitToleranceInches: number;
  geometryHash: string | null; candidateHash: string | null; displayContentHash: string | null;
  displayMetadata: { width: number; height: number; headerHeight: number } | null;
  geometry: { contractVersion: string; units: "in"; vehicle: Record<string, unknown>; pieces: TemplateGeometryPiece[] } | null;
  previews: Array<{ role: "source-raster" | "brand-original" | "branded-template-candidate"; contentHash: string; signedUrl: string; customerVisible: false }>;
  template: Record<string, unknown> | null;
  stages: Array<{ key: string; state: string }>;
  error: { code: string; retryable?: boolean; providerRetryDisposition?: string } | null;
  updatedAt: string;
};
export type TemplateSourceRegistration = { sourceId: string; templateId: string; version: string; inputHash: string; geometryHash: string; status: "measured_source_reviewed" };
export type PanelOutputStage = {
  key: string;
  state: string;
  dependsOn: string[];
  attempt?: number;
};
export type PanelOutputPreview = {
  id: string;
  role: string;
  pieceId?: string;
  signedUrl: string;
  contentHash: string;
  profileHash?: string;
  geometryValidated?: boolean;
  provenance?: string;
  approvedDisplay?: boolean;
};
export type PanelOutputPiece = {
  id: string;
  label: string;
  state: string;
  trimWidthIn?: number;
  trimHeightIn?: number;
  printWidthIn?: number;
  printHeightIn?: number;
  bleedInches?: number;
  ppi?: number;
  blockers?: Array<string | { code: string }>;
};
export type PanelOutputRun = PanelOutputIdentity & {
  id: string;
  /** Authoring revision; revisionId remains the separate existing source ID. */
  atlasRevisionId?: string | null;
  status: string;
  stages: PanelOutputStage[];
  previews: PanelOutputPreview[];
  pieces: PanelOutputPiece[];
  blockers: Array<string | { code: string }>;
  humanReviewUrl?: string;
  wrapboxUrl?: string;
  updatedAt?: string;
  createdAt?: string;
  artifactSetHash?: string;
  canReview?: boolean;
  files?: Array<{
    id: string;
    filename?: string;
    name?: string;
    label?: string;
    format?: string;
    mimeType?: string;
    role?: string;
    pieceId?: string;
    signedUrl: string;
    contentHash: string;
  }>;
};
export const PANEL_OUTPUT_REVIEW_CHECKS = [
  "template",
  "fit",
  "essentialArtworkSafe",
  "backgroundContinuous",
  "fiveInchBleed",
  "resolution",
  "physicalPieces",
  "filesInspected",
] as const;
export type PanelOutputReviewChecks = Record<
  (typeof PANEL_OUTPUT_REVIEW_CHECKS)[number],
  boolean
>;

export class PanelOutputApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public blockers: string[] = [],
    public continuation?: unknown,
  ) {
    super(code);
    this.name = "PanelOutputApiError";
  }
}

const base =
  (import.meta.env.VITE_DP_API_BASE_URL as string | undefined)?.replace(
    /\/$/,
    "",
  ) || "/api";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(`${base}/panelpro-file-output${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const codes = Array.isArray(body.blockers)
      ? body.blockers.map((item: unknown) =>
          typeof item === "string"
            ? item
            : String((item as { code?: string })?.code || ""),
        )
      : [];
    throw new PanelOutputApiError(
      response.status,
      String(body.error || "panelprofile_request_failed"),
      codes,
      body.continuation,
    );
  }
  return body as T;
}

export const panelOutputApi = {
  capabilities: (signal?: AbortSignal) => request<{ canPrepare: boolean; canReview: boolean; enabled: boolean }>("/capabilities", { signal }),
  list: async (
    identity?: Partial<PanelOutputIdentity>,
    signal?: AbortSignal,
  ): Promise<PanelOutputRun[]> => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(identity || {}))
      if (value) params.set(key, value);
    const result = await request<PanelOutputRun[] | { runs: PanelOutputRun[] }>(
      `/runs?${params}`,
      { signal },
    );
    return Array.isArray(result) ? result : result.runs || [];
  },
  get: (runId: string, signal?: AbortSignal) =>
    request<PanelOutputRun>(`/runs/${encodeURIComponent(runId)}`, { signal }),
  resume: (runId: string) => request<{ resumed: boolean }>(`/runs/${encodeURIComponent(runId)}/resume`, { method: "POST", body: JSON.stringify({}) }),
  create: (identity: PanelOutputIdentity) =>
    request<PanelOutputRun>("/runs", {
      method: "POST",
      body: JSON.stringify(identity),
    }),
  registerSource: (handoff: Record<string, unknown>) =>
    request<PanelOutputPreparedIdentity>("/sources", {
      method: "POST",
      body: JSON.stringify({ handoff }),
    }),
  approve: (
    runId: string,
    body: {
      artifactSetHash: string;
      approvalRef: string;
      checks: PanelOutputReviewChecks;
    },
  ) =>
    request<{ accepted: boolean }>(
      `/runs/${encodeURIComponent(runId)}/approve`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  attach: (runId: string, productionRunId: string) =>
    request<{ attached: boolean; productionRunId: string }>(
      `/runs/${encodeURIComponent(runId)}/attach`,
      {
        method: "POST",
        body: JSON.stringify({ productionRunId }),
      },
    ),
  reserve: (productionRunId: string) =>
    request<{ reserved: boolean; productionRunId: string }>(
      `/production/${encodeURIComponent(productionRunId)}/reserve`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    ),
  importTemplateSource: (source: Record<string, unknown>) => request<TemplateSourceRegistration>("/templates/sources", { method: "POST", body: JSON.stringify(source) }),
  createTemplateCandidate: (sourceId: string) => request<TemplateCandidate>("/templates/candidates", { method: "POST", body: JSON.stringify({ sourceId }) }),
  listTemplateCandidates: (sourceId?: string, signal?: AbortSignal) => request<TemplateCandidate[]>(`/templates/candidates${sourceId ? `?sourceId=${encodeURIComponent(sourceId)}` : ""}`, { signal }),
  getTemplateCandidate: (candidateId: string, signal?: AbortSignal) => request<TemplateCandidate>(`/templates/candidates/${encodeURIComponent(candidateId)}`, { signal }),
  recoverTemplateCandidate: (candidateId: string) => request<TemplateCandidate>(`/templates/candidates/${encodeURIComponent(candidateId)}/recover`, { method: "POST", body: JSON.stringify({}) }),
  approveTemplateCandidate: (candidateId: string, body: { candidateHash: string; review: {
    reviewId: string; approved: true; displayContentHash: string; geometryHash: string;
    cutGeometryReviewed: true; displayAlignmentReviewed: true;
    displayRegions: Array<{ pieceId: string; displayRegionPixels: TemplateRegion }>;
  } }) => request<TemplateCandidate>(`/templates/candidates/${encodeURIComponent(candidateId)}/review`, { method: "POST", body: JSON.stringify(body) }),
};

export function panelOutputHref(
  identity: Partial<PanelOutputIdentity>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(identity))
    if (value) params.set(key, value);
  return `/panelpro-file-output?${params}`;
}

/** Preserve the registered handoff identity only while its source selection is unchanged. */
export function panelOutputIdentityFromSearch(
  search: URLSearchParams,
  sourceApp: PanelOutputSourceApp,
  sourceJobId: string,
): PanelOutputIdentity {
  const originalApp =
    PANEL_OUTPUT_SOURCE_APPS.find(
      (app) =>
        app.toLowerCase() ===
        (search.get("sourceApp") || "DesignPro").toLowerCase(),
    ) || "DesignPro";
  const sameSource =
    sourceApp === originalApp &&
    sourceJobId.trim() ===
      (search.get("sourceJobId") || search.get("generationId") || "").trim();
  return {
    sourceApp,
    sourceJobId: sourceJobId.trim(),
    ...(sourceApp === "DesignPro" && sourceJobId.trim()
      ? { generationId: sourceJobId.trim() }
      : {}),
    ...(sameSource
      ? Object.fromEntries(
          [
            "designId",
            "orderId",
            "revisionId",
            "sourceId",
            "inputHash",
          ].flatMap((key) =>
            search.get(key) ? [[key, search.get(key)!]] : [],
          ),
        )
      : {}),
  };
}
