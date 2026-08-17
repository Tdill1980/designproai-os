/**
 * generate-wall-design — AI wall art / mural generator for WallPro
 *
 * Modes:
 *   1. "generate"  — Text prompt → flat print-ready wall art (no room context)
 *   2. "composite" — User wall photo + design/prompt → installed on their wall
 *   3. "studio"    — User design and/or prompt + studio room type → photo-
 *                    realistic interior render with the wrap on a feature wall.
 *                    Works with prompt-only, design-only, or both.
 *
 * Returns: { success, image_url, storage_path, design_name, scene_render }
 *   scene_render=true means image_url is a full photorealistic interior render
 *   (composite/studio). false means it is flat print-ready artwork.
 *
 * Retry strategy (aligned with design-panel-ai-generate golden pattern):
 *   - Up to 3 attempts with exponential backoff (2s, 4s, 8s)
 *   - Rotates Gemini API keys via pool on each attempt
 *   - Retries on 429 rate limit, 5xx server errors, network timeouts
 *   - Retries on NO_IMAGE / empty content with SAME full prompt + images
 *     (preserves wall photo context — never downgrades to text-only)
 *   - Returns clear error codes on hard failures (CONTENT_FILTERED, QUOTA,
 *     GENERATION_FAILED) so the frontend can show useful messages
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import { tokenGate } from "../_shared/token-gate.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const BUCKET = "wrap-files";
const MODEL = "gemini-3-pro-image-preview";
const MAX_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 90_000;
// Supabase kills edge functions at ~150s. Leave headroom for upload + response.
const WALL_CLOCK_BUDGET_MS = 135_000;

// Realistic interior scene descriptions for each studio room type. These let
// Gemini produce a believable photograph of the wrap installed on a feature
// wall in the chosen environment instead of a generic gradient blob.
const ROOM_SCENES: Record<string, string> = {
  office:
    "a modern corporate office interior — clean bright space, light oak floor, a sleek contemporary desk and ergonomic chair in the foreground, minimal decor, floor-to-ceiling windows on one side letting in soft natural daylight, one large feature wall facing camera",
  gym:
    "an upscale fitness gym interior — polished concrete floor, matte black ceiling with industrial track lighting, chrome and black strength equipment partially visible at the edges, strong even lighting, one large feature wall facing camera",
  retail:
    "a high-end retail showroom interior — warm white oak floor, minimalist product fixtures along the sides, track spot lighting, spacious open layout, one large feature wall facing camera",
  restaurant:
    "an upscale restaurant and bar interior — moody warm ambient lighting, dark walnut banquettes and tables in the foreground, brass pendant lights, sophisticated atmosphere, one large feature wall facing camera",
  lobby:
    "a premium corporate lobby — polished stone floor, contemporary lounge seating, a minimal reception desk visible, soft natural light from clerestory windows, refined professional mood, one large feature wall facing camera",
  living:
    "an elegant residential living room — warm oak floor, a contemporary sofa and area rug in the foreground, soft natural daylight, tasteful interior design, one large feature wall facing camera",
  studio_wall:
    "a smooth neutral wall in a clean, modern commercial interior with soft even lighting",
  canvas:
    "a gallery-style stretched canvas on a simple easel in a clean photography studio with soft even lighting",
};

const getRoomScene = (surfaceType: string | undefined): string =>
  (surfaceType && ROOM_SCENES[surfaceType]) || ROOM_SCENES.studio_wall;

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Rewrite a Supabase Storage public URL to use the image-transformation
 * render endpoint, so iPhone HEIC photos and oversized originals are
 * auto-converted to JPEG and resized server-side before we forward them
 * to Gemini. Gemini rejects HEIC outright and chokes on 8–12 MB iPhone
 * originals — this is the difference between "WallPro 502" and a clean
 * render.
 *
 * Pass-through for any non-Supabase URL (legacy uploads, external refs).
 */
function optimizeImageUrl(url: string): string {
  // Match: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
  const m = url.match(/^(https?:\/\/[^/]+)\/storage\/v1\/object\/public\/(.+)$/);
  if (!m) return url; // not a Supabase storage public URL — leave alone
  const [, origin, objectPath] = m;
  // Strip any existing query string off the original path before re-adding ours.
  const cleanPath = objectPath.split("?")[0];
  return `${origin}/storage/v1/render/image/public/${cleanPath}?width=1920&height=1920&resize=contain&format=jpeg&quality=85`;
}

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mime: string }> {
  const optimizedUrl = optimizeImageUrl(url);
  const resp = await fetch(optimizedUrl);
  if (!resp.ok) {
    // If the render endpoint failed (e.g., transformation not enabled on
    // this bucket), fall back to the raw URL so we don't completely block
    // the request. Still useful for non-iPhone uploads under the size cap.
    if (optimizedUrl !== url) {
      console.warn(
        `[generate-wall-design] Image transformation failed (${resp.status}) — falling back to raw URL`,
      );
      const fallbackResp = await fetch(url);
      if (!fallbackResp.ok) {
        throw new Error(`Failed to fetch image (${fallbackResp.status}): ${url}`);
      }
      const buf = await fallbackResp.arrayBuffer();
      return {
        base64: uint8ToBase64(new Uint8Array(buf)),
        mime: fallbackResp.headers.get("content-type") || "image/jpeg",
      };
    }
    throw new Error(`Failed to fetch image (${resp.status}): ${url}`);
  }
  const buf = await resp.arrayBuffer();
  const bytes = new Uint8Array(buf);
  return {
    base64: uint8ToBase64(bytes),
    // The transform endpoint always returns the requested format (JPEG)
    // regardless of the original. For pass-through URLs, trust the
    // content-type header.
    mime: optimizedUrl !== url ? "image/jpeg" : (resp.headers.get("content-type") || "image/jpeg"),
  };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // ── WallPro production-pack vault write (service role) ──────────────────────
  // The client slices the wall design into 54"-roll panels (client-side, Canvas)
  // and uploads them to storage, then calls this action to RECORD them in the
  // shared production_flow_assets vault so the design team can pick a wall order
  // up alongside vehicle jobs. This is NOT a render: it must run BEFORE the token
  // gate (no token charge) and needs no Gemini key. Peek the body via req.clone()
  // so the render path below still reads req.json() unchanged.
  try {
    const peek = await req.clone().json();
    if (peek?.action === "persist_wall_panels") {
      // Light auth — require a valid user (service role does the insert, but we
      // don't want anonymous writes). No token is charged.
      const authHeader = req.headers.get("authorization") || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const svc = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: userData } = token ? await svc.auth.getUser(token) : { data: { user: null } };
      if (!userData?.user) return jsonResponse({ error: "Authentication required", code: "NO_AUTH" }, 401);

      const jobId = String(peek.jobId || crypto.randomUUID());
      const panels = Array.isArray(peek.panels) ? peek.panels : [];
      const rows = panels
        .filter((p: any) => p && p.url)
        .map((p: any, i: number) => ({
          job_id: jobId,
          side: `PANEL-${p.index ?? i + 1}`,
          version: "wallpro",
          dimensions_inches: {
            w: Number(p.widthInches) || 0,
            h: Number(p.heightInches) || 0,
            bleed: Number(p.bleedInches) || 0,
          },
          // branding_url / depth_mask_url / final_pack_url are NOT NULL; a wall
          // panel has no separate branded/overlay/final asset (the panel IS the
          // print file), so branding mirrors the panel and the rest are "".
          background_url: String(p.url),
          branding_url: String(p.url),
          depth_mask_url: "",
          final_pack_url: "",
        }));
      if (!rows.length) return jsonResponse({ error: "No panels to persist", code: "BAD_REQUEST" }, 400);
      const { error: insErr } = await svc.from("production_flow_assets").insert(rows);
      if (insErr) return jsonResponse({ error: insErr.message, code: "INSERT_FAILED" }, 500);
      return jsonResponse({ success: true, jobId, inserted: rows.length });
    }
  } catch (_) {
    // Not a persist call (or unparseable) — fall through to the normal render path.
  }

  // Token gate — 1 token per WallPro render.
  const gate = await tokenGate(req, { reason: "wall_design_render" });
  if (!gate.ok) return gate.response!;

  const WALL_CLOCK_START = Date.now();
  const remainingMs = () => WALL_CLOCK_BUDGET_MS - (Date.now() - WALL_CLOCK_START);

  try {
    if (!hasGeminiKey()) {
      console.error("[generate-wall-design] No Gemini key configured");
      return jsonResponse(
        { error: "AI service is not configured. Contact support.", code: "NO_API_KEY" },
        500,
      );
    }

    const body = await req.json();
    const {
      mode = "generate",
      prompt,
      wall_photo_url,
      design_url,
      height_inches,
      width_inches,
      surface_type = "studio_wall",
      aspect_ratio = "16:9",
    } = body;

    if (!prompt && !design_url && !wall_photo_url) {
      return jsonResponse(
        { error: "Provide a prompt, a design_url, or a wall_photo_url", code: "BAD_REQUEST" },
        400,
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Build prompt parts
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    const dimLabel = height_inches && width_inches
      ? `${height_inches}" H × ${width_inches}" W`
      : "";

    // ── Designer identity — shared across all modes ─────────────
    // Elevates Gemini from generic clip-art output to the caliber of work
    // interior designers and premium sign-and-graphics shops actually sell.
    const DESIGNER_IDENTITY =
      `You are the senior creative director at a premium sign & graphics company that builds install-ready wall murals, environmental branding, and printed vinyl wraps for luxury and commercial interiors — boutique hotels, corporate lobbies and offices, flagship retail, fine dining, bars, malls, fitness clubs and gyms, modern apartments and homes, schools and universities, and lifestyle spaces. Your work is what interior designers and architects spec at $30–$150 per square foot installed — the aesthetic of Williams Sonoma Home, Restoration Hardware, and Schumacher wallpaper. Every design is built with tangible depth and texture: dimensional shading, tactile surface detail (paper grain, brush stroke, stone, woven fiber, metallic leaf, ink bleed), layered hierarchy, and refined color harmony. Nothing flat or clip-art — the viewer should be able to feel the paper, the pigment, and the hand of the designer.`;

    const CAPABILITIES =
      `Your output spans the full range a premium sign & graphics shop delivers: large-format murals and wallpaper; environmental branding (company logos, brand marks, tagline walls, mission statements, values walls, donor walls, wayfinding); typography-driven designs (custom letterforms, hand-lettered headlines, editorial display type, manifesto walls); mixed media (typography layered with graphic forms, illustration, photography, or pattern); and refined decorative art (botanical, abstract, geometric, architectural). When the brief calls for text or branding, render clean, crisp, production-ready letterforms — vector-sharp, correctly spelled, no gibberish or AI scribble. When the brief does not call for text, omit it entirely — no spurious captions, labels, borders, or watermarks.`;

    const FIDELITY =
      `Output super high-fidelity, ultra high-resolution, print-ready artwork at 4K detail — tack-sharp edges, fine gradient control, rich texture depth, vivid saturated color, flawless large-format print quality. Designed to hold up full-bleed at 8+ feet tall without pixelation.`;

    const DESIGN_TRANSLATION =
      `Translate the brief into refined design geometry: "botanical" → oversized dimensional florals with painterly shading and negative space; "industrial" → layered concrete, brushed metal, and architectural linework; "abstract" → sculptural color fields with intentional gesture; "geometric" → precise repeating modules with depth and shadow; "luxury" → deep jewel tones, brass or gold accents, marble and velvet textures; "minimalist" → bold negative space, one hero element, restrained palette; "lifestyle/sports" → dynamic motion, layered graphic forms; "typography/branding" → bold editorial headline type with hierarchy, optional supporting marks or iconography; references like "art deco" or "mid-century" translate into period-accurate pattern vocabulary, not literal copies.`;

    if (mode === "generate") {
      // Mode 1: Pure prompt → generate wall art
      parts.push({
        text: [
          DESIGNER_IDENTITY,
          CAPABILITIES,
          `Deliver a photorealistic flat artwork panel designed for print on Avery Dennison MPI 2610 wall vinyl. Flat 2D artwork only — NOT a 3D room render, NOT a photo of a wall.`,
          FIDELITY,
          dimLabel ? `Wall dimensions: ${dimLabel}.` : "",
          `Design brief: "${prompt}"`,
          DESIGN_TRANSLATION,
          `Output a single original creative design name (2-4 words, no quotes) before the image.`,
        ].filter(Boolean).join("\n\n"),
      });
    } else if (mode === "composite" && wall_photo_url) {
      // Mode 2: User wall photo + design/prompt → composite on wall
      const wallImg = await fetchImageAsBase64(wall_photo_url);
      parts.push({ inlineData: { mimeType: wallImg.mime, data: wallImg.base64 } });

      if (design_url) {
        const designImg = await fetchImageAsBase64(design_url);
        parts.push({ inlineData: { mimeType: designImg.mime, data: designImg.base64 } });
        parts.push({
          text: [
            DESIGNER_IDENTITY,
            CAPABILITIES,
            `The first image is a real photograph of a client's wall. The second image is the approved artwork. Deliver a photorealistic install preview: render the artwork as a premium printed vinyl wall wrap professionally installed onto the wall — smooth, flush, no bubbles, with shadows and lighting that match the room's existing ambient light. The install should read like a flagship commercial project, not a flat sticker.`,
            FIDELITY,
            dimLabel ? `The wrap covers ${dimLabel} of the wall.` : "",
            prompt ? `Additional direction: ${prompt}` : "",
          ].filter(Boolean).join("\n\n"),
        });
      } else {
        parts.push({
          text: [
            DESIGNER_IDENTITY,
            CAPABILITIES,
            `This is a real photograph of a client's wall. Design a custom mural, environmental branding, or typography piece for this specific space and deliver a photorealistic install preview of it professionally installed — smooth, flush, with shadows and lighting that match the room. The design should feel intentional for the architecture, not a generic pattern.`,
            FIDELITY,
            dimLabel ? `The wrap covers ${dimLabel} of the wall.` : "",
            `Design brief: "${prompt}"`,
            DESIGN_TRANSLATION,
          ].filter(Boolean).join("\n\n"),
        });
      }
    } else if (mode === "studio") {
      // Mode 3: Render in a styled studio/room scene. Works with prompt,
      // user design, or both. Uses ROOM_SCENES so each studio room type
      // (office, gym, retail, restaurant, lobby, living, studio_wall, canvas)
      // produces a distinct, believable interior — not a generic backdrop.
      const scene = getRoomScene(surface_type);

      if (design_url) {
        const designImg = await fetchImageAsBase64(design_url);
        parts.push({ inlineData: { mimeType: designImg.mime, data: designImg.base64 } });
        parts.push({
          text: [
            DESIGNER_IDENTITY,
            `Deliver a photorealistic interior photograph of ${scene}. Show the provided artwork applied as a large-format printed vinyl wall wrap covering the feature wall facing camera. The install should look like professionally printed and installed premium vinyl — tack-sharp detail, vivid saturated color, perfect panel alignment, realistic shadows and subtle surface texture matching the room's lighting. No spurious captions or watermarks on the scene itself.`,
            FIDELITY,
            dimLabel ? `The wrap covers approximately ${dimLabel} of that wall.` : "",
            prompt ? `Style notes: ${prompt}` : "",
            `Output a single original creative design name (2-4 words, no quotes) before the image.`,
          ].filter(Boolean).join("\n\n"),
        });
      } else {
        parts.push({
          text: [
            DESIGNER_IDENTITY,
            CAPABILITIES,
            `Deliver a photorealistic interior photograph of ${scene}. The feature wall facing camera is covered with a large-format printed vinyl wall wrap custom designed for this space. Design the wrap and render the install in a single image — professionally installed premium vinyl, tack-sharp detail, vivid saturated color, perfect panel alignment, realistic shadows and lighting matching the room. No spurious captions or watermarks on the scene itself.`,
            FIDELITY,
            `Wrap design brief: "${prompt}"`,
            DESIGN_TRANSLATION,
            dimLabel ? `The wrap covers approximately ${dimLabel} of that wall.` : "",
            `Output a single original creative design name (2-4 words, no quotes) before the image.`,
          ].filter(Boolean).join("\n\n"),
        });
      }
    } else {
      // Fallback: treat as generate mode
      parts.push({
        text: [
          DESIGNER_IDENTITY,
          CAPABILITIES,
          `Deliver a photorealistic flat, print-ready wall mural artwork panel designed for a premium commercial or residential interior.`,
          prompt ? `Design brief: "${prompt}"` : `Brief: a refined contemporary mural suitable for a high-end commercial interior.`,
          FIDELITY,
          dimLabel ? `Dimensions: ${dimLabel}.` : "",
          DESIGN_TRANSLATION,
          `Output a creative design name (2-4 words, no quotes) before the image.`,
        ].filter(Boolean).join("\n\n"),
      });
    }

    // ── Call Gemini with retry loop ──────────────────────────────
    let imageBase64 = "";
    let designName = "";
    let lastFinishReason: string | undefined;
    let lastHttpStatus = 0;
    let lastErrorText = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1 && remainingMs() < 20_000) {
        console.warn(`[generate-wall-design] ⏱️ Wall clock near budget (${(remainingMs() / 1000).toFixed(1)}s left) — stopping retries`);
        break;
      }

      const effectiveTimeout = Math.min(FETCH_TIMEOUT_MS, Math.max(10_000, remainingMs() - 10_000));
      console.log(`[generate-wall-design] 🎯 Attempt ${attempt}/${MAX_ATTEMPTS} mode=${mode} (timeout ${effectiveTimeout / 1000}s)`);

      let geminiResp: Response;
      try {
        geminiResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${getGeminiKey()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: { aspectRatio: aspect_ratio, imageSize: "4K" },
              },
            }),
            signal: AbortSignal.timeout(effectiveTimeout),
          },
        );
      } catch (fetchErr: any) {
        const isTimeout = fetchErr?.name === "TimeoutError" || fetchErr?.name === "AbortError";
        lastErrorText = isTimeout ? "timeout" : (fetchErr?.message || "network error");
        console.error(`[generate-wall-design] Fetch failed (attempt ${attempt}): ${lastErrorText}`);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
          continue;
        }
        break;
      }

      if (!geminiResp.ok) {
        lastHttpStatus = geminiResp.status;
        lastErrorText = await geminiResp.text().catch(() => "");
        console.error(`[generate-wall-design] Gemini HTTP ${geminiResp.status} (attempt ${attempt}): ${lastErrorText.slice(0, 300)}`);

        // Hard quota/auth failures — don't retry
        if (geminiResp.status === 402 || geminiResp.status === 403) {
          return jsonResponse(
            { error: "AI quota exceeded or API key invalid. Contact support.", code: "QUOTA_EXCEEDED" },
            geminiResp.status,
          );
        }

        // Rate limit or server error — retry with next pool key
        if ((geminiResp.status === 429 || geminiResp.status >= 500) && attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
          continue;
        }
        break;
      }

      const data = await geminiResp.json();
      const candidate = data.candidates?.[0];
      const responseParts = candidate?.content?.parts || [];
      lastFinishReason = candidate?.finishReason;

      for (const part of responseParts) {
        if (part.text && !designName) designName = part.text.trim();
        if (part.inlineData?.data) imageBase64 = part.inlineData.data;
      }

      if (imageBase64) {
        console.log(`[generate-wall-design] ✅ Image generated on attempt ${attempt}`);
        break;
      }

      console.warn(`[generate-wall-design] No image (attempt ${attempt}) finishReason=${lastFinishReason}`);

      // Hard content filter — don't waste retries
      if (
        lastFinishReason === "SAFETY" ||
        lastFinishReason === "PROHIBITED_CONTENT" ||
        lastFinishReason === "RECITATION" ||
        lastFinishReason === "BLOCKLIST"
      ) {
        const userMsg = lastFinishReason === "RECITATION"
          ? "This design resembles copyrighted material too closely. Describe the style, colors, and mood you want instead of naming a specific brand or artwork."
          : "This design was filtered by content safety. Try rephrasing — describe the visual elements (colors, shapes, mood) instead of named characters or brands.";
        return jsonResponse(
          { error: userMsg, code: "CONTENT_FILTERED", finishReason: lastFinishReason },
          422,
        );
      }

      // NO_IMAGE / empty STOP / MAX_TOKENS — retry with SAME full parts (keeps wall photo context)
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
        continue;
      }
    }

    if (!imageBase64) {
      console.error(
        `[generate-wall-design] ❌ All ${MAX_ATTEMPTS} attempts failed. finishReason=${lastFinishReason} httpStatus=${lastHttpStatus} lastError=${lastErrorText.slice(0, 500)}`,
      );
      const status = lastHttpStatus === 429 ? 429 : 502;
      const msg = lastHttpStatus === 429
        ? "AI service is rate limited. Try again in a moment."
        : "Couldn't generate a wall design after multiple attempts. Try simplifying your prompt or try again.";
      return jsonResponse(
        {
          error: msg,
          code: "GENERATION_FAILED",
          finishReason: lastFinishReason,
          httpStatus: lastHttpStatus || undefined,
          // Surface the first 300 chars of the actual Gemini error body so
          // bug reports show what really happened, not a generic message.
          geminiError: lastErrorText ? lastErrorText.slice(0, 300) : undefined,
        },
        status,
      );
    }

    // Upload to storage
    const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
    const storagePath = `wallpro/${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;

    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, imageBytes, { contentType: "image/png", cacheControl: "3600", upsert: true });

    if (uploadErr) {
      console.error("[generate-wall-design] Storage upload failed:", uploadErr);
      return jsonResponse(
        { error: `Storage upload failed: ${uploadErr.message}`, code: "STORAGE_FAILED" },
        500,
      );
    }

    const { data: signedData } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 7200);

    // composite/studio modes produce a full interior render; "generate" mode
    // produces flat print-ready artwork. Frontend uses scene_render to decide
    // whether to swap the canvas background (scene) or show as a flat overlay.
    const sceneRender = mode === "composite" || mode === "studio";

    // Save to color_visualizations so WallPro renders appear in RevisionStudioIQ
    const { data: pubUrlData } = sb.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = pubUrlData?.publicUrl;

    // Resolve user email from JWT if present
    let userEmail = "wallpro@restyleproai.com";
    try {
      const authHeader = req.headers.get("Authorization");
      if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
        const { data: { user } } = await sb.auth.getUser(token);
        if (user?.email) userEmail = user.email;
      }
    } catch { /* non-fatal */ }

    try {
      const { error: insertErr } = await sb.from("color_visualizations").insert({
        customer_email: userEmail,
        color_name: designName || prompt?.slice(0, 100) || "Wall Design",
        color_hex: "#000000",
        finish_type: surface_type || "wall",
        render_urls: { hero: publicUrl || signedData?.signedUrl },
        generation_status: "completed",
        mode_type: "wallpro",
        vehicle_make: "WallPro",
        vehicle_model: mode,
        // color_visualizations.vehicle_year is NOT NULL (no default).
        // WallPro has no real vehicle, so stamp the current year so the
        // insert succeeds and the row shows up in RevisionStudioIQ.
        vehicle_year: new Date().getFullYear().toString(),
        source_photo_url: wall_photo_url || design_url || null,
      });
      if (insertErr) {
        console.warn("[generate-wall-design] color_visualizations insert error:", insertErr);
      }
    } catch (dbErr) {
      console.warn("[generate-wall-design] Failed to save to color_visualizations:", dbErr);
    }

    return jsonResponse({
      success: true,
      image_url: signedData?.signedUrl,
      storage_path: storagePath,
      design_name: designName || "Wall Design",
      scene_render: sceneRender,
    });
  } catch (err: any) {
    console.error("[generate-wall-design] Unhandled error:", err);
    return jsonResponse(
      { error: err?.message || "Generation failed", code: "SYSTEM_ERROR" },
      500,
    );
  }
});
