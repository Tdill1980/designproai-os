/**
 * generate-seed-panel — Phase 1: "The Seed"
 *
 * Generates a single flat Driver Side panel as the MASTER DESIGN.
 * This is the "soul" of the wrap — all other panels will inherit its DNA.
 *
 * The panel is generated at exact print dimensions with bleed baked in.
 * No 3D, no vehicle shapes — just a flat rectangle of production artwork.
 *
 * POST /generate-seed-panel
 * {
 *   "designDescription": "Ed's Smokehouse BBQ dark smoky theme with photorealistic ribs...",
 *   "companyName": "Ed's Smokehouse BBQ",
 *   "vehicleMake": "Mercedes-Benz",
 *   "vehicleModel": "Sprinter High Roof Extended 2018",
 *   "templateUrl": "https://...",           // optional: 2D vehicle template
 *   "panelWidth": 189,                      // inches (default: auto from vehicle DB)
 *   "panelHeight": 80,                      // inches (default: auto from vehicle DB)
 *   "userId": "abc123",
 *   "jobId": "job456"
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey } from "../_shared/gemini-key-pool.ts";
import {
  uploadToStorage,
  getSignedUrl,
  base64ToUint8Array,
  uint8ArrayToBase64,
  fetchImageBytes,
  getServiceClient,
} from "../_shared/panelizer-os/storage.ts";
import { buildPanelList } from "../_shared/artboard-prompt.ts";

const BUCKET = "wrap-files";
const BLEED = 1.5; // inches — baked in silently

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const designDescription = body.designDescription || "";
    const companyName = body.companyName || "";
    const vehicleMake = body.vehicleMake || "Mercedes-Benz";
    const vehicleModel = body.vehicleModel || "Sprinter High Roof Extended 2018";
    const templateUrl = body.templateUrl || "";
    // REFERENCE DESIGN (image-to-image) — optional uploaded design/panel the
    // generator REPRODUCES into a clean flat panel, instead of free-styling from
    // text. Image-conditioned output is far more consistent + powers the
    // "upload a panel" workflow. Pipeline-ready: pass referenceImageUrl when a
    // source design exists; omit it for pure prompt generation (unchanged).
    const referenceImageUrl = body.referenceImageUrl || "";
    const userId = body.userId || "test";
    const jobId = body.jobId || `seed-${Date.now()}`;

    if (!designDescription && !referenceImageUrl) {
      return jsonResponse({ error: "designDescription or referenceImageUrl is required" }, 400);
    }

    // ── Get panel dimensions ─────────────────────────────────────
    let panelWidth = body.panelWidth;
    let panelHeight = body.panelHeight;

    if (!panelWidth || !panelHeight) {
      const { panels } = buildPanelList(vehicleMake, vehicleModel, {});
      const driverSide = panels.find(p => p.key === "driver-side");
      if (driverSide) {
        panelWidth = panelWidth || driverSide.widthInches;
        panelHeight = panelHeight || driverSide.heightInches;
      } else {
        panelWidth = panelWidth || 189;
        panelHeight = panelHeight || 80;
      }
    }

    // Bake bleed into dimensions
    const printWidth = panelWidth + BLEED * 2;
    const printHeight = panelHeight + BLEED * 2;
    const sqft = +(printWidth * printHeight / 144).toFixed(1);

    console.log(`[SEED] ═══ Phase 1: The Seed ═══`);
    console.log(`[SEED] Vehicle: ${vehicleMake} ${vehicleModel}`);
    console.log(`[SEED] Panel: DRIVER SIDE MAIN — ${printWidth}" × ${printHeight}" (${sqft} sqft)`);

    // ── Build content parts ──────────────────────────────────────
    const contentParts: any[] = [];

    // Attach template if provided
    if (templateUrl) {
      try {
        const bytes = await fetchImageBytes(templateUrl);
        contentParts.push({
          inlineData: { mimeType: "image/png", data: uint8ArrayToBase64(bytes) },
        });
        console.log(`[SEED] ✓ Template: ${(bytes.length / 1024).toFixed(0)} KB`);
      } catch (err: any) {
        console.warn(`[SEED] ⚠ Template skipped: ${err.message}`);
      }
    }

    // Attach a REFERENCE DESIGN (image-to-image). When present, Gemini
    // reproduces THIS design as the flat panel instead of inventing one — the
    // consistency lever + the "upload a panel" path. Skipped (no change) when
    // no reference is passed.
    let hasReference = false;
    if (referenceImageUrl) {
      try {
        const bytes = await fetchImageBytes(referenceImageUrl);
        contentParts.push({
          inlineData: { mimeType: "image/png", data: uint8ArrayToBase64(bytes) },
        });
        hasReference = true;
        console.log(`[SEED] ✓ Reference design: ${(bytes.length / 1024).toFixed(0)} KB`);
      } catch (err: any) {
        console.warn(`[SEED] ⚠ Reference skipped: ${err.message}`);
      }
    }

    // ── The prompt — persona-based, simple, exact ────────────────
    const systemInstruction = `You are a vehicle wrap graphic designer. You create flat, print-ready panel artwork for professional vehicle wraps. Every output is a single flat 2D rectangle — the raw vinyl artwork that will be printed and applied to a real vehicle.`;

    const prompt = `Generate a flat, print-ready rectangular panel design for a ${vehicleMake} ${vehicleModel} vehicle wrap.

Panel: DRIVER SIDE MAIN
Dimensions: ${printWidth}" wide × ${printHeight}" tall
${hasReference
  ? `\nA REFERENCE DESIGN is attached as an image. Reproduce THAT design faithfully as this flat panel — keep its exact colors, patterns, depth, motifs, and overall style. Continue/extend the artwork edge-to-edge to fill the full panel dimensions above; do NOT invent a different design.${designDescription ? ` Apply only this refinement: "${designDescription}".` : ""}`
  : `\nDesign direction: "${designDescription}"`}
${companyName ? `Company: ${companyName}` : ""}

This is the HERO PANEL — the master design that sets the visual DNA for the entire vehicle wrap. All other panels (passenger side, hood, rear, roof) will be designed to match this panel's style, colors, and energy.

Output as a single flat rectangle at maximum resolution. Print-ready, filled edge-to-edge. This is a production print file for cast vinyl, not a mockup.`;

    contentParts.push({ text: prompt });

    console.log(`[SEED] Prompt: ${prompt.length} chars`);

    // ── Aspect ratio from panel dimensions ───────────────────────
    const ratio = printWidth / printHeight;
    const geminiRatio = ratio > 2.5 ? "21:9" : ratio > 1.5 ? "16:9" : ratio > 1.2 ? "4:3" : "1:1";

    // ── Call Gemini ──────────────────────────────────────────────
    const key = getGeminiKey();
    const model = "gemini-3-pro-image-preview";
    const start = Date.now();

    console.log(`[SEED] Calling ${model} (ratio: ${geminiRatio})...`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: contentParts }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: geminiRatio, imageSize: "4K" },
          },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );

    const ms = Date.now() - start;

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[SEED] Gemini ${response.status}: ${errText.slice(0, 300)}`);
      return jsonResponse({ success: false, error: `Gemini ${response.status}`, detail: errText.slice(0, 500), ms });
    }

    const result = await response.json();
    const parts = result?.candidates?.[0]?.content?.parts;
    const finishReason = result?.candidates?.[0]?.finishReason || "unknown";

    let imageBase64: string | null = null;
    let text: string | null = null;

    if (parts) {
      for (const part of parts) {
        if (part?.inlineData?.data) imageBase64 = part.inlineData.data;
        if (part?.text) text = part.text;
      }
    }

    if (!imageBase64) {
      console.error(`[SEED] No image (finishReason: ${finishReason})`);
      return jsonResponse({ success: false, error: `No image returned (${finishReason})`, text, ms });
    }

    // ── Save seed panel ──────────────────────────────────────────
    const imageBytes = base64ToUint8Array(imageBase64);
    const storagePath = `production-packs/${userId}/temp/${jobId}/seed-driver-side.png`;
    await uploadToStorage(storagePath, imageBytes);
    const signedUrl = await getSignedUrl(storagePath);

    console.log(`[SEED] ✓ Seed panel: ${(imageBytes.length / 1024).toFixed(0)} KB in ${ms}ms`);

    return jsonResponse({
      success: true,
      phase: "seed",
      url: signedUrl,
      storagePath,
      sizeKB: Math.round(imageBytes.length / 1024),
      text,
      ms,
      panel: {
        name: "DRIVER SIDE MAIN",
        width: printWidth,
        height: printHeight,
        sqft,
      },
      vehicle: `${vehicleMake} ${vehicleModel}`,
      promptLength: prompt.length,
      // Pass these forward to Phase 2
      nextStep: "generate-full-artboard",
      seedPath: storagePath,
    });

  } catch (err: any) {
    console.error("[SEED] Error:", err);
    return jsonResponse({ error: err.message || "Seed generation failed" }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
