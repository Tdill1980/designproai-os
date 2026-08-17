/**
 * prompt-rewriter — Standalone sandbox edge function
 *
 * Takes a customer design prompt and rewrites it as precise art direction
 * for recreating 3D rendered designs as flat print-ready vinyl wrap panels.
 *
 * Model: gemini-2.5-flash (text-only, fast, cheap)
 * Input:  { customer_prompt: string, finish?: string }
 * Output: { original, rewritten, char_count }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getGeminiKey(): string {
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) return primary;
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) return k;
  }
  throw new Error("No GOOGLE_AI_API_KEY configured");
}

const GEMINI_MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `You are a prompt engineer for a vehicle wrap production company. You translate customer design ideas into precise art direction for recreating designs as flat print-ready vinyl wrap panels.

A designer has already created this design and rendered it on a 3D vehicle. Now we need to produce flat rectangular print files. Your rewritten prompt will guide the AI in translating the 3D rendered design into flat panel artwork.

REWRITE RULES:
- Expand the idea into specific visual details: colors, textures, elements, lighting, composition
- Specify: fill entire rectangle edge to edge
- Specify: flat artwork viewed from above like vinyl on a production table
- Specify: photorealistic material finish {FINISH}
- Specify: design must maintain visual continuity across separate panels when installed on vehicle
- Emphasize: reproduce the EXACT design elements from the reference render — same colors, same imagery, same composition, same style
- For commercial/brand wraps: maintain exact logo placement, brand colors, and imagery accuracy
- Keep output under 500 characters
- Output ONLY the rewritten prompt

EXAMPLE:
Customer: 'space theme cybertruck'
Rewrite: 'Flat print-ready vehicle wrap artwork recreating the reference design: deep space cosmic environment with detailed nebula clouds in purple and blue, distant star fields, and futuristic spacecraft elements. Maintain exact color palette and composition from the rendered vehicle preview. Design fills entire panel edge to edge. Seamless continuous artwork. Photorealistic detail at print resolution. Gloss vinyl finish appearance. Visual flow continues naturally across panel boundaries.'`;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { customer_prompt, finish } = await req.json();

    if (!customer_prompt || typeof customer_prompt !== "string" || customer_prompt.trim().length < 3) {
      return new Response(
        JSON.stringify({ error: "customer_prompt must be at least 3 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const effectiveFinish = finish || "Gloss";
    const systemPrompt = SYSTEM_PROMPT.replace("{FINISH}", effectiveFinish);
    const apiKey = getGeminiKey();

    console.log(`[prompt-rewriter] Rewriting: "${customer_prompt.slice(0, 60)}..." finish=${effectiveFinish}`);

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            role: "user",
            parts: [{ text: `Customer prompt: "${customer_prompt.trim()}"\nFinish: ${effectiveFinish}\n\nRewrite this into flat panel art direction:` }],
          },
        ],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 512,
          topP: 0.9,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[prompt-rewriter] Gemini ${response.status}:`, errText.slice(0, 300));
      throw new Error(`Gemini ${response.status}: ${errText.slice(0, 200)}`);
    }

    const result = await response.json();
    const rewritten = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!rewritten) {
      throw new Error("No text returned from Gemini");
    }

    console.log(`[prompt-rewriter] "${customer_prompt.slice(0, 40)}..." → "${rewritten.slice(0, 60)}..." (${rewritten.length} chars)`);

    return new Response(
      JSON.stringify({
        original: customer_prompt.trim(),
        rewritten,
        char_count: rewritten.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[prompt-rewriter] Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message || "Rewrite failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
