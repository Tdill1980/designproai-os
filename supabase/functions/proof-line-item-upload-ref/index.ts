/**
 * proof-line-item-upload-ref — Phase 8C.
 *
 * Customer-facing upload endpoint for per-line-item reference images. Mirrors
 * proof-upload-revision-ref but the storage path is nested under the specific
 * line item id so the shop can see which reference belongs to which line:
 *
 *   proof-uploads/<proof_id>/line-items/<line_item_id>/<timestamp>-<file>
 *
 * Accepts JSON:
 *   - token         (HMAC view token)
 *   - line_item_id  (uuid — must belong to the proof)
 *   - filename      (original filename)
 *   - content_type  (image/jpeg, image/png, image/webp, image/heic/heif)
 *   - data_base64   (raw bytes, <= 8MB)
 *
 * Returns { path, preview_url }. The client calls this up to 4 times per
 * line and then hands the resulting paths to proof-line-item-decision
 * as reference_image_paths.
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
  line_item_id: string;
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
    if (!body.line_item_id) {
      return jsonResponse({ error: "line_item_id required" }, 400);
    }
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

    let verifiedUuid: string | null;
    try {
      verifiedUuid = await verifyProofToken(body.token, "view");
    } catch (err) {
      console.error("proof-line-item-upload-ref: token verify threw:", err);
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }
    if (!verifiedUuid) return jsonResponse({ error: "Invalid token" }, 404);

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

    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("id, status, mode, expires_at, has_line_items")
      .eq("view_token", body.token)
      .single();
    if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);
    if (!proof.has_line_items) {
      return jsonResponse(
        { error: "This proof has no line items" },
        409,
      );
    }
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

    // Confirm the line item belongs to this proof
    const { data: lineItem, error: liErr } = await db
      .from("proof_line_items")
      .select("id")
      .eq("id", body.line_item_id)
      .eq("proof_id", proof.id)
      .maybeSingle();
    if (liErr || !lineItem) {
      return jsonResponse({ error: "Line item not found" }, 404);
    }

    const ext = safeExt(body.content_type);
    const safeName = sanitizeFilename(body.filename);
    const timestamp = Date.now();
    const path =
      `${proof.id}/line-items/${body.line_item_id}/${timestamp}-${safeName}.${ext}`;

    const { error: uploadErr } = await db.storage
      .from("proof-uploads")
      .upload(path, bytes, {
        contentType: body.content_type,
        upsert: false,
      });
    if (uploadErr) {
      console.error("proof-line-item-upload-ref: upload failed:", uploadErr);
      return jsonResponse(
        { error: "Upload failed", detail: uploadErr.message },
        500,
      );
    }

    const { data: signed } = await db.storage
      .from("proof-uploads")
      .createSignedUrl(path, 60 * 60 * 24);

    return jsonResponse({
      success: true,
      path,
      preview_url: signed?.signedUrl || null,
    });
  } catch (err: any) {
    console.error("proof-line-item-upload-ref: unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error", detail: err?.message },
      500,
    );
  }
});
