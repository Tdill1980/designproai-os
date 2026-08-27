/**
 * persona-csr-enrich — Persona 1: CSR / Design Brief Enricher
 *
 * Text-only Gemini call. Takes a raw customer prompt (5 words or 50),
 * enriches it into a structured design brief with pro suggestions.
 * Identity: Senior vehicle wrap consultant, 15yr experience.
 *
 * Input:  raw prompt, vehicle info, mode, VisionBoardIQ image URLs
 * Output: { enrichedBrief, suggestions[], colorPalette, visionBoardImages }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CSREnrichParams {
  prompt: string;
  mode: "restyle" | "commercial";
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  finish?: string;
  companyName?: string;
  phone?: string;
  mascot?: string;
  industryType?: string;
  bulletPoints?: string[];
  visionBoardImages?: Array<{ slotLabel: string; storageUrl: string }>;
  visionboard_intent?: "style_inspiration" | "exact_reference";
}

function buildCSRPrompt(params: CSREnrichParams): string {
  const {
    prompt,
    mode,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    finish,
    companyName,
    phone,
    mascot,
    industryType,
    bulletPoints,
    visionBoardImages,
    visionboard_intent,
  } = params;

  const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ");

  let assembled = `You are a senior vehicle wrap design consultant with 15 years of experience. You've sold thousands of $3K-$10K wraps. You know what sells, what prints well, and what makes customers say "that's exactly what I wanted."

A customer just walked in and described what they want:
"${prompt}"

Vehicle: ${vehicle || "Not specified"}
Finish: ${finish || "Gloss"}
Mode: ${mode === "commercial" ? "Commercial/Business" : "Restyle/Artistic"}`;

  if (mode === "commercial") {
    if (companyName) assembled += `\nBusiness: ${companyName}`;
    if (phone) assembled += `\nPhone: ${phone}`;
    if (mascot) assembled += `\nMascot: ${mascot}`;
    if (industryType) assembled += `\nIndustry: ${industryType}`;
    if (bulletPoints?.filter(Boolean).length) {
      assembled += `\nBrand elements: ${bulletPoints.filter(Boolean).join(", ")}`;
    }
    // Critical: Tell CSR to infer industry from company name
    if (!industryType && companyName) {
      assembled += `\n\nIMPORTANT: The customer did not specify an industry type. You MUST infer the industry from the company name "${companyName}". For example: "Jake's Landscaping" = lawn care/landscaping, "Mike's Plumbing" = plumbing, "City Electric" = electrical. The design MUST be thematically relevant to the inferred industry — use industry-specific imagery, colors, and visual language.`;
    }
  }

  // Common sense override: if company name is provided in restyle mode, this is actually a commercial wrap
  if (mode !== "commercial" && companyName) {
    assembled += `\n\nCRITICAL OVERRIDE: The customer selected "Restyle" mode but provided a company name "${companyName}". This is clearly a COMMERCIAL wrap request. Treat this as a commercial/business wrap — the design MUST feature the company name prominently, be thematically relevant to the business industry (infer from company name), and follow commercial wrap best practices. Set wrapType to "commercial" in your response.`;
  }

  if (visionBoardImages && visionBoardImages.length > 0) {
    assembled += `\n\nThe customer brought ${visionBoardImages.length} reference image(s) (${visionboard_intent === "exact_reference" ? "they want these elements directly incorporated" : "for style inspiration only"}).`;
  }

  assembled += `

YOUR TASK: Enrich this into a professional design brief that a $5K wrap designer can execute. You must respond in EXACTLY this JSON format — no markdown, no code fences, just raw JSON:

{
  "enrichedBrief": "A detailed 2-3 sentence design brief that elevates the customer's idea into pro-level direction. Include specific colors, flow direction, energy, and design elements. Be specific enough that a designer can execute without guessing.",
  "suggestions": [
    "Suggestion 1: A specific enhancement idea (e.g., 'Add a metallic silver pinstripe along the body line for depth')",
    "Suggestion 2: Another enhancement",
    "Suggestion 3: Another enhancement"
  ],
  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4"],
  "designStyle": "One or two words describing the overall energy (e.g., 'Aggressive Sport', 'Clean Executive', 'Bold Industrial')",
  "wrapType": "${mode === "commercial" ? "commercial" : "restyle"}"
}

Rules:
- ALWAYS give exactly 3-5 suggestions — this is REQUIRED even if the customer gave a detailed prompt. For minimal/vague prompts, your suggestions matter even more.
- The shorter the customer's input, the MORE creative direction you must add in the enrichedBrief. A 5-word input needs a 3-sentence enriched brief with specific colors, elements, and flow.
- The colorPalette MUST have 3-5 hex colors that work together for this design
- The enrichedBrief must be specific and actionable, not vague — include exact colors, flow direction, and key design elements
- For commercial: the design MUST relate to the business industry. Infer the industry from the company name if not explicitly stated. Use industry-specific imagery, colors, and iconography. A landscaping company gets grass/trees/nature imagery, NOT waves. A plumbing company gets water/pipes imagery, NOT flames.
- For restyle: focus on artistic impact, flow, hero artwork placement
- Keep the customer's core vision — enhance it, don't replace it
- suggestions array must NEVER be empty — always provide upgrade ideas`;

  return assembled;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const params = body as CSREnrichParams;

    if (!params.prompt) {
      return new Response(
        JSON.stringify({ error: "Missing required field: prompt" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authenticate user — extract JWT token and pass explicitly to getUser()
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

    const csrPrompt = buildCSRPrompt(params);

    console.log("=== PERSONA 1 (CSR) PROMPT START ===");
    console.log(csrPrompt);
    console.log(`=== PERSONA 1 (CSR) PROMPT END (${csrPrompt.length} chars) ===`);

    // Text-only Gemini call — no image generation
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`;
    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: csrPrompt }] }],
        generationConfig: {
          responseMimeType: "text/plain",
          maxOutputTokens: 1024,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini CSR error:", response.status, errorText);
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limited — try again in a moment" }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: `CSR enrichment failed (HTTP ${response.status})` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const textParts = result.candidates?.[0]?.content?.parts?.filter((p: any) => p.text) || [];
    const rawText = textParts.map((p: any) => p.text).join("").trim();

    if (!rawText) {
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "No response from CSR consultant" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse JSON from response — strip markdown fences if present
    let parsed: any;
    try {
      const cleaned = rawText.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn("CSR response was not valid JSON, wrapping as enrichedBrief:", rawText.substring(0, 200));
      parsed = {
        enrichedBrief: rawText,
        suggestions: [],
        colorPalette: [],
        designStyle: "Custom",
        wrapType: params.mode,
      };
    }

    console.log("Persona 1 (CSR) enrichment complete:", {
      userId,
      briefLength: parsed.enrichedBrief?.length,
      suggestionCount: parsed.suggestions?.length,
    });

    return new Response(
      JSON.stringify({
        enrichedBrief: parsed.enrichedBrief || rawText,
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
        colorPalette: Array.isArray(parsed.colorPalette) ? parsed.colorPalette : [],
        designStyle: parsed.designStyle || "Custom",
        wrapType: parsed.wrapType || params.mode,
        // Pass through for Persona 2
        visionBoardImages: params.visionBoardImages || [],
        visionboard_intent: params.visionboard_intent || "style_inspiration",
        vehicle: {
          year: params.vehicleYear,
          make: params.vehicleMake,
          model: params.vehicleModel,
        },
        finish: params.finish || "Gloss",
        mode: params.mode,
        // Commercial fields passthrough
        companyName: params.companyName,
        phone: params.phone,
        mascot: params.mascot,
        industryType: params.industryType,
        bulletPoints: params.bulletPoints,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("persona-csr-enrich error:", err);
    return new Response(
      JSON.stringify({ code: "SYSTEM_ERROR", message: "Unexpected failure" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
