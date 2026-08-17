/**
 * ace-speak — text-to-voice for the customer portal. Gives ACE his Onyx voice.
 *
 * ACE is a chat-based designer; on the customer portal he can TALK BACK. The
 * portal posts the text of an ACE reply here; we run it through OpenAI's
 * text-to-speech with the "onyx" voice and return MP3 audio (base64) for the
 * browser to play. Gated by the proof view token (HMAC) — same auth boundary
 * as the rest of the public portal — so the OpenAI key can't be hit anonymously.
 *
 * Body: { token, text, voice? }  →  { success: true, audio_base64, mime }
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { verifyProofToken } from "../_shared/proof-tokens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Encode bytes → base64 (chunked to avoid call-stack limits on large buffers).
function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    let body: { token?: string; text?: string; voice?: string };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    if (!body.token) return json({ error: "token required" }, 400);
    const text = (body.text || "").trim();
    if (!text) return json({ error: "text required" }, 400);
    // Keep clips short — this is conversational, not narration.
    if (text.length > 1200) return json({ error: "text too long" }, 413);

    let verified: string | null;
    try { verified = await verifyProofToken(body.token, "view"); }
    catch { return json({ error: "Server misconfiguration" }, 500); }
    if (!verified) return json({ error: "Invalid token" }, 404);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "Voice isn't configured" }, 503);

    // ACE's voice is "onyx" — locked unless the caller explicitly overrides.
    const voice = (body.voice || "onyx").toLowerCase();

    const resp = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice,
        input: text,
        response_format: "mp3",
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("ace-speak: tts error", resp.status, errText.slice(0, 300));
      return json({ error: "Couldn't generate voice", detail: resp.status }, 502);
    }

    const buf = new Uint8Array(await resp.arrayBuffer());
    return json({ success: true, audio_base64: encodeBase64(buf), mime: "audio/mpeg" });
  } catch (e: any) {
    console.error("ace-speak: error", e);
    return json({ error: "Unexpected server error", detail: e?.message }, 500);
  }
});
