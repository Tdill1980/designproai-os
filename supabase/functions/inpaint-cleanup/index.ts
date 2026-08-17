/**
 * inpaint-cleanup — ClipDrop Cleanup API proxy for RevisionIQ element removal.
 *
 * The client-side magic wand in src/lib/logo-composite.ts can SELECT an element
 * cleanly (BFS color region), but its built-in "median color stamp" fill is
 * garbage on photoreal vehicle renders because the wrap under the selection
 * has curvature, lighting, shadows, and texture that a single color cannot
 * reproduce. This function swaps that bad fill for a real inpainting pass.
 *
 * Flow:
 *   1. Client sends the source render + a matching-size binary mask (white =
 *      remove, black = keep) as base64.
 *   2. We forward both to ClipDrop's Cleanup endpoint with the CLIPDROP_API_KEY
 *      secret.
 *   3. ClipDrop returns a PNG with the masked region inpainted using content-
 *      aware texture synthesis.
 *   4. We upload the result to Supabase Storage (wrap-files bucket) under the
 *      user's clean-backgrounds folder and return the public URL.
 *
 * If CLIPDROP_API_KEY is not set or the upstream call fails, this function
 * returns a descriptive error so the client can gracefully fall back to the
 * local median fill.
 *
 * ClipDrop docs: https://clipdrop.co/apis/docs/cleanup
 */

export const maxDuration = 30;

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const CLIPDROP_ENDPOINT = "https://clipdrop-api.co/cleanup/v1";

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ---- Auth ----
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!authHeader || authHeader === "Bearer") {
      return new Response(
        JSON.stringify({ code: "AUTH_ERROR", message: "No authorization token provided" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ code: "AUTH_ERROR", message: `Not authenticated: ${authError?.message || "user not found"}` }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- API key check ----
    const apiKey = Deno.env.get("CLIPDROP_API_KEY");
    if (!apiKey) {
      console.warn("[inpaint-cleanup] CLIPDROP_API_KEY secret is not set — client should fall back to local fill");
      return new Response(
        JSON.stringify({
          code: "API_KEY_MISSING",
          message: "CLIPDROP_API_KEY secret is not configured on this Supabase project",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- Parse body ----
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return new Response(
        JSON.stringify({ code: "BAD_REQUEST", message: "JSON body required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { imageBase64, maskBase64, imageMimeType = "image/png" } = body as {
      imageBase64?: string;
      maskBase64?: string;
      imageMimeType?: string;
    };

    if (!imageBase64 || !maskBase64) {
      return new Response(
        JSON.stringify({ code: "BAD_REQUEST", message: "imageBase64 and maskBase64 are both required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Rough safety: ClipDrop max is ~30 MB per file. Base64 adds ~33% overhead,
    // so cap the base64 length at ~40 MB to stay well under.
    if (imageBase64.length > 40 * 1024 * 1024 || maskBase64.length > 40 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ code: "PAYLOAD_TOO_LARGE", message: "Image or mask exceeds 30 MB" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const imageBytes = base64ToUint8Array(imageBase64);
    const maskBytes = base64ToUint8Array(maskBase64);

    console.log(`[inpaint-cleanup] user=${user.id.substring(0, 8)} image=${(imageBytes.length / 1024).toFixed(0)}KB mask=${(maskBytes.length / 1024).toFixed(0)}KB`);

    // ---- Forward to ClipDrop ----
    const form = new FormData();
    form.append(
      "image_file",
      new Blob([imageBytes], { type: imageMimeType }),
      "image.png",
    );
    form.append(
      "mask_file",
      new Blob([maskBytes], { type: "image/png" }),
      "mask.png",
    );
    // ClipDrop Cleanup accepts a `mode` field — "quality" is slower but
    // produces significantly better results on textured surfaces like wraps.
    form.append("mode", "quality");

    const upstream = await fetch(CLIPDROP_ENDPOINT, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error(`[inpaint-cleanup] ClipDrop HTTP ${upstream.status}: ${errText.substring(0, 300)}`);
      return new Response(
        JSON.stringify({
          code: "UPSTREAM_ERROR",
          message: `ClipDrop returned ${upstream.status}: ${errText.substring(0, 200)}`,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const cleanedBuf = await upstream.arrayBuffer();
    const cleanedBytes = new Uint8Array(cleanedBuf);
    console.log(`[inpaint-cleanup] ClipDrop returned ${(cleanedBytes.length / 1024).toFixed(0)}KB`);

    // ---- Upload result to Supabase Storage ----
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const fileName = `renders/${user.id}/clean-backgrounds/cleaned_${Date.now()}.png`;
    const { error: uploadError } = await serviceClient.storage
      .from("wrap-files")
      .upload(fileName, cleanedBytes, { contentType: "image/png", upsert: true });

    if (uploadError) {
      console.error(`[inpaint-cleanup] Storage upload failed: ${uploadError.message}`);
      return new Response(
        JSON.stringify({ code: "STORAGE_ERROR", message: `Upload failed: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: { publicUrl } } = serviceClient.storage
      .from("wrap-files")
      .getPublicUrl(fileName);

    console.log(`[inpaint-cleanup] ✅ Success: ${publicUrl.substring(0, 80)}...`);

    return new Response(
      JSON.stringify({ cleanedImageUrl: publicUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[inpaint-cleanup] Unhandled error: ${message}`);
    return new Response(
      JSON.stringify({ code: "INTERNAL_ERROR", message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
