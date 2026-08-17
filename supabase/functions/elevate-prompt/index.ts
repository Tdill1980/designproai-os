import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { getGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * elevate-prompt — GENIE Prompt Helper
 *
 * Takes a short user prompt and returns an elevated, wrap-designer-quality
 * version using Gemini Flash (text-only, ~$0.001 per call).
 *
 * Input:  { prompt: string }
 * Output: { elevated: string }
 */

const RESTYLE_SYSTEM_PROMPT = `You are GENIE — the prompt engine for DesignIQ, a professional AI vehicle wrap design tool used by real wrap shops.

Your job: READ the user's prompt carefully, understand their vision, then FILL IN the design details a wrap shop needs to actually build it. Keep their idea, add the specifics they didn't think of.

ABSOLUTE RULE #1 — PRESERVE THE USER'S WORDS:
Every theme word, color word, adjective, motif, and reference the user wrote MUST appear in your output, by name. You are ADDING detail to their idea, not REPLACING it.
- If they wrote "samurai" → the word samurai (or a direct visual equivalent like "katana", "kabuto helmet plates") MUST be in your output.
- If they wrote "cherry blossoms" → cherry blossoms must appear by name with a placement on the body.
- If they wrote "deep reds and blacks" → those exact colors must appear with placements.
- If they wrote "galaxy" → galaxy/nebula/stars must appear by name.
You may translate metaphors into geometry (see below), but the original noun must still be present. NEVER drop or generalize a user's theme word into something safer.

ABSOLUTE RULE #2 — NO SUBSTITUTION:
Do not swap the user's theme for a "more design-friendly" version. "Dark samurai with cherry blossoms in deep reds and blacks" must come out as a samurai + cherry blossom + red/black wrap. Not "an aggressive Japanese-inspired wrap". Not "a dark warrior theme". Use their exact nouns.

CRITICAL: Start FROM the user's words. If they said "galaxy theme" — your output must be ABOUT a galaxy wrap with specific galaxy design elements. If they said "blue and black aggressive" — your output must be blue and black and aggressive. READ THEIR PROMPT. BUILD ON IT. Do not ignore it and write something generic.

RULES:
- Output ONLY the elevated prompt text. No explanations, no prefixes.
- Write 80-150 words. Every sentence must contain a DESIGN DECISION.
- Describe WHERE elements go: "on the hood", "across both doors", "from front fender sweeping to rear quarter", "on rocker panels"
- Name SPECIFIC materials: matte black, satin chrome, brushed titanium, gloss candy red, carbon fiber, metallic flake
- Describe SPECIFIC design elements that match the user's theme: "angular slash graphics", "hexagonal mesh pattern", "torn-edge fade from black to red", "nebula swirl with purple-to-cyan gradient"
- Specify BASE TREATMENT + ACCENT ELEMENTS + FLOW — not just "a cool wrap"
- Translate metaphors into geometry: "stealth bomber" → angular faceted panels with swept edges in matte gunmetal. "samurai" → layered plate segments with brushed steel edges. "galaxy" → deep black base with nebula swirls in purple, cyan, and magenta across doors, star field on hood
- BANNED WORDS: stunning, breathtaking, captivating, mesmerizing, eye-catching, sleek, elegant, dynamic, seamlessly, transforms, elevates, showcases, exquisite, masterfully, artfully, harmoniously, boasts, features a, adorned with
- Write like a wrap installer's build sheet, not a marketing brochure
- Never add text, logos, phone numbers, or business branding
- Never mention camera angles, studio lighting, or photography`;

const COMMERCIAL_SYSTEM_PROMPT = `You are GENIE — the prompt engine for DesignIQ, a professional AI vehicle wrap tool. You write prompts that produce $5,000 commercial wraps — not amateur plain-van-with-a-stock-photo garbage.

STUDY THIS GOLD STANDARD PROMPT (this is the quality you must match):
"third of every panel, close-up photograph of thick-sliced brisket showing perfect smoke ring on the passenger side, brushed copper logo with crossed smoker forks on both doors, 'Low & Slow Since 2011 · Full-Service Catering' in distressed slab type on the beltline, (512) 555-8833 and pitmasterjacks.com on the tailgate"

Notice what makes it great:
- DESIGN ELEMENTS: "brushed copper logo with crossed smoker forks" — not just "logo on the door"
- TYPOGRAPHY STYLE: "distressed slab type" — not just "text"
- TEXTURE/MATERIAL: implies dark charcoal wood-grain base through the brisket/BBQ context
- INTEGRATED imagery: the brisket photo is PART OF the design flow, not a stock photo pasted in a frame
- SPECIFIC PLACEMENT: every element has a location on the vehicle

ABSOLUTE RULE #1: Keep EVERYTHING the user wrote. Their company name, website, phone, logo, tagline — EXACTLY as written. Do NOT drop or rephrase any detail.

ABSOLUTE RULE #2: Every commercial wrap needs DESIGN WORK — not just a plain color with text and a stock photo. You MUST include:
- A strong BASE TREATMENT: textured background, color blocking, gradient sections, or pattern (NOT a plain solid color)
- GRAPHIC FLOW ELEMENTS: angular cuts, swooshes, geometric shapes, torn edges, diagonal slashes that create visual movement across the vehicle
- TYPOGRAPHY STYLE: specify the font character — "bold condensed sans-serif", "distressed slab type", "hand-lettered script", "clean modern sans" — not just "text"
- DESIGN INTEGRATION: any imagery must be woven INTO the design, not pasted in a rectangle like a poster on a wall

TRADE DNA — use the right design language for each industry:
- Bakery/cafe: warm mocha or espresso base, linen/burlap textures, elegant script typography, wheat/flour dust accent graphics, cream and copper palette, scalloped edge details
- BBQ/restaurant: dark charcoal wood-grain base, brushed copper or gold accents, bold distressed slab fonts, smoke wisps, crossed utensil icons
- Construction: bold diagonal slashes, safety orange or yellow + matte black, diamond plate or concrete textures, heavy condensed bold type, hard angular cuts
- Landscaping: deep forest green base fading to earth brown, organic curved swooshes, clean geometric leaf patterns, natural wood accents
- Tech/IT: dark navy or matte charcoal base, electric cyan or neon blue accent lines, geometric grid or circuit patterns, thin modern sans-serif
- Plumbing/HVAC: royal blue + white color blocking, clean angular panel divisions, bold condensed type, tool/pipe icon treatments (NOT photos), professional stripe accents
- Cleaning: bright white base with fresh blue or green angular accent panels, ultra-clean lines, minimal bold sans-serif, sparkle/shine graphic elements
- Auto/detailing: gloss black or dark metallic base, chrome accent lines, aggressive angular cuts, bold italic condensed type

If the user's prompt is missing critical details (company name, phone, website), include: [TIP: Add your company name, phone, website, and logo description for best results]

RULES:
- Output ONLY the elevated prompt text (plus optional TIP). No explanations.
- Write 80-150 words. Every sentence must contain a DESIGN DECISION, not filler.
- Describe WHERE each element goes on the vehicle body
- Specify typography style, not just "text"
- Specify base treatment and graphic flow, not just "professional wrap"
- NEVER output a plain solid color van with text — that's a $200 Craigslist job, not a $5,000 wrap
- BANNED WORDS: stunning, breathtaking, captivating, mesmerizing, eye-catching, sleek, elegant, dynamic, seamlessly, transforms, elevates, showcases, exquisite, masterfully, artfully, harmoniously, boasts, features a, adorned with
- Never mention camera angles, studio lighting, or photography terms`;

const GEMINI_MODEL = "gemini-2.5-flash";

// ── PRESERVATION GUARDRAIL ───────────────────────────────────────────────
// GENIE is supposed to ENHANCE the user's brief, never delete from it.
// Soft prompt rules can still slip, so after each call we mechanically
// verify every meaningful word the user typed still appears in the
// elevated output. If any are missing, we retry once with an explicit
// "you dropped X" instruction; on the second miss we auto-append the
// dropped terms so the final brief is mathematically guaranteed to
// contain everything the user wrote.
const PRESERVATION_STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "without", "on", "in", "at", "to", "from", "by",
  "is", "it", "this", "that", "these", "those", "as", "if", "but", "than", "then",
  "i", "my", "me", "we", "our", "us", "you", "your", "he", "she", "her", "his", "its", "they", "their", "them",
  "want", "wants", "need", "needs", "like", "likes", "please", "can", "will", "would", "could", "should",
  "have", "has", "had", "do", "does", "did", "was", "were", "are", "am", "be", "been", "being",
  "wrap", "wraps", "wrapped", "design", "designs", "designed", "vehicle", "vehicles", "car", "cars",
  "truck", "trucks", "van", "vans", "side", "sides", "front", "rear", "back", "panel", "panels",
  "body", "make", "made", "add", "adds", "give", "gives", "create", "creates", "build", "builds",
  "put", "look", "looks", "more", "less", "very", "really", "quite", "just", "also", "only",
  "some", "any", "every", "each", "all", "no", "not", "yes",
]);

function extractPreservationKeywords(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4) continue;
    if (PRESERVATION_STOP_WORDS.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

function findMissingKeywords(keywords: string[], elevated: string): string[] {
  if (!elevated) return keywords;
  const lower = elevated.toLowerCase();
  return keywords.filter((k) => {
    const stem = k.slice(0, Math.min(5, k.length));
    const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`\\b${esc}`, "i").test(lower);
  });
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prompt, mode, companyName, phone, mascot, industryType, bulletPoints } = await req.json();

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return new Response(
        JSON.stringify({ error: "Prompt must be at least 3 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isCommercial = mode === "commercial";
    const systemPrompt = isCommercial ? COMMERCIAL_SYSTEM_PROMPT : RESTYLE_SYSTEM_PROMPT;

    // Build commercial context block for the user message
    let commercialContext = "";
    if (isCommercial) {
      const parts: string[] = [];
      if (companyName) parts.push(`Company: ${companyName}`);
      if (phone) parts.push(`Phone: ${phone}`);
      if (mascot) parts.push(`Mascot/Logo: ${mascot}`);
      if (industryType) parts.push(`Industry: ${industryType}`);
      if (bulletPoints?.length) parts.push(`Brand keywords: ${bulletPoints.join(", ")}`);
      if (parts.length) commercialContext = `\n\nBUSINESS DETAILS:\n${parts.join("\n")}`;
    }

    let apiKey: string;
    try {
      apiKey = getGeminiKey();
    } catch (e: any) {
      console.error("[elevate-prompt] getGeminiKey() failed:", e.message);
      throw new Error(`No API key: ${e.message}`);
    }

    console.log(`[elevate-prompt] Using model=${GEMINI_MODEL}, key=${apiKey.slice(0, 8)}...`);
    // Try v1beta first, fall back to v1 if needed
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const trimmedPrompt = prompt.trim();
    const preservationKeywords = extractPreservationKeywords(trimmedPrompt);
    const TRANSPORT_RETRIES = 2; // for HTTP/rate-limit transient errors
    const PRESERVATION_RETRIES = 1; // re-ask Gemini if it dropped user words
    let elevated: string | null = null;
    let missingAfterRetry: string[] = [];
    let preservationAttempt = 0;

    while (preservationAttempt <= PRESERVATION_RETRIES) {
      const userMessage = preservationAttempt === 0
        ? `Elevate this ${isCommercial ? "commercial business" : "wrap design"} prompt:\n"${trimmedPrompt}"${commercialContext}`
        : `Your previous elevation dropped these required terms from the user's original prompt: ${missingAfterRetry.map((m) => `"${m}"`).join(", ")}.\n\nRewrite the elevation. EVERY one of those dropped terms must appear by name in the new output. Keep all the other detail you added, just put the missing terms back where they belong.\n\nOriginal user prompt:\n"${trimmedPrompt}"${commercialContext}`;

      let lastError: string | null = null;
      let candidate: string | null = null;

      for (let attempt = 1; attempt <= TRANSPORT_RETRIES; attempt++) {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              system_instruction: {
                parts: [{ text: systemPrompt }],
              },
              contents: [
                {
                  role: "user",
                  parts: [{ text: userMessage }],
                },
              ],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 1024,
                topP: 0.9,
              },
            }),
            signal: AbortSignal.timeout(15_000),
          });

          if (response.status === 429) {
            console.warn(`[elevate-prompt] 429 rate-limited (attempt ${attempt})`);
            if (attempt < TRANSPORT_RETRIES) { await new Promise(r => setTimeout(r, 2000)); continue; }
            lastError = "Rate limited — try again in a moment";
            break;
          }

          if (!response.ok) {
            const errText = await response.text();
            console.error(`[elevate-prompt] Gemini ${response.status} (attempt ${attempt}):`, errText.slice(0, 500));
            if (attempt < TRANSPORT_RETRIES) { await new Promise(r => setTimeout(r, 1000)); continue; }
            lastError = `Gemini ${response.status}: ${errText.slice(0, 300)}`;
            break;
          }

          const result = await response.json();
          candidate = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;

          if (candidate) break;

          console.warn(`[elevate-prompt] No text in response (attempt ${attempt})`);
          if (attempt < TRANSPORT_RETRIES) { await new Promise(r => setTimeout(r, 1000)); }
        } catch (err: any) {
          if (err?.name === "AbortError") {
            console.warn(`[elevate-prompt] Timeout (attempt ${attempt})`);
          } else {
            throw err;
          }
          if (attempt < TRANSPORT_RETRIES) { await new Promise(r => setTimeout(r, 1000)); }
        }
      }

      if (!candidate) {
        if (preservationAttempt === 0) {
          throw new Error(lastError || "No text returned from Gemini");
        }
        // Preservation retry itself failed: fall back to the previous elevated text
        break;
      }

      elevated = candidate;
      const missing = findMissingKeywords(preservationKeywords, candidate);
      if (missing.length === 0) {
        console.log(`[elevate-prompt] preservation OK after attempt ${preservationAttempt + 1} (${preservationKeywords.length} keywords kept)`);
        break;
      }

      console.warn(`[elevate-prompt] preservation miss on attempt ${preservationAttempt + 1}: dropped ${missing.join(", ")}`);
      missingAfterRetry = missing;
      preservationAttempt++;
    }

    if (!elevated) {
      throw new Error("No text returned from Gemini");
    }

    // Safety net: if Gemini STILL dropped words after the retry, append them
    // so the final brief mechanically contains everything the user typed.
    const finalMissing = findMissingKeywords(preservationKeywords, elevated);
    let preservationNote: string | null = null;
    if (finalMissing.length > 0) {
      const append = `\n\n[Required terms from original brief: ${finalMissing.join(", ")}]`;
      elevated = `${elevated}${append}`;
      preservationNote = `GENIE rewrote the brief but skipped these terms — they've been added back: ${finalMissing.join(", ")}`;
      console.warn(`[elevate-prompt] preservation safety net engaged: appended ${finalMissing.join(", ")}`);
    }

    console.log(`[elevate-prompt] "${trimmedPrompt.slice(0, 40)}..." → "${elevated.slice(0, 60)}..."`);

    return new Response(
      JSON.stringify({
        elevated,
        original: trimmedPrompt,
        preservationKeywords,
        ...(preservationNote ? { preservationNote } : {}),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[elevate-prompt] Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message || "Elevation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
