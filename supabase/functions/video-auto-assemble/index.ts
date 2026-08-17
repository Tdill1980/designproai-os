// Ported from WrapCommandAI ai-auto-create-reel (2026-07) — RestylePro-native video pipeline.
// PORT-NOTES:
// - Env: GEMINI_API_KEY → GOOGLE_AI_API_KEY (RestylePro convention). Also reads
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-provided to edge functions).
// - Media table: content_files → agent_media_assets. Column mapping applied:
//   file_url → storage_url, file_type → asset_type. Kept-as-is column names this
//   function selects/filters on that are NOT in the base agent_media_assets table
//   (migration must add them): original_filename, duration_seconds, tags (text[]),
//   thumbnail_url, ai_labels (jsonb), metadata (jsonb), content_category (text),
//   visual_tags (jsonb), organization_id (uuid, used as an optional filter).
//   (id / storage_url / asset_type / created_at already exist.)
// - Response shape: selected_videos[].file_url renamed → storage_url (single-video
//   mode and library mode both). Downstream renderer/UI must read storage_url.
// - STRIPPED: mux_playback_id select (Mux is WrapCommand-only; not part of the
//   RestylePro ffmpeg render path — the source itself no longer required it).
// - KEPT with graceful degradation (queries fail soft → empty results) three
//   auxiliary tables that need migrations if their features are wanted:
//     * media_tags (asset_id, tag, locked, source) — deterministic tag filtering.
//     * media_analysis (asset_id, ...) — per-asset analysis bonus scoring.
//     * caption_library (wrap_type_category, pain_type, audience, intensity,
//       hook text[], agitate text[], resolve text[], cta) — deterministic
//       caption_text selection. Without these tables the function still works;
//       caption_text is null and tag filtering falls back to AI selection.
// - Gemini endpoint/model kept EXACTLY as source: OpenAI-compat chat completions
//   endpoint, model gemini-2.5-flash.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AI_KEY = Deno.env.get("GOOGLE_AI_API_KEY")!;

interface InspoStyle {
  font_style: string;
  font_weight: string;
  text_color: string;
  text_shadow: boolean;
  text_position: string;
  background_style: string;
  accent_color: string;
  text_animation: string;
  hook_format: string;
  emoji_usage: boolean;
}

// Dara Denney Format Configurations
const DARA_FORMAT_PROMPTS: Record<string, string> = {
  grid_style: `
FORMAT: 📊 GRID STYLE AD
- Psychology: Completes subconscious loop - eyes trail left-to-right, top-to-bottom
- Select 4 product shots that work in a 2x2 grid
- Overlay: Value-based messaging OR specific routine/outcome
- Example hooks: "The perfect set", "All you need", "Mix & match"
- Clip duration: 2-3s each, total 8-12s`,

  egc_warehouse: `
FORMAT: 📦 EGC WAREHOUSE CONTENT
- Psychology: Employee-generated content builds authenticity
- Show behind-the-scenes: packing, workspace, production
- POV shots work great
- Example hooks: "POV:", "Day in the life", "Watch me pack"
- Clip duration: 3-5s each, raw authentic energy`,

  founders_objection: `
FORMAT: 💬 FOUNDERS + OBJECTION HANDLER
- Psychology: Founder credibility + addressing anxiety = trust
- Structure: Lo-fi founder video handling common objection
- Address: price, quality, timeline objections directly
- Example hooks: "Is it worth it?", "Why so expensive?", "Does this work?"
- One longer clip, 15-30s, authentic energy`,

  creator_testimonial: `
FORMAT: ⭐ CREATOR TESTIMONIAL
- Psychology: Social proof from real people. Single > compilations
- Structure: One creator giving authentic testimonial
- Use reaction opening hooks
- Trigger words: "this", "look", "watch"
- Example hooks: "I can't believe...", "This changed...", "Watch what happens"
- One clip, 15-45s`,

  text_heavy: `
FORMAT: 📝 TEXT HEAVY AD
- Psychology: Text creates curiosity gaps. Crushes during sales
- Bold text overlays drive narrative, video supports
- Example hooks: "3 things you need", "Don't miss this", "The truth about"
- Clip duration: 2-3s each, 4 clips total
- TEXT IS THE STAR - video is background`,

  negative_marketing: `
FORMAT: 😬 NEGATIVE MARKETING
- Psychology: Negative emotions are powerful triggers
- Use trigger words: regret, embarrassed, hate
- 1-star review style or negative hook that flips positive
- Example hooks: "I regret...", "Don't make this mistake", "I was so embarrassed"
- 3 clips, 3-5s each`,

  ugly_ads: `
FORMAT: 📱 UGLY ADS / LO-FI
- Psychology: Authenticity > polish. Meta recommends this for Reels
- Raw, unpolished: post-it notes, one-take videos, POV shots
- Think: how would you explain this to a friend?
- Example hooks: "POV:", "Okay so", "Real talk"
- One clip, 10-30s, ZERO polish`,

  brandformance: `
FORMAT: 🚀 BRANDFORMANCE
- Psychology: Organic content that works gets amplified
- Select content that feels organic/authentic
- Don't over-edit - keep the original energy
- Example hooks: "Y'all loved this", "This went viral", "Had to share"
- One clip, 15-60s`
};

// ═══════════════════════════════════════════════════════════════
// STYLE-TO-TAG RULES - Determines which clips match each format
// ═══════════════════════════════════════════════════════════════
const STYLE_TAG_RULES: Record<string, {
  mustHaveAny: string[];
  mustNotHave: string[];
  preferredTags: string[];
}> = {
  ugly_ads: {
    mustHaveAny: [
      "ugly_ads", "lo_fi", "raw", "behind_the_scenes", "authentic",
      "handheld", "phone_video", "unpolished", "imperfect", "no_color_grade", "amateur"
    ],
    mustNotHave: ["studio", "cinematic", "polished", "professional", "color_graded"],
    preferredTags: ["shop_environment", "garage", "process", "installation"],
  },
  grid_style: {
    mustHaveAny: [
      "grid_style", "clean", "polished", "studio", "cinematic",
      "professional", "color_graded", "studio_light"
    ],
    mustNotHave: ["ugly_ads", "lo_fi", "raw", "handheld", "shaky", "unpolished", "amateur"],
    preferredTags: ["high_resolution", "hero_shot", "product_focus"],
  },
  creator_testimonial: {
    mustHaveAny: ["testimonial", "talking_head", "face_cam"],
    mustNotHave: [],
    preferredTags: ["good_audio", "close_up", "medium_shot"],
  },
  negative_marketing: {
    mustHaveAny: ["negative_marketing", "harsh", "aggressive", "raw", "ugly_ads"],
    mustNotHave: [],
    preferredTags: ["high_contrast", "handheld"],
  },
  egc_warehouse: {
    mustHaveAny: [
      "behind_the_scenes", "shop_environment", "garage", "process",
      "handheld", "pov", "authentic", "raw"
    ],
    mustNotHave: ["studio", "polished"],
    preferredTags: ["installation", "motion"],
  },
  founders_objection: {
    mustHaveAny: ["talking_head", "face_cam", "lo_fi", "raw", "authentic"],
    mustNotHave: ["studio", "cinematic"],
    preferredTags: ["good_audio"],
  },
  text_heavy: {
    mustHaveAny: [], // Any clips work for text-heavy
    mustNotHave: [],
    preferredTags: ["b_roll", "motion", "vehicle"],
  },
  brandformance: {
    mustHaveAny: ["authentic", "raw", "b_roll", "process"],
    mustNotHave: [],
    preferredTags: ["motion", "vehicle", "wrap"],
  },
};

// Filter clips by style tags
function filterByStyleTags(videos: any[], format: string): any[] {
  const rules = STYLE_TAG_RULES[format];
  if (!rules || rules.mustHaveAny.length === 0) {
    return videos; // No filter for this format
  }

  return videos.filter(v => {
    const clipTags = v.tags || [];

    // Must have at least one required tag
    const hasRequired = rules.mustHaveAny.some(tag => clipTags.includes(tag));
    if (!hasRequired) return false;

    // Must NOT have any excluded tags
    const hasExcluded = rules.mustNotHave.some(tag => clipTags.includes(tag));
    if (hasExcluded) return false;

    return true;
  });
}

// Score clips by style match
function scoreByStyleMatch(video: any, format: string): number {
  const rules = STYLE_TAG_RULES[format];
  if (!rules) return 0;

  const clipTags = video.tags || [];
  let score = 0;

  // Count matching required tags
  score += rules.mustHaveAny.filter(t => clipTags.includes(t)).length * 2;

  // Count matching preferred tags
  score += (rules.preferredTags || []).filter(t => clipTags.includes(t)).length;

  return score;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, filter_category, max_videos, use_inspo, dara_format, video_url, video_duration, topic, content_type } = await req.json();

    // ═══════════════════════════════════════════════════════════════
    // SINGLE VIDEO AUTO-EDIT MODE
    // If video_url is provided, analyze that ONE video and find best scenes
    // ═══════════════════════════════════════════════════════════════
    if (video_url) {
      console.log("Single video mode - analyzing:", video_url);

      const formatPrompt = dara_format && DARA_FORMAT_PROMPTS[dara_format]
        ? DARA_FORMAT_PROMPTS[dara_format]
        : "";

      const singleVideoPrompt = `You are Dara Denney, the world's best performance creative strategist.

${formatPrompt ? `SELECTED FORMAT:\n${formatPrompt}\n` : ''}

You are analyzing a SINGLE video to find the BEST CONVERTING MOMENTS for a viral reel.

VIDEO DURATION: ${video_duration || 60} seconds

YOUR TASK:
1. Identify 3-5 KEY MOMENTS in this video that would make scroll-stopping content
2. For each moment, specify exact timestamps (start/end in seconds)
3. Prioritize: reveals, transformations, satisfying moments, action shots, before/after

SCENE DETECTION STRATEGY:
- Look for visual transitions, movement changes, key actions
- Hook moment should be in first 10 seconds of source
- Find the "money shot" - the most visually impressive moment
- Find B-roll/filler that supports the story
- End with a satisfying conclusion or call-to-action moment

Return JSON with scene cuts from THIS video:
{
  "selected_videos": [
    {
      "id": "scene_1",
      "order": 1,
      "trim_start": 0,
      "trim_end": 3,
      "reason": "Strong opening hook",
      "suggested_overlay": "Watch this",
      "scene_type": "hook"
    },
    {
      "id": "scene_2",
      "order": 2,
      "trim_start": 15,
      "trim_end": 20,
      "reason": "The transformation/reveal",
      "suggested_overlay": "The reveal",
      "scene_type": "payoff"
    }
  ],
  "reel_concept": "One sentence concept",
  "suggested_hook": "MAX 12 chars",
  "suggested_cta": "Follow for more",
  "music_vibe": "upbeat_energy",
  "estimated_virality": 85
}

RULES:
- Each scene is 2-5 seconds MAX
- Total reel = 12-20 seconds
- Hook overlay: MAX 12 characters
- Other overlays: MAX 15 characters
- Truncate at WORD boundaries, never mid-word`;

      // Call AI to analyze the single video
      const aiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AI_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [
            { role: "system", content: singleVideoPrompt },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Analyze this video and identify the best 3-5 scenes for a viral reel. The video is ${video_duration || 60} seconds long. Find the most converting, scroll-stopping moments.`
                },
                {
                  type: "image_url",
                  image_url: { url: video_url }
                }
              ]
            }
          ],
        }),
      });

      if (!aiRes.ok) {
        const errorText = await aiRes.text();
        console.error("AI analysis failed:", errorText);

        // Fallback: create default scene cuts if AI vision fails
        const duration = video_duration || 60;
        const defaultScenes = [
          { id: "scene_1", order: 1, trim_start: 0, trim_end: 3, reason: "Opening hook", suggested_overlay: "Watch this", scene_type: "hook" },
          { id: "scene_2", order: 2, trim_start: Math.floor(duration * 0.3), trim_end: Math.floor(duration * 0.3) + 4, reason: "Build-up", suggested_overlay: "The process", scene_type: "value" },
          { id: "scene_3", order: 3, trim_start: Math.floor(duration * 0.7), trim_end: Math.floor(duration * 0.7) + 5, reason: "The reveal", suggested_overlay: "The reveal", scene_type: "payoff" },
          { id: "scene_4", order: 4, trim_start: Math.max(0, duration - 5), trim_end: duration, reason: "Final result", suggested_overlay: "Follow", scene_type: "cta" },
        ];

        return new Response(JSON.stringify({
          selected_videos: defaultScenes.map(s => ({ ...s, storage_url: video_url, source_video_url: video_url })),
          reel_concept: "Auto-generated reel from uploaded video",
          suggested_hook: "Watch this",
          suggested_cta: "Follow",
          music_vibe: "upbeat_energy",
          estimated_virality: 70,
          total_analyzed: 1,
          single_video_mode: true,
          source_video_url: video_url
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      const aiJson = await aiRes.json();
      const content = aiJson.choices?.[0]?.message?.content || "{}";

      let result;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        result = JSON.parse(jsonMatch?.[0] ?? "{}");
      } catch {
        console.error("Failed to parse AI response:", content);
        result = { selected_videos: [] };
      }

      // Enrich scenes with the source video URL
      const enrichedScenes = (result.selected_videos || []).map((scene: any) => ({
        ...scene,
        storage_url: video_url,
        source_video_url: video_url,
      }));

      return new Response(JSON.stringify({
        ...result,
        selected_videos: enrichedScenes,
        total_analyzed: 1,
        single_video_mode: true,
        source_video_url: video_url
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // LIBRARY MODE (existing behavior)
    // ═══════════════════════════════════════════════════════════════

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Step 1: Fetch user's inspiration files and analyze visual styles
    let inspoContext = "";
    let inspoHooks: string[] = [];
    let extractedStyle: InspoStyle | null = null;

    if (use_inspo !== false) {
      const { data: inspoFiles } = await supabase
        .from("agent_media_assets")
        .select("id, storage_url, original_filename, tags, ai_labels, metadata, asset_type")
        .or("content_category.eq.inspiration,content_category.eq.raw,tags.cs.{inspo}")
        .order("created_at", { ascending: false })
        .limit(10);

      if (inspoFiles && inspoFiles.length > 0) {
        console.log(`Found ${inspoFiles.length} inspo files to learn from`);

        // Find image inspo files to analyze visually
        const imageInspoFiles = inspoFiles.filter(f =>
          f.asset_type === 'image' ||
          f.storage_url?.match(/\.(jpg|jpeg|png|gif|webp)$/i)
        );

        // VISION ANALYSIS: Analyze actual inspo images to extract visual styles
        if (imageInspoFiles.length > 0) {
          console.log(`Analyzing ${imageInspoFiles.length} inspo images with AI vision...`);

          const imageUrls = imageInspoFiles.slice(0, 3).map(f => f.storage_url).filter(Boolean);

          if (imageUrls.length > 0) {
            try {
              const visionRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${AI_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "gemini-2.5-flash",
                  messages: [
                    {
                      role: "user",
                      content: [
                        {
                          type: "text",
                          text: `Analyze these social media content images and extract the EXACT visual style for text overlays. Return JSON ONLY with these fields:
{
  "font_style": "bold-condensed" | "script" | "sans-serif" | "impact" | "modern-thin" | "handwritten",
  "font_weight": "bold" | "black" | "regular" | "light",
  "text_color": "#HEXCODE of main text color",
  "text_shadow": true/false (if text has shadow/glow),
  "text_position": "center" | "top" | "bottom" | "split-top-bottom",
  "background_style": "none" | "solid-box" | "gradient-box" | "outline-only",
  "accent_color": "#HEXCODE of accent/highlight color",
  "text_animation": "none" | "pop-in" | "slide-up" | "scale-bounce",
  "hook_format": "all-caps" | "mixed-case" | "sentence-case",
  "emoji_usage": true/false
}

Look at: font family used, text weight, colors, shadows, positioning, any boxes behind text. Be precise about hex colors.`
                        },
                        ...imageUrls.map(url => ({
                          type: "image_url",
                          image_url: { url }
                        }))
                      ]
                    }
                  ],
                }),
              });

              if (visionRes.ok) {
                const visionJson = await visionRes.json();
                let styleContent = visionJson.choices?.[0]?.message?.content || "{}";

                // Strip markdown code fences if present
                styleContent = styleContent.trim();
                if (styleContent.startsWith('```')) {
                  styleContent = styleContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                }

                // Extract JSON object from response
                const jsonMatch = styleContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  try {
                    extractedStyle = JSON.parse(jsonMatch[0]);
                    console.log("Extracted inspo style:", extractedStyle);
                  } catch (parseErr) {
                    console.warn("JSON parse failed for style:", parseErr);
                  }
                }
              }
            } catch (visionErr) {
              console.warn("Vision analysis failed:", visionErr);
            }
          }
        }

        // Extract text patterns from inspo
        const inspoPatterns = inspoFiles.map(f => {
          const labels = f.ai_labels as Record<string, any> || {};
          return {
            name: f.original_filename,
            tags: f.tags || [],
            style: labels.style || labels.hook_style,
            hooks: labels.hooks || [],
          };
        });

        // Gather hook examples from inspo
        inspoFiles.forEach(f => {
          const labels = f.ai_labels as Record<string, any> || {};
          if (labels.hooks) inspoHooks.push(...labels.hooks);
          if (labels.text_overlays) {
            inspoHooks.push(...labels.text_overlays.map((o: any) => o.text || o));
          }
        });

        inspoContext = `
STYLE INSPIRATION FROM USER'S LIBRARY:
${JSON.stringify(inspoPatterns, null, 2)}

${extractedStyle ? `VISUAL STYLE EXTRACTED FROM THEIR IMAGES:
- Font: ${extractedStyle.font_style} ${extractedStyle.font_weight}
- Text Color: ${extractedStyle.text_color}
- Accent Color: ${extractedStyle.accent_color}
- Text Has Shadow: ${extractedStyle.text_shadow}
- Text Position: ${extractedStyle.text_position}
- Hook Format: ${extractedStyle.hook_format}
- Uses Emojis: ${extractedStyle.emoji_usage}

MATCH THIS STYLE EXACTLY for all overlays and hooks!` : ''}

Use these patterns for text overlays and hook style. Match the energy, pacing, and overlay text style from their inspo.
${inspoHooks.length > 0 ? `Example hooks from their inspo: ${inspoHooks.slice(0, 5).join(", ")}` : ""}
`;
      }
    }

    // Get format-specific prompt if a Dara format is selected
    const formatPrompt = dara_format && DARA_FORMAT_PROMPTS[dara_format]
      ? DARA_FORMAT_PROMPTS[dara_format]
      : "";

    // Step 2: Build dynamic system prompt based on inspo + DARA DENNEY RULES + PREMIUM POSITIONING
    const systemPrompt = `You are Dara Denney - the world's best performance creative strategist. You create scroll-stopping reels that CONVERT.

═══════════════════════════════════════════════════════════════
🏆 BRAND POSITIONING (NON-NEGOTIABLE):
═══════════════════════════════════════════════════════════════
- You are creating content for PROFESSIONAL WRAP SHOPS, not hobbyists
- Tone: Dara Denney × Ogilvy × Premium Trade Brand
- NO hype language, NO slang, NO emojis in overlays
- Hook examples: "For professional shops", "Built for installers", "Commercial grade"
- CTA examples: "Follow for pro tips", "Link for bulk pricing"
- NEVER use: "This hits different", "Wait for it", cheap urgency, countdown language
- Premium persuasion, not loud marketing

${formatPrompt ? `
═══════════════════════════════════════════════════════════════
🎬 SELECTED AD FORMAT:
═══════════════════════════════════════════════════════════════
${formatPrompt}
` : ''}

═══════════════════════════════════════════════════════════════
🎯 DARA DENNEY'S IRON RULES FOR VIRAL REELS:
═══════════════════════════════════════════════════════════════

1. HOOK = 2-4 WORDS MAX. Never more. Professional examples:
   - "For pro shops"
   - "Commercial grade"
   - "Built for scale"
   - "The standard"
   - "Professional quality"
   - "Before → After"

2. TEXT MUST FIT ON SCREEN - TRUNCATE AT WORD BOUNDARIES
   - Max 12 characters for hooks
   - Max 15 characters for other overlays
   - If text is too long, CUT WORDS not letters
   - NEVER cut a word in the middle

3. SCROLL-STOPPING STRUCTURE:
   - Clip 1 (0-3s): HOOK - create curiosity gap
   - Clip 2-3 (3-12s): PAYOFF - deliver the satisfying moment
   - Clip 4 (12-15s): CTA - "Follow for more" or "Link in bio"

4. PROFESSIONAL ENERGY, NOT UGC CHAOS:
   - Clean, competent clips
   - Quick cuts (2-5 sec each)
   - No amateur vibes

5. PATTERN INTERRUPT:
   - Start mid-action
   - Show the reveal FAST
   - Don't make them wait

═══════════════════════════════════════════════════════════════
TOPIC MATCHING (CRITICAL - RELEVANCE FIRST):
═══════════════════════════════════════════════════════════════
${topic ? `
THE TOPIC/DIRECTIVE IS: "${topic}"
- You MUST select clips that are relevant to this topic
- If a clip's tags, filename, or content don't match the topic, SKIP IT
- Prefer clips with tags that match keywords from the topic
- If you cannot find at least 3 relevant clips, return an error message
` : '- No specific topic provided, select best general content'}

═══════════════════════════════════════════════════════════════
CRITICAL RULES:
- NEVER select the same video twice
- NEVER select duplicate IDs
- Each video ID must be UNIQUE in your selection
- If a video has already been used or looks edited, skip it

${inspoContext}

Given a list of videos with metadata (filename, duration, tags, category), you must:
1. Select 3-5 DIFFERENT videos that would make an ENGAGING, VIRAL reel when combined
2. Prioritize: install reveals, satisfying peels, before/after, POV shots, transformations
3. Avoid videos with "edited", "reel", "final" in filename - prefer raw source clips
4. Order them for maximum hook → value → payoff structure
5. Suggest trim points (start/end) for each clip - aim for 2-5 seconds per clip
6. Total reel should be 12-20 seconds (shorter = better engagement)

═══════════════════════════════════════════════════════════════
TEXT OVERLAY RULES (CRITICAL - TEXT MUST FIT):
═══════════════════════════════════════════════════════════════
${extractedStyle ? `- Use ${extractedStyle.hook_format} format
- ${extractedStyle.emoji_usage ? 'Use 1 emoji max' : 'No emojis - keep it clean'}
- Position: ${extractedStyle.text_position}` : ''}

OVERLAY FORMAT - FOLLOW EXACTLY:
- Hook: MAX 12 CHARS (e.g., "Wait for it", "POV:", "Watch this")
- Value: MAX 15 CHARS (e.g., "So satisfying", "The reveal")
- CTA: MAX 15 CHARS (e.g., "Follow for more")

EXAMPLES OF GOOD SHORT HOOKS:
- "POV:"
- "Wait for it"
- "The reveal"
- "Before → After"
- "Game changer"
- "Watch this"
- "So satisfying"

${inspoHooks.length > 0 ? `Style reference from their inspo (but keep text SHORT): ${inspoHooks.slice(0, 3).join(", ")}` : ''}

Return JSON ONLY:
{
  "selected_videos": [
    {
      "id": "unique_video_id_here",
      "order": 1,
      "trim_start": 0,
      "trim_end": 4,
      "reason": "Strong hook - dramatic reveal",
      "suggested_overlay": "Wait for it"
    }
  ],
  "reel_concept": "One sentence concept",
  "suggested_hook": "2-4 words ONLY - MAX 12 CHARS",
  "suggested_cta": "Follow for more",
  "music_vibe": "upbeat_energy",
  "estimated_virality": 85,
  "inspo_style_applied": true,
  "format_used": "${dara_format || 'auto'}"
}`;

    // ═══════════════════════════════════════════════════════════════
    // VISUAL TAG SCORING + FAIL-LOUD SYSTEM
    // ═══════════════════════════════════════════════════════════════

    // Determine intent from topic/format
    function getIntent(topic = "", contentType = "") {
      const t = (topic + " " + contentType).toLowerCase();

      if (t.includes("before") || t.includes("after") || t.includes("transform") || t.includes("reveal"))
        return { want_finished: true, want_install: true, want_peel: false, want_logo: true };

      if (t.includes("install") || t.includes("process") || t.includes("how"))
        return { want_finished: false, want_install: true, want_peel: false, want_logo: false };

      if (t.includes("peel") || t.includes("satisfying"))
        return { want_finished: false, want_install: false, want_peel: true, want_logo: false };

      return { want_finished: true, want_install: true, want_peel: false, want_logo: false };
    }

    // Score video based on visual tags + intent
    function scoreVideoForTopic(v: any, intent: any) {
      const tags = v.visual_tags || {};
      let score = 0;

      // Hard disqualifiers
      if (!tags.has_vehicle) return -999;
      if ((tags.quality_score ?? 50) < 35) return -999;

      // Intent-based scoring
      if (intent.want_install && tags.has_wrap_install) score += 35;
      if (intent.want_finished && tags.has_finished_result) score += 30;
      if (intent.want_peel && tags.has_peel) score += 30;
      if (intent.want_logo && tags.has_logo) score += 15;

      // Motion bonuses
      if (tags.dominant_motion === "hand_install" || tags.dominant_motion === "peel_motion") score += 10;
      if (tags.environment === "shop") score += 5;

      // Quality bonus
      score += Math.floor((tags.quality_score || 50) / 10);

      // Topic ↔ manual tag bonus (ex: "chicago", "ghost_industries")
      // This lets you steer the picker by tagging videos in Tag Manager.
      const manualTags: string[] = Array.isArray(v.tags) ? v.tags : [];
      const topicStr = (topic || "").toLowerCase();
      if (manualTags.length && topicStr.trim()) {
        const stop = new Set([
          "the","a","an","and","or","to","for","of","in","on","at","with","from","is","are","was","were",
          "reel","short","video","clip","post","ad","ads","content","wpw","wrap","wraps","printing","print",
        ]);
        const tokens = topicStr
          .replace(/[^a-z0-9\s_\-]/g, " ")
          .split(/\s+/)
          .map((w: string) => w.trim())
          .filter((w: string) => w.length >= 3 && !stop.has(w));

        const tagSet = new Set(manualTags.map((t: string) => t.toLowerCase()));
        const matches = tokens.filter(
          (t: string) => tagSet.has(t) || tagSet.has(t.replace(/\s+/g, "_"))
        );

        // Up to +24 points to strongly bias selection toward topic-matched clips
        score += Math.min(24, matches.length * 8);
      }

      return score;
    }

    // Diversify top clips across categories
    function diversifyTop(videos: any[], count: number) {
      const buckets = { finished: [] as any[], install: [] as any[], peel: [] as any[], other: [] as any[] };

      for (const v of videos) {
        const t = v.visual_tags || {};
        if (t.has_finished_result) buckets.finished.push(v);
        else if (t.has_wrap_install) buckets.install.push(v);
        else if (t.has_peel) buckets.peel.push(v);
        else buckets.other.push(v);
      }

      const out: any[] = [];
      const order = ["finished", "install", "peel", "other"] as const;
      let idx = 0;

      while (out.length < count) {
        const bucket = buckets[order[idx % 4]];
        if (bucket.length > 0) {
          out.push(bucket.shift()!);
        }
        idx++;
        // Safety: if all buckets empty, break
        if (order.every(k => buckets[k].length === 0)) break;
      }

      return out;
    }

    // Step 3: Fetch videos from media library (with visual_tags, excluding inspo)
    // Require a playable storage_url (the ffmpeg renderer downloads clipUrl directly).
    let query = supabase
      .from("agent_media_assets")
      .select("id, storage_url, original_filename, duration_seconds, tags, content_category, thumbnail_url, created_at, visual_tags")
      .eq("asset_type", "video")
      // Exclude inspo references but KEEP rows with a NULL content_category.
      // PostgREST `.neq()` drops NULLs (NULL != x evaluates to NULL → excluded),
      // which hid every uploaded clip that was never categorized.
      .or("content_category.is.null,content_category.neq.inspo_reference")
      .not("storage_url", "is", null)
      // Exclude raw Google Drive links — browsers/ffmpeg can't play them, so a
      // reel built from one shows a black clip. Only re-hosted (storage) or
      // uploaded clips are selectable. (storage_url is non-null here, so .not is safe.)
      .not("storage_url", "ilike", "%drive.google.com%")
      .order("created_at", { ascending: false })
      .limit(max_videos || 50);

    if (organization_id) {
      query = query.eq("organization_id", organization_id);
    }

    if (filter_category && filter_category !== "all") {
      query = query.eq("content_category", filter_category);
    }

    const { data: videos, error: fetchError } = await query;

    if (fetchError) {
      console.error("Error fetching videos:", fetchError);
      throw new Error("Failed to fetch videos");
    }

    if (!videos || videos.length === 0) {
      return new Response(JSON.stringify({
        error: "No videos found in library",
        selected_videos: []
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // DETERMINISTIC TAG-BASED SELECTION
    // Fetch media_tags and media_analysis for all videos.
    // PORT-NOTE: these tables do not exist in restylepro yet (migration needed);
    // queries degrade gracefully to empty maps until they do.
    // ═══════════════════════════════════════════════════════════════
    const videoIds = videos.map(v => v.id);

    const [mediaTagsResult, mediaAnalysisResult] = await Promise.all([
      supabase.from("media_tags").select("asset_id, tag, locked, source").in("asset_id", videoIds),
      supabase.from("media_analysis").select("*").in("asset_id", videoIds),
    ]);

    // Build lookup maps
    const tagsByVideo = new Map<string, string[]>();
    if (mediaTagsResult.data) {
      for (const row of mediaTagsResult.data) {
        const existing = tagsByVideo.get(row.asset_id) || [];
        existing.push(row.tag);
        tagsByVideo.set(row.asset_id, existing);
      }
    }

    const analysisByVideo = new Map<string, any>();
    if (mediaAnalysisResult.data) {
      for (const row of mediaAnalysisResult.data) {
        analysisByVideo.set(row.asset_id, row);
      }
    }

    console.log(`Found ${videos.length} videos, ${tagsByVideo.size} with media_tags, ${analysisByVideo.size} with media_analysis`);

    // ═══════════════════════════════════════════════════════════════
    // TOPIC-TO-TAGS: Convert topic into required/forbidden tags
    // ═══════════════════════════════════════════════════════════════
    function topicToRequiredTags(topicStr: string): string[] {
      const t = topicStr.toLowerCase();
      const tags: string[] = [];

      if (t.includes("wrap") || t.includes("install")) tags.push("wrap_install");
      if (t.includes("fleet") || t.includes("commercial")) tags.push("fleet", "commercial");
      if (t.includes("reveal") || t.includes("transform")) tags.push("reveal");
      if (t.includes("before") && t.includes("after")) tags.push("before_after");
      if (t.includes("color change")) tags.push("color_change");
      if (t.includes("truck") || t.includes("van")) tags.push("commercial");
      if (t.includes("peel") || t.includes("satisfying")) tags.push("peel");

      // If no specific tags, default to vehicle content
      if (tags.length === 0) tags.push("vehicle");

      return [...new Set(tags)];
    }

    const requiredTags = topic ? topicToRequiredTags(topic) : [];
    console.log(`Topic "${topic}" → required tags: ${requiredTags.join(", ")}`);

    // Enrich videos with tags and analysis for scoring
    const videosWithTags = videos.map(v => ({
      ...v,
      mediaTags: tagsByVideo.get(v.id) || [],
      mediaAnalysis: analysisByVideo.get(v.id) || null,
    }));

    console.log(`Found ${videos.length} videos, applying deterministic tag-based selection...`);

    // Filter out already-edited content (prefer raw, but don't be too strict)
    const rawVideos = videosWithTags.filter(v => {
      const filename = (v.original_filename || "").toLowerCase();
      // Only filter out obviously edited content
      return !filename.includes("edited") &&
             !filename.includes("final_export") &&
             !filename.includes("ai-reel-") &&
             !filename.includes("render_output");
    });

    // If strict filter leaves us with less than 2 clips, use ALL videos as fallback
    const workingVideos = rawVideos.length >= 2 ? rawVideos : videosWithTags;

    if (workingVideos.length < 2) {
      console.warn(`FAIL-LOUD: Only ${workingVideos.length} clips available total.`);
      return new Response(JSON.stringify({
        error: "INSUFFICIENT_CLIPS",
        message: `Only ${workingVideos.length} clips available.`,
        suggestion: "Upload more source footage to your library."
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    console.log(`Using ${workingVideos.length} clips (${rawVideos.length} passed raw filter, ${videosWithTags.length} total)`)

    // ═══════════════════════════════════════════════════════════════
    // DETERMINISTIC TAG-BASED FILTERING
    // Use media_tags for precise filtering - AI annotates, system decides
    // ═══════════════════════════════════════════════════════════════
    let tagFilteredVideos = workingVideos;
    let tagFilterApplied = false;

    if (requiredTags.length > 0) {
      const tagMatched = workingVideos.filter(v => {
        const videoTags = v.mediaTags || [];
        // Must have at least one required tag
        return requiredTags.some(rt => videoTags.includes(rt));
      });

      console.log(`Tag filter: ${tagMatched.length}/${workingVideos.length} clips match required tags [${requiredTags.join(", ")}]`);

      if (tagMatched.length >= 2) {
        tagFilteredVideos = tagMatched;
        tagFilterApplied = true;
        console.log(`✅ Using ${tagMatched.length} tag-matched clips`);
      } else {
        console.log(`⚠️ Only ${tagMatched.length} clips match required tags, including untagged as fallback`);
        // Prioritize tag-matched, then include others
        tagFilteredVideos = [
          ...tagMatched,
          ...workingVideos.filter(v => !tagMatched.includes(v))
        ];
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // STYLE-BASED TAG FILTERING
    // If a Dara format is selected, filter clips by matching style tags
    // ═══════════════════════════════════════════════════════════════
    let styleFilteredVideos = tagFilteredVideos;
    let styleFilterApplied = false;

    if (dara_format && STYLE_TAG_RULES[dara_format]) {
      const styleMatched = filterByStyleTags(tagFilteredVideos, dara_format);
      console.log(`Style filter "${dara_format}": ${styleMatched.length}/${tagFilteredVideos.length} clips match tags`);

      if (styleMatched.length >= 2) {
        styleFilteredVideos = styleMatched;
        styleFilterApplied = true;
        console.log(`✅ Using ${styleMatched.length} style-matched clips for ${dara_format}`);
      } else {
        console.log(`⚠️ Only ${styleMatched.length} clips match style, using all filtered clips as fallback`);
        styleFilteredVideos = [
          ...styleMatched,
          ...tagFilteredVideos.filter(v => !styleMatched.includes(v))
        ];
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // SCORE + FILTER + DETERMINISTIC SELECTION
    // ═══════════════════════════════════════════════════════════════
    const intent = getIntent(topic || "", content_type || "");
    const SCORE_THRESHOLD = 10;

    const scored = styleFilteredVideos
      .map(v => {
        // Combine visual_tags score + style_tags score + media_tags bonus
        const visualScore = scoreVideoForTopic(v, intent);
        const styleScore = dara_format ? scoreByStyleMatch(v, dara_format) * 5 : 0;

        // BONUS: Score boost for videos with locked system tags matching required tags
        const mediaTagBonus = requiredTags.filter(rt => (v.mediaTags || []).includes(rt)).length * 10;

        // BONUS: Score boost for videos with media_analysis data
        const analysisBonus = v.mediaAnalysis ? 5 : 0;

        return {
          ...v,
          score: visualScore + styleScore + mediaTagBonus + analysisBonus,
          styleScore,
          mediaTagBonus,
          matchedTags: requiredTags.filter(rt => (v.mediaTags || []).includes(rt))
        };
      })
      .filter(v => v.score > SCORE_THRESHOLD || tagFilterApplied || (styleFilterApplied && v.styleScore > 0))
      .sort((a, b) => b.score - a.score);

    console.log(`Scoring complete: ${scored.length} videos qualify (threshold: ${SCORE_THRESHOLD}, tag_filter: ${tagFilterApplied}, style_filter: ${styleFilterApplied})`);

    // ═══════════════════════════════════════════════════════════════
    // FALLBACK MODE: If not enough qualifying clips, use best available
    // This ensures content is ALWAYS created (bootstrap mode)
    // ═══════════════════════════════════════════════════════════════
    let finalCandidates = scored;
    let confidence: "high" | "medium" | "low" = "high";

    if (scored.length < 3) {
      console.warn(`FALLBACK MODE: Only ${scored.length} videos qualify, using best available vehicle clips`);
      confidence = "low";

      // Fallback 1: Use any videos with vehicles, sorted by quality
      const vehicleVideos = rawVideos
        .filter(v => v.visual_tags?.has_vehicle)
        .sort((a, b) => (b.visual_tags?.quality_score ?? 0) - (a.visual_tags?.quality_score ?? 0));

      if (vehicleVideos.length >= 3) {
        finalCandidates = vehicleVideos.slice(0, 10).map(v => ({
          ...v,
          score: v.visual_tags?.quality_score ?? 50,
          styleScore: 0,
          mediaTagBonus: 0,
          matchedTags: [] as string[]
        }));
        console.log(`Fallback 1: Using ${finalCandidates.length} vehicle clips by quality`);
      } else {
        // Fallback 2: Use any raw videos sorted by recency
        finalCandidates = rawVideos.slice(0, 10).map(v => ({
          ...v,
          score: 25,
          styleScore: 0,
          mediaTagBonus: 0,
          matchedTags: [] as string[]
        }));
        console.log(`Fallback 2: Using ${finalCandidates.length} most recent raw clips`);
        confidence = "low";
      }
    } else if (scored.length < 10) {
      confidence = "medium";
    }

    // Diversify the top clips for variety
    const selectedForAI = diversifyTop(finalCandidates, Math.min(20, finalCandidates.length));

    const videoSummary = selectedForAI.map(v => ({
      id: v.id,
      filename: v.original_filename || "Untitled",
      duration: v.duration_seconds || 10,
      tags: v.tags || [],
      category: v.content_category || "raw",
      score: v.score,
      visual_tags: v.visual_tags || {},
    }));

    // Step 4: Call AI to select best videos with inspo context
    const aiRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Analyze these PRE-SCORED videos (higher score = better match for this topic) and select the best ones for a viral reel:\n\n${JSON.stringify(videoSummary, null, 2)}`
          }
        ],
      }),
    });

    if (!aiRes.ok) {
      const errorText = await aiRes.text();
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      throw new Error(`AI error: ${errorText}`);
    }

    const aiJson = await aiRes.json();
    const content = aiJson.choices?.[0]?.message?.content || "{}";

    let result;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = JSON.parse(jsonMatch?.[0] ?? "{}");
    } catch {
      console.error("Failed to parse AI response:", content);
      return new Response(JSON.stringify({
        error: "AI_SELECTION_PARSE_FAILED",
        message: "AI returned an invalid response.",
      }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Enrich selected videos with full data
    let enrichedVideos = (result.selected_videos || [])
      .map((selected: any) => {
        const original = videos.find(v => v.id === selected.id);
        if (!original?.storage_url) return null; // AI hallucinated an id — drop it
        return {
          ...selected,
          storage_url: original.storage_url,
          thumbnail_url: original.thumbnail_url,
          original_filename: original.original_filename,
          duration_seconds: original.duration_seconds,
          visual_tags: original.visual_tags,
        };
      })
      .filter(Boolean);

    // DETERMINISTIC RESCUE: the second (gemini-flash) pass only *ranks* clips we
    // already scored — when it returns an empty/garbled selection or ids that
    // don't map, do NOT ship a build with zero scenes. Fall back to the top
    // deterministically-scored, diversified candidates (selectedForAI is always
    // populated by the fallback modes above). This was the intermittent
    // "can't make a reel" failure: valid library, flaky AND-gated AI pick.
    if (!enrichedVideos.length && selectedForAI.length) {
      console.warn(`AI selection empty — rescuing with ${Math.min(6, selectedForAI.length)} scored clips`);
      enrichedVideos = selectedForAI.slice(0, 6).map((v: any, i: number) => ({
        id: v.id,
        order: i + 1,
        trim_start: 0,
        trim_end: Math.min(4, Number(v.duration_seconds) || 4),
        reason: "Top scored clip (deterministic rescue — AI ranker returned nothing).",
        suggested_overlay: null,
        storage_url: v.storage_url,
        thumbnail_url: v.thumbnail_url,
        original_filename: v.original_filename,
        duration_seconds: v.duration_seconds,
        visual_tags: v.visual_tags,
      }));
    }

    // ═══════════════════════════════════════════════════════════════
    // CAPTION LIBRARY SELECTION (DETERMINISTIC - NO AI GUESSING)
    // PORT-NOTE: caption_library needs a migration; without it captionRow is
    // null and caption_text stays null (graceful degradation).
    // ═══════════════════════════════════════════════════════════════
    let caption_text: string | null = null;

    // Use tags from the first enriched video to determine wrap type and pain signals
    const primaryVideo = enrichedVideos[0];
    const visualTags = primaryVideo?.visual_tags as Record<string, any> || {};
    const wrapTypeCategory = visualTags?.wrap_type_category?.category;
    const painSignals = visualTags?.pain_signals;

    if (wrapTypeCategory && painSignals) {
      const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

      const { data: captionRow } = await supabase
        .from("caption_library")
        .select("*")
        .eq("wrap_type_category", wrapTypeCategory)
        .eq("pain_type", painSignals.pain_type || "customer_expectations")
        .eq("audience", painSignals.audience || "business_owner")
        .eq("intensity", painSignals.intensity || "medium")
        .limit(1)
        .single();

      if (captionRow) {
        caption_text = [
          pick(captionRow.hook || []),
          pick(captionRow.agitate || []),
          pick(captionRow.resolve || []),
          captionRow.cta
        ].filter(Boolean).join("\n\n");
        console.log("Selected caption from library:", caption_text?.substring(0, 50));
      } else {
        console.log("No caption match for:", { wrapTypeCategory, painSignals });
      }
    }

    return new Response(JSON.stringify({
      ...result,
      selected_videos: enrichedVideos,
      total_analyzed: videos.length,
      inspo_files_used: inspoContext ? true : false,
      // Include extracted style for render function to use
      extracted_style: extractedStyle,
      // Caption text from library (deterministic selection)
      caption_text,
      // Confidence level based on scoring results
      confidence,
      // Diagnostics for debugging
      diagnostics: {
        intent,
        threshold: SCORE_THRESHOLD,
        total_videos: videos.length,
        raw_videos: rawVideos.length,
        qualifying_videos: scored.length,
        used_fallback: confidence !== "high",
        caption_source: caption_text ? "library" : "none",
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("video-auto-assemble error:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Unknown error",
      selected_videos: []
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
