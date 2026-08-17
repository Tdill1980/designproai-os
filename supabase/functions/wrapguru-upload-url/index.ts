// =============================================================================
// wrapguru-upload-url — mint a one-shot signed upload URL for the chat widget.
//
// The widget lives on weprintwraps.com (a site we don't control the build of),
// so it must not carry any API key. Instead it asks here for a signed upload
// URL, PUTs the file straight to storage, and then sends the chat turn with
// only the object PATH.
//
// The SERVER picks the path — the caller cannot choose where the file lands, so
// nothing can be written outside `uploads/<session>/`. The bucket stays private
// and no read access is granted: `wrapguru-file-check` signs the object with
// the service role when it needs the bytes.
// =============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mirrors the widget's own guard; enforced here too since the widget is public.
const ALLOWED_EXT = ["pdf", "png", "jpg", "jpeg", "psd", "ai", "eps", "tif", "tiff"];
const MAX_BYTES = 50 * 1024 * 1024;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const rawName = String(body.file_name || "").trim();
    const size = Number(body.file_size) || 0;
    const sessionId = String(body.session_id || "").trim().slice(0, 80);

    if (!rawName || !sessionId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing file_name or session_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const ext = rawName.toLowerCase().split(".").pop() || "";
    if (!ALLOWED_EXT.includes(ext)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Unsupported file type .${ext}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (size > MAX_BYTES) {
      return new Response(
        JSON.stringify({ ok: false, error: "File is over the 50MB limit" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return new Response(
        JSON.stringify({ ok: false, error: "upload unavailable" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const db = createClient(url, key, { auth: { persistSession: false } });

    // Server-chosen path. Session is slugged so a crafted session_id can't
    // traverse out of uploads/.
    const safeSession = sessionId.replace(/[^\w.-]/g, "_");
    const safeName = rawName.replace(/[^\w.-]/g, "_").slice(-120);
    const path = `uploads/${safeSession}/${Date.now()}-${safeName}`;

    const { data, error } = await db.storage
      .from("wrapguru-files")
      .createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      console.error("[wrapguru-upload-url] sign failed:", error?.message);
      return new Response(
        JSON.stringify({ ok: false, error: "could not create upload url" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, path, signed_url: data.signedUrl, token: data.token }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[wrapguru-upload-url] error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e).slice(0, 160) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
