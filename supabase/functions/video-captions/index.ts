// Ported from WrapCommandAI ai-generate-captions (2026-07) — RestylePro-native video pipeline.
// PORT-NOTES:
// - Env: GEMINI_API_KEY → GOOGLE_AI_API_KEY (RestylePro convention). No other secrets.
// - No database access in this function (pure prompt → timed captions JSON) —
//   nothing was stripped; the port is a straight rename.
// - Gemini endpoint/model kept EXACTLY as source: OpenAI-compat chat completions
//   endpoint, model gemini-2.5-flash, function-calling tool "generate_captions".
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STYLE_PROMPTS = {
  sabri: `Generate captions in Sabri Suby direct-response style:
- UPPERCASE for emphasis
- Punchy, aggressive hooks
- Problem-agitation-solution flow
- Urgency and scarcity language
- Use 🔥 💰 ⚡ emojis sparingly
- Short, impactful phrases (2-5 words max)
- Examples: "THIS IS INSANE", "WAIT FOR IT", "WATCH THE REVEAL 🔥"`,

  dara: `Generate captions in Dara Denney UGC style:
- Lowercase, conversational tone
- Relatable and authentic
- "I didn't think this would work" vibes
- Soft CTAs, testimonial feel
- Use emojis naturally
- Storytelling pacing
- Examples: "wait for this...", "honestly obsessed", "the way this turned out 😍"`,

  clean: `Generate captions in clean minimal style:
- Professional and simple
- No emojis
- Sentence case
- Clear and direct
- Elegant pacing
- Examples: "Premium wrap finish", "The transformation", "Before and after"`,
};

// ── BrandCast content packs — the OpenAI brain ───────────────────────────────
// mode:"content_pack": parsed install footage (topic + real transcript +
// verbatim quotes) + the brand's voice → one multi-channel written pack:
// Blog, X, Substack, LinkedIn, Instagram, Facebook + YouTube metadata.
// Additive mode — the default timed-captions behavior is untouched.
const BRAND_OS: Record<string, { name: string; site: string; voice: string; cta: string }> = {
  weprintwraps: {
    name: "WePrintWraps", site: "weprintwraps.com",
    voice: "trade wrap printer talking shop-to-shop; confident, practical, quality-and-turnaround focused; speaks installer language",
    cta: "Send us your print files at weprintwraps.com",
  },
  restylepro: {
    name: "RestyleProAI", site: "restyleproai.com",
    voice: "professional vehicle-wrap visualization platform; sharp, tech-forward, results-first",
    cta: "Visualize your next wrap at restyleproai.com",
  },
  designproai: {
    name: "DesignProAI", site: "designproai.com",
    voice: "prompt-to-production wrap design; bold, category-defining, 'one prompt to print-ready files'",
    cta: "One prompt to print-ready production files — designproai.com",
  },
  wraptvworld: {
    name: "WrapTVWorld", site: "wraptvworld.com",
    voice: "wrap culture media channel; hype, energetic, community-first, shop-floor real",
    cta: "Follow WrapTVWorld for more from the shop floor",
  },
  inkandedge: {
    name: "Ink & Edge Magazine", site: "inkandedgemagazine.com",
    voice: "editorial print-industry magazine; story-driven, craft-focused, long-form literate",
    cta: "Read the full story at inkandedgemagazine.com",
  },
  creatormarket: {
    name: "CreatorMarket", site: "restyleproai.com",
    voice: "marketplace for wrap designers; creator-economy energy, design-first, celebrates the artist behind the wrap",
    cta: "Sell your wrap designs on CreatorMarket",
  },
};

// ── CORE STORY extraction — runs ONCE per footage session ────────────────────
// mode:"core_story": the full transcript (+ vision moment labels) → the ONE
// story the footage tells: hook, narrative beats, tension, payoff, best
// verbatim quotes. Every brand's five anchor pieces are then written FROM
// this story, so all channels tell the same story in different registers.
const STORY_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "the story in one punchy line" },
    hook: { type: "string", description: "the single most gripping opening line, usable on-camera or as a first line" },
    narrative: { type: "string", description: "the core story in 3-6 sentences: who, what happened, why it matters" },
    beats: { type: "array", items: { type: "string" }, description: "3-6 story beats in order (setup, work, tension, payoff)" },
    tension: { type: "string", description: "the problem/challenge/stake in the footage" },
    payoff: { type: "string", description: "the resolution/reveal/result" },
    quotes: { type: "array", items: { type: "string" }, description: "up to 5 best VERBATIM quotes from the transcript, exact words only" },
    cta_angle: { type: "string", description: "the natural ask this story earns" },
  },
  required: ["headline", "hook", "narrative", "beats", "payoff"],
};

async function coreStory(body: Record<string, unknown>) {
  const topic = String(body.topic || "").trim();
  const transcript = String(body.transcript || "").slice(0, 12000);
  const momentLabels = Array.isArray(body.moments) ? (body.moments as string[]).slice(0, 20) : [];
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(JSON.stringify({ success: false, error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!transcript && !topic) {
    return new Response(JSON.stringify({ success: false, error: "transcript or topic required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a documentary story editor for the vehicle-wrap industry. From raw install footage (transcript + what the camera saw), extract the ONE core story the footage actually tells. Quotes must be VERBATIM from the transcript — never paraphrase into quotation marks. If the material is thin, keep the story honest and small rather than inventing drama.`,
        },
        {
          role: "user",
          content: `Job/topic: ${topic || "(untitled install)"}\n\n` +
            (transcript ? `FULL TRANSCRIPT:\n${transcript}\n\n` : "No transcript available — work from the topic and visuals only.\n\n") +
            (momentLabels.length ? `WHAT THE CAMERA SAW (vision-scored moments):\n${momentLabels.map((m) => `- ${m}`).join("\n")}\n\n` : "") +
            `Extract the core story.`,
        },
      ],
      tools: [{ type: "function", function: { name: "deliver_core_story", description: "Return the core story", parameters: STORY_SCHEMA } }],
      tool_choice: { type: "function", function: { name: "deliver_core_story" } },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("[core_story] OpenAI error:", errText.slice(0, 400));
    return new Response(JSON.stringify({ success: false, error: `openai ${res.status}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const data = await res.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) {
    return new Response(JSON.stringify({ success: false, error: "no story returned" }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const story = JSON.parse(args);
  console.log(`[core_story] extracted: ${String(story.headline || "").slice(0, 60)}`);
  return new Response(JSON.stringify({ success: true, story }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ── DOC EDIT — the documentary editor brain ──────────────────────────────────
// mode:"doc_edit": parsed moments (speech beats + vision money-shots, with
// times, quotes, drama scores) → a full EDL cut with documentary grammar:
// cold-open hook, three-act shape, pacing that tightens toward the payoff,
// a hold on the emotional line, ONE deliberate act-break fade, a speed-ramped
// reveal, and a color grade chosen for the story's mood. The client clamps
// every timecode back inside its source moment — the AI can shape the cut
// but can never invent footage.
const EDL_SCHEMA = {
  type: "object",
  properties: {
    grade: { type: "string", enum: ["cinematic", "gritty", "golden", "raw"], description: "color grade for the whole piece, chosen from the story's mood" },
    title: { type: "string", description: "working title of the cut" },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          m: { type: "integer", description: "index into the provided moments list" },
          start: { type: "number", description: "seconds, within (or ±1s of) the moment's own bounds" },
          end: { type: "number" },
          purpose: { type: "string", enum: ["hook", "pattern_interrupt", "proof", "payoff", "b_roll", "reveal", "cta"] },
          text: { type: "string", description: "burned overlay line — use sparingly (hook + payoff), never subtitle every scene" },
          speed: { type: "number", description: "0.4-1.5; use ~0.6 ONLY on one reveal/money shot" },
          fade_in: { type: "boolean", description: "act-break dip — at most 2 in the whole cut" },
        },
        required: ["m", "start", "end", "purpose"],
      },
    },
  },
  required: ["grade", "scenes"],
};

async function docEdit(body: Record<string, unknown>) {
  const topic = String(body.topic || "").trim();
  const transcript = String(body.transcript || "").slice(0, 8000);
  const moments = Array.isArray(body.moments) ? (body.moments as Record<string, unknown>[]).slice(0, 60) : [];
  const target = Number(body.target_duration) || 45;
  const maxScenes = Number(body.max_scenes) || 14;
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(JSON.stringify({ success: false, error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  if (!moments.length) {
    return new Response(JSON.stringify({ success: false, error: "moments required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const momentList = moments.map((m, i) =>
    `#${i} [${Number(m.start).toFixed(1)}–${Number(m.end).toFixed(1)}s] score:${m.score ?? "-"} ${m.quote ? `"${String(m.quote).slice(0, 140)}"` : "(visual moment)"}`,
  ).join("\n");
  // THE SCRIPT (core_story pass over the FULL transcript) — when provided,
  // the cut exists to tell THIS story: open on its hook, follow its beats.
  const st = body.story && typeof body.story === "object" ? body.story as Record<string, unknown> : null;
  const scriptBlock = st
    ? `THE SCRIPT — written from the full transcript. The cut must TELL THIS STORY:\n` +
      `Hook (open on the beat closest to this line): ${st.hook || st.headline || ""}\n` +
      `Story: ${st.narrative || ""}\n` +
      (Array.isArray(st.beats) ? `Acts:\n${(st.beats as string[]).map((b, i) => `${i + 1}. ${b}`).join("\n")}\n` : "") +
      (st.tension ? `Tension: ${st.tension}\n` : "") +
      `Payoff: ${st.payoff || ""}\n\n`
    : "";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a documentary film editor cutting real footage for the vehicle-wrap industry. The moments you receive are COMPLETE BEATS. Your job is to SELECT and ORDER them into a story — the craft rules below are absolute:
- SPEECH IS SACRED: a beat with a quote is a complete spoken line. Use it WHOLE (its exact start/end) or don't use it. NEVER trim inside speech, NEVER speed-ramp a spoken line, NEVER fade over dialogue.
- ONE TAKE PER LINE: if several beats say (nearly) the same thing, pick exactly ONE — the cleanest, most confident delivery. Never repeat a line.
- COLD OPEN: open on the single most gripping COMPLETE line (often from late in the story).
- STORY ORDER: after the hook, sequence lines so the argument builds — problem → consequence → solution → result → CTA. Drop weak lines entirely; shorter and clean beats longer and padded.
- BLOWN TAKES: flubs, "was that good?", direction chatter — leave them out unless one genuinely lands as a human beat.
- SINGLE-SETUP HONESTY: if everything is one talking-head setup, cut a clean best-takes spine — straight cuts, NO fade dips between lines, no fake drama.
- VISUAL BEATS ONLY (no quote): these may be trimmed, speed-ramped (one ~0.6× max), or given a fade_in act break (max 2) — drama lives in the visuals, not the dialogue.
- TEXT: overlay lines only on the hook and the payoff.
- GRADE: pick ONE for the mood — cinematic (polished/emotional), gritty (raw shop hustle), golden (warm/human), raw (news-real).
Total run time ≈ ${target}s, at most ${maxScenes} scenes. Fewer, complete lines beat many fragments.`,
        },
        {
          role: "user",
          content: `Story/topic: ${topic || "(untitled install)"}\n\n${scriptBlock}${transcript ? `FULL TRANSCRIPT (read it all — the story and the drama live here):\n${transcript}\n\n` : ""}MOMENTS (the only usable footage):\n${momentList}\n\nCut the documentary EDL${st ? " to the script" : ""}.`,
        },
      ],
      tools: [{ type: "function", function: { name: "deliver_edl", description: "Return the documentary EDL", parameters: EDL_SCHEMA } }],
      tool_choice: { type: "function", function: { name: "deliver_edl" } },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("[doc_edit] OpenAI error:", errText.slice(0, 400));
    return new Response(JSON.stringify({ success: false, error: `openai ${res.status}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const data = await res.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) {
    return new Response(JSON.stringify({ success: false, error: "no EDL returned" }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const edl = JSON.parse(args);
  // ENFORCE THE CRAFT IN CODE — the model's prompt says it, this guarantees
  // it: speech beats are used at their exact full bounds, never ramped,
  // never faded; and no line appears twice.
  const usedM = new Set<number>();
  edl.scenes = (Array.isArray(edl.scenes) ? edl.scenes : []).filter((s: Record<string, unknown>) => {
    const mi = Number(s.m);
    const mo = moments[mi] as Record<string, unknown> | undefined;
    if (!mo) return false;
    if (usedM.has(mi)) return false; // same beat never twice
    usedM.add(mi);
    if (String(mo.quote || "").trim()) {
      s.start = Number(mo.start);
      s.end = Number(mo.end);
      delete s.speed;
      delete s.fade_in;
    }
    return true;
  });
  console.log(`[doc_edit] ${edl.scenes?.length || 0} scenes, grade=${edl.grade} (speech-craft enforced)`);
  return new Response(JSON.stringify({ success: true, edl }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const PACK_SCHEMA = {
  type: "object",
  properties: {
    blog: {
      type: "object",
      properties: { title: { type: "string" }, body_markdown: { type: "string", description: "400-700 word blog post in markdown" } },
      required: ["title", "body_markdown"],
    },
    x: { type: "string", description: "X/Twitter post, under 280 characters" },
    substack: {
      type: "object",
      properties: { subject: { type: "string" }, body_markdown: { type: "string", description: "newsletter-style piece in markdown" } },
      required: ["subject", "body_markdown"],
    },
    linkedin: { type: "string", description: "LinkedIn post, professional but human, 500-1200 chars" },
    instagram: { type: "string", description: "IG caption with hook first line + hashtags" },
    facebook: { type: "string", description: "FB post, conversational" },
    youtube: {
      type: "object",
      properties: {
        title: { type: "string", description: "under 70 chars" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["title", "description"],
    },
  },
  required: ["blog", "x", "substack", "linkedin", "instagram", "facebook", "youtube"],
};

async function contentPack(body: Record<string, unknown>) {
  const brand = String(body.brand || "weprintwraps");
  const topic = String(body.topic || "").trim();
  const transcript = String(body.transcript || "").slice(0, 6000);
  const quotes = Array.isArray(body.quotes) ? (body.quotes as string[]).slice(0, 8) : [];
  const os = BRAND_OS[brand] || BRAND_OS.weprintwraps;
  if (!topic) {
    return new Response(JSON.stringify({ success: false, error: "topic required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(JSON.stringify({ success: false, error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // The extracted CORE STORY (mode:"core_story") anchors every piece: all
  // five anchors tell the SAME story in their channel's register.
  const story = body.story && typeof body.story === "object" ? body.story as Record<string, unknown> : null;
  const storyBlock = story
    ? `THE CORE STORY (extracted from the footage — every piece tells THIS story):\n` +
      `Headline: ${story.headline || ""}\n` +
      `Hook: ${story.hook || ""}\n` +
      `Narrative: ${story.narrative || ""}\n` +
      (Array.isArray(story.beats) ? `Beats:\n${(story.beats as string[]).map((b, i) => `${i + 1}. ${b}`).join("\n")}\n` : "") +
      (story.tension ? `Tension: ${story.tension}\n` : "") +
      `Payoff: ${story.payoff || ""}\n` +
      (story.cta_angle ? `Natural CTA angle: ${story.cta_angle}\n` : "")
    : "";
  const grounding = transcript
    ? `REAL TRANSCRIPT from the footage (ground every claim here — quote it, never invent facts):\n${transcript}`
    : "No transcript available — write from the topic only; make NO factual claims beyond it.";
  const quoteBlock = quotes.length ? `\nVerbatim quotes worth using:\n${quotes.map((q) => `- "${q}"`).join("\n")}` : "";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are the senior content lead for ${os.name} (${os.site}), a vehicle-wrap ecosystem brand.
Brand voice: ${os.voice}.
Default CTA: ${os.cta}.
You turn real install footage into the FIVE ANCHOR pieces for the big players — Blog, X, LinkedIn, Meta (Instagram + Facebook), YouTube — plus Substack. Every anchor tells the SAME core story, translated into its channel's register: the blog develops the beats in full, X compresses the hook, LinkedIn draws the professional lesson, Meta leads with the payoff, YouTube frames the watch. Every piece must sound like ${os.name}, stand alone on its channel, and stay grounded in the provided material — no invented customers, prices, or specs.`,
        },
        {
          role: "user",
          content: `Footage topic: ${topic}\n\n${storyBlock ? storyBlock + "\n" : ""}${grounding}${quoteBlock}\n\nWrite the five anchors + Substack: blog, X, LinkedIn, Instagram, Facebook, YouTube metadata, and the Substack piece — all telling the core story.`,
        },
      ],
      tools: [{
        type: "function",
        function: { name: "deliver_content_pack", description: "Return the multi-channel content pack", parameters: PACK_SCHEMA },
      }],
      tool_choice: { type: "function", function: { name: "deliver_content_pack" } },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[content_pack] OpenAI error:", errText.slice(0, 400));
    return new Response(JSON.stringify({ success: false, error: `openai ${res.status}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const data = await res.json();
  const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) {
    return new Response(JSON.stringify({ success: false, error: "no pack returned" }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const pack = JSON.parse(args);
  console.log(`[content_pack] ${brand}: pack written (${Object.keys(pack).length} channels)`);
  return new Response(JSON.stringify({ success: true, brand, pack }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    if (body?.mode === "core_story") return await coreStory(body);
    if (body?.mode === "doc_edit") return await docEdit(body);
    if (body?.mode === "content_pack") return await contentPack(body);
    const { video_url, style = "sabri", duration = 15, concept, hook, cta, prompt } = body;

    // Use prompt OR concept as the main content anchor
    const userPrompt = (prompt || concept || "").trim();

    console.log("[video-captions] Input:", {
      style,
      duration,
      promptLen: userPrompt.length,
      hasHook: !!hook,
      hasCta: !!cta,
    });

    // Enforce minimum prompt length for quality output
    if (userPrompt.length < 3) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing prompt. Enter a real concept (e.g., 'Inside Ghost Industries Shop').",
          captions: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");

    if (!apiKey) {
      throw new Error("GOOGLE_AI_API_KEY not configured");
    }

    const stylePrompt = STYLE_PROMPTS[style as keyof typeof STYLE_PROMPTS] || STYLE_PROMPTS.sabri;

    // Build context from AI-provided data
    let contextInfo = `\nReel Concept: ${userPrompt}`;
    if (hook) contextInfo += `\nSuggested Hook: ${hook}`;
    if (cta) contextInfo += `\nSuggested CTA: ${cta}`;

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content: `You are a viral reel caption generator for the vehicle wrap industry.

${stylePrompt}

Generate 4-6 timed captions for a ${duration}-second reel.
Each caption should appear at strategic moments for maximum retention.
${contextInfo}

Structure captions based on reel duration:
- Hook caption (0-2s) - grab attention immediately
- Tease/build-up captions (2s to ${Math.floor(duration * 0.6)}s) - show progress
- Reveal caption (${Math.floor(duration * 0.7)}s to ${Math.floor(duration * 0.85)}s) - showcase result
- CTA caption (${Math.floor(duration * 0.85)}s to ${duration}s) - call to action

IMPORTANT: Time captions proportionally to the actual ${duration}s duration.`,
          },
          {
            role: "user",
            content: `Generate viral captions for a vehicle wrap reel${video_url ? ` (video: ${video_url})` : ''}.
Duration: ${duration} seconds.
Style: ${style}.
${concept ? `Theme: ${concept}` : ''}
${hook ? `Use this hook concept: ${hook}` : ''}
${cta ? `End with CTA similar to: ${cta}` : ''}

Create engaging captions that will maximize watch time and engagement.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "generate_captions",
              description: "Return timed captions for the reel",
              parameters: {
                type: "object",
                properties: {
                  captions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        text: { type: "string", description: "Caption text" },
                        start: { type: "number", description: "Start time in seconds" },
                        end: { type: "number", description: "End time in seconds" },
                        emoji: { type: "string", description: "Optional emoji" },
                      },
                      required: ["text", "start", "end"],
                    },
                  },
                },
                required: ["captions"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "generate_captions" } },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI API error:", errorText);

      // Return fallback captions scaled to duration
      const fallbackCaptions = [
        { text: hook || (style === "sabri" ? "WATCH THIS 🔥" : style === "dara" ? "wait for it..." : "The transformation"), start: 0, end: 2 },
        { text: style === "sabri" ? "THIS IS INSANE" : style === "dara" ? "honestly obsessed" : "Premium finish", start: 2, end: Math.min(4, duration * 0.3) },
        { text: style === "sabri" ? "THE REVEAL" : style === "dara" ? "the way this turned out 😍" : "Before and after", start: Math.floor(duration * 0.7), end: Math.floor(duration * 0.85) },
        { text: cta || (style === "sabri" ? "LINK IN BIO 💰" : style === "dara" ? "dm for info ✨" : "Contact us"), start: Math.floor(duration * 0.85), end: duration },
      ];

      return new Response(
        JSON.stringify({ success: true, captions: fallbackCaptions }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments);
      console.log(`Generated ${result.captions?.length || 0} captions for ${duration}s ${style} reel`);
      return new Response(
        JSON.stringify({ success: true, captions: result.captions }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error("Failed to generate captions");
  } catch (error: unknown) {
    console.error("video-captions error:", error);
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errMsg, captions: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
