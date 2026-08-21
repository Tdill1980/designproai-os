/**
 * Lean DesignPanel photographer.
 *
 * This endpoint is deliberately isolated from the multi-product
 * generate-color-render bundle. It accepts only server-authenticated
 * DesignProAI calls, reproduces one accepted hero at one locked camera angle,
 * and writes one owner-scoped immutable result.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as encodeBase64, decode as decodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { resolveDesignProInternalCaller } from "../_shared/designpro-internal-call.ts";
import { STUDIO_ENVIRONMENT } from "../_shared/studio-os.ts";
import { getAspectRatio, getCameraAngle, getResolution } from "../_shared/view-angles-os.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const BUCKET = "wrap-files";
const MODEL = "gemini-3-pro-image-preview";
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const MAX_ATTEMPTS = 4;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-designpro-owner-id",
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

function extensionFor(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
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

function buildPrompt(input: {
  vehicle: string;
  viewType: string;
  panelName: string;
  finish: string;
  designAnchorText: string;
  briefText: string;
}): string {
  const { vehicle, viewType, panelName, finish, designAnchorText, briefText } = input;
  const cameraAngle = getCameraAngle(viewType || "side");
  const wantsPhoto =
    /\b(photo|photos|photograph|photographs|photographic|photo-?realistic|photorealism|photoreal)\b/i.test(briefText) ||
    /\b(lifelike|true[-\s]to[-\s]life)\b/i.test(briefText) ||
    (/\brealistic\b/i.test(briefText) && /\b(photo|image|render|look|looking|scene|imagery)\b/i.test(briefText));
  const photoLock = wantsPhoto
    ? `

PHOTOGRAPHIC REALISM LOCK: the customer explicitly asked for a real photo. The imagery in this wrap must read as an actual high-resolution color photograph with natural light, true-to-life color, real depth, and real texture. It is not a cartoon, illustration, drawing, painting, vector, or clip-art. Only a logo may be a designed graphic.`
    : "";

  const finishSpecs: Record<string, string> = {
    gloss: "High-gloss laminate — shiny wet-look surface with crisp reflections.",
    matte: "Matte laminate — completely flat, zero reflections, velvet appearance.",
    satin: "Satin laminate — soft sheen between matte and gloss, silk-like.",
  };
  const normalizedFinish = finish.toLowerCase();
  const finishSpec = finishSpecs[normalizedFinish] || finishSpecs.gloss;
  const viewLabel = viewType.replace(/[-_]/g, " ");
  const viewScene = viewType === "hood_detail"
    ? `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a premium artistic vehicle wrap. The wrap is real printed vinyl; the hood artwork is the hero, rich with layered detail and depth. No new text, logos, or branding.`
    : viewType === "close-up"
      ? `A photorealistic close-up photograph of a ${vehicle}'s body panel from 12 inches away. Show vinyl texture grain, laminate sheen, ink depth, and the printed design conforming to the body curve.`
      : `A photorealistic studio photograph of a ${vehicle} with a premium artistic vehicle wrap fully installed. The wrap is real printed vinyl with the hero artwork spanning the door panels and flowing naturally with every body line.`;

  return `CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${viewScene}

The attached reference image is the accepted driver-side photograph of this exact ${vehicle}. Render the SAME vehicle with the SAME wrap design from the ${viewLabel} angle. Preserve every color, pattern, graphic element, composition choice, and design detail. Change only the camera position.

Panel Design: ${panelName}
${designAnchorText ? `DESIGN CONTINUITY — match this accepted hero exactly:
${designAnchorText}

` : ""}Finish: ${finish.toUpperCase()} — ${finishSpec} The finish is ${normalizedFinish} across every wrapped panel.

${STUDIO_ENVIRONMENT}

${cameraAngle}

The wrap covers painted body panels only. Windows, lights, wheels, tires, mirrors, and trim stay factory. Do not invent or remove text. Canon EOS R5, 35mm f/8, tack-sharp, 16:9 landscape, perfect exposure, vibrant accurate colors.${photoLock}`;
}

function requestPartsFor(
  attempt: number,
  prompt: string,
  reference: { mimeType: string; data: string },
): { parts: Array<Record<string, unknown>>; modalities: string[] } {
  if (attempt === 1) {
    return {
      parts: [{ text: prompt }, { inlineData: reference }],
      modalities: ["TEXT", "IMAGE"],
    };
  }
  const shortPrompt = attempt === 2
    ? ("[GENERATE IMAGE] " + prompt).slice(0, 2000)
    : ("[GENERATE IMAGE] " + prompt).slice(0, 1000);
  return {
    parts: [{ text: shortPrompt }, { inlineData: reference }],
    modalities: attempt === 3 ? ["IMAGE"] : ["TEXT", "IMAGE"],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const caller = await resolveDesignProInternalCaller(req);
  if (caller.rejection) return caller.rejection;
  if (!caller.internal || !caller.userId) {
    return json(401, { error: "designpro_internal_auth_required" });
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  if (body.modeType !== "designpanelpro") {
    return json(400, { error: "designpanel_mode_required" });
  }
  const vehicleYear = String(body.vehicleYear || "").trim();
  const vehicleMake = String(body.vehicleMake || "").trim();
  const vehicleModel = String(body.vehicleModel || "").trim();
  const viewType = String(body.viewType || "").trim();
  const colorData = body.colorData && typeof body.colorData === "object" ? body.colorData : {};
  if (!vehicleYear || !vehicleMake || !vehicleModel || !viewType) {
    return json(400, { error: "vehicle_and_view_required" });
  }
  if (viewType === "side" || viewType === "driver-side") {
    return json(400, { error: "photographer_view_required" });
  }
  if (!hasGeminiKey()) return json(500, { error: "ai_service_not_configured" });

  const rawReferenceUrl = String(colorData.heroReferenceUrl || colorData.panelUrl || "").trim();
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

  const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ");
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

  const prompt = buildPrompt({
    vehicle,
    viewType,
    panelName,
    finish,
    designAnchorText,
    briefText,
  });

  let imageBytes: Uint8Array | null = null;
  let imageMimeType = "image/png";
  let lastError = "no_image";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { parts, modalities } = requestPartsFor(attempt, prompt, reference);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${getGeminiKey()}`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
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
    } catch (error: any) {
      lastError = String(error?.message || error).slice(0, 200);
      if (attempt < MAX_ATTEMPTS) continue;
      break;
    }

    if (!response.ok) {
      lastError = `gemini_http_${response.status}`;
      if (response.status === 403) return json(403, { error: "ai_key_or_quota_invalid" });
      if (attempt < MAX_ATTEMPTS && (response.status === 429 || response.status >= 500)) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      break;
    }

    const payload: any = await response.json();
    const partsOut = payload?.candidates?.[0]?.content?.parts;
    const imagePart = Array.isArray(partsOut)
      ? partsOut.find((part: any) => part?.inlineData?.data)
      : null;
    if (!imagePart?.inlineData?.data) {
      lastError = "gemini_no_image";
      if (attempt < MAX_ATTEMPTS) continue;
      break;
    }

    const decoded = decodeBase64(String(imagePart.inlineData.data));
    if (!outputLooksUsable(decoded)) {
      lastError = "gemini_image_quality_invalid";
      if (attempt < MAX_ATTEMPTS) continue;
      break;
    }
    imageBytes = decoded;
    imageMimeType = String(imagePart.inlineData.mimeType || "image/png").split(";", 1)[0];
    break;
  }

  if (!imageBytes) return json(502, { error: lastError });

  const serverKey = String(req.headers.get("apikey") || "").trim();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serverKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const storagePath = [
    "renders",
    caller.userId,
    "designpanelpro",
    `${Date.now()}_${safeSegment(vehicleMake)}_${safeSegment(vehicleModel)}_${safeSegment(viewType)}.${extensionFor(imageMimeType)}`,
  ].join("/");
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, imageBytes, {
      contentType: imageMimeType,
      upsert: false,
    });
  if (uploadError) {
    return json(500, { error: "storage_upload_failed", detail: uploadError.message.slice(0, 200) });
  }

  return json(200, {
    storagePath,
    contentType: imageMimeType,
    model: MODEL,
    sourceFunction: "design-panel-color-render",
  });
});
