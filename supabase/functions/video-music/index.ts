// Ported from WrapCommandAI ai-match-music (2026-07) — RestylePro-native video pipeline.
// PORT-NOTES:
// - Env: GEMINI_API_KEY → GOOGLE_AI_API_KEY (RestylePro convention). Also reads
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (auto-provided to edge functions).
// - Music table: source read `music_library` → renamed `video_music_library`.
//   This table does NOT exist in restylepro yet and needs a migration. Columns
//   this function reads (select * then references): id, mood (text),
//   energy (text), bpm (int), genre (text), duration_seconds (numeric),
//   created_at, plus a playable track URL column (source used file_url; the
//   scoring code no longer references it directly — suggest storage_url per
//   RestylePro convention; whole rows are returned to the caller as
//   `recommendations`). The function degrades gracefully (AI mood analysis
//   only, empty recommendations) until the table exists.
// - STRIPPED: `video_edit_queue` update (WrapCommand-only bookkeeping — wrote
//   selected_music_id/selected_music_url onto the source repo's edit-queue row).
//   The `video_edit_id` request field is accepted but ignored; the caller in the
//   RestylePro pipeline is responsible for persisting the top pick (e.g. onto
//   the future video_render_jobs row).
// - Gemini endpoint/model kept EXACTLY as source: OpenAI-compat chat completions
//   endpoint, model gemini-2.5-flash.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AI_KEY = Deno.env.get("GOOGLE_AI_API_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // video_edit_id accepted for request-shape compatibility but unused (see PORT-NOTES)
    const { video_edit_id: _video_edit_id, transcript, duration_seconds, mood_override } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Analyze video mood from transcript
    const moodPrompt = `Analyze this video transcript and determine the best background music mood.

Transcript:
${transcript?.slice(0, 2000) || "No transcript - assume energetic content"}

Consider:
- Overall energy level (low, medium, high)
- Emotional tone (hype, chill, dramatic, motivational, professional)
- Suggested BPM range
- Music genre that would fit (electronic, cinematic, hip-hop, ambient, rock)

Return JSON only:
{
  "energy": "high",
  "mood": "hype",
  "bpm_min": 120,
  "bpm_max": 140,
  "genres": ["electronic", "hip-hop"],
  "reasoning": "Brief explanation"
}`;

    let videoMood = { energy: "medium", mood: "neutral", bpm_min: 100, bpm_max: 130, genres: ["electronic"] };

    if (!mood_override) {
      try {
        const moodRes = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${AI_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gemini-2.5-flash",
            messages: [{ role: "user", content: moodPrompt }]
          })
        });

        if (moodRes.ok) {
          const moodJson = await moodRes.json();
          const content = moodJson.choices?.[0]?.message?.content || "{}";
          const match = content.match(/\{[\s\S]*\}/);
          if (match) {
            videoMood = { ...videoMood, ...JSON.parse(match[0]) };
          }
        }
      } catch (e) {
        console.error("Mood analysis failed:", e);
      }
    } else {
      videoMood.mood = mood_override;
    }

    console.log(`Video mood detected: ${videoMood.mood}, energy: ${videoMood.energy}`);

    // Fetch music from library matching mood
    // PORT-NOTE: video_music_library needs a migration; until it exists this
    // query errors and we fall through with AI mood suggestions only.
    const { data: musicLibrary, error: musicError } = await supabase
      .from("video_music_library")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (musicError) {
      console.error("Music library fetch error:", musicError);
      // If table doesn't exist or is empty, return AI-generated placeholder recommendations
      console.log("Music library empty or unavailable - returning AI suggestions only");
    }

    console.log(`Found ${musicLibrary?.length || 0} tracks in music library`);

    // Score and rank music tracks
    const scoredTracks = (musicLibrary || []).map(track => {
      let score = 0;

      // Mood match
      if (track.mood === videoMood.mood) score += 30;

      // Energy match
      if (track.energy === videoMood.energy) score += 25;

      // BPM in range
      if (track.bpm && track.bpm >= videoMood.bpm_min && track.bpm <= videoMood.bpm_max) {
        score += 20;
      }

      // Duration fit (prefer tracks close to video length)
      if (duration_seconds && track.duration_seconds) {
        const ratio = track.duration_seconds / duration_seconds;
        if (ratio >= 0.8 && ratio <= 1.5) score += 15;
      }

      // Genre match
      if (track.genre && videoMood.genres?.includes(track.genre.toLowerCase())) {
        score += 10;
      }

      return { ...track, match_score: score };
    });

    // Sort by score and return top 3
    const recommendations = scoredTracks
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, 3);

    // STRIPPED (WrapCommand-only): source updated video_edit_queue with
    // selected_music_id/selected_music_url here. The RestylePro caller persists
    // the top pick itself (video_render_jobs, once that table lands).

    return new Response(
      JSON.stringify({
        success: true,
        video_mood: videoMood,
        recommendations,
        top_pick: recommendations[0] || null
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("video-music error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
