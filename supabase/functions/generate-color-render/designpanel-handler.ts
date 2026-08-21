/**
 * Lean DesignPanel path inside the sanctioned generate-color-render producer.
 *
 * This handler is deliberately isolated from the legacy multi-product module at
 * startup. It accepts only server-authenticated
 * DesignProAI calls, reproduces one accepted hero at one locked camera angle,
 * and writes one owner-scoped immutable result.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as encodeBase64, decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { resolveDesignProInternalCaller } from "../_shared/designpro-internal-call.ts";
import { STUDIO_ENVIRONMENT } from "../_shared/studio-os.ts";
import { getAspectRatio, getCameraAngle, getResolution, WRAP_COVERAGE_RULES } from "../_shared/view-angles-os.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { canonicalizeVehicle, emitRenderEvent } from "../_shared/render-events.ts";
import { buildDesignPanelPrompt, buildDesignPanelRequestParts } from "./designpanel-contract.mjs";

const BUCKET = "wrap-files";
const MODEL = "gemini-3-pro-image-preview";
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const MAX_ATTEMPTS = 4;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-designpro-owner-id, x-designpro-mode",
};

function json(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeSegment(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "") || "x";
}

function outputLooksUsable(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 50_000) return false;
  const start = Math.max(0, bytes.byteLength - 10_000);
  const unique = new Set(bytes.slice(start));
  return unique.size >= 20;
}

function assertProjectStorageUrl(rawUrl: string): URL {
  const projectUrl = new URL(Deno.env.get("SUPABASE_URL")!);
  const referenceUrl = new URL(rawUrl);
  if (
    referenceUrl.protocol !== "https:" ||
    referenceUrl.origin !== projectUrl.origin ||
    !referenceUrl.pathname.startsWith("/storage/v1/")
  ) {
    throw new Error("designpanel_reference_url_invalid");
  }
  return referenceUrl;
}

export async function handleDesignPanelRender(req: Request): Promise<Response> {
  const renderStartMs = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const caller = await resolveDesignProInternalCaller(req);
  if (caller.rejection) return caller.rejection;
  if (!caller.internal || !caller.userId) {
    return json(401, { error: "designpro_internal_auth_required" });
  }
  const serverKey = String(req.headers.get("apikey") || "").trim();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serverKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  if (body.modeType !== "designpanelpro") {
    return json(400, { error: "designpanel_mode_required" });
  }
  if (
    body.skipLookups !== true ||
    body.skipCacheStorage !== true ||
    body.skipCache !== true ||
    body.forceNew !== true ||
    body.revisionPrompt ||
    body.originalRenderUrl
  ) {
    return json(400, { error: "designpanel_server_photographer_contract_required" });
  }
  const vehicleYear = String(body.vehicleYear || "").trim();
  const vehicleMake = String(body.vehicleMake || "").trim();
  const vehicleModel = String(body.vehicleModel || "").trim();
  const viewType = String(body.viewType || "").trim();
  const colorData = body.colorData && typeof body.colorData === "object" ? body.colorData : {};
  const userEmail = String(body.userEmail || "").trim().toLowerCase();
  if (!vehicleYear || !vehicleMake || !vehicleModel || !viewType) {
    return json(400, { error: "vehicle_and_view_required" });
  }
  if (!userEmail || userEmail !== String(caller.userEmail || "").trim().toLowerCase()) {
    return json(401, { error: "designpro_internal_owner_email_invalid" });
  }
  if (viewType === "side" || viewType === "driver-side") {
    return json(400, { error: "photographer_view_required" });
  }

  const { data: blockedUser } = await admin
    .from("blocked_users")
    .select("id, reason")
    .eq("email", userEmail)
    .maybeSingle();
  if (blockedUser) return json(403, { error: "account_suspended", blocked: true });

  const blockedTerms = [
    "palestine", "israel", "hamas", "hezbollah", "isis", "taliban",
    "nazi", "swastika", "confederate", "rebel fist", "freedom fighter",
    "political", "terrorist", "militia", "uprising", "revolution",
    "genocide", "ethnic cleansing", "war crime", "porn", "xxx", "nude",
    "naked", "sex", "erotic", "hentai", "nsfw", "adult content",
    "explicit", "genitals", "breasts", "penetration", "orgasm", "fetish",
    "bondage", "fuck", "shit", "bitch", "cunt", "dick", "cock", "pussy",
    "asshole", "bastard", "whore", "slut", "nigger", "faggot", "retard",
    "kike", "spic", "chink", "wetback", "beaner", "white power",
    "black power", "racial slur", "hate speech", "crack pipe",
    "drug paraphernalia",
  ];
  const contentToCheck = [
    colorData.colorName,
    colorData.patternName,
    colorData.designName,
    colorData.customStylingPrompt,
    vehicleMake,
    vehicleModel,
  ].filter(Boolean).join(" ").toLowerCase();
  const blockedTerm = blockedTerms.find((term) => contentToCheck.includes(term));
  if (blockedTerm) {
    await admin.from("moderation_log").insert({
      user_email: userEmail,
      blocked_term: blockedTerm,
      attempted_content: contentToCheck.substring(0, 500),
      ip_address: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null,
    });
    return json(400, { error: "content_policy_violation", contentViolation: true });
  }
  if (!hasGeminiKey()) return json(500, { error: "ai_service_not_configured" });

  const rawReferenceUrl = String(colorData.heroReferenceUrl || "").trim();
  if (!rawReferenceUrl) return json(400, { error: "hero_reference_required" });

  let referenceResponse: Response;
  try {
    const referenceUrl = assertProjectStorageUrl(rawReferenceUrl);
    referenceResponse = await fetch(referenceUrl, {
      headers: { "User-Agent": "DesignProAI/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error: any) {
    return json(400, { error: String(error?.message || error).slice(0, 200) });
  }
  if (!referenceResponse.ok) {
    return json(502, { error: "hero_reference_fetch_failed", status: referenceResponse.status });
  }
  const referenceBytes = await referenceResponse.arrayBuffer();
  if (!referenceBytes.byteLength || referenceBytes.byteLength > MAX_REFERENCE_BYTES) {
    return json(413, { error: "hero_reference_size_invalid", byteSize: referenceBytes.byteLength });
  }
  const reference = {
    mimeType: String(referenceResponse.headers.get("content-type") || "image/png").split(";", 1)[0],
    data: encodeBase64(referenceBytes),
  };

  const canonicalMakeModel = canonicalizeVehicle(vehicleMake, vehicleModel, vehicleYear);
  const vehicle = [vehicleYear, canonicalMakeModel || `${vehicleMake} ${vehicleModel}`]
    .filter(Boolean)
    .join(" ");
  const panelName = String(colorData.panelName || "DesignProAI");
  const finish = String(colorData.finish || "Gloss");
  const designAnchorText = String(colorData.designAnchorText || "").trim();
  const briefText = [
    panelName,
    designAnchorText,
    colorData.customStylingPrompt,
    colorData.originalPrompt,
    colorData.designBrief,
    colorData.prompt,
  ].filter(Boolean).join(" ");

  const prompt = buildDesignPanelPrompt({
    vehicle,
    viewType,
    panelName,
    finish,
    designAnchorText,
    briefText,
    hasHeroReference: true,
    cameraAngle: getCameraAngle(viewType || "side"),
    studioEnvironment: STUDIO_ENVIRONMENT,
    wrapCoverageRules: WRAP_COVERAGE_RULES,
  });
  const references = [
    { label: "pattern-primary", inlineData: reference },
    { label: "hero-reference", inlineData: reference },
  ];

  let imageBytes: Uint8Array | null = null;
  let lastError = "no_image";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const { parts, modalities } = buildDesignPanelRequestParts({
        attempt,
        prompt,
        references,
      });
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${getGeminiKey()}`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 1.0,
            responseModalities: modalities,
            imageConfig: {
              aspectRatio: getAspectRatio(viewType || "side"),
              imageSize: String(body.imageSizeOverride || getResolution(viewType || "side")),
            },
          },
        }),
        signal: AbortSignal.timeout(90_000),
      });

      if (!response.ok) {
        lastError = `gemini_http_${response.status}`;
        if (response.status === 403) return json(403, { error: "ai_key_or_quota_invalid" });
        if (response.status === 429) {
          if (attempt < MAX_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, 5_000 * attempt));
            continue;
          }
          return json(429, { error: "rate_limit_reached" });
        }
        throw new Error(lastError);
      }

      const payload: any = await response.json();
      if (payload?.error) {
        const message = String(payload.error.message || "gemini_error");
        if (payload.error.code === 400 && (message.includes("blocked") || message.includes("SAFETY"))) {
          return json(400, { error: "image_generation_blocked" });
        }
        throw new Error(message);
      }

      const candidates = payload?.candidates;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error("gemini_no_candidates");
      }
      const partsOut = candidates[0]?.content?.parts;
      if (!Array.isArray(partsOut) || partsOut.length === 0) {
        throw new Error("gemini_no_parts");
      }
      const imagePart = partsOut.find((part: any) => part?.inlineData?.data);
      if (!imagePart?.inlineData?.data) {
        lastError = "gemini_no_image";
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 1_000 * (2 ** (attempt - 1))));
          continue;
        }
        throw new Error(lastError);
      }

      const decoded = decodeBase64(String(imagePart.inlineData.data));
      if (!outputLooksUsable(decoded)) {
        lastError = "gemini_image_quality_invalid";
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          continue;
        }
        console.warn("DesignPanel quality gate failed on final tier; preserving canonical final-tier acceptance");
      }
      imageBytes = decoded;
      break;
    } catch (error: any) {
      lastError = String(error?.message || error).slice(0, 200);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, (2 ** attempt) * 1_000));
      }
    }
  }

  if (!imageBytes) return json(503, { error: "ai_generation_failed", detail: lastError });

  const storagePath = [
    "renders",
    caller.userId,
    "designpanelpro",
    `${Date.now()}_${safeSegment(vehicleMake)}_${safeSegment(vehicleModel)}_${safeSegment(viewType)}.png`,
  ].join("/");
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, imageBytes, {
      contentType: "image/png",
      upsert: false,
    });
  if (uploadError) {
    return json(500, { error: "storage_upload_failed", detail: uploadError.message.slice(0, 200) });
  }

  const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(storagePath);
  await emitRenderEvent({
    userId: caller.userId,
    email: userEmail,
    tool: "designpanelpro",
    mode: "designpanelpro",
    geminiModel: MODEL,
    geminiFinishReason: "STOP",
    vehicleYear,
    vehicleMake,
    vehicleModel,
    viewType,
    finish,
    rawPrompt: null,
    enhancedPrompt: prompt,
    renderUrl: publicData.publicUrl,
    success: true,
    latencyMs: Date.now() - renderStartMs,
  });
  return json(200, {
    renderUrl: publicData.publicUrl,
    storagePath,
    contentType: "image/png",
    cached: false,
    model: MODEL,
    sourceFunction: "generate-color-render",
  });
}
