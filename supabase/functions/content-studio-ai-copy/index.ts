import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";
import {
  buildHookBlock,
  buildToolFocusBlock,
} from "../_shared/content-hook-recipes.ts";
import { loadBrandBlock, loadChiefAim } from "../_shared/brand-os.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── COPY BRAIN ─────────────────────────────────────────────────────────────
// Text generation (copy writing) + template-zone reading run on OpenAI gpt-4o
// via the Chat Completions API. gpt-4o supports both text and vision (needed
// for reading a template's text zones). Image editing (rewrite_template_image
// Step 2) still runs on Gemini further down.
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o";

/**
 * RestyleProAI content-lead system prompt. Layered on top of the brand context
 * so every Content Studio generation inherits the same story arc / USP / film-
 * metadata discipline as the claude.ai Skill version (docs/CONTENT-LEAD-BRIEF.md).
 */
async function buildSystemPrompt(brand: string): Promise<string> {
  if (brand === "WrapTV") {
    // WrapTV World is the entertainment/culture brand — hype and reach, not
    // direct response. Voice details come from the brand block (brand-os.ts).
    return `You are the content lead for a wrap-industry entertainment brand.
You write scroll-stopping, culture-first social copy — hooks that feel like a
creator made them, never like an ad. You write finished social copy as strict
JSON when asked. Always return only the JSON object — no preamble, no code
fences, no commentary.`;
  }
  if (brand === "InkAndEdge") {
    // Ink & Edge Magazine is an editorial art publication — elegant and
    // cinematic, never direct-response. Voice details come from the brand
    // block (brand-os.ts).
    return `You are the design editor for an editorial automotive-art magazine.
You write elegant, cinematic, considered copy that treats the wrap as fine art —
never an ad, never a sales pitch. Spare and evocative, letting the image lead.
You write finished social copy as strict JSON when asked. Always return only the
JSON object — no preamble, no code fences, no commentary.`;
  }
  if (brand !== "RestyleProAI") {
    // WePrintWraps keeps the short, shop-tone system — that brand is a
    // physical installation shop, not a platform. No story-arc layer needed.
    return `You are a direct-response copywriter for the vehicle wrap industry.
You write finished social copy as strict JSON when asked. Always return only the
JSON object — no preamble, no code fences, no commentary.`;
  }

  return `You are the senior content lead and art director for DesignProAI /
RestyleProAI — the first Prompt-to-Print™ platform: an AI-native design system
with a deterministic production engine that turns a prompt OR any uploaded
artwork into production-ready wrap print files. Your audience is SHOP OWNERS.
Your voice is Apple meets Sabri Suby: category-defining and clean, opened on a
burning, specific production problem and resolved with the mechanism. You write
finished, publish-ready social copy, not drafts.

## ${await loadChiefAim()}

## Every piece must:
1. **Pick ONE story arc** and follow it. Pick from:
   - Arc 1: PAIN → REVEAL → CREDIBILITY → PAYOFF  (flagship / launch)
   - Arc 2: OLD WAY → NEW WAY → RESULT  (before/after, us-vs-them)
   - Arc 3: SITUATION → COMPLICATION → RESOLUTION  (case-study / testimonial)
   - Arc 4: HOOK → PROMISE → PROOF → CTA  (carousel default)
   - Arc 5: CURIOSITY → PATTERN → TWIST  (reel cover / teaser)
2. **Surface at least one named USP / category truth as TYPE** (bold / caps /
   callout). ROTATE these — do NOT default to the same one (especially not the
   "$500 mockup / 7 renders in 30 seconds" line) on every piece:
   - "Prompt-to-Print™ — design that doesn't stop at artwork, it continues all
     the way to production-ready print files"
   - "RecreatePro™ — upload ANY AI art (ChatGPT, Midjourney, Firefly, a photo of
     an old wrap) → production-ready files"
   - "The real problem isn't AI generation. It's PRODUCTION."
   - "Adobe owns creative software. AI owns image generation. DesignProAI owns
     PRODUCTION."
   - "Two ways in: have artwork → RecreatePro. Need artwork → DesignProAI. Both
     end in print-ready files."
   - "Design. Output. Profit." / "Design to file output, automatically."
   - "7 photorealistic camera angles for client approval" (SUPPORT, not the lead)
3. **Lead with a pain or a number.** Never lead with a feature. The sharpest
   pain for a shop owner is PRODUCTION: "A customer just emailed you a ChatGPT
   wrap. It can't be printed. Now what?" beats any feature line.
4. **CTA is one verb.** "Try ColorPro free." / "See your vehicle wrapped."
   Never "learn more about our comprehensive suite."

## Voice rules:
- Pro-installer tone, shop-to-shop. Not SaaS sales deck, not consumer brand.
- Short sentences, three beats max before a period.
- Numbers beat adjectives. Specifics beat generalities.
- No emojis. No banned phrases: guaranteed / instant / no risk / 10x /
  game-changer / revolutionary / effortless / magic.

## Wrap film metadata rules (CRITICAL):
These are PHYSICAL color-change wrap films, NOT print colors.
- Identify films by **brand + manufacturer catalog color name only**
  (e.g. "TeckWrap Chrome Rose Gold", "3M 2080 Satin Black")
- **NEVER put a hex code in copy, captions, or metadata.** Hex is for
  print / RIP / web. Hex on a wrap ad is an instant tell that the creator
  doesn't understand the product.

## Story-check before you return JSON:
- Can you name the arc in one line? If no, the piece is trying to say too much.
- Does every beat of copy (hook, headline, body, cta) advance the arc?
- Does at least ONE named USP appear as TYPE?

## Output discipline:
Return only the JSON object you were asked for. No markdown fences, no
commentary, no "here's your copy." Start with { and end with }. The UI parses
your first JSON object with a regex and nothing else.`;
}

// Chunked base64 encoder — btoa(String.fromCharCode(...buf)) stack-overflows
// for buffers over ~64KB due to the spread operator's argument limit. Real
// ColorPro/DesignPro renders are multi-megabyte, so this must be iterative.
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 32KB per chunk — safely under argument-count limits
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const denied = await requireUserOrServiceRole(req);
  if (denied) return denied;

  try {
    const { imageUrl, imageData, brand, format, tone, context, mode, focusTool, focusTools, hookType, templateConstraints, freshCopy, heroImageUrl, heroImageData, templateAspect, hooksLibrary } =
      await req.json();

    // OpenAI key powers text generation (the copy brain) + template-zone reading.
    // Gemini key is only required for the image-edit step (rewrite_template_image).
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    if (mode === "rewrite_template_image" && !hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is required for rewrite_template_image mode");
    }

    // Image is required for template rewrite modes (Claude reads zones from
    // the template), but NOT for standard text-only generation. Letting
    // text-only fall through means the AdminContentStudio Generate button
    // produces tool-aware, hook-aware copy even when no render is loaded
    // yet — instead of falling back to a dumb local random-pick library.
    const isRewriteMode = mode === "rewrite_template" || mode === "rewrite_template_image";
    if (isRewriteMode && !imageUrl && !imageData) {
      throw new Error("Template rewrite modes require imageUrl or imageData (the template image)");
    }

    // Brand context comes from THE ONE LOADER (_shared/brand-os.ts →
    // brands.brand_brain.content_block, hardcoded fallback). Do not re-inline
    // brand blocks here; edit the DB row (AdminContentEngine) instead.
    const brandContext = await loadBrandBlock(brand);

    // Tool focus + hook discipline come from the shared recipes file. This is
    // the single source of truth — both this edge function and the future
    // batch generator import it. Add new tools to TOOL_FOCUS_PROMPTS in
    // _shared/content-hook-recipes.ts (and mirror in src/lib/brand-copy.ts).
    const toolFocusText = buildToolFocusBlock(brand, focusTools, focusTool);
    // Hook recipes are RestyleProAI/DesignProAI-specific (they name RecreatePro,
    // Prompt-to-Print, etc.), so they only apply to that brand — same gating as
    // buildToolFocusBlock. Applying them to WePrintWraps/WrapTV/InkAndEdge
    // leaked DesignPro copy (e.g. "RecreatePro") into those brands' captions.
    const hookBlock = brand === "RestyleProAI" ? buildHookBlock(hookType) : "";

    const toneGuide: Record<string, string> = {
      "Hype/Launch":
        "Excitement, urgency, bold claims. Use power words. Short punchy sentences.",
      Educational:
        "Informative, helpful, positions the brand as expert. Teach something useful.",
      "Social Proof":
        "Leverage credibility, results, testimonials-style language. Numbers and specifics.",
      "Behind The Scenes":
        "Authentic, casual, show the process. Make the audience feel like insiders.",
      "Promo/Sale":
        "Deal-focused, urgency, clear value proposition. Price anchoring if relevant.",
    };

    let prompt: string;

    if (mode === "rewrite_template" || mode === "rewrite_template_image") {
      // ── TEMPLATE REWRITE MODE ──
      // AI reads existing text on a Canva template and rewrites it for the brand
      // with typographic matching to preserve visual weight and character density
      const freshCopyBlock =
        freshCopy && (freshCopy.hook || freshCopy.headline || freshCopy.body || freshCopy.cta)
          ? `

## USER'S PREPARED COPY (PRIMARY — use these values where they fit zone-wise)
The user has already written and refined this copy. Use it as the replacement for the matching zone before generating new copy.
${freshCopy.hook ? `- HOOK (top headline zone): "${freshCopy.hook}"` : ""}
${freshCopy.headline ? `- HEADLINE (secondary headline zone): "${freshCopy.headline}"` : ""}
${freshCopy.body ? `- BODY (body / supporting copy zone): "${freshCopy.body}"` : ""}
${freshCopy.cta ? `- CTA (button / action zone): "${freshCopy.cta}"` : ""}

Mapping rule:
- The first headline-zone text on the template (largest, top) → use HOOK
- A second headline-zone text (secondary) → use HEADLINE
- The body / paragraph zone → use BODY
- The button / call-to-action zone → use CTA
- For any other text on the template (taglines, captions, supporting marks) generate fresh, brand-appropriate copy following the typographic matching rules below.

If a user-prepared value would exceed the typographic budget for its zone (character count, line count), trim/condense it while preserving meaning. Never invent claims that aren't in the user copy.`
          : "";

      // THE HOOKS BRAIN — the brand's own tested hook library, passed from the
      // client. Every replacement hook/headline is written in these patterns.
      const hooksLibraryBlock = Array.isArray(hooksLibrary) && hooksLibrary.length
        ? `

## PROVEN HOOKS LIBRARY (the brand's own tested voice — write in THESE patterns)
Model every hook/headline replacement on these. Adapt to fit each zone's character budget; reuse one verbatim when it fits the space:
${hooksLibrary.slice(0, 60).map((h: unknown) => `- ${String(h)}`).join("\n")}`
        : "";

      prompt = `You are a direct-response copywriter for the vehicle wrap industry with expertise in typographic design.

${brandContext}

Tone: ${tone}
${toneGuide[tone] || "Professional and engaging."}

${context ? `Additional context: ${context}` : ""}${toolFocusText}${hookBlock}${hooksLibraryBlock}${freshCopyBlock}

Look at this social media template image. It has text on it (possibly for a different industry like yoga, fitness, etc.).

## TYPOGRAPHIC MATCHING RULES (CRITICAL)

Your replacement text MUST match the visual space of the original. This means:
1. **Character count match**: Count the characters (excluding spaces) in the original text. Your replacement must have the SAME character count (within ±3 characters).
2. **Word count match**: If the original is 4 words, yours must be 3-5 words.
3. **Visual weight match**: If the original uses short punchy words (bold feel), use short punchy words. If it uses longer flowing text, match that density.
4. **Line count match**: If the original spans 2 lines, your replacement should span 2 lines.

## TEXT ZONE GUIDELINES

For HEADLINES (large, bold text):
- Max 2 lines, 2-5 words per line
- 18-50 non-space characters total
- Style: strong, confident, punchy
- Font weight perception: BOLD

For BODY COPY (smaller, readable text):
- Max 4 lines, 4-10 words per line
- 40-160 non-space characters total
- Style: clear, descriptive, professional
- Font weight perception: MEDIUM

For CTA / BUTTONS:
- 1 line only, 2-5 words
- 10-26 non-space characters total
- Style: action-oriented, tight
- Font weight perception: BOLD

## YOUR JOB
1. READ every piece of text you see on the template.
2. For EACH text block, identify its ZONE TYPE (headline, body, cta, tagline).
3. Count the non-space characters in the original text.
4. Write a REPLACEMENT that:
   - Is for the vehicle wrap industry and the brand above
   - Has the SAME non-space character count (±3 chars)
   - Matches the visual weight and energy of the original
   - Fits the same physical space on the template

Return ONLY valid JSON:
{
  "replacements": [
    { "original": "exact text you see", "replacement": "your new text", "position": "top/middle/bottom/button", "zone": "headline/body/cta/tagline", "originalCharCount": 18, "replacementCharCount": 19 }
  ],
  "templateDescription": "Brief description of the template design/layout"
}

## SAFETY
- No misleading claims or exaggerated guarantees
- No "guaranteed", "instant results", "no risk", "get rich"
- Keep tone professional and compliant

## EXAMPLES OF GOOD MATCHING
Original: "Stretch Beyond Limits" (18 chars) → "Premium Wrap Studio" (16 chars) ✓
Original: "Buy Now!" (6 chars) → "Get Quote" (8 chars) ✓
BAD: "Stretch Beyond Limits" (18 chars) → "Replace $1,000 Mockups With 30-Second AI Renders" (42 chars) ✗ WAY TOO LONG`;

    } else if (mode === "copy_variants") {
      // ── 🧠 COPY VARIANTS MODE — three distinct options from the marketing
      //    brain, side-by-side, for the operator to choose between. Text-only
      //    (no image read, no image bake) so it's fast and cheap. ──
      const hooksLibraryBlock = Array.isArray(hooksLibrary) && hooksLibrary.length
        ? `

## PROVEN HOOKS LIBRARY (the brand's own tested voice — write in THESE patterns)
${hooksLibrary.slice(0, 60).map((h: unknown) => `- ${String(h)}`).join("\n")}`
        : "";
      const tc = templateConstraints || {};
      prompt = `You are a direct-response copywriter for the vehicle wrap industry.

${brandContext}

Tone: ${tone}
${toneGuide[tone] || "Professional and engaging."}
Format: ${format || "Post"}

${context ? `Additional context from the user: ${context}` : ""}${toolFocusText}${hookBlock}${hooksLibraryBlock}

## YOUR JOB
Write THREE DISTINCT, complete copy variants for the same post. Each variant is a different ANGLE:
1. "Pain-aware" — lead with the customer's frustration or cost.
2. "Proof & numbers" — lead with a specific number, result, or comparison.
3. "Curiosity" — lead with a pattern-break or question that stops the scroll.
All three must be in the brand's voice, modeled on the hooks library patterns above.

## CHARACTER LIMITS (each variant)
HOOK: max ${tc.hook?.charRange?.[1] || 38} non-space chars, punchy.
HEADLINE: max ${tc.headline?.charRange?.[1] || 50} non-space chars.
BODY: max ${tc.body?.charRange?.[1] || 160} non-space chars, 1-3 sentences.
CTA: max ${tc.cta?.charRange?.[1] || 26} non-space chars, one verb.

## SAFETY
No "guaranteed", "instant results", "no risk". Professional and compliant.

Return ONLY valid JSON:
{"variants":[{"angle":"Pain-aware","hook":"...","headline":"...","body":"...","cta":"..."},{"angle":"Proof & numbers","hook":"...","headline":"...","body":"...","cta":"..."},{"angle":"Curiosity","hook":"...","headline":"...","body":"...","cta":"..."}]}`;
    } else {
      // ── STANDARD IMAGE-TO-COPY MODE ──
      const formatGuide: Record<string, string> = {
        Post: "Instagram/Facebook post. Hook should be 5-10 words max. Body 1-2 short sentences.",
        Reel: "Short-form vertical video cover. Hook must be punchy, 3-7 words. Body is a single tagline.",
        Story: "Instagram Story. Hook 3-6 words, ultra-punchy. Body is one line max.",
        Carousel: "Instagram carousel slide. Hook for the first slide, body for supporting slides. Keep each piece short.",
        "YouTube Thumbnail": "YouTube thumbnail text. Hook is 3-5 words MAX. No body needed, just hook + CTA.",
        Ad: "Paid ad. Hook must stop the scroll. Body is the value prop in 1-2 lines. CTA must drive action.",
      };

      // Build character constraint instructions from templateConstraints if provided
      const constraintBlock = templateConstraints ? `

## CHARACTER CONSTRAINTS (CRITICAL — text must fit visual template zones)

HOOK:
- Max ${templateConstraints.hook?.maxLines || 2} lines
- ${templateConstraints.hook?.charRange?.[0] || 15}-${templateConstraints.hook?.charRange?.[1] || 38} characters (excluding spaces)
- ${templateConstraints.hook?.wordsPerLine?.[0] || 2}-${templateConstraints.hook?.wordsPerLine?.[1] || 5} words per line
- Style: short, punchy, bold typography weight

HEADLINE:
- Max ${templateConstraints.headline?.maxLines || 2} lines
- ${templateConstraints.headline?.charRange?.[0] || 18}-${templateConstraints.headline?.charRange?.[1] || 50} characters (excluding spaces)
- ${templateConstraints.headline?.wordsPerLine?.[0] || 2}-${templateConstraints.headline?.wordsPerLine?.[1] || 6} words per line
- Style: bold, high-impact, confident

BODY:
- Max ${templateConstraints.body?.maxLines || 4} lines
- ${templateConstraints.body?.charRange?.[0] || 40}-${templateConstraints.body?.charRange?.[1] || 160} characters (excluding spaces)
- Style: clear, professional, descriptive

CTA:
- 1 line only
- ${templateConstraints.cta?.charRange?.[0] || 10}-${templateConstraints.cta?.charRange?.[1] || 26} characters (excluding spaces)
- Style: action-oriented, tight, bold

If text is too long → compress. If too short → expand slightly. If uneven → rebalance words across lines.
Do NOT exceed these constraints. Text that overflows breaks the template layout.` : `

## CHARACTER CONSTRAINTS (text must fit social media template zones)

HOOK: Max 2 lines, 15-38 non-space characters. Short, punchy, bold.
HEADLINE: Max 2 lines, 18-50 non-space characters. Bold, high-impact.
BODY: Max 4 lines, 40-160 non-space characters. Clear, professional.
CTA: 1 line, 10-26 non-space characters. Action-oriented.

If too long → compress. If too short → expand slightly.`;

      // Image-aware vs text-only prompt. When the user has loaded a render
      // (or has a template on canvas) we get a reference image and Claude
      // grounds the copy in what it sees. When neither is loaded, we still
      // produce tool-aware, hook-aware copy so the Generate button never
      // falls through to a dumb local random-pick library.
      const hasReferenceImage = !!(imageUrl || imageData);
      const writeInstruction = hasReferenceImage
        ? `Based on what you SEE in the image (the vehicle, the wrap design, colors, finish, style), write:

1. HOOK — The scroll-stopping first line. Must reference what's in the image. Must feel visually balanced when rendered in bold typography. Must follow the HOOK DISCIPLINE above.
2. HEADLINE — A bold statement that supports the hook. Short, punchy phrases that match bold, high-impact typography.
3. BODY — 1-3 sentences of supporting copy. Specific to what you see. Must fit within the character constraints.
4. CTA — Call to action. Brand-appropriate. Tight and action-oriented.`
        : `No reference image was provided. Use the user-provided context, tool focus, and hook discipline to write:

1. HOOK — The scroll-stopping first line. Must follow the HOOK DISCIPLINE above (pain-aware by default — lead with the customer's frustration, not the feature).
2. HEADLINE — A bold statement that supports the hook. Short, punchy phrases that match bold, high-impact typography.
3. BODY — 1-3 sentences of supporting copy. Speak to the focused tool's specific selling points. Must fit within the character constraints.
4. CTA — Call to action. Brand-appropriate. Tight and action-oriented. One verb.`;

      const lookAtImageLine = hasReferenceImage
        ? "Look at this image of a vehicle wrap and write social media copy for it."
        : "Write social media copy for the focused tool below — no reference image provided, so ground the copy in the tool's selling points and the hook discipline.";

      const jsonShape = hasReferenceImage
        ? `Return ONLY valid JSON:
{
  "hook": "...",
  "headline": "...",
  "body": "...",
  "cta": "...",
  "imageDescription": "Brief description of what you see in the image (vehicle, color, style)"
}`
        : `Return ONLY valid JSON:
{
  "hook": "...",
  "headline": "...",
  "body": "...",
  "cta": "..."
}`;

      prompt = `You are a direct-response social media copywriter for the vehicle wrap industry.

${brandContext}

${lookAtImageLine}

Format: ${format}
${formatGuide[format] || "Standard social media post."}

Tone: ${tone}
${toneGuide[tone] || "Professional and engaging."}

${context ? `Additional context from the user: ${context}` : ""}${toolFocusText}${hookBlock}
${constraintBlock}

## SAFETY RULES
- No misleading claims or exaggerated guarantees
- No "guaranteed", "instant results", "no risk"
- Keep tone professional and compliant

${writeInstruction}

${jsonShape}`;
    }

    // Build the image part
    const imageParts: any[] = [{ text: prompt }];

    if (imageData) {
      // Base64 inline data
      let mimeType = "image/png";
      let base64 = imageData;
      if (imageData.startsWith("data:")) {
        const m = imageData.match(/^data:([^;]+);base64,(.+)$/);
        if (m) {
          mimeType = m[1];
          base64 = m[2];
        }
      }
      imageParts.push({ inlineData: { mimeType, data: base64 } });
    } else if (imageUrl) {
      // Fetch the image and send as inline data
      const imgRes = await fetch(imageUrl, {
        signal: AbortSignal.timeout(25_000),
      });
      if (!imgRes.ok)
        throw new Error(`Failed to fetch image: ${imgRes.status}`);
      const imgBuf = await imgRes.arrayBuffer();
      const base64 = bufferToBase64(imgBuf);
      const ct = imgRes.headers.get("content-type") || "image/png";
      imageParts.push({ inlineData: { mimeType: ct, data: base64 } });
    }

    const focusToolsLog = Array.isArray(focusTools) && focusTools.length > 0
      ? focusTools.join(",")
      : (focusTool || "all");
    console.log(
      `[content-studio-ai-copy] brand=${brand} format=${format} tone=${tone} hookType=${hookType || "pain_aware"} focusTools=${focusToolsLog} hasImage=${!!(imageUrl || imageData)} brain=openai-gpt-4o`
    );

    // ── Call Claude Sonnet 4.6 for copy generation ─────────────────────────
    // Convert the Gemini-style imageParts (text + inlineData) to the Anthropic
    // Messages API content-block format. The system prompt carries the
    // content-lead discipline (story arcs, USPs, film metadata rules) and is
    // cache_control=ephemeral so repeat calls hit the cache for ~10% cost.
    const systemPrompt = await buildSystemPrompt(brand);
    const claudeContent: any[] = [];
    for (const part of imageParts) {
      if (part.text) {
        claudeContent.push({ type: "text", text: part.text });
      } else if (part.inlineData) {
        claudeContent.push({
          type: "image",
          source: {
            type: "base64",
            media_type: part.inlineData.mimeType,
            data: part.inlineData.data,
          },
        });
      }
    }

    // Convert the Anthropic-style content blocks to OpenAI chat format:
    //   {type:"text",text}                         -> {type:"text",text}
    //   {type:"image",source:{base64,media_type}}  -> {type:"image_url",image_url:{url:data-uri}}
    const openaiContent = claudeContent
      .map((b: any) => {
        if (b.type === "text") return { type: "text", text: b.text };
        if (b.type === "image" && b.source?.type === "base64") {
          return {
            type: "image_url",
            image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
          };
        }
        return null;
      })
      .filter(Boolean);

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 2048,
        temperature: 0.7,
        // Force valid JSON — the raw-text mode intermittently returned prose
        // (a refusal, an image description) which failed the regex parse and
        // 422'd the whole render ("Render failed: non-2xx"). Both prompts
        // already demand a JSON object, which json_object mode requires.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: openaiContent },
        ],
      }),
      // Text gen typically 3-10s. Cap at 45s so the client invoke
      // call never hits its own 60s cutoff silently.
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", response.status, errorText.slice(0, 400));
      throw new Error(`OpenAI API returned ${response.status}: ${errorText.slice(0, 300)}`);
    }

    const data = await response.json();
    const aiText = data.choices?.[0]?.message?.content || "";

    // Parse JSON from response (handle markdown code blocks)
    let parsed;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      parsed = null;
    }

    if (!parsed) {
      // rewrite_template_image with prepared copy: the zone-read is only a
      // nice-to-have (it maps copy onto the template's exact original
      // strings). If it fails, DON'T kill the render — build the replacement
      // set straight from the user's refined sidebar copy and let the image
      // editor swap by zone instead of by exact original text.
      const fc = (freshCopy || {}) as Record<string, string>;
      const hasFresh = !!(fc.hook || fc.headline || fc.body || fc.cta);
      if (mode === "rewrite_template_image" && hasFresh) {
        console.warn("[content-studio-ai-copy] zone-read returned non-JSON — falling back to freshCopy zone map");
        parsed = {
          replacements: [
            fc.hook ? { original: "", replacement: fc.hook, position: "top", zone: "headline" } : null,
            fc.headline ? { original: "", replacement: fc.headline, position: "upper-middle", zone: "subheadline" } : null,
            fc.body ? { original: "", replacement: fc.body, position: "middle", zone: "body" } : null,
            fc.cta ? { original: "", replacement: fc.cta, position: "button", zone: "cta" } : null,
          ].filter(Boolean),
          templateDescription: "zone-read fallback — replacements built from user copy",
          zoneReadFallback: true,
        };
      } else {
        return new Response(
          JSON.stringify({
            error: "AI returned non-JSON response",
            raw: aiText,
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── SERVER-SIDE SAFETY FILTER ──
    // Strip banned phrases from all text fields before returning
    const bannedPhrases = ["guaranteed", "instant results", "no risk", "get rich", "100% free",
      "act now or", "you won't believe", "doctors hate", "one weird trick", "miracle"];

    const sanitizeText = (text: string): string => {
      if (!text) return text;
      let clean = text;
      for (const phrase of bannedPhrases) {
        const re = new RegExp(phrase, "gi");
        clean = clean.replace(re, "").replace(/\s{2,}/g, " ").trim();
      }
      return clean;
    };

    // Apply safety filter to standard copy fields
    if (parsed.hook) parsed.hook = sanitizeText(parsed.hook);
    if (parsed.headline) parsed.headline = sanitizeText(parsed.headline);
    if (parsed.body) parsed.body = sanitizeText(parsed.body);
    if (parsed.cta) parsed.cta = sanitizeText(parsed.cta);

    // Apply safety filter to template replacements
    if (Array.isArray(parsed.replacements)) {
      parsed.replacements = parsed.replacements.map((r: any) => ({
        ...r,
        replacement: sanitizeText(r.replacement || ""),
      }));
    }

    // Apply safety filter to copy variants (🧠 chooser mode)
    if (Array.isArray(parsed.variants)) {
      parsed.variants = parsed.variants.map((v: any) => ({
        ...v,
        hook: sanitizeText(v.hook || ""),
        headline: sanitizeText(v.headline || ""),
        body: sanitizeText(v.body || ""),
        cta: sanitizeText(v.cta || ""),
      }));
    }

    // ── STEP 2 (rewrite_template_image only): bake the replacements onto the image ──
    if (mode === "rewrite_template_image" && Array.isArray(parsed.replacements) && parsed.replacements.length > 0) {
      try {
        // STYLE reference — the Canva template image bytes we already have in imageParts[1].inlineData
        const styleInline = imageParts[1]?.inlineData;
        if (!styleInline) throw new Error("Style reference image data missing");

        // HERO subject — the user's render/design from RestylePro tools (optional).
        // When provided, the new template features this render as the hero subject in
        // the style of the Canva template. When omitted, falls back to a text-only
        // edit (preserve the template, swap the text only).
        let heroInline: { mimeType: string; data: string } | null = null;
        if (heroImageData) {
          let hMime = "image/png";
          let hB64 = heroImageData as string;
          if (hB64.startsWith("data:")) {
            const m = hB64.match(/^data:([^;]+);base64,(.+)$/);
            if (m) {
              hMime = m[1];
              hB64 = m[2];
            }
          }
          heroInline = { mimeType: hMime, data: hB64 };
        } else if (heroImageUrl) {
          try {
            const heroRes = await fetch(heroImageUrl, {
              signal: AbortSignal.timeout(25_000),
            });
            if (heroRes.ok) {
              const heroBuf = await heroRes.arrayBuffer();
              const heroB64 = bufferToBase64(heroBuf);
              const heroCt = heroRes.headers.get("content-type") || "image/png";
              heroInline = { mimeType: heroCt, data: heroB64 };
            } else {
              console.warn(`Hero image fetch failed (${heroRes.status}) — falling back to text-only edit`);
            }
          } catch (heroErr) {
            console.warn("Hero image fetch error — falling back to text-only edit:", (heroErr as Error).message);
          }
        }

        const brandLabel =
          brand === "WePrintWraps"
            ? "WePrintWraps — a professional vehicle wrap installation shop"
            : "RestyleProAI — an AI-powered vehicle wrap design SaaS platform";

        const replacementsBlock = parsed.replacements
          .map((r: any, i: number) => `${i + 1}. ${(r.zone || "text").toUpperCase()} ZONE (${r.position || "auto"}): "${r.replacement}"`)
          .join("\n");

        // FROM → TO map so the model swaps each text string in place,
        // keeping the original font, size, weight, casing, color and position.
        // Fallback replacements (zone-read failed) carry no `original` string —
        // instruct by zone instead so the render still works.
        const fromToBlock = parsed.replacements
          .map((r: any, i: number) => r.original
            ? `${i + 1}. ${(r.zone || "text").toUpperCase()} (${r.position || "auto"}): replace "${r.original}" with "${r.replacement}"`
            : `${i + 1}. ${(r.zone || "text").toUpperCase()} (${r.position || "auto"}): replace the template's existing ${(r.zone || "text")} text with "${r.replacement}"`)
          .join("\n");

        const editInstruction = heroInline
          ? `You are EDITING this exact social media template (IMAGE 1) for ${brandLabel}. Keep the template itself — do NOT redesign it, do NOT move things around, do NOT change the fonts.

You are given TWO images:
- IMAGE 1 = THE TEMPLATE. Keep its EXACT layout, composition, fonts, type sizes, text positions, alignment, colors, background, shapes, and CTA button. This is the design you are editing in place.
- IMAGE 2 = HERO PHOTO (the user's actual vehicle wrap render from their RestylePro tools). This replaces ONLY the main photo/subject area of IMAGE 1.

## MAKE EXACTLY TWO KINDS OF CHANGES — NOTHING ELSE

### 1. SWAP THE PHOTO SUBJECT
- Find the main photograph/subject in IMAGE 1 (e.g. the person, product, or stock photo) and replace it with IMAGE 2.
- Fit IMAGE 2 into the SAME photo area, same crop window, same framing and overlays/gradients the template already uses.
- Do NOT redraw, recolor, or restyle the vehicle or wrap in IMAGE 2 — drop it in as-is, like a designer placing a photo into the existing layout.
- Keep only ONE subject — the vehicle from IMAGE 2. Remove the original subject entirely.
- If IMAGE 1 has ADDITIONAL smaller photo slots or thumbnails, either fill each with a DIFFERENT crop/angle of IMAGE 2 (close-up, detail shot) or remove the slot cleanly — NEVER leave the original stock photo, and NEVER paste the identical uncropped IMAGE 2 twice at different sizes.

### 2. SWAP THE TEXT (same font, same size, same place)
For each item below, replace the original text string with the new one IN PLACE, keeping the SAME font family, weight, casing, color, size, and position as the original text on IMAGE 1:
${fromToBlock}

### 3. SWEEP UP EVERY OTHER TEXT
The list above may not cover every text on IMAGE 1. Any remaining original text — small side labels, category tags (e.g. "/FITNESS/", "/YOGA/"), section markers, taglines, watermarks, handles — MUST be either removed cleanly or replaced with a vehicle-wrap-industry equivalent in the same style. The finished image may contain ZERO words from the original template's industry.

## DO NOT
- Do NOT change the fonts, type sizes, or where text sits.
- Do NOT change the layout, background, colors, shapes, or CTA button styling.
- Do NOT add watermarks, logos, or any text that isn't listed above.
- Do NOT leave ANY of the original template's text behind — including tiny labels and vertical/side text.

## OUTPUT
- The SAME template, same aspect ratio and resolution as IMAGE 1, with only the photo subject and the text swapped as instructed. Production-ready, ready to post.`
          : `You are editing this social media template image for ${brandLabel}. Replace ONLY the existing text on the image — do not change the background, layout, photography, colors, fonts, or graphic elements.

Replacements (replace each "FROM" text with the corresponding "TO" text, preserving the original font style, size, color, and position):
${parsed.replacements.map((r: any, i: number) => r.original
  ? `${i + 1}. FROM: "${r.original}" → TO: "${r.replacement}" (position: ${r.position || "unknown"})`
  : `${i + 1}. Replace the template's existing ${(r.zone || "text")} text with: "${r.replacement}" (position: ${r.position || "unknown"})`).join("\n")}

SWEEP UP EVERY OTHER TEXT: the list above may not cover every text on the
template. Any remaining original text — small side labels, category tags
(e.g. "/FITNESS/", "/YOGA/"), section markers, taglines, watermarks,
handles — MUST be removed cleanly or replaced with a vehicle-wrap-industry
equivalent in the same style. The finished image may contain ZERO words from
the original template's industry.

CRITICAL RULES:
- Keep every visual element identical except the text content — photos and graphics stay EXACTLY as they are
- Match the original font weight, color, casing, and alignment for each replaced text block
- Do not add any new text, watermarks, or logos
- Output the edited image at the same aspect ratio and resolution as the input`;

        const parts: any[] = [{ text: editInstruction }, { inlineData: styleInline }];
        if (heroInline) parts.push({ inlineData: heroInline });

        // Image edit/compose runs on gemini-3-pro-image-preview — the SAME
        // model every working render function uses. The previous
        // gemini-2.5-flash-image-preview model is deprecated and was silently
        // returning errors, so the bake never produced a PNG and the canvas
        // kept showing the original template. responseModalities MUST be
        // ["TEXT", "IMAGE"] — ["IMAGE"] alone causes NO_IMAGE responses.
        const IMAGE_MODEL = "gemini-3-pro-image-preview";
        const MAX_EDIT_ATTEMPTS = 2;
        let baked = false;

        // Lock the output to the template's own shape — without an explicit
        // aspectRatio Gemini defaults to 16:9, which turned 4:5/1:1 templates
        // widescreen (live 2026-07-28 "only showing 16:9").
        const ALLOWED_ASPECTS = new Set(["1:1", "4:5", "5:4", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "21:9"]);
        const aspect = typeof templateAspect === "string" && ALLOWED_ASPECTS.has(templateAspect) ? templateAspect : null;

        for (let attempt = 1; attempt <= MAX_EDIT_ATTEMPTS && !baked; attempt++) {
          let editRes: Response;
          try {
            editRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${getGeminiKey()}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts }],
                  generationConfig: {
                    responseModalities: ["TEXT", "IMAGE"],
                    ...(aspect ? { imageConfig: { aspectRatio: aspect } } : {}),
                  },
                }),
                // Image-edit can legitimately take 30-60s. Hard-cap at 90s so
                // it fails with a real error instead of the invoke call silently
                // timing out at ~60s with no diagnostics.
                signal: AbortSignal.timeout(90_000),
              }
            );
          } catch (fetchErr: any) {
            const isTimeout = fetchErr?.name === "TimeoutError" || fetchErr?.name === "AbortError";
            console.error(`Gemini image-edit fetch ${isTimeout ? "timed out" : "failed"} (attempt ${attempt}/${MAX_EDIT_ATTEMPTS}):`, fetchErr?.message);
            parsed.imageEditError = isTimeout ? "Image editor timed out" : "Image editor network error";
            if (attempt < MAX_EDIT_ATTEMPTS) { await new Promise(r => setTimeout(r, 2000)); continue; }
            break;
          }

          if (!editRes.ok) {
            const errText = await editRes.text();
            console.error(`Gemini image-edit HTTP error (attempt ${attempt}/${MAX_EDIT_ATTEMPTS}):`, editRes.status, errText.slice(0, 400));
            parsed.imageEditError = `Image editor returned ${editRes.status}`;
            // Retry transient rate-limit / server errors with the next pool key.
            if (attempt < MAX_EDIT_ATTEMPTS && (editRes.status === 429 || editRes.status >= 500)) {
              await new Promise(r => setTimeout(r, 2000));
              continue;
            }
            break;
          }

          const editJson = await editRes.json();
          const finishReason = editJson.candidates?.[0]?.finishReason;
          const editParts = editJson.candidates?.[0]?.content?.parts || [];
          const imgPart = editParts.find((p: any) => p.inlineData?.data);
          if (imgPart?.inlineData?.data) {
            parsed.editedImageBase64 = imgPart.inlineData.data;
            parsed.editedImageMimeType = imgPart.inlineData.mimeType || "image/png";
            delete parsed.imageEditError;
            baked = true;
          } else {
            // NO_IMAGE means the model returned text instead of an image —
            // retry once before giving up.
            console.warn(`Gemini image-edit returned no image (finishReason=${finishReason}, attempt ${attempt}/${MAX_EDIT_ATTEMPTS})`);
            parsed.imageEditError = "Image editor returned no image";
            if (attempt < MAX_EDIT_ATTEMPTS) { await new Promise(r => setTimeout(r, 1500)); continue; }
          }
        }
      } catch (editErr: any) {
        console.error("Image edit step failed:", editErr.message);
        parsed.imageEditError = editErr.message;
      }
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[content-studio-ai-copy] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
