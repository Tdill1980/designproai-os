/**
 * proof-upload-revision-ref — Phase 3.
 *
 * Customer-facing upload endpoint. The public proof page calls this BEFORE
 * submitting a revision request so reference images land in the private
 * `proof-uploads` bucket via the service role (customers have no direct
 * storage credentials).
 *
 * Accepts (POST multipart OR JSON with base64):
 *   - token              (HMAC view token)
 *   - filename           (original filename — for human readability)
 *   - content_type       (image/jpeg, image/png, image/webp, image/heic)
 *   - data_base64        (base64-encoded bytes)
 *
 * Returns:
 *   - path        (storage path — to be passed back to proof-request-revision)
 *   - preview_url (signed URL, valid 24h, so the UI can show the thumbnail)
 *
 * Size cap: 8MB per upload. Max 4 uploads per revision request (enforced
 * client-side; this endpoint doesn't track a counter).
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

interface UploadRequest {
  token: string;
  filename: string;
  content_type: string;
  data_base64: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeExt(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
  };
  return map[contentType] || "bin";
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "upload";
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: UploadRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!body.token) return jsonResponse({ error: "token required" }, 400);
    if (!body.filename) return jsonResponse({ error: "filename required" }, 400);
    if (!body.content_type || !ALLOWED_MIME.has(body.content_type)) {
      return jsonResponse(
        { error: "Only JPEG, PNG, WebP, HEIC/HEIF images are allowed" },
        400,
      );
    }
    if (!body.data_base64 || body.data_base64.length < 100) {
      return jsonResponse({ error: "data_base64 required" }, 400);
    }

    // Verify HMAC before any work
    let verifiedUuid: string | null;
    try {
      verifiedUuid = await verifyProofToken(body.token, "view");
    } catch (err) {
      console.error("proof-upload-revision-ref: token verify threw:", err);
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }
    if (!verifiedUuid) return jsonResponse({ error: "Invalid token" }, 404);

    // Decode + size check
    let bytes: Uint8Array;
    try {
      const b64 = body.data_base64.replace(/^data:[^,]+,/, "");
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch {
      return jsonResponse({ error: "Invalid base64 payload" }, 400);
    }
    if (bytes.byteLength > MAX_BYTES) {
      return jsonResponse(
        { error: `File too large (max ${MAX_BYTES / 1024 / 1024}MB)` },
        413,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Look up proof (need proof_id for the path + to confirm proof is not terminal)
    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("id, status, mode, expires_at, view_token")
      .eq("view_token", body.token)
      .single();
    if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);
    if (proof.mode !== "revision_loop") {
      return jsonResponse(
        { error: "Uploads only allowed on revision-loop proofs" },
        409,
      );
    }
    if (["approved", "declined", "revoked", "expired"].includes(proof.status)) {
      return jsonResponse({ error: `Proof is ${proof.status}` }, 409);
    }
    if (proof.expires_at && new Date(proof.expires_at) < new Date()) {
      return jsonResponse({ error: "Proof has expired" }, 410);
    }

    // Get current active version number for the path
    const { data: activeVersion } = await db
      .from("proof_versions")
      .select("version_number")
      .eq("proof_id", proof.id)
      .eq("is_active", true)
      .maybeSingle();
    const versionNumber = activeVersion?.version_number ?? 1;

    const ext = safeExt(body.content_type);
    const safeName = sanitizeFilename(body.filename);
    const timestamp = Date.now();
    const path =
      `${proof.id}/customer-refs/${versionNumber}/${timestamp}-${safeName}.${ext}`;

    const { error: uploadErr } = await db.storage
      .from("proof-uploads")
      .upload(path, bytes, {
        contentType: body.content_type,
        upsert: false,
      });
    if (uploadErr) {
      console.error("proof-upload-revision-ref: upload failed:", uploadErr);
      return jsonResponse(
        { error: "Upload failed", detail: uploadErr.message },
        500,
      );
    }

    // Signed URL for immediate preview in the UI (24 hours)
    const { data: signed } = await db.storage
      .from("proof-uploads")
      .createSignedUrl(path, 60 * 60 * 24);

    return jsonResponse({
      success: true,
      path,
      preview_url: signed?.signedUrl || null,
    });
  } catch (err: any) {
    console.error("proof-upload-revision-ref: unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error", detail: err?.message },
      500,
    );
  }
});
