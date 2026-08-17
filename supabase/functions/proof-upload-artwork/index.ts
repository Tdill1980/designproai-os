/**
 * proof-upload-artwork — Phase 6 shop-side upload.
 *
 * Lets a shop owner upload external (non-RestylePro) artwork (PDF, PNG, JPG,
 * WebP) that becomes the v1 content of a new proof. Each uploaded file gets
 * a storage path in the `proof-uploads` bucket under:
 *   pending/<shop_id>/<timestamp>-<filename>
 *
 * After upload, the shop calls proof-create with `uploaded_file_paths` set
 * to the returned paths (source_visualization_id omitted).
 *
 * Why a dedicated endpoint instead of direct storage uploads?
 *   - Enforces per-file size + type at the network edge before bytes hit
 *     storage (8MB per file, max 6 files).
 *   - Keeps the proof-uploads bucket policy service-role-write-only (the
 *     same policy protecting signatures and audit PDFs).
 *   - One consistent auth surface (shop JWT) rather than per-file RLS.
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

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 6;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

interface UploadFile {
  filename: string;
  content_type: string;
  data_base64: string;
}

interface UploadRequest {
  files: UploadFile[];
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

    let body: UploadRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!Array.isArray(body.files) || body.files.length === 0) {
      return jsonResponse({ error: "files array required" }, 400);
    }
    if (body.files.length > MAX_FILES) {
      return jsonResponse(
        { error: `Too many files (max ${MAX_FILES})` },
        400,
      );
    }

    // Pre-validate every file BEFORE writing anything so partial uploads
    // don't leave orphan storage objects.
    for (const f of body.files) {
      if (!f || typeof f !== "object") {
        return jsonResponse({ error: "Invalid file entry" }, 400);
      }
      if (!f.filename || !f.content_type || !f.data_base64) {
        return jsonResponse(
          { error: "Each file needs filename, content_type, data_base64" },
          400,
        );
      }
      if (!ALLOWED_MIME.has(f.content_type)) {
        return jsonResponse(
          { error: `Unsupported file type: ${f.content_type}` },
          400,
        );
      }
      // base64 inflates by ~33%; verify approximate decoded size
      const approxBytes = Math.floor((f.data_base64.length * 3) / 4);
      if (approxBytes > MAX_BYTES) {
        return jsonResponse(
          { error: `${f.filename} is too large (max ${MAX_BYTES / 1024 / 1024}MB)` },
          413,
        );
      }
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const timestamp = Date.now();
    const uploaded: Array<{ path: string; filename: string; content_type: string; preview_url: string | null }> = [];

    for (let i = 0; i < body.files.length; i++) {
      const f = body.files[i];
      let bytes: Uint8Array;
      try {
        const b64 = f.data_base64.replace(/^data:[^,]+,/, "");
        const bin = atob(b64);
        bytes = new Uint8Array(bin.length);
        for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
      } catch {
        return jsonResponse(
          { error: `${f.filename} is not valid base64`, uploaded },
          400,
        );
      }
      if (bytes.byteLength > MAX_BYTES) {
        return jsonResponse(
          { error: `${f.filename} exceeds ${MAX_BYTES / 1024 / 1024}MB`, uploaded },
          413,
        );
      }

      const ext = safeExt(f.content_type, f.filename);
      const safeName = sanitizeFilename(f.filename);
      // pending/ prefix because these uploads aren't yet attached to a proof.
      // proof-create will copy them into their final proof_id-scoped paths.
      const path = `pending/${shopId}/${timestamp}-${i}-${safeName}.${ext}`;

      const { error: uploadErr } = await db.storage
        .from("proof-uploads")
        .upload(path, bytes, {
          contentType: f.content_type,
          upsert: false,
        });
      if (uploadErr) {
        console.error("proof-upload-artwork: upload failed:", uploadErr);
        return jsonResponse(
          { error: `${f.filename}: ${uploadErr.message}`, uploaded },
          500,
        );
      }

      const { data: signed } = await db.storage
        .from("proof-uploads")
        .createSignedUrl(path, 60 * 60 * 24);

      uploaded.push({
        path,
        filename: f.filename,
        content_type: f.content_type,
        preview_url: signed?.signedUrl || null,
      });
    }

    return jsonResponse({ success: true, uploaded });
  } catch (err: any) {
    console.error("proof-upload-artwork: unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error", detail: err?.message },
      500,
    );
  }
});
