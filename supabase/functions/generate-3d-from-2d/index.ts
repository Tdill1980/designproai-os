/**
 * generate-3d-from-2d
 *
 * Renders the customer-facing 3D proof FROM the approved 2D proof, so the 3D is
 * guaranteed to match the design the customer already approved (no drift).
 *
 * Two anchors keep Gemini on-rails (the same few-shot technique used by
 * generate-2d-proof and the panelizer):
 *   1. DESIGN SOURCE — the 2D proof image is the source of truth. Gemini copies
 *      its exact colors, logos, text, graphics, and layout onto the vehicle.
 *   2. EXAMPLE 3D PROOF(S) — one or two reference images from
 *      wrap-files/genie-examples/ that show what a correct photoreal 3D proof
 *      looks like. This locks the OUTPUT MEDIUM to a real wrapped vehicle photo
 *      (not illustration), eliminating cartoon-slop.
 *
 * Output: the requested single view (driver-side by default) → sent to client.
 *
 * Self-contained (only remote imports) so it deploys cleanly via the Supabase MCP.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Example 3D proof(s) — the OUTPUT-MEDIUM anchor. Paths are <bucket>/<object>
// (path segments are URL-encoded at fetch time, so spaces are fine). The
// function still runs if they are missing — it just loses the style anchor.
const EXAMPLE_3D_PROOF_PATHS = [
  "DesignPro Page Assets/3D Proof/APEX.png",
];

// Concise, self-contained camera framing per view (inlined so the function has
// no _shared dependency for MCP deploy). Keys match the canonical view labels.
const CAMERA: Record<string, string> = {
  "driver-side":
    "Camera at a 3/4 front-driver angle, eye level, showing the full driver side and the front of the vehicle — the classic hero wrap-shop shot.",
  side:
    "Camera at a 3/4 front-driver angle, eye level, showing the full driver side and the front of the vehicle — the classic hero wrap-shop shot.",
  "passenger-side":
    "Camera at a 3/4 front-passenger angle, eye level, showing the full passenger side and the front of the vehicle.",
  front: "Camera straight on to the front of the vehicle, eye level.",
  rear: "Camera straight on to the rear of the vehicle, eye level.",
};

const _pool: string[] = [];
let _loaded = false;
let _idx = 0;
function _load() {
  if (_loaded) return;
  const p = Deno.env.get("GOOGLE_AI_API_KEY");
  if (p) _pool.push(p);
  for (let i = 2; i <= 5; i++) { const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`); if (k) _pool.push(k); }
  _loaded = true;
}
function getKey(): string { _load(); if (!_pool.length) throw new Error("No GOOGLE_AI_API_KEY"); const k = _pool[_idx % _pool.length]; _idx++; return k; }
function hasKey(): boolean { _load(); return _pool.length > 0; }

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, Math.min(i + 8192, bytes.length));
    s += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(s);
}

async function fetchImg(url: string): Promise<{ b64: string; mime: string } | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Deno/1.0" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return { b64: toBase64(await r.arrayBuffer()), mime: r.headers.get("content-type") || "image/jpeg" };
  } catch { return null; }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!hasKey()) return new Response(JSON.stringify({ success: false, error: "No Gemini key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const {
      proofUrl,                 // REQUIRED — the approved 2D proof (design source of truth)
      vehicleYear, vehicleMake, vehicleModel,
      finish,
      viewType = "driver-side", // single view sent to the client
    } = body;

    if (!proofUrl) return new Response(JSON.stringify({ success: false, error: "Missing proofUrl (2D source)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const vehicleName = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ") || "vehicle";
    const camera = CAMERA[String(viewType)] || CAMERA["driver-side"];
    const baseUrl = Deno.env.get("SUPABASE_URL")!;

    // Fetch the 2D design source first (the copy-from), then the example(s).
    const sourceImg = await fetchImg(proofUrl);
    if (!sourceImg) return new Response(JSON.stringify({ success: false, error: "Could not fetch 2D proof source" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const exampleImgs: Array<{ b64: string; mime: string }> = [];
    for (const ex of EXAMPLE_3D_PROOF_PATHS) {
      const encoded = ex.split("/").map(encodeURIComponent).join("/");
      const img = await fetchImg(`${baseUrl}/storage/v1/object/public/${encoded}`);
      if (img) exampleImgs.push(img);
    }

    const prompt = `A photorealistic studio photograph of a ${vehicleName} with a premium vehicle wrap fully installed — real printed vinyl, physically applied. ${camera}

DESIGN SOURCE (source of truth — copy it exactly): The attached 2D PROOF defines this wrap's EXACT colors, logos, company name, contact text, graphics, and layout. Reproduce that same design faithfully on the vehicle's body panels, conforming it naturally to the body lines, fender curves, and wheel-arch contours. Do NOT invent, substitute, simplify, or add any graphic, logo, wording, or color that is not in the 2D proof. The wrap covers painted body panels only — windows, lights, wheels, and trim stay factory.

Finish: ${(finish || "Gloss").toUpperCase()} across all body panels.

${exampleImgs.length ? "Match the photoreal studio look of the attached EXAMPLE 3D PROOF(S): a real vehicle photographed in a clean studio, lifelike lighting and reflections — never an illustration, drawing, or flat cartoon." : "Render it as a real vehicle photographed in a clean studio — never an illustration, drawing, or flat cartoon."}

Canon EOS R5, 35mm f/8, tack-sharp, 16:9 landscape, perfect exposure, vibrant colors.`;

    const parts: Array<Record<string, unknown>> = [{ text: prompt }];

    // Example 3D proof(s) — the OUTPUT-MEDIUM anchor (few-shot).
    for (const ex of exampleImgs) {
      parts.push({ text: "EXAMPLE 3D PROOF — match this photoreal on-vehicle studio style (do NOT copy its design/branding, only its realism and framing):" });
      parts.push({ inlineData: { mimeType: ex.mime, data: ex.b64 } });
    }

    // The 2D design source — the DESIGN anchor (copy-from).
    parts.push({ text: "DESIGN SOURCE — the 2D proof to reproduce exactly on the vehicle:" });
    parts.push({ inlineData: { mimeType: sourceImg.mime, data: sourceImg.b64 } });

    console.log(`[3D-FROM-2D] ${vehicleName} (${viewType}): source + ${exampleImgs.length} example(s) → Gemini`);

    let imageB64 = "";
    let imageMime = "image/png";
    let lastErr = "";

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getKey()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: "16:9", imageSize: "4K" } },
            }),
            signal: AbortSignal.timeout(120000),
          }
        );
        if (!resp.ok) { lastErr = `Gemini ${resp.status}`; if (attempt < 3) { await new Promise(r => setTimeout(r, 2000 * attempt)); continue; } break; }

        const result = await resp.json();
        const rParts = result.candidates?.[0]?.content?.parts;
        const reason = result.candidates?.[0]?.finishReason;
        if (reason === "NO_IMAGE" && attempt < 3) { lastErr = "NO_IMAGE"; await new Promise(r => setTimeout(r, 2000)); continue; }

        if (rParts) for (const p of rParts) { if (p.inlineData) { imageB64 = p.inlineData.data; imageMime = p.inlineData.mimeType || "image/png"; break; } }
        if (imageB64) break;
        lastErr = `No image. finishReason: ${reason}`;
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
      } catch (e) { lastErr = String(e); if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt)); }
    }

    if (!imageB64) return new Response(JSON.stringify({ success: false, error: lastErr || "Failed" }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const bin = atob(imageB64);
    const imgData = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) imgData[i] = bin.charCodeAt(i);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const auth = req.headers.get("Authorization");
    let uid = "anonymous";
    if (auth) { const { data: { user } } = await db.auth.getUser(auth.replace("Bearer ", "")); if (user) uid = user.id; }

    const ext = imageMime.includes("jpeg") ? "jpg" : imageMime.includes("webp") ? "webp" : "png";
    const path = `renders/${uid}/3d-proofs/${Date.now()}_3d-from-2d_${viewType}.${ext}`;
    const { error: upErr } = await db.storage.from("wrap-files").upload(path, imgData, { contentType: imageMime, upsert: true });
    if (upErr) return new Response(JSON.stringify({ success: false, error: "Upload failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: { publicUrl } } = db.storage.from("wrap-files").getPublicUrl(path);
    console.log(`[3D-FROM-2D] Done: ${publicUrl}`);
    return new Response(JSON.stringify({ success: true, renderUrl: publicUrl, viewType }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[3D-FROM-2D] Error:", err);
    return new Response(JSON.stringify({ success: false, error: String(err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
