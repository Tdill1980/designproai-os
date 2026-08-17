/**
 * ace-transcribe — voice-to-text for the customer portal's "Type to ACE" box.
 *
 * ACE is a chat-based designer; customers can TALK to him instead of typing.
 * The browser records a short audio clip and posts it here; we run it through
 * OpenAI Whisper and return the transcript, which the portal drops into the
 * chat input. Gated by the proof view token (HMAC) — same auth boundary as the
 * rest of the public portal — so the OpenAI key can't be hit anonymously.
 *
 * Body: { token, audio_base64, mime? }  →  { success: true, text }
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

// Decode a base64 (optionally data-URL-prefixed) string into bytes.
function decodeBase64(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    let body: { token?: string; audio_base64?: string; mime?: string };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    if (!body.token) return json({ error: "token required" }, 400);
    if (!body.audio_base64 || body.audio_base64.length < 32) {
      return json({ error: "audio_base64 required" }, 400);
    }

    let verified: string | null;
    try { verified = await verifyProofToken(body.token, "view"); }
    catch { return json({ error: "Server misconfiguration" }, 500); }
    if (!verified) return json({ error: "Invalid token" }, 404);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "Voice input isn't configured" }, 503);

    const bytes = decodeBase64(body.audio_base64);
    // Guard against oversized uploads (~25MB is OpenAI's hard limit; keep ours small).
    if (bytes.length > 20 * 1024 * 1024) return json({ error: "Clip too long" }, 413);

    const mime = body.mime || "audio/webm";
    const ext = mime.includes("mp4") ? "mp4" : mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : "webm";

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), `clip.${ext}`);
    form.append("model", "whisper-1");
    form.append("response_format", "json");

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(45_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      console.error("ace-transcribe: whisper error", resp.status, errText.slice(0, 300));
      return json({ error: "Couldn't transcribe — try again", detail: resp.status }, 502);
    }

    const data = await resp.json().catch(() => ({}));
    const text = (data?.text || "").trim();
    return json({ success: true, text });
  } catch (e: any) {
    console.error("ace-transcribe: error", e);
    return json({ error: "Unexpected server error", detail: e?.message }, 500);
  }
});
