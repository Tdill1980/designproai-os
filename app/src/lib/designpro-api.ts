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

export type GenieSurfaceKey = "driver" | "passenger" | "hood" | "roof" | "front" | "rear";
export type ActiveRenderRole = GenieSurfaceKey | "closeup";
export type RenderRole = GenieSurfaceKey | "closeup" | "hero3d";
/** New revision submissions are Close-Up-only. Hero is historical read data. */
export type RevisionRenderAssets = Record<ActiveRenderRole, AssetIdentity> & {
  hero3d?: never;
};

/**
 * `legacy` deliberately serializes exactly the existing v2 request. The atlas
 * mode is an opt-in v3 diagnostic and is the only client mode that sends a
 * `pipelineMode` field to the gateway.
 */
export type GenerationPipelineMode = "legacy" | "flat-first-atlas-v1";

export const FLAT_FIRST_ATLAS_PIPELINE_MODE: GenerationPipelineMode = "flat-first-atlas-v1";

export type FlatAtlasPanelMapEntry = {
  surfaceKey: GenieSurfaceKey;
  trimWidthIn: number;
  trimHeightIn: number;
  printWidthIn: number;
  printHeightIn: number;
  bleedIn: { top: number; right: number; bottom: number; left: number };
  surfaceSqFt: number;
  effectivePpi: number;
  rotationDegrees: number;
  /** Optional atlas coordinates remain diagnostic; the browser never crops. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
};

/**
 * One immutable canonical-atlas revision. Storage paths remain server-private;
 * the gateway returns short-lived signed URLs only for the two images the UI
 * can inspect. The manifest is represented by identity because it is consumed
 * by the server-side slicer, not interpreted in the browser.
 */
export type FlatAtlasRevision = {
  id: string;
  generationId: string;
  revisionSequence: number;
  parentRevisionId: string | null;
  guide: {
    contentHash: string;
    contentType: string;
    byteSize: number;
    widthPx: number;
    heightPx: number;
  };
  manifest: {
    contentHash: string;
    contentType: string;
    byteSize: number;
  };
  master: {
    contentHash: string;
    contentType: string;
    byteSize: number;
    widthPx: number;
    heightPx: number;
    effectivePpi: number;
  };
  /** 4096px bounded transport derivative used only to condition Gemini proofs. */
  projection: {
    contentHash: string;
    contentType: "image/jpeg";
    byteSize: number;
  };
  guideUrl?: string;
  masterUrl?: string;
  expiresIn?: 300;
  model: string;
  promptVersion: string;
  affectedSurfaces: GenieSurfaceKey[];
  panelMap: FlatAtlasPanelMapEntry[];
  instruction: string | null;
  productionEligible: boolean;
  exampleUsed: boolean;
  exampleGuideHash: string | null;
  exampleMasterHash: string | null;
  createdAt: string;
};

/** The six printed surfaces, in the order the production layers are cut. */
export const PRODUCTION_SURFACES: GenieSurfaceKey[] = [
  "driver",
  "passenger",
  "hood",
  "roof",
  "front",
  "rear",
];

/** The exact seven immutable source views, in their frozen display order. */
export const RENDER_ROLES: ActiveRenderRole[] = [
  "driver",
  "passenger",
  "hood",
  "front",
  "rear",
  "closeup",
  "roof",
];

/**
 * The frozen view contract names a slot by its camera (`sourceViewType`); the
 * production contract names it by what consumes it (`consumerRole`). They are
 * not interchangeable: the regenerate route is keyed by the camera, while every
 * display surface is keyed by the role, so the translation lives here once.
 *
 * Close-Up and historical Hero are distinct seventh-slot identities. Neither
 * is relabelled as the other. Only Close-Up is authored now; Hero remains in
 * this identity map solely so immutable historical responses can be displayed.
 */
export const SOURCE_VIEW_TYPE_FOR_ROLE: Record<RenderRole, string> = {
  driver: "side",
  passenger: "passenger-side",
  hood: "hood_detail",
  roof: "roof",
  front: "front",
  rear: "rear",
  closeup: "close-up",
  hero3d: "hero-3d",
};

export const ROLE_FOR_SOURCE_VIEW_TYPE: Record<string, RenderRole> = Object.fromEntries(
  Object.entries(SOURCE_VIEW_TYPE_FOR_ROLE).map(([role, type]) => [type, role as RenderRole]),
);

type GenerationViewIdentity = {
  sourceViewType: string;
  consumerRole: string;
};

/**
 * Choose the cards that describe an existing generation without changing the
 * identity of its seventh slot. New and progressive runs default to Close-Up.
 * An immutable historical Hero response keeps its own Hero identity.
 *
 * The gateway rejects a response containing both compatible seventh slots. If
 * one nevertheless reaches an emergency rollback UI, expose both conflicting
 * identities instead of silently hiding or renaming either one.
 */
export function displayRenderRoles(
  identities: readonly GenerationViewIdentity[],
  regeneratingSourceViewTypes: readonly string[] = [],
): RenderRole[] {
  const observedSeventhRoles = new Set<RenderRole>();
  for (const identity of identities) {
    const mappedRole = ROLE_FOR_SOURCE_VIEW_TYPE[identity.sourceViewType];
    if (mappedRole !== identity.consumerRole) continue;
    if (mappedRole === "closeup" || mappedRole === "hero3d") {
      observedSeventhRoles.add(mappedRole);
    }
  }
  for (const sourceViewType of regeneratingSourceViewTypes) {
    const mappedRole = ROLE_FOR_SOURCE_VIEW_TYPE[sourceViewType];
    if (mappedRole === "closeup" || mappedRole === "hero3d") {
      observedSeventhRoles.add(mappedRole);
    }
  }

  const closeupRoles: RenderRole[] = [
    "driver", "passenger", "hood", "front", "rear", "closeup", "roof",
  ];
  const historicalHeroRoles: RenderRole[] = [
    "driver", "passenger", "hood", "front", "rear", "hero3d", "roof",
  ];
  if (observedSeventhRoles.has("closeup") && observedSeventhRoles.has("hero3d")) {
    return [...closeupRoles, "hero3d"];
  }
  if (observedSeventhRoles.has("closeup")) return closeupRoles;
  if (observedSeventhRoles.has("hero3d")) return historicalHeroRoles;
  return RENDER_ROLES;
}

export const SURFACE_LABEL: Record<string, string> = {
  driver: "Driver side",
  passenger: "Passenger side",
  hood: "Hood",
  roof: "Roof",
  front: "Front",
  rear: "Rear",
  closeup: "Close-Up",
  hero3d: "Historical 3D Hero",
};

export type WorkflowStatus = {
  generationId: string;
  designId: string;
  orderNumber: string;
  revision: number;
  state:
    | "queued"
    | "running"
    // manifest.resolve parks here until a human validates the vehicle's GENIE
    // dimensions. It is NOT progress: Call 8, Call 9 and every panel below it
    // are blocked, so it must never be reported as "running".
    | "waiting_for_genie_dimensions"
    | "waiting_for_preflight"
    | "waiting_for_final_qc"
    | "complete"
    | "failed";
  currentStage: string;
  /** Present only while the run is parked on a human action. */
  waiting?: {
    stage: string;
    reason: string;
    candidateId: string | null;
    requestedAt: string | null;
  };
  stages: Array<{
    key: string;
    label: string;
    state: "pending" | "running" | "waiting" | "complete" | "failed";
    waitReason?: string;
    artifactPath?: string;
  }>;
  failure?: { stage: string; message: string; retryable: boolean };
};

/** One frozen, owner-scoped 3D view of the revision a run was built from. */
export type ApprovedGenerationView = {
  id: string;
  generationId: string;
  surfaceKey: string;
  sourceViewType: string;
  storagePath: string;
  contentHash: string;
  byteSize: number | null;
  contentType: string;
  signedUrl: string;
  expiresIn: 300;
  /**
   * Which master this proof was rendered from — null on a Standard run, which
   * has no master. The runtime already refuses to render a proof whose
   * conditioning bytes do not hash to the master zone; this reports that fact
   * so the design team can SEE the binding rather than trust it.
   */
  atlasBinding: {
    masterContentHash: string | null;
    zoneContentHash: string | null;
    zoneSurfaceKey: string | null;
    anchoredToDriver: boolean;
    deterministicMirror: boolean;
  } | null;
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
  /**
   * The six sides the designer approved individually, each against its own proof
   * and its own panel. The board has always gated its button on all six; they
   * just never left the browser, so the receipt recorded the six checkboxes and
   * nothing about whether anyone looked at the rear panel. The gateway refuses
   * anything other than exactly the six canonical surfaces.
   */
  approvedSides: string[];
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
  overallDimensions: {
    lengthInches: number | null;
    widthInches: number | null;
    heightInches: number | null;
    wheelbaseInches: number | null;
  };
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
  renderAssets: RevisionRenderAssets;
  view: string;
  instruction: string;
  attachmentIds?: string[];
  idempotencyKey: string;
  revisionSnapshot: Record<string, unknown>;
};

/* ── Calls 1-7 generation ────────────────────────────────────────── */

/**
 * The Commercial intake's own fields, carried whole.
 *
 * DesignPanelProPremium collects mode/companyName/phone/website and the customer
 * uploads a logo, and every one of those was being dropped here: the builder
 * below forwarded `brief` and four optional strings, so a commercial job reached
 * the server as prose. The revision snapshot then froze `bodyText` as that prose
 * string, design-master-author coerced the non-array to [], and the frozen master
 * carried textIdentities:[] and logoIdentities:[] with no error anywhere. The
 * panels came out as unbranded imagery because nothing branded ever arrived.
 *
 * IDENTITY IS NOT CREATIVE INPUT. companyName/phone/website are the customer's
 * own strings and the logo is the customer's own file. They travel as structured
 * fields so the master can render them deterministically -- vector type for the
 * strings, the uploaded bytes for the logo. A.C.E. still decides how the design
 * looks; it never decides what the company is called.
 *
 * Both gates already allow these: neither validatedGenerationRequest nor
 * create_designpro_generation_request closes the top-level `input` key set, and
 * none of these names appear in generation_input_has_server_controls. So this
 * needs no contract-version bump and no input-validator migration.
 */
export type GenerationBrief = {
  brief: string;
  businessName?: string;
  industry?: string;
  colors?: string[];
  style?: string;
  /** Existing DesignIQ controls. Kept structured so A.C.E. receives exactly
   * what the customer selected instead of trying to recover it from prose. */
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
  /** "commercial" once a company name exists, matching the intake's own rule. */
  mode?: "restyle" | "commercial";
  /** The customer's own strings. Authoritative; never model-authored. */
  companyName?: string;
  phone?: string;
  website?: string;
  /**
   * The customer's uploaded logo, already through /assets/upload-intents ->
   * signed PUT -> /assets/verify, so it arrives with its storage path and
   * content hash. This is the only logo source: logos.extract runs later and
   * cannot be the origin of the file the customer supplied.
   */
  logoAsset?: AssetIdentity;
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
  /** Server-accepted mode returned by request creation. */
  pipelineMode?: GenerationPipelineMode;
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

export type RegenerateResult = {
  requestId: string;
  sourceViewType: string;
  consumerRole: string;
  supersededViews: number;
  state: string;
};

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
 * DESIGN FIRST. A customer designing a wrap does not have an order yet, and
 * until v2 this call demanded one: an orderNumber, a WrapBox recipient hash,
 * and — in the database — an already-confirmed operator/customer/order binding.
 * That is fulfillment identity, and it does not exist while somebody is still
 * deciding what their wrap should look like. It binds when they buy.
 *
 * No idempotency key is sent. The database derives it from the canonical hash
 * of the stored jsonb, and this process cannot reproduce that: Postgres orders
 * jsonb keys, JavaScript preserves insertion order. A key computed here would
 * be a guess, and the only thing a guess adds is a way to be wrong.
 *
 * prompt, model, seed and camera angle remain server-owned and are rejected if
 * sent — the customer supplies the brief and the vehicle, the frozen view
 * contract in the runtime supplies the angles.
 */
export type CreateGenerationRequestOptions = {
  vehicle: GenerationVehicle;
  brief: GenerationBrief;
  designName: string;
  generationId?: string;
  pipelineMode?: GenerationPipelineMode;
};

/** Pure request encoder, kept exported so v2 rollback/v3 opt-in are testable. */
export function buildGenerationInput(
  options: CreateGenerationRequestOptions,
): Record<string, unknown> {
  const flatFirst = options.pipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE;

  const input: Record<string, unknown> = {
    contractVersion: flatFirst
      ? "designpro.calls-1-7-input.v3"
      : "designpro.calls-1-7-input.v2",
    vehicle: options.vehicle,
    brief: options.brief.brief,
    designName: options.designName,
  };
  if (flatFirst) input.pipelineMode = FLAT_FIRST_ATLAS_PIPELINE_MODE;
  if (options.brief.businessName) input.businessName = options.brief.businessName;
  if (options.brief.industry) input.industry = options.brief.industry;
  if (options.brief.colors?.length) input.colors = options.brief.colors;
  if (options.brief.style) input.style = options.brief.style;
  if (options.brief.finish) input.finish = options.brief.finish;
  if (options.brief.substrate) input.substrate = options.brief.substrate;
  if (options.brief.mascot) input.mascot = options.brief.mascot;
  if (options.brief.bulletPoints?.length) input.bulletPoints = options.brief.bulletPoints;
  if (options.brief.brandColors) input.brandColors = options.brief.brandColors;
  if (options.brief.fontStyle) input.fontStyle = options.brief.fontStyle;
  if (options.brief.qrEnabled !== undefined) input.qrEnabled = options.brief.qrEnabled;
  if (options.brief.qrUrl) input.qrUrl = options.brief.qrUrl;
  if (options.brief.visionBoardImages?.length) {
    input.visionBoardImages = options.brief.visionBoardImages.map((asset) => ({
      storagePath: asset.storagePath,
      contentHash: asset.contentHash,
      byteSize: asset.byteSize,
      contentType: asset.contentType,
    }));
  }
  if (options.brief.visionboardIntent) input.visionboardIntent = options.brief.visionboardIntent;
  if (options.brief.styleDescriptors) input.styleDescriptors = options.brief.styleDescriptors;
  if (options.brief.textLayerPrompt) input.textLayerPrompt = options.brief.textLayerPrompt;

  // THE COMMERCIAL IDENTITY, CARRIED STRUCTURED. Sent as discrete fields rather
  // than folded into the brief prose, because the snapshot has to freeze the
  // exact strings the customer typed and the handoff cannot recover them from a
  // sentence. Parsing prose back into fields would put a guess where an
  // authoritative value already exists.
  if (options.brief.mode) input.mode = options.brief.mode;
  if (options.brief.companyName) input.companyName = options.brief.companyName;
  if (options.brief.phone) input.phone = options.brief.phone;
  if (options.brief.website) input.website = options.brief.website;
  // Identity only -- storage path plus content hash. The bytes stay in the
  // private bucket and are fetched by the runtime against this hash, so a logo
  // that changed after verification fails closed instead of printing.
  if (options.brief.logoAsset) {
    input.logoAsset = {
      storagePath: options.brief.logoAsset.storagePath,
      contentHash: options.brief.logoAsset.contentHash,
      byteSize: options.brief.logoAsset.byteSize,
      contentType: options.brief.logoAsset.contentType,
    };
  }

  return input;
}

/**
 * The v3 requirement is duplicated at the request envelope on purpose. An
 * older gateway rejects the unknown envelope field before it can enqueue any
 * work, so a newly deployed A.T.L.A.S. UI can never silently fall back during
 * a rolling deployment. The gateway validates that this requirement and the
 * inner v3 contract agree before choosing the intake RPC.
 */
export function buildGenerationRequestPayload(
  options: CreateGenerationRequestOptions,
  generationId: string,
): Record<string, unknown> {
  const input = buildGenerationInput(options);
  return options.pipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE
    ? {
        generationId,
        input,
        requiredPipelineMode: FLAT_FIRST_ATLAS_PIPELINE_MODE,
      }
    : { generationId, input };
}

export async function createGenerationRequest(
  options: CreateGenerationRequestOptions,
): Promise<GenerationRequestState> {
  const generationId = (options.generationId || crypto.randomUUID()).toLowerCase();

  return request<GenerationRequestState>("/generation/requests", {
    method: "POST",
    body: JSON.stringify(buildGenerationRequestPayload(options, generationId)),
  });
}

export const dpApi = {
  /* Calls 1-7 */
  createGenerationRequest,
  /**
   * Upload-and-verify for a customer-supplied file. Exposed here because intake
   * needs it for the logo before the generation request is queued: the request
   * must carry a storage path and content hash that already exist, not a file
   * still on its way.
   */
  uploadRevisionAsset,
  getGenerationRequest: (requestId: string) =>
    request<GenerationRequestState>(`/generation/requests/${encodeURIComponent(requestId)}`),
  listGenerationViews: (requestId: string) =>
    request<GenerationView[]>(`/generation/requests/${encodeURIComponent(requestId)}/views`),
  /**
   * Immutable atlas lineage for the opt-in flat-first diagnostic. It is valid
   * for this route to return [] while the designer phase is still running.
   */
  listFlatAtlasRevisions: (requestId: string) =>
    request<FlatAtlasRevision[]>(`/generation/requests/${encodeURIComponent(requestId)}/atlas`),
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
  /**
   * Bind the order to the design. The purchase gate cannot release until this
   * exists: the reconciler compares run.input.fulfillment against the revision's
   * resolved fulfillment, and for a v2 snapshot that comes only from this write.
   * Register the WrapBox recipient first -- its recipientIdentityHash is the
   * input here.
   */
  bindFulfillment: (generationId: string, input: {
    recipientIdentityHash: string;
    orderNumber: string;
    designName: string;
  }) =>
    request<{ bound: true; bindingHash: string }>(
      `/jobs/${encodeURIComponent(generationId)}/fulfillment`,
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
  /**
   * The approved per-side 3D views this run was frozen against. The gateway has
   * served these since the run identity work; nothing consumed them, so the
   * customer saw six print panels with nothing to compare them to. Production
   * Layers pairs each panel with its own view, which is the whole point of the
   * surface -- a panel is only checkable next to the design it came from.
   */
  listApprovedViews: (generationId: string) =>
    request<ApprovedGenerationView[]>(`/jobs/${encodeURIComponent(generationId)}/approved-views`),
  /**
   * Every A.T.L.A.S. version this design has been through, oldest first.
   *
   * Addressed by job because that is how the design team reaches it: a design
   * outlives the request that first produced it, and a revision mints a new
   * request against the same generation. This is a PanelPro Studio surface --
   * the canonical master is a production instrument and is never shown to the
   * customer, who sees the seven proofs and the six panels cut from it.
   */
  listJobFlatAtlasRevisions: (generationId: string) =>
    request<FlatAtlasRevision[]>(`/jobs/${encodeURIComponent(generationId)}/atlas`),
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
  /**
   * Open a purchase and get the Stripe checkout URL.
   *
   * The price lives on the server: this sends WHICH product, never how much.
   * The two products stay separate all the way through -- buying the Logo Pack
   * authorizes logo fulfillment and nothing else, and the Production Pack the
   * same, because the entitlement the webhook confirms is per product.
   */
  createCheckoutSession: (input: {
    generationId: string;
    product: "print_pack_entitlement" | "logo_pack";
    returnPath?: string;
  }) =>
    request<{ url: string; productType: string; amountCents: number }>("/checkout/sessions", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  approveFinalQc: (generationId: string, qc: FinalQc, notes: string) =>
    request<{ accepted: true }>(`/jobs/${encodeURIComponent(generationId)}/approvals/final`, {
      method: "POST",
      body: JSON.stringify({ qc, notes }),
    }),
};
