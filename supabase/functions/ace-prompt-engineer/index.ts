/**
 * ace-prompt-engineer
 *
 * ACE (AI Creative Engine) Prompt Engineer — takes a user's raw commercial
 * or restyle brief and elevates it to a $5,000 wrap-studio-quality prompt.
 *
 * Uses Gemini Flash for fast (~2-5s) prompt engineering. Keeps the user's
 * original info (company name, phone, industry, mascot, creative direction)
 * intact but wraps it in professional design direction:
 *   - Custom typography (hand-lettered, slab serif, condensed bold — never generic)
 *   - Logo/brand identity creation
 *   - Industry-specific imagery and design elements
 *   - Exact color scheme with named colors
 *   - Layout composition (where elements sit on the vehicle)
 *   - Photography direction for hero imagery
 *
 * Returns: { enhancedPrompt, aceVersion, processingTimeMs }
 * The frontend sends the enhancedPrompt to design-panel-ai-generate as the prompt.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ACE_VERSION = "1.0.0";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const t0 = Date.now();

  try {
    const body = await req.json();
    const {
      mode,
      prompt,
      companyName,
      phone,
      mascot,
      industryType,
      bulletPoints,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      finish,
    } = body;

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Missing prompt" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ");
    const isCommercial = mode === "commercial";
    const keywords = Array.isArray(bulletPoints)
      ? bulletPoints.filter((b: string) => b?.trim())
      : [];

    // Build the ACE system prompt — teaches Gemini Flash how to write wrap prompts
    // at the level of our curated batch library
    const aceSystemPrompt = isCommercial
      ? buildCommercialAcePrompt(vehicle, companyName, phone, mascot, industryType, keywords, finish, prompt)
      : buildRestyleAcePrompt(vehicle, finish, prompt);

    console.log(`[ACE] Enriching ${isCommercial ? "commercial" : "restyle"} prompt for ${vehicle || "unknown vehicle"} (${prompt.length} chars input)`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: aceSystemPrompt }] }],
          generationConfig: {
            responseMimeType: "text/plain",
            maxOutputTokens: 1024,
            temperature: 0.9,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!response.ok) {
      console.error(`[ACE] Gemini Flash error: ${response.status}`);
      // Fallback: return original prompt un-enriched so render still works
      return new Response(
        JSON.stringify({
          enhancedPrompt: prompt,
          aceVersion: ACE_VERSION,
          fallback: true,
          processingTimeMs: Date.now() - t0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    let enhancedPrompt = prompt; // fallback

    if (parts) {
      for (const part of parts) {
        if (part.text?.trim()) {
          enhancedPrompt = part.text.trim();
          break;
        }
      }
    }

    const processingTimeMs = Date.now() - t0;
    console.log(`[ACE] Prompt enriched: ${prompt.length} → ${enhancedPrompt.length} chars (${processingTimeMs}ms)`);

    return new Response(
      JSON.stringify({
        enhancedPrompt,
        originalPrompt: prompt,
        aceVersion: ACE_VERSION,
        processingTimeMs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[ACE] Error:", err);
    return new Response(
      JSON.stringify({ error: "ACE prompt engineering failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ---------------------------------------------------------------------------
// ACE Commercial Prompt Builder
// Teaches Flash how to write prompts like our curated batch library
// ---------------------------------------------------------------------------

function buildCommercialAcePrompt(
  vehicle: string,
  companyName?: string,
  phone?: string,
  mascot?: string,
  industryType?: string,
  keywords?: string[],
  finish?: string,
  userPrompt?: string,
): string {
  return `You are ACE, the AI Prompt Engineer for WePrintWraps.com — the world's first prompt-to-production vehicle wrap platform. Your job is to take a customer's basic commercial wrap request and transform it into a detailed, production-ready creative brief that will produce a stunning, unique vehicle wrap design.

CUSTOMER'S ORIGINAL REQUEST:
${companyName ? `Business: ${companyName}` : ""}
${phone ? `Phone: ${phone}` : ""}
${mascot ? `Mascot: ${mascot}` : ""}
${industryType ? `Industry: ${industryType}` : ""}
${keywords?.length ? `Brand elements: ${keywords.join(", ")}` : ""}
${vehicle ? `Vehicle: ${vehicle}` : ""}
${finish ? `Finish: ${finish}` : ""}
Creative direction: "${userPrompt}"

YOUR TASK: Rewrite the customer's brief into a single, detailed design prompt (200-350 words) that specifies ALL of the following. Keep every piece of info the customer provided (company name, phone, mascot, etc.) — you are ELEVATING their vision, not replacing it.

REQUIRED ELEMENTS IN YOUR OUTPUT:

1. COLOR SCHEME: Name specific colors (not "blue" — say "deep navy blue", "electric cobalt", "warm amber gold"). Specify base color and accent colors. Describe gradients, splits, or transitions.

2. TYPOGRAPHY: Specify a font style for the company name — NEVER use generic sans-serif. Choose from: hand-lettered script, bold condensed industrial, distressed slab serif, elegant serif, brush-stroke calligraphy, stencil military, retro diner, modern geometric display. The company name must be the HERO element readable from 30 feet.

3. LOGO/BRAND MARK: Design a custom logo icon that sits next to or above the company name. Be specific: "crossed pipe wrenches behind a shield", "flame icon emerging from a snowflake", "chef's hat with a rolling pin crossed behind it". Match the industry.

4. HERO IMAGERY: Specify one photograph or illustration as the visual centerpiece on the passenger side. Be specific about what it shows and the composition. For example: "close-up photograph of a hand-stretched pepperoni pizza with bubbling mozzarella" or "a superhero mascot character flexing while holding a wrench".

5. DESIGN ELEMENTS & TEXTURES: Industry-specific graphic elements across the vehicle — tool textures, food imagery, organic patterns, geometric shapes. Specify WHERE on the vehicle each element appears (hood, doors, rocker panels, rear).

6. SERVICE LINES & TAGLINE: Write a compelling tagline and list key services in the style that fits the brand. Specify placement on the vehicle.

7. CONTACT INFO PLACEMENT: Where the phone number and website go. Phone should be in large, bold digits on the tailgate/rear.

STYLE RULES:
- Each industry gets a UNIQUE design language. A plumber's wrap looks NOTHING like an electrician's.
- Include real texture descriptions: wood grain, carbon fiber, brushed metal, concrete, fabric weave.
- Specify at least one "wow factor" element that makes this wrap stand out from competitors.
- Write the prompt as a single flowing paragraph, not a bulleted list.
- Do NOT include camera angles, studio descriptions, or render instructions — just the DESIGN itself.
- Do NOT say "photorealistic" or mention the AI — write as if briefing a human designer.
- ALWAYS include the company name, phone number, and website (invent a plausible .com domain from the company name if not provided).

CRITICAL — KEEP IT GROUNDED IN REAL WRAP DESIGN:
- This is a PRINTED VINYL WRAP on a REAL VEHICLE — not a painting, not an illustration, not digital art.
- Describe PRINTED GRAPHICS, not fantasy scenes. The wrap is ink on vinyl film applied to sheet metal.
- Photography references should be "photograph of..." (a real photo printed on vinyl), not illustrated or painted imagery.
- Logos and text are PRINTED on the wrap — they look like real signage, not watercolor art.
- Do NOT over-describe with flowery artistic language. Be SPECIFIC and CONCRETE.
- If you mention a mascot or character, describe it as a designed mascot graphic (like a logo mascot), not a realistic painting of a person or creature.
- The result should look like a wrap you'd see driving down the highway — professional, bold, clean — not like a gallery painting.

Output ONLY the enhanced design prompt — no explanations, no preamble, no "Here's the enhanced prompt:".`;
}

// ---------------------------------------------------------------------------
// ACE Restyle Prompt Builder
// ---------------------------------------------------------------------------

function buildRestyleAcePrompt(
  vehicle: string,
  finish?: string,
  userPrompt?: string,
): string {
  return `You are ACE, the AI Prompt Engineer for WePrintWraps.com. Your job is to take a customer's basic restyle wrap concept and transform it into a richly detailed creative brief that will produce a gallery-worthy, show-stopping vehicle wrap.

CUSTOMER'S ORIGINAL CONCEPT:
${vehicle ? `Vehicle: ${vehicle}` : ""}
${finish ? `Finish: ${finish}` : ""}
Creative direction: "${userPrompt}"

YOUR TASK: Rewrite this into a single, detailed design prompt (200-350 words) that describes the complete wrap design. Keep the customer's core concept — you are AMPLIFYING it with professional-level detail.

REQUIRED ELEMENTS:

1. COLOR PALETTE: Name 3-5 specific colors with descriptive names ("burnt sienna", "midnight cobalt", "oxidized copper"). Describe how they flow, blend, and transition across the vehicle — gradients, fades, hard splits.

2. HERO ARTWORK: The main visual spanning the door panels. Describe it in vivid, painterly detail — what it depicts, its art style, how it integrates with the vehicle's body lines and curves.

3. COMPOSITION & FLOW: The visual journey from front to rear. Describe foreground heroes, mid-ground flow elements, and background atmosphere layers. How does the eye travel across the vehicle?

4. TEXTURE & DEPTH: This is CRITICAL. Layer real material textures into the design — riveted steel plates, weathered wood grain, cracked leather, brushed metal, oxidized patina, stone, carbon fiber weave, concrete, fabric, rust, bark, hammered copper. Textures give wraps their premium feel. Specify surface fidelity: is it smooth, gritty, rough, polished? Describe subsurface effects, transparency layers, and dimensional depth. The design should feel like you can TOUCH it.

5. ACCENT ELEMENTS: Secondary details at wheel arches, rocker panels, hood, and rear. These support the theme — particle effects, drip patterns, geometric overlays, organic growth, splatter, cracks, seams.

6. FIDELITY & REALISM: Describe light interaction — how surfaces catch and reflect light, where shadows fall, where highlights bloom. Matte surfaces absorb, metallic surfaces reflect, textured surfaces scatter.

STYLE RULES:
- Write as if briefing a world-class wrap designer, not an AI.
- Be SPECIFIC and CONCRETE — describe exactly what goes where on the vehicle.
- Include specific art style references (ukiyo-e, art nouveau, graffiti, baroque, military surplus, steampunk, etc.).
- Specify "no text, no logos, no branding" for restyle wraps.
- Write as a single flowing paragraph.
- Do NOT include camera angles, studio descriptions, or render instructions.
- Think in LAYERS: base color → texture underlay → mid-ground design → hero artwork → accent overlay.

CRITICAL — KEEP IT GROUNDED IN REAL WRAP DESIGN:
- This is PRINTED VINYL on a REAL VEHICLE — not a painting or digital illustration.
- Describe PRINTED GRAPHICS with real material textures (steel, carbon fiber, wood, stone, leather).
- Do NOT over-describe with flowery language. Be specific about what's on each panel.
- The result should look like a premium show-car wrap, not a fantasy illustration.

Output ONLY the enhanced design prompt — no explanations, no preamble.`;
}
