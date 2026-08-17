/**
 * proof-revise-view — revise ONE non-hero angle and patch it into an existing
 * proof version. Internal fan-out worker for the multi-view AI revision.
 *
 * Why this exists: a customer revision (proof-revise-ai / proof-intake-submit)
 * used to edit ONLY the hero, so every revision collapsed the proof down to a
 * single angle — the other 3D views + artboards desynced (and visibly
 * "disappeared", showing stale/misspelled older versions). The caller now edits
 * the hero synchronously, carries ALL prior angles forward onto the new version,
 * then fires one of THESE per remaining angle. Each runs as an independent
 * invocation (well under the 150s gateway window — one Gemini call) and patches
 * its revised angle into the new version atomically, so the active version keeps
 * the full angle set and every view receives the same edit.
 *
 * Fire-and-forget: the caller does not await the result; this runs to completion
 * server-side. Idempotent-ish: re-running just overwrites the same key.
 *
 * Body (service-role, server-to-server):
 *   { proof_id, version_id, view_key, source_url, prompt,
 *     vehicle_summary?, finish_type?, reference_image_paths?: string[] }
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runProofRevision } from "../_shared/proof-ai-revise.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: {
      proof_id?: string; version_id?: string; view_key?: string; source_url?: string;
      prompt?: string; vehicle_summary?: string; finish_type?: string;
      reference_image_paths?: string[];
    };
    try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

    const { proof_id, version_id, view_key, source_url, prompt } = body;
    if (!proof_id || !version_id || !view_key || !source_url || !prompt) {
      return jsonResponse({ error: "proof_id, version_id, view_key, source_url, prompt required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve any reference images (proof-uploads storage paths) → signed URLs.
    const refPaths = Array.isArray(body.reference_image_paths)
      ? body.reference_image_paths.filter((p) => typeof p === "string" && p).slice(0, 3)
      : [];
    const referenceImageUrls: string[] = [];
    for (const path of refPaths) {
      const { data: signed } = await db.storage.from("proof-uploads").createSignedUrl(path, 60 * 10);
      if (signed?.signedUrl) referenceImageUrls.push(signed.signedUrl);
    }

    const result = await runProofRevision({
      originalImageUrl: source_url,
      customerPrompt: prompt.trim(),
      vehicleSummary: body.vehicle_summary || undefined,
      finishType: body.finish_type || undefined,
      referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
    });

    if (!result.ok) {
      console.warn(`proof-revise-view: ${view_key} revision failed:`, result.reason, result.error);
      // Non-fatal: the new version already carries the prior (un-revised) angle.
      return jsonResponse({ success: false, view_key, reason: result.reason }, 200);
    }

    // Upload the revised angle.
    const newPath = `renders/proof-ai/${proof_id}/${Date.now()}-${view_key}.png`;
    const { error: upErr } = await db.storage.from("wrap-files").upload(newPath, result.pngBytes, {
      contentType: result.mimeType, upsert: false,
    });
    if (upErr) {
      console.warn(`proof-revise-view: ${view_key} upload failed:`, upErr.message);
      return jsonResponse({ success: false, view_key, error: upErr.message }, 200);
    }
    const { data: { publicUrl } } = db.storage.from("wrap-files").getPublicUrl(newPath);

    // Atomic per-key merge so concurrent angle patches don't clobber each other.
    const { error: rpcErr } = await db.rpc("proof_version_merge_render_url", {
      p_version_id: version_id, p_key: view_key, p_url: publicUrl,
    });
    if (rpcErr) {
      console.warn(`proof-revise-view: ${view_key} merge failed:`, rpcErr.message);
      return jsonResponse({ success: false, view_key, error: rpcErr.message }, 200);
    }

    await db.from("proof_events").insert({
      proof_id, event_type: "ai_revise_view_completed", actor_role: "system",
      payload: { source: "multiview_fanout", view_key, version_id, render_url: publicUrl },
    });

    return jsonResponse({ success: true, view_key, render_url: publicUrl });
  } catch (err: any) {
    console.error("proof-revise-view: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error", detail: err?.message }, 500);
  }
});
