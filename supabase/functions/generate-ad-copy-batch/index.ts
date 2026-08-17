/**
 * generate-ad-copy-batch — Bulk ad copy generator for launch content.
 *
 * Text-only (no image input). Generates 5 ad copy pieces per call for
 * one tool + one angle. Frontend loops across tools × angles to build
 * a full launch library (50 per tool × 9 tools = 450 pieces).
 *
 * Each piece: { hook, headline, body, cta, angle, tool, format }
 *
 * Writes results directly to agent_social_posts for persistence.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOOL_BRIEFS: Record<string, string> = {
  DesignProAI: "DesignProAI™ — the first Prompt-to-Print™ platform. Prompt OR upload any artwork (ChatGPT, Midjourney, Firefly, a Photoshop file, a photo of an old wrap) and get production-ready wrap print files out. The real problem shops have isn't AI generation — it's PRODUCTION: customers show up with AI wrap art and ask 'now what?'. RecreatePro™ rebuilds any design into production-ready files (the acquisition wedge); DesignProAI creates from a prompt (the expansion). Positioning: Adobe owns creative software, AI owns image generation, DesignProAI owns PRODUCTION. Supporting proof: 7 photorealistic camera angles for client approval. Rotate angles — do NOT lead every ad with the '$500 mockup / 30 seconds' line.",
  ColorPro: "ColorPro™ — Visualize any vinyl wrap color on any vehicle. Browse manufacturer libraries (3M, Avery, XPEL, Inozetek). Upload custom swatches. See it before you commit. Upsell tool for walk-in customers.",
  GraphicsPro: "GraphicsPro™ — AI-powered cut vinyl graphics from design to production-ready cut files. Any surface: vehicles, walls, windows, signs. Compatible with VersaWorks, Onyx, Flexi, SAi, Caldera.",
  FadeWraps: "FadeWraps™ — Premium gradient fade wrap effects with photorealistic renders + production panel kits. Linear, radial, diagonal, split fades. Show-car quality.",
  PatternPro: "PatternPro™ (WBTY) — Pattern wrap visualization + linear footage calculator. Camo, carbon fiber, brushed metal, wood grain. Calculate exact material by the yard. Eliminate waste.",
  ProductionFlow: "ProductionFlow™ — Full production pipeline: AI panelizing, 4× upscaling, vectorizing, quality check, production file packaging. Render to print-ready in minutes, not hours.",
  ApprovePro: "ApprovePro™ — Client approval workflow with professional proof sheets. Digital sign-off. No more back-and-forth emails. Close faster.",
  RevisionStudio: "RevisionStudioIQ™ — AI-powered design revision system. 4-layer revision engine. Adjust colors, patterns, placement without regenerating. Iterate fast, don't start over.",
  QuickQuote: "QuickQuote™ — Instant vehicle wrap quotes. Professional branded PDFs in seconds. Accurate pricing by vehicle size, coverage, material. Close deals on the spot.",
};

const ANGLE_PROMPTS: Record<string, string> = {
  witty: `ANGLE: Witty & Clever. Use humor, wordplay, unexpected comparisons. Make them laugh AND want to buy. Think "Old Spice meets tech startup." Confident, self-aware, slightly irreverent. Short punchy sentences with a twist.`,

  premium: `ANGLE: Premium & Luxury Positioning. This is the Rolls-Royce of wrap tools. Speak to quality, exclusivity, craftsmanship. "For shops that refuse to compromise." Aspirational but not pretentious. Use words like: premium, curated, precision, studio-grade, white-glove, bespoke.`,

  fomo: `ANGLE: FOMO & Urgency. Create fear of missing out. "Your competitor just signed up." "Every day without this is money lost." Scarcity, social proof, ticking clock energy. Short, punchy, action-demanding. Numbers and specifics hit harder than vague urgency.`,

  cutting_edge: `ANGLE: Cutting Edge & Innovation. First-mover energy. "Welcome to the future of wraps." Position the user as an early adopter, ahead of the curve. Tech-forward but accessible. "While others are still doing it the old way, you'll be..."`,

  roi: `ANGLE: Leave Money on the Table / ROI. Hard numbers. "That mockup you outsourced for $800? We do it in 30 seconds for $5." Cost comparison, time savings, revenue opportunity cost. Make them feel the pain of NOT having this tool. Specific dollar amounts and time comparisons.`,

  us_vs_them: `ANGLE: Us vs Them / Competitive. Direct comparison without naming competitors. "Before RestyleProAI" vs "After RestyleProAI." Old way vs new way. "Other shops are still..." Highlight the gap between having and not having this tool. Table-format thinking.`,

  founders: `ANGLE: Founders Carousel / Personal Story. Written as if from the founder. Authentic, vulnerable, mission-driven. "I built this because..." "After 15 years in the wrap industry..." Storytelling format — problem → journey → breakthrough → invitation. Relatable, human, anti-corporate.`,

  features: `ANGLE: Features Callout / Spotlight. Pick ONE specific feature and go deep. Not a feature list — a feature STORY. "Here's what happens when you click Generate..." Walk them through the magic moment. Specific, demonstrable, "watch this" energy.`,

  authority: `ANGLE: Authority & Credibility. Position as THE industry standard. "Used by 500+ wrap shops." "The platform professional installers trust." Expert voice, backed by specifics. Industry knowledge signals. Technical credibility without being boring.`,

  usps: `ANGLE: USP Focused / Differentiators. What makes this tool THE ONLY option? "The only platform that goes from text prompt to production-ready wrap files." Stack unique capabilities. "No one else does X + Y + Z in one tool." Clear, bold, undeniable.`,
};

const FORMATS = ["Post", "Reel", "Story", "Carousel", "Ad"] as const;

// The function is verify_jwt=false at the gateway, so gate it here: callers
// must be a signed-in user (any authenticated account) or present the service
// role key. Blocks anon-key-only callers from burning AI credits.
async function requireUserOrServiceRole(req: Request): Promise<Response | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (jwt && serviceKey && jwt === serviceKey) return null;
  if (jwt) {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
      auth: { persistSession: false },
    });
    const { data, error } = await client.auth.getUser(jwt);
    if (!error && data?.user) return null;
  }
  return new Response(JSON.stringify({ error: "Sign in required" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const denied = await requireUserOrServiceRole(req);
  if (denied) return denied;

  try {
    if (!hasGeminiKey()) {
      return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { tool, angle, count = 5, brand = "RestyleProAI", persist = true } = await req.json();

    if (!tool || !TOOL_BRIEFS[tool]) {
      return new Response(JSON.stringify({ error: `Invalid tool. Valid: ${Object.keys(TOOL_BRIEFS).join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!angle || !ANGLE_PROMPTS[angle]) {
      return new Response(JSON.stringify({ error: `Invalid angle. Valid: ${Object.keys(ANGLE_PROMPTS).join(", ")}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const batchCount = Math.min(10, Math.max(1, count));

    const prompt = `You are a world-class direct-response copywriter for RestyleProAI — the first AI-powered vehicle wrap design platform used by professional wrap shops.

BRAND: RestyleProAI (restyleproai.com)
TARGET: Wrap shop owners, fleet managers, freelance wrap designers, car enthusiasts.
VOICE: Bold, confident, conversational. Sabri Suby meets Gary Vee. No corporate fluff. Every word earns its place.

TOOL YOU'RE WRITING FOR:
${TOOL_BRIEFS[tool]}

${ANGLE_PROMPTS[angle]}

Generate exactly ${batchCount} unique social media ad copy pieces for this tool using ONLY the angle above. Each piece must feel completely different from the others — vary the hook style, sentence structure, and specific feature highlighted.

For each piece, assign a random format from: Post, Reel, Story, Carousel, Ad.

RULES:
- Hook: 3-10 words. Must stop the scroll. No generic "Attention wrap shop owners."
- Headline: 5-15 words. Bold claim or value statement.
- Body: 2-4 sentences. Specific to the tool. Include at least one concrete detail (time saved, cost comparison, feature name).
- CTA: 3-8 words. Action-oriented. "Try it free at RestyleProAI.com" or similar.
- NEVER use: "game-changer", "revolutionary", "next-level", "seamless", "elevate your", "unleash", "transform your business"
- NEVER start hooks with "Attention..." or "Hey wrap shop owners..."
- Use em dashes, sentence fragments, and rhetorical questions for punch.
- Each piece must work standalone — no "as mentioned above" references.

Return ONLY valid JSON array:
[
  { "hook": "...", "headline": "...", "body": "...", "cta": "...", "format": "Post|Reel|Story|Carousel|Ad" }
]`;

    console.log(`[ad-copy-batch] tool=${tool} angle=${angle} count=${batchCount}`);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.9,
            responseMimeType: "application/json",
            maxOutputTokens: 4096,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[ad-copy-batch] Gemini ${response.status}:`, errText.slice(0, 300));
      return new Response(JSON.stringify({ error: `Gemini ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = await response.json();
    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    let pieces: Array<{ hook: string; headline: string; body: string; cta: string; format: string }>;
    try {
      const match = text.match(/\[[\s\S]*\]/);
      pieces = match ? JSON.parse(match[0]) : [];
    } catch {
      console.error("[ad-copy-batch] JSON parse failed:", text.slice(0, 200));
      return new Response(JSON.stringify({ error: "AI returned invalid JSON", raw: text.slice(0, 500) }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!Array.isArray(pieces) || pieces.length === 0) {
      return new Response(JSON.stringify({ error: "No pieces generated" }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Persist to agent_social_posts if requested
    let persisted = 0;
    if (persist) {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );

      const rows = pieces.map((p) => ({
        brand: "restylepro",
        platform: (p.format || "post").toLowerCase(),
        post_type: angle,
        caption: `${p.hook}\n\n${p.headline}\n\n${p.body}\n\n${p.cta}`,
        hashtags: [tool, angle, "launch-adset", "#restyleproai", "#vehiclewrap", "#wrapdesign"],
        status: "draft",
        created_by: "bulk-ad-generator",
      }));

      const { error: insertErr, count } = await sb
        .from("agent_social_posts")
        .insert(rows);

      if (insertErr) {
        console.error("[ad-copy-batch] Insert error:", insertErr.message);
      } else {
        persisted = rows.length;
      }
    }

    console.log(`[ad-copy-batch] Generated ${pieces.length} pieces for ${tool}/${angle}, persisted=${persisted}`);

    return new Response(JSON.stringify({
      pieces,
      tool,
      angle,
      count: pieces.length,
      persisted,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[ad-copy-batch] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
