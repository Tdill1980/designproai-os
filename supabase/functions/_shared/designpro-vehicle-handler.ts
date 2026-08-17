/**
 * designpro-vehicle-handler.ts — Shared handler for DesignPro specialty vehicle
 * edge functions (motorcycle, boat, bus, RV).
 *
 * Accepts the same DesignIQ payload shape as design-panel-ai-generate:
 *   { mode, prompt, finish, vehicleMake, vehicleModel, vehicleYear, viewType,
 *     visionBoardImages, visionboard_intent }
 *
 * Builds a vehicle-class-aware prompt, calls Gemini 3 Pro Image Preview,
 * uploads the result to wrap-files storage, tracks in designiq_generations,
 * and returns the same response shape as design-panel-ai-generate so the
 * frontend can consume it identically.
 *
 * Each thin edge function (designpro-motorcycle, etc.) calls this handler
 * with the vehicle class string.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { STUDIO_ENVIRONMENT, STUDIO_REINFORCEMENT } from "./studio-os.ts";
import { getCameraAngle, getAspectRatio, getResolution } from "./view-angles-os.ts";
import { getGeminiKey, hasGeminiKey } from "./gemini-key-pool.ts";
import { keepClearGuidance, type WrapBodyType } from "./keep-clear-os.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type VehicleClass = "motorcycle" | "boat" | "bus" | "rv" | "trailer";

interface DesignProVehicleParams {
  mode: "restyle" | "commercial";
  prompt: string;
  finish: string;
  substrate?: "standard" | "color_change_film" | "chrome_film" | "satin_film";
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  viewType?: string;
  visionBoardImages?: Array<{ slotLabel: string; storageUrl: string }>;
  visionboard_intent?: "style_inspiration" | "exact_reference" | "artboard_projection";
  companyName?: string;
  mascot?: string;
  bulletPoints?: string[];
  industryType?: string;
  phone?: string;
}

// Keep-clear (GAP 2) — map the DesignPro vehicle class to the closest body type
// that has real install-cut zones (rear man-door, wheel arches). Only the
// flat-sided commercial bodies get keep-clear guidance; boats and motorcycles
// have no door/wheel-arch install cut to steer branding around.
const CLASS_TO_KEEPCLEAR: Partial<Record<VehicleClass, WrapBodyType>> = {
  trailer: "enclosed_trailer",
  bus: "box_truck",
  rv: "box_truck",
};

// Vehicle-class-specific prompt framing
const VEHICLE_CLASS_CONTEXT: Record<VehicleClass, string> = {
  motorcycle: `The vehicle is a MOTORCYCLE. The wrap covers the fuel tank, front fender, rear fender, side fairings/panels, and any bodywork. Frame, engine, wheels, exhaust, seat, handlebars, and suspension stay factory/exposed. The wrap follows the motorcycle's aggressive body curves and compound contours.`,
  boat: `The vehicle is a BOAT. The wrap covers the hull sides, transom, and any cabin/console panels. The wrap follows the hull's sweeping curves from bow to stern. Waterline, deck surfaces, windshield, rails, and hardware stay factory. Show the boat on a trailer or in a studio — NOT in water.`,
  bus: `The vehicle is a BUS. The wrap covers the full exterior body panels — sides, rear, and front fascia below the windshield. Windows, windshield, wheels, bumpers, mirrors, and lights stay factory. The large flat side panels are the primary design canvas. Show the bus from a 3/4 angle to capture the scale.`,
  rv: `The vehicle is an RV/MOTORHOME. The wrap covers the exterior body panels — sides, rear cap, front cap below the windshield, and any slide-out panels. Windows, windshield, wheels, roof AC units, awning, and accessories stay factory. The large side panels are the primary design canvas with sweeping graphics that flow from front to rear.`,
  trailer: `The vehicle is a TRAILER (enclosed cargo, race, gooseneck, utility, or flatbed). The wrap covers the long flat side walls, rear door panel, and front wall (if enclosed). Wheels, tires, fenders, hitch/tongue, ramps, axles, and any windows or vents stay factory. Trailer sides are huge uninterrupted flat panels — the primary design canvas — so graphics can run nearly full length without curve distortion. Show the trailer from a 3/4 side angle to capture the side panel as the hero and the rear door as a secondary surface. NOT towed by a vehicle in the render — show the trailer alone in studio lighting.`,
};

const FINISH_SPECS: Record<string, string> = {
  gloss: "GLOSS — shiny wet-look surface, crisp reflections, deep color depth.",
  matte: "MATTE — completely flat, ZERO reflections, ZERO highlights, velvety non-reflective surface.",
  satin: "SATIN — soft sheen, subtle highlights that spread wide, silk-like.",
};

const SUBSTRATE_CONTEXT: Record<string, string> = {
  color_change_film: 'SPECIALTY SUBSTRATE: This design is printed on a color-change specialty base film (metallic, pearl, or color-shift vinyl). The metallic/pearl base film shows through the printed ink layer, creating a luminous, color-shifting effect. Lighter print areas reveal more of the pearl/metallic base. Dark print areas remain opaque. This is printed vinyl with a specialty base layer — NOT chrome paint or automotive metallic paint.',
  chrome_film: 'SPECIALTY SUBSTRATE: This design is printed on a mirror chrome base film. The chrome substrate shows through lighter and transparent areas of the printed design, creating a chrome-through-ink effect. Dark printed areas remain opaque over the chrome. This is printed vinyl on chrome film — NOT chrome paint.',
  satin_film: 'SPECIALTY SUBSTRATE: This design is printed on a satin base film. The satin substrate provides a soft, silk-like sheen underneath the printed design, giving the artwork depth and luminosity. This is printed vinyl on satin film — NOT satin automotive paint.',
};

function buildPrompt(params: DesignProVehicleParams, vehicleClass: VehicleClass): string {
  const {
    mode, prompt, finish, substrate, vehicleMake, vehicleModel, vehicleYear,
    viewType, companyName, mascot, bulletPoints, industryType, phone,
  } = params;
  const substrateContext = substrate && substrate !== 'standard' ? SUBSTRATE_CONTEXT[substrate] || '' : '';

  const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ");
  let cameraAngle = getCameraAngle(viewType || "side");
  const finishSpec = FINISH_SPECS[(finish || "gloss").toLowerCase()] || FINISH_SPECS.gloss;
  let classContext = VEHICLE_CLASS_CONTEXT[vehicleClass];

  // Trailer length nudge: if the user stated a length (e.g. "25'", "25 ft"),
  // push the proportions toward a long body. Image models won't render exact
  // feet, but this stops a 25' trailer coming out looking like a short 16-20'
  // utility trailer.
  if (vehicleClass === "trailer") {
    const lenMatch = vehicle.match(/(\d{1,3})\s*(?:'|’|ft\b|foot|feet)/i);
    if (lenMatch) {
      const ft = lenMatch[1];
      classContext += ` LENGTH: this is a ${ft}-FOOT trailer — render it at full ${ft}ft length with a long body, long wheelbase, and a long, tall side wall as the hero panel. Proportion it like a ${ft}-foot trailer (long and roomy), NOT a short utility trailer.`;
    }

    // Trailer-specific camera framing. The canonical car angles (grille,
    // headlights, tailgate, taillights) are meaningless for a trailer, so
    // "front" / "rear" otherwise just re-render the long side. Override them
    // with the trailer's actual front wall and rear cargo doors.
    const v = (viewType || "side").toLowerCase();
    if (v === "front") {
      cameraAngle = `Straight-on FRONT view of the TRAILER. Camera faces the NARROW front wall / V-nose head-on, ~10 ft away, centered and level. Show the front cap/wall of the trailer with the hitch/tongue and coupler at the bottom. This is the SHORT front end of the trailer — NOT the long side wall. Symmetrical left-to-right. FRAME FILL: the front wall fills 70%+ of the frame.`;
    } else if (v === "rear") {
      cameraAngle = `Straight-on REAR view of the TRAILER. Camera faces the rear CARGO DOORS head-on, ~10 ft away, centered and level. Show the full-height rear barn/ramp door(s), the rear frame, and the taillights/license plate. This is the SHORT rear end of the trailer — NOT the long side wall. Symmetrical left-to-right. FRAME FILL: the rear doors fill 70%+ of the frame.`;
    } else if (v === "hood_detail" || v === "roof") {
      // Trailers have no hood or roof glamour shot — fall back to the side.
      cameraAngle = getCameraAngle("side");
    }
  }

  if (mode === "commercial") {
    const keywords = bulletPoints?.filter((b: string) => b?.trim());

    let assembled = `You are WePrintWraps.com Lead Vehicle Wrap Designer for commercial wraps. You create amazing, modern commercial vehicle wrap designs for wrap shops who print and install them. You amplify your customer's designs while staying true to their request. You specialize in wraps that generate leads.

CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

A photorealistic studio photograph of a ${vehicle} with a premium commercial vehicle wrap fully installed. The wrap is real printed vinyl physically applied to the vehicle.

${classContext}

${STUDIO_ENVIRONMENT}

CLIENT BRIEF:`;

    if (companyName) assembled += `\nBusiness: ${companyName}`;
    if (phone) assembled += `\nPhone: ${phone}`;
    if (mascot) assembled += `\nMascot: ${mascot}`;
    if (industryType) assembled += `\nIndustry: ${industryType}`;
    if (keywords?.length) {
      assembled += `\nBrand elements: ${keywords.map((k: string) => k.trim()).join(", ")}`;
    }

    assembled += `\n\nCreative direction from client: "${prompt}"`;
    assembled += `\n\nDESIGN AMPLIFICATION: If the client's prompt is short, YOU fill in ALL design decisions at a $5,000 level. Every wrap MUST have: (1) strong base treatment, (2) graphic flow elements, (3) professional typography, (4) design integration.`;
    // KEEP-CLEAR (GAP 2): keep the logo / business name / phone out of the
    // door + wheel-arch install-cut zones (placement only — full rectangles).
    const kcBody = CLASS_TO_KEEPCLEAR[vehicleClass];
    if (kcBody && (companyName || phone)) {
      assembled += `\n\n${keepClearGuidance(kcBody)}`;
    }
    assembled += `\n\nFinish: ${(finish || "Gloss").toUpperCase()} — ${finishSpec}`;
    if (substrateContext) assembled += `\n${substrateContext}`;
    assembled += `\n${STUDIO_REINFORCEMENT}`;
    assembled += `\n${cameraAngle}`;
    assembled += `\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`;

    return assembled;
  }

  // RESTYLE MODE
  let assembled = `You are WePrintWraps.com Lead Vehicle Wrap Designer. You create restyle and artistic wraps with depth and texture — your designs are seen at shows around the world. You amplify each customer's vision while staying true to their request.

CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

A photorealistic studio photograph of a ${vehicle} with a premium artistic vehicle wrap fully installed. The wrap is real printed vinyl — a bold, gallery-worthy design. No text, no logos, no branding on the vehicle.

${classContext}

${STUDIO_ENVIRONMENT}

Wrap request: "${prompt}"

DESIGN AMPLIFICATION: If the wrap request is short or vague, that means MORE creative freedom — not less effort. You are an elite designer — fill in every design decision the client left open. Every wrap must have depth, flow, and multiple visual layers.`;

  assembled += `\nFinish: ${(finish || "Gloss").toUpperCase()} — ${finishSpec}`;
  if (substrateContext) assembled += `\n${substrateContext}`;
  assembled += `\n${STUDIO_REINFORCEMENT}`;
  assembled += `\n${cameraAngle}`;
  assembled += `\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`;

  return assembled;
}

// Simple deterministic design naming (matches design-panel-ai-generate)
function generateDesignName(prompt: string, mode: string, companyName?: string): string {
  if (mode === "commercial" && companyName) return `${companyName}'s Wrap`;
  const fillerWords = new Set([
    "a", "an", "the", "with", "that", "has", "have", "and", "or", "of", "for",
    "on", "in", "is", "it", "its", "my", "this", "which", "also", "very", "really",
    "wrap", "wraps", "style", "theme", "design", "vehicle", "car", "truck",
    "color", "colors", "side", "front", "rear", "back", "center",
  ]);
  const thematicWords = prompt.trim().split(/\s+/)
    .filter(w => !fillerWords.has(w.toLowerCase()) && w.length > 2)
    .slice(0, 3);
  if (thematicWords.length > 0) {
    return thematicWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
  return "Custom Wrap";
}

export async function handleDesignProVehicle(req: Request, vehicleClass: VehicleClass): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const WALL_CLOCK_START = Date.now();
  const WALL_CLOCK_BUDGET_MS = 140_000;

  try {
    const body = await req.json();
    const {
      mode, prompt, finish = "Gloss", substrate,
      vehicleMake, vehicleModel, vehicleYear,
      viewType, visionBoardImages, visionboard_intent,
      companyName, mascot, bulletPoints, industryType, phone,
      originalRenderUrl,
    } = body as DesignProVehicleParams & Record<string, unknown>;

    if (!mode || !prompt) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: mode, prompt" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authenticate
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    let userId: string | null = null;

    if (authHeader) {
      const authClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await authClient.auth.getUser();
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Service-role client — created up front so the failure path can record a
    // render_failed diagnostics row (queryable ground truth) and the success
    // path can reuse it for upload + tracking.
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Record the REAL terminal failure into designiq_generations so a 500 on an
    // angle view is diagnosable from the DB (status-level edge logs hide the
    // Gemini error body). Non-blocking — never let logging mask the response.
    const logFailure = async (geminiStatus: number | null, geminiError: string) => {
      try {
        await supabase.from("designiq_generations").insert({
          user_id: userId,
          mode,
          raw_prompt: prompt,
          finish,
          vehicle_year: vehicleYear || null,
          vehicle_make: vehicleMake || null,
          vehicle_model: vehicleModel || null,
          engine_version: "4.0.0-" + vehicleClass,
          generation_status: "render_failed",
          truespec_metadata: {
            vehicleClass,
            view: viewType || "side",
            geminiStatus,
            geminiError: (geminiError || "").slice(0, 800),
          },
        });
      } catch (_e) { /* diagnostics only */ }
    };

    // Downsize a Supabase Storage public image via the on-the-fly render/image
    // transform. Reference images (the hero render, the studio anchor) only need
    // to be READABLE by Gemini — sending them at full 4K as inline base64 blew
    // the request past Gemini's inline payload limit, which is why every angle
    // view that attaches the 4K hero started failing with a fast 400 after the
    // June-12 4K upgrade (#2679). Non-Supabase URLs are returned unchanged.
    const toResizedUrl = (url: string, width: number, quality = 80): string => {
      const host = Deno.env.get("SUPABASE_URL") || "";
      if (host && url.includes(host) && url.includes("/storage/v1/object/public/")) {
        return url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") +
          `?width=${width}&quality=${quality}`;
      }
      return url;
    };

    // Build prompt
    const aiPrompt = buildPrompt(
      { mode, prompt, finish, substrate, vehicleMake, vehicleModel, vehicleYear, viewType, companyName, mascot, bulletPoints, industryType, phone },
      vehicleClass
    );

    console.log(`=== DESIGNPRO-${vehicleClass.toUpperCase()} PROMPT START ===`);
    console.log(aiPrompt);
    console.log(`=== DESIGNPRO-${vehicleClass.toUpperCase()} PROMPT END ===`);
    console.log(`DesignPro ${vehicleClass} generation:`, { mode, finish, vehicleMake, vehicleModel, userId });

    // Fetch VisionBoard images
    const vbImages = Array.isArray(visionBoardImages) ? visionBoardImages : [];
    const visionBoardParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];

    const MAX_VB = 6;
    const cappedVb = vbImages.slice(0, MAX_VB);
    for (const vbImg of cappedVb) {
      try {
        let fetchUrl = vbImg.storageUrl;
        const supabaseStorageHost = Deno.env.get("SUPABASE_URL") || "";
        if (fetchUrl.includes(supabaseStorageHost) && fetchUrl.includes("/storage/v1/object/public/")) {
          fetchUrl = fetchUrl.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/") +
            "?width=512&height=512&resize=contain&quality=75";
        }
        const imgResp = await fetch(fetchUrl, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(15_000) });
        if (imgResp.ok) {
          const ct = imgResp.headers.get("content-type") || "image/jpeg";
          const buf = await imgResp.arrayBuffer();
          const u8 = new Uint8Array(buf);
          let bin = "";
          for (let i = 0; i < u8.length; i += 8192) {
            const chunk = u8.subarray(i, Math.min(i + 8192, u8.length));
            bin += String.fromCharCode.apply(null, Array.from(chunk));
          }
          visionBoardParts.push({ inlineData: { mimeType: ct, data: btoa(bin) } });
        }
      } catch (err) {
        console.warn(`VisionBoard fetch error (${vbImg.slotLabel}):`, err);
      }
    }

    // Studio anchor image
    const studioAnchorParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    let promptWithStudio = aiPrompt;
    try {
      const studioUrl = toResizedUrl(`${supabaseUrl}/storage/v1/object/public/wrap-files/studio-reference/golden-studio.png`, 768);
      const studioResp = await fetch(studioUrl, { signal: AbortSignal.timeout(10_000) });
      if (studioResp.ok) {
        const buf = await studioResp.arrayBuffer();
        const u8 = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < u8.length; i += 8192) {
          const chunk = u8.subarray(i, Math.min(i + 8192, u8.length));
          bin += String.fromCharCode.apply(null, Array.from(chunk));
        }
        studioAnchorParts.push({ inlineData: { mimeType: "image/png", data: btoa(bin) } });
        promptWithStudio += `\n\nSTUDIO REFERENCE IMAGE ATTACHED: Match this EXACT studio environment — same dark glossy epoxy floor with mirror reflections, same light gray walls, same overhead LED strip lights. The studio must be IDENTICAL to the reference.`;
      }
    } catch {
      // Non-fatal
    }

    // Clone-hero: when an approved hero render is passed (the additional 360
    // views all clone view 1), attach it as the FIRST reference image so the
    // wrap design stays IDENTICAL across angles — only the camera moves.
    const heroParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
    if (typeof originalRenderUrl === "string" && originalRenderUrl) {
      try {
        // Downsize the hero to a Gemini-friendly size (1280px wide). At full 4K
        // the inline base64 overflowed Gemini's request limit → fast 400. 1280px
        // preserves every design detail Gemini needs to clone the wrap.
        const heroFetchUrl = toResizedUrl(originalRenderUrl, 1280);
        const heroResp = await fetch(heroFetchUrl, { signal: AbortSignal.timeout(15_000) });
        if (heroResp.ok) {
          const ct = heroResp.headers.get("content-type") || "image/png";
          const buf = await heroResp.arrayBuffer();
          const u8 = new Uint8Array(buf);
          let bin = "";
          for (let i = 0; i < u8.length; i += 8192) {
            const chunk = u8.subarray(i, Math.min(i + 8192, u8.length));
            bin += String.fromCharCode.apply(null, Array.from(chunk));
          }
          heroParts.push({ inlineData: { mimeType: ct, data: btoa(bin) } });
          promptWithStudio = `HERO REFERENCE IMAGE (first attached): the APPROVED wrap design on this ${vehicleClass} shown from another angle. Reproduce the IDENTICAL wrap design — same colors, graphics, text, logos, finish, and layout — now shown from the camera angle described below. Only the camera angle changes; the design must match the reference exactly.\n\n${promptWithStudio}`;
        }
      } catch (e) {
        console.warn("Hero reference fetch failed (non-fatal):", e);
      }
    }

    // ARTBOARD PROJECTION: when DesignProAI runs artboard-first, it builds the
    // flat master artboard (design-panel-ai-generate mode:artboard) and passes it
    // here as the visionBoard image with intent 'artboard_projection'. We then
    // PROJECT that exact print artwork onto this vehicle at the requested view —
    // never redesign — so the 3D faithfully matches the artboard (zero drift).
    // The artboard becomes the PRIMARY reference image.
    const isArtboardProjection =
      visionboard_intent === "artboard_projection" && visionBoardParts.length > 0;
    if (isArtboardProjection) {
      // Map this view to the artboard's matching labeled panel so each side
      // reproduces ITS OWN panel (driver→DRIVER SIDE, rear→REAR…).
      const viewToPanel: Record<string, string> = {
        side: "DRIVER SIDE", driver: "DRIVER SIDE", "driver-side": "DRIVER SIDE",
        "passenger-side": "PASSENGER SIDE", passenger: "PASSENGER SIDE",
        front: "FRONT", rear: "REAR", back: "REAR", roof: "ROOF/TOP", hood_detail: "HOOD",
      };
      const panelLabel = viewToPanel[(viewType || "side").toLowerCase()];
      const panelLine = panelLabel
        ? ` THIS VIEW = the ${panelLabel}: use the artboard's "${panelLabel}" panel as the exact artwork for this side — match that specific panel's design, layout, colors, logos, and text precisely.`
        : "";
      promptWithStudio = `MASTER ARTBOARD (first attached image): a FLAT 2D production artboard — the approved, locked print-ready wrap artwork for this ${vehicleClass}, laid out as labeled flat panels for every side. PROJECT this EXACT artwork onto the ${vehicle}, conforming the printed vinyl to the body panels and contours, shown from the camera angle described below. Reproduce every color, graphic, pattern, logo, and text EXACTLY as drawn in the artboard — do NOT redesign, reinterpret, reposition, resize, or add anything.${panelLine} This is a faithful application of an existing print file onto the vehicle.\n\n${promptWithStudio}`;
    }

    // Design name
    const designName = generateDesignName(prompt, mode, companyName);
    console.log(`Design name: ${designName}${isArtboardProjection ? " (artboard projection)" : ""}`);

    // Gemini image generation
    const GEMINI_TIMEOUT_MS = 60_000;
    // ROOT CAUSE of the June-12 angle-view regression: the additional angle
    // views attach the approved HERO render as a reference (originalRenderUrl)
    // so the design stays identical across angles. #2679 upgraded that hero to
    // 4K, and we were inlining it at full size as base64 — which overflowed
    // Gemini's inline request limit and returned a FAST 400 on every angle that
    // carried a hero (the initial side view, with no hero, kept working). The
    // fix is the resized hero/studio reference above. This retry block is just
    // resilience for genuinely transient 429/5xx, bounded by the 140s budget.
    const MAX_ATTEMPTS = 4;
    // Exponential backoff with jitter for transient 429/5xx — ~3s, 6s, 12s.
    // Kept modest so a retried view still finishes inside the client's per-view
    // timeout tiers (90s/120s/150s). The real fix is the resized hero above,
    // which makes the request succeed on attempt 1; this is just resilience.
    const backoffMs = (attempt: number) => {
      const base = Math.min(3000 * Math.pow(2, attempt - 1), 12000);
      return base + Math.floor(Math.random() * 1000);
    };
    // Track the last real Gemini error so a terminal failure reports the TRUTH
    // (status + body) instead of an opaque "no image" message.
    let lastGeminiStatus: number | null = null;
    let lastGeminiError = "";
    const resolvedView = viewType || "side";
    const aspectRatio = getAspectRatio(resolvedView);
    const resolution = getResolution(resolvedView);

    // For artboard projection the master artboard must be the PRIMARY (first)
    // image so Gemini treats it as the source of truth, not a loose reference.
    const imageParts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> =
      isArtboardProjection
        ? [{ text: promptWithStudio }, ...visionBoardParts, ...studioAnchorParts]
        : [
            { text: promptWithStudio },
            ...heroParts,
            ...studioAnchorParts,
            ...visionBoardParts,
          ];

    const remainingMs = () => WALL_CLOCK_BUDGET_MS - (Date.now() - WALL_CLOCK_START);

    let imageBase64: string | null = null;
    let imageMimeType = "image/png";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1 && remainingMs() < 15_000) break;

      console.log(`Image attempt ${attempt}/${MAX_ATTEMPTS} — gemini-3-pro-image-preview (${promptWithStudio.length} chars, ${aspectRatio} ${resolution})`);

      const effectiveTimeout = Math.min(GEMINI_TIMEOUT_MS, remainingMs() - 5_000);
      let response: Response;
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: imageParts }],
              generationConfig: {
                responseModalities: ["TEXT", "IMAGE"],
                imageConfig: { aspectRatio, imageSize: resolution },
              },
            }),
            signal: AbortSignal.timeout(effectiveTimeout > 0 ? effectiveTimeout : 10_000),
          }
        );
      } catch (fetchErr: any) {
        console.error(`Gemini fetch failed (attempt ${attempt}):`, fetchErr?.message);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
          continue;
        }
        return new Response(
          JSON.stringify({ code: "SYSTEM_ERROR", message: "AI generation timed out — try again" }),
          { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Gemini HTTP ${response.status} (attempt ${attempt}):`, errText);
        lastGeminiStatus = response.status;
        lastGeminiError = errText || "";
        // 429 (concurrent-slot rate limit) and 5xx are transient — back off
        // long enough to outlast the sibling render that's holding the slot,
        // but only if there's budget left for another full attempt afterward.
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_ATTEMPTS) {
          const wait = backoffMs(attempt);
          // Need the wait PLUS a meaningful fetch window (~20s) still on the clock.
          if (remainingMs() - wait > 20_000) {
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
        }
        await logFailure(response.status, errText);
        return new Response(
          JSON.stringify({
            code: "SYSTEM_ERROR",
            message: `Image generation failed (HTTP ${response.status})`,
            // Surface the REAL Gemini error so a 500 on the angle views is
            // diagnosable instead of opaque (status-level logs hide the body).
            geminiStatus: response.status,
            geminiError: (errText || "").slice(0, 500),
            view: resolvedView, aspectRatio, resolution,
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const result = await response.json();
      const finishReason = result.candidates?.[0]?.finishReason;
      const hasContent = result.candidates?.[0]?.content?.parts?.length > 0;

      if (finishReason && finishReason !== "STOP" && finishReason !== "NO_IMAGE" && !hasContent) {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        return new Response(
          JSON.stringify({ code: "CONTENT_FILTERED", message: "This design was filtered. Try describing the visual elements differently." }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (finishReason === "NO_IMAGE" || (finishReason === "STOP" && !hasContent)) {
        if (attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
      }

      const parts = result.candidates?.[0]?.content?.parts;
      if (parts && Array.isArray(parts)) {
        for (const part of parts) {
          if (part.inlineData) {
            imageBase64 = part.inlineData.data;
            imageMimeType = part.inlineData.mimeType || "image/png";
          }
        }
      }

      if (imageBase64) {
        console.log(`Image gen SUCCESS — attempt ${attempt}`);
        break;
      }

      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!imageBase64) {
      await logFailure(lastGeminiStatus, lastGeminiError || "no image in response (NO_IMAGE / empty parts)");
      return new Response(
        JSON.stringify({
          code: "SYSTEM_ERROR",
          message: "No image returned from AI — try again in a moment.",
          geminiStatus: lastGeminiStatus,
          geminiError: (lastGeminiError || "").slice(0, 500),
          view: resolvedView, aspectRatio, resolution,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload to storage (reuses the service-role client created up front).
    const timestamp = Date.now();
    const mimeExtMap: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
    const fileExt = mimeExtMap[imageMimeType] || "png";
    const fileName = `renders/${userId}/DesignPro-${vehicleClass}/${timestamp}_${mode}.${fileExt}`;

    const binaryStr = atob(imageBase64);
    const imageData = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) imageData[i] = binaryStr.charCodeAt(i);

    const { error: uploadError } = await supabase.storage.from("wrap-files").upload(fileName, imageData, {
      contentType: imageMimeType,
      upsert: true,
    });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "Failed to save generated render" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(fileName);

    // Prompt thumbprint
    const ptSource = `${prompt || ""}|${userId}|${Date.now()}`;
    const ptBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ptSource));
    const ptHex = Array.from(new Uint8Array(ptBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
    const promptThumbprint = `PT-${ptHex.substring(0, 12).toUpperCase()}`;

    // Track in designiq_generations
    const promptNorm = [
      vehicleYear || "", (vehicleMake || "").toLowerCase().trim(),
      (vehicleModel || "").toLowerCase().trim(), mode,
      (prompt || "").toLowerCase().replace(/\s+/g, " ").trim().substring(0, 200),
      (finish || "").toLowerCase(),
    ].join("|");
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(promptNorm));
    const promptHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

    const { data: genRecord, error: genError } = await supabase
      .from("designiq_generations")
      .insert({
        user_id: userId,
        mode,
        raw_prompt: prompt,
        enhanced_prompt: promptWithStudio,
        finish,
        vehicle_year: vehicleYear || null,
        vehicle_make: vehicleMake || null,
        vehicle_model: vehicleModel || null,
        panel_url: publicUrl,
        engine_version: "4.0.0-" + vehicleClass,
        generation_status: "render_complete",
        panel_mime_type: imageMimeType,
        prompt_hash: promptHash,
        pt: promptThumbprint,
        truespec_metadata: {
          vehicleClass,
          mode, finish,
          vehicleYear, vehicleMake, vehicleModel,
          designName,
        },
      })
      .select("id")
      .single();

    if (genError) {
      console.warn("designiq_generations insert skipped:", genError.message);
    }

    // Design anchor (non-blocking)
    let designAnchorText: string | null = null;
    try {
      const anchorPrompt = `Analyze this vehicle wrap render in precise detail for visual continuity across angles. Describe: COLORS (with hex), DESIGN ELEMENTS (position, flow), TYPOGRAPHY (or "none"), COMPOSITION (flow direction, focal points), SCALE (which panels are covered). Output a single structured paragraph.`;
      const anchorResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: anchorPrompt }, { inlineData: { mimeType: imageMimeType, data: imageBase64 } }] }],
            generationConfig: { responseMimeType: "text/plain", maxOutputTokens: 1024 },
          }),
          signal: AbortSignal.timeout(30_000),
        }
      );
      if (anchorResp.ok) {
        const anchorData = await anchorResp.json();
        const anchorParts = anchorData?.candidates?.[0]?.content?.parts;
        if (anchorParts) {
          for (const p of anchorParts) {
            if (p.text) { designAnchorText = p.text.trim(); break; }
          }
        }
      }
    } catch {
      // Non-critical
    }

    console.log(`DesignPro ${vehicleClass} render complete:`, { designName, publicUrl, hasAnchor: !!designAnchorText });

    return new Response(
      JSON.stringify({
        renderUrl: publicUrl,
        panel: null,
        directRender: true,
        success: true,
        generationId: genRecord?.id || null,
        designName,
        designAnchorText,
        did: genRecord?.id ? `DID-${genRecord.id.substring(0, 8).toUpperCase()}` : null,
        pt: promptThumbprint,
        vehicleClass,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`designpro-${vehicleClass} error:`, err);
    return new Response(
      JSON.stringify({ code: "SYSTEM_ERROR", message: "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
