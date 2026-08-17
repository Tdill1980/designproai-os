/**
 * GENERATE PATTERN RENDER — Dedicated PatternPro Edge Function
 * ═══════════════════════════════════════════════════════════════
 *
 * Separate from generate-color-render (which handles ColorPro) and
 * design-panel-ai-generate (which handles DesignProAI).
 *
 * Key difference: This function tells Gemini to REPRODUCE the exact
 * pattern/design from the reference image — not interpret a color name.
 * The panel image IS the design. Gemini applies it to the vehicle body
 * panels exactly as shown, maintaining colors, shapes, and composition.
 *
 * Inputs:
 *   - vehicleYear, vehicleMake, vehicleModel
 *   - viewType (side, front, rear, etc.)
 *   - colorData.panelUrl — the pattern image to apply
 *   - colorData.panelName — human label (NOT used in prompt to avoid misinterpretation)
 *   - colorData.finish — Gloss/Satin/Matte
 *   - colorData.patternScale — 0.3 to 3.0
 *
 * Uses shared modules: studio-os.ts, view-angles-os.ts, gemini-key-pool.ts
 * Does NOT modify any of those files.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { STUDIO_ENVIRONMENT } from "../_shared/studio-os.ts";
import { getCameraAngle } from "../_shared/view-angles-os.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { tokenGate } from "../_shared/token-gate.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_MODEL = "gemini-3-pro-image-preview";

// Cached preflight — keeps OPTIONS off the worker boot path
const preflightHeaders = {
  ...corsHeaders,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** Chunked base64 encoding — avoids stack overflow on large images */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Deterministic 31-bit seed from a string. Same swatch+view+vehicle always
 * produces the same seed, which paired with temperature=0.05 makes Gemini's
 * pattern replication reproducible across runs. Avoids the "click Generate
 * twice on the same swatch and get two different wraps" complaint.
 */
function deterministicSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483647;
}

function createServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: preflightHeaders });
  }

  // Token gate — 1 token per PatternPro render.
  const gate = await tokenGate(req, { reason: "pattern_render" });
  if (!gate.ok) return gate.response!;

  try {
    const {
      vehicleYear,
      vehicleMake,
      vehicleModel,
      vehicleType = "car",
      viewType = "side",
      userEmail,
      colorData,
      heroReferenceUrl,
      revisionPrompt,
    } = await req.json();

    // ── VALIDATE ────────────────────────────────────────────────
    if (!vehicleMake || !vehicleModel) {
      return new Response(
        JSON.stringify({ error: "Vehicle make and model required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!colorData?.panelUrl) {
      return new Response(
        JSON.stringify({ error: "Pattern image URL (panelUrl) required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "AI service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve user email from body or JWT
    let email = userEmail;
    if (!email) {
      try {
        const sb = createServiceClient();
        const authHeader = req.headers.get("Authorization");
        if (authHeader) {
          const token = authHeader.replace("Bearer ", "");
          const { data: { user } } = await sb.auth.getUser(token);
          email = user?.email;
        }
      } catch { /* non-fatal */ }
    }

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const vehicleClassLabel: Record<string, string> = {
      motorcycle: "motorcycle",
      boat: "boat",
      bus: "bus",
      rv: "RV",
      truck: "truck",
      suv: "SUV",
      van: "van",
      car: "car",
    };
    const classLabel = vehicleClassLabel[vehicleType] || "vehicle";
    const vehicle = `${vehicleYear || ""} ${vehicleMake} ${vehicleModel} ${classLabel}`.trim();
    const finish = colorData.finish || "Gloss";
    const patternScale = colorData.patternScale || 1.0;
    const scaleLabel = patternScale < 0.6 ? "micro/fine" : patternScale < 1.0 ? "small" : patternScale < 1.5 ? "standard" : patternScale < 2.5 ? "large/bold" : "extreme/oversized";

    // ── FETCH PATTERN IMAGE ─────────────────────────────────────
    console.log(`[PatternPro] Fetching pattern: ${colorData.panelUrl}`);
    const panelRes = await fetch(colorData.panelUrl);
    if (!panelRes.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch pattern image (${panelRes.status})` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const panelBuffer = await panelRes.arrayBuffer();
    const panelBase64 = uint8ArrayToBase64(new Uint8Array(panelBuffer));
    const panelMime = panelRes.headers.get("content-type") || "image/jpeg";
    console.log(`[PatternPro] Pattern fetched, base64 size: ${panelBase64.length}`);

    // ── FETCH HERO REFERENCE (cross-view consistency) ───────────
    let heroBase64: string | null = null;
    let heroMime = "image/jpeg";
    if (heroReferenceUrl && viewType !== "side") {
      try {
        const heroRes = await fetch(heroReferenceUrl);
        if (heroRes.ok) {
          const heroBuf = await heroRes.arrayBuffer();
          heroBase64 = uint8ArrayToBase64(new Uint8Array(heroBuf));
          heroMime = heroRes.headers.get("content-type") || "image/jpeg";
          console.log(`[PatternPro] Hero reference fetched for cross-view consistency`);
        }
      } catch { /* non-fatal */ }
    }

    // ── BUILD PROMPT ────────────────────────────────────────────
    // DETERMINISTIC + NAME-BLIND: Gemini must reproduce the attached swatch
    // SWATCH pixel-for-pixel onto the vehicle. The pattern name is NEVER
    // mentioned in the prompt — naming it lets Gemini's language model
    // override the pixels (e.g. "Pink Marble" → generic pink/white marble).
    // The ONLY ground truth is IMAGE 1's pixels.
    const cameraAngle = getCameraAngle(viewType);
    const hasHero = !!heroBase64 && viewType !== "side";

    // IMAGE 1 = pattern swatch (always). IMAGE 2 = prior hero render (optional).
    // Label the images explicitly so Gemini cannot confuse their roles. Do
    // NOT include the pattern name — that biases Gemini toward a stock
    // interpretation of the name instead of the actual pixels.
    const imageRoster = hasHero
      ? `IMAGE 1 — PATTERN SWATCH: the flat vinyl pattern. This IS the design. Do not name it, do not categorize it, do not assume what it represents — just reproduce its pixels.
IMAGE 2 — HERO REFERENCE: the previously approved driver-side render of this same vehicle with IMAGE 1 already applied. Match its wrap exactly; only the camera angle changes.`
      : `IMAGE 1 — PATTERN SWATCH: the flat vinyl pattern. This IS the design. Do not name it, do not categorize it, do not assume what it represents — just reproduce its pixels.`;

    let prompt = `Your task: apply IMAGE 1 as a printed vinyl wrap onto a ${vehicle}, then photograph it.

${imageRoster}

PATTERN FIDELITY — NON-NEGOTIABLE:
Reproduce IMAGE 1 pixel-for-pixel on the body panels. Sample colors directly from IMAGE 1 — do not shift hue, saturation, or value. Preserve every shape, vein, swirl, line, and texture exactly as they appear in IMAGE 1. Do NOT use prior knowledge of any pattern style or material name to guess what it "should" look like — IMAGE 1 is the only source of truth. Never substitute a similar-looking pattern, never re-stylize, never simplify the composition. Treat IMAGE 1 as a printed film you are laying onto the vehicle.

WHITE BACKGROUND HANDLING: IMAGE 1 may have a white or near-white background surrounding the actual pattern artwork. That white area is NOT part of the design — it is just the canvas the pattern was saved on. Ignore it completely. Extract only the actual pattern/artwork/design elements and apply those to the vehicle. The white background must never appear on the vehicle body panels.

Pattern scale on vehicle: ${scaleLabel} (${Math.round(patternScale * 100)}%).
Finish: ${finish}.
The wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.

${STUDIO_ENVIRONMENT}

${cameraAngle}

Canon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, colors sampled from IMAGE 1.`;

    if (revisionPrompt) {
      prompt += `\n\nREVISION REQUEST (keep IMAGE 1 pattern fidelity — do not interpret pattern name): ${revisionPrompt}`;
    }

    // No "output the pattern name" line — we already know the name client-side
    // and feed it via colorData.panelName. Asking Gemini to name the pattern
    // forces it to semantically classify IMAGE 1, which leaks back into how
    // it renders the pixels. Better to keep Gemini name-blind end-to-end.

    console.log(`[PatternPro] Prompt built, length: ${prompt.length}, view: ${viewType}`);

    // ── BUILD GEMINI REQUEST ────────────────────────────────────
    // Parts order MUST match the "IMAGE 1 / IMAGE 2" labels in the prompt:
    // [IMAGE 1 = pattern swatch] → [IMAGE 2 = hero ref (optional)] → [text].
    // Putting images BEFORE the text anchors them as the primary inputs
    // and cuts Gemini's tendency to invent a similar pattern.
    const parts: any[] = [];
    parts.push({ inlineData: { mimeType: panelMime, data: panelBase64 } });
    if (heroBase64) {
      parts.push({ inlineData: { mimeType: heroMime, data: heroBase64 } });
    }
    parts.push({ text: prompt });

    const geminiKey = getGeminiKey();
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiKey}`;

    // Stable seed per (swatch + view + vehicle). Same inputs → same render.
    // Revision prompts vary the seed so a revision actually produces a
    // different image instead of the identical one.
    const seed = deterministicSeed(
      `${colorData.panelUrl}|${viewType}|${vehicle}|${revisionPrompt || ""}`,
    );

    const geminiBody = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        // Near-zero temperature for deterministic pattern replication.
        // Higher temps let Gemini "improvise" and swap in a similar-looking
        // pattern, which was the #1 PatternPro complaint (e.g. Pink Marble
        // rendering as white/gray Grecian Marble).
        temperature: 0.05,
        seed,
        // NO maxOutputTokens on image calls — a 4K image needs far more output
        // tokens than a text cap allows; capping truncates the image and Gemini
        // returns text-only (NO_IMAGE → 422 on every render). The working render
        // functions only cap their text-only anchor calls.
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "4K",
        },
      },
    };

    // ── CALL GEMINI ─────────────────────────────────────────────
    console.log(`[PatternPro] Calling Gemini (${GEMINI_MODEL})...`);
    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });

    const shortPrompt = `Apply IMAGE 1 pixel-for-pixel as a printed vinyl wrap onto a ${vehicle}. Reproduce every color and shape of IMAGE 1 exactly. Ignore any white/near-white background in IMAGE 1 — that is just the canvas, not part of the design. ${finish} finish. ${cameraAngle} Canon EOS R5. 16:9.`;

    const callGeminiShort = async () => {
      const retryBody = {
        contents: [{
          role: "user",
          parts: [
            { text: shortPrompt },
            { inlineData: { mimeType: panelMime, data: panelBase64 } },
          ],
        }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          temperature: 0.05,
          seed,
          imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
        },
      };
      return await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retryBody),
      });
    };

    // Tier 1: full prompt. On Gemini HTTP error OR NO_IMAGE, fall back to short prompt.
    let geminiData: any = null;
    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error(`[PatternPro] Gemini ${geminiRes.status}:`, errText);
      console.log("[PatternPro] Retrying with shortened prompt (HTTP error)...");
      const retryRes = await callGeminiShort();
      if (!retryRes.ok) {
        return new Response(
          JSON.stringify({ error: `AI generation failed (${retryRes.status})` }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      geminiData = await retryRes.json();
    } else {
      geminiData = await geminiRes.json();
    }

    // Tier 2: if first response contains no image (NO_IMAGE or empty), retry once with short prompt.
    if (!extractImage(geminiData) && geminiRes.ok) {
      const finishReason = geminiData?.candidates?.[0]?.finishReason;
      console.warn(`[PatternPro] No image in response (finishReason=${finishReason}) — retrying with short prompt...`);
      const retryRes = await callGeminiShort();
      if (retryRes.ok) {
        geminiData = await retryRes.json();
      } else {
        console.error(`[PatternPro] Short-prompt retry failed: ${retryRes.status}`);
      }
    }

    return await processGeminiResponse(geminiData, vehicle, viewType, email, colorData);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[PatternPro] Error:", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

/**
 * Pure extractor — pulls image bytes + design name out of a Gemini response.
 * Returns null when Gemini chose text-only (finishReason=NO_IMAGE) or the
 * candidate had no inlineData parts. Used by the main handler to decide
 * whether a short-prompt retry is needed before failing the request.
 */
function extractImage(
  geminiData: any,
): { imageData: string; imageMime: string; designName: string | null } | null {
  const candidate = geminiData?.candidates?.[0];
  if (!candidate) return null;
  let imageData: string | null = null;
  let imageMime = "image/png";
  let designName: string | null = null;
  for (const part of candidate.content?.parts || []) {
    if (part.text) {
      const t = part.text.trim().replace(/^["']|["']$/g, "").slice(0, 60);
      if (t) designName = t;
    }
    if (part.inlineData) {
      imageData = part.inlineData.data;
      imageMime = part.inlineData.mimeType || "image/png";
    }
  }
  if (!imageData) return null;
  return { imageData, imageMime, designName };
}

/**
 * Process Gemini response — extract image, upload to storage, save to DB.
 */
async function processGeminiResponse(
  geminiData: any,
  vehicle: string,
  viewType: string,
  email: string,
  colorData: any,
): Promise<Response> {
  const sb = createServiceClient();

  const extracted = extractImage(geminiData);
  if (!extracted) {
    const finishReason = geminiData?.candidates?.[0]?.finishReason;
    console.warn(`[PatternPro] Final response has no image (finishReason=${finishReason})`);
    return new Response(
      JSON.stringify({ error: "AI did not generate an image — please try again" }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const designName = extracted.designName || colorData.panelName || "PatternPro Design";
  const imageData = extracted.imageData;
  const imageMime = extracted.imageMime;

  // ── UPLOAD TO STORAGE ─────────────────────────────────────
  const { data: { user } } = await sb.auth.getUser(
    (await sb.auth.getSession()).data.session?.access_token || "",
  ).catch(() => ({ data: { user: null } }));

  // Find user by email for shop_id
  // Resolve user ID from auth — no profiles table needed
  let userId = "anonymous";
  try {
    const authHeader = (await sb.auth.getSession()).data.session?.access_token;
    if (authHeader) {
      const { data: { user } } = await sb.auth.getUser(authHeader);
      if (user?.id) userId = user.id;
    }
  } catch { /* fallback to anonymous */ }
  const ext = imageMime.includes("png") ? "png" : "jpg";
  const timestamp = Date.now();
  const vMake = (colorData.vehicleMake || vehicle.split(" ")[1] || "vehicle").replace(/\s+/g, "_");
  const vModel = (colorData.vehicleModel || vehicle.split(" ")[2] || "model").replace(/\s+/g, "_");
  const storagePath = `renders/${userId}/patternpro/${timestamp}_${vMake}_${vModel}_${viewType}.${ext}`;

  // Single-pass decode into a preallocated buffer. Uint8Array.from(atob(...),
  // mapFn) allocates a temp string per byte — tens of millions on a 4K image —
  // which blows the 256MB worker limit (546 WORKER_RESOURCE_LIMIT).
  const imageBinary = atob(imageData);
  const imageBytes = new Uint8Array(imageBinary.length);
  for (let i = 0; i < imageBinary.length; i++) imageBytes[i] = imageBinary.charCodeAt(i);

  const { error: uploadErr } = await sb.storage
    .from("wrap-files")
    .upload(storagePath, imageBytes, {
      contentType: imageMime,
      upsert: true,
    });

  if (uploadErr) {
    console.error("[PatternPro] Storage upload failed:", uploadErr);
    return new Response(
      JSON.stringify({ error: "Failed to save render" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const renderUrl = `${SUPABASE_URL}/storage/v1/object/public/wrap-files/${storagePath}`;
  console.log(`[PatternPro] Render uploaded: ${renderUrl}`);

  // ── SAVE TO DB ────────────────────────────────────────────
  const { data: vizRow, error: vizErr } = await sb
    .from("color_visualizations")
    .insert({
      customer_email: email,
      vehicle_year: colorData.vehicleYear || null,
      vehicle_make: colorData.vehicleMake || vehicle.split(" ")[1] || null,
      vehicle_model: colorData.vehicleModel || vehicle.split(" ")[2] || null,
      color_name: colorData.panelName || "PatternPro Design",
      finish_type: colorData.finish || "Gloss",
      render_urls: { [viewType]: renderUrl },
      generation_status: "complete",
      mode_type: "wbty",
      tool_source: "patternpro",
      shop_id: userId !== "anonymous" ? userId : null,
    })
    .select("id")
    .maybeSingle();

  if (vizErr) {
    console.warn("[PatternPro] DB insert warning:", vizErr);
  }

  console.log(`[PatternPro] Complete — ${viewType} view, design: "${designName}"`);

  return new Response(
    JSON.stringify({
      renderUrl,
      designName,
      renderId: vizRow?.id || null,
      viewType,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
