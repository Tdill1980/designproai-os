/**
 * proof-create-upload-url — large-file upload helper.
 *
 * The classic proof-upload-artwork takes base64 in the JSON body, which
 * caps out around 8 MB because of the Supabase edge function body limit.
 * Production-resolution 2D proofs (Carley's exports) routinely exceed
 * that. This function returns a short-lived signed upload URL the
 * browser can PUT directly to Supabase Storage — no body limit on the
 * function itself.
 *
 * Request:
 *   { filename: string, content_type: string }
 *
 * Response:
 *   { success, path, token, signed_url }
 *
 * Then the client uses
 *   supabase.storage.from('proof-uploads').uploadToSignedUrl(path, token, file)
 * to push the file directly. Once uploaded, call proof-save-version with
 * uploaded_file_paths: [path] to attach it to a proof as a new version.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
]);

interface RequestBody {
  filename: string;
  content_type: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeExt(contentType: string, filename: string): string {
  const map: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/tiff": "tif",
  };
  if (map[contentType]) return map[contentType];
  const fromName = filename.split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  return "bin";
}

function sanitizeFilename(name: string): string {
  const stem = name.replace(/\.[^.]+$/, "");
  return stem.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "upload";
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid auth token" }, 401);
    const shopId = user.id;

    let body: RequestBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!body.filename || typeof body.filename !== "string") {
      return jsonResponse({ error: "filename required" }, 400);
    }
    if (!body.content_type || typeof body.content_type !== "string") {
      return jsonResponse({ error: "content_type required" }, 400);
    }
    if (!ALLOWED_MIME.has(body.content_type)) {
      return jsonResponse(
        { error: `Unsupported content_type: ${body.content_type}` },
        400,
      );
    }

    const ext = safeExt(body.content_type, body.filename);
    const safeName = sanitizeFilename(body.filename);
    const timestamp = Date.now();
    // Upload into the PUBLIC wrap-files bucket so customer-facing views
    // can load the image directly without needing a signed URL refresh.
    // The path stays scoped per shop so files are organized.
    const path = `proof-uploads/${shopId}/${timestamp}-${safeName}.${ext}`;

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await db.storage
      .from("wrap-files")
      .createSignedUploadUrl(path);

    if (error || !data) {
      console.error("proof-create-upload-url: signed url failed:", error);
      return jsonResponse(
        { error: "Failed to create upload URL", detail: error?.message },
        500,
      );
    }

    // Resolve the eventual public URL the browser will load after the
    // upload completes. Stored alongside the path so the client can
    // pass it through to proof-save-version when attaching to a
    // line item.
    const { data: pub } = db.storage.from("wrap-files").getPublicUrl(path);

    return jsonResponse({
      success: true,
      bucket: "wrap-files",
      path: data.path,
      token: data.token,
      signed_url: data.signedUrl,
      public_url: pub?.publicUrl || null,
    });
  } catch (err: any) {
    console.error("proof-create-upload-url: error:", err);
    return jsonResponse(
      { error: err?.message || "Unexpected error" },
      500,
    );
  }
});
