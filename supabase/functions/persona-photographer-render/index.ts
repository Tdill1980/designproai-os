/**
 * persona-photographer-render — Persona 3: Automotive Photographer
 *
 * Gemini image generation x 6 angles. Runs AUTOMATICALLY after Persona 2.
 * Uses Design Anchor text for cross-view consistency.
 *
 * Fixed 6-shot sequence: driver, passenger, front, hood, close-up, rear
 *
 * Input:  designAnchorText + heroRenderUrl + vehicle info + finish
 * Output: { renderUrls: { driverSide, passengerSide, front, hoodDetail, closeUp, rear } }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import {
  buildPhotographerPrompt,
  PHOTOGRAPHER_SHOT_SEQUENCE,
} from "../_shared/persona-photographer-prompt.ts";
import { WRAP_COVERAGE_RULES } from "../_shared/view-angles-os.ts";
import { geminiImageUrl, PRIMARY_IMAGE_MODEL, FALLBACK_IMAGE_MODEL } from "../_shared/model-config.ts";
import { upscaleImageBytes } from "../_shared/topaz-upscale.ts";

// THE PICKUP BED CLAUSE, DERIVED FROM THE PIN — NEVER RE-TYPED.
//
// Owner, 2026-08-31, looking at the Flamingo flat master beside its installed
// proof: "Like this but nothing inside truck bed." CLAUDE.md RULE 0.0 states
// where that belongs: "For pickups, exterior bed sides and tailgate receive the
// coordinated artwork; the bed floor and inner bed walls remain unwrapped under
// the downstream vehicle application/proof coverage contract." The proof IS
// that downstream contract, and the pinned photographer prompt does not carry
// the rule -- it says only "Wrap covers painted body panels only. Windows,
// lights, wheels, trim stay factory.", which never mentions an open bed. The
// Standard path has carried the clause since view-angles-os was written
// (`WRAP_COVERAGE_RULES`), and design-panel-ai-generate / generate-color-render
// both import it; the A.T.L.A.S. proof path is the one that never did.
//
// It is SLICED from the pinned block rather than restated, so the two homes
// cannot drift, and a pin edit that removes the line fails the module load
// instead of silently dropping the rule from every pickup proof. Only this one
// clause is taken: the other fifteen lines duplicate what the pinned prompt
// already says in one sentence, and the owner capped this prompt's length.
const TRUCK_BED_RULE = (() => {
  const line = WRAP_COVERAGE_RULES.split("\n").map((l) => l.trim()).find((l) => l.startsWith("TRUCK BED:"));
  if (!line) throw new Error("atlas_proof_truck_bed_rule_missing_from_pin");
  return line;
})();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-designpro-owner-id",
};

// The A.T.L.A.S. contract version this function stamps on every proof it
// produces in atlas-proof mode. The runtime pins the same string, so a drift
// between the two homes is caught by a test rather than shipped.
const ATLAS_PROOF_CONTRACT = "designpro.atlas-photographer-proof.v1";
const ATLAS_PROOF_SOURCE_COMMIT = "113d137dbe8813ca3bf70c8d7265ad081ebd4524";

/**
 * THE SEVEN CANONICAL A.T.L.A.S. SHOTS, AND THE SURFACE THAT AUTHORS EACH.
 *
 * PHOTOGRAPHER_SHOT_SEQUENCE is the pinned SIX-shot magazine sequence and has
 * no roof. `CAMERA_ANGLES` in view-angles-os carries all seven, so atlas-proof
 * resolves against this map instead of that sequence — which changes nothing
 * about the camera text, only which of the pinned angles may be requested.
 */
const ATLAS_SHOT_SURFACES: Record<string, string> = {
  "side": "driver",
  "passenger-side": "passenger",
  "hood_detail": "hood",
  "front": "front",
  "rear": "rear",
  "roof": "roof",
  // ⚠️ CLOSE-UP HAS NO FIXED SURFACE, AND MAY NOT SILENTLY INHERIT DRIVER.
  //
  // Owner, 2026-08-28: "Close-Up must never silently inherit a Driver
  // photograph unless the requested detail explicitly uses Driver as its
  // selected artwork surface." So `null` here means "the caller must NAME the
  // surface", not "anything goes" -- the check below requires it to be one of
  // the six real surfaces, and the response echoes which was chosen so the
  // selection is on the record rather than assumed.
  "close-up": null,
};
const ATLAS_REAL_SURFACES = ["driver", "passenger", "hood", "front", "rear", "roof"];

/** Fetch an image URL and return base64 inline data for Gemini */
async function fetchImageAsInlineData(
  url: string
): Promise<{ inlineData: { mimeType: string; data: string } } | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Deno/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") || "image/png";
    const buf = await resp.arrayBuffer();
    const uint8 = new Uint8Array(buf);
    let bin = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const chunk = uint8.subarray(i, Math.min(i + chunkSize, uint8.length));
      bin += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return { inlineData: { mimeType: contentType, data: btoa(bin) } };
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // ═══ ATLAS-PROOF — the DesignProAI 3D proof, artwork authority swapped.
    // Owner directive 2026-08-28: "DO NOT CREATE ANOTHER 3D EDGE FUNCTION."
    // This is that function, in the one mode where the extracted A.T.L.A.S.
    // panel is the artwork instead of a hero render. See handleAtlasProof.
    if (body?.mode === "atlas-proof") {
      return await handleAtlasProof(body);
    }
    const {
      designAnchorText,
      heroRenderUrl,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      finish = "Gloss",
      generationId,
      // Optional: render a SINGLE shot instead of all 6
      // When provided, returns { renderUrl, shotKey } for just that one shot
      shotKey: requestedShotKey,
      upscaleForPrint = false,
    } = body;

    if (!designAnchorText) {
      return new Response(
        JSON.stringify({ error: "Missing required field: designAnchorText" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authenticate — extract JWT token and pass explicitly to getUser()
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    let userId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const authClient = createClient(supabaseUrl, supabaseAnonKey);
      const { data: { user } } = await authClient.auth.getUser(token);
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

    // Fetch hero render as visual reference for consistency
    let heroImagePart: { inlineData: { mimeType: string; data: string } } | null = null;
    if (heroRenderUrl) {
      heroImagePart = await fetchImageAsInlineData(heroRenderUrl);
      if (heroImagePart) {
        console.log("Hero render loaded as visual reference for photographer");
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── SINGLE-SHOT MODE ─────────────────────────────────────
    // When shotKey is provided, render ONE shot and return immediately.
    // Frontend calls this 6 times, showing each shot as it arrives.
    const shotsToRender = requestedShotKey
      ? PHOTOGRAPHER_SHOT_SEQUENCE.filter(s => s.key === requestedShotKey)
      : PHOTOGRAPHER_SHOT_SEQUENCE;

    if (requestedShotKey && shotsToRender.length === 0) {
      return new Response(
        JSON.stringify({ error: `Unknown shot key: ${requestedShotKey}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const renderUrls: Record<string, string> = {};
    const productionRenderUrls: Record<string, string> = {};
    const failedShots: string[] = [];
    const timestamp = Date.now();

    for (const shot of shotsToRender) {
      console.log(`Persona 3: Shooting ${shot.label} (${shot.key})...`);

      const prompt = buildPhotographerPrompt({
        designAnchorText,
        vehicleYear,
        vehicleMake,
        vehicleModel,
        finish,
        shotKey: shot.key,
      });

      console.log(`  Prompt: ${prompt.length} chars`);

      // Build parts: hero image first, then text prompt last (Gemini gives
      // strongest weight to the last part — camera angle instructions must win).
      // Skip hero image for passenger-side and close-up — the driver-side hero
      // biases Gemini toward the wrong angle for these shots.
      const skipHeroShots = ['passenger-side', 'close-up'];
      const useHero = heroImagePart && !skipHeroShots.includes(shot.key);
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      if (useHero) {
        parts.push(heroImagePart);
      }
      parts.push({ text: prompt });

      let imageBase64: string | null = null;
      let imageMimeType = "image/png";
      const MAX_RETRIES = 2;

      for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
        try {
          // Pro first (attempts 1-2), fallback to Flash on final attempt
          const currentModel = attempt < MAX_RETRIES + 1 ? PRIMARY_IMAGE_MODEL : FALLBACK_IMAGE_MODEL;
          if (currentModel === FALLBACK_IMAGE_MODEL) {
            console.log(`\u26A1 Model fallback for ${shot.key}: switching to ${FALLBACK_IMAGE_MODEL}`);
          }
          const response = await fetch(
            geminiImageUrl(getGeminiKey(), currentModel),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: attempt === 1 ? parts : [{ text: prompt }] }],
                generationConfig: {
                  responseModalities: ["TEXT", "IMAGE"],
                  imageConfig: { imageSize: "4K", aspectRatio: "16:9" },
                },
              }),
              signal: AbortSignal.timeout(60_000),
            }
          );

          if (!response.ok) {
            console.error(`  ${shot.key} HTTP ${response.status} (attempt ${attempt})`);
            if (response.status === 429 && attempt <= MAX_RETRIES) {
              await new Promise((r) => setTimeout(r, 3000));
              continue;
            }
            if (attempt <= MAX_RETRIES) continue;
            break;
          }

          const result = await response.json();
          const responseParts = result.candidates?.[0]?.content?.parts || [];

          for (const part of responseParts) {
            if (part.inlineData) {
              imageBase64 = part.inlineData.data;
              imageMimeType = part.inlineData.mimeType || "image/png";
            }
          }

          if (imageBase64) {
            console.log(`  ${shot.key} OK on attempt ${attempt}`);
            break;
          }
        } catch (err: any) {
          console.error(`  ${shot.key} error (attempt ${attempt}):`, err?.message);
        }

        if (attempt <= MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }

      if (!imageBase64) {
        console.error(`  ${shot.key} FAILED after all attempts`);
        failedShots.push(shot.key);
        continue;
      }

      // Upload
      const mimeExtMap: Record<string, string> = {
        "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
      };
      const ext = mimeExtMap[imageMimeType] || "png";
      const filePath = `renders/${userId}/PersonaPipeline/photographer/${timestamp}_${shot.key}.${ext}`;

      const bin = atob(imageBase64);
      const imageData = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        imageData[i] = bin.charCodeAt(i);
      }

      const { error: uploadErr } = await supabase.storage
        .from("wrap-files")
        .upload(filePath, imageData, { contentType: imageMimeType, upsert: true });

      if (uploadErr) {
        console.error(`  Upload error for ${shot.key}:`, uploadErr);
        failedShots.push(shot.key);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(filePath);
      renderUrls[shot.key] = publicUrl;
      console.log(`  ${shot.key} uploaded: ${publicUrl}`);

      // ── Optional ESRGAN upscale for print production ──
      if (upscaleForPrint && userId) {
        try {
          console.log(`[UPSCALE] photographer-${shot.key}: running 2-pass ESRGAN...`);
          const upResult = await upscaleImageBytes(imageData, imageMimeType, supabase, {
            scale: 2, passes: 2, userId, label: `photographer-${shot.key}`, timeoutMs: 120_000,
          });
          if (upResult.upscaled) {
            const prodPath = `renders/${userId}/PersonaPipeline/photographer/production/${timestamp}_${shot.key}.${ext}`;
            const { error: pErr } = await supabase.storage
              .from("wrap-files")
              .upload(prodPath, upResult.imageBytes, { contentType: imageMimeType, upsert: true });
            if (!pErr) {
              productionRenderUrls[shot.key] = supabase.storage.from("wrap-files").getPublicUrl(prodPath).data.publicUrl;
              console.log(`[UPSCALE] Production ${shot.key}: ${productionRenderUrls[shot.key]}`);
            }
          }
        } catch (e: any) {
          console.warn(`[UPSCALE] Non-fatal photographer-${shot.key} upscale error:`, e?.message);
        }
      }

      // Brief pause between shots to avoid rate limits
      if (shot.key !== PHOTOGRAPHER_SHOT_SEQUENCE[PHOTOGRAPHER_SHOT_SEQUENCE.length - 1].key) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Update designiq_generations with all render URLs (best-effort)
    if (generationId && Object.keys(renderUrls).length > 0) {
      try {
        await supabase
          .from("designiq_generations")
          .update({
            render_urls: renderUrls,
            generation_status: failedShots.length === 0 ? "all_views" : "partial_views",
            updated_at: new Date().toISOString(),
          })
          .eq("id", generationId);
      } catch (err) {
        console.warn("Failed to update designiq_generations:", err);
      }
    }

    const totalShots = PHOTOGRAPHER_SHOT_SEQUENCE.length;
    const successCount = Object.keys(renderUrls).length;
    console.log(`Persona 3 (Photographer) complete: ${successCount}/${totalShots} shots${failedShots.length > 0 ? ` (failed: ${failedShots.join(", ")})` : ""}`);

    // Single-shot mode: return just the one URL for immediate display
    if (requestedShotKey) {
      const url = renderUrls[requestedShotKey] || null;
      return new Response(
        JSON.stringify({
          shotKey: requestedShotKey,
          renderUrl: url,
          productionRenderUrl: productionRenderUrls[requestedShotKey] || undefined,
          success: !!url,
          generationId: generationId || null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        renderUrls,
        productionRenderUrls: Object.keys(productionRenderUrls).length > 0 ? productionRenderUrls : undefined,
        failedShots,
        totalShots,
        successCount,
        generationId: generationId || null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("persona-photographer-render error:", err);
    return new Response(
      JSON.stringify({ code: "SYSTEM_ERROR", message: "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// ATLAS-PROOF MODE — THE PROVEN PHOTOGRAPHER, ONE INPUT CHANGED
//
// Owner directive (Trish 2026-08-28), verbatim: "DO NOT CREATE ANOTHER 3D EDGE
// FUNCTION. Use supabase/functions/persona-photographer-render/index.ts with
// persona-photographer-prompt.ts, view-angles-os.ts, studio-os.ts. For ATLAS,
// replace the historical heroRenderUrl artwork reference with the matching
// persisted sourcePanelUrl/sourcePanelHash. Passenger must receive its
// Passenger panel. Driver must receive Driver. Hood receives Hood, etc. Do not
// skip the panel input for Passenger. Do not use Driver as artwork continuity
// authority. ATLAS panel = artwork authority. Photographer + angles + studio +
// lighting = presentation authority only."
//
// So exactly one thing differs from the shot loop above:
//
//   heroRenderUrl (a 3D render of the whole vehicle, dropped for two shots)
//     becomes
//   sourcePanelPath (this surface's deterministic panel, attached to every shot)
//
// Everything else is the pinned stack, untouched: buildPhotographerPrompt owns
// the words, view-angles-os owns the camera, studio-os owns the room and the
// light, model-config owns the model and its fallback.
//
// THREE THINGS THE HERO PATH DID THAT THIS MUST NOT.
//
//   1. `skipHeroShots = ['passenger-side', 'close-up']` dropped the reference
//      image for those two shots, because a DRIVER-SIDE hero biased the camera
//      toward the wrong angle. That reasoning does not survive the swap: the
//      passenger panel is not a driver-side photograph, it is the passenger
//      side's own flat artwork, and dropping it would leave the model to invent
//      that flank's design. Every shot gets its own panel.
//   2. The retry re-sent `[{ text: prompt }]` with no image. Under a hero that
//      lost a consistency hint; here it would lose the ARTWORK, and the proof
//      would be a different wrap. The panel is re-attached on every attempt.
//   3. It required a browser JWT. The runtime holds the service role, so this
//      mode takes the same service-role + x-designpro-owner-id pair the Call-1
//      endpoint already accepts, and writes into the DesignProAI namespace.
//
// Returned by STORAGE PATH plus sha256, never a public URL: wrap-files is
// private and a public URL 400s (live 2026-08-27, the same lesson Call 1
// learned). The caller downloads with its server client and verifies the hash.
// ═══════════════════════════════════════════════════════════════════════════

async function handleAtlasProof(body: Record<string, unknown>): Promise<Response> {
  const requestId = crypto.randomUUID();
  const shotKey = String(body.shotKey || "").trim();
  const surfaceKey = String(body.surfaceKey || "").trim();
  const svc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const fail = (message: string, status = 400) => new Response(
    JSON.stringify({
      success: false, requestId, functionName: "persona-photographer-render",
      contract: ATLAS_PROOF_CONTRACT, shotKey, surfaceKey, error: message,
    }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );

  try {
    if (!(shotKey in ATLAS_SHOT_SURFACES)) {
      return fail(`atlas_proof_unknown_shot: ${shotKey || "(missing)"}`);
    }
    // THE PANEL MUST BE THE ONE THIS SHOT IS FOR. A silent mismatch here is the
    // whole defect class this mode exists to remove -- a passenger proof built
    // from the driver's artwork looks plausible and is wrong.
    const expectedSurface = ATLAS_SHOT_SURFACES[shotKey];
    if (expectedSurface && surfaceKey !== expectedSurface) {
      return fail(`atlas_proof_surface_mismatch: ${shotKey} requires the ${expectedSurface} panel, received ${surfaceKey || "(none)"}`);
    }
    // Close-Up: the surface is a SELECTION the caller must state. An unnamed or
    // unknown one is refused rather than defaulted to Driver.
    if (expectedSurface === null && !ATLAS_REAL_SURFACES.includes(surfaceKey)) {
      return fail(`atlas_proof_detail_surface_unselected: close-up must name its artwork surface, received ${surfaceKey || "(none)"}`);
    }
    if (body.heroRenderUrl) {
      return fail("atlas_proof_hero_forbidden: the A.T.L.A.S. panel is the artwork authority; a hero render may not be substituted");
    }

    const panelPath = String(body.sourcePanelStoragePath || "").trim();
    const panelHash = String(body.sourcePanelHash || "").trim().toLowerCase();
    if (!panelPath) return fail("atlas_proof_panel_storage_path_missing");
    if (!/^[0-9a-f]{64}$/.test(panelHash)) return fail("atlas_proof_panel_hash_missing");

    const { data: blob, error: dlErr } = await svc.storage.from("wrap-files").download(panelPath);
    if (dlErr || !blob) return fail(`atlas_proof_panel_download_failed: ${dlErr?.message || panelPath}`, 502);
    const panelBytes = new Uint8Array(await blob.arrayBuffer());
    const panelDigest = await crypto.subtle.digest("SHA-256", panelBytes);
    const panelSha = Array.from(new Uint8Array(panelDigest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (panelSha !== panelHash) {
      return fail("atlas_proof_panel_hash_mismatch: the stored panel is not the artifact the caller named");
    }
    let panelBin = "";
    for (let i = 0; i < panelBytes.length; i += 8192) {
      panelBin += String.fromCharCode.apply(null, Array.from(panelBytes.subarray(i, Math.min(i + 8192, panelBytes.length))));
    }
    const panelPart = {
      inlineData: {
        mimeType: String(body.sourcePanelContentType || "image/png"),
        data: btoa(panelBin),
      },
    };

    if (!hasGeminiKey()) return fail("atlas_proof_no_api_key", 500);

    // ⚠️ KEEP THIS SHORT. Owner, 2026-08-28: "The current ATLAS proof prompts
    // were recorded at roughly 13K characters while the proven photographer
    // prompt is approximately 1.4K. Restore the real photographer prompt stack
    // rather than wrapping it in another enormous reconstructed proof prompt.
    // ATLAS should contribute only: exact panel artwork; lineage; exact
    // vehicle/config; requested shot."
    //
    // The artwork IS the attached image, so this fills the pinned prompt's
    // design slot with the one sentence that says so. Every instruction about
    // HOW to photograph it already lives in the pinned stack; restating any of
    // it here would rebuild the 13K prompt one clause at a time.
    //
    // The pickup clause is the ONE exception the owner named, and it is vehicle
    // CONFIG -- exactly what that quote lists as A.T.L.A.S.'s to contribute. It
    // is one sentence, only on a pickup, sliced from the pin above.
    const designAnchorText = [
      `The attached image is this vehicle's exact approved ${surfaceKey} print panel. It is the wrap.`,
      body.isPickup === true ? TRUCK_BED_RULE : "",
    ].filter(Boolean).join("\n");

    const prompt = buildPhotographerPrompt({
      designAnchorText,
      vehicleYear: String(body.vehicleYear || ""),
      vehicleMake: String(body.vehicleMake || ""),
      vehicleModel: String(body.vehicleModel || ""),
      finish: String(body.finish || "Gloss"),
      shotKey,
    });

    // THE PANEL FIRST, THE CAMERA LAST. Gemini weights the final part most
    // heavily, and the camera instruction is the one that must win -- the same
    // ordering the hero path used, for the same reason.
    const parts = [panelPart, { text: prompt }];

    let imageBase64: string | null = null;
    let imageMimeType = "image/png";
    let modelUsed = PRIMARY_IMAGE_MODEL;
    let imageRequestCount = 0;
    const MAX_RETRIES = 2;
    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
      const currentModel = attempt < MAX_RETRIES + 1 ? PRIMARY_IMAGE_MODEL : FALLBACK_IMAGE_MODEL;
      modelUsed = currentModel;
      try {
        imageRequestCount += 1;
        const response = await fetch(geminiImageUrl(getGeminiKey(), currentModel), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The panel rides EVERY attempt. Retrying text-only would ask the
          // model to invent the design it was meant to photograph.
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: { imageSize: "4K", aspectRatio: "16:9" },
            },
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!response.ok) {
          console.error(`atlas-proof ${requestId} ${shotKey}: HTTP ${response.status} (attempt ${attempt})`);
          if (attempt <= MAX_RETRIES) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
          break;
        }
        const result = await response.json();
        for (const part of (result.candidates?.[0]?.content?.parts || [])) {
          if (part.inlineData) {
            imageBase64 = part.inlineData.data;
            imageMimeType = part.inlineData.mimeType || "image/png";
          }
        }
        if (imageBase64) break;
      } catch (err) {
        console.error(`atlas-proof ${requestId} ${shotKey}: attempt ${attempt} error`, (err as Error)?.message);
      }
      if (attempt <= MAX_RETRIES) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    if (!imageBase64) return fail(`atlas_proof_no_image after ${imageRequestCount} request(s)`, 502);

    const bin = atob(imageBase64);
    const proofBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) proofBytes[i] = bin.charCodeAt(i);
    const digest = await crypto.subtle.digest("SHA-256", proofBytes);
    const proofSha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const ext = imageMimeType === "image/jpeg" ? "jpg" : imageMimeType === "image/webp" ? "webp" : "png";
    const storagePath = `atlas-proof/${requestId}_${shotKey}.${ext}`;
    const { error: upErr } = await svc.storage.from("wrap-files").upload(storagePath, proofBytes, {
      contentType: imageMimeType, upsert: false,
    });
    if (upErr) return fail(`atlas_proof_upload_failed: ${upErr.message}`, 502);

    return new Response(
      JSON.stringify({
        success: true,
        requestId,
        functionName: "persona-photographer-render",
        contract: ATLAS_PROOF_CONTRACT,
        sourceCommit: ATLAS_PROOF_SOURCE_COMMIT,
        provider: "google",
        model: modelUsed,
        functionVersion: ATLAS_PROOF_SOURCE_COMMIT,
        imageRequestCount,
        promptChars: prompt.length,
        shotKey,
        surfaceKey,
        // Every output proves which panel authored it, and which master that
        // panel came from, so both UIs can pair a proof with its panel.
        sourcePanelStoragePath: panelPath,
        sourcePanelHash: panelSha,
        sourceMasterHash: String(body.sourceMasterHash || "") || null,
        atlasRevisionId: String(body.atlasRevisionId || "") || null,
        generationId: String(body.generationId || "") || null,
        proofStoragePath: storagePath,
        proofSha256,
        proofBytes: proofBytes.length,
        contentType: imageMimeType,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(`atlas-proof ${requestId} failed:`, err);
    return fail(`atlas_proof_unexpected: ${String((err as Error)?.message || err).slice(0, 300)}`, 500);
  }
}
