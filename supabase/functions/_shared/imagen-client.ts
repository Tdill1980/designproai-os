/**
 * imagen-client.ts — Unified Imagen 3 client supporting both:
 *   1. Vertex AI (service account key) — preferred, full Imagen access
 *   2. Gemini API (API key) — fallback if Vertex not configured
 *
 * Required secrets for Vertex AI:
 *   VERTEX_AI_SERVICE_ACCOUNT_KEY  — JSON service account key
 *   GCP_PROJECT_ID                 — e.g. "restylepro-production"
 *   GCP_REGION                     — e.g. "us-central1"
 *
 * Fallback to Gemini API:
 *   GOOGLE_AI_API_KEY              — existing Gemini API key
 */

// ── Google OAuth2 for Service Account ─────────────────────────

async function getAccessToken(saKey: string): Promise<string> {
  const sa = JSON.parse(saKey);
  const now = Math.floor(Date.now() / 1000);

  // Build JWT header + claims
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const b64url = (obj: any) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const headerB64 = b64url(header);
  const claimsB64 = b64url(claims);
  const unsignedJwt = `${headerB64}.${claimsB64}`;

  // Sign with private key (RS256)
  const pemContents = sa.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const keyBytes = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedJwt),
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const signedJwt = `${unsignedJwt}.${sigB64}`;

  // Exchange JWT for access token
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJwt}`,
  });

  if (!tokenResp.ok) {
    const err = await tokenResp.text();
    throw new Error(`OAuth2 token exchange failed: ${err}`);
  }

  const tokenData = await tokenResp.json();
  return tokenData.access_token;
}

// ── Cached access token ───────────────────────────────────────
let _cachedToken: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  const saKey = Deno.env.get("VERTEX_AI_SERVICE_ACCOUNT_KEY");
  if (!saKey) throw new Error("VERTEX_AI_SERVICE_ACCOUNT_KEY not set");

  const now = Date.now();
  if (_cachedToken && now < _tokenExpiry - 60_000) {
    return _cachedToken;
  }

  _cachedToken = await getAccessToken(saKey);
  _tokenExpiry = now + 3_600_000; // 1 hour
  return _cachedToken;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Imagen 4 Model Tiers:
 *   "ultra" → imagen-4.0-ultra-generate-001 — 2K native, elite photorealism ($0.06/img)
 *   "standard" → imagen-4.0-generate-001 — balanced speed/quality ($0.04/img)
 *   "fast" → imagen-4.0-fast-generate-001 — 10x faster, drafts ($0.02/img)
 *   "edit" → imagen-3.0-capability-001 — editing/inpainting
 */
export type ImagenTier = "ultra" | "standard" | "fast";

const IMAGEN_MODELS: Record<ImagenTier, string> = {
  ultra: "imagen-4.0-ultra-generate-001",
  standard: "imagen-4.0-generate-001",
  fast: "imagen-4.0-fast-generate-001",
};
const IMAGEN_EDIT_MODEL = "imagen-3.0-capability-001";

export interface ImagenGenerateOptions {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
  sampleCount?: number;
  tier?: ImagenTier;
  resolution?: "1K" | "2K";
}

export interface ImagenEditOptions {
  prompt: string;
  sourceImageBase64: string;
  negativePrompt?: string;
  sampleCount?: number;
}

export interface ImagenResult {
  success: boolean;
  imageBase64?: string;
  mimeType?: string;
  error?: string;
  backend: "vertex" | "gemini-api";
}

/** Check which backend is available */
export function getImagenBackend(): "vertex" | "gemini-api" | "none" {
  if (Deno.env.get("VERTEX_AI_SERVICE_ACCOUNT_KEY") && Deno.env.get("GCP_PROJECT_ID")) {
    return "vertex";
  }
  if (Deno.env.get("GOOGLE_AI_API_KEY")) {
    return "gemini-api";
  }
  return "none";
}

/** Generate image from text prompt using Imagen 3 */
export async function imagenGenerate(opts: ImagenGenerateOptions): Promise<ImagenResult> {
  const backend = getImagenBackend();
  console.log(`[IMAGEN] Backend: ${backend}`);

  if (backend === "vertex") {
    return vertexGenerate(opts);
  } else if (backend === "gemini-api") {
    return geminiApiGenerate(opts);
  }
  return { success: false, error: "No Imagen backend configured", backend: "vertex" };
}

/** Edit/transform an existing image using Imagen 3 capability model */
export async function imagenEdit(opts: ImagenEditOptions): Promise<ImagenResult> {
  const backend = getImagenBackend();
  console.log(`[IMAGEN] Edit backend: ${backend}`);

  if (backend === "vertex") {
    return vertexEdit(opts);
  } else if (backend === "gemini-api") {
    return geminiApiEdit(opts);
  }
  return { success: false, error: "No Imagen backend configured", backend: "vertex" };
}

// ── Mask-based editing (Imagen 3 capability) ──────────────────
// Proper inpaint-removal / outpaint with a MaskReferenceImage. Only the masked
// (white) region is synthesized; non-masked pixels are preserved — the 1:1
// property the plain generateContent endpoint cannot give.

export interface ImagenMaskEditOptions {
  sourceImageBase64: string;
  maskImageBase64: string;      // white = edit/remove region, black = keep
  prompt?: string;              // empty for pure removal
  maskMode?: "MASK_MODE_USER_PROVIDED" | "MASK_MODE_FOREGROUND" | "MASK_MODE_BACKGROUND" | "MASK_MODE_SEMANTIC";
  maskDilation?: number;        // 0..1 (default 0.01)
  baseSteps?: number;
  sampleCount?: number;
}

/** Inpaint-REMOVAL: erase the masked foreground and synthesize the surrounding pattern into it. */
export async function vertexInpaintRemoval(opts: ImagenMaskEditOptions): Promise<ImagenResult> {
  return vertexMaskEdit("EDIT_MODE_INPAINT_REMOVAL", opts);
}

/** Outpaint: place the source on a larger canvas (mask = the new empty border) and fill it seamlessly. */
export async function vertexOutpaint(opts: ImagenMaskEditOptions): Promise<ImagenResult> {
  return vertexMaskEdit("EDIT_MODE_OUTPAINT", opts);
}

async function vertexMaskEdit(editMode: string, opts: ImagenMaskEditOptions): Promise<ImagenResult> {
  const project = Deno.env.get("GCP_PROJECT_ID");
  if (!project || !Deno.env.get("VERTEX_AI_SERVICE_ACCOUNT_KEY")) {
    return { success: false, error: "Vertex not configured (need VERTEX_AI_SERVICE_ACCOUNT_KEY + GCP_PROJECT_ID)", backend: "vertex" };
  }
  const region = Deno.env.get("GCP_REGION") || "us-central1";
  const token = await getToken();
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${IMAGEN_EDIT_MODEL}:predict`;

  const body = {
    instances: [{
      prompt: opts.prompt || "",
      referenceImages: [
        {
          referenceType: "REFERENCE_TYPE_RAW",
          referenceId: 1,
          referenceImage: { bytesBase64Encoded: opts.sourceImageBase64 },
        },
        {
          referenceType: "REFERENCE_TYPE_MASK",
          referenceId: 2,
          referenceImage: { bytesBase64Encoded: opts.maskImageBase64 },
          maskImageConfig: {
            maskMode: opts.maskMode || "MASK_MODE_USER_PROVIDED",
            dilation: opts.maskDilation ?? 0.01,
          },
        },
      ],
    }],
    parameters: {
      editMode,
      editConfig: { baseSteps: opts.baseSteps ?? 35 },
      sampleCount: opts.sampleCount || 1,
      outputOptions: { mimeType: "image/png" },
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`[IMAGEN] ${editMode} ${resp.status}: ${err.slice(0, 500)}`);
    return { success: false, error: `${editMode} ${resp.status}: ${err.slice(0, 300)}`, backend: "vertex" };
  }
  const result = await resp.json();
  const prediction = result?.predictions?.[0];
  if (!prediction?.bytesBase64Encoded) {
    return { success: false, error: `No image in ${editMode} response`, backend: "vertex" };
  }
  return { success: true, imageBase64: prediction.bytesBase64Encoded, mimeType: prediction.mimeType || "image/png", backend: "vertex" };
}

// ── Vertex AI Implementation ──────────────────────────────────

async function vertexGenerate(opts: ImagenGenerateOptions): Promise<ImagenResult> {
  const project = Deno.env.get("GCP_PROJECT_ID")!;
  const region = Deno.env.get("GCP_REGION") || "us-central1";
  const token = await getToken();
  const tier = opts.tier || "ultra";
  const modelId = IMAGEN_MODELS[tier];

  console.log(`[IMAGEN] Vertex model: ${modelId} (${tier})`);
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/${modelId}:predict`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [{ prompt: opts.prompt }],
      parameters: {
        sampleCount: opts.sampleCount || 1,
        aspectRatio: opts.aspectRatio || "16:9",
        sampleImageSize: opts.resolution || "2K",
        ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
        outputOptions: { mimeType: "image/png" },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`[IMAGEN] Vertex generate ${resp.status}: ${err.slice(0, 500)}`);
    return { success: false, error: `Vertex ${resp.status}: ${err.slice(0, 300)}`, backend: "vertex" };
  }

  const result = await resp.json();
  const prediction = result?.predictions?.[0];

  if (!prediction?.bytesBase64Encoded) {
    return { success: false, error: "No image in Vertex response", backend: "vertex" };
  }

  return {
    success: true,
    imageBase64: prediction.bytesBase64Encoded,
    mimeType: prediction.mimeType || "image/png",
    backend: "vertex",
  };
}

async function vertexEdit(opts: ImagenEditOptions): Promise<ImagenResult> {
  const project = Deno.env.get("GCP_PROJECT_ID")!;
  const region = Deno.env.get("GCP_REGION") || "us-central1";
  const token = await getToken();

  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${project}/locations/${region}/publishers/google/models/imagen-3.0-capability-001:predict`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances: [{
        prompt: opts.prompt,
        image: { bytesBase64Encoded: opts.sourceImageBase64 },
      }],
      parameters: {
        sampleCount: opts.sampleCount || 1,
        ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
        outputOptions: { mimeType: "image/png" },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error(`[IMAGEN] Vertex edit ${resp.status}: ${err.slice(0, 500)}`);
    return { success: false, error: `Vertex edit ${resp.status}: ${err.slice(0, 300)}`, backend: "vertex" };
  }

  const result = await resp.json();
  const prediction = result?.predictions?.[0];

  if (!prediction?.bytesBase64Encoded) {
    return { success: false, error: "No image in Vertex edit response", backend: "vertex" };
  }

  return {
    success: true,
    imageBase64: prediction.bytesBase64Encoded,
    mimeType: prediction.mimeType || "image/png",
    backend: "vertex",
  };
}

// ── Gemini API Fallback ───────────────────────────────────────
// Uses generativelanguage.googleapis.com — Imagen may not be available
// on all API keys. Falls back gracefully.

async function geminiApiGenerate(opts: ImagenGenerateOptions): Promise<ImagenResult> {
  const key = Deno.env.get("GOOGLE_AI_API_KEY")!;

  // Try Imagen model first
  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt: opts.prompt }],
      parameters: {
        sampleCount: opts.sampleCount || 1,
        aspectRatio: opts.aspectRatio || "16:9",
        ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
        outputOptions: { mimeType: "image/png" },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.warn(`[IMAGEN] Gemini API Imagen not available: ${err.slice(0, 200)}`);
    return { success: false, error: `Gemini API Imagen unavailable: ${resp.status}`, backend: "gemini-api" };
  }

  const result = await resp.json();
  const prediction = result?.predictions?.[0];

  if (!prediction?.bytesBase64Encoded) {
    return { success: false, error: "No image from Gemini API Imagen", backend: "gemini-api" };
  }

  return {
    success: true,
    imageBase64: prediction.bytesBase64Encoded,
    mimeType: "image/png",
    backend: "gemini-api",
  };
}

async function geminiApiEdit(opts: ImagenEditOptions): Promise<ImagenResult> {
  const key = Deno.env.get("GOOGLE_AI_API_KEY")!;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-capability-001:predict?key=${key}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{
        prompt: opts.prompt,
        image: { bytesBase64Encoded: opts.sourceImageBase64 },
      }],
      parameters: {
        sampleCount: opts.sampleCount || 1,
        ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
        outputOptions: { mimeType: "image/png" },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    return { success: false, error: `Gemini API edit unavailable: ${resp.status}`, backend: "gemini-api" };
  }

  const result = await resp.json();
  const prediction = result?.predictions?.[0];

  if (!prediction?.bytesBase64Encoded) {
    return { success: false, error: "No image from Gemini API edit", backend: "gemini-api" };
  }

  return {
    success: true,
    imageBase64: prediction.bytesBase64Encoded,
    mimeType: "image/png",
    backend: "gemini-api",
  };
}
