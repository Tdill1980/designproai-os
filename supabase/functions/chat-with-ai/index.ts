/**
 * chat-with-ai — QC Assistant for Admin GraphicDesigner QC
 *
 * Uses Gemini to provide production QC recommendations:
 * fix actions, upscaler settings, sizing advice, resolution guidance.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey } from "../_shared/gemini-key-pool.ts";

// gemini-2.0-flash was retired by Google (404 "no longer available").
const MODEL = "gemini-2.5-flash";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt } = await req.json();
    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Missing prompt" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = getGeminiKey();
    if (!apiKey) {
      return new Response(
        JSON.stringify({ response: "AI service not configured. Use the fix action buttons to apply fixes manually." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const systemPrompt = `You are a print production QC assistant for a vehicle wrap production shop. You help quality check panelized wrap files.

You know these fix pipelines that the admin can trigger:
- **Deterministic Upscale**: Re-runs ESRGAN 4x upscaler on panels. Use when resolution is below 150 DPI at print size. Settings: 2x (one pass) or 4x (two passes).
- **Resize Panel**: Adjusts panel pixel dimensions to match the vehicle template measurements.
- **Extend Bleed**: Re-runs the panelizer fill step to regenerate panels with 0.5" bleed margins.
- **Regenerate Panel**: Full re-panelization of a specific zone — re-crops from the 3D render and sends through Gemini again.
- **Text Cleanup**: For blurry or AI-garbled text — recommends vector rebuild or manual replacement.
- **Color Calibration**: Re-maps colors for CMYK print accuracy.

Resolution math for vehicle wraps:
- 59.5" wide roll at 4K render (3840px) = ~65 DPI (too low for close viewing)
- After ESRGAN 2x: ~130 DPI (acceptable for vehicle wraps viewed at 3+ feet)
- After ESRGAN 4x: ~260 DPI (excellent, exceeds 150 DPI threshold)
- Minimum acceptable: 72 DPI for fleet/commercial wraps
- Ideal target: 150+ DPI for retail/premium wraps

Respond concisely (under 150 words). Be specific about which fix action to use and what settings.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `${systemPrompt}\n\n${prompt}` }] },
          ],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.3,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[CHAT-AI] Gemini ${response.status}: ${errText.slice(0, 200)}`);
      return new Response(
        JSON.stringify({ response: "AI temporarily unavailable. Check the failed QC steps and select a fix action manually." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated. Select a fix action manually.";

    return new Response(
      JSON.stringify({ response: text }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[CHAT-AI] Error:", err);
    return new Response(
      JSON.stringify({ response: "AI service error. Use fix action buttons to apply fixes manually." }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
